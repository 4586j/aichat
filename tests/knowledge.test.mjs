import test from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, rankText, chunkText, extractHeadingPaths, MAX_FILE_BYTES, MAX_TEXT_LENGTH } from '../lib/knowledge.mjs';
import { LOCAL_EMBEDDING_DIM, computeLocalEmbedding, cosineSimilarity, vectorToBlob, blobToVector } from '../lib/vector.mjs';
import { fixture, base64, errorStatus } from './helpers.mjs';
import { tinyDocx, tinyPdf } from './knowledge-fixtures.mjs';

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

test('vector embeddings are unit-normalized Float32Arrays, round-trip through SQLite BLOBs and cascade on delete', async t => {
  const { api, store } = fixture(t);
  const v1 = computeLocalEmbedding('凌晨容器触发快照归档并回收僵尸句柄');
  const v2 = computeLocalEmbedding('半夜服务器清理内存与垃圾回收');
  const vUnrelated = computeLocalEmbedding('足球场上的体育训练计划');
  assert.equal(v1.length, LOCAL_EMBEDDING_DIM);
  const norm = Math.sqrt(v1.reduce((sum, x) => sum + x * x, 0));
  assert.ok(Math.abs(norm - 1) < 1e-5, 'normalized vector must lie on the unit hypersphere');
  const restored = blobToVector(vectorToBlob(v1));
  assert.deepEqual(Array.from(restored), Array.from(v1));
  assert.ok(cosineSimilarity(v1, v2) > 0.5, 'semantically aligned concepts must have high cosine similarity');
  assert.ok(Math.abs(cosineSimilarity(v1, vUnrelated)) < 0.1, 'orthogonal domains must have near-zero similarity');

  const { document } = await api.importDocument({ name: 'ops.md', data: base64('# 运维指南\n## 内存治理\n容器在每日 03:00 触发快照归档并回收僵尸句柄。') });
  const vecRow = store.get('SELECT * FROM chunk_vectors WHERE chunkId = (SELECT id FROM chunks WHERE documentId=?)', document.id);
  assert.ok(vecRow);
  assert.equal(vecRow.dim, LOCAL_EMBEDDING_DIM);
  assert.equal(vecRow.headingPath, '运维指南 > 内存治理');
  assert.equal(api.knowledge.stats().vectorCount, 1);

  api.deleteDocument(document.id);
  assert.equal(store.get('SELECT COUNT(*) AS n FROM chunk_vectors').n, 0);
  assert.equal(api.knowledge.stats().chunkCount, 0);
});

test('hybrid vector + BM25 search bridges the lexical gap when BM25 has zero token overlap', async t => {
  const { api } = fixture(t);
  const opsDoc = await api.importDocument({
    name: 'ops-manual.txt',
    data: base64('容器在每日 03:00 触发快照归档并回收僵尸句柄。'),
  });
  const rocketDoc = await api.importDocument({
    name: 'space.txt',
    data: base64('Deploy the satellite with a reusable rocket.'),
  });
  await api.importDocument({
    name: 'sports.txt',
    data: base64('周末在球场进行篮球比赛。'),
  });

  // Pure BM25 has 0 overlapping Chinese bigrams between query and opsDoc
  assert.equal(rankText('为什么半夜系统会卡顿并清理内存', [{ content: '容器在每日 03:00 触发快照归档并回收僵尸句柄。' }]).length, 0);

  // Hybrid search recalls opsDoc via dense semantic vector similarity
  const semanticHits = api.searchKnowledge({ query: '为什么半夜系统会卡顿并清理内存' }).sources;
  assert.ok(semanticHits.length >= 1);
  assert.equal(semanticHits[0].documentId, opsDoc.document.id);

  // Morphological stem & aerospace concept matching ("deployment" / "spacecraft launch into orbit")
  const stemHits = api.searchKnowledge({ query: 'spacecraft deployment into orbit' }).sources;
  assert.ok(stemHits.length >= 1);
  assert.equal(stemHits[0].documentId, rocketDoc.document.id);
});

test('hierarchical Markdown heading paths preserve parent section context across chunks', async t => {
  const { api } = fixture(t);
  const chunk1 = `# 网易云音乐模块\n## 简介\n${'音乐服务基础说明。'.repeat(120)}`;
  const chunk2 = `## 常见故障\n### 连接超时排查\n请检查本地 3000 端口是否启动。`;
  const paths = extractHeadingPaths([chunk1, chunk2]);
  assert.equal(paths[0], '网易云音乐模块 > 简介');
  assert.equal(paths[1], '网易云音乐模块 > 常见故障 > 连接超时排查');

  const { document } = await api.importDocument({
    name: 'manual.md',
    data: base64(`${chunk1}\n${chunk2}`),
  });
  const hits = api.searchKnowledge({ query: '网易云音乐 3000 端口' }).sources;
  assert.ok(hits.length >= 1);
  assert.equal(hits[0].documentId, document.id);
  assert.equal(hits[0].index, 2);
});

