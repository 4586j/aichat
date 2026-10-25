import { test, expect } from '@playwright/test';

let original;
test.beforeEach(async ({ request }) => {
  original = (await (await request.get('/api/settings')).json()).settings;
  await request.put('/api/settings', { data: { model: '', clearApiKey: true } });
});
test.afterEach(async ({ request }) => { await request.put('/api/settings', { data: { model: original.model, baseUrl: original.baseUrl, clearApiKey: true } }); });
async function firstMessage(page, text = '你好，这是我第一次想说的话。') {
  await page.goto('/#chat'); await page.getByLabel('发送给当前角色的消息', { exact: true }).fill(text);
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.getByRole('article', { name: '快捷配置消息' })).toBeVisible(); return text;
}

test('first unconfigured send gives one local setup message, keeps the draft and makes no outgoing action', async ({ page, request }) => {
  const before = (await (await request.get('/api/bootstrap')).json()).stats; const actions = [];
  page.on('request', r => { if (r.method() !== 'GET') actions.push(r.url()); });
  const text = await firstMessage(page);
  const card = page.getByRole('article', { name: '快捷配置消息' }); await expect(card).toContainText('本地配置助手');
  await expect(card).toContainText('基础地址不要带 /chat/completions');
  await expect(page.getByLabel('发送给当前角色的消息', { exact: true })).toHaveValue(text);
  await page.getByRole('button', { name: '发送', exact: true }).click(); await expect(card).toHaveCount(1);
  expect(actions).toHaveLength(0); await expect(page.locator('.message')).toHaveCount(0);
  const after = (await (await request.get('/api/bootstrap')).json()).stats; expect(after.messageCount).toBe(before.messageCount); expect(after.conversationCount).toBe(before.conversationCount);
  await page.getByRole('button', { name: '查看配置方法', exact: true }).click(); await expect(page.locator('.guide-document')).toContainText('模型连接与 API Key');
  await expect(page.getByRole('button', { name: '带到聊天中询问', exact: true })).toBeDisabled(); expect(actions).toHaveLength(0);
});

test('quick configuration saves explicitly, tests explicitly and resumes the retained first sentence once', async ({ page, request }) => {
  const { persona } = await (await request.post('/api/personas', { data: { name: '首次配置验证', systemPrompt: '简洁回答。' } })).json();
  const actions = []; page.on('request', r => { if (r.method() !== 'GET') actions.push(r.url()); });
  await page.goto(`/?setup=${persona.id}#chat`); await page.getByLabel('选择聊天角色', { exact: true }).selectOption(persona.id);
  const text = '这句话要在我完成配置后再发送。'; await page.locator('#chat-input').fill(text); await page.getByRole('button', { name: '发送', exact: true }).click();
  await page.getByRole('button', { name: '快捷配置模型', exact: true }).click();
  await page.getByLabel('模型基础地址（Base URL）', { exact: true }).fill('http://127.0.0.1:1');
  await page.getByLabel('模型 ID', { exact: true }).fill('offline-ui-test'); await page.getByLabel('模型 API Key', { exact: true }).fill('ONBOARDING-PRIVATE');
  await page.getByRole('button', { name: '保存快捷配置', exact: true }).click(); await expect(page.locator('#editor-dialog')).not.toBeVisible();
  await expect(page.getByRole('article', { name: '快捷配置消息' })).toContainText('模型信息已保存');
  await expect(page.locator('#chat-input')).toHaveValue(text); expect(actions.filter(url => url.endsWith('/api/settings'))).toHaveLength(1);
  expect(actions.filter(url => url.includes('/conversations') || url.endsWith('/settings/test'))).toHaveLength(0);
  expect(await page.evaluate(() => Object.values(localStorage).join(' '))).not.toContain('ONBOARDING-PRIVATE');
  expect(await page.locator('#editor-dialog input[type="password"]').inputValue()).toBe('');
  await page.getByRole('button', { name: '测试已保存的连接', exact: true }).click(); await expect(page.locator('.setup-message .inline-success')).toContainText('离线测试回复');
  expect(actions.filter(url => url.endsWith('/settings/test'))).toHaveLength(1);
  await page.getByRole('button', { name: '继续发送', exact: true }).click(); await expect(page.locator('.message.assistant')).toBeVisible();
  await expect(page.getByRole('article', { name: '快捷配置消息' })).toHaveCount(0); await expect(page.locator('#chat-input')).toHaveValue('');
  expect(actions.filter(url => /\/conversations\/[^/]+\/messages$/.test(url))).toHaveLength(1);
  await expect(page.locator('.message.user .message-content')).toHaveText(text);
});

test('invalid quick settings and cancellation retain the first sentence and clear unsaved password on close', async ({ page, request }) => {
  const text = await firstMessage(page); await page.getByRole('button', { name: '快捷配置模型', exact: true }).click();
  await page.getByLabel('模型基础地址（Base URL）', { exact: true }).fill('https://model.example.com/v1?secret=invalid');
  await page.getByLabel('模型 ID', { exact: true }).fill('test-model'); await page.getByLabel('模型 API Key', { exact: true }).fill('CANCELLED-SECRET');
  await page.getByRole('button', { name: '保存快捷配置', exact: true }).click(); await expect(page.locator('#dialog-error')).toContainText('模型地址必须');
  expect((await (await request.get('/api/settings')).json()).settings.model).toBe('');
  await page.getByRole('button', { name: '取消', exact: true }).click(); await expect(page.locator('#chat-input')).toHaveValue(text);
  expect(await page.locator('#editor-dialog input[type="password"]').inputValue()).toBe('');
  await page.locator('.setup-optional summary').click(); await page.getByRole('button', { name: '音乐配置方法', exact: true }).click();
  await expect(page.locator('.guide-document')).toContainText('音乐平台与背景播放'); await page.getByRole('button', { name: '关闭配置指南', exact: true }).click();
  await expect(page.locator('#chat-input')).toHaveValue(text);
});

test('a configured model follows the normal first-message flow', async ({ page, request }) => {
  await request.put('/api/settings', { data: { model: 'offline-ui-test' } });
  await page.goto('/#chat'); await page.locator('#chat-input').fill('已经配置，直接开始聊天。'); await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.locator('.message.assistant')).toBeVisible(); await expect(page.getByRole('article', { name: '快捷配置消息' })).toHaveCount(0);
});

for (const width of [320, 390]) test(`local setup and quick model configuration fit a ${width}px phone`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 844 }); await firstMessage(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator('.setup-message')).toBeVisible();
  const button = page.getByRole('button', { name: '快捷配置模型', exact: true }); await button.scrollIntoViewIfNeeded(); expect((await button.boundingBox()).height).toBeGreaterThanOrEqual(44);
  await page.screenshot({ path: info.outputPath(`onboarding-phone-${width}.png`) }); await button.click();
  expect(await page.locator('#editor-dialog').evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true);
  await page.getByLabel('模型 ID', { exact: true }).fill('保留快捷表单内容');
  await page.evaluate(() => { Object.defineProperty(window.visualViewport, 'height', { configurable: true, value: 450 }); window.visualViewport.dispatchEvent(new Event('resize')); });
  await expect(async () => { const box = await page.locator('#editor-dialog').boundingBox(); expect(box.y + box.height).toBeLessThanOrEqual(450); }).toPass();
  await expect(page.getByLabel('模型 ID', { exact: true })).toHaveValue('保留快捷表单内容');
});
