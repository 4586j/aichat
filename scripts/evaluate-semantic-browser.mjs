// Browser acceptance against the configured real model, using synthetic chat and local media fixtures.
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { startServer } from '../server.mjs';
import { createLocalModelKey } from '../lib/local-model-key.mjs';
import { mockMediaFetch, gallerySticker, PNG } from '../tests/media-fixtures.mjs';
const data=resolve(process.env.AGENT_DATA_DIR||'./data'),db=new DatabaseSync(resolve(data,'agent.sqlite'),{readOnly:true});
db.exec('PRAGMA busy_timeout = 5000');
const saved=Object.fromEntries(db.prepare("SELECT key,value FROM settings WHERE key IN ('baseUrl','model')").all().map(r=>[r.key,JSON.parse(r.value)]));db.close();
const diagnostics=[], requests=[];
const mode=process.env.SEMANTIC_EVAL_MODE||'tags';
const mediaFetchImpl=async(url,init)=>{const u=new URL(url);if(u.hostname==='semantic-gallery.invalid')return u.pathname.includes('/images/')?new Response(PNG,{headers:{'content-type':'image/png','content-length':String(PNG.length)}}):new Response(JSON.stringify({stickers:[gallerySticker(u.origin,{name:'生气小猫',meaning:'生气',tags:['生气'],emotions:['anger'],intensity:2})]}),{headers:{'content-type':'application/json'}});return mockMediaFetch(url,init);};
const app=await startServer({port:0,dbPath:':memory:',scheduler:false,modelOptions:{apiKey:createLocalModelKey(resolve(data,'model-key.local')).read()||'',mediaFetchImpl,semanticDiagnostics:e=>diagnostics.push(e)}});
let browser;
try {
 app.api.updateSettings({...saved,intentMode:'semantic',musicToolMode:mode});app.api.media.update({musicBaseUrl:'http://music-fixture.invalid',stickerSearchUrl:'http://semantic-gallery.invalid/api/v1/stickers/search'});
 const persona=app.api.savePersona({name:'语义验收',systemPrompt:'简洁回应。'}).persona;
 browser=await chromium.launch({channel:'chrome',headless:true});const context=await browser.newContext({storageState:{cookies:[],origins:[{origin:app.url,localStorage:[{name:'qiyi-entrance-seen',value:'true'}]}]}});
 await context.route('**/*',route=>{const url=new URL(route.request().url());return url.origin===app.url||['data:','blob:'].includes(url.protocol)?route.continue():route.abort();});
 const page=await context.newPage();page.on('request',r=>{if(r.url().includes('/api/music/stream'))requests.push(r.url());});
 await page.goto(`${app.url}/#chat`);await page.getByLabel('选择聊天角色',{exact:true}).selectOption(persona.id);
 const started=Date.now();await page.locator('#chat-input').fill('播放《安静片刻》，再发一个生气的表情');await page.getByRole('button',{name:'发送',exact:true}).click();
 await page.locator('#live-reply').waitFor({state:'hidden',timeout:120000});
 const song=await page.getByRole('button',{name:'播放这首歌',exact:true}).count(),sticker=await page.locator('.reply-sticker img').count(),before=requests.length;
 let advancing=false;if(song){await page.getByRole('button',{name:'播放这首歌',exact:true}).first().click();await page.waitForFunction(()=>document.querySelector('#background-audio')?.currentTime>0,null,{timeout:10000});advancing=true;}
 mkdirSync('test-reports',{recursive:true});await page.screenshot({path:`test-reports/semantic-real-browser-${mode}.png`,fullPage:true});
 const result={mode,pass:Boolean(song&&sticker&&before===0&&requests.length>0&&advancing),elapsedMs:Date.now()-started,songCount:song,stickerCount:sticker,audioRequestsBeforeClick:before,audioRequestsAfterClick:requests.length,audioTimeAdvances:advancing,diagnostics};
 writeFileSync(`test-reports/semantic-real-browser-${mode}.json`,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));if(!result.pass)process.exitCode=1;
} finally {await browser?.close();app.server.closeAllConnections();await app.close();}
