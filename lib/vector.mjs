export const LOCAL_EMBEDDING_DIM = 256;
export const LOCAL_EMBEDDING_MODEL = 'qiyi-hybrid-vec-v1';

// High-specificity bilingual semantic concept clusters bridging the lexical gap (dims 0..63).
// Excludes generic conversational verbs/nouns to prevent cross-topic false positives.
const SEMANTIC_CONCEPTS = [
  ['凌晨', '半夜', '深夜', '午夜', '子夜', '00:00', '01:00', '02:00', '03:00', '04:00', 'midnight', 'overnight'],
  ['清晨', '早晨', '拂晓', '黎明', 'morning', 'dawn'],
  ['午后', '傍晚', '黄昏', 'afternoon', 'dusk'],
  ['定时任务', '周期执行', '定期执行', '自动调度', 'cron', 'scheduler', 'crontab'],
  ['卡顿', '变慢', '响应慢', '延迟高', '卡死', '停滞', '卡一下', '不流畅', 'lag', 'slowdown', 'latency', 'stall', 'bottleneck', 'hang', 'freeze'],
  ['内存', '归档', '回收', '清理内存', '释放内存', '释放句柄', '僵尸句柄', '僵尸进程', '快照归档', '冷数据', '垃圾回收', '内存泄漏', 'oom', 'out of memory', 'memory', 'gc', 'garbage collection', 'archive', 'cleanup'],
  ['容器', '守护进程', '工作线程', 'container', 'docker', 'daemon', 'worker thread'],
  ['报错', '异常', '故障', '崩溃', '闪退', '挂了', 'error', 'exception', 'crash', 'fault', 'panic'],
  ['连接超时', '拒绝连接', '断网', '离线', '代理隧道', '端口转发', 'timeout', 'connection refused', 'offline', 'proxy', 'tunnel'],
  ['环境变量', '配置文件', '配置项', 'environment variable', 'dotenv', 'config file'],
  ['密钥', '密码', '授权码', '口令', '令牌', '鉴权', 'api key', 'apikey', 'token', 'secret', 'password', 'credential', 'auth', 'bearer'],
  ['数据库', '索引', '事务', '全表扫描', 'sqlite', 'database', 'sql', 'transaction', 'wal'],
  ['向量', '嵌入', '语义检索', '余弦相似度', '倒排索引', '混合检索', '倒数秩融合', 'vector', 'embedding', 'rag', 'cosine similarity', 'bm25', 'rrf', 'hybrid search'],
  ['备份', '还原', '迁移', '另存为', 'backup', 'restore', 'migration'],
  ['茉莉', '花茶', '绿茶', '红茶', '乌龙茶', '茶席', '冲泡', '茶香', '花香', '品茗', '茶叶', 'jasmine', 'tea', 'brew', 'floral aroma'],
  ['咖啡', '拿铁', '美式咖啡', '浓缩咖啡', '手冲咖啡', '咖啡豆', 'coffee', 'espresso', 'latte', 'caffeine'],
  ['卫星', '火箭', '航天', '发射', '轨道', '飞船', '航天器', '探测器', '太空', '运载火箭', '可回收火箭', 'satellite', 'rocket', 'spacecraft', 'launch', 'orbit', 'deploy', 'deployment', 'reusable rocket', 'aerospace'],
  ['徒步', '登山', '爬山', '远足', '山峰', '露营', '山路', 'hiking', 'hike', 'mountain', 'trail', 'climb', 'camp', 'trekking'],
  ['足球', '篮球', '球场', '体育训练', 'football', 'soccer', 'basketball'],
  ['算法', '排序', '冒泡排序', '快速排序', '归并排序', '时间复杂度', '空间复杂度', '原地排序', '递归', '二分查找', 'algorithm', 'sort', 'sorting', 'bubble sort', 'quicksort', 'complexity', 'recursion'],
  ['函数', '脚本', '编程', '源码', '代码产物', 'python', 'javascript', 'typescript', 'code', 'function', 'script'],
  ['音乐', '歌曲', '听歌', '歌单', '曲库', '歌手', '旋律', '歌词', '切歌', '网易云', 'music', 'song', 'track', 'playlist', 'lyric'],
  ['表情包', '贴纸', '动图', 'sticker', 'emoji', 'gif'],
  ['邮件', '邮箱', '发信', '收件人', '发件箱', 'smtp', 'email', 'inbox', 'outbox'],
  ['知识图谱', '三元组', '实体关系', '遗忘曲线', '半衰期', 'knowledge graph', 'triple', 'half-life'],
  ['宠物', '小窝', '喂食', '抚摸', '亲密度', '猫咪', '小狗', 'pet', 'feed', 'bond'],
  ['开心', '高兴', '快乐', '愉悦', '欣喜', 'happy', 'joy', 'cheerful'],
  ['难过', '伤心', '沮丧', '低落', '疲惫', '焦虑', '烦躁', '委屈', 'sad', 'upset', 'exhausted', 'anxious', 'depressed'],
  ['扫描件', '文字提取', 'pdf', 'docx', 'ocr'],
  ['沙箱', '同源策略', '跨域', '注入攻击', 'sandbox', 'same-origin', 'csrf', 'xss'],
  ['移动端', '响应式', '夜间模式', '滚动条', 'viewport', 'responsive'],
  ['报销', '差旅', '补贴', '发票', '账单', 'reimbursement', 'allowance', 'invoice', 'expense'],
  ['失眠', '熬夜', '睡眠', '作息', '感冒', '发烧', 'sleep', 'insomnia'],
  ['下雨', '晴天', '降温', '刮风', '天气预报', 'weather', 'rain', 'sunny'],
  ['菜谱', '烹饪', '食材', '做饭', 'recipe', 'cooking'],
  ['电脑', '计算机', '笔记本电脑', '显卡', '处理器', '芯片', 'computer', 'laptop', 'cpu', 'gpu'],
  ['并发', '竞态条件', '互斥锁', '死锁', 'concurrency', 'race condition', 'mutex', 'deadlock'],
  ['缓存', '命中率', '淘汰策略', '协商缓存', 'cache', 'etag', 'lru'],
];

