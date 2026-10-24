import test from 'node:test';
import assert from 'node:assert/strict';
import { AppError } from '../lib/model.mjs';
import { fixture, TIME, iso, errorStatus, addPersona, addConversation, addMessages, deferred, modelResponse } from './helpers.mjs';

const reminder = extra => ({ name: 'Reminder', type: 'reminder', prompt: 'Take a break', scheduleType: 'interval',
  intervalMinutes: 10, nextRunAt: iso(TIME), ...extra });
const getTask = (store, id) => store.get('SELECT * FROM tasks WHERE id=?', id);
const runs = (store, id) => store.all('SELECT * FROM task_runs WHERE taskId=? ORDER BY startedAt', id);

test('interval runs exactly when due, advances from tick time, and does not replay missed intervals', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: TIME });
  const { api, store, calls } = fixture(t);
  const { task } = api.saveTask(reminder());
  await api.scheduler.tick(TIME - 1);
  assert.equal(runs(store, task.id).length, 0);
  await api.scheduler.tick(TIME);
  assert.equal(runs(store, task.id).length, 1);
  assert.equal(runs(store, task.id)[0].status, 'success');
  assert.equal(runs(store, task.id)[0].result, 'Take a break');
  assert.equal(getTask(store, task.id).nextRunAt, iso(TIME + 10 * 60000));
  assert.equal(getTask(store, task.id).running, false);
  await api.scheduler.tick(TIME);
  await api.scheduler.tick(TIME + 10 * 60000 - 1);
  assert.equal(runs(store, task.id).length, 1);
  await api.scheduler.tick(TIME + 10 * 60000);
  assert.equal(runs(store, task.id).length, 2);
  await api.scheduler.tick(TIME + 24 * 3600000);
  assert.equal(runs(store, task.id).length, 3, 'only one catch-up execution');
  assert.equal(getTask(store, task.id).nextRunAt, iso(TIME + 24 * 3600000 + 10 * 60000));
  assert.equal(calls.length, 0);
});

test('once tasks disable after due run; disabled and future tasks do not run', async t => {
  const { api, store, calls } = fixture(t);
  const once = api.saveTask(reminder({ scheduleType: 'once', intervalMinutes: null })).task;
  const disabled = api.saveTask(reminder({ enabled: false })).task;
  const future = api.saveTask(reminder({ nextRunAt: iso(TIME + 3600000) })).task;
  await api.scheduler.tick(TIME);
  assert.equal(runs(store, once.id).length, 1);
  assert.equal(getTask(store, once.id).enabled, false);
  assert.equal(runs(store, disabled.id).length, 0);
  assert.equal(runs(store, future.id).length, 0);
  await api.scheduler.tick(TIME + 1);
  assert.equal(runs(store, once.id).length, 1);
  assert.equal(calls.length, 0);
});

test('manual run of a disabled task records execution without changing its schedule', async t => {
  const { api, store } = fixture(t);
  const { task } = api.saveTask(reminder({ enabled: false, scheduleType: 'once' }));
  const run = await api.scheduler.run(task.id);
  assert.equal(run.status, 'success');
  assert.ok(run.startedAt && run.finishedAt);
  assert.equal(run.taskName, task.name);
  assert.equal(getTask(store, task.id).nextRunAt, task.nextRunAt);
  assert.equal(getTask(store, task.id).enabled, false);
  assert.deepEqual(api.deleteTask(task.id), { ok: true });
  assert.equal(runs(store, task.id).length, 0, 'run records cascade on deletion');
  await assert.rejects(api.scheduler.run(task.id), errorStatus(404));
});

for (const scheduleType of ['interval', 'once']) {
  test(`failed scheduled ${scheduleType} task records error, releases lock and avoids immediate repeat`, async t => {
    const { api, store, personaId, calls } = fixture(t, [new TypeError('PRIVATE_UPSTREAM_DETAIL')]);
    const { task } = api.saveTask(reminder({ name: 'Model task', type: 'prompt', personaId, prompt: 'Plan my day', scheduleType }));
    await api.scheduler.tick(TIME);
    const records = runs(store, task.id);
    assert.equal(records.length, 1);
    assert.equal(records[0].status, 'failed');
    assert.match(records[0].result, /无法连接/);
    assert.ok(!records[0].result.includes('PRIVATE_UPSTREAM_DETAIL'));
    assert.ok(records[0].finishedAt);
    assert.equal(getTask(store, task.id).running, false);
    assert.equal(getTask(store, task.id).enabled, scheduleType !== 'once');
    assert.equal(store.get('SELECT COUNT(*) AS n FROM messages').n, 0);
    await api.scheduler.tick(TIME);
    assert.equal(runs(store, task.id).length, 1);
    assert.equal(calls.length, 1);
  });
}

test('prompt task succeeds with configured mocked model, not a fake canned scheduler answer', async t => {
  const { api, personaId, calls } = fixture(t, ['Actual mocked plan']);
  const { task } = api.saveTask(reminder({ type: 'prompt', personaId, prompt: 'Plan my day' }));
  const run = await api.scheduler.run(task.id);
  assert.equal(run.status, 'success');
  assert.equal(run.result, 'Actual mocked plan');
  assert.equal(calls[0].body.messages.at(-1).content, 'Plan my day');
});

