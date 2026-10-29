import { test, expect } from '@playwright/test';
import { PET_ACTIONS } from '../public/pet-motion.js';

const ids=['cream-cat','shiba','lop-rabbit','little-fox'];
const stage=page => page.locator('#portrait');
const pixels=page => stage(page).locator('canvas').evaluate(canvas => canvas.toDataURL());
async function component(page, options={}) {
  await page.addInitScript(() => { Math.random=() => .5; });
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.route('**/pet-motion-fixture',route => route.fulfill({contentType:'text/html; charset=utf-8',body:`<!doctype html><html><head><link rel="stylesheet" href="/pets.css"><style>body{margin:24px;background:#edf2e7}#portrait{width:220px;height:220px}</style></head><body><span id="portrait" class="pet-portrait" data-pet-portrait><img src="/assets/pets/cream-cat-v1.png" alt="奶油猫"></span><script type="module">import {createPetMotion} from '/pet-motion.js'; const motion=createPetMotion(); let state={id:'cream-cat',animations:true};window.updatePet=next=>{state={...state,...next};motion.update(state)};window.updatePet(${JSON.stringify(options)});</script></body></html>`}));
  await page.goto('/pet-motion-fixture'); await expect(stage(page)).toHaveAttribute('data-pet-renderer','canvas');
}

test('every plush pet draws five distinct faces from a single lazy strip; image errors retain the original',async({page},info)=>{
  const loaded=[]; page.on('request',r=>{if(r.url().endsWith('-expressions-v2.webp'))loaded.push(r.url());});
  await component(page,{animations:false}); expect(loaded).toHaveLength(1);
  for(const id of ids){
    const faces=[];
    for(const [scene,reaction,chatting,face] of [['normal','',false,'natural'],['comfort','',false,'warm'],['normal','pet',false,'happy'],['focus','',true,'focused'],['rest','',false,'sleepy']]){
      await page.evaluate(next=>window.updatePet(next),{id,scene,reaction,chatting});
      await expect(stage(page)).toHaveAttribute('data-expression',face); await expect(stage(page)).toHaveAttribute('data-pet-motion','still'); faces.push(await pixels(page));
    }
    expect(new Set(faces).size).toBe(5);
    await stage(page).screenshot({path:info.outputPath(`${id}-sleepy.png`)});
  }
  expect(loaded).toHaveLength(4);
  await page.route('**/cream-cat-expressions-v2.webp',route=>route.abort());
  await page.reload(); await expect(stage(page)).toHaveAttribute('data-pet-renderer','fallback');
  await expect(stage(page).locator('img')).toBeVisible(); expect(await stage(page).locator('img').evaluate(img=>img.naturalWidth)).toBeGreaterThan(100);
});

test('actual canvas blink changes only eyes and completes the half/closed/half sequence',async({page},info)=>{
  await page.clock.install({time:new Date('2026-10-26T08:00:00Z')});
  await component(page,{scene:'rest'});
  await page.clock.pauseAt(new Date('2026-10-26T08:00:01Z'));
  await page.evaluate(()=>{
    window.blinkFrames=[];window.blinkPixels=[];
    new MutationObserver(records=>{for(const record of records)if(record.attributeName==='data-blink'){window.blinkFrames.push(record.target.dataset.blink);window.blinkPixels.push(record.target.querySelector('canvas').toDataURL());}}).observe(document.querySelector('#portrait'),{attributes:true,attributeFilter:['data-blink']});
  });
  const before=await pixels(page); await page.clock.runFor(6500);
  const seen=await page.evaluate(()=>({frames:window.blinkFrames,pixels:window.blinkPixels}));
  expect(seen.frames).toContain('half'); expect(seen.frames).toContain('closed'); expect(seen.frames.at(-1)).toBe('open');
  expect(seen.pixels.some(p=>p!==before)).toBe(true); expect(await pixels(page)).toBe(before);
  await stage(page).screenshot({path:info.outputPath('blink-restored.png')});
});

