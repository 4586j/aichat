import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../lib/store.mjs';
import { createMedia, parseMediaReply } from '../lib/media.mjs';
import { fixture, addConversation, errorStatus, deferred } from './helpers.mjs';
import { gallerySticker } from './media-fixtures.mjs';

export const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=','base64');
const json=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
function local(t,options={}) {
  const store=createStore(':memory:');t.after(()=>store.close());
  const calls=[];
  const media=createMedia(store,{musicApiKey:'',stickerApiKey:'',mediaFetchImpl:async(url,init)=>{calls.push({url:new URL(url),init});return options.response?options.response(new URL(url),init):json({});},...options});
  return {store,media,calls};
}

test('blank music and online sticker configuration makes no network requests',async t=>{
  const {media,calls}=local(t);
  assert.equal(media.settings().musicBaseUrl,'');
  assert.equal(media.list().length,6);
  assert.equal((await media.music.status()).configured,false);
  await assert.rejects(media.music.search('tea'),errorStatus(503));
  const reply=await media.resolve('一起听一首歌。\n<qiyi-media>{"songQuery":"tea","stickerQuery":"没有任何关联xyz"}</qiyi-media>',media.candidates('tea'));
  assert.equal(reply.content,'一起听一首歌。');assert.equal(reply.attachments[0].type,'song-search');
  assert.match(reply.attachments[0].message,/未配置/);assert.equal(calls.length,0);
});

test('media settings validate atomically and runtime keys never enter settings or database',t=>{
  const {media,store}=local(t);
  const result=media.update({musicBaseUrl:'http://music.invalid/prefix/',musicApiKey:'music-secret',stickerApiKey:'sticker-secret'});
  assert.equal(result.settings.musicBaseUrl,'http://music.invalid/prefix');
  assert.equal(result.settings.hasMusicApiKey,true);
  assert.ok(!JSON.stringify(result).includes('music-secret'));
  assert.ok(!store.get('SELECT value FROM media_settings').value.includes('secret'));
  assert.throws(()=>media.update({musicBaseUrl:'https://new.invalid',musicSource:'wrong',clearMusicApiKey:true}));
  assert.equal(media.settings().musicBaseUrl,'http://music.invalid/prefix');assert.equal(media.bootstrap().settings.hasMusicApiKey,true);
  assert.throws(()=>media.update({musicApiKey:'line\nbreak'}));
  assert.equal(media.update({musicApiKey:''}).settings.hasMusicApiKey,true);
  assert.equal(media.update({clearMusicApiKey:true}).settings.hasMusicApiKey,false);
});

for(const input of [{musicBaseUrl:'file:///tmp/key'},{musicBaseUrl:'http://user:password@host'}, {musicBaseUrl:'https://host?q=token'}, {musicEnabled:'true'}, {stickerImageOrigins:['https://host/path']}, {stickerSearchUrl:null}]) {
  test(`invalid configuration is rejected: ${Object.keys(input)[0]} ${JSON.stringify(input)}`,t=>{const{media}=local(t);assert.throws(()=>media.update(input));assert.equal(media.settings().musicBaseUrl,'');});
}

test('upload validates binary type, deduplicates, edits, disables and deletes',async t=>{
  const {media}=local(t);
  const first=media.upload({name:'小测试',tags:'测试 test',description:'表示认可',data:PNG.toString('base64')}).sticker;
  assert.equal(first.builtin,false);assert.equal(media.list().length,7);
  const duplicate=media.upload({name:'更新名字',tags:'test',data:PNG.toString('base64')}).sticker;
  assert.equal(duplicate.id,first.id);assert.equal(media.list().length,7);
  assert.deepEqual((await media.image(first.id)).data,PNG);
  media.edit(first.id,{description:'new description',enabled:false});
  assert.ok(!media.candidates('test').some(s=>s.id===first.id));
  assert.throws(()=>media.upload({name:'script',data:Buffer.from('<svg onload="alert(1)"/>').toString('base64')}));
  assert.throws(()=>media.upload({name:'huge',data:'A'.repeat(6*1024*1024)}));
  assert.throws(()=>media.upload({name:'bad',data:'####'}));
  assert.throws(()=>media.remove('leaf-cheer'));
  media.remove(first.id);await assert.rejects(media.image(first.id),errorStatus(404));
});

test('uploaded sticker dimensions are bounded even for a small file',t=>{
  const {media}=local(t);const data=Buffer.from(PNG);data.writeUInt32BE(65535,16);
  assert.throws(()=>media.upload({name:'huge dimension',data:data.toString('base64')}));
});

