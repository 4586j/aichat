import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startServer } from '../server.mjs';
import { addConversation, addMessages, iso, TIME } from './helpers.mjs';

async function app(t) {
  const running = await startServer({ port: 0, dbPath: ':memory:', scheduler: false, modelOptions: { apiKey: '', timeoutMs: 1000 } });
  t.after(() => running.close());
  return running;
}
const call = (running, path, { method = 'GET', json } = {}) => new Promise((resolve, reject) => {
  const url = new URL(running.url);
  const body = json === undefined ? undefined : JSON.stringify(json);
  const req = http.request({ hostname: url.hostname, port: url.port, path, method, agent: false,
    headers: body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {} }, res => {
    let text = '';
    res.on('data', c => { text += c; });
    res.on('end', () => resolve({ status: res.statusCode, data: text ? JSON.parse(text) : undefined }));
  });
  req.on('error', reject);
  req.end(body);
});

test('autonomy settings, pause, events and inbox endpoints', async t => {
  const running = await app(t);
  assert.equal((await call(running, '/api/autonomy/settings')).data.autonomy.enabled, false);
  const saved = await call(running, '/api/autonomy/settings', { method: 'PUT', json: { enabled: true, dailyLimit: 2 } });
  assert.equal(saved.data.autonomy.dailyLimit, 2);
  assert.equal((await call(running, '/api/autonomy/settings', { method: 'PUT', json: { dailyLimit: 999 } })).status, 400);
  assert.equal((await call(running, '/api/autonomy/pause', { method: 'POST', json: {} })).data.autonomy.paused, true);
  assert.deepEqual((await call(running, '/api/autonomy/events')).data.events, []);
  assert.deepEqual((await call(running, '/api/inbox?since=0')).data.messages, []);
  assert.equal((await call(running, '/api/bootstrap')).data.autonomy.paused, true);
});

test('GET /api/events streams autonomous and task messages and cleans up on close', async t => {
  const running = await app(t);
  const { api, store } = running;
  const personaId = store.get('SELECT id FROM personas LIMIT 1').id;
  const conversationId = addConversation(api, personaId);
  addMessages(store, conversationId, ['hi', 'hello'], TIME);
  const url = new URL(running.url);
  const frames = [];
  const req = http.get({ hostname: url.hostname, port: url.port, path: '/api/events', agent: false });
  const res = await new Promise(resolve => req.on('response', resolve));
  assert.match(res.headers['content-type'], /text\/event-stream/);
  res.setEncoding('utf8');
  res.on('data', chunk => frames.push(chunk));
  await new Promise(resolve => setTimeout(resolve, 50));
  api.autonomy.deliver({ conversationId, content: '你好，在吗？', trigger: 'idle', time: TIME + 1000 });
  const { task } = api.saveTask({ name: '作业', type: 'reminder', prompt: '写作业', scheduleType: 'once', nextRunAt: iso(TIME) });
  await api.scheduler.run(task.id);
  await new Promise(resolve => setTimeout(resolve, 100));
  const text = frames.join('');
  assert.match(text, /event: autonomous_message\ndata: .*你好，在吗/u);
  assert.match(text, /event: task_finished\ndata: .*写作业/u);
  req.destroy();
});
