import {test,expect} from './ui-test.mjs';

async function begin(page,request,question='慢速流式演示'){
  const {persona}=await(await request.post('/api/personas',{data:{name:`流式验证${Date.now()}`,systemPrompt:'简洁回应。'}})).json();
  await page.goto('/#chat');await expect(page.locator('#startup-screen')).toHaveCount(0);await page.getByLabel('选择聊天角色',{exact:true}).selectOption(persona.id);
  await page.locator('#chat-input').fill(question);await page.getByRole('button',{name:'发送',exact:true}).click();return persona;
}

test('waiting, provider reasoning and a growing body share one live bubble, then reload as one persisted pair',async({page,request})=>{
  const persona=await begin(page,request);const body=page.locator('#live-reply .live-body');
  await expect(body).toContainText('正在思考');await expect(page.locator('#live-reply .reasoning-text')).toContainText('先理解这个问题');
  await page.evaluate(()=>{window.originalLiveBubble=document.querySelector('#live-reply');window.leakedFooter=false;new MutationObserver(()=>{if(/qiyi-media|qiyi-state/.test(document.querySelector('#chat-messages').textContent))window.leakedFooter=true;}).observe(document.querySelector('#chat-messages'),{subtree:true,characterData:true,childList:true});});
  await expect(body).toContainText('第一段');const firstHeight=await body.evaluate(element=>element.getBoundingClientRect().height);
  await expect(body).toContainText('第二段');expect(await page.evaluate(()=>window.originalLiveBubble===document.querySelector('#live-reply'))).toBe(true);
  expect(await body.evaluate(element=>element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(firstHeight);
  await expect(page.locator('#live-reply')).toHaveCount(0);expect(await page.evaluate(()=>window.leakedFooter)).toBe(false);
  await expect(page.locator('.message.user')).toHaveCount(1);await expect(page.locator('.message.assistant')).toHaveCount(1);
  const reasoning=page.locator('.message.assistant .message-reasoning');await expect(reasoning).not.toHaveAttribute('open','');await reasoning.locator('summary').click();await expect(reasoning.locator('.reasoning-text')).toContainText('整理回答的重点');
  await page.reload();await page.getByLabel('选择聊天角色',{exact:true}).selectOption(persona.id);await page.getByRole('button',{name:'历史对话',exact:true}).click();await page.locator('.history-item').filter({hasText:'慢速流式演示'}).click();
  await expect(page.locator('.message.assistant .message-content')).toContainText('第二段');await expect(page.locator('.message-reasoning')).toContainText('整理回答的重点');
});

test('providers without reasoning show waiting and正文 without inventing a reasoning section',async({page,request})=>{
  await begin(page,request,'普通问题，不返回额外信息');await expect(page.locator('#live-reply .live-body')).toContainText('正在思考');
  await expect(page.locator('#live-reply')).toHaveCount(0);await expect(page.locator('.message.assistant .message-content')).toContainText('离线测试回复');await expect(page.locator('.message-reasoning')).toHaveCount(0);
});

test('a page upgraded before its backend remains usable without repeating a model request',async({page,request})=>{
  let calls=0;page.on('request',value=>{if(/\/messages$/u.test(value.url())&&value.method()==='POST')calls++;});
  await page.route('**/streaming.js',route=>route.fulfill({status:404,body:'not yet available'}));
  await begin(page,request,'升级兼容验证');await expect(page.locator('.message.assistant .message-content')).toContainText('离线测试回复');
  await expect(page.locator('#live-reply')).toHaveCount(0);expect(calls).toBe(1);
});

test('interrupted streams keep partial output clearly temporary and retain the editable draft',async({page,request})=>{
  const persona=await begin(page,request,'断流演示');await expect(page.locator('#live-reply')).toHaveClass(/is-interrupted/);
  await expect(page.locator('#live-reply .live-body')).toContainText('尚未完成');await expect(page.locator('#live-reply .generation-label')).toHaveText('生成中断');
  await expect(page.locator('#chat-input')).toHaveValue('断流演示');await expect(page.locator('#live-reply .message-mail-action')).toHaveCount(0);
  const data=await(await request.get('/api/bootstrap')).json(),conversation=data.conversations.find(row=>row.personaId===persona.id),history=await(await request.get(`/api/conversations/${conversation.id}`)).json();expect(history.messages).toHaveLength(0);
});

test('switching roles during streaming never shows another role the pending content',async({page,request})=>{
  const {persona:other}=await(await request.post('/api/personas',{data:{name:'另一个流式角色',systemPrompt:'简洁。'}})).json();
  const original=await begin(page,request);await expect(page.locator('#live-reply .reasoning-text')).toContainText('先理解');
  await page.getByLabel('选择聊天角色',{exact:true}).selectOption(other.id);await expect(page.locator('#live-reply')).toHaveCount(0);await expect(page.locator('#chat-messages')).not.toContainText('第一段');
  await page.getByLabel('选择聊天角色',{exact:true}).selectOption(original.id);await expect(page.locator('.message.assistant .message-content')).toContainText('第一段');
});

test('typing the same question again while a reply streams preserves the new draft',async({page,request})=>{
  await begin(page,request);await expect(page.locator('#live-reply .reasoning-text')).toContainText('先理解');
  await page.locator('#chat-input').fill('下一条草稿');await page.locator('#chat-input').fill('慢速流式演示');
  await expect(page.locator('#live-reply')).toHaveCount(0);await expect(page.locator('#chat-input')).toHaveValue('慢速流式演示');
});

for(const width of [320,390])test(`streaming reasoning and reply bubbles fit ${width}px phones`,async({page,request},info)=>{
  await page.setViewportSize({width,height:844});await begin(page,request);await expect(page.locator('#live-reply .reasoning-text')).toContainText('先理解');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await expect(page.locator('#startup-screen')).toHaveCount(0);await page.locator('#live-reply').scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath(`streaming-${width}.png`)});
  await expect(page.locator('#live-reply')).toHaveCount(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
