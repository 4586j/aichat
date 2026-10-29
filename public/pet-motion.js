// The sprite strip contains five registered faces, then two transparent eye-only blink frames.
import { PET_CLIP_LAYOUT, petClipSprite, petClipFrame, petClipDuration } from './pet-clips.js';
import { PET_FRAMING } from './pet-framing.js';
export const PET_FACES = { natural: 0, warm: 1, happy: 2, focused: 3, sleepy: 4 };
export const PET_ACTIONS = {
  pet: { duration: 2500, face: 'happy' },
  feed: { label:'尝点心', caption:'捧起小点心，慢慢吃一口。', duration: petClipDuration('feed'), face: 'happy' },
  play: { label:'开心跳跳', caption:'蹲一蹲，跳起来，再稳稳落下。', duration: petClipDuration('play'), face: 'happy' },
  reply: { duration: 1800 }, celebrate: { duration: petClipDuration('celebrate') },
  wave: { label: '招招手', caption: '举起小爪子，和你打个招呼。', duration: petClipDuration('wave'), face: 'happy' },
  stretch: { label: '伸懒腰', caption: '舒舒服服地伸个懒腰。', duration: petClipDuration('stretch'), face: 'sleepy' },
  look: { label: '看看四周', caption: '左看看，右看看，最后还是看向你。', duration: 3000, face: 'focused' },
  ears: { label: '动动耳朵', caption: '耳朵轻轻动一动，听见你啦。', duration: 2100, face: 'natural' },
  tail: { label: '摇摇尾巴', caption: '把一点好心情藏进摇摆的尾巴。', duration: 2600, face: 'happy' },
  hop: { label: '轻轻蹦', caption: '蓄一点力，轻轻蹦起来。', duration: petClipDuration('hop'), face: 'happy' },
  nuzzle: { label: '蹭一蹭', caption: '凑近一点，轻轻蹭蹭你。', duration: 2600, face: 'warm' },
  shake: { label: '抖抖毛', caption: '抖一抖，重新变得蓬蓬松松。', duration: 2200, face: 'natural' },
};
export const isPetInteraction = kind => ['pet','feed','play'].includes(kind) || Boolean(PET_ACTIONS[kind]?.label);
export const PET_MOTION_PROFILES = {
  'cream-cat': { period: 5.6, interval: [2.5, 4.5], ears: [[.22, .2], [.65, .14]], paws: [[.34,.72],[.59,.71]], tail: [.87, .7], gestures: ['tail','look','stretch','wave','ears','nuzzle','shake'] },
  shiba: { period: 4.8, interval: [2, 3.8], ears: [[.35, .15], [.74, .25]], paws: [[.32,.9],[.52,.91]], tail: [.82, .72], gestures: ['tail','wave','hop','look','ears','stretch','shake'] },
  'lop-rabbit': { period: 6.2, interval: [3, 5], ears: [[.17, .48], [.8, .54]], paws: [[.39,.67],[.59,.69]], tail: null, gestures: ['ears','look','stretch','wave','nuzzle','hop','shake'] },
  'little-fox': { period: 5.2, interval: [2.2, 4], ears: [[.27, .18], [.69, .28]], paws: [[.32,.85],[.51,.86]], tail: [.83, .73], gestures: ['ears','look','tail','wave','stretch','nuzzle','hop'] },
};
export const petSprite = id => `/assets/pets/${id}-expressions-v2.webp`;
export function petPresentation({ scene = 'normal', reaction = '', chatting = false, music = false, animations = true } = {}) {
  const explicit = isPetInteraction(reaction);
  let face, motion, phase;
  if (explicit) { face = PET_ACTIONS[reaction].face; motion = reaction; phase = reaction; }
  else if (scene === 'rest') { face = 'sleepy'; motion = 'rest'; phase = 'quiet'; }
  else if (scene === 'comfort') { face = 'warm'; motion = 'comfort'; phase = 'comfort'; }
  else if (scene === 'focus') { face = 'focused'; motion = 'focus'; phase = 'focus'; }
  else if (chatting) { face = 'focused'; motion = 'thinking'; phase = 'thinking'; }
  else if (reaction === 'reply' && scene === 'celebrate') { face = 'happy'; motion = 'celebrate'; phase = 'celebrate'; }
  else if (reaction === 'error') { face = 'warm'; motion = 'comfort'; phase = 'error'; }
  else if (reaction === 'reply') { face = 'warm'; motion = 'reply'; phase = 'reply'; }
  else if (music) { face = 'natural'; motion = 'music'; phase = 'music'; }
  else { face = 'natural'; motion = 'idle'; phase = 'idle'; }
  return { face, motion, phase: animations ? phase : 'quiet' };
}

