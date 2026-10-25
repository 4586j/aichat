import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../lib/store.mjs';
import { createService } from '../lib/service.mjs';
import { responseRequests } from '../lib/response-policy.mjs';
import { fixture, addConversation, addMessages, errorStatus, deferred, modelResponse } from './helpers.mjs';
import { mockMediaFetch, PNG } from './media-fixtures.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../server.mjs';

const field = (value, quote, more = {}) => ({ value, confidence:'high', evidence:[{messageId:'current',quote}], ...more });
const mediaReply = (intent, prediction, content = '我在这里。') => `${content}\n<qiyi-media>${JSON.stringify(intent)}</qiyi-media>${prediction ? `\n<qiyi-state>${JSON.stringify(prediction)}</qiyi-state>` : ''}`;
const musicIntent = {songQuery:'安静片刻',songReason:'根据你明确想听的歌曲选择。'};
const snapshot = (f,id) => f.api.getChatState({personaId:f.personaId,conversationId:id}).chatState;
const manual = (f,id,fields) => f.api.updateChatState({personaId:f.personaId,conversationId:id,patch:{expectedManualRevision:snapshot(f,id).manualRevision,fields}});
const configure = f => f.api.media.update({musicBaseUrl:'http://music-fixture.invalid'});
const prefill = (f,id,n=4) => addMessages(f.store,id,Array.from({length:n*2},(_,i)=>i%2?'收到。':'继续聊。'));
const relaxed = (f,id,more={}) => manual(f,id,{need:{value:'chat'},emotion:{value:['calm'],intensity:1},...more});
const hasSong = message => message.attachments.some(item=>['song','song-search'].includes(item.type));
const update = (api,values) => api.responsePolicy.update({expectedRevision:api.responsePolicy.settings().revision,...values});

test('response settings are independent, atomic and revisioned with no external calls', t => {
  const f=fixture(t); const defaults=f.api.responsePolicy.settings(); assert.deepEqual(defaults,{stickerLinked:true,musicLinked:true,petLinked:true,revision:0});
  update(f.api,{musicLinked:false}); assert.equal(f.api.responsePolicy.settings().stickerLinked,true);
  assert.throws(()=>f.api.responsePolicy.update({expectedRevision:0,petLinked:false}),errorStatus(409));
  assert.throws(()=>update(f.api,{petLinked:'false'}),errorStatus(400));
  assert.equal(f.api.responsePolicy.settings().petLinked,true);assert.equal(f.calls.length,0);
});

test('explicit requests and local declines are distinguished from setup questions',()=>{
  for(const text of ['推荐一首歌','给我一首安静的歌','想听音乐','请播放一首歌曲','recommend a song','不想说话，推荐一首歌','来一首晴天'])assert.equal(responseRequests(text).music,true,text);
  for(const text of ['音乐服务怎么设置','推荐歌曲怎么配置','我在做音乐平台项目','不要推荐音乐','别再推歌了'])assert.equal(responseRequests(text).music,false,text);
  assert.equal(responseRequests('发一个抱抱表情').sticker,true);assert.equal(responseRequests('不要发表情').negativeSticker,true);
});

test('current grounded state drives first-turn comfort, rejects celebration and performs no music search',async t=>{
  const networks=[];const f=fixture(t,[mediaReply({stickerId:'leaf-cheer',...musicIntent},{energy:field('low','今天好累'),need:field('listen','先别给建议')})],{mediaFetchImpl:async(...args)=>{networks.push(args);return mockMediaFetch(...args);}});
  configure(f);const id=addConversation(f.api,f.personaId);const result=await f.api.sendMessage(id,{content:'今天好累，先别给建议。'});
  assert.equal(f.calls.length,1);assert.equal(result.message.responseBehavior.scene,'rest');assert.equal(result.message.attachments[0].id,'leaf-rest');
  assert.equal(hasSong(result.message),false);assert.equal(networks.length,0);assert.equal(result.chatState.responseBehavior.petPhase,'quiet');
  assert.equal(result.message.responseBehavior.evidence[0].evidence[0].messageId,result.userMessage.id);
});

