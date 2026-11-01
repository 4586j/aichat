import test from 'node:test';
import assert from 'node:assert/strict';
import {readEvents} from '../public/streaming.js';
import {visibleReply} from '../lib/chat-stream.mjs';
import {createModel} from '../lib/model.mjs';
import {fixture,addConversation,errorStatus,modelResponse,deferred,scriptedModel} from './helpers.mjs';
import {startServer} from '../server.mjs';

const encoder=new TextEncoder();
const delta=(value)=>`data: ${JSON.stringify({choices:[{index:0,delta:value,finish_reason:null}]})}\n\n`;
const finish='data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
function sse(value,byteSize=7){
  const bytes=encoder.encode(value);return new Response(new ReadableStream({start(controller){for(let pos=0;pos<bytes.length;pos+=byteSize)controller.enqueue(bytes.slice(pos,pos+byteSize));controller.close();}}),{headers:{'content-type':'text/event-stream'}});
}

test('SSE decodes UTF-8 split bytes, CRLF frames, comments and multiline data',async()=>{
  const response=sse(': heartbeat\r\nevent: content\r\ndata: 第一行\r\ndata: 第二行\r\n\r\ndata: [DONE]\r\n\r\n',1),events=[];
  for await(const event of readEvents(response.body))events.push(event);
  assert.deepEqual(events,[{event:'content',data:'第一行\n第二行'},{event:'message',data:'[DONE]'}]);
});

test('model streams provider reasoning separately from content with one authenticated request',async t=>{
  const f=fixture(t,[sse(delta({reasoning_content:'先核对问题。'})+delta({content:'你'})+delta({content:'好🙂'})+finish)],{apiKey:'STREAM_TEST_SECRET'}),events=[];
  const result=await f.api.model.stream([{role:'user',content:'你好'}],{onDelta:event=>events.push(event)});
  assert.deepEqual(result,{content:'你好🙂',reasoning:'先核对问题。'});assert.equal(f.calls.length,1);assert.equal(f.calls[0].body.stream,true);assert.equal(f.calls[0].init.headers.Authorization,'Bearer STREAM_TEST_SECRET');
  assert.deepEqual(events.map(event=>event.type),['reasoning','content','content']);assert.ok(!JSON.stringify(result).includes('STREAM_TEST_SECRET'));
});

test('JSON-only providers remain usable without an extra model request',async t=>{
  const f=fixture(t,[new Response(JSON.stringify({choices:[{message:{content:'正文',reasoning_content:'服务提供的思考'}}]}),{headers:{'content-type':'application/json'}})]),events=[];
  assert.deepEqual(await f.api.model.stream([],{onDelta:event=>events.push(event)}),{content:'正文',reasoning:'服务提供的思考'});assert.equal(f.calls.length,1);assert.equal(events.length,2);
});

for(const [name,response]of[
  ['premature EOF',()=>sse(delta({content:'只收到半句'}))],
  ['malformed event',()=>sse('data: not-json\n\n')],
  ['error event',()=>sse('data: {"error":{"message":"PRIVATE_PROVIDER_ERROR"}}\n\n')],
  ['empty body',()=>sse(finish)],
  ['overlong content',()=>sse(delta({content:'x'.repeat(24001)})+finish,2000)],
  ['overlong reasoning',()=>sse(delta({reasoning_content:'x'.repeat(48001)})+finish,2000)],
])test(`invalid stream ${name} is sanitized and persists no partial transcript`,async t=>{
  const f=fixture(t,[response()]),id=addConversation(f.api,f.personaId);
  await assert.rejects(f.api.sendMessage(id,{content:'测试'},{onEvent:()=>{}}),error=>errorStatus(502)(error)&&!error.message.includes('PRIVATE_PROVIDER_ERROR'));
  assert.equal(f.api.getConversation(id).messages.length,0);
});

