import { startServer } from '../server.mjs';
import { mockMediaFetch } from './media-fixtures.mjs';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import { randomInt } from 'node:crypto';

function streamingResponse(content,question,signal){
  const slow=question.includes('流式演示'),interrupted=question.includes('断流演示');
  const reasoning=slow||interrupted?'先理解这个问题，再整理回答的重点。':'';
  if(slow)content='这是第一段逐步出现的回答。\n\n这是第二段，气泡会随文字继续长高。\n<qiyi-media>{"stickerId":"leaf-think"}</qiyi-media>\n<qiyi-state>{}</qiyi-state>';
  if(interrupted)content='这是一段尚未完成的回答。';
  const encoder=new TextEncoder();let cancelled=false;
  return new Response(new ReadableStream({start(controller){
    void(async()=>{
      const send=data=>{if(!cancelled)controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));};
      try{
        await delay(200,undefined,{signal});
        if(reasoning){send({choices:[{index:0,delta:{reasoning_content:reasoning.slice(0,9)}}]});await delay(200,undefined,{signal});send({choices:[{index:0,delta:{reasoning_content:reasoning.slice(9)}}]});}
        for(const part of content.match(/.{1,10}|\n/gu)||[]){await delay(slow?100:15,undefined,{signal});send({choices:[{index:0,delta:{content:part}}]});}
        if(!interrupted){send({choices:[{index:0,delta:{},finish_reason:'stop'}]});if(!cancelled)controller.enqueue(encoder.encode('data: [DONE]\n\n'));}
        if(!cancelled)controller.close();
      }catch(error){if(!cancelled)controller.error(error);}
    })();
  },cancel(){cancelled=true;}}),{headers:{'content-type':'text/event-stream'}});
}

