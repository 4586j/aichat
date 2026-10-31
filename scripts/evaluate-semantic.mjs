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
const saved=Object.fromEntries(source.prepare("SELECT key,value FROM settings WHERE key IN ('baseUrl','model','musicToolMode')").all().map(row=>[row.key,JSON.parse(row.value)]));source.close();
const store=createStore(':memory:');store.saveSettings(saved);
const model=createModel(store,{apiKey:createLocalModelKey(resolve(sourceDir,'model-key.local')).read()||'',timeoutMs:90000});
const mc=(title,artist='',reference=1)=>({version:1,musicRequest:{title,artist,version:'',style:'',sourceMessageId:reference}});
const sc={version:1,stickerIntent:{meaning:'开心',scene:'general',emotion:'joy',intensity:2,sourceMessageId:1},stickerImage:{id:'leaf-cheer',sourceMessageId:1}};
const history=[{id:1,role:'user',content:'播放《沦陷》'},{id:2,role:'assistant',content:'歌曲卡片。'}];
const previousSticker=[{id:1,role:'user',content:'发个开心的表情'},{id:2,role:'assistant',content:'给你。'}];
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
 {id:'knowledge_rewrite',content:'新人报到要办哪些手续',check:x=>[x.retrieval.question,...x.retrieval.variants].some(v=>/入职|新员工/u.test(v||''))},
 {id:'combined',content:'播放《晴天》，再发一个生气的表情',check:x=>x.music.action==='search'&&x.sticker.action==='search'},
 {id:'holdout_sticker_denial',content:'这次不用配图，文字就好',check:x=>!['search','again','modify'].includes(x.sticker.action)},
 {id:'holdout_music',content:'找一下《稻香》给我听',check:x=>x.music.action==='search'&&x.music.title==='稻香'},
 {id:'holdout_quote',content:'对方说“给我放首歌”，他在表达什么？',check:x=>!['search','recommend','modify'].includes(x.music.action)},
 {id:'holdout_mixed',content:'我正在写程序，别配表情，放《晴天》',check:x=>x.music.action==='search'&&x.music.title==='晴天'&&!['search','again','modify'].includes(x.sticker.action)},
 {id:'holdout_fiction',content:'我写的故事里角色刚住院，我们继续聊剧情',check:x=>!x.contexts.includes('medical_or_safety')},
 {id:'holdout_ambiguous',content:'换个吧',check:x=>!['search','recommend','modify'].includes(x.music.action)&&!['search','again','modify'].includes(x.sticker.action)},
 {id:'holdout_followup',content:'那之后怎么办',history:[{id:1,role:'user',content:'新人报到要办哪些手续'},{id:2,role:'assistant',content:'先办理入职报到。'}],check:x=>[x.retrieval.question,...x.retrieval.variants].some(v=>/入职|报到|新人/u.test(v||''))},
];
async function run(item) {
 const started=Date.now();
 try {
  let diagnostic;
  const planned=await analyzeTurn(model,{content:item.content,history:item.history||[],context:item.context||{version:1},chatState:{mode:'off'},settings:{musicEnabled:true,stickersEnabled:true,stickerOnlineEnabled:true},constraints:[]},{mode:process.env.SEMANTIC_EVAL_MODE||saved.musicToolMode||'tags',onDiagnostic:event=>{diagnostic=event;}});
  const intent=planned && mergeTurnContext(planned,item.context||{version:1},item.history||[],item.content);
  if(!intent)return {id:item.id,pass:false,kind:diagnostic?.outcome||'analysis_failed',ms:Date.now()-started};
  const pass=Boolean(item.check(intent));
  return {id:item.id,pass,kind:pass?'pass':(['clarify'].includes(intent.music.action)||['clarify'].includes(intent.sticker.action)||intent.clarification.length?'clarification':'mismatch'),ms:Date.now()-started,musicAction:intent.music.action,stickerAction:intent.sticker.action};
 }catch(error){return{id:item.id,pass:false,kind:'service_error',ms:Date.now()-started,errorStatus:error.status||null};}
}
try {
 const results=[];
 const selected=process.env.SEMANTIC_EVAL_CASES ? cases.filter(item=>process.env.SEMANTIC_EVAL_CASES.split(',').includes(item.id)) : cases;
 // Avoid saturating the configured model service.
 for(let i=0;i<selected.length;i+=2) {const batch=await Promise.all(selected.slice(i,i+2).map(run));results.push(...batch);for(const row of batch) console.log(JSON.stringify(row));}
 const report={generatedAt:new Date().toISOString(),mode:process.env.SEMANTIC_EVAL_MODE||saved.musicToolMode||'tags',total:results.length,passed:results.filter(r=>r.pass).length,failed:results.filter(r=>!r.pass).length,results};
 mkdirSync(dirname(output),{recursive:true});writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({summary:{total:report.total,passed:report.passed,failed:report.failed},report:output}));
} finally {store.close();}
