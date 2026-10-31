import { AppError } from './model.mjs';
import { RESPONSE_SCENES, responseScene } from '../public/response-scenes.js';
import { planStickerSearch, stickerContexts } from './sticker-gallery.mjs';

export const RESPONSE_DEFAULTS = Object.freeze({ stickerLinked: true, musicLinked: true, petLinked: true });
const keys = Object.keys(RESPONSE_DEFAULTS);
const songAttachment = item => ['song', 'song-search'].includes(item.type);
const playbackCommand = /^(?:(?:请|帮我|给我|麻烦你?|我想|想|能不能|可以|你|现在|再|先)\s*)*(?:(播放|点播|点歌|推歌|推荐|找|搜|放|听|来|给)\s*|(?=一?首))(.*)$/u;
const otherPlayback = /^(?:(?:一下|一?首|一?段|一?部|一?个|一?篇|这首|这个)\s*)*(?:视频|电影|动画|短片|录音|语音|播客|有声书|课件|幻灯片|PPT|直播|新闻|教程|按钮|列表|进度|功能|接口|诗|古诗|唐诗|词|宋词)|(?:这首|这段|的)(?:诗|词|视频|电影)/iu;
const musicTarget = /^(?:一?首|[《「“"'])|(?:歌(?:曲|单)?|音乐|背景乐)(?:吧|好吗|谢谢|听听)?$/u;
const musicTopic = /音乐|歌|背景乐|播放|点播|(?:放|听|来|推荐)\s*(?:一?首|[《「“"'])|\b(?:music|songs?)\b/iu;
const englishMusicRequest = /(?:recommend|suggest|find|play).{0,20}(?:music|song)/iu;
const titleQuote = /《([^》\n]{1,100})》|「([^」\n]{1,100})」|“([^”\n]{1,100})”|"([^"\n]{1,100})"|'([^'\n]{1,100})'/u;
const withoutBookTitles = content => content.replace(/《[^》\n]*》/gu, '《》');
const musicStyle = /^(?:爵士|摇滚|民谣|古典|流行|电子|蓝调|嘻哈|说唱)(?:乐)?$|钢琴曲|纯音乐|lo-?fi/iu;
const styleRequest = /^(?:放|听|来|推荐)\s*(?:点|一点|一些)(?:爵士|摇滚|民谣|古典|流行|电子|蓝调|嘻哈|说唱)(?:乐)?(?:吧|好吗|谢谢)?$/iu;
// An unquoted clause can contain more than a title even when punctuation is omitted.
const conversationalTail = /(?:我|你|他|她|我们|你们|他们)(?:今天|昨天|明天|刚刚|最近|现在|已经|刚|想|要|会|有|是|在|得了|确诊)|(?:我|你|他|她)(?:觉得|喜欢|不想|需要|告诉|说|生病|确诊)|(?:我想聊|聊聊|跟你说|告诉你|顺便|然后)/u;

function musicCommands(content) {
  // A command starts a clause; quoted examples and setup discussions are vetoed below.
  const clauses = content.match(new RegExp(`(?:${titleQuote.source}|[^，。！？,;；.!?\n])+`, 'gu')) ?? [];
  return clauses.map(clause => playbackCommand.exec(clause.trim()))
    .filter(command => command && (/^(?:播放|点播|点歌|推歌)$/u.test(command[1]) || musicTarget.test(command[2]) || otherPlayback.test(command[2]) || styleRequest.test(`${command[1] ?? ''}${command[2]}`)));
}

function requestedMusicQuery(content) {
  // Only a bounded, current-turn request goes to the service, never surrounding chat.
  const command = musicCommands(content)[0]?.[2] ?? '';
  const end = /(?:并且?|然后|顺便)/u.exec(command)?.index ?? command.length;
  const quoted = titleQuote.exec(command);
  // A title may contain a conjunction, but a title in a later instruction is not a request.
  const prefix = quoted ? command.slice(0, quoted.index).replace(/^(?:(?:一下|一首|首)\s*)+/u, '').trim() : '';
  const artist = /^([^\s《》「」“”"'，。！？,;；]{1,20})的$/u.exec(prefix)?.[1];
  const title = quoted && quoted.index < end && (!prefix || (artist && !conversationalTail.test(artist)))
    ? `${artist ? `${artist}的` : ''}${quoted.slice(1).find(value => value !== undefined)?.trim()}` : undefined;
  const query = title ?? command.slice(0, end)
    .replace(/^(?:(?:一下|一首|首|一点|一些|点)\s*)+/u, '').replace(/(?:这首歌|这首歌曲|这首音乐|吧|好吗|好么|谢谢|可以吗|给我听听|听听|一下)[\s呢吧啊]*$/u, '').trim();
  const ambiguous = !title && (query.length > 20 || /[\s《》「」“”"']/u.test(query) || conversationalTail.test(query));
  if (!query || query.length > 120 || /[\u0000-\u001f\u007f]/u.test(query) || ambiguous) return { query: '轻音乐', exact: false, ambiguous };
  const generic = !title && /(?:歌(?:曲|单)?|音乐|背景乐|的)$|^(?:随便|任意|一些|一点|点)/u.test(query);
  return { query: generic ? '轻音乐' : query, exact: !generic && (Boolean(title) || !musicStyle.test(query)) };
}

// These conservative matches recognize requests, not an inferred permission from a mood.
export function responseRequests(content = '') {
  // Do not span arbitrary words after a decline: “不想说话，推荐一首歌” is a request.
  const context = withoutBookTitles(content);
  const negativeMusic = /(?:不(?:要|用|想|许|需要)?|别|停止|暂停|禁止)\s*(?:(?:再|继续|给我|帮我|自动|主动)\s*)*(?:推荐|推歌|歌曲|音乐|歌单|播放|点播|点歌|(?:搜索|搜|找|放|听|来)\s*(?:一?首|[《「“"']|(?:个|点)?歌|音乐)|放(?:了|吧)?(?=$|[，。！？,;；.!?\n]))|(?:no|don't|do not)\s+(?:recommend|suggest|play).{0,15}(?:music|song)/iu.test(context);
  const negativeSticker = /(?:不要|别|不用|不想)[^，。！？,;；\n]{0,6}(?:表情|贴纸)|(?:no|don't|do not).{0,12}(?:sticker|meme)/iu.test(content);
  const commands = musicCommands(content);
  const hasMusicTopic = musicTopic.test(context);
  const setupContext = context.replace(/((?:播放|点播|放|听|来|推荐)\s*(?:一首|首)?)\s*[^，。！？,;；.!?\n《》]{1,20}的(?=《》)/gu, '$1');
  const setupQuestion = hasMusicTopic && /配置|设置|接入|接口|功能|项目|代码|实现|添加|支持|适配|调试|测试|检查|排查|修复|故障|报错|卡片|按钮/iu.test(setupContext);
  // Book-title brackets alone are NOT quotation: 播放《晴天》 is a real request.
  const quotedRequest = [...context.matchAll(/“([^”]*)”|「([^」]*)」|"([^"\n]*)"|'([^'\n]*)'/gu)]
    .some(match => musicTopic.test(match.slice(1).find(value => value !== undefined)));
  const reference = /`|~~~|^\s*>/mu.test(context) || quotedRequest
    || (hasMusicTopic && /示例|例子|例如|比如|假设|假如|如果|引用|原话|这句话/u.test(context));
  const otherMedia = commands.some(command => otherPlayback.test(withoutBookTitles(command[2])));
  const explicit = commands.length > 0 || englishMusicRequest.test(content);
  const musicBlocked = negativeMusic || setupQuestion || reference || otherMedia || (hasMusicTopic && !explicit);
  const music = !musicBlocked && explicit;
  const sticker = !negativeSticker && /(?:发|给|来|用|配|搭配|看看|查看|预览).{0,10}(?:表情|贴纸|动图)|(?:send|show).{0,15}(?:sticker|meme)/iu.test(content);
  return { music, sticker, negativeMusic, negativeSticker, musicBlocked };
}

function musicFollowup(content, history) {
  const value=content.trim();
  const match = /^([\p{L}\p{N}·._-]{1,20})的[。！!？?]?$/u.exec(value);
  const conversational = /^(?:换|改|用|想听|我要|能不能|可以|来).{0,40}(?:唱|演唱|版本|版|的)[。！!？?]?$/u.test(value);
  if (!match && !conversational) return null;
  if (match && /^(?:我|你|他|她|这|那|好|真|对|不是|不要|不对|不喜欢|别|没有)$/u.test(match[1])) return null;
  const [user, assistant] = history.slice(-2);
  if (user?.role !== 'user' || assistant?.role !== 'assistant' || !assistant.attachments?.some(songAttachment)) return null;
  const request = responseRequests(user.content);
  if (!request.music) return null;
  const previous = requestedMusicQuery(user.content);
  if (!previous.exact || previous.ambiguous || previous.query.includes('的')) return null;
  const artist = match && !conversational && !/(?:唱|演唱|版本|换|换成|改成|用)/u.test(match[1]) ? match[1] : '';
  return { title: previous.query, artist, current: value };
}

function followupIntent(plan, intent) {
  const followup=plan.requestedMusicFollowup;
  if (!followup) return null;
  const proposed=typeof intent.songArtist==='string' ? intent.songArtist.trim() : '';
  const valid=proposed.length>0 && proposed.length<=20 && /^[\p{L}\p{N}·._-]+$/u.test(proposed)
    && followup.current.includes(proposed) && !/^(?:我|你|他|她|换|改|用|唱|版本|换成|改成|换个|这首|这版|原唱)$/u.test(proposed)
    && !/^(?:换成|改成|换个|换为|改为|用)/u.test(proposed) && !/(?:唱|版本|演唱)$/u.test(proposed);
  const artist=valid ? proposed : followup.artist;
  return artist ? { title:followup.title,artist } : null;
}

export function createResponsePolicy(store, media) {
  function settings() {
    const row = store.get('SELECT * FROM response_settings WHERE id=1');
    return { ...RESPONSE_DEFAULTS, ...JSON.parse(row?.value || '{}'), revision: row?.revision || 0 };
  }
  function update(input) {
    if (!input || !Number.isInteger(input.expectedRevision) || input.expectedRevision < 0 || Object.keys(input).some(key => ![...keys, 'expectedRevision'].includes(key)) || !keys.some(key => key in input)) throw new AppError('联动设置格式无效。');
    for (const key of keys) if (key in input && typeof input[key] !== 'boolean') throw new AppError('联动开关必须为布尔值。');
    store.transaction(() => {
      const current = settings(); if (current.revision !== input.expectedRevision) throw new AppError('联动设置已在另一处修改，请重新读取后再保存。', 409);
      const value = Object.fromEntries(keys.map(key => [key, input[key] ?? current[key]]));
      store.run('INSERT INTO response_settings VALUES (1,?,1) ON CONFLICT(id) DO UPDATE SET value=excluded.value,revision=response_settings.revision+1', JSON.stringify(value));
    });
    return { responseSettings: settings() };
  }
  const muted = conversationId => Boolean(conversationId && store.get('SELECT musicMuted FROM conversation_response WHERE conversationId=?', conversationId)?.musicMuted);
  function plan(snapshot, conversationId, content = '', history = []) {
    const config = settings(), request = responseRequests(content), mediaConfig = media.bootstrap().settings;
    const followup = !request.musicBlocked && !request.music ? musicFollowup(content, history) : null;
    if (followup) request.music = true;
    const requested = followup ? { query: [followup.title,followup.artist].filter(Boolean).join(' '), exact: false } : request.music ? requestedMusicQuery(content) : { query: '', exact: false };
    const scene = responseScene(snapshot), style = RESPONSE_SCENES[scene];
    const previous = conversationId ? store.all("SELECT attachments FROM messages WHERE conversationId=? AND role='assistant' ORDER BY id DESC LIMIT 9", conversationId) : [];
    const total = conversationId ? store.get("SELECT COUNT(*) AS n FROM messages WHERE conversationId=? AND role='assistant'", conversationId).n : 0;
    const low = snapshot?.fields?.proactivity?.value === 'low' || snapshot?.fields?.energy?.value === 'low';
    const interval = low ? 10 : 5, recentSong = previous.slice(0, interval - 1).some(row => row.attachments.some(songAttachment));
    const stateKnown = snapshot?.mode !== 'off' && Object.entries(snapshot?.fields || {}).some(([key, field]) => ['emotion', 'need', 'energy'].includes(key) && field.value !== 'unknown' && !(Array.isArray(field.value) && field.value.includes('unknown')));
    const musicWindow = config.musicLinked && !muted(conversationId) && Boolean(mediaConfig.musicBaseUrl) && total >= interval - 1 && !recentSong;
    const proactiveMusic = musicWindow && stateKnown && !['focus', 'comfort'].includes(scene);
    const manualNeed = snapshot?.fields?.need;
    const musicConditional = musicWindow && snapshot?.mode === 'assist' && !(manualNeed?.origin === 'manual' && ['task','advice','listen'].includes(manualNeed.value));
    const recentContext = conversationId ? store.all("SELECT content FROM messages WHERE conversationId=? AND role='user' ORDER BY id DESC LIMIT 2",conversationId).map(row=>row.content).join('\n') : '';
    const result = { scene, label: style.label, petPhase: style.petPhase, petCaption: style.caption, petLinked: config.petLinked && snapshot?.mode !== 'off',
      stickerAllowed: mediaConfig.stickersEnabled && !request.negativeSticker && (request.sticker || (config.stickerLinked && scene !== 'focus' && !previous[0]?.attachments.some(item => item.type === 'sticker'))),
      musicAllowed: mediaConfig.musicEnabled && !request.musicBlocked && (request.music || proactiveMusic),
      musicConditional: mediaConfig.musicEnabled && !request.musicBlocked && musicConditional, completedReplies: total,
      explicitMusic: request.music, requestedMusicQuery: requested.query, requestedMusicExact: requested.exact, requestedMusicAmbiguous: Boolean(requested.ambiguous), requestedMusicFollowup: followup, explicitSticker: request.sticker, musicMuted: muted(conversationId), interval,
      allowedStickerScenes: style.stickers, maxStickerIntensity: style.intensity, settingsRevision: config.revision,
      stickerContexts: stickerContexts(`${recentContext}\n${content}`),
      evidence: snapshot?.mode === 'off' ? [] : Object.entries(snapshot?.fields || {}).filter(([key, field]) => ['emotion', 'energy', 'need', 'proactivity'].includes(key) && ['manual', 'model'].includes(field.origin)).map(([key, field]) => ({ key, label: snapshot.labels[key], value: (Array.isArray(field.value) ? field.value : [field.value]).map(value => snapshot.options[key][value]).join(' / '), origin: field.origin, evidence: field.evidence })),
    };
    return {...result,stickerSearch:planStickerSearch(result,content)};
  }
  function filterIntent(intent, plan, candidates, { fallback = true } = {}) {
    const result = { ...intent };
    if (!plan.stickerAllowed) { delete result.stickerId; delete result.stickerQuery; }
    else {
      if(result.stickerId&&!candidates.some(item=>item.id===result.stickerId))delete result.stickerQuery;
      const eligible = candidates.filter(item => media.eligible(item,plan));
      if (!eligible.some(item => item.id === result.stickerId)) delete result.stickerId;
      // An unclassified online image cannot be checked for a delicate scene.
      if (!plan.explicitSticker && ['rest', 'comfort', 'focus'].includes(plan.scene)) {
        delete result.stickerQuery;
        if (!result.stickerId && intent.stickerId && !intent.stickerId.startsWith('remote-')) result.stickerId = eligible.sort((a,b) => plan.allowedStickerScenes.indexOf(a.scene)-plan.allowedStickerScenes.indexOf(b.scene))[0]?.id;
      }
    }
    if (!plan.musicAllowed) { delete result.songQuery; delete result.songReason; }
    else if (plan.explicitMusic) {
      if (plan.requestedMusicFollowup) {
        const match=followupIntent(plan,result);
        result.songMatch=match;
        result.songQuery=match ? `${match.title} ${match.artist}` : '';
        result.songNeedsClarification=!match;
      }
      // Disabling fallback must not relax an existing exact-track constraint.
      if (result.songQuery && (plan.requestedMusicExact || plan.requestedMusicAmbiguous)) result.songQuery = plan.requestedMusicQuery;
      else if (!result.songQuery && fallback && !plan.requestedMusicFollowup) {
        result.songQuery = plan.requestedMusicQuery;
        result.songReason = '按你本轮的点歌请求提供，点击后播放。';
      }
    }
    delete result.songArtist;
    if (plan.explicitSticker && !plan.explicitMusic) { delete result.songQuery; delete result.songReason; }
    else if (result.songQuery && !(plan.explicitMusic && plan.explicitSticker)) { delete result.stickerId; delete result.stickerQuery; }
    return result;
  }
  function filterAttachments(attachments, plan) {
    let items = attachments.filter(item => {
      if (songAttachment(item)) return plan.musicAllowed;
      if (item.type !== 'sticker' || !plan.stickerAllowed) return false;
      const profile = media.profile(item.id);
      return Boolean(profile && (profile.galleryId || profile.enabled) && media.eligible(profile,plan));
    });
    if (plan.explicitSticker && !plan.explicitMusic) items = items.filter(item => !songAttachment(item));
    else if (!(plan.explicitSticker && plan.explicitMusic) && items.some(songAttachment)) items = items.filter(songAttachment);
    return items;
  }
  function describe(plan, attachments = []) {
    return { scene: plan.scene, label: plan.label, petPhase: plan.petPhase, petCaption: plan.petCaption, petLinked: plan.petLinked, evidence: plan.evidence,
      musicMuted: plan.musicMuted, proactiveSong: !plan.explicitMusic && attachments.some(songAttachment), explicitSong: plan.explicitMusic && attachments.some(songAttachment),
      interval: plan.interval, settingsRevision: plan.settingsRevision };
  }
  function feedback(conversationId, input) {
    if (!['skip', 'mute', 'restore', 'unmute'].includes(input?.action)) throw new AppError('歌曲反馈无效。');
    const conversation = store.get('SELECT id FROM conversations WHERE id=?', conversationId); if (!conversation) throw new AppError('会话不存在。', 404);
    let message;
    if (input.action !== 'unmute') {
      if (!Number.isInteger(input.messageId) || input.messageId < 1) throw new AppError('消息编号无效。');
      message = store.get("SELECT * FROM messages WHERE id=? AND conversationId=? AND role='assistant'", input.messageId, conversationId);
      if (!message?.attachments.some(songAttachment)) throw new AppError('该会话中没有这条歌曲推荐。', 404);
    }
    store.transaction(() => {
      if (message) store.run('UPDATE messages SET musicFeedback=? WHERE id=?', input.action === 'restore' ? '' : input.action, message.id);
      if (['mute', 'unmute'].includes(input.action)) store.run('INSERT INTO conversation_response VALUES (?,?) ON CONFLICT(conversationId) DO UPDATE SET musicMuted=excluded.musicMuted', conversationId, Number(input.action === 'mute'));
      if (input.action === 'unmute') {
        const state=store.get('SELECT value FROM conversation_intent_state WHERE conversationId=?',conversationId);
        if (state) {
          try { const value=JSON.parse(state.value); if(value?.version===1 && value.musicMuted) {value.musicMuted=false;store.run('UPDATE conversation_intent_state SET value=? WHERE conversationId=?',JSON.stringify(value),conversationId);} }
          catch { /* A corrupt optional intent state cannot block ordinary feedback. */ }
        }
      }
    });
    return { message: message ? store.get('SELECT * FROM messages WHERE id=?', message.id) : null, musicMuted: muted(conversationId) };
  }
  const prompt = plan => `回应联动规则：先回应用户本轮明确需要，手动状态优先于自动推测；当前参考场景为${plan.label}，结合本轮原话与状态元数据一起判断，不把烦躁简单等同于需要开心或音乐。疲惫时简短，倾诉时先听，解决问题时给清楚步骤。表情与歌曲默认突出一种，只有用户明确要求两者时才可同时搭配。表情本轮${plan.stickerAllowed ? '可按场景克制选择，避免与本轮情绪冲突' : '不主动发送，若本轮用户明确要求且功能开启才可发送'}；主动歌曲推荐每${plan.interval}次回复最多一次，本轮${plan.musicAllowed ? '允许推荐，但只在话题合适时自然给出' : plan.musicConditional ? '已到推荐间隔，可根据本轮有效原话重新判断；只有适合轻松交流时才自然推荐，倾诉、建议、任务场景不推荐' : '不主动推荐或承诺提供歌曲卡片'}。当前已成功回复${plan.completedReplies}次；若本轮识别为疲惫或少追问，主动推歌改用10次间隔。用户本轮明确点歌可直接给歌名和歌手检索；只提到音乐项目或讨论音乐设置不算点歌。音乐始终点击后播放，不改动已有播放、音量或队列。歌曲选择优先已确认的音乐偏好，推荐理由以已提供资料为准，不编造歌词、节拍或音源信息。不需要媒体时只输出正文。宠物由程序按已验证状态呈现，不在正文宣读动作指令。`;
  return { settings, update, muted, plan, filterIntent, filterAttachments, describe, feedback, prompt };
}
