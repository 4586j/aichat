import test from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, rankText, chunkText, MAX_FILE_BYTES, MAX_TEXT_LENGTH } from '../lib/knowledge.mjs';
import { fixture, base64, errorStatus } from './helpers.mjs';

test('tokenization normalizes English and full-width input, and indexes Chinese bigrams', () => {
  assert.deepEqual(tokenize('HELLO ＷＯＲＬＤ 42'), ['hello', 'world', '42']);
  assert.deepEqual(tokenize('茉莉花茶'), ['茉莉', '莉花', '花茶']);
  assert.deepEqual(tokenize('茶'), ['茶']);
  assert.deepEqual(tokenize('! ? a'), []);
});

test('ranking returns matching rows in descending relevance without mutating input', () => {
  const rows = [{ id: 'both', content: 'jasmine tea' }, { id: 'one', content: 'jasmine flowers grow in the garden' }, { id: 'none', content: 'football' }];
  const before = structuredClone(rows);
  const result = rankText('JASMINE tea', rows);
  assert.deepEqual(result.map(row => row.id), ['both', 'one']);
  assert.ok(result[0].relevance > result[1].relevance);
  assert.deepEqual(rankText('unmatched', rows), []);
  assert.deepEqual(rankText('!?', rows), []);
  assert.deepEqual(rankText('jasmine', []), []);
  assert.deepEqual(rows, before);
  assert.equal(rankText('茶叶', [{ text: '茶叶种类' }], 'text').length, 1);
});

test('chunking cleans NUL/CRLF, preserves overlap and covers the final character', () => {
  assert.deepEqual(chunkText(' \0Hello\r\nworld\0 '), ['Hello\nworld']);
  assert.deepEqual(chunkText(' \n\0 '), []);
  const text = Array.from({ length: 2300 }, (_, i) => String.fromCharCode(65 + i % 26)).join('');
  const chunks = chunkText(text);
  assert.equal(chunks.length, 3);
  assert.equal(chunks[0].length, 1000);
  assert.equal(chunks[0].slice(-140), chunks[1].slice(0, 140));
  assert.equal(chunks[1].slice(-140), chunks[2].slice(0, 140));
  assert.equal(chunks[0] + chunks.slice(1).map(chunk => chunk.slice(140)).join(''), text);
  const sentence = `${'x'.repeat(700)}。${'y'.repeat(900)}`;
  assert.ok(chunkText(sentence)[0].endsWith('。'));
});

test('UTF-8 Chinese/English imports are retrievable, named safely and isolated from unrelated docs', async t => {
  const { api, store, calls } = fixture(t);
  const chinese = await api.importDocument({ name: '../../茶叶.TXT', data: base64('\uFEFF茉莉花茶带有花香。\r\n适合午后饮用。') });
  const english = await api.importDocument({ name: 'C:\\private\\guide.md', data: base64('Deploy the satellite with a reusable rocket.') });
  await api.importDocument({ name: 'data.json', data: base64('{"topic":"mountain hiking"}') });
  assert.equal(chinese.document.name, '茶叶.TXT');
  assert.equal(chinese.document.format, 'txt');
  assert.equal(english.document.name, 'guide.md');
  const zh = api.searchKnowledge({ query: '茉莉花茶' }).sources;
  assert.equal(zh.length, 1);
  assert.equal(zh[0].documentId, chinese.document.id);
  assert.match(zh[0].content, /花香/);
  assert.equal(zh[0].index, 1);
  assert.ok(zh[0].score > 0);
  const en = api.searchKnowledge({ query: 'SATELLITE rocket' }).sources;
  assert.equal(en[0].documentId, english.document.id);
  assert.deepEqual(api.searchKnowledge({ query: 'unmatchedword' }), { sources: [] });
  assert.equal(store.get('SELECT COUNT(*) AS n FROM documents').n, 3);
  assert.equal(calls.length, 0);
});

test('document chunk metadata is complete, results are capped and deletion cascades', async t => {
  const { api, store } = fixture(t);
  const content = 'jasmine 茶叶 notes。\n'.repeat(500);
  const { document } = await api.importDocument({ name: 'many.txt', data: base64(content) });
  const chunks = store.all('SELECT * FROM chunks WHERE documentId=? ORDER BY chunkIndex', document.id);
  assert.equal(chunks.length, document.chunkCount);
  assert.ok(chunks.length > 6);
  assert.equal(document.charCount, content.trim().length);
  assert.deepEqual(chunks.map(row => row.chunkIndex), Array.from({ length: chunks.length }, (_, i) => i + 1));
  assert.equal(api.searchKnowledge({ query: 'jasmine' }).sources.length, 6);
  assert.equal(api.knowledge.search('jasmine', 2).length, 2);
  const retained = await api.importDocument({ name: 'keep.txt', data: base64('unrelated hiking') });
  assert.deepEqual(api.deleteDocument(document.id), { ok: true });
  assert.equal(store.get('SELECT COUNT(*) AS n FROM chunks WHERE documentId=?', document.id).n, 0);
  assert.equal(store.get('SELECT COUNT(*) AS n FROM documents').n, 1);
  assert.ok(store.get('SELECT * FROM documents WHERE id=?', retained.document.id));
  assert.deepEqual(api.searchKnowledge({ query: 'jasmine' }), { sources: [] });
  assert.throws(() => api.deleteDocument(document.id), errorStatus(404));
});

