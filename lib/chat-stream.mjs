// Hold optional protocol footers (including a split opening tag) until final validation.
export function visibleReply(raw){
  let fence=null,comment=false,offset=0,inline=0;
  const tags=['<qiyi-media>','<qiyi-state>'];
  for(const line of raw.split('\n')){
    const marker=/^ {0,3}(`{3,}|~{3,})/u.exec(line)?.[1];
    if(!fence&&!comment&&inline%2===0&&line&&tags.some(tag=>tag.startsWith(line)||line.startsWith(tag)))return raw.slice(0,offset).trimEnd();
    if(marker){if(!fence)fence=marker;else if(marker[0]===fence[0]&&marker.length>=fence.length)fence=null;}
    else if(!fence){
      for(const token of line.match(/<!--|-->/gu)||[])comment=token==='<!--';
      inline+=(line.match(/`/gu)||[]).length;
    }
    offset+=line.length+1;
  }
  return raw.trimEnd();
}