test('local sticker takes precedence; disabled and invented ids do not attach',async t=>{
  const {media,calls}=local(t);
  media.update({stickerSearchUrl:'https://stickers.invalid/search'});
  const candidates=media.candidates('celebrate');
  const raw='好消息！\n<qiyi-media>{"stickerId":"leaf-cheer","stickerQuery":"something online"}</qiyi-media>';
  assert.equal((await media.resolve(raw,candidates)).attachments[0].id,'leaf-cheer');assert.equal(calls.length,0);
  media.edit('leaf-cheer',{enabled:false});
  const result=await media.resolve('正文\n<qiyi-media>{"stickerId":"leaf-cheer"}</qiyi-media>',candidates);
  assert.equal(result.attachments.length,0);
  assert.equal((await media.resolve('正文\n<qiyi-media>{"stickerId":"invented"}</qiyi-media>',candidates)).attachments.length,0);
  assert.equal((await media.resolve('正文\n<qiyi-media>{"stickerId":"leaf-hug"}</qiyi-media>',[])).attachments.length,0);
});

test('online fallback uses short query and an allowlisted image, never exposes its token',async t=>{
  const {media,calls}=local(t,{response:(url)=>url.pathname==='/search'?json({stickers:[gallerySticker()]}):new Response(PNG,{headers:{'content-type':'image/png'}})});
  media.update({stickerSearchUrl:'https://stickers.invalid/search',stickerApiKey:'private-key'});
  const plan={stickerAllowed:true,explicitSticker:true,stickerSearch:{q:'害羞',scene:'general',emotion:'affection',maxIntensity:1,contexts:[],limit:8}};
  const result=await media.resolve('正文\n<qiyi-media>{"stickerQuery":"害羞"}</qiyi-media>',[],[],null,{plan});
  assert.equal(result.attachments[0].origin,'online');
  assert.ok(!JSON.stringify(result).includes('signature'));assert.ok(!JSON.stringify(result).includes('private-key'));
  assert.equal(calls[0].url.searchParams.get('q'),'害羞');assert.equal(calls[0].init.headers.Authorization,'Bearer private-key');
  assert.deepEqual((await media.image(result.attachments[0].id)).data,PNG);
  assert.equal(calls[1].init.headers.Authorization,'Bearer private-key');
});

for(const url of ['http://127.0.0.1/private','https://unknown.invalid/file.png','https://user:pass@stickers.invalid/file.png','javascript:alert(1)']) {
  test(`unapproved external sticker image is ignored: ${url}`,async t=>{
    const {media,calls}=local(t,{response:()=>json({stickers:[gallerySticker('https://stickers.invalid',{url})]})});media.update({stickerSearchUrl:'https://stickers.invalid/search'});
    const plan={stickerAllowed:true,explicitSticker:true,stickerSearch:{q:'害羞',scene:'general',emotion:'affection',maxIntensity:1,contexts:[],limit:8}};
    const result=await media.resolve('正文\n<qiyi-media>{"stickerQuery":"害羞"}</qiyi-media>',[],[],null,{plan});
    assert.equal(result.content,'正文');assert.equal(result.attachments.length,0);assert.equal(calls.length,1);
  });
}

for(const body of ['```json\n<qiyi-media>{"stickerId":"leaf-hug"}</qiyi-media>\n```','```\n<qiyi-media>{"stickerId":"leaf-hug"}</qiyi-media>','> <qiyi-media>{"stickerId":"leaf-hug"}</qiyi-media>','<!--\n<qiyi-media>{"stickerId":"leaf-hug"}</qiyi-media>','`example\n<qiyi-media>{"stickerId":"leaf-hug"}</qiyi-media>']){
  test('quoted or code protocol is displayed as ordinary text: '+body.slice(0,12),()=>assert.deepEqual(parseMediaReply(body),{content:body,intent:{}}));
}
test('malformed metadata preserves text and a metadata-only reply is rejected',async t=>{
  const {media}=local(t);assert.deepEqual(parseMediaReply('正文\n<qiyi-media>invalid</qiyi-media>'),{content:'正文',intent:{}});
  await assert.rejects(media.resolve('<qiyi-media>{"stickerId":"leaf-hug"}</qiyi-media>',media.candidates('')),errorStatus(502));
});

test('music local-first search uses fixed source endpoints and keeps keys server side',async t=>{
  const {media,calls}=local(t,{response:url=>url.pathname.endsWith('/library')?json({files:[{name:'tea.mp3',title:'tea time',singer:'artist',duration:100,has_cover:true}]}):json({songs:[{songmid:'song001',songname:'other song',singer:'band'}]})});
  media.update({musicBaseUrl:'http://music.invalid',musicApiKey:'credential'});
  const localResult=await media.music.search('tea');assert.equal(localResult.songs[0].kind,'local');assert.equal(calls.length,1);
  assert.equal(calls[0].init.headers['X-API-Key'],'credential');assert.ok(!calls[0].url.href.includes('credential'));
  const remote=await media.music.search('other','netease');assert.equal(remote.songs[0].source,'netease');assert.equal(calls[2].url.searchParams.get('source'),'netease');
  assert.equal(calls[2].url.pathname,'/api/search');assert.ok(!JSON.stringify(remote).includes('credential'));
  assert.equal(media.music.get(localResult.songs[0].id).name,'tea.mp3');
  media.update({musicBaseUrl:'http://changed.invalid'});assert.throws(()=>media.music.get(localResult.songs[0].id),errorStatus(409));
});