const between = (range, random) => range[0] + (range[1] - range[0]) * random();
export class PetGestures {
  constructor(random = Math.random) { this.random=random; this.id=''; this.bag=[]; this.last=''; this.running=null; this.next=null; }
  reset(id, time) { this.id=id; this.bag=[]; this.last=''; this.running=null; this.next=time+between([800,1600],this.random); }
  invite(time) { if (!this.running) this.next=Math.min(this.next ?? Infinity,time+450); }
  suspend() { this.running=null; this.next=null; }
  pick() {
    if (!this.bag.length) {
      this.bag=[...PET_MOTION_PROFILES[this.id].gestures];
      for (let i=this.bag.length-1;i>0;i--) { const j=Math.floor(this.random()*(i+1)); [this.bag[i],this.bag[j]]=[this.bag[j],this.bag[i]]; }
      if (this.bag.at(-1)===this.last) [this.bag[0],this.bag[this.bag.length-1]]=[this.bag.at(-1),this.bag[0]];
    }
    return this.bag.pop();
  }
  frame(time, allowed) {
    if (!allowed) { this.suspend(); return null; }
    if (this.next === null && !this.running) this.next=time+between([1000,1800],this.random);
    if (this.running && time-this.running.start>=PET_ACTIONS[this.running.kind].duration) {
      this.last=this.running.kind; this.running=null; this.next=time+between(PET_MOTION_PROFILES[this.id].interval,this.random)*1000;
    }
    if (!this.running && time>=this.next) this.running={kind:this.pick(),start:time};
    return this.running ? {kind:this.running.kind,progress:(time-this.running.start)/PET_ACTIONS[this.running.kind].duration} : null;
  }
}
export class PetBlink {
  constructor(random = Math.random) { this.random = random; this.reset(0); }
  reset(time) { this.start = null; this.double = false; this.followup = false; this.next = time + between([4000, 8000], this.random); }
  frame(time, face) {
    if (face === 'happy') { this.reset(time); return 'open'; }
    if (this.start === null && time >= this.next) { this.start = time; this.double = !this.followup && this.random() < .12; this.followup = false; }
    if (this.start === null) return 'open';
    const age = time - this.start;
    if (age >= 230) {
      if (this.double) { this.start = null; this.double = false; this.followup = true; this.next = time + 150; }
      else this.reset(time);
      return 'open';
    }
    return age < 50 || age >= 150 ? 'half' : 'closed';
  }
}