test('cancelling a stalled provider read releases the reader and leaves no messages',async t=>{
  const controller=new AbortController();let cancelled=false;
  const f=fixture(t,[new Response(new ReadableStream({start(stream){stream.enqueue(encoder.encode(delta({content:'部分正文'})));},cancel(){cancelled=true;}}),{headers:{'content-type':'text/event-stream'}})]),id=addConversation(f.api,f.personaId);
  await assert.rejects(f.api.sendMessage(id,{content:'测试'},{signal:controller.signal,onEvent:event=>{if(event.type==='content')controller.abort();}}),errorStatus(499));
  assert.equal(cancelled,true);assert.equal(f.api.getConversation(id).messages.length,0);
});

test('stream footer filtering holds split tags while leaving code and quoted examples alone',()=>{
  for(const tag of ['<qiyi-media>','<qiyi-state>'])for(let i=1;i<=tag.length;i++)assert.equal(visibleReply('正文\n'+tag.slice(0,i)),'正文');
  assert.equal(visibleReply('正文\n<qiyi-media>{"stickerId":"leaf-hug"}</qiyi-media>'),'正文');
  assert.equal(visibleReply('示例\n```\n<qiyi-media>{}</qiyi-media>\n```'),'示例\n```\n<qiyi-media>{}</qiyi-media>\n```');
  assert.equal(visibleReply('> <qiyi-state>{}</qiyi-state>'),'> <qiyi-state>{}</qiyi-state>');
});

test('clean streaming body and reasoning persist separately; history and memory see only the body',async t=>{
  const raw='我先陪你。\n<qiyi-media>{"stickerId":"leaf-hug"}</qiyi-media>\n<qiyi-state>{}</qiyi-state>';
  const f=fixture(t,[sse(delta({reasoning_content:'私有测试思考，不应进入下一轮历史。'})+[...raw].map(content=>delta({content})).join('')+finish),'第二轮正文']),id=addConversation(f.api,f.personaId),events=[];
  const result=await f.api.sendMessage(id,{content:'发一个抱抱表情'},{onEvent:event=>events.push(event)});
  assert.equal(result.message.content,'我先陪你。');assert.ok(result.message.reasoning.includes('测试思考'));assert.equal(result.message.attachments[0].id,'leaf-hug');
  assert.ok(!events.filter(event=>event.type==='content').map(event=>event.delta||event.content).join('').includes('qiyi-'));
  assert.equal(f.api.getConversation(id).messages[1].reasoning,result.message.reasoning);
  await f.api.sendMessage(id,{content:'继续'});assert.ok(!JSON.stringify(f.calls[1].body.messages).includes('私有测试思考'));assert.equal(f.calls.length,2);
});

test('a token-limited protocol footer never leaks into the completed answer',async t=>{
  const f=fixture(t,[sse(delta({content:'完整正文\n<qiyi-media>{"stickerId":"leaf-'})+finish)]),id=addConversation(f.api,f.personaId);
  const result=await f.api.sendMessage(id,{content:'测试截断元数据'},{onEvent:()=>{}});
  assert.equal(result.message.content,'完整正文');assert.deepEqual(result.message.attachments,[]);
});

test('HTTP streams waiting, thinking and body before completion, then persists a single message pair',async t=>{
  const gate=deferred(),started=deferred();let upstream;
  const app=await startServer({port:0,dbPath:':memory:',scheduler:false,modelOptions:{apiKey:'',musicApiKey:'',stickerApiKey:'',fetchImpl:async()=>new Response(new ReadableStream({start(controller){upstream=controller;started.resolve();}}),{headers:{'content-type':'text/event-stream'}})}});t.after(()=>app.close());
  app.api.updateSettings({model:'stream-test',baseUrl:'http://model.invalid'});const personaId=app.store.get('SELECT id FROM personas LIMIT 1').id,id=app.api.createConversation({personaId}).conversation.id;
  const response=await fetch(`${app.url}/api/conversations/${id}/messages`,{method:'POST',headers:{'content-type':'application/json',Accept:'text/event-stream'},body:JSON.stringify({content:'测试流式'})});
  assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('x-accel-buffering'),'no');
  const received=[];const done=(async()=>{for await(const event of readEvents(response.body)){const data=JSON.parse(event.data);received.push({type:event.event,...data});if(event.event==='content')gate.resolve();}})();
  await started.promise;upstream.enqueue(encoder.encode(delta({reasoning_content:'先理解需求。'})+delta({content:'第一段'})));await gate.promise;
  assert.deepEqual(received.slice(0,3).map(event=>event.type),['status','reasoning','content']);assert.equal(app.api.getConversation(id).messages.length,0);
  upstream.enqueue(encoder.encode(delta({content:'，第二段。'})+finish));upstream.close();await done;
  assert.equal(received.at(-1).type,'done');assert.equal(received.at(-1).message.content,'第一段，第二段。');assert.equal(app.api.getConversation(id).messages.length,2);
});

