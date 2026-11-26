import { test, expect } from './ui-test.mjs';

test.describe('Workspace 7 New Feature Journeys', () => {
  test('Relationships, Group Chat Branching, and Global Search (Ctrl+K)', async ({ page, request }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await request.post('/api/personas', {
      data: { name: '清晏', description: '爱喝茶的琴师', systemPrompt: '你是清晏，温和健谈。' }
    });
    await page.goto('/#personas');

    // Open Relationship Editor modal and create relationship
    await page.getByRole('button', { name: '角色关系' }).first().click();
    const relDialog = page.locator('#relationship-dialog');
    await expect(relDialog).toBeVisible();
    await relDialog.locator('#rel-shared-label').fill('知音茶友');
    await relDialog.locator('#rel-a-to-b').fill('总能听懂他的弦外之音');
    await relDialog.locator('#rel-save-btn').click();
    await expect(relDialog.locator('.rel-card')).toContainText('知音茶友');
    await relDialog.locator('[data-rel-close]').click();
    await expect(relDialog).toBeHidden();

    // Send messages in chat and test branching
    await page.goto('/#chat');
    await page.locator('#chat-input').fill('竹林小亭的石桌摆好了清茶');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect(page.getByRole('button', { name: '发送', exact: true })).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.message')).toHaveCount(2, { timeout: 8000 });

    await page.locator('#chat-input').fill('再来一碟桂花糕吧');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect(page.getByRole('button', { name: '发送', exact: true })).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.message')).toHaveCount(4, { timeout: 8000 });

    // Branch from the 2nd message (index 1)
    const secondMsg = page.locator('.message').nth(1);
    await secondMsg.locator('[data-action="branch-message"]').click();
    const branchBar = page.locator('.branch-switcher-bar');
    await expect(branchBar).toBeVisible();
    await expect(branchBar.locator('.branch-chip')).toHaveCount(2);
    await expect(page.locator('.message')).toHaveCount(2);

    // Switch back to root conversation via branch bar
    await branchBar.locator('.branch-chip').first().click();
    await expect(page.locator('.message')).toHaveCount(4);

    // Global Search via Ctrl+K and jump to message
    await page.keyboard.press('Control+k');
    const searchDialog = page.locator('#global-search-dialog');
    await expect(searchDialog).toBeVisible();
    await searchDialog.locator('#global-search-input').fill('桂花糕');
    const hit = searchDialog.locator('.search-hit-item').first();
    await expect(hit).toBeVisible({ timeout: 5000 });
    await hit.click();
    await expect(searchDialog).toBeHidden();
    await expect(page.locator('.message.is-highlighted')).toContainText('桂花糕');
  });

  test('Bookmarks & Multi-Select Long-Image Canvas2D Export', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/#chat');
    await page.locator('#chat-input').fill('春风拂槛露华浓，今日心情甚好');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect(page.getByRole('button', { name: '发送', exact: true })).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.message')).toHaveCount(2, { timeout: 8000 });

    // Bookmark the assistant reply
    const reply = page.locator('.message.assistant').last();
    await reply.locator('[data-action="toggle-bookmark"]').click();
    await expect(reply.locator('[data-action="toggle-bookmark"]')).toHaveClass(/is-bookmarked/);

    // Verify bookmark appears in Memories -> 摘录收藏 tab and note can be edited
    await page.goto('/#memories');
    await page.getByRole('button', { name: /摘录收藏/ }).click();
    const card = page.locator('.bookmark-card').first();
    await expect(card).toBeVisible();
    await card.locator('[data-action="edit-bookmark-note"]').click();
    const noteDlg = page.locator('#bookmark-note-dialog');
    await expect(noteDlg).toBeVisible();
    await noteDlg.locator('#bookmark-note-input').fill('春日园林金句');
    await noteDlg.locator('#bookmark-note-save').click();
    await expect(card).toContainText('春日园林金句');

    // Return to chat and generate 2x long-image preview
    await card.locator('[data-action="jump-bookmark"]').click();
    await expect(page.locator('.message.is-highlighted')).toBeVisible();

    await page.getByRole('button', { name: '生成长图', exact: true }).click();
    await expect(page.locator('.export-select-bar')).toBeVisible();
    await page.getByRole('button', { name: '全选当前', exact: true }).click();
    await page.getByRole('button', { name: '预览并导出长图', exact: true }).click();

    const longDlg = page.locator('#long-image-dialog');
    await expect(longDlg).toBeVisible();
    const dims = await longDlg.locator('#long-image-canvas').evaluate(c => ({ w: c.width, h: c.height }));
    expect(dims.w).toBe(1360);
    expect(dims.h).toBeGreaterThan(200);
    await longDlg.locator('[data-longimg-theme="night"]').click();
    await longDlg.locator('[data-longimg-close]').click();
  });

  test('Dual-Entry Web URL Clipper (SSRF + Clean Import) & Split-Pane Live Canvas', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/#knowledge');

    // SSRF attempt blocked cleanly with alert
    await page.getByRole('button', { name: '抓取网页入库', exact: true }).click();
    const clipDlg = page.locator('#url-clip-dialog');
    await expect(clipDlg).toBeVisible();
    await clipDlg.locator('#clip-url-input').fill('http://127.0.0.1:4317/secret');
    await clipDlg.locator('#clip-url-submit').click();
    await expect(clipDlg.locator('#clip-url-error')).toBeVisible();

    // Valid public URL clipped cleanly into Knowledge Base (using offline mock webFetchImpl)
    await clipDlg.locator('#clip-url-input').fill('https://example.com/garden-architecture');
    await clipDlg.locator('#clip-url-submit').click();
    await expect(clipDlg).toBeHidden();
    await expect(page.locator('.document-row').first()).toContainText('江南园林营造录.md');

    // Chat URL clipper adds attachment chip cleanly
    await page.goto('/#chat');
    await page.locator('[data-action="open-chat-url-clip"]').click();
    await expect(page.locator('#url-clip-dialog')).toBeVisible();
    await page.locator('#clip-url-input').fill('https://example.com/notes');
    await page.locator('#clip-url-submit').click();
    await expect(page.locator('#composer-attachments')).toContainText('江南园林营造录.md');

    // Inject an HTML code artifact in a message and open Split-Pane Canvas
    await page.locator('#chat-input').fill('请给我一段 ```html 示例演示```：');
    // Directly test artifact split canvas rendering via formatted content on page
    await page.evaluate(() => {
      const container = document.getElementById('chat-messages');
      container.insertAdjacentHTML('beforeend', `<article class="message assistant"><div class="message-content">${window.formatMessageContent('看这个小组件：\n\n```html widget.html\n<h2 id="demo-heading">清风亭</h2>\n<script>console.log("ok")</script>\n```', '')}</div></article>`);
    });
    const canvasBtn = page.locator('[data-artifact-action="open-canvas"]').last();
    await expect(canvasBtn).toBeVisible();
    await canvasBtn.click();

    const canvasPane = page.locator('#chat-canvas-pane');
    await expect(canvasPane).toBeVisible();
    const iframeSandbox = await canvasPane.locator('.canvas-sandbox-frame').getAttribute('sandbox');
    expect(iframeSandbox).toBe('allow-scripts');

    // Switch to code editor, edit HTML, and verify live preview updates
    await canvasPane.locator('[data-action="canvas-mode-code"]').click();
    await canvasPane.locator('#canvas-code-editor').fill('<h2 id="edited-heading">秋水轩</h2>');
    await canvasPane.locator('[data-action="canvas-mode-preview"]').click();
    const srcdoc = await canvasPane.locator('.canvas-sandbox-frame').getAttribute('srcdoc');
    expect(srcdoc).toContain('秋水轩');
    await canvasPane.locator('[data-action="close-canvas"]').click();
    await expect(canvasPane).toBeHidden();
  });

  test('Mood Calendar, Persona Card Export/Import, Settings Backup, Night Mode & 320px Mobile', async ({ page, request }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const boot = await (await request.get('/api/bootstrap')).json();
    const firstPersona = boot.personas[0];
    const conv = (await (await request.post('/api/conversations', { data: { personaId: firstPersona.id } })).json()).conversation;
    await request.post(`/api/conversations/${conv.id}/messages`, { data: { content: '今天在茶室写了几页笔记。' } });

    await page.goto('/#chat');
    await page.locator('#topbar-journal-btn').click();
    const journalDlg = page.locator('#mood-journal-dialog');
    await expect(journalDlg).toBeVisible();
    await journalDlg.locator('[data-mood-pick="happy"]').click();
    await journalDlg.locator('#journal-user-note').fill('清茶伴书香');
    await journalDlg.locator('#journal-generate-btn').click();
    await expect(journalDlg.locator('.journal-ai-card')).toContainText('今天在园林里聊了茶与日常', { timeout: 8000 });
    await journalDlg.locator('[data-journal-close]').click();

    // Night theme check on topbar/settings backup card — no #ffffff pure white leak
    await page.goto('/#settings');
    await page.locator('[data-garden-theme-select="night"]').click();
    await expect(page.locator('#settings-backup-card')).toBeVisible();
    const nightBg = await page.locator('#settings-backup-card').evaluate(el => getComputedStyle(el).backgroundColor);
    expect(nightBg).not.toBe('rgb(255, 255, 255)');

    // Open search modal in Night theme and verify no white card background leak
    await page.locator('#topbar-search-btn').click();
    const searchDlgBg = await page.locator('#global-search-dialog .extras-dialog-body').evaluate(el => getComputedStyle(el).backgroundColor);
    expect(searchDlgBg).not.toBe('rgb(255, 255, 255)');
    await page.locator('[data-search-close]').click();

    // Mobile 320x568 viewport overflow and closed-dialog check
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto('/#chat');
    const mobileAudit = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      openDialogs: [...document.querySelectorAll('dialog:not([open])')].filter(d => getComputedStyle(d).display !== 'none').length
    }));
    expect(mobileAudit.scrollWidth).toBeLessThanOrEqual(mobileAudit.innerWidth);
    expect(mobileAudit.openDialogs).toBe(0);
  });

  test('Per-persona custom model: editor saves it, card shows it, and it can be cleared', async ({ page, request }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/#settings');
    await page.locator('[data-action="fetch-settings-models"]').click();
    await expect(page.locator('#settings-model-list option')).toHaveCount(3);

    await page.goto('/#personas');
    await page.getByRole('button', { name: '创建角色', exact: true }).click();
    const dlg = page.locator('#editor-dialog');
    await dlg.locator('[data-action="fetch-persona-models"]').click();
    await expect(dlg.locator('#persona-model-list option')).toHaveCount(3);
    await dlg.locator('#persona-name').fill('专属模型伙伴');
    await dlg.locator('#persona-systemPrompt').fill('简洁地回答。');
    await dlg.locator('#persona-model').fill('qiyi-pro-model');
    await dlg.getByRole('button', { name: '确认创建角色', exact: true }).click();
    const card = page.locator('.persona-card', { hasText: '专属模型伙伴' });
    await expect(card).toContainText('模型：qiyi-pro-model');

    const saved = (await (await request.get('/api/bootstrap')).json()).personas.find(p => p.name === '专属模型伙伴');
    expect(saved.model).toBe('qiyi-pro-model');

    await card.locator('[data-action="edit-persona"]').last().click();
    await dlg.locator('#persona-model').fill('');
    await dlg.getByRole('button', { name: '保存修改', exact: true }).click();
    await expect(card).not.toContainText('模型：');
  });

  test('Quota 429 pause saves checkpoint banner and manual resume finishes reply', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/#chat');
    await page.locator('#chat-input').fill('限流断点演示：请帮我继续完成');
    await page.getByRole('button', { name: '发送', exact: true }).click();

    const banner = page.locator('.resumable-run-banner').first();
    await expect(banner).toBeVisible({ timeout: 8000 });
    await expect(banner).toContainText('因模型限流已暂停');

    // Adjust model override via dialog
    await banner.locator('[data-action="edit-resumable-run"]').click();
    const dlg = page.locator('#editor-dialog');
    await dlg.locator('#resumable-modelOverride').fill('qiyi-fast-model');
    await dlg.getByRole('button', { name: '保存调整', exact: true }).click();
    await expect(banner).toContainText('qiyi-fast-model');

    // Click immediate resume and verify assistant reply completes & banner disappears
    await banner.locator('[data-action="resume-run-now"]').click();
    await expect(banner).toBeHidden({ timeout: 8000 });
    await expect(page.locator('.message.assistant').last()).toBeVisible({ timeout: 8000 });
  });
});
