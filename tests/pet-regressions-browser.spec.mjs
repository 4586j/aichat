import { test, expect } from './ui-test.mjs';

const portrait = page => page.locator('.pet-trigger [data-pet-portrait]');
const nav = (page, name) => page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name, exact: true });
async function open(page) {
  await page.getByRole('button', { name: '打开宠物小窝', exact: true }).first().click();
  await expect(page.locator('.pet-home-stage [data-pet-portrait]')).toHaveAttribute('data-pet-renderer', 'canvas');
}

test('a completed reply and changed pet revision preserve name composition, focus and selection', async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/'); await page.waitForLoadState('networkidle');
  let release, seen;
  const gate = new Promise(resolve => { release = resolve; });
  const observed = new Promise(resolve => { seen = resolve; });
  await page.route('**/api/conversations/*/messages', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    seen(); await gate; await route.continue();
  });
  try {
    await page.locator('#chat-input').fill('回复时继续给宠物取名字。');
    await page.getByRole('button', { name: '发送', exact: true }).click(); await observed;
    await open(page);
    await page.locator('#pet-name').fill('小团团');
    await page.locator('#pet-name').evaluate(input => {
      input.setSelectionRange(1, 2);
      input.dispatchEvent(new CompositionEvent('compositionstart', { data: '绒', bubbles: true }));
      window.nameInputBeforeReply = input;
      window.petCanvasBeforeReply = document.querySelector('.pet-home-stage canvas');
    });
    // Even an unrelated pet update must not replace the active name input.
    await request.put('/api/pets/shiba', { data: { name: '新的豆包' } });
    release();
    await expect(page.locator('#chat-messages')).toHaveAttribute('aria-busy', 'false');
    await expect(page.locator('#pet-name')).toBeFocused();
    expect(await page.locator('#pet-name').evaluate(input => ({
      same: input === window.nameInputBeforeReply,
      selection: [input.selectionStart, input.selectionEnd],
      canvasSame: document.querySelector('.pet-home-stage canvas') === window.petCanvasBeforeReply,
    }))).toEqual({ same: true, selection: [1, 2], canvasSame: true });
    await page.keyboard.insertText('绒');
    await expect(page.locator('#pet-name')).toHaveValue('小绒团');
    await page.locator('#pet-name').dispatchEvent('compositionend', { data: '绒' });
    await expect(page.locator('.pet-choice[data-pet-id="shiba"] strong')).toHaveText('新的豆包');
  } finally { release(); }
});

test('keyboard interactions retain focus, the animation canvas and the chat composer', async ({ page, request }) => {
  await page.goto('/'); await page.waitForLoadState('networkidle'); await open(page);
  await page.locator('#pet-name').fill('未保存的小名字');
  await page.evaluate(() => {
    window.petCanvasBeforeInteraction = document.querySelector('.pet-home-stage canvas');
    window.chatComposerBeforeInteraction = document.querySelector('#chat-input');
  });
  const before = (await (await request.get('/api/pets')).json()).pets[0];
  for (const action of ['pet', 'feed', 'play']) {
    const button = page.locator(`.pet-interactions [data-pet-interaction="${action}"]`);
    await button.focus(); await page.keyboard.press('Enter');
    await expect(button).toBeEnabled(); await expect(button).toBeFocused();
    await expect(page.locator('#pet-name')).toHaveValue('未保存的小名字');
    expect(await page.evaluate(() => ({
      canvasSame: document.querySelector('.pet-home-stage canvas') === window.petCanvasBeforeInteraction,
      composerSame: document.querySelector('#chat-input') === window.chatComposerBeforeInteraction,
    }))).toEqual({ canvasSame: true, composerSame: true });
  }
  const after = (await (await request.get('/api/pets')).json()).pets[0];
  expect(after.bond).toBe(before.bond + 4);
  expect([after.petCount, after.feedCount, after.playCount]).toEqual([before.petCount + 1, before.feedCount + 1, before.playCount + 1]);
});

test('a failed interaction keeps the name draft and restores keyboard focus for retry', async ({ page }) => {
  await page.goto('/'); await page.waitForLoadState('networkidle'); await open(page);
  await page.locator('#pet-name').fill('失败时也保留');
  await page.route('**/api/pets/interact', route => route.fulfill({ status: 503, json: { error: '暂时无法互动，请重试。' } }));
  const button = page.locator('.pet-interactions [data-pet-interaction="feed"]');
  await button.focus(); await page.keyboard.press('Enter');
  await expect(page.locator('.pet-feedback[role="alert"]')).toContainText('暂时无法互动');
  await expect(button).toBeFocused(); await expect(page.locator('#pet-name')).toHaveValue('失败时也保留');
  await page.unroute('**/api/pets/interact'); await page.keyboard.press('Enter');
  await expect(page.locator('.pet-feedback')).toContainText('陪伴点数 +2');
  await expect(button).toBeFocused();
});