test('HTTP disconnect cancels upstream and releases the conversation lock without committing',async t=>{
  let cancelled=false;
  const app=await startServer({port:0,dbPath:':memory:',scheduler:false,modelOptions:{apiKey:'',musicApiKey:'',stickerApiKey:'',fetchImpl:async()=>new Response(new ReadableStream({start(controller){controller.enqueue(encoder.encode(delta({content:'部分正文'})));},cancel(){cancelled=true;}}),{headers:{'content-type':'text/event-stream'}})}});t.after(()=>app.close());
  app.api.updateSettings({model:'stream-test',baseUrl:'http://model.invalid'});const personaId=app.store.get('SELECT id FROM personas LIMIT 1').id,id=app.api.createConversation({personaId}).conversation.id;
  const response=await fetch(`${app.url}/api/conversations/${id}/messages`,{method:'POST',headers:{'content-type':'application/json',Accept:'text/event-stream'},body:JSON.stringify({content:'测试断连'})});
  const reader=response.body.getReader();await reader.read();await reader.cancel();
  for(let i=0;i<30&&!cancelled;i++)await new Promise(resolve=>setTimeout(resolve,10));assert.equal(cancelled,true);assert.equal(app.api.getConversation(id).messages.length,0);
});

// Protocol tests use only a tiny settings stub and scripted responses, never a provider.
const tools=[{type:'function',function:{name:'search_music',description:'Search music',parameters:{type:'object',properties:{query:{type:'string'}},required:['query']}}}];
const toolCall=(overrides={})=>({id:'call_music_1',type:'function',function:{name:'search_music',arguments:'{"query":"夜曲"}'},...overrides});
const frame=choices=>`data: ${JSON.stringify({choices})}\n\n`;
const toolFinish=frame([{index:0,delta:{},finish_reason:'tool_calls'}]);
const done='data: [DONE]\n\n';
const jsonResponse=data=>new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}});
function protocolModel(...responses){
  const mock=scriptedModel(...responses);
  const model=createModel({settings:()=>({model:'protocol-stub',baseUrl:'http://model.invalid/v1'})},{fetchImpl:mock.fetchImpl,apiKey:'',timeoutMs:1000});
  return {model,...mock};
}
const modes=[
  {name:'complete',method:'complete',streaming:false},
  {name:'stream JSON fallback',method:'stream',streaming:false},
  {name:'stream SSE',method:'stream',streaming:true},
];
function protocolResponse(mode,message,finishReason='tool_calls',extraChoices=[],index=0){
  const choices=[{index,message,finish_reason:finishReason},...extraChoices];
  if(!mode.streaming)return jsonResponse({choices});
  return sse(frame(choices.map(({message,...choice})=>({...choice,delta:{...message,
    ...(Array.isArray(message?.tool_calls)?{tool_calls:message.tool_calls.map((call,index)=>call&&typeof call==='object'?{index,...call}:call)}:{})}})))+done,1024);
}