test('browsers without a 2D canvas keep the original accessible portrait',async({page})=>{
  await page.addInitScript(()=>{HTMLCanvasElement.prototype.getContext=()=>null;});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  // The component helper waits for a canvas, so this case supplies its minimal markup directly.
  await page.route('**/pet-no-canvas',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:'<!doctype html><html><head><link rel="stylesheet" href="/pets.css"></head><body><span class="pet-portrait" data-pet-portrait><img src="/assets/pets/cream-cat-v1.png" alt="团团，奶油猫"></span><script type="module">import {createPetMotion} from "/pet-motion.js";createPetMotion().update({id:"cream-cat",animations:true});</script></body></html>'}));
  await page.goto('/pet-no-canvas');await expect(page.locator('[data-pet-portrait]')).toHaveAttribute('data-pet-renderer','fallback');
  await expect(page.getByAltText('团团，奶油猫')).toBeVisible();expect(errors).toEqual([]);
});

test('motion preference and OS reduced motion stop canvas updates while keeping the right static face',async({page})=>{
  await page.clock.install({time:new Date('2026-10-26T08:00:00Z')}); await component(page,{scene:'comfort'});
  await page.clock.pauseAt(new Date('2026-10-26T08:00:01Z'));
  const first=await pixels(page); await page.clock.runFor(500); expect(await pixels(page)).not.toBe(first);
  const minimumAlpha=await stage(page).locator('canvas').evaluate(canvas=>{
    const ctx=canvas.getContext('2d'), bytes=ctx.getImageData(Math.round(canvas.width*.3),Math.round(canvas.height*.3),Math.round(canvas.width*.3),Math.round(canvas.height*.15)).data;
    let minimum=255;for(let i=3;i<bytes.length;i+=4)minimum=Math.min(minimum,bytes[i]);return minimum;
  });
  expect(minimumAlpha).toBeGreaterThanOrEqual(240); // Source fur is translucent; allow filtering rounding, but reject visible mesh cracks.
  await page.evaluate(()=>window.updatePet({scene:'comfort',animations:false})); await expect(stage(page)).toHaveAttribute('data-expression','warm'); await expect(stage(page)).toHaveAttribute('data-pet-motion','still');
  const stopped=await pixels(page); await page.clock.runFor(14000); expect(await pixels(page)).toBe(stopped); await expect(stage(page)).toHaveAttribute('data-blink','open');
  await page.evaluate(()=>window.updatePet({animations:true})); await page.emulateMedia({reducedMotion:'reduce'}); await expect(stage(page)).toHaveAttribute('data-pet-motion','still');
  const reduced=await pixels(page); await page.clock.runFor(10000); expect(await pixels(page)).toBe(reduced);
  await page.emulateMedia({reducedMotion:'no-preference'}); await expect(stage(page)).toHaveAttribute('data-pet-motion','comfort');
  await page.clock.runFor(500); expect(await pixels(page)).not.toBe(reduced);
});

test('larger character motions draw cleanly for all four plush shapes',async({page},info)=>{
  await page.clock.install({time:new Date('2026-10-26T08:00:00Z')});await component(page,{animations:false});
  await page.clock.pauseAt(new Date('2026-10-26T08:00:01Z'));
  for(const[id,reaction,elapsed]of[['cream-cat','wave',1000],['shiba','hop',1100],['lop-rabbit','ears',700],['little-fox','look',1000]]){
    await page.evaluate(next=>window.updatePet(next),{id,reaction,animations:true});await expect(stage(page)).toHaveAttribute('data-pet-renderer','canvas');
    const before=await pixels(page);await page.clock.runFor(elapsed);expect(await pixels(page)).not.toBe(before);
    await stage(page).screenshot({path:info.outputPath(`${id}-${reaction}.png`)});
  }
});

test('hidden document pauses, resumes without a burst, and idle gestures are suppressed during focus',async({page})=>{
  await page.clock.install({time:new Date('2026-10-26T08:00:00Z')}); await component(page,{id:'lop-rabbit'});
  await page.clock.pauseAt(new Date('2026-10-26T08:00:01Z'));
  await page.clock.runFor(1800); await expect(stage(page)).toHaveAttribute('data-pet-gesture',/^(ears|look|stretch|wave|nuzzle|hop|shake)$/);
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
  const hidden=await pixels(page); await page.clock.runFor(30000); expect(await pixels(page)).toBe(hidden);
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});
  await expect(stage(page)).toHaveAttribute('data-blink','open'); await expect(stage(page)).toHaveAttribute('data-pet-gesture','none');
  await page.evaluate(()=>window.updatePet({scene:'focus'})); await page.clock.runFor(14000); await expect(stage(page)).toHaveAttribute('data-pet-gesture','none'); await expect(stage(page)).toHaveAttribute('data-expression','focused');
});

