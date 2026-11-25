import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PET_CLIPS, PET_CLIP_LAYOUT, petClipFrame, petClipSprite, petClipDuration, petClipAction } from '../public/pet-clips.js';
import { startServer } from '../server.mjs';

test('full-body timelines visit every authored pose and finish once without sticking on the last frame',()=>{
  for(const kind of [...Object.keys(PET_CLIPS),'hop','celebrate']){
    const seen=new Set();
    for(let i=0;i<1000;i++){
      const frame=petClipFrame(kind,i/1000);assert.ok(frame);seen.add(frame.column);
      assert.ok(frame.opacity>=0&&frame.opacity<=1);assert.ok(frame.row>=0&&frame.row<4);
    }
    assert.deepEqual([...seen].sort((a,b)=>a-b),Array.from({length:24},(_,i)=>i));
    assert.equal(petClipFrame(kind,0).column,0);assert.equal(petClipFrame(kind,.999).column,23);
    assert.equal(petClipFrame(kind,0).opacity,0);assert.equal(petClipFrame(kind,.5).opacity,1);
    for(const progress of [-1,1,2,NaN,Infinity])assert.equal(petClipFrame(kind,progress),null);
  }
  for(const kind of ['pet','ears','tail','music','comfort',undefined,'__proto__'])assert.equal(petClipFrame(kind,.5),null);
});

test('a small hop has one takeoff, while play contains two and returns to the same resting pose',()=>{
  const flights=kind=>{
    let count=0,previous=-1;
    for(let i=0;i<1000;i++){const col=petClipFrame(kind,i/1000).column;if(col===13&&previous!==13)count++;previous=col;}
    return count;
  };
  assert.equal(flights('hop'),1);assert.equal(flights('celebrate'),1);assert.equal(flights('play'),2);
});

test('pose changes use a short animation cadence independently of caption timing',()=>{
  for(const kind of [...Object.keys(PET_CLIPS),'hop','celebrate']){
    const duration=petClipDuration(kind);assert.ok(duration>=800&&duration<=1600);
    let previous=petClipFrame(kind,0).column,start=0;
    for(let time=1;time<=duration;time++){
      const next=petClipFrame(kind,time/duration)?.column;
      if(next!==previous){assert.ok(time-start<=51,kind+' has a long accidental pose hold');previous=next;start=time;}
    }
  }
});

test('continuous weight shifts preserve a single silhouette and settle at the endpoints',()=>{
  for(const kind of Object.keys(PET_CLIPS)){
    let changes=0,last=petClipFrame(kind,.3);
    for(let i=301;i<700;i++){
      const next=petClipFrame(kind,i/1000);assert.ok(Math.abs(next.angle)<=.0121);assert.ok(Math.abs(next.scaleY)<=.0181);
      if(last.angle!==next.angle||last.scaleY!==next.scaleY)changes++;last=next;
    }
    assert.ok(changes>350);assert.equal(petClipFrame(kind,0).angle,0);assert.equal(petClipFrame(kind,0).scaleY,0);
  }
});

test('sixteen dense action atlases have transparent WebP headers, bounded weight, and explicit cached HTTP paths',async t=>{
  const app=await startServer({port:0,dbPath:':memory:',scheduler:false});t.after(()=>app.close());
  for(const id of ['cream-cat','shiba','lop-rabbit','little-fox'])for(const action of Object.keys(PET_CLIPS)){
    const path=petClipSprite(id,action),bytes=await readFile(new URL('../public'+path,import.meta.url));
    assert.equal(bytes.subarray(8,12).toString(),'WEBP');assert.equal(bytes.subarray(12,16).toString(),'VP8X');
    assert.ok(bytes[20]&0x10,'alpha channel must be present');
    assert.equal(1+bytes.readUIntLE(24,3),PET_CLIP_LAYOUT.columns*PET_CLIP_LAYOUT.size);
    assert.equal(1+bytes.readUIntLE(27,3),PET_CLIP_LAYOUT.rows*PET_CLIP_LAYOUT.size);
    assert.ok(bytes.length<700_000,`${id}/${action} atlas should remain below 700 KB`);
    const response=await fetch(app.url+path);assert.equal(response.status,200);
    assert.equal(response.headers.get('content-type'),'image/webp');assert.match(response.headers.get('cache-control'),/immutable/);
    assert.equal((await(await fetch(app.url+path,{method:'HEAD'})).arrayBuffer()).byteLength,0);
  }
  assert.equal((await fetch(app.url+'/pet-clips.js')).status,200);
  assert.equal((await fetch(app.url+'/assets/pets/unknown-actions-v3.webp')).status,404);
  assert.equal((await fetch(app.url+'/assets/pets/cream-cat-unknown-v4.webp')).status,404);
});

test('pose indices span a chronological 6x4 sheet and single hops share the play asset',()=>{
  for(const kind of [...Object.keys(PET_CLIPS),'hop','celebrate'])for(let index=0;index<24;index++){
    const progress=(index+.25)/24/(kind==='play'?2:1),frame=petClipFrame(kind,progress);
    assert.equal(frame.column,index);assert.equal(frame.spriteColumn,index%6);assert.equal(frame.spriteRow,Math.floor(index/6));assert.equal(frame.size,256);
  }
  assert.equal(petClipAction('hop'),'play');assert.equal(petClipAction('celebrate'),'play');
  assert.equal(petClipAction('__proto__'),null);assert.equal(petClipDuration('__proto__'),0);
  assert.equal(petClipAction('ears'),null);
});
