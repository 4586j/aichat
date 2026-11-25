import { AppError } from './model.mjs';

function normalizeFloat(value) {
  if (Number.isInteger(value)) return value;
  const cleaned = Number(value.toPrecision(12));
  return Object.is(cleaned, -0) ? 0 : cleaned;
}

function parseIsoDateUtc(dateStr, fieldName = '日期') {
  if (typeof dateStr !== 'string') throw new AppError(`${fieldName}必须是 YYYY-MM-DD 格式字符串。`);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
  if (!match) throw new AppError(`${fieldName}格式无效，请使用 YYYY-MM-DD（例如 2026-11-23）。`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const ms = Date.UTC(year, month - 1, day);
  const check = new Date(ms);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    throw new AppError(`${fieldName}不是合法的日历日期: ${dateStr}`);
  }
  return { ms, iso: `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` };
}

function formatUtcDate(ms) {
  const d = new Date(ms);
  const y = String(d.getUTCFullYear()).padStart(4, '0');
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const weekday = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'][d.getUTCDay()];
  return { iso: `${y}-${m}-${day}`, weekday };
}

export function computeDataStats(values) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new AppError('统计数据 values 必须是非空数字数组。');
  }
  if (values.length > 10000) {
    throw new AppError('单次统计数据量不能超过 10000 条。');
  }
  const nums = values.map((v, i) => {
    const n = typeof v === 'number' ? v : Number(v);
    if (!Number.isFinite(n)) throw new AppError(`第 ${i + 1} 项不是有限数值: ${v}`);
    return n;
  });
  const count = nums.length;
  const sum = normalizeFloat(nums.reduce((acc, n) => acc + n, 0));
  const mean = normalizeFloat(sum / count);
  const sorted = [...nums].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[count - 1];
  const range = normalizeFloat(max - min);
  const mid = Math.floor(count / 2);
  const median = count % 2 === 0
    ? normalizeFloat((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];
  const variance = normalizeFloat(nums.reduce((acc, n) => acc + (n - mean) ** 2, 0) / count);
  const stdDev = normalizeFloat(Math.sqrt(variance));
  return { count, sum, mean, median, min, max, range, variance, stdDev };
}

export function computeDateCalculation({ mode, startDate, endDate, baseDate, offsetDays }) {
  const DAY_MS = 24 * 60 * 60 * 1000;
  if (mode === 'diff') {
    const start = parseIsoDateUtc(startDate, 'startDate');
    const end = parseIsoDateUtc(endDate, 'endDate');
    const diffDays = Math.round((end.ms - start.ms) / DAY_MS);
    const absDays = Math.abs(diffDays);
    return {
      mode: 'diff',
      startDate: start.iso,
      endDate: end.iso,
      diffDays,
      absDays,
      weeks: Math.floor(absDays / 7),
      remainingDays: absDays % 7
    };
  }
  if (mode === 'offset') {
    const baseStr = baseDate || new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
    const base = parseIsoDateUtc(baseStr, 'baseDate');
    const delta = Number(offsetDays);
    if (!Number.isInteger(delta) || Math.abs(delta) > 365000) {
      throw new AppError('offsetDays 必须是合理的整数天数。');
    }
    const target = formatUtcDate(base.ms + delta * DAY_MS);
    return {
      mode: 'offset',
      baseDate: base.iso,
      offsetDays: delta,
      resultDate: target.iso,
      weekday: target.weekday
    };
  }
  throw new AppError('date_calculator 的 mode 必须是 "diff" 或 "offset"。');
}

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
    return normalizeFloat(result);
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

  // 4. Data Statistics (Deterministic Aggregation)
  registerSkill({
    type: 'function',
    function: {
      name: 'data_stats',
      description: '对一组数值执行精准的描述性统计（计数、总和、均值、中位数、极值、极差、方差、标准差）。涉及账单汇总、成绩分析或批量数据统计时请调用此工具。',
      parameters: {
        type: 'object',
        properties: {
          values: {
            type: 'array',
            items: { type: 'number' },
            description: '待统计的数值数组，例如 [12.5, 30, 45.8]'
          }
        },
        required: ['values']
      }
    }
  }, async (args) => computeDataStats(args.values), { safe: true });

  // 5. Date Calculator (Deterministic Calendar Arithmetic)
  registerSkill({
    type: 'function',
    function: {
      name: 'date_calculator',
      description: '执行精准的日历天数差值计算（diff）或日期加减推算（offset）。涉及相差几天、倒计时、推算未来或过去某天是星期几时请调用此工具。',
      parameters: {
        type: 'object',
        properties: {
          mode: { type: 'string', enum: ['diff', 'offset'], description: 'diff 表示计算两个日期的天数差；offset 表示基准日期加减天数' },
          startDate: { type: 'string', description: 'diff 模式起始日期（YYYY-MM-DD）' },
          endDate: { type: 'string', description: 'diff 模式结束日期（YYYY-MM-DD）' },
          baseDate: { type: 'string', description: 'offset 模式基准日期（YYYY-MM-DD，省略则默认今天）' },
          offsetDays: { type: 'integer', description: 'offset 模式偏移天数（正数向后，负数向前）' }
        },
        required: ['mode']
      }
    }
  }, async (args) => computeDateCalculation(args), { safe: true });

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
