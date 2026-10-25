import { test, expect } from '@playwright/test';

const question = '状态演示：今天好累，有点烦躁，先别给我建议。';
const bar = page => page.getByRole('button', { name: '查看和调整对话状态', exact: true });
const modal = page => page.locator('#chat-state-dialog');
async function fresh(page, request, name = '状态测试') {
  const { persona } = await (await request.post('/api/personas', { data: { name, systemPrompt: '清晰、温和地交流。' } })).json();
  await page.goto(`/?state=${persona.id}#chat`); await page.getByLabel('选择聊天角色', { exact: true }).selectOption(persona.id);
  await expect(bar(page)).toContainText('初识'); return persona;
}
async function open(page) { await bar(page).click(); await expect(page.locator('#state-mode')).toBeVisible(); }
async function send(page, content = question) { const n = await page.locator('.message.assistant').count(); await page.locator('#chat-input').fill(content); await page.getByRole('button', { name: '发送', exact: true }).click(); await expect(page.locator('.message.assistant')).toHaveCount(n + 1); }
async function close(page) { await page.getByRole('button', { name: '关闭对话状态', exact: true }).click(); }
async function save(page) { await page.getByRole('button', { name: '保存状态修改', exact: true }).click(); await expect(modal(page)).not.toBeVisible(); }
const manual = (page, key) => page.locator(`[data-state-manual="${key}"]`);

test('six states separate user and role; stage is compact while scores and evidence stay in details', async ({ page, request }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message)); await fresh(page, request);
  await expect(bar(page)).toContainText('暂不判断'); await expect(bar(page)).toContainText('跟随人设'); await expect(bar(page)).not.toContainText('/ 100');
  await open(page); await expect(modal(page).getByRole('heading', { name: '你 · 当前状态', exact: true })).toBeVisible();
  await expect(modal(page).getByRole('heading', { name: '状态测试 · 表达状态', exact: true })).toBeVisible();
  await expect(modal(page).locator('.state-field')).toHaveCount(5); await expect(modal(page).locator('.state-score')).toContainText('0 / 100');
  await modal(page).locator('.state-evidence summary').first().click(); await expect(modal(page).locator('.state-evidence').first()).toContainText('目前没有足够的用户原话');
  await expect(page.locator('#state-save')).toBeDisabled(); expect(errors).toEqual([]);
});

test('a grounded reply updates the bar and evidence, hides metadata and calms pets without changing preferences', async ({ page, request }, info) => {
  await request.put('/api/pets/settings', { data: { enabled: true, animations: true } }); const persona = await fresh(page, request);
  let chats = 0; page.on('request', r => { if (r.method() === 'POST' && /\/api\/conversations\/[^/]+\/messages$/.test(r.url())) chats++; });
  await send(page); await expect(bar(page)).toContainText('有些烦躁'); await expect(bar(page)).toContainText('精力疲惫'); await expect(bar(page)).toContainText('想被倾听'); await expect(bar(page)).toContainText('温和关切');
  await expect(page.locator('.pet-trigger [data-pet-portrait]')).toHaveAttribute('data-phase', 'quiet');
  expect((await (await request.get('/api/pets')).json()).settings.animations).toBe(true);
  await expect(page.locator('.message.assistant')).not.toContainText('qiyi-state'); await page.screenshot({ path: info.outputPath('state-desktop-chat.png') }); await open(page);
  await modal(page).locator('.state-field').filter({ has: page.getByRole('heading', { name: '精力状态', exact: true }) }).locator('summary').click();
  await expect(modal(page).locator('.state-field').filter({ has: page.getByRole('heading', { name: '精力状态', exact: true }) }).locator('blockquote')).toHaveText('今天好累'); await page.screenshot({ path: info.outputPath('state-desktop-detail.png') }); await close(page); await page.reload();
  await page.getByLabel('选择聊天角色', { exact: true }).selectOption(persona.id); await page.locator('.history-item').filter({ hasText: '状态演示' }).click();
  await expect(bar(page)).toContainText('精力疲惫'); expect(chats).toBe(1);
});

test('all five manual values and local notes survive another automatic reply and can return to automatic', async ({ page, request }) => {
  await fresh(page, request); await send(page); await open(page);
  for (const key of ['emotion', 'energy', 'need', 'roleMood', 'proactivity']) await manual(page, key).check();
  await page.locator('#state-emotion-primary').selectOption('happy'); await page.locator('#state-emotion-secondary').selectOption('excited'); await page.locator('#state-emotion-intensity').selectOption('4');
  await page.locator('#state-value-energy').selectOption('high'); await page.locator('#state-value-need').selectOption('task'); await page.locator('#state-value-roleMood').selectOption('serious'); await page.locator('#state-value-proactivity').selectOption('high'); await page.locator('#state-note-energy').fill('我现在休息好了');
  await save(page); await expect(bar(page)).toContainText('开心 / 兴奋'); await expect(bar(page)).toContainText('精力充足'); await send(page); await expect(bar(page)).toContainText('精力充足');
  await open(page); await expect(manual(page, 'energy')).toBeChecked(); await expect(page.locator('#state-note-energy')).toHaveValue('我现在休息好了');
  await manual(page, 'energy').uncheck(); await save(page); await send(page); await expect(bar(page)).toContainText('精力疲惫');
});

