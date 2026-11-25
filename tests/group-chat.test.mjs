import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, id, now } from '../lib/store.mjs';
import { extractMentionedPersonaIds, projectGroupHistoryForSpeaker, sanitizeGroupReply } from '../lib/group-director.mjs';
import { readEvents } from '../public/streaming.js';
import { startOfflineServer } from './ui-fixture.mjs';
import { fixture, addPersona, addMessages, errorStatus, TIME, iso } from './helpers.mjs';

test('SQLite migration v6 adds group chat schema columns, conversation_members table, and cascades cleanly', () => {
  const store = createStore(':memory:');
  try {
    assert.ok(store.schemaVersion() >= 6);
    const convCols = store.db.prepare('PRAGMA table_info(conversations)').all().map(c => c.name);
    for (const col of ['kind', 'scenePrompt', 'maxAutoTurns']) {
      assert.ok(convCols.includes(col), `conversations missing ${col}`);
    }
    const msgCols = store.db.prepare('PRAGMA table_info(messages)').all().map(c => c.name);
    for (const col of ['speakerPersonaId', 'directorNote']) {
      assert.ok(msgCols.includes(col), `messages missing ${col}`);
    }
    const memberCols = store.db.prepare('PRAGMA table_info(conversation_members)').all().map(c => c.name);
    assert.deepEqual(memberCols, ['conversationId', 'personaId', 'sortOrder', 'joinedAt']);

    const p1 = store.get('SELECT id FROM personas LIMIT 1').id;
    const p2 = id();
    store.run('INSERT INTO personas (id,name,description,systemPrompt,tone,greeting,createdAt) VALUES (?,?,?,?,?,?,?)', p2, '沈清秋', '测试简介', '严格简洁。', '沉稳', '你好', now());
    const convId = id();
    const stamp = now();
    store.run(
      'INSERT INTO conversations (id,personaId,title,kind,scenePrompt,maxAutoTurns,summarizedAt,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?,?)',
      convId, p1, '茶馆小聚', 'group', '雨夜茶馆', 3, stamp, stamp, stamp
    );
    store.run('INSERT INTO conversation_members VALUES (?,?,?,?)', convId, p1, 0, stamp);
    store.run('INSERT INTO conversation_members VALUES (?,?,?,?)', convId, p2, 1, stamp);
    assert.equal(store.all('SELECT * FROM conversation_members WHERE conversationId=?', convId).length, 2);

    store.run('DELETE FROM conversations WHERE id=?', convId);
    assert.equal(store.all('SELECT * FROM conversation_members WHERE conversationId=?', convId).length, 0);
  } finally {
    store.close();
  }
});

test('memory summarization and automatic autonomy skip group conversations to prevent cross-pollination', async t => {
  const { store, api, personaId, calls } = fixture(t, []);
  const p2 = addPersona(api, '林晚');
  const groupId = id();
  const stamp = iso(TIME);
  store.run(
    'INSERT INTO conversations (id,personaId,title,kind,scenePrompt,maxAutoTurns,summarizedAt,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?,?)',
    groupId, personaId, '剧本杀测试群', 'group', '雨夜古宅情景剧', 3, stamp, stamp, stamp
  );
  store.run('INSERT INTO conversation_members VALUES (?,?,?,?)', groupId, personaId, 0, stamp);
  store.run('INSERT INTO conversation_members VALUES (?,?,?,?)', groupId, p2, 1, stamp);
  addMessages(store, groupId, [
    '场景设定：我们都在古老宅院里躲雨。',
    '这里好安静啊，只听见檐外雨声。',
    '刚才客厅里的铜镜好像动了一下。'
  ]);

  const singleRes = await api.memory.summarizeConversation(groupId);
  assert.deepEqual(singleRes, { created: 0, processed: 0 });
  const personaRes = await api.memory.summarizePersona(personaId);
  assert.deepEqual(personaRes, { created: 0, processed: 0 });

  store.saveSettings({ memoryMessageThreshold: 2 });
  await api.memory.automatic();
  assert.equal(calls.length, 0, 'memory summarization must never send group messages to model');

  api.autonomy.update({ enabled: true, paused: false, idleMinutes: 10, quietStart: '00:00', quietEnd: '00:00' });
  const autoRes = await api.autonomy.evaluate(TIME + 120 * 60000);
  assert.deepEqual(autoRes, { skipped: 'no_conversation' });
  assert.equal(calls.length, 0, 'autonomy must ignore group conversations');
});

