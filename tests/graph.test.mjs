import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore } from '../lib/store.mjs';
import { createService } from '../lib/service.mjs';
import { startServer } from '../server.mjs';
import {
  fixture, scriptedModel, modelResponse, deferred, errorStatus,
  addPersona, addConversation, addMessages, TIME, DAY, iso,
} from './helpers.mjs';

const TEST_DIRECTORY = fileURLToPath(new URL('.', import.meta.url));
const triple = (subject = 'Alice', predicate = 'likes', object = 'Jasmine tea', subjectType = 'person', objectType = 'topic') => ({
  subject: { name: subject, type: subjectType }, predicate, object: { name: object, type: objectType },
});
const save = (api, personaId, content, extra = {}) => api.saveMemory({ personaId, content, ...extra }).memory;
const relations = view => view.edges.filter(edge => edge.kind === 'relation');
const entities = view => view.nodes.filter(node => node.kind === 'entity');
const memoryNodes = view => view.nodes.filter(node => node.kind === 'memory');
const ids = rows => new Set(rows.map(row => row.id));
const batchFor = call => JSON.parse(call.body.messages.find(message => message.role === 'user').content);
const jsonResponse = value => modelResponse(JSON.stringify(value));
const extractionReply = (getTriples = () => []) => call => jsonResponse({
  memories: batchFor(call).map(row => ({ id: row.id, triples: getTriples(row) })),
});
const summaryItem = (content, extra = {}) => ({ content, category: 'fact', importance: 0.7, confidence: 0.9, ...extra });
const graphState = (store, memoryId) => store.get('SELECT * FROM memory_graph_state WHERE memoryId=?', memoryId);
const memoryRow = (api, memoryId) => api.memory.list().find(row => row.id === memoryId);

// Compare durable rows, not time-dependent scores, when asserting atomicity.
function snapshot(store) {
  return {
    memories: store.all('SELECT * FROM memories ORDER BY id'),
    entities: store.all('SELECT * FROM graph_entities ORDER BY id'),
    relations: store.all('SELECT * FROM graph_relations ORDER BY id'),
    evidence: store.all('SELECT * FROM graph_evidence ORDER BY memoryId,relationId'),
    states: store.all('SELECT * FROM memory_graph_state ORDER BY memoryId'),
  };
}

function assertGraphIntegrity(view) {
  const nodes = new Map(view.nodes.map(node => [node.id, node]));
  const visibleMemories = new Set(memoryNodes(view).map(node => node.memoryId));
  assert.equal(nodes.size, view.nodes.length, 'node IDs must be unique');
  assert.equal(ids(view.edges).size, view.edges.length, 'edge IDs must be unique');
  assert.equal(view.stats.memoryCount, visibleMemories.size);
  assert.equal(view.stats.entityCount, entities(view).length);
  assert.equal(view.stats.relationCount, relations(view).length);
  for (const item of [...view.nodes, ...view.edges]) {
    assert.ok(item.memoryIds.length > 0, `${item.id} must retain evidence`);
    assert.equal(new Set(item.memoryIds).size, item.memoryIds.length);
    for (const memoryId of item.memoryIds) assert.ok(visibleMemories.has(memoryId), 'evidence must reference a visible memory');
  }
  for (const edge of view.edges) {
    assert.ok(nodes.has(edge.source), `missing source for ${edge.id}`);
    assert.ok(nodes.has(edge.target), `missing target for ${edge.id}`);
    assert.equal(nodes.get(edge.target).kind, 'entity');
    assert.equal(nodes.get(edge.source).kind, edge.kind === 'relation' ? 'entity' : 'memory');
  }
}

// These are the only disk fixtures; each directory belongs to this test file.
async function diskFixture(t, replies = []) {
  const directory = await mkdtemp(join(TEST_DIRECTORY, '.tmp-graph-'));
  const dbPath = join(directory, 'graph.sqlite');
  const mock = scriptedModel(...replies);
  let current;
  const close = async () => {
    if (!current) return;
    const closing = current;
    current = undefined;
    try { await closing.api.scheduler.stop(); } finally { closing.store.close(); }
  };
  t.after(async () => {
    try { await close(); } finally { await rm(directory, { recursive: true, force: true }); }
  });
  const open = () => {
    assert.equal(current, undefined, 'close the previous connection before restarting');
    const store = createStore(dbPath);
    store.saveSettings({ baseUrl: 'http://model.invalid/v1', model: 'test-model' });
    const api = createService(store, { fetchImpl: mock.fetchImpl, apiKey: '', timeoutMs: 1000 });
    current = { store, api };
    return current;
  };
  return { dbPath, open, close, ...mock };
}

test('omitted triples are pending; explicit empty triples are indexed without model work', async t => {
  const { api, store, personaId, calls } = fixture(t, [extractionReply()]);
  const pending = save(api, personaId, 'No supplied relations');
  const empty = save(api, personaId, 'Intentionally no relation', { triples: [] });
  assert.equal(pending.graphIndexed, false);
  assert.equal(empty.graphIndexed, true);
  assert.deepEqual(pending.triples, []);
  assert.deepEqual(empty.triples, []);
  assert.equal(graphState(store, pending.id).extractedAt, null);
  assert.ok(graphState(store, empty.id).extractedAt);
  const view = api.getGraph({ personaId });
  assert.deepEqual(view.stats, { memoryCount: 2, entityCount: 0, relationCount: 0, pendingCount: 1, totalMemoryCount: 2 });
  assert.equal(view.truncated, false);
  assert.equal(memoryNodes(view).find(row => row.memoryId === pending.id).indexed, false);
  assertGraphIntegrity(view);
  api.bootstrap();
  api.memory.recall(personaId, 'relations');
  assert.equal(calls.length, 0, 'reads and manual writes must never invoke extraction');
  assert.deepEqual(await api.extractGraph({ personaId }), { processed: 1, skipped: 0, remaining: 0, relations: 0 });
  assert.deepEqual(batchFor(calls[0]), [{ id: pending.id, content: pending.content }]);
  const indexedState = graphState(store, pending.id);
  assert.ok(indexedState.contentHash);
  assert.ok(indexedState.extractedAt);
  for (let i = 0; i < 3; i++) {
    assert.deepEqual(await api.extractGraph({ personaId }), { processed: 0, skipped: 0, remaining: 0, relations: 0 });
  }
  assert.equal(calls.length, 1, 'an empty result must not cause endless extraction');
  assert.deepEqual(graphState(store, pending.id), indexedState);
  assert.equal(api.getGraph({ personaId }).stats.pendingCount, 0);
});

test('NFKC, case and whitespace normalization deduplicate entities, relations and evidence within a role', t => {
  const { api, store, personaId, calls } = fixture(t);
  const first = save(api, personaId, 'First supporting observation', { triples: [
    triple(' Alice ', ' LIKES ', ' Jasmine   Tea '),
    triple('ＡＬＩＣＥ', 'ｌｉｋｅｓ', 'ｊａｓｍｉｎｅ　ｔｅａ'),
  ] });
  const second = save(api, personaId, 'Independent supporting observation', { triples: [triple('alice', 'likes', 'jasmine tea')] });
  const view = api.getGraph({ personaId });
  assert.equal(first.triples.length, 1);
  assert.equal(second.triples.length, 1);
  assert.equal(view.stats.entityCount, 2);
  assert.equal(view.stats.relationCount, 1);
  assert.deepEqual(new Set(relations(view)[0].memoryIds), new Set([first.id, second.id]));
  assert.equal(view.edges.filter(edge => edge.kind === 'evidence').length, 4);
  assert.deepEqual(new Set(store.all('SELECT normalizedName FROM graph_entities').map(row => row.normalizedName)), new Set(['alice', 'jasmine tea']));
  assert.equal(store.get('SELECT normalizedPredicate FROM graph_relations').normalizedPredicate, 'likes');
  assert.equal(store.get('SELECT COUNT(*) AS n FROM graph_evidence').n, 2);
  assertGraphIntegrity(view);
  assert.equal(calls.length, 0);
});

