import { GALLERY_CONTEXTS } from './sticker-gallery.mjs';

export function readTurnContext(store, conversationId) {
  try { const state=JSON.parse(store.get('SELECT value FROM conversation_intent_state WHERE conversationId=?',conversationId)?.value || '{}'); return state.version === 1 ? state : {version:1}; }
  catch { return {version:1}; }
}
export function mergeTurnContext(intent, previous, history = [], content = '') {
  const refersTo = (reference, object, allowAncestors=false) => {
    const index=history.findIndex(row=>String(row.id)===String(reference));
    const ids=[object?.sourceMessageId,...(allowAncestors && Array.isArray(object?.referenceIds)?object.referenceIds:[])].map(String);
    return Boolean(object && index>=0 && ((history[index].role==='user' && ids.includes(String(reference))) || (history[index].role==='assistant' && history[index-1]?.role==='user' && ids.includes(String(history[index-1].id)))));
  };
  const music={...intent.music}, sticker={...intent.sticker};
  // Restoring a grounded prior version is a modification even when the model
  // labels the general action as search/recommend. Normal reference checks
  // below still require an eligible request in this conversation.
  if(music.restorePrevious && ['search','recommend'].includes(music.action))music.action='modify';
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
  if (sticker.action==='search' && sticker.origin==='continuation') {
    const target=previous.stickerIntent;
    if (!sticker.reference && !previous.stickerReferenceInactive && !(previous.musicRequest && !previous.musicReferenceInactive)) sticker.reference=String(target?.sourceMessageId || '');
    if (!refersTo(sticker.reference,target,!sticker.explicitReference) || (previous.stickerReferenceInactive && !sticker.explicitReference)) sticker.action='clarify';
    else {
      const changed=sticker.intensityChange || (sticker.meaning && sticker.meaning!==target.meaning) || (sticker.emotion && sticker.emotion!==target.emotion) || (sticker.scene && sticker.scene!==target.scene) || (sticker.intensity && sticker.intensity!==target.intensity);
      sticker.action=changed?'modify':'again';
    }
  }
  if (['again','modify'].includes(sticker.action)) {
    if (!sticker.reference && !previous.stickerReferenceInactive && !(previous.musicRequest && !previous.musicReferenceInactive)) sticker.reference=String((previous.pendingSticker || previous.stickerIntent)?.sourceMessageId || '');
    const target=refersTo(sticker.reference,previous.pendingSticker) ? previous.pendingSticker : previous.stickerIntent;
    if (!refersTo(sticker.reference,target,!sticker.explicitReference) || (target===previous.stickerIntent && previous.stickerReferenceInactive && !sticker.explicitReference)) sticker.action='clarify';
    else {
      sticker.meaning ||= target.meaning || '';
      if (sticker.action === 'again') { sticker.scene=target.scene; sticker.emotion=target.emotion; sticker.intensity=target.intensity; }
      else { sticker.scene ||= target.scene; sticker.emotion ||= target.emotion; sticker.intensity ??= target.intensity; }
      if (['lower','higher'].includes(sticker.intensityChange)) {
        const actual=previous.stickerImage;
        const related=actual && [target.sourceMessageId,...(target.referenceIds||[])].map(String).includes(String(actual.sourceMessageId));
        const next=related && Number.isInteger(actual.intensity)?actual.intensity+(sticker.intensityChange==='lower'?-1:1):null;
        if(next===null || next<1 || next>3)sticker.action='clarify';
        else {sticker.action='modify';sticker.intensity=next;}
      }
    }
  }
  // When more than one prior medium is eligible, an implicit continuation
  // needs either an explicit target or a grounded music-specific field.
  const bothActive=Boolean(previous.musicRequest && !previous.musicReferenceInactive && previous.stickerIntent && !previous.stickerReferenceInactive);
  const musicQuote=music.evidence?.quote, stickerQuote=sticker.evidence?.quote;
  const distinctEvidence=music.action==='modify' && ['again','modify'].includes(sticker.action) && musicQuote && stickerQuote && !musicQuote.includes(stickerQuote) && !stickerQuote.includes(musicQuote);
  if (bothActive && !distinctEvidence) {
    const currentText=content.normalize('NFKC');
    const groundedMusic=['artist','version','title'].some(key=>music[key] && currentText.includes(music[key].normalize('NFKC')));
    if (music.action==='modify' && !music.explicitReference && !groundedMusic) music.action='clarify';
    if (['again','modify'].includes(sticker.action) && !sticker.explicitReference) sticker.action='clarify';
  }
  // Two continuation actions grounded in the same undifferentiated user span
  // cannot establish which prior object the user meant. Independent evidence
  // for each action remains executable, including a new song plus a clarification.
  if (music.action==='modify' && ['again','modify'].includes(sticker.action)) {
    const a=music.evidence?.quote, b=sticker.evidence?.quote;
    if (a && b && (a.includes(b) || b.includes(a))) {music.action='clarify';sticker.action='clarify';}
  }
  // Retain recently grounded safety context when an otherwise valid plan
  // omits it. Explicit, current-message corrections take precedence.
  const updates=Array.isArray(intent.contextUpdates)?intent.contextUpdates:[];
  const active=new Map();
  for(const item of Array.isArray(previous.activeSafetyContexts)?previous.activeSafetyContexts:[]) {
    if(!item || !GALLERY_CONTEXTS.includes(item.type))continue;
    const index=history.findIndex(row=>row.role==='user' && String(row.id)===String(item.sourceMessageId));
    if(index>=0 && history.slice(index+1).filter(row=>row.role==='user').length<4) active.set(item.type,item);
  }
  for(const item of updates.filter(item=>!item.active)) active.delete(item.type);
  for(const item of updates.filter(item=>item.active)) active.set(item.type,item);
  const contexts=[...new Set([...(intent.contexts||[]),...active.keys()])];
  return {...intent,music,sticker,contexts,activeSafetyContexts:[...active.values()]};
}
export function commitTurnContext(store, conversationId, previous, intent, attachments, userId, stickerProfile=()=>null) {
  const next={...previous,version:1};
  next.activeSafetyContexts=(intent.activeSafetyContexts||[]).map(item=>({type:item.type,sourceMessageId:item.sourceMessageId==='current'?Number(userId):Number(item.sourceMessageId)})).filter(item=>Number.isSafeInteger(item.sourceMessageId));
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
    const previousSticker=next.stickerIntent;
    const referenceIds=['again','modify'].includes(intent.sticker.action) && previousSticker ? [...new Set([...(Array.isArray(previousSticker.referenceIds)?previousSticker.referenceIds:[]),previousSticker.sourceMessageId].filter(Number.isSafeInteger))].slice(-4) : [];
    next.stickerIntent={meaning,scene,emotion,intensity,sourceMessageId:Number(userId),...(referenceIds.length?{referenceIds}:{})};
    next.stickerReferenceInactive=false;
    const image=attachments.find(item=>item.type==='sticker');
    if(image) {
      const profile=stickerProfile(image.id);
      next.stickerImage={id:image.id,sourceMessageId:Number(userId),...(Number.isInteger(profile?.intensity)&&profile.intensity>=1&&profile.intensity<=3?{intensity:profile.intensity}:{}),...(typeof profile?.meaning==='string'?{meaning:profile.meaning.slice(0,120)}:{}),...(typeof profile?.scene==='string'?{scene:profile.scene}:Array.isArray(profile?.scenes)&&typeof profile.scenes[0]==='string'?{scene:profile.scenes[0]}:{}),...(Array.isArray(profile?.emotions)&&typeof profile.emotions[0]==='string'?{emotion:profile.emotions[0]}:{})};
    } else if(intent.sticker.action==='search') delete next.stickerImage;
  }
  if(intent.topicSwitch) { if(intent.music.action==='none') { next.musicReferenceInactive=true; delete next.pendingMusic; } if(intent.sticker.action==='none') { next.stickerReferenceInactive=true; delete next.pendingSticker; } }
  if(intent.music.action==='reject' && intent.music.origin!=='proactive' && intent.music.confidence!=='low' && intent.music.rejectionScope==='session') {
    next.musicMuted=true;
    store.run('INSERT INTO conversation_response(conversationId,musicMuted) VALUES (?,1) ON CONFLICT(conversationId) DO UPDATE SET musicMuted=1',conversationId);
  }
  store.run('INSERT INTO conversation_intent_state(conversationId,value,version) VALUES (?,?,1) ON CONFLICT(conversationId) DO UPDATE SET value=excluded.value,version=1',conversationId,JSON.stringify(next));
}
