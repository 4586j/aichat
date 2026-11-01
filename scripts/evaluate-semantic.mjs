// Optional isolated acceptance run. Reads only model connection settings; all prompts are synthetic.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createStore } from '../lib/store.mjs';
import { createModel } from '../lib/model.mjs';
import { createLocalModelKey } from '../lib/local-model-key.mjs';
import { analyzeTurn } from '../lib/turn-intent.mjs';
import { mergeTurnContext } from '../lib/turn-context.mjs';

const sourceDir=resolve(process.env.AGENT_DATA_DIR || './data');
const output=resolve(process.argv[2] || 'test-reports/semantic-model.json');
const source=new DatabaseSync(resolve(sourceDir,'agent.sqlite'),{readOnly:true});
source.exec('PRAGMA busy_timeout = 5000');
const saved=Object.fromEntries(source.prepare("SELECT key,value FROM settings WHERE key IN ('baseUrl','model','musicToolMode')").all().map(row=>[row.key,JSON.parse(row.value)]));source.close();
const store=createStore(':memory:');store.saveSettings(saved);
const fetchImpl=async(url,options)=>{
 const response=await fetch(url,options);
 if(process.env.SEMANTIC_DEBUG==='1')try {
  const data=await response.clone().json(),choice=data.choices?.[0];
  // Capture truncated synthetic arguments before the production parser rejects
  // them. Never log connection settings, headers, or real conversation data.
  if(process.env.SEMANTIC_TRACE_PROVIDER==='1'||choice?.finish_reason==='length')console.log(JSON.stringify({syntheticProviderResponse:choice?.message,finishReason:choice?.finish_reason,usage:data.usage,status:response.status}));
 }catch{/* Diagnostic capture must not alter model behavior. */}
 return response;
};
const model=createModel(store,{apiKey:createLocalModelKey(resolve(sourceDir,'model-key.local')).read()||'',timeoutMs:90000,fetchImpl});
const mc=(title,artist='',reference=1)=>({version:1,musicRequest:{title,artist,version:'',style:'',sourceMessageId:reference}});
const sc={version:1,stickerIntent:{meaning:'开心',scene:'general',emotion:'joy',intensity:2,sourceMessageId:1},stickerImage:{id:'leaf-cheer',sourceMessageId:1}};
const history=[{id:1,role:'user',content:'播放《沦陷》'},{id:2,role:'assistant',content:'歌曲卡片。'}];
const previousSticker=[{id:1,role:'user',content:'发个开心的表情'},{id:2,role:'assistant',content:'给你。'}];
const restoreHistory=[...history,{id:3,role:'user',content:'换贾格唱的'},{id:4,role:'assistant',content:'没有找到匹配音源。'},{id:5,role:'user',content:'再换成王靖雯唱的'},{id:6,role:'assistant',content:'没有找到匹配音源。'}];
const cases=[
 {id:'music_mixed',content:'我在写代码，播放《晴天》',check:x=>x.music.action==='search'&&x.music.title==='晴天'},
 {id:'music_replace',content:'别放《晴天》，换成《稻香》',check:x=>x.music.action==='search'&&x.music.title==='稻香'},
 {id:'music_negation',content:'别放歌了',check:x=>!['search','recommend','modify'].includes(x.music.action)},
 {id:'music_quote',content:'他说“播放《晴天》”，是什么意思？',check:x=>!['search','recommend','modify'].includes(x.music.action)},
 {id:'music_followup',content:'换贾格唱的',history,context:mc('沦陷'),check:x=>x.music.action==='modify'&&x.music.artist==='贾格'},
 {id:'sticker_anger',content:'发个生气的表情',check:x=>x.sticker.action==='search'&&x.sticker.emotion==='anger'},
 {id:'sticker_cute',content:'我没有生病，发个可爱的表情',check:x=>x.sticker.action==='search'&&!x.contexts.includes('medical_or_safety')},
 {id:'sticker_denial',content:'别发动图',check:x=>!['search','again','modify'].includes(x.sticker.action)},
 {id:'sticker_quote',content:'他说“发个表情”，是什么意思',check:x=>!['search','again','modify'].includes(x.sticker.action)},
 {id:'sticker_again',content:'再来一张',history:previousSticker,context:sc,check:x=>['again','modify'].includes(x.sticker.action)},
 {id:'medical_actual',content:'我正在住院',check:x=>x.contexts.includes('medical_or_safety')},
 {id:'medical_fiction',content:'小说里有人生病',check:x=>!x.contexts.includes('medical_or_safety')},
 {id:'help_pet',content:'这小家伙能改个名字吗',check:x=>x.help.requested||x.clarification.length>0},
 {id:'help_email',content:'邮箱的密码填哪儿',check:x=>x.help.requested},
 {id:'knowledge_rewrite',content:'新人报到要办哪些手续',check:x=>[x.retrieval.question,...x.retrieval.variants].some(v=>/入职|新员工/u.test(v||''))},
 {id:'combined',content:'播放《晴天》，再发一个生气的表情',check:x=>x.music.action==='search'&&x.sticker.action==='search'},
 {id:'holdout_sticker_denial',content:'这次不用配图，文字就好',check:x=>!['search','again','modify'].includes(x.sticker.action)},
 {id:'holdout_music',content:'找一下《稻香》给我听',check:x=>x.music.action==='search'&&x.music.title==='稻香'},
 {id:'holdout_quote',content:'对方说“给我放首歌”，他在表达什么？',check:x=>!['search','recommend','modify'].includes(x.music.action)},
 {id:'holdout_mixed',content:'我正在写程序，别配表情，放《晴天》',check:x=>x.music.action==='search'&&x.music.title==='晴天'&&!['search','again','modify'].includes(x.sticker.action)},
 {id:'holdout_fiction',content:'我写的故事里角色刚住院，我们继续聊剧情',check:x=>!x.contexts.includes('medical_or_safety')},
 {id:'holdout_ambiguous',content:'换个吧',check:x=>!['search','recommend','modify'].includes(x.music.action)&&!['search','again','modify'].includes(x.sticker.action)},
 {id:'holdout_followup',content:'那之后怎么办',history:[{id:1,role:'user',content:'新人报到要办哪些手续'},{id:2,role:'assistant',content:'先办理入职报到。'}],check:x=>[x.retrieval.question,...x.retrieval.variants].some(v=>/入职|报到|新人/u.test(v||''))},
 {id:'quote_instruction',content:'请解释这句指令：“播放《晴天》”。',check:x=>!['search','recommend','modify'].includes(x.music.action)},
 {id:'quote_hypothesis',content:'假如我说播放《晴天》，你会怎么回答？',check:x=>!['search','recommend','modify'].includes(x.music.action)},
 {id:'quote_negation',content:'我不是让你播放《晴天》，只是想知道谁唱的。',check:x=>!['search','recommend','modify'].includes(x.music.action)},
 {id:'quote_sticker',content:'“再来一张表情”这句话是什么意思？',check:x=>!['search','again','modify'].includes(x.sticker.action)},
 {id:'sticker_sad',content:'帮我找一张难过的表情',check:x=>x.sticker.action==='search'&&x.sticker.emotion==='sadness'},
 {id:'sticker_negation_reword',content:'不用发图片了，请只打字。',check:x=>!['search','again','modify'].includes(x.sticker.action)},
 {id:'mixed_negation',content:'我没生病，请发一个温柔的表情。',check:x=>x.sticker.action==='search'&&!x.contexts.includes('medical_or_safety')},
 {id:'medical_other',content:'小说里的主角住院了，分析一下情节。',check:x=>!x.contexts.includes('medical_or_safety')},
 {id:'knowledge_variant',content:'新同事第一天报到需要做什么',check:x=>[x.retrieval.question,...x.retrieval.variants].some(v=>/入职|报到|新员工/u.test(v||''))},
 {id:'music_discussion',content:'这个音乐播放器的接口应该怎么配置？',check:x=>!['search','recommend','modify'].includes(x.music.action)},
 {id:'safety_quote_translate',content:'把“请放一首歌”翻译成英语。',check:x=>!['search','recommend','modify'].includes(x.music.action)},
 {id:'safety_quote_story',content:'小说里的人说：给我放一首歌。请点评这句台词。',check:x=>!['search','recommend','modify'].includes(x.music.action)},
 {id:'safety_quote_intent',content:'我朋友问我“发个表情”，他为什么这样说？',check:x=>!['search','again','modify'].includes(x.sticker.action)},
 {id:'safety_quote_hypo',content:'假设有人让我播放《稻香》，我该怎么解释？',check:x=>!['search','recommend','modify'].includes(x.music.action)},
 {id:'safety_denial',content:'我并没有让你放任何歌曲，请解释播放器设置。',check:x=>!['search','recommend','modify'].includes(x.music.action)},
 {id:'safety_quote_with_request',content:'他说“别发图”，但我想要一个开心的表情。',check:x=>x.sticker.action==='search'},
 {id:'safety_positive_title',content:'请播放“晴天”这首歌。',check:x=>x.music.action==='search'&&x.music.title==='晴天'},
 {id:'safety_ongoing_hospital',content:'再来一张',history:[{id:1,role:'user',content:'我住院了，给我一张安慰的表情'},{id:2,role:'assistant',content:'给你。'}],context:{version:1,activeSafetyContexts:[{type:'medical_or_safety',sourceMessageId:1}],stickerIntent:{meaning:'安慰',scene:'comfort',emotion:'affection',intensity:1,sourceMessageId:1}},check:x=>x.contexts.includes('medical_or_safety')},
 {id:'heldout_distress_ongoing',content:'再给我一张',history:[{id:1,role:'user',content:'我现在陷入严重困境，非常绝望，发一张安慰的表情。'},{id:2,role:'assistant',content:'我在这里。'}],context:{version:1,activeSafetyContexts:[{type:'serious_distress',sourceMessageId:1}],stickerIntent:{meaning:'安慰',scene:'comfort',emotion:'affection',intensity:1,sourceMessageId:1}},check:x=>x.contexts.includes('serious_distress')},
 {id:'heldout_recovered_hospital',content:'我已经出院了，给我一张庆祝的表情。',history:[{id:1,role:'user',content:'我正在住院'},{id:2,role:'assistant',content:'希望你早日康复。'}],context:{version:1,activeSafetyContexts:[{type:'medical_or_safety',sourceMessageId:1}]},check:x=>!x.contexts.includes('medical_or_safety')&&x.sticker.action==='search'},
 {id:'ambiguous_two_media',content:'换个吧',history:[{id:1,role:'user',content:'播放《晴天》'},{id:2,role:'assistant',content:'歌曲卡片。'},{id:3,role:'user',content:'发个开心表情'},{id:4,role:'assistant',content:'表情。'}],context:{version:1,musicRequest:{title:'晴天',artist:'',version:'',style:'',sourceMessageId:1},stickerIntent:{meaning:'开心',scene:'general',emotion:'joy',intensity:2,sourceMessageId:3}},check:x=>!['search','recommend','modify'].includes(x.music.action)&&!['search','again','modify'].includes(x.sticker.action)&&(x.music.action==='clarify'||x.sticker.action==='clarify'||x.clarification.length>0)},
 {id:'ambiguous_with_clear_music',content:'播放《晴天》，再换一个',history:[{id:1,role:'user',content:'放一首歌'},{id:2,role:'assistant',content:'歌曲卡片。'},{id:3,role:'user',content:'发个表情'},{id:4,role:'assistant',content:'表情。'}],context:{version:1,musicRequest:{title:'稻香',artist:'',version:'',style:'',sourceMessageId:1},stickerIntent:{meaning:'开心',scene:'general',emotion:'joy',intensity:2,sourceMessageId:3}},check:x=>x.music.action==='search'&&x.music.title==='晴天'&&!['search','again','modify'].includes(x.sticker.action)},
 // Held out from prompt wording: distinguish who is affected and requests from discussion.
 {id:'heldout_relative_medical',content:'我陪朋友去医院复查，他住院了。',check:x=>!x.contexts.includes('medical_or_safety')},
 {id:'heldout_self_medical',content:'今天我因为骨折住进了医院。',check:x=>x.contexts.includes('medical_or_safety')},
 {id:'heldout_story_and_sticker',content:'剧本中的姐姐生病了，给我一个开心的表情。',check:x=>!x.contexts.includes('medical_or_safety')&&x.sticker.action==='search'},
 {id:'heldout_sticker_repeat',content:'能再换一张吗？',history:previousSticker,context:sc,check:x=>['again','modify'].includes(x.sticker.action)},
 {id:'heldout_sticker_discussion',content:'我在研究“再换一张”这句话的意思。',history:previousSticker,context:sc,check:x=>!['search','again','modify'].includes(x.sticker.action)},
 {id:'heldout_knowledge_rewrite',content:'员工新到公司第一天要走哪些流程？',check:x=>[x.retrieval.question,...x.retrieval.variants].some(v=>/入职|报到|新员工/u.test(v||''))},
 {id:'heldout_business_not_app_help',content:'请问员工办理离职交接需要准备什么？',check:x=>!x.help.requested},
 {id:'heldout_ambiguous_help',content:'这个可以换名字吗？',check:x=>x.help.requested||x.clarification.length>0},
 {id:'music_restore_budget',content:'换回上一版',history:restoreHistory,context:{...mc('沦陷','王靖雯',5),previousMusicRequest:mc('沦陷','贾格',3).musicRequest},check:x=>x.music.action==='modify'&&x.music.title==='沦陷'&&x.music.artist==='贾格'},
 {id:'new_sticker_lower',content:'这张还是太张扬，能再收敛一点吗？',history:previousSticker,context:{...sc,stickerImage:{id:'synthetic-high',sourceMessageId:1,intensity:2,meaning:'开心'}},check:x=>x.sticker.action==='modify'&&x.sticker.intensity===1},
 {id:'new_sticker_minimum',content:'比刚才那张再轻一点',history:previousSticker,context:{...sc,stickerImage:{id:'synthetic-low',sourceMessageId:1,intensity:1,meaning:'开心'}},check:x=>x.sticker.action==='clarify'},
 {id:'new_media_discussion',content:'“换回上一版”是不是指上一次的歌手？只解释这句话。',history:restoreHistory,context:{...mc('沦陷','王靖雯',5),previousMusicRequest:mc('沦陷','贾格',3).musicRequest},check:x=>!['search','modify','recommend'].includes(x.music.action)},
];
async function run(item) {
 const started=Date.now();
 try {
  let diagnostic,rawPlan;
  const instrumented={...model,complete:async(...args)=>{const result=await model.complete(...args);rawPlan=result;return result;}};
  const planned=await analyzeTurn(instrumented,{content:item.content,history:item.history||[],context:item.context||{version:1},chatState:{mode:'off'},settings:{musicEnabled:true,stickersEnabled:true,stickerOnlineEnabled:true},constraints:[]},{mode:process.env.SEMANTIC_EVAL_MODE||saved.musicToolMode||'tags',onDiagnostic:event=>{diagnostic=event;}});
  const intent=planned && mergeTurnContext(planned,item.context||{version:1},item.history||[],item.content);
  if(!intent){if(process.env.SEMANTIC_DEBUG==='1')console.log(JSON.stringify({debugCase:item.id,rawPlan}));return {id:item.id,pass:false,kind:diagnostic?.outcome||'analysis_failed',ms:Date.now()-started,...(diagnostic?.tokenUsage?{tokenUsage:diagnostic.tokenUsage}:{})};}
  const lowConfidenceAction=[intent.music,intent.sticker].some(action=>['search','recommend','modify','again'].includes(action.action)&&action.confidence==='low');
  const pass=Boolean(item.check(intent))&&!lowConfidenceAction;
  if(!pass && process.env.SEMANTIC_DEBUG==='1')console.log(JSON.stringify({debugCase:item.id,rawPlan,planned,normalized:intent}));
  return {id:item.id,pass,kind:pass?'pass':lowConfidenceAction?'low_confidence':(['clarify'].includes(intent.music.action)||['clarify'].includes(intent.sticker.action)||intent.clarification.length?'clarification':'mismatch'),ms:Date.now()-started,musicAction:intent.music.action,stickerAction:intent.sticker.action,...(diagnostic?.tokenUsage?{tokenUsage:diagnostic.tokenUsage}:{})};
 }catch(error){return{id:item.id,pass:false,kind:'service_error',ms:Date.now()-started,errorStatus:error.status||null};}
}
try {
 const results=[];
 const selection=process.env.SEMANTIC_EVAL_CASES ? cases.filter(item=>process.env.SEMANTIC_EVAL_CASES.split(',').includes(item.id)) : cases;
 const repetitions=Math.max(1,Math.min(10,Number.parseInt(process.env.SEMANTIC_EVAL_REPEAT||'1',10)||1));
 const selected=Array.from({length:repetitions},()=>selection).flat();
 // Avoid saturating the configured model service.
 const concurrency=process.env.SEMANTIC_EVAL_CONCURRENCY==='1'?1:2;
 for(let i=0;i<selected.length;i+=concurrency) {const batch=await Promise.all(selected.slice(i,i+concurrency).map(run));results.push(...batch);for(const row of batch) console.log(JSON.stringify(row));}
 const report={generatedAt:new Date().toISOString(),mode:process.env.SEMANTIC_EVAL_MODE||saved.musicToolMode||'tags',total:results.length,passed:results.filter(r=>r.pass).length,failed:results.filter(r=>!r.pass).length,results};
 mkdirSync(dirname(output),{recursive:true});writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({summary:{total:report.total,passed:report.passed,failed:report.failed},report:output}));
 if(report.failed)process.exitCode=1;
} finally {store.close();}
