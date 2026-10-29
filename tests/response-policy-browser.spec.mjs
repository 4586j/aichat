import { test, expect } from '@playwright/test';
const defaults={stickerLinked:true,musicLinked:true,petLinked:true};
const happy='联动演示：今天很开心，想轻松聊天。';
const tired='联动演示：今天好累，我只想说说。';
const nav=(page,name)=>page.getByRole('navigation',{name:'主导航'}).getByRole('link',{name,exact:true});
async function settings(request,values=defaults){const current=(await(await request.get('/api/response-settings')).json()).responseSettings;return request.put('/api/response-settings',{data:{...values,expectedRevision:current.revision}});}
test.beforeEach(async({request})=>{await settings(request);await request.put('/api/media/settings',{data:{musicBaseUrl:'http://music-fixture.invalid',musicEnabled:true,stickersEnabled:true}});await request.put('/api/pets/settings',{data:{enabled:true,animations:true,selectedId:'cream-cat'}});});
test.afterEach(async({request})=>{await settings(request);await request.put('/api/media/settings',{data:{musicBaseUrl:'',stickerSearchUrl:''}});});
async function fresh(page,request){const{persona}=await(await request.post('/api/personas',{data:{name:'回应联动测试',systemPrompt:'清晰温和地回答。'}})).json();await page.emulateMedia({reducedMotion:'reduce'});await page.goto(`/?response=${persona.id}#chat`);await page.getByLabel('选择聊天角色',{exact:true}).selectOption(persona.id);await expect(page.locator('#startup-screen')).toHaveCount(0);return persona;}
async function send(page,content){const count=await page.locator('.message.assistant').count();await page.locator('#chat-input').fill(content);await page.getByRole('button',{name:'发送',exact:true}).click();await expect(page.locator('.message.assistant')).toHaveCount(count+1);return page.locator('.message.assistant').last();}
async function seed(page,request,persona,n=4){
  if(page.viewportSize().width<=700){
    for(let i=0;i<n;i++)await send(page,'普通闲聊。');
    return(await(await request.get('/api/bootstrap')).json()).conversations.find(c=>c.personaId===persona.id);
  }
  const{conversation}=await(await request.post('/api/conversations',{data:{personaId:persona.id,title:'联动间隔测试'}})).json();
  for(let i=0;i<n;i++)await request.post(`/api/conversations/${conversation.id}/messages`,{data:{content:'普通闲聊。'}});
  await page.getByRole('button',{name:'刷新本地数据',exact:true}).click();await page.getByRole('button', { name: '历史对话', exact: true }).click(); await page.locator(`.history-item[data-id="${conversation.id}"]`).click();await expect(page.locator('.message.assistant')).toHaveCount(n);return conversation;
}

test('same-turn fatigue selects gentle local sticker, quiet pet and visible original evidence',async({page,request},info)=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));await fresh(page,request);let outgoing=0;page.on('request',r=>{if(/\/api\/conversations\/[^/]+\/messages$/.test(r.url()))outgoing++;});
  const reply=await send(page,tired);await expect(reply.locator('.reply-sticker img')).toHaveAttribute('alt','歇一会儿');await expect(reply.locator('.song-recommendation')).toHaveCount(0);await expect(page.locator('.pet-trigger [data-pet-portrait]')).toHaveAttribute('data-phase','quiet');
  await reply.locator('.response-basis summary').click();await expect(reply.locator('.response-basis')).toContainText('今天好累');await expect(reply.locator('.response-basis')).toContainText('只想说说');await expect(reply).not.toContainText('qiyi-state');expect(outgoing).toBe(1);expect(errors).toEqual([]);await page.screenshot({path:info.outputPath('response-gentle-desktop.png')});
});

test('natural song recommendation starts on reply five and waits for a user click to play',async({page,request},info)=>{
  const persona=await fresh(page,request);await seed(page,request,persona);const streams=[];page.on('request',r=>{if(r.url().includes('/api/music/stream'))streams.push(r.url());});
  const reply=await send(page,happy);await expect(reply.getByRole('region',{name:'歌曲推荐',exact:true})).toContainText('安静片刻');await expect(reply.locator('.reply-sticker')).toHaveCount(0);await expect(page.locator('#background-audio')).toHaveJSProperty('paused',true);expect(streams).toHaveLength(0);
  await page.screenshot({path:info.outputPath('response-song-desktop.png')});await reply.getByRole('button',{name:'播放这首歌',exact:true}).click();await expect(page.locator('#background-audio')).toHaveJSProperty('paused',false);expect(streams.length).toBeGreaterThan(0);
  const next=await send(page,happy);await expect(next.locator('.song-recommendation')).toHaveCount(0);await expect(page.locator('#background-audio')).toHaveJSProperty('paused',false);
});

test('skip, restore, conversation mute, explicit request and unmute persist across reload',async({page,request})=>{
  const persona=await fresh(page,request);const conversation=await seed(page,request,persona);let reply=await send(page,happy);
  await reply.getByRole('button',{name:'这次不需要',exact:true}).click();await expect(reply.locator('.song-recommendation')).toHaveCount(0);await reply.getByRole('button',{name:'重新显示这首歌',exact:true}).click();await expect(reply.locator('.song-recommendation')).toHaveCount(1);
  await reply.getByRole('button',{name:'本会话不再主动推荐',exact:true}).click();await expect(page.locator('.response-session')).toContainText('暂停主动推歌');await expect(page.locator('#background-audio')).toHaveJSProperty('paused',true);
  await page.reload();await page.getByLabel('选择聊天角色',{exact:true}).selectOption(persona.id);await page.getByRole('button', { name: '历史对话', exact: true }).click(); await page.locator(`.history-item[data-id="${conversation.id}"]`).click();await expect(page.locator('.response-session')).toContainText('暂停主动推歌');
  reply=await send(page,`${happy}请推荐一首歌。`);await expect(reply.locator('.song-recommendation')).toHaveCount(1);await page.getByRole('button',{name:'恢复本会话推荐',exact:true}).click();await expect(page.locator('.response-session')).toHaveCount(0);
});

