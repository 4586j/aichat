import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createStore } from './lib/store.mjs';
import { createService } from './lib/service.mjs';
import { AppError } from './lib/model.mjs';
import { PET_CATALOG } from './lib/pets.mjs';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const STATIC = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/media.js', ['media.js', 'text/javascript; charset=utf-8']],
  ['/media.css', ['media.css', 'text/css; charset=utf-8']],
  ['/mail.js', ['mail.js', 'text/javascript; charset=utf-8']],
  ['/mail.css', ['mail.css', 'text/css; charset=utf-8']],
  ['/guides.js', ['guides.js', 'text/javascript; charset=utf-8']],
  ['/guides.css', ['guides.css', 'text/css; charset=utf-8']],
  ['/pets.js', ['pets.js', 'text/javascript; charset=utf-8']],
  ['/pets.css', ['pets.css', 'text/css; charset=utf-8']],
  ['/llms.txt', ['../llms.txt', 'text/plain; charset=utf-8']],
  ['/memory-graph.js', ['memory-graph.js', 'text/javascript; charset=utf-8']],
  ['/memory-graph.css', ['memory-graph.css', 'text/css; charset=utf-8']],
  ['/vendor/cytoscape.esm.min.mjs', ['../node_modules/cytoscape/dist/cytoscape.esm.min.mjs', 'text/javascript; charset=utf-8']],
]);
for (const pet of PET_CATALOG) STATIC.set(pet.image, [pet.image.slice(1), 'image/png']);
const MAX_BODY = 12 * 1024 * 1024;

async function readJson(request) {
  if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new AppError('写入请求必须使用 application/json。', 415);
  if (Number(request.headers['content-length']) > MAX_BODY) throw new AppError('请求超过 12 MiB。', 413);
  const buffers = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY) throw new AppError('请求超过 12 MiB。', 413);
    buffers.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(buffers).toString('utf8') || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not object');
    return value;
  } catch { throw new AppError('请求必须是有效的 JSON 对象。'); }
}

async function route(api, method, pathname, input, query) {
  const parts = pathname.split('/').filter(Boolean).map(decodeURIComponent);
  const [, resource, itemId, action] = parts;
  if (parts.length > 4) throw new AppError('接口不存在。', 404);
  if (method === 'GET' && pathname === '/api/bootstrap') return api.bootstrap();
  if (method === 'GET' && pathname === '/api/pets') return api.pets.bootstrap();
  if (method === 'PUT' && pathname === '/api/pets/settings') return api.pets.update(input);
  if (method === 'POST' && pathname === '/api/pets/interact') return api.pets.interact(input);
  if (method === 'PUT' && resource === 'pets' && itemId && !action) return api.pets.rename(itemId, input);
  if (method === 'GET' && pathname === '/api/guides') return { guides: api.guides.bootstrap() };
  if (method === 'GET' && resource === 'guides' && itemId && !action) return { document: api.guides.get(itemId) };
  if (method === 'POST' && pathname === '/api/guides/sync') return api.guides.sync();
  if (pathname === '/api/mail/settings') {
    if (method === 'GET') return api.mail.bootstrap();
    if (method === 'PUT') return api.mail.update(input);
  }
  if (method === 'POST' && pathname === '/api/mail/verify') return api.mail.verify();
  if (method === 'POST' && pathname === '/api/mail/draft') return api.mail.draft(input);
  if (method === 'POST' && pathname === '/api/mail/prepare') return api.mail.prepare(input);
  if (method === 'POST' && pathname === '/api/mail/send') return api.mail.send(input);
  if (method === 'GET' && pathname === '/api/mail/history') return { history: api.mail.list() };
  if (method === 'DELETE' && resource === 'mail' && itemId === 'history' && action) return api.mail.remove(action);
  if (pathname === '/api/media/settings') {
    if (method === 'GET') return api.media.bootstrap();
    if (method === 'PUT') return api.media.update(input);
  }
  if (resource === 'media' && itemId === 'stickers') {
    if (method === 'POST' && !action) return api.media.upload(input);
    if (method === 'PUT' && action) return api.media.edit(action,input);
    if (method === 'DELETE' && action) return api.media.remove(action);
  }
  if (method === 'GET' && pathname === '/api/music/status') return api.media.music.status();
  if (method === 'GET' && pathname === '/api/music/search') return api.media.music.search(query.get('q') || '', query.get('source') || api.media.settings().musicSource);
  if (method === 'GET' && pathname === '/api/music/song') return { song:api.media.music.get(query.get('id')) };
  if (method === 'GET' && pathname === '/api/graph') {
    const archived = query.get('includeArchived') ?? 'false';
    if (!['true', 'false'].includes(archived)) throw new AppError('归档筛选必须为 true 或 false。');
    return api.getGraph({ personaId: query.get('personaId'), includeArchived: archived === 'true' });
  }
  if (method === 'POST' && pathname === '/api/graph/extract') return api.extractGraph(input);
  if (resource === 'settings' && parts.length === 2) {
    if (method === 'GET') return { settings: api.model.settings() };
    if (method === 'PUT') return api.updateSettings(input);
  }
  if (method === 'POST' && pathname === '/api/settings/test') return api.testModel();
  if (method === 'POST' && pathname === '/api/analyze') return api.analyze(input);
  if (resource === 'personas' && !action) {
    if (method === 'POST' && !itemId) return api.savePersona(input);
    if (method === 'PUT' && itemId) return api.savePersona(input, itemId);
  }
  if (resource === 'conversations') {
    if (method === 'POST' && !itemId) return api.createConversation(input);
    if (method === 'GET' && itemId && !action) return api.getConversation(itemId);
    if (method === 'POST' && itemId && action === 'messages') return api.sendMessage(itemId, input);
  }
  if (resource === 'documents' && !action) {
    if (method === 'POST' && !itemId) return api.importDocument(input);
    if (method === 'DELETE' && itemId) return api.deleteDocument(itemId);
  }
  if (method === 'POST' && pathname === '/api/knowledge/search') return api.searchKnowledge(input);
  if (resource === 'memories' && !action) {
    if (method === 'POST' && itemId === 'summarize') return api.summarize(input);
    if (method === 'POST' && itemId === 'maintain') return api.memory.maintain();
    if (method === 'POST' && !itemId) return api.saveMemory(input);
    if (method === 'PUT' && itemId) return api.saveMemory(input, itemId);
    if (method === 'DELETE' && itemId) return api.deleteMemory(itemId);
  }
  if (resource === 'tasks') {
    if (method === 'POST' && !itemId) return api.saveTask(input);
    if (method === 'PUT' && itemId && !action) return api.saveTask(input, itemId);
    if (method === 'DELETE' && itemId && !action) return api.deleteTask(itemId);
    if (method === 'POST' && itemId && action === 'run') return { run: await api.scheduler.run(itemId) };
  }
  throw new AppError('接口不存在。', 404);
}

