import { Worker } from 'node:worker_threads';
import { extname, basename } from 'node:path';
import { AppError } from './model.mjs';
import { id, now } from './store.mjs';
import {
  LOCAL_EMBEDDING_DIM,
  LOCAL_EMBEDDING_MODEL,
  blobToVector,
  computeLocalEmbedding,
  cosineSimilarity,
  extractSemanticFeatures,
  hasSemanticOverlap,
  vectorToBlob,
} from './vector.mjs';

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

export function hybridRankText(query, rows, contentKey = 'content') {
  if (!rows.length) return [];
  const bm25Rows = rankText(query, rows, contentKey);
  const bm25Map = new Map();
  bm25Rows.forEach((row, idx) => bm25Map.set(row, { score: row.relevance, rank: idx }));

  const qFeatures = extractSemanticFeatures(query);
  if (!qFeatures.concepts.size && !qFeatures.subwords.size && !bm25Rows.length) return [];
  const qVec = computeLocalEmbedding(query, qFeatures);

  const vecScored = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const text = row[contentKey] || '';
    const dFeatures = extractSemanticFeatures(text);
    if (!hasSemanticOverlap(qFeatures, dFeatures)) continue;
    const dVec = computeLocalEmbedding(text, dFeatures);
    const sim = cosineSimilarity(qVec, dVec);
    if (sim >= 0.22) vecScored.push({ index: i, sim });
  }
  vecScored.sort((a, b) => b.sim - a.sim);
  const vecRankMap = new Map();
  vecScored.forEach((item, rank) => vecRankMap.set(item.index, { sim: item.sim, rank }));

  const bm25ByIndex = new Map();
  const queryTerms = [...new Set(tokenize(query))];
  if (queryTerms.length) {
    const indexed = rows.map((row, idx) => {
      const tokens = tokenize(row[contentKey]);
      const frequency = new Map();
      for (const token of tokens) frequency.set(token, (frequency.get(token) || 0) + 1);
      return { idx, frequency, length: tokens.length };
    });
    const average = indexed.reduce((sum, item) => sum + item.length, 0) / (indexed.length || 1) || 1;
    const weights = new Map(queryTerms.map(term => {
      const count = indexed.filter(item => item.frequency.has(term)).length;
      return [term, Math.log(1 + (rows.length - count + 0.5) / (count + 0.5))];
    }));
    const scored = [];
    for (const { idx, frequency, length } of indexed) {
      let score = 0;
      for (const term of queryTerms) {
        const f = frequency.get(term) || 0;
        if (f) score += weights.get(term) * (f * 2.2) / (f + 1.2 * (0.25 + 0.75 * length / average));
      }
      if (score > 0) scored.push({ idx, score });
    }
    scored.sort((a, b) => b.score - a.score);
    scored.forEach((item, rank) => bm25ByIndex.set(item.idx, { score: item.score, rank }));
  }

  const results = [];
  for (let i = 0; i < rows.length; i++) {
    const bm25 = bm25ByIndex.get(i);
    const vec = vecRankMap.get(i);
    if (!bm25 && !vec) continue;
    const rrf = (bm25 ? 1 / (60 + bm25.rank + 1) : 0) + (vec ? 0.85 / (60 + vec.rank + 1) : 0);
    const relevance = (bm25 ? bm25.score : 0) + (vec ? vec.sim * 1.4 : 0) + rrf * 6;
    results.push({ ...rows[i], relevance });
  }
  return results.sort((a, b) => b.relevance - a.relevance);
}

