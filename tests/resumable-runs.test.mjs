import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startServer } from '../server.mjs';
import { parseRetryAfterMs } from '../lib/model.mjs';
import { computeNextResumeAt, recoverRunningResumableRuns } from '../lib/resumable-runs.mjs';
import { fixture, scriptedModel } from './helpers.mjs';

function rateLimitResponse(headers = {}) {
  return new Response(JSON.stringify({ error: { message: 'rate limited' } }), {
    status: 429,
    headers: { 'content-type': 'application/json', ...headers }
  });
}

function toolCallResponse(name, args) {
  return new Response(JSON.stringify({
    choices: [{
      message: {
        content: null,
        tool_calls: [{ id: 'call_1', type: 'function', function: { name, arguments: JSON.stringify(args) } }]
      },
      finish_reason: 'tool_calls'
    }]
  }), { headers: { 'content-type': 'application/json' } });
}

function request(app, path, { method = 'GET', json } = {}) {
  const url = new URL(app.url);
  const body = json === undefined ? undefined : JSON.stringify(json);
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path,
      method,
      agent: false,
      headers: {
        ...(json === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(body === undefined ? {} : { 'Content-Length': Buffer.byteLength(body) })
      }
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let data;
        try { data = JSON.parse(text); } catch {}
        resolve({ status: res.statusCode, text, data });
      });
    });
    req.on('error', reject);
    req.end(body);
  });
}

test('parseRetryAfterMs and computeNextResumeAt handle headers and 5->15->60m backoff', () => {
  const nowMs = Date.parse('2030-01-15T12:00:00.000Z');
  assert.equal(parseRetryAfterMs(new Headers({ 'retry-after': '45' }), nowMs), 45000);
  assert.equal(parseRetryAfterMs(new Headers({ 'x-ratelimit-reset-requests': '1m30s' }), nowMs), 90000);
  assert.equal(parseRetryAfterMs(new Headers({}), nowMs), null);

  assert.equal(computeNextResumeAt({ retryAfterMs: 30000, retryCount: 0, nowMs }), '2030-01-15T12:00:30.000Z');
  assert.equal(computeNextResumeAt({ retryAfterMs: null, retryCount: 0, nowMs }), '2030-01-15T12:05:00.000Z');
  assert.equal(computeNextResumeAt({ retryAfterMs: null, retryCount: 1, nowMs }), '2030-01-15T12:15:00.000Z');
  assert.equal(computeNextResumeAt({ retryAfterMs: null, retryCount: 2, nowMs }), '2030-01-15T13:00:00.000Z');
  assert.equal(computeNextResumeAt({ retryAfterMs: null, retryCount: 5, nowMs }), '2030-01-15T13:00:00.000Z');
});

test('single chat pauses mid-tool on 429 and auto-resumes via scheduler.tick() without repeating completed tools', async t => {
  const { api, personaId, calls } = fixture(t, [
    toolCallResponse('calculator', { expression: '12 * 13' }),
    rateLimitResponse({ 'retry-after': '30' }),
    '12 乘以 13 等于 156。'
  ]);
  api.updateSettings({ criticEnabled: false });
  const convId = api.createConversation({ personaId }).conversation.id;

  const first = await api.sendMessage(convId, { content: '请计算 12 * 13' });
  assert.ok(first.userMessage);
  assert.equal(first.message, null);
  assert.ok(first.pausedRun);
  assert.equal(first.pausedRun.kind, 'chat');
  assert.equal(first.pausedRun.status, 'paused_quota');
  assert.equal(first.pausedRun.step, 1);
  assert.equal(api.bootstrap().resumableRuns.length, 1);

  // Tick before cooldown arrives -> does not resume yet
  await api.scheduler.tick(Date.now() + 5000);
  assert.equal(api.bootstrap().resumableRuns.length, 1);

  // Tick after Retry-After (30s) -> auto-resumes from step 1 checkpoint and finishes!
  await api.scheduler.tick(Date.parse(first.pausedRun.resumeAt) + 1000);
  assert.equal(api.bootstrap().resumableRuns.length, 0);
  const msgs = api.getConversation(convId).messages;
  assert.equal(msgs.length, 2);
  assert.equal(msgs[1].role, 'assistant');
  assert.ok(msgs[1].content.includes('156'));
  // Confirm resumed call received the already-executed tool result in messages (did not redo step 0)
  const resumedCall = calls.at(-1);
  assert.ok(resumedCall.body.messages.some(m => m.role === 'tool' && String(m.content).includes('156')));
});

