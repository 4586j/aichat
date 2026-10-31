// End-to-end acceptance with a real configured model and isolated in-memory media fixtures.
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createStore } from '../lib/store.mjs';
import { createService } from '../lib/service.mjs';
import { createLocalModelKey } from '../lib/local-model-key.mjs';
import { mockMediaFetch, gallerySticker } from '../tests/media-fixtures.mjs';
const data=resolve(process.env.AGENT_DATA_DIR||'./data');const source=new DatabaseSync(resolve(data,'agent.sqlite'),{readOnly:true});
const settings=Object.fromEntries(source.prepare("SELECT key,value FROM settings WHERE key IN ('baseUrl','model','musicToolMode')").all().map(r=>[r.key,JSON.parse(r.value)]));source.close();
const store=createStore(':memory:');store.saveSettings({...settings,intentMode:'semantic'});
const diagnostics=[],results=[];
const record=value=>{results.push(value);console.log(JSON.stringify(value));};
const mediaFetchImpl=async(url,init)=>{const u=new URL(url);if(u.hostname==='semantic-gallery.invalid')return new Response(JSON.stringify({stickers:[gallerySticker(u.origin,{name:'生气小猫',meaning:'生气',tags:['生气'],emotions:['anger'],intensity:2})]}),{headers:{'content-type':'application/json'}});return mockMediaFetch(url,init);};
const service=createService(store,{apiKey:createLocalModelKey(resolve(data,'model-key.local')).read()||'',mediaFetchImpl,semanticDiagnostics:event=>diagnostics.push(event)});
try {
 service.media.update({musicBaseUrl:'http://music-fixture.invalid',stickerSearchUrl:'http://semantic-gallery.invalid/api/v1/stickers/search'});
 const personaId=store.get('SELECT id FROM personas LIMIT 1').id;
 await service.knowledge.importDocument('新员工入职流程.txt',Buffer.from('新员工入职流程：新人报到时先核验身份证并领取门禁。完成报到后，到人事处提交银行卡资料，然后参加安全培训。').toString('base64'));
 service.saveMemory({personaId,content:'用户不吃辣',category:'constraint'});
 for(const [id,content,expected] of [['music','播放《安静片刻》','song'],['sticker','发个生气的表情','sticker'],['knowledge','新人报到要办哪些手续','source'],['memory','推荐适合我的川菜','memory']].filter(([id])=>!process.env.SEMANTIC_EVAL_CASES||process.env.SEMANTIC_EVAL_CASES.split(',').includes(id))){
  const conversation=service.createConversation({personaId}).conversation.id;const events=[];const started=Date.now();
  try{const response=await service.sendMessage(conversation,{content},{onEvent:event=>{if(event.type==='status')events.push(event.phase);}});
   record({id,ms:Date.now()-started,pass:(expected==='source'?response.sources.some(x=>x.name==='新员工入职流程.txt'):expected==='memory'?response.recalledMemories.some(x=>x.content==='用户不吃辣'):response.message.attachments.some(x=>x.type===expected)),sourceCount:response.sources.length,memoryCount:response.recalledMemories.length,...(id==='memory'?{answerMentionsConstraint:/不吃辣|不辣|少辣|无辣|避免.*辣|去掉.*辣|清淡/u.test(response.message.content)}:{}),attachmentTypes:response.message.attachments.map(x=>x.type),status:events,diagnostics:diagnostics.splice(0)});
   if(id==='knowledge') {
     const followStarted=Date.now();
     const follow=await service.sendMessage(conversation,{content:'那之后怎么办'});
     record({id:'knowledge_followup',ms:Date.now()-followStarted,pass:follow.sources.some(x=>x.name==='新员工入职流程.txt'),sourceCount:follow.sources.length,diagnostics:diagnostics.splice(0)});
   }
  }catch(error){record({id,pass:false,status:error.status||null,diagnostics:diagnostics.splice(0)});}
 }
 if(process.env.SEMANTIC_EVAL_CASES?.split(',').includes('music_sequence')) {
  const conversation=service.createConversation({personaId}).conversation.id;
  for(const [content,expectedArtist] of [['播放《沦陷》',''],['换贾格唱的','贾格'],['再换成王靖雯唱的','王靖雯'],['换回上一版','贾格']]) {
   const started=Date.now();
   try {
    const response=await service.sendMessage(conversation,{content});
    const row=store.get('SELECT value FROM conversation_intent_state WHERE conversationId=?',conversation);
    const state=row ? JSON.parse(row.value) : {};
    record({id:'music_sequence',ms:Date.now()-started,pass:state.musicRequest?.title==='沦陷' && state.musicRequest?.artist===expectedArtist && state.musicRequest?.sourceMessageId===response.userMessage.id,attachmentTypes:response.message.attachments.map(x=>x.type),diagnostics:diagnostics.splice(0)});
   } catch(error) {record({id:'music_sequence',pass:false,status:error.status||null,diagnostics:diagnostics.splice(0)});break;}
  }
 }
} finally {mkdirSync('test-reports',{recursive:true});writeFileSync('test-reports/semantic-chat.json',JSON.stringify({generatedAt:new Date().toISOString(),results},null,2)+'\n');await service.scheduler.stop();store.close();}
