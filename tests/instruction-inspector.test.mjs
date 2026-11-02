import test from 'node:test';
import assert from 'node:assert/strict';
import { assessToolCall, createInstructionInspector } from '../lib/instruction-inspector.mjs';

test('assessToolCall correctly classifies safe and sensitive tools in standard mode', () => {
  // Safe tools
  assert.equal(assessToolCall({ name: 'calculator', arguments: '{"expr":"2+2"}' }).requiresApproval, false);
  assert.equal(assessToolCall({ name: 'search_music', arguments: '{"query":"晴天"}' }).requiresApproval, false);
  assert.equal(assessToolCall({ name: 'knowledge_search', arguments: '{"query":"架构"}' }).requiresApproval, false);

  // Sensitive mutating tools
  const execCall = assessToolCall({ name: 'exec_command', arguments: '{"cmd":"ls"}' });
  assert.equal(execCall.requiresApproval, true);
  assert.equal(execCall.riskLevel, 'critical');

  const deleteCall = assessToolCall({ name: 'delete_document', arguments: '{"id":"doc-1"}' });
  assert.equal(deleteCall.requiresApproval, true);
  assert.equal(deleteCall.riskLevel, 'critical');

  const writeCall = assessToolCall({ name: 'file_write', arguments: '{"path":"/tmp/a"}' });
  assert.equal(writeCall.requiresApproval, true);

  const mailCall = assessToolCall({ name: 'mail_send', arguments: '{"to":"a@b.com"}' });
  assert.equal(mailCall.requiresApproval, true);
});

test('assessToolCall detects dangerous arguments even in innocuous tool names', () => {
  const dangerousCall = assessToolCall({ name: 'custom_query', arguments: '{"query":"drop table users;"}' });
  assert.equal(dangerousCall.requiresApproval, true);
  assert.equal(dangerousCall.riskLevel, 'critical');

  const dangerousArgs = assessToolCall({ name: 'do_task', arguments: '{"action":"rm -rf /"}' });
  assert.equal(dangerousArgs.requiresApproval, true);
});

test('assessToolCall respects securityLevel strict and loose', () => {
  // Strict mode: everything except calculator requires approval
  assert.equal(assessToolCall({ name: 'calculator' }, { securityLevel: 'strict' }).requiresApproval, false);
  assert.equal(assessToolCall({ name: 'search_music' }, { securityLevel: 'strict' }).requiresApproval, true);
  assert.equal(assessToolCall({ name: 'knowledge_search' }, { securityLevel: 'strict' }).requiresApproval, true);

  // Loose mode: standard read/search/normal tools pass, only exec and delete require approval
  assert.equal(assessToolCall({ name: 'search_music' }, { securityLevel: 'loose' }).requiresApproval, false);
  assert.equal(assessToolCall({ name: 'knowledge_search' }, { securityLevel: 'loose' }).requiresApproval, false);
  assert.equal(assessToolCall({ name: 'file_write' }, { securityLevel: 'loose' }).requiresApproval, false);
  assert.equal(assessToolCall({ name: 'exec_command' }, { securityLevel: 'loose' }).requiresApproval, true);
  assert.equal(assessToolCall({ name: 'delete_document' }, { securityLevel: 'loose' }).requiresApproval, true);
});

test('assessToolCall handles malformed JSON arguments safely', () => {
  const result = assessToolCall({ name: 'some_tool', arguments: '{invalid json' });
  assert.equal(result.requiresApproval, true);
  assert.equal(result.riskLevel, 'high');
});

test('createInstructionInspector manages approval ticket lifecycle and prevents replay', () => {
  let currentTime = 100000;
  const inspector = createInstructionInspector({ ttlMs: 60000, clock: () => currentTime });

  // Create ticket
  const ticket = inspector.createTicket({
    conversationId: 'conv-123',
    step: 2,
    toolCall: { name: 'exec_command', arguments: '{"cmd":"npm test"}' },
    explanation: '为了验证模块正确性，需要执行单元测试。',
    riskLevel: 'critical',
    reason: '检测到系统终端执行指令。'
  });

  assert.ok(ticket.id && ticket.id.length === 64);
  assert.equal(ticket.status, 'pending');
  assert.equal(ticket.step, 2);
  assert.equal(inspector.countPending('conv-123'), 1);

  // Cannot consume before approval
  assert.throws(() => inspector.consume(ticket.id), /approved/);

  // Approve ticket
  const approved = inspector.decide(ticket.id, { approved: true, reason: '用户手动确认放行' });
  assert.equal(approved.status, 'approved');
  assert.equal(approved.decisionReason, '用户手动确认放行');
  assert.equal(inspector.countPending('conv-123'), 0);

  // Cannot re-decide
  assert.throws(() => inspector.decide(ticket.id, { approved: false }), /重复审批/);

  // Consume ticket
  const consumed = inspector.consume(ticket.id);
  assert.equal(consumed.status, 'executed');

  // Cannot re-consume (anti-replay)
  assert.throws(() => inspector.consume(ticket.id), /approved/);
});

test('createInstructionInspector handles rejection and expiration', () => {
  let currentTime = 100000;
  const inspector = createInstructionInspector({ ttlMs: 5000, clock: () => currentTime });

  const ticket1 = inspector.createTicket({
    conversationId: 'conv-1',
    toolCall: { name: 'delete_document', arguments: '{"id":"doc-1"}' }
  });

  const rejected = inspector.decide(ticket1.id, { approved: false, reason: '用户取消该操作' });
  assert.equal(rejected.status, 'rejected');
  assert.equal(rejected.decisionReason, '用户取消该操作');
  assert.throws(() => inspector.consume(ticket1.id), /approved/);

  // Test expiration
  const ticket2 = inspector.createTicket({
    conversationId: 'conv-1',
    toolCall: { name: 'exec_command', arguments: '{"cmd":"rm data"}' }
  });

  // Advance time past TTL
  currentTime += 6000;
  const expiredView = inspector.getTicket(ticket2.id);
  assert.equal(expiredView.status, 'expired');
  assert.throws(() => inspector.decide(ticket2.id, { approved: true }), /已过期/);
});