test('group chat pauses at second speaker on 429 and resumes with modelOverride', async t => {
  const { api, personaId, calls } = fixture(t, [
    '第一棒回复完成。',
    JSON.stringify({ shouldReply: true, speakerPersonaId: 'REPLACE_ME', intent: 'chime_in', cue: '接一句', reason: '接话' }),
    rateLimitResponse(),
    '第二棒换模型续跑成功！',
    JSON.stringify({ shouldReply: false, speakerPersonaId: null, intent: 'silence', cue: '', reason: '收尾' })
  ]);
  api.updateSettings({ criticEnabled: false });
  const a = api.savePersona({ name: '甲角色', systemPrompt: '我是甲' }).persona;
  const b = api.savePersona({ name: '乙角色', systemPrompt: '我是乙' }).persona;
  const group = api.createConversation({ kind: 'group', title: '群聊断点', personaIds: [a.id, b.id], maxAutoTurns: 3 }).conversation;

  // Replace placeholder speaker id in scripted director reply via a fresh fixture
  const mock = scriptedModel(
    '第一棒回复完成。',
    JSON.stringify({ shouldReply: true, speakerPersonaId: b.id, intent: 'chime_in', cue: '接一句', reason: '接话' }),
    rateLimitResponse(),
    '第二棒换模型续跑成功！',
    JSON.stringify({ shouldReply: false, speakerPersonaId: null, intent: 'silence', cue: '', reason: '收尾' })
  );
  const app = await startServer({
    port: 0,
    dbPath: ':memory:',
    scheduler: false,
    modelOptions: { fetchImpl: mock.fetchImpl, apiKey: '', timeoutMs: 1000 }
  });
  t.after(() => app.close());
  app.api.updateSettings({ baseUrl: 'http://model.invalid/v1', model: 'main-model', criticEnabled: false });
  const p1 = app.api.savePersona({ name: '甲角色', systemPrompt: '我是甲' }).persona;
  const p2 = app.api.savePersona({ name: '乙角色', systemPrompt: '我是乙' }).persona;
  const mock2 = scriptedModel(
    '第一棒回复完成。',
    JSON.stringify({ shouldReply: true, speakerPersonaId: p2.id, intent: 'chime_in', cue: '接一句', reason: '接话' }),
    rateLimitResponse(),
    '第二棒换模型续跑成功！',
    JSON.stringify({ shouldReply: false, speakerPersonaId: null, intent: 'silence', cue: '', reason: '收尾' })
  );
  const app2 = await startServer({
    port: 0,
    dbPath: ':memory:',
    scheduler: false,
    modelOptions: { fetchImpl: mock2.fetchImpl, apiKey: '', timeoutMs: 1000 }
  });
  t.after(() => app2.close());
  app2.api.updateSettings({ baseUrl: 'http://model.invalid/v1', model: 'main-model', criticEnabled: false });
  const gp1 = app2.api.savePersona({ name: '甲角色', systemPrompt: '我是甲' }).persona;
  const gp2 = app2.api.savePersona({ name: '乙角色', systemPrompt: '我是乙' }).persona;
  const gConv = app2.api.createConversation({ kind: 'group', title: '茶室群聊', personaIds: [gp1.id, gp2.id], maxAutoTurns: 3 }).conversation;

  // Point director reply at actual gp2.id by using dynamic function reply
  const dynamicCalls = [];
  let seq = 0;
  const app3 = await startServer({
    port: 0,
    dbPath: ':memory:',
    scheduler: false,
    modelOptions: {
      apiKey: '',
      timeoutMs: 1000,
      fetchImpl: async (_url, init) => {
        const body = JSON.parse(init.body);
        dynamicCalls.push(body);
        seq++;
        if (seq === 1) return new Response(JSON.stringify({ choices: [{ message: { content: '第一棒回复完成。' } }] }), { headers: { 'content-type': 'application/json' } });
        if (seq === 2) return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ shouldReply: true, speakerPersonaId: pB.id, intent: 'chime_in', cue: '接一句', reason: '接话' }) } }] }), { headers: { 'content-type': 'application/json' } });
        if (seq === 3) return rateLimitResponse();
        if (seq === 4) return new Response(JSON.stringify({ choices: [{ message: { content: '第二棒换模型续跑成功！' } }] }), { headers: { 'content-type': 'application/json' } });
        return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ shouldReply: false, speakerPersonaId: null, intent: 'silence', cue: '', reason: '收尾' }) } }] }), { headers: { 'content-type': 'application/json' } });
      }
    }
  });
  t.after(() => app3.close());
  app3.api.updateSettings({ baseUrl: 'http://model.invalid/v1', model: 'main-model', criticEnabled: false });
  const pA = app3.api.savePersona({ name: '甲角色', systemPrompt: '我是甲' }).persona;
  const pB = app3.api.savePersona({ name: '乙角色', systemPrompt: '我是乙' }).persona;
  const room = app3.api.createConversation({ kind: 'group', title: '茶室群聊', personaIds: [pA.id, pB.id], maxAutoTurns: 3 }).conversation;

  const firstTurn = await app3.api.sendMessage(room.id, { content: '@甲角色 请先说一句' });
  assert.equal(firstTurn.messages.length, 1);
  assert.ok(firstTurn.pausedRun);
  assert.equal(firstTurn.pausedRun.kind, 'group');
  assert.equal(firstTurn.pausedRun.step, 1);

  // Resume with modelOverride via HTTP endpoint
  const resumeRes = await request(app3, `/api/resumable-runs/${firstTurn.pausedRun.id}/resume`, {
    method: 'POST',
    json: { modelOverride: 'backup-fast-model' }
  });
  assert.equal(resumeRes.status, 200);
  assert.equal(resumeRes.data.status, 'completed');
  assert.equal(app3.api.getConversation(room.id).messages.length, 3);
  assert.equal(dynamicCalls[3].model, 'backup-fast-model');
  assert.ok(personaId && calls && group && gConv);
});

