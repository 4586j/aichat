import { AppError } from './model.mjs';
import { SSE_EVENTS, SSE_PHASES } from '../public/sse-protocol.js';

export const DEFAULT_MAX_STEPS = 20;
export const MIN_MAX_STEPS = 0;
export const MAX_MAX_STEPS = 100;
export const DEFAULT_DUPLICATE_THRESHOLD = 5;
export const DEFAULT_FAILURE_THRESHOLD = 5;
export const DEFAULT_CRITIC_MAX_RETRIES = 1;

/**
 * Decides whether a turn warrants an IntentCritic verification pass.
 * Simple greetings/short casual chats without tool calls skip the critic to save latency,
 * while any turn that executed tools or involves multi-part/analytical user prompts is audited.
 */
export function shouldAuditPrompt(prompt = '', steps = []) {
  if (Array.isArray(steps) && steps.length > 0) return true;
  const text = String(prompt || '').trim();
  if (!text || text.length < 18) return false;
  if (/(?:\d+\s*[.、)）]|\n|计算|对比|比较|分析|总结|汇总|步骤|方案|表格|代码|为什么|如何|怎么|区别|列出|核对|检查|同时|并且|以及)/u.test(text)) {
    return true;
  }
  return text.length >= 45;
}

function normalizeArgs(rawArgs) {
  if (!rawArgs) return '{}';
  try {
    const obj = typeof rawArgs === 'string' ? JSON.parse(rawArgs) : rawArgs;
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return String(rawArgs);
    const sortedKeys = Object.keys(obj).sort();
    const normalized = {};
    for (const k of sortedKeys) normalized[k] = obj[k];
    return JSON.stringify(normalized);
  } catch {
    return String(rawArgs).trim();
  }
}

export function clampMaxSteps(val) {
  const num = Number(val);
  if (!Number.isFinite(num)) return DEFAULT_MAX_STEPS;
  return Math.max(MIN_MAX_STEPS, Math.min(MAX_MAX_STEPS, Math.floor(num)));
}

/**
 * Runs a multi-turn ReAct (Reason + Act + Critic) loop with:
 * - Configurable maxSteps (0 to 100, default 20)
 * - 5-time duplicate call circuit breaker
 * - 5-time consecutive failure circuit breaker
 * - Instruction safety inspection & user approval gate
 * - Post-generation IntentCritic verification & reflection loop
 * - Custom tool interceptors (e.g., search_music) and live visibleReply streaming
 */
