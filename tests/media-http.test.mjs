import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../server.mjs';
import { mockMediaFetch, PNG } from './media-fixtures.mjs';

async function appFixture(t,mediaFetchImpl=mockMediaFetch) {
  const app=await startServer({port:0,dbPath:':memory:',scheduler:false,modelOptions:{musicApiKey:'',stickerApiKey:'',mediaFetchImpl}});
  t.after(()=>app.close());
  const get=async(path,options)=>{const response=await fetch(app.url+path,options);return response;};
  const put=async(path,value)=>get(path,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(value)});
  return {app,get,put};
}

test('media HTTP bootstrap is offline by default, settings hide credentials, and local images are served',async t=>{
  let calls=0;const {app,get,put}=await appFixture(t,async(...args)=>{calls++;return mockMediaFetch(...args);});
  const bootstrap=await(await get('/api/bootstrap')).json();assert.equal(bootstrap.media.settings.musicBaseUrl,'');assert.equal(bootstrap.media.stickers.length,6);
  const blank=await(await get('/api/music/status')).json();assert.equal(blank.configured,false);assert.equal(calls,0);
  assert.equal((await get('/api/music/search?q=anything')).status,503);assert.equal(calls,0);
  const updated=await(await put('/api/media/settings',{musicBaseUrl:'http://music-fixture.invalid',musicApiKey:'hidden'})).json();assert.equal(updated.settings.hasMusicApiKey,true);assert.ok(!JSON.stringify(updated).includes('hidden'));
  const image=await get('/api/media/sticker-image?id=leaf-cheer');assert.equal(image.headers.get('content-type'),'image/svg+xml');assert.match(await image.text(),/好耶/);
  const head=await get('/api/media/sticker-image?id=leaf-cheer',{method:'HEAD'});assert.equal((await head.arrayBuffer()).byteLength,0);
  const status=await(await get('/api/music/status')).json();assert.equal(status.configured,true);assert.ok(!JSON.stringify(status).includes('musicid'));
  assert.equal(app.api.media.settings().musicBaseUrl,'http://music-fixture.invalid');
});

test('audio proxy passes ranges and status, keeps the key in a header and validates known songs',async t=>{
  const calls=[];const {get,put}=await appFixture(t,(url,init)=>{calls.push({url:new URL(url),init});return mockMediaFetch(url,init);});
  await put('/api/media/settings',{musicBaseUrl:'http://music-fixture.invalid',musicApiKey:'server-key'});
  const data=await(await get('/api/music/search')).json();const id=data.songs[0].id;
  const stream=await get(`/api/music/stream?id=${id}`,{headers:{Range:'bytes=0-1023'}});
  assert.equal(stream.status,206);assert.equal(stream.headers.get('content-type'),'audio/wav');assert.equal(stream.headers.get('content-range'),'bytes 0-1023/320044');assert.equal((await stream.arrayBuffer()).byteLength,1024);
  const call=calls.at(-1);assert.equal(call.url.pathname,'/api/local_play');assert.equal(call.init.headers['X-API-Key'],'server-key');assert.equal(call.init.headers.Range,'bytes=0-1023');assert.ok(!call.url.href.includes('server-key'));
  const head=await get(`/api/music/stream?id=${id}`,{method:'HEAD'});assert.equal(head.status,200);assert.equal((await head.arrayBuffer()).byteLength,0);
  const invalid=await get(`/api/music/stream?id=${id}`,{headers:{Range:'bytes=9999999-'}});assert.equal(invalid.status,416);assert.equal(invalid.headers.get('content-range'),'bytes */320044');await invalid.arrayBuffer();
  assert.equal((await get('/api/music/stream?id=../cookie.txt')).status,400);
  assert.equal((await get('/api/music/search?source=other')).status,400);
  assert.equal((await get(`/api/music/stream?id=${'a'.repeat(64)}`)).status,404);
  await put('/api/media/settings',{musicBaseUrl:''});assert.equal((await get(`/api/music/stream?id=${id}`)).status,409);
});

test('uploaded and remote sticker HTTP routes enforce image types and configured origins',async t=>{
  const {get,put}=await appFixture(t);
  const uploaded=await(await get('/api/media/stickers',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'测试图片',tags:'test',data:PNG.toString('base64')})})).json();
  const id=uploaded.sticker.id;const image=await get(`/api/media/sticker-image?id=${id}`);assert.equal(image.headers.get('content-type'),'image/png');assert.deepEqual(Buffer.from(await image.arrayBuffer()),PNG);
  assert.equal((await get(`/api/media/stickers/${id}`,{method:'DELETE',headers:{'content-type':'application/json'},body:'{}'})).status,200);
  assert.equal((await get(`/api/media/sticker-image?id=${id}`)).status,404);
  assert.equal((await put('/api/media/settings',{stickerSearchUrl:'javascript:bad'})).status,400);
});

test('closing the browser audio response cancels upstream streaming',async t=>{
  let cancelled=false,signal;
  const {get,put}=await appFixture(t,(url,init)=>{
    if(new URL(url).pathname==='/api/local_play'){
      signal=init.signal;
      return Promise.resolve(new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(64));},cancel(){cancelled=true;}}),{headers:{'content-type':'audio/mpeg'}}));
    }
    return mockMediaFetch(url,init);
  });
  await put('/api/media/settings',{musicBaseUrl:'http://music-fixture.invalid'});
  const data=await(await get('/api/music/search')).json();const stream=await get(`/api/music/stream?id=${data.songs[0].id}`);
  const reader=stream.body.getReader();await reader.read();await reader.cancel();
  for(let i=0;i<20&&!cancelled;i++)await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(cancelled,true);assert.equal(signal.aborted,true);
});
