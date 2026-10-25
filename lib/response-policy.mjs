import { AppError } from './model.mjs';
import { RESPONSE_SCENES, responseScene } from '../public/response-scenes.js';

export const RESPONSE_DEFAULTS = Object.freeze({ stickerLinked: true, musicLinked: true, petLinked: true });
const keys = Object.keys(RESPONSE_DEFAULTS);
const songAttachment = item => ['song', 'song-search'].includes(item.type);

// These conservative matches recognize requests, not an inferred permission from a mood.
export function responseRequests(content = '') {
  const negativeMusic = /(?:不要|别|不用|不想|停止|暂停)[^，。！？,;；\n]{0,8}(?:推荐|推歌|歌曲|音乐|放歌)|(?:no|don't|do not)\s+(?:recommend|suggest|play).{0,15}(?:music|song)/iu.test(content);
  const negativeSticker = /(?:不要|别|不用|不想)[^，。！？,;；\n]{0,6}(?:表情|贴纸)|(?:no|don't|do not).{0,12}(?:sticker|meme)/iu.test(content);
  const music = !negativeMusic && /(?:推荐|来|给|找|搜|放|播放|听|点).{0,14}(?:首.{0,6}歌|歌曲|音乐|歌单|背景乐)|(?:点歌|推歌)|(?:播放|推荐|来|放|听)(?:一首|首)(?!诗|词)|(?:recommend|suggest|find|play).{0,20}(?:music|song)/iu.test(content)
    && !/(?:音乐|歌曲|推歌).{0,10}(?:怎么配置|如何设置|怎么设置|接口|功能怎么|功能如何)|(?:配置|设置|接入).{0,8}(?:歌曲推荐|音乐服务|音乐平台)/u.test(content);
  const sticker = !negativeSticker && /(?:发|给|来|用|配|搭配|看看|查看|预览).{0,10}(?:表情|贴纸|动图)|(?:send|show).{0,15}(?:sticker|meme)/iu.test(content);
  return { music, sticker, negativeMusic, negativeSticker };
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
  function plan(snapshot, conversationId, content = '') {
    const config = settings(), request = responseRequests(content), mediaConfig = media.bootstrap().settings;
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
    return { scene, label: style.label, petPhase: style.petPhase, petCaption: style.caption, petLinked: config.petLinked && snapshot?.mode !== 'off',
      stickerAllowed: mediaConfig.stickersEnabled && !request.negativeSticker && (request.sticker || (config.stickerLinked && scene !== 'focus' && !previous[0]?.attachments.some(item => item.type === 'sticker'))),
      musicAllowed: mediaConfig.musicEnabled && !request.negativeMusic && (request.music || proactiveMusic),
      musicConditional: mediaConfig.musicEnabled && !request.negativeMusic && musicConditional, completedReplies: total,
      explicitMusic: request.music, explicitSticker: request.sticker, musicMuted: muted(conversationId), interval,
      allowedStickerScenes: style.stickers, maxStickerIntensity: style.intensity, settingsRevision: config.revision,
      evidence: snapshot?.mode === 'off' ? [] : Object.entries(snapshot?.fields || {}).filter(([key, field]) => ['emotion', 'energy', 'need', 'proactivity'].includes(key) && ['manual', 'model'].includes(field.origin)).map(([key, field]) => ({ key, label: snapshot.labels[key], value: (Array.isArray(field.value) ? field.value : [field.value]).map(value => snapshot.options[key][value]).join(' / '), origin: field.origin, evidence: field.evidence })),
    };
  }
  function filterIntent(intent, plan, candidates) {
    const result = { ...intent };
    if (!plan.stickerAllowed) { delete result.stickerId; delete result.stickerQuery; }
    else if (!plan.explicitSticker) {
      const eligible = candidates.filter(item => plan.allowedStickerScenes.includes(item.scene) && item.intensity <= plan.maxStickerIntensity);
      if (!eligible.some(item => item.id === result.stickerId)) delete result.stickerId;
      // An unclassified online image cannot be checked for a delicate scene.
      if (['rest', 'comfort', 'focus'].includes(plan.scene)) {
        delete result.stickerQuery;
        if (!result.stickerId && intent.stickerId) result.stickerId = eligible.sort((a,b) => plan.allowedStickerScenes.indexOf(a.scene)-plan.allowedStickerScenes.indexOf(b.scene))[0]?.id;
      }
    }
    if (!plan.musicAllowed) { delete result.songQuery; delete result.songReason; }
    if (plan.explicitSticker && !plan.explicitMusic) { delete result.songQuery; delete result.songReason; }
    else if (result.songQuery && !(plan.explicitMusic && plan.explicitSticker)) { delete result.stickerId; delete result.stickerQuery; }
    return result;
  }
  function filterAttachments(attachments, plan) {
    let items = attachments.filter(item => {
      if (songAttachment(item)) return plan.musicAllowed;
      if (item.type !== 'sticker' || !plan.stickerAllowed) return false;
      if (plan.explicitSticker) return true;
      const profile = media.list().find(s => s.id === item.id && s.enabled);
      return profile ? plan.allowedStickerScenes.includes(profile.scene) && profile.intensity <= plan.maxStickerIntensity : !['rest', 'comfort', 'focus'].includes(plan.scene);
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
    });
    return { message: message ? store.get('SELECT * FROM messages WHERE id=?', message.id) : null, musicMuted: muted(conversationId) };
  }
  const prompt = plan => `回应联动规则：先回应用户本轮明确需要，手动状态优先于自动推测；当前参考场景为${plan.label}，结合本轮原话与状态元数据一起判断，不把烦躁简单等同于需要开心或音乐。疲惫时简短，倾诉时先听，解决问题时给清楚步骤。表情与歌曲默认突出一种，只有用户明确要求两者时才可同时搭配。表情本轮${plan.stickerAllowed ? '可按场景克制选择，避免与本轮情绪冲突' : '不主动发送，若本轮用户明确要求且功能开启才可发送'}；主动歌曲推荐每${plan.interval}次回复最多一次，本轮${plan.musicAllowed ? '允许推荐，但只在话题合适时自然给出' : plan.musicConditional ? '已到推荐间隔，可根据本轮有效原话重新判断；只有适合轻松交流时才自然推荐，倾诉、建议、任务场景不推荐' : '不主动推荐或承诺提供歌曲卡片'}。当前已成功回复${plan.completedReplies}次；若本轮识别为疲惫或少追问，主动推歌改用10次间隔。用户本轮明确点歌可直接给歌名和歌手检索；只提到音乐项目或讨论音乐设置不算点歌。音乐始终点击后播放，不改动已有播放、音量或队列。歌曲选择优先已确认的音乐偏好，推荐理由以已提供资料为准，不编造歌词、节拍或音源信息。不需要媒体时只输出正文。宠物由程序按已验证状态呈现，不在正文宣读动作指令。`;
  return { settings, update, muted, plan, filterIntent, filterAttachments, describe, feedback, prompt };
}