export async function runAgentLoop({
  model,
  messages = [],
  tools = [],
  toolExecutor,
  customToolHandlers = null,
  inspector = null,
  critic = null,
  criticEnabled = false,
  criticMaxRetries = DEFAULT_CRITIC_MAX_RETRIES,
  shouldAuditFn = shouldAuditPrompt,
  roleName = '伙伴',
  conversationId = null,
  maxSteps = DEFAULT_MAX_STEPS,
  maxTokens = 4000,
  duplicateThreshold = DEFAULT_DUPLICATE_THRESHOLD,
  failureThreshold = DEFAULT_FAILURE_THRESHOLD,
  securityLevel = 'standard',
  emitThinkingStatus = true,
  streamTransform = null,
  bufferCandidateOnAudit = false,
  preserveRawContent = false,
  onStep = null,
  onApprovalRequest = null,
  stream = null,
  signal = null
}) {
  const effectiveMaxSteps = clampMaxSteps(maxSteps);
  const conversationMessages = [...messages];
  const steps = [];
  let step = 0;
  let consecutiveFailures = 0;
  let lastCallSignature = null;
  let consecutiveDuplicates = 0;
  let finalContent = '';
  let finalReasoning = '';
  let criticRetries = 0;
  let lastCriticResult = null;
  let modelCalls = 0;
  let toolAttempted = false;
  let visible = '';

  const abort = () => {
    if (signal?.aborted) throw new AppError('本次回复已取消。', 499);
  };

  const resetStreamVisible = async () => {
    if (stream && visible) {
      visible = '';
      await stream.emit({ type: SSE_EVENTS.CONTENT, content: '' });
    }
  };

  const generate = async (inputMessages, toolChoice = 'auto', { bufferContent = false } = {}) => {
    abort();
    modelCalls++;
    const hasTools = tools !== undefined;
    const config = {
      maxTokens,
      signal,
      ...(hasTools ? { tools, toolChoice } : (toolChoice === 'none' ? { toolChoice: 'none' } : {}))
    };

    if (!stream) {
      const value = await model.complete(inputMessages, config);
      if (typeof value === 'string') return { content: value, reasoning: '', toolCalls: [] };
      return {
        content: value?.content ?? '',
        reasoning: value?.reasoning ?? '',
        toolCalls: Array.isArray(value?.toolCalls) ? value.toolCalls : []
      };
    }

    let raw = '';
    let streamedLive = false;
    const response = await model.stream(inputMessages, {
      ...config,
      onDelta: async event => {
        if (event.type === SSE_EVENTS.REASONING) {
          await stream.emit(event);
          return;
        }
        if (event.type === SSE_EVENTS.CONTENT) {
          raw += event.delta;
          if (!bufferContent && streamTransform) {
            streamedLive = true;
            const next = streamTransform(raw);
            if (next !== visible) {
              await stream.emit({
                type: SSE_EVENTS.CONTENT,
                ...(next.startsWith(visible) ? { delta: next.slice(visible.length) } : { content: next })
              });
              visible = next;
            }
          }
        }
      }
    });
    if (!response.content && raw) response.content = raw;
    return {
      content: response.content ?? '',
      reasoning: response.reasoning ?? '',
      toolCalls: Array.isArray(response.toolCalls) ? response.toolCalls : [],
      streamedLive
    };
  };

  // When maxSteps === 0, skip all tool-calling loops and ask model to answer directly
  if (effectiveMaxSteps === 0) {
    if (stream && emitThinkingStatus) {
      await stream.emit({ type: SSE_EVENTS.STATUS, phase: SSE_PHASES.THINKING, step: 0 });
    }
    const response = await generate(conversationMessages, 'none', { bufferContent: false });
    if (stream && !streamTransform && response.content) {
      await stream.emit({ type: SSE_EVENTS.CONTENT, delta: response.content });
    }
    const outContent = response.content || '';
    return {
      content: preserveRawContent ? outContent : outContent.trim(),
      reasoning: (response.reasoning || '').trim(),
      steps: [],
      totalSteps: 0,
      modelCalls,
      toolAttempted: false,
      criticResult: null
    };
  }

  let forceFinal = false;
  const userPrompt = [...conversationMessages].reverse().find(m => m.role === 'user')?.content || '';

  while (step < effectiveMaxSteps && !forceFinal) {
    abort();
    step++;

    if (stream && (emitThinkingStatus || step > 1)) {
      await stream.emit({ type: SSE_EVENTS.STATUS, phase: SSE_PHASES.THINKING, step });
    }

    const willAuditIfNoTool = Boolean(
      critic &&
      criticEnabled &&
      criticRetries <= criticMaxRetries &&
      shouldAuditFn(userPrompt, steps)
    );

    const response = await generate(conversationMessages, 'auto', {
      bufferContent: !streamTransform || (bufferCandidateOnAudit && willAuditIfNoTool)
    });

    abort();

    const thought = response.reasoning || response.content || '';
    const toolCalls = Array.isArray(response.toolCalls) ? response.toolCalls : [];

    // If model made no tool call, it has reached its candidate answer
    if (!toolCalls.length) {
      const candidateContent = response.content || '';
      const candidateReasoning = [finalReasoning, response.reasoning].filter(Boolean).join('\n\n');

      const shouldAudit = Boolean(
        critic &&
        criticEnabled &&
        criticRetries <= criticMaxRetries &&
        shouldAuditFn(userPrompt, steps)
      );

      if (shouldAudit) {
        if (stream) {
          await stream.emit({ type: SSE_EVENTS.STATUS, phase: SSE_PHASES.REVIEWING });
        }
        const toolsExecuted = steps.filter(s => s.tool).map(s => ({
          name: s.tool,
          args: s.arguments,
          result: s.observation,
          status: s.status
        }));
        const historyForCritic = conversationMessages.filter(m => m.role === 'user' || m.role === 'assistant');
        modelCalls++;
        const auditResult = await critic.auditCandidate({
          prompt: userPrompt,
          history: historyForCritic,
          toolsExecuted,
          candidateContent,
          roleName,
          signal
        });
        lastCriticResult = auditResult;

        if (!auditResult.passed && criticRetries < criticMaxRetries && step < effectiveMaxSteps) {
          criticRetries++;
          if (preserveRawContent) {
            finalReasoning = [
              finalReasoning,
              response.reasoning,
              `[意图审核] 第 ${criticRetries} 次质检未通过 (${auditResult.score}/100)：${auditResult.feedbackToAgent}`
            ].filter(Boolean).join('\n');
          }
          await resetStreamVisible();
          if (stream) {
            await stream.emit({
              type: SSE_EVENTS.STATUS,
              phase: SSE_PHASES.REFLECTING,
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

      finalContent = candidateContent;
      finalReasoning = candidateReasoning;
      if (stream && finalContent && !response.streamedLive) {
        const textToEmit = streamTransform ? streamTransform(finalContent) : finalContent;
        if (textToEmit) {
          visible = textToEmit;
          await stream.emit({ type: SSE_EVENTS.CONTENT, content: textToEmit });
        }
      }
      break;
    }

    // Extract tool call
    toolAttempted = true;
    const call = toolCalls[0];
    const toolName = call.function.name;
    const rawArgs = call.function.arguments;

    // 0. Check Custom Tool Handler (e.g., search_music in main chat)
    if (customToolHandlers && typeof customToolHandlers[toolName] === 'function') {
      const customResult = await customToolHandlers[toolName](call, {
        response,
        step,
        conversationMessages,
        stream,
        signal,
        resetStreamVisible,
        steps
      });
      if (customResult?.followUpToolChoice === 'none') {
        const finalResp = await generate(conversationMessages, 'none', { bufferContent: false });
        finalContent = finalResp.content || '';
        finalReasoning = [finalReasoning, response.reasoning, finalResp.reasoning].filter(Boolean).join('\n\n');
        if (stream && finalContent && !finalResp.streamedLive) {
          const textToEmit = streamTransform ? streamTransform(finalContent) : finalContent;
          if (textToEmit) {
            visible = textToEmit;
            await stream.emit({ type: SSE_EVENTS.CONTENT, content: textToEmit });
          }
        }
        break;
      }
      continue;
    }

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
        await stream.emit({ type: SSE_EVENTS.THOUGHT_STEP, ...stepRecord });
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
          await stream.emit({ type: SSE_EVENTS.APPROVAL_REQUESTED, ticket });
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
          try { inspector.decide(ticket.id, { approved: false, reason: '用户未授权执行该敏感指令。' }); } catch {}
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
        await stream.emit({ type: SSE_EVENTS.THOUGHT_STEP, ...stepRecord });
      }

      conversationMessages.push({ role: 'assistant', content: response.content || null, tool_calls: response.toolCalls });
      conversationMessages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ error: rejectionMessage, rejected: true }) });
      continue;
    }

    // 3. Execute Tool
    if (stream) {
      await stream.emit({
        type: SSE_EVENTS.THOUGHT_STEP,
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
      try { parsedArgs = JSON.parse(rawArgs || '{}'); } catch { parsedArgs = { raw: rawArgs }; }
      observation = await toolExecutor(toolName, parsedArgs, { signal, step, conversationId });
      if (observation && typeof observation === 'object' && observation.error && observation.success === false) {
        executionError = observation.error;
        consecutiveFailures++;
      } else {
        consecutiveFailures = 0;
      }
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
    if (preserveRawContent) {
      finalReasoning = [
        finalReasoning,
        response.reasoning,
        `[步骤 ${step}] 调用工具 ${toolName}(${rawArgs || '{}'}) -> ${obsContent.slice(0, 180)}`
      ].filter(Boolean).join('\n');
    }

    if (stream) {
      await stream.emit({
        type: SSE_EVENTS.TOOL_RESULT,
        step,
        tool: toolName,
        result: observation,
        status: executionError ? 'error' : 'success'
      });
    }

    conversationMessages.push({ role: 'assistant', content: response.content || null, tool_calls: response.toolCalls });
    conversationMessages.push({ role: 'tool', tool_call_id: call.id, content: obsContent });
    conversationMessages.push({ role: 'system', content: '工具已执行完毕。请仔细分析工具返回的数据，继续下一步思考或直接给出回答。' });

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
      await stream.emit({ type: SSE_EVENTS.STATUS, phase: SSE_PHASES.FINALIZING });
    }
    const finalPrompt = step >= effectiveMaxSteps
      ? `已达到最大推理步数上限 (${effectiveMaxSteps})，请综合目前已收集到的观察结果直接给出最终回复与未尽说明。`
      : '请综合目前所有观察结果给出最终回复。';

    conversationMessages.push({ role: 'system', content: finalPrompt });

    const response = await generate(conversationMessages, 'none', { bufferContent: false });
    if (stream && !streamTransform && response.content) {
      await stream.emit({ type: SSE_EVENTS.CONTENT, delta: response.content });
    }
    finalContent = response.content || '';
    finalReasoning = [finalReasoning, response.reasoning].filter(Boolean).join('\n\n');
  }

  return {
    content: preserveRawContent ? finalContent : finalContent.trim(),
    reasoning: finalReasoning.trim(),
    steps,
    totalSteps: step,
    modelCalls,
    toolAttempted,
    criticResult: lastCriticResult
  };
}