const smooth = (a, b, n) => { const t = Math.max(0, Math.min(1, (n - a) / (b - a))); return t*t*(3 - 2*t); };
const influence = (x, y, cx, cy, rx, ry) => Math.exp(-2.5 * (((x-cx)/rx)**2 + ((y-cy)/ry)**2));
export function petVertex(x, y, { id, time, motion, gesture = '', gestureProgress = 0, actionProgress = 1 }) {
  const profile = PET_MOTION_PROFILES[id];
  if (!profile || motion === 'still' || motion === 'rest') return [x, y];
  const anchor = 1 - smooth(.7, .98, y), head = influence(x, y, .48, .35, .46, .43);
  const calm = ['comfort', 'focus', 'thinking'].includes(motion);
  const breath = Math.sin(time / (profile.period * 1000) * Math.PI * 2);
  let dx = 0, dy = -breath * (calm ? .0017 : .005) * anchor;
  // Every short action returns to its exact starting pose, so feet never accumulate drift.
  const action=PET_ACTIONS[motion] ? motion : gesture;
  const p=Math.min(1,Math.max(0,PET_ACTIONS[motion] ? actionProgress : gestureProgress));
  const envelope = Math.sin(Math.PI*p)**2;
  const wave = Math.sin(p*Math.PI*2)*envelope;
  const wiggle = Math.sin(p*Math.PI*4)*envelope;
  let tilt = 0;
  if (action === 'pet' || action === 'nuzzle') { tilt=-wave*.15; dx+=envelope*.018*head; dy+=envelope*.012*head; }
  if (action === 'feed') dy+=(envelope*.013+wiggle*.012)*head;
  if (action === 'reply') dy+=wave*.014*head;
  if (action === 'look') tilt=wave*.2;
  if (action === 'shake') { tilt=Math.sin(p*Math.PI*6)*envelope*.1; dx+=wiggle*.007*head; }
  if (action === 'stretch') {
    dy-=envelope*.025*head; dx+=(x-.48)*envelope*.035*anchor;
    for (const [px,py] of profile.paws) { const w=influence(x,y,px,py,.14,.18); dx+=(px<.48 ? -.014 : .014)*envelope*w; dy+=envelope*.016*w; }
  }
  if (action === 'wave') {
    const [px,py]=profile.paws[0], paw=influence(x,y,px,py,.12,.2);
    dx+=(envelope*-.012+wiggle*.025)*paw; dy-=envelope*.055*paw; tilt=wave*.055;
  }
  if (motion === 'music') { const beat=Math.sin(time/2100*Math.PI*2); tilt+=beat*.035; dy+=beat*.007*head; }
  dx-=(y-.55)*tilt*head; dy+=(x-.48)*tilt*head;
  if (['ears','shake','stretch'].includes(action)) {
    for (const [index, [ex, ey]] of profile.ears.entries()) {
      // Lop ears settle slightly later than the head; the same fur texture stays continuous.
      const lag = id === 'lop-rabbit' ? .16 * index : .07 * index;
      const q = Math.max(0, Math.min(1, (p - lag) / (1 - lag)));
      const amount = Math.sin(q*Math.PI*4)*Math.sin(q*Math.PI)**2;
      const w = influence(x, y, ex, ey, .18, id === 'lop-rabbit' ? .4 : .24);
      const strength=action === 'stretch' ? .35 : action === 'shake' ? .65 : 1;
      dx+=amount*(index ? -.032 : .032)*w*strength; dy+=amount*.012*w*strength;
    }
  }
  if (['tail','play','pet','wave'].includes(action) && profile.tail) {
    const [tx, ty] = profile.tail, w = influence(x, y, tx, ty, .23, .3);
    const strength=action === 'tail' ? 1 : .55;
    dx+=wiggle*(id === 'shiba' ? .04 : .03)*w*strength; dy-=wiggle*.016*w*strength;
  }
  const edge = smooth(0, .025, x) * (1-smooth(.975, 1, x)) * smooth(0, .025, y) * (1-smooth(.975, 1, y));
  return [x + dx * edge, y + dy * edge];
}

export function petRoot({motion,gesture='',actionProgress=1,gestureProgress=0}) {
  if (['rest','still','comfort','focus','thinking'].includes(motion)) return {lift:0,squash:0,lean:0};
  const action=PET_ACTIONS[motion] ? motion : gesture;
  const p=Math.min(1,Math.max(0,PET_ACTIONS[motion] ? actionProgress : gestureProgress));
  if (p===0 || p===1) return {lift:0,squash:0,lean:0};
  let lift=0, squash=0, lean=0;
  if (['hop','play','celebrate'].includes(action)) {
    const cycles=action === 'play' ? 2 : 1, q=p*cycles%1;
    if (p>0 && p<1) {
      if (q<.22) squash=Math.sin(q/.22*Math.PI)*.055;
      else if(q<.72) lift=Math.sin((q-.22)/.5*Math.PI)*.032*(action === 'play' && p>.5 ? .8 : 1);
      else squash=Math.sin((q-.72)/.28*Math.PI)*.025;
    }
  }
  if (action === 'nuzzle' || action === 'pet') lean=Math.sin(p*Math.PI*2)*Math.sin(p*Math.PI)**2*.016;
  return {lift,squash,lean};
}

