// End-to-end acceptance with a real configured model and isolated in-memory media fixtures.
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createStore } from '../lib/store.mjs';
import { createService } from '../lib/service.mjs';
import { createLocalModelKey } from '../lib/local-model-key.mjs';
import { mockMediaFetch, gallerySticker } from '../tests/media-fixtures.mjs';
import { checkDietConstraint } from './semantic-acceptance-checks.mjs';
const data=resolve(process.env.AGENT_DATA_DIR||'./data');const source=new DatabaseSync(resolve(data,'agent.sqlite'),{readOnly:true});
source.exec('PRAGMA busy_timeout = 5000');
const settings=Object.fromEntries(source.prepare("SELECT key,value FROM settings WHERE key IN ('baseUrl','model','musicToolMode')").all().map(r=>[r.key,JSON.parse(r.value)]));source.close();
const store=createStore(':memory:');store.saveSettings({...settings,intentMode:'semantic',...(process.env.SEMANTIC_EVAL_MODE?{musicToolMode:process.env.SEMANTIC_EVAL_MODE}:{})});
const diagnostics=[],results=[];
let callsSinceLast=0;
const record=value=>{value.modelCalls=callsSinceLast;callsSinceLast=0;value.pass=Boolean(value.pass && value.modelCalls===2 && value.diagnostics.some(x=>x.stage==='analysis' && x.outcome==='success'));results.push(value);console.log(JSON.stringify(value));};
// Stable catalogue: the same ID and URL always describe the same image.
const galleryEntries=[
 ...['a','b','c'].map((hash,index)=>({hash,emotion:'joy',intensity:2,name:`开心表情${index+1}`,meaning:'自然地表达开心'})),
 ...['d','e','f'].map((hash,index)=>({hash,emotion:'joy',intensity:1,name:`含蓄开心${index+1}`,meaning:'含蓄地表达开心'})),
 ...['1','2','3'].map((hash,index)=>({hash,emotion:'anger',intensity:1,name:`生气表情${index+1}`,meaning:'表达生气'})),
];
const mediaFetchImpl=async(url,init)=>{
 const u=new URL(url);
 if(u.hostname==='semantic-gallery.invalid') {
  const stickers=galleryEntries.map(item=>{const hash=item.hash.repeat(64);return gallerySticker(u.origin,{id:`stk_${hash}`,url:`${u.origin}/api/v1/images/${hash}`,name:item.name,meaning:item.meaning,description:item.meaning,alt:item.meaning,examples:[item.meaning],tags:[item.meaning],scenes:['general','celebration'],emotions:[item.emotion],intensity:item.intensity,excludedContexts:['grief','medical_or_safety']});});
  return new Response(JSON.stringify({stickers}),{headers:{'content-type':'application/json'}});
 }
 return mockMediaFetch(url,init);
};
const fetchImpl=async(url,options)=>{
 callsSinceLast++;
 const request=JSON.parse(options.body);
 const response=await fetch(url,options);
 if(process.env.SEMANTIC_DEBUG==='1') {
  if(request.messages?.[0]?.content?.includes('聊天意图分析器')) {
   try {const data=await response.clone().json();const choice=data.choices?.[0],message=choice?.message;console.log(JSON.stringify({syntheticPlan:message?.tool_calls?.[0]?.function?.arguments||message?.content||null,finishReason:choice?.finish_reason||null,usage:data.usage||null}));} catch { /* Diagnostics do not affect execution. */ }
  } else if(request.messages?.[0]?.content?.includes('execution.stickerExplicit') || request.messages?.[0]?.content?.includes('本轮必须返回 JSON 对象')) {
   if(request.stream) void response.clone().text().then(body=>{
    const content=body.split('\n').filter(line=>line.startsWith('data: ')).flatMap(line=>{try{return [JSON.parse(line.slice(6)).choices?.[0]?.delta?.content||''];}catch{return [];}}).join('');
    console.log(JSON.stringify({syntheticAnswer:content}));
   }).catch(()=>{});
   else try {const data=await response.clone().json();console.log(JSON.stringify({syntheticAnswer:data.choices?.[0]?.message?.content||null}));} catch { /* Diagnostics do not affect execution. */ }
  }
 }
 return response;
};
const service=createService(store,{apiKey:createLocalModelKey(resolve(data,'model-key.local')).read()||'',fetchImpl,mediaFetchImpl,semanticDiagnostics:event=>diagnostics.push(event)});
// Use only the controlled gallery for this acceptance run, so its intensity
// metadata matches the progressively softer candidates requested by the test.
store.run('UPDATE stickers SET enabled=0');
try {
 service.media.update({musicBaseUrl:'http://music-fixture.invalid',stickerSearchUrl:'http://semantic-gallery.invalid/api/v1/stickers/search'});
 const personaId=store.get('SELECT id FROM personas LIMIT 1').id;
 await service.knowledge.importDocument('新员工入职流程.txt',Buffer.from('新员工入职流程：新人报到时先核验身份证并领取门禁。完成报到后，到人事处提交银行卡资料，然后参加安全培训。').toString('base64'));
 service.saveMemory({personaId,content:'用户不吃辣',category:'constraint'});
 for(const [id,content,expected] of [['music','播放《安静片刻》','song'],['sticker','发个生气的表情','sticker'],['knowledge','新人报到要办哪些手续','source'],['memory','推荐适合我的川菜','memory'],['help_email','邮箱的密码填哪儿','guide'],['memory_order','按我的忌口，去川菜馆要怎么跟服务员说？','memory'],['memory_alternative','我想吃麻婆豆腐，怎样调整才符合我的口味？','memory']].filter(([id])=>!process.env.SEMANTIC_EVAL_CASES||process.env.SEMANTIC_EVAL_CASES.split(',').includes(id))){
  const conversation=service.createConversation({personaId}).conversation.id;const events=[];const started=Date.now();
  try{const response=await service.sendMessage(conversation,{content},{onEvent:event=>{if(event.type==='status')events.push(event.phase);}});
   const dietCheck=checkDietConstraint(response.message.content);
   const answerMentionsConstraint=dietCheck.pass;
   const matchingSource=response.sources.findIndex(x=>expected==='guide'?x.name?.includes('邮件、SMTP'):x.name==='新员工入职流程.txt');
   const cited=matchingSource>=0 && response.message.content.includes(`[${matchingSource+1}]`);
   const pass=['source','guide'].includes(expected)?matchingSource>=0&&cited:expected==='memory'?response.recalledMemories.some(x=>x.content==='用户不吃辣')&&answerMentionsConstraint:response.message.attachments.some(x=>x.type===expected);
   record({id,ms:Date.now()-started,pass,syntheticAnswer:response.message.content,sourceCount:response.sources.length,memoryCount:response.recalledMemories.length,...(['source','guide'].includes(expected)?{matchingSource:matchingSource>=0,cited}:{}),...(expected==='memory'?{answerMentionsConstraint,dietCheck}:{}),attachmentTypes:response.message.attachments.map(x=>x.type),status:events,diagnostics:diagnostics.splice(0)});
   if(id==='knowledge') {
     const followStarted=Date.now();
     const follow=await service.sendMessage(conversation,{content:'领取门禁之后还要办什么？'});
     const index=follow.sources.findIndex(x=>x.name==='新员工入职流程.txt');
     if(process.env.SEMANTIC_DEBUG==='1' && !(index>=0&&follow.message.content.includes(`[${index+1}]`))) console.log(JSON.stringify({syntheticFollowup:follow.message.content,sourceNames:follow.sources.map(x=>x.name)}));
     const citedFollowup=index>=0&&follow.message.content.includes(`[${index+1}]`);
     record({id:'knowledge_followup',ms:Date.now()-followStarted,pass:citedFollowup,syntheticAnswer:follow.message.content,sourceCount:follow.sources.length,cited:citedFollowup,diagnostics:diagnostics.splice(0)});
   }
  }catch(error){record({id,pass:false,status:error.status||null,diagnostics:diagnostics.splice(0)});}
 }
 if(process.env.SEMANTIC_EVAL_CASES?.split(',').includes('sticker_sequence')) {
  const conversation=service.createConversation({personaId}).conversation.id, seen=[];let priorIntensity=null;
  for(const [index,content] of ['发一张开心的表情','再来一张','比上一张再含蓄一点'].entries()) {
   const started=Date.now();
   try {
    const response=await service.sendMessage(conversation,{content});
    const row=store.get('SELECT value FROM conversation_intent_state WHERE conversationId=?',conversation);
    const state=row?JSON.parse(row.value):{},sticker=response.message.attachments.find(item=>item.type==='sticker');
    const different=Boolean(sticker&&!seen.includes(sticker.id));if(sticker)seen.push(sticker.id);
    const actualIntensity=sticker?service.media.profile(sticker.id)?.intensity??null:null;
    const noLower=index===2 && priorIntensity===1 && !sticker && diagnostics.some(item=>item.stage==='media' && item.stickerAction==='clarify') && /含蓄|强度|更低|更轻|最轻/u.test(response.message.content);
    const pass=noLower || (different && (index!==2||(priorIntensity>1 && actualIntensity<priorIntensity)));
    record({id:'sticker_sequence',step:index+1,ms:Date.now()-started,pass,...(!pass?{syntheticAnswer:response.message.content}:{}),different,noLower,requestedIntensity:state.stickerIntent?.intensity??null,actualIntensity,diagnostics:diagnostics.splice(0)});
    if(actualIntensity!=null)priorIntensity=actualIntensity;
   }catch(error){const reason=/模型未返回正文/u.test(error.message)?'empty_model_content':/模型没有返回可展示的正文/u.test(error.message)?'empty_visible_content':'other';record({id:'sticker_sequence',step:index+1,pass:false,status:error.status||null,reason,diagnostics:diagnostics.splice(0)});break;}
  }
 }
 if(process.env.SEMANTIC_EVAL_CASES?.split(',').includes('context_lifecycle')) {
  const conversation=service.createConversation({personaId}).conversation.id;
  for(const [index,content] of ['我正在住院，发一个开心的表情。','我已经出院了，给我一张庆祝的表情。'].entries()) {
   const started=Date.now();
   try {
    const response=await service.sendMessage(conversation,{content});
    const row=store.get('SELECT value FROM conversation_intent_state WHERE conversationId=?',conversation);
    const state=row?JSON.parse(row.value):{},active=Boolean(state.activeSafetyContexts?.some(item=>item.type==='medical_or_safety'));
    const sticker=response.message.attachments.some(item=>item.type==='sticker');
    const pass=index===0?active&&!sticker:!active&&sticker;
    record({id:'context_lifecycle',step:index+1,ms:Date.now()-started,pass,...(!pass?{syntheticAnswer:response.message.content}:{}),active,sticker,diagnostics:diagnostics.splice(0)});
   } catch(error) {record({id:'context_lifecycle',step:index+1,pass:false,status:error.status||null,diagnostics:diagnostics.splice(0)});break;}
  }
 }
 if(process.env.SEMANTIC_EVAL_CASES?.split(',').includes('music_sequence')) {
  const conversation=service.createConversation({personaId}).conversation.id;
  for(const [content,expectedArtist] of [['播放《沦陷》',''],['换贾格唱的','贾格'],['再换成王靖雯唱的','王靖雯'],['换回上一版','贾格']]) {
   const started=Date.now();
   try {
    const response=await service.sendMessage(conversation,{content});
    const row=store.get('SELECT value FROM conversation_intent_state WHERE conversationId=?',conversation);
    const state=row ? JSON.parse(row.value) : {};
    record({id:'music_sequence',syntheticAnswer:response.message.content,ms:Date.now()-started,pass:state.musicRequest?.title==='沦陷' && state.musicRequest?.artist===expectedArtist && state.musicRequest?.sourceMessageId===response.userMessage.id,attachmentTypes:response.message.attachments.map(x=>x.type),diagnostics:diagnostics.splice(0)});
   } catch(error) {record({id:'music_sequence',pass:false,status:error.status||null,diagnostics:diagnostics.splice(0)});break;}
  }
 }
} finally {mkdirSync('test-reports',{recursive:true});writeFileSync(process.env.SEMANTIC_EVAL_REPORT || 'test-reports/semantic-chat.json',JSON.stringify({generatedAt:new Date().toISOString(),mode:store.settings().musicToolMode,results},null,2)+'\n');if(!results.length||results.some(x=>!x.pass))process.exitCode=1;await service.scheduler.stop();store.close();}
