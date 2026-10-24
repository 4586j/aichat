import { test, expect } from '@playwright/test';

const nav = (page, name) => page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name, exact: true });

test('entrance finishes independently of loading and does not replay during navigation', async ({ page }) => {
  await page.route('**/api/bootstrap', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '测试：本地服务暂不可用' }) }));
  await page.goto('/');
  await expect(page.locator('#startup-screen')).toHaveCount(0, { timeout: 3000 });
  await expect(page.getByRole('button', { name: '重新连接', exact: true })).toBeVisible();
  await page.unroute('**/api/bootstrap');
  await page.getByRole('button', { name: '重新连接', exact: true }).click();
  await nav(page, '设置').click();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.locator('#startup-screen')).toHaveCount(0);
});

test('reduced motion skips the entrance and keeps the workspace usable', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.locator('#startup-screen')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '让思绪，有处栖息。' })).toBeVisible();
  expect(await page.locator('.app-shell').evaluate(element => getComputedStyle(element).animationName)).toBe('none');
});

test.describe('responsive touch layouts', () => {
  test.use({ hasTouch: true, isMobile: true });

  for (const viewport of [{ width: 320, height: 740 }, { width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 844, height: 390 }]) {
    test(`all pages fit ${viewport.width} x ${viewport.height}`, async ({ page }, testInfo) => {
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.setViewportSize(viewport);
      await page.goto('/');
      await expect(page.getByText('本地服务已连接', { exact: true })).toBeVisible();
      await expect(page.locator('#startup-screen')).toHaveCount(0);
      for (const name of ['对话', '人设工坊', '知识库', '记忆', '定时任务', '设置']) {
        await nav(page, name).click();
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), name).toBe(true);
      }
      if (viewport.width <= 700) {
        const navigation = await page.locator('#navigation').boundingBox();
        expect(navigation.y + navigation.height).toBeLessThanOrEqual(viewport.height + 1);
        expect(navigation.y).toBeGreaterThan(viewport.height - 100);
        for (const link of await page.locator('#navigation a').all()) expect((await link.boundingBox()).height).toBeGreaterThanOrEqual(44);
        await nav(page, '对话').click();
        await expect(page.locator('.chat-context')).not.toHaveAttribute('open');
        await expect(async () => {
          const send = await page.getByRole('button', { name: '发送', exact: true }).boundingBox();
          expect(send.y + send.height).toBeLessThan(navigation.y);
        }).toPass();
        await expect(page.locator('.touch-hint')).toBeVisible();
        await expect(page.locator('.keyboard-hint')).not.toBeVisible();
        await page.screenshot({ path: testInfo.outputPath('mobile-chat.png'), fullPage: true });
        await page.locator('.chat-context > summary').click();
        await expect(page.getByRole('heading', { name: '对话手记', exact: true })).toBeVisible();
        await nav(page, '定时任务').click();
        await page.getByRole('button', { name: '创建任务', exact: true }).click();
        await expect(page.getByRole('dialog')).toBeVisible();
        expect(await page.locator('#editor-dialog').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
        expect(await page.getByLabel('任务名称', { exact: true }).evaluate(element => getComputedStyle(element).fontSize)).toBe('16px');
        await page.getByRole('button', { name: '取消', exact: true }).click();
        await expect(page.getByRole('dialog')).not.toBeVisible();
      }
      expect(errors).toEqual([]);
    });
  }

  test('touch Enter inserts a newline; explicit send works and resizing preserves the draft', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    const input = page.getByLabel('发送给当前角色的消息', { exact: true });
    await expect(page.locator('#startup-screen')).toHaveCount(0);
    const initialHeight = (await page.locator('.chat-panel').boundingBox()).height;
    await page.locator('.chat-context > summary').scrollIntoViewIfNeeded();
    await input.fill('第一行');
    await expect(async () => {
      expect((await page.locator('.chat-panel').boundingBox()).height).toBeLessThanOrEqual(initialHeight + 1);
    }).toPass();
    await input.press('Enter');
    await expect(input).toHaveValue('第一行\n');
    await expect(page.locator('.message')).toHaveCount(0);
    await page.setViewportSize({ width: 768, height: 1024 });
    await expect(input).toHaveValue('第一行\n');
    await expect(page.locator('.chat-context')).toHaveAttribute('open', '');
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(input).toHaveValue('第一行\n');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect(page.locator('.message.assistant')).toContainText('这是离线测试回复');
    await expect(input).toHaveValue('');
  });
});
