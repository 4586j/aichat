import { mountMemoryGraph } from './memory-graph.js';
import { createMediaUI, renderAttachments } from './media.js';
import { createMailUI } from './mail.js';
import { createGuidesUI } from './guides.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const e = escapeHTML;
const text = value => value == null ? '' : typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
const checked = value => value ? ' checked' : '';
const disabled = value => value ? ' disabled' : '';
const selected = (a, b) => String(a ?? '') === String(b ?? '') ? ' selected' : '';
const endpointId = value => encodeURIComponent(String(value));
const MAX_FILE_SIZE = 8 * 1024 * 1024;
const PAGES = {
  chat: ['对话', 'chat', '01'], personas: ['人设工坊', 'personas', '02'],
  knowledge: ['知识库', 'book', '03'], memories: ['记忆', 'leaf', '04'],
  tasks: ['定时任务', 'clock', '05'], settings: ['设置', 'settings', '06']
};
const CATEGORIES = { fact: '事实', preference: '偏好', goal: '目标', constraint: '约束', summary: '摘要' };
const TASK_TYPES = { reminder: '应用内提醒', summarize: '角色上下文总结', prompt: 'AI 提问' };
const ICON_PATHS = {
  chat: '<path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z"/><path d="M8 11h8M8 14h5"/>',
  personas: '<rect x="4" y="3" width="16" height="18" rx="3"/><circle cx="12" cy="9" r="3"/><path d="M7 18c0-5 10-5 10 0"/>',
  book: '<path d="M12 5v16M12 5C8 2 3 3 3 3v16s5-1 9 2c4-3 9-2 9-2V3s-5-1-9 2Z"/><path d="M6 7h3M15 7h3M6 11h3M15 11h3"/>',
  leaf: '<path d="M20 3C6 2 2 8 5 15s15 5 15-12Z"/><path d="M3 21 15 9M8 16v-5M11 13h5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="2" fill="currentColor"/><circle cx="15" cy="17" r="2" fill="currentColor"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  send: '<path d="m22 2-7 20-4-9-9-4L22 2ZM22 2 11 13"/>',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 6a8 8 0 0 1 13 2l1 4M4 12l1 4a8 8 0 0 0 13 2"/>',
  upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 15v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7v.1"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
  edit: '<path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-4-4L5 15l-1 5Z"/>',
  pin: '<path d="m9 3 8 8M10 4l-4 6-3 1 10 10 1-3 6-4M3 21l5-5"/>',
  search: '<circle cx="10" cy="10" r="7"/><path d="m15 15 6 6"/>',
  spark: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z"/>',
  archive: '<rect x="3" y="3" width="18" height="5" rx="1"/><path d="M5 8v13h14V8M9 12h6"/>',
  play: '<path d="m8 4 12 8-12 8V4Z"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/>'
};
function icon(name) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name] || ICON_PATHS.leaf}</svg>`;
}
function button(label, action, { id = '', kind = '', iconName = '', busy = false, extra = '' } = {}) {
  return `<button type="button" class="button ${e(kind)}" data-action="${e(action)}"${id ? ` data-id="${e(id)}"` : ''}${disabled(busy)} ${extra}>${iconName ? icon(iconName) : ''}${e(label)}</button>`;
}
function date(value, withTime = true) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('zh-CN', withTime ? { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false } : { year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
function localDateInput(value) {
  const d = new Date(value || Date.now() + 5 * 60 * 1000);
  if (Number.isNaN(d.getTime())) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function number(value) { return value == null || !Number.isFinite(Number(value)) ? '—' : Number(value).toLocaleString('zh-CN'); }
function decimal(value) { return value == null || !Number.isFinite(Number(value)) ? '—' : Number(value).toFixed(2); }
function initial(name) { return [...String(name || '栖')][0]; }
function heading(title, subtitle, eyebrow, actions = '') {
  return `<div class="page-heading"><div><div class="eyebrow">${e(eyebrow)}</div><h1>${e(title)}</h1><p>${e(subtitle)}</p></div>${actions ? `<div class="heading-actions">${actions}</div>` : ''}</div>`;
}
function notice(content, variant = '', iconName = 'info') { return `<div class="notice ${e(variant)}">${icon(iconName)}<p>${e(content)}</p></div>`; }
function errorHTML(error) { return error ? `<div class="inline-error" role="alert">${e(error)}</div>` : ''; }
function empty(iconName, title, description, action = '') {
  return `<div class="empty-state"><div class="empty-icon">${icon(iconName)}</div><h3>${e(title)}</h3><p>${e(description)}</p>${action}</div>`;
}
function analysisContent(value) {
  if (Array.isArray(value) && value.length) return `<ul class="analysis-list">${value.map(item => `<li class="plain-text">${e(text(item))}</li>`).join('')}</ul>`;
  return `<p class="plain-text">${e((Array.isArray(value) ? '' : text(value)) || '模型未提供此项。')}</p>`;
}

const state = {
  data: null, page: Object.hasOwn(PAGES, location.hash.slice(1)) ? location.hash.slice(1) : 'chat',
  connection: 'loading', lastSync: null, bootstrapError: '', refreshing: false,
  personaId: '', conversationId: null, personaConversations: new Map(),
  messages: new Map(), loadingConversations: new Set(), loadErrors: new Map(),
  drafts: new Map(), chatErrors: new Map(), sending: null, newConversationBusy: false,
  setupPrompts: new Set(),
  analysis: { text: '', target: '', fileName: '', result: null, resultTarget: '', busy: false, error: '' },
  knowledge: { query: '', result: null, resultQuery: '', busy: false, uploading: false, error: '', uploadError: '' },
  memoryRole: 'all', memoryStatus: 'active', memoryView: 'list', busy: new Set(),
  graph: { personaId: '', includeArchived: false, data: null, loading: false, error: '', sequence: 0 },
  settingsDraft: null, settingsDirty: false, settingsSaving: false, settingsError: '',
  testBusy: false, testResult: null
};
const main = $('#main');
const dialog = $('#editor-dialog');
let dialogState = null;
let dialogSaving = false;
let refreshSequence = 0;
let disposeGraph = null;
const mediaUI = createMediaUI({ request: api, toast, redraw: () => renderPage() });
const mailUI = createMailUI({ request: api, toast, redraw: () => renderPage() });
const guidesUI = createGuidesUI({ request: api, askInChat: beginGuideQuestion });
const mobileLayout = window.matchMedia('(max-width: 700px)');
let layoutFrame = null;

function startEntrance() {
  const screen = $('#startup-screen');
  if (!screen) return;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const dismiss = () => screen.remove();
  if (reducedMotion.matches) { dismiss(); return; }
  screen.addEventListener('animationend', event => {
    if (event.target === screen && event.animationName === 'startup-exit') dismiss();
  });
  reducedMotion.addEventListener('change', event => { if (event.matches) dismiss(); }, { once: true });
  // Entrance is decorative and never waits for a network response.
  setTimeout(dismiss, 1800);
}

function scheduleMobileLayout() {
  if (layoutFrame !== null) return;
  layoutFrame = requestAnimationFrame(() => {
    layoutFrame = null;
    const viewport = window.visualViewport;
    const editing = document.activeElement?.matches('input:not([type="checkbox"]), textarea, select');
    const keyboardOpen = mobileLayout.matches && editing && (!viewport || viewport.scale === 1)
      && window.innerHeight - (viewport?.height || window.innerHeight) > 120;
    document.body.dataset.keyboardOpen = String(Boolean(keyboardOpen));
    // Pinch zoom must not resize the conversation or reflow an active form.
    if (viewport && viewport.scale !== 1) return;
    document.documentElement.style.setProperty('--visible-height', `${viewport?.height || window.innerHeight}px`);
    document.documentElement.style.setProperty('--visible-top', `${viewport?.offsetTop || 0}px`);
    const panel = $('.chat-panel');
    if (!mobileLayout.matches || !panel) return;
    const navigationHeight = (keyboardOpen ? 0 : $('#navigation').getBoundingClientRect().height) + ($('#music-dock')?.getBoundingClientRect().height || 0);
    const panelTop = panel.getBoundingClientRect().top + window.scrollY;
    const available = (viewport?.height || window.innerHeight) - panelTop - navigationHeight - 12;
    panel.style.setProperty('--chat-height', `${Math.max(320, available)}px`);
    if (keyboardOpen && document.activeElement?.id === 'chat-input') {
      const bottom = $('.composer-wrap').getBoundingClientRect().bottom;
      const viewportBottom = (viewport?.offsetTop || 0) + (viewport?.height || window.innerHeight);
      if (bottom > viewportBottom - 8) window.scrollBy({ top: bottom - viewportBottom + 8, behavior: 'instant' });
    }
  });
}

startEntrance();
window.addEventListener('resize', scheduleMobileLayout);
window.addEventListener('qiyi-player-layout', scheduleMobileLayout);
window.visualViewport?.addEventListener('resize', scheduleMobileLayout);
document.addEventListener('focusin', scheduleMobileLayout);
document.addEventListener('focusout', scheduleMobileLayout);
mobileLayout.addEventListener('change', () => {
  const context = $('.chat-context');
  if (context) context.open = !mobileLayout.matches;
  scheduleMobileLayout();
});

async function api(path, method = 'GET', data) {
  let response;
  try {
    response = await fetch(`/api${path}`, {
      method, credentials: 'same-origin', cache: 'no-store',
      headers: { Accept: 'application/json', ...(method === 'GET' ? {} : { 'Content-Type': 'application/json' }) },
      ...(method === 'GET' ? {} : { body: JSON.stringify(data ?? {}) })
    });
  } catch {
    state.connection = 'offline';
    updateShell();
    throw new Error('无法连接本地服务。请确认服务仍在运行，然后重试；当前输入已保留。');
  }
  let result;
  try { result = await response.json(); }
  catch {
    state.connection = 'offline';
    updateShell();
    throw new Error(`本地服务未返回有效 JSON（HTTP ${response.status}），请检查服务状态。`);
  }
  state.connection = 'online';
  updateShell();
  if (!response.ok || result?.error) throw new Error(result?.error || `请求失败（HTTP ${response.status}）`);
  return result;
}
function toast(message, kind = 'success') {
  const item = document.createElement('div');
  item.className = `toast${kind === 'error' ? ' error' : ''}`;
  item.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  item.innerHTML = `${icon(kind === 'error' ? 'info' : 'check')}<span></span><button type="button" class="icon-button" aria-label="关闭通知">${icon('close')}</button>`;
  $('span', item).textContent = String(message);
  $('button', item).addEventListener('click', () => item.remove());
  while ($('#toasts').children.length >= 3) $('#toasts').firstElementChild.remove();
  $('#toasts').append(item);
  setTimeout(() => item.remove(), kind === 'error' ? 12000 : 6500);
}
function currentPersona() { return state.data?.personas.find(p => p.id === state.personaId); }
function personaName(id) { return state.data?.personas.find(p => p.id === id)?.name || '未关联角色'; }
function currentDraftKey() { return state.conversationId || `new:${state.personaId}`; }
function beginGuideQuestion(question) {
  if (!state.data?.settings.model || !state.personaId) { toast('请先完成模型配置，再向 AI 提问。', 'error'); return false; }
  if (state.sending) { toast('当前回复尚未结束，请稍后再填写新问题。', 'error'); return false; }
  const key = currentDraftKey();
  if (state.drafts.get(key)?.trim() && !window.confirm('用配置问题替换当前聊天草稿？')) return false;
  state.drafts.set(key, question);
  location.hash = 'chat'; navigate('chat');
  return true;
}
function personaOptions(value, { all = false, blank = false } = {}) {
  return `${all ? `<option value="all"${selected(value, 'all')}>所有角色</option>` : ''}${blank ? `<option value=""${selected(value, '')}>不关联角色</option>` : ''}${(state.data?.personas || []).map(p => `<option value="${e(p.id)}"${selected(value, p.id)}>${e(p.name)}</option>`).join('')}`;
}
function updateShell() {
  document.body.dataset.page = state.page;
  const statuses = { loading: '正在连接本地服务', online: '本地服务已连接', offline: '本地服务不可达' };
  const settings = state.data?.settings;
  const configured = Boolean(settings?.baseUrl && settings?.model);
  const modelState = configured ? `${settings.model} · ${state.testResult?.ok ? '本次测试通过' : '未验证连接'}` : '尚未配置模型';
  $('#connection-status').innerHTML = `<div class="status-line"><span class="status-dot ${e(state.connection)}"></span>${e(statuses[state.connection])}</div><div class="connection-model">${e(modelState)}</div>`;
  $('#current-page').textContent = PAGES[state.page][0];
  $$('#navigation a').forEach(a => a.setAttribute('aria-current', a.dataset.page === state.page ? 'page' : 'false'));
  $('#sync-status').textContent = state.lastSync ? `${state.connection === 'offline' ? '当前为缓存数据 · ' : ''}上次同步 ${date(state.lastSync)}` : '尚未读取本地数据';
  const refresh = $('#refresh-button');
  refresh.disabled = state.refreshing;
  refresh.innerHTML = state.refreshing ? '<span class="spinner" aria-hidden="true"></span>' : icon('refresh');
}
function initializeSettingsDraft() {
  if (state.settingsDraft) return;
  const settings = state.data?.settings || {};
  state.settingsDraft = {
    baseUrl: settings.baseUrl || '', model: settings.model || '', apiKey: '', clearApiKey: false,
    memoryMessageThreshold: settings.memoryMessageThreshold ?? 20,
    memoryIntervalHours: settings.memoryIntervalHours ?? 6, memoryBudget: settings.memoryBudget ?? 300
  };
}
async function refreshData({ silent = false, draw = true } = {}) {
  const sequence = ++refreshSequence;
  state.refreshing = true;
  updateShell();
  try {
    const data = await api('/bootstrap');
    if (!data || !data.settings || !['personas', 'conversations', 'documents', 'memories', 'tasks', 'runs'].every(key => Array.isArray(data[key]))) {
      throw new Error('初始化数据不符合接口契约，请检查本地服务版本。');
    }
    if (sequence !== refreshSequence) return false;
    state.data = data;
    mediaUI.sync(data.media);
    mailUI.sync(data.mail);
    guidesUI.sync(data.guides, Boolean(data.settings.model));
    state.bootstrapError = '';
    state.lastSync = new Date().toISOString();
    if (!data.personas.some(p => p.id === state.personaId)) {
      state.personaId = (data.personas.find(p => p.name === '望舒') || data.personas[0])?.id || '';
      state.conversationId = null;
    }
    if (state.conversationId && !data.conversations.some(c => c.id === state.conversationId)) state.conversationId = null;
    if (state.memoryRole !== 'all' && !data.personas.some(p => p.id === state.memoryRole)) state.memoryRole = 'all';
    if (!state.settingsDirty && !state.settingsSaving) state.settingsDraft = null;
    initializeSettingsDraft();
    if (!data.personas.some(p => p.id === state.graph.personaId)) state.graph.personaId = state.personaId;
    if (draw) renderPage();
    if (state.page === 'memories' && state.memoryView === 'graph') await loadGraph();
    return true;
  } catch (error) {
    if (sequence !== refreshSequence) return false;
    state.bootstrapError = error.message;
    if (!silent) toast(error.message, 'error');
    if (draw) renderPage();
    return false;
  } finally {
    if (sequence === refreshSequence) state.refreshing = false;
    updateShell();
  }
}
function renderPage({ toBottom = false } = {}) {
  disposeGraph?.();
  disposeGraph = null;
  const active = document.activeElement;
  const focus = main.contains(active) && active.id ? { id: active.id, start: active.selectionStart, end: active.selectionEnd } : null;
  const previousMessages = $('#chat-messages');
  const scroll = previousMessages ? { key: previousMessages.dataset.conversation, top: previousMessages.scrollTop, nearBottom: previousMessages.scrollHeight - previousMessages.scrollTop - previousMessages.clientHeight < 70 } : null;
  const opened = new Set($$('details[open][data-detail]', main).map(d => d.dataset.detail));
  updateShell();
  main.setAttribute('aria-busy', String(!state.data && !state.bootstrapError));
  if (!state.data) {
    main.innerHTML = state.bootstrapError
      ? `${heading('等待与你重逢', '页面已就绪，请连接本地服务以读取你的资料。', 'YOUR LOCAL SPACE')}${errorHTML(state.bootstrapError)}<div class="card">${empty('leaf', '暂时无法读取工作室', '没有使用演示数据。启动本地服务后，点击重试。', button('重新连接', 'refresh', { kind: 'primary', iconName: 'refresh' }))}</div>`
      : `<div class="loading-state" role="status"><span class="spinner" aria-hidden="true"></span>正在打开你的私人工作室…</div>`;
    return;
  }
  const views = { chat: renderChat, personas: renderPersonas, knowledge: renderKnowledge, memories: renderMemories, tasks: renderTasks, settings: renderSettings };
  guidesUI.setModelConfigured(Boolean(state.data.settings.model));
  main.innerHTML = `${state.bootstrapError ? notice('最近一次数据同步失败，以下显示上次成功读取的数据。可使用右上角刷新重试。', 'warning') : ''}${views[state.page]()}${state.page === 'settings' ? mediaUI.renderSettings() + mailUI.renderSettings() : ''}`;
  const graphContainer = $('#memory-graph-container');
  if (graphContainer && state.graph.data && !state.graph.loading) {
    disposeGraph = mountMemoryGraph(graphContainer, { data: state.graph.data, onOpenMemory: id => {
      const memory = state.data.memories.find(item => item.id === id);
      if (memory) openMemoryEditor(memory);
    } });
  }
  $$('details[data-detail]', main).forEach(d => { if (opened.has(d.dataset.detail)) d.open = true; });
  if (focus) {
    const element = document.getElementById(focus.id);
    if (element && main.contains(element)) {
      element.focus({ preventScroll: true });
      if (typeof element.setSelectionRange === 'function' && focus.start != null) {
        try { element.setSelectionRange(focus.start, focus.end); } catch { /* Numeric fields have no text selection. */ }
      }
    }
  }
  const messageList = $('#chat-messages');
  if (messageList) messageList.scrollTop = toBottom || !scroll || scroll.key !== messageList.dataset.conversation || scroll.nearBottom ? messageList.scrollHeight : scroll.top;
  scheduleMobileLayout();
}
function navigate(page) {
  if (!Object.hasOwn(PAGES, page)) page = 'chat';
  state.page = page;
  renderPage();
  if (page === 'memories' && state.memoryView === 'graph') void loadGraph();
  main.focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function sourceItems(sources = []) {
  return (Array.isArray(sources) ? sources : []).map(source => {
    const guide = source.kind === 'configuration-guide' && ['start', 'model', 'stickers', 'music', 'email', 'troubleshooting'].includes(source.guideId);
    return `<div class="evidence-item"><strong>${e(source.name || '知识片段')} <span class="pill">块 ${e(source.index ?? '—')}</span></strong>${guide ? `<span class="guide-source-label">${source.origin === 'github' ? 'GitHub 本地副本' : '应用内置副本'} · 修订 ${e(source.revision)}</span>` : ''}<p class="plain-text">${e(source.content)}</p>${source.score != null ? `<span class="micro muted">相关性 ${e(decimal(source.score))}</span>` : ''}${guide ? `<div><button type="button" class="button small guide-source-link" data-guide-action="open" data-guide-id="${e(source.guideId)}">阅读本机指南</button></div>` : ''}</div>`;
  }).join('');
}
function recalledItems(memories = []) {
  return (Array.isArray(memories) ? memories : []).map(memory => `<div class="evidence-item"><strong>${e(CATEGORIES[memory.category] || memory.category || '长期记忆')}</strong><p class="plain-text">${e(memory.content)}</p>${memory.source ? `<p class="plain-text">来源：${e(text(memory.source))}</p>` : ''}</div>`).join('');
}
function renderMessage(message, persona) {
  const isUser = message.role === 'user';
  const sources = Array.isArray(message.sources) ? message.sources : [];
  const memories = Array.isArray(message.recalledMemories) ? message.recalledMemories : [];
  return `<article class="message ${isUser ? 'user' : 'assistant'}"><div class="message-meta"><span class="avatar" aria-hidden="true">${e(isUser ? '我' : initial(persona?.name))}</span><span>${e(isUser ? '你' : persona?.name || '助手')}</span><time datetime="${e(message.createdAt)}">${e(date(message.createdAt))}</time></div><div class="message-content plain-text">${e(message.content)}</div>${!isUser ? renderAttachments(message.attachments) + '<div class="message-mail-action"><button type="button" data-mail-action="from-reply">写成邮件</button></div>' : ''}${sources.length ? `<details class="evidence-group" data-detail="sources-${e(message.id)}"><summary>知识来源 · ${sources.length} 处引用</summary><div class="evidence-items">${sourceItems(sources)}</div></details>` : ''}${memories.length ? `<details class="evidence-group" data-detail="memories-${e(message.id)}"><summary>记忆依据 · ${memories.length} 条命中</summary><div class="evidence-items">${recalledItems(memories)}</div></details>` : ''}</article>`;
}
function renderSetupPrompt(key) {
  if (!state.setupPrompts.has(key)) return '';
  const configured = Boolean(state.data.settings.model);
  const busy = Boolean(state.sending || state.testBusy || state.settingsSaving);
  return `<article class="setup-message" aria-label="快捷配置消息"><div class="message-meta"><span class="avatar" aria-hidden="true">${icon('settings')}</span><span>本地配置助手</span><span class="pill">无需模型</span></div><div class="message-content setup-message-body"><h2>${configured ? '模型信息已保存，可以继续了' : '先连上模型，再开始聊天'}</h2><p>${configured ? '保存不代表连接成功。你可以先测试已保存的连接，再发送输入框里保留的那句话。' : '你的第一句话已保留在输入框中。先完成下面三步，就能开始对话。'}</p>${!configured ? '<ol><li>准备模型服务的基础地址（Base URL）、模型 ID 和 API Key；无需认证的本机服务可不填 Key。</li><li>点击“快捷配置模型”填写并保存；基础地址不要带 /chat/completions。</li><li>保存后可手动测试连接，再继续发送刚才的话。</li></ol>' : ''}<div class="setup-message-actions">${configured ? `${button(state.testBusy ? '正在测试…' : '测试已保存的连接', 'test-settings', { busy, iconName: 'play' })}${button('继续发送', 'resume-setup-chat', { busy, kind: 'primary', iconName: 'send' })}` : button('快捷配置模型', 'quick-model-setup', { busy, kind: 'primary', iconName: 'settings' })}<button type="button" class="button" data-guide-action="open" data-guide-id="model">查看配置方法</button>${configured ? button('调整模型配置', 'quick-model-setup', { busy }) : ''}</div>${configured && state.testResult ? `<p class="${state.testResult.ok ? 'inline-success' : 'inline-error'}" role="status">${e(state.testResult.message || '连接测试完成。')}</p>` : ''}<details class="setup-optional"><summary>音乐、邮件和表情包怎么配？</summary><p>这些功能可以稍后分别配置，不影响先开始聊天。</p><div class="setup-message-actions"><button type="button" class="button small" data-guide-action="open" data-guide-id="music">音乐配置方法</button><button type="button" class="button small" data-guide-action="open" data-guide-id="email">邮件配置方法</button><button type="button" class="button small" data-guide-action="open" data-guide-id="stickers">表情包配置方法</button></div></details></div></article>`;
}
function renderChat() {
  const persona = currentPersona();
  const history = state.data.conversations.filter(c => c.personaId === state.personaId).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  const messages = state.messages.get(state.conversationId) || [];
  const loading = state.loadingConversations.has(state.conversationId);
  const key = currentDraftKey();
  const setupPrompt = renderSetupPrompt(key);
  const sendingHere = state.sending && (state.sending.conversationId ? state.sending.conversationId === state.conversationId : state.sending.personaId === state.personaId && !state.conversationId);
  const activeMemories = state.data.memories.filter(m => m.personaId === state.personaId && m.status === 'active').length;
  const pinnedMemories = state.data.memories.filter(m => m.personaId === state.personaId && m.status === 'active' && m.pinned).length;
  const title = state.data.conversations.find(c => c.id === state.conversationId)?.title;
  const loadError = state.loadErrors.get(state.conversationId);
  return `${heading('让思绪，有处栖息。', '从一次对话开始，慢慢积累只属于你的理解与记忆。', 'A SPACE TO THINK & REMEMBER', button(state.newConversationBusy ? '正在新建…' : '开启新对话', 'new-conversation', { iconName: 'plus', busy: !persona || state.newConversationBusy }))}
    <div class="chat-grid"><section class="card chat-panel" aria-label="与角色对话">
      <div class="chat-toolbar"><div class="persona-control"><span class="avatar" aria-hidden="true">${e(initial(persona?.name))}</span><div><label class="sr-only" for="chat-persona">选择聊天角色</label><select id="chat-persona"${disabled(!persona)}>${personaOptions(state.personaId)}${!persona ? '<option value="">请先创建角色</option>' : ''}</select><div class="micro muted truncate" title="${e(title || '尚未开始的新对话')}">${e(title || '尚未开始的新对话')}</div></div></div><div class="chat-toolbar-note">${icon('lock')}角色记忆独立保存</div></div>
      <div id="chat-messages" class="chat-messages" data-conversation="${e(key)}" role="log" aria-live="polite" aria-relevant="additions text" aria-label="聊天消息" aria-busy="${Boolean(loading || sendingHere)}">
        ${loadError ? `${errorHTML(loadError)}${button('重新读取会话', 'reload-conversation', { iconName: 'refresh', busy: loading })}` : ''}
        ${messages.length ? messages.map(m => renderMessage(m, persona)).join('') : setupPrompt ? '' : loading ? '<div class="loading-state" role="status"><span class="spinner"></span>正在读取对话…</div>' : `<div class="chat-welcome"><div class="orbit-mark" aria-hidden="true">${icon('leaf')}</div><h2>${persona ? '把此刻的想法，轻轻放下。' : '从一个角色开始'}</h2><div class="welcome-rule"></div>${persona ? `<span class="greeting-label">${e(persona.name)} · 开场白</span><p class="plain-text">${e(persona.greeting || '你可以分享近况、整理思路，或向已导入的资料提问。')}</p><span class="micro muted">发送后才会生成回复，不会自动调用模型</span>` : `<p>本地服务尚未提供角色。创建一位属于你的对话伙伴。</p>${button('创建角色', 'create-persona', { kind: 'primary', iconName: 'plus' })}`}</div>`}
        ${setupPrompt}
        ${sendingHere ? '<div class="waiting-line" role="status"><span class="spinner" aria-hidden="true"></span>正在等待模型完整回复，请稍候…</div>' : ''}
      </div>
      <div class="composer-wrap">${errorHTML(state.chatErrors.get(key))}<form id="chat-form" class="composer"><label class="sr-only" for="chat-input">发送给当前角色的消息</label><textarea id="chat-input" name="content" rows="2" maxlength="8000" placeholder="说说今天，或者问一个你在意的问题…"${disabled(!persona || loading)}>${e(state.drafts.get(key) || '')}</textarea><div class="composer-bottom"><span class="keyboard-hint">Enter 发送 · Shift + Enter 换行</span><span class="touch-hint">换行继续写，轻触发送</span><button class="button primary small" type="submit"${disabled(!persona || loading || Boolean(loadError) || Boolean(state.sending))}>${sendingHere ? '<span class="spinner" aria-hidden="true"></span>' : icon('send')}${state.sending ? '等待回复' : '发送'}</button></div></form><div class="composer-note">${icon('shield')}<span>发送后，聊天内容、相关知识片段和角色记忆会传至已配置的模型服务。模型回答请自行核实。</span></div></div>
    </section><details class="chat-context" data-detail="chat-context"${mobileLayout.matches ? '' : ' open'}><summary>${icon('book')}<span>会话与记忆</span><span class="context-hint">查看对话手记</span>${icon('chevron')}</summary><aside class="chat-aside" aria-label="当前角色与会话信息">
      <section class="card persona-summary"><div class="eyebrow">YOUR COMPANION</div><span class="avatar" aria-hidden="true">${e(initial(persona?.name))}</span><h2>${e(persona?.name || '等待一个名字')}</h2><p class="plain-text">${e(persona?.description || '给角色写下一段简介，让陪伴拥有自己的模样。')}</p>${persona?.tone ? `<span class="pill">${e(persona.tone)}</span>` : ''}${persona ? `<div>${button('了解与编辑人设', 'edit-persona', { id: persona.id, kind: 'subtle small', iconName: 'arrow' })}</div>` : ''}</section>
      <section class="card aside-card"><div class="card-header"><h3>正在生长的记忆</h3>${icon('leaf')}</div><div class="stat-line"><span>当前角色 · 活跃记忆</span><strong>${number(activeMemories)}</strong></div><div class="stat-line"><span>其中固定保留</span><strong>${number(pinnedMemories)}</strong></div><div class="stat-line"><span>共享知识文档</span><strong>${number(state.data.documents.length)}</strong></div><p class="aside-footnote">只有相关的资料才会被检索。回复下方可展开查看实际引用。</p></section>
      <section class="card aside-card"><div class="card-header"><h3>对话手记</h3><span class="small-label">${history.length} CONVERSATIONS</span></div><div class="history-list">${history.length ? history.map(c => `<button type="button" class="history-item${c.id === state.conversationId ? ' active' : ''}" data-action="open-conversation" data-id="${e(c.id)}"${c.id === state.conversationId ? ' aria-current="true"' : ''}>${icon('chat')}<span><strong class="truncate">${e(c.title || '未命名对话')}</strong><small>${e(date(c.updatedAt || c.createdAt))}</small></span></button>`).join('') : '<p class="small muted">还没有对话手记。<br>第一句，就从今天开始。</p>'}</div></section>
    </aside></details></div>`;
}
async function loadConversation(id) {
  if (!id || state.loadingConversations.has(id)) return;
  state.loadingConversations.add(id);
  state.loadErrors.delete(id);
  renderPage();
  try {
    const result = await api(`/conversations/${endpointId(id)}`);
    state.messages.set(id, result.messages || []);
  } catch (error) { state.loadErrors.set(id, error.message); }
  finally { state.loadingConversations.delete(id); if (state.page === 'chat') renderPage(); }
}
async function openConversation(id) {
  const conversation = state.data.conversations.find(c => c.id === id);
  if (!conversation) return;
  state.personaId = conversation.personaId;
  state.conversationId = id;
  state.personaConversations.set(conversation.personaId, id);
  renderPage();
  if (!state.sending || state.sending.conversationId !== id) await loadConversation(id);
}
function selectPersona(id) {
  state.personaId = id;
  const remembered = state.personaConversations.get(id);
  state.conversationId = state.data.conversations.some(c => c.id === remembered && c.personaId === id) ? remembered : null;
  renderPage();
  if (state.conversationId && !state.messages.has(state.conversationId)) void loadConversation(state.conversationId);
}
async function newConversation() {
  if (state.newConversationBusy || !state.personaId) return;
  const personaId = state.personaId;
  state.newConversationBusy = true;
  renderPage();
  try {
    const { conversation } = await api('/conversations', 'POST', { personaId });
    state.data.conversations.unshift(conversation);
    state.messages.set(conversation.id, []);
    state.personaConversations.set(personaId, conversation.id);
    if (state.personaId === personaId) state.conversationId = conversation.id;
    await refreshData({ silent: true });
    if (state.page === 'chat') $('#chat-input')?.focus();
  } catch (error) { toast(error.message, 'error'); }
  finally { state.newConversationBusy = false; renderPage(); }
}
async function sendMessage() {
  if (state.sending || !state.personaId || state.loadingConversations.has(state.conversationId) || state.loadErrors.has(state.conversationId)) return;
  let key = currentDraftKey();
  const rawDraft = state.drafts.get(key) || '';
  const content = rawDraft.trim();
  if (!content) { $('#chat-input')?.focus(); return; }
  if (!state.data.settings.model) {
    state.setupPrompts.add(key);
    state.chatErrors.delete(key);
    renderPage({ toBottom: true });
    return;
  }
  const personaId = state.personaId;
  let conversationId = state.conversationId;
  state.sending = { personaId, conversationId };
  state.chatErrors.delete(key);
  renderPage({ toBottom: true });
  try {
    if (!conversationId) {
      const { conversation } = await api('/conversations', 'POST', { personaId });
      conversationId = conversation.id;
      state.data.conversations.unshift(conversation);
      state.messages.set(conversationId, []);
      state.drafts.set(conversationId, state.drafts.get(key) || rawDraft);
      if (state.setupPrompts.delete(key)) state.setupPrompts.add(conversationId);
      state.drafts.delete(key);
      state.personaConversations.set(personaId, conversationId);
      if (state.personaId === personaId && state.conversationId === null) state.conversationId = conversationId;
      key = conversationId;
      state.sending.conversationId = conversationId;
      renderPage({ toBottom: true });
    }
    const result = await api(`/conversations/${endpointId(conversationId)}/messages`, 'POST', { content });
    const assistant = { ...result.message, sources: result.sources ?? result.message?.sources ?? [], recalledMemories: result.recalledMemories ?? result.message?.recalledMemories ?? [] };
    const messages = state.messages.get(conversationId) || [];
    for (const message of [result.userMessage, assistant]) {
      if (message && message.id != null && !messages.some(m => m.id === message.id)) messages.push(message);
    }
    state.messages.set(conversationId, messages);
    state.setupPrompts.delete(key);
    if (state.drafts.get(key) === rawDraft) state.drafts.delete(key);
    state.chatErrors.delete(key);
    await refreshData({ silent: true, draw: false });
  } catch (error) {
    // No optimistic messages: a failed model request leaves the draft, not a fake transcript.
    state.chatErrors.set(key, error.message);
    if (state.page !== 'chat' || currentDraftKey() !== key) toast(error.message, 'error');
  } finally {
    state.sending = null;
    renderPage({ toBottom: state.conversationId === conversationId });
  }
}

function renderPersonas() {
  const a = state.analysis;
  const analysisFields = [ ['overview', '整体观察'], ['traits', '特征与互动偏好'], ['speakingStyle', '表达与说话风格'], ['boundaries', '可能的边界'], ['evidence', '引用证据与推测依据'] ];
  return `${heading('让陪伴，拥有自己的模样。', '亲手定义一位伙伴，或从真实对话中提炼一份可编辑的人设。', 'PERSONA ATELIER', button('创建角色', 'create-persona', { kind: 'primary', iconName: 'plus' }))}
    <div class="studio-grid"><section aria-label="我的角色"><div class="card-header"><h2>我的角色</h2><span class="small-label">${state.data.personas.length} PERSONAS</span></div><div class="stack persona-list">${state.data.personas.length ? state.data.personas.map(p => `<article class="card persona-card"><div class="persona-card-head"><span class="avatar" aria-hidden="true">${e(initial(p.name))}</span><div><h3>${e(p.name)}</h3><span class="micro muted">创建于 ${e(date(p.createdAt, false))}</span></div></div><p class="plain-text">${e(p.description || '还没有简介，可以在编辑中写下角色的故事。')}</p>${p.tone ? `<span class="pill">${e(p.tone)}</span>` : ''}<div class="card-actions">${button('开始对话', 'chat-as-persona', { id: p.id, kind: 'small', iconName: 'chat' })}${button('编辑', 'edit-persona', { id: p.id, kind: 'subtle small', iconName: 'edit' })}</div></article>`).join('') : `<div class="card">${empty('personas', '一个名字，一种陪伴', '创建角色后即可开始对话，每个角色拥有独立的长期记忆。')}</div>`}</div></section>
    <section class="card card-pad"><div class="card-header"><h2>从对话中认识一个人</h2><span class="pill">人物分析</span></div><p class="small muted">粘贴聊天记录，或选择 UTF-8 文本文件，生成有证据的人设草稿。</p>${notice('点击「分析聊天记录」后，所选文件或粘贴的聊天内容与目标人物会发送至你配置的模型服务。请先获得相关人员授权。', '', 'shield')}
      <form id="analysis-form"><div class="field" style="margin-top:20px"><label for="analysis-target">目标人物 <span>填写记录中的名称或昵称</span></label><input id="analysis-target" name="target" required maxlength="120" placeholder="例如：聊天记录中的「小林」" value="${e(a.target)}"></div><div class="field"><label for="analysis-text">聊天记录</label><textarea id="analysis-text" name="text" rows="9" required maxlength="60000" placeholder="在这里粘贴对话，保留说话者名称，以便区分观察与引用证据。">${e(a.text)}</textarea></div><label class="button small file-select">${icon('upload')}选择 TXT / MD / JSON<input id="analysis-file" type="file" accept=".txt,.md,.json,text/plain,text/markdown,application/json" aria-label="选择待分析的聊天记录文件"${disabled(a.busy)}></label>${a.fileName ? `<p class="file-name">已载入：${e(a.fileName)} · 可继续编辑上方文本</p>` : '<p class="file-name">文件最大 8 MiB；单次分析最多 60,000 字符。选择文件仅载入文本，不会自动分析。</p>'}${errorHTML(a.error)}<div class="form-actions"><button type="submit" class="button primary"${disabled(a.busy)}>${a.busy ? '<span class="spinner"></span>' : icon('spark')}${a.busy ? '正在分析，请稍候…' : '分析聊天记录'}</button></div></form>
      ${a.result ? `<section class="analysis-result" aria-label="人物分析预览"><div class="card-header"><h2>分析预览 · ${e(a.resultTarget)}</h2><span class="pill">尚未创建角色</span></div>${notice('以下为模型基于本次记录的观察与推测，不是确定的人格结论或心理诊断。请核对原文证据，再决定哪些内容值得保留。', 'warning')}${analysisFields.map(([key, label]) => `<div class="analysis-section"><h3>${e(label)}</h3>${analysisContent(a.result[key])}</div>`).join('')}<div class="analysis-section"><h3>人设提示词草稿</h3><pre class="plain-text">${e(text(a.result.personaPrompt) || '模型未提供提示词，可在下一步手动填写。')}</pre></div>${button('编辑草稿并确认创建', 'use-analysis', { kind: 'primary', iconName: 'edit' })}<p class="micro muted" style="margin:10px 0 0">下一步仍可修改；只有点击「确认创建角色」才会保存。</p></section>` : ''}
    </section></div>`;
}
async function readAnalysisFile(file) {
  if (!file) return;
  try {
    if (!/\.(txt|md|json)$/i.test(file.name)) throw new Error('人物分析仅支持 UTF-8 TXT、MD 或 JSON 文本文件。');
    if (file.size > MAX_FILE_SIZE) throw new Error('文件超过 8 MiB，请拆分后重试。');
    if (!file.size) throw new Error('文件为空，请选择包含聊天记录的文件。');
    let content;
    try { content = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()); }
    catch { throw new Error('无法按 UTF-8 读取文件，请转换为 UTF-8 编码后重试。'); }
    if (!content.trim()) throw new Error('文件没有可分析的文字。');
    state.analysis.text = content;
    state.analysis.fileName = file.name;
    state.analysis.error = content.length > 60000 ? `文本已完整载入（${number(content.length)} 字符），但单次分析最多 60,000 字符。请先精简聊天记录。` : '';
    renderPage();
  } catch (error) { state.analysis.error = error.message; renderPage(); }
}
async function analyze() {
  const a = state.analysis;
  if (a.busy) return;
  const input = { text: a.text.trim(), target: a.target.trim() };
  if (!input.text || !input.target) { a.error = '请填写目标人物和聊天记录。'; renderPage(); return; }
  if (input.text.length > 60000) { a.error = `记录共 ${number(input.text.length)} 个字符，超过单次分析的 60,000 字符限制。请精简上方文本后重试，已载入内容不会丢失。`; renderPage(); return; }
  a.busy = true;
  a.error = '';
  renderPage();
  try {
    const { analysis } = await api('/analyze', 'POST', input);
    if (!analysis || typeof analysis !== 'object') throw new Error('模型未返回有效的分析结果，请重试。');
    a.result = analysis;
    a.resultTarget = input.target;
    toast('分析已完成。请核对证据，人设仍是未保存的草稿。');
  } catch (error) { a.error = error.message; }
  finally { a.busy = false; renderPage(); }
}

function renderKnowledge() {
  const k = state.knowledge;
  return `${heading('把资料，变成可对话的知识。', '一份文档，一些线索。让回答有据可循，而不只凭空想象。', 'YOUR LIVING LIBRARY')}
    <div class="two-column"><div class="stack"><section class="card card-pad"><div class="card-header"><h2>导入文档</h2><span class="pill">全角色共享</span></div><div id="document-drop" class="drop-zone" aria-label="拖放知识库文档">${k.uploading ? '<span class="spinner" aria-hidden="true"></span>' : icon('upload')}<h3>${k.uploading ? '正在本地解析文档…' : '把值得保留的资料放在这里'}</h3><p>拖入文件，或点击选择 · 每个文件最大 8 MiB<br>TXT · Markdown · JSON · 文字型 PDF · DOCX</p><label class="button file-select">${icon('plus')}选择文件<input id="document-files" type="file" multiple accept=".txt,.md,.json,.pdf,.docx" aria-label="选择导入知识库的文件"${disabled(k.uploading)}></label></div>${errorHTML(k.uploadError)}<div style="margin-top:16px">${notice('导入在本地提取文字，不调用模型；对话引用的相关片段会发送至已配置的模型。原文件不保留。扫描型 PDF 不支持 OCR，请先转为文字。', '', 'lock')}</div></section>
      <section class="card card-pad"><div class="card-header"><h2>我的文档</h2><span class="small-label">${state.data.documents.length} DOCUMENTS</span></div><div class="document-list">${state.data.documents.length ? state.data.documents.map(d => `<article class="document-row"><span class="file-badge" aria-hidden="true">${e(d.format || d.name?.split('.').pop() || 'FILE')}</span><div class="document-info"><strong>${e(d.name)}</strong><small>${number(d.charCount)} 字符 · ${number(d.chunkCount)} 分块 · ${e(date(d.createdAt, false))}</small></div><button type="button" class="icon-button" data-action="delete-document" data-id="${e(d.id)}" aria-label="删除文档 ${e(d.name)}" title="删除文档">${icon('trash')}</button></article>`).join('') : empty('book', '知识，从第一份资料开始', '导入常用笔记、项目资料或个人记录，之后可以直接在对话里提问。')}</div></section></div>
    <section class="card card-pad"><div class="card-header"><h2>试着寻找一个答案</h2>${icon('search')}</div><p class="small muted">本地关键词检索，不调用模型。预览哪些原文片段可能用于回答。</p><form id="knowledge-form"><div class="field"><label for="knowledge-query">你想查找什么？</label><input id="knowledge-query" name="query" required maxlength="1000" value="${e(k.query)}" placeholder="输入一个主题、问题或关键词"></div><button type="submit" class="button primary"${disabled(k.busy)}>${k.busy ? '<span class="spinner"></span>' : icon('search')}${k.busy ? '检索中…' : '检索资料'}</button></form>${errorHTML(k.error)}<div class="search-result" aria-live="polite">${k.result !== null ? `<div class="card-header"><h3>「${e(k.resultQuery)}」的结果</h3><span class="pill">${k.result.length} 个片段</span></div>${k.result.length ? sourceItems(k.result) : empty('search', '暂未找到相关片段', '尝试使用更具体的关键词，或先导入与这个问题相关的文档。')}` : empty('search', '让每一处引用都可查', '检索后会显示原文、文件名与块序号。检索结果不是模型生成的答案。')}</div></section></div>`;
}
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`无法读取文件：${file.name}`));
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.readAsDataURL(file);
  });
}
async function uploadDocuments(files) {
  if (state.knowledge.uploading || !files.length) return;
  state.knowledge.uploading = true;
  state.knowledge.uploadError = '';
  renderPage();
  const errors = [];
  let imported = 0;
  for (const file of files) {
    try {
      if (!/\.(txt|md|json|pdf|docx)$/i.test(file.name)) throw new Error('不支持该格式，请选择 TXT、MD、JSON、PDF 或 DOCX。');
      if (file.size > MAX_FILE_SIZE) throw new Error('文件超过 8 MiB，请拆分后重试。');
      if (!file.size) throw new Error('空文件无法导入。');
      const data = await fileToBase64(file);
      const { document: documentItem } = await api('/documents', 'POST', { name: file.name, data });
      state.data.documents.unshift(documentItem);
      imported += 1;
    } catch (error) { errors.push(`${file.name}：${error.message}`); }
  }
  state.knowledge.uploading = false;
  state.knowledge.uploadError = errors.join('\n');
  if (imported) toast(`已导入 ${imported} 份文档，内容已在本地建立索引。`);
  if (errors.length && state.page !== 'knowledge') toast(errors.join('\n'), 'error');
  await refreshData({ silent: true });
}
async function searchKnowledge() {
  const k = state.knowledge;
  if (k.busy || !k.query.trim()) return;
  const query = k.query.trim();
  k.busy = true;
  k.error = '';
  renderPage();
  try { const result = await api('/knowledge/search', 'POST', { query }); k.result = result.sources || []; k.resultQuery = query; }
  catch (error) { k.error = error.message; }
  finally { k.busy = false; renderPage(); }
}

function memoryViewSwitch() {
  return `<div class="heading-actions" style="margin-bottom:20px" role="group" aria-label="记忆显示方式">${button('记忆列表', 'memory-view-list', { kind: state.memoryView === 'list' ? 'primary' : '', extra: `aria-pressed="${state.memoryView === 'list'}"` })}${button('知识图谱', 'memory-view-graph', { kind: state.memoryView === 'graph' ? 'primary' : '', extra: `aria-pressed="${state.memoryView === 'graph'}"` })}</div>`;
}
function renderGraphPage() {
  const g = state.graph;
  return `${heading('让记忆，连成理解的网络。', '实体之间的每一条关系，都有原始记忆作为依据。', 'MEMORY CONSTELLATION', button('添加记忆', 'create-memory', { kind: 'primary', iconName: 'plus' }))}${memoryViewSwitch()}
    <div class="card filter-bar"><div class="field"><label for="graph-persona">图谱所属角色</label><select id="graph-persona">${personaOptions(g.personaId)}</select></div><label class="checkbox-label"><input id="graph-archived" type="checkbox"${checked(g.includeArchived)}>包含归档记忆</label>${button('提取待处理关系', 'extract-graph', { iconName: 'spark', busy: g.loading || !g.data?.stats.pendingCount })}${button('刷新图谱', 'refresh-graph', { iconName: 'refresh', busy: g.loading })}</div>
    <div style="margin-bottom:20px">${notice('图谱查看、拖拽和搜索均在本地完成。点击提取并确认后，每批最多 20 条待处理活跃记忆会发送至已配置的模型；模型关系需自行核实。也可编辑记忆，手动填写关系。')}</div>
    ${errorHTML(g.error)}${g.loading ? '<div class="loading-state" role="status"><span class="spinner"></span>正在读取记忆网络…</div>' : '<section id="memory-graph-container" aria-label="记忆知识图谱"></section>'}`;
}
async function loadGraph() {
  if (!state.data || !state.graph.personaId) return;
  const g = state.graph;
  const sequence = ++g.sequence;
  const personaId = g.personaId, includeArchived = g.includeArchived;
  g.loading = true; g.error = ''; g.data = null;
  if (state.page === 'memories' && state.memoryView === 'graph') renderPage();
  try {
    const data = await api(`/graph?personaId=${endpointId(personaId)}&includeArchived=${includeArchived}`);
    if (sequence === g.sequence) g.data = data;
  } catch (error) { if (sequence === g.sequence) g.error = error.message; }
  finally {
    if (sequence === g.sequence) {
      g.loading = false;
      if (state.page === 'memories' && state.memoryView === 'graph') renderPage();
    }
  }
}
function openGraphExtraction() {
  openDialog('为原始记忆提取关系', `${notice('将这个角色最多 20 条待处理活跃记忆发送至你配置的模型服务。仅从明确文字提取，不处理归档记忆。请勿发送未获授权或含秘密的内容。', '', 'shield')}<p>角色：${e(personaName(state.graph.personaId))}</p><p class="dialog-description">已有手动关系不会被覆盖；提取期间修改过的条目会跳过。结果保存到本机 SQLite，不会自动继续下一批。</p>`, '确认并提取关系', { type: 'graph-extract', personaId: state.graph.personaId });
}
function renderMemories() {
  if (state.memoryView === 'graph') return renderGraphPage();
  const memories = state.data.memories.filter(m => (state.memoryRole === 'all' || m.personaId === state.memoryRole) && (state.memoryStatus === 'all' || m.status === state.memoryStatus)).sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || String(b.reinforcedAt || b.createdAt).localeCompare(String(a.reinforcedAt || a.createdAt)));
  return `${heading('记住重要的，也允许淡忘。', '长期记忆不是无限堆积，而是可查看、可纠正、可恢复的理解。', 'MEMORY GARDEN', `${button('整理维护', 'maintain-memories', { iconName: 'leaf', busy: state.busy.has('maintain') })}${button('手动总结', 'summarize-memories', { iconName: 'spark', busy: !state.data.personas.length })}${button('添加记忆', 'create-memory', { kind: 'primary', iconName: 'plus', busy: !state.data.personas.length })}`)}
    ${memoryViewSwitch()}
    <div class="notice memory-note">${icon('info')}<p>固定记忆不参与自动遗忘；新建或最近确认不足 7 天的条目受保护。低保留分数的旧记忆可被归档，而非删除。归档后不再注入对话，恢复或编辑会刷新确认时间。</p></div>
    ${errorHTML(state.data.settings.lastMemoryError ? `最近一次自动总结未完成：${state.data.settings.lastMemoryError}` : '')}
    <div class="card filter-bar"><div class="field"><label for="memory-role">所属角色</label><select id="memory-role">${personaOptions(state.memoryRole, { all: true })}</select></div><div class="field"><label for="memory-status">记忆状态</label><select id="memory-status"><option value="active"${selected(state.memoryStatus, 'active')}>活跃记忆</option><option value="archived"${selected(state.memoryStatus, 'archived')}>已归档</option><option value="all"${selected(state.memoryStatus, 'all')}>全部状态</option></select></div><span class="filter-count">当前筛选 · ${memories.length} 条记忆</span></div>
    ${memories.length ? `<div class="memory-grid">${memories.map(m => {
      const busy = state.busy.has(`memory:${m.id}`);
      return `<article class="card memory-card ${m.status === 'archived' ? 'archived' : ''}"><div class="memory-top"><span class="pill">${e(CATEGORIES[m.category] || m.category)}</span>${m.pinned ? '<span class="pill success">固定保留</span>' : ''}${m.status === 'archived' ? '<span class="pill warning">已归档</span>' : ''}<span class="memory-persona">${e(personaName(m.personaId))}</span></div><p class="memory-content plain-text">${e(m.content)}</p><div class="memory-metrics"><span>保留分数 <strong>${e(decimal(m.score))}</strong></span><span>重要性 <strong>${e(decimal(m.importance))}</strong></span><span>置信度 <strong>${e(decimal(m.confidence))}</strong></span></div><details class="memory-detail" data-detail="memory-${e(m.id)}"><summary>来源与记忆轨迹</summary><p class="plain-text">来源：${e(text(m.source) || '未提供')}<br>提及 ${number(m.mentions)} 次 · 引用 ${number(m.accessCount)} 次<br>创建：${e(date(m.createdAt))}<br>最近确认：${e(date(m.reinforcedAt))}<br>最近访问：${e(date(m.lastAccessedAt))}</p></details><div class="card-actions">${button('编辑', 'edit-memory', { id: m.id, kind: 'subtle small', iconName: 'edit', busy })}${button(m.pinned ? '取消固定' : '固定', 'pin-memory', { id: m.id, kind: 'subtle small', iconName: 'pin', busy })}${button(m.status === 'active' ? '归档' : '恢复', 'archive-memory', { id: m.id, kind: 'subtle small', iconName: m.status === 'active' ? 'archive' : 'refresh', busy })}<span class="spacer"></span><button type="button" class="icon-button" data-action="delete-memory" data-id="${e(m.id)}" aria-label="永久删除记忆" title="永久删除"${disabled(busy)}>${icon('trash')}</button></div></article>`;
    }).join('')}</div>` : `<div class="card">${empty('leaf', state.memoryStatus === 'archived' ? '这里还没有归档的记忆' : '记忆会在对话中慢慢生长', state.memoryStatus === 'archived' ? '日后淡忘的条目会留在这里，随时可以恢复。' : '你可以手动添加重要的信息，也可以在对话后使用总结，让模型提炼值得保留的内容。')}</div>`}`;
}
async function updateMemory(id, patch) {
  const key = `memory:${id}`;
  if (state.busy.has(key)) return;
  state.busy.add(key);
  renderPage();
  try {
    const { memory } = await api(`/memories/${endpointId(id)}`, 'PUT', patch);
    state.data.memories = state.data.memories.map(m => m.id === id ? memory : m);
    await refreshData({ silent: true });
    toast(patch.status === 'archived' ? '记忆已归档，之后可以恢复。' : patch.status === 'active' ? '记忆已恢复，确认时间已刷新。' : patch.pinned ? '已固定这条记忆。' : '已取消固定。');
  } catch (error) { toast(error.message, 'error'); }
  finally { state.busy.delete(key); renderPage(); }
}
async function maintainMemories() {
  if (state.busy.has('maintain')) return;
  state.busy.add('maintain');
  renderPage();
  try {
    const result = await api('/memories/maintain', 'POST');
    toast(`维护完成：归档 ${number(result.archived)} 条记忆，未永久删除任何条目。`);
    await refreshData({ silent: true });
  } catch (error) { toast(error.message, 'error'); }
  finally { state.busy.delete('maintain'); renderPage(); }
}

function runStatus(status) {
  if (['success', 'completed', 'ok'].includes(status)) return ['成功', 'success'];
  if (['failed', 'error'].includes(status)) return ['失败', 'danger'];
  if (['running', 'pending'].includes(status)) return ['执行中', 'warning'];
  return [status || '未知状态', ''];
}
function renderRun(run) {
  const [label, variant] = runStatus(run.status);
  return `<details class="run-item" data-detail="run-${e(run.id)}"><summary>${e(run.taskName || state.data.tasks.find(t => t.id === run.taskId)?.name || '历史任务')}<span class="pill ${e(variant)}">${e(label)}</span><small>${e(date(run.startedAt))}${run.finishedAt ? ` → ${e(date(run.finishedAt))}` : ' · 尚未完成'}</small></summary><div class="run-result plain-text">${e(text(run.result) || '本次运行没有返回文本结果。')}</div></details>`;
}
function renderTasks() {
  const runs = [...state.data.runs].sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
  return `${heading('把需要记挂的事，轻轻托付。', '设一个提醒，整理一段记忆，或在合适的时候问一个问题。', 'RHYTHMS & REMINDERS', button('创建任务', 'create-task', { kind: 'primary', iconName: 'plus' }))}
    <div style="margin-bottom:21px">${notice('任务仅在本地服务运行时执行；服务关闭或电脑休眠时不会推送，重启后过期任务补跑一次。提醒无需模型；总结与 AI 提问会发送相关内容到已配置的模型。', '', 'clock')}</div>
    <div class="two-column"><section aria-label="任务列表"><div class="card-header"><h2>我的任务</h2><span class="small-label">${state.data.tasks.filter(t => t.enabled).length} ENABLED / ${state.data.tasks.length} TOTAL</span></div><div class="task-list">${state.data.tasks.length ? state.data.tasks.map(t => {
      const busy = state.busy.has(`task:${t.id}`) || t.running;
      const latest = runs.find(r => r.taskId === t.id);
      const latestStatus = latest ? runStatus(latest.status) : null;
      return `<article class="card task-card"><div class="task-top"><span class="task-icon">${icon(t.type === 'reminder' ? 'clock' : t.type === 'summarize' ? 'leaf' : 'spark')}</span><div class="task-name"><h3>${e(t.name)}</h3><span class="pill">${e(TASK_TYPES[t.type] || t.type)}</span>${t.running ? '<span class="pill warning">正在执行</span>' : ''}</div><button type="button" class="switch" role="switch" aria-checked="${Boolean(t.enabled)}" aria-label="启用任务 ${e(t.name)}" data-action="toggle-task" data-id="${e(t.id)}"${disabled(busy)}><span class="switch-track" aria-hidden="true"></span>${t.enabled ? '已启用' : '已停用'}</button></div><div class="task-details"><span>${t.scheduleType === 'interval' ? `每 ${e(number(t.intervalMinutes))} 分钟` : '一次性任务'}</span><span>${t.enabled ? '下次执行' : '计划时间'}：${e(date(t.nextRunAt))}</span>${t.personaId ? `<span>角色：${e(personaName(t.personaId))}</span>` : ''}</div>${t.prompt ? `<p class="task-prompt plain-text">${e(t.prompt)}</p>` : ''}${latest ? `<p class="micro muted" style="margin:13px 0 0">最近执行：${e(date(latest.startedAt))} <span class="pill ${e(latestStatus[1])}">${e(latestStatus[0])}</span> · 结果见右侧执行记录</p>` : '<p class="micro muted" style="margin:13px 0 0">尚无执行记录</p>'}<div class="card-actions">${button(busy ? '执行处理中' : '立即运行', 'run-task', { id: t.id, kind: 'small', iconName: 'play', busy })}${button('编辑', 'edit-task', { id: t.id, kind: 'subtle small', iconName: 'edit', busy })}<span class="spacer"></span><button type="button" class="icon-button" data-action="delete-task" data-id="${e(t.id)}" aria-label="删除任务 ${e(t.name)}"${disabled(busy)}>${icon('trash')}</button></div></article>`;
    }).join('') : `<div class="card">${empty('clock', '给未来留一张便笺', '先创建一个应用内提醒吧，无需配置模型即可使用。', button('创建第一个任务', 'create-task', { kind: 'primary', iconName: 'plus' }))}</div>`}</div></section>
    <section class="card card-pad"><div class="card-header"><h2>执行记录</h2><span class="small-label">${runs.length} RUNS</span></div><p class="micro muted">展开查看真实结果或错误。页面每分钟同步本地任务状态，也可手动刷新。</p>${runs.length ? runs.map(renderRun).join('') : empty('clock', '还没有发生的事', '任务运行后，开始时间、完成状态和结果会保存在这里。')}</section></div>`;
}
async function taskAction(id, operation) {
  const task = state.data.tasks.find(t => t.id === id);
  const key = `task:${id}`;
  if (!task || task.running || state.busy.has(key)) return;
  state.busy.add(key);
  renderPage();
  try {
    if (operation === 'run') {
      const { run } = await api(`/tasks/${endpointId(id)}/run`, 'POST');
      if (run) state.data.runs = [run, ...state.data.runs.filter(r => r.id !== run.id)];
      const status = runStatus(run?.status);
      toast(`任务运行${status[0]}，可在执行记录中查看结果。`, status[1] === 'danger' ? 'error' : 'success');
    } else {
      const { task: updated } = await api(`/tasks/${endpointId(id)}`, 'PUT', { enabled: !task.enabled });
      state.data.tasks = state.data.tasks.map(t => t.id === id ? updated : t);
      toast(updated.enabled ? '任务已启用。' : '任务已停用。');
    }
  } catch (error) { toast(error.message, 'error'); }
  finally { state.busy.delete(key); await refreshData({ silent: true }); }
}

function renderSettings() {
  initializeSettingsDraft();
  const s = state.settingsDraft;
  const apiKeySet = Boolean(state.data.settings.hasApiKey);
  return `${heading('把连接与边界，交还给你。', '选择你的模型服务，让记忆按适合自己的节奏生长。', 'SETTINGS & BOUNDARIES', '<button type="button" class="button" data-guide-action="open">配置指南</button>')}${guidesUI.renderEntry()}
    <div class="settings-grid"><form id="settings-form"><section class="card settings-card"><h2><span class="section-number">01</span>模型连接</h2><div class="field"><label for="settings-baseUrl">Base URL <span>OpenAI 兼容服务地址</span></label><input id="settings-baseUrl" type="url" name="baseUrl" required maxlength="500" value="${e(s.baseUrl)}" placeholder="例如：https://api.openai.com/v1" autocomplete="off" spellcheck="false"><small>填写服务文档指定的基础地址，通常以 /v1 结尾。也支持本机部署的兼容服务。</small></div><div class="field"><label for="settings-model">模型名称</label><input id="settings-model" name="model" maxlength="160" value="${e(s.model)}" placeholder="填写服务商提供的模型 ID" autocomplete="off" spellcheck="false"></div><div class="field"><label for="settings-apiKey">API Key <span>${apiKeySet ? '服务端已有密钥，不会下发到页面' : '服务端尚无密钥，本地模型可不需要'}</span></label><input id="settings-apiKey" type="password" name="apiKey" maxlength="2000" value="${e(s.apiKey)}" placeholder="留空保留当前密钥" autocomplete="new-password" spellcheck="false"${disabled(s.clearApiKey)}><small>界面输入的密钥仅在当前服务进程内保留，不写入长期配置。重启后可能需要重新输入。</small></div><label class="checkbox-label"><input id="settings-clearApiKey" name="clearApiKey" type="checkbox"${checked(s.clearApiKey)}>清除当前运行期密钥（保存后生效）</label>${notice('空白密钥表示保持原值。环境变量配置不由此页面修改。不要将这个单用户本地应用直接暴露到公网。', '', 'lock')}<div class="card-actions">${button(state.testBusy ? '正在测试…' : '测试已保存的连接', 'test-settings', { iconName: 'play', busy: state.testBusy || state.settingsSaving })}<span class="micro muted">不会自动测试；测试将发送一条请求到已保存的模型服务。</span></div>${state.testResult ? `<div class="${state.testResult.ok ? 'inline-success' : 'inline-error'}" role="status">${e(state.testResult.message || (state.testResult.ok ? '连接测试成功。' : '连接测试失败。'))}</div>` : ''}</section>
      <section class="card settings-card"><h2><span class="section-number">02</span>记忆的生长节奏</h2><div class="field-row"><div class="field"><label for="settings-memoryMessageThreshold">总结消息阈值 <span>条</span></label><input id="settings-memoryMessageThreshold" type="number" name="memoryMessageThreshold" required min="2" max="200" step="1" value="${e(s.memoryMessageThreshold)}"><small>会话中未总结的新消息达到该值时触发。</small></div><div class="field"><label for="settings-memoryIntervalHours">总结时间间隔 <span>小时</span></label><input id="settings-memoryIntervalHours" type="number" name="memoryIntervalHours" required min="1" max="720" step="1" value="${e(s.memoryIntervalHours)}"><small>有新消息且距上次总结达到该间隔时触发。</small></div></div><div class="field"><label for="settings-memoryBudget">每个角色的活跃记忆预算 <span>条</span></label><input id="settings-memoryBudget" type="number" name="memoryBudget" required min="10" max="5000" step="1" value="${e(s.memoryBudget)}"><small>超过预算时优先归档低分记忆。固定或处于保护期的条目可能使数量暂时超出预算，不会强制删除。</small></div></section>
      ${errorHTML(state.settingsError)}<div class="settings-actions"><span class="muted">${state.settingsDirty ? '有尚未保存的修改' : '配置来自本地服务'} · 连接测试只使用已保存配置</span><button type="submit" class="button primary"${disabled(state.settingsSaving || state.testBusy)}>${state.settingsSaving ? '<span class="spinner"></span>' : icon('check')}${state.settingsSaving ? '正在保存…' : '保存设置'}</button></div></form>
    <aside class="card settings-aside"><div class="eyebrow">YOUR DATA, YOUR CHOICE</div><h3>安心，来自清楚的边界。</h3><div class="boundary-item"><strong>${icon('lock')}留在这台设备</strong><p>角色、会话、提取后的文档、记忆与任务保存在本地 SQLite 中。本地存储不等于加密，请自行做好磁盘保护与备份。</p></div><div class="boundary-item"><strong>${icon('arrow')}何时发送到模型</strong><p>聊天、人物分析、记忆总结与 AI 任务会发送相应文本。聊天还可能携带相关知识片段和长期记忆，请只选择获准使用的内容。</p></div><div class="boundary-item"><strong>${icon('shield')}没有隐形的动作</strong><p>邮件由你填写收件人、预览并确认后才通过已配置的 SMTP 服务发送。AI 与定时任务不会自动发信。定时任务仅在本地服务运行时执行。</p></div><div class="boundary-item"><strong>${icon('leaf')}随时修正与遗忘</strong><p>模型可能误解你的意思。你可以查看记忆来源、修改、归档、恢复，或在明确确认后永久删除。</p></div></aside></div>`;
}
async function saveSettings() {
  if (state.settingsSaving || state.testBusy) return;
  const draft = { ...state.settingsDraft };
  const payload = {
    baseUrl: draft.baseUrl.trim(), model: draft.model.trim(), apiKey: draft.clearApiKey ? '' : draft.apiKey,
    clearApiKey: draft.clearApiKey, memoryMessageThreshold: Number(draft.memoryMessageThreshold),
    memoryIntervalHours: Number(draft.memoryIntervalHours), memoryBudget: Number(draft.memoryBudget)
  };
  state.settingsSaving = true;
  state.settingsError = '';
  renderPage();
  try {
    const { settings } = await api('/settings', 'PUT', payload);
    state.data.settings = settings;
    state.testResult = null;
    // Keep edits made while saving; discard submitted secrets from frontend state after success.
    const current = state.settingsDraft;
    const unchanged = Object.keys(draft).every(key => current[key] === draft[key]);
    if (unchanged) { state.settingsDraft = null; state.settingsDirty = false; initializeSettingsDraft(); }
    else {
      if (current.apiKey === draft.apiKey) current.apiKey = '';
      if (current.clearApiKey === draft.clearApiKey) current.clearApiKey = false;
    }
    toast(unchanged ? '设置已保存。不会自动发送模型测试。' : '已保存提交时的设置，之后输入的修改仍待保存。');
  } catch (error) { state.settingsError = error.message; }
  finally { state.settingsSaving = false; renderPage(); }
}
async function testSettings() {
  if (state.testBusy || state.settingsSaving) return;
  state.testBusy = true;
  state.testResult = null;
  renderPage();
  try { state.testResult = await api('/settings/test', 'POST'); }
  catch (error) { state.testResult = { ok: false, message: error.message }; }
  finally { state.testBusy = false; renderPage(); }
}

function field(id, label, control, hint = '') {
  return `<div class="field"><label for="${e(id)}">${e(label)}</label>${control}${hint ? `<small>${e(hint)}</small>` : ''}</div>`;
}
function openDialog(title, content, submitLabel, config) {
  if (dialogSaving) return;
  dialogState = config;
  dialog.innerHTML = `<div class="dialog-header"><h2 id="dialog-title">${e(title)}</h2><button type="button" class="icon-button" data-action="close-dialog" aria-label="关闭对话框">${icon('close')}</button></div><form id="editor-form" class="dialog-body"><fieldset>${content}</fieldset><div id="dialog-error" class="inline-error" role="alert" hidden></div><div class="dialog-footer"><button type="button" class="button" data-action="close-dialog">取消</button><button id="dialog-submit" type="submit" class="button ${config.type === 'confirm' ? 'danger' : 'primary'}">${e(submitLabel)}</button></div></form>`;
  if (!dialog.open) dialog.showModal();
  const firstControl = $('input:not([type="hidden"]), select, textarea', dialog);
  (firstControl || (config.type === 'confirm' ? $('[data-action="close-dialog"]', dialog) : $('#dialog-submit')))?.focus();
}
function openQuickModelSetup() {
  const settings = state.data.settings;
  openDialog('快捷配置模型', `${notice('你的聊天草稿会继续保留。保存只更新模型连接信息，不会自动测试或发送聊天内容。')}
    ${field('quick-model-baseUrl', '模型基础地址（Base URL）', `<input id="quick-model-baseUrl" name="baseUrl" type="url" required maxlength="500" value="${e(settings.baseUrl)}" placeholder="填写服务商提供的基础地址" autocomplete="off">`, '程序会自动追加 /chat/completions，不要重复填写该后缀。')}
    ${field('quick-model-name', '模型 ID', `<input id="quick-model-name" name="model" required maxlength="160" value="${e(settings.model)}" placeholder="填写服务商实际提供的模型 ID" autocomplete="off">`)}
    ${field('quick-model-key', '模型 API Key', `<input id="quick-model-key" name="apiKey" type="password" maxlength="2000" autocomplete="new-password" placeholder="${settings.hasApiKey ? '已配置，留空保留' : '无需认证的本机服务可留空'}">`, '仅保留在服务进程内，不写入数据库；不要把密钥贴到聊天中。')}`, '保存快捷配置', { type: 'quick-model' });
}
function openPersonaEditor(persona, fromAnalysis = false) {
  const draft = persona || (fromAnalysis ? {
    name: state.analysis.resultTarget.slice(0, 60),
    description: typeof state.analysis.result.overview === 'string' ? state.analysis.result.overview.slice(0, 300) : '',
    systemPrompt: text(state.analysis.result.personaPrompt), tone: '', greeting: ''
  } : {});
  openDialog(persona ? '编辑角色' : fromAnalysis ? '把观察，写成一个角色' : '创建一位新伙伴', `${fromAnalysis ? notice('这是来自分析结果的可编辑草稿，尚未保存。名称与简介已按字段长度截取，完整分析仍在预览中。核对并调整提示词后，点击下方确认才会创建角色。') : ''}
    ${field('persona-name', '角色名称', `<input id="persona-name" name="name" required maxlength="60" value="${e(draft.name)}" placeholder="给这位伙伴一个名字">`)}
    ${field('persona-description', '简介', `<textarea id="persona-description" name="description" maxlength="300" rows="2" placeholder="用一两句话介绍 TA…">${e(draft.description)}</textarea>`, '最多 300 个字符。')}
    ${field('persona-tone', '说话语气', `<input id="persona-tone" name="tone" maxlength="200" value="${e(draft.tone)}" placeholder="例如：温和、清晰，适度幽默">`)}
    ${field('persona-greeting', '开场白', `<textarea id="persona-greeting" name="greeting" maxlength="1000" rows="2" placeholder="第一次开始对话时，想对你说些什么？">${e(draft.greeting)}</textarea>`)}
    ${field('persona-systemPrompt', '人设系统提示词', `<textarea id="persona-systemPrompt" name="systemPrompt" class="large-textarea" required maxlength="8000" rows="6" placeholder="描述角色的身份、表达方式、回应偏好与边界…">${e(draft.systemPrompt)}</textarea>`, '最多 8000 个字符。人设会参与模型请求，但不能覆盖应用的隐私和安全边界。')}`, persona ? '保存修改' : '确认创建角色', { type: 'persona', id: persona?.id });
}
function openMemoryEditor(memory) {
  const draft = memory || { personaId: state.memoryView === 'graph' ? state.graph.personaId : state.memoryRole !== 'all' ? state.memoryRole : state.personaId, category: 'fact', importance: .7, confidence: .8, source: 'manual', pinned: false };
  const triplesText = (draft.triples || []).map(t => `${t.subject.name} | ${t.predicate} | ${t.object.name}`).join('\n');
  const categories = { ...CATEGORIES };
  if (draft.category && !categories[draft.category]) categories[draft.category] = draft.category;
  openDialog(memory ? '修正一条记忆' : '留下一条重要的记忆', `${field('memory-personaId', '所属角色', `<select id="memory-personaId" name="personaId" required${disabled(Boolean(memory))}>${personaOptions(draft.personaId)}</select>`)}
    ${field('memory-content', '记忆内容', `<textarea id="memory-content" name="content" class="large-textarea" required maxlength="1000" rows="4" placeholder="记录一个清晰、具体、可确认的信息…">${e(draft.content)}</textarea>`, '最多 1000 个字符。')}
    ${field('memory-triples', '图谱关系（可选）', `<textarea id="memory-triples" name="triples" rows="3" maxlength="1800" placeholder="用户 | 喜欢 | 茉莉茶&#10;茉莉茶 | 属于 | 花茶">${e(triplesText)}</textarea>`, '每行：主体 | 关系 | 客体，最多 8 行；手动填写不调用模型。只改内容而未改关系时，旧关系将失效，需重新提取。新记忆留空表示待提取；清空已有关系表示确认无关系。')}
    ${field('memory-category', '类别', `<select id="memory-category" name="category">${Object.entries(categories).map(([value, label]) => `<option value="${e(value)}"${selected(value, draft.category)}>${e(label)}</option>`).join('')}</select>`)}
    <div class="field-row">${field('memory-importance', '重要性 · 0 至 1', `<input id="memory-importance" name="importance" type="number" min="0" max="1" step="any" required value="${e(draft.importance)}">`)}${field('memory-confidence', '置信度 · 0 至 1', `<input id="memory-confidence" name="confidence" type="number" min="0" max="1" step="any" required value="${e(draft.confidence)}">`)}</div>
    ${field('memory-source', '来源 / 依据（由系统记录）', `<textarea id="memory-source" readonly rows="2">${e(draft.source === 'manual' ? '手动添加' : text(draft.source))}</textarea>`, '来源是原始记录，不会随内容编辑被覆盖。')}
    <label class="checkbox-label"><input id="memory-pinned" name="pinned" type="checkbox"${checked(draft.pinned)}>固定保留，不参与自动遗忘</label>${memory ? notice('保存修改会刷新最近确认时间。归档状态不会因编辑自动改变，可在列表中恢复。') : ''}`, memory ? '保存记忆' : '添加记忆', { type: 'memory', id: memory?.id, personaId: draft.personaId, triplesText, triples: draft.triples || [] });
}
function openTaskEditor(task) {
  const draft = task || { name: '', type: 'reminder', personaId: state.personaId, prompt: '', scheduleType: 'once', intervalMinutes: 60, enabled: true };
  openDialog(task ? '调整任务的节奏' : '给未来安排一件小事', `${field('task-name', '任务名称', `<input id="task-name" name="name" required maxlength="100" value="${e(draft.name)}" placeholder="例如：晚间整理、项目回顾">`)}
    <div class="field-row">${field('task-type', '任务类型', `<select id="task-type" name="type">${Object.entries(TASK_TYPES).map(([value, label]) => `<option value="${e(value)}"${selected(value, draft.type)}>${e(label)}</option>`).join('')}</select>`)}${field('task-personaId', '关联角色', `<select id="task-personaId" name="personaId">${personaOptions(draft.personaId, { blank: true })}</select>`)}</div>
    <div id="task-prompt-field" class="field"><label id="task-prompt-label" for="task-prompt">提醒内容</label><textarea id="task-prompt" name="prompt" rows="3" maxlength="8000" placeholder="写下需要提醒的内容，或交给 AI 的问题…">${e(draft.prompt)}</textarea></div>
    ${field('task-scheduleType', '调度方式', `<select id="task-scheduleType" name="scheduleType"><option value="once"${selected(draft.scheduleType, 'once')}>一次性 · 指定时间</option><option value="interval"${selected(draft.scheduleType, 'interval')}>固定间隔 · 按分钟重复</option></select>`)}
    <div class="field-row">${field('task-nextRunAt', '下次执行时间 · 本地时间', `<input id="task-nextRunAt" name="nextRunAt" type="datetime-local" required value="${e(localDateInput(draft.nextRunAt))}">`)}<div id="task-interval-field" class="field"><label for="task-intervalMinutes">重复间隔 · 分钟</label><input id="task-intervalMinutes" name="intervalMinutes" type="number" min="1" max="525600" step="1" value="${e(draft.intervalMinutes || 60)}"></div></div>
    <label class="checkbox-label"><input id="task-enabled" name="enabled" type="checkbox"${checked(draft.enabled)}>保存后启用此任务</label>${notice('时间会转换为 UTC 保存，并按本地时区显示。1440 分钟是固定 24 小时，不保证夏令时切换后的钟点。总结和 AI 提问会发送相关文本到已配置模型。')}`, task ? '保存任务' : '创建任务', { type: 'task', id: task?.id });
  updateTaskFields();
}
function updateTaskFields() {
  if (dialogState?.type !== 'task') return;
  const type = $('#task-type').value;
  const interval = $('#task-scheduleType').value === 'interval';
  $('#task-interval-field').hidden = !interval;
  $('#task-intervalMinutes').required = interval;
  $('#task-intervalMinutes').disabled = !interval;
  $('#task-personaId').required = type !== 'reminder';
  $('#task-personaId').disabled = type === 'reminder';
  $('#task-prompt-field').hidden = type === 'summarize';
  $('#task-prompt').required = type === 'prompt';
  $('#task-prompt-label').textContent = type === 'prompt' ? '交给 AI 的问题' : '提醒内容（可选，留空使用任务名称）';
}
function openSummaryDialog() {
  const personaId = state.memoryRole === 'all' ? state.personaId : state.memoryRole;
  openDialog('把对话整理为长期记忆', `${notice('将所选角色尚未总结的聊天内容发送至已配置的模型服务。单批最多处理 60 条消息，只有成功后才推进总结游标。')}${field('summary-personaId', '选择需要总结的角色', `<select id="summary-personaId" name="personaId" required>${personaOptions(personaId)}</select>`)}<p class="dialog-description">结果会报告实际处理的消息数与创建的记忆数。没有新消息时不会凭空生成记忆。</p>`, '确认并开始总结', { type: 'summary' });
}
function confirmDelete(type, id) {
  const collections = { document: 'documents', memory: 'memories', task: 'tasks' };
  const item = state.data[collections[type]].find(x => x.id === id);
  if (!item) return;
  const label = { document: '文档', memory: '记忆', task: '任务' }[type];
  const descriptions = {
    document: '删除后，此文档及对应知识分块将从知识库移除，但历史聊天中已保存的引用文字不会被改写。此操作无法撤销，需要时可重新导入。',
    memory: '这是永久删除，不是归档。删除后无法恢复；如果只是暂时不想在对话中引用，可以选择归档。',
    task: '删除后不再安排此任务的后续执行。此操作无法撤销。'
  };
  openDialog(`确认删除这条${label}？`, `<p class="plain-text">${e(type === 'memory' ? item.content : item.name)}</p><p class="dialog-description">${e(descriptions[type])}</p>`, `永久删除${label}`, { type: 'confirm', resource: collections[type], id, label });
}
async function submitDialog() {
  if (!dialogState || dialogSaving) return;
  const config = { ...dialogState };
  const form = $('#editor-form');
  const values = Object.fromEntries(new FormData(form));
  const submit = $('#dialog-submit');
  const originalLabel = submit.textContent;
  dialogSaving = true;
  $('fieldset', form).disabled = true;
  $$('button', dialog).forEach(b => { b.disabled = true; });
  submit.innerHTML = '<span class="spinner" aria-hidden="true"></span>正在处理…';
  $('#dialog-error').hidden = true;
  try {
    let successMessage = '';
    if (config.type === 'quick-model') {
      if (!values.model.trim()) throw new Error('请填写模型 ID。');
      const { settings } = await api('/settings', 'PUT', { baseUrl: values.baseUrl.trim(), model: values.model.trim(), apiKey: values.apiKey });
      state.data.settings = settings;
      state.testResult = null;
      if (!state.settingsDirty) state.settingsDraft = null;
      else Object.assign(state.settingsDraft, { baseUrl: settings.baseUrl, model: settings.model, apiKey: '', clearApiKey: false });
      $('input[type="password"]', form).value = '';
      successMessage = '模型信息已保存。可先测试连接，再继续发送保留的第一句话。';
    } else if (config.type === 'persona') {
      const payload = { name: values.name.trim(), description: values.description.trim(), tone: values.tone.trim(), greeting: values.greeting.trim(), systemPrompt: values.systemPrompt.trim() };
      if (!payload.name || !payload.systemPrompt) throw new Error('角色名称和系统提示词不能为空。');
      const { persona } = await api(config.id ? `/personas/${endpointId(config.id)}` : '/personas', config.id ? 'PUT' : 'POST', payload);
      if (config.id) state.data.personas = state.data.personas.map(p => p.id === config.id ? persona : p);
      else { state.data.personas.push(persona); if (!state.personaId) state.personaId = persona.id; }
      successMessage = config.id ? '角色已更新。' : `已创建角色「${persona.name}」。`;
    } else if (config.type === 'memory') {
      const payload = { personaId: values.personaId || config.personaId, content: values.content.trim(), category: values.category, importance: Number(values.importance), confidence: Number(values.confidence), pinned: values.pinned === 'on' };
      if (!payload.content) throw new Error('记忆内容不能为空。');
      if (values.triples.trim() !== config.triplesText.trim()) {
        const lines = values.triples.split('\n').filter(line => line.trim());
        if (lines.length > 8) throw new Error('每条记忆最多填写 8 行关系。');
        const knownEntities = config.triples.flatMap(t => [t.subject, t.object]);
        const entity = name => ({ name, type: knownEntities.find(item => item.name === name)?.type || 'other' });
        payload.triples = lines.map(line => {
          const parts = line.split('|').map(part => part.trim());
          if (parts.length !== 3 || parts.some(part => !part)) throw new Error('每行关系请使用：主体 | 关系 | 客体。');
          return { subject: entity(parts[0]), predicate: parts[1], object: entity(parts[2]) };
        });
      }
      const { memory } = await api(config.id ? `/memories/${endpointId(config.id)}` : '/memories', config.id ? 'PUT' : 'POST', payload);
      if (config.id) state.data.memories = state.data.memories.map(m => m.id === config.id ? memory : m);
      else state.data.memories.unshift(memory);
      successMessage = config.id ? '记忆已更新。' : '新的记忆已保存。';
    } else if (config.type === 'task') {
      const nextRun = new Date(values.nextRunAt);
      if (Number.isNaN(nextRun.getTime())) throw new Error('请填写有效的本地执行时间。');
      const payload = { name: values.name.trim(), type: values.type, personaId: values.personaId || null, prompt: values.type === 'summarize' ? '' : values.prompt.trim(), scheduleType: values.scheduleType, intervalMinutes: values.scheduleType === 'interval' ? Number(values.intervalMinutes) : null, nextRunAt: nextRun.toISOString(), enabled: values.enabled === 'on' };
      if (!payload.name) throw new Error('任务名称不能为空。');
      if (payload.type !== 'reminder' && !payload.personaId) throw new Error('总结和 AI 提问任务需要关联一个角色。');
      if (payload.type === 'prompt' && !payload.prompt) throw new Error('请填写交给 AI 的问题。');
      const { task } = await api(config.id ? `/tasks/${endpointId(config.id)}` : '/tasks', config.id ? 'PUT' : 'POST', payload);
      if (config.id) state.data.tasks = state.data.tasks.map(t => t.id === config.id ? task : t);
      else state.data.tasks.unshift(task);
      successMessage = config.id ? '任务已更新。' : '任务已创建，请保持本地服务运行。';
    } else if (config.type === 'graph-extract') {
      const result = await api('/graph/extract', 'POST', { personaId: config.personaId });
      successMessage = `提取完成：处理 ${number(result.processed)} 条记忆，得到 ${number(result.relations)} 条关系，跳过 ${number(result.skipped)} 条，剩余 ${number(result.remaining)} 条待处理。`;
    } else if (config.type === 'summary') {
      const result = await api('/memories/summarize', 'POST', { personaId: values.personaId });
      successMessage = `总结完成：处理 ${number(result.processed)} 条消息，创建 ${number(result.created)} 条记忆。`;
    } else if (config.type === 'confirm') {
      await api(`/${config.resource}/${endpointId(config.id)}`, 'DELETE');
      state.data[config.resource] = state.data[config.resource].filter(item => item.id !== config.id);
      if (config.resource === 'documents') state.knowledge.result = null;
      successMessage = `${config.label}已删除。`;
    }
    dialogSaving = false;
    dialog.close();
    toast(successMessage);
    renderPage();
    void refreshData({ silent: true });
  } catch (error) {
    const errorBox = $('#dialog-error');
    errorBox.textContent = error.message;
    errorBox.hidden = false;
    errorBox.scrollIntoView({ block: 'nearest' });
  } finally {
    dialogSaving = false;
    if (dialog.open && $('#editor-form') === form) {
      $('fieldset', form).disabled = false;
      $$('button', dialog).forEach(b => { b.disabled = false; });
      submit.textContent = originalLabel;
      if (config.type === 'task') updateTaskFields();
    }
  }
}

$('#navigation').innerHTML = Object.entries(PAGES).map(([page, [name, symbol, ordinal]]) => `<a class="nav-item" href="#${page}" data-page="${page}" aria-label="${e(name)}" title="${e(name)}">${icon(symbol)}<span class="nav-label">${e(name)}</span><span class="nav-number" aria-hidden="true">${ordinal}</span></a>`).join('');
$('#refresh-button').addEventListener('click', async () => {
  await refreshData();
  if (state.page === 'chat' && state.conversationId && !state.sending) await loadConversation(state.conversationId);
});
window.addEventListener('hashchange', () => navigate(location.hash.slice(1)));
dialog.addEventListener('cancel', event => { if (dialogSaving) event.preventDefault(); });
dialog.addEventListener('close', () => {
  if (!dialog.open) {
    if (dialogState?.type === 'quick-model') $$('input[type="password"]', dialog).forEach(input => { input.value = ''; });
    dialogState = null;
  }
});

document.addEventListener('click', async event => {
  const control = event.target.closest('[data-action]');
  if (!control || control.disabled) return;
  const action = control.dataset.action;
  const id = control.dataset.id;
  try {
    if (action === 'close-dialog') { if (!dialogSaving) dialog.close(); return; }
    if (action === 'refresh') { await refreshData(); return; }
    if (!state.data) return;
    switch (action) {
      case 'new-conversation': await newConversation(); break;
      case 'open-conversation': await openConversation(id); break;
      case 'reload-conversation': await loadConversation(state.conversationId); break;
      case 'create-persona': openPersonaEditor(); break;
      case 'edit-persona': openPersonaEditor(state.data.personas.find(p => p.id === id)); break;
      case 'chat-as-persona':
        selectPersona(id);
        if (location.hash !== '#chat') location.hash = 'chat'; else navigate('chat');
        break;
      case 'use-analysis': if (state.analysis.result) openPersonaEditor(null, true); break;
      case 'delete-document': confirmDelete('document', id); break;
      case 'memory-view-list': state.memoryView = 'list'; renderPage(); break;
      case 'memory-view-graph':
        state.memoryView = 'graph';
        state.graph.personaId = state.memoryRole !== 'all' ? state.memoryRole : state.graph.personaId || state.personaId;
        await loadGraph();
        break;
      case 'refresh-graph': await loadGraph(); break;
      case 'extract-graph': openGraphExtraction(); break;
      case 'create-memory': openMemoryEditor(); break;
      case 'edit-memory': openMemoryEditor(state.data.memories.find(m => m.id === id)); break;
      case 'pin-memory': { const m = state.data.memories.find(item => item.id === id); if (m) await updateMemory(id, { pinned: !m.pinned }); break; }
      case 'archive-memory': { const m = state.data.memories.find(item => item.id === id); if (m) await updateMemory(id, { status: m.status === 'active' ? 'archived' : 'active' }); break; }
      case 'delete-memory': confirmDelete('memory', id); break;
      case 'maintain-memories': await maintainMemories(); break;
      case 'summarize-memories': openSummaryDialog(); break;
      case 'create-task': openTaskEditor(); break;
      case 'edit-task': openTaskEditor(state.data.tasks.find(t => t.id === id)); break;
      case 'toggle-task': await taskAction(id, 'toggle'); break;
      case 'run-task': await taskAction(id, 'run'); break;
      case 'delete-task': confirmDelete('task', id); break;
      case 'test-settings': await testSettings(); break;
      case 'quick-model-setup': if (!state.sending && !state.testBusy) openQuickModelSetup(); break;
      case 'resume-setup-chat': if (!state.testBusy) await sendMessage(); break;
      default: break;
    }
  } catch (error) { toast(error.message || '操作未能完成，请重试。', 'error'); }
});
document.addEventListener('submit', event => {
  const actions = { 'chat-form': sendMessage, 'analysis-form': analyze, 'knowledge-form': searchKnowledge, 'settings-form': saveSettings, 'editor-form': submitDialog };
  const action = actions[event.target.id];
  if (!action) return;
  event.preventDefault();
  void action().catch(error => toast(error.message || '操作未能完成，请重试。', 'error'));
});
document.addEventListener('input', event => {
  const target = event.target;
  if (target.id === 'chat-input') state.drafts.set(currentDraftKey(), target.value);
  else if (target.id === 'analysis-target') state.analysis.target = target.value;
  else if (target.id === 'analysis-text') state.analysis.text = target.value;
  else if (target.id === 'knowledge-query') state.knowledge.query = target.value;
  else if (target.closest('#settings-form') && target.name) {
    state.settingsDraft[target.name] = target.type === 'checkbox' ? target.checked : target.value;
    state.settingsDirty = true;
    const hint = $('.settings-actions > .muted');
    if (hint) hint.textContent = '有尚未保存的修改 · 连接测试只使用已保存配置';
    if (target.name === 'clearApiKey') $('#settings-apiKey').disabled = target.checked;
  }
});
document.addEventListener('change', event => {
  const target = event.target;
  if (target.id === 'chat-persona') selectPersona(target.value);
  else if (target.id === 'memory-role') { state.memoryRole = target.value; renderPage(); }
  else if (target.id === 'memory-status') { state.memoryStatus = target.value; renderPage(); }
  else if (target.id === 'graph-persona') { state.graph.personaId = target.value; void loadGraph(); }
  else if (target.id === 'graph-archived') { state.graph.includeArchived = target.checked; void loadGraph(); }
  else if (target.id === 'analysis-file') void readAnalysisFile(target.files[0]);
  else if (target.id === 'document-files') void uploadDocuments([...target.files]);
  else if (target.id === 'task-type' || target.id === 'task-scheduleType') updateTaskFields();
});
document.addEventListener('keydown', event => {
  if (event.target.id === 'chat-input' && event.key === 'Enter' && !window.matchMedia('(pointer: coarse)').matches && !event.shiftKey && !event.isComposing && event.keyCode !== 229 && !event.ctrlKey && !event.metaKey && !event.altKey) {
    event.preventDefault();
    $('#chat-form')?.requestSubmit();
  }
});
main.addEventListener('dragover', event => {
  const zone = event.target.closest('#document-drop');
  if (zone) { event.preventDefault(); if (!state.knowledge.uploading) zone.classList.add('drag-over'); }
});
main.addEventListener('dragleave', event => {
  const zone = event.target.closest('#document-drop');
  if (zone && !zone.contains(event.relatedTarget)) zone.classList.remove('drag-over');
});
main.addEventListener('drop', event => {
  const zone = event.target.closest('#document-drop');
  if (zone) { event.preventDefault(); zone.classList.remove('drag-over'); void uploadDocuments([...event.dataTransfer.files]); }
});
// Only local reads are automatic. No model tests, analysis, or external requests run on load.
setInterval(() => {
  if (document.visibilityState === 'visible' && state.data && !state.refreshing && !dialogSaving && !state.sending && !state.newConversationBusy && !state.settingsSaving && !state.knowledge.uploading && state.busy.size === 0 && !mediaUI.isBusy() && !mailUI.isBusy() && !guidesUI.isBusy()) void refreshData({ silent: true });
}, 60_000);
renderPage();
void refreshData({ silent: true });
