import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, addConversation, modelResponse } from './helpers.mjs';
import { mockMediaFetch, gallerySticker } from './media-fixtures.mjs';
import { analyzeTurn, intentModelOptions, normalizeTurnIntent, STRICT_TURN_SCHEMA } from '../lib/turn-intent.mjs';
import { mergeTurnContext, commitTurnContext, readTurnContext } from '../lib/turn-context.mjs';
import { mergeRanked, retrievalPlan } from '../lib/retrieval-plan.mjs';
import { validateCitations } from '../lib/citations.mjs';

const plan=(music={action:'none'},sticker={action:'none'})=>({version:1,music,sticker,help:{requested:false,topics:[]},retrieval:{question:'',variants:[],topics:[],entities:[]},contexts:[],responseNeeds:'chat',clarification:[]});
const request=(action,quote,other={})=>({action,origin:'explicit',confidence:'high',evidence:{messageId:'current',quote},...other});
const answer=text=>({paragraphs:[{text,sourceIds:[]}],sticker:{decision:'none',candidate:null},state:null});
const setup=(t,replies,options={})=>{const f=fixture(t,replies,{mediaFetchImpl:mockMediaFetch,...options}); f.api.updateSettings({intentMode:'semantic'});return {...f,conversationId:addConversation(f.api,f.personaId)};};

test('actions require real user evidence and references from this conversation',()=>{
  const input={content:'播放晴天',history:[{id:4,role:'assistant',content:'播放晴天'}]};
  assert.equal(normalizeTurnIntent(plan(request('search','并不存在',{title:'晴天'})),input).music.action,'none');
  assert.equal(normalizeTurnIntent(plan({...request('search','播放晴天',{title:'晴天'}),evidence:{messageId:4,quote:'播放晴天'}}),input).music.action,'none');
  assert.equal(normalizeTurnIntent(plan(request('modify','播放晴天',{reference:999})),input).music.action,'clarify');
});
test('a string evidence span is grounded only against the current user message',()=>{
 const input={content:'我已经出院，发一个庆祝表情',history:[{id:1,role:'user',content:'以前发过生气表情'}]};
 const sticker={...request('search','发一个庆祝表情',{meaning:'庆祝'}),evidence:'发一个庆祝表情'};
 assert.equal(normalizeTurnIntent(plan(undefined,sticker),input).sticker.action,'search');
 assert.equal(normalizeTurnIntent(plan(undefined,{...sticker,evidence:'以前发过生气表情'}),input).sticker.action,'none');
});
test('current references on new requests and adjacent assistant numbering on continuations are normalized narrowly',()=>{
 const history=[{id:1,role:'user',content:'播放《沦陷》'},{id:2,role:'assistant',content:'未找到音源'}];
 const content='换贾格唱的';
 const continuation={action:'modify',origin:'continuation',confidence:'high',artist:'贾格',reference:'1',evidence:{messageId:'2',quote:content}};
 assert.equal(normalizeTurnIntent(plan(continuation),{content,history}).music.action,'modify');
 assert.equal(normalizeTurnIntent(plan({...continuation,reference:'9'}),{content,history}).music.action,'none');
 assert.equal(normalizeTurnIntent(plan({...continuation,evidence:{messageId:'2',quote:'不存在'}}),{content,history}).music.action,'none');
 const sticker={...request('search','发个生气的表情',{meaning:'生气'}),reference:'current'};
 const result=normalizeTurnIntent(plan(undefined,sticker),{content:'发个生气的表情',history});
 assert.equal(result.sticker.action,'search');assert.equal(result.sticker.reference,null);
});
test('a continuation without evidence asks for clarification instead of executing or disappearing',()=>{
 const history=[{id:1,role:'user',content:'发一个表情'},{id:2,role:'assistant',content:'给你'}];
 const raw={action:'again',origin:'continuation',reference:1,confidence:'high'};
 assert.equal(normalizeTurnIntent(plan(undefined,raw),{content:'再来一张',history}).sticker.action,'clarify');
 assert.equal(normalizeTurnIntent(plan(undefined,{...raw,reference:99}),{content:'再来一张',history}).sticker.action,'none');
});
test('native outer evidence can ground omitted or misattributed quotes but cannot forge them',async()=>{
 const history=[{id:1,role:'user',content:'发一个开心表情'},{id:2,role:'assistant',content:'给你'}],content='再来一张';
 const data=plan(undefined,{action:'again',origin:'continuation',reference:'1',confidence:'high'});
 const modelFor=(stickerEvidence,stickerOrigin='continuation',stickerConfidence='high')=>({settings:()=>({baseUrl:'https://ark.cn-beijing.volces.com/api/v3',model:'ark-code-latest'}),complete:async(_messages,options)=>{
  assert.deepEqual(options.tools[0].function.parameters.required,['plan','musicEvidence','stickerEvidence']);
  const packed=stickerOrigin==='none'?'none':`${stickerOrigin}|${stickerConfidence}|${stickerEvidence}`;
  return {toolCalls:[{function:{arguments:JSON.stringify({plan:JSON.stringify(data),musicEvidence:'none',stickerEvidence:packed})}}]};
 }});
 const valid=await analyzeTurn(modelFor(content),{content,history},{mode:'native'});
 assert.equal(valid.sticker.action,'again');assert.deepEqual(valid.sticker.evidence,{messageId:'current',quote:content});
 data.sticker.evidence=[];
 const empty=await analyzeTurn(modelFor(content),{content,history},{mode:'native'});
 assert.equal(empty.sticker.action,'again');
 data.sticker.evidence={messageId:'2',quote:content};
 const corrected=await analyzeTurn(modelFor(content),{content,history},{mode:'native'});
 assert.equal(corrected.sticker.action,'again');assert.equal(corrected.sticker.evidence.messageId,'current');
 delete data.sticker.origin;delete data.sticker.confidence;
 const metadata=await analyzeTurn(modelFor(content),{content,history},{mode:'native'});
 assert.equal(metadata.sticker.action,'again');assert.equal(metadata.sticker.confidence,'high');
 const noOrigin=await analyzeTurn(modelFor(content,'none'),{content,history},{mode:'native'});
 assert.equal(noOrigin.sticker.action,'none');
 const invalidOrigin=await analyzeTurn(modelFor(content,'forged'),{content,history},{mode:'native'});
 assert.equal(invalidOrigin.sticker.action,'none');
 data.sticker.origin='explicit';data.sticker.confidence='high';
 const conflict=await analyzeTurn(modelFor(content,'proactive'),{content,history},{mode:'native'});
 assert.equal(conflict.sticker.action,'clarify');assert.equal(conflict.sticker.confidence,'low');
 const confidence=await analyzeTurn(modelFor(content,'explicit','low'),{content,history},{mode:'native'});
 assert.equal(confidence.sticker.confidence,'low');
 delete data.sticker.origin;delete data.sticker.confidence;
 delete data.sticker.evidence;
 const invalid=await analyzeTurn(modelFor('不在本轮的话'),{content,history},{mode:'native'});
 assert.equal(invalid.sticker.action,'none');
});
test('invalid native evidence for one medium does not block another grounded action',async()=>{
 const content='播放《晴天》，再发个表情';
 const data=plan(request('search','播放《晴天》',{title:'晴天'}),request('search','发个表情',{meaning:'开心'}));
 const model={settings:()=>({baseUrl:'https://ark.cn-beijing.volces.com/api/v3',model:'ark-code-latest'}),complete:async()=>({toolCalls:[{function:{arguments:JSON.stringify({plan:JSON.stringify(data),musicEvidence:'explicit|high|播放《晴天》',stickerEvidence:'explicit|high|伪造文字'})}}]})};
 const result=await analyzeTurn(model,{content,history:[]},{mode:'native'});
 assert.equal(result.music.action,'search');assert.equal(result.sticker.action,'none');
});
test('modifications inherit only the referenced conversation object',()=>{
  const prev={musicRequest:{title:'沦陷',artist:'甲',sourceMessageId:1}};
  const history=[{id:1,role:'user'},{id:2,role:'assistant'},{id:3,role:'user'}];
  const intent={music:{action:'modify',reference:'2',artist:'乙'},sticker:{action:'none'}};
  assert.equal(mergeTurnContext(intent,prev,history).music.title,'沦陷');
  assert.equal(mergeTurnContext({...intent,music:{...intent.music,reference:'3'}},prev,history).music.action,'clarify');
});
test('rank fusion deduplicates and enforces document and context budgets',()=>{
  const a={id:'a',documentId:'one',content:'123'}, b={id:'b',documentId:'one',content:'123'}, c={id:'c',documentId:'two',content:'123'};
  assert.deepEqual(mergeRanked([[a,b,c],[a,c]],{perDocument:1,budget:6}).map(x=>x.id),['a','c']);
});
test('retrieval retains original wording when a model rewrite omits the useful term',()=>{
  const queries=[];
  const source={id:'s',documentId:'doc',content:'入职手续',name:'流程'};
  const knowledge={search:q=>{queries.push(q);return q==='入职手续'?[source]:[];}};
  const guides={search:()=>[]};
  const memory={recall:()=>[],list:()=>[]};
  const result=retrievalPlan({retrieval:{question:'人员办理',variants:['报到','第一天','第四个']}},'入职手续',knowledge,guides,memory,'p');
  assert.deepEqual(queries,['人员办理','入职手续','报到','第一天']);
  assert.deepEqual(result.sources,[source]);
});
test('semantic music executes before answer, preserves explicit title and commits context',async t=>{
  const input='我在写代码，播放《安静片刻》';
  const f=setup(t,[plan(request('search',input,{title:'安静片刻'})),'请点击歌曲卡片。']);
  f.api.media.update({musicBaseUrl:'http://music-fixture.invalid'});
  const result=await f.api.sendMessage(f.conversationId,{content:input});
  assert.equal(f.calls.length,2);assert.equal(result.message.attachments[0].type,'song');
  assert.equal(JSON.parse(f.store.get('SELECT value FROM conversation_intent_state WHERE conversationId=?',f.conversationId).value).musicRequest.title,'安静片刻');
  assert.match(f.calls[1].body.messages[2].content,/安静片刻/);
});
test('invalid analysis produces text without executing media or committing intent state',async t=>{
  const f=setup(t,['not json','本轮未能完成媒体理解。']);
  const result=await f.api.sendMessage(f.conversationId,{content:'播放《晴天》'});
  assert.equal(f.calls.length,2);assert.deepEqual(result.message.attachments,[]);assert.match(result.message.content,/本轮意图分析未完成/);
  assert.equal(f.store.get('SELECT value FROM conversation_intent_state WHERE conversationId=?',f.conversationId),null);
});
test('disabled music never executes and confirmed constraints are supplied',async t=>{
  const input='播放《晴天》，推荐川菜';
  const f=setup(t,[plan(request('search',input,{title:'晴天'})),'推荐不辣的菜。']);
  f.api.media.update({musicEnabled:false});f.api.saveMemory({personaId:f.personaId,content:'不吃辣',category:'constraint'});
  const result=await f.api.sendMessage(f.conversationId,{content:input});
  assert.deepEqual(result.message.attachments,[]);assert.match(f.calls[1].body.messages[2].content,/不吃辣/);
  const ctx=JSON.parse(f.calls[1].body.messages[2].content.slice(f.calls[1].body.messages[2].content.indexOf('{')));
  assert.deepEqual(ctx.confirmedConstraints,['不吃辣']);
});
test('native planning uses one tool call and one final request',async t=>{
  const tool={id:'plan',type:'function',function:{name:'plan_turn',arguments:JSON.stringify(plan())}};
  const reply=new Response(JSON.stringify({choices:[{index:0,message:{content:null,tool_calls:[tool]},finish_reason:'tool_calls'}]}),{headers:{'content-type':'application/json'}});
  const f=setup(t,[reply,'你好。']); f.api.updateSettings({musicToolMode:'native'});
  await f.api.sendMessage(f.conversationId,{content:'你好'});
  assert.equal(f.calls.length,2);assert.equal(f.calls[0].body.tools[0].function.name,'plan_turn');assert.equal(f.calls[1].body.tools,undefined);
});
test('final failure leaves messages and intent state uncommitted',async t=>{
  const input='播放《晴天》';const f=setup(t,[plan(request('search',input,{title:'晴天'})),new Error('network')]);
  await assert.rejects(f.api.sendMessage(f.conversationId,{content:input}));
  assert.equal(f.api.getConversation(f.conversationId).messages.length,0);
  assert.equal(f.store.get('SELECT value FROM conversation_intent_state WHERE conversationId=?',f.conversationId),null);
});

