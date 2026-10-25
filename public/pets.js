const $ = (selector, root = document) => root.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const off = value => value ? ' disabled' : '';
const checked = value => value ? ' checked' : '';
const ids = ['cream-cat', 'shiba', 'lop-rabbit', 'little-fox'];
const image = id => `/assets/pets/${id}-v1.png`;
const paw = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><ellipse cx="7" cy="6" rx="2" ry="2.7"/><ellipse cx="17" cy="6" rx="2" ry="2.7"/><ellipse cx="3.8" cy="11" rx="1.8" ry="2.3"/><ellipse cx="20.2" cy="11" rx="1.8" ry="2.3"/><path d="M6 18c0-3 3-6 6-6s6 3 6 6c0 5-4 2-6 2s-6 3-6-2Z"/></svg>';
const action = (label, name, extra = '', busy = false) => `<button type="button" class="button small" data-pet-action="${name}" ${extra}${off(busy)}>${label}</button>`;

export function createPetsUI({ request, toast, redraw }) {
  const state = { info: null, busy: false, feedback: '', error: false, chatting: false, music: false, reaction: '', reactionText: '', timer: null, nameDrafts: new Map() };
  const dialog = document.createElement('dialog'); dialog.id = 'pet-home'; dialog.className = 'pet-home'; dialog.setAttribute('aria-labelledby', 'pet-home-title'); document.body.append(dialog);
  const trigger = document.createElement('button'); trigger.type = 'button'; trigger.className = 'icon-button pet-trigger'; trigger.dataset.petAction = 'open'; trigger.setAttribute('aria-label', '打开宠物小窝'); trigger.title = '宠物小窝'; trigger.innerHTML = paw;
  $('.topbar-tools').prepend(trigger);
  const current = () => state.info?.pets.find(pet => pet.id === state.info.settings.selectedId);
  const phase = () => !state.info?.settings.animations ? 'quiet' : state.reaction || (state.chatting ? 'thinking' : state.music ? 'music' : 'idle');
  const caption = () => state.reactionText || (state.chatting ? '陪你等一等，回复正在路上。' : state.music ? '听着音乐，轻轻晃一晃。' : !state.info?.settings.animations ? '安静地陪你待着。' : '点点我，给我一个摸摸。');
  function portrait(pet, extra = '') {
    return `<span class="pet-portrait ${extra}" data-pet-portrait data-phase="${phase()}"><img src="${image(pet.id)}" alt="${esc(pet.name)}，${esc(pet.species)}" data-pet-image draggable="false" width="192" height="192"><span class="pet-image-fallback" hidden>${paw}<small>形象暂时无法加载</small></span><span class="pet-sparkle" aria-hidden="true">✦</span></span>`;
  }
  function sync(info) {
    if (!info?.settings || !ids.includes(info.settings.selectedId) || !Array.isArray(info.pets) || info.pets.length !== 4 || !Number.isInteger(info.revision)) return;
    if (state.info && info.revision < state.info.revision) return;
    const changed = state.info?.settings.selectedId !== info.settings.selectedId;
    state.info = info;
    if (changed) { clearTimeout(state.timer); state.reaction = ''; state.reactionText = ''; }
    paint();
    if (dialog.open && !state.busy) drawHome();
  }
  function paint() {
    const pet = current();
    trigger.title = pet ? `${pet.name}的宠物小窝` : '宠物小窝';
    if (pet && state.info.settings.enabled) {
      if (!trigger.querySelector('img')) trigger.innerHTML = `<span class="pet-portrait pet-portrait-tiny" data-pet-portrait><img data-pet-image alt="" width="40" height="40"><span class="pet-image-fallback" hidden>${paw}</span></span>`;
    } else if (trigger.querySelector('img')) trigger.innerHTML = paw;
    if (!pet) return;
    for (const stage of document.querySelectorAll('[data-pet-portrait]')) {
      stage.dataset.phase = phase();
      const img = $('img', stage);
      if (img?.getAttribute('src') !== image(pet.id) && !stage.closest('.pet-choice')) { img.src = image(pet.id); img.hidden = false; $('.pet-image-fallback', stage).hidden = true; }
    }
    for (const node of document.querySelectorAll('[data-pet-caption]')) node.textContent = caption();
    for (const node of document.querySelectorAll('[data-pet-points]')) node.textContent = String(pet.bond);
  }
  function react(kind, text = '') {
    if (!current()) return;
    clearTimeout(state.timer); state.reaction = kind; state.reactionText = text; paint();
    state.timer = setTimeout(() => { state.reaction = ''; state.reactionText = ''; paint(); }, 3200);
  }
  function renderCompanion(compact = false) {
    const pet = current(); if (!pet || !state.info.settings.enabled) return '';
    if (compact) return `<div class="pet-mobile-companion" aria-label="聊天宠物"><button type="button" class="pet-touch" data-pet-action="interact" data-pet-interaction="pet" data-pet-id="${pet.id}" aria-label="摸摸当前宠物"${off(state.busy)}>${portrait(pet, 'pet-portrait-small')}</button><div><strong>${esc(pet.name)}</strong><span data-pet-caption>${esc(caption())}</span></div><button type="button" class="icon-button" data-pet-action="open" aria-label="打开聊天宠物的小窝">${paw}</button></div>`;
    return `<section class="card pet-companion" aria-label="聊天宠物"><div class="card-header"><h3>陪你待一会儿</h3><span class="pill">${esc(pet.species)}</span></div><button type="button" class="pet-touch" data-pet-action="interact" data-pet-interaction="pet" data-pet-id="${pet.id}" aria-label="摸摸当前宠物"${off(state.busy)}>${portrait(pet)}</button><h3 class="pet-companion-name">${esc(pet.name)}</h3><p class="pet-caption" data-pet-caption>${esc(caption())}</p><div class="pet-companion-actions">${action('摸摸', 'interact', `data-pet-interaction="pet" data-pet-id="${pet.id}"`, state.busy)}${action('小窝', 'open')}</div></section>`;
  }
  function renderSettings() {
    const pet = current();
    return `<section class="card pet-settings-entry"><div><h2>留一只小伙伴，陪你聊天</h2><p>${pet ? `正在陪伴你的是${esc(pet.species)}「${esc(pet.name)}」。${state.info.settings.enabled ? '可以摸摸、喂点心，也可以安静待着。' : '当前已隐藏，可随时在小窝中重新显示。'}` : '奶油猫、柴犬、垂耳兔和小狐狸，选一个喜欢的形象。'}</p></div>${action('打开宠物小窝', 'open')}</section>`;
  }
  function drawHome() {
    const pet = current(), info = state.info;
    dialog.innerHTML = `<header class="dialog-header"><div><h2 id="pet-home-title">给日常，添一点毛茸茸</h2><p class="small muted">四位原创 Q 版小伙伴，挑一位陪你慢慢聊。</p></div><button type="button" class="icon-button" data-pet-action="close" aria-label="关闭宠物小窝">×</button></header>${!pet ? `<div class="pet-home-body"><p role="status">${esc(state.feedback || '正在打开小窝…')}</p></div>` : `<div class="pet-home-body"><div class="pet-home-current"><section class="pet-home-stage" aria-label="当前宠物"><button type="button" class="pet-touch" data-pet-action="interact" data-pet-interaction="pet" data-pet-id="${pet.id}" aria-label="摸摸小窝里的宠物"${off(state.busy)}>${portrait(pet, 'pet-portrait-large')}</button><h3>${esc(pet.name)}<span>${esc(pet.species)}</span></h3><p class="pet-caption" data-pet-caption>${esc(caption())}</p><div class="pet-points"><strong data-pet-points>${pet.bond}</strong><span>陪伴点数</span></div><div class="pet-interactions">${action('摸摸', 'interact', `data-pet-interaction="pet" data-pet-id="${pet.id}"`, state.busy)}${action('喂点心', 'interact', `data-pet-interaction="feed" data-pet-id="${pet.id}"`, state.busy)}${action('玩一会儿', 'interact', `data-pet-interaction="play" data-pet-id="${pet.id}"`, state.busy)}</div></section><section class="pet-home-options"><h3>一起待着的方式</h3><form id="pet-name-form"><div class="field"><label for="pet-name">给它取个名字</label><input id="pet-name" name="name" value="${esc(state.nameDrafts.get(pet.id) ?? pet.name)}" maxlength="20" required${off(state.busy)}><small>每位小伙伴都有自己的名字和互动记录。</small></div><button type="submit" class="button"${off(state.busy)}>保存宠物名字</button></form><div class="pet-preferences"><label class="checkbox-label"><input type="checkbox" id="pet-enabled"${checked(info.settings.enabled)}${off(state.busy)}>在聊天中显示宠物</label><label class="checkbox-label"><input type="checkbox" id="pet-animations"${checked(info.settings.animations)}${off(state.busy)}>开启轻动效</label><p class="small muted">关闭动效后会安静陪伴；系统开启“减少动态效果”时同样静止显示。</p></div><p class="pet-record small">摸摸 ${pet.petCount} 次 · 点心 ${pet.feedCount} 次 · 玩耍 ${pet.playCount} 次</p><p class="small muted">这是本地虚拟宠物。不用打卡，不会因为你暂时离开而扣分。</p></section></div><p class="pet-feedback${state.error ? ' pet-error' : ''}" role="${state.error ? 'alert' : 'status'}">${esc(state.feedback || '点一下形象就能摸摸。每秒最多记录一次互动。')}</p><section class="pet-collection" aria-label="可选宠物"><div class="card-header"><h3>谁来陪你，自己选</h3><span class="small muted">AI 原创生成形象</span></div><div class="pet-choices">${info.pets.map(item => `<button type="button" class="pet-choice${item.id === pet.id ? ' is-selected' : ''}" data-pet-action="select" data-pet-id="${item.id}" aria-pressed="${item.id === pet.id}"${off(state.busy)}><img src="${image(item.id)}" alt="${esc(item.species)}形象" width="144" height="144" loading="lazy" draggable="false"><strong>${esc(item.name)}</strong><span>${esc(item.species)}</span><small>${esc(item.description)}</small></button>`).join('')}</div></section></div>`}`;
  }
  async function mutate(operation, success = '') {
    if (state.busy) return;
    state.busy = true; state.error = false; state.feedback = ''; if (dialog.open) drawHome(); redraw();
    try {
      const result = await operation(); sync(result);
      if (result.interaction) {
        state.feedback = result.interaction.message;
        if (result.interaction.petId === current()?.id) react(result.interaction.action, result.interaction.message);
      } else state.feedback = success;
    } catch (error) { state.error = true; state.feedback = error.message; if (!dialog.open) toast(error.message, 'error'); }
    finally { state.busy = false; if (dialog.open) drawHome(); redraw(); paint(); }
  }
  async function open() {
    state.feedback = ''; state.error = false; drawHome(); if (!dialog.open) dialog.showModal();
    if (!state.info) { try { sync(await request('/pets')); } catch (error) { state.feedback = error.message; state.error = true; drawHome(); } }
  }
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-pet-action]'); if (!button || button.disabled) return;
    const name = button.dataset.petAction;
    if (name === 'open') void open();
    else if (name === 'close') dialog.close();
    else if (name === 'select') void mutate(() => request('/pets/settings', 'PUT', { selectedId: button.dataset.petId }), '小伙伴已经换好啦。');
    else if (name === 'interact') void mutate(() => request('/pets/interact', 'POST', { petId: button.dataset.petId, action: button.dataset.petInteraction }));
  });
  document.addEventListener('input', event => { if (event.target.id === 'pet-name' && current()) state.nameDrafts.set(current().id, event.target.value); });
  document.addEventListener('change', event => {
    if (!['pet-enabled', 'pet-animations'].includes(event.target.id)) return;
    const key = event.target.id === 'pet-enabled' ? 'enabled' : 'animations', value = event.target.checked;
    void mutate(() => request('/pets/settings', 'PUT', { [key]: value }), '陪伴偏好已保存。');
  });
  document.addEventListener('submit', event => {
    if (event.target.id !== 'pet-name-form' || !current()) return; event.preventDefault();
    const petId = current().id, name = $('#pet-name', dialog).value;
    void mutate(async () => { const result = await request(`/pets/${petId}`, 'PUT', { name }); state.nameDrafts.delete(petId); return result; }, '宠物名字已保存。');
  });
  document.addEventListener('error', event => {
    if (!event.target.matches?.('[data-pet-image]')) return;
    const stage = event.target.closest('[data-pet-portrait]'); if (!stage) return;
    event.target.hidden = true; $('.pet-image-fallback', stage).hidden = false;
  }, true);
  const audio = $('#background-audio');
  for (const event of ['playing', 'pause', 'ended', 'emptied']) audio?.addEventListener(event, () => { state.music = !audio.paused && !audio.ended; paint(); });
  const pauseHidden = () => { document.body.dataset.petSuspended = String(document.hidden); };
  document.addEventListener('visibilitychange', pauseHidden); pauseHidden();
  return { sync, renderCompanion, renderSettings, react, setChatState: value => { state.chatting = Boolean(value); paint(); }, isBusy: () => state.busy || dialog.open };
}
