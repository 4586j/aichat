const $ = (selector, root = document) => root.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const off = value => value ? ' disabled' : '';
const inline = text => esc(text).replace(/`([^`]+)`/g, '<code>$1</code>');
function markdown(content) {
  const result = []; let paragraph = [], list = [], code = null;
  const flush = () => { if (paragraph.length) result.push(`<p>${inline(paragraph.join('\n'))}</p>`); paragraph = []; if (list.length) result.push(`<ul>${list.map(line => `<li>${inline(line)}</li>`).join('')}</ul>`); list = []; };
  for (const line of content.split('\n')) {
    if (/^```/.test(line)) { flush(); if (code) { result.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`); code = null; } else code = []; continue; }
    if (code) { code.push(line); continue; }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) { flush(); if (heading[1].length > 1) result.push(`<h3>${inline(heading[2])}</h3>`); }
    else if (!line.trim()) flush();
    else if (/^- /.test(line)) { if (paragraph.length) flush(); list.push(line.slice(2)); }
    else { if (list.length) flush(); paragraph.push(line); }
  }
  flush(); if (code) result.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);
  return result.join('');
}

export function createGuidesUI({ request, askInChat }) {
  const state = { info: null, modelConfigured: false, topic: 'start', document: null, question: '', loading: false, syncing: false, error: '', feedback: '', sequence: 0 };
  const dialog = document.createElement('dialog'); dialog.id = 'guides-dialog'; dialog.className = 'guides-dialog'; dialog.setAttribute('aria-labelledby', 'guides-title');
  document.body.append(dialog);
  function sync(info, modelConfigured = false) { if (info?.documents) state.info = info; state.modelConfigured = modelConfigured; }
  function renderEntry() {
    return `<section class="guide-entry" aria-label="配置帮助"><div><h2>配置遇到问题，先翻翻指南</h2><p>模型还没连接也能阅读；连接后，把问题带到聊天中，AI 会按相关文档解释。</p></div><div class="guide-entry-topics">${(state.info?.documents || []).map(doc => `<button type="button" class="button small" data-guide-action="open" data-guide-id="${esc(doc.id)}">${esc(doc.title)}</button>`).join('')}</div></section>`;
  }
  function draw() {
    const info = state.info, doc = state.document;
    dialog.innerHTML = `<header class="dialog-header"><div><h2 id="guides-title">配置指南</h2><p class="small muted">${info ? `${info.source === 'github' ? 'GitHub 本地副本' : '应用内置副本'} · 适用 ${esc(info.appVersion)} · 修订 ${esc(info.revision)}` : '正在读取本地指南'}</p></div><button class="icon-button" type="button" data-guide-action="close" aria-label="关闭配置指南">×</button></header><div class="guide-layout"><nav class="guide-topics" aria-label="配置指南目录">${(info?.documents || []).map(item => `<button type="button" data-guide-action="topic" data-guide-id="${esc(item.id)}"${item.id === state.topic ? ' aria-current="page"' : ''}>${esc(item.title)}</button>`).join('')}</nav><div class="guide-reading"><p class="guide-feedback small${state.error ? ' inline-error' : ''}" role="${state.error ? 'alert' : 'status'}">${esc(state.error || state.feedback || '本地可阅读；点击更新时才会连接 GitHub。')}</p><article class="guide-document" aria-busy="${state.loading}">${state.loading ? '<p role="status">正在读取指南…</p>' : doc ? `<h2>${esc(doc.title)}</h2>${markdown(doc.content)}` : '<p>暂时无法读取指南，请重新选择一个主题。</p>'}</article><section class="guide-question"><h3>让 AI 结合指南帮我看看</h3><p class="small muted">${state.modelConfigured ? 'AI 会收到相关文档和字段是否填写的状态。请描述现象，不要粘贴密码、Key 或授权码。' : '先按模型指南完成连接；现在可以直接阅读所有文档。'}</p><label class="sr-only" for="guide-question">想向 AI 询问的配置问题</label><textarea id="guide-question" rows="2" maxlength="1500" placeholder="例如：音乐服务地址应该填在哪里？">${esc(state.question)}</textarea><button type="button" class="button primary" data-guide-action="ask"${off(!state.modelConfigured || !doc || state.loading)}>带到聊天中询问</button><small class="muted">只填入聊天草稿，由你点击发送。</small></section></div></div><footer class="guide-footer"><p class="small muted">文档来自 4586j/aichat。更新只下载文档，不上传你的设置或问题。${info?.lastSyncedAt ? `上次下载：${esc(new Date(info.lastSyncedAt).toLocaleString('zh-CN', { hour12: false }))}` : ''}</p><button type="button" class="button" data-guide-action="sync"${off(state.syncing)}>${state.syncing ? '正在检查 GitHub…' : '从 GitHub 更新指南'}</button></footer>`;
  }
  async function load(topic) {
    const sequence = ++state.sequence; state.topic = topic; state.loading = true; state.document = null; draw();
    try { const { document } = await request(`/guides/${encodeURIComponent(topic)}`); if (sequence === state.sequence) state.document = document; }
    catch (error) { if (sequence === state.sequence) state.error = error.message; }
    finally { if (sequence === state.sequence) { state.loading = false; draw(); } }
  }
  async function open(topic = 'start') {
    state.error = ''; state.feedback = ''; draw(); if (!dialog.open) dialog.showModal();
    if (!state.info) { try { const data = await request('/guides'); state.info = data.guides; } catch (error) { state.error = error.message; draw(); return; } }
    await load(state.info.documents.some(item => item.id === topic) ? topic : 'start');
  }
  async function update() {
    if (state.syncing) return; state.syncing = true; state.error = ''; state.feedback = ''; draw();
    try { const result = await request('/guides/sync', 'POST', {}); state.info = result.guides; state.feedback = result.message; await load(state.topic); }
    catch (error) { state.error = error.message; }
    finally { state.syncing = false; draw(); }
  }
  document.addEventListener('input', event => { if (event.target.id === 'guide-question') state.question = event.target.value; });
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-guide-action]'); if (!button || button.disabled) return;
    const name = button.dataset.guideAction;
    if (name === 'open') void open(button.dataset.guideId || 'start');
    else if (name === 'topic') { state.error = ''; void load(button.dataset.guideId); }
    else if (name === 'close') dialog.close();
    else if (name === 'sync') void update();
    else if (name === 'ask' && state.document && state.modelConfigured) {
      const question = `请根据栖忆配置指南，帮助我配置“${state.document.title}”。\n${state.question.trim() || '请说明需要准备哪些信息、应该在哪里填写，以及保存后如何验证。'}`;
      if (askInChat(question)) { dialog.close(); state.question = ''; requestAnimationFrame(() => $('#chat-input')?.focus()); }
    }
  });
  return { sync, setModelConfigured: value => { state.modelConfigured = Boolean(value); }, renderEntry, isBusy: () => dialog.open || state.syncing || state.loading };
}
