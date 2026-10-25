import { renderAttachments } from './media.js';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const keys = { stickerLinked:'表情包随情绪回应', musicLinked:'低频自然推荐歌曲', petLinked:'宠物随对话状态表现' };
const song = item => ['song', 'song-search'].includes(item.type);
export function createResponseUI({ request, redraw, toast, onFeedback, onSettings }) {
  const state = { info:null, draft:null, busy:false, error:'', feedbackBusy:new Set(), context:null, snapshot:null };
  function sync(info) { if (!info || !Number.isInteger(info.revision) || (state.info && info.revision < state.info.revision)) return; state.info = info; }
  const settings = () => state.info || { stickerLinked:true, musicLinked:true, petLinked:true, revision:0 };
  function renderSettings() {
    const draft = state.draft || settings();
    return `<section class="card response-settings" aria-labelledby="response-settings-title"><div class="card-header"><div><h2 id="response-settings-title">让回应贴合此刻</h2><p class="small muted">根据当前需要、情绪和精力，调整表达与陪伴。</p></div></div><form id="response-settings-form"><fieldset${state.busy ? ' disabled' : ''}><div class="response-switches">${Object.entries(keys).map(([key,label]) => `<label class="checkbox-label"><input type="checkbox" name="${key}" aria-label="${label}" aria-describedby="response-help-${key}"${draft[key] ? ' checked' : ''}><span>${label}<small id="response-help-${key}">${key === 'stickerLinked' ? '本地优先，每次最多一张，避免连续发送。' : key === 'musicLinked' ? '每 5 次回复最多一次；少追问或疲惫时为 10 次，始终点击后播放。' : '安静、温和陪伴、专注、短暂庆祝和听歌轻摆。'}</small></span></label>`).join('')}</div><p class="small muted">关闭表情或歌曲联动后，仍可明确要求相应内容；原有媒体总开关继续生效。关闭宠物联动后保留普通陪伴表现。音乐推荐不会切歌、调整音量或改动播放队列。</p><div class="response-setting-actions"><span class="small muted">${state.draft ? '有尚未保存的联动设置' : '三个开关独立保存，应用于后续回复。'}</span><button type="submit" class="button primary">${state.busy ? '正在保存…' : '保存回应联动设置'}</button><button type="button" class="button" data-response-action="reload-settings">重新读取联动设置</button></div></fieldset>${state.error ? `<p class="inline-error" role="alert">${esc(state.error)}</p>` : ''}</form></section>`;
  }
  function renderMessage(message) {
    const items = message.attachments || [], hasSong = items.some(song), dismissed = ['skip','mute'].includes(message.musicFeedback), busy = state.feedbackBusy.has(message.id);
    const action = (name,label) => `<button type="button" data-response-action="${name}" data-message-id="${message.id}" data-conversation-id="${esc(message.conversationId)}"${busy ? ' disabled' : ''}>${label}</button>`;
    const media = renderAttachments(dismissed ? items.filter(item => !song(item)) : items);
    const feedback = hasSong ? `<div class="response-song-feedback" aria-label="歌曲推荐反馈">${dismissed ? `<span>已收起这次推荐${message.musicFeedback === 'mute' ? '，本会话已暂停主动推歌' : ''}。</span>${action('restore','重新显示这首歌')}` : `${action('skip','这次不需要')}${action('mute','本会话不再主动推荐')}`}<span role="status">${busy ? '正在保存反馈…' : ''}</span></div>` : '';
    const behavior = message.responseBehavior, basis = behavior?.evidence?.length ? `<details class="response-basis" data-detail="response-${message.id}"><summary>本轮回应依据 · ${esc(behavior.label)}</summary><p>先回应当前需要，再结合情绪和精力选择表达。${behavior.proactiveSong ? `本轮自然推荐歌曲，推荐间隔至少 ${behavior.interval} 次回复。` : ''}</p>${behavior.evidence.map(field => `<div><strong>${esc(field.label)}：${esc(field.value)}</strong><small>${field.origin === 'manual' ? '你手动指定' : '根据本会话原话推测'}</small>${(field.evidence || []).map(item => `<blockquote>${esc(item.quote)}</blockquote>`).join('')}</div>`).join('')}</details>` : '';
    return media + feedback + basis;
  }
  function renderSession() {
    return state.context?.conversationId && state.snapshot?.responseBehavior?.musicMuted ? '<div class="response-session"><span>本会话已暂停主动推歌，仍可直接点歌。</span><button type="button" data-response-action="unmute">恢复本会话推荐</button></div>' : '';
  }
  document.addEventListener('input', event => {
    const target = event.target; if (!target.closest('#response-settings-form') || !(target.name in keys)) return;
    state.draft ||= { ...settings() }; state.draft[target.name] = target.checked;
  });
  document.addEventListener('submit', async event => {
    if (event.target.id !== 'response-settings-form') return; event.preventDefault(); if (state.busy) return;
    const payload = state.draft || settings(); state.busy = true; state.error = ''; redraw();
    try {
      const result = await request('/response-settings','PUT',{ ...Object.fromEntries(Object.keys(keys).map(key => [key,payload[key]])),expectedRevision:payload.revision });
      sync(result.responseSettings); state.draft = null; onSettings(result.responseSettings); toast('回应联动设置已保存。');
    } catch (error) { state.error = error.message; } finally { state.busy = false; redraw(); }
  });
  document.addEventListener('click', async event => {
    const control = event.target.closest('[data-response-action]'); if (!control || control.disabled) return;
    const action = control.dataset.responseAction;
    if (action === 'reload-settings') {
      if (state.busy) return; control.disabled = true;
      try { const result = await request('/response-settings'); sync(result.responseSettings); state.draft = null; state.error = ''; redraw(); }
      catch (error) { toast(error.message,'error'); } finally { control.disabled = false; } return;
    }
    if (!['skip','mute','restore','unmute'].includes(action)) return;
    const conversationId = control.dataset.conversationId || state.context?.conversationId, messageId = Number(control.dataset.messageId);
    if (!conversationId || state.feedbackBusy.has(messageId)) return;
    state.feedbackBusy.add(messageId); redraw();
    try {
      const result = await request(`/conversations/${encodeURIComponent(conversationId)}/music-feedback`,'POST',{ action,...(action === 'unmute' ? {} : { messageId }) });
      onFeedback(result); toast(action === 'mute' ? '本会话已暂停主动推歌，仍可直接点歌。' : action === 'unmute' ? '本会话已恢复低频推荐。' : action === 'restore' ? '歌曲推荐已重新显示。' : '已收起这次推荐。');
    } catch (error) { toast(error.message,'error'); } finally { state.feedbackBusy.delete(messageId); redraw(); }
  });
  return { sync, settings, renderSettings, renderMessage, renderSession, setContext:(context,snapshot) => { state.context=context; state.snapshot=snapshot; }, isBusy:() => state.busy || Boolean(state.draft) || state.feedbackBusy.size > 0 };
}