export async function startServer({ port = 4317, dbPath = join(ROOT, 'data', 'agent.sqlite'), scheduler = true, modelOptions = {} } = {}) {
  const store = createStore(dbPath);
  const api = createService(store, modelOptions);
  let currentPort;
  const server = http.createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self'; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'");
    const json = (status, data) => {
      if (response.destroyed) return;
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify(data));
    };
    try {
      const allowedHosts = [`127.0.0.1:${currentPort}`, `localhost:${currentPort}`];
      const host = request.headers.host;
      if (!allowedHosts.includes(host)) throw new AppError('仅接受本机地址访问。', 403);
      if (request.headers.origin && request.headers.origin !== `http://${host}`) throw new AppError('拒绝跨站访问。', 403);
      if (request.headers['sec-fetch-site'] === 'cross-site') throw new AppError('拒绝跨站访问。', 403);
      const url = new URL(request.url, `http://${host}`);
      if (['GET', 'HEAD'].includes(request.method) && /^\/guides\/[a-z]+\.md$/.test(url.pathname)) {
        const doc = api.guides.get(url.pathname.slice(8, -3));
        const content = Buffer.from(doc.content + '\n');
        response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': content.length });
        return response.end(request.method === 'HEAD' ? undefined : content);
      }
      if (['GET','HEAD'].includes(request.method) && url.pathname === '/api/media/sticker-image') {
        const image = await api.media.image(url.searchParams.get('id'));
        response.writeHead(200,{'Content-Type':image.mime,'Content-Length':image.data.length});
        return response.end(request.method==='HEAD'?undefined:image.data);
      }
      if (['GET','HEAD'].includes(request.method) && ['/api/music/stream','/api/music/cover'].includes(url.pathname)) {
        const range=request.headers.range;
        if(range && (!/^bytes=\d*-\d*$/u.test(range)||range==='bytes=-'))throw new AppError('音频范围请求无效。',416);
        const controller=new AbortController();
        const abort=()=>controller.abort();
        response.once('close',abort);
        try {
          const upstream=await api.media.music.resource(url.searchParams.get('id'),url.pathname.endsWith('/cover'),range,controller.signal);
          const headers={};
          for(const key of ['content-type','content-length','content-range','accept-ranges'])if(upstream.headers.has(key))headers[key]=upstream.headers.get(key);
          if(upstream.status===416){await upstream.body?.cancel();response.writeHead(416,headers);return response.end();}
          response.writeHead(upstream.status,headers);
          if(request.method==='HEAD'||!upstream.body){await upstream.body?.cancel();return response.end();}
          await pipeline(Readable.fromWeb(upstream.body),response,{signal:controller.signal});
          return;
        } finally {response.removeListener('close',abort);controller.abort();}
      }
      if (url.pathname.startsWith('/api/')) {
        const method = request.method;
        const input = ['POST', 'PUT', 'DELETE'].includes(method) ? await readJson(request) : {};
        return json(200, await route(api, method, url.pathname, input, url.searchParams));
      }
      const asset = STATIC.get(url.pathname);
      if (!asset || !['GET', 'HEAD'].includes(request.method)) throw new AppError('页面不存在。', 404);
      const contents = await readFile(join(ROOT, 'public', asset[0]));
      if (url.pathname.startsWith('/assets/pets/')) response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      response.writeHead(200, { 'Content-Type': asset[1], 'Content-Length': contents.length });
      response.end(request.method === 'HEAD' ? undefined : contents);
    } catch (error) {
      if(response.destroyed)return;
      if(response.headersSent){response.destroy();return;}
      if (error instanceof AppError) return json(error.status, { error: error.message });
      if (error instanceof URIError) return json(400, { error: '请求路径无效。' });
      console.error('请求处理失败：', error.code || error.name);
      return json(500, { error: '本地服务处理失败，请检查终端中的错误类型。' });
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 15000;
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolveListen);
  }).catch(error => { store.close(); throw error; });
  currentPort = server.address().port;
  if (scheduler) api.scheduler.start();
  return {
    server, store, api, url: `http://127.0.0.1:${currentPort}`,
    async close() {
      await new Promise((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()));
      await api.scheduler.stop();
      store.close();
    },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4317);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT 必须是 1～65535 的整数。');
  const app = await startServer({ port, ...(process.env.AGENT_DATA_DIR ? { dbPath: join(resolve(process.env.AGENT_DATA_DIR), 'agent.sqlite') } : {}) });
  console.log(`栖忆 AI Agent 已启动：${app.url}`);
  console.log('仅本机访问；关闭终端后定时任务暂停。首次使用请在设置中配置模型。');
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    await app.close();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
