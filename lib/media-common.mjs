import { createHash } from 'node:crypto';
import { AppError, validateBaseUrl } from './model.mjs';

export const digest = value => createHash('sha256').update(value).digest('hex');
export function shortText(value, label, max = 160, required = false) {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value) || (required && !value.trim())) throw new AppError(`${label}格式无效或超过 ${max} 字符。`);
  return value.trim();
}
export function serviceUrl(value) {
  return value === '' ? '' : validateBaseUrl(shortText(value, '服务地址', 500, true));
}
export async function readLimited(response, limit) {
  if (!response.body) throw new AppError('服务返回空响应。', 502);
  const reader = response.body.getReader();
  const parts = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new AppError('媒体响应超过大小限制。', 502);
      parts.push(Buffer.from(value));
    }
    return Buffer.concat(parts);
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
}
export async function fetchJson(fetchImpl, url, { headers = {}, timeoutMs = 6000 } = {}) {
  try {
    const response = await fetchImpl(url, { headers, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) {
      await response.body?.cancel();
      throw new AppError(response.status === 401 || response.status === 403 ? '音乐或媒体服务鉴权失败，请检查 API Key。' : `媒体服务返回 HTTP ${response.status}。`, 502);
    }
    const data = JSON.parse((await readLimited(response, 3 * 1024 * 1024)).toString('utf8'));
    if (!data || typeof data !== 'object' || data.error) throw new AppError('媒体服务响应无效。', 502);
    return data;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('无法连接媒体服务，请检查地址、网络或稍后重试。', 502);
  }
}
