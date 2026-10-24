import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, base64, errorStatus, addPersona, addConversation, addMessages, deferred, modelResponse } from './helpers.mjs';

for (const [name, response] of [['transport failure', new TypeError('offline')], ['blank reply', '  '], ['provider error', new Response('private', { status: 500 })]]) {
  test(`chat ${name} writes no messages and touches no recalled memories`, async t => {
    const { api, store, personaId } = fixture(t, [response, 'retry worked']);
    const memory = api.saveMemory({ personaId, content: 'jasmine tea' }).memory;
    const conversationId = addConversation(api, personaId);
    const before = api.getConversation(conversationId);
    await assert.rejects(api.sendMessage(conversationId, { content: 'jasmine tea' }), errorStatus(502));
    assert.deepEqual(api.getConversation(conversationId), before);
    const untouched = store.get('SELECT * FROM memories WHERE id=?', memory.id);
    assert.equal(untouched.accessCount, 0);
    assert.equal(untouched.lastAccessedAt, null);
    assert.equal(untouched.mentions, 1);
    const retry = await api.sendMessage(conversationId, { content: 'jasmine tea' });
    assert.equal(retry.message.content, 'retry worked');
    assert.equal(api.getConversation(conversationId).messages.length, 2);
    assert.equal(store.get('SELECT accessCount FROM memories WHERE id=?', memory.id).accessCount, 1);
  });
}

test('successful chat persists paired messages, citations, selected memories and ordered history', async t => {
  const { api, store, personaId, calls } = fixture(t, ['茉莉花茶有花香。[1]', '第二次回答。[1]']);
  const other = addPersona(api);
  const own = api.saveMemory({ personaId, content: '用户喜欢 jasmine 茉莉花茶' }).memory;
  const foreign = api.saveMemory({ personaId: other, content: '另一个角色喜欢 jasmine 茉莉花茶' }).memory;
  const unused = api.saveMemory({ personaId, content: '用户喜欢足球' }).memory;
  const { document } = await api.importDocument({ name: 'tea.txt', data: base64('jasmine 茉莉花茶有花香。') });
  await api.importDocument({ name: 'unrelated.md', data: base64('Football training schedule') });
  const conversationId = addConversation(api, personaId);
  const unrelatedConversation = addConversation(api, other);
  addMessages(store, unrelatedConversation, ['DO_NOT_INCLUDE_OTHER_ROLE_HISTORY', 'private reply']);
  const result = await api.sendMessage(conversationId, { content: '  jasmine 茉莉花茶如何？  ' });
  assert.equal(result.userMessage.content, 'jasmine 茉莉花茶如何？');
  assert.equal(result.userMessage.role, 'user');
  assert.equal(result.message.role, 'assistant');
  assert.equal(result.message.content, '茉莉花茶有花香。[1]');
  assert.ok(result.userMessage.id < result.message.id);
  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0].documentId, document.id);
  assert.equal(result.sources[0].name, 'tea.txt');
  assert.equal(result.sources[0].index, 1);
  assert.ok(result.sources[0].score > 0);
  assert.deepEqual(result.message.sources, result.sources);
  assert.deepEqual(result.message.recalledMemories, result.recalledMemories);
  assert.deepEqual(result.userMessage.sources, []);
  assert.deepEqual(result.recalledMemories.map(row => row.id), [own.id]);
  const reference = JSON.parse(calls[0].body.messages[2].content.split('\n').slice(1).join('\n'));
  assert.deepEqual(reference.knowledge, [{ citation: 1, name: 'tea.txt', chunk: 1, content: 'jasmine 茉莉花茶有花香。' }]);
  assert.equal(reference.memories[0].content, own.content);
  assert.ok(!JSON.stringify(calls).includes('DO_NOT_INCLUDE_OTHER_ROLE_HISTORY'));
  assert.equal(calls[0].body.messages.at(-1).role, 'user');
  const second = await api.sendMessage(conversationId, { content: '再谈 jasmine 茉莉花茶' });
  assert.deepEqual(calls[1].body.messages.slice(3), [
    { role: 'user', content: result.userMessage.content }, { role: 'assistant', content: result.message.content },
    { role: 'user', content: '再谈 jasmine 茉莉花茶' },
  ]);
  const saved = api.getConversation(conversationId);
  assert.deepEqual(saved.messages.map(row => row.role), ['user', 'assistant', 'user', 'assistant']);
  assert.equal(saved.conversation.title, result.userMessage.content);
  assert.deepEqual(saved.messages.at(-1), second.message);
  assert.equal(store.get('SELECT accessCount FROM memories WHERE id=?', own.id).accessCount, 2);
  for (const row of [foreign, unused]) assert.equal(store.get('SELECT accessCount FROM memories WHERE id=?', row.id).accessCount, 0);
});

