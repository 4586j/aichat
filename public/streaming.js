// Shared by the browser and Node: SSE may split frames and UTF-8 characters at any byte.
export async function* readEvents(body,{signal,maxBytes=2*1024*1024}={}) {
  if(!body)throw new Error('服务返回了空数据流。');
  const reader=body.getReader(),decoder=new TextDecoder();
  let buffer='',event='message',data=[],bytes=0;
  const abort=()=>{void reader.cancel().catch(()=>{});};
  signal?.addEventListener('abort',abort,{once:true});
  function line(value){
    if(value===''){
      const result=data.length?{event,data:data.join('\n')}:null;event='message';data=[];return result;
    }
    if(value.startsWith(':'))return null;
    const colon=value.indexOf(':'),field=colon<0?value:value.slice(0,colon);
    let content=colon<0?'':value.slice(colon+1);if(content.startsWith(' '))content=content.slice(1);
    if(field==='event')event=content;
    if(field==='data')data.push(content);
    return null;
  }
  try{
    while(true){
      signal?.throwIfAborted();
      const part=await reader.read();signal?.throwIfAborted();
      if(part.done)break;
      bytes+=part.value.byteLength;if(bytes>maxBytes)throw new Error('数据流超过大小限制。');
      buffer+=decoder.decode(part.value,{stream:true});
      let match;
      while((match=/\r\n|\n|\r/u.exec(buffer))){
        if(match[0]==='\r'&&match.index===buffer.length-1)break;
        const result=line(buffer.slice(0,match.index));buffer=buffer.slice(match.index+match[0].length);
        if(result)yield result;
      }
    }
    buffer+=decoder.decode();
    for(const value of buffer.split(/\r\n|\n|\r/u)){const result=line(value);if(result)yield result;}
    const last=line('');if(last)yield last;
  }finally{
    signal?.removeEventListener('abort',abort);
    await reader.cancel().catch(()=>{});reader.releaseLock();
  }
}

export async function requestChat(path,payload,onEvent,{signal}={}){
  const body = typeof payload === 'string' ? { content: payload } : payload;
  const response=await fetch(`/api${path}`,{method:'POST',headers:{'Content-Type':'application/json',Accept:'text/event-stream'},body:JSON.stringify(body),signal});
  if(!response.headers.get('content-type')?.includes('text/event-stream')){
    const data=await response.json();if(!response.ok)throw new Error(typeof data.error==='string'?data.error:'请求未成功，请稍后重试。');return data;
  }
  let result;
  for await(const frame of readEvents(response.body,{signal})){
    let data;try{data=JSON.parse(frame.data);}catch{throw new Error('回复数据格式无效，请重新发送。');}
    if(frame.event==='error')throw new Error(data.message||'回复生成失败，请重新发送。');
    if(frame.event==='done'){result=data;break;}
    if(['status','reasoning','content'].includes(frame.event))onEvent({type:frame.event,...data});
  }
  if(!result)throw new Error('回复连接已中断，请重新读取会话确认回复是否已保存。');
  return result;
}
