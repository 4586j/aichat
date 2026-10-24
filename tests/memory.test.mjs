import test from 'node:test';
import assert from 'node:assert/strict';
import { memoryScore, scored, HALF_LIVES } from '../lib/memory.mjs';
import { fixture, TIME, DAY, iso, errorStatus, addPersona, addConversation, addMessages, deferred, modelResponse } from './helpers.mjs';

const extracted = (content, extra = {}) => ({ content, category: 'preference', importance: 0.7, confidence: 0.9, ...extra });
const scoreInput = extra => ({ category: 'fact', importance: 0.7, confidence: 0.8, mentions: 1,
  accessCount: 0, pinned: false, reinforcedAt: iso(TIME), lastAccessedAt: null, ...extra });

test('memoryScore has exact initial weighting and half-life decay for every category', () => {
  for (const [category, days] of Object.entries(HALF_LIVES)) {
    const row = scoreInput({ category });
    const initial = 0.65 * row.importance + 0.35 * row.confidence;
    const halfLife = days * (0.5 + row.importance) * (1 + Math.log1p(1) / 2);
    assert.equal(memoryScore(row, TIME), initial);
    assert.ok(Math.abs(memoryScore(row, TIME + halfLife * DAY) - initial / 2) < 1e-10);
    assert.ok(memoryScore(row, TIME + DAY) < initial);
    assert.equal(memoryScore(row, TIME - DAY), initial, 'future timestamps must not amplify scores');
    assert.equal(scored(row, TIME).score, Number(initial.toFixed(4)));
  }
});

test('strong, repeated, recently accessed and pinned memories resist decay', () => {
  const weak = scoreInput({ importance: 0.1, confidence: 0.2 });
  const strong = scoreInput({ importance: 0.9, confidence: 1 });
  assert.ok(memoryScore(strong, TIME + 180 * DAY) > memoryScore(weak, TIME + 180 * DAY));
  assert.ok(memoryScore(scoreInput({ mentions: 20, accessCount: 10 }), TIME + 90 * DAY) > memoryScore(scoreInput(), TIME + 90 * DAY));
  assert.equal(memoryScore(scoreInput({ lastAccessedAt: iso(TIME + 100 * DAY) }), TIME + 100 * DAY), memoryScore(scoreInput(), TIME));
  assert.equal(memoryScore(scoreInput({ pinned: true, importance: 0, confidence: 0 }), TIME + 10000 * DAY), 1);
  assert.equal(memoryScore(scoreInput({ mentions: 1000 }), TIME + DAY), memoryScore(scoreInput({ mentions: 1000000 }), TIME + DAY), 'reinforcement is capped');
});

test('maintenance archives old weak data but protects pinned, fresh and recently accessed memories', t => {
  const { api, store, personaId } = fixture(t);
  const create = (content, extra = {}) => api.saveMemory({ personaId, content, importance: 0.05, confidence: 0.05, ...extra }).memory;
  const weak = create('old weak');
  const strong = create('strong constraint', { category: 'constraint', importance: 1, confidence: 1 });
  const pinned = create('pinned', { pinned: true });
  const fresh = create('fresh');
  const accessed = create('recently accessed');
  const boundary = create('exactly seven days old');
  const archived = create('already archived', { status: 'archived' });
  for (const row of [weak, strong, pinned, fresh, accessed, boundary, archived]) {
    store.run('UPDATE memories SET createdAt=?,reinforcedAt=?,lastAccessedAt=NULL WHERE id=?', iso(TIME - 200 * DAY), iso(TIME - 200 * DAY), row.id);
  }
  store.run('UPDATE memories SET reinforcedAt=? WHERE id=?', iso(TIME - 7 * DAY + 1), fresh.id);
  store.run('UPDATE memories SET lastAccessedAt=? WHERE id=?', iso(TIME - DAY), accessed.id);
  store.run('UPDATE memories SET reinforcedAt=? WHERE id=?', iso(TIME - 7 * DAY), boundary.id);
  assert.deepEqual(api.memory.maintain(TIME), { archived: 2 });
  for (const row of [weak, boundary, archived]) assert.equal(store.get('SELECT status FROM memories WHERE id=?', row.id).status, 'archived');
  for (const row of [strong, pinned, fresh, accessed]) assert.equal(store.get('SELECT status FROM memories WHERE id=?', row.id).status, 'active');
  assert.equal(store.settings().lastMemoryMaintenanceAt, iso(TIME));
  assert.deepEqual(api.memory.maintain(TIME), { archived: 0 });
});