test('successive singer changes and restoring the previous version keep the original title',async t=>{
  const seen=[];
  const makePlan=(call)=>{const data=JSON.parse(call.body.messages[1].content);const content=data.content;
    const first=!data.context.musicRequest;
    const music=first?request('search',content,{title:'沦陷'}):request('modify',content,{origin:'continuation',reference:data.context.musicRequest.sourceMessageId,...(content==='换回上一版'?{restorePrevious:true}:{artist:content})});
    return modelResponse(JSON.stringify(plan(music)));
  };
  const mediaFetchImpl=async url=>{const u=new URL(url);seen.push(u);return new Response(JSON.stringify(u.pathname==='/api/library'?{files:[]}:{songs:[]}),{headers:{'content-type':'application/json'}});};
  const f=setup(t,[makePlan,'未找到。',makePlan,'未找到。',makePlan,'未找到。',makePlan,'未找到。'],{mediaFetchImpl});
  f.api.media.update({musicBaseUrl:'http://music-fixture.invalid'});
  for(const content of ['播放《沦陷》','贾格','王靖雯','换回上一版']) await f.api.sendMessage(f.conversationId,{content});
  assert.deepEqual(seen.filter(u=>u.pathname==='/api/search').map(u=>u.searchParams.get('keyword')),['沦陷','沦陷 贾格','沦陷 王靖雯','沦陷 贾格']);
  const state=JSON.parse(f.store.get('SELECT value FROM conversation_intent_state WHERE conversationId=?',f.conversationId).value);
  assert.equal(state.musicRequest.artist,'贾格');assert.equal(state.musicFound,undefined);
});
test('cancelled analysis does not generate a final response or persist a turn',async t=>{
  const controller=new AbortController();
  const f=setup(t,[async()=>{controller.abort();return modelResponse(JSON.stringify(plan()));}]);
  await assert.rejects(f.api.sendMessage(f.conversationId,{content:'你好'},{signal:controller.signal}),error=>error.status===499);
  assert.equal(f.calls.length,1);assert.equal(f.api.getConversation(f.conversationId).messages.length,0);
});
test('a failed authentication does not repeat the request',async t=>{
  const f=setup(t,[new Response('',{status:401})]);
  await assert.rejects(f.api.sendMessage(f.conversationId,{content:'你好'}));
  assert.equal(f.calls.length,1);
});


