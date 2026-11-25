const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const STYLE_LABELS = {
  natural: '自然互动（像真实网友搭话）',
  witty: '幽默神评（轻幽默 / 反差接梗）',
  warm: '温和共情（鼓励 / 情绪共鸣）',
  concise: '简短接梗（十几个字短平快）',
};

/**
 * Settings card for Douyin Web Social Comment Copilot (Chrome MV3 extension at E:\tools\napcat).
 * Zero-build ESM; all colors inherit Classical Garden CSS theme variables.
 */
export function createSocialUI({ request, redraw, toast }) {
  const state = {
    settings: null,
    todayCount: 0,
    recentEvents: [],
    draft: null,
    busy: false,
    error: '',
    preview: null,
  };

  const current = () => state.settings || {
    enabled: true,
    personaId: '',
    style: 'natural',
    maxChars: 60,
    dailyLimit: 50,
    cooldownSeconds: 5,
  };

  function sync(payload) {
    if (!payload || typeof payload !== 'object') return;
    if (payload.settings && !state.draft) state.settings = payload.settings;
    if (typeof payload.todayCount === 'number') state.todayCount = payload.todayCount;
    if (Array.isArray(payload.recentEvents)) state.recentEvents = payload.recentEvents;
  }

  function renderCard(personas = []) {
    const draft = state.draft || current();
    const personaOptions = `<option value="">跟随默认角色</option>` + personas.map(p => `<option value="${esc(p.id)}"${draft.personaId === p.id ? ' selected' : ''}>${esc(p.name)}</option>`).join('');
    const styleOptions = Object.entries(STYLE_LABELS).map(([k, label]) => `<option value="${esc(k)}"${draft.style === k ? ' selected' : ''}>${esc(label)}</option>`).join('');
    const previewHtml = state.preview?.length
      ? `<div class="social-preview" role="status"><strong class="small">测试拟评结果：</strong><ul class="social-events small">${state.preview.map(c => `<li>${esc(c)}</li>`).join('')}</ul></div>`
      : '';
    const recentHtml = state.recentEvents.slice(0, 5).map(ev => {
      const first = Array.isArray(ev.candidates) && ev.candidates[0] ? ev.candidates[0] : '';
      const title = ev.videoTitle ? `「${String(ev.videoTitle).slice(0, 22)}」` : '网页上下文';
      return `<li><time datetime="${esc(ev.createdAt)}">${esc(new Date(ev.createdAt).toLocaleString('zh-CN', { hour12: false }))}</time> · ${esc(ev.platform)} · ${esc(title)} → ${esc(first)}</li>`;
    }).join('');

    return `<section class="card settings-card social-card" aria-labelledby="social-title"><div class="card-header"><h2 id="social-title"><span class="section-number">06</span>评论区助手（抖音网页版）</h2><span class="pill">今日已拟 ${esc(state.todayCount)} / ${esc(current().dailyLimit)}</span></div>
      <p class="small muted">配合本地 Chrome 扩展在抖音网页版提取当前视频标题与热评上下文，由你的角色人设与记忆生成 3 条候选评论，点击填入评论框后由你确认发送。Chrome 安装路径：<code>E:\\tools\\napcat</code>（在 <code>chrome://extensions</code> 开启开发者模式 → 加载已解压的扩展程序）。</p>
      <form id="social-form"><fieldset${state.busy ? ' disabled' : ''}>
        <label class="checkbox-label"><input type="checkbox" name="enabled"${draft.enabled ? ' checked' : ''}><span>启用评论区助手接口（允许本机 Chrome 扩展调用）</span></label>
        <div class="field-row">
          <div class="field"><label for="social-personaId">评论人设角色</label><select id="social-personaId" name="personaId">${personaOptions}</select></div>
          <div class="field"><label for="social-style">默认评论风格</label><select id="social-style" name="style">${styleOptions}</select></div>
        </div>
        <div class="field-row">
          <div class="field"><label for="social-maxChars">单条字数上限 <span>字</span></label><input id="social-maxChars" type="number" name="maxChars" required min="10" max="200" step="1" value="${esc(draft.maxChars)}"></div>
          <div class="field"><label for="social-dailyLimit">每日生成上限 <span>次</span></label><input id="social-dailyLimit" type="number" name="dailyLimit" required min="0" max="200" step="1" value="${esc(draft.dailyLimit)}"></div>
        </div>
        <div class="field"><label for="social-cooldownSeconds">连续生成冷却 <span>秒</span></label><input id="social-cooldownSeconds" type="number" name="cooldownSeconds" required min="0" max="600" step="1" value="${esc(draft.cooldownSeconds)}"></div>
        <div class="card-actions">
          <span class="small muted" id="social-dirty">${state.draft ? '有尚未保存的修改' : '配置来自本地服务'}</span>
          <button type="submit" class="button primary">${state.busy ? '正在处理…' : '保存评论区设置'}</button>
          <button type="button" class="button" data-social-action="test-draft">测试拟评</button>
          <button type="button" class="button" data-social-action="refresh">刷新记录</button>
        </div>
      </fieldset>${state.error ? `<p class="inline-error" role="alert">${esc(state.error)}</p>` : ''}${previewHtml}</form>
      ${recentHtml ? `<ul class="social-events small muted" aria-label="最近生成的评论">${recentHtml}</ul>` : ''}</section>`;
  }

  const readForm = form => {
    const data = new FormData(form);
    return {
      enabled: data.has('enabled'),
      personaId: String(data.get('personaId') || ''),
      style: String(data.get('style') || 'natural'),
      maxChars: Number(data.get('maxChars')),
      dailyLimit: Number(data.get('dailyLimit')),
      cooldownSeconds: Number(data.get('cooldownSeconds')),
    };
  };

  document.addEventListener('input', event => {
    const form = event.target.closest?.('#social-form');
    if (!form) return;
    state.draft = { ...current(), ...readForm(form) };
    const hint = document.getElementById('social-dirty');
    if (hint) hint.textContent = '有尚未保存的修改';
  });

  document.addEventListener('submit', async event => {
    if (event.target.id !== 'social-form') return;
    event.preventDefault();
    if (state.busy) return;
    const payload = readForm(event.target);
    state.busy = true; state.error = ''; redraw();
    try {
      const res = await request('/social/settings', 'PUT', payload);
      state.settings = res.social;
      state.draft = null;
      toast('评论区助手设置已保存。');
    } catch (error) {
      state.error = error.message;
    } finally {
      state.busy = false; redraw();
    }
  });

  document.addEventListener('click', async event => {
    const control = event.target.closest?.('[data-social-action]');
    if (!control || control.disabled || state.busy) return;
    const action = control.dataset.socialAction;
    state.busy = true; state.error = ''; redraw();
    try {
      if (action === 'test-draft') {
        const res = await request('/social/draft', 'POST', {
          platform: 'douyin',
          videoTitle: '深夜加班回家路过街角面馆，老板多加了一勺牛肉，瞬间被治愈了。',
          author: '都市夜归人',
          topComments: ['半夜刷到这个看饿了', '好暖心的老板'],
        });
        state.preview = res.candidates || [];
        const st = await request('/social/status');
        sync(st);
        toast('测试拟评完成。');
      } else if (action === 'refresh') {
        const st = await request('/social/status');
        sync(st);
      }
    } catch (error) {
      state.error = error.message;
    } finally {
      state.busy = false; redraw();
    }
  });

  return { renderCard, sync };
}