function canvas(size) { const node = document.createElement('canvas'); node.width = node.height = size; return node; }
function triangle(ctx, source, src, dst) {
  const [[x0,y0],[x1,y1],[x2,y2]] = src, [[u0,v0],[u1,v1],[u2,v2]] = dst;
  const det = (x1-x0)*(y2-y0) - (x2-x0)*(y1-y0);
  const a = ((u1-u0)*(y2-y0) - (u2-u0)*(y1-y0))/det;
  const b = ((v1-v0)*(y2-y0) - (v2-v0)*(y1-y0))/det;
  const c = ((u2-u0)*(x1-x0) - (u1-u0)*(x2-x0))/det;
  const d = ((v2-v0)*(x1-x0) - (v1-v0)*(x2-x0))/det;
  ctx.save(); ctx.beginPath();
  // A subpixel overlap avoids hairline cracks between adjacent triangles at phone DPRs.
  const cx = (u0+u1+u2)/3, cy = (v0+v1+v2)/3;
  for (let i=0; i<3; i++) {
    const [u,v] = dst[i], length = Math.hypot(u-cx, v-cy);
    const px = u + (u-cx)/length * .9, py = v + (v-cy)/length * .9;
    if (i === 0) ctx.moveTo(px,py); else ctx.lineTo(px,py);
  }
  ctx.closePath(); ctx.clip(); ctx.setTransform(a,b,c,d,u0-a*x0-c*y0,v0-b*x0-d*y0);
  // Sample the complete texture: cropping each cell would clip its filtering/overlap margin.
  ctx.drawImage(source,0,0); ctx.restore();
}
function warp(ctx, source, config) {
  const size = source.width, n = 10, step = size/n, points = [];
  const root=petRoot(config), framing=PET_FRAMING[config.id];
  ctx.clearRect(0,0,size,size);
  for (let y=0; y<=n; y++) for (let x=0; x<=n; x++) {
    const [u,v]=petVertex(x/n,y/n,config);
    const px=(.5+(u-.5)*(1+root.squash*.55)+(1-v)*root.lean/.92)*size;
    const py=(1+(v-1)*(1-root.squash)-root.lift/.92)*size;
    points.push([framing.origin.x+(px-framing.anchor.x)*framing.camera,framing.origin.y+(py-framing.anchor.y)*framing.camera]);
  }
  for (let y=0; y<n; y++) for (let x=0; x<n; x++) {
    const a=y*(n+1)+x, b=a+1, c=a+n+1, d=c+1, sx=x*step, sy=y*step;
    triangle(ctx,source,[[sx,sy],[sx+step,sy],[sx,sy+step]],[points[a],points[b],points[c]]);
    triangle(ctx,source,[[sx+step,sy+step],[sx,sy+step],[sx+step,sy]],[points[d],points[c],points[b]]);
  }
}

function drawRegistered(ctx, image, framing, clip=null) {
  const size=384;
  ctx.save();ctx.translate(framing.origin.x,framing.origin.y);ctx.scale(framing.camera,framing.camera);
  ctx.rotate(clip?.angle || 0);ctx.scale(1,1+(clip?.scaleY || 0));ctx.translate(-framing.anchor.x,-framing.anchor.y);
  if(clip){
    const row=framing.rows[clip.row];ctx.translate(row.x,row.y);ctx.scale(row.scale,row.scale);
    ctx.drawImage(image,clip.column*size,clip.row*size,size,size,0,0,size,size);
  }else ctx.drawImage(image,0,0,size,size);
  ctx.restore();
}

