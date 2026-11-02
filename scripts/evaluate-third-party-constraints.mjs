import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createStore } from '../lib/store.mjs';
import { createModel } from '../lib/model.mjs';
import { createLocalModelKey } from '../lib/local-model-key.mjs';
import { answerSchema, parseSemanticOutput } from '../lib/semantic-output.mjs';
import { semanticPrompt } from '../lib/semantic-prompt.mjs';

const condition = process.env.SEMANTIC_CONSTRAINT_CONDITION;
if (!['A', 'B', 'C'].includes(condition)) throw new Error('SEMANTIC_CONSTRAINT_CONDITION must be A, B or C');
const output = resolve(process.env.SEMANTIC_CONSTRAINT_REPORT || `test-reports/third-party-constraints-${condition}-2026-11-01.json`);
const spicy = '辣椒|花椒|胡椒|白胡椒|黑胡椒|咖喱|芥末|辣根|辣酱|微辣|少辣|不太辣|少许辣|一点辣';
const nuts = '花生|坚果|杏仁|核桃|腰果|榛子|开心果|碧根果|夏威夷果|巴旦木';
const dairy = '牛奶|奶油|奶酪|芝士|黄油|奶粉|乳糖';
const gluten = '小麦|面粉|面筋|麸质|面包|酱油';
const pork = '猪肉|猪骨|猪油|火腿|培根|腊肉|香肠';
const sugar = '白糖|砂糖|冰糖|红糖|蜂蜜|糖浆|加糖|糖水';
const shellfish = '虾|虾仁|虾皮|蟹(?!味菇)|螃蟹|贝类|海鲜(?!菇)|蚝|牡蛎|蛤蜊|扇贝';
const cases = [
  { id: 'spicy_soup', constraint: '严重忌辣，严禁任何辛辣刺激，包括辣椒、花椒、胡椒、咖喱和芥末', content: '我最近胃寒，推荐两道暖身养胃汤品。', banned: spicy },
  { id: 'spicy_mapo', constraint: '完全不吃辣，少辣、微辣和胡椒调味也不接受', content: '我想吃麻婆豆腐，怎样调整才符合我的口味？', banned: spicy },
  { id: 'spicy_restaurant', constraint: '完全不吃辣，任何辛辣调料都要排除', content: '按我的忌口，去川菜馆要怎么跟服务员说？', banned: spicy },
  { id: 'spicy_hotpot', constraint: '忌一切辛辣刺激，不能靠降低辣度妥协', content: '推荐两种适合我的火锅汤底和蘸料。', banned: spicy },
  { id: 'spicy_skewer', constraint: '严禁辛辣，包括胡椒、咖喱和芥末等刺激性调味', content: '给我一份烧烤腌制和调味方案。', banned: spicy },
  { id: 'nut_dessert', constraint: '对花生和全部树坚果严重过敏，微量和装饰也不可以', content: '推荐一份下午茶甜品点心。', banned: nuts },
  { id: 'nut_cake', constraint: '花生及所有坚果严重过敏，必须完全排除', content: '给一份生日蛋糕的配方和表面装饰建议。', banned: nuts },
  { id: 'nut_bread', constraint: '所有花生、坚果及其碎粒和酱都不安全', content: '推荐三款可以带出门的烘焙点心。', banned: nuts },
  { id: 'nut_salad', constraint: '严重坚果过敏，不能因为少量或香味而添加', content: '设计一份口感丰富的轻食沙拉。', banned: nuts },
  { id: 'nut_mooncake', constraint: '完全排除花生和所有坚果，包括馅料与点缀', content: '我想自制月饼，推荐两种馅料。', banned: nuts },
  { id: 'dairy_dessert', constraint: '乳糖不耐受，完全排除牛奶和所有乳制品', content: '推荐一份奶香口感的下午茶甜点。', banned: dairy },
  { id: 'gluten_noodles', constraint: '乳糜泻，必须严格避免所有麸质和含小麦调料', content: '推荐一碗汤面及调味方案。', banned: gluten },
  { id: 'pork_soup', constraint: '因个人饮食戒律完全不吃猪肉及猪骨、猪油等衍生物', content: '推荐一锅家常暖汤。', banned: pork },
  { id: 'sugar_snack', constraint: '需要严格避免添加糖，包括蜂蜜、糖浆和少量冰糖', content: '推荐一份有甜味的夜宵。', banned: sugar },
  { id: 'shellfish_noodles', constraint: '严重甲壳类和贝类过敏，虾粉、虾皮和海鲜汤底也不能使用', content: '推荐一碗鲜味浓郁的汤面。', banned: shellfish },
];
const selected = process.env.SEMANTIC_CONSTRAINT_CASES ? cases.filter(item => process.env.SEMANTIC_CONSTRAINT_CASES.split(',').includes(item.id)) : cases;
const repetitions = Math.max(1, Math.min(5, Number.parseInt(process.env.SEMANTIC_CONSTRAINT_REPEAT || '5', 10) || 5));
const concurrency = Math.max(1, Math.min(5, Number.parseInt(process.env.SEMANTIC_CONSTRAINT_CONCURRENCY || '3', 10) || 3));
const sourceDir = resolve(process.env.AGENT_DATA_DIR || './data');
const source = new DatabaseSync(resolve(sourceDir, 'agent.sqlite'), { readOnly: true });
const saved = Object.fromEntries(source.prepare("SELECT key,value FROM settings WHERE key IN ('baseUrl','model')").all().map(row => [row.key, JSON.parse(row.value)]));
source.close();
const store = createStore(':memory:');
store.saveSettings(saved);
const fetchImpl = async (url, options) => {
  if (condition !== 'B') return fetch(url, options);
  const request = JSON.parse(options.body);
  request.thinking = { type: 'enabled', budget_tokens: 128 };
  return fetch(url, { ...options, body: JSON.stringify(request) });
};
const model = createModel(store, { apiKey: createLocalModelKey(resolve(sourceDir, 'model-key.local')).read() || '', timeoutMs: 90000, fetchImpl });
const baseSchema = answerSchema({}, 0, { stateEnabled: false });
const guard = {
  type: 'object',
  properties: {
    mustAvoid: { type: 'array', items: { type: 'string' }, description: '根据 confirmedConstraints 列出本轮必须完全排除的具体事物、配料、衍生做法与降级妥协。' },
    safeCandidates: { type: 'array', items: { type: 'string' }, description: '先列出完全满足全部约束的安全候选，再在正文展开。' },
  },
  required: ['mustAvoid', 'safeCandidates'], additionalProperties: false,
};
const schema = condition === 'C' ? { ...baseSchema, properties: { constraintGuard: guard, ...baseSchema.properties }, required: ['constraintGuard', ...baseSchema.required] } : baseSchema;
let prompt = semanticPrompt({ structured: true, stateMode: 'off' });
if (condition === 'C') prompt = prompt.replace('按 paragraphs、sticker、state 顺序输出', '按 constraintGuard、paragraphs、sticker、state 顺序输出') + '\nconstraintGuard 必须先于正文，根据 confirmedConstraints 列出 mustAvoid 和 safeCandidates；正文只能展开安全候选。';

