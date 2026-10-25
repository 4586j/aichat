import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createStore } from '../lib/store.mjs';
import { createChatState, parseStateReply, STATE_TTL } from '../lib/chat-state.mjs';
import { startServer } from '../server.mjs';
import { fixture, addConversation, addPersona, addMessages, errorStatus, deferred, modelResponse, TIME } from './helpers.mjs';

const field = (value, quote = '今天好累', confidence = 'high', messageId = 'current') => ({ value, confidence, evidence: [{ messageId, quote }] });
const predicted = () => ({ energy: field('low'), need: field('listen', '先别给我建议'), roleMood: field('caring'), proactivity: field('low', '先别给我建议') });
const footer = value => `<qiyi-state>${JSON.stringify(value)}</qiyi-state>`;
const reply = (value = predicted()) => `我先陪你说说。\n${footer(value)}`;
const question = '今天好累，先别给我建议。';
const read = (f, conversationId) => f.api.getChatState({ personaId: f.personaId, conversationId }).chatState;
const update = (f, conversationId, patch) => f.api.updateChatState({ personaId: f.personaId, conversationId, patch: { expectedManualRevision: read(f, conversationId).manualRevision, ...patch } });
const reference = call => JSON.parse(call.body.messages[2].content.split('\n').slice(1).join('\n'));

test('one chat request returns clean prose and grounded state with real stored user ids', async t => {
  const f = fixture(t, [reply(), '第二轮']); const id = addConversation(f.api, f.personaId);
  const result = await f.api.sendMessage(id, { content: question });
  assert.equal(f.calls.length, 1); assert.equal(result.message.content, '我先陪你说说。');
  const data = result.chatState;
  assert.equal(data.fields.energy.value, 'low'); assert.equal(data.fields.need.value, 'listen');
  assert.equal(data.fields.roleMood.value, 'caring'); assert.equal(data.fields.proactivity.value, 'low');
  assert.deepEqual(data.fields.emotion.value, ['unknown']);
  assert.deepEqual(data.fields.energy.evidence, [{ messageId: result.userMessage.id, quote: '今天好累' }]);
  assert.equal(data.familiarity.score, 0); assert.equal(data.familiarity.stage, '初识');
  assert.ok(!JSON.stringify(f.api.getConversation(id)).includes('qiyi-state'));
  await f.api.sendMessage(id, { content: '继续' });
  assert.equal(reference(f.calls[1]).chatState.fields.energy.value, 'low');
  assert.ok(!f.calls[1].body.messages.slice(3).some(message => message.content.includes('qiyi-state')));
  assert.equal(f.calls.length, 2);
});

test('state evidence rejects invented, foreign, assistant and missing quotes independently', t => {
  const f = fixture(t, [], { stateClock: () => TIME }), id = addConversation(f.api, f.personaId), other = addConversation(f.api, f.personaId);
  const [uid, aid] = addMessages(f.store, id, ['今天好累', '你一定很伤心']); const [foreign] = addMessages(f.store, other, ['不能外传']);
  const messages = f.store.all('SELECT id,role,content,createdAt FROM messages WHERE conversationId=?', id);
  const values = { energy: field('low', '今天好累', 'high', uid), emotion: { ...field(['sad'], '你一定很伤心', 'high', aid), intensity: 5 },
    need: field('listen', '不能外传', 'high', foreign), roleMood: field('caring', '凭空编造', 'high', uid), proactivity: { value: 'low', confidence: 'high', evidence: [] } };
  const normalized = f.api.chatState.normalizePrediction(values, messages);
  assert.deepEqual(Object.keys(normalized), ['energy']);
  f.api.chatState.commit(id, values, messages, uid);
  f.store.run('DELETE FROM messages WHERE id=?', uid);
  assert.equal(read(f, id).fields.energy.origin, 'default');
});

