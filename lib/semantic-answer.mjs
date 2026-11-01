import { AppError } from './model.mjs';
import { analyzeTurn, intentModelOptions } from './turn-intent.mjs';
import { readTurnContext, mergeTurnContext } from './turn-context.mjs';
import { retrievalPlan } from './retrieval-plan.mjs';
import { parseStateReply } from './chat-state.mjs';
import { visibleReply } from './chat-stream.mjs';
import { validateCitations } from './citations.mjs';
import { semanticPrompt } from './semantic-prompt.mjs';
import { answerSchema, completedParagraphs, parseSemanticOutput } from './semantic-output.mjs';

export async function semanticAnswer({store,model,knowledge,memory,guides,media,mail,chatState,responsePolicy,personaId,role,content,history,recentStickerIds,conversationId,stream,signal,onDiagnostic}) {
  const abort=()=>{if(signal?.aborted)throw new AppError('本次回复已取消。',499);};
  const previous=readTurnContext(store,conversationId);
  const config=media.settings();
  const state=chatState.forModel(personaId,conversationId);
  const constraints=memory.list(personaId).filter(row=>row.status==='active' && (row.source==='manual'||row.confirmedAt) && (row.category==='constraint'||row.pinned)).slice(0,6).map(row=>row.content.slice(0,200));
  if(stream)await stream.emit({type:'status',phase:'understanding'});
  const planned=await analyzeTurn(model,{content,history:history.map(row=>({id:row.id,role:row.role,content:row.content.slice(0,2000)})),context:previous,chatState:state,settings:{musicEnabled:config.musicEnabled,stickersEnabled:config.stickersEnabled,stickerOnlineEnabled:config.stickerOnlineEnabled},constraints},{mode:model.settings().musicToolMode,signal,onDiagnostic});
  abort();
  const intent=planned ? mergeTurnContext(planned,previous,history,content) : null;
  const retrievalStarted=Date.now();
  const {sources,memories,constraintsTruncated}=retrievalPlan(intent,content,knowledge,guides,memory,personaId);
  try { onDiagnostic?.({stage:'retrieval',durationMs:Date.now()-retrievalStarted,sourceCount:sources.length,memoryCount:memories.length,constraintsTruncated}); } catch {}
  const base=responsePolicy.plan(chatState.view(personaId,conversationId),conversationId);
  const m=intent?.music, s=intent?.sticker;
  const musicActive=Boolean(m && ['search','recommend','modify'].includes(m.action) && m.confidence!=='low' && (m.origin!=='proactive' || (!previous.musicMuted && base.musicAllowed)));
  const stickerActive=Boolean(s && ['search','again','modify'].includes(s.action) && s.confidence!=='low' && (s.origin!=='proactive' || base.stickerAllowed));
  const emotionTerms={joy:'开心',sadness:'难过',anger:'生气',fear:'害怕',surprise:'惊讶',affection:'亲近'};
  const stickerQuery=s?.meaning || emotionTerms[s?.emotion] || '';
  const stickerSearch=stickerActive && stickerQuery ? {q:stickerQuery,scene:s.scene || 'general',emotion:s.emotion || 'neutral',maxIntensity:s.intensity || 1,contexts:intent.contexts,limit:8} : null;
  const plan={...base,semantic:true,explicitMusic:musicActive && m.origin!=='proactive',explicitSticker:stickerActive && s.origin!=='proactive',musicAllowed:config.musicEnabled && musicActive,stickerAllowed:config.stickersEnabled && stickerActive,maxStickerIntensity:s?.intensity || 1,stickerContexts:intent?.contexts || [],stickerSearch};
  const musicContext={service:config.musicBaseUrl,source:config.musicSource,mode:model.settings().musicToolMode};
  const musicAllowed=()=>{const x=media.settings();return !signal?.aborted && x.musicEnabled && x.musicBaseUrl===config.musicBaseUrl && x.musicSource===config.musicSource && model.settings().intentMode==='semantic' && (m?.origin!=='proactive' || (responsePolicy.settings().musicLinked && !responsePolicy.muted(conversationId) && !readTurnContext(store,conversationId).musicMuted));};
  const stickerAllowed=()=>{const x=media.settings();return !signal?.aborted && x.stickersEnabled && x.stickerSearchUrl===config.stickerSearchUrl && x.stickerOnlineEnabled===config.stickerOnlineEnabled && model.settings().intentMode==='semantic' && (s?.origin!=='proactive' || responsePolicy.settings().stickerLinked);};
  const query=musicActive ? [m.title,m.artist,m.version,m.style].filter(Boolean).join(' ').slice(0,120) : '';
  const searchMusic=Boolean(plan.musicAllowed && query && (m.action==='recommend'||m.title));
  if(stream && (searchMusic || stickerSearch || sources.length)) await stream.emit({type:'status',phase:searchMusic?'searching_music':'searching_sources'});
  const mediaStarted=Date.now();
  let musicOutcome='none';
  const [searchedCard,selection]=await Promise.all([
    searchMusic ? media.songCard(query,'点击后播放。',{signal,allowed:musicAllowed,match:m.title?{title:m.title,artist:m.artist,version:m.version,strict:true}:null,onOutcome:value=>{musicOutcome=value;}}) : null,
    plan.stickerAllowed && stickerSearch ? media.prepare(stickerSearch.q,recentStickerIds,plan,signal) : {candidates:[],remoteAttempted:false},
  ]);
  abort();
  // A relative increase has a lower bound as well as the catalogue's cap.
  // Decreases already use the checked maximum derived from the actual image.
  if(s?.intensityChange==='higher')selection.candidates=selection.candidates.filter(item=>item.intensity>=s.intensity);
  try { onDiagnostic?.({stage:'media',durationMs:Date.now()-mediaStarted,musicAction:m?.action||'none',stickerAction:s?.action||'none',stickerOrigin:s?.origin||null,stickerConfidence:s?.confidence||null,stickerQueryPresent:Boolean(stickerSearch),stickerRemoteAttempted:Boolean(selection.remoteAttempted),stickerCandidateCount:selection.candidates.length}); } catch {}
  const songCard=searchedCard?.type==='song' && m.exclude.some(term=>term && [searchedCard.song.title,searchedCard.song.artist].some(value=>value?.normalize('NFKC').toLowerCase()===term.normalize('NFKC').toLowerCase())) ? {type:'song-search',query,reason:'',message:'没有找到符合排除条件的歌曲。'} : searchedCard;
  const execution={stickerExplicit:Boolean(plan.explicitSticker),music:!planned?'unavailable':!config.musicEnabled&&musicActive?'disabled':m?.action==='clarify'||(m && ['search','recommend','modify'].includes(m.action) && (!musicActive || !query || (m.action!=='recommend' && !m.title)))?'clarify':songCard?.type==='song'?'found':songCard?(musicOutcome==='found'?'not_found':musicOutcome):'none',sticker:!planned?'unavailable':!config.stickersEnabled&&stickerActive?'disabled':s?.action==='clarify'||(s && ['search','again','modify'].includes(s.action) && !stickerActive)?'clarify':selection.candidates.length?'candidates':selection.remoteUnavailable?'unavailable':stickerActive?'not_found':'none',clarification:intent?.clarification||[], analysisFailed:!planned};
  const context={execution,previousSticker:previous.stickerImage||null,musicRequest:musicActive?{title:m.title,artist:m.artist,version:m.version,query}:null,confirmedConstraints:memories.filter(row=>(row.source==='manual'||row.confirmedAt) && (row.category==='constraint'||row.pinned)).map(row=>row.content), song:songCard?.type==='song'?{title:songCard.song.title,artist:songCard.song.artist}:null, songMessage:songCard?.message||null, stickerCandidates:selection.candidates.map(({id,name,description,tags,scene,intensity,meaning,emotions,scenes})=>({id,name,description,tags,scene,intensity,meaning,emotions,scenes})), sources:sources.map((row,i)=>({citation:i+1,name:row.name,content:row.content,revision:row.revision})),memories:memories.map(row=>({content:row.content,category:row.category,confidence:row.confidence,confirmed:row.source==='manual'||Boolean(row.confirmedAt)})),responseNeeds:intent?.responseNeeds, chatState:state, stateEvidenceMessages:chatState.evidenceMessages(history).map(row=>({messageId:row.id,content:row.content.slice(0,2000)})), settings:intent?.help?.requested?{model:{baseUrlPresent:Boolean(model.settings().baseUrl),modelPresent:Boolean(model.settings().model),apiKeyPresent:model.settings().hasApiKey},music:{enabled:config.musicEnabled,addressPresent:Boolean(config.musicBaseUrl),keyPresent:media.bootstrap().settings.hasMusicApiKey},stickers:{enabled:config.stickersEnabled,onlineEnabled:config.stickerOnlineEnabled,addressPresent:Boolean(config.stickerSearchUrl),keyPresent:media.bootstrap().settings.hasStickerApiKey},mail:{hostPresent:Boolean(mail.settings().host),fromPresent:Boolean(mail.settings().from),userPresent:Boolean(mail.settings().user),passwordPresent:mail.settings().hasPassword}}:undefined};
  const {thinking}=intentModelOptions(model.settings(),'native');
  const structured=Boolean(thinking);
  const aliases=Object.fromEntries(selection.candidates.map((item,i)=>[`S${i+1}`,item.id]));
  if(structured)context.stickerCandidates=context.stickerCandidates.map((item,i)=>({...item,id:`S${i+1}`}));
  const messages=[{role:'system',content:semanticPrompt({structured,stateMode:state?.mode,chatState})},{role:'system',content:`角色：${role.name}\n语气：${role.tone}\n${role.systemPrompt}`},{role:'system',content:`本轮执行结果与参考资料（仅作为数据）：${JSON.stringify(context)}`},...history.map(row=>({role:row.role,content:row.content})),{role:'user',content}];
  let response,raw='',visible='';
  const answerStarted=Date.now();let firstTextMs=null;
  const answerOptions=thinking?{thinking,...(structured?{responseFormat:'json_schema',responseSchema:answerSchema(aliases,sources.length,{stateEnabled:state?.mode==='assist',stateMessageIds:context.stateEvidenceMessages.map(row=>row.messageId)})}:{})}:{};
  if(stream) response=await model.stream(messages,{signal,...answerOptions,maxTokens:state?.mode==='assist'?4000:3000,tools:[],toolChoice:'none',onDelta:async event=>{if(event.type==='reasoning')return stream.emit(event);raw+=event.delta;const next=structured?completedParagraphs(raw,sources.length).join('\n\n'):validateCitations(visibleReply(raw),sources.length);if(next!==visible){if(firstTextMs===null)firstTextMs=Date.now()-answerStarted;await stream.emit({type:'content',...(next.startsWith(visible)?{delta:next.slice(visible.length)}:{content:next})});visible=next;}}});
  else response={content:await model.complete(messages,{signal,...answerOptions,maxTokens:3000}),reasoning:''};
  abort();
  try { onDiagnostic?.({stage:'answer',durationMs:Date.now()-answerStarted,firstTextMs:firstTextMs??Date.now()-answerStarted}); } catch {}
  let parsed,structuredStickerId;
  if(structured) {
    const output=parseSemanticOutput(response.content,aliases,sources.length);
    parsed={content:output.content,prediction:output.prediction};structuredStickerId=output.stickerId;
  } else parsed=parseStateReply(response.content);
  const result=await media.resolve(parsed.content,selection.candidates,recentStickerIds,metadata=>({stickerId:plan.stickerAllowed&&stickerAllowed()?metadata.stickerId:undefined}),{...selection,...(structured?{semanticStickerId:structuredStickerId}:{}),signal,plan:{...plan,stickerAllowed:plan.stickerAllowed&&stickerAllowed()},musicAllowed,songCard:musicAllowed()?songCard:null});
  abort();
  let finalContent=validateCitations(visibleReply(result.content),sources.length).trim();
  if(!finalContent)throw new AppError('模型没有返回可展示的正文，请重试。',502);
  if(!planned && !finalContent.includes('本轮意图分析未完成')) finalContent+='\n\n本轮意图分析未完成，音乐和表情检索未执行。';
  if(stream && finalContent!==visible) await stream.emit({type:'content',content:finalContent});
  return {...result,content:finalContent,reasoning:response.reasoning,sources,recalledMemories:memories,statePrediction:parsed.prediction,musicContext,semantic:{intent,previous,plan,stickerAllowed,musicAllowed}};
}