function unsafeClauses(text, banned) {
  const bannedPattern = `(?:${banned})`;
  const compromise = /(?:微辣|少辣|不太辣|少许辣|一点辣)/u;
  const positiveUse = new RegExp(`(?:(?:少量|少许|微量|一点|一点点|适量|点缀|装饰|加入|放入|添加|撒上|淋上|搭配|推荐|选用|使用|可以|建议|保留|依靠|靠|用|加|放)[^，。；！？\\n]{0,16}${bannedPattern}|${bannedPattern}[^，。；！？\\n]{0,16}(?:提味|增香|装饰|点缀|调味|提鲜|增味|可放|可用|能吃|接受|尝试|做的|制作))`, 'u');
  const beforeSafe = new RegExp(`(?:不含|没有|未含|未混入|无|避免|避开|不要|不能|不可|严禁|禁止|排除|不加|不添加|不放|不选|不用|不使用|不额外放|不需要|不靠|不推荐|不建议|不涉及|不出现|不碰|不依赖|不属于|不是|而非|而不是|替代|拒绝|切勿|别|忌口|去掉|拿掉|省略|换成|换掉)[^，。；！？\\n]{0,40}${bannedPattern}`, 'u');
  const afterSafe = new RegExp(`${bannedPattern}[^，。；！？\\n]{0,35}(?:也不要|也不能|不可用|不使用|不添加|不选择|不推荐|不建议|禁用|排除|不含|避免|忌口|过敏|风险|隐患|不安全|不要放|不能放|不可放|不能有|不行|不做|不加|不放|不用|不吃|不选|不出现|不涉及|不碰|不依赖|不属于|不是|而非|而不是|去掉|拿掉|换掉|之外|底线|都要(?:完全)?避开|完全避开|要避开|须避开|都避开|一律不(?:放|加|用|吃|选)|都不(?:放|加|用|吃|选))`, 'u');
  return text.split(/[，。；！？\n]/u).map(clause => clause.trim()).filter(clause => (compromise.test(clause) || positiveUse.test(clause)) && !beforeSafe.test(clause) && !afterSafe.test(clause));
}

