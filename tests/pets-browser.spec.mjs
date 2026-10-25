import { test, expect } from '@playwright/test';

const defaults = { enabled: true, selectedId: 'cream-cat', animations: true };
test.beforeEach(async ({ request }) => { await request.put('/api/pets/settings', { data: defaults }); });
test.afterEach(async ({ request }) => {
  await request.put('/api/pets/settings', { data: defaults });
  for (const [id, name] of [['cream-cat', '团团'], ['shiba', '豆包'], ['lop-rabbit', '糯米'], ['little-fox', '栗栗']]) await request.put(`/api/pets/${id}`, { data: { name } });
  await request.put('/api/media/settings', { data: { musicBaseUrl: '', clearMusicApiKey: true } });
});
async function open(page) { await page.getByRole('button', { name: '打开宠物小窝', exact: true }).first().click(); await expect(page.locator('.pet-home-stage h3')).toBeVisible(); }
const choose = (page, species) => page.locator('.pet-choice').filter({ has: page.getByAltText(`${species}形象`, { exact: true }) });

test('four generated portraits load locally; selection and escaped custom names survive navigation and reload', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message)); await page.goto('/'); await open(page);
  await expect(page.locator('.pet-choice')).toHaveCount(4);
  for (const img of await page.locator('.pet-choice img').all()) { await img.scrollIntoViewIfNeeded(); await expect(async () => expect(await img.evaluate(e => e.naturalWidth)).toBeGreaterThan(100)).toPass(); }
  await choose(page, '小狐狸').click(); await expect(choose(page, '小狐狸')).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel('给它取个名字', { exact: true }).fill('小<b>栗</b>'); await page.getByRole('button', { name: '保存宠物名字', exact: true }).click();
  await expect(page.locator('.pet-home-stage h3')).toContainText('小<b>栗</b>'); await expect(page.locator('.pet-home-stage h3 b')).toHaveCount(0);
  await page.getByRole('button', { name: '关闭宠物小窝', exact: true }).click();
  await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '知识库', exact: true }).click();
  await expect(page.locator('.pet-trigger img')).toHaveAttribute('src', '/assets/pets/little-fox-v1.png');
  await page.reload(); await open(page); await expect(page.getByLabel('给它取个名字', { exact: true })).toHaveValue('小<b>栗</b>'); expect(errors).toEqual([]);
});

test('pet, snack and play update independent records without losing an unsaved name', async ({ page, request }) => {
  const before = (await (await request.get('/api/pets')).json()).pets.find(p => p.id === 'cream-cat');
  await page.goto('/'); await open(page);
  await page.locator('#pet-home').getByRole('button', { name: '摸摸', exact: true }).click(); await expect(page.locator('.pet-feedback')).toContainText('陪伴点数 +1');
  await page.getByRole('button', { name: '喂点心', exact: true }).click(); await expect(page.locator('.pet-feedback')).toContainText('陪伴点数 +2');
  await page.getByLabel('给它取个名字', { exact: true }).fill('尚未保存的名字');
  await page.getByRole('button', { name: '玩一会儿', exact: true }).click(); await expect(page.getByLabel('给它取个名字', { exact: true })).toHaveValue('尚未保存的名字');
  const after = (await (await request.get('/api/pets')).json()).pets.find(p => p.id === 'cream-cat');
  expect(after.bond).toBe(before.bond + 4); expect(after.petCount).toBe(before.petCount + 1); expect(after.feedCount).toBe(before.feedCount + 1); expect(after.playCount).toBe(before.playCount + 1); expect(after.name).toBe(before.name);
});

test('visibility and quiet preferences persist and reduced motion stops portrait animation', async ({ page }) => {
  await page.goto('/'); await open(page); await page.getByLabel('开启轻动效', { exact: true }).uncheck();
  await expect(page.locator('.pet-home-stage [data-pet-portrait]')).toHaveAttribute('data-phase', 'quiet');
  expect(await page.locator('.pet-home-stage img').evaluate(e => getComputedStyle(e).animationName)).toBe('none');
  await page.getByLabel('在聊天中显示宠物', { exact: true }).uncheck(); await page.getByRole('button', { name: '关闭宠物小窝', exact: true }).click();
  await expect(page.locator('.pet-companion, .pet-mobile-companion')).toHaveCount(0); await expect(page.locator('.pet-trigger img')).toHaveCount(0);
  await page.reload(); await open(page); await expect(page.getByLabel('在聊天中显示宠物', { exact: true })).not.toBeChecked();
  await page.getByLabel('在聊天中显示宠物', { exact: true }).check(); await page.getByLabel('开启轻动效', { exact: true }).check();
  await page.emulateMedia({ reducedMotion: 'reduce' }); expect(await page.locator('.pet-home-stage img').evaluate(e => getComputedStyle(e).animationName)).toBe('none');
});

