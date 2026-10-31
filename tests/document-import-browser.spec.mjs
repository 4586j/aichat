import { test, expect } from './ui-test.mjs';
import { tinyDocx, tinyPdf } from './knowledge-fixtures.mjs';

for (const [format, mimeType, makeFixture, query] of [
  ['docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', tinyDocx, '茉莉花茶'],
  ['pdf', 'application/pdf', tinyPdf, 'Jasmine'],
]) {
  test(`${format} imports real binary text and remains searchable after reopening SQLite`, async ({ page, offlineApp: offline }) => {
    await page.goto('/#knowledge');
    await page.locator('#document-files').setInputFiles({ name: `original.${format}`, mimeType, buffer: makeFixture() });
    await expect(page.locator('.document-row')).toContainText(`original.${format}`);
    await offline.restart();
    await page.reload();
    await expect(page.locator('.document-row')).toContainText(`original.${format}`);
    await page.getByLabel('你想查找什么？', { exact: true }).fill(query);
    await page.getByRole('button', { name: '检索资料', exact: true }).click();
    await expect(page.locator('.search-result .evidence-item')).toHaveCount(1);
    await expect(page.locator('.search-result .evidence-item')).toContainText('fixture');
    await expect(page.locator('.search-result .evidence-item')).toContainText(`original.${format}`);
    expect(offline.calls.model).toHaveLength(0);
  });
}

test('invalid uploads never leave partial rows and a valid import still works afterwards', async ({ page, request, offlineApp: offline }) => {
  await page.goto('/#knowledge');
  for (const [name, buffer] of [
    ['broken.docx', Buffer.from('not a zip archive')],
    ['broken.pdf', Buffer.from('not a pdf')],
    ['empty.txt', Buffer.from('   ')],
    ['large.txt', Buffer.alloc(8 * 1024 * 1024 + 1, 65)],
  ]) {
    await test.step(name, async () => {
      await page.locator('#document-files').setInputFiles({ name, mimeType: 'application/octet-stream', buffer });
      await expect(page.locator('#main .inline-error')).toBeVisible();
      await expect(page.locator('#document-files')).toBeEnabled();
      const data = await (await request.get('/api/bootstrap')).json();
      expect(data.documents).toHaveLength(0);
      expect(offline.app.store.all('SELECT * FROM chunks')).toHaveLength(0);
      await page.reload();
    });
  }
  await page.locator('#document-files').setInputFiles({ name: 'valid.txt', mimeType: 'text/plain', buffer: Buffer.from('青石桥的集合时间是星期日。') });
  await expect(page.locator('.document-row')).toContainText('valid.txt');
  await expect(page.locator('#main .inline-error')).toHaveCount(0);
  expect((await (await request.get('/api/bootstrap')).json()).documents).toHaveLength(1);
  expect(offline.calls.model).toHaveLength(0);
});

test('imported markup is displayed as inert text in search and chat evidence', async ({ page, offlineApp: offline }) => {
  const payload = '<img src=x onerror="window.importExecuted=true"><script>window.importExecuted=true</script>青石桥原始材料';
  await page.goto('/#knowledge');
  await page.locator('#document-files').setInputFiles({ name: '<b>青石桥</b>.txt', mimeType: 'text/plain', buffer: Buffer.from(payload) });
  await expect(page.locator('.document-row')).toHaveCount(1);
  await page.getByLabel('你想查找什么？', { exact: true }).fill('青石桥');
  await page.getByRole('button', { name: '检索资料', exact: true }).click();
  await expect(page.locator('.search-result .evidence-item')).toContainText(payload);
  await expect(page.locator('.search-result img, .search-result script')).toHaveCount(0);
  await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '对话', exact: true }).click();
  await page.locator('#chat-input').fill('请查阅青石桥原始材料。');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.locator('.message.assistant')).toHaveCount(1);
  await page.locator('.message.assistant summary').filter({ hasText: '知识来源' }).click();
  await expect(page.locator('.message.assistant .evidence-items')).toContainText(payload);
  await expect(page.locator('.message.assistant .evidence-items img, .message.assistant .evidence-items script')).toHaveCount(0);
  expect(await page.evaluate(() => window.importExecuted)).toBeUndefined();
  expect(offline.calls.mail).toHaveLength(0);
});
