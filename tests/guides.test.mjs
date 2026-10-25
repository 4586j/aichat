import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createStore } from '../lib/store.mjs';
import { createGuides, guideQuery, GUIDE_REMOTE_URL, validateGuideBundle } from '../lib/guides.mjs';
import { generateGuides } from '../scripts/build-guides.mjs';
import { startServer } from '../server.mjs';
import { fixture, addConversation } from './helpers.mjs';

const original = JSON.parse(readFileSync(new URL('../docs/configuration/guide-bundle.json', import.meta.url), 'utf8'));
const newer = () => ({ ...structuredClone(original), revision: '2026-10-26.1' });
function local(t, options = {}) { const store = createStore(); t.after(() => store.close()); return { store, guides: createGuides(store, options) }; }

test('generated docs and llms.txt match the source Markdown; all default guides work offline', t => {
  assert.equal(generateGuides(true).documentCount, 6);
  let requests = 0; const { guides } = local(t, { guideFetchImpl: () => { requests++; throw new Error('no network'); } });
  const info = guides.bootstrap(); assert.equal(info.source, 'builtin'); assert.equal(info.documents.length, 6);
  for (const doc of info.documents) { const value = guides.get(doc.id); assert.match(value.content, /适用于栖忆 1.0.0/); assert.equal(value.url, `/guides/${doc.id}.md`); }
  assert.ok(guides.search('栖忆怎么配置音乐平台').some(row => row.guideId === 'music')); assert.equal(requests, 0);
});

test('configuration retrieval selects topic documents, caps context and leaves normal chat untouched', t => {
  const { guides } = local(t);
  for (const [query, topic] of [['SMTP 授权码在哪里填', 'email'], ['栖忆音乐服务地址怎么设置', 'music'], ['怎么配置模型 Base URL', 'model'], ['表情包上传失败怎么处理', 'stickers']]) {
    const rows = guides.search(query); assert.equal(rows[0].guideId, topic); assert.ok(rows.length <= 3);
    assert.ok(rows.reduce((sum, row) => sum + row.content.length, 0) <= 3300);
    assert.ok(rows.every(row => row.kind === 'configuration-guide' && row.content.length <= 1100 && !('searchText' in row)));
  }
  assert.deepEqual(guides.search('写一首描写晚风的诗'), []);
  assert.deepEqual(guides.search('今天适合听什么音乐'), []);
  assert.match(guideQuery('那授权码在哪里填', [{ role: 'user', content: '栖忆的邮件怎么配置' }]), /邮件/);
  assert.equal(guideQuery('今天吃什么', [{ role: 'user', content: '栖忆的邮件怎么配置' }]), '');
  assert.ok(guides.search('宠物怎么改名字').some(row => row.guideId === 'start' && row.content.includes('宠物')));
  assert.throws(() => guides.get('../../.env'), /不存在/);
});

test('GitHub update uses one fixed anonymous GET, persists a validated bundle and reuses ETag', async t => {
  let clock = Date.now(), count = 0; const calls = [];
  const { store, guides } = local(t, { guideClock: () => clock, guideFetchImpl: async (url, init) => {
    calls.push({ url, init }); count++;
    return count === 1 ? new Response(JSON.stringify(newer()), { headers: { etag: '"revision-one"' } }) : new Response(null, { status: 304 });
  } });
  await guides.sync(); assert.equal(calls.length, 1); assert.equal(calls[0].url, GUIDE_REMOTE_URL);
  assert.equal(calls[0].init.redirect, 'error'); assert.equal(calls[0].init.headers.Accept, 'application/vnd.github.raw+json');
  assert.equal(calls[0].init.headers.Authorization, undefined); assert.equal(calls[0].init.body, undefined);
  assert.equal(guides.bootstrap().source, 'github'); assert.equal(guides.bootstrap().revision, '2026-10-26.1');
  assert.ok(guides.search('音乐地址在哪里填').every(row => row.origin === 'github'));
  const restarted = createGuides(store); assert.equal(restarted.bootstrap().source, 'github');
  await assert.rejects(guides.sync(), error => error.status === 429); assert.equal(calls.length, 1);
  clock += 61_000; const same = await guides.sync(); assert.match(same.message, /没有变化/);
  assert.equal(calls[1].init.headers['If-None-Match'], '"revision-one"');
});

test('simultaneous sync requests share one download', async t => {
  let resolve, requests = 0; const gate = new Promise(r => { resolve = r; });
  const { guides } = local(t, { guideFetchImpl: async () => { requests++; await gate; return new Response(JSON.stringify(newer())); } });
  const a = guides.sync(), b = guides.sync(); resolve();
  await Promise.all([a, b]); assert.equal(requests, 1);
});

for (const [name, response] of [
  ['404', () => new Response('{}', { status: 404 })], ['rate limit', () => new Response('{}', { status: 403 })],
  ['unexpected 304', () => new Response(null, { status: 304 })], ['HTML', () => new Response('<html>login</html>')],
  ['too large', () => new Response('a'.repeat(512 * 1024 + 1))],
  ['schema mismatch', () => new Response(JSON.stringify({ ...newer(), schemaVersion: 2 }))],
  ['application mismatch', () => new Response(JSON.stringify({ ...newer(), appVersion: '999.0.0' }))],
  ['older revision', () => new Response(JSON.stringify({ ...newer(), revision: '2026-10-24.1' }))],
  ['network failure', () => { throw new Error('private-provider-configuration'); }],
]) test(`failed sync (${name}) preserves the existing guide without leaking upstream details`, async t => {
  const { guides, store } = local(t, { guideFetchImpl: async () => response() });
  const before = guides.get('email');
  await assert.rejects(guides.sync(), error => !error.message.includes('private-provider-configuration'));
  assert.deepEqual(guides.get('email'), before); assert.equal(guides.bootstrap().source, 'builtin');
  assert.equal(store.get('SELECT * FROM configuration_guides'), null);
});