test('deduplication preserves distinct predicates, direction and self-relations', t => {
  const { api, personaId } = fixture(t);
  const memory = save(api, personaId, 'Several distinct statements', { triples: [
    triple('Alice', 'knows', 'Bob', 'person', 'person'),
    triple('Bob', 'knows', 'Alice', 'person', 'person'),
    triple('Alice', 'mentors', 'Bob', 'person', 'person'),
    triple('Alice', 'reflects on', 'Alice', 'person', 'person'),
  ] });
  const view = api.getGraph({ personaId });
  assert.equal(memory.triples.length, 4);
  assert.equal(view.stats.entityCount, 2);
  assert.equal(view.stats.relationCount, 4);
  assert.equal(view.edges.filter(edge => edge.kind === 'evidence').length, 2, 'evidence links are deduplicated across relations and self-loops');
  assert.equal(relations(view).filter(edge => edge.source === edge.target).length, 1);
  assertGraphIntegrity(view);
});

test('identical named graphs remain role-isolated in storage, views and recall', t => {
  const { api, store, personaId } = fixture(t);
  const other = addPersona(api);
  const own = save(api, personaId, 'Own supporting record', { triples: [triple('Orion', 'visits', 'Kyoto')] });
  const foreign = save(api, other, 'Foreign supporting record', { triples: [triple('Orion', 'visits', 'Kyoto')], pinned: true });
  const ownView = api.getGraph({ personaId });
  const foreignView = api.getGraph({ personaId: other });
  assert.equal(ownView.personaId, personaId);
  assert.equal(foreignView.personaId, other);
  assert.equal(ownView.stats.entityCount, 2);
  assert.equal(foreignView.stats.entityCount, 2);
  assert.equal(store.get('SELECT COUNT(*) AS n FROM graph_entities').n, 4);
  assert.equal(store.get('SELECT COUNT(*) AS n FROM graph_relations').n, 2);
  assert.ok(ownView.nodes.every(node => !ids(foreignView.nodes).has(node.id)));
  assert.ok(ownView.edges.every(edge => !ids(foreignView.edges).has(edge.id)));
  assert.deepEqual(ids(api.memory.recall(personaId, 'Orion')), new Set([own.id]));
  assert.deepEqual(ids(api.memory.recall(other, 'Orion')), new Set([foreign.id]));
  const before = snapshot(store);
  assert.throws(() => api.saveMemory({ personaId: other, triples: [] }, own.id), errorStatus(400));
  assert.deepEqual(snapshot(store), before);
  api.deleteMemory(own.id);
  assert.equal(api.getGraph({ personaId }).nodes.length, 0);
  assert.deepEqual(api.getGraph({ personaId: other }), foreignView);
  assertGraphIntegrity(foreignView);
});

test('shared evidence survives one deletion; last-evidence deletion cleans relations, entities and state', t => {
  const { api, store, personaId } = fixture(t);
  const first = save(api, personaId, 'First source', { triples: [triple(), triple('Alice', 'visits', 'Kyoto', 'person', 'place')] });
  const second = save(api, personaId, 'Second source', { triples: [triple()], pinned: true, importance: 0.95, confidence: 0.99 });
  const before = api.getGraph({ personaId });
  const shared = relations(before).find(edge => edge.memoryIds.length === 2);
  assert.equal(shared.pinned, true);
  assert.equal(shared.score, 1);
  assert.equal(shared.importance, 0.95);
  assert.equal(shared.confidence, 1);
  assert.deepEqual(api.deleteMemory(first.id), { ok: true });
  const after = api.getGraph({ personaId });
  assert.equal(after.stats.entityCount, 2);
  assert.equal(after.stats.relationCount, 1);
  assert.equal(relations(after)[0].id, shared.id);
  assert.deepEqual(relations(after)[0].memoryIds, [second.id]);
  assert.equal(relations(after)[0].confidence, 0.99);
  assert.ok(!entities(after).some(node => node.label === 'Kyoto'));
  assert.equal(graphState(store, first.id), null);
  assert.equal(store.get('SELECT COUNT(*) AS n FROM graph_evidence WHERE memoryId=?', first.id).n, 0);
  assertGraphIntegrity(after);
  api.deleteMemory(second.id);
  assert.deepEqual(snapshot(store), { memories: [], entities: [], relations: [], evidence: [], states: [] });
  assert.deepEqual(api.getGraph({ personaId }).stats, { memoryCount: 0, entityCount: 0, relationCount: 0, pendingCount: 0, totalMemoryCount: 0 });
  assert.throws(() => api.deleteMemory(second.id), errorStatus(404));
});

test('content edits invalidate only their evidence and mark the edited memory pending', t => {
  const { api, store, personaId } = fixture(t);
  const edited = save(api, personaId, 'Original assertion', { triples: [triple(), triple('Alice', 'visits', 'Kyoto')] });
  const sibling = save(api, personaId, 'Shared assertion', { triples: [triple()] });
  const originalState = graphState(store, edited.id);
  const sharedId = relations(api.getGraph({ personaId })).find(edge => edge.memoryIds.length === 2).id;
  const changed = api.saveMemory({ content: 'Replacement assertion' }, edited.id).memory;
  assert.equal(changed.graphIndexed, false);
  assert.deepEqual(changed.triples, []);
  assert.notEqual(graphState(store, edited.id).revision, originalState.revision);
  assert.equal(graphState(store, edited.id).extractedAt, null);
  const view = api.getGraph({ personaId });
  assert.equal(view.stats.pendingCount, 1);
  assert.equal(view.stats.entityCount, 2);
  assert.equal(relations(view)[0].id, sharedId);
  assert.deepEqual(relations(view)[0].memoryIds, [sibling.id]);
  assert.equal(memoryRow(api, sibling.id).graphIndexed, true);
  assertGraphIntegrity(view);
});

test('pin, category, confidence, status and unchanged-content patches preserve graph indexing', t => {
  const { api, store, personaId, calls } = fixture(t);
  const memory = save(api, personaId, 'Unchanged assertion', { triples: [triple()] });
  const state = graphState(store, memory.id);
  const relationIds = ids(relations(api.getGraph({ personaId })));
  for (const patch of [{ pinned: true }, { category: 'preference', importance: 0.9, confidence: 0.8 },
    { status: 'archived' }, { status: 'active' }, { content: `  ${memory.content}  ` }]) {
    const changed = api.saveMemory(patch, memory.id).memory;
    assert.equal(changed.graphIndexed, true);
    assert.deepEqual(changed.triples, memory.triples);
    assert.deepEqual(graphState(store, memory.id), state);
    assert.deepEqual(ids(relations(api.getGraph({ personaId, includeArchived: true }))), relationIds);
  }
  assert.equal(api.getGraph({ personaId }).stats.pendingCount, 0);
  assert.equal(calls.length, 0);
});

