import { test, expect } from './ui-test.mjs';

let originalModel, originalMedia;
test.beforeEach(async ({ request }) => {
  originalModel = (await (await request.get('/api/settings')).json()).settings;
  const media = (await (await request.get('/api/media/settings')).json()).settings;
  originalMedia = Object.fromEntries(['musicBaseUrl', 'musicSource', 'musicEnabled', 'stickersEnabled'].map(key => [key, media[key]]));
  expect((await request.put('/api/settings', { data: { musicToolMode: 'native' } })).ok()).toBe(true);
  expect((await request.put('/api/media/settings', { data: { musicBaseUrl: 'http://music-fixture.invalid', musicSource: 'qq', musicEnabled: true, stickersEnabled: false } })).ok()).toBe(true);
});
test.afterEach(async ({ request }) => {
  await request.put('/api/settings', { data: { musicToolMode: originalModel.musicToolMode } });
  await request.put('/api/media/settings', { data: originalMedia });
});

async function prepare(page, request) {
  const errors = [], audioRequests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('request', request => { if (request.url().includes('/api/music/stream')) audioRequests.push(request.url()); });
  const { persona } = await (await request.post('/api/personas', { data: { name: `点歌验证${Date.now()}`, systemPrompt: '简洁回应。' } })).json();
  await page.goto('/#chat');
  await expect(page.locator('#startup-screen')).toHaveCount(0);
  await page.getByLabel('选择聊天角色', { exact: true }).selectOption(persona.id);
  await page.evaluate(() => {
    const fetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const response = await fetch(...args);
      if (/\/messages$/u.test(new URL(response.url).pathname)) window.lastMusicStream = response.clone().text();
      return response;
    };
    window.musicProtocolLeaked = false;
    new MutationObserver(() => {
      if (/qiyi-media|qiyi-state|tool_calls|offline_music_call|"query"/.test(document.querySelector('#chat-messages').textContent)) window.musicProtocolLeaked = true;
    }).observe(document.querySelector('#chat-messages'), { subtree: true, childList: true, characterData: true });
  });
  return { persona, errors, audioRequests };
}

async function send(page, content) {
  const completed = page.waitForResponse(response => /\/messages$/u.test(new URL(response.url()).pathname) && response.request().method() === 'POST');
  await page.locator('#chat-input').fill(content);
  await page.getByRole('button', { name: '发送', exact: true }).click();
  const response = await completed;
  expect(response.headers()['content-type']).toContain('text/event-stream');
  const body = await page.evaluate(() => window.lastMusicStream);
  const events = body.split('\n\n').filter(Boolean);
  expect(events.filter(event => event.startsWith('event: done\n'))).toHaveLength(1);
  expect(body).not.toContain('event: error');
  const done = JSON.parse(events.find(event => event.startsWith('event: done\n')).split('\ndata: ')[1]);
  await expect(page.locator('#live-reply')).toHaveCount(0);
  await expect(page.locator('.message.assistant')).toHaveCount(1);
  expect(await page.evaluate(() => window.musicProtocolLeaked)).toBe(false);
  return done;
}

for (const [mode, question] of [
  ['tags', '放歌'], ['tags', '播放《安静片刻》'], ['tags', '播放离线测试音源的《安静片刻》'], ['tags', '放点摇滚'],
  ['native', '播放《安静片刻》'], ['native', '播放《安静片刻》，只回正文'],
]) test(`${mode}: ${question} produces one card in done and history, never autoplay`, async ({ page, request }, info) => {
  await request.put('/api/settings', { data: { musicToolMode: mode } });
  const { persona, errors, audioRequests } = await prepare(page, request);
  const done = await send(page, question);
  expect(done.message.attachments).toHaveLength(1);
  expect(done.message.attachments[0].type).toBe('song');
  await expect(page.getByRole('button', { name: '播放这首歌', exact: true })).toHaveCount(1);
  const audio = page.locator('#background-audio');
  await expect(audio).toHaveJSProperty('paused', true);
  expect(audioRequests).toHaveLength(0);
  await expect(page.locator('.message.user')).toHaveCount(1);
  if (mode === 'native' && !question.includes('只回正文')) {
    await expect(page.locator('.message.assistant')).toContainText('已找到《安静片刻》');
    await page.screenshot({ path: info.outputPath('native-music-card-desktop.png'), fullPage: true, animations: 'disabled' });
  }
  await page.getByRole('button', { name: '播放这首歌', exact: true }).click();
  await expect(audio).toHaveJSProperty('paused', false);
  expect(audioRequests.length).toBeGreaterThan(0);
  await page.reload();
  await page.getByLabel('选择聊天角色', { exact: true }).selectOption(persona.id);
  await page.getByRole('button', { name: '历史对话', exact: true }).click();
  await page.locator('.history-item').filter({ hasText: question }).click();
  await expect(page.locator('.message.user')).toHaveCount(1);
  await expect(page.locator('.message.assistant')).toHaveCount(1);
  await expect(page.getByRole('button', { name: '播放这首歌', exact: true })).toHaveCount(1);
  await expect(audio).toHaveJSProperty('paused', true);
  expect(errors).toEqual([]);
});

