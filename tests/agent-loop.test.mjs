import test from 'node:test';
import assert from 'node:assert/strict';
import { runAgentLoop } from '../lib/agent-loop.mjs';
import { createInstructionInspector } from '../lib/instruction-inspector.mjs';

function createMockModel(responses) {
  let callIndex = 0;
  return {
    async complete(messages, options) {
      const resp = responses[callIndex++] || { content: '默认回答', reasoning: '' };
      return resp;
    },
    async stream(messages, options) {
      const resp = responses[callIndex++] || { content: '流式默认回答', reasoning: '' };
      if (options.onDelta && resp.content) {
        await options.onDelta({ type: 'content', delta: resp.content });
      }
      return resp;
    }
  };
}

test('runAgentLoop: maxSteps=0 directly generates final response without tool execution', async () => {
  let toolCalled = false;
  const model = createMockModel([{ content: '直接回答结果', reasoning: '直接思考' }]);
  const result = await runAgentLoop({
    model,
    messages: [{ role: 'user', content: '测试' }],
    tools: [{ type: 'function', function: { name: 'calculator', parameters: {} } }],
    toolExecutor: async () => { toolCalled = true; },
    maxSteps: 0
  });

  assert.equal(result.content, '直接回答结果');
  assert.equal(toolCalled, false);
  assert.equal(result.totalSteps, 0);
  assert.equal(result.steps.length, 0);
});

test('runAgentLoop: multi-step tool execution terminates cleanly upon final answer', async () => {
  const model = createMockModel([
    // Step 1: Model calls calculator
    {
      content: '需要计算 12 + 34',
      reasoning: '第1步分析',
      toolCalls: [{ id: 'call_1', type: 'function', function: { name: 'calculator', arguments: '{"expr":"12+34"}' } }]
    },
    // Step 2: Model receives observation 46 and outputs final content
    {
      content: '计算结果是 46。',
      reasoning: '完成计算',
      toolCalls: []
    }
  ]);

  const toolExecutions = [];
  const result = await runAgentLoop({
    model,
    messages: [{ role: 'user', content: '请帮我计算 12+34' }],
    tools: [{ type: 'function', function: { name: 'calculator', parameters: {} } }],
    toolExecutor: async (name, args) => {
      toolExecutions.push({ name, args });
      return { result: 46 };
    },
    maxSteps: 10
  });

  assert.equal(toolExecutions.length, 1);
  assert.equal(toolExecutions[0].name, 'calculator');
  assert.deepEqual(toolExecutions[0].args, { expr: '12+34' });
  assert.equal(result.content, '计算结果是 46。');
  assert.equal(result.steps.length, 1);
  assert.equal(result.steps[0].status, 'success');
});

test('runAgentLoop: 5-time duplicate call breaker trips and stops loop', async () => {
  // Model returns 5 duplicate tool calls, then 1 final response
  const duplicateResponses = [];
  for (let i = 0; i < 5; i++) {
    duplicateResponses.push({
      content: `重复调用第 ${i + 1} 次`,
      toolCalls: [{ id: `call_${i}`, type: 'function', function: { name: 'same_tool', arguments: '{"q":"loop"}' } }]
    });
  }
  // Final forced response
  duplicateResponses.push({ content: '因死循环已强行给出当前回答', reasoning: '' });

  const model = createMockModel(duplicateResponses);
  let executeCount = 0;

  const result = await runAgentLoop({
    model,
    messages: [{ role: 'user', content: '死循环测试' }],
    tools: [{ type: 'function', function: { name: 'same_tool', parameters: {} } }],
    toolExecutor: async () => { executeCount++; return { ok: true }; },
    maxSteps: 20,
    duplicateThreshold: 5
  });

  // Exactly 4 executions allowed, 5th duplicate call triggers breaker
  assert.equal(executeCount, 4);
  const brokenStep = result.steps.find(s => s.status === 'circuit_broken');
  assert.ok(brokenStep, 'Should find circuit_broken step');
  assert.ok(brokenStep.warning.includes('连续重复调用 5 次相同参数'));
  assert.equal(result.content, '因死循环已强行给出当前回答');
});