test('invalid enums, emotion shape, confidence, intensity and oversized evidence are ignored', t => {
  const f = fixture(t), messages = [{ id: 'current', role: 'user', content: question }];
  for (const emotion of [[], ['sad', 'sad'], ['unknown', 'sad'], ['sad', 'happy', 'worried'], ['diagnosis'], 'sad']) {
    assert.deepEqual(f.api.chatState.normalizePrediction({ emotion: { ...field(emotion), intensity: 3 } }, messages), {});
  }
  for (const intensity of [0, 6, 2.5, '3', null]) assert.deepEqual(f.api.chatState.normalizePrediction({ emotion: { ...field(['sad']), intensity } }, messages), {});
  for (const value of [field('impossible'), field('low', '今天好累', 'certain'), { ...field('low'), evidence: Array(3).fill(field('low').evidence[0]) }]) {
    assert.deepEqual(f.api.chatState.normalizePrediction({ energy: value }, messages), {});
  }
  const low = f.api.chatState.normalizePrediction({ energy: field('low', '今天好累', 'low'), familiarity: { score: 100 } }, messages);
  assert.equal(low.energy.value, 'unknown'); assert.equal(low.energy.confidence, 'low'); assert.equal(low.energy.evidence.length, 1); assert.ok(!('familiarity' in low));
});

test('emotion allows two supported labels with explicit intensity and genuine evidence', async t => {
  const f = fixture(t, [reply({ emotion: { ...field(['happy', 'worried'], '又高兴又担心'), intensity: 2 } })]);
  const id = addConversation(f.api, f.personaId); await f.api.sendMessage(id, { content: '又高兴又担心。' });
  assert.deepEqual(read(f, id).fields.emotion.value, ['happy', 'worried']); assert.equal(read(f, id).fields.emotion.intensity, 2);
});

test('footer parser handles malformed and oversized optional metadata without losing the answer', () => {
  for (const raw of ['{bad}', '[]', 'null', JSON.stringify({ x: 'a'.repeat(8100) })]) assert.deepEqual(parseStateReply(`正文\n<qiyi-state>${raw}</qiyi-state>`), { content: '正文', prediction: null });
  const value = predicted(); assert.deepEqual(parseStateReply(`正文\n${footer(value)}`), { content: '正文', prediction: value });
});

test('footer examples in code, comments, inline literals or quoted text remain literal', () => {
  for (const raw of [`\x60\x60\x60json\n${footer(predicted())}`, `<!-- example\n${footer(predicted())}`, `\x60example\n${footer(predicted())}`, `> ${footer(predicted())}`, `  ${footer(predicted())}`, `${footer(predicted())}\n后面还有正文`]) {
    assert.deepEqual(parseStateReply(raw), { content: raw, prediction: null });
  }
  const prose = '示例：\n```text\n`\n```\n正文';
  assert.equal(parseStateReply(`${prose}\n${footer(predicted())}`).content, prose);
});

for (const order of ['state last', 'media last']) test(`state and sticker footers coexist: ${order}`, async t => {
  const state = footer(predicted()), media = '<qiyi-media>{"stickerId":"leaf-hug"}</qiyi-media>';
  const f = fixture(t, [`抱抱。\n${order === 'state last' ? `${media}\n${state}` : `${state}\n${media}`}`]);
  const id = addConversation(f.api, f.personaId); const result = await f.api.sendMessage(id, { content: question });
  assert.equal(result.message.content, '抱抱。'); assert.equal(result.message.attachments[0].id, 'leaf-hug'); assert.equal(result.chatState.fields.energy.value, 'low');
});

test('empty state-only or failed model responses write neither messages nor state', async t => {
  const f = fixture(t, [footer(predicted()), new TypeError('offline')]); const id = addConversation(f.api, f.personaId);
  for (let i = 0; i < 2; i++) { await assert.rejects(f.api.sendMessage(id, { content: question }), errorStatus(502)); assert.equal(f.api.getConversation(id).messages.length, 0); assert.equal(read(f, id).revision, 0); }
});

test('automatic and manual short-term fields expire after 30 minutes in UI and model context', async t => {
  let time = TIME; const f = fixture(t, [reply(), '下一轮'], { stateClock: () => time }); const id = addConversation(f.api, f.personaId);
  await f.api.sendMessage(id, { content: question }); update(f, id, { fields: { emotion: { value: ['happy'], intensity: 2, note: '仅当前心情' } } });
  time += STATE_TTL - 1; assert.equal(read(f, id).fields.energy.value, 'low'); assert.deepEqual(read(f, id).fields.emotion.value, ['happy']);
  time++; assert.equal(read(f, id).fields.energy.origin, 'default'); assert.deepEqual(read(f, id).fields.emotion.value, ['unknown']);
  await f.api.sendMessage(id, { content: '请回答' }); assert.equal(reference(f.calls[1]).chatState.fields.energy.value, 'unknown'); assert.deepEqual(reference(f.calls[1]).chatState.fields.emotion.value, ['unknown']);
});