const NEGATION_TERMS = ['严禁', '禁止', '切勿', '不要', '不可', '不能', '不准', '禁用', 'never', 'forbid', 'prohibit', 'disable'];
const AFFIRM_TERMS = ['建议', '推荐', '应当', '必须', '开启', '启用', '允许', 'recommend', 'enable', 'allow', 'must'];
const ZH_STOP_CHARS = /[\s的了是在有和与或请按把被不也都就要会能可以及为对从到于中上下个之这那我你他她它人们吗呢吧啊哦]/gu;

export function stemEnglish(word) {
  let w = word.toLowerCase();
  if (w.length <= 3) return w;
  for (const [suffix, replacement] of [
    ['ational', 'ate'], ['tional', 'tion'], ['ements', 'e'], ['ement', 'e'],
    ['ments', ''], ['ment', ''], ['ings', ''], ['ing', ''],
    ['edly', ''], ['ed', ''], ['ies', 'y'], ['es', ''], ['s', ''],
  ]) {
    if (w.endsWith(suffix) && w.length - suffix.length >= 3) {
      w = w.slice(0, w.length - suffix.length) + replacement;
      break;
    }
  }
  return w;
}

function fnv1a(str, seed = 2166136261) {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

export function normalizeVector(values) {
  const vec = new Float32Array(values);
  let normSq = 0;
  for (let i = 0; i < vec.length; i++) normSq += vec[i] * vec[i];
  if (normSq > 1e-12) {
    const invNorm = 1 / Math.sqrt(normSq);
    for (let i = 0; i < vec.length; i++) vec[i] *= invNorm;
  }
  return vec;
}

export function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

export function vectorToBlob(vec) {
  const f32 = vec instanceof Float32Array ? vec : new Float32Array(vec);
  return Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength);
}

export function blobToVector(blob) {
  if (!blob || !blob.byteLength || blob.byteLength % 4 !== 0) return null;
  const aligned = new Uint8Array(blob.byteLength);
  aligned.set(new Uint8Array(blob.buffer, blob.byteOffset, blob.byteLength));
  return new Float32Array(aligned.buffer);
}