test('manual state before the first message preserves the draft and creates only one conversation', async ({ page, request }) => {
  const persona = await fresh(page, request); await page.locator('#chat-input').fill('这句话先保留，稍后发送。'); await open(page);
  await manual(page, 'need').check(); await page.locator('#state-value-need').selectOption('listen'); await save(page);
  await expect(page.locator('#chat-input')).toHaveValue('这句话先保留，稍后发送。'); await expect(bar(page)).toContainText('想被倾听');
  await page.getByRole('button', { name: '发送', exact: true }).click(); await expect(page.locator('.message.assistant')).toHaveCount(1);
  const bootstrap = await (await request.get('/api/bootstrap')).json(); expect(bootstrap.conversations.filter(c => c.personaId === persona.id)).toHaveLength(1);
});

test('familiarity uses confirmed memories and supports a reasoned override and restoration without an empty conversation', async ({ page, request }) => {
  const persona = await fresh(page, request); for (const content of ['喜欢茉莉花茶', '周末骑车', '在做音乐平台']) await request.post('/api/memories', { data: { personaId: persona.id, content } });
  await page.getByRole('button', { name: '刷新本地数据', exact: true }).click(); await expect(bar(page)).toContainText('逐渐熟悉'); await open(page);
  await expect(page.locator('.state-score')).toContainText('27 / 100'); await page.locator('.state-familiarity-basis summary').click(); await expect(page.locator('.state-familiarity-basis')).toContainText('喜欢茉莉花茶');
  await page.locator('#state-familiarity-manual').check(); await page.locator('#state-familiarity-score').fill('75'); await page.locator('#state-familiarity-note').fill('这些资料已足够了解我的日常偏好'); await save(page);
  await expect(page.locator('.state-summary-familiarity')).toContainText('熟悉'); await expect(bar(page)).not.toContainText('75');
  let data = await (await request.get('/api/bootstrap')).json(); expect(data.conversations.filter(c => c.personaId === persona.id)).toHaveLength(0);
  await open(page); await expect(page.locator('#state-familiarity-note')).toHaveValue('这些资料已足够了解我的日常偏好'); await page.locator('#state-familiarity-manual').uncheck(); await save(page); await expect(bar(page)).toContainText('逐渐熟悉');
  const { persona: other } = await (await request.post('/api/personas', { data: { name: '另一角色', systemPrompt: '简洁' } })).json(); await page.reload(); await page.getByLabel('选择聊天角色', { exact: true }).selectOption(other.id); await expect(bar(page)).toContainText('初识');
});

test('manual mode, clearing and disabling keep chat history intact', async ({ page, request }) => {
  await fresh(page, request); await send(page); await open(page); await page.locator('#state-mode').selectOption('manual'); await manual(page, 'energy').check(); await page.locator('#state-value-energy').selectOption('high'); await save(page);
  await send(page); await expect(bar(page)).toContainText('精力充足'); await open(page);
  page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: '清空本会话状态', exact: true }).click(); await expect(modal(page)).not.toBeVisible();
  await expect(bar(page)).toContainText('精力未知'); await expect(page.locator('.message.assistant')).toHaveCount(2);
  await open(page); await page.locator('#state-mode').selectOption('off'); await save(page); await expect(bar(page)).toContainText('状态辅助已关闭'); await send(page); await expect(bar(page)).toContainText('状态辅助已关闭'); await expect(page.locator('.message.assistant')).toHaveCount(3);
});

test('conflicting edits preserve the open form and require an explicit reload', async ({ page, request }) => {
  const persona = await fresh(page, request); await send(page); await open(page); await manual(page, 'energy').check(); await page.locator('#state-value-energy').selectOption('high');
  const bootstrap = await (await request.get('/api/bootstrap')).json(), conversationId = bootstrap.conversations.find(c => c.personaId === persona.id).id;
  const current = (await (await request.get(`/api/chat-state?personaId=${persona.id}&conversationId=${conversationId}`)).json()).chatState;
  await request.post('/api/chat-state', { data: { personaId: persona.id, conversationId, patch: { expectedManualRevision: current.manualRevision, fields: { energy: { value: 'normal' } } } } });
  await page.getByRole('button', { name: '保存状态修改', exact: true }).click(); await expect(modal(page).getByRole('alert')).toContainText('另一处修改'); await expect(page.locator('#state-value-energy')).toHaveValue('high');
  page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: '重新读取', exact: true }).click(); await expect(page.locator('#state-value-energy')).toHaveValue('normal');
});

for (const width of [320, 390]) test(`state bar, evidence and editing fit ${width}px and the visible keyboard area`, async ({ page, request }, info) => {
  await page.setViewportSize({ width, height: 844 }); await fresh(page, request); await send(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const sendBox = await page.getByRole('button', { name: '发送', exact: true }).boundingBox(), nav = await page.locator('#navigation').boundingBox(); expect(sendBox.y + sendBox.height).toBeLessThan(nav.y);
  await page.screenshot({ path: info.outputPath(`state-chat-${width}.png`) }); await open(page); expect(await modal(page).evaluate(e => e.scrollWidth <= e.clientWidth + 1)).toBe(true); await page.screenshot({ path: info.outputPath(`state-detail-${width}.png`) }); await manual(page, 'energy').check(); await page.locator('#state-note-energy').fill('移动端保留输入');
  await page.evaluate(() => { Object.defineProperty(window.visualViewport, 'height', { configurable: true, value: 450 }); window.visualViewport.dispatchEvent(new Event('resize')); });
  await expect(async () => { const box = await modal(page).boundingBox(); expect(box.y + box.height).toBeLessThanOrEqual(450); }).toPass(); await expect(page.locator('#state-note-energy')).toHaveValue('移动端保留输入');
  await page.screenshot({ path: info.outputPath(`state-mobile-${width}.png`) });
});