test('manual overrides win; notes and evidence never enter model state context', async t => {
  const f = fixture(t, [reply()]); const id = addConversation(f.api, f.personaId);
  update(f, id, { fields: { energy: { value: 'high', note: 'LOCAL_PRIVATE_NOTE' }, proactivity: { value: 'high' } } });
  const result = await f.api.sendMessage(id, { content: question });
  assert.equal(result.chatState.fields.energy.origin, 'manual'); assert.equal(result.chatState.fields.energy.value, 'high');
  assert.equal(result.chatState.fields.need.value, 'listen'); assert.equal(result.chatState.fields.proactivity.value, 'high');
  assert.ok(!JSON.stringify(f.calls).includes('LOCAL_PRIVATE_NOTE')); assert.equal(reference(f.calls[0]).chatState.fields.energy.value, 'high');
  update(f, id, { reset: ['energy'] }); assert.equal(read(f, id).fields.energy.origin, 'default');
});

test('a user edit while a model request is pending survives the reply commit', async t => {
  const gate = deferred(); const f = fixture(t, [() => gate.promise]); const id = addConversation(f.api, f.personaId);
  const pending = f.api.sendMessage(id, { content: question });
  update(f, id, { fields: { energy: { value: 'high' } } }); gate.resolve(modelResponse(reply())); await pending;
  assert.equal(read(f, id).fields.energy.value, 'high'); assert.equal(read(f, id).fields.energy.origin, 'manual'); assert.equal(read(f, id).fields.need.value, 'listen');
});

test('switching off during a request blocks its pending state update', async t => {
  const gate = deferred(); const f = fixture(t, [() => gate.promise]); const id = addConversation(f.api, f.personaId);
  const pending = f.api.sendMessage(id, { content: question }); update(f, id, { mode: 'off' }); gate.resolve(modelResponse(reply())); await pending;
  assert.equal(read(f, id).mode, 'off'); assert.equal(read(f, id).fields.energy.origin, 'default'); assert.equal(f.api.getConversation(id).messages.length, 2);
});

for (const mode of ['manual', 'off']) test(`${mode} mode skips state analysis and rejects optional model predictions`, async t => {
  const f = fixture(t, [reply()]); const id = addConversation(f.api, f.personaId);
  update(f, id, { mode, fields: { energy: { value: 'high' } } }); await f.api.sendMessage(id, { content: question });
  assert.equal(read(f, id).fields.energy.value, mode === 'manual' ? 'high' : 'unknown'); assert.equal(read(f, id).fields.need.origin, 'default');
  assert.ok(!f.calls[0].body.messages[0].content.includes('<qiyi-state>'));
  if (mode === 'off') assert.ok(!reference(f.calls[0]).chatState); else assert.equal(reference(f.calls[0]).chatState.mode, 'manual');
});

test('manual edits conflict with manual edits, while automatic updates do not invalidate open forms', async t => {
  const f = fixture(t, [reply()]); const id = addConversation(f.api, f.personaId), old = read(f, id);
  await f.api.sendMessage(id, { content: question }); assert.equal(read(f, id).manualRevision, old.manualRevision);
  update(f, id, { expectedManualRevision: old.manualRevision, fields: { energy: { value: 'high' } } });
  assert.throws(() => update(f, id, { expectedManualRevision: old.manualRevision, clear: true }), errorStatus(409));
  assert.equal(read(f, id).fields.energy.value, 'high');
});

test('conversation state and familiarity remain isolated by conversation and persona', async t => {
  const f = fixture(t, [reply()]); const id = addConversation(f.api, f.personaId), second = addConversation(f.api, f.personaId), other = addPersona(f.api);
  await f.api.sendMessage(id, { content: question });
  update(f, id, { familiarity: { mode: 'manual', score: 70, note: '已了解彼此的资料', expectedRevision: 0 } });
  assert.equal(read(f, second).fields.energy.value, 'unknown'); assert.equal(read(f, second).familiarity.stage, '熟悉');
  assert.equal(f.api.getChatState({ personaId: other }).chatState.familiarity.score, 0);
  assert.throws(() => f.api.getChatState({ personaId: other, conversationId: id }), errorStatus(409));
  assert.throws(() => f.api.updateChatState({ personaId: other, conversationId: id, patch: { expectedManualRevision: 0, clear: true } }), errorStatus(409));
});

