import { test, expect } from '@playwright/test';

const CONFIG = { host: 'smtp-fixture.invalid', port: 587, security: 'starttls', user: 'sender@example.com', password: 'ui-smtp-secret', from: 'sender@example.com', fromName: '测试工作室' };
async function configure(request, value = CONFIG) { expect((await request.put('/api/mail/settings', { data: value })).ok()).toBe(true); }
async function compose(page, subject = '来自栖忆的测试邮件') {
  await page.getByRole('button', { name: '写一封邮件', exact: true }).first().click();
  await page.getByLabel('收件人', { exact: true }).fill('reader@example.com');
  await page.getByLabel('抄送（可选）', { exact: true }).fill('copy@example.com');
  await page.getByLabel('密送（可选）', { exact: true }).fill('blind@example.com');
  await page.getByLabel('主题', { exact: true }).fill(subject);
  await page.getByLabel('正文', { exact: true }).fill('你好，\n\n这封信会先预览，确认后才提交。\n\n祝好。');
}
test.afterEach(async ({ request }) => {
  const { history } = await (await request.get('/api/mail/history')).json();
  for (const row of history) await request.delete(`/api/mail/history/${row.id}`, { data: {} });
  await configure(request, { host: '', user: '', from: '', fromName: '', port: 465, security: 'tls', clearPassword: true });
});

test('SMTP setup stays offline, saves independently, hides passwords and explicitly verifies', async ({ page, request }) => {
  await configure(request, { host: '', user: '', from: '', clearPassword: true });
  const externalActions = []; page.on('request', r => { if (/\/api\/mail\/(verify|send|prepare|draft)$/.test(r.url())) externalActions.push(r.url()); });
  await page.goto('/#settings'); await expect(page.getByLabel('SMTP 主机', { exact: true })).toHaveValue('');
  await page.getByLabel('SMTP 主机', { exact: true }).fill(CONFIG.host);
  await page.getByLabel('连接加密', { exact: true }).selectOption('starttls');
  await expect(page.getByLabel('端口', { exact: true })).toHaveValue('587');
  await page.getByLabel('SMTP 用户名', { exact: true }).fill(CONFIG.user);
  await page.getByLabel('SMTP 密码 / 邮箱授权码', { exact: true }).fill(CONFIG.password);
  await page.getByLabel('发件邮箱', { exact: true }).fill(CONFIG.from);
  await page.getByRole('button', { name: '保存邮件设置', exact: true }).click();
  await expect(page.locator('.mail-feedback')).toContainText('已保存');
  await expect(page.getByLabel('SMTP 密码 / 邮箱授权码', { exact: true })).toHaveValue('');
  expect(externalActions).toHaveLength(0);
  const settings = await (await request.get('/api/mail/settings')).json(); expect(settings.settings.hasPassword).toBe(true); expect(JSON.stringify(settings)).not.toContain(CONFIG.password);
  expect(await page.evaluate(() => Object.values(localStorage).join(' '))).not.toContain(CONFIG.password);
  await page.getByRole('button', { name: '测试已保存的 SMTP 连接', exact: true }).click();
  await expect(page.locator('.mail-feedback')).toContainText('此测试不发送邮件');
  expect(externalActions.filter(url => url.endsWith('/verify'))).toHaveLength(1);
  expect(externalActions.filter(url => url.endsWith('/send'))).toHaveLength(0);
});

test('preview lists all recipients; editing requires new preview, final confirm sends exactly once and history persists', async ({ page, request }) => {
  await configure(request); let sends = 0; page.on('request', r => { if (r.url().endsWith('/api/mail/send')) sends++; });
  await page.goto('/'); await compose(page);
  await page.getByRole('button', { name: '预览邮件', exact: true }).click();
  await expect(page.getByRole('heading', { name: '发送前，再读一遍' })).toBeVisible();
  await expect(page.locator('.mail-envelope')).toContainText('blind@example.com');
  expect(sends).toBe(0); expect((await (await request.get('/api/mail/history')).json()).history).toHaveLength(0);
  await page.getByRole('button', { name: '返回修改', exact: true }).click();
  await page.getByLabel('主题', { exact: true }).fill('修改后的主题');
  await page.getByRole('button', { name: '预览邮件', exact: true }).click();
  await expect(page.locator('.mail-subject')).toHaveText('修改后的主题');
  await page.getByRole('button', { name: '确认发送', exact: true }).click();
  await expect(page.locator('.mail-result')).toContainText('服务器已接受'); expect(sends).toBe(1);
  await page.getByRole('button', { name: '查看发送记录', exact: true }).click();
  await expect(page.locator('.mail-history-item')).toHaveCount(1);
  await page.getByRole('button', { name: '关闭邮件面板', exact: true }).click();
  await page.reload(); await page.goto('/#settings');
  await page.getByRole('button', { name: '查看发送记录', exact: true }).click();
  await expect(page.locator('.mail-history-item')).toContainText('修改后的主题');
  page.once('dialog', d => d.accept()); await page.getByRole('button', { name: '删除本地记录', exact: true }).click();
  await expect(page.locator('.mail-history-item')).toHaveCount(0);
});