test('accepts grounded evidence arrays without accepting forged evidence',()=>{
  const content='发个生气的表情';
  const sticker={...request('search',content,{meaning:'生气',emotion:'anger'}),evidence:[{messageId:'current',quote:content}]};
  assert.equal(normalizeTurnIntent(plan(undefined,sticker),{content}).sticker.action,'search');
  sticker.evidence=[{messageId:'current',quote:'编造的证据'}];
  assert.equal(normalizeTurnIntent(plan(undefined,sticker),{content}).sticker.action,'none');
});

test('accepts omitted optional empty sections while rejecting wrong section types',()=>{
  const content='发个生气的表情';
  const raw={version:1,sticker:request('search',content,{meaning:'生气',emotion:'anger'})};
  assert.equal(normalizeTurnIntent(raw,{content}).sticker.action,'search');
  assert.throws(()=>normalizeTurnIntent({...raw,contexts:{}},{content}));
});


test('citation validation permits only supplied sources while leaving code literal',()=>{
  const input='已知 [1]，伪造 [2]，无效 [0]。 `示例 [9]`\n```js\narray[2]\n```';
  assert.equal(validateCitations(input,1),'已知 [1]，伪造 ，无效 。 `示例 [9]`\n```js\narray[2]\n```');
});


test('a fully specified new title replaces the previous target without expanding a rejection',()=>{
  const intent={music:{action:'modify',title:'稻香',exclude:['晴天']},sticker:{action:'none'}};
  const result=mergeTurnContext(intent,{version:1},[],'别放《晴天》，换成《稻香》');
  assert.equal(result.music.action,'search');assert.equal(result.music.title,'稻香');assert.deepEqual(result.music.exclude,['晴天']);
});


