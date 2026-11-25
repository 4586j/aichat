// Local, offline profiling. No model requests and no changes to saved pet preferences.
import { chromium } from '@playwright/test';
import { startServer } from '../server.mjs';
const app=await startServer({port:0,dbPath:':memory:',scheduler:false});
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL || 'chrome',headless:true});
const percentile=(values,n)=>[...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.floor(values.length*n))] || 0;
try {
  for(const [width,rate]of[[1440,1],[390,4]]){
    const page=await browser.newPage({viewport:{width,height:960},deviceScaleFactor:width<700?2:1,reducedMotion:'no-preference'});
    const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate});
    await page.route('**/pet-profile',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<!doctype html><link rel="stylesheet" href="/pets.css"><body style="margin:16px;background:#edf2e7"><span class="pet-portrait" data-pet-portrait style="width:40px;height:40px"><img alt="" src="/assets/pets/cream-cat-v1.png"></span><span id="portrait" class="pet-portrait" data-pet-portrait style="width:240px;height:240px"><img alt="" src="/assets/pets/cream-cat-v1.png"></span><script type="module">import {createPetMotion} from '/pet-motion.js';window.pet=createPetMotion();window.pet.update({id:'cream-cat',scene:'normal',animations:true});</script>`}));
    await page.addInitScript(()=>{
      window.samples=[];window.paints=[];window.longTasks=[];window.profile=false;const raf=requestAnimationFrame.bind(window),draw=CanvasRenderingContext2D.prototype.drawImage;
      window.requestAnimationFrame=callback=>raf(now=>{const start=performance.now();callback(now);if(window.profile&&callback.name==='tick')window.samples.push({at:now,cost:performance.now()-start});});
      CanvasRenderingContext2D.prototype.drawImage=function(...args){const result=draw.apply(this,args);if(window.profile&&this.canvas.classList.contains('pet-motion-canvas')&&this.canvas.parentElement?.id==='portrait')window.paints.push(performance.now());return result;};
      new PerformanceObserver(list=>{if(window.profile)window.longTasks.push(...list.getEntries().map(item=>item.duration));}).observe({type:'longtask',buffered:false});
    });
    await page.goto(app.url+'/pet-profile');await page.waitForSelector('[data-pet-renderer="canvas"]');await page.waitForTimeout(800);
    for(const [motion,duration]of [['comfort',1600],['wave',1200],['stretch',1400],['feed',1300],['play',1800]]){
      await page.evaluate(motion=>{window.samples=[];window.changes=[];window.paints=[];window.longTasks=[];window.profile=true;window.sampleStart=performance.now();let previous='';window.tracker?.disconnect();window.tracker=new MutationObserver(()=>{const next=document.querySelector('#portrait').dataset.petClipFrame;if(next!==previous){if(next!=='none')window.changes.push(performance.now());previous=next;}});window.tracker.observe(document.querySelector('#portrait'),{attributes:true,attributeFilter:['data-pet-clip-frame']});window.pet.update({id:'cream-cat',animations:true,scene:motion==='comfort'?'comfort':'normal',reaction:motion==='comfort'?'':motion,reactionKey:performance.now()});},motion);
      await page.waitForTimeout(duration);
      const {samples,changes,paints,longTasks,elapsed}=await page.evaluate(()=>{window.profile=false;return{samples:window.samples,changes:window.changes,paints:window.paints,longTasks:window.longTasks,elapsed:performance.now()-window.sampleStart};});
      const gaps=paints.slice(1).map((value,i)=>value-paints[i]),holds=changes.slice(1).map((value,i)=>value-changes[i]);
      console.log(JSON.stringify({width,cpuRate:rate,motion,paintFps:+(paints.length/elapsed*1000).toFixed(1),callbackP95ms:+percentile(samples.map(s=>s.cost),.95).toFixed(2),paintGapP95ms:+percentile(gaps,.95).toFixed(2),maxPaintGapMs:+Math.max(0,...gaps).toFixed(2),poseChanges:changes.length,poseGapP95ms:+percentile(holds,.95).toFixed(2),longTasks:longTasks.length}));
    }
    await page.close();
  }
}finally{await browser.close();await app.close();}
