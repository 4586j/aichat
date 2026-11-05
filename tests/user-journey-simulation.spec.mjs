import { test, expect } from './ui-test.mjs';

const nav = (page, name) =>
  page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name, exact: true });

test.describe('栖忆 (QiYi) 真实用户全链路操作模拟测试套件', () => {
  test('场景 1：设置工作台、Agent/Critic 参数修改检测与古典园林三主题（春园/秋庭/夜雨）视觉切换验证', async ({ page, request }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/#settings');

    // 验证 01 模型连接、02 记忆设置、03 Agent 推理与指令安全、04 园林外观与主题四大分区完整渲染
    await expect(page.getByRole('heading', { name: /模型连接/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: /记忆设置/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Agent 推理与指令安全/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: /园林外观与主题/ })).toBeVisible();

    // 修改 Agent 与 Critic 配置并验证脏状态提示与持久化
    await page.locator('#settings-agentMaxSteps').fill('15');
    await page.locator('#settings-criticMaxRetries').fill('2');
    await page.locator('#settings-criticEnabled').selectOption('false');
    await expect(page.locator('.settings-actions > .muted')).toContainText('有尚未保存的修改');

    await page.getByRole('button', { name: '保存设置', exact: true }).click();
    await expect(page.locator('.settings-actions > .muted')).toContainText('配置来自本地服务');

    const { settings } = await (await request.get('/api/settings')).json();
    expect(settings.agentMaxSteps).toBe(15);
    expect(settings.criticMaxRetries).toBe(2);
    expect(settings.criticEnabled).toBe(false);

    // 重新开启 Critic 供后续场景测试
    await page.locator('#settings-criticEnabled').selectOption('true');
    await page.locator('#settings-criticMaxRetries').fill('1');
    await page.getByRole('button', { name: '保存设置', exact: true }).click();

    // 切换秋庭与夜雨主题，验证 CSS 变量继承且无刺眼纯白背景泄露
    await page.getByRole('button', { name: '秋庭', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-garden-theme', 'autumn');

    await page.getByRole('button', { name: '夜雨', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-garden-theme', 'night');

    const nightColors = await page.evaluate(() => {
      const cardBg = getComputedStyle(document.querySelector('.settings-card')).backgroundColor;
      const bodyBg = getComputedStyle(document.body).backgroundColor;
      return { cardBg, bodyBg };
    });
    expect(nightColors.cardBg).not.toBe('rgb(255, 255, 255)');
    expect(nightColors.bodyBg).not.toBe('rgb(255, 255, 255)');

    // 切回春园
    await page.getByRole('button', { name: '春园', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-garden-theme', 'spring');
  });

  test('场景 2：人设创建、双轨古典角色切换器与“当前状态”折叠面板交互', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/#personas');

    // 创建新角色
    await page.getByRole('button', { name: '创建角色', exact: true }).click();
    await expect(page.locator('#editor-dialog')).toBeVisible();
    await page.locator('#persona-name').fill('云舒');
    await page.locator('#persona-tone').fill('清朗、严谨、善用工具');
    await page.locator('#persona-description').fill('专注架构设计与多步推理的技术伴侣。');
    await page.locator('#persona-systemPrompt').fill('你是云舒，严谨温和地协助用户分析问题。');
    await page.locator('#editor-form button[type="submit"]').click();
    await expect(page.locator('#editor-dialog')).not.toBeVisible();

    // 点击“开始对话”跳转到对话页
    const yunshuCard = page.locator('.persona-card').filter({ hasText: '云舒' });
    await expect(yunshuCard).toBeVisible();
    await yunshuCard.getByRole('button', { name: '开始对话', exact: true }).click();

    await expect(page).toHaveURL(/#chat$/);
    await expect(page.locator('#persona-picker-trigger')).toContainText('云舒');

    // 验证“当前状态”按钮位于“当前对话”左侧且支持展开与折叠切换
    const toggleBtn = page.locator('#toggle-chat-status');
    const statusDrawer = page.locator('#chat-status-drawer');
    await expect(toggleBtn).toBeVisible();

    // 在 WebDriver 下若初始为展开，点击一次折叠隐藏，再点击一次展开显示
    if ((await toggleBtn.getAttribute('aria-expanded')) === 'true') {
      await toggleBtn.click();
    }
    await expect(toggleBtn).toHaveAttribute('aria-expanded', 'false');
    await expect(statusDrawer).toBeHidden();

    // 点击“当前状态”展开状态栏
    await toggleBtn.click();
    await expect(toggleBtn).toHaveAttribute('aria-expanded', 'true');
    await expect(statusDrawer).toBeVisible();

    // 打开状态调整对话框并关闭，确认无幽灵拦截层
    await statusDrawer.locator('[data-state-action="open"]').click();
    await expect(page.locator('#chat-state-dialog')).toBeVisible();
    await page.locator('#chat-state-dialog [data-state-action="close"]').click();
    await expect(page.locator('#chat-state-dialog')).toBeHidden();
  });

  test('场景 3：聊天框剪贴板粘贴文件、附件预览弹窗、多轮 ReAct 工具调用 + Critic 审核反思与思考过程持久化', async ({ page, request }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/#chat');

    // 模拟用户在聊天输入框直接粘贴文件 (ClipboardEvent paste)
    await page.evaluate(() => {
      const input = document.querySelector('#chat-input');
      input.focus();
      const fileContent = JSON.stringify({ baseMetric: 128, growthFactor: 1.25 }, null, 2);
      const file = new File([fileContent], 'metrics.json', { type: 'application/json' });
      const dt = new DataTransfer();
      dt.items.add(file);
      const pasteEvent = new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: dt
      });
      input.dispatchEvent(pasteEvent);
    });

    // 验证附件卡片出现并可点击预览
    const chip = page.locator('#composer-attachments .attachment-chip');
    await expect(chip).toBeVisible();
    await expect(chip).toContainText('metrics.json');

    await chip.locator('[data-action="preview-attachment"]').click();
    await expect(page.locator('#editor-dialog')).toBeVisible();
    await expect(page.locator('#editor-dialog')).toContainText('baseMetric');
    await page.locator('#editor-dialog [data-action="close-dialog"]').click();
    await expect(page.locator('#editor-dialog')).not.toBeVisible();

    // 发送触发多轮计算器工具 + Critic 质检重修的提示词
    await page.locator('#chat-input').fill('多轮计算与审核演示：请结合附件计算 128 * 1.25 的精确数值，并附带一段 JS 验证代码块。');
    await page.getByRole('button', { name: '发送', exact: true }).click();

    // 验证最终助手回复包含工具计算结果 160、修正后的代码块以及持久化的多步思考过程
    const assistantMsg = page.locator('.message.assistant').last();
    await expect(assistantMsg).toContainText('计算结果是 160');
    await expect(assistantMsg.locator('.artifact-card')).toBeVisible();
    await expect(assistantMsg.locator('.artifact-code')).toContainText('128 * 1.25');

    // 验证思考过程记录了工具调用与意图审核轨迹
    const reasoningDetails = assistantMsg.locator('details.message-reasoning');
    await expect(reasoningDetails).toBeVisible();
    await reasoningDetails.locator('summary').click();
    await expect(reasoningDetails.locator('.reasoning-text')).toContainText('[步骤 1] 调用工具 calculator');
    await expect(reasoningDetails.locator('.reasoning-text')).toContainText('[意图审核]');

    // 验证后端 /api/traces 可观测性表完整记录了该回合
    const { traces } = await (await request.get('/api/traces')).json();
    expect(traces.length).toBeGreaterThanOrEqual(1);
    const latestTrace = traces[0];
    expect(latestTrace.toolCalls).toBe(1);
    expect(latestTrace.criticScore).toBe(96);
    expect(latestTrace.criticPassed).toBe(true);
    expect(latestTrace.outcome).toBe('completed');
  });

  test('场景 4：流式生成中途点击“停止”取消、保留草稿与释放会话锁立即重发', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/#chat');

    const promptText = '流式演示：请慢慢输出一段长文本供我测试中途停止按钮。';
    await page.locator('#chat-input').fill(promptText);
    await page.getByRole('button', { name: '发送', exact: true }).click();

    // 等待进入流式生成状态并点击“停止”
    const stopBtn = page.locator('[data-action="stop-chat"]');
    await expect(stopBtn).toBeVisible();
    await stopBtn.click();

    // 验证停止后输入框保留了原草稿，且会话锁已释放可立即发送新消息
    await expect(page.locator('#chat-input')).toHaveValue(promptText);
    await page.locator('#chat-input').fill('停止后立即发送的新问题');
    await page.getByRole('button', { name: '发送', exact: true }).click();

    const lastReply = page.locator('.message.assistant').last();
    await expect(lastReply).toContainText('这是离线测试回复');
  });

  test('场景 5：知识库文档导入、FTS5 + 混合向量检索、记忆管理与定时任务立即运行', async ({ page, request }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.emulateMedia({ reducedMotion: 'reduce' });

    // 1. 知识库导入与检索
    await page.goto('/#knowledge');
    const docContent = '# 栖忆架构手册\n\n栖忆采用本地 SQLite FTS5 全文索引与 RRF 混合向量检索架构，确保毫秒级精准召回。';
    await request.post('/api/documents', {
      data: {
        name: 'qiyi-architecture.md',
        data: Buffer.from(docContent, 'utf8').toString('base64')
      }
    });
    await page.getByRole('button', { name: '刷新本地数据', exact: true }).click();
    await expect(page.locator('.document-row').filter({ hasText: 'qiyi-architecture.md' })).toBeVisible();

    await page.locator('#knowledge-query').fill('FTS5 混合向量检索');
    await page.locator('#knowledge-form button[type="submit"]').click();
    await expect(page.locator('.search-result')).toContainText('FTS5 全文索引');

    // 2. 记忆创建与图谱视图切换
    await nav(page, '记忆').click();
    await page.getByRole('button', { name: '添加记忆', exact: true }).click();
    await expect(page.locator('#editor-dialog')).toBeVisible();
    await page.locator('#memory-content').fill('用户偏好使用零构建 ESM 与本地 SQLite FTS5 架构。');
    await page.locator('#memory-triples').fill('用户 | 偏好 | SQLite FTS5');
    await page.locator('#editor-form button[type="submit"]').click();
    await expect(page.locator('#editor-dialog')).not.toBeVisible();
    await expect(page.locator('.memory-card').filter({ hasText: 'SQLite FTS5 架构' })).toBeVisible();

    // 3. 定时任务创建与立即运行（后台任务自动跳过交互式工具与 Critic）
    await nav(page, '任务').click();
    await page.locator('[data-action="create-task"]').first().click();
    await expect(page.locator('#editor-dialog')).toBeVisible();
    await page.locator('#task-name').fill('架构巡检日报');
    await page.locator('#task-type').selectOption('prompt');
    await page.locator('#task-prompt').fill('请简要汇报今日系统状态。');
    await page.locator('#editor-form button[type="submit"]').click();
    await expect(page.locator('#editor-dialog')).not.toBeVisible();

    const taskCard = page.locator('.task-card').filter({ hasText: '架构巡检日报' });
    await expect(taskCard).toBeVisible();
    await taskCard.getByRole('button', { name: '立即运行', exact: true }).click();
    await expect(page.locator('.run-item').filter({ hasText: '架构巡检日报' }).first()).toContainText('成功');
  });

  test('场景 6：移动端极窄视口 (320x568) 与标准手机视口 (390x844) 自适应及浮层穿透防御检查', async ({ page }) => {
    for (const vp of [{ width: 320, height: 568 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(vp);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto('/#chat');

      const diagnostics = await page.evaluate(() => {
        const composer = document.querySelector('.composer-wrap').getBoundingClientRect();
        const closedDialogs = [...document.querySelectorAll('dialog:not([open])')];
        const blockingDialogs = closedDialogs.filter(d => getComputedStyle(d).display !== 'none');
        return {
          horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
          composerVisible: composer.bottom <= window.innerHeight + 1 && composer.top >= 0,
          blockingDialogCount: blockingDialogs.length
        };
      });

      expect(diagnostics.horizontalOverflow).toBe(false);
      expect(diagnostics.composerVisible).toBe(true);
      expect(diagnostics.blockingDialogCount).toBe(0);
    }
  });
});
