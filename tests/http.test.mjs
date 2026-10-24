import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../server.mjs';
import { scriptedModel, base64 } from './helpers.mjs';

async function localApp(t, replies = []) {
  const mock = scriptedModel(...replies);
  const app = await startServer({ port: 0, dbPath: ':memory:', scheduler: false,
    modelOptions: { fetchImpl: mock.fetchImpl, apiKey: '', timeoutMs: 1000 } });
  t.after(() => app.close());
  app.api.updateSettings({ model: 'test-model', baseUrl: 'http://model.invalid/v1' });
  return { app, ...mock };
}

// Only the loopback address returned by startServer is contacted. Host/Origin
// overrides are sent as headers, never interpreted as remote destinations.
function request(app, path, { method = 'GET', json, raw, headers = {} } = {}) {
  const url = new URL(app.url);
  const body = raw ?? (json === undefined ? undefined : JSON.stringify(json));
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: url.hostname, port: url.port, path, method, agent: false,
      headers: { ...(json === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(body === undefined ? {} : { 'Content-Length': Buffer.byteLength(body) }), ...headers } }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('error', reject);
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let data;
        try { data = JSON.parse(text); } catch { data = undefined; }
        resolve({ status: res.statusCode, headers: res.headers, text, data });
      });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('Local HTTP test timed out')));
    req.end(body);
  });
}

function assertHttpError(response, status) {
  assert.equal(response.status, status, response.text);
  assert.equal(typeof response.data?.error, 'string');
  assert.ok(!Object.hasOwn(response.data, 'stack'));
}

test('HTTP serves bootstrap and static assets with defensive headers', async t => {
  const { app, calls } = await localApp(t);
  const bootstrap = await request(app, '/api/bootstrap');
  assert.equal(bootstrap.status, 200);
  assert.equal(bootstrap.data.personas.length, 1);
  assert.equal(bootstrap.data.stats.messageCount, 0);
  assert.equal(bootstrap.headers['x-content-type-options'], 'nosniff');
  assert.equal(bootstrap.headers['x-frame-options'], 'DENY');
  assert.equal(bootstrap.headers['referrer-policy'], 'no-referrer');
  assert.equal(bootstrap.headers['cache-control'], 'no-store');
  assert.match(bootstrap.headers['content-security-policy'], /frame-ancestors 'none'/);
  const page = await request(app, '/');
  assert.equal(page.status, 200);
  assert.match(page.headers['content-type'], /text\/html/);
  const head = await request(app, '/', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.text, '');
  assert.equal(head.headers['content-length'], page.headers['content-length']);
  assertHttpError(await request(app, '/server.mjs'), 404);
  assertHttpError(await request(app, '/api/does-not-exist'), 404);
  assertHttpError(await request(app, '/api/conversations/%ZZ'), 400);
  assert.equal(calls.length, 0);
});

test('HTTP permits only exact loopback Host and same-host same-origin requests', async t => {
  const { app, calls } = await localApp(t);
  const port = new URL(app.url).port;
  for (const host of ['evil.invalid', `evil.invalid:${port}`, `127.0.0.1.evil.invalid:${port}`, `localhost:${Number(port) + 1}`]) {
    assertHttpError(await request(app, '/api/bootstrap', { headers: { Host: host } }), 403);
  }
  for (const origin of ['https://evil.invalid', 'null', `http://localhost:${port}`, `https://127.0.0.1:${port}`]) {
    assertHttpError(await request(app, '/api/bootstrap', { headers: { Origin: origin } }), 403);
  }
  assertHttpError(await request(app, '/api/bootstrap', { headers: { 'Sec-Fetch-Site': 'cross-site' } }), 403);
  assert.equal((await request(app, '/api/bootstrap', { headers: { Origin: app.url, 'Sec-Fetch-Site': 'same-origin' } })).status, 200);
  assert.equal((await request(app, '/api/bootstrap', { headers: { Host: `localhost:${port}`, Origin: `http://localhost:${port}` } })).status, 200);
  assert.equal(calls.length, 0);
});