test('chat without matching knowledge does not fabricate citation metadata', async t => {
  const { api, personaId } = fixture(t, ['No source available.']);
  const conversationId = addConversation(api, personaId, 'Custom title');
  const result = await api.sendMessage(conversationId, { content: 'hello' });
  assert.deepEqual(result.sources, []);
  assert.deepEqual(result.message.sources, []);
  assert.deepEqual(result.recalledMemories, []);
  assert.equal(api.getConversation(conversationId).conversation.title, 'Custom title');
});

test('concurrent chat rejects same conversation but permits a different conversation', async t => {
  const gate = deferred();
  const { api, personaId, calls } = fixture(t, [() => gate.promise, 'other reply', 'next reply']);
  const firstId = addConversation(api, personaId);
  const secondId = addConversation(api, personaId);
  const pending = api.sendMessage(firstId, { content: 'first' });
  try {
    await assert.rejects(api.sendMessage(firstId, { content: 'overlap' }), errorStatus(409));
    assert.equal(api.getConversation(firstId).messages.length, 0);
    assert.equal(calls.length, 1);
    assert.equal((await api.sendMessage(secondId, { content: 'independent' })).message.content, 'other reply');
  } finally { gate.resolve(modelResponse('first reply')); }
  await pending;
  assert.equal((await api.sendMessage(firstId, { content: 'after lock release' })).message.content, 'next reply');
  assert.equal(api.getConversation(firstId).messages.length, 4);
});

test('chat history is limited to the latest 24 messages without mixing conversations', async t => {
  const { api, store, personaId, calls } = fixture(t, ['ok']);
  const conversationId = addConversation(api, personaId);
  addMessages(store, conversationId, Array.from({ length: 28 }, (_, i) => `history ${i}`));
  await api.sendMessage(conversationId, { content: 'current' });
  const history = calls[0].body.messages.slice(3, -1);
  assert.equal(history.length, 24);
  assert.equal(history[0].content, 'history 4');
  assert.equal(history[0].role, 'user');
  assert.equal(history.at(-1).content, 'history 27');
});

test('chat history respects 24000-character budget and removes orphan assistant prefix', async t => {
  const { api, store, personaId, calls } = fixture(t, ['ok']);
  const conversationId = addConversation(api, personaId);
  addMessages(store, conversationId, Array.from({ length: 4 }, (_, i) => `${i}${'x'.repeat(7999)}`));
  await api.sendMessage(conversationId, { content: 'current' });
  const history = calls[0].body.messages.slice(3, -1);
  assert.equal(history.length, 2);
  assert.deepEqual(history.map(row => row.role), ['user', 'assistant']);
  assert.equal(history[0].content[0], '2');
  assert.ok(history.reduce((n, row) => n + row.content.length, 0) <= 24000);
});

test('chat input errors reject before model calls and leave data unchanged', async t => {
  const { api, personaId, calls } = fixture(t);
  const conversationId = addConversation(api, personaId);
  for (const content of ['', '  ', 'x'.repeat(8001), null, 123]) {
    await assert.rejects(api.sendMessage(conversationId, { content }), errorStatus(400));
  }
  await assert.rejects(api.sendMessage('missing', { content: 'hello' }), errorStatus(404));
  assert.equal(calls.length, 0);
  assert.equal(api.getConversation(conversationId).messages.length, 0);
});