test('semantic angry sticker uses gallery metadata and only permits returned candidate IDs',async t=>{
  const input='发个生气的表情';let remoteUrl;
  const mediaFetchImpl=async(url)=>{remoteUrl=new URL(url);return new Response(JSON.stringify({stickers:[gallerySticker(remoteUrl.origin,{name:'生气小猫',meaning:'生气',tags:['生气'],emotions:['anger'],intensity:2})]}),{headers:{'content-type':'application/json'}});};
  const final=call=>{const ctx=JSON.parse(call.body.messages[2].content.slice(call.body.messages[2].content.indexOf('{')));assert.equal(ctx.stickerCandidates.length,1);return modelResponse(`给你。\n<qiyi-media>${JSON.stringify({stickerId:ctx.stickerCandidates[0].id})}</qiyi-media>`);};
  const f=setup(t,[plan(undefined,request('search',input,{meaning:'生气',scene:'general',emotion:'anger',intensity:2})),final],{mediaFetchImpl});
  f.api.media.update({stickerSearchUrl:'http://stickers-fixture.invalid/api/v1/stickers/search'});
  const result=await f.api.sendMessage(f.conversationId,{content:input});
  assert.equal(remoteUrl.searchParams.get('emotion'),'anger');assert.equal(remoteUrl.searchParams.get('q'),'生气');
  assert.match(f.calls[1].body.messages[0].content,/不能声称看见图片或编造元数据未描述的画面/);
  assert.match(f.calls[1].body.messages[0].content,/标签前必须换行/);
  assert.equal(result.message.attachments[0].type,'sticker');assert.match(result.message.attachments[0].imageUrl,/^\/api\/media\/sticker-image/);
});
test('structured semantic answer resolves only the selected current candidate and streams prose',async t=>{
 const input='发个生气的表情';
 const mediaFetchImpl=async url=>{const u=new URL(url);return new Response(JSON.stringify({stickers:[gallerySticker(u.origin,{name:'生气小猫',meaning:'生气',tags:['生气'],emotions:['anger'],intensity:2})]}),{headers:{'content-type':'application/json'}});};
 const final=call=>{const context=JSON.parse(call.body.messages[2].content.slice(call.body.messages[2].content.indexOf('{')));assert.equal(context.stickerCandidates[0].id,'S1');return modelResponse(JSON.stringify({paragraphs:[{text:'给你。',sourceIds:[]}],sticker:{decision:'select',candidate:'S1'},state:null}));};
 const f=setup(t,[plan(undefined,request('search',input,{meaning:'生气',scene:'general',emotion:'anger',intensity:2})),final],{mediaFetchImpl});
 f.api.updateSettings({baseUrl:'https://ark.cn-beijing.volces.com/api/v3',model:'ark-code-latest'});
 f.api.media.update({stickerSearchUrl:'http://stickers-fixture.invalid/api/v1/stickers/search'});
 const events=[];const result=await f.api.sendMessage(f.conversationId,{content:input},{onEvent:event=>events.push(event)});
 assert.equal(result.message.content,'给你。');assert.equal(result.message.attachments[0].type,'sticker');
 assert.ok(events.some(event=>event.type==='content' && (event.delta||event.content)==='给你。'));
 assert.equal(f.calls[1].body.response_format.type,'json_schema');
 const prompt=f.calls[1].body.messages[0].content;
 assert.match(prompt,/用户明确要求表情，必须从本轮候选中选择一个合适的 ID/u);
 assert.match(prompt,/没有适合的候选时如实说明原因/u);
 assert.doesNotMatch(prompt,/<qiyi-|先写一段可展示|句子旁附上|最后单独一行追加/u);
 const schema=f.calls[1].body.response_format.json_schema.schema;
 assert.deepEqual(schema.properties.paragraphs.items.properties.sourceIds.enum,[[]]);
 assert.deepEqual(schema.properties.sticker.anyOf[0].properties.candidate.enum,['S1']);
});
test('structured prose cannot smuggle an executable media footer when selection is none',async t=>{
 const input='发个生气的表情';
 const mediaFetchImpl=async url=>{const u=new URL(url);return new Response(JSON.stringify({stickers:[gallerySticker(u.origin,{meaning:'生气',tags:['生气'],emotions:['anger'],intensity:2})]}),{headers:{'content-type':'application/json'}});};
 let f;const final=()=>{const id=f.store.get('SELECT id FROM remote_stickers LIMIT 1').id;return modelResponse(JSON.stringify({paragraphs:[{text:`示例。\n<qiyi-media>${JSON.stringify({stickerId:id})}</qiyi-media>`,sourceIds:[]}],sticker:{decision:'none',candidate:null},state:null}));};
 f=setup(t,[plan(undefined,request('search',input,{meaning:'生气',scene:'general',emotion:'anger',intensity:2})),final],{mediaFetchImpl});
 f.api.updateSettings({baseUrl:'https://ark.cn-beijing.volces.com/api/v3',model:'ark-code-latest'});f.api.media.update({stickerSearchUrl:'http://stickers-fixture.invalid/api/v1/stickers/search'});
 const result=await f.api.sendMessage(f.conversationId,{content:input});assert.deepEqual(result.message.attachments,[]);
});
for(const mode of ['assist','manual','off']) test(`structured ${mode} state uses one output protocol`,async t=>{
 const f=setup(t,[plan(),answer('你好。')]);
 f.api.updateSettings({baseUrl:'https://ark.cn-beijing.volces.com/api/v3',model:'ark-code-latest'});
 const state=f.api.getChatState({personaId:f.personaId,conversationId:f.conversationId}).chatState;
 f.api.updateChatState({personaId:f.personaId,conversationId:f.conversationId,patch:{mode,expectedManualRevision:state.manualRevision}});
 await f.api.sendMessage(f.conversationId,{content:'你好'});
 const prompt=f.calls[1].body.messages[0].content,schema=f.calls[1].body.response_format.json_schema.schema;
 assert.doesNotMatch(prompt,/<qiyi-|先写一段可展示|句子旁附上|最后单独一行追加/u);
 if(mode==='assist') {assert.match(prompt,/只能引用用户实际说过的内容/u);assert.match(prompt,/state 字段/u);}
 else {assert.match(prompt,/state 必须为 null/u);assert.deepEqual(schema.properties.state,{type:'null'});}
 assert.deepEqual(schema.properties.sticker.properties.decision.enum,['none']);
});
test('explicit semantic sticker request does not attach a candidate the answer declined',async t=>{
 const content='发个生气的表情';
 const mediaFetchImpl=async url=>{const u=new URL(url);return new Response(JSON.stringify({stickers:[gallerySticker(u.origin,{name:'生气小猫',meaning:'生气',tags:['生气'],emotions:['anger'],intensity:2})]}),{headers:{'content-type':'application/json'}});};
 const f=setup(t,[plan(undefined,request('search',content,{meaning:'生气',scene:'general',emotion:'anger',intensity:2})),'没有找到合适的表情。'],{mediaFetchImpl});
 f.api.media.update({stickerSearchUrl:'http://stickers-fixture.invalid/api/v1/stickers/search'});
 const result=await f.api.sendMessage(f.conversationId,{content});
 assert.deepEqual(result.message.attachments,[]);
});
test('semantic sticker handling never replaces an unrecognized or malformed model selection',async t=>{
 const content='发个生气的表情';
 const mediaFetchImpl=async url=>{const u=new URL(url);return new Response(JSON.stringify({stickers:[gallerySticker(u.origin,{name:'生气小猫',meaning:'生气',tags:['生气'],emotions:['anger'],intensity:2})]}),{headers:{'content-type':'application/json'}});};
 const requestPlan=plan(undefined,request('search',content,{meaning:'生气',scene:'general',emotion:'anger',intensity:2}));
 const f=setup(t,[requestPlan,'给你。\n<qiyi-media>{"stickerId":"forged"}</qiyi-media>',requestPlan,'给你。\n<qiyi-media>{invalid}</qiyi-media>'],{mediaFetchImpl});
 f.api.media.update({stickerSearchUrl:'http://stickers-fixture.invalid/api/v1/stickers/search'});
 const result=await f.api.sendMessage(f.conversationId,{content});
 assert.deepEqual(result.message.attachments,[]);
 const second=await f.api.sendMessage(f.conversationId,{content});
 assert.deepEqual(second.message.attachments,[]);
});
test('one unclear media action does not block the other action',async t=>{
  const input='播放《安静片刻》，再换一个';
  const f=setup(t,[plan(request('search',input,{title:'安静片刻'}),request('clarify',input,{meaning:''})),'歌曲已经找到；请问要换哪张表情？']);
  f.api.media.update({musicBaseUrl:'http://music-fixture.invalid'});
  const result=await f.api.sendMessage(f.conversationId,{content:input});
  assert.equal(result.message.attachments[0].type,'song');
  const stored=readTurnContext(f.store,f.conversationId);assert.equal(stored.pendingSticker.sourceMessageId,result.userMessage.id);
});
test('context evidence requires a real nonempty user quote and preserves current ongoing facts',()=>{
  const content='再来一张',history=[{id:1,role:'user',content:'我在住院'},{id:2,role:'assistant',content:'你在住院'}];
  const raw={...plan(),contexts:[{type:'medical_or_safety',active:true,subject:'user',scope:'current',evidence:''},{type:'medical_or_safety',active:true,subject:'user',scope:'ongoing',evidence:{messageId:1,quote:'住院'}}]};
  assert.deepEqual(normalizeTurnIntent(raw,{content,history}).contexts,['medical_or_safety']);
  raw.contexts[1].evidence.messageId=2;assert.deepEqual(normalizeTurnIntent(raw,{content,history}).contexts,[]);
});
test('grounded safety context survives a missing model update, expires and accepts an evidenced correction',t=>{
 const f=setup(t,[]),first='我在住院';
 const initial=normalizeTurnIntent({...plan(),contexts:[{type:'medical_or_safety',active:true,subject:'user',scope:'current',evidence:{messageId:'current',quote:first}}]},{content:first});
 commitTurnContext(f.store,f.conversationId,{version:1},mergeTurnContext(initial,{version:1},[],first),[],1);
 const saved=readTurnContext(f.store,f.conversationId);
 const history=[{id:1,role:'user',content:first},{id:2,role:'assistant',content:'好'}];
 const empty=normalizeTurnIntent(plan(),{content:'再来一张',history});
 assert.deepEqual(mergeTurnContext(empty,saved,history,'再来一张').contexts,['medical_or_safety']);
 const correction='我已经出院了';
 const corrected=normalizeTurnIntent({...plan(),contexts:[{type:'medical_or_safety',active:false,subject:'user',scope:'current',evidence:{messageId:'current',quote:correction}}]},{content:correction,history});
 assert.deepEqual(mergeTurnContext(corrected,saved,history,correction).contexts,[]);
 const forged=normalizeTurnIntent({...plan(),contexts:[{type:'medical_or_safety',active:false,subject:'user',scope:'current',evidence:{messageId:'current',quote:'无关内容'}}]},{content:correction,history});
 assert.deepEqual(mergeTurnContext(forged,saved,history,correction).contexts,['medical_or_safety']);
 const conflicting={...corrected,contextUpdates:[...corrected.contextUpdates,{type:'medical_or_safety',active:true,sourceMessageId:'current'}],contexts:['medical_or_safety']};
 assert.deepEqual(mergeTurnContext(conflicting,saved,history,correction).contexts,['medical_or_safety']);
 assert.deepEqual(mergeTurnContext(empty,saved,[...history,...[3,4,5,6].map(id=>({id:id+10,role:'user',content:'继续'}))],'继续').contexts,[]);
 assert.deepEqual(mergeTurnContext(empty,saved,[],'继续').contexts,[]);
 assert.deepEqual(mergeTurnContext(empty,{activeSafetyContexts:'bad'},history,'继续').contexts,[]);
 assert.deepEqual(mergeTurnContext(empty,{activeSafetyContexts:[{type:'unknown',sourceMessageId:1}]},history,'继续').contexts,[]);
});
test('pending clarification inherits only from a referenced same-conversation object',t=>{
  const f=setup(t,[]), previous={version:1};
  const pending=normalizeTurnIntent(plan(request('clarify','换歌手',{title:'沦陷'})),{content:'换歌手'});
  commitTurnContext(f.store,f.conversationId,previous,pending,[],1);
  const state=readTurnContext(f.store,f.conversationId);
  const next={music:{action:'modify',reference:'1',artist:'贾格'},sticker:{action:'none'}};
  assert.equal(mergeTurnContext(next,state,[{id:1,role:'user'}]).music.title,'沦陷');
  assert.equal(mergeTurnContext({...next,music:{...next.music,reference:'9'}},state,[{id:1,role:'user'}]).music.action,'clarify');
});


test('query variants are bounded even when the model supplies too many',()=>{
 const raw={...plan(),retrieval:{variants:['一','二','三','四']}};
 assert.deepEqual(normalizeTurnIntent(raw,{content:'问题'}).retrieval.variants,['一','二','三']);
});