export function extractHeadingPaths(chunks) {
  const stack = ['', '', '', '', '', ''];
  return chunks.map(content => {
    const currentBefore = stack.filter(Boolean).join(' > ');
    for (const match of content.matchAll(/^ {0,3}(#{1,6})\s+([^\n]{1,200})/gmu)) {
      const level = match[1].length - 1;
      stack[level] = match[2].trim();
      for (let k = level + 1; k < 6; k++) stack[k] = '';
    }
    const currentAfter = stack.filter(Boolean).join(' > ');
    return currentAfter || currentBefore;
  });
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

let sharedWorker = null;
let sharedWorkerIdleTimer = null;
let currentTaskId = 0;
const pendingWorkerTasks = new Map();

function getSharedWorker() {
  if (!sharedWorker) {
    sharedWorker = new Worker(new URL('./document-worker.mjs', import.meta.url), {
      execArgv: [],
      resourceLimits: { maxOldGenerationSizeMb: 192 },
    });
    sharedWorker.unref();

    sharedWorker.on('message', msg => {
      if (!msg || !msg.id) return;
      const task = pendingWorkerTasks.get(msg.id);
      if (task) {
        pendingWorkerTasks.delete(msg.id);
        clearTimeout(task.timer);
        if (msg.error) task.reject(new AppError(msg.error, 422));
        else task.resolve(msg.text);
      }
      resetSharedWorkerIdleTimer();
    });

    sharedWorker.on('error', () => {
      destroySharedWorker(new AppError('文档解析失败或超过资源限制，请检查文件。', 422));
    });

    sharedWorker.on('exit', () => {
      destroySharedWorker(new AppError('文档解析意外结束，请转换为 TXT 后重试。', 422));
    });
  }
  return sharedWorker;
}

function destroySharedWorker(error = null) {
  if (sharedWorkerIdleTimer) {
    clearTimeout(sharedWorkerIdleTimer);
    sharedWorkerIdleTimer = null;
  }
  if (sharedWorker) {
    const w = sharedWorker;
    sharedWorker = null;
    void w.terminate().catch(() => {});
  }
  if (error) {
    for (const [, task] of pendingWorkerTasks) {
      clearTimeout(task.timer);
      task.reject(error);
    }
    pendingWorkerTasks.clear();
  }
}

function resetSharedWorkerIdleTimer() {
  if (sharedWorkerIdleTimer) clearTimeout(sharedWorkerIdleTimer);
  if (pendingWorkerTasks.size === 0) {
    sharedWorkerIdleTimer = setTimeout(() => {
      destroySharedWorker();
    }, 30000);
    sharedWorkerIdleTimer.unref?.();
  }
}

async function parseBinary(buffer, format) {
  const worker = getSharedWorker();
  const taskId = ++currentTaskId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingWorkerTasks.delete(taskId);
      destroySharedWorker(new AppError('文档解析超时，请拆分或转换成 TXT 后重试。', 422));
      reject(new AppError('文档解析超时，请拆分或转换成 TXT 后重试。', 422));
    }, 25000);

    pendingWorkerTasks.set(taskId, { resolve, reject, timer });
    if (sharedWorkerIdleTimer) {
      clearTimeout(sharedWorkerIdleTimer);
      sharedWorkerIdleTimer = null;
    }
    worker.postMessage({ id: taskId, buffer, format });
  });
}

