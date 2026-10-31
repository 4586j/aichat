import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, addConversation, modelResponse } from './helpers.mjs';
import { mockMediaFetch, gallerySticker } from './media-fixtures.mjs';
import { analyzeTurn, intentModelOptions, normalizeTurnIntent } from '../lib/turn-intent.mjs';
import { mergeTurnContext, commitTurnContext, readTurnContext } from '../lib/turn-context.mjs';
import { mergeRanked } from '../lib/retrieval-plan.mjs';
import { validateCitations } from '../lib/citations.mjs';

const plan=(music={action:'none'},sticker={action:'none'})=>({version:1,music,sticker,help:{requested:false,topics:[]},retrieval:{question:'',variants:[],topics:[],entities:[]},contexts:[],responseNeeds:'chat',clarification:[]});
const request=(action,quote,other={})=>({action,origin:'explicit',confidence:'high',evidence:{messageId:'current',quote},...other});
const setup=(t,replies,options={})=>{const f=fixture(t,replies,{mediaFetchImpl:mockMediaFetch,...options}); f.api.updateSettings({intentMode:'semantic'});return {...f,conversationId:addConversation(f.api,f.personaId)};};

test('actions require real user evidence and references from this conversation',()=>{
  const input={content:'播放晴天',history:[{id:4,role:'assistant',content:'播放晴天'}]};
  assert.equal(normalizeTurnIntent(plan(request('search','并不存在',{title:'晴天'})),input).music.action,'none');
  assert.equal(normalizeTurnIntent(plan({...request('search','播放晴天',{title:'晴天'}),evidence:{messageId:4,quote:'播放晴天'}}),input).music.action,'none');
  assert.equal(normalizeTurnIntent(plan(request('modify','播放晴天',{reference:999})),input).music.action,'clarify');
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
  assert.equal(result.message.attachments[0].type,'sticker');assert.match(result.message.attachments[0].imageUrl,/^\/api\/media\/sticker-image/);
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
 const truncated=new Response(JSON.stringify({choices:[{index:0,finish_reason:'length',message:{content:'',reasoning_content:'hidden'}}]}),{headers:{'content-type':'application/json'}});
 const f=setup(t,[truncated,'暂时无法完成。'],{semanticDiagnostics:e=>events.push(e)});
 const result=await f.api.sendMessage(f.conversationId,{content:'随便聊聊'});
 assert.equal(f.calls.length,2);assert.match(result.message.content,/意图分析未完成/);
 assert.equal(events.find(e=>e.stage==='analysis').outcome,'output_limit');
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


test('low reasoning and JSON formatting apply only to the verified official Ark model during planning',async t=>{
 assert.deepEqual(intentModelOptions({baseUrl:'https://ark.cn-beijing.volces.com/api/v3',model:'ark-code-latest'}),{thinking:{type:'enabled'},reasoningEffort:'low',responseFormat:'json_object'});
 assert.deepEqual(intentModelOptions({baseUrl:'https://ark.cn-beijing.volces.com/api/v3',model:'ark-code-latest'},'native'),{thinking:{type:'enabled'},reasoningEffort:'low'});
 for(const settings of [{baseUrl:'https://other.invalid/v1',model:'ark-code-latest'},{baseUrl:'https://ark.cn-beijing.volces.com/api/v3',model:'other-model'},{baseUrl:'http://ark.cn-beijing.volces.com/api/v3',model:'ark-code-latest'}]) assert.deepEqual(intentModelOptions(settings),{});
 const f=setup(t,[plan(),'你好。']);f.api.updateSettings({baseUrl:'https://ark.cn-beijing.volces.com/api/v3',model:'ark-code-latest'});
 await f.api.sendMessage(f.conversationId,{content:'你好'});
 assert.deepEqual(f.calls[0].body.thinking,{type:'enabled'});assert.equal(f.calls[0].body.reasoning_effort,'low');assert.deepEqual(f.calls[0].body.response_format,{type:'json_object'});assert.equal(f.calls[1].body.thinking,undefined);assert.equal(f.calls[1].body.reasoning_effort,undefined);assert.equal(f.calls[1].body.response_format,undefined);
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

test('native Ark planning omits JSON response_format while preserving low reasoning',async t=>{
 const call={id:'p1',type:'function',function:{name:'plan_turn',arguments:JSON.stringify(plan())}};
 const reply=new Response(JSON.stringify({choices:[{index:0,message:{content:null,tool_calls:[call]},finish_reason:'tool_calls'}]}),{headers:{'content-type':'application/json'}});
 const f=setup(t,[reply,'你好。']);f.api.updateSettings({baseUrl:'https://ark.cn-beijing.volces.com/api/v3',model:'ark-code-latest',musicToolMode:'native'});
 await f.api.sendMessage(f.conversationId,{content:'你好'});
 assert.equal(f.calls[0].body.tools[0].function.name,'plan_turn');assert.equal(f.calls[0].body.reasoning_effort,'low');assert.equal(f.calls[0].body.response_format,undefined);
 assert.equal(f.calls[1].body.thinking,undefined);assert.equal(f.calls.length,2);
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
