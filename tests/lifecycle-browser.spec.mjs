import { test, expect } from './ui-test.mjs';

const nav = (page, name) => page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name, exact: true });
const refresh = page => page.getByRole('button', { name: '刷新本地数据', exact: true }).click();
const bootstrap = async request => (await (await request.get('/api/bootstrap')).json());

async function createTask(page, { name, type = 'reminder', schedule = 'once', prompt = '休息一下，喝杯水。', due }) {
  await page.getByRole('button', { name: '创建任务', exact: true }).click();
  await page.getByLabel('任务名称', { exact: true }).fill(name);
  await page.getByLabel('任务类型', { exact: true }).selectOption(type);
  if (type !== 'summarize') await page.locator('#task-prompt').fill(prompt);
  await page.getByLabel('调度方式', { exact: true }).selectOption(schedule);
  if (schedule === 'interval') await page.locator('#task-intervalMinutes').fill('5');
  const localTime = await page.evaluate(time => {
    const date = new Date(time);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  }, due);
  await page.locator('#task-nextRunAt').fill(localTime);
  await page.getByRole('dialog').getByRole('button', { name: '创建任务', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  return page.locator('.task-card').filter({ has: page.getByRole('heading', { name, exact: true }) });
}

async function send(page, content) {
  const before = await page.locator('.message.assistant').count();
  await page.locator('#chat-input').fill(content);
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.locator('.message.assistant')).toHaveCount(before + 1);
  await expect(page.locator('#live-reply')).toHaveCount(0);
}

test.describe('first visit business flow', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('first visit configures explicitly, sends once and reopens history after a service restart', { tag: '@core' }, async ({ page, request, offlineApp: offline }) => {
    await request.put('/api/settings', { data: { model: '', clearApiKey: true } });
    const sentence = '这是完成首次配置后才发送的阅读计划。';
    await test.step('skip the first entrance and retain the unconfigured draft', async () => {
      await page.goto('/');
      await expect(page.locator('#startup-screen')).toHaveClass(/is-active/);
      await page.getByRole('button', { name: '跳过入场', exact: true }).click();
      await page.locator('#chat-input').fill(sentence);
      await page.getByRole('button', { name: '发送', exact: true }).click();
      await expect(page.getByRole('article', { name: '快捷配置消息' })).toBeVisible();
      await expect(page.locator('#chat-input')).toHaveValue(sentence);
      expect(offline.calls.model).toHaveLength(0);
      expect((await bootstrap(request)).conversations).toHaveLength(0);
    });
    await test.step('saving is not testing or sending', async () => {
      await page.getByRole('button', { name: '快捷配置模型', exact: true }).click();
      await page.getByLabel('模型基础地址（Base URL）', { exact: true }).fill('http://127.0.0.1:1');
      await page.getByLabel('模型 ID', { exact: true }).fill('offline-ui-test');
      await page.getByRole('button', { name: '保存快捷配置', exact: true }).click();
      await expect(page.locator('#editor-dialog')).not.toBeVisible();
      expect(offline.calls.model).toHaveLength(0);
      await page.getByRole('button', { name: '测试已保存的连接', exact: true }).click();
      await expect(page.locator('.setup-message .inline-success')).toContainText('离线测试回复');
      expect(offline.calls.model).toHaveLength(1);
      await expect(page.locator('#chat-input')).toHaveValue(sentence);
      await page.getByRole('button', { name: '继续发送', exact: true }).click();
      await expect(page.locator('#chat-messages')).toHaveAttribute('aria-busy', 'false');
      await expect(page.locator('#live-reply')).toHaveCount(0);
      await expect(page.locator('.message.assistant')).toHaveCount(1);
      await expect(page.locator('#chat-input')).toHaveValue('');
      expect(offline.calls.model).toHaveLength(2);
    });
    await test.step('reopen the database and history without another generation', async () => {
      const before = await bootstrap(request);
      await offline.restart();
      await page.reload();
      await expect(page.locator('#startup-screen')).toHaveCount(0);
      await page.getByRole('button', { name: '历史对话', exact: true }).click();
      await page.locator('.history-item').filter({ hasText: sentence.slice(0, 12) }).click();
      await expect(page.locator('.message.user .message-content')).toHaveText(sentence);
      await expect(page.locator('.message.assistant')).toHaveCount(1);
      const after = await bootstrap(request);
      expect(after.conversations.map(row => row.id)).toEqual(before.conversations.map(row => row.id));
      expect(after.settings.model).toBe('offline-ui-test');
      expect(offline.calls.model).toHaveLength(2);
    });
  });
});

