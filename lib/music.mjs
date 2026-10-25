import { AppError } from './model.mjs';
import { digest, shortText, fetchJson } from './media-common.mjs';
import { rankText } from './knowledge.mjs';

export function createMusic(store, settings, key, { mediaFetchImpl = fetch, mediaTimeoutMs = 6000 } = {}) {
  const headers = () => key() ? { 'X-API-Key': key() } : {};
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
    async search(query = '', source = settings().musicSource) {
      query = shortText(query, '歌曲检索词', 120);
      if (!['qq','netease','local'].includes(source)) throw new AppError('音乐来源无效。');
      const config = settings();
      const service = config.musicBaseUrl;
      const auth = headers();
      const searchJson = (path, params) => fetchJson(mediaFetchImpl, endpoint(path, params, config), {headers:auth,timeoutMs:mediaTimeoutMs});
      const ensureCurrent = () => {if(settings().musicBaseUrl!==service||!settings().musicEnabled)throw new AppError('音乐设置已改变，请重新搜索。',409);};
      // A blank service address must never fall back to localhost or another provider.
      endpoint('/api/library',{},config);
      let local = [];
      try {
        const library = await searchJson('/api/library');
        ensureCurrent();
        if (!Array.isArray(library.files)) throw new AppError('音乐曲库格式无效。', 502);
        local = library.files.slice(0,1000).map(row => register(row, 'local', 'local', service)).filter(Boolean);
      } catch (error) { if (!query || source === 'local' || error.status===409) throw error; }
      const matches = query ? rankText(query,local.map(s => ({...s, content:`${s.title} ${s.artist} ${s.album}`}))).slice(0,20).map(({ content,relevance,...s })=>s) : local.slice(0,100);
      if (matches.length || !query || source === 'local') return { songs: matches, source: 'local' };
      const data = await searchJson('/api/search', { keyword: query, source, num: '8', page: '1' });
      ensureCurrent();
      if (!Array.isArray(data.songs)) throw new AppError('歌曲搜索响应无效。', 502);
      return { songs: data.songs.slice(0,8).map(row => register(row,'online',source,service)).filter(Boolean), source };
    },
    get(id) {
      if (typeof id !== 'string' || !/^[a-f0-9]{64}$/u.test(id)) throw new AppError('歌曲标识无效。');
      const row = store.get('SELECT * FROM music_catalog WHERE id=?',id);
      if (!row) throw new AppError('歌曲不存在，请重新搜索。',404);
      if (row.service !== settings().musicBaseUrl) throw new AppError('音乐服务地址已改变，请重新搜索此歌曲。',409);
      return JSON.parse(row.value);
    },
    async resource(id, cover, range, signal = new AbortController().signal) {
      const song = music.get(id);
      if (cover && (song.kind !== 'local' || !song.hasCover)) throw new AppError('暂无歌曲封面。',404);
      const url = song.kind === 'local' ? endpoint(cover ? '/api/local_cover' : '/api/local_play', { name:song.name })
        : endpoint('/api/stream',{ songmid:song.songmid,source:song.source,quality:'320' });
      let response;
      const connection=new AbortController();
      const timer=setTimeout(()=>connection.abort(),mediaTimeoutMs);
      try { response = await mediaFetchImpl(url,{ headers:{...headers(),...(range && !cover ? { Range:range } : {})}, redirect:'error', signal:AbortSignal.any([signal,connection.signal]) }); }
      catch { throw new AppError('音乐服务连接中断，请稍后重试。',502); }
      finally {clearTimeout(timer);}
      if (response.status === 416) return response;
      const type = response.headers.get('content-type')?.split(';')[0] || '';
      if (![200,206].includes(response.status) || (cover ? !['image/jpeg','image/png','image/webp'].includes(type) : !/^(audio\/|application\/octet-stream)/u.test(type))) {
        await response.body?.cancel();
        throw new AppError(response.status===401||response.status===403 ? '音乐服务鉴权失败，请检查 API Key。' : '该歌曲暂时没有可播放音源，或格式不受支持。',502);
      }
      return response;
    },
  };
  return music;
}