test('motion previews run immediately without requests or points, restore the current need, and respect the switch',async({page,request},info)=>{
  await request.put('/api/pets/settings',{data:{enabled:true,animations:true,selectedId:'cream-cat'}});
  const before=await(await request.get('/api/pets')).json();
  await page.emulateMedia({reducedMotion:'no-preference'});await page.goto('/');
  await page.getByRole('button',{name:'打开宠物小窝',exact:true}).first().click();
  await expect(page.getByRole('region',{name:'宠物动作试玩'})).toBeVisible();
  let calls=0;page.on('request',r=>{if(r.method()!=='GET')calls++;});
  const portrait=page.locator('.pet-home-stage [data-pet-portrait]');
  for(const[label,motion]of[['招招手','wave'],['伸懒腰','stretch'],['尝点心','feed'],['开心跳跳','play'],['看看四周','look'],['动动耳朵','ears'],['摇摇尾巴','tail'],['轻轻蹦','hop'],['抖抖毛','shake']]){
    await page.getByRole('button',{name:label,exact:true}).click();await expect(portrait).toHaveAttribute('data-pet-motion',motion);
  }
  const after=await(await request.get('/api/pets')).json();expect(after.pets).toEqual(before.pets);expect(calls).toBe(0);
  await expect(portrait).toHaveAttribute('data-pet-motion','idle',{timeout:5000});
  await page.getByRole('button',{name:'招招手',exact:true}).click();await page.screenshot({path:info.outputPath('pet-motion-preview-desktop.png')});
  await page.getByLabel('开启轻动效',{exact:true}).uncheck();await expect(page.getByRole('button',{name:'招招手',exact:true})).toBeDisabled();
  await expect(portrait).toHaveAttribute('data-pet-motion','still');await request.put('/api/pets/settings',{data:{animations:true}});
});

test('portraits added after rendering share state; removed and offscreen canvases stop updating',async({page})=>{
  await page.clock.install({time:new Date('2026-10-26T08:00:00Z')}); await component(page,{scene:'comfort'});
  await page.clock.pauseAt(new Date('2026-10-26T08:00:01Z'));
  await page.evaluate(()=>{const node=document.querySelector('#portrait').cloneNode(false);node.id='second';node.style.cssText='width:44px;height:44px';node.innerHTML='<img alt="宠物" src="/assets/pets/cream-cat-v1.png">';document.body.append(node);});
  await expect(page.locator('#second')).toHaveAttribute('data-expression','warm'); await expect(page.locator('#second canvas')).toHaveCount(1);
  await page.evaluate(()=>{document.querySelector('#portrait').remove();document.querySelector('#second').style.marginTop='2000px';});
  await expect(async()=>{expect(await page.locator('#second').evaluate(node=>node.getBoundingClientRect().top)).toBeGreaterThan(900);}).toPass();
  const offscreen=await page.locator('#second canvas').evaluate(c=>c.toDataURL()); await page.clock.runFor(12000); expect(await page.locator('#second canvas').evaluate(c=>c.toDataURL())).toBe(offscreen);
  await page.locator('#second').evaluate(node=>{node.style.marginTop='0';});await expect(page.locator('#second')).toHaveAttribute('data-blink','open');await expect(page.locator('#second')).toHaveAttribute('data-pet-gesture','none');
});

test('real chat needs, interactions and audio state choose expressions and recover after an interaction',async({page,request},info)=>{
  await request.put('/api/pets/settings',{data:{enabled:true,animations:true,selectedId:'cream-cat'}});
  const responseSettings=(await(await request.get('/api/response-settings')).json()).responseSettings;
  await request.put('/api/response-settings',{data:{expectedRevision:responseSettings.revision,petLinked:true}});
  const{persona}=await(await request.post('/api/personas',{data:{name:'宠物动画联动验证',systemPrompt:'温和简洁。'}})).json();
  await page.emulateMedia({reducedMotion:'reduce'}); await page.goto('/'); await page.getByLabel('选择聊天角色',{exact:true}).selectOption(persona.id);
  await page.locator('#chat-input').fill('联动演示：今天好累，我只想说说。'); await page.getByRole('button',{name:'发送',exact:true}).click();
  const current=page.locator('.pet-trigger [data-pet-portrait]'); await expect(current).toHaveAttribute('data-expression','sleepy');
  await page.getByRole('button',{name:'打开宠物小窝',exact:true}).first().click();
  await page.locator('#pet-home').getByRole('button',{name:'摸摸',exact:true}).click(); await expect(current).toHaveAttribute('data-expression','happy');
  await page.locator('.pet-home-stage').screenshot({path:info.outputPath('pet-happy-home.png')});
  await expect(current).toHaveAttribute('data-expression','sleepy',{timeout:5000});
  await page.getByRole('button',{name:'关闭宠物小窝',exact:true}).click();
  await page.getByRole('button',{name:'查看和调整对话状态',exact:true}).click();
  await page.locator('[data-state-manual="need"]').check(); await page.locator('#state-value-need').selectOption('task'); await page.getByRole('button',{name:'保存状态修改',exact:true}).click();
  await expect(current).toHaveAttribute('data-expression','focused');
  await page.evaluate(()=>document.querySelector('#background-audio').dispatchEvent(new Event('playing'))); await expect(current).toHaveAttribute('data-expression','focused');
  await page.evaluate(()=>document.querySelector('#background-audio').dispatchEvent(new Event('pause')));
});