test('maintenance enforces per-role budget weakest-first without removing protected entries', t => {
  const { api, store, personaId } = fixture(t);
  api.updateSettings({ memoryBudget: 10 });
  const other = addPersona(api);
  const rows = Array.from({ length: 12 }, (_, i) => api.saveMemory({ personaId, content: `eligible ${i}`, importance: 0.4 + i * 0.04, confidence: 1 }).memory);
  for (const row of rows) store.run('UPDATE memories SET reinforcedAt=? WHERE id=?', iso(TIME - 8 * DAY), row.id);
  const otherMemory = api.saveMemory({ personaId: other, content: 'independent budget' }).memory;
  store.run('UPDATE memories SET reinforcedAt=? WHERE id=?', iso(TIME - 8 * DAY), otherMemory.id);
  assert.deepEqual(api.memory.maintain(TIME), { archived: 2 });
  assert.deepEqual(store.all("SELECT id FROM memories WHERE personaId=? AND status='archived'", personaId).map(row => row.id).sort(), rows.slice(0, 2).map(row => row.id).sort());
  assert.equal(api.memory.list(other)[0].status, 'active');
  for (let i = 0; i < 12; i++) api.saveMemory({ personaId: other, content: `protected ${i}`, pinned: true });
  api.memory.maintain(TIME);
  assert.equal(api.memory.list(other).filter(row => row.status === 'active').length, 12, 'protected entries may exceed the budget');
});

test('manual memories and recall remain role-isolated, exclude archived rows and do not touch on retrieval', t => {
  const { api, store, personaId } = fixture(t);
  const other = addPersona(api);
  const own = api.saveMemory({ personaId, content: '喜欢 jasmine tea' }).memory;
  const foreign = api.saveMemory({ personaId: other, content: own.content, pinned: true }).memory;
  const pinned = api.saveMemory({ personaId, content: '无关但固定', pinned: true }).memory;
  api.saveMemory({ personaId, content: own.content, status: 'archived', pinned: true });
  const recalled = api.memory.recall(personaId, 'jasmine tea');
  assert.deepEqual(new Set(recalled.map(row => row.id)), new Set([own.id, pinned.id]));
  assert.ok(!recalled.some(row => row.id === foreign.id));
  assert.equal(store.get('SELECT accessCount FROM memories WHERE id=?', own.id).accessCount, 0);
  assert.equal(store.get('SELECT lastAccessedAt FROM memories WHERE id=?', own.id).lastAccessedAt, null);
  assert.equal(own.source, 'manual');
  assert.throws(() => api.saveMemory({ personaId: other }, own.id), errorStatus(400));
  assert.equal(api.saveMemory({ content: '更新后的 jasmine tea', pinned: true }, own.id).memory.personaId, personaId);
  assert.deepEqual(api.deleteMemory(own.id), { ok: true });
  assert.throws(() => api.deleteMemory(own.id), errorStatus(404));
});

test('recall is capped at six and touch updates only selected rows', t => {
  const { api, store, personaId } = fixture(t);
  for (let i = 0; i < 9; i++) api.saveMemory({ personaId, content: `coffee preference ${i}` });
  const rows = api.memory.recall(personaId, 'coffee');
  assert.equal(rows.length, 6);
  api.memory.touch(rows);
  assert.equal(store.get('SELECT COUNT(*) AS n FROM memories WHERE accessCount=1 AND lastAccessedAt IS NOT NULL').n, 6);
  assert.equal(store.get('SELECT COUNT(*) AS n FROM memories WHERE accessCount=0 AND lastAccessedAt IS NULL').n, 3);
});