test('summary task processes only its selected role', async t => {
  const { api, store, personaId, calls } = fixture(t, [{ memories: [] }]);
  const conversationId = addConversation(api, personaId);
  addMessages(store, conversationId, ['hello', 'hi']);
  const otherId = addConversation(api, addPersona(api));
  addMessages(store, otherId, ['OTHER_ROLE_PRIVATE_HISTORY', 'other reply']);
  const { task } = api.saveTask(reminder({ type: 'summarize', personaId, prompt: '' }));
  const run = await api.scheduler.run(task.id);
  assert.equal(run.status, 'success');
  assert.match(run.result, /2 条消息.*0 条记忆/);
  assert.ok(api.getConversation(conversationId).conversation.summaryCursor > 0);
  assert.equal(api.getConversation(otherId).conversation.summaryCursor, 0);
  assert.equal(calls.length, 1);
  assert.ok(!JSON.stringify(calls).includes('OTHER_ROLE_PRIVATE_HISTORY'));
});

test('concurrent task run rejects, edits/deletion are blocked, and independent ticks cannot double execute', async t => {
  const gate = deferred();
  const { api, store, personaId, calls } = fixture(t, [() => gate.promise]);
  const { task } = api.saveTask(reminder({ type: 'prompt', personaId, prompt: 'waiting' }));
  const pending = api.scheduler.tick(TIME);
  const second = api.scheduler.tick(TIME);
  try {
    assert.equal(getTask(store, task.id).running, true);
    assert.equal(getTask(store, task.id).running, true);
    await assert.rejects(api.scheduler.run(task.id), errorStatus(409));
    assert.throws(() => api.saveTask({ name: 'edited' }, task.id), errorStatus(409));
    assert.throws(() => api.deleteTask(task.id), errorStatus(409));
    assert.equal(runs(store, task.id).length, 1);
    assert.equal(calls.length, 1);
  } finally { gate.resolve(modelResponse('finished')); }
  await Promise.all([pending, second]);
  assert.equal(getTask(store, task.id).running, false);
  assert.equal(runs(store, task.id)[0].status, 'success');
  assert.equal(api.saveTask({ name: 'edited' }, task.id).task.name, 'edited');
});

test('slow model work and automatic summaries do not delay newly due reminders', async t => {
  const modelGate = deferred();
  const summaryGate = deferred();
  const { api, store, personaId } = fixture(t, [() => modelGate.promise]);
  api.memory.automatic = () => summaryGate.promise;
  api.saveTask(reminder({ type: 'prompt', personaId, prompt: 'slow model task' }));
  const later = api.saveTask(reminder({ name: 'Time sensitive', nextRunAt: iso(TIME + 1000) })).task;
  try {
    await api.scheduler.tick(TIME, { wait: false });
    assert.equal(runs(store, later.id).length, 0);
    await api.scheduler.tick(TIME + 1000, { wait: false });
    assert.equal(runs(store, later.id)[0].status, 'success');
    assert.equal(store.get("SELECT COUNT(*) AS n FROM task_runs WHERE status='running'").n, 1);
  } finally {
    modelGate.resolve(modelResponse('completed'));
    summaryGate.resolve();
    await api.scheduler.stop();
  }
});

test('recover marks interrupted runs failed, resets running flags and preserves completed history', async t => {
  const { api, store } = fixture(t);
  const { task } = api.saveTask(reminder());
  const completed = await api.scheduler.run(task.id);
  store.run('UPDATE tasks SET running=1 WHERE id=?', task.id);
  store.run('INSERT INTO task_runs VALUES (?,?,?,?,?,?,?)', 'interrupted-run', task.id, task.name, 'running', '', iso(TIME), null);
  api.scheduler.recover();
  assert.equal(getTask(store, task.id).running, false);
  const interrupted = store.get('SELECT * FROM task_runs WHERE id=?', 'interrupted-run');
  assert.equal(interrupted.status, 'failed');
  assert.match(interrupted.result, /服务在执行期间退出/);
  assert.ok(interrupted.finishedAt);
  assert.deepEqual(store.get('SELECT * FROM task_runs WHERE id=?', completed.id), completed);
  api.scheduler.recover();
  assert.deepEqual(store.get('SELECT * FROM task_runs WHERE id=?', 'interrupted-run'), interrupted);
  assert.equal((await api.scheduler.run(task.id)).status, 'success');
});

test('unexpected summary error is sanitized and AppError retains actionable message', async t => {
  const { api, personaId } = fixture(t);
  const { task } = api.saveTask(reminder({ type: 'summarize', personaId }));
  api.memory.summarizePersona = async () => { throw new Error('INTERNAL_PRIVATE_DETAIL'); };
  assert.equal((await api.scheduler.run(task.id)).result, '任务执行失败，请检查输入与服务状态。');
  api.memory.summarizePersona = async () => { throw new AppError('模型未配置', 503); };
  assert.equal((await api.scheduler.run(task.id)).result, '模型未配置');
});

test('task validation rejects bad schedules and values without insertion', t => {
  const { api, store, personaId } = fixture(t);
  const invalid = [{ name: '' }, { type: 'shell' }, { scheduleType: 'cron' }, { intervalMinutes: 0 },
    { intervalMinutes: 525601 }, { intervalMinutes: 1.5 }, { intervalMinutes: '10' }, { enabled: 'true' },
    { nextRunAt: 'not a date' }, { prompt: 'x'.repeat(8001) }, { type: 'prompt', personaId, prompt: '' },
    { type: 'prompt', personaId: 'missing' }];
  for (const input of invalid) assert.throws(() => api.saveTask(reminder(input)), error => errorStatus(400)(error) || errorStatus(404)(error));
  assert.equal(store.get('SELECT COUNT(*) AS n FROM tasks').n, 0);
  for (const intervalMinutes of [1, 525600]) assert.equal(api.saveTask(reminder({ intervalMinutes })).task.intervalMinutes, intervalMinutes);
  assert.throws(() => api.saveTask({}, 'missing'), errorStatus(404));
  assert.throws(() => api.deleteTask('missing'), errorStatus(404));
});