export async function startOfflineServer({ port = 0, dbPath = ':memory:' } = {}) {
  const calls = { model: [], mail: [], mailVerify: [], media: [], guides: [], blocked: [] };
  const modelFailures = [];
  let app;
  let petTestTime = Date.now();
  const fetchImpl = async (_url, options) => {
  const request = JSON.parse(options.body);
  calls.model.push(request);
  if (modelFailures.length) return new Response(JSON.stringify({ error: { message: 'Offline model failure' } }), { status: modelFailures.shift(), headers: { 'content-type': 'application/json' } });
  const instruction = request.messages[0].content;
  const question = request.messages.findLast(message => message.role === 'user')?.content || '';
  const tool = request.messages.findLast(message => message.role === 'tool');
  const hasCriticFeedback = request.messages.some(message => message.role === 'system' && message.content?.includes('[审核员质检未通过]'));
  if (instruction.includes('高精度的回答意图对齐审核器')) {
    if (question.includes('多轮计算与审核演示') && !question.includes('```js')) {
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ passed: false, score: 58, missingPoints: ['缺少示例验证代码'], factCheck: 'consistent', feedbackToAgent: '计算结果 160 正确，但请补充一段简短的 JS 验证代码块。' }) } }]
      }), { headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ passed: true, score: 96, missingPoints: [], factCheck: 'consistent', feedbackToAgent: '' }) } }]
    }), { headers: { 'content-type': 'application/json' } });
  }
  if (instruction.includes('聊天意图分析器')) {
    const input=JSON.parse(question), text=input.content;
    if (text.includes('语义停止演示')) await delay(3000,undefined,{signal:options.signal});
    else if (text.includes('语义演示')) await delay(300,undefined,{signal:options.signal});
    const evidence={messageId:'current',quote:text};
    const active=action=>({action,origin:'explicit',evidence,confidence:'high'});
    const plan={version:1,music:text.includes('安静片刻')?{...active('search'),title:'安静片刻'}:{action:'none'},sticker:text.includes('生气')?{...active('search'),meaning:'生气',scene:'general',emotion:'anger',intensity:2}:{action:'none'},contexts:[],help:{requested:false,topics:[]},retrieval:{question:'',variants:[],topics:[],entities:[]},responseNeeds:'task',clarification:[]};
    const call={id:'offline_plan',type:'function',function:{name:'plan_turn',arguments:JSON.stringify(plan)}};
    if(request.tools?.some(item=>item.function.name==='plan_turn')) return new Response(JSON.stringify({choices:[{index:0,message:{content:null,tool_calls:[call]},finish_reason:'tool_calls'}]}),{headers:{'content-type':'application/json'}});
    return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(plan)}}]}),{headers:{'content-type':'application/json'}});
  }
  if (question.includes('多轮计算与审核演示') && !tool && request.tools?.some(item => item.function.name === 'calculator') && request.tool_choice !== 'none') {
    const call = { id: 'offline_calc_call', type: 'function', function: { name: 'calculator', arguments: JSON.stringify({ expression: '128 * 1.25' }) } };
    if (!request.stream) return new Response(JSON.stringify({ choices: [{ index: 0, message: { content: null, tool_calls: [call] }, finish_reason: 'tool_calls' }] }), { headers: { 'content-type': 'application/json' } });
    const frames = [
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: call.id, type: call.type, function: { name: call.function.name, arguments: call.function.arguments } }] } }] },
      { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
    ];
    return new Response(frames.map(frame => `data: ${JSON.stringify(frame)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
  }
  if (request.tools?.some(item => item.function.name === 'search_music') && request.tool_choice !== 'none' && !question.includes('只回正文')) {
    const call = { id: 'offline_music_call', type: 'function', function: { name: 'search_music', arguments: JSON.stringify({ query: '安静片刻' }) } };
    if (!request.stream) return new Response(JSON.stringify({ choices: [{ index: 0, message: { content: null, tool_calls: [call] }, finish_reason: 'tool_calls' }] }), { headers: { 'content-type': 'application/json' } });
    const frames = [
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: call.id, type: call.type, function: { name: call.function.name, arguments: '{"query":"安静' } }] } }] },
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '片刻"}' } }] } }] },
      { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
    ];
    return new Response(frames.map(frame => `data: ${JSON.stringify(frame)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'application/json' } });
  }
  let content;
  if (question.includes('多轮计算与审核演示') && tool) {
    content = hasCriticFeedback
      ? '计算结果是 160。以下是为您补充的验证代码：\n\n```js\nconsole.log(128 * 1.25); // 160\n```'
      : '计算结果是 160。';
  } else if (tool) {
    const result = JSON.parse(tool.content);
    content = result.status === 'found' ? `已找到《${result.song.title}》，点击歌曲卡片后播放。` : '本轮音乐暂不可用，没有播放任何音频。';
  } else if (instruction.includes('邮件起草助手')) {
    content = JSON.stringify({ subject: '会议邀请 · 待确认', text: '你好，\n\n诚邀你参加会议，时间与地点为【待补充】。\n\n祝好！' });
  } else if (instruction.includes('提取知识图谱')) {
    const memories = JSON.parse(request.messages[1].content);
    content = JSON.stringify({ memories: memories.map(memory => ({ id: memory.id, triples: memory.content.includes('茉莉茶') ? [{ subject: { name: '用户', type: 'person' }, predicate: '喜欢', object: { name: '茉莉茶', type: 'topic' } }] : [] })) });
  } else if (instruction.includes('整理为长期记忆')) {
    content = JSON.stringify({ memories: [{ content: '用户正在验证本地 AI 助手的知识库与记忆功能。', category: 'goal', importance: 0.8, confidence: 0.95, triples: [{ subject: { name: '用户', type: 'person' }, predicate: '验证', object: { name: '本地 AI 助手', type: 'topic' } }] }] });
  } else if (instruction.includes('聊天风格分析助手')) {
    content = JSON.stringify({ overview: '测试人物倾向于清晰、直接地交流；仅依据提供的少量记录。', traits: ['表达直接'], speakingStyle: ['简洁、有条理'], boundaries: ['需要更多样本才能确定'], evidence: ['“请简洁一点”体现了对简洁表达的偏好。'], personaPrompt: '你是一位表达简洁、条理清晰的 AI 助手，不冒充真实人物。' });
  } else {
    content = '这是离线测试回复，不来自真实模型。\n\n我会参考提供的知识片段回答 [1]，并保留可追溯的来源。';
    if (instruction.includes('当前问题命中了栖忆配置指南')) content = '根据栖忆配置指南，请在对应的设置字段填写并保存，随后手动测试连接。[1]\n\n这是离线配置帮助测试回复，没有修改设置或连接外部服务。';
    if (instruction.includes('execution.stickerExplicit')) {
      const context=JSON.parse(request.messages[2].content.slice(request.messages[2].content.indexOf('{')));
      const candidate=context.stickerCandidates[0];
      content=context.song?'已找到歌曲，请点击卡片播放。':'这是离线测试回复。';
      if(candidate)content+=`\n<qiyi-media>${JSON.stringify({stickerId:candidate.id})}</qiyi-media>`;
    }
    if (question.includes('换成离线测试音源唱的')) content += '\n<qiyi-media>{"songQuery":"安静片刻 离线测试音源","songArtist":"离线测试音源"}</qiyi-media>';
    if(question.includes('媒体演示')) content += '\n<qiyi-media>{"stickerId":"leaf-cheer","songQuery":"安静片刻","songReason":"轻轻的旋律，留一点空间给思绪。"}</qiyi-media>';
    else if(question.includes('联网表情演示')) { const remote=/"id":"(remote-[a-f0-9]{64})"/u.exec(instruction)?.[1]; content += `\n<qiyi-media>${JSON.stringify(remote?{stickerId:remote}:{stickerQuery:'害羞'})}</qiyi-media>`; }
    else if(question.includes('动图演示')) {const sticker=app.api.media.list().find(s=>s.enabled&&s.animated);if(sticker)content+=`\n<qiyi-media>${JSON.stringify({stickerId:sticker.id})}</qiyi-media>`;}
    if (question.includes('状态演示')) {
      const stateField = (value, quote) => ({ value, confidence: 'high', evidence: [{ messageId: 'current', quote }] });
      content += `\n<qiyi-state>${JSON.stringify({ emotion: { ...stateField(['irritated'], '有点烦躁'), intensity: 2 }, energy: stateField('low', '今天好累'), need: stateField('listen', '先别给我建议'), roleMood: stateField('caring', '今天好累'), proactivity: stateField('low', '先别给我建议') })}</qiyi-state>`;
    }
    if (question.includes('联动演示')) {
      const stateField = (value, quote) => ({ value, confidence:'high', evidence:[{messageId:'current',quote}] });
      const prediction = question.includes('很开心') ? { emotion:{...stateField(['happy'],'很开心'),intensity:3},need:stateField('chat','轻松聊天') }
        : question.includes('解决问题') ? {need:stateField('task','解决问题')}
        : {energy:stateField('low','今天好累'),need:stateField('listen','只想说说')};
      content += `\n<qiyi-media>${JSON.stringify({stickerId:'leaf-cheer',songQuery:'安静片刻',songReason:'一首留给聊天间隙的歌曲，点击后收听。'})}</qiyi-media>\n<qiyi-state>${JSON.stringify(prediction)}</qiyi-state>`;
    }
  }
  if(request.stream)return streamingResponse(content,question,options.signal);
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { headers: { 'content-type': 'application/json' } });
};

  const start = async (listenPort, seed) => {
    const inherited = { AI_BASE_URL: process.env.AI_BASE_URL, AI_MODEL: process.env.AI_MODEL };
    // Store initialization must not overwrite persisted settings with provider environment defaults.
    try {
      delete process.env.AI_BASE_URL;
      delete process.env.AI_MODEL;
      app = await startServer({ port: listenPort, dbPath, scheduler: false, modelOptions: {
      fetchImpl, apiKey: '', musicApiKey: '', stickerApiKey: '',
      mediaFetchImpl: (url, init) => {
        calls.media.push({ url: String(url), method: init?.method || 'GET' });
        return mockMediaFetch(url, init);
      },
      petClock: () => (petTestTime += 1100),
      guideFetchImpl: async url => {
        calls.guides.push(String(url));
        const bundle = JSON.parse(readFileSync(new URL('../docs/configuration/guide-bundle.json', import.meta.url), 'utf8'));
        bundle.revision = bundle.revision.replace(/\.(\d+)$/u, (_, value) => `.${Number(value)+1}`);
        return new Response(JSON.stringify(bundle), { headers: { etag: '"offline-guide-update"' } });
      },
      smtpPassword: '',
      mailTransportFactory: () => ({
        close() {},
        verify: async () => { calls.mailVerify.push({}); return true; },
        sendMail: async message => {
          calls.mail.push(structuredClone(message));
          await delay(100);
          if (message.subject.includes('中断演示')) throw Object.assign(new Error('offline timeout'), { code: 'ETIMEDOUT', command: 'DATA' });
          const recipients = [...message.to, ...message.cc, ...message.bcc];
          return { accepted: recipients.filter(a => !a.endsWith('@reject.invalid')), rejected: recipients.filter(a => a.endsWith('@reject.invalid')) };
        },
      }),
      } });
    } finally {
      for (const [key, value] of Object.entries(inherited)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
    if (seed) app.api.updateSettings({ model: 'offline-ui-test', baseUrl: 'http://127.0.0.1:1', intentMode: 'legacy', memoryMessageThreshold: 20 });
    app.api.scheduler.recover();
  };
  // Chromium rejects certain low ports (for example 1720), which may be
  // returned by the OS for port 0 on Windows. Use the high ephemeral range.
  if (port) await start(port, true);
  else {
    for (let attempt=0;attempt<10;attempt++) {
      try { await start(randomInt(49152,65536),true); break; }
      catch(error) { if(error.code!=='EADDRINUSE' || attempt===9) throw error; }
    }
  }
  return {
    get app() { return app; },
    get url() { return app.url; },
    calls,
    failNextModel(status = 503) { modelFailures.push(status); },
    tick(time) { return app.api.scheduler.tick(time); },
    async restart() {
      if (dbPath === ':memory:') throw new Error('Restart requires a file-backed test database.');
      const currentPort = app.server.address().port;
      app.server.closeAllConnections();
      await app.close();
      await start(currentPort, false);
    },
    async close() {
      app.server.closeAllConnections();
      await app.close();
    },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const offline = await startOfflineServer({ port: 4318 });
  console.log(`Offline UI fixture: ${offline.url}; in-memory data only; no external model requests.`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => offline.close());
}
