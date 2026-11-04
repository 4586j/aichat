import test from 'node:test';
import assert from 'node:assert/strict';
import { createIntentCritic } from '../lib/intent-critic.mjs';

test('createIntentCritic requires valid model instance', () => {
  assert.throws(() => createIntentCritic({}), /IntentCritic 需要注入有效的 model/);
});

test('auditCandidate passes when critic model evaluates candidate as compliant', async () => {
  const mockModel = {
    complete: async (messages) => {
      return JSON.stringify({
        passed: true,
        score: 95,
        missingPoints: [],
        factCheck: 'consistent',
        feedbackToAgent: ''
      });
    }
  };

  const critic = createIntentCritic({ model: mockModel });
  const result = await critic.auditCandidate({
    prompt: '帮我计算 (345 * 28) + (1024 / 16) 是多少？',
    toolsExecuted: [{ name: 'calculator', args: { expression: '(345 * 28) + (1024 / 16)' }, result: { result: 9724 } }],
    candidateContent: '经过计算，(345 * 28) + (1024 / 16) 的准确结果为 9724。'
  });

  assert.equal(result.passed, true);
  assert.equal(result.score, 95);
  assert.equal(result.factCheck, 'consistent');
  assert.deepEqual(result.missingPoints, []);
  assert.equal(result.feedbackToAgent, '');
});

test('auditCandidate fails when critic model identifies missing requirements or fact error', async () => {
  const mockModel = {
    complete: async (messages) => {
      return JSON.stringify({
        passed: false,
        score: 45,
        missingPoints: ['未查询知识库关于架构规范的说明'],
        factCheck: 'consistent',
        feedbackToAgent: '请调用知识库检索工具，补充安全规范相关条款。'
      });
    }
  };

  const critic = createIntentCritic({ model: mockModel });
  const result = await critic.auditCandidate({
    prompt: '帮我计算 1+1 并查询知识库架构规范',
    toolsExecuted: [{ name: 'calculator', args: { expression: '1+1' }, result: { result: 2 } }],
    candidateContent: '1+1 等于 2。'
  });

  assert.equal(result.passed, false);
  assert.equal(result.score, 45);
  assert.ok(result.missingPoints.includes('未查询知识库关于架构规范的说明'));
  assert.ok(result.feedbackToAgent.includes('补充安全规范'));
});

test('auditCandidate safely fails-open on unparseable JSON or model exception', async () => {
  const faultyModel = {
    complete: async () => 'Not a valid JSON format from upstream'
  };

  const critic = createIntentCritic({ model: faultyModel });
  const result = await critic.auditCandidate({
    prompt: '你好',
    candidateContent: '你好呀！有什么我可以帮你的？'
  });

  assert.equal(result.passed, true);
  assert.equal(result.score, 80);
});

test('auditCandidate propagates abort signal immediately', async () => {
  const controller = new AbortController();
  controller.abort();

  const critic = createIntentCritic({ model: { complete: async () => '{}' } });
  await assert.rejects(
    critic.auditCandidate({ prompt: 'test', candidateContent: 'test', signal: controller.signal }),
    /本次回复已取消|审核已取消/
  );
});
