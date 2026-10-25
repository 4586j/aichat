const $ = (selector, root = document) => root.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const checked = value => value ? ' checked' : '';
const disabled = value => value ? ' disabled' : '';
const symbol = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${({music:'<path d="M9 18V5l12-2v13M9 8l12-2"/><ellipse cx="6" cy="18" rx="3" ry="3"/><ellipse cx="18" cy="16" rx="3" ry="3"/>',play:'<path d="m9 5 10 7-10 7Z"/>',pause:'<path d="M8 5v14M16 5v14"/>',close:'<path d="m6 6 12 12M6 18 18 6"/>',prev:'<path d="M5 5v14m14-14L8 12l11 7Z"/>',next:'<path d="M19 5v14M5 5l11 7-11 7Z"/>',plus:'<path d="M12 5v14M5 12h14"/>'})[name] || ''}</svg>`;
const actionButton = (label, action, extra = '', primary = false) => `<button type="button" class="button ${primary?'primary ':''}small" data-media-action="${action}" ${extra}>${label}</button>`;
const stickerUrl = id => `/api/media/sticker-image?id=${encodeURIComponent(id)}`;
const validStickerId = id => typeof id==='string' && /^(leaf-[a-z]+|upload-[a-f0-9]{64}|remote-[a-f0-9]{64})$/u.test(id);
const validSongId = id => typeof id==='string' && /^[a-f0-9]{64}$/u.test(id);
const clock = time => {time=Number.isFinite(time)?Math.max(0,time):0;return `${Math.floor(time/60)}:${String(Math.floor(time%60)).padStart(2,'0')}`;};

export function renderAttachments(attachments) {
  if(!Array.isArray(attachments))return '';
  return attachments.slice(0,2).map(item=>{
    if(item?.type==='sticker' && validStickerId(item.id)) {
      const manual=Boolean(item.animated);
      return `<figure class="reply-sticker"><div class="sticker-image-wrap">${manual?`<button type="button" class="sticker-reveal" data-media-action="show-sticker" data-sticker-id="${item.id}" aria-label="查看表情：${esc(item.name)}">${symbol('play')}<span>${esc(item.name)}<small>点击查看动图</small></span></button>`:`<img src="${stickerUrl(item.id)}" alt="${esc(item.name)}" width="160" height="160" loading="lazy">`}<span class="sticker-fallback" hidden>表情暂时无法加载</span></div><figcaption>${esc(item.name)}${item.origin==='online'?' · 联网表情':''}</figcaption></figure>`;
    }
    if(item?.type==='song' && validSongId(item.song?.id)) {
      const song=item.song;
      return `<section class="song-recommendation" aria-label="歌曲推荐"><div class="song-record">${symbol('music')}</div><div class="song-description"><span class="media-kicker">给此刻的一首歌</span><h3>${esc(song.title)}</h3><p>${esc(song.artist||'未知歌手')}<span class="song-source">${song.kind==='local'?'本地曲库':song.source==='qq'?'QQ 音乐':'网易云'}</span></p>${item.reason?`<p class="song-reason">${esc(item.reason)}</p>`:''}<div class="card-actions">${actionButton(`${symbol('play')}播放这首歌`,'preview-song',`data-song-id="${song.id}"`,true)}${actionButton('设为背景音乐','background-song',`data-song-id="${song.id}"`)}</div></div></section>`;
    }
    if(item?.type==='song-search' && typeof item.query==='string')return `<section class="song-recommendation song-pending" aria-label="待查询的歌曲推荐"><div class="song-record">${symbol('music')}</div><div class="song-description"><span class="media-kicker">音乐推荐</span><h3>${esc(item.query)}</h3>${item.reason?`<p>${esc(item.reason)}</p>`:''}<p class="small muted">${esc(item.message)}</p>${actionButton('打开音乐搜索','song-search',`data-query="${esc(item.query)}"`)}</div></section>`;
    return '';
  }).join('');
}

export function createMediaUI({request,toast,redraw}) {
  const state={info:null,draft:null,dirty:false,revision:0,busy:false,querySequence:0,playSequence:0,queue:[],index:-1,current:null,mode:'background',resume:null,pendingSeek:null,stickerDrafts:new Map()};
  let preferences={volume:.2,loop:'list'};
  try {const value=JSON.parse(localStorage.getItem('qiyi-music-preferences')||'{}');if(Number.isFinite(value.volume)&&value.volume>=0&&value.volume<=1)preferences.volume=value.volume;if(['list','one','none'].includes(value.loop))preferences.loop=value.loop;}catch{}
  const savePreferences=()=>{try{localStorage.setItem('qiyi-music-preferences',JSON.stringify(preferences));}catch{}};
  const settings=()=>state.info?.settings||{};
  const configured=()=>Boolean(settings().musicEnabled&&settings().musicBaseUrl);
  const audio=document.createElement('audio');audio.id='background-audio';audio.preload='none';document.body.append(audio);audio.volume=preferences.volume;
  const dock=document.createElement('aside');dock.id='music-dock';dock.className='music-dock';dock.hidden=true;dock.setAttribute('aria-label','背景音乐播放器');
  dock.innerHTML=`<button type="button" class="player-record" data-media-action="open-music" aria-label="打开音乐与播放队列">${symbol('music')}</button><div class="player-track"><strong id="player-title">选择一首音乐</strong><span id="player-artist"></span><span id="player-state" role="status"></span></div><div class="player-transport"><button type="button" class="icon-button" data-media-action="previous" aria-label="上一首">${symbol('prev')}</button><button id="player-toggle" type="button" class="player-toggle" data-media-action="toggle-play" aria-label="播放音乐">${symbol('play')}</button><button type="button" class="icon-button" data-media-action="next" aria-label="下一首">${symbol('next')}</button></div><div class="player-progress"><label class="sr-only" for="player-seek">音乐进度</label><input id="player-seek" type="range" min="0" max="100" step=".1" value="0" disabled><span id="player-time">0:00 / 0:00</span></div><label class="player-volume">音量<input id="player-volume" aria-label="音乐音量" type="range" min="0" max="1" step=".05" value="${preferences.volume}"></label><select id="player-loop" aria-label="循环方式"><option value="list">列表循环</option><option value="one">单曲循环</option><option value="none">不循环</option></select><button type="button" class="icon-button" data-media-action="close-player" aria-label="停止并关闭播放器">${symbol('close')}</button>`;
  document.body.append(dock);
  const browser=document.createElement('dialog');browser.id='music-browser';browser.className='music-browser';browser.setAttribute('aria-labelledby','music-browser-title');
  browser.innerHTML=`<header class="dialog-header"><div><h2 id="music-browser-title">给思绪一点旋律</h2><p class="small muted">本地曲库优先，喜欢的歌可以慢慢排进队列。</p></div><button type="button" class="icon-button" data-media-action="close-music" aria-label="关闭音乐面板">${symbol('close')}</button></header><div class="music-browser-body"><div id="music-service-state" class="notice"></div><form id="music-search-form" class="music-search-form"><div class="field"><label for="music-query">搜索歌曲或歌手</label><input id="music-query" maxlength="120" placeholder="输入歌名、歌手，或想听的风格"></div><div class="field"><label for="music-search-source">在线补充来源</label><select id="music-search-source"><option value="qq">QQ 音乐</option><option value="netease">网易云</option><option value="local">仅本地曲库</option></select></div><button type="submit" class="button primary" id="music-search-submit">搜索歌曲</button></form><div class="music-browser-actions">${actionButton('浏览本地曲库','music-library')}${actionButton('配置音乐服务','media-settings')}</div><p id="music-search-feedback" class="small muted" role="status"></p><div id="music-results" class="music-results"></div><section class="music-queue"><div class="card-header"><h3>接下来听</h3>${actionButton('清空待播','clear-queue')}</div><ol id="music-queue-list"></ol></section></div>`;
  document.body.append(browser);
  const playbackOptions=document.createElement('div');playbackOptions.className='music-playback-options';
  playbackOptions.innerHTML=`<label for="browser-volume">播放音量<input id="browser-volume" aria-label="播放面板音量" type="range" min="0" max="1" step=".05" value="${preferences.volume}"></label><label for="browser-loop">播放方式<select id="browser-loop"><option value="list">列表循环</option><option value="one">单曲循环</option><option value="none">不循环</option></select></label>`;
  $('.music-browser-actions',browser).after(playbackOptions);

  function notifyLayout(){document.body.dataset.musicPlayer=String(!dock.hidden);window.dispatchEvent(new Event('qiyi-player-layout'));}
  function setFeedback(id,message,error=false){const element=document.getElementById(id);if(element){element.textContent=message;element.classList.toggle('media-error',error);}}
  function status(message){$('#player-state').textContent=message;}
  function drawPlayer(){
    $('#player-title').textContent=state.current?.title||'选择一首音乐';$('#player-artist').textContent=state.current?.artist||'';
    const button=$('#player-toggle');button.innerHTML=symbol(audio.paused?'play':'pause');button.setAttribute('aria-label',audio.paused?'播放音乐':'暂停音乐');
    $('#player-loop').value=preferences.loop;$('#browser-loop').value=preferences.loop;audio.loop=state.mode==='background'&&preferences.loop==='one';
  }
  function drawQueue(){
    $('#music-queue-list').innerHTML=state.queue.length?state.queue.map((song,i)=>`<li class="${i===state.index?'is-current':''}"><button type="button" data-media-action="queue-play" data-index="${i}"><span>${esc(song.title)}</span><small>${esc(song.artist||'未知歌手')}</small></button><button type="button" class="icon-button" data-media-action="queue-remove" data-index="${i}" aria-label="移出队列：${esc(song.title)}">${symbol('close')}</button></li>`).join(''):'<li class="queue-empty">还没有待播歌曲。搜索一首，或从聊天推荐中加入。</li>';
  }
  function resetPlayer(){state.playSequence++;state.resume=null;state.current=null;state.pendingSeek=null;audio.pause();audio.removeAttribute('src');audio.load();dock.hidden=true;notifyLayout();drawPlayer();}
  function sync(info){
    if(!info?.settings||!Array.isArray(info.stickers))return;
    const previous=state.info?.settings;state.info=info;
    if(previous&&(previous.musicBaseUrl!==info.settings.musicBaseUrl||!info.settings.musicEnabled)){resetPlayer();state.queue=[];state.index=-1;state.querySequence++;$('#music-results').replaceChildren();drawQueue();}
    if(!state.dirty)state.draft=null;
    if(browser.open)updateBrowserStatus();
  }
  function draft(){return state.draft ||= {...settings(),stickerImageOrigins:(settings().stickerImageOrigins||[]).join('\n'),musicApiKey:'',stickerApiKey:'',clearMusicApiKey:false,clearStickerApiKey:false};}
  function updateBrowserStatus(){
    const ready=configured();$('#music-service-state').textContent=ready?'使用已保存的音乐服务。本地曲库没有匹配时，再搜索在线来源。':settings().musicEnabled===false?'音乐功能已关闭，可在设置中重新开启。':'音乐服务未配置。请先在设置中填写你的音乐平台地址，保存后再搜索或播放。';
    $('#music-search-submit').disabled=!ready; $('[data-media-action="music-library"]',browser).disabled=!ready;
  }
  function openMusic(query=''){
    updateBrowserStatus();$('#music-search-source').value=settings().musicSource||'qq';
    if(query)$('#music-query').value=query;
    drawQueue();if(!browser.open)browser.showModal();
    if(query&&configured())void search(query);
  }
  function openSettings(){browser.close();location.hash='settings';requestAnimationFrame(()=>document.getElementById('media-settings')?.scrollIntoView({block:'start',behavior:'smooth'}));}
  async function search(query){
    if(!configured()){updateBrowserStatus();return;}
    const sequence=++state.querySequence;$('#music-search-submit').disabled=true;setFeedback('music-search-feedback','正在查找可用曲目…');
    try{
      const result=await request(`/music/search?q=${encodeURIComponent(query)}&source=${encodeURIComponent($('#music-search-source').value)}`);
      if(sequence!==state.querySequence)return;
      $('#music-results').innerHTML=(result.songs||[]).map(song=>`<article class="music-result"><div class="song-record">${symbol('music')}</div><div><strong>${esc(song.title)}</strong><p>${esc(song.artist||'未知歌手')} · ${song.kind==='local'?'本地曲库':song.source==='qq'?'QQ 音乐':'网易云'}</p></div><div class="card-actions">${actionButton('播放','background-song',`data-song-id="${esc(song.id)}"`,true)}${actionButton(`${symbol('plus')}待播`,'enqueue-song',`data-song-id="${esc(song.id)}"`)}</div></article>`).join('');
      setFeedback('music-search-feedback',result.songs?.length?`找到 ${result.songs.length} 首${result.source==='local'?'本地':'在线'}歌曲。`:'没有找到匹配歌曲，试试歌名与歌手。');
    }catch(error){if(sequence===state.querySequence){$('#music-results').replaceChildren();setFeedback('music-search-feedback',error.message,true);}}
    finally{if(sequence===state.querySequence)$('#music-search-submit').disabled=!configured();}
  }
  async function songById(id){if(!validSongId(id))throw new Error('歌曲标识无效，请重新搜索。');return (await request(`/music/song?id=${id}`)).song;}
  async function startSong(song,mode='background',resumeTime=0,onReady){
    const sequence=++state.playSequence;
    // Revalidate persisted cards against the current service before touching the player.
    const verified=await songById(song.id);if(sequence!==state.playSequence)return;
    onReady?.(verified);
    state.current=verified;state.mode=mode;state.pendingSeek=resumeTime||null;dock.hidden=false;notifyLayout();
    audio.src=`/api/music/stream?id=${encodeURIComponent(verified.id)}`;drawPlayer();status('正在加载音源…');
    try{await audio.play();if(sequence===state.playSequence)status(mode==='preview'?'正在播放推荐歌曲':'背景音乐播放中');}
    catch(error){if(sequence===state.playSequence){status(error.name==='NotAllowedError'?'请点击播放按钮开始播放。':'暂时无法播放，请检查音乐服务与音源。');drawPlayer();}}
  }
  async function selectSong(id,mode){
    const song={id};
    if(mode==='preview'){
      await startSong(song,'preview',0,()=>{
        if(state.mode!=='preview')state.resume=state.current&&!audio.paused?{song:state.current,time:audio.currentTime,queue:[...state.queue],index:state.index}:null;
      });
    }else{
      await startSong(song,'background',0,item=>{
        state.resume=null;let index=state.queue.findIndex(s=>s.id===id);if(index<0){state.queue.push(item);index=state.queue.length-1;}state.index=index;drawQueue();
      });
    }
  }
  async function step(delta){state.resume=null;if(!state.queue.length)return;state.index=(state.index+delta+state.queue.length)%state.queue.length;drawQueue();await startSong(state.queue[state.index]);}
  audio.addEventListener('playing',()=>{drawPlayer();status(state.mode==='preview'?'正在播放推荐歌曲':'背景音乐播放中');});
  audio.addEventListener('pause',()=>{drawPlayer();if(state.current&&!audio.ended)status('已暂停');});
  audio.addEventListener('waiting',()=>{if(state.current)status('正在缓冲…');});
  audio.addEventListener('error',()=>{if(state.current){state.resume=null;status('音源不可用或音乐服务连接失败，请重新搜索。');drawPlayer();}});
  audio.addEventListener('loadedmetadata',()=>{if(state.pendingSeek!==null){try{audio.currentTime=state.pendingSeek;}catch{}state.pendingSeek=null;}});
  audio.addEventListener('timeupdate',()=>{const duration=audio.duration;$('#player-time').textContent=`${clock(audio.currentTime)} / ${clock(duration)}`;const seek=$('#player-seek');seek.disabled=!Number.isFinite(duration)||duration<=0;seek.value=seek.disabled?0:(audio.currentTime/duration*100);});
  audio.addEventListener('ended',()=>{
    if(state.mode==='preview'){
      const restore=state.resume;state.resume=null;
      if(restore){state.queue=restore.queue;state.index=restore.index;drawQueue();void startSong(restore.song,'background',restore.time).catch(e=>toast(e.message,'error'));}
      else{drawPlayer();status('播放结束');}
    }else if(preferences.loop==='list'&&state.queue.length)void step(1).catch(e=>toast(e.message,'error'));
    else{drawPlayer();status('播放结束');}
  });
  $('#player-volume').addEventListener('input',event=>{audio.volume=Number(event.target.value);preferences.volume=audio.volume;savePreferences();});
  $('#player-loop').addEventListener('change',event=>{preferences.loop=event.target.value;savePreferences();drawPlayer();});
  $('#player-seek').addEventListener('input',event=>{if(Number.isFinite(audio.duration))audio.currentTime=audio.duration*Number(event.target.value)/100;});
  $('#browser-volume').addEventListener('input',event=>{audio.volume=Number(event.target.value);preferences.volume=audio.volume;$('#player-volume').value=audio.volume;savePreferences();});
  $('#player-volume').addEventListener('input',()=>{$('#browser-volume').value=audio.volume;});
  $('#browser-loop').addEventListener('change',event=>{preferences.loop=event.target.value;savePreferences();drawPlayer();});

  async function saveMedia(form){
    if(state.busy)return;state.busy=true;const version=state.revision,payload={...draft()};
    payload.stickerImageOrigins=payload.stickerImageOrigins.split(/[\n,]/u).map(s=>s.trim()).filter(Boolean);
    $('button[type="submit"]',form).disabled=true;setFeedback('media-settings-feedback','正在保存…');
    try{
      const info=await request('/media/settings','PUT',payload);
      if(payload.musicApiKey?.trim()||payload.clearMusicApiKey)resetPlayer();
      if(version===state.revision){state.dirty=false;state.draft=null;}
      else{for(const key of ['musicApiKey','stickerApiKey'])if(state.draft[key]===payload[key])state.draft[key]='';}
      sync(info);redraw();toast('媒体设置已保存。音乐连接不会自动测试。');
    }catch(error){setFeedback('media-settings-feedback',error.message,true);}
    finally{state.busy=false;const submit=$('#media-settings-form button[type="submit"]');if(submit)submit.disabled=false;}
  }
  async function uploadSticker(form){
    if(state.busy)return;
    const file=$('#sticker-file',form).files[0];if(!file)throw new Error('请先选择一张表情图片。');if(file.size>4*1024*1024)throw new Error('表情图片不能超过 4 MiB。');
    state.busy=true;$('fieldset',form).disabled=true;setFeedback('sticker-upload-feedback','正在保存表情…');
    try{
      const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(new Error('图片读取失败。'));reader.readAsDataURL(file);});
      const info=await request('/media/stickers','POST',{name:form.elements.name.value.trim(),description:form.elements.description.value.trim(),tags:form.elements.tags.value.trim(),scene:form.elements.scene.value,intensity:Number(form.elements.intensity.value),data});
      sync(info);redraw();toast('表情已加入本地图库，AI 可以按标签选图。');
    }catch(error){setFeedback('sticker-upload-feedback',error.message,true);}
    finally{state.busy=false;const fieldset=$('#sticker-upload-form fieldset');if(fieldset)fieldset.disabled=false;}
  }
  document.addEventListener('input',event=>{const input=event.target;if(input.closest('#media-settings-form')&&input.name){draft()[input.name]=input.type==='checkbox'?input.checked:input.value;state.dirty=true;state.revision++;}const edit=input.closest('[data-sticker-edit]');if(edit&&input.name){const id=edit.dataset.stickerEdit;const value=state.stickerDrafts.get(id)||{...state.info.stickers.find(s=>s.id===id)};value[input.name]=input.value;state.stickerDrafts.set(id,value);}});
  document.addEventListener('change',event=>{const input=event.target;if(input.closest('#media-settings-form')&&input.name){draft()[input.name]=input.type==='checkbox'?input.checked:input.value;state.dirty=true;state.revision++;}});
  document.addEventListener('submit',event=>{
    const form=event.target;
    if(form.id==='media-settings-form'){event.preventDefault();void saveMedia(form);}
    else if(form.id==='sticker-upload-form'){event.preventDefault();void uploadSticker(form).catch(e=>toast(e.message,'error'));}
    else if(form.id==='music-search-form'){event.preventDefault();void search($('#music-query').value.trim());}
    else if(form.matches('[data-sticker-edit]')){event.preventDefault();if(state.busy)return;state.busy=true;const payload={name:form.elements.name.value,description:form.elements.description.value,tags:form.elements.tags.value,scene:form.elements.scene.value,intensity:Number(form.elements.intensity.value)};void request(`/media/stickers/${form.dataset.stickerEdit}`,'PUT',payload).then(info=>{state.stickerDrafts.delete(form.dataset.stickerEdit);sync(info);redraw();toast('表情说明已保存。');}).catch(e=>toast(e.message,'error')).finally(()=>{state.busy=false;});}
  });
  document.addEventListener('error',event=>{const image=event.target;if(image.matches?.('.reply-sticker img,.sticker-thumb img')){image.hidden=true;const fallback=image.parentElement.querySelector('.sticker-fallback');if(fallback)fallback.hidden=false;}},true);
  document.addEventListener('click',async event=>{
    const control=event.target.closest('[data-media-action]');if(!control||control.disabled)return;
    const action=control.dataset.mediaAction;
    try{
      if(action==='open-music')openMusic();
      else if(action==='close-music')browser.close();
      else if(action==='media-settings')openSettings();
      else if(action==='music-library')await search('');
      else if(action==='song-search')openMusic(control.dataset.query||'');
      else if(action==='preview-song'||action==='background-song')await selectSong(control.dataset.songId,action==='preview-song'?'preview':'background');
      else if(action==='enqueue-song'){const song=await songById(control.dataset.songId);if(!state.queue.some(s=>s.id===song.id))state.queue.push(song);drawQueue();toast('已加入待播队列。');}
      else if(action==='toggle-play'){
        if(!state.current)return;
        if(!audio.paused){state.playSequence++;state.resume=null;audio.pause();}
        else{try{await audio.play();}catch{status('无法播放，请检查音乐服务或重新搜索。');drawPlayer();}}
      }
      else if(action==='close-player')resetPlayer();
      else if(action==='previous')await step(-1);
      else if(action==='next')await step(1);
      else if(action==='clear-queue'){state.queue=state.current?[state.current]:[];state.index=state.current?0:-1;state.resume=null;drawQueue();}
      else if(action==='queue-play'){const index=Number(control.dataset.index);if(state.queue[index]){state.index=index;state.resume=null;drawQueue();await startSong(state.queue[index]);}}
      else if(action==='queue-remove'){const index=Number(control.dataset.index);if(state.queue[index]){state.queue.splice(index,1);if(index<state.index)state.index--;else if(index===state.index)state.index=-1;state.resume=null;drawQueue();}}
      else if(action==='show-sticker'){
        if(!validStickerId(control.dataset.stickerId))return;const image=document.createElement('img');image.src=stickerUrl(control.dataset.stickerId);image.alt=control.getAttribute('aria-label').replace('查看表情：','');image.width=160;image.height=160;control.replaceWith(image);
      }
      else if(action==='music-test'){
        if(state.busy)return;state.busy=true;control.disabled=true;setFeedback('media-settings-feedback','正在测试已保存的音乐连接…');
        try{const result=await request('/music/status');setFeedback('media-settings-feedback',result.message,!result.configured);}catch(e){setFeedback('media-settings-feedback',e.message,true);}finally{state.busy=false;control.disabled=false;}
      }
      else if(action==='sticker-toggle'||action==='sticker-delete'){
        if(state.busy)return;const sticker=state.info.stickers.find(s=>s.id===control.dataset.stickerId);if(!sticker)return;
        if(action==='sticker-delete'&&!confirm('永久删除这张表情？历史消息将保留说明，但不能再加载该图片。'))return;
        state.busy=true;try{const info=await request(`/media/stickers/${sticker.id}`,action==='sticker-delete'?'DELETE':'PUT',action==='sticker-delete'?{}:{enabled:!sticker.enabled});sync(info);redraw();}finally{state.busy=false;}
      }
    }catch(error){toast(error.message||'媒体操作未完成，请重试。','error');}
  });

  function profileFields(value, prefix) {
    return `<div class="field"><label for="${prefix}-scene">${prefix === 'sticker' ? '表情联动场景' : '联动场景'}</label><select id="${prefix}-scene" name="scene">${Object.entries(state.info?.stickerScenes || {general:'通用'}).map(([id,label])=>`<option value="${id}"${(value?.scene || 'general') === id ? ' selected' : ''}>${esc(label)}</option>`).join('')}</select></div><div class="field"><label for="${prefix}-intensity">${prefix === 'sticker' ? '表情表达强度' : '表达强度'}</label><select id="${prefix}-intensity" name="intensity">${[1,2,3].map(n=>`<option value="${n}"${Number(value?.intensity || 2) === n ? ' selected' : ''}>${n} · ${n===1?'轻柔':n===2?'明显':'强烈'}</option>`).join('')}</select></div>`;
  }
  function renderSettings(){
    if(!state.info)return '';
    const d=draft(),stickers=state.info.stickers;
    return `<section id="media-settings" class="media-settings"><div class="card-header"><div><h2>让对话多一点表达</h2><p class="small muted">用一张表情回应此刻，用一首歌陪伴思绪。</p></div><span class="pill">本地优先</span></div><form id="media-settings-form"><div class="media-settings-grid"><section class="card settings-card"><h3>表情包</h3><label class="checkbox-label"><input type="checkbox" name="stickersEnabled"${checked(d.stickersEnabled)}>允许 AI 搭配表情包</label><p class="small muted">先从启用的本地图库选图，每次最多一张；不合适时可以不发送。</p><label class="checkbox-label"><input type="checkbox" name="stickerOnlineEnabled"${checked(d.stickerOnlineEnabled)}>本地没有合适表情时，允许联网补充</label><div class="field"><label for="sticker-search-url">表情检索服务地址</label><input id="sticker-search-url" name="stickerSearchUrl" type="url" maxlength="500" value="${esc(d.stickerSearchUrl)}" placeholder="填写你有权使用的表情检索接口"><small>留空时只使用本地图库。接口协议见 README；不会自动接入其他图源。</small></div><div class="field"><label for="sticker-image-origins">额外允许的图片来源</label><textarea id="sticker-image-origins" name="stickerImageOrigins" rows="2" placeholder="每行一个完整来源，例如 https://images.example.com">${esc(d.stickerImageOrigins)}</textarea><small>默认允许检索服务自身的来源，其他图片域名需在这里添加，最多 8 个。</small></div><div class="field"><label for="sticker-api-key">表情服务 API Key</label><input id="sticker-api-key" type="password" name="stickerApiKey" value="${esc(d.stickerApiKey)}" autocomplete="new-password" placeholder="${settings().hasStickerApiKey?'已配置，留空保留':'可选'}"></div><label class="checkbox-label"><input type="checkbox" name="clearStickerApiKey"${checked(d.clearStickerApiKey)}>清除运行期表情密钥</label></section><section class="card settings-card"><h3>你的音乐平台</h3><label class="checkbox-label"><input type="checkbox" name="musicEnabled"${checked(d.musicEnabled)}>允许歌曲推荐与背景播放</label><div class="field"><label for="music-base-url">音乐服务地址</label><input id="music-base-url" name="musicBaseUrl" type="url" maxlength="500" value="${esc(d.musicBaseUrl)}" placeholder="先留空，准备好后再填写"><small>使用你现有的音乐平台。地址为空时不会连接、搜索或读取曲库。</small></div><div class="field"><label for="music-api-key">音乐服务 API Key</label><input id="music-api-key" type="password" name="musicApiKey" value="${esc(d.musicApiKey)}" autocomplete="new-password" placeholder="${settings().hasMusicApiKey?'已配置，留空保留':'服务开启鉴权时填写'}"></div><label class="checkbox-label"><input type="checkbox" name="clearMusicApiKey"${checked(d.clearMusicApiKey)}>清除运行期音乐密钥</label><div class="field"><label for="music-default-source">在线补充来源</label><select id="music-default-source" name="musicSource"><option value="qq"${d.musicSource==='qq'?' selected':''}>QQ 音乐</option><option value="netease"${d.musicSource==='netease'?' selected':''}>网易云</option></select><small>先查本地曲库，没有匹配时再使用选定来源。</small></div><div class="card-actions">${actionButton('测试已保存的音乐连接','music-test')}${actionButton('打开音乐面板','open-music')}</div><p class="small muted">${settings().musicBaseUrl?'音乐地址已保存，尚不代表连接或音源可用。':'音乐服务未配置。'} 音乐需要点击播放；切换页面不会中断。两种服务的 API Key 仅保留在服务进程内。</p></section></div><div id="media-settings-feedback" class="small muted" role="status"></div><div class="media-save-row"><span class="small muted">${state.dirty?'有尚未保存的媒体设置':'设置保存在本地，不会自动测试连接'}</span><button type="submit" class="button primary"${disabled(state.busy)}>保存媒体设置</button></div></form><section class="card sticker-library"><div class="card-header"><div><h3>本地表情图库</h3><p class="small muted">${stickers.filter(s=>s.enabled).length} 张已启用 · 内置小叶贴纸为原创矢量素材</p></div></div><form id="sticker-upload-form"><fieldset><div class="sticker-upload-grid"><div class="field"><label for="sticker-file">选择表情图片</label><input id="sticker-file" type="file" accept="image/png,image/jpeg,image/gif,image/webp" required><small>PNG、JPEG、GIF、WebP；每张最多 4 MiB，图库合计 64 MiB。</small></div><div class="field"><label for="sticker-name">表情名称</label><input id="sticker-name" name="name" maxlength="60" required placeholder="例如：猫猫点头"></div><div class="field"><label for="sticker-description">使用场景</label><input id="sticker-description" name="description" maxlength="300" placeholder="例如：表示同意、认可和鼓励"></div><div class="field"><label for="sticker-tags">标签</label><input id="sticker-tags" name="tags" maxlength="160" placeholder="用空格分隔，例如：猫咪 同意 点头"></div>${profileFields({}, 'sticker')}</div><button type="submit" class="button">加入本地图库</button></fieldset><p id="sticker-upload-feedback" class="small muted" role="status"></p></form><div class="sticker-grid">${stickers.map(s=>`<article class="sticker-tile ${s.enabled?'':'is-disabled'}" data-sticker-id="${s.id}"><div class="sticker-thumb">${s.animated?`<span class="sticker-motion-label">${symbol('play')}动图 · 点击查看</span>${actionButton('预览','show-sticker',`data-sticker-id="${s.id}" aria-label="查看表情：${esc(s.name)}"`)}`:`<img src="${stickerUrl(s.id)}" alt="${esc(s.name)}表情预览" width="100" height="100" loading="lazy">`}<span class="sticker-fallback" hidden>图片已不可用</span></div><strong>${esc(s.name)}</strong><p>${esc(s.description||s.tags||'尚未填写使用场景')}</p><div class="card-actions">${actionButton(s.enabled?'停用':'启用','sticker-toggle',`data-sticker-id="${s.id}" aria-label="${s.enabled?'停用':'启用'}${esc(s.name)}"`)}${!s.builtin?actionButton('删除','sticker-delete',`data-sticker-id="${s.id}"`):'<span class="micro muted">内置</span>'}</div><details class="sticker-edit"><summary>编辑名称与标签</summary><form data-sticker-edit="${s.id}"><label>名称<input name="name" value="${esc(state.stickerDrafts.get(s.id)?.name ?? s.name)}" maxlength="60" required></label><label>场景说明<textarea name="description" maxlength="300" rows="2">${esc(state.stickerDrafts.get(s.id)?.description ?? s.description)}</textarea></label><label>标签<input name="tags" value="${esc(state.stickerDrafts.get(s.id)?.tags ?? s.tags)}" maxlength="160"></label>${profileFields(state.stickerDrafts.get(s.id) || s, `sticker-${s.id}`)}<button class="button small" type="submit">保存表情说明</button></form></details></article>`).join('')}</div></section></section>`;
  }
  return {sync,renderSettings,isBusy:()=>state.busy||state.dirty||state.stickerDrafts.size>0||Boolean($('#sticker-file')?.files.length),openMusic};
}