const invalidUploads = [
  ['unsupported executable', { name: 'unsafe.exe', data: base64('text') }],
  ['unsupported image', { name: 'scan.png', data: base64('text') }],
  ['missing name', { data: base64('text') }],
  ['blank name', { name: ' ', data: base64('text') }],
  ['overlong name', { name: `${'x'.repeat(200)}.txt`, data: base64('text') }],
  ['empty payload', { name: 'file.txt', data: '' }],
  ['non-string payload', { name: 'file.txt', data: [] }],
  ['invalid base64 characters', { name: 'file.txt', data: '%%%%' }],
  ['noncanonical base64 padding bits', { name: 'file.txt', data: 'Zh==' }],
  ['bad base64 length', { name: 'file.txt', data: 'YQ=' }],
  ['data URL instead of base64', { name: 'file.txt', data: 'data:text/plain;base64,YQ==' }],
  ['invalid UTF-8', { name: 'file.txt', data: base64(Buffer.from([0xc3, 0x28])) }],
  ['UTF-16 data', { name: 'file.txt', data: base64(Buffer.from([0xff, 0xfe, 0x41, 0])) }],
  ['only whitespace and NUL', { name: 'file.txt', data: base64(' \r\n\0') }],
];
for (const [name, input] of invalidUploads) {
  test(`upload rejects ${name} with no partial document or chunks`, async t => {
    const { api, store } = fixture(t);
    await assert.rejects(api.importDocument(input), errorStatus(400));
    assert.equal(store.get('SELECT COUNT(*) AS n FROM documents').n, 0);
    assert.equal(store.get('SELECT COUNT(*) AS n FROM chunks').n, 0);
  });
}

test('upload enforces decoded byte and extracted character limits', async t => {
  const { api, store } = fixture(t);
  // MAX+1 has the same encoded length ceiling: exercises decoded-byte validation.
  await assert.rejects(api.importDocument({ name: 'large.txt', data: base64(Buffer.alloc(MAX_FILE_BYTES + 1, 65)) }), errorStatus(400, /8 MiB/));
  await assert.rejects(api.importDocument({ name: 'long.txt', data: base64('x'.repeat(MAX_TEXT_LENGTH + 1)) }), errorStatus(400, /30 万/));
  assert.equal(store.get('SELECT COUNT(*) AS n FROM documents').n, 0);
  const { document } = await api.importDocument({ name: 'limit.txt', data: base64('x'.repeat(MAX_TEXT_LENGTH)) });
  assert.equal(document.charCount, MAX_TEXT_LENGTH);
});

// Tiny valid binary fixtures are generated in memory, using no ZIP/PDF dependency.
function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function storedZip(files) {
  const local = [], central = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const filename = Buffer.from(name), data = Buffer.from(text), crc = crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4);
    header.writeUInt32LE(crc, 14); header.writeUInt32LE(data.length, 18); header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(filename.length, 26);
    local.push(header, filename, data);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6);
    entry.writeUInt32LE(crc, 16); entry.writeUInt32LE(data.length, 20); entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(filename.length, 28); entry.writeUInt32LE(offset, 42);
    central.push(entry, filename);
    offset += header.length + filename.length + data.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

function tinyDocx() {
  return storedZip({
    '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml': '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Jasmine 茉莉花茶 DOCX fixture</w:t></w:r></w:p></w:body></w:document>',
  });
}

function tinyPdf() {
  const stream = 'BT /F1 12 Tf 40 120 Td (Jasmine tea PDF fixture) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let source = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(source)); source += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(source);
  source += `xref\n0 6\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`;
  source += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(source);
}

for (const [format, makeFixture, query] of [['docx', tinyDocx, '茉莉花茶'], ['pdf', tinyPdf, 'jasmine']]) {
  test(`tiny literal ${format.toUpperCase()} imports and retrieves actual extracted text`, { timeout: 30000 }, async t => {
    const { api } = fixture(t);
    const { document } = await api.importDocument({ name: `fixture.${format}`, data: base64(makeFixture()) });
    assert.equal(document.format, format);
    assert.ok(document.charCount > 0);
    const result = api.searchKnowledge({ query }).sources;
    assert.equal(result[0].documentId, document.id);
    assert.match(result[0].content, /fixture/);
  });
  test(`corrupt ${format.toUpperCase()} fails cleanly without database changes`, { timeout: 30000 }, async t => {
    const { api, store } = fixture(t);
    await assert.rejects(api.importDocument({ name: `broken.${format}`, data: base64('not a valid binary document') }), errorStatus(422));
    assert.equal(store.get('SELECT COUNT(*) AS n FROM documents').n, 0);
    assert.equal(store.get('SELECT COUNT(*) AS n FROM chunks').n, 0);
  });
}

test('DOCX advertised decompression size and encryption are rejected before extraction', async t => {
  const { api } = fixture(t);
  const original = tinyDocx();
  const central = original.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  for (const variant of ['oversize', 'encrypted', 'zero-entry-count', 'lying-size', 'directory-size']) {
    const data = Buffer.from(original);
    if (variant === 'oversize') data.writeUInt32LE(17 * 1024 * 1024, central + 24);
    else if (variant === 'encrypted') data.writeUInt16LE(1, central + 8);
    else if (variant === 'zero-entry-count') { data.writeUInt16LE(0, data.length - 14); data.writeUInt16LE(0, data.length - 12); }
    else if (variant === 'lying-size') data.writeUInt32LE(1, central + 24);
    else data.writeUInt32LE(1, data.length - 10);
    await assert.rejects(api.importDocument({ name: 'unsafe.docx', data: base64(data) }), errorStatus(422, /DOCX/));
  }
});
