import test from 'node:test';
import assert from 'node:assert/strict';
import { createService } from '../lib/service.mjs';
import { parseJson, validateBaseUrl } from '../lib/model.mjs';
import { fixture, errorStatus, scriptedModel } from './helpers.mjs';

test('model sends configured OpenAI-compatible payload through mock only', async t => {
  const { api, calls } = fixture(t, ['  hello  ', '{"ok":true}']);
  const messages = [{ role: 'user', content: 'test input' }];
  assert.equal(await api.model.complete(messages, { maxTokens: 123 }), 'hello');
  assert.equal(calls[0].url, 'http://model.invalid/v1/chat/completions');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.redirect, 'error');
  assert.equal(calls[0].init.headers['Content-Type'], 'application/json');
  assert.ok(!Object.hasOwn(calls[0].init.headers, 'Authorization'));
  assert.ok(calls[0].init.signal instanceof AbortSignal);
  assert.deepEqual(calls[0].body, { model: 'test-model', messages, max_tokens: 123 });
  assert.deepEqual(await api.model.complete(messages, { json: true }), { ok: true });
});

test('unconfigured model fails before any network request', async t => {
  const { api, calls } = fixture(t);
  api.updateSettings({ model: '' });
  assert.equal(api.model.configured(), false);
  await assert.rejects(api.testModel(), errorStatus(503));
  await api.memory.automatic();
  assert.equal(calls.length, 0);
});

for (const status of [401, 403, 404, 429, 500]) {
  test(`provider HTTP ${status} is sanitized as 502`, async t => {
    const { api } = fixture(t, [new Response('SENSITIVE_PROVIDER_BODY', { status })]);
    await assert.rejects(api.testModel(), error => errorStatus(502)(error)
      && error.message.includes(String(status)) && !error.message.includes('SENSITIVE_PROVIDER_BODY'));
  });
}

for (const [name, error, status] of [
  ['network failure', new TypeError('secret-in-upstream-address'), 502],
  ['timeout', new DOMException('provider detail', 'TimeoutError'), 504],
  ['abort', new DOMException('provider detail', 'AbortError'), 504],
]) {
  test(`model maps ${name} without leaking provider details`, async t => {
    const { api } = fixture(t, [error], { timeoutMs: 1 });
    await assert.rejects(api.testModel(), result => errorStatus(status)(result) && !/secret|provider detail/.test(result.message));
  });
}

const invalidResponses = [
  ['malformed response JSON', () => new Response('{')],
  ['missing choices', () => new Response('{}')],
  ['null response object', () => new Response('null')],
  ['null choices', () => new Response('{"choices":null}')],
  ['empty choices', () => new Response('{"choices":[]}')],
  ['non-text content', () => new Response('{"choices":[{"message":{"content":42}}]}')],
  ['blank content', () => '  \n '],
  ['overlong text', () => 'x'.repeat(24001)],
  ['oversized response body', () => new Response('x'.repeat(2 * 1024 * 1024 + 1))],
  ['missing response body', () => new Response(null)],
];
for (const [name, output] of invalidResponses) {
  test(`model rejects ${name} with a controlled 502`, async t => {
    const { api } = fixture(t, [output()]);
    await assert.rejects(api.testModel(), errorStatus(502));
  });
}

test('model accepts the maximum text response size', async t => {
  const text = 'x'.repeat(24000);
  const { api } = fixture(t, [text]);
  assert.equal(await api.model.complete([{ role: 'user', content: 'test' }]), text);
});

test('parseJson accepts strict JSON and fenced JSON, not surrounding prose', () => {
  assert.deepEqual(parseJson(' {"memories":[]} '), { memories: [] });
  assert.deepEqual(parseJson('```json\n{"ok":true}\n```'), { ok: true });
  assert.deepEqual(parseJson('```\n[1,2]\n```'), [1, 2]);
  assert.throws(() => parseJson('Here is JSON: {"ok":true}'), errorStatus(502));
});

