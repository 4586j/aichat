import { test, expect } from '@playwright/test';
import { PNG } from './media-fixtures.mjs';

const nav=(page,name)=>page.getByRole('navigation',{name:'主导航'}).getByRole('link',{name,exact:true});
async function configure(request,value={}){const response=await request.put('/api/media/settings',{data:{musicBaseUrl:'',musicEnabled:true,stickersEnabled:true,stickerOnlineEnabled:true,stickerSearchUrl:'',clearMusicApiKey:!value.musicApiKey,clearStickerApiKey:!value.stickerApiKey,...value}});expect(response.ok()).toBe(true);return response.json();}
async function chat(page,request,question='媒体演示，请推荐一首歌并发表情'){
  const response=await request.post('/api/personas',{data:{name:`媒体验证${Date.now()}`,systemPrompt:'简洁回应。'}});const {persona}=await response.json();
  await page.goto(`/?media=${persona.id}#chat`);await page.getByLabel('选择聊天角色',{exact:true}).selectOption(persona.id);
  await page.getByLabel('发送给当前角色的消息',{exact:true}).fill(question);await page.getByRole('button',{name:'发送',exact:true}).click();
  await expect(page.locator('.message.assistant')).toBeVisible();return persona;
}
async function localBackground(page){
  await page.getByRole('button',{name:'打开音乐播放器',exact:true}).click();await page.getByRole('button',{name:'浏览本地曲库',exact:true}).click();
  await page.locator('.music-result').filter({hasText:'安静片刻'}).getByRole('button',{name:'播放',exact:true}).click();
  await expect(page.locator('#background-audio')).toHaveJSProperty('paused',false);
  await page.getByRole('button',{name:'关闭音乐面板',exact:true}).click();
  await expect(page.locator('#startup-screen')).toHaveCount(0);
}
test.afterEach(async({request})=>{await configure(request);});

test('blank service is explicit, offline by default and media settings save separately',async({page,request})=>{
  await configure(request);const calls=[];page.on('request',r=>{if(r.url().includes('/api/music/'))calls.push(r.url());});
  await page.goto('/#settings');await expect(page.getByLabel('音乐服务地址',{exact:true})).toHaveValue('');expect(calls).toHaveLength(0);
  await page.getByRole('button',{name:'打开音乐播放器',exact:true}).click();await expect(page.locator('#music-service-state')).toContainText('音乐服务未配置');
  await expect(page.getByRole('button',{name:'搜索歌曲',exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'浏览本地曲库',exact:true})).toBeDisabled();expect(calls).toHaveLength(0);
  await page.getByRole('button',{name:'关闭音乐面板',exact:true}).click();
  await page.getByLabel('音乐服务地址',{exact:true}).fill('http://music-fixture.invalid');await page.getByLabel('音乐服务 API Key',{exact:true}).fill('secret-key');
  await page.getByRole('button',{name:'保存媒体设置',exact:true}).click();await expect(page.getByText('媒体设置已保存。音乐连接不会自动测试。',{exact:true})).toBeVisible();
  await expect(page.getByLabel('音乐服务 API Key',{exact:true})).toHaveValue('');expect(calls).toHaveLength(0);
  await page.getByRole('button',{name:'测试已保存的音乐连接',exact:true}).click();await expect(page.locator('#media-settings-feedback')).toContainText('连接成功');
  expect(await page.evaluate(()=>Object.values(localStorage).join(' ').includes('secret-key'))).toBe(false);
});