for(const width of [320,390])test(`canvas pets fit ${width}px phones, keep controls available and use bounded resolution`,async({page,request},info)=>{
  await request.put('/api/pets/settings',{data:{enabled:true,animations:true,selectedId:'little-fox'}});
  await page.setViewportSize({width,height:844}); await page.emulateMedia({reducedMotion:'no-preference'}); await page.goto('/');
  await expect(page.locator('.pet-mobile-companion [data-pet-portrait]')).toHaveAttribute('data-pet-renderer','canvas');
  await page.getByRole('button',{name:'打开宠物小窝',exact:true}).first().click();
  await expect(page.locator('.pet-home-stage [data-pet-portrait]')).toHaveAttribute('data-pet-renderer','canvas');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(await page.locator('.pet-home-stage canvas').evaluate(c=>c.width)).toBeLessThanOrEqual(440);
  await page.screenshot({path:info.outputPath(`pet-motion-phone-${width}.png`)});
  await page.getByRole('button',{name:'关闭宠物小窝',exact:true}).click(); await expect(page.getByRole('button',{name:'发送',exact:true})).toBeInViewport();
});

for(const id of ids)test(`${id} plays four real body clips, visits authored poses, and returns to its current need`,async({page},info)=>{
  await page.clock.install({time:new Date('2026-10-26T08:00:00Z')});await component(page,{id,animations:false});
  await page.clock.pauseAt(new Date('2026-10-26T08:00:01Z'));
  for(const[reaction,row]of[['wave',0],['stretch',1],['feed',2],['play',3]]){
    await page.evaluate(next=>window.updatePet(next),{reaction,animations:true,scene:'normal',reactionKey:row+1});
    await expect(stage(page)).toHaveAttribute('data-pet-clip',reaction);
    const columns=new Set(),frames=new Set();
    for(let i=0;i<Math.ceil(PET_ACTIONS[reaction].duration/30)+4;i++){
      const name=await stage(page).getAttribute('data-pet-clip-frame');if(name!=='none')columns.add(Number(name.split(':')[1]));
      if(name===`${row}:3`){frames.add(await pixels(page));if(frames.size===1)await stage(page).screenshot({path:info.outputPath(`${id}-${reaction}-full-body.png`)});}
      await page.clock.runFor(30);
    }
    expect([...columns].sort()).toEqual([0,1,2,3,4,5]);expect(frames.size).toBeGreaterThan(0);
    await expect(stage(page)).toHaveAttribute('data-pet-clip','none');
    await page.evaluate(()=>window.updatePet({reaction:'',scene:'comfort'}));await expect(stage(page)).toHaveAttribute('data-expression','warm');
  }
});

