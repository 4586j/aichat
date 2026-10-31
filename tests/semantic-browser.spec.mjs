import {test,expect} from './ui-test.mjs';
import {PNG} from './media-fixtures.mjs';

for(const mode of ['tags','native']) test(`semantic ${mode}: stages, media and click-to-play`,async({page,request})=>{
  const old=(await(await request.get('/api/settings')).json()).settings;
  const media=(await(await request.get('/api/media/settings')).json()).settings;
  let stickerId;
  try {
    await request.put('/api/settings',{data:{intentMode:'semantic',musicToolMode:mode}});
    await request.put('/api/media/settings',{data:{musicBaseUrl:'http://music-fixture.invalid',musicEnabled:true,stickersEnabled:true,stickerOnlineEnabled:false}});
    const upload=await(await request.post('/api/media/stickers',{data:{name:'生气测试图',description:'生气表达',tags:'生气 愤怒',scene:'general',intensity:2,data:PNG.toString('base64')}})).json();
    stickerId=upload.sticker.id;
    const {persona}=await(await request.post('/api/personas',{data:{name:`语义验收${mode}`,systemPrompt:'简洁回应'}})).json();
    const audioRequests=[];page.on('request',r=>{if(r.url().includes('/api/music/stream'))audioRequests.push(r.url());});
    await page.goto('/#chat');await page.getByLabel('选择聊天角色',{exact:true}).selectOption(persona.id);
    await page.locator('#chat-input').fill('语义演示：播放《安静片刻》，发个生气的表情');
    await page.getByRole('button',{name:'发送',exact:true}).click();
    await expect(page.locator('.generation-label')).toHaveText('正在理解…');
    await expect(page.getByRole('button',{name:'播放这首歌',exact:true})).toBeVisible({timeout:15000});
    await expect(page.locator('.reply-sticker img')).toBeVisible();
    const audio=page.locator('#background-audio');await expect(audio).toHaveJSProperty('paused',true);expect(audioRequests).toHaveLength(0);
    await page.getByRole('button',{name:'播放这首歌',exact:true}).click();
    await expect(audio).toHaveJSProperty('paused',false);
    await expect.poll(async()=>audio.evaluate(e=>e.currentTime),{timeout:10000}).toBeGreaterThan(0);
    expect(audioRequests.length).toBeGreaterThan(0);
    const body=await page.locator('#chat-messages').innerText();expect(body).not.toContain('offline_plan');expect(body).not.toContain('qiyi-media');
  } finally {
    if(stickerId)await request.delete(`/api/media/stickers/${stickerId}`,{data:{}});
    await request.put('/api/settings',{data:{intentMode:old.intentMode??'legacy',musicToolMode:old.musicToolMode}});
    await request.put('/api/media/settings',{data:{musicBaseUrl:media.musicBaseUrl,musicSource:media.musicSource,musicEnabled:media.musicEnabled,stickersEnabled:media.stickersEnabled,stickerOnlineEnabled:media.stickerOnlineEnabled}});
  }
});


test('stop during intent analysis aborts the request and does not persist a late attachment',async({page,request})=>{
 const old=(await(await request.get('/api/settings')).json()).settings;
 try {
  await request.put('/api/settings',{data:{intentMode:'semantic',musicToolMode:'tags'}});
  const {persona}=await(await request.post('/api/personas',{data:{name:'停止语义验收',systemPrompt:'简洁回应'}})).json();
  await page.goto('/#chat');await page.getByLabel('选择聊天角色',{exact:true}).selectOption(persona.id);
  const input='语义停止演示：发个生气的表情';await page.locator('#chat-input').fill(input);
  await page.getByRole('button',{name:'发送',exact:true}).click();await expect(page.locator('.generation-label')).toHaveText('正在理解…');
  await page.getByRole('button',{name:'停止生成',exact:true}).click();
  await expect(page.getByRole('button',{name:'发送',exact:true})).toBeVisible();
  await expect(page.locator('#chat-input')).toHaveValue(input);
  await expect(page.locator('.composer-wrap')).toContainText('已请求停止');
  const boot=await(await request.get('/api/bootstrap')).json();const conversation=boot.conversations.find(row=>row.personaId===persona.id);
  expect(conversation).toBeTruthy();
  await expect.poll(async()=>{const data=await(await request.get(`/api/conversations/${conversation.id}`)).json();return data.messages.length;}).toBe(0);
  await page.waitForTimeout(3500);
  const result=await(await request.get(`/api/conversations/${conversation.id}`)).json();expect(result.messages).toHaveLength(0);
  await expect(page.locator('.reply-sticker')).toHaveCount(0);
 } finally {await request.put('/api/settings',{data:{intentMode:old.intentMode??'legacy',musicToolMode:old.musicToolMode}});}
});

test('stop while the answer streams preserves the draft without committing partial text',async({page,request})=>{
 const old=(await(await request.get('/api/settings')).json()).settings;
 try {
  await request.put('/api/settings',{data:{intentMode:'semantic',musicToolMode:'tags'}});
  const {persona}=await(await request.post('/api/personas',{data:{name:'停止正文验收',systemPrompt:'简洁回应'}})).json();
  await page.goto('/#chat');await page.getByLabel('选择聊天角色',{exact:true}).selectOption(persona.id);
  const input='语义演示：流式演示';await page.locator('#chat-input').fill(input);
  await page.getByRole('button',{name:'发送',exact:true}).click();
  await expect(page.locator('#live-reply .live-body')).toContainText('第一段',{timeout:15000});
  await page.getByRole('button',{name:'停止生成',exact:true}).click();
  await expect(page.getByRole('button',{name:'发送',exact:true})).toBeVisible();await expect(page.locator('#chat-input')).toHaveValue(input);
  const boot=await(await request.get('/api/bootstrap')).json();const conversation=boot.conversations.find(row=>row.personaId===persona.id);
  expect(conversation).toBeTruthy();await page.waitForTimeout(2500);
  const result=await(await request.get(`/api/conversations/${conversation.id}`)).json();expect(result.messages).toHaveLength(0);
 } finally {await request.put('/api/settings',{data:{intentMode:old.intentMode??'legacy',musicToolMode:old.musicToolMode}});}
});
