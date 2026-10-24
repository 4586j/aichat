import { Worker } from 'node:worker_threads';
import { extname, basename } from 'node:path';
import { AppError } from './model.mjs';
import { id, now } from './store.mjs';

export const MAX_FILE_BYTES = 8 * 1024 * 1024;
export const MAX_TEXT_LENGTH = 300000;

export function tokenize(text) {
  const input = String(text).normalize('NFKC').toLowerCase();
  const words = input.match(/[a-z0-9_]{2,}/g) || [];
  for (const segment of input.match(/[\p{Script=Han}]+/gu) || []) {
    if (segment.length === 1) words.push(segment);
    else for (let i = 0; i < segment.length - 1; i++) words.push(segment.slice(i, i + 2));
  }
  return words;
}

export function rankText(query, rows, contentKey = 'content') {
  const queryTerms = [...new Set(tokenize(query))];
  if (!queryTerms.length) return [];
  const indexed = rows.map(row => {
    const tokens = tokenize(row[contentKey]);
    const frequency = new Map();
    for (const token of tokens) frequency.set(token, (frequency.get(token) || 0) + 1);
    return { row, frequency, length: tokens.length };
  });
  const average = indexed.reduce((sum, item) => sum + item.length, 0) / (indexed.length || 1) || 1;
  const weights = new Map(queryTerms.map(term => {
    const count = indexed.filter(item => item.frequency.has(term)).length;
    return [term, Math.log(1 + (rows.length - count + 0.5) / (count + 0.5))];
  }));
  return indexed.map(({ row, frequency, length }) => {
    let score = 0;
    for (const term of queryTerms) {
      const f = frequency.get(term) || 0;
      if (f) score += weights.get(term) * (f * 2.2) / (f + 1.2 * (0.25 + 0.75 * length / average));
    }
    return { ...row, relevance: score };
  }).filter(row => row.relevance > 0).sort((a, b) => b.relevance - a.relevance);
}

export function chunkText(text, size = 1000, overlap = 140) {
  const chunks = [];
  const input = text.replace(/\r\n/g, '\n').replace(/\0/g, '').trim();
  for (let start = 0; start < input.length;) {
    let end = Math.min(start + size, input.length);
    if (end < input.length) {
      const boundary = Math.max(input.lastIndexOf('\n', end), input.lastIndexOf('。', end));
      if (boundary > start + size / 2) end = boundary + 1;
    }
    const content = input.slice(start, end).trim();
    if (content) chunks.push(content);
    if (end === input.length) break;
    start = end - overlap;
  }
  return chunks;
}

async function parseBinary(buffer, format) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./document-worker.mjs', import.meta.url), {
      workerData: { buffer, format }, execArgv: [], resourceLimits: { maxOldGenerationSizeMb: 192 },
    });
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      if (error) reject(error); else resolve(value);
    };
    const timer = setTimeout(() => finish(new AppError('文档解析超时，请拆分或转换成 TXT 后重试。', 422)), 25000);
    worker.once('message', message => finish(message.error ? new AppError(message.error, 422) : null, message.text));
    worker.once('error', () => finish(new AppError('文档解析失败或超过资源限制，请检查文件。', 422)));
    worker.once('exit', () => { if (!settled) finish(new AppError('文档解析意外结束，请转换为 TXT 后重试。', 422)); });
  });
}

export function createKnowledge(store) {
  return {
    async importDocument(name, data) {
      if (typeof name !== 'string' || !name.trim() || name.length > 200) throw new AppError('文件名称无效。');
      const safeName = basename(name.replace(/\\/g, '/'));
      const format = extname(safeName).toLowerCase().slice(1);
      if (!['txt', 'md', 'json', 'pdf', 'docx'].includes(format)) throw new AppError('支持 TXT、MD、JSON、文字型 PDF 和 DOCX。');
      if (typeof data !== 'string' || !data.length || data.length > Math.ceil(MAX_FILE_BYTES / 3) * 4 || data.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(data)) {
        throw new AppError('文件内容无效或超过 8 MiB。');
      }
      const buffer = Buffer.from(data, 'base64');
      if (buffer.toString('base64') !== data) throw new AppError('文件 Base64 编码无效。');
      if (!buffer.length || buffer.length > MAX_FILE_BYTES) throw new AppError('文件不能为空或超过 8 MiB。');
      let text;
      if (format === 'pdf' || format === 'docx') text = await parseBinary(buffer, format);
      else {
        try { text = new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
        catch { throw new AppError('文本文件必须使用 UTF-8 编码，请转换编码后重试。'); }
      }
      text = text.replace(/\0/g, '').trim();
      if (!text) throw new AppError('没有提取到文字。扫描型 PDF 请先进行 OCR。');
      if (text.length > MAX_TEXT_LENGTH) throw new AppError('文档提取后超过 30 万字符，请拆分后导入。');
      const chunks = chunkText(text);
      const documentId = id();
      store.transaction(() => {
        store.run('INSERT INTO documents VALUES (?,?,?,?,?,?)', documentId, safeName, format, text.length, chunks.length, now());
        chunks.forEach((content, index) => store.run('INSERT INTO chunks VALUES (?,?,?,?)', id(), documentId, index + 1, content));
      });
      return store.get('SELECT * FROM documents WHERE id=?', documentId);
    },
    search(query, limit = 6) {
      const rows = store.all('SELECT c.id,c.documentId,d.name,c.chunkIndex AS "index",c.content FROM chunks c JOIN documents d ON d.id=c.documentId');
      return rankText(query, rows).slice(0, limit).map(({ relevance, ...row }) => ({ ...row, score: Number(relevance.toFixed(4)) }));
    },
  };
}
