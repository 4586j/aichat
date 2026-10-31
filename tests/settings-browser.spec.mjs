import {test,expect} from './ui-test.mjs';

let original;
test.beforeEach(async({request})=>{
  original=(await(await request.get('/api/settings')).json()).settings;
  await request.put('/api/settings',{data:{model:'',baseUrl:'http://model.invalid/v1',clearApiKey:true,musicToolMode:'tags'}});
});
test.afterEach(async({request})=>{await request.put('/api/settings',{data:{model:original.model,baseUrl:original.baseUrl,clearApiKey:true,musicToolMode:original.musicToolMode??'tags',memoryMessageThreshold:original.memoryMessageThreshold}});});
async function fill(page){
  await page.goto('/#settings');
  await page.locator('#settings-baseUrl').fill('https://model.invalid/api/coding/v3');
  await page.getByLabel('模型名称',{exact:true}).fill('model-draft-test');
  await page.locator('#settings-apiKey').fill('MODEL_DRAFT_TEST_KEY');
}
function actions(page){
  const calls=[];page.on('request',request=>{
    if(request.url().endsWith('/api/settings')&&request.method()==='PUT')calls.push({type:'save',data:request.postDataJSON()});
    if(request.url().endsWith('/api/settings/test'))calls.push({type:'test'});
  });return calls;
}

test('music tool mode defaults to tags and selecting either mode makes no request',async({page,request},info)=>{
  await page.goto('/#settings');
  const mode=page.getByLabel('点歌调用方式',{exact:true});await expect(mode).toHaveValue('tags');
  await expect(mode).toHaveAttribute('id','settings-musicToolMode');await expect(mode).toHaveAttribute('name','musicToolMode');
  await expect(mode.locator('option')).toHaveText(['文本标签（兼容模式）','原生工具调用']);
  const hint=page.locator('#settings-musicToolMode-hint');
  for(const text of ['模型支持 tools','最多一次检索、两次模型请求','服务错误不会自动切换重试','歌曲始终点击才播放','普通连接测试不验证工具能力'])await expect(hint).toContainText(text);
  const requests=[];page.on('request',request=>{if(['fetch','xhr'].includes(request.resourceType()))requests.push(request.url());});
  await mode.selectOption('native');await expect(mode).toHaveValue('native');
  await expect(page.getByRole('button',{name:'保存并测试连接',exact:true})).toBeVisible();
  await expect(page.locator('.settings-actions')).toContainText('有尚未保存');
  await mode.selectOption('tags');await expect(mode).toHaveValue('tags');
  await expect(page.getByRole('button',{name:'测试已保存的连接',exact:true})).toBeVisible();
  await expect(page.locator('.settings-actions')).toContainText('配置来自本地服务');
  expect(requests).toHaveLength(0);
  expect((await(await request.get('/api/settings')).json()).settings.musicToolMode).toBe('tags');
  await mode.scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('music-tool-mode-settings.png'),animations:'disabled'});
});

test('settings without a music tool mode keep the compatible tags default',async({page})=>{
  await page.route('**/api/bootstrap',async route=>{
    const response=await route.fetch(),data=await response.json();delete data.settings.musicToolMode;
    await route.fulfill({response,json:data});
  });
  await page.goto('/#settings');await expect(page.getByLabel('点歌调用方式',{exact:true})).toHaveValue('tags');
  await expect(page.getByRole('button',{name:'测试已保存的连接',exact:true})).toBeVisible();
  await expect(page.locator('.settings-actions')).toContainText('配置来自本地服务');
});

for(const saveName of ['保存模型配置','保存设置'])test(`${saveName} persists the music tool mode across reloads without testing and can switch back`,async({page,request})=>{
  const calls=actions(page);await fill(page);await page.getByLabel('点歌调用方式',{exact:true}).selectOption('native');
  expect(calls).toHaveLength(0);await page.getByRole('button',{name:saveName,exact:true}).click();
  await expect(page.getByText(saveName==='保存模型配置'?'模型配置已保存。不会自动发送模型测试。':'设置已保存。不会自动发送模型测试。',{exact:true})).toBeVisible();
  expect(calls.map(call=>call.type)).toEqual(['save']);expect(calls[0].data.musicToolMode).toBe('native');
  expect(Object.hasOwn(calls[0].data,'memoryMessageThreshold')).toBe(saveName==='保存设置');
  expect((await(await request.get('/api/settings')).json()).settings.musicToolMode).toBe('native');
  await page.reload();await expect(page.getByLabel('点歌调用方式',{exact:true})).toHaveValue('native');
  await expect(page.locator('#settings-apiKey')).toHaveValue('');
  await expect(page.getByRole('button',{name:'测试已保存的连接',exact:true})).toBeVisible();
  await page.getByLabel('点歌调用方式',{exact:true}).selectOption('tags');
  await expect(page.getByRole('button',{name:'保存并测试连接',exact:true})).toBeVisible();
  expect(calls.map(call=>call.type)).toEqual(['save']);await page.getByRole('button',{name:saveName,exact:true}).click();
  await expect(page.locator('.settings-actions')).toContainText('配置来自本地服务');
  expect(calls.map(call=>call.type)).toEqual(['save','save']);expect(calls[1].data.musicToolMode).toBe('tags');
  await page.reload();await expect(page.getByLabel('点歌调用方式',{exact:true})).toHaveValue('tags');
  expect((await(await request.get('/api/settings')).json()).settings.musicToolMode).toBe('tags');
  expect(calls.map(call=>call.type)).toEqual(['save','save']);
});

