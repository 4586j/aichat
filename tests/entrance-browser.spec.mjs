import { test, expect } from './ui-test.mjs';

test.use({ storageState: { cookies: [], origins: [] } });

test('the five-act entrance plays once, then yields to the settled workspace', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#startup-screen')).toHaveClass(/is-active/);
  await expect(page.locator('body')).toHaveClass(/is-entering-pre/);
  await expect(page.locator('body')).toHaveClass(/is-entering-post/, { timeout: 8000 });
  await expect(page.locator('#startup-screen')).toHaveCount(0, { timeout: 8000 });
  await expect(page.locator('body')).not.toHaveClass(/is-entering/);

  await page.reload();
  await expect(page.getByRole('heading', { name: '今天，聊点什么？' })).toBeVisible();
  await expect(page.locator('#startup-screen')).toHaveCount(0);
  await expect(page.locator('body')).not.toHaveClass(/is-entering/);

  await page.getByRole('button', { name: '重播入场', exact: true }).click();
  await expect(page.locator('#startup-screen')).toHaveClass(/is-active/);
  await page.getByRole('button', { name: '跳过入场', exact: true }).click();
  await expect(page.locator('#startup-screen')).toHaveCount(0);
  await expect(page.locator('body')).not.toHaveClass(/is-entering/);

  await page.locator('#chat-input').fill('入场结束后输入框仍可用。');
  await expect(page.locator('#chat-input')).toHaveValue('入场结束后输入框仍可用。');
});

test('reduced motion skips the entrance entirely', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.locator('#startup-screen')).toHaveCount(0);
  await expect(page.locator('body')).not.toHaveClass(/is-entering/);
  await expect(page.getByRole('heading', { name: '今天，聊点什么？' })).toBeVisible();
});

test('entrance finishes on its own timeline even when loading fails', async ({ page }) => {
  await page.route('**/api/bootstrap', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '测试：本地服务暂不可用' }) }));
  await page.goto('/');
  await expect(page.locator('#startup-screen')).toHaveClass(/is-active/);
  await expect(page.locator('#startup-screen')).toHaveCount(0, { timeout: 12000 });
  await expect(page.getByRole('button', { name: '重新连接', exact: true })).toBeVisible();
});