export function extractSemanticFeatures(text) {
  const input = String(text || '').normalize('NFKC').toLowerCase();
  const concepts = new Set();
  const subwords = new Set();
  const conceptWeights = new Map();

  // 1. Concept manifold activation
  for (let idx = 0; idx < SEMANTIC_CONCEPTS.length; idx++) {
    const cluster = SEMANTIC_CONCEPTS[idx];
    let hits = 0;
    for (const term of cluster) {
      if (input.includes(term)) hits++;
    }
    if (hits > 0) {
      concepts.add(idx);
      conceptWeights.set(idx, Math.min(2.5, 1 + Math.log1p(hits) * 0.6));
    }
  }

  // 2. English words, morphological stems, and single-letter technical identifiers
  for (const match of input.matchAll(/[a-z0-9_]+/g)) {
    const word = match[0];
    if (word.length >= 2) {
      subwords.add(`w:${word}`);
      const stem = stemEnglish(word);
      if (stem.length >= 3) subwords.add(`st:${stem}`);
    } else if (/^[a-z]$/.test(word)) {
      const after = input.slice((match.index || 0) + 1, (match.index || 0) + 3);
      if (/^[\p{Script=Han}#+-]/u.test(after)) subwords.add(`id:${word}${after[0]}`);
    }
  }

  // 3. Chinese bigrams and content-bearing skip-1 bigrams
  for (const segment of input.match(/[\p{Script=Han}]+/gu) || []) {
    if (segment.length === 1) {
      if (!ZH_STOP_CHARS.test(segment)) subwords.add(`zh:${segment}`);
      ZH_STOP_CHARS.lastIndex = 0;
    } else {
      for (let i = 0; i < segment.length - 1; i++) {
        subwords.add(`zh2:${segment.slice(i, i + 2)}`);
      }
      const cleaned = segment.replace(ZH_STOP_CHARS, '');
      for (let i = 0; i < cleaned.length - 2; i++) {
        subwords.add(`zhs:${cleaned[i]}${cleaned[i + 2]}`);
      }
    }
  }

  // 4. Contextual negation / affirmation polarity
  let negCount = 0;
  let affirmCount = 0;
  for (const term of NEGATION_TERMS) if (input.includes(term)) negCount++;
  for (const term of AFFIRM_TERMS) if (input.includes(term)) affirmCount++;

  return { concepts, conceptWeights, subwords, negCount, affirmCount };
}

export function computeLocalEmbedding(text, precomputed = null) {
  const vec = new Float32Array(LOCAL_EMBEDDING_DIM);
  const { conceptWeights, subwords, negCount, affirmCount } = precomputed || extractSemanticFeatures(text);

  // Layer A (dims 0..63): Semantic concept manifold coordinates
  for (const [idx, weight] of conceptWeights.entries()) {
    if (idx < 64) vec[idx] = weight * 2.8;
  }

  // Layer B (dims 64..71): Contextual polarity & directive modulation
  if (negCount > 0 || affirmCount > 0) {
    const netPolarity = affirmCount - negCount;
    vec[64] = netPolarity * 0.45;
    vec[65] = negCount > 0 ? 0.4 : 0;
    vec[66] = affirmCount > 0 ? 0.4 : 0;
  }

  // Layer C (dims 72..255): Signed random projection of multi-granular subwords & stems
  const projectionSpace = LOCAL_EMBEDDING_DIM - 72;
  for (const feat of subwords) {
    const h1 = fnv1a(feat, 2166136261);
    const h2 = fnv1a(feat, 1469598103);
    const bucket1 = 72 + (h1 % projectionSpace);
    const bucket2 = 72 + (h2 % projectionSpace);
    const sign1 = (h1 & 1) === 0 ? 1 : -1;
    const sign2 = (h2 & 1) === 0 ? 1 : -1;
    const weight = feat.startsWith('st:') || feat.startsWith('id:') ? 1.15 : feat.startsWith('w:') ? 0.75 : 0.35;
    vec[bucket1] += sign1 * weight;
    vec[bucket2] += sign2 * weight * 0.4;
  }

  return normalizeVector(vec);
}

export function hasSemanticOverlap(queryFeatures, docFeatures) {
  for (const c of queryFeatures.concepts) {
    if (docFeatures.concepts.has(c)) return true;
  }
  for (const s of queryFeatures.subwords) {
    if (docFeatures.subwords.has(s)) return true;
  }
  return false;
}