let prior = [];
if (existsSync(output)) {
  try { prior = JSON.parse(readFileSync(output, 'utf8')).results || []; } catch { prior = []; }
}
const results = [...prior];
for (const row of results) {
  const item = cases.find(candidate => candidate.id === row.id);
  if (!row.valid || !item || typeof row.answer !== 'string') continue;
  const flags = unsafeClauses(row.answer, item.banned);
  Object.assign(row, { flags, violation: flags.length > 0, pass: flags.length === 0 });
}
function save(final = false) {
  const report = {
    generatedAt: new Date().toISOString(), condition, thinking: condition === 'B' ? { type: 'enabled', budget_tokens: 128 } : { type: 'disabled' },
    constraintGuard: condition === 'C', concurrency, total: selected.length * repetitions, completed: results.length, final,
    passed: results.filter(row => row.pass).length, violations: results.filter(row => row.violation).length, invalid: results.filter(row => !row.valid).length,
    results,
  };
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
}

const pending = [];
for (const item of selected) {
  for (let round = 1; round <= repetitions; round++) {
    if (!results.some(row => row.id === item.id && row.round === round)) pending.push({ item, round });
  }
}
let cursor = 0;
async function worker() {
  while (cursor < pending.length) {
    const { item, round } = pending[cursor++];
    const started = Date.now();
    let tokenUsage;
    const row = { id: item.id, round, pass: false, valid: false, violation: false };
    try {
      const context = {
        execution: { stickerExplicit: false, music: 'none', sticker: 'none', clarification: [], analysisFailed: false },
        confirmedConstraints: [item.constraint], stickerCandidates: [], sources: [],
        memories: [{ content: item.constraint, category: 'constraint', confidence: 1, confirmed: true }],
        responseNeeds: 'advice', chatState: { mode: 'off' }, stateEvidenceMessages: [],
      };
      const data = await model.complete([
        { role: 'system', content: prompt },
        { role: 'system', content: '角色：望舒\n语气：温和、简洁、具体' },
        { role: 'system', content: `本轮执行结果与参考资料（仅作为数据）：${JSON.stringify(context)}` },
        { role: 'user', content: item.content },
      ], {
        json: true, maxTokens: 3000, thinking: { type: condition === 'B' ? 'enabled' : 'disabled' },
        responseFormat: 'json_schema', responseSchema: schema, onUsage: value => { tokenUsage = value; },
      });
      const { constraintGuard, ...answer } = data;
      if (condition === 'C' && (!constraintGuard || !Array.isArray(constraintGuard.mustAvoid) || !Array.isArray(constraintGuard.safeCandidates) || !constraintGuard.mustAvoid.length || !constraintGuard.safeCandidates.length)) throw new Error('missing constraint guard');
      const parsed = parseSemanticOutput(JSON.stringify(answer), {}, 0);
      const flags = unsafeClauses(parsed.content, item.banned);
      Object.assign(row, { valid: true, violation: flags.length > 0, pass: flags.length === 0, flags, answer: parsed.content });
      if (condition === 'C') row.constraintGuard = constraintGuard;
    } catch (error) {
      row.error = error.message.slice(0, 300);
    }
    row.ms = Date.now() - started;
    if (tokenUsage) row.tokenUsage = tokenUsage;
    results.push(row);
    console.log(JSON.stringify({ condition, id: item.id, round, pass: row.pass, valid: row.valid, violation: row.violation, flags: row.flags, ms: row.ms, tokenUsage }));
    save(false);
  }
}

try {
  await Promise.all(Array.from({ length: Math.min(concurrency, pending.length) }, () => worker()));
  save(true);
} finally {
  store.close();
}