test('current need has priority over happiness and invalid model quotes do not trigger a scene',async t=>{
  const f=fixture(t,[mediaReply({stickerId:'leaf-cheer'},{need:field('task','帮我解决问题'),emotion:field(['happy'],'我很开心',{intensity:4})}),mediaReply({stickerId:'leaf-hug'},{energy:field('low','编造的疲惫')})]);
  const id=addConversation(f.api,f.personaId);let result=await f.api.sendMessage(id,{content:'我很开心，但现在先帮我解决问题。'});assert.equal(result.message.responseBehavior.scene,'focus');assert.equal(result.message.attachments.length,0);
  const other=addConversation(f.api,f.personaId);result=await f.api.sendMessage(other,{content:'普通问候。'});assert.equal(result.message.responseBehavior.scene,'normal');
});

test('proactive music first appears on reply five and then respects a rolling five-reply gap',async t=>{
  const f=fixture(t,Array(10).fill(mediaReply(musicIntent)),{mediaFetchImpl:mockMediaFetch});configure(f);const id=addConversation(f.api,f.personaId);relaxed(f,id);
  const turns=[];for(let i=1;i<=10;i++){const result=await f.api.sendMessage(id,{content:'继续聊聊日常。'});if(hasSong(result.message))turns.push(i);}
  assert.deepEqual(turns,[5,10]);assert.equal(f.calls.length,10);
  assert.ok(f.calls[0].body.messages[0].content.includes('本轮不主动推荐'));
});

test('low proactivity and tiredness extend the proactive interval to ten replies',async t=>{
  const f=fixture(t,[mediaReply(musicIntent),mediaReply(musicIntent)],{mediaFetchImpl:mockMediaFetch});configure(f);const id=addConversation(f.api,f.personaId);relaxed(f,id,{energy:{value:'low'}});prefill(f,id,8);
  let result=await f.api.sendMessage(id,{content:'继续轻松聊聊。'});assert.equal(hasSong(result.message),false);
  result=await f.api.sendMessage(id,{content:'继续聊。'});assert.equal(hasSong(result.message),true);assert.equal(result.message.responseBehavior.interval,10);
});

for(const need of ['listen','task','advice'])test(`${need} need suppresses unsolicited music even after the interval`,async t=>{
  const f=fixture(t,[mediaReply(musicIntent)],{mediaFetchImpl:mockMediaFetch});configure(f);const id=addConversation(f.api,f.personaId);manual(f,id,{need:{value:need}});prefill(f,id,12);
  assert.equal(hasSong((await f.api.sendMessage(id,{content:'继续。'})).message),false);
});

test('missing service and unknown state produce no unsolicited pending card or external request',async t=>{
  let requests=0;const f=fixture(t,[mediaReply(musicIntent),mediaReply(musicIntent)],{mediaFetchImpl:()=>{requests++;throw new Error('unexpected');}});const id=addConversation(f.api,f.personaId);relaxed(f,id);prefill(f,id);
  assert.equal(hasSong((await f.api.sendMessage(id,{content:'继续。'})).message),false);
  const other=addConversation(f.api,f.personaId);configure(f);prefill(f,other);assert.equal(hasSong((await f.api.sendMessage(other,{content:'你好。'})).message),false);assert.equal(requests,0);
});

test('explicit music bypasses linked switch, interval and session mute, while master off still wins',async t=>{
  const f=fixture(t,Array(4).fill(mediaReply(musicIntent)),{mediaFetchImpl:mockMediaFetch});const id=addConversation(f.api,f.personaId);update(f.api,{musicLinked:false});
  let result=await f.api.sendMessage(id,{content:'给我推荐一首歌。'});assert.equal(result.message.attachments[0].type,'song-search');assert.equal(result.message.responseBehavior.explicitSong,true);
  f.api.musicFeedback(id,{action:'mute',messageId:result.message.id});configure(f);
  result=await f.api.sendMessage(id,{content:'推荐一首歌。'});assert.equal(hasSong(result.message),true);
  f.api.media.update({musicEnabled:false});result=await f.api.sendMessage(id,{content:'推荐一首歌。'});assert.equal(hasSong(result.message),false);
});