test('disabling music while the final answer is generated discards a pending card',async t=>{
 const input='播放《安静片刻》';let f;
 f=setup(t,[plan(request('search',input,{title:'安静片刻'})),()=>{f.api.media.update({musicEnabled:false});return modelResponse('音乐已关闭。');}]);
 f.api.media.update({musicBaseUrl:'http://music-fixture.invalid'});
 const result=await f.api.sendMessage(f.conversationId,{content:input});assert.deepEqual(result.message.attachments,[]);
});
test('semantic diagnostics record only counts, stage types and timings',async t=>{
 const events=[];const f=setup(t,[plan(),'你好。'],{semanticDiagnostics:event=>events.push(event)});
 await f.api.sendMessage(f.conversationId,{content:'不应进入诊断的文字'});
 assert.deepEqual(events.map(e=>e.stage),['analysis','retrieval','media','answer']);
 assert.ok(events.every(e=>!JSON.stringify(e).includes('不应进入诊断的文字')));
});
test('successful analysis records provider token counts without recording model content',async t=>{
 const events=[];
 const analysis=new Response(JSON.stringify({usage:{completion_tokens:150,completion_tokens_details:{reasoning_tokens:0}},choices:[{index:0,message:{content:JSON.stringify(plan())}}]}),{headers:{'content-type':'application/json'}});
 const f=setup(t,[analysis,'你好。'],{semanticDiagnostics:event=>events.push(event)});
 await f.api.sendMessage(f.conversationId,{content:'仅供测试的私密文字'});
 assert.deepEqual(events.find(e=>e.stage==='analysis').tokenUsage,{completionTokens:150,reasoningTokens:0});
 assert.ok(!JSON.stringify(events).includes('仅供测试的私密文字'));
});
test('stop during final streaming leaves no messages, memory touches, or context',async t=>{
 const controller=new AbortController();const input='播放《安静片刻》';
 const f=setup(t,[plan(request('search',input,{title:'安静片刻'})),()=>{controller.abort();return modelResponse('请点击。');}]);
 f.api.media.update({musicBaseUrl:'http://music-fixture.invalid'});
 const memory=f.api.saveMemory({personaId:f.personaId,category:'constraint',content:'不吃辣'}).memory;
 await assert.rejects(f.api.sendMessage(f.conversationId,{content:input},{signal:controller.signal,onEvent:()=>{}}),error=>error.status===499);
 assert.equal(f.api.getConversation(f.conversationId).messages.length,0);assert.equal(readTurnContext(f.store,f.conversationId).musicRequest,undefined);
 assert.equal(f.store.get('SELECT accessCount FROM memories WHERE id=?',memory.id).accessCount,0);
});


test('semantic memory recall does not pull unrelated facts from a generic user entity',t=>{
 const f=setup(t,[]);f.api.saveMemory({personaId:f.personaId,content:'用户喜欢茉莉茶'});
 f.api.saveMemory({personaId:f.personaId,content:'用户计划登山'});
 assert.deepEqual(f.api.memory.recall(f.personaId,'用户',{skipHubSeeds:true}),[]);
});


test('sticker modification inherits meaning and emotion while preserving the new intensity',()=>{
 const content='换个含蓄的',previous={stickerIntent:{meaning:'开心',scene:'general',emotion:'joy',intensity:3,sourceMessageId:1}};
 const history=[{id:1,role:'user',content:'发张开心表情'},{id:2,role:'assistant',content:'给你'}];
 const intent=normalizeTurnIntent(plan(undefined,request('modify',content,{origin:'continuation',reference:1,intensity:1})),{content,history});
 const result=mergeTurnContext(intent,previous,history,content);
 assert.equal(result.sticker.meaning,'开心');assert.equal(result.sticker.emotion,'joy');assert.equal(result.sticker.intensity,1);
});
test('delivered sticker intensity is kept separately from requested intensity',t=>{
 const f=setup(t,[]), intent={music:{action:'none'},sticker:{action:'search',origin:'explicit',confidence:'high',meaning:'开心',scene:'general',emotion:'joy',intensity:2},contexts:[]};
 commitTurnContext(f.store,f.conversationId,{version:1},intent,[{type:'sticker',id:'real'}],1,id=>id==='real'?{intensity:1}:null);
 const state=readTurnContext(f.store,f.conversationId);
 assert.equal(state.stickerIntent.intensity,2);assert.equal(state.stickerImage.intensity,1);
 commitTurnContext(f.store,f.conversationId,state,intent,[],2,()=>null);
 assert.equal(readTurnContext(f.store,f.conversationId).stickerImage,undefined);
});
test('relative sticker strength is bounded by the actual referenced image, never the requested cap',()=>{
 const history=[{id:1,role:'user',content:'发个表情'},{id:2,role:'assistant',content:'给你。'}],content='更含蓄一点';
 const intent=normalizeTurnIntent(plan(undefined,request('modify',content,{origin:'continuation',reference:1,intensity:1,intensityChange:'lower'})),{content,history});
 const previous={stickerIntent:{sourceMessageId:1,intensity:3,meaning:'开心',emotion:'joy',scene:'general'},stickerImage:{sourceMessageId:1,intensity:2}};
 assert.equal(mergeTurnContext(intent,previous,history,content).sticker.intensity,1);
 for(const stickerImage of [undefined,{sourceMessageId:1,intensity:1},{sourceMessageId:99,intensity:2}]) assert.equal(mergeTurnContext(intent,{...previous,stickerImage},history,content).sticker.action,'clarify');
 const higher={...intent,sticker:{...intent.sticker,intensityChange:'higher'}};
 assert.equal(mergeTurnContext(higher,{...previous,stickerImage:{sourceMessageId:1,intensity:3}},history,content).sticker.action,'clarify');
});
test('native planning separates tool submission from JSON text instructions',async()=>{
 const content='播放《晴天》';
 const model={settings:()=>({baseUrl:'https://ark.cn-beijing.volces.com/api/v3',model:'ark-code-latest'}),complete:async(_messages,options)=>{
  assert.equal(options.tools[0].function.parameters.properties.plan.type,'string');
  assert.match(_messages[0].content,/只提交一次 plan_turn 工具调用/u);
  assert.doesNotMatch(_messages[0].content,/只输出紧凑 JSON/u);
  return {toolCalls:[{function:{arguments:JSON.stringify({plan:JSON.stringify(plan(request('search',content,{title:'晴天'}))),musicEvidence:`explicit|high|${content}`,stickerEvidence:'none'})}}]};
 }};
 assert.equal((await analyzeTurn(model,{content,history:[]},{mode:'native'})).music.action,'search');
});
test('restoration overrides a broad recommendation action only with eligible prior requests',()=>{
 const history=[{id:1,role:'user'},{id:2,role:'assistant'},{id:3,role:'user'},{id:4,role:'assistant'}];
 const previous={musicRequest:{title:'同一首',artist:'乙',sourceMessageId:3},previousMusicRequest:{title:'同一首',artist:'甲',sourceMessageId:1}};
 const intent={music:{action:'recommend',restorePrevious:true,reference:'3'},sticker:{action:'none'}};
 const restored=mergeTurnContext(intent,previous,history);
 assert.equal(restored.music.action,'modify');assert.equal(restored.music.artist,'甲');
 assert.equal(mergeTurnContext(intent,{},history).music.action,'clarify');
});
test('native delimiter loops exhausting tokens cannot execute or commit a plan',async t=>{
 const events=[];
 const response=new Response(JSON.stringify({usage:{completion_tokens:3200,completion_tokens_details:{reasoning_tokens:0}},choices:[{index:0,finish_reason:'length',message:{content:'',tool_calls:[{id:'loop',type:'function',function:{name:'plan_turn',arguments:'{"plan":{"version":1}</plan><parameter name="musicEvidence">none</parameter>'.repeat(8)}}]}}]}),{headers:{'content-type':'application/json'}});
 const f=setup(t,[response,answer('本轮意图分析未完成。')],{semanticDiagnostics:event=>events.push(event)});
 f.api.updateSettings({baseUrl:'https://ark.cn-beijing.volces.com/api/v3',model:'ark-code-latest',musicToolMode:'native'});
 const result=await f.api.sendMessage(f.conversationId,{content:'换回上一版'});
 assert.equal(f.calls.length,2);assert.deepEqual(result.message.attachments,[]);
 assert.equal(events.find(x=>x.stage==='analysis').outcome,'output_limit');
 assert.equal(f.store.get('SELECT value FROM conversation_intent_state WHERE conversationId=?',f.conversationId),null);
});
test('a continuation search referencing an eligible sticker reuses it without losing explicit changes',()=>{
 const previous={stickerIntent:{meaning:'开心',scene:'general',emotion:'joy',intensity:2,sourceMessageId:1}};
 const history=[{id:1,role:'user',content:'发张开心表情'},{id:2,role:'assistant',content:'给你'}];
 const continuation={action:'search',origin:'continuation',reference:'1',meaning:'开心',scene:'general',emotion:'joy',intensity:2};
 assert.equal(mergeTurnContext({music:{action:'none'},sticker:continuation},previous,history,'再来一张').sticker.action,'again');
 const changed={...continuation,meaning:'生气',emotion:'anger'};
 assert.equal(mergeTurnContext({music:{action:'none'},sticker:changed},previous,history,'再发个生气的').sticker.action,'modify');
 assert.equal(mergeTurnContext({music:{action:'none'},sticker:{...continuation,reference:'9'}},previous,history,'再来一张').sticker.action,'clarify');
 assert.equal(mergeTurnContext({music:{action:'none'},sticker:continuation},{...previous,stickerReferenceInactive:true},history,'再来一张').sticker.action,'clarify');
});
test('a sticker continuation may cite an ancestor in the same chain, but not after replacement',t=>{
 const f=setup(t,[]),previous={version:1,stickerIntent:{meaning:'开心',scene:'general',emotion:'joy',intensity:2,sourceMessageId:1}};
 const history=[{id:1,role:'user',content:'发个开心表情'},{id:2,role:'assistant',content:'给你'}];
 const again={music:{action:'none'},sticker:{action:'again',origin:'continuation',confidence:'high',reference:'1'},contexts:[]};
 commitTurnContext(f.store,f.conversationId,previous,mergeTurnContext(again,previous,history,'再来一张'),[],3);
 const state=readTurnContext(f.store,f.conversationId),longer=[...history,{id:3,role:'user',content:'再来一张'},{id:4,role:'assistant',content:'给你'}];
 assert.deepEqual(state.stickerIntent.referenceIds,[1]);
 const modification={music:{action:'none'},sticker:{action:'modify',origin:'continuation',confidence:'high',reference:'2',intensity:1},contexts:[]};
 assert.equal(mergeTurnContext(modification,state,longer,'换个含蓄的').sticker.action,'modify');
 assert.equal(mergeTurnContext({...modification,sticker:{...modification.sticker,explicitReference:true}},state,longer,'换之前那张').sticker.action,'clarify');
 const replacement={music:{action:'none'},sticker:{action:'search',origin:'explicit',confidence:'high',meaning:'惊讶',scene:'general',emotion:'surprise',intensity:2},contexts:[]};
 commitTurnContext(f.store,f.conversationId,state,mergeTurnContext(replacement,state,longer,'发惊讶表情'),[],5);
 assert.equal(readTurnContext(f.store,f.conversationId).stickerIntent.referenceIds,undefined);
});