for(const mode of modes){
  test(`${mode.name}: validated thinking option is sent and malformed values are rejected`,async()=>{
    const f=protocolModel(protocolResponse(mode,{content:'正文'},'stop'));
    await f.model[mode.method]([],{thinking:{type:'disabled'}});
    assert.deepEqual(f.calls[0].body.thinking,{type:'disabled'});
    await assert.rejects(f.model[mode.method]([],{thinking:{type:'disabled',extra:true}}),/思考配置无效/u);
    assert.equal(f.calls.length,1);
  });
  test(`${mode.name}: authorized native call preserves wire shape and makes one request`,async()=>{
    const call=toolCall(),message={content:' 正文 ',reasoning_content:' 思考 ',tool_calls:[call]};
    const f=protocolModel(protocolResponse(mode,message)),events=[];
    const messages=[{role:'user',content:'听首歌'}];
    assert.deepEqual(await f.model[mode.method](messages,{tools,maxTokens:123,json:true,onDelta:event=>events.push(event)}),{content:'正文',reasoning:'思考',toolCalls:[call]});
    assert.equal(f.calls.length,1);
    assert.deepEqual(f.calls[0].body,{model:'protocol-stub',messages,max_tokens:123,...(mode.method==='stream'?{stream:true}:{}),tools,tool_choice:'auto',parallel_tool_calls:false});
    assert.equal(f.calls[0].init.redirect,'error');
    assert.equal(f.calls[0].init.headers.Authorization,undefined);
    assert.deepEqual(events,mode.method==='stream'?[{type:'reasoning',delta:' 思考 '},{type:'content',delta:' 正文 '}]:[]);
    assert.ok(!JSON.stringify(events).includes('query'));
  });

  test(`${mode.name}: a tool-only intermediate result is valid and never emitted as text`,async()=>{
    const call=toolCall(),f=protocolModel(protocolResponse(mode,{content:null,tool_calls:[call]})),events=[];
    assert.deepEqual(await f.model[mode.method]([],{tools,onDelta:event=>events.push(event)}),{content:'',reasoning:'',toolCalls:[call]});
    assert.deepEqual(events,[]);assert.equal(f.calls.length,1);
  });

  test(`${mode.name}: tools=[] returns structured text without sending tool controls`,async()=>{
    const f=protocolModel(protocolResponse(mode,{content:' {"ok":true} ',reasoning:' reason '},'stop'));
    assert.deepEqual(await f.model[mode.method]([],{tools:[],json:true,toolChoice:'none'}),{content:'{"ok":true}',reasoning:'reason',toolCalls:[]});
    assert.equal(f.calls.length,1);
    for(const key of ['tools','tool_choice','parallel_tool_calls'])assert.equal(Object.hasOwn(f.calls[0].body,key),false);
  });

  test(`${mode.name}: absent tools keeps the legacy return shape`,async()=>{
    const f=protocolModel(protocolResponse(mode,{content:' 正文 ',reasoning_content:' 思考 '},'stop'));
    assert.deepEqual(await f.model[mode.method]([]),mode.method==='complete'?'正文':{content:'正文',reasoning:'思考'});
    assert.equal(Object.hasOwn(f.calls[0].body,'tools'),false);assert.equal(f.calls.length,1);
  });

  const invalidCalls=[
    ['unknown tool',()=>[toolCall({function:{name:'unapproved',arguments:'{}'}})]],
    ['two different calls',()=>[toolCall(),toolCall({id:'call_music_2'})]],
    ['duplicate IDs',()=>[toolCall(),toolCall()]],
    ['missing ID',()=>[toolCall({id:undefined})]],
    ['empty ID',()=>[toolCall({id:'  '})]],
    ['non-string ID',()=>[toolCall({id:1})]],
    ['overlong ID',()=>[toolCall({id:'x'.repeat(257)})]],
    ['wrong type',()=>[toolCall({type:'custom'})]],
    ['missing type',()=>[toolCall({type:undefined})]],
    ['missing function',()=>[toolCall({function:undefined})]],
    ['missing name',()=>[toolCall({function:{arguments:'{}'}})]],
    ['non-string name',()=>[toolCall({function:{name:123,arguments:'{}'}})]],
    ['overlong name',()=>[toolCall({function:{name:'x'.repeat(65),arguments:'{}'}})]],
    ['missing arguments',()=>[toolCall({function:{name:'search_music'}})]],
    ['object arguments',()=>[toolCall({function:{name:'search_music',arguments:{query:'夜曲'}}})]],
    ['overlong arguments',()=>[toolCall({function:{name:'search_music',arguments:JSON.stringify({query:'x'.repeat(1990)})}})]],
    ['non-array tool_calls',()=>({id:'call_music_1'})],
    ['null call',()=>[null]],
    ...['','{','{"query":"夜曲"','{} trailing','```json\n{}\n```','[]','null','1','true','"text"'].map(args=>[`invalid argument JSON ${JSON.stringify(args)}`,()=>[toolCall({function:{name:'search_music',arguments:args}})]]),
  ];
  for(const [name,calls]of invalidCalls)test(`${mode.name}: rejects ${name} atomically without retry`,async()=>{
    const f=protocolModel(protocolResponse(mode,{content:'不可作为成功结果',tool_calls:calls()}));
    let delivered=false;
    await assert.rejects(f.model[mode.method]([],{tools}).then(result=>{delivered=true;return result;}),errorStatus(502));
    assert.equal(delivered,false);assert.equal(f.calls.length,1);
  });

  for(const [name,options]of [['omitted',{}],['empty',{tools:[]}],['none',{tools,toolChoice:'none'}]]){
    test(`${mode.name}: rejects calls with authorization ${name}`,async()=>{
      const f=protocolModel(protocolResponse(mode,{content:'正文',tool_calls:[toolCall()]}));
      await assert.rejects(f.model[mode.method]([] ,options),errorStatus(502));assert.equal(f.calls.length,1);
      assert.equal(f.calls[0].body.tool_choice,name==='none'?'none':undefined);
    });
  }
  for(const reason of ['stop','length','content_filter',null])test(`${mode.name}: rejects calls finished with ${reason}`,async()=>{
    const f=protocolModel(protocolResponse(mode,{content:'正文',tool_calls:[toolCall()]},reason));
    await assert.rejects(f.model[mode.method]([],{tools}),errorStatus(502));assert.equal(f.calls.length,1);
  });
  for(const reason of ['length','content_filter'])test(`${mode.name}: tool-enabled truncated text is not a successful completion (${reason})`,async()=>{
    const f=protocolModel(protocolResponse(mode,{content:'正文'},reason));
    await assert.rejects(f.model[mode.method]([],{tools}),errorStatus(502));assert.equal(f.calls.length,1);
  });
  test(`${mode.name}: tool_calls finish without a call is invalid`,async()=>{
    const f=protocolModel(protocolResponse(mode,{content:'正文',tool_calls:[]}));
    await assert.rejects(f.model[mode.method]([],{tools}),errorStatus(502));assert.equal(f.calls.length,1);
  });
  test(`${mode.name}: accepts exactly 2000 argument characters and leaves query semantics to caller`,async()=>{
    const args=JSON.stringify({query:'x'.repeat(1988)});assert.equal(args.length,2000);
    for(const argumentsValue of [args,'{}','{"query":null}']){
      const call=toolCall({function:{name:'search_music',arguments:argumentsValue}});
      const f=protocolModel(protocolResponse(mode,{tool_calls:[call]}));
      assert.deepEqual((await f.model[mode.method]([],{tools})).toolCalls,[call]);assert.equal(f.calls.length,1);
    }
  });
  for(const index of [0,1])test(`${mode.name}: refuses extra choice calls (index ${index})`,async()=>{
    const f=protocolModel(protocolResponse(mode,{content:'choice zero'},'stop',[{index,message:{tool_calls:[toolCall()]},finish_reason:'tool_calls'}]));
    await assert.rejects(f.model[mode.method]([],{tools}),errorStatus(502));assert.equal(f.calls.length,1);
  });
  test(`${mode.name}: never promotes a lone nonzero choice's call`,async()=>{
    const f=protocolModel(protocolResponse(mode,{tool_calls:[toolCall()]},'tool_calls',[],1));
    await assert.rejects(f.model[mode.method]([],{tools}),errorStatus(502));assert.equal(f.calls.length,1);
  });
  test(`${mode.name}: refuses unrequested legacy function_call`,async()=>{
    const f=protocolModel(protocolResponse(mode,{content:'正文',function_call:{name:'search_music',arguments:'{}'}},'function_call'));
    await assert.rejects(f.model[mode.method]([],{tools}),errorStatus(502));assert.equal(f.calls.length,1);
  });
  for(const [field,size]of [['content',24001],['reasoning_content',48001]])test(`${mode.name}: retains the ${field} limit with tools`,async()=>{
    const f=protocolModel(protocolResponse(mode,{content:'正文',[field]:'x'.repeat(size),tool_calls:[toolCall()]}));
    await assert.rejects(f.model[mode.method]([],{tools}),errorStatus(502));assert.equal(f.calls.length,1);
  });

  for(const secondCalls of [false,true])test(`${mode.name}: caller owns the second request with toolChoice none (${secondCalls?'reject calls':'text'})`,async()=>{
    const call=toolCall();
    const f=protocolModel(protocolResponse(mode,{tool_calls:[call]}),protocolResponse(mode,{content:'最终正文',...(secondCalls?{tool_calls:[call]}:{})},secondCalls?'tool_calls':'stop'));
    const messages=[{role:'user',content:'听首歌'}],first=await f.model[mode.method](messages,{tools});
    assert.equal(f.calls.length,1);
    const next=[...messages,{role:'assistant',content:first.content,tool_calls:first.toolCalls},{role:'tool',tool_call_id:call.id,content:'{"tracks":[]}'}];
    const second=f.model[mode.method](next,{tools,toolChoice:'none'});
    if(secondCalls)await assert.rejects(second,errorStatus(502));
    else assert.deepEqual(await second,{content:'最终正文',reasoning:'',toolCalls:[]});
    assert.equal(f.calls.length,2);assert.deepEqual(f.calls[1].body.messages,next);
    assert.equal(f.calls[1].body.tool_choice,'none');assert.equal(f.calls[1].body.parallel_tool_calls,false);
  });
}

