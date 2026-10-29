import {test,expect} from '@playwright/test';
import {PET_ACTIONS} from '../public/pet-motion.js';

async function bounds(page){
  return page.locator('#portrait canvas').evaluate(canvas=>{
    const {width,height}=canvas,bytes=canvas.getContext('2d').getImageData(0,0,width,height).data;
    let left=width,right=-1,top=height,bottom=-1;
    for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(bytes[(y*width+x)*4+3]>32){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
    const box=canvas.getBoundingClientRect();
    return {width:(right-left+1)/width*box.width,height:(bottom-top+1)/height*box.height,floor:box.top+(bottom+1)/height*box.height,left,right,top,bottom,pixels:width};
  });
}

for(const id of ['cream-cat','shiba','lop-rabbit','little-fox'])test(`${id} keeps its displayed resting size when entering and leaving every body action`,async({page},info)=>{
  await page.clock.install({time:new Date('2026-10-27T02:00:00Z')});await page.emulateMedia({reducedMotion:'no-preference'});
  await page.route('**/pet-framing-fixture',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<!doctype html><link rel="stylesheet" href="/pets.css"><body style="margin:40px;background:#edf2e7"><span id="portrait" class="pet-portrait pet-portrait-large" data-pet-portrait><img src="/assets/pets/${id}-v1.png" alt="宠物"></span><script type="module">import {createPetMotion} from '/pet-motion.js';let state={id:'${id}',animations:false};const pet=createPetMotion();window.updatePet=next=>{state={...state,...next};pet.update(state)};window.updatePet({});</script>`}));
  await page.goto('/pet-framing-fixture');const portrait=page.locator('#portrait');await expect(portrait).toHaveAttribute('data-pet-renderer','canvas');
  await page.clock.pauseAt(new Date('2026-10-27T02:00:01Z'));
  const pngReference=await portrait.evaluate(stage=>{
    const image=stage.querySelector('img'),canvas=document.createElement('canvas');canvas.width=canvas.height=384;
    const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0,384,384);const bytes=ctx.getImageData(0,0,384,384).data;
    let left=384,right=-1,top=384,bottom=-1;
    for(let y=0;y<384;y++)for(let x=0;x<384;x++)if(bytes[(y*384+x)*4+3]>32){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
    const rect=image.getBoundingClientRect();return{width:(right-left+1)/384*rect.width,height:(bottom-top+1)/384*rect.height,floor:rect.top+(bottom+1)/384*rect.height};
  });
  const staticSize=await bounds(page);
  expect(Math.abs(staticSize.width/pngReference.width-1)).toBeLessThan(.02);
  expect(Math.abs(staticSize.height/pngReference.height-1)).toBeLessThan(.02);
  expect(Math.abs(staticSize.floor-pngReference.floor)).toBeLessThan(1.5);
  await portrait.screenshot({path:info.outputPath(`${id}-idle-original-size.png`)});
  let key=0;
  for(const reaction of ['wave','stretch','feed','play']){
    await page.evaluate(()=>window.updatePet({animations:false,reaction:''}));const idle=await bounds(page);
    await page.evaluate(next=>window.updatePet(next),{animations:true,reaction,reactionKey:++key});await expect(portrait).toHaveAttribute('data-pet-clip',reaction);
    await page.clock.runFor(65);await expect(portrait).toHaveAttribute('data-pet-clip-frame',/^[0-3]:0$/);
    const entry=await bounds(page);
    if(reaction==='wave')await portrait.screenshot({path:info.outputPath(`${id}-action-entry-size.png`)});
    await page.evaluate(next=>window.updatePet(next),{reactionKey:++key});await page.clock.runFor(PET_ACTIONS[reaction].duration-40);
    await expect(portrait).toHaveAttribute('data-pet-clip-frame',/^[0-3]:5$/);const exit=await bounds(page);
    for(const actual of [entry,exit]){
      expect(Math.abs(actual.height/idle.height-1),`${reaction}: resting height changes`).toBeLessThan(.045);
      expect(Math.abs(actual.width/idle.width-1),`${reaction}: resting width changes`).toBeLessThan(.055);
      expect(Math.abs(actual.floor-idle.floor),`${reaction}: feet jump at the artwork boundary`).toBeLessThan(2.5);
    }
    await portrait.screenshot({path:info.outputPath(`${id}-${reaction}-same-size.png`)});
  }
});

test('expanded ears and raised paws stay inside the shared camera with no pixel clipping',async({page})=>{
  await page.clock.install({time:new Date('2026-10-27T02:00:00Z')});await page.emulateMedia({reducedMotion:'no-preference'});
  await page.route('**/pet-framing-limits',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:'<!doctype html><link rel="stylesheet" href="/pets.css"><span id="portrait" class="pet-portrait pet-portrait-large" data-pet-portrait><img src="/assets/pets/lop-rabbit-v1.png" alt="宠物"></span><script type="module">import {createPetMotion} from "/pet-motion.js";window.pet=createPetMotion();window.pet.update({id:"lop-rabbit",animations:false});</script>'}));
  await page.goto('/pet-framing-limits');await expect(page.locator('#portrait')).toHaveAttribute('data-pet-renderer','canvas');
  await page.clock.pauseAt(new Date('2026-10-27T02:00:01Z'));
  for(const id of ['cream-cat','shiba','lop-rabbit','little-fox'])for(const reaction of ['stretch','play']){
    await page.evaluate(next=>window.pet.update(next),{id,animations:true,reaction,reactionKey:performance.now()});
    await expect(page.locator('#portrait')).toHaveAttribute('data-pet-clip',reaction);
    for(let i=0;i<Math.ceil(PET_ACTIONS[reaction].duration/30);i++){
      await page.clock.runFor(30);const box=await bounds(page);
      expect(Math.min(box.left,box.top,box.pixels-1-box.right,box.pixels-1-box.bottom),`${id}/${reaction} at ${i*30}ms`).toBeGreaterThan(1);
    }
  }
});