export function createKnowledge(store) {
  let cachedSignature = '';
  let cachedItems = [];
  let cachedPostings = new Map();
  let cachedAvgLength = 1;

  function ensureIndex() {
    const sigRow = store.get('SELECT COUNT(*) AS n, COALESCE(MAX(rowid), 0) AS m FROM chunks');
    const signature = `${sigRow?.n || 0}:${sigRow?.m || 0}`;
    if (signature === cachedSignature) return;

    const rows = store.all(`
      SELECT c.id, c.documentId, d.name, c.chunkIndex AS "index", c.content,
             v.headingPath, v.dim, v.vector
      FROM chunks c
      JOIN documents d ON d.id = c.documentId
      LEFT JOIN chunk_vectors v ON v.chunkId = c.id
      ORDER BY c.documentId, c.chunkIndex
    `);

    const headingStacks = new Map();
    const missingVectors = [];
    const items = [];
    const postings = new Map();
    let totalTokens = 0;

    for (let idx = 0; idx < rows.length; idx++) {
      const row = rows[idx];
      let stack = headingStacks.get(row.documentId);
      if (!stack) {
        stack = ['', '', '', '', '', ''];
        headingStacks.set(row.documentId, stack);
      }
      const beforePath = stack.filter(Boolean).join(' > ');
      for (const match of row.content.matchAll(/^ {0,3}(#{1,6})\s+([^\n]{1,200})/gmu)) {
        const level = match[1].length - 1;
        stack[level] = match[2].trim();
        for (let k = level + 1; k < 6; k++) stack[k] = '';
      }
      const computedPath = stack.filter(Boolean).join(' > ') || beforePath;
      const headingPath = row.headingPath || computedPath;
      const searchText = `${row.name}\n${headingPath}\n${row.content}`;

      const tokens = tokenize(searchText);
      const frequency = new Map();
      for (const token of tokens) frequency.set(token, (frequency.get(token) || 0) + 1);
      for (const [term, tf] of frequency.entries()) {
        let list = postings.get(term);
        if (!list) {
          list = [];
          postings.set(term, list);
        }
        list.push({ idx, tf });
      }
      totalTokens += tokens.length;

      const features = extractSemanticFeatures(searchText);
      let vector = blobToVector(row.vector);
      if (!vector || vector.length !== LOCAL_EMBEDDING_DIM) {
        vector = computeLocalEmbedding(searchText, features);
        missingVectors.push({ chunkId: row.id, headingPath, vector });
      }

      items.push({
        id: row.id,
        documentId: row.documentId,
        name: row.name,
        index: row.index,
        content: row.content,
        headingPath,
        searchText,
        frequency,
        length: tokens.length,
        features,
        vector,
      });
    }

    if (missingVectors.length) {
      store.transaction(() => {
        for (const item of missingVectors) {
          store.run(
            'INSERT INTO chunk_vectors (chunkId, headingPath, model, dim, vector) VALUES (?,?,?,?,?) ON CONFLICT(chunkId) DO UPDATE SET headingPath=excluded.headingPath, model=excluded.model, dim=excluded.dim, vector=excluded.vector',
            item.chunkId,
            item.headingPath,
            LOCAL_EMBEDDING_MODEL,
            LOCAL_EMBEDDING_DIM,
            vectorToBlob(item.vector)
          );
          const itemObj = items.find(i => i.id === item.chunkId);
          if (itemObj) {
            store.run('DELETE FROM chunks_fts WHERE chunkId=?', item.chunkId);
            store.run('INSERT INTO chunks_fts (chunkId, content) VALUES (?,?)', item.chunkId, tokenize(itemObj.searchText).join(' '));
          }
        }
      });
    }

    cachedItems = items;
    cachedPostings = postings;
    cachedAvgLength = items.length ? (totalTokens / items.length || 1) : 1;
    cachedSignature = signature;
  }

  return {
    async parseText(name, data) {
      if (typeof name !== 'string' || !name.trim() || name.length > 200) throw new AppError('文件名称无效。');
      const safeName = basename(name.replace(/\\/g, '/'));
      const format = extname(safeName).toLowerCase().slice(1);
      const supportedFormats = [
        'txt', 'md', 'json', 'pdf', 'docx', 'csv', 'log', 'yaml', 'yml', 'xml', 'html', 'css',
        'js', 'mjs', 'cjs', 'ts', 'jsx', 'tsx', 'py', 'java', 'c', 'cpp', 'h', 'hpp', 'rs', 'go',
        'sql', 'sh', 'bash', 'bat', 'ps1', 'ini', 'env', 'toml'
      ];
      if (!supportedFormats.includes(format)) throw new AppError('不支持该文件格式，请传入代码文件、文本、JSON、DOCX 或 PDF。');
      if (typeof data !== 'string' || !data.length || data.length > Math.ceil(MAX_FILE_BYTES / 3) * 4) {
        throw new AppError('文件内容无效或超过 8 MiB。');
      }
      const buffer = Buffer.from(data, 'base64');
      if (!buffer.length || buffer.length > MAX_FILE_BYTES) throw new AppError('文件不能为空或超过 8 MiB。');
      let text;
      if (format === 'pdf' || format === 'docx') text = await parseBinary(buffer, format);
      else {
        try { text = new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
        catch { throw new AppError('文本文件必须使用 UTF-8 编码，请转换编码后重试。'); }
      }
      text = text.replace(/\0/g, '').trim();
      if (!text) throw new AppError('没有提取到文字。扫描型 PDF 请先进行 OCR。');
      return { name: safeName, format, text, charCount: text.length, lineCount: text.split('\n').length };
    },
    async importDocument(name, data) {
      if (typeof name !== 'string' || !name.trim() || name.length > 200) throw new AppError('文件名称无效。');
      const safeName = basename(name.replace(/\\/g, '/'));
      const format = extname(safeName).toLowerCase().slice(1);
      if (!['txt', 'md', 'json', 'pdf', 'docx'].includes(format)) throw new AppError('支持 TXT、MD、JSON、文字型 PDF 和 DOCX。');
      if (typeof data !== 'string' || !data.length || data.length > Math.ceil(MAX_FILE_BYTES / 3) * 4 || data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) {
        throw new AppError('文件内容无效或超过 8 MiB。');
      }
      const tail = data.slice(-4);
      if (Buffer.from(tail, 'base64').toString('base64') !== tail) throw new AppError('文件 Base64 编码无效。');
      const buffer = Buffer.from(data, 'base64');
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
      const headingPaths = extractHeadingPaths(chunks);
      const documentId = id();
      store.transaction(() => {
        store.run('INSERT INTO documents VALUES (?,?,?,?,?,?)', documentId, safeName, format, text.length, chunks.length, now());
        chunks.forEach((content, index) => {
          const chunkId = id();
          const headingPath = headingPaths[index] || '';
          const searchText = `${safeName}\n${headingPath}\n${content}`;
          const vec = computeLocalEmbedding(searchText);
          store.run('INSERT INTO chunks VALUES (?,?,?,?)', chunkId, documentId, index + 1, content);
          store.run('DELETE FROM chunks_fts WHERE chunkId=?', chunkId);
          store.run('INSERT INTO chunks_fts (chunkId, content) VALUES (?,?)', chunkId, tokenize(searchText).join(' '));
          store.run(
            'INSERT INTO chunk_vectors (chunkId, headingPath, model, dim, vector) VALUES (?,?,?,?,?)',
            chunkId,
            headingPath,
            LOCAL_EMBEDDING_MODEL,
            LOCAL_EMBEDDING_DIM,
            vectorToBlob(vec)
          );
        });
      });
      cachedSignature = '';
      return store.get('SELECT * FROM documents WHERE id=?', documentId);
    },
    vectorSearch(query, limit = 6) {
      ensureIndex();
      if (!cachedItems.length) return [];
      const qFeatures = extractSemanticFeatures(query);
      if (!qFeatures.concepts.size && !qFeatures.subwords.size) return [];
      const qVec = computeLocalEmbedding(query, qFeatures);
      const matches = [];
      for (const item of cachedItems) {
        if (!hasSemanticOverlap(qFeatures, item.features)) continue;
        const sim = cosineSimilarity(qVec, item.vector);
        if (sim >= 0.18) {
          matches.push({
            id: item.id,
            documentId: item.documentId,
            name: item.name,
            index: item.index,
            content: item.content,
            score: Number(sim.toFixed(4)),
          });
        }
      }
      return matches.sort((a, b) => b.score - a.score).slice(0, limit);
    },
    ftsSearch(query, limit = 20) {
      const terms = [...new Set(tokenize(query))].filter(t => /^[a-z0-9_\p{Script=Han}]+$/iu.test(t));
      if (!terms.length) return [];
      const matchExpr = terms.slice(0, 12).map(t => `"${t.replace(/"/g, '""')}"`).join(' OR ');
      try {
        return store.all(
          'SELECT chunkId, bm25(chunks_fts) AS rank FROM chunks_fts WHERE chunks_fts MATCH ? ORDER BY rank LIMIT ?',
          matchExpr,
          limit
        );
      } catch {
        return [];
      }
    },
    search(query, limit = 6) {
      ensureIndex();
      const total = cachedItems.length;
      if (!total) return [];

      // 1. Sparse Channel: FTS5 Index + In-Memory Inverted Index BM25
      const ftsHits = new Map();
      const ftsRows = this.ftsSearch(query, Math.max(limit * 8, 40));
      ftsRows.forEach((row, idx) => ftsHits.set(row.chunkId, idx));

      const queryTerms = [...new Set(tokenize(query))];
      const bm25Scores = new Map();
      for (const term of queryTerms) {
        const list = cachedPostings.get(term);
        if (!list || !list.length) continue;
        const idf = Math.log(1 + (total - list.length + 0.5) / (list.length + 0.5));
        for (const { idx, tf } of list) {
          const item = cachedItems[idx];
          const termScore = idf * (tf * 2.2) / (tf + 1.2 * (0.25 + 0.75 * item.length / cachedAvgLength));
          bm25Scores.set(idx, (bm25Scores.get(idx) || 0) + termScore);
        }
      }
      if (ftsHits.size) {
        for (let idx = 0; idx < total; idx++) {
          const ftsRank = ftsHits.get(cachedItems[idx].id);
          if (ftsRank !== undefined) {
            bm25Scores.set(idx, (bm25Scores.get(idx) || 0) + 0.35 / (1 + ftsRank * 0.15));
          }
        }
      }
      const bm25Ranked = [...bm25Scores.entries()]
        .filter(([, score]) => score > 0)
        .sort((a, b) => b[1] - a[1]);
      const bm25RankMap = new Map();
      bm25Ranked.forEach(([idx, score], rank) => bm25RankMap.set(idx, { score, rank }));

      // 2. Dense Channel: Unit-Normalized Float32Array Vector Inner Product
      const qFeatures = extractSemanticFeatures(query);
      const vecRankMap = new Map();
      if (qFeatures.concepts.size || qFeatures.subwords.size) {
        const qVec = computeLocalEmbedding(query, qFeatures);
        const vecScored = [];
        for (let idx = 0; idx < total; idx++) {
          const item = cachedItems[idx];
          if (!hasSemanticOverlap(qFeatures, item.features)) continue;
          const sim = cosineSimilarity(qVec, item.vector);
          if (sim >= 0.20) vecScored.push({ idx, sim });
        }
        vecScored.sort((a, b) => b.sim - a.sim);
        vecScored.forEach(({ idx, sim }, rank) => vecRankMap.set(idx, { sim, rank }));
      }

      // 3. Hybrid Reciprocal Rank Fusion (RRF k=60) + Calibrated Relevance
      const candidateIndices = new Set([...bm25RankMap.keys(), ...vecRankMap.keys()]);
      if (!candidateIndices.size) return [];

      const merged = [];
      for (const idx of candidateIndices) {
        const item = cachedItems[idx];
        const bm25 = bm25RankMap.get(idx);
        const vec = vecRankMap.get(idx);
        const rrf = (bm25 ? 1 / (60 + bm25.rank + 1) : 0) + (vec ? 0.85 / (60 + vec.rank + 1) : 0);
        const relevance = (bm25 ? bm25.score : 0) + (vec ? vec.sim * 1.4 : 0) + rrf * 6;
        merged.push({
          id: item.id,
          documentId: item.documentId,
          name: item.name,
          index: item.index,
          content: item.content,
          relevance,
        });
      }

      return merged
        .sort((a, b) => b.relevance - a.relevance)
        .slice(0, limit)
        .map(({ relevance, ...row }) => ({ ...row, score: Number(relevance.toFixed(4)) }));
    },
    stats() {
      ensureIndex();
      return {
        chunkCount: cachedItems.length,
        vectorCount: cachedItems.filter(item => item.vector?.length === LOCAL_EMBEDDING_DIM).length,
        dimension: LOCAL_EMBEDDING_DIM,
        model: LOCAL_EMBEDDING_MODEL,
        vocabularySize: cachedPostings.size,
        ftsEnabled: true,
      };
    },
  };
}
