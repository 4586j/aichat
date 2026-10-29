export const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=','base64');

export function gallerySticker(origin='https://stickers.invalid',overrides={}) {
  const hash='a'.repeat(64);
  return {id:`stk_${hash}`,name:'害羞小猫',meaning:'温柔地表达害羞和亲近',description:'小猫捂着脸',tags:['害羞','可爱'],emotions:['affection'],scenes:['general'],excludedContexts:['grief'],examples:['轻松聊天时表达害羞'],intensity:1,url:`${origin}/api/v1/images/${hash}`,alt:'害羞小猫：温柔地表达害羞和亲近',mime:'image/png',width:1,height:1,sizeBytes:PNG.length,animated:false,revision:1,updatedAt:'2026-10-29T00:00:00.000Z',score:2,...overrides};
}

// Silent PCM, long enough to check navigation and seeking without contacting an audio host.
export function silentWave(seconds=20) {
  const rate=8000,length=rate*2*seconds,b=Buffer.alloc(44+length);
  b.write('RIFF',0);b.writeUInt32LE(36+length,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);
  b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*2,28);
  b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(length,40);return b;
}
const json=data=>new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}});
export function mockMediaFetch(url,init={}) {
  url=new URL(url);
  if(url.origin==='http://stickers-fixture.invalid') {
    if(!['Bearer fixture-sticker-key','Bearer fixture-sticker-key-rotated'].includes(init.headers?.Authorization))return Promise.resolve(new Response(null,{status:401}));
    if(url.pathname==='/api/v1/stickers/search')return Promise.resolve(json({stickers:[gallerySticker(url.origin)]}));
    return Promise.resolve(new Response(init.method==='HEAD'?null:PNG,{headers:{'content-type':'image/png','content-length':String(PNG.length)}}));
  }
  if(url.origin!=='http://music-fixture.invalid')return Promise.reject(new Error('Unexpected fixture host'));
  if(url.pathname==='/api/status')return Promise.resolve(json({auth:true,sources:[{key:'qq',name:'QQ 音乐',logged_in:true},{key:'netease',name:'网易云',logged_in:false}]}));
  if(url.pathname==='/api/library')return Promise.resolve(json({count:1,files:[{name:'安静片刻.wav',title:'安静片刻',singer:'离线测试音源',album:'本地音乐',duration:20,has_cover:false}]}));
  if(url.pathname==='/api/search')return Promise.resolve(json({songs:[{songmid:'offline-song-01',songname:'晚风练习',singer:'离线乐队',album:'测试唱片',duration:20}]}));
  if(['/api/stream','/api/local_play'].includes(url.pathname)) {
    const b=silentWave();const range=init.headers?.Range;
    if(range){const parts=/^bytes=(\d*)-(\d*)$/u.exec(range);let start=0,end=b.length-1;if(parts?.[1]){start=Number(parts[1]);if(parts[2])end=Math.min(Number(parts[2]),end);}else if(parts?.[2])start=Math.max(0,b.length-Number(parts[2]));if(start>=b.length||end<start)return Promise.resolve(new Response(null,{status:416,headers:{'content-range':`bytes */${b.length}`}}));const slice=b.subarray(start,end+1);return Promise.resolve(new Response(slice,{status:206,headers:{'content-type':'audio/wav','content-length':String(slice.length),'content-range':`bytes ${start}-${end}/${b.length}`,'accept-ranges':'bytes'}}));}
    return Promise.resolve(new Response(b,{headers:{'content-type':'audio/wav','content-length':String(b.length),'accept-ranges':'bytes'}}));
  }
  return Promise.resolve(json({error:'not found'}));
}
