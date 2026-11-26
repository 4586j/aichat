const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const NUMBERS = [
  ['idleMinutes', '静默多久后可主动开口', '分钟', 10, 10080],
  ['cooldownMinutes', '两次主动发言的最短间隔', '分钟', 5, 1440],
  ['dailyLimit', '每日主动发言上限', '条', 0, 20],
];
const TRIGGERS = { idle: '静默触发（你一段时间没说话时）', routine: '早晚问候（每天最多各一次）' };
const REASONS = {
  disabled: '未开启', paused: '已暂停', quiet_hours: '免打扰时段', busy: '会话正在生成', daily_limit: '已达每日上限',
  cooldown: '冷却中', ignored_backoff: '多条主动消息未被回复，已暂停',
};

/**
 * Settings card for the autonomous ("no-prompt") activation system, plus the live push channel (SSE)
 * that delivers autonomous and task messages into the open chat. Zero-build ESM, theme variables only.
 */
export function createAutonomyUI({ request, redraw, toast, onPush }) {
  const state = { info: null, draft: null, busy: false, error: '', events: [], source: null };

  const settings = () => state.info || { enabled: false, paused: false, quietStart: '23:00', quietEnd: '08:00', dailyLimit: 3, cooldownMinutes: 60, idleMinutes: 90, triggers: { idle: true, routine: true } };
  const sync = info => { if (info && typeof info === 'object' && !state.draft) state.info = info; };

  function renderCard() {
    const draft = state.draft || settings();
    const number = ([key, label, unit, min, max]) => `<div class="field"><label for="autonomy-${key}">${label} <span>${unit}</span></label><input id="autonomy-${key}" type="number" name="${key}" required min="${min}" max="${max}" step="1" value="${esc(draft[key])}"></div>`;
    const recent = state.events.slice(0, 5).map(item => `<li><time datetime="${esc(item.createdAt)}">${esc(new Date(item.createdAt).toLocaleString('zh-CN', { hour12: false }))}</time> · ${esc(item.trigger)} · ${esc({ speak: '已发言', silent: '选择沉默', error: '决策失败' }[item.decision] || item.decision)}${item.reason ? ` · ${esc(REASONS[item.reason] || item.reason)}` : ''}</li>`).join('');
    return `<section class="card settings-card autonomy-card" aria-labelledby="autonomy-title"><h2 id="autonomy-title"><span class="section-number">05</span>自主行为（无主激活）</h2>
      <p class="small muted">开启后，角色会在你没有提问时，自行判断是否开口。默认保持克制：先过免打扰、冷却、每日上限等规则，再由模型决定“说或不说”。自主发言不使用任何工具，不会执行命令、写文件或发邮件。</p>
      <form id="autonomy-form"><fieldset${state.busy ? ' disabled' : ''}>
        <label class="checkbox-label"><input type="checkbox" name="enabled"${draft.enabled ? ' checked' : ''}><span>允许角色主动开口</span></label>
        <div class="field-row"><div class="field"><label for="autonomy-quietStart">免打扰开始</label><input id="autonomy-quietStart" type="time" name="quietStart" required value="${esc(draft.quietStart)}"></div><div class="field"><label for="autonomy-quietEnd">免打扰结束</label><input id="autonomy-quietEnd" type="time" name="quietEnd" required value="${esc(draft.quietEnd)}"></div></div>
        <div class="field-row">${NUMBERS.slice(0, 2).map(number).join('')}</div>${number(NUMBERS[2])}
        <div class="field"><label>触发方式</label>${Object.entries(TRIGGERS).map(([key, label]) => `<label class="checkbox-label"><input type="checkbox" name="trigger:${key}"${draft.triggers?.[key] ? ' checked' : ''}><span>${label}</span></label>`).join('')}<small>定时任务的结果始终会送入对话，不受以上限制。</small></div>
        <div class="card-actions"><span class="small muted" id="autonomy-dirty">${state.draft ? '有尚未保存的修改' : (draft.paused ? '已暂停：不会主动发言' : '设置来自本地服务')}</span>
          <button type="submit" class="button primary">${state.busy ? '正在保存…' : '保存自主行为设置'}</button>
          <button type="button" class="button" data-autonomy-action="pause">${draft.paused ? '恢复主动发言' : '一键急停'}</button>
          <button type="button" class="button" data-autonomy-action="events">查看决策记录</button></div>
      </fieldset>${state.error ? `<p class="inline-error" role="alert">${esc(state.error)}</p>` : ''}</form>
      ${recent ? `<ul class="autonomy-events small muted" aria-label="最近的主动决策">${recent}</ul>` : ''}</section>`;
  }

  const readForm = form => {
    const data = new FormData(form);
    return {
      enabled: data.has('enabled'), quietStart: data.get('quietStart'), quietEnd: data.get('quietEnd'),
      ...Object.fromEntries(NUMBERS.map(([key]) => [key, Number(data.get(key))])),
      triggers: Object.fromEntries(Object.keys(TRIGGERS).map(key => [key, data.has(`trigger:${key}`)])),
    };
  };

  document.addEventListener('input', event => {
    const form = event.target.closest?.('#autonomy-form');
    if (!form) return;
    state.draft = { ...settings(), ...readForm(form) };
    const hint = document.getElementById('autonomy-dirty');
    if (hint) hint.textContent = '有尚未保存的修改';
  });
  document.addEventListener('submit', async event => {
    if (event.target.id !== 'autonomy-form') return;
    event.preventDefault();
    if (state.busy) return;
    const payload = readForm(event.target);
    state.busy = true; state.error = ''; redraw();
    try {
      const result = await request('/autonomy/settings', 'PUT', payload);
      state.info = result.autonomy; state.draft = null; toast('自主行为设置已保存。');
    } catch (error) { state.error = error.message; } finally { state.busy = false; redraw(); }
  });
  document.addEventListener('click', async event => {
    const control = event.target.closest?.('[data-autonomy-action]');
    if (!control || control.disabled) return;
    try {
      if (control.dataset.autonomyAction === 'pause') {
        const result = await request('/autonomy/pause', 'POST', { paused: !settings().paused });
        state.info = result.autonomy; toast(result.autonomy.paused ? '已急停，角色不会再主动发言。' : '已恢复主动发言。');
      } else if (control.dataset.autonomyAction === 'events') {
        state.events = (await request('/autonomy/events?limit=10')).events || [];
      }
    } catch (error) { state.error = error.message; }
    redraw();
  });

  function connect() {
    if (state.source || typeof EventSource === 'undefined') return;
    const source = new EventSource('/api/events');
    state.source = source;
    for (const type of ['autonomous_message', 'task_finished', 'run_paused', 'run_resumed']) {
      source.addEventListener(type, message => {
        try { onPush({ type, ...JSON.parse(message.data) }); } catch { /* malformed frame: ignore */ }
      });
    }
    // EventSource reconnects by itself (server sends retry: 5000); the 60 s background refresh covers any gap.
  }

  return { renderCard, sync, connect, settings: () => state.info };
}