test('complete preserves legacy json parsing without tools',async()=>{
  const f=protocolModel(modelResponse('```json\n{"ok":true}\n```'));
  assert.deepEqual(await f.model.complete([],{json:true}),{ok:true});assert.equal(f.calls.length,1);
});

for(const mode of modes.filter(mode=>!mode.streaming))for(const [name,body]of [
  ['malformed envelope','{"choices":'],
  ['provider error',JSON.stringify({error:{message:'PRIVATE_PROVIDER_ERROR'}})],
  ['null envelope','null'],
  ['tool calls hidden in delta',JSON.stringify({choices:[{index:0,message:{content:'正文'},delta:{tool_calls:[toolCall()]},finish_reason:'stop'}]})],
])test(`${mode.name}: rejects ${name} with sanitized 502 and no retry`,async()=>{
  const response=new Response(body,{headers:{'content-type':'application/json'}}),f=protocolModel(response);
  await assert.rejects(f.model[mode.method]([],{tools}),error=>errorStatus(502)(error)&&!error.message.includes('PRIVATE_PROVIDER_ERROR'));
  assert.equal(f.calls.length,1);assert.equal(response.body.locked,false);
});

for(const method of ['complete','stream'])test(`${method}: cancellation also works without tools for a stalled JSON-only response`,async()=>{
  const controller=new AbortController(),reading=deferred();let cancelled=false;
  const response=new Response(new ReadableStream({
    start(stream){stream.enqueue(encoder.encode('{"choices":['));},pull(){reading.resolve();},cancel(){cancelled=true;},
  }),{headers:{'content-type':'application/json'}});
  const f=protocolModel(response),rejected=assert.rejects(f.model[method]([],{signal:controller.signal}),errorStatus(499));
  await reading.promise;controller.abort();await rejected;
  assert.equal(cancelled,true);assert.equal(response.body.locked,false);assert.equal(f.calls.length,1);
});

