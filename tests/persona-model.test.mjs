import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../lib/store.mjs';
import { createService } from '../lib/service.mjs';
import { fixture } from './helpers.mjs';

test('persona model: saved per persona, validated, and exported/imported with persona cards', t => {
  const { api, personaId } = fixture(t);
  const created = api.savePersona({ name: '专属模型角色', systemPrompt: '简洁回答。', model: '  fast-model-1  ' }).persona;
  assert.equal(created.model, 'fast-model-1');
  assert.equal(api.bootstrap().personas.find(p => p.id === created.id).model, 'fast-model-1');
  assert.equal(api.bootstrap().personas.find(p => p.id === personaId).model, '');

  const cleared = api.savePersona({ model: '' }, created.id).persona;
  assert.equal(cleared.model, '');
  assert.throws(() => api.savePersona({ model: 'x'.repeat(161) }, created.id));

  api.savePersona({ model: 'card-model' }, created.id);
  const card = api.exportPersonaCard(created.id);
  assert.equal(card.persona.model, 'card-model');
  assert.equal(api.importPersonaCard(card).persona.model, 'card-model');
});

test('persona model: single chat uses the persona model while others use the global model', async t => {
  const { api, personaId, calls } = fixture(t, ['默认模型回复', '专属模型回复']);
  api.updateSettings({ criticEnabled: false });
  const customId = api.savePersona({ name: '专属', systemPrompt: '简洁回答。', model: 'persona-only-model' }).persona.id;

  const defaultConv = api.createConversation({ personaId }).conversation.id;
  await api.sendMessage(defaultConv, { content: '你好' });
  assert.ok(calls.length > 0);
  assert.ok(calls.every(call => call.body.model === 'test-model'));

  const before = calls.length;
  const customConv = api.createConversation({ personaId: customId }).conversation.id;
  await api.sendMessage(customConv, { content: '你好' });
  const customCalls = calls.slice(before);
  assert.ok(customCalls.length > 0);
  assert.ok(customCalls.every(call => call.body.model === 'persona-only-model'));
});

test('persona model: group speakers each use their own model', async t => {
  const { api, personaId, calls } = fixture(t, [
    '乙的回复',
    '{"shouldReply":false,"speakerPersonaId":null,"intent":"silence","cue":"","reason":"完"}'
  ]);
  api.updateSettings({ criticEnabled: false });
  const other = api.savePersona({ name: '乙', systemPrompt: '简洁回答。', model: 'group-member-model' }).persona.id;
  const group = api.createConversation({ kind: 'group', title: '双人', personaIds: [other, personaId] }).conversation.id;
  // The @mention forces the model-specific member to speak first without a director decision.
  await api.sendMessage(group, { content: '@乙 你好' });
  const speakerCalls = calls.filter(call => call.body.messages.some(m => typeof m.content === 'string' && m.content.includes('你当前唯一要扮演的角色是「乙」')));
  assert.ok(speakerCalls.length > 0);
  assert.ok(speakerCalls.every(call => call.body.model === 'group-member-model'));
});

test('listModels reads the provider /models endpoint and tolerates failures', async t => {
  const store = createStore(':memory:');
  t.after(() => store.close());
  store.saveSettings({ baseUrl: 'http://model.invalid/v1', model: 'test-model' });
  let mode = 'ok';
  const requests = [];
  const api = createService(store, {
    apiKey: 'sk-test',
    fetchImpl: async (url, init) => {
      requests.push({ url: String(url), auth: init?.headers?.Authorization });
      if (mode === 'fail') return new Response('nope', { status: 401 });
      return new Response(
        JSON.stringify({ data: [{ id: 'b-model' }, { id: 'a-model' }, { id: 'a-model' }, { object: 'x' }] }),
        { headers: { 'content-type': 'application/json' } }
      );
    }
  });
  t.after(async () => { await api.scheduler.stop(); });

  const ok = await api.listModels();
  assert.deepEqual(ok.models, ['a-model', 'b-model']);
  assert.equal(requests[0].url, 'http://model.invalid/v1/models');
  assert.equal(requests[0].auth, 'Bearer sk-test');

  mode = 'fail';
  await assert.rejects(api.listModels(), error => error.status === 502 && /401/.test(error.message));
});
