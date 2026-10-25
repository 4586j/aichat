const $ = (selector, root = document) => root.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const off = value => value ? ' disabled' : '';
const labels = { sending: '正在提交', sent: '服务器已接受', partial: '部分接受', failed: '提交失败', unknown: '结果待核实' };
const action = (label, name, extra = '', primary = false, busy = false) => `<button type="button" class="button${primary ? ' primary' : ''}" data-mail-action="${name}" ${extra}${off(busy)}>${label}</button>`;

export function createMailUI({ request, toast, redraw }) {
  const state = { info: null, config: null, dirty: false, busy: '', feedback: '', error: '', compose: null, preview: null, result: null, view: 'compose' };
  const dialog = document.createElement('dialog');
  dialog.id = 'mail-dialog'; dialog.className = 'mail-dialog'; dialog.setAttribute('aria-labelledby', 'mail-title');
  document.body.append(dialog);
  const saved = () => state.info?.settings || { host: '', port: 465, security: 'tls', user: '', from: '', fromName: '', hasPassword: false };
  const config = () => state.config ||= { ...saved(), password: '', clearPassword: false };
  const blank = () => ({ to: '', cc: '', bcc: '', subject: '', text: '', instruction: '' });
  function sync(info) { if (!info?.settings) return; state.info = info; if (!state.dirty) state.config = null; }
  function renderSettings() {
    const c = config();
    return `<section id="mail-settings" class="mail-settings"><div class="card-header"><div><div class="eyebrow">LETTERS, WITH INTENTION</div><h2>把想说的话，寄出去</h2><p class="small muted">先写草稿、再核对，最后由你确认发送。</p></div>${action('写一封邮件', 'open')}</div><div class="mail-settings-grid"><form id="mail-settings-form" class="card settings-card"><fieldset${off(state.busy)}><h3>邮件服务 · SMTP</h3><div class="mail-two-columns"><div class="field"><label for="smtp-host">SMTP 主机</label><input id="smtp-host" name="host" maxlength="254" value="${esc(c.host)}" placeholder="smtp.example.com" autocomplete="off"><small>只填域名或 IP；服务地址可以先留空。</small></div><div class="field"><label for="smtp-port">端口</label><input id="smtp-port" name="port" type="number" min="1" max="65535" value="${esc(c.port)}" required></div></div><div class="field"><label for="smtp-security">连接加密</label><select id="smtp-security" name="security"><option value="tls"${c.security === 'tls' ? ' selected' : ''}>TLS（常用端口 465）</option><option value="starttls"${c.security === 'starttls' ? ' selected' : ''}>STARTTLS（常用端口 587）</option></select></div><div class="field"><label for="smtp-user">SMTP 用户名</label><input id="smtp-user" name="user" maxlength="254" value="${esc(c.user)}" autocomplete="username" placeholder="通常为完整邮箱地址"><small>仅在服务商允许免认证中继时留空。</small></div><div class="field"><label for="smtp-password">SMTP 密码 / 邮箱授权码</label><input id="smtp-password" name="password" type="password" maxlength="2000" value="${esc(c.password)}" autocomplete="new-password" placeholder="${saved().hasPassword ? '已配置，留空保留' : '按邮箱服务商要求填写授权码'}"><small>只保留在服务进程内存中；重启后重新填写或使用 SMTP_PASSWORD。</small></div><label class="checkbox-label"><input type="checkbox" name="clearPassword"${c.clearPassword ? ' checked' : ''}>清除当前运行期密码</label><div class="mail-two-columns"><div class="field"><label for="smtp-from">发件邮箱</label><input id="smtp-from" name="from" type="email" maxlength="254" value="${esc(c.from)}" placeholder="you@example.com"></div><div class="field"><label for="smtp-from-name">发件人名称</label><input id="smtp-from-name" name="fromName" maxlength="100" value="${esc(c.fromName)}" placeholder="可选"></div></div><p class="small muted">更换主机或用户名时，请重新填写密码。所有邮件均使用加密连接。</p><p class="mail-feedback small" role="status">${esc(state.feedback || (state.dirty ? '有尚未保存的邮件设置' : '配置保存在本地，保存不会自动连接或发信'))}</p><div class="card-actions"><button type="submit" class="button primary"${off(state.busy)}>保存邮件设置</button>${action('测试已保存的 SMTP 连接', 'verify', '', false, state.busy)}</div></fieldset></form><aside class="card settings-card mail-notes"><span class="mail-stamp" aria-hidden="true">栖<br>忆</span><h3>一封信，认真送达</h3><p>从顶部信封按钮随时开始写信，也可以把某条 AI 回复带入邮件。</p><p>AI 起草只生成主题和正文。收件人由你填写；预览时会逐一列出收件、抄送和密送地址。</p><p>连接测试只检查 SMTP 连接和认证。实际发送后会记录服务器接受或拒绝的地址，最终送达请留意退信。</p>${action('查看发送记录', 'history')}<small class="muted">最近 100 条发送尝试保存在本地，包含正文和收件人，可逐条删除。</small></aside></div></section>`;
  }
  function recipientLine(label, list) { return list?.length ? `<dt>${label}</dt><dd>${list.map(esc).join('<br>')}</dd>` : ''; }
  function letter(message) {
    return `<dl class="mail-envelope"><dt>发件人</dt><dd>${esc(message.fromName)} ${esc(message.from)}</dd>${recipientLine('收件人', message.to)}${recipientLine('抄送', message.cc)}${recipientLine('密送', message.bcc)}</dl><h3 class="mail-subject">${esc(message.subject)}</h3><div class="mail-letter plain-text">${esc(message.text)}</div>`;
  }
  function recipientResult(row) {
    return `${row.accepted?.length ? `<p class="small">已接受：${row.accepted.map(esc).join('，')}</p>` : ''}${row.rejected?.length ? `<p class="small mail-error">已拒绝：${row.rejected.map(esc).join('，')}</p>` : ''}`;
  }
  function drawDialog() {
    const c = state.compose ||= blank(), busy = Boolean(state.busy);
    const title = state.view === 'history' ? '寄出的回响' : state.result ? '本次发送结果' : state.preview ? '发送前，再读一遍' : '写一封邮件';
    let body;
    if (state.view === 'history') {
      body = `<div class="mail-history"><p class="small muted">最近 100 条发送尝试。“服务器已接受”表示 SMTP 提交成功，最终送达请留意退信。</p>${(state.info?.history || []).length ? state.info.history.map(row => `<article class="mail-history-item"><div class="card-header"><strong>${esc(row.message.subject)}</strong><span class="pill mail-status-${row.status}">${labels[row.status] || '结果待核实'}</span></div><p class="small muted">${esc(new Date(row.createdAt).toLocaleString('zh-CN', { hour12: false }))} · ${esc(row.message.to.join(', '))}</p><p class="small">${esc(row.notice || '发送请求正在处理，请稍后刷新记录。')}</p><details><summary>查看邮件内容与收件结果</summary>${letter(row.message)}${recipientResult(row)}</details><div class="card-actions">${action('用作新草稿', 'reuse', `data-mail-id="${row.id}"`, false, busy)}${action('删除本地记录', 'delete', `data-mail-id="${row.id}"`, false, busy || row.status === 'sending')}</div></article>`).join('') : '<div class="empty-state"><h3>还没有发送记录</h3><p>每封经过确认的邮件，都会在这里留下回响。</p></div>'}</div><div class="mail-dialog-actions">${action('刷新记录', 'history', '', false, busy)}${action('写一封邮件', 'new', '', true, busy)}</div>`;
    } else if (state.result) {
      const r = state.result;
      body = `<div class="mail-result" role="status"><span class="pill mail-status-${r.status}">${labels[r.status] || '结果待核实'}</span><p>${esc(r.notice || '发送请求正在处理，请稍后刷新记录。')}</p>${recipientResult(r)}</div>${letter(r.message)}<div class="mail-dialog-actions">${action('查看发送记录', 'history', '', false, busy)}${action('写下一封', 'new', '', true, busy)}</div>`;
    } else if (state.preview) {
      body = `<div class="notice"><p>请核对以下内容。点击“确认发送”后，邮件将提交到已保存的 SMTP 服务。预览有效期 10 分钟。</p></div>${letter(state.preview.message)}<div class="mail-dialog-actions">${action('返回修改', 'edit', '', false, busy)}${action(busy ? '正在提交…' : '确认发送', 'send', '', true, busy)}</div>`;
    } else {
      body = `<p class="small muted">${saved().host ? `使用已保存的发件邮箱 ${esc(saved().from || '（尚未填写）')}` : '尚未配置邮件服务。可以先起草，再前往设置填写 SMTP。'}</p><details class="mail-ai-draft"${c.instruction ? ' open' : ''}><summary>让 AI 帮我起草</summary><label for="mail-instruction">想写给谁，说明什么？</label><textarea id="mail-instruction" name="instruction" rows="3" maxlength="4000" placeholder="例如：写一封简洁、礼貌的会议邀请，时间与地点保留待补充。"${off(busy)}>${esc(c.instruction)}</textarea><p class="small muted">起草需求会发送给已配置的模型；不会携带 SMTP 设置和收件地址。生成内容可继续编辑。</p>${action(state.busy === 'draft' ? '正在起草…' : '生成主题和正文', 'draft', '', false, busy)}</details><form id="mail-compose-form"><div class="field"><label for="mail-to">收件人</label><input id="mail-to" name="to" value="${esc(c.to)}" maxlength="6000" required placeholder="name@example.com，多个地址用逗号分隔"${off(busy)}></div><div class="mail-two-columns"><div class="field"><label for="mail-cc">抄送（可选）</label><input id="mail-cc" name="cc" value="${esc(c.cc)}" maxlength="6000"${off(busy)}></div><div class="field"><label for="mail-bcc">密送（可选）</label><input id="mail-bcc" name="bcc" value="${esc(c.bcc)}" maxlength="6000"${off(busy)}></div></div><div class="field"><label for="mail-subject">主题</label><input id="mail-subject" name="subject" maxlength="200" value="${esc(c.subject)}" required${off(busy)}></div><div class="field"><label for="mail-text">正文</label><textarea id="mail-text" name="text" rows="10" maxlength="50000" required placeholder="把想说的话，慢慢写下来。"${off(busy)}>${esc(c.text)}</textarea><small>纯文本邮件，每封最多 20 位收件人。草稿只在当前页面内保留。</small></div><div class="mail-dialog-actions">${action('邮件设置', 'settings', '', false, busy)}<button class="button primary" type="submit"${off(busy)}>预览邮件</button></div></form>`;
    }
    dialog.innerHTML = `<header class="dialog-header"><div><div class="eyebrow">A LETTER FROM HERE</div><h2 id="mail-title">${title}</h2></div><button type="button" class="icon-button" data-mail-action="close" aria-label="关闭邮件面板"${off(busy)}>×</button></header><div class="mail-dialog-body">${state.error ? `<p class="inline-error" role="alert">${esc(state.error)}</p>` : ''}${body}</div>`;
  }
  function open(content) {
    if (state.busy) return;
    if (content !== undefined && state.compose && Object.values(state.compose).some(Boolean) && !window.confirm('将 AI 回复带入新的邮件草稿？当前草稿将被替换。')) return;
    if (content !== undefined) state.compose = { ...blank(), text: content };
    state.view = 'compose'; state.preview = null; state.result = null; state.error = '';
    drawDialog(); if (!dialog.open) dialog.showModal();
  }
  function updateEntry(row) {
    state.info ||= { settings: saved(), history: [] };
    state.info.history = [row, ...state.info.history.filter(item => item.id !== row.id)].slice(0, 100);
  }
  async function run(kind, fn, inDialog = false) {
    if (state.busy) return;
    state.busy = kind; state.error = ''; state.feedback = '';
    if (inDialog) drawDialog(); else redraw();
    try { await fn(); }
    catch (error) { if (inDialog) state.error = error.message; else { state.feedback = error.message; toast(error.message, 'error'); } }
    finally { state.busy = ''; if (inDialog) drawDialog(); else redraw(); }
  }
  async function history() {
    await run('history', async () => { const data = await request('/mail/history'); state.info ||= { settings: saved(), history: [] }; state.info.history = data.history; state.view = 'history'; state.preview = null; state.result = null; }, true);
    if (!dialog.open) dialog.showModal();
  }
  document.addEventListener('input', event => {
    const t = event.target;
    if (t.closest('#mail-settings-form') && t.name) { config()[t.name] = t.type === 'checkbox' ? t.checked : t.name === 'port' ? Number(t.value) : t.value; state.dirty = true; }
    if ((t.closest('#mail-compose-form') || t.id === 'mail-instruction') && t.name) { (state.compose ||= blank())[t.name] = t.value; state.preview = null; }
  });
  document.addEventListener('change', event => {
    if (event.target.id === 'smtp-security') { const c = config(); if ([465, 587].includes(c.port)) { c.port = c.security === 'tls' ? 465 : 587; $('#smtp-port').value = c.port; } }
  });
  document.addEventListener('submit', event => {
    if (event.target.id === 'mail-settings-form') {
      event.preventDefault();
      void run('save', async () => { const { settings } = await request('/mail/settings', 'PUT', config()); state.info = { settings, history: state.info?.history || [] }; state.dirty = false; state.config = null; state.feedback = '邮件设置已保存。'; toast('邮件设置已保存'); });
    } else if (event.target.id === 'mail-compose-form') {
      event.preventDefault();
      void run('prepare', async () => { if (state.dirty) throw new Error('请先保存邮件设置，再预览发送。'); const { preview } = await request('/mail/prepare', 'POST', state.compose); state.preview = preview; }, true);
    }
  });
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-mail-action]'); if (!button || button.disabled) return;
    const name = button.dataset.mailAction;
    if (name === 'open') open();
    else if (name === 'from-reply') open(button.closest('.message')?.querySelector('.message-content')?.textContent || '');
    else if (name === 'close' && !state.busy) dialog.close();
    else if (name === 'settings') { dialog.close(); location.hash = 'settings'; setTimeout(() => $('#mail-settings')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50); }
    else if (name === 'new' && !state.busy) {
      if (state.compose && Object.values(state.compose).some(Boolean) && !state.result && !window.confirm('清空当前草稿，开始写新邮件？')) return;
      state.compose = blank(); open();
    } else if (name === 'edit' && !state.busy) { state.preview = null; state.error = ''; drawDialog(); }
    else if (name === 'verify') void run('verify', async () => { if (state.dirty) throw new Error('请先保存邮件设置，再测试连接。'); const result = await request('/mail/verify', 'POST', {}); state.feedback = result.message; });
    else if (name === 'draft') void run('draft', async () => {
      const c = state.compose;
      if ((c.subject || c.text) && !window.confirm('用 AI 新草稿替换当前主题和正文？收件人会保留。')) return;
      const { draft } = await request('/mail/draft', 'POST', { instruction: c.instruction }); c.subject = draft.subject; c.text = draft.text;
    }, true);
    else if (name === 'send') void run('send', async () => {
      const { mail } = await request('/mail/send', 'POST', { token: state.preview.id, confirmed: true }); state.result = mail; updateEntry(mail); state.preview = null; state.compose = blank();
    }, true);
    else if (name === 'history') void history();
    else if (name === 'reuse' && !state.busy) {
      const row = state.info?.history.find(item => item.id === button.dataset.mailId); if (!row) return;
      if (!window.confirm('把这封邮件复制为新草稿？请核实之前的投递情况，避免重复发送。')) return;
      state.compose = { ...blank(), ...row.message, to: row.message.to.join(', '), cc: row.message.cc.join(', '), bcc: row.message.bcc.join(', ') }; open();
    } else if (name === 'delete') void run('delete', async () => {
      if (!window.confirm('删除这条本地发送记录？这不会撤回已提交的邮件。')) return;
      await request(`/mail/history/${encodeURIComponent(button.dataset.mailId)}`, 'DELETE', {}); state.info.history = state.info.history.filter(row => row.id !== button.dataset.mailId);
    }, true);
  });
  dialog.addEventListener('cancel', event => { if (state.busy) event.preventDefault(); });
  return { sync, renderSettings, isBusy: () => Boolean(state.busy || state.dirty || dialog.open) };
}
