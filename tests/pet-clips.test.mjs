import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PET_CLIPS, PET_CLIP_LAYOUT, petClipFrame, petClipSprite, petClipDuration } from '../public/pet-clips.js';
import { startServer } from '../server.mjs';

test('full-body timelines visit every authored pose and finish once without sticking on the last frame',()=>{
  for(const kind of [...Object.keys(PET_CLIPS),'hop','celebrate']){
    const seen=new Set();
    for(let i=0;i<1000;i++){
      const frame=petClipFrame(kind,i/1000);assert.ok(frame);seen.add(frame.column);
      assert.ok(frame.opacity>=0&&frame.opacity<=1);assert.ok(frame.row>=0&&frame.row<4);
    }
    assert.deepEqual([...seen].sort(),[0,1,2,3,4,5]);
    assert.equal(petClipFrame(kind,0).column,0);assert.equal(petClipFrame(kind,.999).column,5);
    assert.equal(petClipFrame(kind,0).opacity,0);assert.equal(petClipFrame(kind,.5).opacity,1);
    for(const progress of [-1,1,2,NaN,Infinity])assert.equal(petClipFrame(kind,progress),null);
  }
  for(const kind of ['pet','ears','tail','music','comfort',undefined,'__proto__'])assert.equal(petClipFrame(kind,.5),null);
});

test('a small hop has one takeoff, while play contains two and returns to the same resting pose',()=>{
  const flights=kind=>{
    let count=0,previous=-1;
    for(let i=0;i<1000;i++){const col=petClipFrame(kind,i/1000).column;if(col===3&&previous!==3)count++;previous=col;}
    return count;
  };
  assert.equal(flights('hop'),1);assert.equal(flights('celebrate'),1);assert.equal(flights('play'),2);
});

test('pose changes use a short animation cadence independently of caption timing',()=>{
  for(const kind of [...Object.keys(PET_CLIPS),'hop','celebrate']){
    const duration=petClipDuration(kind);assert.ok(duration>=400&&duration<=1500);
    let previous=petClipFrame(kind,0).column,start=0;
    for(let time=1;time<=duration;time++){
      const next=petClipFrame(kind,time/duration)?.column;
      if(next!==previous){assert.ok(time-start<=(kind==='stretch'&&previous===3?430:110),kind+' has a long accidental pose hold');previous=next;start=time;}
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

test('all four full-body atlases have transparent WebP headers, bounded weight, and explicit cached HTTP paths',async t=>{
  const app=await startServer({port:0,dbPath:':memory:',scheduler:false});t.after(()=>app.close());
  for(const id of ['cream-cat','shiba','lop-rabbit','little-fox']){
    const path=petClipSprite(id),bytes=await readFile(new URL('../public'+path,import.meta.url));
    assert.equal(bytes.subarray(8,12).toString(),'WEBP');assert.equal(bytes.subarray(12,16).toString(),'VP8X');
    assert.ok(bytes[20]&0x10,'alpha channel must be present');
    assert.equal(1+bytes.readUIntLE(24,3),PET_CLIP_LAYOUT.columns*PET_CLIP_LAYOUT.size);
    assert.equal(1+bytes.readUIntLE(27,3),PET_CLIP_LAYOUT.rows*PET_CLIP_LAYOUT.size);
    assert.ok(bytes.length<850_000,`${id} atlas should remain below 850 KB`);
    const response=await fetch(app.url+path);assert.equal(response.status,200);
    assert.equal(response.headers.get('content-type'),'image/webp');assert.match(response.headers.get('cache-control'),/immutable/);
    assert.equal((await(await fetch(app.url+path,{method:'HEAD'})).arrayBuffer()).byteLength,0);
  }
  assert.equal((await fetch(app.url+'/pet-clips.js')).status,200);
  assert.equal((await fetch(app.url+'/assets/pets/unknown-actions-v3.webp')).status,404);
});
