import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { startServer } from '../server.mjs';
import { scriptedModel } from './helpers.mjs';

const CONTENT_JS = readFileSync('E:/tools/napcat/content.js', 'utf8');
const CONTENT_CSS = readFileSync('E:/tools/napcat/content.css', 'utf8');

const DOUYIN_MOCK_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>2500全局思路 - 抖音</title>
  <style>
    body { margin: 0; font-family: sans-serif; height: 100vh; display: flex; background: #161823; color: #fff; }
    .video-pane { flex: 1; display: flex; flex-direction: column; padding: 24px; position: relative; }
    .danmaku-bar { margin-top: auto; display: flex; gap: 8px; padding: 8px; background: #222; border-radius: 6px; width: 420px; }
    .danmaku-bar input { flex: 1; }
    .side-actions { position: absolute; right: 16px; bottom: 140px; display: flex; flex-direction: column; gap: 12px; }
    .comment-pane { width: 400px; background: #1f212e; display: none; flex-direction: column; padding: 16px; position: relative; }
    .comment-list { flex: 1; overflow-y: auto; }
    [data-e2e="comment-item"] { padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.08); }
    .comment-bar { margin-top: auto; padding: 10px; background: #2c2f3f; border-radius: 8px; display: flex; align-items: center; gap: 8px; }
    .placeholder-box { flex: 1; color: #aaa; cursor: text; min-height: 24px; line-height: 24px; }
    .placeholder-box::before { content: "留下你的精彩评论吧"; }
    .ed-wrap-1, .ed-wrap-2, .ed-wrap-3, .ed-wrap-4 { display: block; width: 100%; min-height: 24px; }
    .public-DraftEditor-root { flex: 1; }
    .public-DraftEditor-content { display: inline-block; width: 0px; min-height: 24px; outline: none; color: #fff; }
  </style>
</head>
<body>
  <main class="video-pane" data-e2e="feed-active-video">
    <div data-e2e="feed-video-nickname">@自得其乐</div>
    <h1 data-e2e="video-desc">2500全局思路 #游戏教学</h1>
    <div class="side-actions">
      <button type="button" id="open-comment-drawer" data-e2e="feed-comment-icon">4530</button>
    </div>
    <div class="danmaku-bar" data-e2e="danmaku-input">
      <input id="danmaku-input-el" type="text" placeholder="发一条友好的弹幕吧">
      <button id="danmaku-send-btn" type="button">发送</button>
    </div>
  </main>
  <aside id="comment-pane" class="comment-pane">
    <div class="comment-list">
      <div data-e2e="comment-item">
        <a href="https://www.douyin.com/user/MS4wLjABAAAA123"><img alt="头像"></a>
        <a href="https://www.douyin.com/user/MS4wLjABAAAA123">小昊前男友</a>
        <div>主播，真的很感谢你，我们曾经一起度过艰难的日子，那时候我很穷交不起房租，你二话没说直接给我租交了</div>
        <div>2月前·天津</div>
        <div class="comment-item-stats-container">
          <span>34</span>
          <span>分享</span>
          <button type="button" data-e2e="comment-reply-btn">回复</button>
        </div>
      </div>
      <div class="obf-comment-card">
        <a href="/user/456">用户571029</a>
        <div>加载动画差点给我看睡着了</div>
        <div>2月前·福建</div>
        <div class="comment-item-stats-container">
          <span>12</span>
          <span>分享</span>
          <span class="obf-reply-span">回复</span>
        </div>
      </div>
    </div>
    <div id="comment-bar-mount" class="comment-bar">
      <div class="placeholder-box"></div>
    </div>
  </aside>
  <script>
    window.__submittedComments = [];
    window.__danmakuSubmitted = [];
    window.__reactCrashed = false;
    document.getElementById('danmaku-send-btn').addEventListener('click', () => {
      const val = document.getElementById('danmaku-input-el').value.trim();
      if (val) window.__danmakuSubmitted.push(val);
    });
    const drawer = document.getElementById('comment-pane');
    // Toggle behavior: double-clicking in one tick opens and immediately re-closes!
    document.getElementById('open-comment-drawer').addEventListener('click', () => {
      drawer.style.display = drawer.style.display === 'flex' ? 'none' : 'flex';
    });
    const mount = document.getElementById('comment-bar-mount');
    function activateEditor(replyPrefix = '') {
      if (mount.querySelector('[contenteditable]')) return;
      mount.innerHTML = '';
      const root = document.createElement('div');
      root.className = 'public-DraftEditor-root';
      const w1 = document.createElement('div'); w1.className = 'ed-wrap-1';
      const w2 = document.createElement('div'); w2.className = 'ed-wrap-2';
      const w3 = document.createElement('div'); w3.className = 'ed-wrap-3';
      const w4 = document.createElement('div'); w4.className = 'ed-wrap-4';
      const ed = document.createElement('div');
      ed.className = 'public-DraftEditor-content';
      ed.setAttribute('contenteditable', 'true');
      ed.setAttribute('role', 'textbox');
      if (replyPrefix) ed.setAttribute('data-placeholder', replyPrefix);

      // Strict React/Draft.js internal node tree: removing data-contents or data-offset-key crashes into "网络加载失败"
      const contents = document.createElement('div');
      contents.setAttribute('data-contents', 'true');
      const offsetSpan = document.createElement('span');
      offsetSpan.setAttribute('data-offset-key', 'k1');
      const textSpan = document.createElement('span');
      textSpan.setAttribute('data-text', 'true');
      offsetSpan.appendChild(textSpan);
      contents.appendChild(offsetSpan);
      ed.appendChild(contents);
      w4.appendChild(ed); w3.appendChild(w4); w2.appendChild(w3); w1.appendChild(w2);
      root.appendChild(w1);

      const crashCheck = new MutationObserver(() => {
        if (!ed.querySelector('[data-contents="true"] [data-offset-key="k1"]')) {
          window.__reactCrashed = true;
          drawer.innerHTML = '<div class="error-boundary">网络加载失败</div>';
        }
      });
      crashCheck.observe(ed, { childList: true, subtree: true });

      ed.addEventListener('select', () => {
        const sel = window.getSelection();
        window.__syncedSelection = sel && sel.rangeCount > 0 ? sel.toString() : '';
      });
      ed.addEventListener('paste', (e) => {
        const pasted = e.clipboardData?.getData('text/plain') || '';
        if (pasted) {
          e.preventDefault();
          const cur = textSpan.textContent || '';
          // Only replace if selection synced full existing text (like real Draft.js editOnSelect -> editOnPaste)
          if (cur && window.__syncedSelection === cur) {
            textSpan.textContent = pasted;
            window.__syncedSelection = '';
          } else {
            textSpan.textContent = cur + pasted;
          }
        }
      });

      const postBtn = document.createElement('button');
      postBtn.type = 'button';
      postBtn.setAttribute('data-e2e', 'comment-post');
      postBtn.textContent = '发送';
      postBtn.addEventListener('click', () => {
        if (!ed.querySelector('[data-contents="true"]')) {
          window.__reactCrashed = true;
          drawer.innerHTML = '<div class="error-boundary">网络加载失败</div>';
          return;
        }
        const text = (ed.innerText || ed.textContent || '').trim();
        if (text) {
          window.__submittedComments.push(text);
          textSpan.textContent = '';
        }
      });
      mount.append(root, postBtn);
      ed.focus();
    }
    mount.addEventListener('click', () => activateEditor());
    document.querySelectorAll('[data-e2e="comment-reply-btn"]').forEach(btn => {
      btn.addEventListener('click', () => activateEditor('回复 @李斐杰：'));
    });
  </script>
</body>
</html>`;

test('Douyin extension toggles drawer once, preserves Draft.js tree without crashing, fills via paste, and clicks send', async ({ page }) => {
  const mock = scriptedModel(
    { candidates: ['这波全局思路太细了！', '音乐一响我就知道稳了', '学废了学废了'] },
    { candidates: ['哈哈同感，配乐一出来味道就对了'] }
  );
  const app = await startServer({
    port: 0,
    dbPath: ':memory:',
    scheduler: false,
    modelOptions: { fetchImpl: mock.fetchImpl, apiKey: '', timeoutMs: 3000 },
  });
  try {
    app.api.updateSettings({ model: 'test-model', baseUrl: 'http://model.invalid/v1', intentMode: 'legacy' });
    app.api.social.update({ cooldownSeconds: 0 });

    await page.route('https://www.douyin.com/**', async route => {
      await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: DOUYIN_MOCK_HTML });
    });

    await page.exposeFunction('__qiyiBridgeCall', async message => {
      if (message?.type === 'QIYI_GET_CONFIG') {
        return { ok: true, config: { serverUrl: app.url, style: 'natural' } };
      }
      if (message?.type === 'QIYI_DRAFT') {
        const res = await fetch(`${app.url}/api/social/draft`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: 'chrome-extension://abcdefghijklmnopqrstuvwxyzabcdef',
          },
          body: JSON.stringify(message.payload),
        });
        const data = await res.json();
        return res.ok ? { ok: true, data } : { ok: false, error: data?.error || 'error' };
      }
      return { ok: false, error: 'unknown' };
    });

    await page.goto('https://www.douyin.com/video/test');
    await page.addStyleTag({ content: CONTENT_CSS });
    await page.addScriptTag({
      content: `window.chrome = {
        storage: { local: { get: async () => ({}), set: async () => {} } },
        runtime: {
          sendMessage: (msg) => window.__qiyiBridgeCall(msg),
          onMessage: { addListener: () => {} }
        }
      };`,
    });
    await page.addScriptTag({ content: CONTENT_JS });

    // Open copilot panel while comment drawer is CLOSED
    await page.locator('.qiyi-fab').click();
    await expect(page.locator('.qiyi-panel')).toBeVisible();
    await expect(page.locator('#comment-pane')).toBeHidden();

    // Step A: "生成并填入" fills candidate 1, then clicking "仅填入" on candidate 2 must REPLACE (not append)
    await page.getByRole('button', { name: '生成并填入', exact: true }).click();
    await expect(page.locator('#comment-pane')).toBeVisible();
    await expect(page.locator('[data-step="fill"]')).toContainText('写入');
    await expect.poll(async () => page.evaluate(() => document.querySelector('.public-DraftEditor-content')?.innerText.trim())).toBe('这波全局思路太细了！');

    await page.locator('.qiyi-candidate-card').nth(1).getByRole('button', { name: '仅填入', exact: true }).click();
    await expect.poll(async () => page.evaluate(() => document.querySelector('.public-DraftEditor-content')?.innerText.trim())).toBe('音乐一响我就知道稳了');

    // Step B: Click "填入并发送" on candidate 1 -> replaces cleanly and clicks send!
    await page.locator('.qiyi-candidate-card').nth(0).getByRole('button', { name: '填入并发送', exact: true }).click();

    await expect(page.locator('[data-step="recognize"]')).toContainText('热评 2 条');
    await expect(page.locator('[data-step="generate"]')).toContainText('生成 3 条');
    await expect(page.locator('[data-step="fill"]')).toContainText('写入');
    await expect(page.locator('[data-step="send"]')).toContainText('已点击发送按钮');

    const status = await page.evaluate(() => ({
      submitted: window.__submittedComments,
      danmaku: window.__danmakuSubmitted,
      crashed: window.__reactCrashed,
      hasTree: Boolean(document.querySelector('[data-contents="true"] [data-offset-key="k1"]')),
    }));
    expect(status.crashed).toBe(false);
    expect(status.hasTree).toBe(true);
    expect(status.submitted).toEqual(['这波全局思路太细了！']);
    expect(status.danmaku).toEqual([]);

    // Verify extracted clean hot comments (never picking up raw .comment-item-stats-container as extra comments)
    await expect(page.locator('.qiyi-meta')).toContainText('已提取热评 2 条');

    // Step C: Drag panel out of the right drawer, then click "回复" on a netizen comment -> extracts clean author + body (not "34 分享 回复") and auto-triggers reply generation
    const headerBox = await page.locator('.qiyi-header').boundingBox();
    await page.mouse.move(headerBox.x + 60, headerBox.y + 14);
    await page.mouse.down();
    await page.mouse.move(220, 120, { steps: 5 });
    await page.mouse.up();

    await page.locator('.qiyi-toggle input').nth(1).check();
    await page.locator('[data-e2e="comment-reply-btn"]').first().click();

    await expect(page.locator('.qiyi-input')).toHaveValue(
      '@小昊前男友：主播，真的很感谢你，我们曾经一起度过艰难的日子，那时候我很穷交不起房租，你二话没说直接给我租交了'
    );
    expect(await page.locator('.qiyi-input').inputValue()).not.toContain('34 分享 回复');

    await expect.poll(async () => page.evaluate(() => window.__submittedComments.length)).toBe(2);
    const submittedAfterReply = await page.evaluate(() => window.__submittedComments);
    expect(submittedAfterReply[1]).toBe('哈哈同感，配乐一出来味道就对了');

    // Also verify clicking "回复" on an obfuscated comment card without [data-e2e="comment-item"]
    await page.locator('.qiyi-toggle input').nth(0).uncheck();
    await page.locator('.obf-comment-card .obf-reply-span').click();
    await expect(page.locator('.qiyi-input')).toHaveValue('@用户571029：加载动画差点给我看睡着了');
    expect(await page.evaluate(() => window.__reactCrashed)).toBe(false);

    // Confirm real social_events recorded in backend (1 from 生成并填入, 1 from 回复)
    expect(app.api.social.events().events.length).toBe(2);
  } finally {
    await app.close();
  }
});