test('content plus manual triples replace atomically; manual empty triples clear without becoming pending', async t => {
  const { api, store, personaId, calls } = fixture(t);
  const memory = save(api, personaId, 'Old assertion', { triples: [triple()] });
  const replacement = triple('Bob', 'works at', 'Acme', 'person', 'organization');
  const changed = api.saveMemory({ content: 'New assertion', triples: [replacement] }, memory.id).memory;
  assert.equal(changed.graphIndexed, true);
  assert.deepEqual(changed.triples, [replacement]);
  assert.deepEqual(new Set(entities(api.getGraph({ personaId })).map(row => row.label)), new Set(['Bob', 'Acme']));
  const empty = api.saveMemory({ triples: [] }, memory.id).memory;
  assert.equal(empty.graphIndexed, true);
  assert.deepEqual(empty.triples, []);
  assert.equal(store.get('SELECT COUNT(*) AS n FROM graph_entities').n, 0);
  assert.equal(store.get('SELECT COUNT(*) AS n FROM graph_relations').n, 0);
  assert.equal(store.get('SELECT COUNT(*) AS n FROM graph_evidence').n, 0);
  assert.deepEqual(await api.extractGraph({ personaId }), { processed: 0, skipped: 0, remaining: 0, relations: 0 });
  assert.equal(calls.length, 0);
});

test('archived evidence is hidden from views and recall, retained on disk and restored without re-extraction', t => {
  const { api, store, personaId, calls } = fixture(t);
  const active = save(api, personaId, 'Active source', { triples: [triple('Orion')], importance: 0.3, confidence: 0.4 });
  const archived = save(api, personaId, 'Archived source', { triples: [triple('Orion'), triple('Orion', 'visits', 'Kyoto')], pinned: true });
  const pendingArchive = save(api, personaId, 'Unindexed archive', { status: 'archived' });
  const archivedState = graphState(store, archived.id);
  const originalRelations = ids(relations(api.getGraph({ personaId })));
  api.saveMemory({ status: 'archived' }, archived.id);
  const view = api.getGraph({ personaId });
  assert.equal(view.stats.memoryCount, 1);
  assert.equal(view.stats.relationCount, 1);
  assert.equal(view.stats.pendingCount, 0);
  assert.deepEqual(relations(view)[0].memoryIds, [active.id]);
  assert.equal(relations(view)[0].pinned, false);
  assert.equal(relations(view)[0].importance, 0.3);
  assert.equal(relations(view)[0].confidence, 0.4);
  assert.ok(!entities(view).some(node => node.label === 'Kyoto'));
  assert.deepEqual(ids(api.memory.recall(personaId, 'Orion')), new Set([active.id]));
  assert.deepEqual(api.memory.recall(personaId, 'Kyoto'), [], 'archived edges must not provide even indirect recall');
  const all = api.getGraph({ personaId, includeArchived: true });
  assert.equal(all.stats.memoryCount, 3);
  assert.equal(all.stats.pendingCount, 0, 'archived pending memories are not extractable');
  assert.deepEqual(ids(relations(all)), originalRelations);
  const exclusive = relations(all).find(edge => edge.label === 'visits');
  assert.equal(exclusive.status, 'archived');
  assert.equal(relations(all).find(edge => edge.memoryIds.length === 2).status, 'active');
  assert.equal(graphState(store, pendingArchive.id).extractedAt, null);
  assert.deepEqual(graphState(store, archived.id), archivedState);
  assertGraphIntegrity(view);
  assertGraphIntegrity(all);
  api.saveMemory({ status: 'active' }, archived.id);
  const restored = api.getGraph({ personaId });
  assert.deepEqual(ids(relations(restored)), originalRelations);
  assert.deepEqual(ids(api.memory.recall(personaId, 'Kyoto')), new Set([active.id, archived.id]));
  assert.deepEqual(graphState(store, archived.id), archivedState);
  assert.equal(restored.stats.pendingCount, 0);
  assert.equal(calls.length, 0);
});

test('maintenance archives weak graph evidence without destroying relations needed for restoration', t => {
  const { api, store, personaId } = fixture(t);
  const memory = save(api, personaId, 'A stale observation', { importance: 0.01, confidence: 0.01, triples: [triple('Orion')] });
  store.run('UPDATE memories SET reinforcedAt=? WHERE id=?', iso(TIME - 300 * DAY), memory.id);
  const state = graphState(store, memory.id);
  assert.deepEqual(api.memory.maintain(TIME), { archived: 1 });
  assert.equal(api.getGraph({ personaId }).nodes.length, 0);
  assert.deepEqual(api.memory.recall(personaId, 'Orion'), []);
  assert.equal(api.getGraph({ personaId, includeArchived: true }).stats.relationCount, 1);
  api.saveMemory({ status: 'active' }, memory.id);
  assert.equal(api.getGraph({ personaId }).stats.relationCount, 1);
  assert.deepEqual(graphState(store, memory.id), state);
});

const invalidTriples = [
  ['explicit undefined', undefined], ['null', null], ['object instead of array', {}],
  ['more than eight triples', Array.from({ length: 9 }, () => triple())],
  ['null triple', [null]], ['missing subject', [{ predicate: 'likes', object: triple().object }]],
  ['missing object', [{ subject: triple().subject, predicate: 'likes' }]],
  ['missing predicate', [{ subject: triple().subject, object: triple().object }]],
  ['array entity', [{ ...triple(), subject: [] }]],
  ['invalid subject type', [triple('Alice', 'likes', 'Tea', 'unknown')]],
  ['invalid object type', [triple('Alice', 'likes', 'Tea', 'person', 'unknown')]],
  ['blank subject', [triple('  ')]], ['blank object', [triple('Alice', 'likes', ' ')]],
  ['blank predicate', [triple('Alice', ' ')]], ['non-string name', [triple(42)]],
  ['non-string predicate', [triple('Alice', 42)]],
  ['overlong subject', [triple('x'.repeat(81))]],
  ['overlong object', [triple('Alice', 'likes', 'x'.repeat(81))]],
  ['overlong predicate', [triple('Alice', 'x'.repeat(41))]],
  ['control character in subject', [triple('Al\u0000ice')]],
  ['newline in object', [triple('Alice', 'likes', 'Green\nTea')]],
  ['pipe in predicate', [triple('Alice', 'likes|hates')]],
  ['pipe in subject', [triple('Alice|Bob')]],
];
for (const [name, value] of invalidTriples) {
  test(`manual triple validation rejects ${name} without any partial write`, t => {
    const { api, store, personaId, calls } = fixture(t);
    const existing = save(api, personaId, 'Existing source', { triples: [triple()] });
    const before = snapshot(store);
    // Put a valid relation first so validation cannot save a valid prefix.
    const triples = Array.isArray(value) && value.length <= 8 ? [triple('New subject', 'knows', 'New object'), ...value] : value;
    assert.throws(() => api.saveMemory({ personaId, content: 'Must not insert', triples }), errorStatus(400));
    assert.deepEqual(snapshot(store), before);
    assert.throws(() => api.saveMemory({ content: 'Must not update', pinned: true, triples }, existing.id), errorStatus(400));
    assert.deepEqual(snapshot(store), before);
    assert.equal(calls.length, 0);
  });
}