test('familiarity counts only confirmed, confident, active and distinct non-summary memories', t => {
  const f = fixture(t); const save = (content, more = {}) => f.api.saveMemory({ personaId: f.personaId, content, ...more }).memory;
  save('喜欢茉莉花茶', { category: 'preference' }); save('喜欢茉莉花茶', { category: 'fact' });
  const extracted = save('喜欢骑车', { category: 'preference' });
  f.store.run("UPDATE memories SET source='model',confirmedAt=NULL,mentions=3 WHERE id=?", extracted.id);
  const summary = save('一段摘要', { category: 'summary' }); const archived = save('已归档的目标', { status: 'archived' }); save('置信度不足', { confidence: .6 });
  let value = f.api.chatState.familiarity(f.personaId); assert.equal(value.score, 11); assert.equal(value.basis.confirmedCount, 1); assert.equal(value.basis.excludedCount, 4);
  f.api.saveMemory({ pinned: true }, extracted.id); assert.equal(f.api.chatState.familiarity(f.personaId).score, 11);
  f.api.saveMemory({ content: '喜欢骑车' }, extracted.id); value = f.api.chatState.familiarity(f.personaId);
  assert.equal(value.score, 21); assert.equal(value.basis.reinforcedCount, 1); assert.equal(value.basis.confirmedCount, 2);
  f.api.saveMemory({ status: 'archived' }, extracted.id); assert.equal(f.api.chatState.familiarity(f.personaId).score, 11);
  f.api.deleteMemory(summary.id); f.api.deleteMemory(archived.id); assert.equal(f.api.chatState.familiarity(f.personaId).score, 11);
});

test('familiarity stages and cap derive from data rather than elapsed time or message count', t => {
  let time = TIME; const f = fixture(t, [], { stateClock: () => time });
  for (let i = 1; i <= 15; i++) {
    f.api.saveMemory({ personaId: f.personaId, content: `资料 ${i}` });
    const value = f.api.chatState.familiarity(f.personaId); assert.equal(value.score, Math.min(100, i * 8 + 3));
    assert.equal(value.stage, i < 3 ? '初识' : i < 8 ? '逐渐熟悉' : '熟悉');
  }
  time += 365 * 86400000; assert.equal(f.api.chatState.familiarity(f.personaId).score, 100);
});

test('manual familiarity requires a reason, supports reset and uses an independent revision', t => {
  const f = fixture(t); update(f, null, { familiarity: { mode: 'manual', score: 70, note: '根据自己的了解调整', expectedRevision: 0 } });
  assert.equal(f.store.get('SELECT COUNT(*) AS n FROM conversations').n, 0);
  assert.equal(read(f).familiarity.origin, 'manual'); assert.equal(read(f).familiarity.stage, '熟悉');
  assert.throws(() => update(f, null, { familiarity: { mode: 'manual', score: 20, note: '另一处改动', expectedRevision: 0 } }), errorStatus(409));
  update(f, null, { familiarity: { mode: 'computed', expectedRevision: 1 } }); assert.equal(read(f).familiarity.score, 0); assert.equal(read(f).familiarity.revision, 2);
  for (const value of [{ score: -1, note: '依据' }, { score: 101, note: '依据' }, { score: 3.5, note: '依据' }, { score: 70, note: '' }]) {
    assert.throws(() => update(f, null, { familiarity: { mode: 'manual', expectedRevision: 2, ...value } }), errorStatus(400));
  }
});

test('invalid manual changes are atomic and do not create conversations', t => {
  const f = fixture(t);
  for (const patch of [{ fields: { energy: { value: 'invented' } } }, { fields: { energy: { value: 'high' } }, reset: ['energy'] }, { mode: 'wrong' }, { fields: { mood: { value: 'happy' } } }, { fields: { emotion: { value: ['happy'], intensity: 6 } } }, { fields: { need: { value: 'listen', note: 'x'.repeat(201) } } }]) {
    assert.throws(() => update(f, null, patch), errorStatus(400)); assert.equal(f.store.get('SELECT COUNT(*) AS n FROM conversations').n, 0);
  }
  const result = update(f, null, { fields: { need: { value: 'listen' } } }); assert.ok(result.conversation.id); assert.equal(result.chatState.fields.need.origin, 'manual');
});