test('successful summary advances exactly to processed messages and merges only exact content within a role', async t => {
  const content = '用户喜欢茉莉花茶';
  const { api, store, personaId, calls } = fixture(t, [{ memories: [extracted(`  ${content}  `), extracted(`${content}。`)] }]);
  const other = addPersona(api);
  const existing = api.saveMemory({ personaId, content, importance: 0.9, confidence: 0.3, pinned: true, status: 'archived' }).memory;
  const foreign = api.saveMemory({ personaId: other, content }).memory;
  store.run('UPDATE memories SET reinforcedAt=? WHERE id=?', iso(TIME - DAY), existing.id);
  const conversationId = addConversation(api, personaId);
  const ids = addMessages(store, conversationId, ['我喜欢茉莉花茶', '好的']);
  assert.deepEqual(await api.summarize({ personaId }), { created: 1, processed: 2 });
  const merged = store.get('SELECT * FROM memories WHERE id=?', existing.id);
  assert.equal(merged.mentions, 2);
  assert.equal(merged.importance, 0.9);
  assert.equal(merged.confidence, 0.9);
  assert.equal(merged.status, 'active');
  assert.equal(merged.pinned, true);
  assert.notEqual(merged.reinforcedAt, iso(TIME - DAY));
  assert.equal(store.get('SELECT mentions FROM memories WHERE id=?', foreign.id).mentions, 1);
  const created = store.get('SELECT * FROM memories WHERE personaId=? AND content=?', personaId, `${content}。`);
  assert.equal(created.source, `conversation:${conversationId};messages:${ids[0]}-${ids[1]}`);
  assert.equal(api.getConversation(conversationId).conversation.summaryCursor, ids[1]);
  assert.deepEqual(JSON.parse(calls[0].body.messages[1].content), [{ role: 'user', content: '我喜欢茉莉花茶' }, { role: 'assistant', content: '好的' }]);
  assert.deepEqual(await api.summarize({ personaId }), { created: 0, processed: 0 });
  assert.equal(calls.length, 1);
});

const invalidSummaries = [
  ['unparseable JSON', 'not json'], ['null', 'null'], ['missing memories', {}], ['wrong memories type', { memories: {} }],
  ['too many entries', { memories: Array.from({ length: 21 }, () => extracted('tea')) }],
  ['null entry', { memories: [null] }], ['blank content', { memories: [extracted(' ')] }],
  ['overlong content', { memories: [extracted('x'.repeat(1001))] }],
  ['invalid category', { memories: [extracted('tea', { category: 'diagnosis' })] }],
  ['string importance', { memories: [extracted('tea', { importance: '0.7' })] }],
  ['importance out of range', { memories: [extracted('tea', { importance: 1.1 })] }],
  ['confidence out of range', { memories: [extracted('tea', { confidence: -0.1 })] }],
  ['partial valid output', { memories: [extracted('must not insert'), extracted('invalid', { category: 'unknown' })] }],
];
for (const [name, output] of invalidSummaries) {
  test(`summary rejects ${name} atomically and permits retry`, async t => {
    const { api, store, personaId } = fixture(t, [output, { memories: [extracted('retry succeeds')] }]);
    const conversationId = addConversation(api, personaId);
    addMessages(store, conversationId, ['用户明确偏好', '回复']);
    const before = api.getConversation(conversationId).conversation;
    await assert.rejects(api.memory.summarizeConversation(conversationId), errorStatus(502));
    assert.deepEqual(api.getConversation(conversationId).conversation, before);
    assert.equal(api.memory.list().length, 0);
    assert.deepEqual(await api.memory.summarizeConversation(conversationId), { created: 1, processed: 2 });
  });
}

test('empty conversation makes no request; valid empty extraction still advances its cursor', async t => {
  const { api, store, personaId, calls } = fixture(t, [{ memories: [] }]);
  const conversationId = addConversation(api, personaId);
  assert.deepEqual(await api.memory.summarizeConversation(conversationId), { created: 0, processed: 0 });
  assert.equal(calls.length, 0);
  const ids = addMessages(store, conversationId, ['hello', 'hi']);
  assert.deepEqual(await api.memory.summarizeConversation(conversationId), { created: 0, processed: 2 });
  assert.equal(api.getConversation(conversationId).conversation.summaryCursor, ids.at(-1));
  assert.equal(api.memory.list().length, 0);
  await assert.rejects(api.memory.summarizeConversation('missing'), errorStatus(404));
});

