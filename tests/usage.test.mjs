import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../lib/store.mjs';
import { startServer } from '../server.mjs';
import {
  extractTokenUsage,
  estimateCallUsage,
  mergeTokenUsage,
  computeCacheHitRate,
  recordTokenUsage,
  queryUsageAnalytics,
  clearTokenUsage
} from '../lib/usage.mjs';

test('extractTokenUsage normalizes OpenAI, DeepSeek, and Anthropic usage payloads', () => {
  const openai = extractTokenUsage({
    usage: {
      prompt_tokens: 1000,
      completion_tokens: 250,
      total_tokens: 1250,
      prompt_tokens_details: { cached_tokens: 800 },
      completion_tokens_details: { reasoning_tokens: 90 }
    }
  });
  assert.deepEqual(openai, {
    promptTokens: 1000,
    cachedPromptTokens: 800,
    cacheWriteTokens: 0,
    completionTokens: 250,
    reasoningTokens: 90,
    totalTokens: 1250,
    source: 'provider'
  });

  const deepseek = extractTokenUsage({
    usage: {
      prompt_tokens: 500,
      completion_tokens: 100,
      prompt_cache_hit_tokens: 450
    }
  });
  assert.equal(deepseek.cachedPromptTokens, 450);
  assert.equal(deepseek.totalTokens, 600);
  assert.equal(computeCacheHitRate(deepseek.cachedPromptTokens, deepseek.promptTokens), 90);

  const anthropic = extractTokenUsage({
    usage: {
      input_tokens: 2000,
      output_tokens: 300,
      cache_read_input_tokens: 1822,
      cache_creation_input_tokens: 178
    }
  });
  assert.equal(anthropic.cachedPromptTokens, 1822);
  assert.equal(anthropic.cacheWriteTokens, 178);
  assert.equal(computeCacheHitRate(anthropic.cachedPromptTokens, anthropic.promptTokens), 91.1);

  assert.equal(extractTokenUsage({}), null);
});

test('estimateCallUsage estimates tokens without fabricating cache hits', () => {
  const est = estimateCallUsage(
    [{ role: 'user', content: '请帮我统计这组数据' }],
    '统计结果合计 1200。',
    '先调用工具。'
  );
  assert.equal(est.source, 'estimated');
  assert.equal(est.cachedPromptTokens, 0);
  assert.ok(est.promptTokens > 0);
  assert.ok(est.completionTokens > 0);
  assert.equal(est.totalTokens, est.promptTokens + est.completionTokens);
});

test('mergeTokenUsage sums multi-step usage and computeCacheHitRate handles edge cases', () => {
  const m = mergeTokenUsage(
    { promptTokens: 1000, cachedPromptTokens: 800, cacheWriteTokens: 0, completionTokens: 100, reasoningTokens: 20, totalTokens: 1100, source: 'provider' },
    { promptTokens: 1000, cachedPromptTokens: 900, cacheWriteTokens: 50, completionTokens: 200, reasoningTokens: 40, totalTokens: 1200, source: 'provider' }
  );
  assert.equal(m.promptTokens, 2000);
  assert.equal(m.cachedPromptTokens, 1700);
  assert.equal(m.cacheWriteTokens, 50);
  assert.equal(m.completionTokens, 300);
  assert.equal(m.reasoningTokens, 60);
  assert.equal(m.totalTokens, 2300);
  assert.equal(m.source, 'provider');
  assert.equal(computeCacheHitRate(m.cachedPromptTokens, m.promptTokens), 85);
  assert.equal(computeCacheHitRate(0, 0), 0);
});

test('SQLite v5 token_usage_logs records, aggregates analytics by model/day/conversation, and clears cleanly', () => {
  const store = createStore(':memory:');
  try {
    assert.ok(store.schemaVersion() >= 5);
    const today = new Date().toISOString();
    recordTokenUsage(store.db, {
      conversationId: 'conv-1', personaId: 'p1', model: 'gemini-flash', kind: 'chat',
      promptTokens: 10000, cachedPromptTokens: 9000, completionTokens: 500, reasoningTokens: 100, totalTokens: 10500,
      source: 'provider', durationMs: 800, createdAt: today
    });
    recordTokenUsage(store.db, {
      conversationId: 'conv-2', personaId: 'p1', model: 'deepseek-chat', kind: 'critic',
      promptTokens: 2000, cachedPromptTokens: 1000, completionTokens: 200, reasoningTokens: 0, totalTokens: 2200,
      source: 'provider', durationMs: 400, createdAt: today
    });

    const analytics = queryUsageAnalytics(store.db, { range: '7d' });
    assert.equal(analytics.summary.totalTokens, 12700);
    assert.equal(analytics.summary.promptTokens, 12000);
    assert.equal(analytics.summary.cachedPromptTokens, 10000);
    assert.equal(analytics.summary.uncachedPromptTokens, 2000);
    assert.equal(analytics.summary.completionTokens, 700);
    assert.equal(analytics.summary.cacheHitRate, 83.3);
    assert.equal(analytics.summary.requestCount, 2);
    assert.equal(analytics.summary.conversationCount, 2);
    assert.equal(analytics.byModel.length, 2);
    assert.equal(analytics.byModel[0].model, 'gemini-flash');
    assert.equal(analytics.daily.length, 1);
    assert.equal(analytics.byKind.length, 2);

    const convOnly = queryUsageAnalytics(store.db, { range: '7d', conversationId: 'conv-1' });
    assert.equal(convOnly.summary.totalTokens, 10500);
    assert.equal(convOnly.summary.cacheHitRate, 90);

    const cleared = clearTokenUsage(store.db);
    assert.equal(cleared.cleared, 2);
    assert.equal(queryUsageAnalytics(store.db, { range: 'all' }).summary.totalTokens, 0);
  } finally {
    store.close();
  }
});

test('HTTP GET /api/usage and DELETE /api/usage expose live turn telemetry', async () => {
  const mockFetch = async () => new Response(JSON.stringify({
    choices: [{ message: { role: 'assistant', content: '测试回复完成。' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1000, completion_tokens: 100, total_tokens: 1100, prompt_tokens_details: { cached_tokens: 800 } }
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  const app = await startServer({ port: 0, dbPath: ':memory:', scheduler: false, modelOptions: { fetchImpl: mockFetch, apiKey: 'k' } });
  try {
    await fetch(`${app.url}/api/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Origin: app.url },
      body: JSON.stringify({ baseUrl: 'http://127.0.0.1:9999/v1', model: 'test-model', criticEnabled: false })
    });
    const boot = await (await fetch(`${app.url}/api/bootstrap`)).json();
    const conv = await (await fetch(`${app.url}/api/conversations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: app.url },
      body: JSON.stringify({ personaId: boot.personas[0].id })
    })).json();
    await fetch(`${app.url}/api/conversations/${conv.conversation.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: app.url },
      body: JSON.stringify({ content: '你好，帮我测一下用量统计' })
    });

    const usageRes = await fetch(`${app.url}/api/usage?range=7d`);
    assert.equal(usageRes.status, 200);
    const data = await usageRes.json();
    assert.equal(data.summary.totalTokens, 1100);
    assert.equal(data.summary.cachedPromptTokens, 800);
    assert.equal(data.summary.cacheHitRate, 80);

    const delRes = await fetch(`${app.url}/api/usage`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Origin: app.url },
      body: '{}'
    });
    assert.equal(delRes.status, 200);
    const after = await (await fetch(`${app.url}/api/usage?range=7d`)).json();
    assert.equal(after.summary.totalTokens, 0);
  } finally {
    await app.close();
  }
});
