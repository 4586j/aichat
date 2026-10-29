import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PET_FACES, PET_ACTIONS, PET_MOTION_PROFILES, PetBlink, PetGestures, petPresentation, petSprite, petVertex, petRoot } from '../public/pet-motion.js';
import { startServer } from '../server.mjs';

test('current need wins over music and reply; direct interaction temporarily wins over the need', () => {
  for (const [scene, face, motion] of [['rest','sleepy','rest'],['comfort','warm','comfort'],['focus','focused','focus']]) {
    assert.deepEqual(petPresentation({scene,music:true,chatting:true,reaction:'reply'}),{face,motion,phase:scene === 'rest' ? 'quiet' : scene});
    for (const reaction of ['pet','feed','play']) assert.equal(petPresentation({scene,music:true,reaction}).face,'happy');
    assert.equal(petPresentation({scene}).face,face,'ending an interaction restores the current need');
  }
  assert.equal(petPresentation({scene:'celebrate'}).face,'natural','celebration does not smile indefinitely');
  assert.equal(petPresentation({scene:'celebrate',reaction:'reply'}).face,'happy');
  assert.equal(petPresentation({chatting:true,music:true}).face,'focused');
  assert.equal(petPresentation({music:true}).motion,'music');
  assert.equal(petPresentation({reaction:'error'}).face,'warm');
  assert.equal(petPresentation({scene:'rest',animations:false}).face,'sleepy','motion preference retains static expression');
  assert.equal(petPresentation({reaction:'play',animations:false}).phase,'quiet');
});

test('blink holds open between cycles, traverses both transition frames, and returns open after a long gap', () => {
  const blink=new PetBlink(() => .5);
  assert.equal(blink.frame(5999,'natural'),'open');
  assert.equal(blink.frame(6000,'natural'),'half');
  assert.equal(blink.frame(6050,'natural'),'closed');
  assert.equal(blink.frame(6150,'natural'),'half');
  assert.equal(blink.frame(6230,'natural'),'open');
  assert.equal(blink.frame(12229,'natural'),'open');
  assert.equal(blink.frame(12230,'natural'),'half');
  assert.equal(blink.frame(20000,'natural'),'open');
  blink.reset(20000); assert.equal(blink.frame(25000,'sleepy'),'open');
  assert.equal(blink.frame(26000,'sleepy'),'half');
  assert.equal(blink.frame(26070,'happy'),'open','smiling closed eyes do not blink again');
});

test('occasional double blink has a pause and cannot become an endless repeat', () => {
  const blink=new PetBlink(() => 0);
  assert.equal(blink.frame(4000,'natural'),'half');
  assert.equal(blink.frame(4230,'natural'),'open');
  assert.equal(blink.frame(4379,'natural'),'open');
  assert.equal(blink.frame(4380,'natural'),'half');
  assert.equal(blink.frame(4460,'natural'),'closed');
  assert.equal(blink.frame(4610,'natural'),'open');
  assert.ok(blink.next > 4610 + 1000,'double blink resets the long random interval');
});

test('local motions preserve planted feet and borders, stop in rest, and have bounded displacement', () => {
  for (const id of Object.keys(PET_MOTION_PROFILES)) for (const motion of ['idle','pet','feed','play','music','comfort','focus']) {
    const config={id,time:1700,motion,gesture:'ears',gestureProgress:.4,actionProgress:.5};
    for (const [x,y] of [[0,.5],[1,.5],[.5,0],[.5,1],[.3,1],[.7,1]]) assert.deepEqual(petVertex(x,y,config),[x,y]);
    for (let x=.1;x<1;x+=.1) for (let y=.1;y<1;y+=.1) {
      const [u,v]=petVertex(x,y,config); assert.ok(Number.isFinite(u) && Number.isFinite(v)); assert.ok(Math.hypot(u-x,v-y)<.07);
      assert.deepEqual(petVertex(x,y,{...config,motion:'rest'}),[x,y]);
      assert.deepEqual(petVertex(x,y,{...config,motion:'still'}),[x,y]);
    }
  }
});

test('larger actions keep every mesh triangle facing forward through the complete motion',()=>{
  const area=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(c[0]-a[0])*(b[1]-a[1]);
  for(const id of Object.keys(PET_MOTION_PROFILES))for(const motion of Object.keys(PET_ACTIONS))for(let phase=0;phase<=20;phase++){
    const points=[],config={id,time:1300,motion,actionProgress:phase/20};
    for(let y=0;y<=10;y++)for(let x=0;x<=10;x++){
      const point=petVertex(x/10,y/10,config);points.push(point);assert.ok(Math.hypot(point[0]-x/10,point[1]-y/10)<.07);
    }
    for(let y=0;y<10;y++)for(let x=0;x<10;x++){
      const a=y*11+x,b=a+1,c=a+11,d=c+1;
      assert.ok(area(points[a],points[b],points[c])>.003,`${id}/${motion}: upper triangle must not fold`);
      assert.ok(area(points[d],points[c],points[b])>.003,`${id}/${motion}: lower triangle must not fold`);
    }
  }
});

