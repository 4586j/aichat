import {readEvents} from '../public/streaming.js';

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

const toolProtocolError = () => new AppError('模型返回的工具调用未授权、不完整或格式无效。', 502);
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function toolPolicy(options) {
  const provided = Object.hasOwn(options, 'tools');
  const { tools = [], toolChoice = 'auto' } = options;
  if (provided && !Array.isArray(tools)) throw new AppError('tools 必须是工具定义数组。');
  const names = new Set(tools.filter(tool => tool?.type === 'function' && typeof tool.function?.name === 'string').map(tool => tool.function.name));
  return {
    provided, names, allowed: provided && tools.length > 0 && toolChoice !== 'none',
    request: provided && tools.length ? { tools, tool_choice: toolChoice, parallel_tool_calls: false } : {},
  };
}

function hasToolData(message) {
  return message?.function_call != null || (message?.tool_calls != null &&
    (!Array.isArray(message.tool_calls) || message.tool_calls.length > 0));
}

// Never promote another choice's calls to choice zero, or silently accept extra calls.
function primaryChoice(data, field) {
  if (data?.error) throw new AppError('模型服务返回错误响应。', 502);
  if (data?.choices == null) return undefined;
  if (!Array.isArray(data.choices)) throw toolProtocolError();
  const choice = data.choices.find(item => item?.index === 0) ??
    (data.choices[0]?.index == null ? data.choices[0] : undefined);
  for (const item of data.choices) {
    if (item !== choice && (hasToolData(item?.message) || hasToolData(item?.delta) || item?.finish_reason === 'tool_calls')) throw toolProtocolError();
    if (item === choice && (item?.[field]?.function_call != null || hasToolData(item?.[field === 'message' ? 'delta' : 'message']))) throw toolProtocolError();
  }
  return choice;
}

function validateToolCall(call, policy) {
  if (!policy.allowed || !isObject(call) || call.type !== 'function' ||
      typeof call.id !== 'string' || !call.id.trim() || call.id.length > 256 ||
      !isObject(call.function) || typeof call.function.name !== 'string' ||
      !call.function.name || call.function.name.length > 64 || !policy.names.has(call.function.name) ||
      typeof call.function.arguments !== 'string' || call.function.arguments.length > (call.function.name === 'plan_turn' ? 8000 : 2000)) throw toolProtocolError();
  let args;
  try { args = JSON.parse(call.function.arguments); } catch { throw toolProtocolError(); }
  if (!isObject(args)) throw toolProtocolError();
  // Keep the wire shape: the caller owns argument semantics and tool execution.
  return { id: call.id, type: 'function', function: { name: call.function.name, arguments: call.function.arguments } };
}

function validateToolCalls(calls, finishReason, policy) {
  if (calls == null) calls = [];
  if (!Array.isArray(calls) || calls.length > 1) throw toolProtocolError();
  if (policy.provided && ['length', 'content_filter'].includes(finishReason)) throw toolProtocolError();
  if (calls.length || finishReason === 'tool_calls') {
    if (finishReason !== 'tool_calls' || calls.length !== 1) throw toolProtocolError();
    return [validateToolCall(calls[0], policy)];
  }
  return [];
}

function streamToolCalls(policy) {
  let call, finishReason;
  const addString = (target, key, value, limit) => {
    if (value === undefined) return;
    if (typeof value !== 'string' || target[key].length + value.length > limit) throw toolProtocolError();
    target[key] += value;
  };
  return {
    accept(choice) {
      const calls = choice.delta?.tool_calls;
      if (calls != null && (!Array.isArray(calls) || calls.length > 1)) throw toolProtocolError();
      if (calls?.length) {
        if (!policy.allowed || finishReason != null) throw toolProtocolError();
        const fragment = calls[0];
        if (!isObject(fragment) || fragment.index !== 0) throw toolProtocolError();
        call ??= { id: '', type: undefined, function: { name: '', arguments: '' } };
        if (fragment.type !== undefined) {
          if (fragment.type !== 'function') throw toolProtocolError();
          call.type = fragment.type;
        }
        addString(call, 'id', fragment.id, 256);
        if (fragment.function !== undefined) {
          if (!isObject(fragment.function)) throw toolProtocolError();
          addString(call.function, 'name', fragment.function.name, 64);
          addString(call.function, 'arguments', fragment.function.arguments, policy.names.has('plan_turn') ? 8000 : 2000);
        }
      }
      if (choice.finish_reason != null) {
        if (call && finishReason != null) throw toolProtocolError();
        finishReason = choice.finish_reason;
        if (policy.provided && ['length', 'content_filter'].includes(finishReason)) throw toolProtocolError();
        if (finishReason === 'tool_calls' && (!policy.allowed || !call)) throw toolProtocolError();
        if (call && finishReason !== 'tool_calls') throw toolProtocolError();
      }
    },
    result() { return validateToolCalls(call ? [call] : [], finishReason, policy); },
  };
}

