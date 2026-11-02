import { randomBytes } from 'node:crypto';
import { AppError } from './model.mjs';

const DEFAULT_TTL_MS = 10 * 60 * 1000; // 10 minutes

export const SAFE_TOOLS = new Set([
  'search_music',
  'calculator',
  'get_time',
  'get_system_status',
  'knowledge_search',
  'knowledge_deep_search',
  'fetch_document_detail',
  'list_documents',
  'list_memories'
]);

export const SENSITIVE_PREFIXES = [
  'exec', 'run', 'shell', 'bash', 'cmd', 'command',
  'delete', 'remove', 'drop', 'unlink', 'rm',
  'write', 'create', 'overwrite', 'modify', 'update', 'patch',
  'send_mail', 'mail_send', 'transfer', 'buy', 'pay', 'publish'
];

export function assessToolCall(toolCall, { securityLevel = 'standard' } = {}) {
  const name = (toolCall?.name || toolCall?.function?.name || '').trim();
  let args = {};
  try {
    const rawArgs = toolCall?.arguments ?? toolCall?.function?.arguments;
    args = typeof rawArgs === 'string' ? JSON.parse(rawArgs) : (rawArgs || {});
  } catch {
    return {
      requiresApproval: true,
      riskLevel: 'high',
      reason: '工具调用参数不是合法的 JSON 格式。'
    };
  }

  if (securityLevel === 'loose') {
    // In loose mode, only direct shell/exec and delete operations require confirmation
    const isCritical = /exec|run|shell|bash|delete|drop|remove/i.test(name);
    return {
      requiresApproval: isCritical,
      riskLevel: isCritical ? 'critical' : 'low',
      reason: isCritical ? `指令 [${name}] 具有系统级破坏风险，需人工确认。` : '宽松模式下允许直接执行。'
    };
  }

  if (securityLevel === 'strict') {
    // In strict mode, every tool except pure calculator requires confirmation
    const isPureCalc = name === 'calculator';
    return {
      requiresApproval: !isPureCalc,
      riskLevel: isPureCalc ? 'safe' : 'medium',
      reason: isPureCalc ? '安全计算指令。' : `严格模式下，指令 [${name}] 需要用户明确确认后方可执行。`
    };
  }

  // Default: 'standard' security level
  if (SAFE_TOOLS.has(name)) {
    return {
      requiresApproval: false,
      riskLevel: 'safe',
      reason: '只读或安全无害操作，自动放行。'
    };
  }

  const lowerName = name.toLowerCase();
  for (const prefix of SENSITIVE_PREFIXES) {
    if (lowerName.startsWith(prefix) || lowerName.includes(`_${prefix}`) || lowerName.includes(`${prefix}_`)) {
      return {
        requiresApproval: true,
        riskLevel: ['exec', 'run', 'shell', 'delete', 'drop'].some(p => lowerName.includes(p)) ? 'critical' : 'high',
        reason: `检测到敏感指令 [${name}]，可能修改系统、文件或外发数据，需用户同意。`
      };
    }
  }

  // Check arguments for suspicious command lines or file mutations
  const argsString = JSON.stringify(args).toLowerCase();
  if (/rm\s+-rf|format\s+[a-z]:|drop\s+table|delete\s+from|powershell|curl\s+|wget\s+/i.test(argsString)) {
    return {
      requiresApproval: true,
      riskLevel: 'critical',
      reason: `指令 [${name}] 的参数中包含危险系统命令或破坏性操作模式。`
    };
  }

  return {
    requiresApproval: false,
    riskLevel: 'low',
    reason: '标准操作，已通过安全校验。'
  };
}

export function createInstructionInspector({ ttlMs = DEFAULT_TTL_MS, clock = Date.now } = {}) {
  const tickets = new Map();

  function prune() {
    const now = clock();
    for (const [id, ticket] of tickets.entries()) {
      if (ticket.expiresAt <= now && ticket.status === 'pending') {
        ticket.status = 'expired';
      }
      if (ticket.expiresAt + ttlMs <= now) {
        tickets.delete(id);
      }
    }
  }

  return {
    assess(toolCall, options = {}) {
      return assessToolCall(toolCall, options);
    },

    createTicket({ conversationId, step = 1, toolCall, explanation = '', riskLevel = 'medium', reason = '' }) {
      prune();
      const token = randomBytes(32).toString('hex');
      const now = clock();
      const ticket = {
        id: token,
        conversationId,
        step,
        toolCall: {
          name: toolCall?.name || toolCall?.function?.name || 'unknown',
          arguments: toolCall?.arguments || toolCall?.function?.arguments || '{}'
        },
        explanation,
        riskLevel,
        reason,
        status: 'pending', // 'pending' | 'approved' | 'rejected' | 'executed' | 'expired'
        createdAt: now,
        expiresAt: now + ttlMs,
        decisionAt: null,
        decisionReason: null
      };
      tickets.set(token, ticket);
      return { ...ticket };
    },

    getTicket(ticketId) {
      prune();
      const ticket = tickets.get(ticketId);
      if (!ticket) throw new AppError('审批凭证不存在或已失效。', 404);
      if (ticket.status === 'pending' && clock() >= ticket.expiresAt) {
        ticket.status = 'expired';
      }
      return { ...ticket };
    },

    decide(ticketId, { approved, reason = '' } = {}) {
      prune();
      const ticket = tickets.get(ticketId);
      if (!ticket) throw new AppError('审批凭证不存在或已失效。', 404);
      if (ticket.status === 'expired' || clock() >= ticket.expiresAt) {
        ticket.status = 'expired';
        throw new AppError('审批凭证已过期。', 410);
      }
      if (ticket.status !== 'pending') {
        throw new AppError(`凭证状态为 [${ticket.status}]，不能重复审批。`, 409);
      }

      ticket.status = approved ? 'approved' : 'rejected';
      ticket.decisionAt = clock();
      ticket.decisionReason = reason || (approved ? '用户已同意执行。' : '用户已拒绝执行。');
      return { ...ticket };
    },

    consume(ticketId) {
      prune();
      const ticket = tickets.get(ticketId);
      if (!ticket) throw new AppError('审批凭证不存在或已失效。', 404);
      if (ticket.status !== 'approved') {
        throw new AppError(`凭证状态必须为 approved，当前为 [${ticket.status}]。`, 403);
      }
      ticket.status = 'executed';
      ticket.executedAt = clock();
      return { ...ticket };
    },

    countPending(conversationId) {
      prune();
      let count = 0;
      for (const ticket of tickets.values()) {
        if (ticket.status === 'pending' && (!conversationId || ticket.conversationId === conversationId)) {
          count++;
        }
      }
      return count;
    },

    listPending(conversationId) {
      prune();
      const list = [];
      for (const ticket of tickets.values()) {
        if (ticket.status === 'pending' && (!conversationId || ticket.conversationId === conversationId)) {
          list.push({ ...ticket });
        }
      }
      return list;
    },

    clear() {
      tickets.clear();
    }
  };
}
