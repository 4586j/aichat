import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createStore } from './lib/store.mjs';
import { createService } from './lib/service.mjs';
import { AppError } from './lib/model.mjs';
import { PET_CATALOG } from './lib/pets.mjs';
import { petSprite } from './public/pet-motion.js';
import { petClipSprite } from './public/pet-clips.js';
import { SSE_EVENTS, SSE_PHASES } from './public/sse-protocol.js';
import { loadLocalEnvironment, readTunnelConfig, createTunnelManager } from './lib/startup.mjs';
import { createLocalModelKey } from './lib/local-model-key.mjs';
import { once } from 'node:events';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const STATIC = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/streaming.js', ['streaming.js', 'text/javascript; charset=utf-8']],
  ['/sse-protocol.js', ['sse-protocol.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/garden.css', ['garden.css', 'text/css; charset=utf-8']],
  ['/garden-ui.js', ['garden-ui.js', 'text/javascript; charset=utf-8']],
  ['/entrance.css', ['entrance.css', 'text/css; charset=utf-8']],
  ['/entrance.js', ['entrance.js', 'text/javascript; charset=utf-8']],
  ['/media.js', ['media.js', 'text/javascript; charset=utf-8']],
  ['/media.css', ['media.css', 'text/css; charset=utf-8']],
  ['/mail.js', ['mail.js', 'text/javascript; charset=utf-8']],
  ['/mail.css', ['mail.css', 'text/css; charset=utf-8']],
  ['/guides.js', ['guides.js', 'text/javascript; charset=utf-8']],
  ['/guides.css', ['guides.css', 'text/css; charset=utf-8']],
  ['/pets.js', ['pets.js', 'text/javascript; charset=utf-8']],
  ['/pets.css', ['pets.css', 'text/css; charset=utf-8']],
  ['/pet-motion.js', ['pet-motion.js', 'text/javascript; charset=utf-8']],
  ['/pet-clips.js', ['pet-clips.js', 'text/javascript; charset=utf-8']],
  ['/pet-framing.js', ['pet-framing.js', 'text/javascript; charset=utf-8']],
  ['/chat-state.js', ['chat-state.js', 'text/javascript; charset=utf-8']],
  ['/chat-state.css', ['chat-state.css', 'text/css; charset=utf-8']],
  ['/response-scenes.js', ['response-scenes.js', 'text/javascript; charset=utf-8']],
  ['/response-policy.js', ['response-policy.js', 'text/javascript; charset=utf-8']],
  ['/response-policy.css', ['response-policy.css', 'text/css; charset=utf-8']],
  ['/llms.txt', ['../llms.txt', 'text/plain; charset=utf-8']],
  ['/memory-graph.js', ['memory-graph.js', 'text/javascript; charset=utf-8']],
  ['/memory-graph.css', ['memory-graph.css', 'text/css; charset=utf-8']],
  ['/vendor/cytoscape.esm.min.mjs', ['../node_modules/cytoscape/dist/cytoscape.esm.min.mjs', 'text/javascript; charset=utf-8']],
]);
for (const pet of PET_CATALOG) {
  STATIC.set(pet.image, [pet.image.slice(1), 'image/png']);
  STATIC.set(petSprite(pet.id), [petSprite(pet.id).slice(1), 'image/webp']);
  STATIC.set(petClipSprite(pet.id), [petClipSprite(pet.id).slice(1), 'image/webp']);
}
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