test('extractMentionedPersonaIds, projectGroupHistoryForSpeaker, and sanitizeGroupReply prevent cross-talk', () => {
  const members = [
    { id: 'p1', name: '望舒' },
    { id: 'p2', name: '望舒月' },
    { id: 'p3', name: '林晚' }
  ];
  assert.deepEqual(
    extractMentionedPersonaIds('@林晚 和 @望舒月 先说说，@林晚 再补充', members),
    ['p3', 'p2']
  );
  assert.deepEqual(extractMentionedPersonaIds('请 @望舒 看一下', members), ['p1']);

  const personaMap = new Map(members.map(m => [m.id, m]));
  const projected = projectGroupHistoryForSpeaker({
    speaker: { id: 'p1', name: '望舒' },
    personaMap,
    history: [
      { role: 'user', origin: 'narrator', content: '夜雨落进庭院。' },
      { role: 'user', origin: 'user', content: '大家今天聊什么？' },
      { role: 'assistant', speakerPersonaId: 'p3', content: '我想喝热茶。' },
      { role: 'assistant', speakerPersonaId: 'p1', content: '我刚烧好热水。' },
      { role: 'assistant', speakerPersonaId: 'p3', content: '谢谢望舒！' }
    ]
  });
  assert.deepEqual(projected.map(m => m.role), ['user', 'assistant', 'user']);
  assert.match(projected[0].content, /\[舞台旁白 \/ 场景变化\]：夜雨落进庭院/);
  assert.match(projected[0].content, /\[用户\]：大家今天聊什么/);
  assert.match(projected[0].content, /\[同场角色·林晚\]：我想喝热茶/);
  assert.equal(projected[1].content, '我刚烧好热水。');
  assert.match(projected[2].content, /\[同场角色·林晚\]：谢谢望舒/);

  assert.equal(
    sanitizeGroupReply('望舒：今夜月色不错。\n林晚：是啊我也觉得！', '望舒', ['望舒月', '林晚']),
    '今夜月色不错。'
  );
});

test('createConversation & updateConversation validate group members and preserve 1v1 defaults', t => {
  const { api, personaId } = fixture(t, []);
  const p2 = addPersona(api, '沈清秋');
  const p3 = addPersona(api, '林晚');

  assert.throws(
    () => api.createConversation({ kind: 'group', personaIds: [personaId] }),
    errorStatus(400, /至少需要选择 2 位角色/)
  );

  const created = api.createConversation({
    kind: 'group',
    title: '雅集群聊',
    personaIds: [personaId, p2, personaId],
    scenePrompt: '竹林听雨',
    maxAutoTurns: 4
  }).conversation;
  assert.equal(created.kind, 'group');
  assert.equal(created.title, '雅集群聊');
  assert.equal(created.scenePrompt, '竹林听雨');
  assert.equal(created.maxAutoTurns, 4);
  assert.deepEqual(created.memberIds, [personaId, p2]);

  const updated = api.updateConversation(created.id, {
    title: '秋夜小聚',
    personaIds: [p2, p3],
    maxAutoTurns: 2
  }).conversation;
  assert.equal(updated.title, '秋夜小聚');
  assert.equal(updated.personaId, p2);
  assert.equal(updated.maxAutoTurns, 2);
  assert.deepEqual(updated.memberIds, [p2, p3]);
  assert.ok(api.bootstrap().conversations.some(c => c.id === created.id && c.memberIds.length === 2));
});