test('all supported entity types and exact triple/name/predicate limits are accepted', t => {
  const { api, personaId } = fixture(t);
  const types = ['person', 'organization', 'place', 'topic', 'event', 'other'];
  const triples = types.map((type, index) => triple(`Subject ${index}`, `relation ${index}`, `Object ${index}`, type, type));
  triples.push(triple('s'.repeat(80), 'p'.repeat(40), 'o'.repeat(80)), triple('Last subject', 'connects', 'Last object'));
  const memory = save(api, personaId, 'Exactly eight supported statements', { triples });
  assert.equal(memory.graphIndexed, true);
  assert.equal(memory.triples.length, 8);
  assert.deepEqual(new Set(memory.triples.map(item => item.subject.type)), new Set(types));
  assert.equal(api.getGraph({ personaId }).stats.relationCount, 8);
  assertGraphIntegrity(api.getGraph({ personaId }));
});

test('summary stores supplied triples in its single model call and distinguishes omitted from empty triples', async t => {
  const output = { memories: [
    summaryItem('Alice has an explicit preference', { triples: [triple()] }),
    summaryItem('Nothing relational', { triples: [] }),
    summaryItem('Legacy output without triples'),
  ] };
  const { api, store, personaId, calls } = fixture(t, [output]);
  const conversationId = addConversation(api, personaId);
  const messageIds = addMessages(store, conversationId, ['I like jasmine tea.', 'Noted.']);
  assert.deepEqual(await api.summarize({ personaId }), { created: 3, processed: 2 });
  assert.equal(calls.length, 1, 'summary must not make a second graph extraction request');
  assert.match(calls[0].body.messages[0].content, /triples/);
  const rows = api.memory.list(personaId);
  assert.deepEqual(rows.find(row => row.content === output.memories[0].content).triples, [triple()]);
  assert.equal(rows.find(row => row.content === output.memories[0].content).graphIndexed, true);
  assert.equal(rows.find(row => row.content === output.memories[1].content).graphIndexed, true);
  assert.equal(rows.find(row => row.content === output.memories[2].content).graphIndexed, false);
  assert.equal(api.getGraph({ personaId }).stats.pendingCount, 1);
  assert.equal(api.getConversation(conversationId).conversation.summaryCursor, messageIds.at(-1));
  assert.ok(rows.every(row => row.source === `conversation:${conversationId};messages:${messageIds[0]}-${messageIds.at(-1)}`));
  assert.deepEqual(await api.summarize({ personaId }), { created: 0, processed: 0 });
  assert.equal(calls.length, 1);
});

for (const [name, triples] of [['null triples', null], ['invalid late relation', [triple(), triple('Alice', 'bad|predicate')]], ['missing entity', [{ predicate: 'likes', object: triple().object }]]]) {
  test(`summary rejects ${name} atomically without advancing its cursor and permits retry`, async t => {
    const content = 'Existing pending summary source';
    const { api, store, personaId, calls } = fixture(t, [
      { memories: [summaryItem(content, { triples: [triple()] }), summaryItem('Invalid late source', { triples })] },
      { memories: [summaryItem(content, { triples: [triple()] })] },
    ]);
    const existing = save(api, personaId, content);
    const conversationId = addConversation(api, personaId);
    const messageIds = addMessages(store, conversationId, ['Explicit statement.', 'Acknowledged.']);
    const before = snapshot(store);
    const conversation = api.getConversation(conversationId).conversation;
    await assert.rejects(api.summarize({ personaId }), errorStatus(502));
    assert.deepEqual(snapshot(store), before);
    assert.deepEqual(api.getConversation(conversationId).conversation, conversation);
    assert.equal(calls.length, 1);
    assert.deepEqual(await api.summarize({ personaId }), { created: 0, processed: 2 });
    assert.equal(memoryRow(api, existing.id).graphIndexed, true);
    assert.equal(memoryRow(api, existing.id).mentions, 2);
    assert.equal(api.getConversation(conversationId).conversation.summaryCursor, messageIds.at(-1));
    assert.equal(calls.length, 2);
  });
}

test('summary dedup fills pending relations but preserves manual relations and indexed-empty decisions', async t => {
  const contents = ['Manual source', 'Manually empty source', 'Pending source'];
  const generated = triple('Model subject', 'asserts', 'Model object');
  const { api, store, personaId, calls } = fixture(t, [{ memories: contents.map(content => summaryItem(content, { triples: [generated] })) }]);
  const manual = save(api, personaId, contents[0], { triples: [triple()], status: 'archived' });
  const empty = save(api, personaId, contents[1], { triples: [] });
  const pending = save(api, personaId, contents[2]);
  const manualState = graphState(store, manual.id), emptyState = graphState(store, empty.id);
  const conversationId = addConversation(api, personaId);
  addMessages(store, conversationId, ['Statements to summarize.']);
  assert.deepEqual(await api.summarize({ personaId }), { created: 0, processed: 1 });
  assert.equal(memoryRow(api, manual.id).status, 'active');
  assert.deepEqual(memoryRow(api, manual.id).triples, [triple()]);
  assert.deepEqual(memoryRow(api, empty.id).triples, []);
  assert.deepEqual(memoryRow(api, pending.id).triples, [generated]);
  assert.deepEqual(graphState(store, manual.id), manualState);
  assert.deepEqual(graphState(store, empty.id), emptyState);
  assert.equal(api.getGraph({ personaId }).stats.pendingCount, 0);
  assert.equal(calls.length, 1);
});

const invalidExtractions = [
  ['missing memories', () => ({})], ['null response', () => null], ['non-array memories', () => ({ memories: {} })],
  ['missing batch ID', batch => ({ memories: [{ id: batch[0].id, triples: [triple()] }] })],
  ['unknown ID', batch => ({ memories: [{ id: batch[0].id, triples: [triple()] }, { id: 'not-an-input-id', triples: [] }] })],
  ['foreign-role ID', (batch, context) => ({ memories: [{ id: batch[0].id, triples: [triple()] }, { id: context.foreign.id, triples: [] }] })],
  ['already-indexed ID', (batch, context) => ({ memories: [{ id: batch[0].id, triples: [triple()] }, { id: context.indexed.id, triples: [] }] })],
  ['duplicate ID', batch => ({ memories: [{ id: batch[0].id, triples: [triple()] }, { id: batch[0].id, triples: [] }] })],
  ['extra ID', batch => ({ memories: [...batch.map(row => ({ id: row.id, triples: [] })), { id: 'extra', triples: [] }] })],
  ['null entry', batch => ({ memories: [{ id: batch[0].id, triples: [triple()] }, null] })],
  ['missing triples', batch => ({ memories: [{ id: batch[0].id, triples: [triple()] }, { id: batch[1].id }] })],
  ['invalid late triples', batch => ({ memories: [{ id: batch[0].id, triples: [triple()] }, { id: batch[1].id, triples: [triple('bad|name')] }] })],
];
for (const [name, output] of invalidExtractions) {
  test(`extraction rejects ${name}, saves nothing from the batch and releases its lock`, async t => {
    const context = {};
    const { api, store, personaId, calls } = fixture(t, [
      call => jsonResponse(output(batchFor(call), context)), extractionReply(() => [triple()]),
    ]);
    const first = save(api, personaId, 'Pending first');
    const second = save(api, personaId, 'Pending second');
    context.indexed = save(api, personaId, 'Existing indexed relation', { triples: [triple()] });
    context.foreign = save(api, addPersona(api), 'Foreign pending source');
    const before = snapshot(store);
    await assert.rejects(api.extractGraph({ personaId }), errorStatus(502));
    assert.equal(calls.length, 1);
    assert.deepEqual(new Set(batchFor(calls[0]).map(row => row.id)), new Set([first.id, second.id]));
    assert.deepEqual(snapshot(store), before);
    assert.equal(api.getGraph({ personaId }).stats.pendingCount, 2);
    assert.deepEqual(await api.extractGraph({ personaId }), { processed: 2, skipped: 0, remaining: 0, relations: 2 });
    assert.equal(api.getGraph({ personaId }).stats.relationCount, 1, 'both extracted memories share the existing normalized relation');
    assert.equal(relations(api.getGraph({ personaId }))[0].memoryIds.length, 3);
    assert.equal(memoryRow(api, context.foreign.id).graphIndexed, false);
    assert.equal(calls.length, 2);
  });
}

