import { AppError } from './model.mjs';

function parseJsonSafely(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  // Strip markdown code fences if present
  const unquoted = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    return JSON.parse(unquoted);
  } catch {
    const match = unquoted.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]); } catch {}
    }
    return null;
  }
}

export function createIntentCritic({ model }) {
  if (!model) throw new AppError('IntentCritic 需要注入有效的 model 实例。');

  return {
    async auditCandidate({
      prompt,
      history = [],
      toolsExecuted = [],
      candidateContent = '',
      roleName = '伙伴',
      signal = null
    }) {
      if (signal?.aborted) throw new AppError('审核已取消。', 499);
      if (!prompt || typeof prompt !== 'string') return { passed: true, score: 100, missingPoints: [], factCheck: 'consistent', feedbackToAgent: '' };
      if (!candidateContent || typeof candidateContent !== 'string') {
        return {
          passed: false,
          score: 0,
          missingPoints: ['回答内容为空'],
          factCheck: 'inconsistent',
          feedbackToAgent: '模型没有生成任何实质回答内容，请针对用户的问题给出正面答复。'
        };
      }

      const toolsContext = toolsExecuted.length > 0
        ? toolsExecuted.map((t, idx) => `[工具调用 ${idx + 1}] 名称: ${t.name}\n入参: ${JSON.stringify(t.args)}\n执行结果: ${JSON.stringify(t.result)}`).join('\n\n')
        : '（本轮无工具调用）';

      const criticMessages = [
        {
          role: 'system',
          content: `你是一个高精度的回答意图对齐审核器与事实质检员。
你的任务是严格核对【候选回答】是否真实、完整、准确地回应了【用户当次提问】，特别是多目标、计算与工具引用的场景。

【核验准则】：
1. 完整性（Coverage）：用户提问中的全部核心诉求或子问题是否已在候选回答中正面且清晰地作答？是否有明显遗漏？
2. 事实一致性（Factuality）：若执行了工具（如计算器算出的数值、知识库查出的事实），候选回答引用的数值和事实是否与工具结果严格一致？严禁捏造或歪曲工具结果。
3. 显式约束遵从（Constraints）：若用户指定了格式（如表格、代码块、语言、字数或特定结构），是否基本满足？
4. 宽容度控制：纯闲聊、语气发挥或合理修辞应予以放行；仅在出现【严重遗漏未答】、【关键事实/计算数值错误】或【完全偏离用户意图】时判定不通过。

请严格输出合法的 JSON 对象，格式如下：
{
  "passed": true 或 false,
  "score": 0 到 100 的整数打分,
  "missingPoints": ["未回答的要点1", "未回答的要点2"],
  "factCheck": "consistent" 或 "inconsistent",
  "feedbackToAgent": "若 passed 为 false，给出 1-2 句明确有力的反思建议，指导下一轮回答修正；若 passed 为 true，留空字符串"
}`
        },
        {
          role: 'user',
          content: `【用户角色设定】: ${roleName}
【用户当次提问】:
${prompt}

【本轮真实工具执行记录】:
${toolsContext}

【待审核的候选回答】:
${candidateContent}`
        }
      ];

      try {
        const response = await model.complete(criticMessages, {
          signal,
          maxTokens: 1000,
          toolChoice: 'none'
        });

        const raw = typeof response === 'string' ? response : (response?.content || '');
        const parsed = parseJsonSafely(raw);

        if (parsed && typeof parsed === 'object') {
          const passed = Boolean(parsed.passed);
          const score = typeof parsed.score === 'number' ? Math.max(0, Math.min(100, Math.round(parsed.score))) : (passed ? 90 : 40);
          const missingPoints = Array.isArray(parsed.missingPoints) ? parsed.missingPoints.map(p => String(p).trim()).filter(Boolean) : [];
          const factCheck = parsed.factCheck === 'inconsistent' ? 'inconsistent' : 'consistent';
          const feedbackToAgent = typeof parsed.feedbackToAgent === 'string' ? parsed.feedbackToAgent.trim() : '';

          return {
            passed,
            score,
            missingPoints,
            factCheck,
            feedbackToAgent: feedbackToAgent || (passed ? '' : '请对照用户需求和工具结果补充缺失要点并修正错误。')
          };
        }

        // Fallback: If model did not return parseable JSON, default to passed so we do not block user
        return {
          passed: true,
          score: 80,
          missingPoints: [],
          factCheck: 'consistent',
          feedbackToAgent: ''
        };
      } catch (err) {
        if (err instanceof AppError && err.status === 499) throw err;
        // Network/Model error on critic stage should fail-open (pass through) to prevent breaking chat
        return {
          passed: true,
          score: 80,
          missingPoints: [],
          factCheck: 'consistent',
          feedbackToAgent: '',
          error: err.message
        };
      }
    }
  };
}