test('unsafe source identifiers are discarded and API failures do not break a reply',async t=>{
  const {media}=local(t,{response:url=>url.pathname.endsWith('/library')?json({files:[{name:'../cookie.txt',title:'bad'}]}):json({songs:[{songmid:'../../bad',songname:'bad'}]})});
  media.update({musicBaseUrl:'http://music.invalid'});assert.equal((await media.music.search('anything')).songs.length,0);
  const result=await media.resolve('正文\n<qiyi-media>{"songQuery":"anything"}</qiyi-media>',[]);assert.equal(result.attachments[0].type,'song-search');
});

test('media service errors are sanitized and a configured music failure preserves reply text',async t=>{
  const {media}=local(t,{response:()=>{throw new Error('secret-cookie-address');}});media.update({musicBaseUrl:'http://music.invalid'});
  const result=await media.resolve('正文\n<qiyi-media>{"songQuery":"song"}</qiyi-media>',[]);
  assert.equal(result.content,'正文');assert.equal(result.attachments[0].type,'song-search');assert.ok(!JSON.stringify(result).includes('secret'));
});

test('switching music service mid-search cannot register songs against the wrong service',async t=>{
  const wait=deferred();const {media}=local(t,{response:()=>wait.promise});media.update({musicBaseUrl:'http://first.invalid'});
  const pending=media.music.search('tea');media.update({musicBaseUrl:'http://second.invalid'});wait.resolve(json({files:[{name:'tea.mp3',title:'tea'}]}));
  await assert.rejects(pending,errorStatus(409));
});

test('chat persists attachments and excludes protocol from the next model history',async t=>{
  const {api,store,personaId,calls}=fixture(t,['好耶！\n<qiyi-media>{"stickerId":"leaf-cheer","songQuery":"安静的歌"}</qiyi-media>','第二次回复']);
  const id=addConversation(api,personaId);const first=await api.sendMessage(id,{content:'庆祝一下，请推荐一首歌并发表情'});
  assert.equal(first.message.content,'好耶！');assert.equal(first.message.attachments.length,2);
  assert.deepEqual(api.getConversation(id).messages[1].attachments,first.message.attachments);
  assert.equal(store.get('SELECT content FROM messages WHERE role=?','assistant').content,'好耶！');
  await api.sendMessage(id,{content:'继续'});assert.equal(calls[1].body.messages.at(-2).content,'好耶！');
  assert.deepEqual(first.userMessage.attachments,[]);
});

test('recent stickers are withheld from the next chat candidates to avoid repeated images',async t=>{
  const reply='开心！\n<qiyi-media>{"stickerId":"leaf-cheer"}</qiyi-media>';
  const {api,personaId,calls}=fixture(t,[reply,reply]);const id=addConversation(api,personaId);
  assert.equal((await api.sendMessage(id,{content:'庆祝'})).message.attachments.length,1);
  assert.equal((await api.sendMessage(id,{content:'继续'})).message.attachments.length,0);
  assert.ok(!calls[1].body.messages[0].content.includes('"id":"leaf-cheer"'));
});

test('old SQLite messages migrate without losing content and media state persists across restart',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'qiyi-media-migration-'));const path=join(directory,'old.sqlite');
  try{
    const old=new DatabaseSync(path);old.exec("CREATE TABLE messages (id INTEGER PRIMARY KEY,conversationId TEXT,role TEXT,content TEXT,sources TEXT DEFAULT '[]',recalledMemories TEXT DEFAULT '[]',createdAt TEXT);INSERT INTO messages (id,role,content) VALUES (1,'assistant','旧消息')");old.close();
    const store=createStore(path);const media=createMedia(store,{musicApiKey:'',stickerApiKey:''});
    assert.equal(store.get('SELECT * FROM messages WHERE id=1').content,'旧消息');assert.deepEqual(store.get('SELECT * FROM messages WHERE id=1').attachments,[]);
    media.upload({name:'restart',tags:'test',data:PNG.toString('base64')});media.update({musicSource:'netease',musicApiKey:'ephemeral'});store.close();
    const reopened=createStore(path);const second=createMedia(reopened,{musicApiKey:'',stickerApiKey:''});assert.equal(second.list().length,7);assert.equal(second.settings().musicSource,'netease');assert.equal(second.bootstrap().settings.hasMusicApiKey,false);reopened.close();
  }finally{for(const suffix of ['','-wal','-shm'])await unlink(path+suffix).catch(()=>{});await rmdir(directory);}
});
