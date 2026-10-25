import { readFileSync } from 'node:fs';
import { AppError } from './model.mjs';
import { chunkText, rankText } from './knowledge.mjs';
import { readLimited } from './media-common.mjs';

export const GUIDE_REPOSITORY = '4586j/aichat';
export const GUIDE_REMOTE_URL = `https://api.github.com/repos/${GUIDE_REPOSITORY}/contents/docs/configuration/guide-bundle.json?ref=main`;
const bundled = JSON.parse(readFileSync(new URL('../docs/configuration/guide-bundle.json', import.meta.url), 'utf8'));
const appVersion = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const MAX_BYTES = 512 * 1024;
const sameRevision = (a, b) => a.slice(0, 10).localeCompare(b.slice(0, 10)) || Number(a.split('.')[1]) - Number(b.split('.')[1]);
function invalid() { return new AppError('GitHub 文档包格式、修订号或适用版本不匹配，继续使用现有指南。', 502); }
export function validateGuideBundle(input) {
  if (!input || input.schemaVersion !== 1 || input.appVersion !== appVersion || typeof input.revision !== 'string'
    || !/^\d{4}-\d{2}-\d{2}\.[1-9]\d{0,3}$/.test(input.revision) || Number.isNaN(Date.parse(input.revision.slice(0, 10)))
    || !Array.isArray(input.documents) || input.documents.length !== bundled.documents.length || Buffer.byteLength(JSON.stringify(input)) > MAX_BYTES) throw invalid();
  const seen = new Set();
  const documents = input.documents.map(doc => {
    const expected = bundled.documents.find(item => item.id === doc?.id);
    if (!expected || seen.has(doc.id) || doc.path !== expected.path || typeof doc.title !== 'string' || !doc.title.trim() || doc.title.length > 100
      || !Array.isArray(doc.keywords) || doc.keywords.length > 20 || doc.keywords.some(word => typeof word !== 'string' || !word || word.length > 40)
      || typeof doc.content !== 'string' || doc.content.trim().length < 50 || doc.content.length > 18_000 || /\x00/.test(doc.content)) throw invalid();
    seen.add(doc.id);
    return { id: doc.id, title: doc.title.trim(), path: doc.path, keywords: [...doc.keywords], content: doc.content.trim() };
  });
  return { schemaVersion: 1, appVersion, revision: input.revision, documents };
}
const intent = value => /配置|设置|接入|连接|启动|部署|安装|接口|认证|鉴权|报错|失败|超时|打不开|没声音|不播放|收不到|授权码|smtp|base\s*url|api\s*key|服务地址|端口|环境变量|怎么用|如何用|怎么上传|在哪填|哪里填|怎么填|填什么/i.test(value);
const subject = value => /栖忆|本项目|本应用|模型|ai\b|邮件|邮箱|smtp|音乐|歌曲|表情|贴纸|图库|base\s*url|api\s*key|服务地址|环境变量|npm|node/i.test(value);
export function guideQuery(content, history = []) {
  if (intent(content) && subject(content)) return content;
  if (content.length <= 180 && /^(那|这个|这里|这样|然后|接下来|还|再|为什么|怎么|需要|填|用哪个|在哪|可以|不行|还是|报错)/.test(content.trim())) {
    const previous = history.filter(row => row.role === 'user').slice(-2).reverse().find(row => intent(row.content) && subject(row.content));
    if (previous) return `${previous.content.slice(0, 1000)}\n${content}`;
  }
  return '';
}