export function createPetMotion() {
  const size = 384, base = canvas(size), output = canvas(size);
  const baseCtx = base.getContext('2d'), outputCtx = output.getContext('2d');
  const supported = Boolean(baseCtx && outputCtx);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)'), mobile = matchMedia('(max-width: 700px)');
  const cache = new Map(), clipCache = new Map(), stages = new Map(), blink = new PetBlink(), gestures = new PetGestures();
  let state = {}, presentation = petPresentation(), frame = null, clock = 0, lastTime = null, lastPaint = -Infinity;
  let selected = '', face = '', faceSince = 0, pendingFace = '', actionAt = 0, dirty = true, queued = false, disposed = false;
  const moving = () => state.animations !== false && !reduced.matches && !document.hidden;
  const visible = stage => stage.isConnected && stage.getClientRects().length > 0 && !stage.closest('dialog:not([open])') && stages.get(stage)?.visible;
  const activeStages = () => [...stages.keys()].filter(visible);
  function stop() { if (frame !== null) cancelAnimationFrame(frame); frame = null; lastTime = null; }
  function resetIdle() { blink.reset(clock); if (selected) gestures.reset(selected,clock); }
  function load(id) {
    if (cache.has(id)) return cache.get(id);
    const resource = { image: new Image(), ready: false, failed: false }; cache.set(id, resource);
    resource.image.onload = () => {
      resource.ready = resource.image.naturalWidth === size*7 && resource.image.naturalHeight === size;
      resource.failed = !resource.ready; dirty = true; refresh();
    };
    resource.image.onerror = () => { resource.failed = true; refresh(); };
    resource.image.decoding = 'async'; resource.image.src = petSprite(id);
    return resource;
  }
  function loadClips(id) {
    if (clipCache.has(id)) return clipCache.get(id);
    const resource={image:new Image(),ready:false,failed:false}; clipCache.set(id,resource);
    resource.image.onload=()=>{
      resource.ready=resource.image.naturalWidth===size*PET_CLIP_LAYOUT.columns && resource.image.naturalHeight===size*PET_CLIP_LAYOUT.rows;
      resource.failed=!resource.ready;
      // Start a user's first action at its beginning if the artwork arrived during loading.
      if (resource.ready && selected===id && petClipFrame(presentation.motion,0) && clock-actionAt<PET_ACTIONS[presentation.motion].duration) actionAt=clock;
      dirty=true; refresh();
    };
    resource.image.onerror=()=>{resource.failed=true;dirty=true;refresh();};
    resource.image.decoding='async'; resource.image.src=petClipSprite(id);
    return resource;
  }
  function compose(resource, expression, eyelid) {
    baseCtx.clearRect(0,0,size,size);
    baseCtx.drawImage(resource.image,PET_FACES[expression]*size,0,size,size,0,0,size,size);
    if (eyelid !== 'open') baseCtx.drawImage(resource.image,(eyelid === 'half' ? 5 : 6)*size,0,size,size,0,0,size,size);
  }
  function draw() {
    const targets = activeStages(); if (!targets.length) return;
    if (!supported) { for (const stage of targets) stage.dataset.petRenderer='fallback'; return; }
    const resource = cache.get(selected),framing=PET_FRAMING[selected];
    if (!resource?.ready) {
      for (const stage of targets) { stage.dataset.petRenderer = resource?.failed ? 'fallback' : 'loading'; stage.dataset.blink = 'open'; }
      return;
    }
    if (pendingFace && (!moving() || clock-faceSince >= 1400)) { face=pendingFace; pendingFace=''; faceSince=clock; blink.reset(clock); dirty=true; }
    const ambient=gestures.frame(clock,moving() && ['idle','music'].includes(presentation.motion));
    const expression=ambient && face==='natural' && ambient.progress>.1 && ambient.progress<.9 ? PET_ACTIONS[ambient.kind].face : face;
    const actionProgress=Math.min(1,(clock-actionAt)/(PET_ACTIONS[presentation.motion]?.duration || 1400));
    const config={id:selected,time:clock,motion:presentation.motion,actionProgress,gesture:ambient?.kind || '',gestureProgress:ambient?.progress || 0};
    const direct=Boolean(PET_ACTIONS[presentation.motion]);
    const clip=moving() && clipCache.get(selected)?.ready ? petClipFrame(direct?presentation.motion:ambient?.kind,direct?actionProgress:ambient?.progress) : null;
    const eyelid=moving() && !clip ? blink.frame(clock,expression) : 'open';
    if (clip) blink.reset(clock); // Full-body artwork already includes its own face; eye patches are for the resting pose.
    if(!clip || clip.opacity<1)compose(resource,expression,eyelid);
    if (clip) {
      outputCtx.clearRect(0,0,size,size);
      if(clip.opacity<1){outputCtx.globalAlpha=1-clip.opacity;drawRegistered(outputCtx,base,framing);}
      const body=clipCache.get(selected);
      outputCtx.globalAlpha=clip.opacity;
      outputCtx.globalCompositeOperation='lighter';
      drawRegistered(outputCtx,body.image,framing,clip);
      outputCtx.globalCompositeOperation='source-over';outputCtx.globalAlpha=1;
    } else if (moving() && presentation.motion !== 'rest') warp(outputCtx,base,config);
    else { outputCtx.clearRect(0,0,size,size); drawRegistered(outputCtx,base,framing); }
    for (const stage of targets) {
      const record=stages.get(stage), target=record.canvas, width=Math.max(1,Math.min(440,Math.round(stage.clientWidth*Math.min(devicePixelRatio || 1,2)*framing.bleed)));
      if(record.framing!==selected){
        record.framing=selected;
        stage.style.setProperty('--pet-camera-scale',String(framing.bleed));
        stage.style.setProperty('--pet-camera-origin',`${framing.origin.x/size*100}% ${framing.origin.y/size*100}%`);
      }
      if (target.width !== width) target.width=target.height=width;
      const ctx=target.getContext('2d'); if (!ctx) continue;
      ctx.clearRect(0,0,width,width); ctx.drawImage(output,0,0,width,width);
      stage.dataset.petRenderer='canvas'; stage.dataset.expression=expression; stage.dataset.blink=eyelid;
      stage.dataset.petGesture=moving() ? ambient?.kind || (PET_ACTIONS[presentation.motion] ? presentation.motion : 'none') : 'none';
      stage.dataset.petMotion=moving() ? presentation.motion : 'still';
      stage.dataset.petClip=clip?.action || 'none'; stage.dataset.petClipFrame=clip?`${clip.row}:${clip.column}`:'none';
      stage.dataset.petClipProgress=clip?clip.progress.toFixed(3):'0';
    }
    dirty=false;
  }
  function tick(now) {
    frame=null;
    if (!moving() || !activeStages().length || !cache.get(selected)?.ready) { lastTime=null; return; }
    if (lastTime !== null) clock += Math.min(100,now-lastTime);
    lastTime=now;
    const period=1000/(mobile.matches ? 30 : 60), elapsed=now-lastPaint;
    if (dirty || elapsed>=period-.5) {
      const forced=dirty;draw();
      lastPaint=forced||!Number.isFinite(elapsed)?now:lastPaint+Math.max(1,Math.floor((elapsed+.5)/period))*period;
    }
    frame=requestAnimationFrame(tick);
  }
  function wake() {
    if (!activeStages().length) { stop(); resetIdle(); dirty=true; return; }
    if (!supported || !moving()) { stop(); draw(); return; }
    if (dirty) draw();
    if (frame === null && cache.get(selected)?.ready) frame=requestAnimationFrame(tick);
  }
  const observer = new IntersectionObserver(entries => { for (const entry of entries) if (stages.has(entry.target)) stages.get(entry.target).visible=entry.isIntersecting; dirty=true; wake(); });
  function refresh() {
    if (disposed) return;
    queued=false;
    for (const [stage] of stages) if (!stage.isConnected) { observer.unobserve(stage); stages.delete(stage); }
    for (const stage of document.querySelectorAll('[data-pet-portrait]')) {
      if (!stages.has(stage)) {
        const target=document.createElement('canvas'); target.className='pet-motion-canvas'; target.setAttribute('aria-hidden','true'); stage.append(target);
        const box=stage.getBoundingClientRect(); stages.set(stage,{canvas:target,visible:box.width>0 && box.bottom>0 && box.top<innerHeight}); observer.observe(stage);
        if (stage.classList.contains('pet-portrait-large')) gestures.invite(clock);
      }
      stage.dataset.phase=presentation.phase;
    }
    if (supported && selected && stages.size) load(selected);
    if (supported && selected && moving() && activeStages().length && !['rest','comfort','focus','thinking'].includes(presentation.motion)) loadClips(selected);
    dirty=true; wake();
  }
  function queueRefresh() { if (!queued) { queued=true; queueMicrotask(refresh); } }
  const mutations = new MutationObserver(records => {
    if (records.some(record => [...record.addedNodes,...record.removedNodes].some(node => node.nodeType === 1 && (node.matches('[data-pet-portrait]') || node.querySelector('[data-pet-portrait]'))))) queueRefresh();
  });
  mutations.observe(document.body,{childList:true,subtree:true});
  const pause = () => { stop(); resetIdle(); dirty=true; refresh(); };
  document.addEventListener('visibilitychange',pause); reduced.addEventListener('change',pause);
  window.addEventListener('resize',queueRefresh);
  return {
    update(next) {
      if (disposed || !PET_MOTION_PROFILES[next.id]) return;
      const changed=selected !== next.id, old=state;
      state=next; selected=next.id; presentation=petPresentation(next);
      if (changed) { clock=0; face=presentation.face; faceSince=0; pendingFace=''; actionAt=0; resetIdle(); stop(); }
      else if (presentation.face !== face) {
        // New needs and direct interactions take effect immediately; returning to neutral can settle.
        if (presentation.face === 'natural' && moving() && clock-faceSince<1400) pendingFace='natural';
        else { face=presentation.face; faceSince=clock; pendingFace=''; blink.reset(clock); }
      } else pendingFace='';
      if (old.reaction !== next.reaction || old.reactionKey !== next.reactionKey) { actionAt=clock; gestures.suspend(); }
      if (old.animations !== next.animations) { stop(); resetIdle(); }
      dirty=true; queueRefresh();
    },
    refresh: queueRefresh,
    destroy() {
      disposed=true; stop(); observer.disconnect(); mutations.disconnect();
      document.removeEventListener('visibilitychange',pause); reduced.removeEventListener('change',pause); window.removeEventListener('resize',queueRefresh);
      for (const resource of cache.values()) resource.image.onload=resource.image.onerror=null;
      for (const resource of clipCache.values()) resource.image.onload=resource.image.onerror=null;
      for (const [stage,record] of stages) { record.canvas.remove(); delete stage.dataset.petRenderer; }
      stages.clear();
    },
  };
}