test('feedback hides only the selected song and mute remains scoped to its conversation',async t=>{
  const f=fixture(t,[mediaReply(musicIntent),mediaReply(musicIntent),mediaReply(musicIntent)],{mediaFetchImpl:mockMediaFetch});configure(f);const id=addConversation(f.api,f.personaId);relaxed(f,id);prefill(f,id);
  const result=await f.api.sendMessage(id,{content:'继续聊。'});const messageId=result.message.id;
  f.api.musicFeedback(id,{action:'skip',messageId});assert.equal(f.api.getConversation(id).messages.at(-1).musicFeedback,'skip');assert.equal(f.api.responsePolicy.muted(id),false);
  f.api.musicFeedback(id,{action:'restore',messageId});assert.equal(f.api.getConversation(id).messages.at(-1).musicFeedback,'');
  f.api.musicFeedback(id,{action:'mute',messageId});prefill(f,id,5);assert.equal(hasSong((await f.api.sendMessage(id,{content:'继续。'})).message),false);
  const other=addConversation(f.api,f.personaId);relaxed(f,other);prefill(f,other);assert.equal(hasSong((await f.api.sendMessage(other,{content:'继续。'})).message),true);
  f.api.musicFeedback(id,{action:'unmute'});assert.equal(f.api.responsePolicy.muted(id),false);assert.equal(f.api.getConversation(id).messages.length,22);
});

test('feedback rejects foreign, user and non-song messages, and repeated feedback is idempotent',async t=>{
  const f=fixture(t,[mediaReply(musicIntent)]);const id=addConversation(f.api,f.personaId),other=addConversation(f.api,f.personaId);const result=await f.api.sendMessage(id,{content:'推荐一首歌。'});
  for(const [conversationId,messageId]of[[other,result.message.id],[id,result.userMessage.id],[id,99999]])assert.throws(()=>f.api.musicFeedback(conversationId,{action:'mute',messageId}),errorStatus(404));
  f.api.musicFeedback(id,{action:'mute',messageId:result.message.id});const before=f.api.getConversation(id);f.api.musicFeedback(id,{action:'mute',messageId:result.message.id});assert.deepEqual(f.api.getConversation(id),before);
});

test('independent sticker link allows explicit requests but blocks unsolicited stickers',async t=>{
  const f=fixture(t,[mediaReply({stickerId:'leaf-cheer'}),mediaReply({stickerId:'leaf-cheer'})]);update(f.api,{stickerLinked:false});const id=addConversation(f.api,f.personaId);
  assert.equal((await f.api.sendMessage(id,{content:'庆祝一下。'})).message.attachments.length,0);
  assert.equal((await f.api.sendMessage(id,{content:'发一个开心表情。'})).message.attachments[0].id,'leaf-cheer');
});

test('one primary medium is selected unless both are explicitly requested; negative requests are enforced',async t=>{
  const f=fixture(t,Array(3).fill(mediaReply({stickerId:'leaf-cheer',...musicIntent})),{mediaFetchImpl:mockMediaFetch});configure(f);const id=addConversation(f.api,f.personaId);relaxed(f,id);prefill(f,id);
  let result=await f.api.sendMessage(id,{content:'继续聊天。'});assert.equal(result.message.attachments.length,1);assert.equal(result.message.attachments[0].type,'song');
  result=await f.api.sendMessage(id,{content:'请推荐一首歌并发一个表情。'});assert.equal(result.message.attachments.length,2);
  result=await f.api.sendMessage(id,{content:'不要推荐音乐，也不要发表情。'});assert.equal(result.message.attachments.length,0);
});

test('manual changes made during the model request override inferred media decisions',async t=>{
  const gate=deferred();let requests=0;const f=fixture(t,[()=>gate.promise],{mediaFetchImpl:async(...args)=>{requests++;return mockMediaFetch(...args);}});configure(f);const id=addConversation(f.api,f.personaId);relaxed(f,id);prefill(f,id);
  const pending=f.api.sendMessage(id,{content:'我很开心。'});manual(f,id,{need:{value:'listen'},energy:{value:'low'}});gate.resolve(modelResponse(mediaReply({stickerId:'leaf-cheer',...musicIntent},{emotion:field(['happy'],'我很开心',{intensity:3})})));const result=await pending;
  assert.equal(hasSong(result.message),false);assert.equal(result.message.responseBehavior.scene,'rest');assert.equal(requests,0);
});

