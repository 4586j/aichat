import { AppError } from './model.mjs';
import { digest, shortText, fetchJson } from './media-common.mjs';
import { rankText } from './knowledge.mjs';
import { existsSync, mkdirSync, createReadStream, createWriteStream, statSync, unlinkSync, readdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const normalizeTitle = value => value.normalize('NFKC').toLowerCase().replace(/\s+/gu, '').replace(/\.(?:mp3|flac|wav|m4a|ogg|aac|opus)$/u, '');
const exactSong = (song, query) => {
  const title = normalizeTitle(song.title);
  const cleanTitle = title.replace(/\([^()]*\)$/u, '');
  const target = normalizeTitle(query);
  const cleanTarget = target.replace(/\([^()]*\)$/u, '');
  const artist = normalizeTitle(song.artist);
  if (title === target || cleanTitle === cleanTarget) return true;
  if (`${artist}的${title}` === target || `${artist}的${cleanTitle}` === cleanTarget) return true;
  if (`${cleanTitle}${artist}` === cleanTarget || `${artist}${cleanTitle}` === cleanTarget) return true;
  if (cleanTarget.includes(cleanTitle) && (artist.includes(cleanTarget.replace(cleanTitle, '')) || cleanTarget.includes(artist))) return true;
  const artistPrefixed = /^(.+?)的(.+)$/u.exec(cleanTarget);
  if (artistPrefixed) {
    const [, reqArtist, reqTitle] = artistPrefixed;
    if ((cleanTitle === reqTitle || title === reqTitle) && (artist.includes(reqArtist) || reqArtist.includes(artist))) return true;
  }
  return false;
};
const followupSong = (song, match) => {
  const title = normalizeTitle(song.title).replace(/\([^()]*\)$/u, '');
  return title === normalizeTitle(match.title) && (!match.artist || (match.strict ? normalizeTitle(song.artist) === normalizeTitle(match.artist) : normalizeTitle(song.artist).includes(normalizeTitle(match.artist)))) && (!match.version || normalizeTitle(song.title).includes(normalizeTitle(match.version)));
};

export function createMusic(store, settings, key, { mediaFetchImpl = fetch, mediaTimeoutMs = 6000, musicCacheDir } = {}) {
  const headers = () => key() ? { 'X-API-Key': key() } : {};
  const cacheDir = musicCacheDir !== undefined ? musicCacheDir : (existsSync(join(process.cwd(), 'data')) ? join(process.cwd(), 'data', 'music-cache') : null);
  const ensureCacheDir = () => { if (cacheDir && !existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true }); };

  function parseByteRange(rangeHeader, totalSize) {
    if (!rangeHeader || typeof rangeHeader !== 'string') return null;
    const match = /^bytes=(\d*)-(\d*)$/u.exec(rangeHeader.trim());
    if (!match) return false;
    let start = match[1] ? Number(match[1]) : undefined;
    let end = match[2] ? Number(match[2]) : undefined;
    if (start === undefined && end === undefined) return false;
    if (start !== undefined && end !== undefined && start > end) return false;
    if (start === undefined) {
      const suffix = end;
      if (suffix <= 0) return false;
      start = Math.max(0, totalSize - suffix);
      end = totalSize - 1;
    } else {
      if (start >= totalSize) return 'unsatisfiable';
      if (end === undefined || end >= totalSize) end = totalSize - 1;
    }
    return { start, end, chunkSize: end - start + 1 };
  }

  function getCache(id, preferredQuality) {
    if (!cacheDir) return null;
    for (const q of [preferredQuality, '128', '320'].filter(Boolean)) {
      const audioPath = join(cacheDir, `${id}.${q}.audio`);
      const metaPath = join(cacheDir, `${id}.${q}.json`);
      if (existsSync(audioPath) && existsSync(metaPath)) {
        try {
          const stat = statSync(audioPath);
          if (stat.size > 0) {
            const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
            if (!meta.contentLength || meta.contentLength === stat.size) {
              return { filePath: audioPath, metadata: meta, size: stat.size, quality: q };
            }
          }
        } catch {}
      }
    }
    return null;
  }

  const inFlightCaches = new Map();
  const MAX_CACHE_BYTES = 512 * 1024 * 1024;

  function pruneCacheDirectory() {
    if (!cacheDir || !existsSync(cacheDir)) return;
    try {
      const files = readdirSync(cacheDir);
      const metaFiles = files.filter(f => f.endsWith('.json'));
      let totalBytes = 0;
      const entries = [];
      for (const metaFile of metaFiles) {
        try {
          const audioFile = metaFile.replace(/\.json$/, '.audio');
          const audioPath = join(cacheDir, audioFile);
          const metaPath = join(cacheDir, metaFile);
          if (existsSync(audioPath)) {
            const stat = statSync(audioPath);
            totalBytes += stat.size;
            entries.push({ audioPath, metaPath, mtimeMs: stat.mtimeMs, size: stat.size });
          }
        } catch {}
      }
      if (totalBytes > MAX_CACHE_BYTES) {
        entries.sort((a, b) => a.mtimeMs - b.mtimeMs);
        for (const item of entries) {
          if (totalBytes <= MAX_CACHE_BYTES * 0.8) break;
          try { if (existsSync(item.audioPath)) unlinkSync(item.audioPath); } catch {}
          try { if (existsSync(item.metaPath)) unlinkSync(item.metaPath); } catch {}
          totalBytes -= item.size;
        }
      }
    } catch {}
  }

  async function saveStreamToCache(id, quality, song, stream, respHeaders, signal) {
    if (!cacheDir) return;
    ensureCacheDir();
    const key = `${id}:${quality}`;
    if (inFlightCaches.has(key)) {
      try { await stream.cancel(); } catch {}
      return inFlightCaches.get(key);
    }
    const task = (async () => {
      const cachePath = join(cacheDir, `${id}.${quality}.audio`);
      const metaPath = join(cacheDir, `${id}.${quality}.json`);
      const partPath = `${cachePath}.${randomUUID()}.part`;
      const lenHeader = respHeaders.get('content-length') || respHeaders.get('content-range')?.split('/')?.[1];
      const expectedLen = lenHeader && Number(lenHeader) > 0 ? Number(lenHeader) : null;
      const contentType = respHeaders.get('content-type')?.split(';')[0] || 'audio/mpeg';
      try {
        const writer = createWriteStream(partPath);
        await pipeline(Readable.fromWeb(stream), writer, { signal });
        const stat = statSync(partPath);
        if (stat.size > 0 && (!expectedLen || stat.size === expectedLen)) {
          renameSync(partPath, cachePath);
          writeFileSync(metaPath, JSON.stringify({
            id, quality,
            contentType, contentLength: stat.size,
            title: song.title, artist: song.artist,
            album: song.album || '', duration: song.duration || 0,
            cachedAt: new Date().toISOString()
          }), 'utf8');
          pruneCacheDirectory();
        } else {
          try { if (existsSync(partPath)) unlinkSync(partPath); } catch {}
        }
      } catch {
        try { if (existsSync(partPath)) unlinkSync(partPath); } catch {}
      } finally {
        inFlightCaches.delete(key);
      }
    })();
    inFlightCaches.set(key, task);
    return task;
  }

  function endpoint(path, params = {}, config = settings()) {
    if (!config.musicEnabled) throw new AppError('音乐功能已关闭。', 503);
    if (!config.musicBaseUrl) throw new AppError('音乐服务未配置，请先在设置中填写地址。', 503);
    const url = new URL(`${config.musicBaseUrl}${path}`);
    for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
    return url;
  }
  const json = (path, params) => fetchJson(mediaFetchImpl, endpoint(path, params), { headers: headers(), timeoutMs: mediaTimeoutMs });
  function register(item, kind, source, service) {
    if (!item || typeof item !== 'object') return null;
    const name = kind === 'local' ? item.name : '';
    const songmid = kind === 'online' ? String(item.songmid ?? '') : '';
    if (kind === 'local' && (typeof name !== 'string' || !name || name.length > 255 || /[\\/\u0000]/u.test(name) || name === '.' || name === '..')) return null;
    if (kind === 'online' && !/^[a-zA-Z0-9_-]{1,100}$/u.test(songmid)) return null;
    const title = String(item.title || item.songname || name || '').slice(0,200);
    if (!title) return null;
    const song = { id: digest(`${service}\n${kind}\n${source}\n${name || songmid}`), kind, source,
      title, artist: String(item.singer || '').slice(0,200), album: String(item.album || '').slice(0,200),
      duration: Number.isFinite(item.duration) && item.duration >= 0 ? Math.min(item.duration,86400) : 0,
      ...(kind === 'local' ? { name, hasCover: Boolean(item.has_cover) } : { songmid }) };
    store.run('INSERT INTO music_catalog VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value', song.id, service, JSON.stringify(song));
    return song;
  }
  const music = {
    async status() {
      if (!settings().musicBaseUrl) return { configured: false, message: '音乐服务未配置' };
      const data = await json('/api/status');
      if (!Array.isArray(data.sources)) throw new AppError('该地址不是兼容的音乐服务。', 502);
      return { configured: true, message: '音乐服务连接成功', sources: data.sources.filter(s => ['qq','netease'].includes(s.key)).map(s => ({ key:s.key, name:String(s.name || s.key), loggedIn:Boolean(s.logged_in) })) };
    },
    async search(query = '', source = settings().musicSource, { signal, allowed = () => true, exact = false, match = null } = {}) {
      query = shortText(query, '歌曲检索词', 120);
      if (!['qq','netease','local'].includes(source)) throw new AppError('音乐来源无效。');
      const config = settings();
      const service = config.musicBaseUrl;
      const auth = headers();
      const ensureCurrent = () => {
        if (signal?.aborted) throw new AppError('本次回复已取消。', 499);
        if (settings().musicBaseUrl !== service || settings().musicSource !== config.musicSource || !settings().musicEnabled || !allowed()) throw new AppError('音乐设置或本轮权限已改变，请重新搜索。', 409);
      };
      const searchJson = (path, params) => {
        ensureCurrent();
        return fetchJson(mediaFetchImpl, endpoint(path, params, config), { headers: auth, timeoutMs: mediaTimeoutMs, signal });
      };
      // A blank service address must never fall back to localhost or another provider.
      endpoint('/api/library',{},config);
      let local = [];
      try {
        const library = await searchJson('/api/library');
        ensureCurrent();
        if (!Array.isArray(library.files)) throw new AppError('音乐曲库格式无效。', 502);
        local = store.transaction(() =>
          library.files.slice(0, 1000).map(row => register(row, 'local', 'local', service)).filter(Boolean)
        );
      } catch (error) { ensureCurrent(); if (!query || source === 'local' || error.status === 409 || error.status === 499) throw error; }
      const matches = match ? local.filter(song => followupSong(song, match)).slice(0,20) : exact ? local.filter(song => exactSong(song, query)).slice(0,20)
        : query ? rankText(query,local.map(s => ({...s, content:`${s.title} ${s.artist} ${s.album}`}))).slice(0,20).map(({ content,relevance,...s })=>s) : local.slice(0,100);
      if (matches.length || !query || source === 'local') return { songs: matches.map(s => ({ ...s, cached: music.isCached(s.id) })), source: 'local' };
      const data = await searchJson('/api/search', { keyword: query, source, num: '8', page: '1' });
      ensureCurrent();
      if (!Array.isArray(data.songs)) throw new AppError('歌曲搜索响应无效。', 502);
      const registered = store.transaction(() =>
        data.songs.slice(0, 8).map(row => register(row, 'online', source, service)).filter(Boolean)
      );
      return { songs: registered.filter(song => (match ? followupSong(song, match) : !exact || exactSong(song, query))).map(s => ({ ...s, cached: music.isCached(s.id) })), source };
    },
    get(id) {
      if (typeof id !== 'string' || !/^[a-f0-9]{64}$/u.test(id)) throw new AppError('歌曲标识无效。');
      const row = store.get('SELECT * FROM music_catalog WHERE id=?',id);
      if (!row) throw new AppError('歌曲不存在，请重新搜索。',404);
      if (row.service !== settings().musicBaseUrl) throw new AppError('音乐服务地址已改变，请重新搜索此歌曲。',409);
      const song = JSON.parse(row.value);
      return { ...song, cached: music.isCached(song.id) };
    },
    isCached(id, quality) {
      if (typeof id !== 'string' || !/^[a-f0-9]{64}$/u.test(id)) return false;
      return Boolean(getCache(id, quality));
    },
    getCacheStats() {
      if (!cacheDir || !existsSync(cacheDir)) return { count: 0, totalBytes: 0, songs: [] };
      try {
        const files = readdirSync(cacheDir);
        const metaFiles = files.filter(f => f.endsWith('.json'));
        let totalBytes = 0;
        const songs = [];
        for (const metaFile of metaFiles) {
          try {
            const meta = JSON.parse(readFileSync(join(cacheDir, metaFile), 'utf8'));
            const audioFile = metaFile.replace(/\.json$/, '.audio');
            const audioPath = join(cacheDir, audioFile);
            if (existsSync(audioPath)) {
              const stat = statSync(audioPath);
              totalBytes += stat.size;
              songs.push({
                id: meta.id,
                title: meta.title,
                artist: meta.artist,
                quality: meta.quality,
                size: stat.size,
                cachedAt: meta.cachedAt
              });
            }
          } catch {}
        }
        return { count: songs.length, totalBytes, songs };
      } catch {
        return { count: 0, totalBytes: 0, songs: [] };
      }
    },
    clearCache(id) {
      if (!cacheDir || !existsSync(cacheDir)) return { cleared: 0 };
      let cleared = 0;
      try {
        const files = readdirSync(cacheDir);
        for (const f of files) {
          if (id) {
            if (f.startsWith(`${id}.`)) {
              try { unlinkSync(join(cacheDir, f)); cleared++; } catch {}
            }
          } else {
            try { unlinkSync(join(cacheDir, f)); cleared++; } catch {}
          }
        }
      } catch {}
      return { cleared };
    },
    async cacheSong(id, { quality = settings().musicQuality || '128', signal } = {}) {
      const song = music.get(id);
      const q = ['128', '320'].includes(quality) ? quality : '128';
      if (music.isCached(id, q)) {
        const existing = getCache(id, q);
        return { cached: true, id, quality: q, size: existing.size, alreadyCached: true };
      }
      const key = `${id}:${q}`;
      if (inFlightCaches.has(key)) {
        await inFlightCaches.get(key);
        const existing = getCache(id, q);
        if (existing) return { cached: true, id, quality: q, size: existing.size, title: song.title, artist: song.artist };
      }
      const url = song.kind === 'local'
        ? endpoint('/api/local_play', { name: song.name })
        : endpoint('/api/stream', { songmid: song.songmid, source: song.source, quality: q });
      const streamTimeoutMs = mediaTimeoutMs > 1000 ? Math.max(mediaTimeoutMs, 60000) : mediaTimeoutMs;
      const connection = new AbortController();
      const timer = setTimeout(() => connection.abort(), streamTimeoutMs);
      let resp;
      try {
        resp = await mediaFetchImpl(url, {
          headers: headers(),
          redirect: 'error',
          signal: signal ? AbortSignal.any([signal, connection.signal]) : connection.signal
        });
      } catch {
        throw new AppError('音乐服务连接中断，无法缓存歌曲。', 502);
      } finally {
        clearTimeout(timer);
      }
      if (resp.status === 404 && q === '320' && song.kind !== 'local') {
        return music.cacheSong(id, { quality: '128', signal });
      }
      if (![200, 206].includes(resp.status)) {
        await resp.body?.cancel();
        throw new AppError('无法获取歌曲音频流，缓存失败。', 502);
      }
      await saveStreamToCache(id, q, song, resp.body, resp.headers, signal);
      const result = getCache(id, q);
      if (!result) throw new AppError('歌曲缓存写入失败，请重试。', 500);
      return { cached: true, id, quality: q, size: result.size, title: song.title, artist: song.artist };
    },
    async resource(id, cover, range, signal = new AbortController().signal) {
      const song = music.get(id);
      if (cover && (song.kind !== 'local' || !song.hasCover)) throw new AppError('暂无歌曲封面。',404);
      const quality = ['128', '320'].includes(settings().musicQuality) ? settings().musicQuality : '128';
      if (!cover) {
        const cached = getCache(id, quality);
        if (cached) {
          const totalSize = cached.size;
          if (range) {
            const parsed = parseByteRange(range, totalSize);
            if (parsed === 'unsatisfiable') {
              return new Response(null, {
                status: 416,
                headers: {
                  'content-range': `bytes */${totalSize}`,
                  'accept-ranges': 'bytes',
                  'x-cache': 'HIT'
                }
              });
            }
            if (parsed) {
              const { start, end, chunkSize } = parsed;
              const stream = Readable.toWeb(createReadStream(cached.filePath, { start, end }));
              return new Response(stream, {
                status: 206,
                headers: {
                  'content-type': cached.metadata.contentType || 'audio/mpeg',
                  'content-length': String(chunkSize),
                  'content-range': `bytes ${start}-${end}/${totalSize}`,
                  'accept-ranges': 'bytes',
                  'x-cache': 'HIT'
                }
              });
            }
          }
          const stream = Readable.toWeb(createReadStream(cached.filePath));
          return new Response(stream, {
            status: 200,
            headers: {
              'content-type': cached.metadata.contentType || 'audio/mpeg',
              'content-length': String(totalSize),
              'accept-ranges': 'bytes',
              'x-cache': 'HIT'
            }
          });
        }
      }
      const url = song.kind === 'local' ? endpoint(cover ? '/api/local_cover' : '/api/local_play', { name:song.name })
        : endpoint('/api/stream',{ songmid:song.songmid,source:song.source,quality });
      let response;
      const connection=new AbortController();
      const streamTimeoutMs = mediaTimeoutMs > 1000 ? Math.max(mediaTimeoutMs, 35000) : mediaTimeoutMs;
      const timer=setTimeout(()=>connection.abort(),streamTimeoutMs);
      try { response = await mediaFetchImpl(url,{ headers:{...headers(),...(range && !cover ? { Range:range } : {})}, redirect:'error', signal:AbortSignal.any([signal,connection.signal]) }); }
      catch { throw new AppError('音乐服务连接中断，请稍后重试。',502); }
      finally {clearTimeout(timer);}
      if (response.status === 404 && quality === '320' && song.kind !== 'local') {
        const fallbackUrl = endpoint('/api/stream', { songmid:song.songmid, source:song.source, quality:'128' });
        const fallbackConn = new AbortController();
        const fallbackTimer = setTimeout(() => fallbackConn.abort(), streamTimeoutMs);
        try {
          const fallbackResp = await mediaFetchImpl(fallbackUrl, { headers:{...headers(),...(range && !cover ? { Range:range } : {})}, redirect:'error', signal:AbortSignal.any([signal,fallbackConn.signal]) });
          if ([200, 206].includes(fallbackResp.status)) response = fallbackResp;
        } catch { /* ignore fallback error */ }
        finally { clearTimeout(fallbackTimer); }
      }
      if (response.status === 416) return response;
      const type = response.headers.get('content-type')?.split(';')[0] || '';
      if (![200,206].includes(response.status) || (cover ? !['image/jpeg','image/png','image/webp'].includes(type) : !/^(audio\/|application\/octet-stream)/u.test(type))) {
        await response.body?.cancel();
        throw new AppError(response.status===401||response.status===403 ? '音乐服务鉴权失败，请检查 API Key。' : '该歌曲暂时没有可播放音源，或格式不受支持。',502);
      }
      if (!cover && cacheDir && response.body && (!range || range === 'bytes=0-') && (response.status === 200 || (response.status === 206 && response.headers.get('content-range')?.startsWith('bytes 0-')))) {
        const lenHeader = response.headers.get('content-length') || response.headers.get('content-range')?.split('/')?.[1];
        const expectedLen = lenHeader && Number(lenHeader) > 0 ? Number(lenHeader) : null;
        if (expectedLen && expectedLen > 1024) {
          const [streamForClient, streamForCache] = response.body.tee();
          const cacheAbort = new AbortController();
          if (signal) {
            signal.addEventListener('abort', () => cacheAbort.abort(), { once: true });
          }
          saveStreamToCache(id, quality, song, streamForCache, response.headers, cacheAbort.signal).catch(() => {});
          return new Response(streamForClient, { status: response.status, headers: response.headers });
        }
      }
      return response;
    },
  };
  return music;
}
