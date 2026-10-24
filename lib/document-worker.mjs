import { parentPort, workerData } from 'node:worker_threads';
import { inflateRawSync } from 'node:zlib';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

function checkZip(buffer) {
  const invalid = () => { throw new Error('DOCX 压缩目录不一致、加密或超出解压限制，请转换为 TXT。'); };
  let eocd = -1;
  for (let p = buffer.length - 22; p >= Math.max(0, buffer.length - 65557); p--) {
    if (buffer.readUInt32LE(p) === 0x06054b50 && p + 22 + buffer.readUInt16LE(p + 20) === buffer.length) { eocd = p; break; }
  }
  if (eocd < 0) invalid();
  const entries = buffer.readUInt16LE(eocd + 10);
  const directoryStart = buffer.readUInt32LE(eocd + 16);
  const directorySize = buffer.readUInt32LE(eocd + 12);
  if (!entries || entries > 3000 || buffer.readUInt16LE(eocd + 8) !== entries || buffer.readUInt32LE(eocd + 4) !== 0 || directoryStart + directorySize !== eocd) invalid();
  let offset = directoryStart;
  let count = 0;
  let total = 0;
  const names = new Set();
  while (offset < eocd) {
    if (offset + 46 > eocd || buffer.readUInt32LE(offset) !== 0x02014b50 || ++count > entries) invalid();
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const size = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const next = offset + 46 + nameLength + buffer.readUInt16LE(offset + 30) + buffer.readUInt16LE(offset + 32);
    const local = buffer.readUInt32LE(offset + 42);
    total += size;
    if ((flags & 1) || ![0, 8].includes(method) || size > 16 * 1024 * 1024 || total > 32 * 1024 * 1024 || next > eocd || local + 30 > directoryStart) invalid();
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength);
    const nameKey = name.toString('hex');
    if (names.has(nameKey)) invalid();
    names.add(nameKey);
    if (buffer.readUInt32LE(local) !== 0x04034b50 || buffer.readUInt16LE(local + 6) !== flags || buffer.readUInt16LE(local + 8) !== method) invalid();
    const localNameLength = buffer.readUInt16LE(local + 26);
    const start = local + 30 + localNameLength + buffer.readUInt16LE(local + 28);
    if (start + compressedSize > directoryStart || localNameLength !== nameLength || !buffer.subarray(local + 30, local + 30 + localNameLength).equals(name)) invalid();
    const compressed = buffer.subarray(start, start + compressedSize);
    let actual;
    try { actual = method === 8 ? inflateRawSync(compressed, { maxOutputLength: 16 * 1024 * 1024 }) : compressed; }
    catch { invalid(); }
    if (actual.length !== size) invalid();
    offset = next;
  }
  if (offset !== eocd || count !== entries) invalid();
}

try {
  const buffer = Buffer.from(workerData.buffer);
  let text;
  if (workerData.format === 'docx') {
    checkZip(buffer);
    const { default: mammoth } = await import('mammoth');
    const result = await mammoth.extractRawText({ buffer });
    text = result.value;
  } else {
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const packageDir = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
    const task = getDocument({
      data: new Uint8Array(buffer), isEvalSupported: false,
      cMapUrl: join(packageDir, 'cmaps') + '/', cMapPacked: true,
      standardFontDataUrl: join(packageDir, 'standard_fonts') + '/',
      wasmUrl: join(packageDir, 'wasm') + '/',
    });
    try {
      const pdf = await task.promise;
      if (pdf.numPages > 200) throw new Error('PDF 超过 200 页，请拆分后导入。');
      const pages = [];
      let total = 0;
      for (let n = 1; n <= pdf.numPages; n++) {
        const page = await pdf.getPage(n);
        try {
          const content = await page.getTextContent();
          const pageText = content.items.filter(item => typeof item.str === 'string').map(item => item.str + (item.hasEOL ? '\n' : ' ')).join('');
          total += pageText.length;
          if (total > 300000) throw new Error('文档提取后超过 30 万字符，请拆分后导入。');
          pages.push(pageText);
        } finally { page.cleanup(); }
      }
      text = pages.join('\n\n');
    } finally { await task.destroy(); }
  }
  parentPort.postMessage({ text });
} catch (error) {
  const known = /DOCX|PDF 超过|30 万字符/.test(error.message);
  parentPort.postMessage({ error: known ? error.message : '无法解析文档，请确认格式正确且未加密；扫描型 PDF 需要先 OCR。' });
}