test('mute or switch-off during a model request prevents an unsolicited lookup',async t=>{
  const gate=deferred();let requests=0;const f=fixture(t,[mediaReply(musicIntent),()=>gate.promise],{mediaFetchImpl:async(...args)=>{requests++;return mockMediaFetch(...args);}});configure(f);const id=addConversation(f.api,f.personaId);relaxed(f,id);prefill(f,id);
  const prior=await f.api.sendMessage(id,{content:'继续。'});prefill(f,id,5);requests=0;
  const pending=f.api.sendMessage(id,{content:'继续聊。'});f.api.musicFeedback(id,{action:'mute',messageId:prior.message.id});gate.resolve(modelResponse(mediaReply(musicIntent)));assert.equal(hasSong((await pending).message),false);assert.equal(requests,0);
});

test('failed requests do not consume a recommendation slot and history retains clean body and response evidence',async t=>{
  const f=fixture(t,[new Error('offline'),mediaReply(musicIntent)],{mediaFetchImpl:mockMediaFetch});configure(f);const id=addConversation(f.api,f.personaId);relaxed(f,id);prefill(f,id);
  await assert.rejects(f.api.sendMessage(id,{content:'继续。'}),errorStatus(502));const result=await f.api.sendMessage(id,{content:'继续。'});assert.equal(hasSong(result.message),true);
  assert.equal(f.api.getConversation(id).messages.at(-1).content,'我在这里。');assert.ok(result.message.responseBehavior.evidence.length>0);
});

test('sticker scene and intensity are editable, validated atomically and survive toggle changes',t=>{
  const f=fixture(t);const before=f.api.media.list().find(s=>s.id==='leaf-hug');assert.equal(before.scene,'comfort');assert.equal(before.intensity,1);
  assert.throws(()=>f.api.media.edit('leaf-hug',{name:'should not save',scene:'invalid'}),errorStatus(400));assert.equal(f.api.media.list().find(s=>s.id==='leaf-hug').name,before.name);
  const uploaded=f.api.media.upload({name:'温柔的小猫',scene:'comfort',intensity:1,data:PNG.toString('base64')}).sticker;
  f.api.media.edit(uploaded.id,{enabled:false});assert.equal(f.api.media.list().find(s=>s.id===uploaded.id).scene,'comfort');
  assert.throws(()=>f.api.media.upload({name:'invalid',intensity:4,data:PNG.toString('base64')}),errorStatus(400));
});

test('emotion-linked online fallback stays offline for unclassified delicate scenes',async t=>{
  let requests=0;const f=fixture(t,[mediaReply({stickerQuery:'galaxyxrobot'},{need:field('listen','只想说说')})],{mediaFetchImpl:()=>{requests++;throw new Error('unexpected');}});f.api.media.update({stickerSearchUrl:'https://stickers.invalid/search'});const id=addConversation(f.api,f.personaId);
  const result=await f.api.sendMessage(id,{content:'我只想说说。'});assert.equal(requests,0);assert.equal(result.message.attachments.length,0);
});

test('pet link switch does not change state, stored animation preferences or scores',async t=>{
  const f=fixture(t,[mediaReply({}, {emotion:field(['happy'],'很开心',{intensity:3}),need:field('chat','聊聊天')})]);const id=addConversation(f.api,f.personaId);const before=f.api.pets.bootstrap();
  await f.api.sendMessage(id,{content:'我很开心，来聊聊天。'});assert.equal(snapshot(f,id).responseBehavior.scene,'celebrate');update(f.api,{petLinked:false});assert.equal(snapshot(f,id).responseBehavior.petLinked,false);assert.equal(snapshot(f,id).fields.emotion.value[0],'happy');assert.deepEqual(f.api.pets.bootstrap(),before);
});

test('response settings, feedback and sticker classification survive restart',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'qiyi-response-'));t.after(()=>rm(dir,{recursive:true,force:true}));const path=join(dir,'app.sqlite');let store=createStore(path),api=createService(store,{apiKey:''});
  const personaId=api.bootstrap().personas[0].id,id=api.createConversation({personaId}).conversation.id;
  const messageId=Number(store.run("INSERT INTO messages(conversationId,role,content,attachments,createdAt) VALUES (?,'assistant','song',?,?)",id,JSON.stringify([{type:'song-search',query:'song'}]),new Date().toISOString()).lastInsertRowid);
  update(api,{musicLinked:false});api.musicFeedback(id,{action:'mute',messageId});api.media.edit('leaf-hug',{intensity:2});await api.scheduler.stop();store.close();
  store=createStore(path);try{api=createService(store,{apiKey:''});assert.equal(api.responsePolicy.settings().musicLinked,false);assert.equal(api.responsePolicy.muted(id),true);assert.equal(api.getConversation(id).messages[0].musicFeedback,'mute');assert.equal(api.media.list().find(s=>s.id==='leaf-hug').intensity,2);await api.scheduler.stop();}finally{store.close();}
});