test('body artwork loads only for enabled visible motion, caches per pet, and stops under reduced motion',async({page})=>{
  const loaded=[];page.on('request',r=>{if(r.url().endsWith('-actions-v3.webp'))loaded.push(r.url());});
  await page.clock.install({time:new Date('2026-10-26T08:00:00Z')});await component(page,{animations:false});
  await page.clock.pauseAt(new Date('2026-10-26T08:00:01Z'));expect(loaded).toHaveLength(0);
  await page.emulateMedia({reducedMotion:'reduce'});await page.evaluate(()=>window.updatePet({animations:true}));expect(loaded).toHaveLength(0);
  await page.evaluate(()=>window.updatePet({scene:'comfort'}));await page.emulateMedia({reducedMotion:'no-preference'});expect(loaded).toHaveLength(0);
  await page.evaluate(()=>window.updatePet({reaction:'wave'}));await expect(stage(page)).toHaveAttribute('data-pet-clip','wave');expect(loaded).toHaveLength(1);
  await page.clock.runFor(800);await expect(stage(page)).toHaveAttribute('data-blink','open');
  await page.emulateMedia({reducedMotion:'reduce'});await expect(stage(page)).toHaveAttribute('data-pet-clip','none');const still=await pixels(page);
  await page.clock.runFor(9000);expect(await pixels(page)).toBe(still);
  await page.evaluate(()=>window.updatePet({reaction:'',scene:'rest'}));await page.emulateMedia({reducedMotion:'no-preference'});
  await page.clock.runFor(6000);await expect(stage(page)).toHaveAttribute('data-pet-clip','none');await expect(stage(page)).toHaveAttribute('data-expression','sleepy');
  await page.evaluate(()=>window.updatePet({reaction:'play',scene:'normal'}));await expect(stage(page)).toHaveAttribute('data-pet-clip','play');expect(loaded).toHaveLength(1);
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
  const hidden=await pixels(page);await page.clock.runFor(20000);expect(await pixels(page)).toBe(hidden);
});

for(const failure of ['missing','malformed'])test(`${failure} body artwork retains working expressions and local motion`,async({page})=>{
  if(failure==='missing')await page.route('**/*-actions-v3.webp',route=>route.abort());
  else await page.route('**/*-actions-v3.webp',async route=>route.fulfill({response:await page.request.get('/assets/pets/cream-cat-v1.png')}));
  await page.clock.install({time:new Date('2026-10-26T08:00:00Z')});await component(page,{reaction:'wave'});
  await page.clock.pauseAt(new Date('2026-10-26T08:00:01Z'));const before=await pixels(page);await page.clock.runFor(900);
  await expect(stage(page)).toHaveAttribute('data-pet-renderer','canvas');await expect(stage(page)).toHaveAttribute('data-pet-clip','none');expect(await pixels(page)).not.toBe(before);
  await page.evaluate(()=>window.updatePet({reaction:'',scene:'focus'}));await expect(stage(page)).toHaveAttribute('data-expression','focused');
});

test('direct body actions restart on a new interaction, then restore music or a new quiet need',async({page})=>{
  await page.clock.install({time:new Date('2026-10-26T08:00:00Z')});await component(page,{animations:false,music:true});
  await page.clock.pauseAt(new Date('2026-10-26T08:00:01Z'));
  await page.evaluate(()=>window.updatePet({animations:true,reaction:'feed',reactionKey:1}));await expect(stage(page)).toHaveAttribute('data-pet-clip','feed');
  await page.clock.runFor(1200);expect(await stage(page).getAttribute('data-pet-clip-frame')).not.toBe('2:0');
  await page.evaluate(()=>window.updatePet({reactionKey:2}));await expect(stage(page)).toHaveAttribute('data-pet-clip-frame','2:0');
  await page.clock.runFor(500);await page.evaluate(()=>window.updatePet({reaction:'reply'}));
  await expect(stage(page)).toHaveAttribute('data-pet-clip','none');
  await page.evaluate(()=>window.updatePet({reaction:''}));await expect(stage(page)).toHaveAttribute('data-pet-motion','music');
  await page.evaluate(()=>window.updatePet({scene:'rest'}));await page.clock.runFor(8000);
  await expect(stage(page)).toHaveAttribute('data-pet-motion','rest');await expect(stage(page)).toHaveAttribute('data-pet-clip','none');
});

test('changing the OS motion preference loads body artwork without another UI state update',async({page})=>{
  const loaded=[];page.on('request',r=>{if(r.url().endsWith('-actions-v3.webp'))loaded.push(r.url());});
  await component(page,{animations:false});await page.emulateMedia({reducedMotion:'reduce'});
  await page.evaluate(()=>window.updatePet({animations:true}));expect(loaded).toHaveLength(0);
  await page.emulateMedia({reducedMotion:'no-preference'});await expect.poll(()=>loaded.length).toBe(1);
  await page.evaluate(()=>window.updatePet({reaction:'wave'}));await expect(stage(page)).toHaveAttribute('data-pet-clip','wave');
});