test('base URL normalizes trailing slashes and permits credential-free local HTTP', () => {
  assert.equal(validateBaseUrl('http://localhost:1234/v1///'), 'http://localhost:1234/v1');
  assert.equal(validateBaseUrl('https://example.invalid'), 'https://example.invalid');
  for (const url of ['not-url', 'file:///tmp/model', 'ftp://example.invalid', 'https://user:pass@example.invalid',
    'http://example.invalid?token=secret', 'http://example.invalid#fragment']) {
    assert.throws(() => validateBaseUrl(url), errorStatus(400), url);
  }
});

test('API key is ephemeral, redacted from settings/bootstrap/database and clearable', async t => {
  const { api, store, calls } = fixture(t, ['ok', 'ok', 'ok']);
  const fakeKey = 'TEST_ONLY_NOT_A_CREDENTIAL';
  const result = api.updateSettings({ apiKey: ` ${fakeKey} `, unknownSetting: 'ignore me' });
  assert.equal(result.settings.hasApiKey, true);
  assert.ok(!Object.hasOwn(result.settings, 'apiKey'));
  assert.ok(!JSON.stringify(api.bootstrap()).includes(fakeKey));
  assert.ok(!JSON.stringify(store.all('SELECT * FROM settings')).includes(fakeKey));
  assert.equal(store.get('SELECT * FROM settings WHERE key=?', 'apiKey'), null);
  assert.equal(store.get('SELECT * FROM settings WHERE key=?', 'unknownSetting'), null);
  await api.testModel();
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${fakeKey}`);
  api.updateSettings({ apiKey: '' });
  await api.testModel();
  assert.equal(calls[1].init.headers.Authorization, `Bearer ${fakeKey}`, 'blank input preserves existing key');
  const otherMock = scriptedModel('ok');
  const freshService = createService(store, { fetchImpl: otherMock.fetchImpl, apiKey: '', timeoutMs: 1000 });
  assert.equal(freshService.model.settings().hasApiKey, false, 'new service cannot restore an in-memory key');
  api.updateSettings({ clearApiKey: true, apiKey: 'ignored' });
  assert.equal(api.model.settings().hasApiKey, false);
  await api.testModel();
  assert.ok(!Object.hasOwn(calls[2].init.headers, 'Authorization'));
});

for (const [key, min, max] of [['memoryMessageThreshold', 2, 200], ['memoryIntervalHours', 1, 720], ['memoryBudget', 10, 5000]]) {
  test(`settings validates ${key} boundaries and rejects without partial updates`, t => {
    const { api, store } = fixture(t);
    assert.equal(api.updateSettings({ [key]: min }).settings[key], min);
    assert.equal(api.updateSettings({ [key]: max }).settings[key], max);
    const before = store.settings();
    for (const value of [min - 1, max + 1, min + 0.5, String(min), null, true, NaN, Infinity]) {
      assert.throws(() => api.updateSettings({ model: 'must-not-persist', [key]: value, apiKey: 'must-not-set' }), errorStatus(400), `${key}: ${String(value)}`);
      assert.deepEqual(store.settings(), before);
      assert.equal(api.model.settings().hasApiKey, false);
    }
  });
}

test('settings rejects invalid text and boolean fields atomically', t => {
  const { api, store } = fixture(t);
  const before = store.settings();
  for (const input of [{ model: 'x'.repeat(161) }, { model: null }, { baseUrl: '' }, { baseUrl: 'https://x.invalid?q=1' },
    { apiKey: 42 }, { apiKey: 'x'.repeat(2001) }, { clearApiKey: 'true' }, { clearApiKey: null }]) {
    assert.throws(() => api.updateSettings(input), errorStatus(400));
    assert.deepEqual(store.settings(), before);
  }
});

test('store transaction rolls back settings and database changes together', t => {
  const { store } = fixture(t);
  const before = store.settings();
  assert.throws(() => store.transaction(() => {
    store.run('INSERT INTO settings VALUES (?,?)', 'rollback-marker', 'true');
    store.run('INSERT INTO messages (conversationId,role,content,createdAt) VALUES (?,?,?,?)', 'missing-conversation', 'user', 'invalid', new Date().toISOString());
  }), /FOREIGN KEY/);
  assert.deepEqual(store.settings(), before);
});