test('response settings and feedback HTTP routes keep existing origin protection and local assets',async t=>{
  const app=await startServer({port:0,dbPath:':memory:',scheduler:false});t.after(()=>app.close());
  for(const path of ['/response-policy.js','/response-policy.css','/response-scenes.js'])assert.equal((await fetch(app.url+path)).status,200);
  const response=await fetch(app.url+'/api/response-settings');assert.equal((await response.json()).responseSettings.musicLinked,true);
  assert.equal((await fetch(app.url+'/api/response-settings',{method:'PUT',headers:{'content-type':'application/json',origin:'https://foreign.invalid'},body:JSON.stringify({expectedRevision:0,musicLinked:false})})).status,403);
});

test('switching off proactive music during generation prevents a lookup without muting other switches',async t=>{
  const gate=deferred();let networks=0;const f=fixture(t,[()=>gate.promise],{mediaFetchImpl:async(...args)=>{networks++;return mockMediaFetch(...args);}});configure(f);const id=addConversation(f.api,f.personaId);relaxed(f,id);prefill(f,id);
  const pending=f.api.sendMessage(id,{content:'轻松聊聊。'});update(f.api,{musicLinked:false});gate.resolve(modelResponse(mediaReply(musicIntent)));assert.equal(hasSong((await pending).message),false);assert.equal(networks,0);assert.equal(f.api.responsePolicy.settings().stickerLinked,true);
});

test('mute during an already started music lookup suppresses its result before committing the message',async t=>{
  const gate=deferred(),started=deferred();const f=fixture(t,[mediaReply(musicIntent)],{mediaFetchImpl:async(url,init)=>{if(new URL(url).pathname==='/api/library'){started.resolve();return gate.promise;}return mockMediaFetch(url,init);}});configure(f);const id=addConversation(f.api,f.personaId);relaxed(f,id);const ids=prefill(f,id,5);
  f.store.run('UPDATE messages SET attachments=? WHERE id=?',JSON.stringify([{type:'song-search',query:'older'}]),ids[1]);
  const pending=f.api.sendMessage(id,{content:'继续聊。'});await started.promise;f.api.musicFeedback(id,{action:'mute',messageId:ids[1]});gate.resolve(await mockMediaFetch('http://music-fixture.invalid/api/library'));
  const result=await pending;assert.equal(hasSong(result.message),false);assert.equal(result.message.responseBehavior.musicMuted,true);
});

test('confirmed preferences are bounded reference data, independent from familiarity frequency',async t=>{
  const f=fixture(t,[mediaReply({})]);const id=addConversation(f.api,f.personaId);
  f.api.saveMemory({personaId:f.personaId,content:'喜欢轻柔的纯音乐',category:'preference'});
  const unconfirmed=f.api.saveMemory({personaId:f.personaId,content:'UNCONFIRMED_MUSIC_TASTE',category:'preference'}).memory;f.store.run("UPDATE memories SET source='conversation',confirmedAt=NULL WHERE id=?",unconfirmed.id);
  await f.api.sendMessage(id,{content:'你好。'});const context=JSON.parse(f.calls[0].body.messages[2].content.split('\n').slice(1).join('\n'));
  assert.deepEqual(context.responsePolicy.confirmedPreferences,['喜欢轻柔的纯音乐']);assert.equal(snapshot(f,id).responseBehavior.interval,5);
});

test('the fifth-turn prompt can consider newly grounded state rather than requiring a previous emotion',async t=>{
  const f=fixture(t,[mediaReply(musicIntent,{need:field('chat','想轻松聊天')})],{mediaFetchImpl:mockMediaFetch});configure(f);const id=addConversation(f.api,f.personaId);prefill(f,id);
  const result=await f.api.sendMessage(id,{content:'想轻松聊天。'});assert.equal(f.calls.length,1);assert.equal(hasSong(result.message),true);assert.ok(f.calls[0].body.messages[0].content.includes('已到推荐间隔，可根据本轮有效原话重新判断'));
});
