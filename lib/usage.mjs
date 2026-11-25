import { randomUUID } from 'node:crypto';

/**
 * Deterministic token usage extraction, normalization, estimation,
 * cache hit rate calculation, and SQLite analytics aggregation.
 * Zero third-party dependencies.
 */

function toNonNegInt(value) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

function normalizeFloat(value, digits = 1) {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

/**
 * Normalizes provider `usage` payloads across OpenAI, Gemini OpenAI-compat,
 * DeepSeek, Kimi, SiliconFlow, Anthropic, and OpenRouter formats.
 */
export function extractTokenUsage(payload) {
  const usage = payload?.usage;
  if (!usage || typeof usage !== 'object') return null;

  const promptRaw = toNonNegInt(usage.prompt_tokens ?? usage.input_tokens);
  const completionRaw = toNonNegInt(usage.completion_tokens ?? usage.output_tokens);
  const totalRaw = toNonNegInt(usage.total_tokens);

  const cachedRaw = toNonNegInt(
    usage.prompt_tokens_details?.cached_tokens ??
    usage.prompt_cache_hit_tokens ??
    usage.cache_read_input_tokens ??
    usage.cached_tokens
  );
  const cacheWriteRaw = toNonNegInt(
    usage.cache_creation_input_tokens ??
    usage.prompt_tokens_details?.cache_write_tokens
  );
  const reasoningRaw = toNonNegInt(
    usage.completion_tokens_details?.reasoning_tokens ??
    usage.reasoning_tokens
  );

  if (
    promptRaw === null &&
    completionRaw === null &&
    totalRaw === null &&
    cachedRaw === null &&
    reasoningRaw === null
  ) {
    return null;
  }

  let promptTokens = promptRaw ?? 0;
  let completionTokens = completionRaw ?? 0;
  const cachedPromptTokens = Math.min(cachedRaw ?? 0, promptTokens > 0 ? promptTokens : (cachedRaw ?? 0));
  if (promptRaw === null && cachedPromptTokens > 0) promptTokens = cachedPromptTokens;
  const cacheWriteTokens = cacheWriteRaw ?? 0;
  const reasoningTokens = reasoningRaw ?? 0;
  const totalTokens = totalRaw ?? (promptTokens + completionTokens);

  return {
    promptTokens,
    cachedPromptTokens,
    cacheWriteTokens,
    completionTokens,
    reasoningTokens,
    totalTokens,
    source: 'provider'
  };
}

/**
 * Deterministic local token estimator used ONLY when an upstream provider
 * omits `usage` telemetry. Never fabricates cache hits (cachedPromptTokens = 0).
 */
export function estimateTextTokens(text) {
  if (!text) return 0;
  const str = typeof text === 'string' ? text : JSON.stringify(text);
  if (!str) return 0;
  let cjk = 0;
  let other = 0;
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3400 && code <= 0x4dbf) ||
      (code >= 0x3000 && code <= 0x303f) ||
      (code >= 0xff00 && code <= 0xffef)
    ) {
      cjk++;
    } else {
      other++;
    }
  }
  return Math.max(1, Math.ceil(cjk * 1.45 + other * 0.28));
}

export function estimateCallUsage(messages = [], outputText = '', reasoningText = '') {
  let promptTokens = 0;
  for (const msg of Array.isArray(messages) ? messages : []) {
    promptTokens += 4; // message framing overhead
    if (typeof msg?.content === 'string') {
      promptTokens += estimateTextTokens(msg.content);
    } else if (Array.isArray(msg?.content)) {
      for (const part of msg.content) {
        if (typeof part?.text === 'string') promptTokens += estimateTextTokens(part.text);
      }
    }
    if (Array.isArray(msg?.tool_calls)) {
      promptTokens += estimateTextTokens(JSON.stringify(msg.tool_calls));
    }
  }
  const reasoningTokens = estimateTextTokens(reasoningText);
  const contentTokens = estimateTextTokens(outputText);
  const completionTokens = contentTokens + reasoningTokens;
  return {
    promptTokens,
    cachedPromptTokens: 0,
    cacheWriteTokens: 0,
    completionTokens,
    reasoningTokens,
    totalTokens: promptTokens + completionTokens,
    source: 'estimated'
  };
}

export function emptyTokenUsage() {
  return {
    promptTokens: 0,
    cachedPromptTokens: 0,
    cacheWriteTokens: 0,
    completionTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
    source: 'provider'
  };
}

export function mergeTokenUsage(base, next) {
  const a = base || emptyTokenUsage();
  if (!next) return { ...a };
  const promptTokens = (a.promptTokens || 0) + (next.promptTokens || 0);
  const cachedPromptTokens = (a.cachedPromptTokens || 0) + (next.cachedPromptTokens || 0);
  const cacheWriteTokens = (a.cacheWriteTokens || 0) + (next.cacheWriteTokens || 0);
  const completionTokens = (a.completionTokens || 0) + (next.completionTokens || 0);
  const reasoningTokens = (a.reasoningTokens || 0) + (next.reasoningTokens || 0);
  const totalTokens = (a.totalTokens || 0) + (next.totalTokens || ((next.promptTokens || 0) + (next.completionTokens || 0)));
  const source = (a.source === 'estimated' || next.source === 'estimated') ? 'estimated' : 'provider';
  return {
    promptTokens,
    cachedPromptTokens,
    cacheWriteTokens,
    completionTokens,
    reasoningTokens,
    totalTokens,
    source
  };
}

