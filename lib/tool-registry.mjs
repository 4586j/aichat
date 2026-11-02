import { AppError } from './model.mjs';

/**
 * Safely evaluates a mathematical expression without arbitrary code execution.
 */
export function safeEvaluateMath(expr) {
  if (typeof expr !== 'string' || !expr.trim()) throw new AppError('计算表达式不能为空。');
  const sanitized = expr.trim();
  // Strictly whitelist numbers, whitespace, standard operators and safe Math functions
  if (!/^[0-9+\-*/%().,^\s]|Math\.(?:abs|sqrt|cbrt|round|floor|ceil|pow|min|max|sin|cos|tan|log|log10|log2|exp|PI|E)/.test(sanitized)) {
    // Check characters
    if (/[^0-9+\-*/%().,\s^eE]|(?:__|\b(?:eval|Function|window|global|process|require|import|constructor|prototype)\b)/i.test(sanitized)) {
      throw new AppError('数学表达式包含不允许的字符或非法标识符。');
    }
  }

  // Replace ^ with ** for power
  const code = sanitized.replace(/\^/g, '**');

  // Verify only allowed tokens
  const tokens = code.match(/[a-zA-Z_$][a-zA-Z0-9_$]*/g) || [];
  const allowedIdentifiers = new Set(['Math', 'abs', 'sqrt', 'cbrt', 'round', 'floor', 'ceil', 'pow', 'min', 'max', 'sin', 'cos', 'tan', 'log', 'log10', 'log2', 'exp', 'PI', 'E']);
  for (const token of tokens) {
    if (!allowedIdentifiers.has(token)) {
      throw new AppError(`表达式包含未授权的函数或标识符: [${token}]`);
    }
  }

  try {
    const fn = new Function('Math', `"use strict"; return (${code});`);
    const result = fn(Math);
    if (typeof result !== 'number' || !Number.isFinite(result)) {
      throw new AppError('计算结果不是有限数值。');
    }
    return result;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(`计算表达式求值失败: ${err.message}`);
  }
}

export function createToolRegistry({ knowledge = null, store = null } = {}) {
  const tools = new Map();

  function registerSkill(definition, handler, { safe = false } = {}) {
    if (!definition?.function?.name) throw new AppError('Skill definition 必须包含 function.name');
    const name = definition.function.name;
    tools.set(name, {
      definition: {
        type: 'function',
        function: {
          name,
          description: definition.function.description || '',
          parameters: definition.function.parameters || { type: 'object', properties: {} }
        }
      },
      handler,
      safe,
      source: 'builtin'
    });
  }

  function registerMcpTool(toolDef, mcpClient, { safe = false } = {}) {
    const name = toolDef.name;
    tools.set(name, {
      definition: {
        type: 'function',
        function: {
          name,
          description: toolDef.description || '',
          parameters: toolDef.inputSchema || { type: 'object', properties: {} }
        }
      },
      handler: async (args, context) => {
        return mcpClient.callTool(name, args, context);
      },
      safe,
      source: 'mcp'
    });
  }

  // Register built-in skills:
  // 1. Calculator
  registerSkill({
    type: 'function',
    function: {
      name: 'calculator',
      description: '执行精准数学表达式计算。当需要进行数学运算、百分比、乘除幂次或几何代数计算时调用。',
      parameters: {
        type: 'object',
        properties: {
          expression: { type: 'string', description: '待计算的数学表达式，例如 "12.5 * 4 - 3 / 2" 或 "Math.sqrt(144)"' }
        },
        required: ['expression']
      }
    }
  }, async (args) => {
    const expr = args.expression ?? args.expr;
    const value = safeEvaluateMath(expr);
    return { expression: expr, result: value };
  }, { safe: true });

  // 2. Knowledge Deep Search
  if (knowledge) {
    registerSkill({
      type: 'function',
      function: {
        name: 'knowledge_deep_search',
        description: '在本地知识库中发起多关键词深度语义与全文检索。当回答需要更多专业知识事实支持时主动调用。',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '检索关键词或子问题' },
            limit: { type: 'integer', description: '期望召回的条数 (1-10)', minimum: 1, maximum: 10 }
          },
          required: ['query']
        }
      }
    }, async (args) => {
      const q = String(args.query || '').trim();
      if (!q) throw new AppError('检索词不能为空。');
      const limit = Math.min(10, Math.max(1, Number(args.limit) || 5));
      const results = knowledge.search(q, limit);
      return {
        query: q,
        count: results.length,
        results: results.map((r, i) => ({
          citation: i + 1,
          name: r.name,
          chunk: r.index,
          content: r.content
        }))
      };
    }, { safe: true });
  }

  // 3. System Time and Environment
  registerSkill({
    type: 'function',
    function: {
      name: 'get_system_time',
      description: '获取当前系统的真实日期、时间和星期。当用户询问时间、今天星期几或计算相对日期时调用。',
      parameters: { type: 'object', properties: {} }
    }
  }, async () => {
    const d = new Date();
    return {
      iso: d.toISOString(),
      localeTime: d.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
      weekday: ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'][d.getDay()]
    };
  }, { safe: true });

  return {
    registerSkill,
    registerMcpTool,
    getTool(name) {
      return tools.get(name);
    },
    listDefinitions() {
      return Array.from(tools.values()).map(t => t.definition);
    },
    async execute(name, args, context = {}) {
      const tool = tools.get(name);
      if (!tool) throw new AppError(`未找到注册的工具或技能: [${name}]`, 404);
      return tool.handler(args, context);
    },
    has(name) {
      return tools.has(name);
    },
    size() {
      return tools.size;
    }
  };
}
