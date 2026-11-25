import { test, expect } from './ui-test.mjs';
import { PET_CLIPS, PET_CLIP_LAYOUT } from '../public/pet-clips.js';

for (const id of ['cream-cat','shiba','lop-rabbit','little-fox']) test(`${id} has distinct in-between poses with smaller adjacent image changes`, async ({ page }, info) => {
  await page.route('**/pet-density-fixture', route => route.fulfill({ contentType:'text/html', body:'<!doctype html><title>Pose analysis</title>' }));
  await page.goto('/pet-density-fixture');
  const measured = await page.evaluate(async ({ id, actions, size }) => {
    const bitmap = async url => createImageBitmap(await (await fetch(url)).blob());
    const old = await bitmap(`/assets/pets/${id}-actions-v3.webp`), canvas = document.createElement('canvas');
    canvas.width = canvas.height = size; const ctx = canvas.getContext('2d', { willReadFrequently:true });
    function pixels(image, x, y, edge) {
      ctx.clearRect(0,0,size,size); ctx.drawImage(image,x*edge,y*edge,edge,edge,0,0,size,size);
      return ctx.getImageData(0,0,size,size).data;
    }
    function summarize(frames) {
      const hashes = new Set(), changes = [];
      for (let index=0;index<frames.length;index++) {
        const data=frames[index]; let hash=2166136261;
        for(let p=0;p<data.length;p+=16) for(let c=0;c<4;c++) hash=Math.imul(hash^data[p+c],16777619);
        hashes.add(hash);
        if(!index)continue;
        const previous=frames[index-1]; let delta=0;
        // Compare premultiplied color on a neutral matte, including silhouette movement.
        for(let p=0;p<data.length;p+=4) for(let c=0;c<3;c++)
          delta+=Math.abs((data[p+c]-127)*data[p+3]/255-(previous[p+c]-127)*previous[p+3]/255);
        changes.push(delta/(size*size*3));
      }
      return { unique:hashes.size, mean:changes.reduce((a,b)=>a+b,0)/changes.length, maximum:Math.max(...changes) };
    }
    const result=[];
    for(const [action, row] of actions) {
      const image = await bitmap(`/assets/pets/${id}-${action}-v4.webp`);
      result.push({action,old:summarize(Array.from({length:6},(_,i)=>pixels(old,i,row,384))),
        dense:summarize(Array.from({length:24},(_,i)=>pixels(image,i%6,Math.floor(i/6),size)))});
      image.close();
    }
    old.close(); return result;
  }, { id, actions:Object.entries(PET_CLIPS).map(([action,clip])=>[action,clip.row]), size:PET_CLIP_LAYOUT.size });
  for(const {action,old,dense} of measured) {
    expect(dense.unique,`${action} needs actual distinct poses`).toBeGreaterThanOrEqual(20);
    expect(dense.mean,`${action} still has large frame-to-frame jumps`).toBeLessThan(old.mean*.85);
  }
  await info.attach('pose-continuity', { body:JSON.stringify(measured,null,2), contentType:'application/json' });
});

test('a late wave preload cannot restart a different action already in progress', async ({ page }) => {
  await page.clock.install({time:new Date('2026-11-05T08:00:00Z')});
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.addInitScript(()=>{
    const makeBitmap=window.createImageBitmap.bind(window);window.readyBitmaps=0;
    window.createImageBitmap=async(...args)=>{const bitmap=await makeBitmap(...args);window.readyBitmaps++;return bitmap;};
  });
  let release,seen;const gate=new Promise(resolve=>{release=resolve;}),observed=new Promise(resolve=>{seen=resolve;});
  await page.route('**/cream-cat-wave-v4.webp',async route=>{seen();await gate;await route.continue();});
  await page.route('**/pet-preload-fixture',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><link rel="stylesheet" href="/pets.css"><span id="portrait" class="pet-portrait" data-pet-portrait><img src="/assets/pets/cream-cat-v1.png" alt="团团"></span><script type="module">import {createPetMotion} from "/pet-motion.js";window.pet=createPetMotion();window.pet.update({id:"cream-cat",animations:true});</script>'}));
  try {
    await page.goto('/pet-preload-fixture');await observed;
    await expect(page.locator('#portrait')).toHaveAttribute('data-pet-renderer','canvas');
    await page.clock.pauseAt(new Date('2026-11-05T08:00:02Z'));
    await page.evaluate(()=>window.pet.update({id:'cream-cat',animations:true,reaction:'feed',reactionKey:1}));
    await expect(page.locator('#portrait')).toHaveAttribute('data-pet-clip','feed');
    await page.clock.runFor(350);
    const before=await page.locator('#portrait').getAttribute('data-pet-clip-frame');
    expect(Number(before.split(':')[1])).toBeGreaterThan(4);
    const finished=page.waitForResponse('**/cream-cat-wave-v4.webp');release();await finished;
    await expect.poll(()=>page.evaluate(()=>window.readyBitmaps)).toBe(2);
    // Wait for decode/refresh without advancing the animation clock.
    await expect.poll(()=>page.locator('#portrait').getAttribute('data-pet-clip-frame')).toBe(before);
    await page.clock.runFor(32);
    expect(Number((await page.locator('#portrait').getAttribute('data-pet-clip-frame')).split(':')[1])).toBeGreaterThanOrEqual(Number(before.split(':')[1]));
  } finally {release();}
});

test('visiting many actions bounds decoded bitmap memory and releases it on destroy', async ({ page }) => {
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.addInitScript(()=>{
    const makeBitmap=window.createImageBitmap.bind(window),close=ImageBitmap.prototype.close;
    window.bodyBitmaps=new Set();window.bitmapCount=0;
    window.createImageBitmap=async(...args)=>{const bitmap=await makeBitmap(...args);window.bodyBitmaps.add(bitmap);window.bitmapCount++;return bitmap;};
    ImageBitmap.prototype.close=function(){window.bodyBitmaps.delete(this);return close.call(this);};
  });
  await page.route('**/pet-memory-fixture',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><link rel="stylesheet" href="/pets.css"><span id="portrait" class="pet-portrait" data-pet-portrait><img src="/assets/pets/cream-cat-v1.png" alt="团团"></span><script type="module">import {createPetMotion} from "/pet-motion.js";window.pet=createPetMotion();window.pet.update({id:"cream-cat",animations:false});</script>'}));
  await page.goto('/pet-memory-fixture');await expect(page.locator('#portrait')).toHaveAttribute('data-pet-renderer','canvas');
  for(const id of ['cream-cat','shiba','lop-rabbit','little-fox'])for(const reaction of ['wave','stretch','feed']){
    await page.evaluate(next=>window.pet.update(next),{id,reaction,animations:true,reactionKey:Math.random()});
    await expect(page.locator('#portrait')).toHaveAttribute('data-pet-clip',reaction);
  }
  const bytes=await page.evaluate(()=>[...window.bodyBitmaps].reduce((sum,image)=>sum+image.width*image.height*4,0));
  expect(await page.evaluate(()=>window.bitmapCount)).toBeGreaterThanOrEqual(12);
  expect(bytes).toBeLessThanOrEqual(48*1024*1024);
  await page.evaluate(()=>window.pet.destroy());
  expect(await page.evaluate(()=>window.bodyBitmaps.size)).toBe(0);
  await expect(page.locator('#portrait canvas')).toHaveCount(0);
});
