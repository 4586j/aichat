const $ = (selector, root = document) => root.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const SERIES_COLORS = ['#d4842a', '#2e7d5b', '#7b5cd6', '#2b8a8a', '#c94c3e', '#6f7c8a'];
const DEFAULT_PRICING = {
  currency: '$',
  inputPerMillion: 1.0,
  cachedInputPerMillion: 0.1,
  outputPerMillion: 3.0
};

function loadPricing() {
  try {
    const raw = JSON.parse(localStorage.getItem('qiyi-usage-pricing') || 'null');
    if (raw && typeof raw === 'object') {
      return {
        currency: raw.currency === '¥' ? '¥' : '$',
        inputPerMillion: Math.max(0, Number(raw.inputPerMillion) || 0),
        cachedInputPerMillion: Math.max(0, Number(raw.cachedInputPerMillion) || 0),
        outputPerMillion: Math.max(0, Number(raw.outputPerMillion) || 0)
      };
    }
  } catch {}
  return { ...DEFAULT_PRICING };
}

function savePricing(pricing) {
  try { localStorage.setItem('qiyi-usage-pricing', JSON.stringify(pricing)); } catch {}
}

function formatCompact(n) {
  const num = Number(n) || 0;
  if (num >= 1e9) return `${(num / 1e9).toFixed(2).replace(/\.?0+$/, '')}B`;
  if (num >= 1e6) return `${(num / 1e6).toFixed(num >= 1e8 ? 0 : 1).replace(/\.0$/, '')}M`;
  if (num >= 1e3) return `${(num / 1e3).toFixed(num >= 1e5 ? 0 : 1).replace(/\.0$/, '')}K`;
  return String(Math.round(num));
}

function computeCost(row, pricing) {
  const prompt = Number(row.promptTokens) || 0;
  const cached = Math.min(Number(row.cachedPromptTokens) || 0, prompt);
  const uncached = Math.max(0, prompt - cached);
  const completion = Number(row.completionTokens) || 0;
  const actual =
    (uncached / 1e6) * pricing.inputPerMillion +
    (cached / 1e6) * pricing.cachedInputPerMillion +
    (completion / 1e6) * pricing.outputPerMillion;
  const saved = (cached / 1e6) * Math.max(0, pricing.inputPerMillion - pricing.cachedInputPerMillion);
  return { actual, saved };
}

function formatMoney(amount, currency = '$') {
  const n = Number(amount) || 0;
  if (n > 0 && n < 0.01) return `${currency}${n.toFixed(4)}`;
  return `${currency}${n.toFixed(2)}`;
}

function formatShortDate(isoDate) {
  const parts = String(isoDate || '').split('-');
  if (parts.length !== 3) return isoDate || '';
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const m = months[Number(parts[1]) - 1] || parts[1];
  return `${m} ${Number(parts[2])}`;
}

