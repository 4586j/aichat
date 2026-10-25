import { test, expect } from '@playwright/test';

const nav = (page, name) => page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name, exact: true });

test('six pages complete the offline AI, knowledge, memory and task workflow', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '让思绪，有处栖息。' })).toBeVisible();
  await expect(page.getByText('本地服务已连接', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('desktop-welcome.png'), fullPage: true });

  await nav(page, '人设工坊').click();
  await page.getByRole('button', { name: '创建角色', exact: true }).click();
  await page.getByLabel('角色名称', { exact: true }).fill('测试搭档');
  await page.getByLabel('简介', { exact: true }).fill('一位清晰可靠的项目助手');
  await page.getByLabel('说话语气', { exact: true }).fill('简洁、有条理');
  await page.getByLabel('人设系统提示词', { exact: true }).fill('你是一位专注项目规划的 AI 助手。');
  await page.getByRole('button', { name: '确认创建角色', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  const roleCard = page.locator('.persona-card').filter({ has: page.getByRole('heading', { name: '测试搭档', exact: true }) });
  await expect(roleCard).toBeVisible();
  await roleCard.getByRole('button', { name: '编辑', exact: true }).click();
  await page.getByLabel('开场白', { exact: true }).fill('我们来整理一下项目计划。');
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.locator('#analysis-target').fill('小林');
  await page.locator('#analysis-text').fill('小林：请简洁一点。\n我：好的，我们按步骤整理。');
  await page.getByRole('button', { name: '分析聊天记录', exact: true }).click();
  await expect(page.getByRole('heading', { name: '分析预览 · 小林' })).toBeVisible();
  await expect(page.getByText('尚未创建角色', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '编辑草稿并确认创建', exact: true }).click();
  await expect(page.getByLabel('人设系统提示词', { exact: true })).toHaveValue(/简洁/);
  await page.getByRole('button', { name: '确认创建角色', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByRole('heading', { name: '小林', exact: true })).toBeVisible();

  await nav(page, '知识库').click();
  await page.locator('#document-files').setInputFiles({ name: '项目资料.txt', mimeType: 'text/plain', buffer: Buffer.from('项目资料：栖忆支持人设、知识库、长期记忆和定时任务。茉莉茶适合午后休息时饮用。') });
  await expect(page.locator('.document-row').filter({ hasText: '项目资料.txt' })).toBeVisible();
  await page.getByLabel('你想查找什么？', { exact: true }).fill('项目资料 长期记忆');
  await page.getByRole('button', { name: '检索资料', exact: true }).click();
  await expect(page.locator('.search-result .evidence-item')).toHaveCount(1);
  await expect(page.locator('.search-result')).toContainText('块 1');

  await nav(page, '记忆').click();
  await page.getByRole('button', { name: '添加记忆', exact: true }).click();
  await page.locator('#memory-personaId').selectOption({ label: '望舒' });
  await page.getByLabel('记忆内容', { exact: true }).fill('用户喜欢在午后喝茉莉茶。');
  await page.getByLabel('类别', { exact: true }).selectOption('preference');
  await page.getByRole('dialog').getByRole('button', { name: '添加记忆', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  let memory = page.locator('.memory-card').filter({ hasText: '用户喜欢在午后喝茉莉茶。' });
  await memory.getByRole('button', { name: '固定', exact: true }).click();
  await expect(memory.getByText('固定保留', { exact: true })).toBeVisible();
  await memory.getByRole('button', { name: '归档', exact: true }).click();
  await expect(memory).toHaveCount(0);
  await page.getByLabel('记忆状态', { exact: true }).selectOption('archived');
  await memory.getByRole('button', { name: '恢复', exact: true }).click();
  await page.getByLabel('记忆状态', { exact: true }).selectOption('active');
  await expect(memory).toBeVisible();

  await nav(page, '对话').click();
  await page.getByLabel('选择聊天角色', { exact: true }).selectOption({ label: '望舒' });
  await page.getByLabel('发送给当前角色的消息', { exact: true }).fill('请根据项目资料说明长期记忆功能，顺便提醒我午后喝茉莉茶。');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.locator('.message.assistant')).toContainText('这是离线测试回复');
  await expect(page.getByLabel('发送给当前角色的消息', { exact: true })).toHaveValue('');
  await page.locator('summary').filter({ hasText: '知识来源' }).click();
  await expect(page.locator('.message.assistant .evidence-items').first()).toContainText('项目资料.txt');
  await page.locator('summary').filter({ hasText: '记忆依据' }).click();
  await expect(page.locator('.message.assistant')).toContainText('用户喜欢在午后喝茉莉茶。');
  expect(await page.locator('.toast').count()).toBeLessThanOrEqual(3);
  while (await page.getByRole('button', { name: '关闭通知', exact: true }).count()) await page.getByRole('button', { name: '关闭通知', exact: true }).first().click();
  await page.evaluate(() => { window.scrollTo({ top: 0, behavior: 'instant' }); document.querySelector('#chat-messages').scrollTop = 0; });
  await page.screenshot({ path: testInfo.outputPath('desktop-chat.png'), fullPage: true });

  await nav(page, '记忆').click();
  await page.getByRole('button', { name: '手动总结', exact: true }).click();
  await page.getByRole('button', { name: '确认并开始总结', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.locator('.memory-card').filter({ hasText: '用户正在验证本地 AI 助手的知识库与记忆功能。' })).toBeVisible();
  await page.getByRole('button', { name: '整理维护', exact: true }).click();
  await expect(page.getByText(/维护完成：归档/)).toBeVisible();

  await nav(page, '定时任务').click();
  await page.getByRole('button', { name: '创建任务', exact: true }).click();
  await page.getByLabel('任务名称', { exact: true }).fill('午后喝茶提醒');
  await page.locator('#task-prompt').fill('休息一下，喝一杯茉莉茶。');
  await page.getByLabel('调度方式', { exact: true }).selectOption('interval');
  await page.locator('#task-intervalMinutes').fill('60');
  await page.getByRole('dialog').getByRole('button', { name: '创建任务', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  const taskCard = page.locator('.task-card').filter({ hasText: '午后喝茶提醒' });
  await taskCard.getByRole('button', { name: '立即运行', exact: true }).click();
  await expect(page.locator('.run-item')).toHaveCount(1);
  await page.locator('.run-item summary').click();
  await expect(page.locator('.run-result')).toHaveText('休息一下，喝一杯茉莉茶。');
  await taskCard.getByRole('switch').click();
  await expect(taskCard.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  await page.reload();
  await expect(page.locator('.task-card').filter({ hasText: '午后喝茶提醒' })).toBeVisible();
  await expect(page.locator('.run-item')).toHaveCount(1);

  await nav(page, '设置').click();
  await page.getByLabel('模型名称', { exact: true }).fill('offline-ui-test');
  await page.locator('#settings-memoryMessageThreshold').fill('30');
  await page.getByRole('button', { name: '保存设置', exact: true }).click();
  await expect(page.getByText('设置已保存。不会自动发送模型测试。', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '测试已保存的连接', exact: true }).click();
  await expect(page.locator('.inline-success')).toContainText('离线测试回复');
  expect(errors).toEqual([]);
});

test('unconfigured model preserves the first draft and shows one local setup message', async ({ page, request }) => {
  await request.put('/api/settings', { data: { model: '' } });
  try {
    await page.goto('/#chat');
    await page.getByLabel('发送给当前角色的消息', { exact: true }).fill('这是一条失败后应该保留的草稿');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect(page.getByRole('article', { name: '快捷配置消息' })).toContainText('本地配置助手');
    await expect(page.locator('.composer-wrap .inline-error')).toHaveCount(0);
    await expect(page.getByLabel('发送给当前角色的消息', { exact: true })).toHaveValue('这是一条失败后应该保留的草稿');
    await expect(page.locator('.message')).toHaveCount(0);
  } finally { await request.put('/api/settings', { data: { model: 'offline-ui-test' } }); }
});

test('mobile pages do not overflow; empty search and invalid uploads are clear', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  for (const name of ['对话', '人设工坊', '知识库', '记忆', '定时任务', '设置']) {
    await nav(page, name).click();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await nav(page, '知识库').click();
  await page.getByLabel('你想查找什么？', { exact: true }).fill('nonexistentxyz');
  await page.getByRole('button', { name: '检索资料', exact: true }).click();
  await expect(page.getByRole('heading', { name: '暂未找到相关片段' })).toBeVisible();
  await page.locator('#document-files').setInputFiles({ name: 'invalid.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('invalid') });
  await expect(page.locator('.inline-error')).toContainText('不支持该格式');
  await nav(page, '对话').click();
  await page.screenshot({ path: testInfo.outputPath('mobile-chat.png'), fullPage: true });
  expect(errors).toEqual([]);
});
