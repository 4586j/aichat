const $ = (selector, root = document) => root.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const off = value => value ? ' disabled' : '';
const check = value => value ? ' checked' : '';
const KEYS = ['emotion', 'energy', 'need', 'roleMood', 'proactivity'];
const confidence = { unknown: '尚无判断', low: '把握偏低', medium: '把握中等', high: '把握较高', confirmed: '由你确认' };
const origins = { default: '暂无判断', model: 'AI 推测', manual: '你指定', expired: '已过期' };
const keyOf = context => context?.conversationId || `new:${context?.personaId || ''}`;
const when = value => value ? new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '';

export function createChatStateUI({ request, redraw, onSaved }) {
  const state = { context: null, cache: new Map(), pending: new Map(), token: '', form: null, busy: false, error: '', timer: null, offset: 0 };
  const dialog = document.createElement('dialog'); dialog.id = 'chat-state-dialog'; dialog.className = 'chat-state-dialog'; dialog.setAttribute('aria-labelledby', 'chat-state-title'); document.body.append(dialog);
  function accept(data) {
    if (!data?.personaId || !data.fields || !data.familiarity) return;
    const key = keyOf(data), prior = state.cache.get(key)?.data;
    if (prior && (data.revision < prior.revision || data.familiarity.revision < prior.familiarity.revision || (data.revision === prior.revision && data.familiarity.revision === prior.familiarity.revision && data.serverNow < prior.serverNow))) return;
    state.cache.set(key, { data, loadedAt: Date.now(), offset: data.serverNow - Date.now() });
    if (key === keyOf(state.context)) {
      state.offset = data.serverNow - Date.now(); clearTimeout(state.timer);
      const expires = Object.values(data.fields).map(field => Date.parse(field.expiresAt)).filter(Number.isFinite);
      if (expires.length) state.timer = setTimeout(() => { void load(state.context, true); }, Math.max(100, Math.min(...expires) - data.serverNow + 50));
    }
  }
  async function load(context, force = false) {
    if (!context?.personaId) return null;
    const key = keyOf(context), cached = state.cache.get(key);
    if (!force && cached && Date.now() - cached.loadedAt < 60_000) return cached.data;
    if (state.pending.has(key)) return state.pending.get(key);
    const promise = (async () => {
      try {
        const query = new URLSearchParams({ personaId: context.personaId }); if (context.conversationId) query.set('conversationId', context.conversationId);
        const { chatState } = await request(`/chat-state?${query}`); accept(chatState); return state.cache.get(key)?.data || null;
      } catch (error) { if (key === keyOf(state.context)) state.error = error.message; return null; }
      finally { state.pending.delete(key); if (key === keyOf(state.context)) redraw(); }
    })(); state.pending.set(key, promise); return promise;
  }
  function setContext(context, token) {
    if (!context?.personaId) return;
    const changed = keyOf(context) !== keyOf(state.context), refresh = state.token !== token;
    state.context = { ...context }; state.token = token;
    if (changed) { clearTimeout(state.timer); state.error = ''; }
    if (changed && state.cache.has(keyOf(context))) {
      const cached = state.cache.get(keyOf(context)); state.offset = cached.offset;
      const expires = Object.values(cached.data.fields).map(field => Date.parse(field.expiresAt)).filter(Number.isFinite);
      if (expires.length) state.timer = setTimeout(() => { void load(state.context, true); }, Math.max(100, Math.min(...expires) - Date.now() - state.offset + 50));
    }
    if ((changed || refresh || !state.cache.has(keyOf(context))) && !(state.error && !changed && !refresh)) void load(context, refresh);
  }
  function display() {
    const data = state.cache.get(keyOf(state.context))?.data; if (!data) return null;
    const copy = structuredClone(data), time = Date.now() + state.offset;
    for (const key of KEYS) {
      const field = copy.fields[key]; if (!field.expiresAt || Date.parse(field.expiresAt) > time) continue;
      copy.fields[key] = { value: key === 'emotion' ? ['unknown'] : key === 'roleMood' ? 'persona' : key === 'proactivity' ? 'normal' : 'unknown', intensity: null, origin: 'expired', evidence: [], note: '', confidence: 'unknown', updatedAt: null };
    }
    return copy;
  }
  function label(data, key, field = data.fields[key]) {
    return (Array.isArray(field.value) ? field.value : [field.value]).map(value => data.options[key][value] || '未知').join(' / ');
  }
  function renderBar() {
    const data = display();
    if (!data) return `<button type="button" class="chat-state-bar is-loading" data-state-action="open" aria-label="查看和调整对话状态"><span>对话状态</span><span>${esc(state.error || '正在读取本地状态…')}</span></button>`;
    if (data.mode === 'off') return `<button type="button" class="chat-state-bar is-off" data-state-action="open" aria-label="查看和调整对话状态"><span>状态辅助已关闭</span><small>点此查看或重新开启</small></button>`;
    return `<button type="button" class="chat-state-bar" data-state-action="open" aria-label="查看和调整对话状态"><span class="state-summary-lines"><span class="state-summary-user"><b>你</b><span>${esc(label(data, 'emotion'))}<i>·</i>精力${esc(label(data, 'energy'))}<i>·</i>${esc(label(data, 'need'))}</span></span><span class="state-summary-role"><b>角色</b><span>${esc(label(data, 'roleMood'))}<i>·</i>${esc(label(data, 'proactivity'))}</span></span></span><span class="state-summary-familiarity">${esc(data.familiarity.stage)}<small>详情与调整</small></span></button>`;
  }
  function makeForm(data) {
    return { base: structuredClone(data), context: { ...state.context }, mode: data.mode,
      fields: Object.fromEntries(KEYS.map(key => [key, { manual: data.fields[key].origin === 'manual', value: structuredClone(data.fields[key].value), intensity: data.fields[key].intensity || 3, note: data.fields[key].note || '' }])),
      familiarity: { manual: data.familiarity.origin === 'manual', score: data.familiarity.score, note: data.familiarity.note || '' } };
  }
  function patch() {
    const form = state.form, base = form.base, result = { expectedManualRevision: base.manualRevision, fields: {}, reset: [] };
    if (form.mode !== base.mode) result.mode = form.mode;
    for (const key of KEYS) {
      const current = form.fields[key], original = base.fields[key];
      const value = { value: current.value, ...(key === 'emotion' ? { intensity: current.value[0] === 'unknown' ? null : Number(current.intensity) } : {}), note: current.note.trim() };
      if (!current.manual && original.origin === 'manual') result.reset.push(key);
      if (current.manual && (original.origin !== 'manual' || JSON.stringify(value.value) !== JSON.stringify(original.value) || (key === 'emotion' && value.intensity !== original.intensity) || value.note !== (original.note || ''))) result.fields[key] = value;
    }
    const familiar = form.familiarity, original = base.familiarity;
    if (familiar.manual !== (original.origin === 'manual') || (familiar.manual && (Number(familiar.score) !== original.score || familiar.note.trim() !== original.note))) result.familiarity = { mode: familiar.manual ? 'manual' : 'computed', score: Number(familiar.score), note: familiar.note.trim(), expectedRevision: original.revision };
    return result;
  }
  const hasChanges = () => state.form && (() => { const p = patch(); return 'mode' in p || Object.keys(p.fields).length || p.reset.length || p.familiarity; })();
  function options(data, key, value, empty = false) {
    return `${empty ? '<option value="">无补充情绪</option>' : ''}${Object.entries(data.options[key]).filter(([id]) => !empty || id !== 'unknown').map(([id, name]) => `<option value="${id}"${id === value ? ' selected' : ''}>${esc(name)}</option>`).join('')}`;
  }
  function evidence(field) {
    if (field.origin === 'manual') return `<p>由你在 ${esc(when(field.updatedAt))} 指定。${field.note ? `备注：${esc(field.note)}` : '未填写备注。'} 不会被自动推测覆盖。</p>`;
    return field.evidence?.length ? field.evidence.map(item => `<blockquote>${esc(item.quote)}</blockquote><small>来自本会话用户原话 · 消息 ${item.messageId}</small>`).join('') + (field.note ? `<p>${esc(field.note)}</p>` : '') : '<p>目前没有足够的用户原话作为判断依据。默认角色状态跟随人设，主动程度为正常。</p>';
  }
  function fieldCard(data, key) {
    const field = data.fields[key], draft = state.form.fields[key], disabled = state.busy || state.form.mode === 'off';
    return `<section class="state-field"><div class="state-field-heading"><h4>${esc(data.labels[key])}</h4><strong>${esc(label(data, key))}${key === 'emotion' && field.intensity ? `<small>强度 ${field.intensity}/5</small>` : ''}</strong></div><p class="state-provenance">${esc(origins[field.origin] || '暂无判断')} · ${esc(confidence[field.confidence] || '尚无判断')}${field.updatedAt ? ` · 更新于 ${esc(when(field.updatedAt))}` : ''}${field.expiresAt ? ` · 有效至 ${esc(when(field.expiresAt))}` : ''}</p><details class="state-evidence"><summary>查看判断依据</summary>${evidence(field)}</details><label class="checkbox-label"><input type="checkbox" data-state-manual="${key}"${check(draft.manual)}${off(disabled)}>由我指定${field.origin === 'manual' ? '（取消后，下次发言恢复自动判断）' : ''}</label><fieldset data-state-controls="${key}"${!draft.manual ? ' hidden' : ''}${off(disabled || !draft.manual)}>${key === 'emotion' ? `<div class="state-form-row"><label for="state-emotion-primary">主要情绪<select id="state-emotion-primary" data-state-field="emotion" data-state-part="primary">${options(data, 'emotion', draft.value[0])}</select></label><label for="state-emotion-secondary">补充情绪<select id="state-emotion-secondary" data-state-field="emotion" data-state-part="secondary"${off(draft.value[0] === 'unknown')}>${options(data, 'emotion', draft.value[1] || '', true)}</select></label></div><label for="state-emotion-intensity">情绪强度（1～5）<select id="state-emotion-intensity" data-state-field="emotion" data-state-part="intensity">${[1, 2, 3, 4, 5].map(n => `<option value="${n}"${Number(draft.intensity) === n ? ' selected' : ''}>${n}${n === 1 ? ' · 轻微' : n === 5 ? ' · 很强' : ''}</option>`).join('')}</select></label>` : `<label for="state-value-${key}">${esc(data.labels[key])}<select id="state-value-${key}" data-state-field="${key}" data-state-part="value">${options(data, key, draft.value)}</select></label>`}<label for="state-note-${key}">备注（可选，仅用于本地说明）<input id="state-note-${key}" data-state-field="${key}" data-state-part="note" maxlength="200" value="${esc(draft.note)}"></label></fieldset></section>`;
  }
  function drawDialog() {
    const form = state.form, data = form?.base, stale = form && keyOf(form.context) !== keyOf(state.context);
    dialog.innerHTML = `<header class="dialog-header"><div><h2 id="chat-state-title">此刻的对话状态</h2><p class="small muted">${esc(state.context?.roleName || '当前角色')} · 用户状态与角色状态分开记录</p></div><button type="button" class="icon-button" data-state-action="close" aria-label="关闭对话状态"${off(state.busy)}>×</button></header><div class="chat-state-dialog-body">${state.error ? `<p class="inline-error" role="alert">${esc(state.error)}</p>` : ''}${!data ? '<p role="status">正在读取状态和依据…</p>' : `<p class="small muted">以下为打开详情时的状态。手动指定优先，短期状态仅在本会话内最多有效 30 分钟；修改用于后续回复，不会改写聊天或自动保存为长期记忆。</p>${stale ? '<p class="inline-error" role="alert">当前会话已切换，请关闭后重新打开详情。</p>' : ''}<form id="chat-state-form"><fieldset class="state-main-fieldset"${off(state.busy || stale)}><div class="field"><label for="state-mode">状态辅助方式</label><select id="state-mode"><option value="assist"${form.mode === 'assist' ? ' selected' : ''}>AI 辅助判断，手动指定优先</option><option value="manual"${form.mode === 'manual' ? ' selected' : ''}>只使用我指定的状态</option><option value="off"${form.mode === 'off' ? ' selected' : ''}>关闭状态辅助并清空临时状态</option></select></div><div class="state-groups"><section class="state-group"><h3>你 · 当前状态</h3>${['emotion', 'energy', 'need'].map(key => fieldCard(data, key)).join('')}</section><section class="state-group state-group-role"><h3>${esc(form.context.roleName || 'AI 角色')} · 表达状态</h3><p class="small muted">调整措辞和互动节奏，继续遵循角色人设。</p>${['roleMood', 'proactivity'].map(key => fieldCard(data, key)).join('')}<p class="state-boundary">主动程度只影响聊天中的追问和建议，不会自动发信、播放音乐或执行任务。</p></section></div><section class="state-familiarity"><div class="card-header"><h3>熟悉程度 · ${esc(data.familiarity.stage)}</h3><strong class="state-score">${data.familiarity.score}<small> / 100</small></strong></div><p class="small muted">${data.familiarity.origin === 'manual' ? '当前分数由你指定。' : '根据该角色的已确认活跃记忆计算。'} 该指标表示掌握的资料量，不表示信任、好感或权限，也不会因暂时不聊天而扣分。</p><details class="state-familiarity-basis"><summary>查看分数依据 · 已确认 ${data.familiarity.basis.confirmedCount} 条资料</summary><p>${esc(data.familiarity.basis.formula)}</p><p>自动计算：${data.familiarity.automaticScore}/100（${esc(data.familiarity.automaticStage)}）；资料类别 ${data.familiarity.basis.categories.length} 类，重复提及 ${data.familiarity.basis.reinforcedCount} 条，其余活跃记忆 ${data.familiarity.basis.excludedCount} 条尚未计入。</p><ul>${data.familiarity.basis.memories.map(memory => `<li>${esc(memory.content)}<small>${memory.source === 'manual' ? '你手动添加' : '你已编辑确认'} · ${esc(memory.category)}</small></li>`).join('')}</ul>${data.familiarity.note ? `<p>你填写的依据：${esc(data.familiarity.note)}</p>` : ''}</details><label class="checkbox-label"><input id="state-familiarity-manual" type="checkbox"${check(form.familiarity.manual)}>手动设定熟悉程度（取消后恢复自动计算）</label><fieldset id="state-familiarity-controls"${!form.familiarity.manual ? ' hidden' : ''}${off(!form.familiarity.manual)}><div class="state-form-row"><label for="state-familiarity-score">熟悉程度分数（0～100）<input id="state-familiarity-score" type="number" min="0" max="100" step="1" value="${form.familiarity.score}" required></label><label for="state-familiarity-note">手动设定的依据<input id="state-familiarity-note" maxlength="200" value="${esc(form.familiarity.note)}" required></label></div></fieldset></section></fieldset><div class="state-dialog-actions"><button type="button" class="button" data-state-action="clear"${off(state.busy || stale)}>清空本会话状态</button><button type="button" class="button" data-state-action="reload"${off(state.busy)}>重新读取</button><button type="submit" class="button primary" id="state-save"${off(state.busy || stale || !hasChanges())}>${state.busy ? '正在保存…' : '保存状态修改'}</button></div></form>`}</div>`;
  }
  async function open() {
    if (!state.context?.personaId || state.context.canEdit === false) return; const context = { ...state.context };
    state.form = null; state.error = ''; drawDialog(); if (!dialog.open) dialog.showModal();
    const data = await load(context, true);
    if (data && keyOf(context) === keyOf(state.context) && dialog.open) { state.form = makeForm(data); drawDialog(); }
    else if (dialog.open) { state.error ||= '当前会话发生变化或状态无法读取，请重新打开详情。'; drawDialog(); }
  }
  async function save(clear = false) {
    if (state.busy || !state.form || keyOf(state.form.context) !== keyOf(state.context)) return;
    const form = state.form, payload = clear ? { clear: true, expectedManualRevision: form.base.manualRevision } : patch();
    state.busy = true; state.error = ''; drawDialog();
    try {
      const result = await request('/chat-state', 'POST', { personaId: form.context.personaId, conversationId: form.context.conversationId || null, patch: payload });
      accept(result.chatState); dialog.close(); state.form = null; onSaved(result);
    } catch (error) { state.error = error.message; }
    finally { state.busy = false; if (dialog.open) drawDialog(); redraw(); }
  }
  document.addEventListener('input', event => {
    const target = event.target, form = state.form; if (!form || !target.closest('#chat-state-form')) return;
    const key = target.dataset.stateField, part = target.dataset.statePart;
    if (key && part) {
      const field = form.fields[key];
      if (part === 'value') field.value = target.value;
      if (part === 'note') field.note = target.value;
      if (part === 'intensity') field.intensity = Number(target.value);
      if (part === 'primary') { field.value = [target.value, ...(target.value !== 'unknown' && field.value[1] && field.value[1] !== target.value ? [field.value[1]] : [])]; const secondary = $('#state-emotion-secondary', dialog); secondary.value = field.value[1] || ''; secondary.disabled = target.value === 'unknown'; }
      if (part === 'secondary') { field.value = [field.value[0], ...(target.value && target.value !== field.value[0] ? [target.value] : [])]; target.value = field.value[1] || ''; }
    }
    const manualKey = target.dataset.stateManual;
    if (manualKey) { form.fields[manualKey].manual = target.checked; const controls = $(`[data-state-controls="${manualKey}"]`, dialog); controls.disabled = !target.checked || form.mode === 'off'; controls.hidden = !target.checked; }
    if (target.id === 'state-familiarity-manual') { form.familiarity.manual = target.checked; $('#state-familiarity-controls', dialog).disabled = !target.checked; $('#state-familiarity-controls', dialog).hidden = !target.checked; }
    if (target.id === 'state-familiarity-score') form.familiarity.score = target.value;
    if (target.id === 'state-familiarity-note') form.familiarity.note = target.value;
    if (target.id === 'state-mode') { form.mode = target.value; drawDialog(); $('#state-mode', dialog)?.focus({ preventScroll: true }); }
    const submit = $('#state-save', dialog); if (submit) submit.disabled = state.busy || !hasChanges();
  });
  document.addEventListener('submit', event => { if (event.target.id === 'chat-state-form') { event.preventDefault(); void save(); } });
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-state-action]'); if (!button || button.disabled) return;
    if (button.dataset.stateAction === 'open') void open();
    if (button.dataset.stateAction === 'close' && !state.busy) dialog.close();
    if (button.dataset.stateAction === 'reload' && !state.busy && (!hasChanges() || window.confirm('重新读取会丢弃尚未保存的状态修改，继续吗？'))) void open();
    if (button.dataset.stateAction === 'clear' && !state.busy && window.confirm('清空本会话的短期状态和手动指定项？聊天、记忆和熟悉程度会保留。')) void save(true);
  });
  dialog.addEventListener('cancel', event => { if (state.busy) event.preventDefault(); });
  return { setContext, renderBar, receive: accept, current: display, refresh: () => load(state.context, true), isBusy: () => state.busy || dialog.open };
}
