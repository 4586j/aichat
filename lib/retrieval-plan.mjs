import { rankText } from './knowledge.mjs';

export function mergeRanked(results, { limit=6, perDocument=2, budget=7000 }={}) {
  const merged=new Map();
  for(const rows of results) rows.forEach((row,index)=>{ const key=row.id || `${row.documentId}:${row.index}`; const entry=merged.get(key) || {row,rank:0}; entry.rank+=1/(60+index+1); merged.set(key,entry); });
  const counts=new Map(); let used=0;
  return [...merged.values()].sort((a,b)=>b.rank-a.rank).map(x=>x.row).filter(row=>{ const doc=row.documentId; const count=counts.get(doc)||0; if(count>=perDocument || used+row.content.length>budget)return false; counts.set(doc,count+1);used+=row.content.length;return true; }).slice(0,limit);
}
export function retrievalPlan(intent, content, knowledge, guides, memory, personaId) {
  const query=intent?.retrieval?.question || content;
  const queries=[...new Set([query,...(intent?.retrieval?.variants||[])])].slice(0,4);
  const knowledgeSources=mergeRanked(queries.map(q=>knowledge.search(q,10)));
  const guideSources=intent?.help?.requested ? mergeRanked(queries.map(q=>guides.search(`${q} ${(intent.help.topics||[]).join(' ')}`,[],{semantic:true})),{limit:3,perDocument:2,budget:3500}) : [];
  const memories=mergeRanked(queries.map(q=>memory.recall(personaId,q,{skipHubSeeds:true})),{limit:6,perDocument:6,budget:3000});
  const confirmed=memory.list(personaId).filter(row=>row.status==='active' && (row.source==='manual'||row.confirmedAt) && (row.category==='constraint'||row.pinned));
  const relevance=new Map(rankText(queries.join(' '),confirmed).map(row=>[row.id,row.relevance]));
  confirmed.sort((a,b)=>Number(b.pinned)-Number(a.pinned)||(relevance.get(b.id)||0)-(relevance.get(a.id)||0)||b.score-a.score);
  let used=0;const constraints=confirmed.filter(row=>{if(used+row.content.length>1200)return false; used+=row.content.length;return true;}).slice(0,6);
  return {sources:[...guideSources,...knowledgeSources],memories:[...new Map([...constraints,...memories].map(row=>[row.id,row])).values()], constraintsTruncated:constraints.length<confirmed.length};
}