test('summary batches stop at 60 messages and resume without replay', async t => {
  const { api, store, personaId, calls } = fixture(t, [{ memories: [] }, { memories: [] }]);
  const conversationId = addConversation(api, personaId);
  const ids = addMessages(store, conversationId, Array.from({ length: 62 }, (_, i) => `message ${i}`));
  assert.deepEqual(await api.memory.summarizeConversation(conversationId), { created: 0, processed: 60 });
  assert.equal(api.getConversation(conversationId).conversation.summaryCursor, ids[59]);
  assert.deepEqual(await api.memory.summarizeConversation(conversationId), { created: 0, processed: 2 });
  assert.equal(JSON.parse(calls[1].body.messages[1].content)[0].content, 'message 60');
  assert.equal(api.getConversation(conversationId).conversation.summaryCursor, ids[61]);
});

test('summary obeys 24000-character batch budget', async t => {
  const { api, store, personaId, calls } = fixture(t, [{ memories: [] }]);
  const conversationId = addConversation(api, personaId);
  const ids = addMessages(store, conversationId, Array.from({ length: 4 }, () => 'x'.repeat(8000)));
  assert.deepEqual(await api.memory.summarizeConversation(conversationId), { created: 0, processed: 3 });
  assert.equal(api.getConversation(conversationId).conversation.summaryCursor, ids[2]);
  assert.equal(JSON.parse(calls[0].body.messages[1].content).reduce((n, row) => n + row.content.length, 0), 24000);
});

test('concurrent summaries cannot duplicate extraction or advance twice', async t => {
  const gate = deferred();
  const { api, store, personaId, calls } = fixture(t, [() => gate.promise]);
  const conversationId = addConversation(api, personaId);
  addMessages(store, conversationId, ['tea', 'noted']);
  const first = api.memory.summarizeConversation(conversationId);
  try {
    assert.deepEqual(await api.memory.summarizeConversation(conversationId), { created: 0, processed: 0 });
    assert.equal(calls.length, 1);
  } finally { gate.resolve(modelResponse(JSON.stringify({ memories: [extracted('tea')] }))); }
  assert.deepEqual(await first, { created: 1, processed: 2 });
});

for (const trigger of ['message threshold', 'elapsed interval']) {
  test(`automatic summary triggers on ${trigger} and respects retry cooldown`, async t => {
    t.mock.timers.enable({ apis: ['Date'], now: TIME });
    const { api, store, personaId, calls } = fixture(t, [{ memories: [] }]);
    api.updateSettings({ memoryMessageThreshold: 4, memoryIntervalHours: 2 });
    const conversationId = addConversation(api, personaId);
    addMessages(store, conversationId, ['one', 'two']);
    if (trigger === 'message threshold') addMessages(store, conversationId, ['three', 'four']);
    else store.run('UPDATE conversations SET summarizedAt=? WHERE id=?', iso(TIME - 2 * 3600000), conversationId);
    await api.memory.automatic();
    assert.equal(calls.length, 1);
    assert.equal(store.settings().lastMemoryError, '');
    assert.equal(store.settings().lastMemorySummaryAt, iso(TIME));
    addMessages(store, conversationId, ['a', 'b', 'c', 'd']);
    await api.memory.automatic();
    assert.equal(calls.length, 1);
  });
}

test('failed automatic summary records error but preserves cursor and memories', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: TIME });
  const { api, store, personaId } = fixture(t, ['invalid json']);
  api.updateSettings({ memoryMessageThreshold: 2 });
  const conversationId = addConversation(api, personaId);
  addMessages(store, conversationId, ['one', 'two']);
  await api.memory.automatic();
  assert.match(store.settings().lastMemoryError, /解析/);
  assert.equal(api.getConversation(conversationId).conversation.summaryCursor, 0);
  assert.equal(api.memory.list().length, 0);
});
