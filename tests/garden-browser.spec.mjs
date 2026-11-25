import { test, expect } from './ui-test.mjs';

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
    if (viewport.width > 700) {
      await expect(page.locator('.garden-memory')).toBeVisible();
      await expect(page.locator('#garden-companion .pet-companion')).toBeVisible();
    } else {
      await expect(page.locator('.chat-aside')).toBeHidden();
      await expect(page.locator('.persona-summary')).toBeHidden();
      await expect(page.locator('.garden-memory')).toBeHidden();
    }
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
  await nav(page, '设置').click();
  await page.getByRole('button', { name: '夜雨', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-garden-theme', 'night');
  await page.getByRole('button', { name: '原有风格', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-ui-style', 'classic');
  await nav(page, '对话').click();
  await page.locator('.garden-memory [data-garden-action="scenes"]').click();
  await expect(page.locator('body')).toHaveClass(/scene-paused/);
  await nav(page, '知识库').click();
  await nav(page, '对话').click();
  await expect(page.locator('#chat-input')).toHaveValue('切换主题时保留这句话。');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-garden-theme', 'night');
  await expect(page.locator('html')).toHaveAttribute('data-ui-style', 'classic');
  await expect(page.locator('.garden-memory [role="switch"]')).toHaveAttribute('aria-checked', 'false');
  expect(writes).toEqual([]);
});

test('long chat auto-hides composer on upward scroll, pins on upward arrow click, and hides on hide button', async ({ page, request }) => {
  const persona = await fresh(page, request, '对话框折叠联调');
  const { conversation } = await (await request.post('/api/conversations', { data: { personaId: persona.id, title: '长对话折叠验证' } })).json();
  for (let i = 1; i <= 7; i++) {
    await request.post(`/api/conversations/${conversation.id}/messages`, {
      data: { content: `第 ${i} 轮长对话内容，用来撑开消息列表高度，验证向上滑动时自动隐藏输入框与展开固定交互。` }
    });
  }
  await page.getByRole('button', { name: '刷新本地数据', exact: true }).click();
  await page.getByRole('button', { name: '历史对话', exact: true }).click();
  await page.locator(`.history-item[data-id="${conversation.id}"]`).click();
  await expect(page.locator('#editor-dialog')).not.toBeVisible();
  await expect(page.locator('.message')).toHaveCount(14);

  const composer = page.locator('#composer-wrap');
  const showBtn = page.locator('#chat-composer-show');
  const hideBtn = page.locator('#chat-composer-hide');
  const pinTag = page.locator('#chat-composer-pin-tag');
  const panel = page.locator('#chat-panel');

  // 初始状态：输入框显示，向上箭头隐藏
  await expect(composer).toBeVisible();
  await expect(showBtn).toBeHidden();
  await expect(panel).toHaveAttribute('data-composer-state', 'default');

  // 确认消息列表确实够长可以滚动，再向上滑动触发自动隐藏
  const scrollInfo = await page.evaluate(() => {
    const list = document.querySelector('#chat-messages');
    const maxScroll = list.scrollHeight - list.clientHeight;
    list.scrollTop = maxScroll;
    return { maxScroll, scrollTop: list.scrollTop };
  });
  expect(scrollInfo.maxScroll).toBeGreaterThan(120);

  await page.evaluate(() => {
    const list = document.querySelector('#chat-messages');
    list.scrollTop = Math.max(0, list.scrollTop - 260);
    list.dispatchEvent(new Event('scroll'));
  });
  await expect(composer).toBeHidden();
  await expect(showBtn).toBeVisible();
  await expect(panel).toHaveAttribute('data-composer-state', 'hidden');

  // 点击向上箭头：展开并固定输入框
  await showBtn.click();
  await expect(composer).toBeVisible();
  await expect(showBtn).toBeHidden();
  await expect(pinTag).toBeVisible();
  await expect(panel).toHaveAttribute('data-composer-state', 'pinned');

  // 固定后无论上下滚动，输入框都保持固定不隐藏
  await page.evaluate(() => {
    const list = document.querySelector('#chat-messages');
    list.scrollTop = Math.max(0, list.scrollTop - 220);
    list.dispatchEvent(new Event('scroll'));
  });
  await expect(composer).toBeVisible();
  await expect(panel).toHaveAttribute('data-composer-state', 'pinned');

  await page.evaluate(() => {
    const list = document.querySelector('#chat-messages');
    list.scrollTop = list.scrollHeight;
    list.dispatchEvent(new Event('scroll'));
    list.scrollTop = Math.max(0, list.scrollTop - 300);
    list.dispatchEvent(new Event('scroll'));
  });
  await expect(composer).toBeVisible();
  await expect(pinTag).toBeVisible();

  // 点击手动「隐藏」键：隐藏输入框并重新出现向上箭头
  await hideBtn.click();
  await expect(composer).toBeHidden();
  await expect(showBtn).toBeVisible();
  await expect(panel).toHaveAttribute('data-composer-state', 'hidden');

  // 再次点击向上箭头仍可重新展开并固定
  await showBtn.click();
  await expect(composer).toBeVisible();
  await expect(panel).toHaveAttribute('data-composer-state', 'pinned');
});

test('group chat sitcom creates room, relays between personas, supports narrator/continue/silence, and links remember-reply to speaker', async ({ page, request }) => {
  const p2 = await fresh(page, request, '林晚');
  const boot = await (await request.get('/api/bootstrap')).json();
  const p1 = boot.personas.find(p => p.id !== p2.id);

  await page.getByRole('button', { name: '新建群聊', exact: true }).click();
  const dlg = page.getByRole('dialog');
  await expect(dlg).toBeVisible();
  await page.locator('#group-title').fill('竹林茶室');
  await page.locator('#group-scenePrompt').fill('春雨细落，大家围炉喝茶聊天。');
  const checks = dlg.locator('input[name="personaIds"]');
  const totalChecks = await checks.count();
  for (let i = 0; i < totalChecks; i++) {
    const val = await checks.nth(i).getAttribute('value');
    const shouldCheck = val === p1.id || val === p2.id;
    if (shouldCheck) await checks.nth(i).check();
    else await checks.nth(i).uncheck();
  }
  await dlg.getByRole('button', { name: '创建并进入群聊', exact: true }).click();
  await expect(dlg).not.toBeVisible();

  await expect(page.locator('#chat-panel')).toHaveClass(/is-group-chat/);
  await expect(page.locator('.group-stage-roster')).toContainText(p1.name);
  await expect(page.locator('.group-stage-roster')).toContainText(p2.name);

  // 发送会触发双人接力的消息
  const assistantMessages = page.locator('.message.assistant:not(#live-reply)');
  await page.locator('#chat-input').fill('互动演示：大家聊聊今晚怎么安排吧。');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(assistantMessages).toHaveCount(2);
  await expect(page.locator('#live-reply')).toHaveCount(0);
  const firstSpeaker = await assistantMessages.nth(0).getAttribute('data-speaker-persona-id');
  const secondSpeaker = await assistantMessages.nth(1).getAttribute('data-speaker-persona-id');
  expect(firstSpeaker).not.toBe(secondSpeaker);
  expect(new Set([firstSpeaker, secondSpeaker])).toEqual(new Set([p1.id, p2.id]));

  // 切换旁白模式发送舞台旁白
  await page.locator('#composer-narrator-toggle').click();
  await expect(page.locator('#chat-form')).toHaveClass(/is-narrator/);
  await page.locator('#chat-input').fill('窗外飘起细雨，茶香渐渐散开。');
  await page.getByRole('button', { name: '发旁白', exact: true }).click();
  await expect(page.locator('.message.narrator')).toContainText('窗外飘起细雨');
  await expect(page.locator('#live-reply')).toHaveCount(0);

  // 点击「继续聊」推进剧情
  const countBeforeContinue = await assistantMessages.count();
  await page.locator('#group-continue-btn').click();
  await expect(async () => {
    expect(await assistantMessages.count()).toBeGreaterThan(countBeforeContinue);
  }).toPass();
  await expect(page.locator('#live-reply')).toHaveCount(0);

  // 发送静默语境触发全员不插话提示
  await page.locator('#composer-narrator-toggle').click(); // 切回普通「我」发言
  await page.locator('#chat-input').fill('静默演示：我先记个备忘，大家不用回复。');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.locator('#group-silence-banner')).toBeVisible();
  await expect(page.locator('#live-reply')).toHaveCount(0);

  // 点击某条群聊回复的「保存记忆」，默认选中该发言角色
  const targetMsg = assistantMessages.last();
  const targetSpeakerId = await targetMsg.getAttribute('data-speaker-persona-id');
  await targetMsg.getByRole('button', { name: '保存记忆', exact: true }).click();
  await expect(page.locator('#memory-personaId')).toHaveValue(targetSpeakerId);
  await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();

  // 重新打开可正常保留群聊且 1v1 切换菜单可用
  await page.locator('#persona-picker-trigger').click();
  await page.locator(`#persona-picker-menu [data-persona-id="${p2.id}"]`).click();
  await expect(page.locator('#chat-panel')).not.toHaveClass(/is-group-chat/);
});

test('custom persona image and emoji avatars persist globally and pet companion canvas survives redraws without twitching', async ({ page, request }) => {
  await fresh(page, request, '墨竹');
  const boot = await (await request.get('/api/bootstrap')).json();
  const p1 = boot.personas.find(p => p.name !== '墨竹');
  const p2 = boot.personas.find(p => p.name === '墨竹');

  // Record existing pet companion canvas identity before interacting
  await expect(page.locator('.pet-companion [data-pet-portrait]')).toHaveAttribute('data-pet-renderer', 'canvas');
  await page.evaluate(() => { window.__petCanvasBeforeRedraw = document.querySelector('.pet-companion canvas'); });

  // Open persona editor directly from the right-side clickable avatar
  await page.locator('.persona-summary .avatar-edit-trigger').click();
  const dlg = page.getByRole('dialog');
  await expect(dlg).toBeVisible();

  // First test preset emoji selection live preview
  await dlg.locator('[data-action="pick-persona-avatar"][data-id="🌙"]').click();
  await expect(dlg.locator('#persona-avatar-preview .avatar.has-emoji')).toHaveText('🌙');

  // Upload a valid 1x1 PNG buffer via setInputFiles -> cropped locally on canvas -> saved as data:image/
  const tinyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR42mP8z8BQzwAEjFAMAA8AAf+L5R4yAAAAAElFTkSuQmCC', 'base64');
  await dlg.locator('#persona-avatar-file').setInputFiles({
    name: 'avatar.png',
    mimeType: 'image/png',
    buffer: tinyPng
  });
  await expect(dlg.locator('#persona-avatar-preview .avatar.has-image img')).toBeVisible();
  await dlg.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect(dlg).not.toBeVisible();

  // Verify image avatar appears across picker trigger, persona summary card, and reply bubble
  await expect(page.locator('#persona-picker-trigger .avatar.has-image img')).toBeVisible();
  await expect(page.locator('.persona-summary .avatar.has-image img')).toBeVisible();

  await page.locator('#chat-input').fill('看看你的新头像');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.locator('#live-reply')).toHaveCount(0);
  await expect(page.locator('.message.assistant .avatar.has-image img').first()).toBeVisible();

  // Trigger a redraw via toggle-chat-status -> pet companion canvas remains exact same node and stored message does not re-animate
  await page.locator('#toggle-chat-status').click();
  expect(await page.evaluate(() => document.querySelector('.pet-companion canvas') === window.__petCanvasBeforeRedraw)).toBe(true);
  await expect(page.locator('.message.assistant').first()).not.toHaveClass(/is-entering/);

  // Create a group with p1 (no image? wait p1 is望舒/墨竹 - verify both p2 image and preset in Personas & group)
  await page.locator('#persona-picker-trigger').click();
  await expect(page.locator(`#persona-picker-menu [data-persona-id="${p2.id}"] .avatar.has-image img`)).toBeVisible();
  await page.locator('#persona-picker-trigger').click();

  await page.getByRole('button', { name: '新建群聊', exact: true }).click();
  const groupDlg = page.getByRole('dialog');
  const checks = groupDlg.locator('input[name="personaIds"]');
  const n = await checks.count();
  for (let i = 0; i < n; i++) {
    const val = await checks.nth(i).getAttribute('value');
    if (val === p1.id || val === p2.id) await checks.nth(i).check();
    else await checks.nth(i).uncheck();
  }
  await groupDlg.getByRole('button', { name: '创建并进入群聊', exact: true }).click();
  await expect(groupDlg).not.toBeVisible();
  await expect(page.locator(`.group-stage-roster [data-id="${p2.id}"] .avatar.has-image img`)).toBeVisible();

  // Also check Personas page avatar display and clear back to default initial
  await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '人设', exact: true }).click();
  await expect(page.locator('.persona-card-head .avatar.has-image img').first()).toBeVisible();
  await page.locator(`.persona-card-head .avatar-edit-trigger[data-id="${p2.id}"]`).click();
  await page.getByRole('dialog').locator('[data-action="clear-persona-avatar"]').click();
  await expect(page.getByRole('dialog').locator('#persona-avatar-preview .avatar')).toHaveText('墨');
  await page.getByRole('dialog').getByRole('button', { name: '保存修改', exact: true }).click();
  await expect(page.locator(`.persona-card-head .avatar-edit-trigger[data-id="${p2.id}"] .avatar`)).toHaveText('墨');
});

