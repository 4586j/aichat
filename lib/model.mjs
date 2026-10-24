export class AppError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

export function parseJson(text) {
  let input = text.trim();
  if (input.startsWith('```')) input = input.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(input); }
  catch { throw new AppError('模型返回的结构化内容无法解析，请重试或更换支持 JSON 输出的模型。', 502); }
}

export function validateBaseUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new AppError('请输入有效的模型 Base URL。'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new AppError('模型地址必须是 http(s) 地址，且不能包含账号、查询参数或片段。');
  }
  return url.href.replace(/\/+$/, '');
}

export function createModel(store, { fetchImpl = fetch, apiKey = process.env.AI_API_KEY || '', timeoutMs = 90000 } = {}) {
  let secret = apiKey;
  return {
    configured() { return Boolean(store.settings().model); },
    settings() { return { ...store.settings(), hasApiKey: Boolean(secret) }; },
    setKey(value) { secret = value; },
    async complete(messages, { json = false, maxTokens = 3000 } = {}) {
      const config = store.settings();
      if (!config.model) throw new AppError('请先在设置中填写模型名称和 Base URL；远程服务通常还需要 API Key。', 503);
      const baseUrl = validateBaseUrl(config.baseUrl);
      let response;
      try {
        response = await fetchImpl(`${baseUrl}/chat/completions`, {
          method: 'POST', redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
          headers: { 'Content-Type': 'application/json', ...(secret ? { Authorization: `Bearer ${secret}` } : {}) },
          body: JSON.stringify({ model: config.model, messages, max_tokens: maxTokens }),
        });
      } catch (error) {
        if (['TimeoutError', 'AbortError'].includes(error.name)) throw new AppError('模型响应超时，请稍后重试。', 504);
        throw new AppError('无法连接模型服务，请检查 Base URL、网络与服务状态。', 502);
      }
      if (!response.ok) {
        await response.body?.cancel();
        const hint = response.status === 401 || response.status === 403 ? '请检查 API Key 与权限。'
          : response.status === 429 ? '服务限流或额度不足，请稍后重试。'
          : response.status === 404 ? '请检查 Base URL 和模型名称。' : '请检查服务商日志或模型配置。';
        throw new AppError(`模型服务返回 HTTP ${response.status}，${hint}`, 502);
      }
      let data;
      try {
        const reader = response.body.getReader();
        const parts = [];
        let bytes = 0;
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > 2 * 1024 * 1024) { await reader.cancel(); throw new Error('large response'); }
          parts.push(Buffer.from(value));
        }
        data = JSON.parse(Buffer.concat(parts).toString('utf8'));
      } catch { throw new AppError('模型响应格式无效或超过大小限制。', 502); }
      const content = data?.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || !content.trim()) throw new AppError('模型没有返回文本，请检查模型是否支持聊天接口。', 502);
      if (content.length > 24000) throw new AppError('模型回复超过 24000 字符，请缩小问题范围后重试。', 502);
      return json ? parseJson(content) : content.trim();
    },
  };
}