const STATIC_API_ROUTES = new Map([
  ['GET /api/bootstrap', ({ api }) => api.bootstrap()],
  ['POST /api/chat/approve', ({ api, input }) => api.approveAction(input.ticketId, { approved: Boolean(input.approved), reason: input.reason })],
  ['GET /api/chat/pending-approvals', ({ api, query }) => ({ approvals: api.getPendingApprovals(query.get('conversationId') || null) })],
  ['GET /api/traces', ({ api, query }) => api.getTraces({ conversationId: query.get('conversationId') || null, limit: query.get('limit') })],
  ['GET /api/tools', ({ api }) => ({ tools: api.toolRegistry.listDefinitions() })],
  ['POST /api/agent/run', ({ api, input }) => api.runAgentTask(input)],
  ['GET /api/chat-state', ({ api, query }) => api.getChatState({ personaId: query.get('personaId'), conversationId: query.get('conversationId') || null })],
  ['POST /api/chat-state', ({ api, input }) => api.updateChatState(input)],
  ['GET /api/response-settings', ({ api }) => ({ responseSettings: api.responsePolicy.settings() })],
  ['PUT /api/response-settings', ({ api, input }) => api.responsePolicy.update(input)],
  ['GET /api/pets', ({ api }) => api.pets.bootstrap()],
  ['PUT /api/pets/settings', ({ api, input }) => api.pets.update(input)],
  ['POST /api/pets/interact', ({ api, input }) => api.pets.interact(input)],
  ['GET /api/guides', ({ api }) => ({ guides: api.guides.bootstrap() })],
  ['POST /api/guides/sync', ({ api }) => api.guides.sync()],
  ['GET /api/mail/settings', ({ api }) => api.mail.bootstrap()],
  ['PUT /api/mail/settings', ({ api, input }) => api.mail.update(input)],
  ['POST /api/mail/verify', ({ api }) => api.mail.verify()],
  ['POST /api/mail/draft', ({ api, input }) => api.mail.draft(input)],
  ['POST /api/mail/prepare', ({ api, input }) => api.mail.prepare(input)],
  ['POST /api/mail/send', ({ api, input }) => api.mail.send(input)],
  ['GET /api/mail/history', ({ api }) => ({ history: api.mail.list() })],
  ['GET /api/media/settings', ({ api }) => api.media.bootstrap()],
  ['PUT /api/media/settings', ({ api, input }) => api.media.update(input)],
  ['GET /api/music/status', ({ api }) => api.media.music.status()],
  ['GET /api/music/search', ({ api, query }) => api.media.music.search(query.get('q') || '', query.get('source') || api.media.settings().musicSource)],
  ['GET /api/music/song', ({ api, query }) => ({ song: api.media.music.get(query.get('id')) })],
  ['GET /api/music/cache', ({ api }) => api.media.music.getCacheStats()],
  ['POST /api/music/cache', ({ api, input }) => {
    if (!input?.id || typeof input.id !== 'string') throw new AppError('歌曲标识不能为空。');
    return api.media.music.cacheSong(input.id, { quality: input.quality });
  }],
  ['DELETE /api/music/cache', ({ api, input, query }) => api.media.music.clearCache(query.get('id') || input?.id)],
  ['GET /api/graph', ({ api, query }) => {
    const archived = query.get('includeArchived') ?? 'false';
    if (!['true', 'false'].includes(archived)) throw new AppError('归档筛选必须为 true 或 false。');
    return api.getGraph({ personaId: query.get('personaId'), includeArchived: archived === 'true' });
  }],
  ['POST /api/graph/extract', ({ api, input }) => api.extractGraph(input)],
  ['GET /api/settings', ({ api }) => ({ settings: api.model.settings() })],
  ['PUT /api/settings', ({ api, input }) => api.updateSettings(input)],
  ['POST /api/settings/test', ({ api }) => api.testModel()],
  ['POST /api/analyze', ({ api, input }) => api.analyze(input)],
  ['POST /api/personas', ({ api, input }) => api.savePersona(input)],
  ['POST /api/conversations', ({ api, input }) => api.createConversation(input)],
  ['POST /api/documents', ({ api, input }) => api.importDocument(input)],
  ['POST /api/chat/parse-attachment', ({ api, input }) => api.parseAttachment(input)],
  ['POST /api/knowledge/search', ({ api, input }) => api.searchKnowledge(input)],
  ['POST /api/memories/summarize', ({ api, input }) => api.summarize(input)],
  ['POST /api/memories/maintain', ({ api }) => api.memory.maintain()],
  ['POST /api/memories', ({ api, input }) => api.saveMemory(input)],
  ['POST /api/tasks', ({ api, input }) => api.saveTask(input)],
]);