test('unsaved model fields are explicitly saved before exactly one connection test',async({page,request})=>{
  const calls=actions(page);await fill(page);expect(calls).toHaveLength(0);
  await expect(page.getByRole('button',{name:'保存并测试连接',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'保存并测试连接',exact:true}).click();
  await expect(page.locator('#settings-model-result')).toContainText('离线测试回复');
  expect(calls.map(call=>call.type)).toEqual(['save','test']);
  expect(calls[0].data).toMatchObject({baseUrl:'https://model.invalid/api/coding/v3',model:'model-draft-test',apiKey:'MODEL_DRAFT_TEST_KEY',clearApiKey:false});
  const saved=(await(await request.get('/api/settings')).json()).settings;expect(saved.model).toBe('model-draft-test');expect(saved.hasApiKey).toBe(true);
  await expect(page.locator('#settings-apiKey')).toHaveValue('');await expect(page.getByRole('button',{name:'测试已保存的连接',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>JSON.stringify({...localStorage}))).not.toContain('MODEL_DRAFT_TEST_KEY');
});

test('model save is adjacent to connection testing and does not send a test automatically',async({page})=>{
  const calls=actions(page);await fill(page);await page.getByRole('button',{name:'保存模型配置',exact:true}).click();
  await expect(page.getByText('模型配置已保存。不会自动发送模型测试。',{exact:true})).toBeVisible();
  expect(calls.map(call=>call.type)).toEqual(['save']);await expect(page.locator('#settings-apiKey')).toHaveValue('');
});

test('saving and testing a model leaves unrelated unsaved memory settings intact',async({page,request})=>{
  await fill(page);await page.locator('#settings-memoryMessageThreshold').fill('1');
  await page.getByLabel('点歌调用方式',{exact:true}).selectOption('native');
  await page.getByRole('button',{name:'保存并测试连接',exact:true}).click();
  await expect(page.locator('#settings-model-result')).toContainText('离线测试回复');
  await expect(page.locator('#settings-memoryMessageThreshold')).toHaveValue('1');
  const saved=(await(await request.get('/api/settings')).json()).settings;
  expect(saved.memoryMessageThreshold).toBe(original.memoryMessageThreshold);expect(saved.musicToolMode).toBe('native');
  await expect(page.getByLabel('点歌调用方式',{exact:true})).toHaveValue('native');
  await expect(page.locator('.settings-actions')).toContainText('有尚未保存');
});

test('clear-key intent is visible and cancelling it preserves the typed key',async({page})=>{
  const calls=actions(page);await fill(page);
  await page.locator('#settings-clearApiKey').check();await expect(page.locator('#settings-apiKey')).toBeDisabled();
  await expect(page.locator('#settings-key-hint')).toContainText('新 Key 不会使用');
  await expect(page.getByRole('button',{name:'清除密钥并测试',exact:true})).toBeVisible();
  await page.locator('#settings-clearApiKey').uncheck();await expect(page.locator('#settings-apiKey')).toBeEnabled();await expect(page.locator('#settings-apiKey')).toHaveValue('MODEL_DRAFT_TEST_KEY');
  await page.getByRole('button',{name:'保存并测试连接',exact:true}).click();await expect(page.locator('#settings-model-result')).toContainText('离线测试回复');
  expect(calls[0].data.clearApiKey).toBe(false);expect(calls[0].data.apiKey).toBe('MODEL_DRAFT_TEST_KEY');
});

test('explicit clear-and-test clears the runtime key and never submits a disabled draft secret',async({page,request})=>{
  const calls=actions(page);await fill(page);await page.locator('#settings-clearApiKey').check();
  await page.getByRole('button',{name:'清除密钥并测试',exact:true}).click();await expect(page.locator('#settings-model-result')).toContainText('离线测试回复');
  expect(calls.map(call=>call.type)).toEqual(['save','test']);expect(calls[0].data.clearApiKey).toBe(true);expect(calls[0].data.apiKey).toBe('');
  expect((await(await request.get('/api/settings')).json()).settings.hasApiKey).toBe(false);
});

test('save failure keeps the draft and never tests the previously saved configuration',async({page})=>{
  const calls=actions(page);await fill(page);await page.locator('#settings-baseUrl').fill('https://model.invalid/v1?token=invalid');
  await page.getByRole('button',{name:'保存并测试连接',exact:true}).click();await expect(page.locator('#settings-model-result')).toContainText('不能包含');
  expect(calls.map(call=>call.type)).toEqual(['save']);await expect(page.locator('#settings-apiKey')).toHaveValue('MODEL_DRAFT_TEST_KEY');
});

test('edits made during saving cancel the pending test until the new draft is saved',async({page})=>{
  const calls=actions(page);await fill(page);
  let release,seen;const gate=new Promise(resolve=>release=resolve),observed=new Promise(resolve=>seen=resolve);
  await page.route('**/api/settings',async route=>{if(route.request().method()==='PUT'){seen();await gate;}await route.continue();});
  await page.getByRole('button',{name:'保存并测试连接',exact:true}).click();await observed;
  await page.getByLabel('模型名称',{exact:true}).fill('model-edited-while-saving');release();
  await expect(page.locator('#settings-model-result')).toContainText('保存期间模型配置又有修改');expect(calls.map(call=>call.type)).toEqual(['save']);
  await page.getByRole('button',{name:'保存并测试连接',exact:true}).click();await expect(page.locator('#settings-model-result')).toContainText('离线测试回复');
  expect(calls.map(call=>call.type)).toEqual(['save','save','test']);expect(calls[1].data.model).toBe('model-edited-while-saving');
});

for(const saveName of ['保存并测试连接','保存设置'])test(`${saveName} keeps music mode edits made during saving without testing a stale draft`,async({page,request})=>{
  const calls=actions(page);await fill(page);await page.getByLabel('点歌调用方式',{exact:true}).selectOption('native');
  const memoryDraft=String(original.memoryMessageThreshold===200?199:original.memoryMessageThreshold+1);
  await page.locator('#settings-memoryMessageThreshold').fill(memoryDraft);
  let release,seen;const gate=new Promise(resolve=>release=resolve),observed=new Promise(resolve=>seen=resolve);
  await page.route('**/api/settings',async route=>{if(route.request().method()==='PUT'){seen();await gate;}await route.continue();});
  await page.getByRole('button',{name:saveName,exact:true}).click();await observed;
  try{await page.getByLabel('点歌调用方式',{exact:true}).selectOption('tags');}finally{release();}
  if(saveName==='保存并测试连接')await expect(page.locator('#settings-model-result')).toContainText('保存期间模型配置又有修改');
  else await expect(page.getByText('已保存提交时的设置，之后输入的修改仍待保存。',{exact:true})).toBeVisible();
  expect(calls.map(call=>call.type)).toEqual(['save']);expect(calls[0].data.musicToolMode).toBe('native');
  await expect(page.getByLabel('点歌调用方式',{exact:true})).toHaveValue('tags');
  await expect(page.locator('#settings-apiKey')).toHaveValue('');
  await expect(page.locator('#settings-memoryMessageThreshold')).toHaveValue(memoryDraft);
  await expect(page.locator('.settings-actions')).toContainText('有尚未保存');
  const saved=(await(await request.get('/api/settings')).json()).settings;
  expect(saved.musicToolMode).toBe('native');
  expect(saved.memoryMessageThreshold).toBe(saveName==='保存设置'?Number(memoryDraft):original.memoryMessageThreshold);
  await page.getByRole('button',{name:saveName,exact:true}).click();
  if(saveName==='保存并测试连接'){
    await expect(page.locator('#settings-model-result')).toContainText('离线测试回复');
    await expect(page.locator('.settings-actions')).toContainText('有尚未保存');
    expect(calls.map(call=>call.type)).toEqual(['save','save','test']);
  }else{
    await expect(page.locator('.settings-actions')).toContainText('配置来自本地服务');
    expect(calls.map(call=>call.type)).toEqual(['save','save']);
  }
  expect(calls[1].data.musicToolMode).toBe('tags');expect(calls[1].data.apiKey).toBe('');
  await expect(page.locator('#settings-memoryMessageThreshold')).toHaveValue(memoryDraft);
  expect((await(await request.get('/api/settings')).json()).settings.musicToolMode).toBe('tags');
});

for(const width of [320,390])test(`model save and explicit test actions fit ${width}px phones`,async({page},info)=>{
  await page.setViewportSize({width,height:844});await fill(page);await page.locator('#settings-clearApiKey').check();
  await expect(page.locator('#startup-screen')).toHaveCount(0);const button=page.getByRole('button',{name:'清除密钥并测试',exact:true});await button.scrollIntoViewIfNeeded();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:info.outputPath(`model-actions-${width}.png`)});
});

test('semantic intent mode can be saved and explicitly reverted',async({page,request})=>{
  try {
    await page.goto('/#settings');
    const mode=page.getByLabel('聊天理解模式',{exact:true});
    await expect(mode).toHaveValue('legacy');
    await mode.selectOption('semantic');
    await page.getByRole('button',{name:'保存模型配置',exact:true}).click();
    await expect.poll(async()=>(await(await request.get('/api/settings')).json()).settings.intentMode).toBe('semantic');
    await page.reload();await expect(mode).toHaveValue('semantic');
    await mode.selectOption('legacy');await page.getByRole('button',{name:'保存模型配置',exact:true}).click();
    await expect.poll(async()=>(await(await request.get('/api/settings')).json()).settings.intentMode).toBe('legacy');
  } finally { await request.put('/api/settings',{data:{intentMode:original.intentMode??'legacy'}}); }
});
