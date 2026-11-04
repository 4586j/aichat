import test from 'node:test';
import assert from 'node:assert/strict';
import { runAgentLoop } from '../lib/agent-loop.mjs';
import { createInstructionInspector } from '../lib/instruction-inspector.mjs';
import { fixture, addConversation } from './helpers.mjs';

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

test('runAgentLoop: critic rejection triggers reflective feedback loop and converges upon approval', async () => {
  const model = createMockModel([
    // Step 1: Tool call (calculator)
    {
      content: '先算一下',
      toolCalls: [{ id: 'c1', type: 'function', function: { name: 'calculator', arguments: '{"expr":"2+2"}' } }]
    },
    // Step 2: First candidate answer (imcomplete)
    {
      content: '2+2 等于 4。',
      toolCalls: []
    },
    // Step 3: Revised candidate after receiving critic feedback
    {
      content: '2+2 等于 4。同时已补充满足安全规范说明。',
      toolCalls: []
    }
  ]);

  let criticCalls = 0;
  const mockCritic = {
    auditCandidate: async ({ candidateContent }) => {
      criticCalls++;
      if (criticCalls === 1) {
        return {
          passed: false,
          score: 50,
          missingPoints: ['缺少安全规范说明'],
          factCheck: 'consistent',
          feedbackToAgent: '请补充说明安全规范相关内容'
        };
      }
      return {
        passed: true,
        score: 95,
        missingPoints: [],
        factCheck: 'consistent',
        feedbackToAgent: ''
      };
    }
  };

  const streamEvents = [];
  const result = await runAgentLoop({
    model,
    messages: [{ role: 'user', content: '计算 2+2 并说明安全规范' }],
    tools: [{ type: 'function', function: { name: 'calculator', parameters: {} } }],
    toolExecutor: async () => ({ result: 4 }),
    critic: mockCritic,
    criticEnabled: true,
    criticMaxRetries: 1,
    maxSteps: 5,
    stream: {
      emit: ev => streamEvents.push(ev)
    }
  });

  assert.equal(criticCalls, 2);
  assert.equal(result.content, '2+2 等于 4。同时已补充满足安全规范说明。');
  assert.ok(streamEvents.some(e => e.type === 'status' && e.phase === 'reviewing'));
  assert.ok(streamEvents.some(e => e.type === 'status' && e.phase === 'reflecting'));
  assert.equal(result.criticResult.passed, true);
});

test('unified turn-pipeline in sendMessage enforces instruction inspector approval on sensitive tools and records turn_traces', async t => {
  const toolCallReply = new Response(JSON.stringify({
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: 'call_del_1',
          type: 'function',
          function: { name: 'delete_external_record', arguments: '{"recordId":"rec-99"}' }
        }]
      },
      finish_reason: 'tool_calls'
    }]
  }), { headers: { 'content-type': 'application/json' } });

  const f = fixture(t, [
    toolCallReply,
    '由于您未授权删除操作，已为您保留原记录 rec-99。'
  ]);
  let sensitiveExecuted = false;
  f.api.toolRegistry.registerSkill({
    type: 'function',
    function: {
      name: 'delete_external_record',
      description: 'Delete an external record',
      parameters: { type: 'object', properties: { recordId: { type: 'string' } }, required: ['recordId'] }
    }
  }, async () => { sensitiveExecuted = true; return { deleted: true }; });
  f.api.updateSettings({ criticEnabled: false });

  const convId = addConversation(f.api, f.personaId);
  const events = [];
  const res = await f.api.sendMessage(convId, { content: '帮我删除外部记录 rec-99' }, {
    onEvent: ev => events.push(ev)
  });

  assert.equal(sensitiveExecuted, false, 'Sensitive tool in main chat must be intercepted by inspector when unapproved');
  assert.ok(events.some(e => e.type === 'approval_requested' && e.ticket?.toolCall?.name === 'delete_external_record'));
  assert.ok(res.message.content.includes('保留原记录'));

  const { traces } = f.api.getTraces({ conversationId: convId });
  assert.equal(traces.length, 1);
  assert.equal(traces[0].conversationId, convId);
  assert.equal(traces[0].outcome, 'approval_rejected');
  assert.equal(traces[0].toolCalls, 1);
});

test('unified turn-pipeline in sendMessage strictly caps critic reflections by criticMaxRetries', async t => {
  const calcCallReply = new Response(JSON.stringify({
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: 'call_calc_1',
          type: 'function',
          function: { name: 'calculator', arguments: '{"expression":"6*7"}' }
        }]
      },
      finish_reason: 'tool_calls'
    }]
  }), { headers: { 'content-type': 'application/json' } });

  const f = fixture(t, [
    calcCallReply,
    '第一次候选回答：结果是 42。',
    JSON.stringify({ passed: false, score: 45, missingPoints: ['缺少推导说明'], factCheck: 'consistent', feedbackToAgent: '请补充推导说明' }),
    '第二次修正回答：6 乘以 7 等于 42，推导完毕。',
    JSON.stringify({ passed: false, score: 55, missingPoints: ['仍想挑剔'], factCheck: 'consistent', feedbackToAgent: '继续挑剔' })
  ]);
  f.api.updateSettings({ criticEnabled: true, criticMaxRetries: 1, agentMaxSteps: 20 });

  const convId = addConversation(f.api, f.personaId);
  const res = await f.api.sendMessage(convId, { content: '请计算 6*7 并给出详细推导说明' });
  assert.ok(res.message.content.includes('42'));
  // 1 tool call + 1 candidate + 1 critic + 1 retry candidate + 1 critic = 5 model calls total (capped at 1 retry despite agentMaxSteps=20)
  assert.equal(f.calls.length, 5);
  const { traces } = f.api.getTraces({ conversationId: convId });
  assert.equal(traces[0].modelCalls, 5);
  assert.equal(traces[0].criticScore, 55);
});

test('store schemaVersion migrations and FTS5 chunks_fts stay synchronized on import and delete', async t => {
  const f = fixture(t, []);
  assert.equal(f.store.schemaVersion(), 2);
  assert.equal(f.api.knowledge.stats().ftsEnabled, true);

  const rawText = '栖忆古典园林架构采用 SQLite FTS5 全文检索引擎与向量混合排序。';
  const doc = await f.api.knowledge.importDocument('architecture.md', Buffer.from(rawText, 'utf8').toString('base64'));
  const ftsHits = f.api.knowledge.ftsSearch('全文检索引擎');
  assert.equal(ftsHits.length, 1);

  const searchHits = f.api.knowledge.search('FTS5 全文检索');
  assert.equal(searchHits.length, 1);
  assert.equal(searchHits[0].documentId, doc.id);

  f.api.deleteDocument(doc.id);
  assert.equal(f.api.knowledge.ftsSearch('全文检索引擎').length, 0);
});

test('model.complete supports pre-first-byte maxRetries and criticModel override', async t => {
  let attempt = 0;
  const f = fixture(t, [], {
    fetchImpl: async (url, init) => {
      attempt++;
      if (attempt === 1) {
        return new Response('Service Unavailable', { status: 503 });
      }
      const body = JSON.parse(init.body);
      return new Response(JSON.stringify({
        choices: [{ index: 0, message: { role: 'assistant', content: `成功使用模型:${body.model}` }, finish_reason: 'stop' }]
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
  });
  const reply = await f.api.model.complete([{ role: 'user', content: '重试测试' }], {
    maxRetries: 1,
    model: 'qiyi-critic-lite'
  });
  assert.equal(attempt, 2);
  assert.equal(reply, '成功使用模型:qiyi-critic-lite');
});