const RESOURCE_HANDLERS = {
  approvals: ({ api, method, itemId, action, input }) => {
    if (method === 'POST' && itemId && !action) return api.approveAction(itemId, { approved: Boolean(input.approved), reason: input.reason });
  },
  pets: ({ api, method, itemId, action, input }) => {
    if (method === 'PUT' && itemId && !action) return api.pets.rename(itemId, input);
  },
  guides: ({ api, method, itemId, action }) => {
    if (method === 'GET' && itemId && !action) return { document: api.guides.get(itemId) };
  },
  mail: ({ api, method, itemId, action }) => {
    if (method === 'DELETE' && itemId === 'history' && action) return api.mail.remove(action);
  },
  media: ({ api, method, itemId, action, input }) => {
    if (itemId === 'stickers') {
      if (method === 'POST' && !action) return api.media.upload(input);
      if (method === 'PUT' && action) return api.media.edit(action, input);
      if (method === 'DELETE' && action) return api.media.remove(action);
    }
  },
  personas: ({ api, method, itemId, action, input }) => {
    if (method === 'PUT' && itemId && !action) return api.savePersona(input, itemId);
  },
  conversations: ({ api, method, itemId, action, input }) => {
    if (method === 'GET' && itemId && !action) return api.getConversation(itemId);
    if (method === 'POST' && itemId && action === 'messages') return api.sendMessage(itemId, input);
    if (method === 'POST' && itemId && action === 'music-feedback') return api.musicFeedback(itemId, input);
  },
  documents: ({ api, method, itemId, action }) => {
    if (method === 'DELETE' && itemId && !action) return api.deleteDocument(itemId);
  },
  memories: ({ api, method, itemId, action, input }) => {
    if (method === 'PUT' && itemId && !action) return api.saveMemory(input, itemId);
    if (method === 'DELETE' && itemId && !action) return api.deleteMemory(itemId);
  },
  tasks: async ({ api, method, itemId, action, input }) => {
    if (method === 'PUT' && itemId && !action) return api.saveTask(input, itemId);
    if (method === 'DELETE' && itemId && !action) return api.deleteTask(itemId);
    if (method === 'POST' && itemId && action === 'run') return { run: await api.scheduler.run(itemId) };
  },
};

