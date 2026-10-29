import { test, expect } from '@playwright/test';

const nav = (page, name) => page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name, exact: true });

async function fresh(page, request, name) {
  const { persona } = await (await request.post('/api/personas', { data: { name, description: '用于验证园林工作台的真实数据联动。', systemPrompt: '清晰简洁地回答。' } })).json();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/#chat');
  await page.getByLabel('选择聊天角色', { exact: true }).selectOption(persona.id);
  return persona;
}

for (const viewport of [{ width: 1366, height: 768 }, { width: 1280, height: 720 }, { width: 1024, height: 768 }, { width: 390, height: 844 }]) {
  test(`garden overview fits ${viewport.width} x ${viewport.height} with a fixed composer`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: '今天，聊点什么？' })).toBeVisible();
    const layout = await page.evaluate(() => ({
      pageFits: document.documentElement.scrollHeight <= innerHeight && document.documentElement.scrollWidth <= innerWidth,
      clipped: [...document.querySelectorAll('.chat-aside,.persona-summary,.garden-memory,.composer-wrap')].filter(el => el.clientHeight && (el.scrollHeight > el.clientHeight + 2 || el.scrollWidth > el.clientWidth + 2)).map(el => el.className),
      composerBottom: document.querySelector('.composer-wrap').getBoundingClientRect().bottom,
      scrolling: getComputedStyle(document.querySelector('#chat-messages')).overflowY,
    }));
    expect(layout.pageFits).toBe(true);
    expect(layout.clipped).toEqual([]);
    expect(layout.composerBottom).toBeLessThanOrEqual(viewport.height);
    expect(layout.scrolling).toBe('auto');
    await expect(page.locator('.garden-memory')).toBeVisible();
    if (viewport.width > 700) await expect(page.locator('#garden-companion .pet-companion')).toBeVisible();
  });
}

test('saving a reply creates a reviewed memory and refreshes the real dashboard count', async ({ page, request }) => {
  const persona = await fresh(page, request, '园林记忆联调');
  await expect(page.locator('[data-memory-count="active"]')).toHaveText('0');
  await page.locator('#chat-input').fill('请帮我整理今天的阅读计划。');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  const reply = page.locator('.message.assistant').last();
  await expect(reply).toContainText('这是离线测试回复');
  await reply.getByRole('button', { name: '保存记忆', exact: true }).click();
  await expect(page.locator('#memory-content')).toHaveValue(/这是离线测试回复/);
  let data = await (await request.get('/api/bootstrap')).json();
  expect(data.memories.filter(m => m.personaId === persona.id)).toHaveLength(0);
  await page.locator('#memory-content').fill('我喜欢在晚上安排半小时阅读。');
  await page.getByRole('dialog').getByRole('button', { name: '添加记忆', exact: true }).click();
  await expect(page.locator('#editor-dialog')).not.toBeVisible();
  await expect(page.locator('[data-memory-count="active"]')).toHaveText('1');
  data = await (await request.get('/api/bootstrap')).json();
  expect(data.memories.find(m => m.personaId === persona.id).content).toBe('我喜欢在晚上安排半小时阅读。');
});

test('history is paginated and opens stored messages without calling the model again', async ({ page, request }) => {
  const persona = await fresh(page, request, '园林历史联调');
  let stored;
  for (let i = 0; i < 10; i++) {
    const { conversation } = await (await request.post('/api/conversations', { data: { personaId: persona.id, title: `历史记录 ${i}` } })).json();
    if (i === 9) { stored = conversation; await request.post(`/api/conversations/${conversation.id}/messages`, { data: { content: '历史记录中的消息' } }); }
  }
  await page.getByRole('button', { name: '刷新本地数据', exact: true }).click();
  let modelCalls = 0;
  page.on('request', req => { if (req.method() === 'POST' && /\/messages$/.test(req.url())) modelCalls++; });
  await page.getByRole('button', { name: '历史对话', exact: true }).click();
  await expect(page.locator('#editor-dialog .history-item')).toHaveCount(8);
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(page.locator('#editor-dialog .history-item')).toHaveCount(2);
  await page.getByRole('button', { name: '上一页', exact: true }).click();
  await page.locator(`.history-item[data-id="${stored.id}"]`).click();
  await expect(page.locator('#editor-dialog')).not.toBeVisible();
  await expect(page.locator('.message.user')).toContainText('历史记录中的消息');
  await expect(page.locator('.message.assistant')).toContainText('这是离线测试回复');
  expect(modelCalls).toBe(0);
});

test('appearance preferences persist without mutating service settings or losing the draft', async ({ page, request }) => {
  await fresh(page, request, '园林外观联调');
  const writes = [];
  page.on('request', req => { if (req.method() !== 'GET') writes.push(req.url()); });
  await page.locator('#chat-input').fill('切换主题时保留这句话。');
  await page.getByRole('button', { name: '夜雨', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-garden-theme', 'night');
  await page.locator('.garden-memory [data-garden-action="scenes"]').click();
  await expect(page.locator('body')).toHaveClass(/scene-paused/);
  await nav(page, '知识库').click();
  await nav(page, '对话').click();
  await expect(page.locator('#chat-input')).toHaveValue('切换主题时保留这句话。');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-garden-theme', 'night');
  await expect(page.locator('.garden-memory [role="switch"]')).toHaveAttribute('aria-checked', 'false');
  expect(writes).toEqual([]);
});