test('clearing temporary state leaves messages, memories and persona familiarity intact', async t => {
  const f = fixture(t, [reply()]); const id = addConversation(f.api, f.personaId); f.api.saveMemory({ personaId: f.personaId, content: '喜欢茶' });
  await f.api.sendMessage(id, { content: question }); const before = f.api.getConversation(id);
  update(f, id, { clear: true }); assert.equal(read(f, id).fields.energy.value, 'unknown'); assert.equal(read(f, id).familiarity.score, 11);
  assert.deepEqual(f.api.getConversation(id), before);
});

test('state schema survives a restart; expiry still applies after reopening the database', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'qiyi-state-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const filename = join(dir, 'state.sqlite'); let store = createStore(filename), time = TIME;
  const personaId = store.get('SELECT id FROM personas LIMIT 1').id;
  store.run("INSERT INTO conversations(id,personaId,title,summarizedAt,createdAt,updatedAt) VALUES ('state-test',?,'test',?,?,?)", personaId, new Date(time).toISOString(), new Date(time).toISOString(), new Date(time).toISOString());
  createChatState(store, { stateClock: () => time }).update(personaId, 'state-test', { expectedManualRevision: 0, fields: { energy: { value: 'low' } } }); store.close();
  store = createStore(filename); try { const manager = createChatState(store, { stateClock: () => time }); assert.equal(manager.view(personaId, 'state-test').fields.energy.value, 'low'); time += STATE_TTL; assert.equal(manager.view(personaId, 'state-test').fields.energy.value, 'unknown'); } finally { store.close(); }
});

test('HTTP exposes local state routes and assets with existing origin and owner validation', async t => {
  const app = await startServer({ port: 0, dbPath: ':memory:', scheduler: false }); t.after(() => app.close());
  const personaId = app.api.bootstrap().personas[0].id;
  for (const path of ['/chat-state.js', '/chat-state.css']) assert.equal((await fetch(app.url + path)).status, 200);
  const url = `${app.url}/api/chat-state?personaId=${personaId}`;
  assert.equal((await fetch(url)).status, 200);
  const body = JSON.stringify({ personaId, patch: { expectedManualRevision: 0, fields: { energy: { value: 'low' } } } });
  assert.equal((await fetch(app.url + '/api/chat-state', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://foreign.invalid' }, body })).status, 403);
  const saved = await fetch(app.url + '/api/chat-state', { method: 'POST', headers: { 'content-type': 'application/json' }, body }); assert.equal(saved.status, 200); assert.equal((await saved.json()).chatState.fields.energy.value, 'low');
});

test('old user quotes cannot renew expired states or extend their original time window', async t => {
  let time = TIME;
  const f = fixture(t, [call => modelResponse(reply({ energy: field('low', '今天好累', 'high', Number(call.body.messages.at(-3).content.match(/id=(\d+)/)[1])) }))], { stateClock: () => time });
  const id = addConversation(f.api, f.personaId);
  const [uid] = addMessages(f.store, id, ['今天好累', '我听着'], time);
  const messages = f.store.all('SELECT id,role,content,createdAt FROM messages WHERE conversationId=?', id);
  time += STATE_TTL - 60_000;
  let prediction = f.api.chatState.normalizePrediction({ energy: field('low', '今天好累', 'high', uid) }, messages);
  assert.equal(Date.parse(prediction.energy.expiresAt), TIME + STATE_TTL);
  time += 60_000;
  assert.deepEqual(f.api.chatState.normalizePrediction({ energy: field('low', '今天好累', 'high', uid) }, messages), {});
  assert.deepEqual(f.api.chatState.evidenceMessages(messages), []);
  f.store.run('UPDATE messages SET content=? WHERE id=?', `今天好累 id=${uid}`, uid);
  await f.api.sendMessage(id, { content: '现在开始新的话题' });
  assert.deepEqual(reference(f.calls[0]).stateEvidenceMessages, []);
  assert.equal(read(f, id).fields.energy.value, 'unknown');
});