function responseText(value, limit) {
  if (value == null) return '';
  if (typeof value !== 'string') throw new AppError('模型响应文本格式无效。', 502);
  if (value.length > limit) throw new AppError('模型回复或思考内容超过长度限制，请缩小问题范围后重试。', 502);
  return value;
}

function fullResponse(data, policy, includeReasoning = true) {
  const choice = primaryChoice(data, 'message');
  const toolCalls = validateToolCalls(choice?.message?.tool_calls, choice?.finish_reason, policy);
  const content = responseText(choice?.message?.content, 24000);
  const reasoning = includeReasoning ? responseText(choice?.message?.reasoning_content ?? choice?.message?.reasoning, 48000) : '';
  if (!content.trim() && !toolCalls.length) throw new AppError('模型没有返回正文，请检查模型是否支持聊天接口。', 502);
  return { content, reasoning, toolCalls };
}

async function readJsonResponse(response, signal) {
  const reader = response.body?.getReader();
  if (!reader) throw new AppError('模型返回空响应。', 502);
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  const parts = [];
  let bytes = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 2 * 1024 * 1024) throw new AppError('模型响应超过大小限制。', 502);
      parts.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(parts).toString('utf8'));
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof AppError) throw error;
    throw new AppError('模型响应格式无效或读取中断。', 502);
  } finally {
    signal.removeEventListener('abort', abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function cancellationError(signal) {
  return new AppError(signal?.aborted ? '本次回复已取消。' : '模型响应超时，请稍后重试。', signal?.aborted ? 499 : 504);
}

function thinkingOption(options) {
  if (options.thinking === undefined) return {};
  if (!isObject(options.thinking) || !['enabled','disabled'].includes(options.thinking.type) || Object.keys(options.thinking).length !== 1) throw new AppError('模型思考配置无效。');
  return {thinking:{type:options.thinking.type}};
}

export function createModel(store, { fetchImpl = fetch, apiKey = process.env.AI_API_KEY || '', timeoutMs = 90000 } = {}) {
  let secret = apiKey;
  return {
    configured() { return Boolean(store.settings().model); },
    settings() { return { ...store.settings(), hasApiKey: Boolean(secret) }; },
    setKey(value) { secret = value; },
    async complete(messages, options = {}) {
      const { json = false, maxTokens = 3000, signal } = options;
      const thinkingSetting = thinkingOption(options);
      if (options.reasoningEffort !== undefined && options.reasoningEffort !== 'low') throw new AppError('意图分析推理配置无效。');
      if (options.responseFormat !== undefined && !['json_object','json_schema'].includes(options.responseFormat)) throw new AppError('意图分析响应格式无效。');
      if (options.responseFormat === 'json_schema' && (!isObject(options.responseSchema) || JSON.stringify(options.responseSchema).length > 20000)) throw new AppError('意图分析结构定义无效。');
      const responseFormat=options.responseFormat === 'json_schema' ? {type:'json_schema',json_schema:{name:'turn_plan',strict:true,schema:options.responseSchema}} : options.responseFormat ? {type:options.responseFormat} : null;
      const thinking = { ...thinkingSetting, ...(options.reasoningEffort ? {reasoning_effort:options.reasoningEffort} : {}), ...(responseFormat ? {response_format:responseFormat} : {}) };
      const policy = toolPolicy(options);
      const config = store.settings();
      if (!config.model) throw new AppError('请先在设置中填写模型名称和 Base URL；远程服务通常还需要 API Key。', 503);
      const baseUrl = validateBaseUrl(config.baseUrl);
      const combined = AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])]);
      try {
        combined.throwIfAborted();
        const response = await fetchImpl(`${baseUrl}/chat/completions`, {
          method: 'POST', redirect: 'error', signal: combined,
          headers: { 'Content-Type': 'application/json', ...(secret ? { Authorization: `Bearer ${secret}` } : {}) },
          body: JSON.stringify({ model: config.model, messages, max_tokens: maxTokens, ...thinking, ...policy.request }),
        });
        if (combined.aborted) { await response.body?.cancel().catch(() => {}); combined.throwIfAborted(); }
        if (!response.ok) {
          await response.body?.cancel().catch(() => {});
          const hint = response.status === 401 || response.status === 403 ? '请检查 API Key 与权限。'
            : response.status === 429 ? '服务限流或额度不足，请稍后重试。'
            : response.status === 404 ? '请检查 Base URL 和模型名称。' : '请检查服务商日志或模型配置。';
          throw new AppError(`模型服务返回 HTTP ${response.status}，${hint}`, 502);
        }
        const payload = await readJsonResponse(response, combined);
        const completion=payload.usage?.completion_tokens,reasoning=payload.usage?.completion_tokens_details?.reasoning_tokens;
        const tokenUsage={...(Number.isSafeInteger(completion)&&completion>=0?{completionTokens:completion}:{}),...(Number.isSafeInteger(reasoning)&&reasoning>=0?{reasoningTokens:reasoning}:{})};
        if(Object.keys(tokenUsage).length) { try { options.onUsage?.(tokenUsage); } catch { /* Diagnostics must not affect responses. */ } }
        if (options.rejectTruncated && primaryChoice(payload, 'message')?.finish_reason === 'length') {
          const error=new AppError('意图分析达到模型输出预算，请重试或选择更快的模型。', 502);
          if(Object.keys(tokenUsage).length) error.tokenUsage=tokenUsage;
          throw error;
        }
        const result = fullResponse(payload, policy, policy.provided);
        combined.throwIfAborted();
        if (policy.provided) return { ...result, content: result.content.trim(), reasoning: result.reasoning.trim() };
        return json ? parseJson(result.content) : result.content.trim();
      } catch (error) {
        if (combined.aborted) throw cancellationError(signal);
        if (error instanceof AppError) throw error;
        if (['TimeoutError', 'AbortError'].includes(error.name)) throw cancellationError(signal);
        throw new AppError('无法连接模型服务或响应格式无效，请检查模型配置与网络。', 502);
      }
    },
    async stream(messages,options={}){
      const {maxTokens=3000,onDelta=()=>{},signal}=options;
      const thinking=thinkingOption(options);
      if(options.responseFormat!==undefined && options.responseFormat!=='json_schema')throw new AppError('模型响应格式无效。');
      if(options.responseFormat==='json_schema' && (!isObject(options.responseSchema)||JSON.stringify(options.responseSchema).length>20000))throw new AppError('模型结构定义无效。');
      const responseFormat=options.responseFormat==='json_schema'?{response_format:{type:'json_schema',json_schema:{name:'semantic_answer',strict:true,schema:options.responseSchema}}}:{};
      const policy=toolPolicy(options),pendingCalls=streamToolCalls(policy);
      const config=store.settings();
      if(!config.model)throw new AppError('请先在设置中填写模型名称和 Base URL；远程服务通常还需要 API Key。',503);
      const combined=AbortSignal.any([AbortSignal.timeout(timeoutMs),...(signal?[signal]:[])]);
      let content='',reasoning='',toolCalls=[];
      const append=async(type,value)=>{
        combined.throwIfAborted();
        if(value==null)return;
        if(typeof value!=='string')throw new AppError('模型流式文本格式无效。',502);
        if(!value)return;
        if(type==='content')content+=value;else reasoning+=value;
        if(content.length>24000||reasoning.length>48000)throw new AppError('模型回复或思考内容超过长度限制，请缩小问题范围后重试。',502);
        await onDelta({type,delta:value});
      };
      try{
        combined.throwIfAborted();
        const response=await fetchImpl(`${validateBaseUrl(config.baseUrl)}/chat/completions`,{method:'POST',redirect:'error',signal:combined,
          headers:{'Content-Type':'application/json',...(secret?{Authorization:`Bearer ${secret}`}:{})},
          body:JSON.stringify({model:config.model,messages,max_tokens:maxTokens,stream:true,...thinking,...responseFormat,...policy.request})});
        if(combined.aborted){await response.body?.cancel().catch(()=>{});combined.throwIfAborted();}
        if(!response.ok){await response.body?.cancel().catch(()=>{});throw new AppError(`模型服务返回 HTTP ${response.status}，请检查服务地址、Key、权限或稍后重试。`,502);}
        if(response.headers.get('content-type')?.includes('application/json')){
          const result=fullResponse(await readJsonResponse(response,combined),policy);
          toolCalls=result.toolCalls;
          await append('reasoning',result.reasoning);
          await append('content',result.content);
        }else{
          let finished=false;
          for await(const frame of readEvents(response.body,{signal:combined})){
            combined.throwIfAborted();
            if(frame.data.trim()==='[DONE]'){finished=true;break;}
            const choice=primaryChoice(JSON.parse(frame.data),'delta');
            if(!choice)continue;
            pendingCalls.accept(choice);
            await append('reasoning',choice.delta?.reasoning_content??choice.delta?.reasoning);
            await append('content',choice.delta?.content);
            if(choice.finish_reason)finished=true;
          }
          if(!finished)throw new AppError('模型数据流提前中断，未完成的回复没有保存，请重试。',502);
          toolCalls=pendingCalls.result();
        }
        combined.throwIfAborted();
        if(!content.trim()&&!toolCalls.length)throw new AppError('模型没有返回正文，请检查模型是否支持聊天接口。',502);
        return {content:content.trim(),reasoning:reasoning.trim(),...(policy.provided?{toolCalls}:{})};
      }catch(error){
        if(combined.aborted)throw cancellationError(signal);
        if(error instanceof AppError)throw error;
        throw new AppError('模型连接中断或流式响应格式无效，请稍后重试。',502);
      }
    },
  };
}