test('three switches save independently and disable proactive media without changing pet preference',async({page,request},info)=>{
  const persona=await fresh(page,request);await nav(page,'设置').click();for(const label of ['表情包随情绪回应','低频自然推荐歌曲','宠物随对话状态表现'])await page.getByLabel(label,{exact:true}).uncheck();
  let outgoing=0;page.on('request',r=>{if(r.url().includes('/api/music/')||r.url().includes('/messages'))outgoing++;});
  await page.getByRole('button',{name:'保存回应联动设置',exact:true}).click();await expect(page.getByText('回应联动设置已保存。',{exact:true})).toBeVisible();expect(outgoing).toBe(0);await page.locator('.response-settings').screenshot({path:info.outputPath('response-settings-desktop.png')});
  const saved=(await(await request.get('/api/response-settings')).json()).responseSettings;expect(saved.stickerLinked).toBe(false);expect(saved.musicLinked).toBe(false);expect(saved.petLinked).toBe(false);expect((await(await request.get('/api/pets')).json()).settings.animations).toBe(true);
  await nav(page,'对话').click();const reply=await send(page,tired);await expect(reply.locator('.reply-sticker,.song-recommendation')).toHaveCount(0);await expect(page.locator('.pet-trigger [data-pet-portrait]')).not.toHaveAttribute('data-phase','quiet');
  await page.reload();await nav(page,'设置').click();await expect(page.getByLabel('宠物随对话状态表现',{exact:true})).not.toBeChecked();
});

test('sticker scene and intensity can be edited and restored with their metadata',async({page,request})=>{
  await fresh(page,request);await nav(page,'设置').click();const tile=page.locator('.sticker-tile').filter({has:page.locator('strong',{hasText:'抱抱'})});await tile.locator('summary').click();await tile.getByLabel('联动场景',{exact:true}).selectOption('rest');await tile.getByLabel('表达强度',{exact:true}).selectOption('2');await tile.getByRole('button',{name:'保存表情说明',exact:true}).click();
  await expect(tile.getByLabel('联动场景',{exact:true})).toHaveValue('rest');await expect(tile.getByLabel('表达强度',{exact:true})).toHaveValue('2');await request.put('/api/media/stickers/leaf-hug',{data:{scene:'comfort',intensity:1}});
});

test('manual current need governs pet focus and reduced motion stops all new poses',async({page,request})=>{
  await fresh(page,request);await send(page,'联动演示：先帮我解决问题。');await expect(page.locator('.pet-trigger [data-pet-portrait]')).toHaveAttribute('data-phase','focus');expect(await page.locator('.pet-trigger img').evaluate(e=>getComputedStyle(e).animationName)).toBe('none');
  await page.getByRole('button',{name:'查看和调整对话状态',exact:true}).click();await page.locator('[data-state-manual="need"]').check();await page.locator('#state-value-need').selectOption('listen');await page.getByRole('button',{name:'保存状态修改',exact:true}).click();await expect(page.locator('.pet-trigger [data-pet-portrait]')).toHaveAttribute('data-phase','comfort');
});

test('settings conflicts preserve unsaved choices until the user reloads settings',async({page,request})=>{
  await fresh(page,request);await nav(page,'设置').click();await page.getByLabel('低频自然推荐歌曲',{exact:true}).uncheck();await settings(request,{petLinked:false});await page.getByRole('button',{name:'保存回应联动设置',exact:true}).click();await expect(page.locator('#response-settings-form [role="alert"]')).toContainText('另一处修改');await expect(page.getByLabel('低频自然推荐歌曲',{exact:true})).not.toBeChecked();
  await page.getByRole('button',{name:'重新读取联动设置',exact:true}).click();await expect(page.getByLabel('宠物随对话状态表现',{exact:true})).not.toBeChecked();await expect(page.getByLabel('低频自然推荐歌曲',{exact:true})).toBeChecked();
});

for(const width of [320,390])test(`linked song feedback and independent switches fit ${width}px phones`,async({page,request},info)=>{
  await page.setViewportSize({width,height:844});const persona=await fresh(page,request);await seed(page,request,persona);const reply=await send(page,happy);await expect(reply.locator('.song-recommendation')).toHaveCount(1);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await reply.getByRole('button',{name:'这次不需要',exact:true}).click();await expect(reply.getByRole('button',{name:'重新显示这首歌',exact:true})).toBeVisible();await page.screenshot({path:info.outputPath(`response-mobile-${width}.png`)});await nav(page,'设置').click();await expect(page.getByRole('heading',{name:'让回应贴合此刻',exact:true})).toBeVisible();expect(await page.locator('.response-settings').evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);
  await page.getByLabel('宠物随对话状态表现',{exact:true}).uncheck();await page.getByRole('button',{name:'保存回应联动设置',exact:true}).click();await expect(page.getByText('回应联动设置已保存。',{exact:true})).toBeVisible();
});