test('cross-origin writes cannot mutate settings or call the provider', async t => {
  const { app, calls } = await localApp(t);
  const before = app.api.model.settings();
  const result = await request(app, '/api/settings', { method: 'PUT', json: { model: 'attacker-choice' }, headers: { Origin: 'https://evil.invalid' } });
  assertHttpError(result, 403);
  assert.deepEqual(app.api.model.settings(), before);
  assert.equal(calls.length, 0);
});

for (const [name, raw] of [['truncated object', '{"model":'], ['array', '[]'], ['null', 'null'], ['string', '"model"'], ['number', '42']]) {
  test(`HTTP rejects malformed/non-object JSON: ${name}`, async t => {
    const { app } = await localApp(t);
    const before = app.api.model.settings();
    assertHttpError(await request(app, '/api/settings', { method: 'PUT', raw, headers: { 'Content-Type': 'application/json' } }), 400);
    assert.deepEqual(app.api.model.settings(), before);
  });
}

for (const contentType of [undefined, 'text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=test', 'application/jsonp']) {
  test(`HTTP rejects unsupported Content-Type ${contentType ?? '(missing)'}`, async t => {
    const { app } = await localApp(t);
    assertHttpError(await request(app, '/api/settings', { method: 'PUT', raw: '{}',
      headers: contentType ? { 'Content-Type': contentType } : {} }), 415);
  });
}

