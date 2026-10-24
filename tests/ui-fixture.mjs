import { startServer } from '../server.mjs';

const fetchImpl = async (_url, options) => {
  const request = JSON.parse(options.body);
  const instruction = request.messages[0].content;
  let content;
  if (instruction.includes('提取知识图谱')) {
    const memories = JSON.parse(request.messages[1].content);
    content = JSON.stringify({ memories: memories.map(memory => ({ id: memory.id, triples: memory.content.includes('茉莉茶') ? [{ subject: { name: '用户', type: 'person' }, predicate: '喜欢', object: { name: '茉莉茶', type: 'topic' } }] : [] })) });
  } else if (instruction.includes('整理为长期记忆')) {
    content = JSON.stringify({ memories: [{ content: '用户正在验证本地 AI 助手的知识库与记忆功能。', category: 'goal', importance: 0.8, confidence: 0.95, triples: [{ subject: { name: '用户', type: 'person' }, predicate: '验证', object: { name: '本地 AI 助手', type: 'topic' } }] }] });
  } else if (instruction.includes('聊天风格分析助手')) {
    content = JSON.stringify({ overview: '测试人物倾向于清晰、直接地交流；仅依据提供的少量记录。', traits: ['表达直接'], speakingStyle: ['简洁、有条理'], boundaries: ['需要更多样本才能确定'], evidence: ['“请简洁一点”体现了对简洁表达的偏好。'], personaPrompt: '你是一位表达简洁、条理清晰的 AI 助手，不冒充真实人物。' });
  } else {
    content = '这是离线测试回复，不来自真实模型。\n\n我会参考提供的知识片段回答 [1]，并保留可追溯的来源。';
  }
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { headers: { 'content-type': 'application/json' } });
};

const app = await startServer({ port: 4318, dbPath: ':memory:', modelOptions: { fetchImpl, apiKey: '' } });
app.api.updateSettings({ model: 'offline-ui-test', baseUrl: 'http://127.0.0.1:1', memoryMessageThreshold: 20 });
console.log(`Offline UI fixture: ${app.url}; in-memory data only; no external model requests.`);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => app.close());