test('SSE aggregates split ID, function name and arguments by index zero, with usage-only frames',async()=>{
  const chunks=[
    {index:0,id:'call_',type:'function',function:{name:'search_',arguments:'{"que'}},
    {index:0,id:'music_',function:{name:'mu',arguments:'ry":"夜'}},
    {index:0,id:'1',function:{name:'sic',arguments:'曲"}'}},
  ];
  const usage='data: {"choices":[],"usage":{"total_tokens":42}}\n\n';
  const response=sse(usage+delta({reasoning:'先找歌'})+chunks.map(call=>delta({tool_calls:[call]})).join('')+toolFinish+usage+done,1);
  const f=protocolModel(response),events=[];
  assert.deepEqual(await f.model.stream([],{tools,onDelta:event=>events.push(event)}),{content:'',reasoning:'先找歌',toolCalls:[toolCall()]});
  assert.deepEqual(events,[{type:'reasoning',delta:'先找歌'}]);assert.equal(f.calls.length,1);assert.equal(response.body.locked,false);
});

for(const [name,body]of [
  ['EOF before finish',()=>delta({tool_calls:[{index:0,...toolCall()}]})],
  ['DONE without tool_calls finish',()=>delta({tool_calls:[{index:0,...toolCall()}]})+done],
  ['second call in a later frame',()=>delta({tool_calls:[{index:0,...toolCall()}]})+delta({tool_calls:[{index:1,...toolCall({id:'call_2'})}]})+toolFinish+done],
  ['call after finish',()=>delta({tool_calls:[{index:0,...toolCall()}]})+toolFinish+delta({tool_calls:[{index:0,function:{arguments:' '}}]})+done],
  ['conflicting type fragment',()=>delta({tool_calls:[{index:0,...toolCall()}]})+delta({tool_calls:[{index:0,type:'custom'}]})+toolFinish+done],
  ['argument fragments exceeding limit',()=>delta({tool_calls:[{index:0,...toolCall({function:{name:'search_music',arguments:' '.repeat(1500)}})}]})+delta({tool_calls:[{index:0,function:{arguments:' '.repeat(501)}}]})+toolFinish+done],
  ['ID fragments exceeding limit',()=>delta({tool_calls:[{index:0,...toolCall({id:'x'.repeat(256)})}]})+delta({tool_calls:[{index:0,id:'x'}]})+toolFinish+done],
  ['name fragments exceeding limit',()=>delta({tool_calls:[{index:0,...toolCall({function:{name:'x'.repeat(64),arguments:'{}'}})}]})+delta({tool_calls:[{index:0,function:{name:'x'}}]})+toolFinish+done],
  ['malformed event after valid call',()=>delta({tool_calls:[{index:0,...toolCall()}]})+toolFinish+'data: not-json\n\n'+done],
  ['error after valid call',()=>delta({tool_calls:[{index:0,...toolCall()}]})+toolFinish+'data: {"error":{"message":"PRIVATE_PROVIDER_ERROR"}}\n\n'+done],
  ['call hidden in message instead of delta',()=>frame([{index:0,message:{tool_calls:[toolCall()]},delta:{content:'正文'},finish_reason:'stop'}])+done],
  ...[undefined,-1,1,'0',0.5].map(index=>[`invalid tool index ${index}`,()=>delta({tool_calls:[{...toolCall(),index}]})+toolFinish+done]),
])test(`SSE rejects ${name} without returning a partial call`,async()=>{
  const response=sse(body(),1024),f=protocolModel(response),events=[];
  await assert.rejects(f.model.stream([],{tools,onDelta:event=>events.push(event)}),error=>errorStatus(502)(error)&&!error.message.includes('PRIVATE_PROVIDER_ERROR'));
  assert.deepEqual(events,[]);assert.equal(f.calls.length,1);assert.equal(response.body.locked,false);
});