test('runAgentLoop: 5-time consecutive failure breaker stops tool loop', async () => {
  // 5 failing calls, then 1 final response
  const failureResponses = [];
  for (let i = 0; i < 5; i++) {
    failureResponses.push({
      content: `报错尝试第 ${i + 1} 次`,
      toolCalls: [{ id: `call_err_${i}`, type: 'function', function: { name: 'failing_tool', arguments: `{"try":${i}}` } }]
    });
  }
  failureResponses.push({ content: '因连续5次失败已向用户说明困难并结束', reasoning: '' });

  const model = createMockModel(failureResponses);
  let attemptCount = 0;

  const result = await runAgentLoop({
    model,
    messages: [{ role: 'user', content: '故障测试' }],
    tools: [{ type: 'function', function: { name: 'failing_tool', parameters: {} } }],
    toolExecutor: async () => {
      attemptCount++;
      throw new Error(`连接超时第 ${attemptCount} 次`);
    },
    maxSteps: 20,
    failureThreshold: 5
  });

  assert.equal(attemptCount, 5);
  assert.equal(result.steps.length, 5);
  assert.ok(result.steps.every(s => s.status === 'error'));
  assert.equal(result.content, '因连续5次失败已向用户说明困难并结束');
});

test('runAgentLoop: instruction inspector prompts for approval and handles rejection', async () => {
  const inspector = createInstructionInspector();
  const model = createMockModel([
    // Step 1: Model tries to call sensitive delete_document
    {
      content: '需要清理文档 doc-1',
      toolCalls: [{ id: 'call_del', type: 'function', function: { name: 'delete_document', arguments: '{"id":"doc-1"}' } }]
    },
    // Step 2: Model receives rejection observation and yields safe alternative
    {
      content: '收到，您已拒绝删除文档，已保留原文件。',
      toolCalls: []
    }
  ]);

  let toolExecuted = false;
  let approvalPromptReceived = false;

  const result = await runAgentLoop({
    model,
    messages: [{ role: 'user', content: '删除旧文档' }],
    tools: [{ type: 'function', function: { name: 'delete_document', parameters: {} } }],
    toolExecutor: async () => { toolExecuted = true; },
    inspector,
    securityLevel: 'standard',
    maxSteps: 5,
    onApprovalRequest: async (ticket) => {
      approvalPromptReceived = true;
      assert.equal(ticket.toolCall.name, 'delete_document');
      assert.equal(ticket.riskLevel, 'critical');
      // User denies
      return false;
    }
  });

  assert.equal(approvalPromptReceived, true);
  assert.equal(toolExecuted, false, 'Sensitive tool must NOT execute when user rejects');
  assert.ok(result.steps.some(s => s.status === 'rejected'));
  assert.equal(result.content, '收到，您已拒绝删除文档，已保留原文件。');
});

test('runAgentLoop: instruction inspector allows execution when user approves', async () => {
  const inspector = createInstructionInspector();
  const model = createMockModel([
    // Step 1: Model calls sensitive delete_document
    {
      content: '申请清理文档 doc-1',
      toolCalls: [{ id: 'call_del', type: 'function', function: { name: 'delete_document', arguments: '{"id":"doc-1"}' } }]
    },
    // Step 2: Model finishes
    {
      content: '文档 doc-1 已成功删除。',
      toolCalls: []
    }
  ]);

  let toolExecuted = false;
  const result = await runAgentLoop({
    model,
    messages: [{ role: 'user', content: '确认删除文档' }],
    tools: [{ type: 'function', function: { name: 'delete_document', parameters: {} } }],
    toolExecutor: async () => { toolExecuted = true; return { deleted: true }; },
    inspector,
    securityLevel: 'standard',
    maxSteps: 5,
    onApprovalRequest: async (ticket) => {
      inspector.decide(ticket.id, { approved: true });
      return true;
    }
  });

  assert.equal(toolExecuted, true);
  assert.equal(result.content, '文档 doc-1 已成功删除。');
});