test('extraction associates out-of-order model results by ID rather than array position', async t => {
  const { api, personaId, calls } = fixture(t, [call => jsonResponse({ memories: batchFor(call).reverse().map(row => ({
    id: row.id, triples: [triple(row.content, 'identifies', 'Destination')],
  })) })]);
  const first = save(api, personaId, 'First subject');
  const second = save(api, personaId, 'Second subject');
  assert.deepEqual(await api.extractGraph({ personaId }), { processed: 2, skipped: 0, remaining: 0, relations: 2 });
  for (const row of [first, second]) assert.equal(memoryRow(api, row.id).triples[0].subject.name, row.content);
  assert.equal(calls.length, 1);
});

test('extraction batches at twenty, visits only pending active memories and never replays indexed-empty results', async t => {
  const { api, store, personaId, calls } = fixture(t, [extractionReply(), extractionReply(), extractionReply()]);
  const pending = Array.from({ length: 45 }, (_, i) => save(api, personaId, `Pending record ${i}`));
  pending.forEach((row, i) => store.run('UPDATE memories SET createdAt=? WHERE id=?', iso(TIME + i), row.id));
  const empty = save(api, personaId, 'Already indexed empty', { triples: [] });
  const indexed = save(api, personaId, 'Already related', { triples: [triple()] });
  const archived = save(api, personaId, 'Archived pending', { status: 'archived' });
  const foreign = save(api, addPersona(api), 'Another role pending');
  const protectedStates = [empty, indexed, archived, foreign].map(row => graphState(store, row.id));
  assert.equal(api.getGraph({ personaId }).stats.pendingCount, 45);
  for (const [index, processed, remaining] of [[0, 20, 25], [1, 20, 5], [2, 5, 0]]) {
    assert.deepEqual(await api.extractGraph({ personaId }), { processed, skipped: 0, remaining, relations: 0 });
    assert.deepEqual(batchFor(calls[index]), pending.slice(index * 20, index * 20 + processed).map(row => ({ id: row.id, content: row.content })));
    assert.equal(api.getGraph({ personaId }).stats.pendingCount, remaining);
  }
  assert.deepEqual(await api.extractGraph({ personaId }), { processed: 0, skipped: 0, remaining: 0, relations: 0 });
  assert.equal(calls.length, 3);
  assert.equal(new Set(calls.flatMap(call => batchFor(call).map(row => row.id))).size, 45);
  assert.ok(pending.every(row => memoryRow(api, row.id).graphIndexed));
  assert.deepEqual([empty, indexed, archived, foreign].map(row => graphState(store, row.id)), protectedStates);
});

test('extraction lock rejects same-role concurrency but permits another role to proceed', async t => {
  const gate = deferred();
  const { api, personaId, calls } = fixture(t, [() => gate.promise, extractionReply(() => [triple()])]);
  const other = addPersona(api);
  save(api, personaId, 'First role pending');
  save(api, other, 'Second role pending');
  const first = api.extractGraph({ personaId });
  let result;
  try {
    assert.equal(calls.length, 1);
    await assert.rejects(api.extractGraph({ personaId }), errorStatus(409));
    assert.equal(calls.length, 1, 'the locked request must not reach the model');
    assert.deepEqual(await api.extractGraph({ personaId: other }), { processed: 1, skipped: 0, remaining: 0, relations: 1 });
    assert.equal(calls.length, 2);
  } finally {
    gate.resolve(extractionReply(() => [triple()])(calls[0]));
    result = await first;
  }
  assert.deepEqual(result, { processed: 1, skipped: 0, remaining: 0, relations: 1 });
  assert.deepEqual(await api.extractGraph({ personaId }), { processed: 0, skipped: 0, remaining: 0, relations: 0 });
  assert.equal(calls.length, 2);
});

const races = [
  ['content edit', (api, row) => api.saveMemory({ content: 'Edited while extracting' }, row.id), 1],
  ['delete', (api, row) => api.deleteMemory(row.id), 0],
  ['manual relations', (api, row) => api.saveMemory({ triples: [triple('Manual subject', 'preserves', 'Manual object')] }, row.id), 0],
  ['manual empty relations', (api, row) => api.saveMemory({ triples: [] }, row.id), 0],
  ['archive', (api, row) => api.saveMemory({ status: 'archived' }, row.id), 0],
  ['edit then revert to original content', (api, row) => {
    api.saveMemory({ content: 'Temporary edit' }, row.id);
    api.saveMemory({ content: row.content }, row.id);
  }, 1],
];
for (const [name, mutate, remaining] of races) {
  test(`in-flight extraction skips a ${name} race without losing unaffected results`, async t => {
    const gate = deferred();
    const generated = triple('Model subject', 'claims', 'Model object');
    const { api, store, personaId, calls } = fixture(t, [() => gate.promise]);
    const target = save(api, personaId, 'Original pending content');
    const control = save(api, personaId, 'Unaffected pending content');
    const extraction = api.extractGraph({ personaId });
    let expectedRow, expectedState, expectedTriples, result;
    try {
      assert.equal(calls.length, 1);
      mutate(api, target);
      expectedRow = store.get('SELECT * FROM memories WHERE id=?', target.id);
      expectedState = graphState(store, target.id);
      expectedTriples = memoryRow(api, target.id)?.triples;
    } finally {
      gate.resolve(extractionReply(() => [generated])(calls[0]));
      result = await extraction;
    }
    assert.deepEqual(result, { processed: 1, skipped: 1, remaining, relations: 1 });
    assert.deepEqual(store.get('SELECT * FROM memories WHERE id=?', target.id), expectedRow);
    assert.deepEqual(graphState(store, target.id), expectedState);
    assert.deepEqual(memoryRow(api, target.id)?.triples, expectedTriples);
    assert.deepEqual(memoryRow(api, control.id).triples, [generated]);
    assert.equal(memoryRow(api, control.id).graphIndexed, true);
    const modelEdge = relations(api.getGraph({ personaId })).find(edge => edge.label === generated.predicate);
    assert.deepEqual(modelEdge.memoryIds, [control.id], 'stale results must not attach evidence to the edited record');
    assertGraphIntegrity(api.getGraph({ personaId }));
    assert.equal(calls.length, 1);
  });
}