test('saving a name keeps the canvas and updates the portrait accessible name', async ({ page }) => {
  await page.goto('/'); await page.waitForLoadState('networkidle'); await open(page);
  await page.locator('.pet-home-stage canvas').evaluate(canvas => { window.canvasBeforeRename = canvas; });
  await page.locator('#pet-name').fill('  小<绒>  '); await page.keyboard.press('Enter');
  await expect(page.locator('.pet-feedback')).toHaveText('宠物名字已保存。');
  await expect(page.locator('#pet-name')).toBeFocused();
  await expect(page.locator('#pet-name')).toHaveValue('小<绒>');
  await expect(page.locator('.pet-home-stage [data-pet-image]')).toHaveAttribute('alt', '小<绒>，奶油猫');
  expect(await page.locator('.pet-home-stage canvas').evaluate(canvas => canvas === window.canvasBeforeRename)).toBe(true);
});

for (const outcome of ['ready', 'failure']) test(`body artwork waits for async raster preparation and handles ${outcome}`, async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.addInitScript(() => {
    const makeBitmap = window.createImageBitmap.bind(window), draw = CanvasRenderingContext2D.prototype.drawImage;
    window.bodyDrawsBeforeDecode = 0; window.bodyDecoded = false;
    window.createImageBitmap = async (...args) => {
      await new Promise((resolve, reject) => { window.finishBodyDecode = fail => fail ? reject(new Error('Decode failed')) : resolve(); });
      const bitmap = await makeBitmap(...args); window.bodyDecoded = true; return bitmap;
    };
    CanvasRenderingContext2D.prototype.drawImage = function (source, ...args) {
      if (source instanceof ImageBitmap && !window.bodyDecoded) window.bodyDrawsBeforeDecode++;
      return draw.call(this, source, ...args);
    };
  });
  await page.goto('/'); await open(page);
  await expect.poll(() => page.evaluate(() => typeof window.finishBodyDecode)).toBe('function');
  await page.locator('button[data-pet-motion="wave"]').click();
  const stage = page.locator('.pet-home-stage [data-pet-portrait]');
  await expect(stage).toHaveAttribute('data-pet-renderer', 'canvas');
  await expect(stage).toHaveAttribute('data-pet-clip', 'none');
  expect(await page.evaluate(() => window.bodyDrawsBeforeDecode)).toBe(0);
  await page.evaluate(fail => window.finishBodyDecode(fail), outcome === 'failure');
  if (outcome === 'ready') await expect(stage).toHaveAttribute('data-pet-clip', 'wave');
  else {
    await expect(stage).toHaveAttribute('data-expression', 'happy');
    await expect(stage).toHaveAttribute('data-pet-renderer', 'canvas');
    await expect(stage).toHaveAttribute('data-pet-clip', 'none');
  }
  expect(await page.evaluate(() => window.bodyDrawsBeforeDecode)).toBe(0);
});

test('body actions still work when ImageBitmap is unavailable', async ({ page }) => {
  await page.addInitScript(() => { window.createImageBitmap = undefined; });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/'); await open(page);
  await page.locator('button[data-pet-motion="wave"]').click();
  await expect(page.locator('.pet-home-stage [data-pet-portrait]')).toHaveAttribute('data-pet-clip', 'wave');
});

test('pet home headings stay readable in all three garden themes', async ({ page }, info) => {
  await page.goto('/'); await open(page);
  for (const theme of ['spring', 'autumn', 'night']) {
    await page.evaluate(theme => { document.documentElement.dataset.gardenTheme = theme; }, theme);
    const contrast = await page.locator('#pet-home-title').evaluate(title => {
      const luminance = color => {
        const rgb = color.match(/[\d.]+/g).slice(0, 3).map(Number).map(value => {
          const channel = value / 255;
          return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
        });
        return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
      };
      const a = luminance(getComputedStyle(title).color), b = luminance(getComputedStyle(title.closest('header')).backgroundColor);
      return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
    });
    expect(contrast, `${theme} large heading contrast`).toBeGreaterThanOrEqual(3);
  }
  await page.locator('.pet-home .dialog-header').screenshot({ path: info.outputPath('pet-night-header.png') });
});

for (const width of [1440, 390]) test(`pet linking switches take effect on the settings page at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 960 }); await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/'); await page.waitForLoadState('networkidle');
  await page.locator('#chat-input').fill('联动演示：今天好累，我只想说说。');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.locator('#chat-messages')).toHaveAttribute('aria-busy', 'false');
  await expect(portrait(page)).toHaveAttribute('data-expression', 'sleepy');
  await nav(page, '设置').click();
  await page.getByLabel('宠物随对话状态表现', { exact: true }).uncheck();
  await page.getByRole('button', { name: '保存回应联动设置', exact: true }).click();
  await expect(portrait(page)).toHaveAttribute('data-expression', 'natural');
  await page.getByLabel('宠物随对话状态表现', { exact: true }).check();
  await page.getByRole('button', { name: '保存回应联动设置', exact: true }).click();
  await expect(portrait(page)).toHaveAttribute('data-expression', 'sleepy');
  await expect(page.getByRole('heading', { name: '让回应贴合此刻', exact: true })).toBeVisible();
});
