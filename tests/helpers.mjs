import assert from 'node:assert/strict';
import { createStore } from '../lib/store.mjs';
import { createService } from '../lib/service.mjs';
import { AppError } from '../lib/model.mjs';

export const TIME = Date.parse('2030-01-15T12:00:00.000Z');
export const DAY = 86400000;
export const iso = time => new Date(time).toISOString();
export const base64 = value => Buffer.from(value).toString('base64');

export function modelResponse(content) {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

export function scriptedModel(...replies) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const call = { url, init, body: JSON.parse(init.body) };
    calls.push(call);
    assert.ok(replies.length, `Unexpected model request #${calls.length}`);
    const next = replies.shift();
    if (typeof next === 'function') return next(call);
    if (next instanceof Error) throw next;
    if (next instanceof Response) return next;
    return modelResponse(typeof next === 'string' ? next : JSON.stringify(next));
  };
  return { calls, fetchImpl };
}

export function fixture(t, replies = [], options = {}) {
  const store = createStore(':memory:');
  // Override inherited model configuration; every provider request uses this stub.
  store.saveSettings({ baseUrl: 'http://model.invalid/v1', model: 'test-model',
    memoryMessageThreshold: 200, memoryIntervalHours: 720, memoryBudget: 300 });
  const mock = scriptedModel(...replies);
  const api = createService(store, { fetchImpl: mock.fetchImpl, apiKey: '', timeoutMs: 1000, ...options });
  t.after(async () => { await api.scheduler.stop(); store.close(); });
  const personaId = store.get('SELECT id FROM personas LIMIT 1').id;
  return { store, api, personaId, ...mock };
}

export function errorStatus(status, pattern) {
  return error => error instanceof AppError && error.status === status && (!pattern || pattern.test(error.message));
}

export function addPersona(api, name = 'Second role') {
  return api.savePersona({ name, systemPrompt: 'Be precise.', tone: 'concise' }).persona.id;
}

export function addConversation(api, personaId, title) {
  return api.createConversation({ personaId, ...(title ? { title } : {}) }).conversation.id;
}

export function addMessages(store, conversationId, contents, startTime = TIME) {
  return contents.map((item, index) => {
    const role = typeof item === 'string' ? (index % 2 ? 'assistant' : 'user') : item.role;
    const content = typeof item === 'string' ? item : item.content;
    return Number(store.run('INSERT INTO messages (conversationId,role,content,createdAt) VALUES (?,?,?,?)',
      conversationId, role, content, iso(startTime + index)).lastInsertRowid);
  });
}

export function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
