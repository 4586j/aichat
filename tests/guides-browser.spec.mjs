import { test, expect } from '@playwright/test';

const setupPage = async page => { await page.goto('/#settings'); await expect(page.getByRole('button', { name: '配置指南', exact: true })).toBeVisible(); };
const topic = (page, title) => page.getByRole('navigation', { name: '配置指南目录' }).getByRole('button', { name: title, exact: true });

test('six offline guides remain readable before a model is configured, with no automatic network action', async ({ page, request }) => {
  const old = (await (await request.get('/api/settings')).json()).settings;
  await request.put('/api/settings', { data: { model: '' } });
  const calls = []; page.on('request', r => { if (/\/api\/(guides\/sync|settings\/test|music\/status|mail\/verify|mail\/send)$/.test(r.url())) calls.push(r.url()); });
  try {
    await setupPage(page); await page.getByRole('button', { name: '配置指南', exact: true }).click();
    await expect(page.locator('.guide-document')).toContainText('首次启动与配置顺序');
    for (const name of ['模型连接与 API Key', '本地表情包与联网补充', '音乐平台与背景播放', '邮件、SMTP 与授权码', '常见问题与排查']) {
      await topic(page, name).click(); await expect(page.locator('.guide-document > h2')).toHaveText(name);
    }
    await expect(page.getByRole('button', { name: '带到聊天中询问', exact: true })).toBeDisabled(); expect(calls).toHaveLength(0);
    await page.getByRole('button', { name: '关闭配置指南', exact: true }).click();
    await page.getByLabel('模型名称', { exact: true }).fill('offline-ui-test');
    await page.getByRole('button', { name: '保存设置', exact: true }).click(); await expect(page.getByLabel('模型名称', { exact: true })).toBeEnabled();
    await page.getByRole('button', { name: '配置指南', exact: true }).click();
    await expect(page.getByRole('button', { name: '带到聊天中询问', exact: true })).toBeEnabled();
  } finally { await request.put('/api/settings', { data: { model: old.model, baseUrl: old.baseUrl } }); }
});

test('guide question enters an editable chat draft, sends on user action, and retains cited sources on reload', async ({ page, request }) => {
  const { persona } = await (await request.post('/api/personas', { data: { name: '配置帮助测试', systemPrompt: '根据资料简洁回答。' } })).json();
  await page.goto(`/?guides=${persona.id}#chat`); await page.getByLabel('选择聊天角色', { exact: true }).selectOption(persona.id);
  await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '邮件、SMTP 与授权码', exact: true }).click();
  await expect(page.locator('.guide-document')).toContainText('SMTP 密码 / 邮箱授权码');
  await page.getByLabel('想向 AI 询问的配置问题', { exact: true }).fill('授权码填写在哪里？');
  let sends = 0; page.on('request', r => { if (/\/api\/conversations\/[^/]+\/messages$/.test(r.url())) sends++; });
  await page.getByRole('button', { name: '带到聊天中询问', exact: true }).click();
  await expect(page.locator('#guides-dialog')).not.toBeVisible(); await expect(page.locator('#chat-input')).toHaveValue(/授权码填写在哪里/); expect(sends).toBe(0);
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.locator('.message.assistant')).toContainText('根据栖忆配置指南'); expect(sends).toBe(1);
  await page.locator('.message.assistant .evidence-group summary').first().click();
  await expect(page.locator('.guide-source-label').first()).toContainText('修订');
  await page.getByRole('button', { name: '阅读本机指南', exact: true }).first().click();
  await expect(page.locator('.guide-document')).toContainText('邮件、SMTP 与授权码');
  await page.getByRole('button', { name: '关闭配置指南', exact: true }).click();
  await page.reload(); await page.getByLabel('选择聊天角色', { exact: true }).selectOption(persona.id);
  await page.getByRole('button', { name: '历史对话', exact: true }).click(); await page.locator('.history-item').filter({ hasText: '请根据栖忆配置指南' }).click();
  await expect(page.locator('.message.assistant')).toContainText('根据栖忆配置指南');
  await page.locator('.message.assistant .evidence-group summary').first().click(); await expect(page.locator('.guide-source-label').first()).toContainText('修订');
});

test('GitHub refresh is explicit, cached and recoverable after an unavailable remote response', async ({ page }) => {
  await setupPage(page); await page.getByRole('button', { name: '配置指南', exact: true }).click();
  let calls = 0; page.on('request', r => { if (r.url().endsWith('/api/guides/sync')) calls++; });
  await page.route('**/api/guides/sync', route => route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'GitHub 文档不可读取，继续使用现有指南。' }) }));
  await page.getByRole('button', { name: '从 GitHub 更新指南', exact: true }).click(); await expect(page.locator('.guide-feedback')).toContainText('继续使用现有指南');
  await topic(page, '音乐平台与背景播放').click(); await expect(page.locator('.guide-document')).toContainText('音乐服务地址');
  await page.unroute('**/api/guides/sync');
  await page.getByRole('button', { name: '从 GitHub 更新指南', exact: true }).click(); await expect(page.locator('.guide-feedback')).toContainText('已更新');
  await expect(page.locator('#guides-dialog .dialog-header')).toContainText('GitHub 本地副本'); expect(calls).toBe(2);
});

test('rapid topic selection keeps the latest topic and escaped text cannot execute HTML', async ({ page }) => {
  let release, seen; const gate = new Promise(r => { release = r; }), observed = new Promise(r => { seen = r; });
  await page.route('**/api/guides/model', async route => { seen(); await gate; await route.continue(); });
  await setupPage(page); await page.getByRole('button', { name: '配置指南', exact: true }).click(); await expect(page.locator('.guide-document > h2')).toBeVisible();
  await topic(page, '模型连接与 API Key').click(); await observed; await topic(page, '音乐平台与背景播放').click();
  await expect(page.locator('.guide-document > h2')).toHaveText('音乐平台与背景播放'); release();
  await page.route('**/api/guides/email', async route => { const response = await route.fetch(); const data = await response.json(); data.document.content += '\n\n<script>window.guideInjected=true</script><img src=x onerror="window.guideInjected=true">'; await route.fulfill({ json: data }); });
  await topic(page, '邮件、SMTP 与授权码').click(); await expect(page.locator('.guide-document')).toContainText('<script>');
  expect(await page.evaluate(() => window.guideInjected)).toBeUndefined(); await expect(page.locator('.guide-document script, .guide-document img')).toHaveCount(0);
});

for (const width of [320, 390]) test(`guide reading and question drafting fit a ${width}px phone`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 844 }); await setupPage(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: '邮件、SMTP 与授权码', exact: true }).click();
  await expect(page.locator('.guide-document > h2')).toHaveText('邮件、SMTP 与授权码');
  const dialog = page.locator('#guides-dialog'); expect(await dialog.evaluate(e => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
  await page.getByLabel('想向 AI 询问的配置问题', { exact: true }).fill('手机端邮件怎么配置？');
  await page.getByRole('button', { name: '带到聊天中询问', exact: true }).scrollIntoViewIfNeeded();
  const box = await page.getByRole('button', { name: '带到聊天中询问', exact: true }).boundingBox(); expect(box.height).toBeGreaterThanOrEqual(40); expect(box.x + box.width).toBeLessThan(width);
  await page.screenshot({ path: info.outputPath(`guides-mobile-${width}.png`) });
});