test('a later failed update keeps the successful cache across restart', async t => {
  let clock = Date.now(), first = true;
  const { guides, store } = local(t, { guideClock: () => clock, guideFetchImpl: async () => { if (!first) throw new Error('offline'); first = false; return new Response(JSON.stringify(newer())); } });
  await guides.sync(); clock += 61_000; await assert.rejects(guides.sync());
  assert.equal(guides.bootstrap().source, 'github'); assert.equal(guides.bootstrap().revision, '2026-10-26.1');
  assert.equal(createGuides(store).bootstrap().source, 'github');
});

test('validation forbids unknown IDs, arbitrary paths, missing documents and huge or invalid content', t => {
  for (const mutate of [b => { b.documents[0].path = '../../.env'; }, b => { b.documents[0].id = 'https://evil.invalid'; }, b => { b.documents.pop(); }, b => { b.documents[0].content = 'a'.repeat(18001); }, b => { b.documents[0].content = 'secret\0'; }, b => { b.documents[0].keywords = Array(21).fill('keyword'); }, b => { b.documents[0] = null; }]) {
    const value = newer(); mutate(value); assert.throws(() => validateGuideBundle(value));
  }
  const { store } = local(t);
  store.run('INSERT INTO configuration_guides VALUES (1,?)', JSON.stringify({ bundle: { ...newer(), appVersion: '999' } }));
  assert.equal(createGuides(store).bootstrap().source, 'builtin');
  store.run('UPDATE configuration_guides SET value=?', '{broken-json'); assert.equal(createGuides(store).bootstrap().source, 'builtin');
});

test('configuration chat includes cited guide text and only boolean settings, with no network or config writes', async t => {
  let networks = 0;
  const { api, store, personaId, calls } = fixture(t, ['请在邮件设置中填写授权码。[1]', '继续说明。[1]'], { smtpPassword: '', guideFetchImpl: () => { networks++; throw new Error('offline'); } });
  api.updateSettings({ baseUrl: 'http://private-model.invalid/v1', apiKey: 'MODEL-PRIVATE' });
  api.media.update({ musicBaseUrl: 'http://private-music.invalid', musicApiKey: 'MUSIC-PRIVATE', stickerApiKey: 'STICKER-PRIVATE' });
  api.mail.update({ host: 'private-smtp.invalid', user: 'private-account@example.com', from: 'private-sender@example.com', password: 'SMTP-PRIVATE' });
  const before = JSON.stringify({ model: store.settings(), media: api.media.settings(), mail: api.mail.settings() });
  const cid = addConversation(api, personaId);
  const result = await api.sendMessage(cid, { content: '栖忆的 SMTP 授权码在哪里填写？' });
  assert.equal(result.sources[0].kind, 'configuration-guide'); assert.equal(result.sources[0].guideId, 'email');
  const prompt = JSON.stringify(calls[0].body.messages);
  for (const secret of ['MODEL-PRIVATE', 'MUSIC-PRIVATE', 'STICKER-PRIVATE', 'SMTP-PRIVATE', 'private-account@example.com', 'private-sender@example.com', 'private-smtp.invalid', 'private-model.invalid', 'private-music.invalid']) assert.ok(!prompt.includes(secret), secret);
  assert.match(prompt, /passwordPresent/); assert.match(prompt, /不要要求用户/); assert.match(prompt, /配置指南/);
  const data = api.getConversation(cid); assert.equal(data.messages[1].sources[0].revision, original.revision);
  await api.sendMessage(cid, { content: '那应该填在哪个框？' }); assert.ok(JSON.stringify(calls[1].body.messages).includes('邮件、SMTP'));
  assert.equal(networks, 0); assert.equal(api.mail.list().length, 0);
  assert.equal(JSON.stringify({ model: store.settings(), media: api.media.settings(), mail: api.mail.settings() }), before);
});

test('guide HTTP routes work without a model and serve plain Markdown and llms.txt', async t => {
  let requests = 0;
  const app = await startServer({ port: 0, dbPath: ':memory:', scheduler: false, modelOptions: { guideFetchImpl: async () => { requests++; return new Response(JSON.stringify(newer())); } } }); t.after(() => app.close());
  const bootstrap = await (await fetch(app.url + '/api/bootstrap')).json(); assert.equal(bootstrap.guides.documents.length, 6); assert.equal(requests, 0);
  const doc = await (await fetch(app.url + '/api/guides/model')).json(); assert.match(doc.document.content, /Base URL/);
  const raw = await fetch(app.url + '/guides/model.md'); assert.match(raw.headers.get('content-type'), /text\/plain/); assert.match(await raw.text(), /^# 模型/);
  const index = await fetch(app.url + '/llms.txt'); assert.match(await index.text(), /raw.githubusercontent.com\/4586j\/aichat/);
  assert.equal((await fetch(app.url + '/api/guides/missing')).status, 404);
  const synced = await fetch(app.url + '/api/guides/sync', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); assert.equal(synced.status, 200); assert.equal(requests, 1);
  assert.equal((await (await fetch(app.url + '/api/guides/music')).json()).document.source, 'github');
});
