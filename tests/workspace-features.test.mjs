import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startServer } from '../server.mjs';
import { createStore } from '../lib/store.mjs';
import { createService } from '../lib/service.mjs';
import { assembleGroupTurnPrompt, decideNextSpeaker } from '../lib/group-director.mjs';
import { isForbiddenIpAddress, clipPublicUrl } from '../lib/web-clipper.mjs';
import { scriptedModel } from './helpers.mjs';

async function localApp(t, replies = [], extraOptions = {}) {
  const mock = scriptedModel(...replies);
  const app = await startServer({
    port: 0,
    dbPath: ':memory:',
    scheduler: false,
    modelOptions: {
      fetchImpl: mock.fetchImpl,
      apiKey: '',
      timeoutMs: 1000,
      dnsLookupImpl: async hostname => ['localhost', '127.0.0.1'].includes(hostname)
        ? [{ address: '127.0.0.1', family: 4 }]
        : [{ address: '93.184.216.34', family: 4 }],
      webFetchImpl: async () => new Response(
        '<!doctype html><html><head><title>园林笔记</title><script>alert(1)</script></head><body><h1>太湖石与曲廊</h1><p>借景生情，咫尺山林。</p></body></html>',
        { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } }
      ),
      ...extraOptions.modelOptions
    }
  });
  t.after(() => app.close());
  app.api.updateSettings({ model: 'test-model', baseUrl: 'http://model.invalid/v1', criticEnabled: false });
  return { app, ...mock };
}