test('chat waiting and completed replies drive the pet without extra provider or interaction requests', async ({ page, request }) => {
  const { persona } = await (await request.post('/api/personas', { data: { name: '宠物等待测试', systemPrompt: '简洁回答。' } })).json();
  let release, seen; const gate = new Promise(r => { release = r; }), observed = new Promise(r => { seen = r; }); let interactions = 0;
  await page.route('**/api/conversations/*/messages', async route => { seen(); await gate; await route.continue(); });
  page.on('request', r => { if (r.url().endsWith('/api/pets/interact')) interactions++; });
  await page.goto(`/?pets=${persona.id}#chat`); await page.getByLabel('选择聊天角色', { exact: true }).selectOption(persona.id);
  await page.locator('#chat-input').fill('等一会儿再回答。'); await page.getByRole('button', { name: '发送', exact: true }).click(); await observed;
  await expect(page.locator('.pet-trigger [data-pet-portrait]')).toHaveAttribute('data-phase', 'thinking');
  release(); await expect(page.locator('.message.assistant')).toBeVisible(); await expect(page.locator('.pet-trigger [data-pet-portrait]')).toHaveAttribute('data-phase', 'reply'); expect(interactions).toBe(0);
});

test('an older bootstrap response cannot replace a just-selected companion', async ({ page, request }) => {
  const old = await (await request.get('/api/bootstrap')).json(); await page.goto('/'); await open(page); await choose(page, '垂耳兔').click();
  await expect(choose(page, '垂耳兔')).toHaveAttribute('aria-pressed', 'true'); await page.getByRole('button', { name: '关闭宠物小窝', exact: true }).click();
  await page.route('**/api/bootstrap', route => route.fulfill({ json: old })); await page.getByRole('button', { name: '刷新本地数据', exact: true }).click();
  await expect(page.locator('.pet-trigger img')).toHaveAttribute('src', '/assets/pets/lop-rabbit-v1.png');
});

test('background audio animates the pet and remains playing when visiting its home', async ({ page, request }) => {
  await request.put('/api/media/settings', { data: { musicEnabled: true, musicBaseUrl: 'http://music-fixture.invalid' } });
  await page.goto('/'); await page.getByRole('button', { name: '打开音乐播放器', exact: true }).click(); await page.getByRole('button', { name: '浏览本地曲库', exact: true }).click();
  await page.locator('.music-result').getByRole('button', { name: '播放', exact: true }).click(); await expect(page.locator('#background-audio')).toHaveJSProperty('paused', false);
  await page.getByRole('button', { name: '关闭音乐面板', exact: true }).click(); await expect(page.locator('.pet-trigger [data-pet-portrait]')).toHaveAttribute('data-phase', 'music');
  await open(page); await expect(page.locator('.pet-home-stage [data-pet-portrait]')).toHaveAttribute('data-phase', 'music'); await expect(page.locator('#background-audio')).toHaveJSProperty('paused', false);
});

for (const width of [320, 390]) test(`pet home and compact chat companion fit ${width}px without covering controls`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 844 }); await page.goto('/'); await expect(page.locator('.pet-mobile-companion')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await page.locator('.pet-mobile-companion').boundingBox()).height).toBeLessThan(70);
  const send = await page.getByRole('button', { name: '发送', exact: true }).boundingBox(), nav = await page.locator('#navigation').boundingBox(); expect(send.y + send.height).toBeLessThan(nav.y);
  await open(page); await expect(page.locator('#pet-home')).toBeVisible(); expect(await page.locator('#pet-home').evaluate(e => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
  await choose(page, '柴犬').scrollIntoViewIfNeeded(); await choose(page, '柴犬').click(); await expect(choose(page, '柴犬')).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: info.outputPath(`pets-mobile-${width}.png`) });
  await page.getByLabel('给它取个名字', { exact: true }).fill('键盘出现后保留名字');
  await page.evaluate(() => { Object.defineProperty(window.visualViewport, 'height', { configurable: true, value: 450 }); window.visualViewport.dispatchEvent(new Event('resize')); });
  await expect(async () => { const box = await page.locator('#pet-home').boundingBox(); expect(box.y + box.height).toBeLessThanOrEqual(450); }).toPass();
  await expect(page.getByLabel('给它取个名字', { exact: true })).toHaveValue('键盘出现后保留名字');
});