test('scheduled reminders run at the boundary, persist and respect disabled state after restart', { tag: '@core' }, async ({ page, request, offlineApp: offline }) => {
  await page.goto('/#tasks');
  const due = Date.now() + 180000;
  const once = await createTask(page, { name: '一次喝水提醒', due });
  const recurring = await createTask(page, { name: '周期伸展提醒', schedule: 'interval', due });
  const initial = await bootstrap(request);
  const time = Date.parse(initial.tasks.find(row => row.name === '一次喝水提醒').nextRunAt);
  await offline.tick(time - 1);
  expect((await bootstrap(request)).runs).toHaveLength(0);
  await offline.tick(time);
  await offline.tick(time);
  await refresh(page);
  await expect(page.locator('.run-item')).toHaveCount(2);
  await expect(once.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  await expect(recurring.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  expect(offline.calls.model).toHaveLength(0);
  const first = await bootstrap(request);
  expect(first.runs.every(run => run.status === 'success')).toBe(true);
  expect(Date.parse(first.tasks.find(row => row.name === '周期伸展提醒').nextRunAt)).toBe(time + 300000);
  await recurring.getByRole('switch').click();
  await expect(recurring.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  await offline.restart();
  await page.reload();
  await expect(page.locator('.run-item')).toHaveCount(2);
  await expect(recurring.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  await offline.tick(time + 600000);
  expect((await bootstrap(request)).runs).toHaveLength(2);
  await recurring.getByRole('switch').click();
  await expect(recurring.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  await offline.tick(time + 600000);
  await offline.tick(time + 600000);
  await refresh(page);
  await expect(page.locator('.run-item')).toHaveCount(3);
  expect((await bootstrap(request)).runs.filter(run => run.taskName === '一次喝水提醒')).toHaveLength(1);
  expect(offline.calls.model).toHaveLength(0);
});

test('AI task failures have durable records and explicit retry succeeds once', async ({ page, request, offlineApp: offline }) => {
  await page.goto('/#tasks');
  const card = await createTask(page, { name: '计划建议', type: 'prompt', prompt: '请列出三项阅读计划。', due: Date.now() + 180000 });
  offline.failNextModel();
  await card.getByRole('button', { name: '立即运行', exact: true }).click();
  await expect(page.locator('.run-item .pill')).toHaveText('失败');
  const failed = await bootstrap(request);
  expect(failed.runs[0].status).toBe('failed');
  expect(failed.runs[0].result.length).toBeGreaterThan(0);
  expect(failed.tasks[0].running).toBe(false);
  await page.reload();
  await expect(page.locator('.run-item .pill')).toHaveText('失败');
  await card.getByRole('button', { name: '立即运行', exact: true }).click();
  await expect(page.locator('.run-item')).toHaveCount(2);
  const retried = await bootstrap(request);
  expect(retried.runs.map(run => run.status).sort()).toEqual(['failed', 'success']);
  expect(offline.calls.model).toHaveLength(2);
  expect(retried.conversations).toHaveLength(0);
  await card.getByRole('button', { name: '删除任务 计划建议', exact: true }).click();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(card).toBeVisible();
});

test('summary task consumes saved conversation once and survives reopening the service', async ({ page, request, offlineApp: offline }) => {
  await page.goto('/#chat');
  await send(page, '正在验证本地 AI 助手的知识库与记忆功能。');
  await nav(page, '任务').click();
  const card = await createTask(page, { name: '晚间记忆整理', type: 'summarize', due: Date.now() + 180000 });
  await card.getByRole('button', { name: '立即运行', exact: true }).click();
  await expect(page.locator('.run-item .pill')).toHaveText('成功');
  const data = await bootstrap(request);
  expect(data.memories).toHaveLength(1);
  expect(offline.calls.model).toHaveLength(2);
  await card.getByRole('button', { name: '立即运行', exact: true }).click();
  await expect(page.locator('.run-item')).toHaveCount(2);
  const repeated = await bootstrap(request);
  expect(repeated.runs.every(run => run.status === 'success')).toBe(true);
  expect(repeated.runs.find(run => run.id !== data.runs[0].id)).toMatchObject({ result: '已处理 0 条消息，新增 0 条记忆。' });
  expect(offline.calls.model).toHaveLength(2);
  await offline.restart();
  await page.reload();
  await expect(page.locator('.run-item')).toHaveCount(2);
  expect((await bootstrap(request)).runs).toEqual(repeated.runs);
  await nav(page, '记忆').click();
  await expect(page.locator('.memory-card')).toContainText('用户正在验证本地 AI 助手的知识库与记忆功能。');
  expect((await bootstrap(request)).memories.map(row => row.id)).toEqual(data.memories.map(row => row.id));
});

test('music and email require explicit action and transport sends exactly once', { tag: '@core' }, async ({ page, request, offlineApp: offline }) => {
  await request.put('/api/media/settings', { data: { musicBaseUrl: 'http://music-fixture.invalid', musicSource: 'qq', musicEnabled: true } });
  await request.put('/api/mail/settings', { data: { host: 'smtp-fixture.invalid', port: 587, security: 'starttls', user: 'sender@example.com', password: 'offline-only', from: 'sender@example.com' } });
  await page.goto('/#chat');
  await send(page, '播放《安静片刻》');
  const audio = page.locator('#background-audio');
  await expect(page.getByRole('button', { name: '播放这首歌', exact: true })).toBeVisible();
  await expect(audio).toHaveJSProperty('paused', true);
  expect(offline.calls.media.filter(call => /\/(stream|local_play)/.test(call.url))).toHaveLength(0);
  expect(offline.calls.mail).toHaveLength(0);
  await page.getByRole('button', { name: '播放这首歌', exact: true }).click();
  await expect(audio).toHaveJSProperty('paused', false);
  expect(offline.calls.media.some(call => /\/(stream|local_play)/.test(call.url))).toBe(true);
  await page.getByRole('button', { name: '写成邮件', exact: true }).click();
  await page.getByLabel('收件人', { exact: true }).fill('reader@example.com');
  await page.getByLabel('主题', { exact: true }).fill('确认后才寄出的音乐便笺');
  await page.getByRole('button', { name: '预览邮件', exact: true }).click();
  await expect(page.getByRole('heading', { name: '发送前，再读一遍' })).toBeVisible();
  expect(offline.calls.mail).toHaveLength(0);
  await page.getByRole('button', { name: '返回修改', exact: true }).click();
  await page.getByLabel('正文', { exact: true }).fill('这封测试邮件只会送到离线替身。');
  await page.getByRole('button', { name: '预览邮件', exact: true }).click();
  await page.getByRole('button', { name: '确认发送', exact: true }).click();
  await expect(page.locator('.mail-result')).toContainText('服务器已接受');
  expect(offline.calls.mail).toHaveLength(1);
  expect(offline.calls.mail[0].text).toBe('这封测试邮件只会送到离线替身。');
  await page.getByRole('button', { name: '关闭邮件面板', exact: true }).click();
  await offline.restart();
  await page.reload();
  await expect(audio).toHaveJSProperty('paused', true);
  await nav(page, '设置').click();
  await page.getByRole('button', { name: '查看发送记录', exact: true }).click();
  await expect(page.locator('.mail-history-item')).toContainText('确认后才寄出的音乐便笺');
  expect(offline.calls.mail).toHaveLength(1);
});

test('a failed chat retains its draft and retry persists exactly one pair', { tag: '@core' }, async ({ page, request, offlineApp: offline }) => {
  await page.goto('/#chat');
  const content = '失败后仍能编辑的读书安排。';
  offline.failNextModel();
  await page.locator('#chat-input').fill(content);
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.locator('.composer-wrap [role="alert"]')).toContainText('HTTP 503');
  await expect(page.locator('#chat-messages')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('#chat-input')).toHaveValue(content);
  await expect(page.locator('#live-reply')).toHaveCount(0);
  const data = await bootstrap(request);
  expect(data.conversations).toHaveLength(1);
  expect((await (await request.get(`/api/conversations/${data.conversations[0].id}`)).json()).messages).toHaveLength(0);
  await send(page, content);
  await expect(page.locator('.message.user')).toHaveCount(1);
  expect(offline.calls.model).toHaveLength(2);
  const saved = await (await request.get(`/api/conversations/${data.conversations[0].id}`)).json();
  expect(saved.messages.map(row => row.role)).toEqual(['user', 'assistant']);
});