export function computeCacheHitRate(cachedPromptTokens, promptTokens) {
  const prompt = Number(promptTokens) || 0;
  const cached = Math.max(0, Math.min(Number(cachedPromptTokens) || 0, prompt));
  if (prompt <= 0) return 0;
  return normalizeFloat((cached / prompt) * 100, 1);
}

const RANGE_DAYS = { '24h': 1, '7d': 7, '30d': 30, '90d': 90, 'all': 0 };

export function recordTokenUsage(db, entry = {}) {
  if (!db) return null;
  const promptTokens = Math.max(0, Math.round(Number(entry.promptTokens) || 0));
  const cachedPromptTokens = Math.max(0, Math.min(promptTokens, Math.round(Number(entry.cachedPromptTokens) || 0)));
  const cacheWriteTokens = Math.max(0, Math.round(Number(entry.cacheWriteTokens) || 0));
  const completionTokens = Math.max(0, Math.round(Number(entry.completionTokens) || 0));
  const reasoningTokens = Math.max(0, Math.round(Number(entry.reasoningTokens) || 0));
  const totalTokens = Math.max(0, Math.round(Number(entry.totalTokens) || (promptTokens + completionTokens)));
  if (totalTokens === 0 && promptTokens === 0 && completionTokens === 0) return null;

  const row = {
    id: entry.id || randomUUID(),
    conversationId: entry.conversationId || null,
    personaId: entry.personaId || null,
    model: String(entry.model || 'unknown').slice(0, 160),
    kind: String(entry.kind || 'chat').slice(0, 40),
    promptTokens,
    cachedPromptTokens,
    cacheWriteTokens,
    completionTokens,
    reasoningTokens,
    totalTokens,
    source: entry.source === 'estimated' ? 'estimated' : 'provider',
    durationMs: Math.max(0, Math.round(Number(entry.durationMs) || 0)),
    createdAt: entry.createdAt || new Date().toISOString()
  };

  try {
    db.prepare(`
      INSERT INTO token_usage_logs (
        id, conversationId, personaId, model, kind,
        promptTokens, cachedPromptTokens, cacheWriteTokens,
        completionTokens, reasoningTokens, totalTokens,
        source, durationMs, createdAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      row.id, row.conversationId, row.personaId, row.model, row.kind,
      row.promptTokens, row.cachedPromptTokens, row.cacheWriteTokens,
      row.completionTokens, row.reasoningTokens, row.totalTokens,
      row.source, row.durationMs, row.createdAt
    );
    return row;
  } catch {
    return null;
  }
}

export function queryUsageAnalytics(db, { range = '7d', conversationId = null } = {}) {
  const safeRange = Object.hasOwn(RANGE_DAYS, range) ? range : '7d';
  const days = RANGE_DAYS[safeRange];
  const conditions = [];
  const params = [];

  if (days > 0) {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    conditions.push('u.createdAt >= ?');
    params.push(cutoff);
  }
  if (conversationId) {
    conditions.push('u.conversationId = ?');
    params.push(String(conversationId));
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const rows = db.prepare(`
    SELECT u.*, c.title AS conversationTitle
    FROM token_usage_logs u
    LEFT JOIN conversations c ON c.id = u.conversationId
    ${where}
    ORDER BY u.createdAt ASC
  `).all(...params);

  const convSet = new Set();
  const modelMap = new Map();
  const convMap = new Map();
  const dayMap = new Map();
  const kindMap = new Map();

  let totalTokens = 0;
  let promptTokens = 0;
  let cachedPromptTokens = 0;
  let cacheWriteTokens = 0;
  let completionTokens = 0;
  let reasoningTokens = 0;
  let providerCount = 0;
  let estimatedCount = 0;
  let totalDurationMs = 0;

  for (const r of rows) {
    const pt = Number(r.promptTokens) || 0;
    const cp = Number(r.cachedPromptTokens) || 0;
    const cw = Number(r.cacheWriteTokens) || 0;
    const ct = Number(r.completionTokens) || 0;
    const rt = Number(r.reasoningTokens) || 0;
    const tt = Number(r.totalTokens) || (pt + ct);
    const dur = Number(r.durationMs) || 0;
    const modelName = r.model || 'unknown';
    const convId = r.conversationId || 'standalone';
    const dayKey = String(r.createdAt || '').slice(0, 10) || new Date().toISOString().slice(0, 10);
    const kindKey = r.kind || 'chat';

    totalTokens += tt;
    promptTokens += pt;
    cachedPromptTokens += cp;
    cacheWriteTokens += cw;
    completionTokens += ct;
    reasoningTokens += rt;
    totalDurationMs += dur;
    if (r.source === 'estimated') estimatedCount++; else providerCount++;
    if (r.conversationId) convSet.add(r.conversationId);

    // By model
    if (!modelMap.has(modelName)) {
      modelMap.set(modelName, {
        model: modelName, convs: new Set(), requestCount: 0,
        totalTokens: 0, promptTokens: 0, cachedPromptTokens: 0,
        completionTokens: 0, reasoningTokens: 0
      });
    }
    const m = modelMap.get(modelName);
    m.requestCount++;
    m.totalTokens += tt;
    m.promptTokens += pt;
    m.cachedPromptTokens += cp;
    m.completionTokens += ct;
    m.reasoningTokens += rt;
    if (r.conversationId) m.convs.add(r.conversationId);

    // By conversation
    if (!convMap.has(convId)) {
      convMap.set(convId, {
        conversationId: r.conversationId || null,
        title: r.conversationTitle || (r.conversationId ? '未命名对话' : '后台任务 / 独立调用'),
        requestCount: 0, totalTokens: 0, promptTokens: 0,
        cachedPromptTokens: 0, completionTokens: 0, updatedAt: r.createdAt
      });
    }
    const cv = convMap.get(convId);
    cv.requestCount++;
    cv.totalTokens += tt;
    cv.promptTokens += pt;
    cv.cachedPromptTokens += cp;
    cv.completionTokens += ct;
    if (r.createdAt > cv.updatedAt) cv.updatedAt = r.createdAt;

    // By day
    if (!dayMap.has(dayKey)) {
      dayMap.set(dayKey, {
        date: dayKey, totalTokens: 0, promptTokens: 0,
        cachedPromptTokens: 0, uncachedPromptTokens: 0,
        completionTokens: 0, requestCount: 0, byModel: {}
      });
    }
    const d = dayMap.get(dayKey);
    d.totalTokens += tt;
    d.promptTokens += pt;
    d.cachedPromptTokens += cp;
    d.uncachedPromptTokens += Math.max(0, pt - cp);
    d.completionTokens += ct;
    d.requestCount++;
    d.byModel[modelName] = (d.byModel[modelName] || 0) + tt;

    // By kind
    if (!kindMap.has(kindKey)) {
      kindMap.set(kindKey, { kind: kindKey, requestCount: 0, totalTokens: 0 });
    }
    const k = kindMap.get(kindKey);
    k.requestCount++;
    k.totalTokens += tt;
  }

  const uncachedPromptTokens = Math.max(0, promptTokens - cachedPromptTokens);
  const requestCount = rows.length;
  const pct = (part, whole) => whole > 0 ? normalizeFloat((part / whole) * 100, 1) : 0;

  const byModel = [...modelMap.values()]
    .map(m => ({
      model: m.model,
      conversationCount: m.convs.size,
      requestCount: m.requestCount,
      totalTokens: m.totalTokens,
      promptTokens: m.promptTokens,
      cachedPromptTokens: m.cachedPromptTokens,
      uncachedPromptTokens: Math.max(0, m.promptTokens - m.cachedPromptTokens),
      completionTokens: m.completionTokens,
      reasoningTokens: m.reasoningTokens,
      cacheHitRate: computeCacheHitRate(m.cachedPromptTokens, m.promptTokens),
      sharePct: pct(m.totalTokens, totalTokens)
    }))
    .sort((a, b) => b.totalTokens - a.totalTokens);

  const byConversation = [...convMap.values()]
    .map(c => ({
      ...c,
      uncachedPromptTokens: Math.max(0, c.promptTokens - c.cachedPromptTokens),
      cacheHitRate: computeCacheHitRate(c.cachedPromptTokens, c.promptTokens),
      sharePct: pct(c.totalTokens, totalTokens)
    }))
    .sort((a, b) => b.totalTokens - a.totalTokens)
    .slice(0, 30);

  const daily = [...dayMap.values()].sort((a, b) => a.date.localeCompare(b.date));

  const byKind = [...kindMap.values()]
    .map(k => ({ ...k, sharePct: pct(k.totalTokens, totalTokens) }))
    .sort((a, b) => b.totalTokens - a.totalTokens);

  return {
    range: safeRange,
    conversationId: conversationId || null,
    summary: {
      totalTokens,
      promptTokens,
      cachedPromptTokens,
      uncachedPromptTokens,
      cacheWriteTokens,
      completionTokens,
      reasoningTokens,
      cacheHitRate: computeCacheHitRate(cachedPromptTokens, promptTokens),
      requestCount,
      conversationCount: convSet.size,
      providerCount,
      estimatedCount,
      avgDurationMs: requestCount > 0 ? Math.round(totalDurationMs / requestCount) : 0
    },
    byModel,
    byConversation,
    daily,
    byKind
  };
}

export function clearTokenUsage(db) {
  if (!db) return { cleared: 0 };
  const result = db.prepare('DELETE FROM token_usage_logs').run();
  return { cleared: Number(result?.changes || 0) };
}