function buildSmoothPath(points, minY = -Infinity, maxY = Infinity) {
  if (!points.length) return '';
  if (points.length === 1) return `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  const clampY = y => Math.max(minY, Math.min(maxY, y));
  let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = clampY(p1.y + (p2.y - p0.y) / 6);
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = clampY(p2.y - (p3.y - p1.y) / 6);
    d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

function getSeriesPalette() {
  const isV4 = document.documentElement.dataset.uiStyle !== 'classic';
  const theme = document.documentElement.dataset.gardenTheme || 'spring';
  if (!isV4) return SERIES_COLORS;
  if (theme === 'night') return ['#e8c67e', '#69b8ae', '#b09bd6', '#d87a58', '#8eb5c4', '#9c8f7d'];
  if (theme === 'autumn') return ['#8a3d27', '#c29248', '#b84932', '#6a5b42', '#9d6a38', '#7b6c61'];
  return ['#26584d', '#335c6e', '#b68c48', '#a83c2f', '#578273', '#6f7c8a'];
}

function renderCacheRing(rate) {
  const pct = Math.max(0, Math.min(100, Number(rate) || 0));
  const r = 34;
  const c = 2 * Math.PI * r;
  const dash = ((pct / 100) * c).toFixed(1);
  return `
    <svg class="usage-cache-ring-svg" viewBox="0 0 88 88" role="img" aria-label="缓存命中率 ${pct}%">
      <circle cx="44" cy="44" r="${r}" class="usage-ring-track"/>
      <circle cx="44" cy="44" r="${r}" class="usage-ring-fill" stroke-dasharray="${dash} ${c.toFixed(1)}" transform="rotate(-90 44 44)"/>
      <circle cx="44" cy="44" r="27" class="usage-ring-inner"/>
      <text x="44" y="42" text-anchor="middle" class="usage-ring-pct">${pct}%</text>
      <text x="44" y="55" text-anchor="middle" class="usage-ring-lbl">缓存命中</text>
    </svg>
  `;
}

function renderDailyChart(daily, topModels, unit, pricing) {
  const W = 380;
  const H = 148;
  const pad = { top: 14, right: 12, bottom: 24, left: 42 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;

  if (!daily.length) {
    return `<div class="usage-chart-empty">当前时间范围内暂无调用数据，发送一条消息后即可实时统计。</div>`;
  }

  const palette = getSeriesPalette();
  const isV4 = document.documentElement.dataset.uiStyle !== 'classic';
  const seriesNames = topModels.slice(0, 5).map(m => m.model);
  const series = seriesNames.map((name, idx) => ({
    name,
    color: palette[idx % palette.length],
    values: daily.map(d => {
      const tok = Number(d.byModel?.[name] || 0);
      if (unit === 'cost') {
        const ratio = d.totalTokens > 0 ? tok / d.totalTokens : 0;
        const { actual } = computeCost(d, pricing);
        return actual * ratio;
      }
      return tok;
    })
  }));

  const maxVal = Math.max(
    unit === 'cost' ? 0.01 : 100,
    ...series.flatMap(s => s.values)
  );
  const yTicks = [0, maxVal / 3, (maxVal * 2) / 3, maxVal];

  const xAt = idx => daily.length === 1
    ? pad.left + plotW / 2
    : pad.left + (idx / (daily.length - 1)) * plotW;
  const yAt = val => pad.top + plotH - (Math.max(0, val) / maxVal) * plotH;

  const gridLines = yTicks.map(v => {
    const y = yAt(v).toFixed(1);
    const label = unit === 'cost' ? formatMoney(v, pricing.currency) : formatCompact(v);
    return `<line x1="${pad.left}" y1="${y}" x2="${W - pad.right}" y2="${y}" class="usage-grid-line"/><text x="${pad.left - 6}" y="${Number(y) + 3}" text-anchor="end" class="usage-axis-label">${esc(label)}</text>`;
  }).join('');

  const xIndices = daily.length <= 3
    ? daily.map((_, i) => i)
    : [0, Math.floor((daily.length - 1) / 2), daily.length - 1];
  const xLabels = [...new Set(xIndices)].map((i, idx, arr) => {
    const anchor = arr.length > 1 ? (idx === 0 ? 'start' : idx === arr.length - 1 ? 'end' : 'middle') : 'middle';
    return `<text x="${xAt(i).toFixed(1)}" y="${H - 6}" text-anchor="${anchor}" class="usage-axis-label">${esc(formatShortDate(daily[i].date))}</text>`;
  }).join('');

  const defs = isV4 ? `<defs>${series.map((s, sIdx) => `
    <linearGradient id="usage-mtn-grad-${sIdx}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${s.color}" stop-opacity="${sIdx === 0 ? '0.62' : '0.34'}"/>
      <stop offset="72%" stop-color="${s.color}" stop-opacity="${sIdx === 0 ? '0.2' : '0.09'}"/>
      <stop offset="100%" stop-color="${s.color}" stop-opacity="0.02"/>
    </linearGradient>`).join('')}</defs>` : '';

  const sunOrnament = isV4
    ? `<circle cx="${W - pad.right - 22}" cy="${pad.top + 14}" r="8" class="usage-shanshui-sun"/>`
    : '';

  const paths = series.map((s, sIdx) => {
    const pts = s.values.map((v, i) => ({ x: xAt(i), y: yAt(v), v, date: daily[i].date }));
    const lineD = buildSmoothPath(pts, pad.top, pad.top + plotH);
    const areaD = pts.length > 1
      ? `${lineD} L ${pts[pts.length - 1].x.toFixed(1)} ${(pad.top + plotH).toFixed(1)} L ${pts[0].x.toFixed(1)} ${(pad.top + plotH).toFixed(1)} Z`
      : '';
    const dots = pts.map(p => {
      const tip = `${s.name} · ${p.date}: ${unit === 'cost' ? formatMoney(p.v, pricing.currency) : formatCompact(p.v)}`;
      return `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="2.6" fill="${s.color}" class="usage-chart-dot"><title>${esc(tip)}</title></circle>`;
    }).join('');
    return `
      ${areaD ? `<path d="${areaD}" fill="${isV4 ? `url(#usage-mtn-grad-${sIdx})` : s.color}"${isV4 ? '' : ` fill-opacity="${sIdx === 0 ? '0.16' : '0.08'}"`}/>` : ''}
      ${pts.length > 1 ? `<path d="${lineD}" fill="none" stroke="${s.color}" stroke-width="${sIdx === 0 ? '1.9' : '1.4'}" stroke-linecap="round"/>` : ''}
      ${dots}
    `;
  }).join('');

  return `<svg class="usage-trend-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="每日处理趋势图">${defs}${sunOrnament}${gridLines}${paths}${xLabels}</svg>`;
}

export function createUsageUI({ request, getConversationId, toast }) {
  const pane = $('#usage-side-pane');
  const shellHost = pane?.parentElement || document.querySelector('.app-shell');
  const state = {
    open: false,
    loading: false,
    error: '',
    range: '7d',
    scope: 'all', // 'all' | 'current'
    unit: 'tokens', // 'tokens' | 'cost'
    tab: 'model', // 'model' | 'conversation' | 'day'
    pricingOpen: false,
    pricing: loadPricing(),
    data: null
  };

  function syncMount() {
    if (!pane) return;
    const chatGrid = document.querySelector('#main .chat-grid');
    if (state.open && chatGrid) {
      pane.classList.add('is-in-aside');
      if (pane.parentElement !== chatGrid) chatGrid.append(pane);
    } else {
      pane.classList.remove('is-in-aside');
      if (shellHost && pane.parentElement !== shellHost) shellHost.append(pane);
    }
    pane.hidden = !state.open;
  }

  function syncTrigger() {
    const btn = $('#usage-toggle-btn');
    if (btn) {
      btn.setAttribute('aria-pressed', String(state.open));
      btn.classList.toggle('is-active', state.open);
    }
    document.body.classList.toggle('usage-pane-open', state.open);
    syncMount();
  }

  async function refresh() {
    if (!pane) return;
    state.loading = true;
    state.error = '';
    draw();
    try {
      const convId = state.scope === 'current' ? getConversationId() : null;
      const qs = new URLSearchParams({ range: state.range });
      if (convId) qs.set('conversationId', convId);
      state.data = await request(`/usage?${qs.toString()}`);
    } catch (err) {
      state.error = err.message || '读取用量数据失败。';
    } finally {
      state.loading = false;
      draw();
    }
  }

  function open() {
    state.open = true;
    syncTrigger();
    void refresh();
  }

  function close() {
    state.open = false;
    syncTrigger();
  }

  function toggle() {
    if (state.open) close();
    else open();
  }

  function draw() {
    if (!pane || !state.open) return;
    const d = state.data;
    const summary = d?.summary || {
      totalTokens: 0, promptTokens: 0, cachedPromptTokens: 0, uncachedPromptTokens: 0,
      completionTokens: 0, reasoningTokens: 0, cacheHitRate: 0, requestCount: 0,
      conversationCount: 0, providerCount: 0, estimatedCount: 0
    };
    const byModel = d?.byModel || [];
    const byConversation = d?.byConversation || [];
    const daily = d?.daily || [];
    const pricing = state.pricing;
    const totalCost = computeCost(summary, pricing);
    const heroValue = state.unit === 'cost'
      ? formatMoney(totalCost.actual, pricing.currency)
      : formatCompact(summary.totalTokens);

    const hasConv = Boolean(getConversationId());
    const uncachedPct = summary.totalTokens > 0 ? (summary.uncachedPromptTokens / summary.totalTokens) * 100 : 0;
    const cachedPct = summary.totalTokens > 0 ? (summary.cachedPromptTokens / summary.totalTokens) * 100 : 0;
    const outputPct = summary.totalTokens > 0 ? Math.max(0, 100 - uncachedPct - cachedPct) : 0;

    const palette = getSeriesPalette();
    const modelRows = byModel.slice(0, 6).map((m, idx) => {
      const c = computeCost(m, pricing);
      const color = palette[idx % palette.length];
      const rightVal = state.unit === 'cost' ? formatMoney(c.actual, pricing.currency) : formatCompact(m.totalTokens);
      return `
        <div class="usage-model-item">
          <div class="usage-model-top">
            <span class="usage-dot" style="background:${color}"></span>
            <strong class="usage-model-name" title="${esc(m.model)}">${esc(m.model)}</strong>
            <span class="usage-model-val">${esc(rightVal)}</span>
          </div>
          <div class="usage-model-sub">
            ${m.conversationCount} 个会话 · 占比 ${m.sharePct}% · 缓存 ${m.cacheHitRate}% · ${esc(formatMoney(c.actual, pricing.currency))}
          </div>
        </div>
      `;
    }).join('');

    let detailRows = '';
    if (state.tab === 'model') {
      detailRows = byModel.map((m, idx) => {
        const c = computeCost(m, pricing);
        return `<tr><td>${idx + 1}</td><td class="usage-td-name" title="${esc(m.model)}">${esc(m.model)}</td><td>${esc(formatMoney(c.actual, pricing.currency))}</td><td>${m.sharePct}%</td><td><strong>${esc(formatCompact(m.totalTokens))}</strong></td></tr>`;
      }).join('');
    } else if (state.tab === 'conversation') {
      detailRows = byConversation.map((cv, idx) => {
        const c = computeCost(cv, pricing);
        return `<tr><td>${idx + 1}</td><td class="usage-td-name" title="${esc(cv.title)}">${esc(cv.title)}</td><td>${esc(formatMoney(c.actual, pricing.currency))}</td><td>${cv.sharePct}%</td><td><strong>${esc(formatCompact(cv.totalTokens))}</strong></td></tr>`;
      }).join('');
    } else {
      detailRows = [...daily].reverse().map((day, idx) => {
        const c = computeCost(day, pricing);
        const share = summary.totalTokens > 0 ? ((day.totalTokens / summary.totalTokens) * 100).toFixed(1) : '0';
        return `<tr><td>${idx + 1}</td><td class="usage-td-name">${esc(day.date)}</td><td>${esc(formatMoney(c.actual, pricing.currency))}</td><td>${share}%</td><td><strong>${esc(formatCompact(day.totalTokens))}</strong></td></tr>`;
      }).join('');
    }

    const sourceHint = summary.estimatedCount > 0
      ? (summary.providerCount > 0 ? `实测 ${summary.providerCount} / 估算 ${summary.estimatedCount}` : '本地字符估算')
      : '服务商实测';

    pane.innerHTML = `
      <header class="usage-pane-header">
        <select id="usage-scope-select" class="usage-scope-select" aria-label="统计范围">
          <option value="all"${state.scope === 'all' ? ' selected' : ''}>全部用量</option>
          <option value="current"${state.scope === 'current' ? ' selected' : ''}${!hasConv ? ' disabled' : ''}>当前会话</option>
        </select>
        <div class="usage-toolbar-right">
          <div class="usage-seg" role="group" aria-label="时间范围">
            ${[['24h', '24小时'], ['7d', '7天'], ['30d', '30天'], ['90d', '90天']].map(([val, label]) =>
              `<button type="button" class="usage-seg-btn${state.range === val ? ' is-active' : ''}" data-usage-range="${val}">${label}</button>`
            ).join('')}
          </div>
          <div class="usage-seg" role="group" aria-label="展示单位">
            <button type="button" class="usage-seg-btn${state.unit === 'tokens' ? ' is-active' : ''}" data-usage-unit="tokens">Token</button>
            <button type="button" class="usage-seg-btn${state.unit === 'cost' ? ' is-active' : ''}" data-usage-unit="cost">费用</button>
          </div>
          <button type="button" class="icon-button usage-close-btn" data-usage-action="close" aria-label="关闭用量面板" title="关闭">×</button>
        </div>
      </header>
      <div class="usage-pane-body">
        ${state.error ? `<div class="inline-error" role="alert">${esc(state.error)}</div>` : ''}
        <div class="usage-bogu-top">
          <div class="usage-ring-niche" aria-label="缓存命中率概览">${renderCacheRing(summary.cacheHitRate)}</div>
          <section class="usage-hero">
            <div class="usage-hero-row">
              <strong class="usage-hero-value">${state.loading && !d ? '…' : esc(heroValue)}</strong>
              <span class="usage-source-badge">${esc(sourceHint)}</span>
            </div>
            <p class="usage-hero-sub">${summary.conversationCount} 个会话 · ${summary.requestCount} 次请求${summary.avgDurationMs ? ` · 均耗 ${(summary.avgDurationMs / 1000).toFixed(1)}s` : ''}</p>
            <p class="usage-hero-save">缓存节省估算 ${esc(formatMoney(totalCost.saved, pricing.currency))}</p>
          </section>
        </div>

        ${byModel.length ? `<section class="usage-model-list" aria-label="模型用量排行">${modelRows}</section>` : ''}

        <section class="usage-section">
          <div class="usage-section-head">
            <h3>每日处理 ${state.unit === 'cost' ? '费用' : 'Token'}</h3>
            <button type="button" class="usage-text-btn" data-usage-action="refresh">刷新</button>
          </div>
          <div class="usage-chart-wrap">${renderDailyChart(daily, byModel, state.unit, pricing)}</div>
        </section>

        <section class="usage-section">
          <div class="usage-section-head">
            <h3>汇总指标</h3>
            <button type="button" class="usage-text-btn" data-usage-action="toggle-pricing">${state.pricingOpen ? '收起单价' : '设置单价'}</button>
          </div>
          ${state.pricingOpen ? `
            <form id="usage-pricing-form" class="usage-pricing-box">
              <div class="usage-pricing-grid">
                <label>货币<select name="currency"><option value="$"${pricing.currency === '$' ? ' selected' : ''}>$ USD</option><option value="¥"${pricing.currency === '¥' ? ' selected' : ''}>¥ CNY</option></select></label>
                <label>输入 /1M<input name="inputPerMillion" type="number" step="0.01" min="0" value="${esc(pricing.inputPerMillion)}"></label>
                <label>缓存 /1M<input name="cachedInputPerMillion" type="number" step="0.01" min="0" value="${esc(pricing.cachedInputPerMillion)}"></label>
                <label>输出 /1M<input name="outputPerMillion" type="number" step="0.01" min="0" value="${esc(pricing.outputPerMillion)}"></label>
              </div>
              <div class="usage-pricing-actions"><button type="submit" class="button small primary">保存本地单价</button></div>
            </form>
          ` : ''}
          <div class="usage-metrics-grid">
            <div class="usage-metric">
              <span>总处理 Token</span>
              <strong>${esc(formatCompact(summary.totalTokens))}</strong>
            </div>
            <div class="usage-metric">
              <span>缓存命中输入</span>
              <strong>${esc(formatCompact(summary.cachedPromptTokens))} <em class="usage-hit-pill">${summary.cacheHitRate}%</em></strong>
            </div>
            <div class="usage-metric">
              <span>未命中输入</span>
              <strong>${esc(formatCompact(summary.uncachedPromptTokens))}</strong>
            </div>
            <div class="usage-metric">
              <span>输出 Token</span>
              <strong>${esc(formatCompact(summary.completionTokens))}</strong>
            </div>
            <div class="usage-metric is-savings">
              <span>缓存节省估算</span>
              <strong>${esc(formatMoney(totalCost.saved, pricing.currency))}</strong>
            </div>
          </div>
        </section>

        <section class="usage-section">
          <h3>按类型分布 (Token)</h3>
          <div class="usage-dist-bar" role="img" aria-label="按类型分布条">
            ${uncachedPct > 0 ? `<span class="seg-uncached" style="width:${uncachedPct.toFixed(1)}%"></span>` : ''}
            ${cachedPct > 0 ? `<span class="seg-cached" style="width:${cachedPct.toFixed(1)}%"></span>` : ''}
            ${outputPct > 0 ? `<span class="seg-output" style="width:${outputPct.toFixed(1)}%"></span>` : ''}
          </div>
          <div class="usage-dist-legend">
            <span><i class="dot-uncached"></i>未命中输入 <b>${esc(formatCompact(summary.uncachedPromptTokens))}</b></span>
            <span><i class="dot-cached"></i>缓存读取 <b>${esc(formatCompact(summary.cachedPromptTokens))}</b></span>
            <span><i class="dot-output"></i>输出 <b>${esc(formatCompact(summary.completionTokens))}</b></span>
          </div>
        </section>

        <section class="usage-section">
          <div class="usage-section-head">
            <h3>详细明细</h3>
            <div class="usage-seg" role="tablist" aria-label="明细分组">
              <button type="button" role="tab" aria-selected="${state.tab === 'model'}" class="usage-seg-btn${state.tab === 'model' ? ' is-active' : ''}" data-usage-tab="model">按模型</button>
              <button type="button" role="tab" aria-selected="${state.tab === 'conversation'}" class="usage-seg-btn${state.tab === 'conversation' ? ' is-active' : ''}" data-usage-tab="conversation">按会话</button>
              <button type="button" role="tab" aria-selected="${state.tab === 'day'}" class="usage-seg-btn${state.tab === 'day' ? ' is-active' : ''}" data-usage-tab="day">按天</button>
            </div>
          </div>
          ${detailRows ? `
            <div class="usage-table-wrap">
              <table class="usage-table">
                <thead><tr><th>#</th><th>${state.tab === 'model' ? '模型' : state.tab === 'conversation' ? '会话' : '日期'}</th><th>等价费用</th><th>占比</th><th>Token</th></tr></thead>
                <tbody>${detailRows}</tbody>
              </table>
            </div>
          ` : '<p class="small muted">暂无详细明细记录。</p>'}
          ${summary.requestCount > 0 ? `<div class="usage-footer-actions"><button type="button" class="usage-text-btn is-danger" data-usage-action="clear">清空统计记录</button></div>` : ''}
        </section>
      </div>
    `;
  }

  document.addEventListener('click', async event => {
    if (event.target.closest('#usage-toggle-btn')) {
      toggle();
      return;
    }
    const rangeBtn = event.target.closest('[data-usage-range]');
    if (rangeBtn) {
      state.range = rangeBtn.dataset.usageRange;
      void refresh();
      return;
    }
    const unitBtn = event.target.closest('[data-usage-unit]');
    if (unitBtn) {
      state.unit = unitBtn.dataset.usageUnit;
      draw();
      return;
    }
    const tabBtn = event.target.closest('[data-usage-tab]');
    if (tabBtn) {
      state.tab = tabBtn.dataset.usageTab;
      draw();
      return;
    }
    const actionBtn = event.target.closest('[data-usage-action]');
    if (actionBtn) {
      const act = actionBtn.dataset.usageAction;
      if (act === 'close') close();
      else if (act === 'refresh') void refresh();
      else if (act === 'toggle-pricing') { state.pricingOpen = !state.pricingOpen; draw(); }
      else if (act === 'clear') {
        if (!window.confirm('确定清空本地所有 Token 用量与缓存统计记录吗？此操作不影响聊天历史。')) return;
        try {
          await request('/usage', 'DELETE', {});
          toast?.('已清空用量统计记录');
          await refresh();
        } catch (err) {
          toast?.(err.message || '清空失败', 'error');
        }
      }
    }
  });

  document.addEventListener('change', event => {
    if (event.target.id === 'usage-scope-select') {
      state.scope = event.target.value;
      void refresh();
    }
  });

  document.addEventListener('submit', event => {
    if (event.target.id === 'usage-pricing-form') {
      event.preventDefault();
      const fd = new FormData(event.target);
      state.pricing = {
        currency: fd.get('currency') === '¥' ? '¥' : '$',
        inputPerMillion: Math.max(0, Number(fd.get('inputPerMillion')) || 0),
        cachedInputPerMillion: Math.max(0, Number(fd.get('cachedInputPerMillion')) || 0),
        outputPerMillion: Math.max(0, Number(fd.get('outputPerMillion')) || 0)
      };
      savePricing(state.pricing);
      state.pricingOpen = false;
      toast?.('已保存本地估算单价');
      draw();
    }
  });

  window.addEventListener('qiyi-ui-style-changed', () => {
    if (state.open) draw();
  });

  return {
    open,
    close,
    toggle,
    syncMount,
    isOpen: () => state.open,
    refreshIfOpen: () => { if (state.open) void refresh(); }
  };
}