test('local uploads can be edited and disabled; AI stickers and pending songs survive history reload',async({page,request})=>{
  await configure(request);await page.goto('/#settings');
  await page.getByLabel('选择表情图片',{exact:true}).setInputFiles({name:'sample.png',mimeType:'image/png',buffer:PNG});
  await page.getByLabel('表情名称',{exact:true}).fill('点头测试');await page.getByLabel('标签',{exact:true}).first().fill('同意 点头');
  await page.getByRole('button',{name:'加入本地图库',exact:true}).click();const tile=page.locator('.sticker-tile').filter({has:page.locator('strong',{hasText:'点头测试'})});await expect(tile).toBeVisible();
  await tile.locator('summary').click();await tile.getByLabel('名称',{exact:true}).fill('更新测试');await tile.getByRole('button',{name:'保存表情说明',exact:true}).click();
  const edited=page.locator('.sticker-tile').filter({has:page.locator('strong',{hasText:'更新测试'})});await edited.getByRole('button',{name:'停用更新测试',exact:true}).click();await expect(edited).toHaveClass(/is-disabled/);
  const persona=await chat(page,request);await expect(page.locator('.reply-sticker img')).toHaveAttribute('alt','好耶');await expect(page.getByRole('region',{name:'待查询的歌曲推荐'})).toContainText('未配置');
  await expect(page.locator('.message.assistant')).not.toContainText('<qiyi-media>');
  await page.reload();await page.getByLabel('选择聊天角色',{exact:true}).selectOption(persona.id);await page.getByRole('button', { name: '历史对话', exact: true }).click(); await page.locator('.history-item').filter({hasText:'媒体演示'}).click();
  await expect(page.locator('.reply-sticker img')).toHaveAttribute('alt','好耶');await expect(page.locator('.song-pending')).toContainText('安静片刻');
  const info=await(await request.get('/api/media/settings')).json();const upload=info.stickers.find(s=>s.name==='更新测试');await request.delete(`/api/media/stickers/${upload.id}`,{data:{}});
});

test('real audio element plays the service stream, seeks, queues and survives page navigation',async({page,request},testInfo)=>{
  await configure(request,{musicBaseUrl:'http://music-fixture.invalid'});await page.goto('/');await localBackground(page);
  await page.evaluate(()=>{window.savedAudio=document.querySelector('#background-audio');});
  const audio=page.locator('#background-audio');await expect(async()=>expect(await audio.evaluate(e=>e.currentTime)).toBeGreaterThan(0)).toPass();
  await page.locator('#player-seek').evaluate(e=>{e.value='50';e.dispatchEvent(new Event('input',{bubbles:true}));});await expect(async()=>expect(await audio.evaluate(e=>e.currentTime)).toBeGreaterThan(9)).toPass();
  for(const name of ['知识库','记忆','设置','对话']){await nav(page,name).click();await expect(audio).toHaveJSProperty('paused',false);expect(await page.evaluate(()=>window.savedAudio===document.querySelector('#background-audio'))).toBe(true);}
  const composer=await page.locator('.composer-wrap').boundingBox(),dock=await page.locator('#music-dock').boundingBox();expect(composer.x+composer.width<=dock.x || composer.y+composer.height<=dock.y).toBe(true);
  await page.getByRole('button',{name:'打开音乐播放器',exact:true}).click();await page.getByLabel('搜索歌曲或歌手',{exact:true}).fill('晚风');await page.getByRole('button',{name:'搜索歌曲',exact:true}).click();
  await page.locator('.music-result').filter({hasText:'晚风练习'}).getByRole('button',{name:'待播',exact:true}).click();await expect(page.locator('#music-queue-list li')).toHaveCount(2);
  await page.getByLabel('播放面板音量',{exact:true}).evaluate(e=>{e.value='.35';e.dispatchEvent(new Event('input',{bubbles:true}));});await expect(audio).toHaveJSProperty('volume',.35);
  await page.getByRole('button',{name:'关闭音乐面板',exact:true}).click();await page.getByRole('button',{name:'下一首',exact:true}).click();await expect(page.locator('#player-title')).toHaveText('晚风练习');
  await page.getByRole('button',{name:'暂停音乐',exact:true}).click();await expect(audio).toHaveJSProperty('paused',true);await page.getByRole('button',{name:'播放音乐',exact:true}).click();await expect(audio).toHaveJSProperty('paused',false);
  await page.screenshot({path:testInfo.outputPath('desktop-media-player.png'),fullPage:true});
  await page.reload();await expect(audio).toHaveJSProperty('paused',true);await expect(page.locator('#music-dock')).not.toBeVisible();
});