for (const [name, mutate] of races) {
  test(`in-flight summary respects a ${name} instead of resurrecting its old evidence`, async t => {
    const gate = deferred();
    const { api, store, personaId } = fixture(t, [() => gate.promise]);
    const target = save(api, personaId, 'Original pending content');
    const conversationId = addConversation(api, personaId);
    const messageIds = addMessages(store, conversationId, ['Explicit statements.']);
    const summary = api.summarize({ personaId });
    mutate(api, target);
    const expected = store.get('SELECT * FROM memories WHERE id=?', target.id);
    const expectedState = graphState(store, target.id);
    gate.resolve(jsonResponse({ memories: [summaryItem(target.content, { triples: [triple()] }), summaryItem('Unaffected new fact', { triples: [] })] }));
    assert.deepEqual(await summary, { created: 1, processed: 1 });
    assert.deepEqual(store.get('SELECT * FROM memories WHERE id=?', target.id), expected);
    assert.deepEqual(graphState(store, target.id), expectedState);
    assert.equal(api.getConversation(conversationId).conversation.summaryCursor, messageIds.at(-1));
    if (!expected) assert.ok(!api.memory.list(personaId).some(row => row.content === target.content));
  });
}

test('a pin-only patch during extraction preserves the patch and does not invalidate the result', async t => {
  const gate = deferred();
  const { api, personaId, calls } = fixture(t, [() => gate.promise]);
  const row = save(api, personaId, 'Pending evidence');
  const extraction = api.extractGraph({ personaId });
  let result;
  try { api.saveMemory({ pinned: true }, row.id); }
  finally {
    gate.resolve(extractionReply(() => [triple()])(calls[0]));
    result = await extraction;
  }
  assert.deepEqual(result, { processed: 1, skipped: 0, remaining: 0, relations: 1 });
  assert.equal(memoryRow(api, row.id).pinned, true);
  assert.deepEqual(memoryRow(api, row.id).triples, [triple()]);
  assert.equal(relations(api.getGraph({ personaId }))[0].pinned, true);
});

test('SQLite restart preserves graph IDs, shared evidence, archived relations and pending/empty state', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: TIME });
  const disk = await diskFixture(t, [extractionReply(() => [triple()])]);
  let { api, store } = disk.open();
  const personaId = store.get('SELECT id FROM personas LIMIT 1').id;
  const first = save(api, personaId, 'First persistent evidence', { triples: [triple()] });
  const second = save(api, personaId, 'Second persistent evidence', { triples: [triple()], status: 'archived' });
  const empty = save(api, personaId, 'Persistent empty decision', { triples: [] });
  const pending = save(api, personaId, 'Persistent pending source');
  const other = addPersona(api);
  save(api, other, 'Other role persistent graph', { triples: [triple()] });
  const before = snapshot(store);
  const beforeView = api.getGraph({ personaId, includeArchived: true });
  await disk.close();
  ({ api, store } = disk.open());
  assert.deepEqual(snapshot(store), before);
  assert.deepEqual(api.getGraph({ personaId, includeArchived: true }), beforeView);
  assert.equal(memoryRow(api, empty.id).graphIndexed, true);
  assert.equal(memoryRow(api, pending.id).graphIndexed, false);
  assert.equal(memoryRow(api, second.id).status, 'archived');
  assert.equal(disk.calls.length, 0, 'opening a database must not make model calls');
  assert.deepEqual(await api.extractGraph({ personaId }), { processed: 1, skipped: 0, remaining: 0, relations: 1 });
  assert.deepEqual(batchFor(disk.calls[0]), [{ id: pending.id, content: pending.content }]);
  const relation = relations(api.getGraph({ personaId, includeArchived: true }))[0];
  assert.equal(relation.id, relations(beforeView)[0].id);
  assert.deepEqual(new Set(relation.memoryIds), new Set([first.id, second.id, pending.id]));
  const indexedSnapshot = snapshot(store);
  await disk.close();
  ({ api, store } = disk.open());
  assert.deepEqual(snapshot(store), indexedSnapshot);
  assert.deepEqual(await api.extractGraph({ personaId }), { processed: 0, skipped: 0, remaining: 0, relations: 0 });
  assert.equal(disk.calls.length, 1);
  assertGraphIntegrity(api.getGraph({ personaId, includeArchived: true }));
  assert.deepEqual(store.all('PRAGMA foreign_key_check'), []);
});

test('pre-graph SQLite memories upgrade to pending without data loss and reopening is idempotent', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: TIME });
  const disk = await diskFixture(t, [extractionReply(() => [triple()])]);
  // Construct a real old-format file with no graph tables, rather than calling the current schema first.
  const legacy = new DatabaseSync(disk.dbPath);
  try {
    legacy.exec(`
      CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE personas (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL,
        systemPrompt TEXT NOT NULL, tone TEXT NOT NULL, greeting TEXT NOT NULL, createdAt TEXT NOT NULL
      );
      CREATE TABLE memories (
        id TEXT PRIMARY KEY, personaId TEXT NOT NULL REFERENCES personas(id), content TEXT NOT NULL,
        category TEXT NOT NULL, importance REAL NOT NULL, confidence REAL NOT NULL, source TEXT NOT NULL,
        mentions INTEGER NOT NULL DEFAULT 1, accessCount INTEGER NOT NULL DEFAULT 0,
        pinned INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'active',
        createdAt TEXT NOT NULL, reinforcedAt TEXT NOT NULL, lastAccessedAt TEXT
      );
    `);
    legacy.prepare('INSERT INTO personas VALUES (?,?,?,?,?,?,?)').run('legacy-role', 'Legacy role', '', 'Be precise.', '', '', iso(TIME));
    legacy.prepare('INSERT INTO settings VALUES (?,?)').run('memoryBudget', '42');
    for (const [memoryId, status] of [['legacy-active', 'active'], ['legacy-second', 'active'], ['legacy-archive', 'archived']]) {
      legacy.prepare('INSERT INTO memories (id,personaId,content,category,importance,confidence,source,status,createdAt,reinforcedAt) VALUES (?,?,?,?,?,?,?,?,?,?)')
        .run(memoryId, 'legacy-role', `Original ${memoryId}`, 'fact', 0.7, 0.9, 'legacy-import', status, iso(TIME), iso(TIME));
    }
  } finally { legacy.close(); }
  let { api, store } = disk.open();
  const personaId = 'legacy-role';
  const originals = store.all('SELECT * FROM memories ORDER BY id');
  assert.equal(originals.length, 3);
  assert.equal(store.all('SELECT * FROM personas').length, 1, 'migration must not create an extra default role');
  assert.equal(store.settings().memoryBudget, 42);
  assert.deepEqual(api.getGraph({ personaId }).stats, { memoryCount: 2, entityCount: 0, relationCount: 0, pendingCount: 2, totalMemoryCount: 2 });
  assert.ok(api.memory.list(personaId).every(row => row.graphIndexed === false && row.triples.length === 0));
  assert.equal(api.getGraph({ personaId, includeArchived: true }).stats.memoryCount, 3);
  assert.equal(disk.calls.length, 0);
  const upgraded = snapshot(store);
  await disk.close();
  ({ api, store } = disk.open());
  assert.deepEqual(snapshot(store), upgraded, 'a second schema initialization must be a no-op');
  assert.deepEqual(await api.extractGraph({ personaId }), { processed: 2, skipped: 0, remaining: 0, relations: 2 });
  assert.deepEqual(new Set(batchFor(disk.calls[0]).map(row => row.id)), new Set(['legacy-active', 'legacy-second']));
  assert.deepEqual(store.all('SELECT * FROM memories ORDER BY id'), originals);
  assert.equal(memoryRow(api, 'legacy-archive').graphIndexed, false);
  const populated = snapshot(store);
  const view = api.getGraph({ personaId });
  await disk.close();
  ({ api, store } = disk.open());
  assert.deepEqual(snapshot(store), populated);
  assert.deepEqual(api.getGraph({ personaId }), view);
  assert.equal(view.stats.relationCount, 1);
  assert.equal(view.stats.entityCount, 2);
  assert.deepEqual(await api.extractGraph({ personaId }), { processed: 0, skipped: 0, remaining: 0, relations: 0 });
  assert.equal(disk.calls.length, 1);
  assert.deepEqual(store.all('PRAGMA foreign_key_check'), []);
});