export function createGuides(store, { guideFetchImpl = fetch, guideClock = Date.now, guideTimeoutMs = 8000 } = {}) {
  let bundle = validateGuideBundle(bundled), source = 'builtin', etag = '', lastSyncedAt = null, lastCheckedAt = null, lastError = '';
  let pending = null, lastAttempt = -Infinity, chunks;
  try {
    const cache = JSON.parse(store.get('SELECT value FROM configuration_guides WHERE id=1')?.value || 'null');
    if (cache) {
      const restored = validateGuideBundle(cache.bundle);
      if (sameRevision(restored.revision, bundle.revision) >= 0) {
        bundle = restored; source = 'github'; etag = typeof cache.etag === 'string' && /^[\x20-\x7e]{0,200}$/.test(cache.etag) ? cache.etag : '';
        lastSyncedAt = typeof cache.syncedAt === 'string' && Number.isFinite(Date.parse(cache.syncedAt)) ? cache.syncedAt : null;
      }
    }
  } catch { /* A corrupt or incompatible cache cannot replace the bundled manual. */ }
  function rebuild() {
    chunks = bundle.documents.flatMap(doc => chunkText(doc.content, 1100, 120).map((content, i) => ({
      id: `guide:${doc.id}:${i + 1}`, documentId: `guide:${doc.id}`, guideId: doc.id,
      name: `配置指南 · ${doc.title}`, index: i + 1, content,
      searchText: `${doc.title} ${doc.keywords.join(' ')}\n${content}`,
      kind: 'configuration-guide', origin: source, revision: bundle.revision, url: `/guides/${doc.id}.md`,
    })));
  }
  rebuild();
  function bootstrap() {
    return { repository: GUIDE_REPOSITORY, appVersion, revision: bundle.revision, source, lastSyncedAt, lastCheckedAt, lastError,
      documents: bundle.documents.map(({ content, ...doc }) => ({ ...doc, url: `/guides/${doc.id}.md`, githubUrl: `https://github.com/${GUIDE_REPOSITORY}/blob/main/${doc.path}` })) };
  }
  function get(id) {
    const document = bundle.documents.find(doc => doc.id === id);
    if (!document) throw new AppError('配置指南不存在。', 404);
    return { ...document, source, revision: bundle.revision, appVersion, url: `/guides/${id}.md` };
  }
  function search(content, history = []) {
    const query = guideQuery(content, history);
    if (!query) return [];
    const preferred = /smtp|邮箱|邮件|授权码|发信/i.test(query) ? 'email' : /音乐|歌曲|曲库|音量|网易云|qq/i.test(query) ? 'music'
      : /表情|贴纸|图库|动图|gif/i.test(query) ? 'stickers' : /模型|base\s*url|api\s*key/i.test(query) ? 'model' : '';
    const ranked = rankText(query, chunks, 'searchText').map(row => ({ ...row, relevance: row.relevance * (row.guideId === preferred ? 2.5 : 1) })).sort((a, b) => b.relevance - a.relevance);
    const perDocument = new Map();
    return ranked.filter(row => { const count = perDocument.get(row.guideId) || 0; perDocument.set(row.guideId, count + 1); return count < 2; }).slice(0, 3)
      .map(({ searchText, relevance, ...row }) => ({ ...row, score: Number(relevance.toFixed(4)) }));
  }
  async function sync() {
    if (pending) return pending;
    if (guideClock() - lastAttempt < 60_000) throw new AppError('刚刚检查过 GitHub，请一分钟后再试；现有指南仍可使用。', 429);
    lastAttempt = guideClock(); lastCheckedAt = new Date(guideClock()).toISOString(); lastError = '';
    pending = (async () => {
      try {
        const response = await guideFetchImpl(GUIDE_REMOTE_URL, { redirect: 'error', signal: AbortSignal.timeout(guideTimeoutMs),
          headers: { Accept: 'application/vnd.github.raw+json', 'X-GitHub-Api-Version': '2026-03-10', 'User-Agent': 'qiyi-configuration-guides', ...(etag ? { 'If-None-Match': etag } : {}) } });
        if (response.status === 304) {
          await response.body?.cancel();
          if (!etag || source !== 'github') throw invalid();
          return { guides: bootstrap(), message: 'GitHub 指南没有变化，继续使用已下载的副本。' };
        }
        if (!response.ok) {
          await response.body?.cancel();
          if (response.status === 404) throw new AppError('GitHub 文档不可读取：请确认仓库公开且文档包已提交推送。继续使用现有指南。', 502);
          if ([403, 429].includes(response.status)) throw new AppError('GitHub 暂时拒绝请求或限流，继续使用现有指南，稍后再更新。', 502);
          throw new AppError('GitHub 文档读取失败，继续使用现有指南。', 502);
        }
        const bytes = await readLimited(response, MAX_BYTES);
        const candidate = validateGuideBundle(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
        if (sameRevision(candidate.revision, bundle.revision) < 0) throw new AppError('GitHub 文档修订较旧，保留当前指南。', 409);
        const nextEtag = response.headers.get('etag') || '';
        const syncedAt = new Date(guideClock()).toISOString();
        const safeEtag = /^[\x20-\x7e]{0,200}$/.test(nextEtag) ? nextEtag : '';
        store.run('INSERT INTO configuration_guides(id,value) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value', JSON.stringify({ bundle: candidate, etag: safeEtag, syncedAt }));
        bundle = candidate; etag = safeEtag; source = 'github'; lastSyncedAt = syncedAt; rebuild();
        return { guides: bootstrap(), message: 'GitHub 指南已更新并保存在本地，断网后也可查阅。' };
      } catch (error) {
        lastError = error instanceof AppError && !/媒体响应/.test(error.message) ? error.message : '无法读取或验证 GitHub 文档，继续使用现有指南。';
        throw new AppError(lastError, error instanceof AppError ? error.status : 502);
      }
    })();
    try { return await pending; } finally { pending = null; }
  }
  return { bootstrap, get, search, sync };
}