test('an inferred singer cannot narrow an explicit song request without user evidence',()=>{
 const content='找一下《稻香》给我听';
 const intent=normalizeTurnIntent(plan(request('search',content,{title:'稻香',artist:'周杰伦',version:'现场版'})),{content});
 assert.equal(intent.music.title,'稻香');assert.equal(intent.music.artist,'');assert.equal(intent.music.version,'');
});


test('restoring a previous version accepts an explicit reference to that previous request',()=>{
 const history=[{id:1,role:'user',content:'贾格版'},{id:2,role:'assistant',content:'未找到'},{id:3,role:'user',content:'王靖雯版'},{id:4,role:'assistant',content:'未找到'}];
 const previous={musicRequest:{title:'沦陷',artist:'王靖雯',sourceMessageId:3},previousMusicRequest:{title:'沦陷',artist:'贾格',sourceMessageId:1}};
 const content='换回上一版';const intent=normalizeTurnIntent(plan(request('modify',content,{reference:1,title:'沦陷',artist:'贾格',restorePrevious:true})),{content,history});
 const result=mergeTurnContext(intent,previous,history,content);
 assert.equal(result.music.action,'modify');assert.equal(result.music.title,'沦陷');assert.equal(result.music.artist,'贾格');
});


test('analysis token exhaustion is recorded and degrades without retrying the analysis',async t=>{
 const events=[];
 const truncated=new Response(JSON.stringify({usage:{completion_tokens:3200,completion_tokens_details:{reasoning_tokens:3100}},choices:[{index:0,finish_reason:'length',message:{content:'',reasoning_content:'hidden'}}]}),{headers:{'content-type':'application/json'}});
 const f=setup(t,[truncated,'暂时无法完成。'],{semanticDiagnostics:e=>events.push(e)});
 const result=await f.api.sendMessage(f.conversationId,{content:'随便聊聊'});
 assert.equal(f.calls.length,2);assert.match(result.message.content,/意图分析未完成/);
 assert.equal(events.find(e=>e.stage==='analysis').outcome,'output_limit');
 assert.deepEqual(events.find(e=>e.stage==='analysis').tokenUsage,{completionTokens:3200,reasoningTokens:3100});
 assert.equal(f.calls[0].body.max_tokens,3200);
});


test('knowledge retrieval carries a section heading into later chunks',async t=>{
 const f=setup(t,[]);
 const body='# 报到材料\n'+('无关内容。'.repeat(210))+'\n请携带工牌。';
 const doc=await f.api.knowledge.importDocument('流程.md',Buffer.from(body).toString('base64'));
 const rows=f.api.knowledge.search('报到材料',10);
 assert.ok(rows.filter(row=>row.documentId===doc.id).some(row=>row.index>1));
});


test('analysis timeout cancels the provider request and reports a timeout without retry',async()=>{
 let calls=0,diagnostic;
 const model={complete:(_messages,{signal})=>{calls++;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>resolve(plan()),1000);signal.addEventListener('abort',()=>{clearTimeout(timer);reject(new Error('aborted'));},{once:true});});}};
 const result=await analyzeTurn(model,{content:'你好',history:[]},{timeoutMs:20,onDiagnostic:event=>{diagnostic=event;}});
 assert.equal(result,null);assert.equal(calls,1);assert.equal(diagnostic.outcome,'timeout');
});


test('strict JSON and disabled thinking apply only to the verified official Ark model during planning',async t=>{
 assert.deepEqual(intentModelOptions({baseUrl:'https://ark.cn-beijing.volces.com/api/v3',model:'ark-code-latest'}),{thinking:{type:'disabled'},responseFormat:'json_schema',responseSchema:STRICT_TURN_SCHEMA});
 assert.deepEqual(intentModelOptions({baseUrl:'https://ark.cn-beijing.volces.com/api/v3',model:'ark-code-latest'},'native'),{thinking:{type:'disabled'}});
 for(const settings of [{baseUrl:'https://other.invalid/v1',model:'ark-code-latest'},{baseUrl:'https://ark.cn-beijing.volces.com/api/v3',model:'other-model'},{baseUrl:'http://ark.cn-beijing.volces.com/api/v3',model:'ark-code-latest'}]) assert.deepEqual(intentModelOptions(settings),{});
 const f=setup(t,[plan(),answer('你好。')]);f.api.updateSettings({baseUrl:'https://ark.cn-beijing.volces.com/api/v3',model:'ark-code-latest'});
 await f.api.sendMessage(f.conversationId,{content:'你好'});
 assert.deepEqual(f.calls[0].body.thinking,{type:'disabled'});assert.equal(f.calls[0].body.reasoning_effort,undefined);assert.equal(f.calls[0].body.response_format.type,'json_schema');assert.deepEqual(f.calls[0].body.response_format.json_schema.schema,STRICT_TURN_SCHEMA);assert.deepEqual(f.calls[1].body.thinking,{type:'disabled'});assert.equal(f.calls[1].body.reasoning_effort,undefined);assert.equal(f.calls[1].body.response_format.type,'json_schema');
});