test('playing a recommendation restores background music; explicit pause prevents automatic resume',async({page,request})=>{
  await configure(request,{musicBaseUrl:'http://music-fixture.invalid'});await chat(page,request);
  await page.getByRole('button',{name:'打开音乐播放器',exact:true}).click();await page.getByLabel('搜索歌曲或歌手',{exact:true}).fill('晚风');await page.getByRole('button',{name:'搜索歌曲',exact:true}).click();
  await page.locator('.music-result').getByRole('button',{name:'播放',exact:true}).click();await expect(page.locator('#background-audio')).toHaveJSProperty('paused',false);await page.getByRole('button',{name:'关闭音乐面板',exact:true}).click();
  await page.getByRole('button',{name:'播放这首歌',exact:true}).click();await expect(page.locator('#player-title')).toHaveText('安静片刻');
  await page.locator('#background-audio').evaluate(e=>e.dispatchEvent(new Event('ended')));await expect(page.locator('#player-title')).toHaveText('晚风练习');await expect(page.locator('#background-audio')).toHaveJSProperty('paused',false);
  await page.getByRole('button',{name:'播放这首歌',exact:true}).click();await expect(page.locator('#player-title')).toHaveText('安静片刻');await page.getByRole('button',{name:'暂停音乐',exact:true}).click();
  await page.locator('#background-audio').evaluate(e=>e.dispatchEvent(new Event('ended')));await expect(page.locator('#player-title')).toHaveText('安静片刻');await expect(page.locator('#background-audio')).toHaveJSProperty('paused',true);
});

test('a slower earlier track lookup cannot replace the last song the user selected',async({page,request})=>{
  await configure(request,{musicBaseUrl:'http://music-fixture.invalid'});
  const local=await(await request.get('/api/music/search')).json();const id=local.songs[0].id;
  let release,observed;const gate=new Promise(resolve=>{release=resolve;});const firstSeen=new Promise(resolve=>{observed=resolve;});
  await page.route(`**/api/music/song?id=${id}`,async route=>{observed();await gate;await route.continue();});
  await page.goto('/');await page.getByRole('button',{name:'打开音乐播放器',exact:true}).click();await page.getByRole('button',{name:'浏览本地曲库',exact:true}).click();
  await page.locator('.music-result').getByRole('button',{name:'播放',exact:true}).click();await firstSeen;
  await page.getByLabel('搜索歌曲或歌手',{exact:true}).fill('晚风');await page.getByRole('button',{name:'搜索歌曲',exact:true}).click();
  await page.locator('.music-result').getByRole('button',{name:'播放',exact:true}).click();await expect(page.locator('#player-title')).toHaveText('晚风练习');
  const response=page.waitForResponse(r=>r.url().includes(`/api/music/song?id=${id}`));release();await response;
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await expect(page.locator('#player-title')).toHaveText('晚风练习');await expect(page.locator('#background-audio')).toHaveJSProperty('paused',false);
});

test('online sticker fallback and opt-in animated preview work without raw provider URLs',async({page,request})=>{
  await configure(request,{stickerSearchUrl:'http://stickers-fixture.invalid/api/v1/stickers/search',stickerApiKey:'fixture-sticker-key'});await chat(page,request,'发一个害羞表情，联网表情演示');await expect(page.locator('.reply-sticker figcaption')).toContainText('联网');
  await expect(page.locator('.reply-sticker img')).toHaveAttribute('src',/^\/api\/media\/sticker-image\?id=remote-/);
  const gif=Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==','base64');
  const upload=await(await request.post('/api/media/stickers',{data:{name:'动图演示',tags:'动图 演示',data:gif.toString('base64')}})).json();
  await page.emulateMedia({reducedMotion:'reduce'});const calls=[];page.on('request',r=>{if(r.url().includes(upload.sticker.id))calls.push(r.url());});
  await chat(page,request,'动图演示');await expect(page.locator('.sticker-reveal')).toBeVisible();expect(calls).toHaveLength(0);
  await page.getByRole('button',{name:'查看表情：动图演示',exact:true}).click();await expect(page.locator('.reply-sticker img')).toBeVisible();await expect(async()=>expect(calls.length).toBeGreaterThan(0)).toPass();
  await request.delete(`/api/media/stickers/${upload.sticker.id}`,{data:{}});
});

