import { AppError } from './model.mjs';

function normalizeArgs(raw) {
  if (!raw) return '';
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (parsed && typeof parsed === 'object') {
      const sorted = Object.keys(parsed).sort().reduce((acc, k) => {
        acc[k] = parsed[k];
        return acc;
      }, {});
      return JSON.stringify(sorted);
    }
    return JSON.stringify(parsed);
  } catch {
    return String(raw).trim();
  }
}

export function shouldAuditPrompt(prompt, steps) {
  if (steps && steps.length > 0) return true;
  if (!prompt || typeof prompt !== 'string') return false;
  const p = prompt.trim();
  if (p.length > 60) return true;
  if (/[0-9+\-*/%().^=]|计算|算一下|检索|查询|搜索|代码|编写|规范|条目|分析|总结|为什么|怎么|对比|表格|列出/i.test(p)) {
    return true;
  }
  return false;
}

export async function runAgentLoop({
  model,
  messages,
  tools = [],
  toolExecutor,
  inspector = null,
  critic = null,
  criticEnabled = false,
  criticMaxRetries = 1,
  roleName = '伙伴',
  conversationId = null,
  maxSteps = 20,
  duplicateThreshold = 5,
  failureThreshold = 5,
  securityLevel = 'standard',
  stream = null,
  signal = null,
  onStep = null,
  onApprovalRequest = null,
}) {
  const abort = () => {
    if (signal?.aborted) throw new AppError('本次回复已取消。', 499);
  };
  abort();

  // If maxSteps is 0 or no tools provided, execute single turn with toolChoice: 'none'
  if (maxSteps <= 0 || !Array.isArray(tools) || tools.length === 0 || !toolExecutor) {
    if (stream) {
      let raw = '';
      const response = await model.stream(messages, {
        signal,
        toolChoice: 'none',
        onDelta: async event => {
          if (event.type === 'reasoning') await stream.emit(event);
          else if (event.type === 'content') {
            raw += event.delta;
            await stream.emit(event);
          }
        }
      });
      return { content: response.content || raw, reasoning: response.reasoning || '', steps: [], totalSteps: 0 };
    }
    const response = await model.complete(messages, { signal, toolChoice: 'none' });
    const content = typeof response === 'string' ? response : (response.content || '');
    const reasoning = typeof response === 'object' ? (response.reasoning || '') : '';
    return { content, reasoning, steps: [], totalSteps: 0 };
  }

  const conversationMessages = [...messages];
  const steps = [];
  let consecutiveDuplicates = 0;
  let consecutiveFailures = 0;
  let lastCallSignature = null;
  let forceFinal = false;
  let step = 0;
  let criticRetries = 0;
  let lastCriticResult = null;
  let finalContent = '';
  let finalReasoning = '';

  while (step < maxSteps && !forceFinal) {
    abort();
    step++;

    if (stream) {
      await stream.emit({ type: 'status', phase: 'thinking', step });
    }

    // Call model
    let response;
    const modelOptions = {
      signal,
      tools,
      toolChoice: 'auto',
      maxTokens: 4000
    };

    if (stream) {
      let streamContent = '';
      response = await model.stream(conversationMessages, {
        ...modelOptions,
        onDelta: async event => {
          if (event.type === 'reasoning') await stream.emit(event);
          else if (event.type === 'content') {
            streamContent += event.delta;
          }
        }
      });
      if (!response.content && streamContent) response.content = streamContent;
    } else {
      response = await model.complete(conversationMessages, modelOptions);
    }

    abort();

    const thought = response.reasoning || response.content || '';
    const toolCalls = Array.isArray(response.toolCalls) ? response.toolCalls : [];

    // If model made no tool call, it has reached its candidate answer!
    if (!toolCalls.length) {
      const candidateContent = response.content || '';
      const candidateReasoning = [finalReasoning, response.reasoning].filter(Boolean).join('\n\n');

      const userPrompt = [...conversationMessages].reverse().find(m => m.role === 'user')?.content || '';
      const shouldAudit = critic && criticEnabled && criticRetries <= criticMaxRetries && shouldAuditPrompt(userPrompt, steps);

      if (shouldAudit) {
        if (stream) {
          await stream.emit({ type: 'status', phase: 'reviewing' });
        }
        const toolsExecuted = steps.filter(s => s.tool).map(s => ({
          name: s.tool,
          args: s.arguments,
          result: s.observation,
          status: s.status
        }));
        const historyForCritic = conversationMessages.filter(m => m.role === 'user' || m.role === 'assistant');
        const auditResult = await critic.auditCandidate({
          prompt: userPrompt,
          history: historyForCritic,
          toolsExecuted,
          candidateContent,
          roleName,
          signal
        });
        lastCriticResult = auditResult;

        if (!auditResult.passed) {
          if (criticRetries < criticMaxRetries) {
            criticRetries++;
            if (stream) {
              await stream.emit({
                type: 'status',
                phase: 'reflecting',
                score: auditResult.score,
                missingPoints: auditResult.missingPoints,
                reason: auditResult.feedbackToAgent
              });
            }
            conversationMessages.push({ role: 'assistant', content: candidateContent });
            conversationMessages.push({
              role: 'system',
              content: `[审核员质检未通过] 契合度评分: ${auditResult.score}/100。\n未满足要点: ${auditResult.missingPoints.join('、') || '部分需求未满足'}\n反思整改指令: ${auditResult.feedbackToAgent}\n请结合用户原始提问与工具结果，针对上述缺陷进行补充和修正，直接给出完善后的最终答复。`
            });
            continue;
          }
        }
      }

      finalContent = candidateContent;
      finalReasoning = candidateReasoning;
      if (stream && finalContent) {
        await stream.emit({ type: 'content', content: finalContent });
      }
      break;
    }

    // Extract tool call
    const call = toolCalls[0];
    const toolName = call.function.name;
    const rawArgs = call.function.arguments;
    const sig = `${toolName}:${normalizeArgs(rawArgs)}`;

    // 1. Check Duplicate Call Breaker (5 times)
    if (sig === lastCallSignature) {
      consecutiveDuplicates++;
    } else {
      consecutiveDuplicates = 1;
      lastCallSignature = sig;
    }

    if (consecutiveDuplicates >= duplicateThreshold) {
      const warning = `[系统熔断] 指令 [${toolName}] 已连续重复调用 ${consecutiveDuplicates} 次相同参数。判定为陷入逻辑死循环，系统已拦截此次调用。请停止调用该工具，直接基于现有结论进行回答或更换解决方案。`;
      const stepRecord = {
        step,
        thought,
        tool: toolName,
        arguments: rawArgs,
        status: 'circuit_broken',
        warning
      };
      steps.push(stepRecord);
      onStep?.(stepRecord);

      if (stream) {
        await stream.emit({ type: 'thought_step', ...stepRecord });
      }

      conversationMessages.push({ role: 'assistant', content: response.content || null, tool_calls: response.toolCalls });
      conversationMessages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ error: warning, circuitBroken: true }) });
      forceFinal = true;
      continue;
    }

    // 2. Check Instruction Safety Inspector (User Approval Required)
    let approved = true;
    let ticket = null;
    if (inspector) {
      const assessment = inspector.assess(call, { securityLevel });
      if (assessment.requiresApproval) {
        ticket = inspector.createTicket({
          conversationId,
          step,
          toolCall: call,
          explanation: thought,
          riskLevel: assessment.riskLevel,
          reason: assessment.reason
        });

        if (stream) {
          await stream.emit({ type: 'approval_requested', ticket });
        }

        if (typeof onApprovalRequest === 'function') {
          approved = await onApprovalRequest(ticket);
        } else {
          // If no approval handler is provided in synchronous run, reject by default for security
          approved = false;
        }

        if (approved) {
          inspector.consume(ticket.id);
        } else {
          inspector.decide(ticket.id, { approved: false, reason: '用户未授权执行该敏感指令。' }).catch?.(() => {});
        }
      }
    }

    if (!approved) {
      const rejectionMessage = `[用户拒绝] 用户不同意执行敏感指令 [${toolName}]。请停止该操作，向用户说明原因或换用安全替代方式。`;
      const stepRecord = {
        step,
        thought,
        tool: toolName,
        arguments: rawArgs,
        status: 'rejected',
        warning: rejectionMessage
      };
      steps.push(stepRecord);
      onStep?.(stepRecord);

      if (stream) {
        await stream.emit({ type: 'thought_step', ...stepRecord });
      }

      conversationMessages.push({ role: 'assistant', content: response.content || null, tool_calls: response.toolCalls });
      conversationMessages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ error: rejectionMessage, rejected: true }) });
      continue;
    }

    // 3. Execute Tool
    if (stream) {
      await stream.emit({
        type: 'thought_step',
        step,
        thought,
        tool: toolName,
        arguments: rawArgs,
        status: 'executing'
      });
    }

    let observation;
    let executionError = null;
    try {
      let parsedArgs = {};
      try { parsedArgs = JSON.parse(rawArgs); } catch { parsedArgs = { raw: rawArgs }; }
      observation = await toolExecutor(toolName, parsedArgs, { signal, step });
      consecutiveFailures = 0;
    } catch (err) {
      executionError = err.message || '工具执行发生未知异常。';
      consecutiveFailures++;
      observation = { error: executionError, success: false };
    }

    const obsContent = typeof observation === 'string' ? observation : JSON.stringify(observation);
    const stepRecord = {
      step,
      thought,
      tool: toolName,
      arguments: rawArgs,
      observation: obsContent,
      status: executionError ? 'error' : 'success'
    };
    steps.push(stepRecord);
    onStep?.(stepRecord);

    if (stream) {
      await stream.emit({
        type: 'tool_result',
        step,
        tool: toolName,
        result: obsContent,
        status: executionError ? 'error' : 'success'
      });
    }

    conversationMessages.push({ role: 'assistant', content: response.content || null, tool_calls: response.toolCalls });
    conversationMessages.push({ role: 'tool', tool_call_id: call.id, content: obsContent });

    // 4. Check Consecutive Failure Breaker (5 times)
    if (consecutiveFailures >= failureThreshold) {
      const breakerWarning = `[系统阻断] 工具调用已连续失败 ${consecutiveFailures} 次。为避免死循环，系统已阻断后续工具调用。请向用户说明遇到的具体困难，并给出当前可行的总结。`;
      conversationMessages.push({ role: 'system', content: breakerWarning });
      forceFinal = true;
    }
  }

  // If loop ended because of maxSteps reached or forceFinal without finalContent, force one final synthesis
  if (!finalContent) {
    abort();
    if (stream) {
      await stream.emit({ type: 'status', phase: 'finalizing' });
    }
    const finalPrompt = step >= maxSteps
      ? `已达到最大推理步数上限 (${maxSteps})，请综合目前已收集到的观察结果直接给出最终回复与未尽说明。`
      : '请综合目前所有观察结果给出最终回复。';

    conversationMessages.push({ role: 'system', content: finalPrompt });

    if (stream) {
      let raw = '';
      const response = await model.stream(conversationMessages, {
        signal,
        toolChoice: 'none',
        onDelta: async event => {
          if (event.type === 'reasoning') await stream.emit(event);
          else if (event.type === 'content') {
            raw += event.delta;
            await stream.emit(event);
          }
        }
      });
      finalContent = response.content || raw;
      finalReasoning = [finalReasoning, response.reasoning].filter(Boolean).join('\n\n');
    } else {
      const response = await model.complete(conversationMessages, { signal, toolChoice: 'none' });
      finalContent = typeof response === 'string' ? response : (response.content || '');
      finalReasoning = [finalReasoning, typeof response === 'object' ? response.reasoning : ''].filter(Boolean).join('\n\n');
    }
  }

  return {
    content: finalContent.trim(),
    reasoning: finalReasoning.trim(),
    steps,
    totalSteps: step,
    criticResult: lastCriticResult
  };
}