test('an explicit grounded replacement title is treated as a search even if the model labels it a recommendation',()=>{
 const content='别放《晴天》，换成《稻香》';
 const intent=normalizeTurnIntent(plan(request('recommend',content,{title:'稻香',exclude:['晴天']})),{content});
 assert.equal(intent.music.action,'search');assert.equal(intent.music.title,'稻香');assert.deepEqual(intent.music.exclude,['晴天']);
});


test('a model-restored title must match an eligible same-conversation request before search',()=>{
 const content='换贾格唱的',history=[{id:1,role:'user',content:'播放《沦陷》'},{id:2,role:'assistant',content:'未找到'}];
 const raw=plan(request('search',content,{title:'沦陷',artist:'贾格'}));
 const normalized=normalizeTurnIntent(raw,{content,history});
 const previous={musicRequest:{title:'沦陷',artist:'',sourceMessageId:1}};
 const restored=mergeTurnContext(normalized,previous,history,content);
 assert.equal(restored.music.action,'modify');assert.equal(restored.music.title,'沦陷');assert.equal(restored.music.artist,'贾格');
 assert.equal(mergeTurnContext(normalized,{musicRequest:{title:'晴天',sourceMessageId:1}},history,content).music.action,'clarify');
 assert.equal(mergeTurnContext(normalized,{...previous,musicReferenceInactive:true},history,content).music.action,'clarify');
 assert.equal(mergeTurnContext(normalized,{...previous,stickerIntent:{sourceMessageId:1}},history,content).music.action,'clarify');
});


test('continuations can ground current text when the model cites only a verified previous user request',()=>{
 const content='再来一张',history=[{id:1,role:'user',content:'发个开心的表情'},{id:2,role:'assistant',content:'给你'}];
 const sticker={action:'again',origin:'continuation',confidence:'high',evidence:[{messageId:1,quote:'发个开心的表情'}],reference:1};
 const normalized=normalizeTurnIntent(plan(undefined,sticker),{content,history});
 assert.equal(normalized.sticker.action,'again');assert.deepEqual(normalized.sticker.evidence,{messageId:'current',quote:content});
 const result=mergeTurnContext(normalized,{stickerIntent:{meaning:'开心',scene:'general',emotion:'joy',intensity:2,sourceMessageId:1}},history,content);
 assert.equal(result.sticker.action,'again');
 assert.equal(normalizeTurnIntent(plan(undefined,{...sticker,evidence:[{messageId:1,quote:'伪造'}]}),{content,history}).sticker.action,'none');
 assert.equal(normalizeTurnIntent(plan(undefined,{...sticker,reference:99}),{content,history}).sticker.action,'none');
});


test('an identified emotion can drive gallery search even if the model omits a meaning',async t=>{
 const input='发个生气的表情';let query;
 const mediaFetchImpl=async url=>{query=new URL(url);return new Response(JSON.stringify({stickers:[]}),{headers:{'content-type':'application/json'}});};
 const f=setup(t,[plan(undefined,request('search',input,{emotion:'anger',intensity:2})), '没有找到合适的表情。'],{mediaFetchImpl});
 f.api.media.update({stickerSearchUrl:'http://stickers-fixture.invalid/api/v1/stickers/search'});
 await f.api.sendMessage(f.conversationId,{content:input});
 assert.equal(query.searchParams.get('q'),'生气');assert.equal(query.searchParams.get('emotion'),'anger');
});

test('native Ark planning uses one strict wrapped tool with no response_format',async t=>{
 const call={id:'p1',type:'function',function:{name:'plan_turn',arguments:JSON.stringify({plan:JSON.stringify(plan())})}};
 const reply=new Response(JSON.stringify({choices:[{index:0,message:{content:null,tool_calls:[call]},finish_reason:'tool_calls'}]}),{headers:{'content-type':'application/json'}});
 const f=setup(t,[reply,answer('你好。')]);f.api.updateSettings({baseUrl:'https://ark.cn-beijing.volces.com/api/v3',model:'ark-code-latest',musicToolMode:'native'});
 await f.api.sendMessage(f.conversationId,{content:'你好'});
 assert.equal(f.calls[0].body.tools[0].function.name,'plan_turn');assert.equal(f.calls[0].body.tools[0].function.strict,true);assert.deepEqual(f.calls[0].body.thinking,{type:'disabled'});assert.equal(f.calls[0].body.reasoning_effort,undefined);assert.equal(f.calls[0].body.response_format,undefined);
 assert.deepEqual(f.calls[1].body.thinking,{type:'disabled'});assert.equal(f.calls.length,2);
});


test('restoring proactive music clears both legacy and semantic session mute states',t=>{
 const f=setup(t,[]);
 f.store.run('INSERT INTO conversation_intent_state(conversationId,value,version) VALUES (?,?,1)',f.conversationId,JSON.stringify({version:1,musicMuted:true}));
 f.api.musicFeedback(f.conversationId,{action:'unmute'});
 assert.equal(readTurnContext(f.store,f.conversationId).musicMuted,false);
 assert.equal(f.api.responsePolicy.muted(f.conversationId),false);
});


test('session mute is reflected in feedback state and explicit song requests still work',async t=>{
 const first='这次会话别主动推荐歌曲',second='播放《安静片刻》';
 const reject=request('reject',first,{rejectionScope:'session'});
 const f=setup(t,[plan(reject),'好的。',plan(request('search',second,{title:'安静片刻'})),'请点击播放。']);
 f.api.media.update({musicBaseUrl:'http://music-fixture.invalid'});
 await f.api.sendMessage(f.conversationId,{content:first});assert.equal(f.api.responsePolicy.muted(f.conversationId),true);
 const result=await f.api.sendMessage(f.conversationId,{content:second});assert.equal(result.message.attachments[0].type,'song');
 f.api.musicFeedback(f.conversationId,{action:'unmute'});assert.equal(readTurnContext(f.store,f.conversationId).musicMuted,false);
});


test('a guessed next message number is canonicalized only with an exact current quote',()=>{
 const content='再来一张',history=[{id:1,role:'user',content:'发个开心的表情'},{id:2,role:'assistant',content:'给你'}];
 const sticker={action:'again',origin:'continuation',confidence:'high',evidence:{messageId:3,quote:content},reference:1};
 const normalized=normalizeTurnIntent(plan(undefined,sticker),{content,history});
 assert.equal(normalized.sticker.action,'again');assert.equal(normalized.sticker.evidence.messageId,'current');
 assert.equal(normalizeTurnIntent(plan(undefined,{...sticker,evidence:{messageId:3,quote:'伪造'}}),{content,history}).sticker.action,'none');
 assert.equal(normalizeTurnIntent(plan(undefined,{...sticker,evidence:{messageId:2,quote:'给你'}}),{content,history}).sticker.action,'none');
 assert.equal(normalizeTurnIntent(plan(undefined,{...sticker,evidence:{messageId:999,quote:content}}),{content,history}).sticker.action,'none');
});