test('scheduled AI task pauses on 429 with backoff and completes on tick, plus PUT/DELETE HTTP controls', async t => {
  const mock = scriptedModel(
    rateLimitResponse(),
    rateLimitResponse(),
    '定时任务最终完成！'
  );
  const app = await startServer({
    port: 0,
    dbPath: ':memory:',
    scheduler: false,
    modelOptions: { fetchImpl: mock.fetchImpl, apiKey: '', timeoutMs: 1000 }
  });
  t.after(() => app.close());
  app.api.updateSettings({ baseUrl: 'http://model.invalid/v1', model: 'main-model', criticEnabled: false });
  const personaId = app.api.bootstrap().personas[0].id;
  const task = app.api.saveTask({
    name: '晚间总结任务',
    type: 'prompt',
    personaId,
    prompt: '总结一下今天的计划',
    scheduleType: 'once',
    nextRunAt: '2030-01-15T12:00:00.000Z',
    enabled: true
  }).task;

  const run1 = await app.api.scheduler.run(task.id);
  assert.equal(run1.status, 'paused_quota');
  const active1 = app.api.bootstrap().resumableRuns;
  assert.equal(active1.length, 1);
  assert.equal(active1[0].kind, 'task');
  assert.equal(active1[0].retryCount, 0);

  // Adjust resume time via PUT /api/resumable-runs/:id
  const customTime = new Date(Date.now() + 60000).toISOString();
  const putRes = await request(app, `/api/resumable-runs/${active1[0].id}`, {
    method: 'PUT',
    json: { resumeAt: customTime, modelOverride: 'alt-model' }
  });
  assert.equal(putRes.status, 200);
  assert.equal(putRes.data.run.modelOverride, 'alt-model');

  // Second 429 increments retryCount to 1 (15m backoff)
  const retry1 = await app.api.resumeRun(active1[0].id, { time: Date.parse(customTime) });
  assert.equal(retry1.status, 'paused_quota');
  assert.equal(retry1.pausedRun.retryCount, 1);

  // Recovering 'running' rows after simulated crash restores them to paused_quota
  app.store.run("UPDATE resumable_runs SET status='running' WHERE id=?", active1[0].id);
  recoverRunningResumableRuns(app.store);
  assert.equal(app.store.get('SELECT status FROM resumable_runs WHERE id=?', active1[0].id).status, 'paused_quota');

  // Tick after due time completes task and updates task_runs to success
  await app.api.scheduler.tick(Date.now() + 2 * 3600000);
  assert.equal(app.api.bootstrap().resumableRuns.length, 0);
  const finalTaskRun = app.store.get('SELECT * FROM task_runs WHERE id=?', run1.id);
  assert.equal(finalTaskRun.status, 'success');
  assert.ok(finalTaskRun.result.includes('定时任务最终完成'));
});