test('user can set custom avatar in settings and clicking chat/topbar avatars navigates to target pages', async ({ page, request }) => {
  await fresh(page, request, '阿青');
  const boot = await (await request.get('/api/bootstrap')).json();
  const p = boot.personas.find(item => item.name === '阿青');

  // Click topbar user avatar -> navigates directly to #settings user avatar card
  await page.locator('#topbar-user-avatar').click();
  await expect(page.locator('#settings-user-avatar')).toBeVisible();

  // Pick preset emoji and upload custom PNG, then save
  await page.locator('[data-action="pick-user-avatar"][data-id="🍵"]').click();
  await expect(page.locator('#settings-user-avatar-preview .avatar.has-emoji')).toHaveText('🍵');
  const tinyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR42mP8z8BQzwAEjFAMAA8AAf+L5R4yAAAAAElFTkSuQmCC', 'base64');
  await page.locator('#settings-user-avatar-file').setInputFiles({
    name: 'me.png',
    mimeType: 'image/png',
    buffer: tinyPng
  });
  await expect(page.locator('#settings-user-avatar-preview .avatar.has-image img')).toBeVisible();
  await page.getByRole('button', { name: '保存头像', exact: true }).click();
  await expect(page.locator('#topbar-user-avatar .avatar.has-image img')).toBeVisible();

  // Return to chat and send a message -> both user and persona avatars render and link to target pages
  await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '对话', exact: true }).click();
  await page.locator('#chat-input').fill('你好呀');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.locator('#live-reply')).toHaveCount(0);
  await expect(page.locator('.message.user .avatar.has-image img')).toBeVisible();

  // Clicking user avatar on message navigates to #settings
  await page.locator('.message.user .avatar-link-trigger').click();
  await expect(page.locator('#settings-user-avatar')).toBeVisible();

  // Back to chat, clicking assistant avatar on message navigates to #personas and highlights card
  await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '对话', exact: true }).click();
  await page.locator('.message.assistant .avatar-link-trigger').click();
  await expect(page.locator(`.persona-card[data-persona-card="${p.id}"]`)).toBeVisible();
  await expect(page.locator(`.persona-card[data-persona-card="${p.id}"]`)).toHaveClass(/is-highlighted/);
});