test('a first-message numeric evidence ID is accepted only for a verbatim current quote',()=>{
 const content='发一张难过的表情',sticker={action:'search',origin:'explicit',confidence:'high',evidence:{messageId:1,quote:content},emotion:'sadness'};
 assert.equal(normalizeTurnIntent(plan(undefined,sticker),{content,history:[]}).sticker.action,'search');
 assert.equal(normalizeTurnIntent(plan(undefined,{...sticker,evidence:{messageId:1,quote:'伪造'}}),{content,history:[]}).sticker.action,'none');
});


test('current safety context can use a grounded current-message evidence object',()=>{
 const content='我正在住院';const raw={...plan(),contexts:[{type:'medical_or_safety',active:true,subject:'user',scope:'current',evidence:{messageId:'current',quote:'正在住院'}}]};
 assert.deepEqual(normalizeTurnIntent(raw,{content}).contexts,['medical_or_safety']);
 raw.contexts[0].evidence.messageId='other';assert.deepEqual(normalizeTurnIntent(raw,{content}).contexts,[]);
});


test('strict intent schema requires every property while preserving nullable optional fields',()=>{
 const check=schema=>{if(schema.type==='object'){assert.deepEqual(new Set(schema.required),new Set(Object.keys(schema.properties)));assert.equal(schema.additionalProperties,false);for(const child of Object.values(schema.properties))check(child);}else if(Array.isArray(schema.type)&&schema.type.includes('object')){assert.equal(schema.additionalProperties,false);for(const child of Object.values(schema.properties))check(child);}else if(schema.type==='array'||Array.isArray(schema.type)&&schema.type.includes('array'))check(schema.items);};
 check(STRICT_TURN_SCHEMA);assert.deepEqual(STRICT_TURN_SCHEMA.properties.music.properties.reference.type,['string','null']);
});


test('malformed nested native plans do not execute and are not retried',async t=>{
 const call={id:'p1',type:'function',function:{name:'plan_turn',arguments:JSON.stringify({plan:'{"version":1,'})}};
 const reply=new Response(JSON.stringify({choices:[{index:0,message:{content:null,tool_calls:[call]},finish_reason:'tool_calls'}]}),{headers:{'content-type':'application/json'}});
 const f=setup(t,[reply,answer('本轮未完成。')]);f.api.updateSettings({baseUrl:'https://ark.cn-beijing.volces.com/api/v3',model:'ark-code-latest',musicToolMode:'native'});
 const result=await f.api.sendMessage(f.conversationId,{content:'播放《晴天》'});
 assert.equal(f.calls.length,2);assert.deepEqual(result.message.attachments,[]);assert.match(result.message.content,/意图分析未完成/);
});

test('native plan handles provider delimiters and trailing commas without accepting other malformed JSON',async t=>{
 const content='播放《晴天》';
 const valid=JSON.stringify(plan(request('search',content,{title:'晴天'})));
 const response=payload=>new Response(JSON.stringify({choices:[{index:0,message:{content:null,tool_calls:[{id:'p1',type:'function',function:{name:'plan_turn',arguments:JSON.stringify({plan:payload})}}]},finish_reason:'tool_calls'}]}),{headers:{'content-type':'application/json'}});
 const trailing=valid.replace('"sticker":{"action":"none"}','"sticker":{"action":"none",}');
 assert.notEqual(trailing,valid);
 const f=setup(t,[response(`${valid}</plan>\n`),answer('请点击歌曲卡片。'),response(trailing),answer('请点击歌曲卡片。'),response(`${valid}</plan>extra`),answer('分析未完成。'),response(`${valid}${' '.repeat(2001)}`),answer('分析未完成。')]);
 f.api.updateSettings({baseUrl:'https://ark.cn-beijing.volces.com/api/v3',model:'ark-code-latest',musicToolMode:'native'});
 const first=await f.api.sendMessage(f.conversationId,{content});assert.ok(first.message.attachments.some(item=>item.type==='song-search'||item.type==='song'));
 const second=await f.api.sendMessage(f.conversationId,{content});assert.ok(second.message.attachments.some(item=>item.type==='song-search'||item.type==='song'));
 const third=await f.api.sendMessage(f.conversationId,{content});assert.deepEqual(third.message.attachments,[]);assert.match(third.message.content,/意图分析未完成/);
 const fourth=await f.api.sendMessage(f.conversationId,{content});assert.deepEqual(fourth.message.attachments,[]);assert.match(fourth.message.content,/意图分析未完成/);
 assert.equal(f.calls.length,8);
});
test('native comma normalization never changes punctuation inside quoted values',async()=>{
 const content='播放《A,}》',data=plan(request('search',content,{title:'A,}'}));
 const model={settings:()=>({baseUrl:'https://ark.cn-beijing.volces.com/api/v3',model:'ark-code-latest'}),complete:async()=>({toolCalls:[{function:{arguments:JSON.stringify({plan:JSON.stringify(data),musicEvidence:`explicit|high|${content}`,stickerEvidence:'none'})}}]})};
 const result=await analyzeTurn(model,{content,history:[]},{mode:'native'});
 assert.equal(result.music.title,'A,}');
});


test('two continuation targets backed by the same user span are clarified independently of new actions',()=>{
 const history=[{id:1,role:'user'},{id:2,role:'assistant'},{id:3,role:'user'},{id:4,role:'assistant'}];
 const previous={musicRequest:{title:'晴天',sourceMessageId:1},stickerIntent:{meaning:'开心',scene:'general',emotion:'joy',intensity:2,sourceMessageId:3}};
 const evidence={messageId:'current',quote:'换个吧'};
 const both={music:{action:'modify',reference:'1',evidence},sticker:{action:'again',reference:'3',evidence}};
 const result=mergeTurnContext(both,previous,history,'换个吧');assert.equal(result.music.action,'clarify');assert.equal(result.sticker.action,'clarify');
 const independent={music:{action:'modify',reference:'1',evidence:{messageId:'current',quote:'换贾格唱的'}},sticker:{action:'modify',reference:'3',evidence:{messageId:'current',quote:'表情换含蓄一点'}}};
 const good=mergeTurnContext(independent,previous,history,'换贾格唱的，表情换含蓄一点');assert.equal(good.music.action,'modify');assert.equal(good.sticker.action,'modify');
});


test('a model-chosen implicit target is clarified when both media remain eligible',()=>{
 const history=[{id:1,role:'user'},{id:2,role:'assistant'},{id:3,role:'user'},{id:4,role:'assistant'}];
 const previous={musicRequest:{title:'晴天',sourceMessageId:1},stickerIntent:{meaning:'开心',scene:'general',emotion:'joy',intensity:2,sourceMessageId:3}};
 const intent={music:{action:'modify',reference:'1',explicitReference:false,evidence:{quote:'换个吧'}},sticker:{action:'none'},clarification:['换歌还是换表情？']};
 assert.equal(mergeTurnContext(intent,previous,history,'换个吧').music.action,'clarify');
 const named={...intent,music:{...intent.music,artist:'贾格',evidence:{quote:'换贾格唱的'}}};
 assert.equal(mergeTurnContext(named,previous,history,'换贾格唱的').music.action,'modify');
 const withPriorArtist={...previous,musicRequest:{...previous.musicRequest,artist:'贾格'}};
 assert.equal(mergeTurnContext(intent,withPriorArtist,history,'换个吧').music.action,'clarify');
});
