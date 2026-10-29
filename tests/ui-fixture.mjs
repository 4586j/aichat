import { startServer } from '../server.mjs';
import { mockMediaFetch } from './media-fixtures.mjs';
import { readFileSync } from 'node:fs';

const fetchImpl = async (_url, options) => {
  const request = JSON.parse(options.body);
  const instruction = request.messages[0].content;
  let content;
  if (instruction.includes('邮件起草助手')) {
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
    const question = request.messages.at(-1).content;
    if(question.includes('媒体演示')) content += '\n<qiyi-media>{"stickerId":"leaf-cheer","songQuery":"安静片刻","songReason":"轻轻的旋律，留一点空间给思绪。"}</qiyi-media>';
    else if(question.includes('联网表情演示')) content += '\n<qiyi-media>{"stickerQuery":"galaxyxrobot"}</qiyi-media>';
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
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { headers: { 'content-type': 'application/json' } });
};

let petTestTime = Date.now();
const app = await startServer({ port: 4318, dbPath: ':memory:', modelOptions: { fetchImpl, apiKey: '', musicApiKey:'', stickerApiKey:'', mediaFetchImpl:mockMediaFetch,
  petClock: () => (petTestTime += 1100),
  guideFetchImpl: async () => {
    const bundle = JSON.parse(readFileSync(new URL('../docs/configuration/guide-bundle.json', import.meta.url), 'utf8'));
    bundle.revision = '2026-10-28.1';
    return new Response(JSON.stringify(bundle), { headers: { etag: '"offline-guide-update"' } });
  },
  smtpPassword: '', mailTransportFactory: () => ({ close() {}, verify: async () => true, sendMail: async message => {
    await new Promise(resolve => setTimeout(resolve, 100));
    if (message.subject.includes('中断演示')) throw Object.assign(new Error('offline timeout'), { code: 'ETIMEDOUT', command: 'DATA' });
    const recipients = [...message.to, ...message.cc, ...message.bcc];
    return { accepted: recipients.filter(a => !a.endsWith('@reject.invalid')), rejected: recipients.filter(a => a.endsWith('@reject.invalid')) };
  } }),
} });
app.api.updateSettings({ model: 'offline-ui-test', baseUrl: 'http://127.0.0.1:1', memoryMessageThreshold: 20 });
console.log(`Offline UI fixture: ${app.url}; in-memory data only; no external model requests.`);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => app.close());
