export function readTurnContext(store, conversationId) {
  try { const state=JSON.parse(store.get('SELECT value FROM conversation_intent_state WHERE conversationId=?',conversationId)?.value || '{}'); return state.version === 1 ? state : {version:1}; }
  catch { return {version:1}; }
}
export function mergeTurnContext(intent, previous, history = [], content = '') {
  const refersTo = (reference, object) => {
    const index=history.findIndex(row=>String(row.id)===String(reference));
    return Boolean(object && index>=0 && (String(reference)===String(object.sourceMessageId) || (history[index].role==='assistant' && String(history[index-1]?.id)===String(object.sourceMessageId))));
  };
  const music={...intent.music}, sticker={...intent.sticker};
  if (music.titleNeedsContext) {
    const target=previous.musicRequest;
    const sameTitle=target?.title && music.title.normalize('NFKC')===target.title.normalize('NFKC');
    const unambiguous=!previous.musicReferenceInactive && !(previous.stickerIntent && !previous.stickerReferenceInactive);
    const ref=music.reference || (unambiguous ? String(target?.sourceMessageId || '') : '');
    if (sameTitle && refersTo(ref,target) && (!previous.musicReferenceInactive || music.explicitReference)) { music.action='modify'; music.reference=ref; }
    else music.action='clarify';
    delete music.titleNeedsContext;
  }
  if (music.action === 'modify' && !music.reference && music.title && content.includes(music.title)) music.action='search';
  if (music.action === 'modify') {
    if (!music.reference && !previous.musicReferenceInactive && !(previous.stickerIntent && !previous.stickerReferenceInactive)) music.reference=String((previous.pendingMusic || previous.musicRequest)?.sourceMessageId || '');
    const target=music.restorePrevious && refersTo(music.reference,previous.previousMusicRequest) ? previous.previousMusicRequest : refersTo(music.reference,previous.pendingMusic) ? previous.pendingMusic : previous.musicRequest;
    if (!refersTo(music.reference,target) || (target===previous.musicRequest && previous.musicReferenceInactive && !music.explicitReference)) music.action='clarify';
    else if (music.restorePrevious) {
      if (!previous.previousMusicRequest) music.action='clarify';
      else for (const key of ['title','artist','version','style']) music[key]=previous.previousMusicRequest[key] || '';
    }
    else for (const key of ['title','artist','version','style']) music[key] ||= target[key] || '';
  }
  if (['again','modify'].includes(sticker.action)) {
    if (!sticker.reference && !previous.stickerReferenceInactive && !(previous.musicRequest && !previous.musicReferenceInactive)) sticker.reference=String((previous.pendingSticker || previous.stickerIntent)?.sourceMessageId || '');
    const target=refersTo(sticker.reference,previous.pendingSticker) ? previous.pendingSticker : previous.stickerIntent;
    if (!refersTo(sticker.reference,target) || (target===previous.stickerIntent && previous.stickerReferenceInactive && !sticker.explicitReference)) sticker.action='clarify';
    else { sticker.meaning ||= target.meaning || ''; if (sticker.action === 'again') { sticker.scene=target.scene; sticker.emotion=target.emotion; sticker.intensity=target.intensity; } else { sticker.scene ||= target.scene; sticker.emotion ||= target.emotion; sticker.intensity ??= target.intensity; } }
  }
  return {...intent,music,sticker};
}
export function commitTurnContext(store, conversationId, previous, intent, attachments, userId) {
  const next={...previous,version:1};
  if (intent.music.action === 'clarify' || (intent.music.action !== 'none' && intent.music.confidence === 'low')) {
    const {title='',artist='',version='',style=''}=intent.music;
    next.pendingMusic={title,artist,version,style,sourceMessageId:Number(userId)};
  }
  if (['search','recommend','modify'].includes(intent.music.action) && intent.music.confidence !== 'low' && (intent.music.origin !== 'proactive' || attachments.some(item=>item.type==='song'))) {
    delete next.pendingMusic;
    const {title,artist,version,style}=intent.music;
    if (next.musicRequest) next.previousMusicRequest=next.musicRequest;
    next.musicRequest={title,artist,version,style,sourceMessageId:Number(userId)};
    next.musicReferenceInactive=false;
    const card=attachments.find(item=>item.type==='song');
    if(card)next.musicFound={title:card.song.title,artist:card.song.artist,id:card.song.id,sourceMessageId:Number(userId)};
  }
  if (intent.sticker.action === 'clarify' || (intent.sticker.action !== 'none' && intent.sticker.confidence === 'low')) {
    const {meaning='',scene='general',emotion='neutral',intensity=1}=intent.sticker;
    next.pendingSticker={meaning,scene,emotion,intensity,sourceMessageId:Number(userId)};
  }
  if (['search','again','modify'].includes(intent.sticker.action) && intent.sticker.confidence !== 'low' && (intent.sticker.origin !== 'proactive' || attachments.some(item=>item.type==='sticker'))) {
    delete next.pendingSticker;
    const {meaning,scene,emotion,intensity}=intent.sticker;
    next.stickerIntent={meaning,scene,emotion,intensity,sourceMessageId:Number(userId)};
    next.stickerReferenceInactive=false;
    const image=attachments.find(item=>item.type==='sticker'); if(image)next.stickerImage={id:image.id,sourceMessageId:Number(userId)};
  }
  if(intent.topicSwitch) { if(intent.music.action==='none') { next.musicReferenceInactive=true; delete next.pendingMusic; } if(intent.sticker.action==='none') { next.stickerReferenceInactive=true; delete next.pendingSticker; } }
  if(intent.music.action==='reject' && intent.music.origin!=='proactive' && intent.music.confidence!=='low' && intent.music.rejectionScope==='session') {
    next.musicMuted=true;
    store.run('INSERT INTO conversation_response(conversationId,musicMuted) VALUES (?,1) ON CONFLICT(conversationId) DO UPDATE SET musicMuted=1',conversationId);
  }
  store.run('INSERT INTO conversation_intent_state(conversationId,value,version) VALUES (?,?,1) ON CONFLICT(conversationId) DO UPDATE SET value=excluded.value,version=1',conversationId,JSON.stringify(next));
}