for (const mode of ['tags', 'native']) {
  for (const question of ['不要播放《安静片刻》', '播放《安静片刻》，别搜歌了', '如何实现放歌功能', '> 播放《安静片刻》']) {
    test(`${mode}: no card for ${question}`, async ({ page, request }) => {
      await request.put('/api/settings', { data: { musicToolMode: mode } });
      const { errors, audioRequests } = await prepare(page, request);
      const done = await send(page, question);
      expect(done.message.attachments).toEqual([]);
      await expect(page.getByRole('button', { name: '播放这首歌', exact: true })).toHaveCount(0);
      await expect(page.locator('#background-audio')).toHaveJSProperty('paused', true);
      expect(audioRequests).toHaveLength(0);
      expect(errors).toEqual([]);
    });
  }
}

test('a singer correction after a song request produces a second card',async ({page,request})=>{
  await request.put('/api/settings',{data:{musicToolMode:'tags'}});
  const {errors,audioRequests}=await prepare(page,request);
  await send(page,'播放安静片刻');
  await page.locator('#chat-input').fill('换成离线测试音源唱的');
  await page.getByRole('button',{name:'发送',exact:true}).click();
  await expect(page.locator('#live-reply')).toHaveCount(0);
  await expect(page.locator('.message.assistant')).toHaveCount(2);
  const reply=page.locator('.message.assistant').last();
  await expect(reply.getByRole('button',{name:'播放这首歌',exact:true})).toBeVisible();
  await expect(reply).toContainText('离线测试音源');
  await expect(page.locator('#background-audio')).toHaveJSProperty('paused',true);
  expect(audioRequests).toHaveLength(0);expect(errors).toEqual([]);
});

test('master off blocks explicit music in the streaming browser path', async ({ page, request }) => {
  await request.put('/api/media/settings', { data: { musicEnabled: false } });
  const { errors, audioRequests } = await prepare(page, request);
  const done = await send(page, '播放《安静片刻》');
  expect(done.message.attachments).toEqual([]);
  await expect(page.locator('#background-audio')).toHaveJSProperty('paused', true);
  expect(audioRequests).toHaveLength(0);
  expect(errors).toEqual([]);
});

test('an unconfigured music service yields one pending card without audio requests', async ({ page, request }) => {
  await request.put('/api/media/settings', { data: { musicBaseUrl: '' } });
  const { errors, audioRequests } = await prepare(page, request);
  const done = await send(page, '播放《安静片刻》');
  expect(done.message.attachments).toHaveLength(1);
  expect(done.message.attachments[0].type).toBe('song-search');
  await expect(page.getByRole('region', { name: '待查询的歌曲推荐' })).toContainText('未配置');
  await expect(page.locator('#background-audio')).toHaveJSProperty('paused', true);
  expect(audioRequests).toHaveLength(0);
  expect(errors).toEqual([]);
});

test('receiving a native music card leaves playing audio, volume and queue unchanged', async ({ page, request }) => {
  const { audioRequests, errors } = await prepare(page, request);
  await page.getByRole('button', { name: '打开音乐播放器', exact: true }).click();
  await page.getByRole('button', { name: '浏览本地曲库', exact: true }).click();
  await page.locator('.music-result').filter({ hasText: '安静片刻' }).getByRole('button', { name: '播放', exact: true }).click();
  const audio = page.locator('#background-audio');
  await expect(audio).toHaveJSProperty('paused', false);
  await page.getByLabel('播放面板音量', { exact: true }).evaluate(element => { element.value = '.35'; element.dispatchEvent(new Event('input', { bubbles: true })); });
  const queue = await page.locator('#music-queue-list').textContent();
  const before = await audio.evaluate(element => ({ source: element.currentSrc, time: element.currentTime }));
  const requestsBefore = audioRequests.length;
  await page.getByRole('button', { name: '关闭音乐面板', exact: true }).click();
  await send(page, '播放《安静片刻》');
  await expect(audio).toHaveJSProperty('paused', false);
  await expect(audio).toHaveJSProperty('volume', .35);
  expect(await audio.evaluate(element => element.currentSrc)).toBe(before.source);
  expect(await audio.evaluate(element => element.currentTime)).toBeGreaterThan(before.time);
  expect(audioRequests).toHaveLength(requestsBefore);
  await page.getByRole('button', { name: '打开音乐播放器', exact: true }).click();
  expect(await page.locator('#music-queue-list').textContent()).toBe(queue);
  expect(errors).toEqual([]);
});

for (const width of [320, 390]) test(`native streamed music card fits ${width}px phones`, async ({ page, request }, info) => {
  await page.setViewportSize({ width, height: 844 });
  const { errors, audioRequests } = await prepare(page, request);
  await send(page, '播放《安静片刻》');
  const play = page.getByRole('button', { name: '播放这首歌', exact: true });
  await expect(play).toBeVisible();
  await page.locator('.song-recommendation').evaluate(element => element.scrollIntoView({ block: 'center', behavior: 'instant' }));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath(`native-music-card-${width}.png`), fullPage: true, animations: 'disabled' });
  await expect(page.locator('#background-audio')).toHaveJSProperty('paused', true);
  expect(audioRequests).toHaveLength(0);
  expect(errors).toEqual([]);
});