test('AI drafts only subject/body, preserves chosen recipients and never sends automatically', async ({ page, request }) => {
  await configure(request); const mailActions = []; page.on('request', r => { if (/\/api\/mail\/(send|draft)$/.test(r.url())) mailActions.push({ url: r.url(), data: r.postDataJSON() }); });
  await page.goto('/'); await page.getByRole('button', { name: '写一封邮件', exact: true }).click();
  await page.getByLabel('收件人', { exact: true }).fill('private@example.com');
  await page.getByText('让 AI 帮我起草', { exact: true }).click();
  await page.getByLabel('想写给谁，说明什么？', { exact: true }).fill('帮我写会议邀请');
  await page.getByRole('button', { name: '生成主题和正文', exact: true }).click();
  await expect(page.getByLabel('主题', { exact: true })).toHaveValue('会议邀请 · 待确认');
  await expect(page.getByLabel('正文', { exact: true })).toHaveValue(/【待补充】/);
  await expect(page.getByLabel('收件人', { exact: true })).toHaveValue('private@example.com');
  expect(mailActions).toHaveLength(1); expect(mailActions[0].url).toContain('/draft');
  expect(mailActions[0].data).toEqual({ instruction: '帮我写会议邀请' });
});

test('an AI reply can become an editable email and blank SMTP prevents submission', async ({ page, request }) => {
  await configure(request, { host: '', user: '', from: '', clearPassword: true });
  const { persona } = await (await request.post('/api/personas', { data: { name: '邮件回复测试', systemPrompt: '简洁回答。' } })).json();
  await page.goto(`/?mail=${persona.id}#chat`); await page.getByLabel('选择聊天角色', { exact: true }).selectOption(persona.id);
  await page.getByLabel('发送给当前角色的消息', { exact: true }).fill('写一段问候'); await page.getByRole('button', { name: '发送', exact: true }).click();
  await page.getByRole('button', { name: '写成邮件', exact: true }).click();
  await expect(page.getByLabel('正文', { exact: true })).toHaveValue(/离线测试回复/);
  await page.getByLabel('收件人', { exact: true }).fill('reader@example.com'); await page.getByLabel('主题', { exact: true }).fill('问候');
  await page.getByRole('button', { name: '预览邮件', exact: true }).click();
  await expect(page.locator('#mail-dialog [role="alert"]')).toContainText('先保存完整');
  await expect(page.getByRole('button', { name: '确认发送', exact: true })).toHaveCount(0);
});

test('partial acceptance and DATA interruption remain distinct in the interface', async ({ page, request }) => {
  await configure(request); await page.goto('/'); await compose(page);
  await page.getByLabel('密送（可选）', { exact: true }).fill('blind@reject.invalid');
  await page.getByRole('button', { name: '预览邮件', exact: true }).click(); await page.getByRole('button', { name: '确认发送', exact: true }).click();
  await expect(page.locator('.mail-result')).toContainText('部分接受'); await expect(page.locator('.mail-result')).toContainText('已拒绝：blind@reject.invalid');
  await page.getByRole('button', { name: '写下一封', exact: true }).click();
  await page.getByLabel('收件人', { exact: true }).fill('reader@example.com'); await page.getByLabel('主题', { exact: true }).fill('中断演示'); await page.getByLabel('正文', { exact: true }).fill('发送状态演示。');
  await page.getByRole('button', { name: '预览邮件', exact: true }).click(); await page.getByRole('button', { name: '确认发送', exact: true }).click();
  await expect(page.locator('.mail-result')).toContainText('结果待核实'); await expect(page.locator('.mail-result')).toContainText('避免重复发送');
});

test('SMTP fields are locked while saving; mobile keyboard viewport keeps the composer reachable', async ({ page, request }) => {
  await configure(request); await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/#settings');
  let release, seen; const gate = new Promise(r => { release = r; }); const observed = new Promise(r => { seen = r; });
  await page.route('**/api/mail/settings', async route => { if (route.request().method() === 'PUT') { seen(); await gate; } await route.continue(); });
  await page.getByLabel('发件人名称', { exact: true }).fill('正在保存的名称');
  await page.getByRole('button', { name: '保存邮件设置', exact: true }).click(); await observed;
  await expect(page.getByLabel('发件人名称', { exact: true })).toBeDisabled(); release();
  await expect(page.locator('.mail-feedback')).toContainText('已保存'); await expect(page.getByLabel('发件人名称', { exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '写一封邮件', exact: true }).first().click();
  await page.getByLabel('正文', { exact: true }).fill('键盘弹出时，保留草稿。');
  await page.evaluate(() => { Object.defineProperty(window.visualViewport, 'height', { configurable: true, value: 450 }); window.visualViewport.dispatchEvent(new Event('resize')); });
  await expect(async () => { const box = await page.locator('#mail-dialog').boundingBox(); expect(box.y + box.height).toBeLessThanOrEqual(450); }).toPass();
  await page.getByLabel('正文', { exact: true }).scrollIntoViewIfNeeded(); await expect(page.getByLabel('正文', { exact: true })).toHaveValue('键盘弹出时，保留草稿。');
});

for (const width of [320, 390]) test(`mail settings, composer and confirmation fit a ${width}px phone`, async ({ page, request }, info) => {
  await page.setViewportSize({ width, height: 844 }); await configure(request); await page.goto('/#settings');
  await page.locator('#mail-settings').scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await compose(page, '手机预览测试'); await page.getByRole('button', { name: '预览邮件', exact: true }).click();
  const dialog = page.locator('#mail-dialog'); await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox(); expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width);
  expect(await dialog.evaluate(e => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
  const confirm = page.getByRole('button', { name: '确认发送', exact: true }); await confirm.scrollIntoViewIfNeeded();
  const button = await confirm.boundingBox(); expect(button.height).toBeGreaterThanOrEqual(44); expect(button.y + button.height).toBeLessThan(844);
  await page.screenshot({ path: info.outputPath(`mail-mobile-${width}.png`) });
});