test('group sendMessage supports 0-reply silence, @mention relay, isolated per-speaker memory, narrator, continueScene, and partial abort', async t => {
  const queue = [];
  const { api, personaId, calls } = fixture(t, Array.from({ length: 20 }, () => call => {
    const next = queue.shift();
    assert.ok(next, `Unexpected model call #${calls.length}: ${call.body.messages[0]?.content?.slice(0, 60)}`);
    return typeof next === 'function' ? next(call) : new Response(JSON.stringify({ choices: [{ message: { content: typeof next === 'string' ? next : JSON.stringify(next) } }] }), { headers: { 'Content-Type': 'application/json' } });
  }));
  const p2 = addPersona(api, '林晚');
  api.savePersona({ name: '林晚', systemPrompt: '性格活泼直爽。', tone: '轻快' }, p2);
  api.saveMemory({ personaId, content: '望舒最喜欢研究茶道', category: 'preference', importance: 0.9, confidence: 1 });
  api.saveMemory({ personaId: p2, content: '林晚偷偷收藏着甜点秘方', category: 'fact', importance: 0.9, confidence: 1 });

  const conv = api.createConversation({
    kind: 'group',
    title: '茶室情景剧',
    personaIds: [personaId, p2],
    scenePrompt: '春雨细落茶室',
    maxAutoTurns: 3
  }).conversation;

  // 1) Silence turn (0 speakers)
  queue.push({ shouldReply: false, speakerPersonaId: null, intent: 'silence', cue: '', reason: '用户表示无需插话' });
  const silentEvents = [];
  const silentRes = await api.sendMessage(conv.id, { content: '我先记个备忘，大家不用回' }, { onEvent: e => silentEvents.push(e) });
  assert.equal(silentRes.messages.length, 0);
  assert.equal(silentRes.silenceReason, '用户表示无需插话');
  assert.ok(silentEvents.some(e => e.type === 'user_message'));

  // 2) @mention 林晚 (skips director call on turn 0) -> 林晚 speaks -> director picks 望舒 -> director stops
  calls.length = 0;
  queue.push(
    '林晚：当然记得，等会儿端出来配茶！',
    { shouldReply: true, speakerPersonaId: personaId, intent: 'chime_in', cue: '回应林晚并泡茶', reason: '茶道话题适合望舒接话' },
    '好茶配甜点正好。\n林晚：我也赞成！',
    { shouldReply: false, speakerPersonaId: null, intent: 'silence', cue: '', reason: '收尾合适' }
  );
  const relayEvents = [];
  const relayRes = await api.sendMessage(conv.id, { content: '@林晚 今天茶室带甜点了吗？记得关于甜点秘方或茶道。' }, { onEvent: e => relayEvents.push(e) });
  assert.equal(calls.length, 4);
  assert.match(calls[0].body.messages[2].content, /甜点秘方/);
  assert.doesNotMatch(calls[0].body.messages[2].content, /茶道/, 'speaker 1 must never see another persona memory');
  assert.match(calls[2].body.messages[2].content, /茶道/);
  assert.doesNotMatch(calls[2].body.messages[2].content, /甜点秘方/, 'speaker 2 must never see another persona memory');
  assert.equal(relayRes.messages.length, 2);
  assert.equal(relayRes.messages[0].speakerPersonaId, p2);
  assert.equal(relayRes.messages[0].content, '当然记得，等会儿端出来配茶！');
  assert.equal(relayRes.messages[1].speakerPersonaId, personaId);
  assert.equal(relayRes.messages[1].content, '好茶配甜点正好。');
  assert.equal(relayRes.messages[1].directorNote, '茶道话题适合望舒接话');
  assert.deepEqual(
    relayEvents.filter(e => e.type === 'speaker_start' || e.type === 'speaker_done').map(e => `${e.type}:${e.personaId || e.message.speakerPersonaId}`),
    [`speaker_start:${p2}`, `speaker_done:${p2}`, `speaker_start:${personaId}`, `speaker_done:${personaId}`]
  );

  // 3) Narrator origin + continueScene + Abort during 2nd speaker preserves 1st speaker in DB
  queue.push(
    { shouldReply: true, speakerPersonaId: p2, intent: 'answer', cue: '看雨', reason: '对旁白做出反应' },
    '窗外雨声忽然大了些。',
    { shouldReply: false, speakerPersonaId: null, intent: 'silence', cue: '', reason: '自然收尾' }
  );
  const narratorRes = await api.sendMessage(conv.id, { content: '檐外骤雨噼啪作响。', origin: 'narrator' });
  assert.equal(narratorRes.userMessage.origin, 'narrator');
  assert.equal(narratorRes.messages.length, 1);

  const ac = new AbortController();
  const prevCount = api.getConversation(conv.id).messages.length;
  queue.push(
    '望舒：我先把窗户关严些。（第一棒完成）',
    () => {
      ac.abort();
      return { shouldReply: false, speakerPersonaId: null, intent: 'silence', reason: '' };
    }
  );
  await assert.rejects(
    () => api.sendMessage(conv.id, { continueScene: true, targetPersonaId: personaId }, { signal: ac.signal }),
    errorStatus(499)
  );
  const afterAbort = api.getConversation(conv.id).messages;
  assert.equal(afterAbort.length, prevCount + 1, 'completed speaker 1 must remain saved when aborted on speaker 2');
  assert.equal(afterAbort.at(-1).speakerPersonaId, personaId);
});

