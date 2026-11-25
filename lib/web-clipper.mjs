import dns from 'node:dns';
import net from 'node:net';
import { AppError } from './model.mjs';

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 12000;
const MAX_REDIRECTS = 3;
const MAX_MARKDOWN_CHARS = 40000;

function ipv4ToInt(ip) {
  const parts = ip.split('.').map(n => Number(n));
  if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

function isForbiddenIpv4(ip) {
  const n = ipv4ToInt(ip);
  if (n === null) return true;
  const cidr = (base, maskBits) => {
    const mask = maskBits === 0 ? 0 : (~0 << (32 - maskBits)) >>> 0;
    return (n & mask) === (ipv4ToInt(base) & mask);
  };
  return (
    cidr('0.0.0.0', 8) ||
    cidr('10.0.0.0', 8) ||
    cidr('100.64.0.0', 10) ||
    cidr('127.0.0.0', 8) ||
    cidr('169.254.0.0', 16) ||
    cidr('172.16.0.0', 12) ||
    cidr('192.0.0.0', 24) ||
    cidr('192.0.2.0', 24) ||
    cidr('192.168.0.0', 16) ||
    cidr('198.18.0.0', 15) ||
    cidr('198.51.100.0', 24) ||
    cidr('203.0.113.0', 24) ||
    cidr('224.0.0.0', 4) ||
    cidr('240.0.0.0', 4)
  );
}

export function isForbiddenIpAddress(rawIp) {
  const ip = String(rawIp || '').trim().toLowerCase().replace(/^\[|\]$/g, '').split('%')[0];
  if (!ip) return true;
  const kind = net.isIP(ip);
  if (kind === 4) return isForbiddenIpv4(ip);
  if (kind !== 6) return true;
  if (ip === '::' || ip === '::1') return true;
  if (ip.startsWith('::ffff:')) {
    const mapped = ip.slice(7);
    if (net.isIP(mapped) === 4) return isForbiddenIpv4(mapped);
  }
  const firstHextet = Number.parseInt(ip.split(':')[0] || '0', 16);
  if (!Number.isFinite(firstHextet)) return true;
  // fc00::/7 unique local, fe80::/10 link-local, ff00::/8 multicast
  if ((firstHextet & 0xfe00) === 0xfc00) return true;
  if ((firstHextet & 0xffc0) === 0xfe80) return true;
  if ((firstHextet & 0xff00) === 0xff00) return true;
  return false;
}

function isForbiddenHostname(hostname) {
  const host = String(hostname || '').trim().toLowerCase().replace(/\.$/, '');
  if (!host) return true;
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    return true;
  }
  const stripped = host.replace(/^\[|\]$/g, '');
  if (net.isIP(stripped)) return isForbiddenIpAddress(stripped);
  return false;
}

async function assertPublicTarget(urlObj, dnsLookupImpl) {
  if (!['http:', 'https:'].includes(urlObj.protocol)) {
    throw new AppError('仅支持抓取 http:// 或 https:// 公开网页链接。', 400);
  }
  if (urlObj.username || urlObj.password) {
    throw new AppError('不支持包含登录凭据的链接。', 400);
  }
  if (isForbiddenHostname(urlObj.hostname)) {
    throw new AppError('安全策略禁止访问本机、内网或保留地址。', 400);
  }
  const rawHost = urlObj.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(rawHost)) {
    if (isForbiddenIpAddress(rawHost)) throw new AppError('安全策略禁止访问本机或内网 IP 地址。', 400);
    return;
  }
  const lookup = dnsLookupImpl || (host => dns.promises.lookup(host, { all: true, verbatim: true }));
  let records;
  try {
    records = await lookup(rawHost);
  } catch {
    throw new AppError('无法解析目标网址域名，请检查网络或网址是否正确。', 400);
  }
  const list = Array.isArray(records) ? records : [records];
  if (!list.length) throw new AppError('目标网址未返回有效解析记录。', 400);
  for (const rec of list) {
    const addr = typeof rec === 'string' ? rec : rec?.address;
    if (!addr || isForbiddenIpAddress(addr)) {
      throw new AppError('安全策略禁止访问解析到内网或保留地址的域名。', 400);
    }
  }
}

function decodeHtmlEntities(str) {
  return String(str || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, num) => {
      const code = Number(num);
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    });
}

