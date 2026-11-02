import { readFileSync } from 'node:fs';
import { test, expect } from './ui-test.mjs';

const appSource = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8').replace(/\r\n/gu, '\n');
const question = `流式演示${'长'.repeat(496)}`;

const isAlreadyPatched = (appSource.match(/active_flight:/gu) || []).length === 3;

function modelBSource() {
  if (isAlreadyPatched) return appSource;
  let source = appSource.replace(
    '    state.data = data;\n',
    `    state.data = data;\n    for (const conversation of data.conversations) {\n      const recovered = localStorage.getItem('active_flight:' + conversation.id);\n      if (recovered !== null && !state.drafts.has(conversation.id)) state.drafts.set(conversation.id, recovered);\n    }\n`,
  );
  source = source.replace(
    '    outgoing.controller.signal.throwIfAborted();\n    const result = await requestChat',
    `    outgoing.controller.signal.throwIfAborted();\n    localStorage.setItem('active_flight:' + conversationId, content);\n    const result = await requestChat`,
  );
  source = source.replace(
    '    outgoing.completed=true;\n',
    `    outgoing.completed=true;\n    localStorage.removeItem('active_flight:' + conversationId);\n`,
  );
  if (source === appSource || (source.match(/active_flight:/gu) || []).length !== 3) throw new Error('Model B browser patch was not applied');
  return source;
}

function modelASource() {
  if (!isAlreadyPatched) return appSource;
  return appSource
    .replace(/for \(const conversation of data\.conversations\) \{\s*const recovered = localStorage\.getItem\('active_flight:' \+ conversation\.id\);\s*if \(recovered !== null && !state\.drafts\.has\(conversation\.id\)\) state\.drafts\.set\(conversation\.id, recovered\);\s*\}/u, '')
    .replace(/localStorage\.setItem\('active_flight:' \+ conversationId, content\);\s*/u, '')
    .replace(/localStorage\.removeItem\('active_flight:' \+ conversationId\);\s*/u, '');
}

async function openConversation(page, personaId, conversationId) {
  await page.getByLabel('选择聊天角色', { exact: true }).selectOption(personaId);
  await page.getByRole('button', { name: '历史对话', exact: true }).click();
  await page.locator(`[data-action="open-conversation"][data-id="${conversationId}"]`).click();
  await expect(page.locator('#chat-input')).toBeEnabled();
}

for (const proposed of [false, true]) {
  test(`third-party ${proposed ? 'Model B localStorage' : 'Model A memory-only'} recovery after reload`, async ({ page, request }) => {
    const source = proposed ? modelBSource() : modelASource();
    await page.route('**/app.js', route => route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: source }));
    const { persona } = await (await request.post('/api/personas', { data: { name: `容灾评测${Date.now()}`, systemPrompt: '简洁回应。' } })).json();
    const { conversation } = await (await request.post('/api/conversations', { data: { personaId: persona.id } })).json();
    await page.goto('/#chat');
    await expect(page.locator('#startup-screen')).toHaveCount(0);
    await openConversation(page, persona.id, conversation.id);
    await page.locator('#chat-input').fill(question);
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect(page.locator('#live-reply .live-body')).toContainText('第一段');
    await page.reload();
    await expect(page.locator('#startup-screen')).toHaveCount(0);
    await openConversation(page, persona.id, conversation.id);
    await expect(page.locator('#chat-input')).toHaveValue(proposed ? question : '');

    let history = await (await request.get(`/api/conversations/${conversation.id}`)).json();
    expect(history.messages).toHaveLength(0);

    if (proposed) {
      expect(await page.evaluate(id => localStorage.getItem(`active_flight:${id}`), conversation.id)).toBe(question);
      await page.getByRole('button', { name: '发送', exact: true }).click();
      await expect(page.locator('#live-reply')).toHaveCount(0);
      await expect(page.locator('.message.assistant .message-content')).toContainText('第二段');
      expect(await page.evaluate(id => localStorage.getItem(`active_flight:${id}`), conversation.id)).toBeNull();
      history = await (await request.get(`/api/conversations/${conversation.id}`)).json();
      expect(history.messages).toHaveLength(2);
      expect(history.messages[0].content).toBe(question);
    }
  });
}

test('page reload maintains the active conversation and messages without creating a new session', async ({ page, request }) => {
  const { persona } = await (await request.post('/api/personas', { data: { name: `持久化测试${Date.now()}`, systemPrompt: '简洁。' } })).json();
  await page.goto('/#chat');
  await page.getByLabel('选择聊天角色', { exact: true }).selectOption(persona.id);
  await page.locator('#chat-input').fill('第一句测试消息');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.locator('#live-reply')).toHaveCount(0);
  await expect(page.locator('.message.user')).toHaveCount(1);
  await expect(page.locator('.message.assistant')).toHaveCount(1);

  // Reload the page
  await page.reload();
  await expect(page.locator('#startup-screen')).toHaveCount(0);

  // The conversation and previous message must stay visible on the screen, NOT wiped to empty welcome
  await expect(page.locator('.message.user .message-content')).toHaveText('第一句测试消息');
  await expect(page.locator('.chat-welcome')).toHaveCount(0);

  // Send a second message and verify it continues in the same conversation
  await page.locator('#chat-input').fill('第二句测试消息');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.locator('#live-reply')).toHaveCount(0);
  await expect(page.locator('.message.user')).toHaveCount(2);
  await expect(page.locator('.message.user .message-content').nth(1)).toHaveText('第二句测试消息');

  // Verify on the server that only ONE conversation was created with 4 messages (2 user + 2 assistant)
  const boot = await (await request.get('/api/bootstrap')).json();
  const convs = boot.conversations.filter(c => c.personaId === persona.id);
  expect(convs).toHaveLength(1);
  const detail = await (await request.get(`/api/conversations/${convs[0].id}`)).json();
  expect(detail.messages).toHaveLength(4);
});
