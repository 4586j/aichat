import { test, expect } from './ui-test.mjs';

test('dense stretches keep changing real poses without a long frozen hold',async({page},info)=>{
  await page.clock.install({time:new Date('2026-10-26T00:00:00Z')});
  await page.clock.pauseAt(new Date('2026-10-26T08:00:00Z'));
  await page.emulateMedia({reducedMotion:'no-preference'});
  const requests=[];page.on('request',r=>requests.push(r.url()));
  await page.route('**/pet-cadence-fixture',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<!doctype html><link rel="stylesheet" href="/pets.css"><body style="background:#edf2e7"><span id="portrait" class="pet-portrait" data-pet-portrait><img src="/assets/pets/cream-cat-v1.png" alt="团团"></span><script type="module">import {createPetMotion} from '/pet-motion.js';window.pet=createPetMotion();window.pet.update({id:'cream-cat',animations:true,reaction:'stretch',reactionKey:1});</script>`}));
  await page.goto('/pet-cadence-fixture');const portrait=page.locator('#portrait');await expect(portrait).toHaveAttribute('data-pet-clip','stretch');
  for(const id of ['cream-cat','shiba','lop-rabbit','little-fox']){
    await page.evaluate(id=>window.pet.update({id,animations:true,reaction:'stretch',reactionKey:2}),id);await expect(portrait).toHaveAttribute('data-pet-clip','stretch');
    // Allow first load, then restart so the same held-pose interval is sampled for every pet.
    await page.evaluate(id=>window.pet.update({id,animations:true,reaction:'stretch',reactionKey:3}),id);await page.clock.runFor(350);
    const samples=[];
    // Span multiple authored middle poses, rather than stretching one pose into a long hold.
    for(let i=0;i<5;i++){
      samples.push(await portrait.evaluate(stage=>({column:stage.dataset.petClipFrame,progress:stage.dataset.petClipProgress,image:stage.querySelector('canvas').toDataURL()})));
      if(i<4)await page.clock.runFor(64);
    }
    expect(new Set(samples.map(sample=>sample.column)).size).toBeGreaterThanOrEqual(4);
    expect(new Set(samples.map(sample=>sample.image)).size,JSON.stringify(samples.map(({column,progress})=>({column,progress})))).toBe(5);
    await portrait.screenshot({path:info.outputPath(`${id}-clear-stretch.png`)});
  }
  expect(requests.some(url=>/motion-v|pet-tween|\.wasm/.test(url))).toBe(false);
  await page.emulateMedia({reducedMotion:'reduce'});const still=await portrait.locator('canvas').evaluate(c=>c.toDataURL());await page.clock.runFor(2000);expect(await portrait.locator('canvas').evaluate(c=>c.toDataURL())).toBe(still);
});