test('protected semantic sticker history follows key rotation and shows a fallback after authentication fails',async({page,request},testInfo)=>{
  await configure(request,{stickerSearchUrl:'http://stickers-fixture.invalid/api/v1/stickers/search',stickerApiKey:'fixture-sticker-key'});
  const browserRequests=[];page.on('request',r=>browserRequests.push({url:r.url(),headers:r.headers()}));
  const persona=await chat(page,request,'发一个害羞表情，联网表情演示');
  const image=page.locator('.reply-sticker img');
  await expect(image).toHaveAttribute('alt','害羞小猫：温柔地表达害羞和亲近');
  await expect(image).toHaveJSProperty('naturalWidth',1);
  const src=await image.getAttribute('src');expect(src).toMatch(/^\/api\/media\/sticker-image\?id=remote-[a-f0-9]{64}$/);
  const response=await request.put('/api/media/settings',{data:{stickerApiKey:'fixture-sticker-key-rotated'}});expect(response.ok()).toBe(true);
  await page.reload();await page.getByLabel('选择聊天角色',{exact:true}).selectOption(persona.id);
  await page.getByRole('button',{name:'历史对话',exact:true}).click();await page.locator('.history-item').filter({hasText:'联网表情演示'}).click();
  await expect(image).toHaveAttribute('src',src);await expect(image).toHaveJSProperty('naturalWidth',1);
  expect(browserRequests.some(r=>r.url.includes('stickers-fixture.invalid'))).toBe(false);
  expect(browserRequests.some(r=>JSON.stringify(r).includes('fixture-sticker-key'))).toBe(false);
  expect(await page.evaluate(()=>JSON.stringify({...localStorage}).includes('fixture-sticker-key'))).toBe(false);
  await request.put('/api/media/settings',{data:{stickerApiKey:'invalid-key'}});
  await page.reload();await page.getByLabel('选择聊天角色',{exact:true}).selectOption(persona.id);await page.getByRole('button',{name:'历史对话',exact:true}).click();await page.locator('.history-item').filter({hasText:'联网表情演示'}).click();
  await expect(page.locator('.reply-sticker .sticker-fallback')).toBeVisible();await expect(page.locator('.message.assistant')).toContainText('这是离线测试回复');
  await expect(page.locator('#startup-screen')).toHaveCount(0);await page.waitForLoadState('networkidle');
  await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath('remote-sticker-failure-mobile.png')});
});

test.describe('mobile media',()=>{
  test.use({hasTouch:true,isMobile:true});
  for(const width of [320,390])test(`player and media settings fit ${width}px`,async({page,request},testInfo)=>{
    await configure(request,{musicBaseUrl:'http://music-fixture.invalid'});await page.setViewportSize({width,height:844});await page.goto('/');await localBackground(page);
    const player=await page.locator('#music-dock').boundingBox(),navigation=await page.locator('#navigation').boundingBox();expect(player.y).toBeGreaterThan(navigation.y+navigation.height);expect(player.y+player.height).toBeLessThanOrEqual(844);expect(player.x).toBeGreaterThanOrEqual(0);expect(player.x+player.width).toBeLessThanOrEqual(width);
    const send=await page.getByRole('button',{name:'发送',exact:true}).boundingBox();expect(send.y+send.height).toBeLessThanOrEqual(player.y);
    expect((await page.locator('.player-track').boundingBox()).width).toBeGreaterThan(80);
    await expect(page.locator('#player-loop')).toBeVisible();
    await page.screenshot({path:testInfo.outputPath('mobile-music-player.png')});
    await nav(page,'设置').click();await expect(page.getByLabel('音乐服务地址',{exact:true})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.getByRole('button',{name:'打开音乐播放器',exact:true}).click();await expect(page.getByLabel('播放面板音量',{exact:true})).toBeVisible();expect(await page.locator('#music-browser').evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);
    await page.getByRole('button',{name:'关闭音乐面板',exact:true}).click();await page.getByRole('button',{name:'停止并关闭播放器',exact:true}).click();await expect(page.locator('#background-audio')).toHaveJSProperty('paused',true);
  });
});