async function route(api, method, pathname, input, query) {
  const parts = pathname.split('/').filter(Boolean).map(decodeURIComponent);
  if (parts.length > 4) throw new AppError('接口不存在。', 404);
  const staticHandler = STATIC_API_ROUTES.get(`${method} ${pathname}`);
  if (staticHandler) return staticHandler({ api, input, query });
  const [, resource, itemId, action] = parts;
  const resourceHandler = RESOURCE_HANDLERS[resource];
  if (resourceHandler) {
    const result = await resourceHandler({ api, method, itemId, action, input, query });
    if (result !== undefined) return result;
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
        const image = await api.media.image(url.searchParams.get('id'),request.method);
        response.writeHead(200,{'Content-Type':image.mime,'Content-Length':image.size});
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
          for(const key of ['content-type','content-length','content-range','accept-ranges','x-cache'])if(upstream.headers.has(key))headers[key]=upstream.headers.get(key);
          if(url.pathname==='/api/music/stream')headers['cache-control']='private, max-age=3600';
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
        const streamPath=/^\/api\/conversations\/([^/]+)\/messages$/u.exec(url.pathname);
        if(method==='POST'&&streamPath&&request.headers.accept?.includes('text/event-stream')){
          const conversationId=decodeURIComponent(streamPath[1]);
          const controller=new AbortController();
          const abort=()=>controller.abort();response.once('close',abort);
          response.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','X-Accel-Buffering':'no'});
          response.flushHeaders();
          const emit=async({type,...data})=>{
            controller.signal.throwIfAborted();
            if(!response.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`))await once(response,'drain',{signal:controller.signal});
          };
          const heartbeat=setInterval(()=>{if(!response.destroyed&&!response.writableNeedDrain)response.write(': keepalive\n\n');},15000);
          try{
            await emit({type:SSE_EVENTS.STATUS,phase:SSE_PHASES.THINKING});
            const result=await api.sendMessage(conversationId,input,{onEvent:emit,signal:controller.signal});
            await emit({type:SSE_EVENTS.DONE,...result});
          }catch(error){
            if(!controller.signal.aborted)await emit({type:SSE_EVENTS.ERROR,message:error instanceof AppError?error.message:'回复生成失败，请稍后重试。',status:error instanceof AppError?error.status:500});
          }finally{
            clearInterval(heartbeat);response.removeListener('close',abort);controller.abort();response.end();
          }
          return;
        }
        if(method==='POST'&&url.pathname==='/api/agent/run'&&request.headers.accept?.includes('text/event-stream')){
          const controller=new AbortController();
          const abort=()=>controller.abort();response.once('close',abort);
          response.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','X-Accel-Buffering':'no'});
          response.flushHeaders();
          const emit=async(data)=>{
            controller.signal.throwIfAborted();
            const type=data.type||'message';
            if(!response.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`))await once(response,'drain',{signal:controller.signal});
          };
          const heartbeat=setInterval(()=>{if(!response.destroyed&&!response.writableNeedDrain)response.write(': keepalive\n\n');},15000);
          try{
            const result=await api.runAgentTask({...input,stream:{emit},signal:controller.signal});
            await emit({type:SSE_EVENTS.DONE,...result});
          }catch(error){
            if(!controller.signal.aborted)await emit({type:SSE_EVENTS.ERROR,message:error instanceof AppError?error.message:'Agent 任务执行失败。',status:error instanceof AppError?error.status:500});
          }finally{
            clearInterval(heartbeat);response.removeListener('close',abort);controller.abort();response.end();
          }
          return;
        }
        return json(200, await route(api, method, url.pathname, input, url.searchParams));
      }
      const asset = STATIC.get(url.pathname);
      if (!asset || !['GET', 'HEAD'].includes(request.method)) throw new AppError('页面不存在。', 404);
      const filePath = join(ROOT, 'public', asset[0]);
      const fileStat = await stat(filePath);
      const etag = `W/"${fileStat.size}-${Math.floor(fileStat.mtimeMs)}"`;
      if (url.pathname.startsWith('/assets/pets/')) {
        response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      } else {
        response.setHeader('Cache-Control', 'no-cache');
        response.setHeader('ETag', etag);
      }
      if (request.headers['if-none-match'] === etag) {
        response.writeHead(304);
        response.end();
        return;
      }
      const contents = await readFile(filePath);
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
  server.requestTimeout = 120000;
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
  loadLocalEnvironment(join(ROOT,'.env'));
  const port = Number(process.env.PORT || 4317);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT 必须是 1～65535 的整数。');
  const tunnelConfig=readTunnelConfig();
  if(tunnelConfig?.forwards.some(pair=>pair.local===port))throw new Error('SSH 转发端口不能占用聊天应用端口。');
  const tunnels=createTunnelManager(tunnelConfig);
  let closing = false;
  let app;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    try { await app?.close(); } finally { await tunnels.close(); }
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  try {
    await tunnels.start();
    const dataDir = process.env.AGENT_DATA_DIR ? resolve(process.env.AGENT_DATA_DIR) : join(ROOT, 'data');
    if(!closing)app=await startServer({ port, dbPath: join(dataDir, 'agent.sqlite'), modelOptions: { modelKeyStore: createLocalModelKey(join(dataDir, 'model-key.local')) } });
    if(closing)await app?.close();
    else {
      console.log(`栖忆 AI Agent 已启动：${app.url}`);
      console.log('仅本机访问；关闭终端后定时任务暂停。首次使用请在设置中配置模型。');
    }
  } catch(error) { await shutdown(); throw error; }
}