test('graph memory truncation starts above 150 and keeps all edges and evidence endpoints valid', t => {
  const { api, store, personaId, calls } = fixture(t);
  const rows = Array.from({ length: 150 }, (_, i) => save(api, personaId, `Visible source ${i}`, {
    triples: [triple(`Subject ${i}`, 'supports', `Object ${i}`)], pinned: i === 0,
  }));
  const full = api.getGraph({ personaId });
  assert.equal(full.stats.memoryCount, 150);
  assert.equal(full.stats.relationCount, 150);
  assert.equal(full.truncated, false);
  assertGraphIntegrity(full);
  const overflow = save(api, personaId, 'Old pending source beyond the view limit');
  store.run('UPDATE memories SET reinforcedAt=? WHERE id=?', iso(TIME - 10000 * DAY), overflow.id);
  const limited = api.getGraph({ personaId });
  assert.equal(limited.truncated, true);
  assert.equal(limited.stats.memoryCount, 150);
  assert.equal(limited.stats.totalMemoryCount, 151);
  assert.equal(limited.stats.pendingCount, 1, 'pending count includes memories outside the rendering limit');
  assert.equal(limited.stats.relationCount, 150);
  assert.deepEqual(new Set(memoryNodes(limited).map(row => row.memoryId)), ids(rows));
  assert.ok(memoryNodes(limited).some(row => row.memoryId === rows[0].id && row.pinned));
  assertGraphIntegrity(limited);
  assert.equal(store.get('SELECT COUNT(*) AS n FROM memories').n, 151);
  assert.equal(calls.length, 0);
});

test('graph relation truncation starts above 200, does not truncate evidence into dangling edges or delete stored relations', t => {
  const { api, store, personaId } = fixture(t);
  const add = i => save(api, personaId, `Source bundle ${i}`, { triples: Array.from({ length: 8 }, (_, j) =>
    triple(`Subject ${i}-${j}`, `relation ${j}`, `Object ${i}-${j}`)) });
  for (let i = 0; i < 25; i++) add(i);
  const full = api.getGraph({ personaId });
  assert.equal(full.stats.relationCount, 200);
  assert.equal(full.truncated, false);
  assertGraphIntegrity(full);
  add(25);
  const limited = api.getGraph({ personaId });
  assert.equal(limited.truncated, true);
  assert.equal(limited.stats.memoryCount, 26);
  assert.equal(limited.stats.totalMemoryCount, 26);
  assert.equal(limited.stats.relationCount, 200);
  assert.equal(limited.stats.entityCount, 400);
  assert.equal(limited.edges.filter(edge => edge.kind === 'evidence').length, 400);
  assert.equal(store.get('SELECT COUNT(*) AS n FROM graph_relations').n, 208);
  assert.equal(store.get('SELECT COUNT(*) AS n FROM graph_evidence').n, 208);
  assertGraphIntegrity(limited);
});

test('graph-only recall expands two hops, not three, in either direction and remains role-isolated', t => {
  const { api, personaId } = fixture(t);
  const first = save(api, personaId, 'First indirect evidence', { triples: [triple('Orion', 'connects', 'Vega')] });
  const second = save(api, personaId, 'Second indirect evidence', { triples: [triple('Vega', 'connects', 'Lyra')] });
  const third = save(api, personaId, 'Third indirect evidence', { triples: [triple('Lyra', 'connects', 'Deneb')] });
  save(api, personaId, 'Disconnected evidence', { triples: [triple('Altair', 'connects', 'Sirius')] });
  save(api, addPersona(api), 'Foreign evidence', { triples: [triple('Orion', 'connects', 'Foreign object')], pinned: true });
  const recalled = api.memory.recall(personaId, 'Orion');
  assert.deepEqual(recalled.map(row => row.id), [first.id, second.id], 'direct evidence should outrank second-hop evidence');
  assert.ok(!recalled.some(row => row.id === third.id));
  assert.deepEqual(ids(api.memory.recall(personaId, 'Deneb')), new Set([second.id, third.id]));
  assert.deepEqual(api.memory.recall(personaId, 'Quasar'), []);
  assert.ok(recalled.every(row => row.triples.length === 1));
});

for (const hub of ['用户', '我', '本人', 'USER', '助手', 'Assistant']) {
  test(`recall does not spread through the generic ${hub} hub`, t => {
    const { api, personaId } = fixture(t);
    const direct = save(api, personaId, 'Direct supporting record', { triples: [triple('Nebula', 'belongs to', hub)] });
    save(api, personaId, 'Unrelated sibling record', { triples: [triple(hub, 'enjoys', 'Gardening')] });
    save(api, personaId, 'Another sibling record', { triples: [triple(hub, 'works at', 'Acme')] });
    const associations = api.graph.related(personaId, 'Nebula', api.memory.list(personaId));
    assert.deepEqual(new Set(associations.keys()), new Set([direct.id]));
    assert.deepEqual(ids(api.memory.recall(personaId, 'Nebula')), new Set([direct.id]));
  });
}

test('recall expands degree-eight entities but contains degree-nine hubs, counting relations not duplicate evidence', t => {
  const { api, personaId } = fixture(t);
  const direct = save(api, personaId, 'Initial supporting record', { triples: [triple('Nebula', 'connects', 'Directory')] });
  const siblings = Array.from({ length: 7 }, (_, i) => save(api, personaId, `Sibling evidence ${i}`, { triples: [triple('Directory', 'connects', `Leaf ${i}`)] }));
  const duplicate = save(api, personaId, 'Repeated independent evidence', { triples: [triple('Directory', 'connects', 'Leaf 0')] });
  const related = () => api.graph.related(personaId, 'Nebula', api.memory.list(personaId));
  assert.deepEqual(new Set(related().keys()), new Set([direct.id, duplicate.id, ...siblings.map(row => row.id)]));
  assert.equal(api.memory.recall(personaId, 'Nebula').length, 6);
  save(api, personaId, 'Ninth distinct relation', { triples: [triple('Directory', 'connects', 'Last leaf')] });
  assert.deepEqual(new Set(related().keys()), new Set([direct.id]));
  assert.deepEqual(ids(api.memory.recall(personaId, 'Nebula')), new Set([direct.id]));
});

