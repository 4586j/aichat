import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdirSync, writeFileSync } from 'node:fs';
import { completedParagraphs, parseSemanticOutput } from '../lib/semantic-output.mjs';

const invalid = () => new Error('invalid structured paragraph');
function paragraph(value, count) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'sourceIds,text' || typeof value.text !== 'string' || !value.text.trim() || value.text.length > 12000 || !Array.isArray(value.sourceIds) || value.sourceIds.length > 8 || value.sourceIds.some(n => !Number.isSafeInteger(n) || n < 1 || n > count)) throw invalid();
  return value.text.trim() + [...new Set(value.sourceIds)].map(n => ` [${n}]`).join('');
}

// Test-only implementation copied from the reviewed Model B proposal.
function streamingParagraphs(raw, sourceCount) {
  const start = /^\s*\{\s*"paragraphs"\s*:\s*\[/u.exec(raw);
  if (!start) return [];
  const output = [];
  let i = start[0].length;
  while (i < raw.length) {
    while (i < raw.length && /[\s,]/u.test(raw[i])) i++;
    if (raw[i] !== '{') break;
    const begin = i;
    let depth = 0, quoted = false, escaped = false, done = false;
    for (; i < raw.length; i++) {
      const c = raw[i];
      if (quoted) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') quoted = false; }
      else if (c === '"') quoted = true;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) { i++; done = true; break; }
    }
    if (done) {
      let item;
      try { item = JSON.parse(raw.slice(begin, i)); } catch { break; }
      output.push(paragraph(item, sourceCount));
      if (output.length > 20) throw invalid();
    } else {
      const partial = raw.slice(begin);
      const textMatch = /"text"\s*:\s*"/u.exec(partial);
      if (textMatch) {
        let preview = '', p = textMatch.index + textMatch[0].length;
        while (p < partial.length) {
          const ch = partial[p];
          if (ch === '"') break;
          if (ch === '\\') {
            if (p + 1 >= partial.length) break;
            const esc = partial[p + 1];
            if (esc === 'u') {
              if (p + 6 > partial.length) break;
              const code = Number.parseInt(partial.slice(p + 2, p + 6), 16);
              if (Number.isFinite(code)) preview += String.fromCharCode(code);
              p += 6; continue;
            }
            preview += ({ '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' }[esc] ?? esc);
            p += 2; continue;
          }
          preview += ch; p++;
        }
        if (preview.trim()) output.push(preview);
      }
      break;
    }
  }
  return output;
}

async function measure(parser, chunks) {
  const started = performance.now();
  const updates = [];
  let raw = '', visible = '';
  for (const chunk of chunks) {
    if (chunk.delay) await delay(chunk.delay);
    raw += chunk.value;
    const next = parser(raw, 1).join('\n\n');
    if (next !== visible) {
      updates.push({ atMs: performance.now() - started, chars: next.length - visible.length });
      visible = next;
    }
  }
  const finalContent = parseSemanticOutput(raw, {}, 1).content;
  if (finalContent !== visible) updates.push({ atMs: performance.now() - started, chars: finalContent.length - visible.length });
  const intervals = updates.slice(1).map((item, index) => item.atMs - updates[index].atMs);
  const mean = intervals.length ? intervals.reduce((sum, value) => sum + value, 0) / intervals.length : null;
  return {
    firstTextMs: updates[0]?.atMs ?? null,
    updateCount: updates.length,
    frameIntervalStdDevMs: mean === null ? null : Math.sqrt(intervals.reduce((sum, value) => sum + (value - mean) ** 2, 0) / intervals.length),
    finalContent,
  };
}

test('third-party streaming A/B keeps citations while reducing time to first visible text', async () => {
  const text = Array.from({ length: 200 }, (_, index) => `暖${index % 10}`).join('').slice(0, 200);
  const chunks = [
    { value: '{"paragraphs":[{"text":"' },
    ...Array.from(text, value => ({ value, delay: 40 })),
    { value: '","sourceIds":[1]}],"sticker":{"decision":"none","candidate":null},"state":null}' },
  ];
  const [baseline, proposed] = await Promise.all([
    measure(completedParagraphs, chunks),
    measure(streamingParagraphs, chunks),
  ]);
  const reductionPercent = (baseline.firstTextMs - proposed.firstTextMs) / baseline.firstTextMs * 100;
  assert.equal(proposed.finalContent, baseline.finalContent);
  assert.match(proposed.finalContent, / \[1\]$/u);
  assert.ok(reductionPercent >= 80, `TTFT reduction was only ${reductionPercent}%`);
  assert.ok(proposed.updateCount > 100);
  const report = { generatedAt: new Date().toISOString(), chunkDelayMs: 40, textLength: text.length, baseline, proposed, reductionPercent };
  mkdirSync('test-reports', { recursive: true });
  writeFileSync('test-reports/third-party-streaming-2026-11-01.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
});