test('HTTP accepts JSON charset parameter and rejects oversized body before parsing', async t => {
  const { app } = await localApp(t);
  const response = await request(app, '/api/settings', { method: 'PUT', raw: '{"memoryBudget":10}',
    headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  assert.equal(response.status, 200);
  assert.equal(response.data.settings.memoryBudget, 10);
  assertHttpError(await request(app, '/api/settings', { method: 'PUT', raw: '{}',
    headers: { 'Content-Type': 'application/json', 'Content-Length': String(12 * 1024 * 1024 + 1) } }), 413);
});

test('HTTP settings never expose fake API key and validate invalid boundaries', async t => {
  const { app, calls } = await localApp(t, ['连接成功']);
  const fakeKey = 'HTTP_TEST_ONLY_NOT_A_CREDENTIAL';
  const saved = await request(app, '/api/settings', { method: 'PUT', json: { apiKey: fakeKey } });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.settings.hasApiKey, true);
  for (const response of [saved, await request(app, '/api/settings'), await request(app, '/api/bootstrap')]) {
    assert.ok(!response.text.includes(fakeKey));
    assert.ok(!Object.hasOwn(response.data.settings, 'apiKey'));
  }
  const checked = await request(app, '/api/settings/test', { method: 'POST', json: {} });
  assert.equal(checked.status, 200);
  assert.deepEqual(checked.data, { ok: true, message: '连接成功' });
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${fakeKey}`);
  assertHttpError(await request(app, '/api/settings', { method: 'PUT', json: { memoryBudget: 9 } }), 400);
});

test('HTTP routes create conversation, knowledge, memories, chat and delete documents', async t => {
  const { app, calls } = await localApp(t, ['Jasmine tea is aromatic. [1]']);
  const personaId = app.api.bootstrap().personas[0].id;
  const imported = await request(app, '/api/documents', { method: 'POST', json: { name: 'tea.txt', data: base64('Jasmine tea is aromatic.') } });
  assert.equal(imported.status, 200);
  const documentId = imported.data.document.id;
  const memory = await request(app, '/api/memories', { method: 'POST', json: { personaId, content: 'Prefers jasmine tea' } });
  assert.equal(memory.status, 200);
  const conversation = await request(app, '/api/conversations', { method: 'POST', json: { personaId } });
  assert.equal(conversation.status, 200);
  const conversationId = conversation.data.conversation.id;
  const sent = await request(app, `/api/conversations/${conversationId}/messages`, { method: 'POST', json: { content: 'jasmine tea' } });
  assert.equal(sent.status, 200);
  assert.equal(sent.data.message.content, 'Jasmine tea is aromatic. [1]');
  assert.equal(sent.data.sources[0].documentId, documentId);
  assert.equal(sent.data.recalledMemories[0].id, memory.data.memory.id);
  const history = await request(app, `/api/conversations/${conversationId}`);
  assert.equal(history.data.messages.length, 2);
  assert.deepEqual(history.data.messages[1].sources, sent.data.sources);
  const search = await request(app, '/api/knowledge/search', { method: 'POST', json: { query: 'jasmine' } });
  assert.equal(search.data.sources[0].documentId, documentId);
  const removed = await request(app, `/api/documents/${documentId}`, { method: 'DELETE', json: {} });
  assert.equal(removed.status, 200, removed.text);
  assert.equal(app.store.get('SELECT COUNT(*) AS n FROM chunks WHERE documentId=?', documentId).n, 0);
  assertHttpError(await request(app, `/api/documents/${documentId}`, { method: 'DELETE', json: {} }), 404);
  assert.equal(calls.length, 1);
});

test('HTTP model failure returns a controlled error and leaves conversation empty', async t => {
  const { app } = await localApp(t, [new TypeError('PRIVATE_PROVIDER_INFO')]);
  const personaId = app.api.bootstrap().personas[0].id;
  const { conversation } = app.api.createConversation({ personaId });
  const response = await request(app, `/api/conversations/${conversation.id}/messages`, { method: 'POST', json: { content: 'hello' } });
  assertHttpError(response, 502);
  assert.ok(!response.text.includes('PRIVATE_PROVIDER_INFO'));
  assert.equal(app.api.getConversation(conversation.id).messages.length, 0);
});

test('file SQLite persists application state across server restarts, never API key', async t => {
  const directory = await mkdtemp(join(fileURLToPath(new URL('.', import.meta.url)), '.tmp-persistence-'));
  const dbPath = join(directory, 'state.sqlite');
  const fakeKey = 'PERSISTENCE_TEST_ONLY_NOT_A_CREDENTIAL';
  const mock = scriptedModel('Saved reply [1]');
  let app;
  t.after(async () => {
    try { if (app) await app.close(); }
    finally { await rm(directory, { recursive: true, force: true }); }
  });
  const start = () => startServer({ port: 0, dbPath, scheduler: false,
    modelOptions: { fetchImpl: mock.fetchImpl, apiKey: '', timeoutMs: 1000 } });
  app = await start();
  app.api.updateSettings({ baseUrl: 'http://model.invalid/v1', model: 'test-model', memoryBudget: 42, apiKey: fakeKey });
  const persona = app.api.savePersona({ name: 'Persistent role', systemPrompt: 'Be helpful' }).persona;
  const conversation = app.api.createConversation({ personaId: persona.id, title: 'Persistent chat' }).conversation;
  const memory = app.api.saveMemory({ personaId: persona.id, content: 'jasmine preference', pinned: true }).memory;
  const document = (await app.api.importDocument({ name: 'persistent.txt', data: base64('Jasmine document') })).document;
  const task = app.api.saveTask({ name: 'Persistent reminder', type: 'reminder', prompt: 'rest', scheduleType: 'once', nextRunAt: '2030-01-01T00:00:00Z', enabled: false }).task;
  const run = await app.api.scheduler.run(task.id);
  await app.api.sendMessage(conversation.id, { content: 'jasmine' });
  const savedMessages = app.api.getConversation(conversation.id).messages;
  await app.close();
  app = undefined;
  assert.ok(!(await readFile(dbPath)).includes(Buffer.from(fakeKey)), 'key must not be stored in SQLite');
  app = await start();
  const response = await request(app, '/api/bootstrap');
  assert.equal(response.status, 200);
  const data = response.data;
  assert.equal(data.settings.memoryBudget, 42);
  assert.equal(data.settings.hasApiKey, false);
  assert.ok(!response.text.includes(fakeKey));
  assert.ok(data.personas.some(row => row.id === persona.id));
  assert.ok(data.conversations.some(row => row.id === conversation.id));
  assert.ok(data.documents.some(row => row.id === document.id));
  assert.equal(data.memories.find(row => row.id === memory.id).pinned, true);
  assert.equal(data.tasks.find(row => row.id === task.id).enabled, false);
  assert.equal(data.runs.find(row => row.id === run.id).status, 'success');
  assert.deepEqual(app.api.getConversation(conversation.id).messages, savedMessages);
  assert.equal(app.api.searchKnowledge({ query: 'jasmine' }).sources[0].documentId, document.id);
  assert.equal(app.store.get('SELECT * FROM settings WHERE key=?', 'apiKey'), null);
  assert.equal(mock.calls.length, 1);
});