const goodAnalysis = () => ({ overview: '资料有限，可能表达简练。', traits: ['可能重视清晰'], speakingStyle: ['短句'],
  boundaries: ['未观察到明确边界'], evidence: ['小林：“先列清单。”'], personaPrompt: '使用简短清晰的表达，不冒充真实本人。' });

test('analysis returns validated fields only, targets selected speaker and does not create a persona', async t => {
  const output = { ...goodAnalysis(), unexpected: 'ignore this' };
  const { api, calls } = fixture(t, [`\`\`\`json\n${JSON.stringify(output)}\n\`\`\``]);
  const before = api.bootstrap();
  const result = await api.analyze({ target: ' 小林 ', text: ' 小林：先列清单。\n其他人：直接开工。 ' });
  assert.deepEqual(result.analysis, goodAnalysis());
  assert.deepEqual(JSON.parse(calls[0].body.messages[1].content), { target: '小林', transcript: '小林：先列清单。\n其他人：直接开工。' });
  assert.deepEqual(api.bootstrap(), before);
});

const invalidAnalysis = [
  ['invalid JSON', 'bad json'], ['null', 'null'], ['missing fields', {}], ['non-text overview', { ...goodAnalysis(), overview: 1 }],
  ['overlong overview', { ...goodAnalysis(), overview: 'x'.repeat(5001) }],
  ['non-text persona prompt', { ...goodAnalysis(), personaPrompt: null }],
  ['overlong persona prompt', { ...goodAnalysis(), personaPrompt: 'x'.repeat(8001) }],
  ...['traits', 'speakingStyle', 'boundaries', 'evidence'].flatMap(key => [
    [`${key} not array`, { ...goodAnalysis(), [key]: 'invalid' }],
    [`${key} too many entries`, { ...goodAnalysis(), [key]: Array(9).fill('entry') }],
    [`${key} non-string entry`, { ...goodAnalysis(), [key]: [42] }],
    [`${key} overlong entry`, { ...goodAnalysis(), [key]: ['x'.repeat(2001)] }],
  ]),
];
for (const [name, output] of invalidAnalysis) {
  test(`analysis rejects ${name} with no persistence`, async t => {
    const { api } = fixture(t, [output]);
    const before = api.bootstrap();
    await assert.rejects(api.analyze({ target: '小林', text: '小林：你好' }), errorStatus(502));
    assert.deepEqual(api.bootstrap(), before);
  });
}

test('analysis input boundaries are enforced before model requests', async t => {
  const { api, calls } = fixture(t);
  for (const input of [{ text: '', target: 'name' }, { text: 'text', target: ' ' }, { text: 'x'.repeat(60001), target: 'name' },
    { text: 'text', target: 'x'.repeat(121) }, { text: [], target: 'name' }]) {
    await assert.rejects(api.analyze(input), errorStatus(400));
  }
  assert.equal(calls.length, 0);
});

test('manual memory fields reject invalid bounds and updates remain atomic', t => {
  const { api, personaId } = fixture(t);
  const memory = api.saveMemory({ personaId, content: 'original' }).memory;
  const invalid = [{ importance: -0.1 }, { importance: 1.1 }, { importance: '0.5' }, { confidence: NaN }, { confidence: 2 },
    { confidence: null }, { pinned: 1 }, { category: 'invalid' }, { status: 'deleted' }, { content: ' ' }, { content: 'x'.repeat(1001) }];
  for (const input of invalid) {
    assert.throws(() => api.saveMemory(input, memory.id), errorStatus(400));
    assert.equal(api.memory.list(personaId)[0].content, 'original');
  }
  assert.throws(() => api.saveMemory({ personaId: 'missing', content: 'hello' }), errorStatus(404));
  assert.throws(() => api.saveMemory({ content: 'hello' }, 'missing'), errorStatus(404));
  const edge = api.saveMemory({ personaId, content: 'edge', importance: 0, confidence: 1 }).memory;
  assert.equal(edge.importance, 0);
  assert.equal(edge.confidence, 1);
});