test('idle actions start soon, cover the whole pet-specific bag without repetition, and suspend without a backlog',()=>{
  for(const id of Object.keys(PET_MOTION_PROFILES)){
    const gestures=new PetGestures(()=>.5);gestures.reset(id,0);
    assert.equal(gestures.frame(1199,true),null);let time=1200,last='',seen=[];
    for(let i=0;i<PET_MOTION_PROFILES[id].gestures.length*2;i++){
      const current=gestures.frame(time,true);assert.ok(current);assert.notEqual(current.kind,last);seen.push(current.kind);last=current.kind;
      assert.equal(current.progress,0);time+=PET_ACTIONS[current.kind].duration;
      assert.equal(gestures.frame(time,true),null);assert.ok(gestures.next-time>=2000 && gestures.next-time<=5000);time=gestures.next;
    }
    const count=PET_MOTION_PROFILES[id].gestures.length;
    assert.equal(new Set(seen.slice(0,count)).size,count);assert.equal(new Set(seen.slice(count)).size,count);
    gestures.frame(time,true);assert.equal(gestures.frame(time+100,false),null);assert.equal(gestures.frame(time+90000,true),null);
    const resumed=gestures.frame(gestures.next,true);assert.equal(resumed.progress,0);
  }
});

test('paw waves, stretches, head turns, ear movements and tail swishes have visibly different local poses',()=>{
  for(const [id,profile] of Object.entries(PET_MOTION_PROFILES)){
    const common={id,time:0,motion:'idle',gestureProgress:.36};
    const [px,py]=profile.paws[0], paw=petVertex(px,py,{...common,gesture:'wave',gestureProgress:.5});
    assert.ok(py-paw[1]>.045,'a raised paw moves at least 9px on a 200px portrait');
    const stretch=petVertex(.48,.35,{...common,gesture:'stretch',gestureProgress:.5});assert.ok(.35-stretch[1]>.02);
    const look=petVertex(.32,.35,{...common,gesture:'look',gestureProgress:.25});assert.ok(Math.hypot(look[0]-.32,look[1]-.35)>.01);
    const [ex,ey]=profile.ears[0], ear=petVertex(ex,ey,{...common,gesture:'ears'});assert.ok(Math.abs(ear[0]-ex)>.02);
    if(profile.tail){const[tx,ty]=profile.tail,tail=petVertex(tx,ty,{...common,gesture:'tail'});assert.ok(Math.abs(tail[0]-tx)>.02);}
  }
});

test('hops include anticipation, flight, landing and return to neutral; preview actions still obey quiet preference',()=>{
  assert.ok(petRoot({motion:'hop',actionProgress:.1}).squash>0);assert.ok(petRoot({motion:'hop',actionProgress:.45}).lift>.025);
  assert.ok(petRoot({motion:'hop',actionProgress:.85}).squash>0);
  for(const motion of ['hop','play','pet','celebrate'])for(const actionProgress of [0,1])assert.deepEqual(petRoot({motion,actionProgress}),{lift:0,squash:0,lean:0});
  assert.ok(petRoot({motion:'play',actionProgress:.23}).lift>petRoot({motion:'play',actionProgress:.73}).lift);
  assert.equal(petPresentation({scene:'rest',reaction:'wave'}).motion,'wave');assert.equal(petPresentation({scene:'rest',reaction:'wave',animations:false}).phase,'quiet');
  assert.equal(petPresentation({scene:'rest',reaction:'',music:true}).motion,'rest');
});

test('all four registered sprite strips are local, small, cacheable, and safely served with WebP MIME', async t => {
  assert.equal(Object.keys(PET_FACES).length,5);
  const app=await startServer({port:0,dbPath:':memory:',scheduler:false}); t.after(() => app.close());
  for (const id of Object.keys(PET_MOTION_PROFILES)) {
    const bytes=await readFile(new URL('../public'+petSprite(id),import.meta.url));
    assert.equal(bytes.subarray(8,12).toString(),'WEBP'); assert.ok(bytes.length<200_000);
    const response=await fetch(app.url+petSprite(id)); assert.equal(response.status,200);
    assert.equal(response.headers.get('content-type'),'image/webp'); assert.match(response.headers.get('cache-control'),/immutable/);
    const head=await fetch(app.url+petSprite(id),{method:'HEAD'}); assert.equal((await head.arrayBuffer()).byteLength,0);
  }
  assert.equal((await fetch(app.url+'/assets/pets/other-expressions-v2.webp')).status,404);
});
