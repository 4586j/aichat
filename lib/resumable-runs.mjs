import { id, now } from './store.mjs';
import { AppError } from './model.mjs';

export const BACKOFF_MINUTES = Object.freeze([5, 15, 60]);
const MAX_RETRY_AFTER_MS = 24 * 3600000;

export function computeNextResumeAt({ retryAfterMs = null, retryCount = 0, nowMs = Date.now() } = {}) {
  const safeCount = Math.max(0, Math.floor(Number(retryCount) || 0));
  const delayMs = Number.isFinite(retryAfterMs) && retryAfterMs > 0
    ? Math.min(Math.floor(retryAfterMs), MAX_RETRY_AFTER_MS)
    : BACKOFF_MINUTES[Math.min(safeCount, BACKOFF_MINUTES.length - 1)] * 60000;
  return new Date(nowMs + delayMs).toISOString();
}

function summarizeRun(row) {
  if (!row) return null;
  const { stateJson, ...summary } = row;
  return summary;
}

export function listActiveResumableRuns(store) {
  return store.all(
    `SELECT id, kind, status, conversationId, personaId, taskId, title, step, modelOverride, retryCount, resumeAt, lastError, createdAt, updatedAt
     FROM resumable_runs
     WHERE status IN ('paused_quota', 'running')
     ORDER BY resumeAt ASC, updatedAt DESC
     LIMIT 50`
  );
}

export function getResumableRun(store, runId) {
  const row = store.get('SELECT * FROM resumable_runs WHERE id=?', String(runId || ''));
  if (!row) return null;
  let state = {};
  try { state = row.stateJson ? JSON.parse(row.stateJson) : {}; } catch { state = {}; }
  return { ...summarizeRun(row), state };
}

export function savePausedRun(store, {
  existingId = null,
  kind,
  conversationId = null,
  personaId = null,
  taskId = null,
  title = '',
  step = 0,
  state = {},
  modelOverride = '',
  retryCount = 0,
  retryAfterMs = null,
  lastError = '',
  nowMs = Date.now()
}) {
  const stamp = new Date(nowMs).toISOString();
  const resumeAt = computeNextResumeAt({ retryAfterMs, retryCount, nowMs });
  const serialized = JSON.stringify(state || {});
  const safeStep = Math.max(0, Math.floor(Number(step) || 0));
  const safeRetry = Math.max(0, Math.floor(Number(retryCount) || 0));
  const safeModel = String(modelOverride || '').trim().slice(0, 160);
  const safeError = String(lastError || '模型服务限流或额度不足，已保存断点。').slice(0, 500);
  const safeTitle = String(title || '').trim().slice(0, 120);

  if (existingId) {
    store.run(
      `UPDATE resumable_runs
       SET status='paused_quota', step=?, stateJson=?, modelOverride=?, retryCount=?, resumeAt=?, lastError=?, updatedAt=?
       WHERE id=?`,
      safeStep, serialized, safeModel, safeRetry, resumeAt, safeError, stamp, existingId
    );
    return summarizeRun(store.get('SELECT * FROM resumable_runs WHERE id=?', existingId));
  }

  const runId = id();
  store.run(
    `INSERT INTO resumable_runs (id,kind,status,conversationId,personaId,taskId,title,step,stateJson,modelOverride,retryCount,resumeAt,lastError,createdAt,updatedAt)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    runId, kind, 'paused_quota', conversationId, personaId, taskId, safeTitle,
    safeStep, serialized, safeModel, safeRetry, resumeAt, safeError, stamp, stamp
  );
  return summarizeRun(store.get('SELECT * FROM resumable_runs WHERE id=?', runId));
}

export function claimResumableRun(store, runId) {
  const claimed = store.run(
    "UPDATE resumable_runs SET status='running', updatedAt=? WHERE id=? AND status='paused_quota'",
    now(), String(runId || '')
  );
  return claimed.changes > 0;
}

export function completeResumableRun(store, runId) {
  store.run(
    "UPDATE resumable_runs SET status='completed', lastError='', updatedAt=? WHERE id=?",
    now(), String(runId || '')
  );
}

export function failResumableRun(store, runId, message) {
  store.run(
    "UPDATE resumable_runs SET status='failed', lastError=?, updatedAt=? WHERE id=?",
    String(message || '恢复执行失败。').slice(0, 500), now(), String(runId || '')
  );
}

export function updateResumableRun(store, runId, { resumeAt, modelOverride } = {}) {
  const existing = store.get('SELECT * FROM resumable_runs WHERE id=?', String(runId || ''));
  if (!existing) throw new AppError('断点任务不存在。', 404);
  if (existing.status !== 'paused_quota') throw new AppError('仅支持调整处于等待恢复状态的断点任务。', 409);
  let nextResumeAt = existing.resumeAt;
  if (resumeAt !== undefined) {
    const parsed = Date.parse(String(resumeAt));
    if (!Number.isFinite(parsed)) throw new AppError('恢复时间格式无效。', 400);
    nextResumeAt = new Date(parsed).toISOString();
  }
  const nextModel = modelOverride !== undefined
    ? String(modelOverride || '').trim().slice(0, 160)
    : existing.modelOverride;
  store.run(
    'UPDATE resumable_runs SET resumeAt=?, modelOverride=?, updatedAt=? WHERE id=?',
    nextResumeAt, nextModel, now(), existing.id
  );
  return summarizeRun(store.get('SELECT * FROM resumable_runs WHERE id=?', existing.id));
}

export function cancelResumableRun(store, runId) {
  const existing = store.get('SELECT * FROM resumable_runs WHERE id=?', String(runId || ''));
  if (!existing) throw new AppError('断点任务不存在。', 404);
  store.run("UPDATE resumable_runs SET status='cancelled', updatedAt=? WHERE id=?", now(), existing.id);
  return { ok: true, id: existing.id };
}

export function recoverRunningResumableRuns(store) {
  const stamp = now();
  store.run(
    "UPDATE resumable_runs SET status='paused_quota', resumeAt=?, updatedAt=? WHERE status='running'",
    stamp, stamp
  );
}

export function listDueResumableRuns(store, timeMs = Date.now()) {
  return store.all(
    "SELECT id FROM resumable_runs WHERE status='paused_quota' AND resumeAt<=? ORDER BY resumeAt ASC LIMIT 10",
    new Date(timeMs).toISOString()
  );
}