test('chat includes recalled graph triples as reference JSON and persists them without an extraction call', async t => {
  const { api, store, personaId, calls } = fixture(t, ['A grounded test reply.']);
  const first = save(api, personaId, 'Direct supporting record', { triples: [triple('Orion', 'connects', 'Vega')] });
  const second = save(api, personaId, 'Indirect supporting record', { triples: [triple('Vega', 'connects', 'Lyra')] });
  save(api, personaId, 'ARCHIVED_ONLY', { triples: [triple('Orion', 'connects', 'Archived object')], status: 'archived', pinned: true });
  save(api, addPersona(api), 'FOREIGN_ONLY', { triples: [triple('Orion', 'connects', 'Foreign object')], pinned: true });
  const conversationId = addConversation(api, personaId);
  const response = await api.sendMessage(conversationId, { content: 'Orion' });
  assert.equal(response.message.content, 'A grounded test reply.');
  assert.equal(calls.length, 1, 'chat must not secretly perform graph extraction');
  assert.equal(calls[0].url, 'http://model.invalid/v1/chat/completions');
  assert.equal(calls[0].init.headers.Authorization, undefined);
  const reference = calls[0].body.messages.find(message => message.role === 'system' && message.content.includes('以下 JSON'));
  assert.ok(reference);
  const context = JSON.parse(reference.content.slice(reference.content.indexOf('\n') + 1));
  assert.deepEqual(context.knowledge, []);
  assert.deepEqual(context.memories, [first, second].map(row => ({
    content: row.content, category: row.category, confidence: row.confidence, triples: row.triples,
  })));
  assert.ok(!JSON.stringify(calls[0].body).includes('ARCHIVED_ONLY'));
  assert.ok(!JSON.stringify(calls[0].body).includes('FOREIGN_ONLY'));
  assert.deepEqual(ids(response.recalledMemories), new Set([first.id, second.id]));
  assert.deepEqual(response.message.recalledMemories, response.recalledMemories);
  const saved = api.getConversation(conversationId).messages.at(-1);
  assert.deepEqual(saved.recalledMemories, response.recalledMemories);
  assert.ok(saved.recalledMemories.every(row => row.triples.length === 1));
  assert.equal(store.get('SELECT COUNT(*) AS n FROM memories WHERE accessCount=1').n, 2);
});

test('graph service validates required role and boolean archive filter without model requests', t => {
  const { api, personaId, calls } = fixture(t);
  for (const input of [{}, { personaId: '' }, { personaId: null }, { personaId: 123 }]) {
    assert.throws(() => api.getGraph(input), errorStatus(400));
    assert.throws(() => api.extractGraph(input), errorStatus(400));
  }
  assert.throws(() => api.getGraph({ personaId: 'missing' }), errorStatus(404));
  assert.throws(() => api.extractGraph({ personaId: 'missing' }), errorStatus(404));
  for (const includeArchived of ['true', 'false', 0, 1, null, undefined]) {
    assert.throws(() => api.getGraph({ personaId, includeArchived }), errorStatus(400));
  }
  assert.deepEqual(api.getGraph({ personaId, includeArchived: false }).nodes, []);
  assert.equal(calls.length, 0);
});

async function localApp(t, replies = []) {
  const mock = scriptedModel(...replies);
  const app = await startServer({ port: 0, dbPath: ':memory:', scheduler: false,
    modelOptions: { fetchImpl: mock.fetchImpl, apiKey: '', timeoutMs: 1000 } });
  t.after(() => app.close());
  app.api.updateSettings({ baseUrl: 'http://model.invalid/v1', model: 'test-model' });
  return { app, ...mock };
}

// Real HTTP is restricted to the loopback server; every model request is stubbed.
const request = (app, path, options = {}) => fetch(new URL(path, app.url), {
  ...options, headers: { Connection: 'close', ...options.headers }, signal: AbortSignal.timeout(5000),
});

test('HTTP graph GET requires a role, strictly validates archive filters and returns only the selected role', async t => {
  const { app, calls } = await localApp(t);
  const personaId = app.api.bootstrap().personas[0].id;
  const active = save(app.api, personaId, 'Active HTTP evidence', { triples: [triple()] });
  const archived = save(app.api, personaId, 'Archived HTTP evidence', { triples: [triple()], status: 'archived' });
  save(app.api, addPersona(app.api), 'Foreign HTTP evidence', { triples: [triple()] });
  for (const [path, status] of [
    ['/api/graph', 400], ['/api/graph?personaId=', 400], ['/api/graph?personaId=missing', 404],
    ...['', '1', '0', 'TRUE', 'yes', 'null'].map(value => [`/api/graph?personaId=${personaId}&includeArchived=${value}`, 400]),
  ]) {
    const response = await request(app, path);
    assert.equal(response.status, status, path);
    assert.equal(typeof (await response.json()).error, 'string');
  }
  for (const suffix of ['', '&includeArchived=false']) {
    const response = await request(app, `/api/graph?personaId=${personaId}${suffix}`);
    assert.equal(response.status, 200);
    const view = await response.json();
    assert.equal(view.personaId, personaId);
    assert.deepEqual(new Set(memoryNodes(view).map(row => row.memoryId)), new Set([active.id]));
    assert.deepEqual(relations(view)[0].memoryIds, [active.id]);
    assertGraphIntegrity(view);
  }
  const response = await request(app, `/api/graph?personaId=${personaId}&includeArchived=true`);
  assert.equal(response.status, 200);
  const view = await response.json();
  assert.deepEqual(new Set(memoryNodes(view).map(row => row.memoryId)), new Set([active.id, archived.id]));
  assertGraphIntegrity(view);
  assert.equal(calls.length, 0);
});

test('HTTP extraction uses submitted persona, skips archived rows and replays empty results without another call', async t => {
  const { app, calls } = await localApp(t, [extractionReply()]);
  const personaId = app.api.bootstrap().personas[0].id;
  const pending = save(app.api, personaId, 'HTTP pending source');
  const archived = save(app.api, personaId, 'HTTP archived pending', { status: 'archived' });
  const foreign = save(app.api, addPersona(app.api), 'HTTP foreign pending');
  const post = json => request(app, '/api/graph/extract', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(json) });
  for (const [input, status] of [[{}, 400], [{ personaId: 'missing' }, 404]]) {
    const response = await post(input);
    assert.equal(response.status, status);
    await response.json();
  }
  assert.equal(calls.length, 0);
  const response = await post({ personaId });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { processed: 1, skipped: 0, remaining: 0, relations: 0 });
  assert.deepEqual(batchFor(calls[0]), [{ id: pending.id, content: pending.content }]);
  const replay = await post({ personaId });
  assert.equal(replay.status, 200);
  assert.deepEqual(await replay.json(), { processed: 0, skipped: 0, remaining: 0, relations: 0 });
  assert.equal(memoryRow(app.api, archived.id).graphIndexed, false);
  assert.equal(memoryRow(app.api, foreign.id).graphIndexed, false);
  assert.equal(calls.length, 1);
});

test('HTTP serves the exact local graph vendor module with valid GET and HEAD responses', async t => {
  const { app, calls } = await localApp(t);
  const expected = await readFile(fileURLToPath(new URL('../node_modules/cytoscape/dist/cytoscape.esm.min.mjs', import.meta.url)));
  const response = await request(app, '/vendor/cytoscape.esm.min.mjs');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/javascript/);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(Number(response.headers.get('content-length')), expected.length);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), expected);
  const head = await request(app, '/vendor/cytoscape.esm.min.mjs', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(Number(head.headers.get('content-length')), expected.length);
  assert.equal(await head.text(), '');
  for (const path of ['/memory-graph.js', '/memory-graph.css']) {
    const asset = await request(app, path);
    assert.equal(asset.status, 200);
    assert.ok((await asset.text()).length > 0);
  }
  const missing = await request(app, '/vendor/unknown.mjs');
  assert.equal(missing.status, 404);
  await missing.json();
  assert.equal(calls.length, 0);
});