test('HTTP PUT /api/conversations/:id and SSE multi-speaker streaming work end-to-end', async t => {
  const server = await startOfflineServer();
  t.after(() => server.close());

  const { persona: p2 } = await (await fetch(`${server.url}/api/personas`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '沈清秋', systemPrompt: '冷静克制。', tone: '清雅', avatar: '🍵' })
  })).json();
  assert.equal(p2.avatar, '🍵');
  const boot = await (await fetch(`${server.url}/api/bootstrap`)).json();
  const p1Id = boot.personas[0].id;

  const { conversation: created } = await (await fetch(`${server.url}/api/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'group', title: '初始群聊', personaIds: [p1Id, p2.id], scenePrompt: '春园喝茶', maxAutoTurns: 2 })
  })).json();
  assert.equal(created.kind, 'group');
  assert.deepEqual(created.memberIds, [p1Id, p2.id]);

  const { conversation: updated } = await (await fetch(`${server.url}/api/conversations/${created.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: '亭中夜话', scenePrompt: '秋庭赏月', maxAutoTurns: 3 })
  })).json();
  assert.equal(updated.title, '亭中夜话');
  assert.equal(updated.scenePrompt, '秋庭赏月');

  const streamRes = await fetch(`${server.url}/api/conversations/${created.id}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({ content: '互动演示：大家聊聊今晚的月色。' })
  });
  assert.equal(streamRes.status, 200);

  const events = [];
  for await (const frame of readEvents(streamRes.body)) {
    events.push({ event: frame.event, data: JSON.parse(frame.data) });
  }
  const eventTypes = events.map(e => e.event);
  assert.ok(eventTypes.includes('user_message'));
  const speakerStarts = events.filter(e => e.event === 'speaker_start');
  assert.equal(speakerStarts.length, 2);
  assert.ok(speakerStarts.some(e => e.data.personaId === p2.id && e.data.personaAvatar === '🍵'));
  assert.equal(eventTypes.filter(t => t === 'speaker_done').length, 2);
  assert.equal(events.at(-1).event, 'done');
  assert.equal(events.at(-1).data.messages.length, 2);
  assert.notEqual(events.at(-1).data.messages[0].speakerPersonaId, events.at(-1).data.messages[1].speakerPersonaId);
});

test('SQLite v7 persona avatar supports local base64 PNG/emoji, clears cleanly, and rejects SVG or external URLs', t => {
  const { store, api } = fixture(t, []);
  assert.ok(store.schemaVersion() >= 7);
  const validPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

  const { persona: created } = api.savePersona({
    name: '画师阿墨',
    systemPrompt: '你是一位温和细致的画师。',
    avatar: validPng
  });
  assert.equal(created.avatar, validPng);
  assert.equal(api.bootstrap().personas.find(p => p.id === created.id)?.avatar, validPng);

  const { persona: updatedEmoji } = api.savePersona({ avatar: '🌙' }, created.id);
  assert.equal(updatedEmoji.avatar, '🌙');

  const { persona: cleared } = api.savePersona({ avatar: '' }, created.id);
  assert.equal(cleared.avatar, '');

  assert.throws(
    () => api.savePersona({ avatar: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' }, created.id),
    errorStatus(400)
  );
  assert.throws(
    () => api.savePersona({ avatar: 'https://example.com/a.png' }, created.id),
    errorStatus(400)
  );
  assert.throws(
    () => api.savePersona({ avatar: '<b>bad</b>' }, created.id),
    errorStatus(400)
  );
  assert.throws(
    () => api.savePersona({ avatar: '超过八个字符的文字头像' }, created.id),
    errorStatus(400)
  );

  const { settings: s1 } = api.updateSettings({ userAvatar: '🧑' });
  assert.equal(s1.userAvatar, '🧑');
  const { settings: s2 } = api.updateSettings({ userAvatar: validPng });
  assert.equal(s2.userAvatar, validPng);
  assert.equal(api.bootstrap().settings.userAvatar, validPng);
  const { settings: s3 } = api.updateSettings({ userAvatar: '' });
  assert.equal(s3.userAvatar, '');
  assert.throws(() => api.updateSettings({ userAvatar: 'https://example.com/u.png' }), errorStatus(400));
});