function stripTags(html) {
  return decodeHtmlEntities(String(html || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

export function htmlToReadableMarkdown(html, sourceUrl) {
  const raw = String(html || '');
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/iu.exec(raw);
  const title = stripTags(titleMatch?.[1] || '') || new URL(sourceUrl).hostname;

  let body = raw
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|template|iframe|svg|canvas)\b[\s\S]*?<\/\1>/giu, '')
    .replace(/<(?:head|nav|footer)\b[\s\S]*?<\/(?:head|nav|footer)>/giu, '');

  body = body.replace(/<a\b[^>]*href=(['"])(.*?)\1[^>]*>([\s\S]*?)<\/a>/giu, (_, _q, href, label) => {
    const cleanLabel = stripTags(label);
    const trimmedHref = String(href || '').trim();
    if (!cleanLabel) return '';
    if (/^https?:\/\//i.test(trimmedHref)) return `[${cleanLabel}](${trimmedHref})`;
    return cleanLabel;
  });

  body = body.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/giu, (_, inner) => {
    const codeText = decodeHtmlEntities(inner.replace(/<[^>]+>/g, '')).trim();
    return codeText ? `\n\n\`\`\`\n${codeText}\n\`\`\`\n\n` : '\n\n';
  });

  body = body.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/giu, (_, lvl, inner) => {
    const text = stripTags(inner);
    return text ? `\n\n${'#'.repeat(Math.min(6, Number(lvl)))} ${text}\n\n` : '\n\n';
  });

  body = body.replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/giu, (_, inner) => {
    const text = stripTags(inner);
    return text ? `\n\n> ${text}\n\n` : '\n\n';
  });

  body = body.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/giu, (_, inner) => {
    const text = stripTags(inner);
    return text ? `\n- ${text}` : '';
  });

  body = body
    .replace(/<br\s*\/?>/giu, '\n')
    .replace(/<\/(?:p|div|section|article|tr|ul|ol|table|dl)>/giu, '\n\n')
    .replace(/<td\b[^>]*>([\s\S]*?)<\/td>/giu, (_, c) => ` ${stripTags(c)} |`)
    .replace(/<th\b[^>]*>([\s\S]*?)<\/th>/giu, (_, c) => ` ${stripTags(c)} |`)
    .replace(/<[^>]+>/g, '');

  const cleaned = decodeHtmlEntities(body)
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_MARKDOWN_CHARS);

  return { title, markdown: cleaned || title };
}

async function readResponseWithLimit(response, maxBytes) {
  const lenHeader = Number(response.headers.get('content-length') || 0);
  if (lenHeader > maxBytes) throw new AppError('网页正文超过 2 MiB 限制。', 413);
  if (!response.body) return await response.text();
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new AppError('网页正文超过 2 MiB 限制。', 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function clipPublicUrl(
  rawUrl,
  { fetchImpl = fetch, dnsLookupImpl, maxBytes = DEFAULT_MAX_BYTES, timeoutMs = DEFAULT_TIMEOUT_MS, signal } = {}
) {
  let currentUrl;
  try {
    currentUrl = new URL(String(rawUrl || '').trim());
  } catch {
    throw new AppError('请输入有效的 http:// 或 https:// 网页地址。', 400);
  }

  const timeoutController = new AbortController();
  const timer = setTimeout(() => timeoutController.abort(), timeoutMs);
  const combinedSignal = signal ? AbortSignal.any([signal, timeoutController.signal]) : timeoutController.signal;

  try {
    let response = null;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      await assertPublicTarget(currentUrl, dnsLookupImpl);
      response = await fetchImpl(currentUrl.toString(), {
        method: 'GET',
        redirect: 'manual',
        signal: combinedSignal,
        headers: {
          'User-Agent': 'QiYi-AI-Companion/1.0 (Local-First Web Clipper)',
          'Accept': 'text/html,application/xhtml+xml,text/plain,text/markdown;q=0.9'
        }
      });
      if (response.status >= 300 && response.status < 400) {
        const loc = response.headers.get('location');
        await response.body?.cancel();
        if (!loc) throw new AppError('网页重定向缺少目标地址。', 502);
        if (hop === MAX_REDIRECTS) throw new AppError('网页重定向次数过多，已停止抓取。', 502);
        currentUrl = new URL(loc, currentUrl);
        continue;
      }
      break;
    }

    if (!response || !response.ok) {
      throw new AppError(`网页抓取失败（HTTP ${response?.status || '错误'}）。`, 502);
    }
    const contentType = String(response.headers.get('content-type') || 'text/html').toLowerCase();
    const isPlainOrMarkdown = contentType.includes('text/plain') || contentType.includes('text/markdown');
    const isHtml = contentType.includes('text/html') || contentType.includes('application/xhtml+xml');
    if (!isHtml && !isPlainOrMarkdown) {
      throw new AppError(`不支持的网页内容类型：${contentType.split(';')[0]}，仅支持网页 HTML、Markdown 或纯文本。`, 415);
    }

    const rawText = await readResponseWithLimit(response, maxBytes);
    const extracted = isHtml
      ? htmlToReadableMarkdown(rawText, currentUrl.toString())
      : {
          title: currentUrl.pathname.split('/').filter(Boolean).pop() || currentUrl.hostname,
          markdown: String(rawText || '').trim().slice(0, MAX_MARKDOWN_CHARS)
        };
    if (!extracted.markdown) throw new AppError('未能从网页中提取到有效正文。', 422);

    return {
      url: currentUrl.toString(),
      title: extracted.title.slice(0, 120),
      markdown: extracted.markdown,
      charCount: extracted.markdown.length,
      excerpt: extracted.markdown.replace(/\s+/g, ' ').slice(0, 180)
    };
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (err?.name === 'AbortError') throw new AppError('抓取网页超时或已取消。', 504);
    throw new AppError('无法连接目标网页，请检查网络连通性。', 502);
  } finally {
    clearTimeout(timer);
  }
}