test('SSE accepts a completed tool_calls finish at EOF without requiring a DONE sentinel',async()=>{
  const f=protocolModel(sse(delta({tool_calls:[{index:0,...toolCall()}]})+toolFinish));
  assert.deepEqual((await f.model.stream([],{tools})).toolCalls,[toolCall()]);assert.equal(f.calls.length,1);
});

test('SSE does not append text or finish reasons from other choices, and keeps legacy length behavior',async()=>{
  const f=protocolModel(sse(frame([{index:1,delta:{content:'不属于零'},finish_reason:'stop'}])+delta({content:'零'})+frame([{index:0,delta:{},finish_reason:'length'}])+done));
  assert.deepEqual(await f.model.stream([]),{content:'零',reasoning:''});assert.equal(f.calls.length,1);
});

for(const mode of modes){
  test(`${mode.name}: pre-aborted signal prevents even the first HTTP request`,async()=>{
    const controller=new AbortController();controller.abort();const f=protocolModel();
    await assert.rejects(f.model[mode.method]([],{tools,signal:controller.signal}),errorStatus(499));assert.equal(f.calls.length,0);
  });
  test(`${mode.name}: aborting a stalled body cancels and unlocks its reader`,async()=>{
    const controller=new AbortController(),reading=deferred();let cancelled=false;
    const partial=mode.streaming?delta({tool_calls:[{index:0,...toolCall()}]}):'{"choices":[';
    const response=new Response(new ReadableStream({
      start(stream){stream.enqueue(encoder.encode(partial));},
      pull(){reading.resolve();},cancel(){cancelled=true;},
    }),{headers:{'content-type':mode.streaming?'text/event-stream':'application/json'}});
    const f=protocolModel(response),events=[];
    const result=f.model[mode.method]([],{tools,signal:controller.signal,onDelta:event=>events.push(event)});
    const rejected=assert.rejects(result,errorStatus(499));
    await reading.promise;assert.equal(response.body.locked,true);controller.abort();await rejected;
    assert.equal(cancelled,true);assert.equal(response.body.locked,false);assert.equal(f.calls.length,1);assert.deepEqual(events,[]);
  });
  for(const error of [new Error('PRIVATE_PROVIDER_ERROR'),new DOMException('PRIVATE_PROVIDER_ERROR','AbortError')])test(`${mode.name}: provider ${error.name} during body read rejects and unlocks the reader`,async()=>{
    const response=new Response(new ReadableStream({pull(stream){stream.error(error);}}),{headers:{'content-type':mode.streaming?'text/event-stream':'application/json'}});
    const f=protocolModel(response);
    await assert.rejects(f.model[mode.method]([],{tools}),error=>errorStatus(502)(error)&&!error.message.includes('PRIVATE_PROVIDER_ERROR'));
    assert.equal(f.calls.length,1);assert.equal(response.body.locked,false);
  });
  test(`${mode.name}: a fetch stub returning after cancellation still has its body cancelled`,async()=>{
    const controller=new AbortController();let cancelled=false;
    const response=new Response(new ReadableStream({cancel(){cancelled=true;}}));
    const f=protocolModel(()=>{controller.abort();return response;});
    await assert.rejects(f.model[mode.method]([],{tools,signal:controller.signal}),errorStatus(499));
    assert.equal(cancelled,true);assert.equal(response.body.locked,false);assert.equal(f.calls.length,1);
  });
  test(`${mode.name}: another choice appearing first does not shadow choice zero`,async()=>{
    const choices=[{index:1,message:{content:'不属于零'},finish_reason:'stop'},{index:0,message:{tool_calls:[toolCall()]},finish_reason:'tool_calls'}];
    const response=mode.streaming?sse(frame(choices.map(({message,...choice})=>({...choice,delta:{...message,...(message.tool_calls?{tool_calls:[{index:0,...toolCall()}]}:{})}})))+done):jsonResponse({choices});
    const f=protocolModel(response);
    assert.deepEqual(await f.model[mode.method]([],{tools}),{content:'',reasoning:'',toolCalls:[toolCall()]});assert.equal(f.calls.length,1);
  });
  test(`${mode.name}: retains the two MiB response limit and does not retry`,async()=>{
    const large='x'.repeat(2*1024*1024);
    const response=mode.streaming?sse(`: ${large}\n\n`+delta({tool_calls:[{index:0,...toolCall()}]})+toolFinish+done,16384):jsonResponse({padding:large,choices:[{message:{tool_calls:[toolCall()]},finish_reason:'tool_calls'}]});
    const f=protocolModel(response);
    await assert.rejects(f.model[mode.method]([],{tools}),errorStatus(502));assert.equal(f.calls.length,1);assert.equal(response.body.locked,false);
  });
}