function request(app, path, { method = 'GET', json, headers = {} } = {}) {
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
        ...(body === undefined ? {} : { 'Content-Length': Buffer.byteLength(body) }),
        ...headers
      }
    }, res => {
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

test('Schema v8 initializes relationships, bookmarks, journals, and FTS search tables', t => {
  const store = createStore(':memory:');
  t.after(() => store.close());
  assert.equal(store.schemaVersion(), 10);
  const tables = store.all("SELECT name FROM sqlite_master WHERE type='table'").map(r => r.name);
  assert.ok(tables.includes('persona_relationships'));
  assert.ok(tables.includes('message_bookmarks'));
  assert.ok(tables.includes('daily_journals'));
  assert.ok(tables.includes('messages_fts'));
});

test('Slice 1: persona relationships CRUD and prompt/director injection', async t => {
  const mock = scriptedModel();
  const store = createStore(':memory:');
  t.after(() => store.close());
  const api = createService(store, { fetchImpl: mock.fetchImpl, apiKey: '', timeoutMs: 1000 });
  const a = api.savePersona({ name: '沈清秋', description: '温和书生', systemPrompt: '我是沈清秋' }).persona;
  const b = api.savePersona({ name: '林晚照', description: '飒爽侠女', systemPrompt: '我是林晚照' }).persona;

  const saved = api.saveRelationship({
    personaAId: b.id,
    personaBId: a.id,
    sharedLabel: '旧日同门兼茶友',
    aToBNote: '觉得他太客套但人很可靠',
    bToANote: '欣赏她的爽朗直接'
  });
  assert.equal(saved.relationship.sharedLabel, '旧日同门兼茶友');
  assert.equal(api.bootstrap().relationships.length, 1);

  const relPrompt = assembleGroupTurnPrompt({
    conversation: { id: 'c1', title: '茶室', scenePrompt: '春雨初晴' },
    speaker: a,
    members: [a, b],
    relationships: [saved.relationship],
    recentMessages: []
  });
  assert.ok(relPrompt[0].content.includes('旧日同门兼茶友'));
  assert.ok(relPrompt[0].content.includes('欣赏她的爽朗直接'));

  let directorSawRel = false;
  const decision = await decideNextSpeaker({
    model: {
      complete: async messages => {
        directorSawRel = messages.some(m => m.content.includes('旧日同门兼茶友'));
        return JSON.stringify({ shouldReply: true, speakerPersonaId: b.id, intent: 'answer', cue: '回应林晚照', reason: '茶友互相打趣' });
      }
    },
    conversation: { id: 'c1', title: '茶室', scenePrompt: '' },
    members: [a, b],
    relationships: [saved.relationship],
    recentMessages: [{ role: 'user', content: '@林晚照 这茶怎么样？', createdAt: new Date().toISOString() }],
    stepIndex: 0,
    maxSteps: 2
  });
  assert.equal(directorSawRel, true);
  assert.equal(decision.speakerPersonaId, b.id);

  const deleted = api.deleteRelationship(saved.relationship.id);
  assert.equal(deleted.ok, true);
  assert.equal(api.bootstrap().relationships.length, 0);
});

test('Slice 1 HTTP: relationships, conversation branching (1v1 & group), and global Chinese search', async t => {
  const { app } = await localApp(t, [
    '雨夜茶馆的灯光正好。',
    '二号分岔口回复。',
    '画卷已经带在身边了。',
    '{"shouldReply":false,"speakerPersonaId":null,"intent":"silence","cue":"","reason":"自然收尾"}'
  ]);
  const bootstrap = await request(app, '/api/bootstrap');
  const firstPersona = bootstrap.data.personas[0];
  const second = (await request(app, '/api/personas', {
    method: 'POST',
    json: { name: '顾长安', description: '画师', systemPrompt: '你是画师顾长安。' }
  })).data.persona;

  const relRes = await request(app, '/api/relationships', {
    method: 'PUT',
    json: { personaAId: firstPersona.id, personaBId: second.id, sharedLabel: '画友' }
  });
  assert.equal(relRes.status, 200);
  assert.equal(relRes.data.relationship.sharedLabel, '画友');

  const delRel = await request(app, `/api/relationships/${relRes.data.relationship.id}`, { method: 'DELETE', json: {} });
  assert.equal(delRel.status, 200);

  const conv = (await request(app, '/api/conversations', {
    method: 'POST',
    json: { personaId: firstPersona.id }
  })).data.conversation;
  await request(app, `/api/conversations/${conv.id}/messages`, {
    method: 'POST',
    json: { content: '今晚在湖心亭喝茶看云怎么样？' }
  });
  await request(app, `/api/conversations/${conv.id}/messages`, {
    method: 'POST',
    json: { content: '顺便再听一首古琴曲。' }
  });
  const detail = await request(app, `/api/conversations/${conv.id}`);
  assert.equal(detail.data.messages.length, 4);
  const branchPointId = detail.data.messages[1].id;

  const branched = await request(app, `/api/conversations/${conv.id}/branch`, {
    method: 'POST',
    json: { upToMessageId: branchPointId, title: '湖心亭支线' }
  });
  assert.equal(branched.status, 200);
  assert.equal(branched.data.conversation.parentConversationId, conv.id);
  assert.equal(branched.data.conversation.branchedFromMessageId, branchPointId);
  assert.equal(branched.data.messages.length, 2);

  // Group conversation + branch
  const groupRes = await request(app, '/api/conversations', {
    method: 'POST',
    json: { kind: 'group', title: '小院茶聚', personaIds: [firstPersona.id, second.id], scenePrompt: '春庭赏花' }
  });
  assert.equal(groupRes.status, 200);
  const group = groupRes.data.conversation;
  await request(app, `/api/conversations/${group.id}/messages`, {
    method: 'POST',
    json: { content: `@${second.name} 带画卷了吗？` }
  });
  const groupDetail = await request(app, `/api/conversations/${group.id}`);
  const groupBranch = await request(app, `/api/conversations/${group.id}/branch`, {
    method: 'POST',
    json: { upToMessageId: groupDetail.data.messages[0].id }
  });
  assert.equal(groupBranch.status, 200);
  assert.equal(groupBranch.data.conversation.kind, 'group');
  assert.equal(groupBranch.data.conversation.memberIds.length, 2);

  // Global Chinese substring search across direct/group and persona filter
  const searchAll = await request(app, `/api/messages/search?q=${encodeURIComponent('湖心亭')}`);
  assert.equal(searchAll.status, 200);
  assert.ok(searchAll.data.results.some(r => r.conversationId === conv.id && r.content.includes('湖心亭')));

  const searchGroupOnly = await request(app, `/api/messages/search?q=${encodeURIComponent('画卷')}&kind=group&personaId=${encodeURIComponent(second.id)}`);
  assert.equal(searchGroupOnly.status, 200);
  assert.ok(searchGroupOnly.data.results.some(r => r.conversationId === group.id));
});

test('Slice 2 HTTP: message bookmarks toggle, note editing, delete, and bootstrap hydration', async t => {
  const { app } = await localApp(t, ['江南春色正浓，喝杯龙井吧。']);
  const bootstrap = await request(app, '/api/bootstrap');
  const persona = bootstrap.data.personas[0];
  const conv = (await request(app, '/api/conversations', {
    method: 'POST',
    json: { personaId: persona.id }
  })).data.conversation;
  await request(app, `/api/conversations/${conv.id}/messages`, {
    method: 'POST',
    json: { content: '今天茶室里很安静。' }
  });
  const detail = await request(app, `/api/conversations/${conv.id}`);
  const assistantMsg = detail.data.messages.find(m => m.role === 'assistant');
  assert.ok(assistantMsg);

  const added = await request(app, '/api/bookmarks', {
    method: 'POST',
    json: { messageId: assistantMsg.id, note: '春日茶语' }
  });
  assert.equal(added.status, 200);
  assert.equal(added.data.bookmarked, true);
  assert.equal(added.data.bookmark.note, '春日茶语');

  const updated = await request(app, `/api/bookmarks/${added.data.bookmark.id}`, {
    method: 'PUT',
    json: { note: '三月茶话珍藏' }
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.data.bookmark.note, '三月茶话珍藏');

  const afterBootstrap = await request(app, '/api/bootstrap');
  assert.equal(afterBootstrap.data.bookmarks.length, 1);
  assert.equal(afterBootstrap.data.bookmarks[0].note, '三月茶话珍藏');

  const toggledOff = await request(app, '/api/bookmarks', {
    method: 'POST',
    json: { messageId: assistantMsg.id }
  });
  assert.equal(toggledOff.status, 200);
  assert.equal(toggledOff.data.bookmarked, false);
  assert.equal(toggledOff.data.bookmarks.length, 0);

  // Re-add then delete via DELETE route
  const reAdded = await request(app, '/api/bookmarks', {
    method: 'POST',
    json: { messageId: assistantMsg.id }
  });
  const deleted = await request(app, `/api/bookmarks/${reAdded.data.bookmark.id}`, {
    method: 'DELETE',
    json: {}
  });
  assert.equal(deleted.status, 200);
  assert.equal(deleted.data.bookmarks.length, 0);
});

test('Slice 3: web clipper SSRF protection, script stripping, and HTTP knowledge import', async t => {
  assert.equal(isForbiddenIpAddress('127.0.0.1'), true);
  assert.equal(isForbiddenIpAddress('10.20.0.1'), true);
  assert.equal(isForbiddenIpAddress('169.254.169.254'), true);
  assert.equal(isForbiddenIpAddress('192.168.1.5'), true);
  assert.equal(isForbiddenIpAddress('172.16.5.4'), true);
  assert.equal(isForbiddenIpAddress('::1'), true);
  assert.equal(isForbiddenIpAddress('fe80::1'), true);
  assert.equal(isForbiddenIpAddress('::ffff:127.0.0.1'), true);
  assert.equal(isForbiddenIpAddress('93.184.216.34'), false);

  await assert.rejects(
    clipPublicUrl('file:///etc/passwd'),
    err => err.status === 400
  );
  await assert.rejects(
    clipPublicUrl('https://rebind.invalid/secret', {
      dnsLookupImpl: async () => [{ address: '127.0.0.1', family: 4 }],
      fetchImpl: async () => { throw new Error('should not fetch private IP'); }
    }),
    err => err.status === 400
  );
  await assert.rejects(
    clipPublicUrl('https://public.example.com/start', {
      dnsLookupImpl: async host => host === 'public.example.com'
        ? [{ address: '93.184.216.34', family: 4 }]
        : [{ address: '10.0.0.1', family: 4 }],
      fetchImpl: async () => new Response('', { status: 302, headers: { location: 'http://127.0.0.1/admin' } })
    }),
    err => err.status === 400
  );

  const { app } = await localApp(t);
  const ssrfRes = await request(app, '/api/web/clip', {
    method: 'POST',
    json: { url: 'http://169.254.169.254/latest/meta-data/' }
  });
  assert.equal(ssrfRes.status, 400);

  const clipAttachmentRes = await request(app, '/api/web/clip', {
    method: 'POST',
    json: { url: 'https://example.com/garden', saveToKnowledge: false }
  });
  assert.equal(clipAttachmentRes.status, 200);
  assert.equal(clipAttachmentRes.data.clipped.title, '园林笔记');
  assert.ok(clipAttachmentRes.data.clipped.markdown.includes('太湖石与曲廊'));
  assert.ok(!clipAttachmentRes.data.clipped.markdown.includes('alert(1)'));

  const clipKbRes = await request(app, '/api/web/clip', {
    method: 'POST',
    json: { url: 'https://example.com/garden', saveToKnowledge: true }
  });
  assert.equal(clipKbRes.status, 200);
  assert.ok(clipKbRes.data.document?.id);
  const bootstrap = await request(app, '/api/bootstrap');
  assert.equal(bootstrap.data.documents.length, 1);
});

test('Slice 4 HTTP: daily mood journal generation, persona card export/import, and secret-free backup/restore', async t => {
  const { app } = await localApp(t, [
    '茶暖月明。',
    JSON.stringify({ summary: '今日在茶亭对饮闲谈，心神宁静。', companionComment: '夜风微凉，早些休息。' })
  ]);
  // Store realistic secrets in settings, mail_settings, and media_settings to verify zero secret leakage.
  app.api.updateSettings({ apiKey: 'sk-super-secret-model-key-999' });
  app.store.run('INSERT OR REPLACE INTO mail_settings VALUES (1,?)', JSON.stringify({ smtpHost: 'smtp.invalid', smtpPass: 'mail-secret-pw' }));
  app.store.run('INSERT OR REPLACE INTO media_settings VALUES (1,?)', JSON.stringify({ musicApiKey: 'music-secret-123', stickerApiKey: 'sticker-secret-456' }));

  const boot = await request(app, '/api/bootstrap');
  const role = boot.data.personas[0];
  const conv = (await request(app, '/api/conversations', { method: 'POST', json: { personaId: role.id } })).data.conversation;
  await request(app, `/api/conversations/${conv.id}/messages`, { method: 'POST', json: { content: '今晚月色真美。' } });

  const today = new Date().toISOString().slice(0, 10);
  const savedJournal = await request(app, `/api/journals/${today}`, {
    method: 'PUT',
    json: { mood: 'happy', userNote: '喝到了好茶', personaId: role.id, scope: 'persona' }
  });
  assert.equal(savedJournal.status, 200);
  assert.equal(savedJournal.data.journal.mood, 'happy');

  const genJournal = await request(app, `/api/journals/${today}/generate`, {
    method: 'POST',
    json: { mood: 'happy', userNote: '喝到了好茶', personaId: role.id }
  });
  assert.equal(genJournal.status, 200);
  assert.ok(genJournal.data.journal.summary.includes('茶亭'));
  assert.ok(genJournal.data.journal.companionComment.includes('早些休息'));

  // Persona Card export & import with memory
  await request(app, '/api/memories', {
    method: 'POST',
    json: { personaId: role.id, content: '喜欢明前龙井', category: 'preference', importance: 0.9, confidence: 0.9 }
  });
  const cardRes = await request(app, `/api/personas/${role.id}/card?includeMemories=true`);
  assert.equal(cardRes.status, 200);
  assert.equal(cardRes.data.format, 'qiyi-persona-card');
  assert.equal(cardRes.data.memories.length, 1);

  const importedCard = await request(app, '/api/personas/import-card', {
    method: 'POST',
    json: { ...cardRes.data, persona: { ...cardRes.data.persona, name: '分身角色' } }
  });
  assert.equal(importedCard.status, 200);
  assert.equal(importedCard.data.persona.name, '分身角色');
  assert.equal(importedCard.data.importedMemories, 1);

  // Full Workspace Backup export must NEVER include any secret
  const backupRes = await request(app, '/api/backup/export');
  assert.equal(backupRes.status, 200);
  assert.equal(backupRes.data.format, 'qiyi-workspace-backup');
  const serializedBackup = JSON.stringify(backupRes.data);
  assert.ok(!serializedBackup.includes('sk-super-secret-model-key-999'));
  assert.ok(!serializedBackup.includes('mail-secret-pw'));
  assert.ok(!serializedBackup.includes('music-secret-123'));
  assert.ok(!serializedBackup.includes('sticker-secret-456'));

  // Replace without explicit confirmation must fail with 400
  const unconfirmedReplace = await request(app, '/api/backup/import', {
    method: 'POST',
    json: { ...backupRes.data, mode: 'replace', confirmReplace: false }
  });
  assert.equal(unconfirmedReplace.status, 400);

  // Merge restore into a fresh persona & confirm replace works
  const replaceRes = await request(app, '/api/backup/import', {
    method: 'POST',
    json: { ...backupRes.data, mode: 'replace', confirmReplace: true }
  });
  assert.equal(replaceRes.status, 200);
  assert.equal(replaceRes.data.ok, true);
  assert.ok(replaceRes.data.counts.personas >= 2);
  assert.ok(replaceRes.data.counts.journals >= 1);
});
