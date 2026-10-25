import { AppError } from './model.mjs';
import { parseMediaReply } from './media.mjs';

export const STATE_TTL = 30 * 60_000;
export const STATE_OPTIONS = {
  emotion: { unknown: '暂不判断', calm: '平静', happy: '开心', irritated: '有些烦躁', sad: '失落', worried: '担心', excited: '兴奋' },
  energy: { unknown: '未知', high: '充足', normal: '一般', low: '疲惫' },
  need: { unknown: '尚不明确', listen: '想被倾听', advice: '想要建议', task: '一起解决问题', chat: '轻松聊聊' },
  roleMood: { persona: '跟随人设', serious: '认真', caring: '温和关切', light: '轻松', curious: '好奇', playful: '俏皮' },
  proactivity: { low: '少追问', normal: '正常', high: '主动一点' },
};
export const STATE_LABELS = { emotion: '当前情绪', energy: '精力状态', need: '当前需要', roleMood: '角色状态', proactivity: '主动程度' };
const KEYS = Object.keys(STATE_OPTIONS);
const initialValue = key => key === 'emotion' ? ['unknown'] : key === 'roleMood' ? 'persona' : key === 'proactivity' ? 'normal' : 'unknown';
const defaultField = key => ({ value: initialValue(key), intensity: null, confidence: 'unknown', origin: 'default', evidence: [], updatedAt: null, expiresAt: null, note: '' });
const stage = score => score >= 60 ? '熟悉' : score >= 25 ? '逐渐熟悉' : '初识';
const cleanNote = value => {
  if (typeof value !== 'string' || value.length > 200 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) throw new AppError('状态备注最多 200 个字符，不能包含控制字符。');
  return value.trim();
};
function fieldValue(key, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AppError('状态字段格式无效。');
  const value = input.value;
  if (key === 'emotion') {
    if (!Array.isArray(value) || !value.length || value.length > 2 || new Set(value).size !== value.length || value.some(item => !Object.hasOwn(STATE_OPTIONS.emotion, item)) || (value.includes('unknown') && value.length !== 1)) throw new AppError('请选择一至两种有效情绪；暂不判断不能与其他情绪同时选择。');
    const intensity = value[0] === 'unknown' ? null : input.intensity;
    if (value[0] !== 'unknown' && (!Number.isInteger(intensity) || intensity < 1 || intensity > 5)) throw new AppError('情绪强度必须是 1～5 的整数。');
    return { value: [...value], intensity };
  }
  if (!Object.hasOwn(STATE_OPTIONS[key], value)) throw new AppError(`${STATE_LABELS[key]}无效。`);
  return { value, intensity: null };
}

// State metadata is accepted only as a standalone footer outside literal examples.
export function parseStateReply(raw) {
  function peel(text) {
    const match = /(?:^|\n)<qiyi-state>([^\n]*)<\/qiyi-state>\s*$/u.exec(text);
    if (!match) return null;
    const prefix = text.slice(0, match.index); let fence = null, literalPrefix = '';
    for (const line of prefix.split('\n')) {
      const tag = /^ {0,3}(`{3,}|~{3,})/u.exec(line)?.[1];
      if (tag) { if (!fence) fence = tag; else if (tag[0] === fence[0] && tag.length >= fence.length) fence = null; }
      else if (!fence) literalPrefix += `${line}\n`;
    }
    if (fence || literalPrefix.lastIndexOf('<!--') > literalPrefix.lastIndexOf('-->') || (literalPrefix.match(/`/gu)?.length || 0) % 2) return null;
    let prediction = null;
    try { if (match[1].length <= 8000) { const value = JSON.parse(match[1]); if (value && typeof value === 'object' && !Array.isArray(value)) prediction = value; } } catch { /* Preserve the answer when optional state metadata is malformed. */ }
    return { content: prefix.trimEnd(), prediction };
  }
  const direct = peel(raw); if (direct) return direct;
  const media = parseMediaReply(raw);
  if (media.content !== raw) {
    const nested = peel(media.content);
    if (nested) return { ...nested, content: `${nested.content}\n<qiyi-media>${JSON.stringify(media.intent)}</qiyi-media>` };
  }
  return { content: raw, prediction: null };
}

export function createChatState(store, { stateClock = Date.now } = {}) {
  const stamp = () => new Date(stateClock()).toISOString();
  function raw(conversationId) {
    const row = conversationId ? store.get('SELECT * FROM chat_states WHERE conversationId=?', conversationId) : null;
    return row ? { ...JSON.parse(row.value), revision: row.revision, manualRevision: row.manualRevision } : { mode: 'assist', fields: {}, revision: 0, manualRevision: 0 };
  }
  function activeFields(record) {
    return Object.fromEntries(KEYS.map(key => {
      const field = record.fields[key];
      return [key, field && Date.parse(field.expiresAt) > stateClock() && record.mode !== 'off' && (record.mode !== 'manual' || field.origin === 'manual') ? field : defaultField(key)];
    }));
  }
  function familiarity(personaId) {
    const all = store.all("SELECT id,content,category,confidence,source,mentions,confirmedAt FROM memories WHERE personaId=? AND status='active' ORDER BY createdAt,id", personaId);
    const seen = new Set();
    const memories = all.filter(memory => {
      if (memory.category === 'summary' || memory.confidence < .7 || !(memory.source === 'manual' || memory.confirmedAt)) return false;
      const normalized = memory.content.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim();
      if (seen.has(normalized)) return false; seen.add(normalized); return true;
    });
    const categories = [...new Set(memories.map(m => m.category))], reinforced = memories.filter(m => m.mentions > 1).length;
    const automaticScore = Math.min(100, memories.length * 8 + categories.length * 3 + Math.min(10, reinforced) * 2);
    const manual = store.get('SELECT * FROM familiarity_state WHERE personaId=?', personaId);
    const score = manual?.score ?? automaticScore;
    return { score, stage: stage(score), automaticScore, automaticStage: stage(automaticScore), origin: manual?.score != null ? 'manual' : 'computed',
      note: manual?.note || '', revision: manual?.revision || 0, updatedAt: manual?.updatedAt || null,
      basis: { confirmedCount: memories.length, categories, reinforcedCount: reinforced, excludedCount: all.length - memories.length,
        formula: '每条不重复的已确认活跃记忆 8 分，每类资料 3 分，有重复提及的记忆每条另加 2 分（最多 10 条），总分上限 100。',
        memories: memories.slice(0, 20).map(({ id, content, category, source, confirmedAt }) => ({ id, content, category, source, confirmedAt })) } };
  }
  function view(personaId, conversationId = null) {
    const record = raw(conversationId), fields = activeFields(record);
    for (const [key, field] of Object.entries(fields)) {
      if (!field.evidence.length) continue;
      field.evidence = field.evidence.filter(item => {
        const message = store.get("SELECT content FROM messages WHERE id=? AND conversationId=? AND role='user'", item.messageId, conversationId);
        return message?.content.includes(item.quote);
      });
      if (field.origin === 'model' && !field.evidence.length) fields[key] = defaultField(key);
    }
    return { personaId, conversationId, mode: record.mode, revision: record.revision, manualRevision: record.manualRevision, fields, familiarity: familiarity(personaId),
      options: STATE_OPTIONS, labels: STATE_LABELS, ttlMinutes: STATE_TTL / 60_000, serverNow: stateClock() };
  }
  function forModel(personaId, conversationId) {
    const value = view(personaId, conversationId);
    if (value.mode === 'off') return { mode: 'off' };
    return { mode: value.mode, fields: Object.fromEntries(KEYS.map(key => [key, { value: value.fields[key].value, intensity: value.fields[key].intensity, origin: value.fields[key].origin }])),
      familiarity: { stage: value.familiarity.stage, score: value.familiarity.score, knownItems: value.familiarity.basis.confirmedCount },
      scope: '本会话短期状态；手动指定优先。熟悉程度只表示掌握的已确认资料，不代表信任、好感或权限。' };
  }
  function prompt(mode) {
    const common = '当前对话状态见参考 JSON。结合用户本轮文字调整回复：疲惫时简洁，想倾诉时先倾听，主动程度低时少追问。保持原有人设与用户互动边界。不要把一时情绪当作长期性格，不作心理诊断，不把疲惫自动判断成悲伤。状态只影响措辞、长度和聊天中的建议，不代表修改设置、发信或播放音乐的授权。';
    if (mode !== 'assist') return common + '当前只采用用户手动指定的状态，不生成状态分析元数据。';
    return common + `\n同时辅助识别状态，但不要在正文宣读状态数值。状态可选值：${JSON.stringify(STATE_OPTIONS)}。在正文和可选 qiyi-media 媒体块之后，最后单独一行追加 <qiyi-state>{"emotion":{"value":["unknown"],"intensity":null,"confidence":"medium","evidence":[]},"energy":{"value":"unknown","confidence":"medium","evidence":[]},"need":{"value":"unknown","confidence":"medium","evidence":[]},"roleMood":{"value":"serious","confidence":"medium","evidence":[]},"proactivity":{"value":"normal","confidence":"medium","evidence":[]}}</qiyi-state>。不要输出熟悉分数。每项 evidence 最多两条，格式 {"messageId":"current 或提供的用户消息数字ID","quote":"用户原话中的连续短引文，最多120字符"}。messageId 为 current 时引用本轮用户文字。只能引用用户实际说过的内容，不能引用助手、知识库或记忆中的语句当作用户本轮情绪证据。情绪最多两项，已知情绪 intensity 为1～5整数。confidence只取low/medium/high；把握不足、无原话证据时使用未知值或省略该项。手动指定项不得被推测覆盖，不能按消息数量提高熟悉程度。`;
  }
  const evidenceMessages = history => history.filter(row => row.role === 'user' && Number.isFinite(Date.parse(row.createdAt)) && stateClock() - Date.parse(row.createdAt) < STATE_TTL).slice(-8);
  function normalizePrediction(prediction, userMessages) {
    const result = {};
    if (!prediction || typeof prediction !== 'object' || Array.isArray(prediction)) return result;
    for (const key of KEYS) {
      const input = prediction[key]; if (!input) continue;
      try {
        const value = fieldValue(key, input);
        if (!['low', 'medium', 'high'].includes(input.confidence) || !Array.isArray(input.evidence) || input.evidence.length > 2) continue;
        const evidence = input.evidence.flatMap(item => {
          if (!item || typeof item.quote !== 'string' || !item.quote.trim() || item.quote.length > 120 || /[\x00-\x1f]/.test(item.quote)) return [];
          const message = userMessages.find(row => row.id === item.messageId && row.role === 'user' && (row.id === 'current' || (Number.isFinite(Date.parse(row.createdAt)) && stateClock() - Date.parse(row.createdAt) < STATE_TTL)));
          return message?.content.includes(item.quote) ? [{ messageId: message.id, quote: item.quote }] : [];
        });
        if (!evidence.length) continue;
        const evidenceTime = Math.max(...evidence.map(item => item.messageId === 'current' ? stateClock() : Date.parse(userMessages.find(row => row.id === item.messageId).createdAt)));
        result[key] = { ...(input.confidence === 'low' ? { value: initialValue(key), intensity: null } : value), confidence: input.confidence,
          evidence, origin: 'model', note: input.confidence === 'low' ? '判断把握偏低，保留默认或未知状态。' : '', updatedAt: stamp(), expiresAt: new Date(Math.min(stateClock(), evidenceTime) + STATE_TTL).toISOString() };
      } catch { /* Ignore invalid fields independently, never guess a replacement. */ }
    }
    return result;
  }
  function save(conversationId, record, manual = false) {
    store.run('INSERT INTO chat_states(conversationId,value,revision,manualRevision) VALUES (?,?,1,?) ON CONFLICT(conversationId) DO UPDATE SET value=excluded.value,revision=chat_states.revision+1,manualRevision=chat_states.manualRevision+?',
      conversationId, JSON.stringify({ mode: record.mode, fields: record.fields }), Number(manual), Number(manual));
  }
  function commit(conversationId, prediction, userMessages, currentMessageId) {
    const record = raw(conversationId); if (record.mode !== 'assist') return;
    const proposed = normalizePrediction(prediction, userMessages); let changed = false;
    const fields = activeFields(record);
    for (const [key, value] of Object.entries(proposed)) {
      if (fields[key].origin === 'manual') continue;
      record.fields[key] = { ...value, evidence: value.evidence.map(item => ({ ...item, messageId: item.messageId === 'current' ? currentMessageId : item.messageId })) }; changed = true;
    }
    if (changed) save(conversationId, record);
  }
  function preview(personaId, conversationId, prediction, userMessages) {
    const current = view(personaId, conversationId);
    if (current.mode === 'assist') for (const [key, field] of Object.entries(normalizePrediction(prediction, userMessages))) {
      if (current.fields[key].origin !== 'manual') current.fields[key] = field;
    }
    return current;
  }
  function validateUpdate(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AppError('状态更新格式无效。');
    const update = { fields: {}, reset: [] };
    if ('mode' in input) { if (!['assist', 'manual', 'off'].includes(input.mode)) throw new AppError('状态模式无效。'); update.mode = input.mode; }
    if ('fields' in input) {
      if (!input.fields || typeof input.fields !== 'object' || Array.isArray(input.fields) || Object.keys(input.fields).some(key => !KEYS.includes(key))) throw new AppError('状态字段无效。');
      for (const [key, value] of Object.entries(input.fields)) update.fields[key] = { ...fieldValue(key, value), note: cleanNote(value.note ?? '') };
    }
    if ('reset' in input) { if (!Array.isArray(input.reset) || input.reset.some(key => !KEYS.includes(key))) throw new AppError('恢复自动的字段无效。'); update.reset = [...new Set(input.reset)]; }
    if (Object.keys(update.fields).some(key => update.reset.includes(key))) throw new AppError('同一字段不能同时指定和恢复自动。');
    if ('clear' in input) { if (typeof input.clear !== 'boolean') throw new AppError('清空状态必须为布尔值。'); update.clear = input.clear; }
    if ('familiarity' in input) {
      const f = input.familiarity;
      if (!f || !['manual', 'computed'].includes(f.mode) || !Number.isInteger(f.expectedRevision) || f.expectedRevision < 0) throw new AppError('熟悉程度更新格式无效。');
      if (f.mode === 'manual' && (!Number.isInteger(f.score) || f.score < 0 || f.score > 100)) throw new AppError('熟悉程度分数必须为 0～100 的整数。');
      const note = cleanNote(f.note ?? ''); if (f.mode === 'manual' && !note) throw new AppError('请说明手动设定熟悉程度的依据。');
      update.familiarity = { ...f, note };
    }
    if (!Number.isInteger(input.expectedManualRevision) || input.expectedManualRevision < 0) throw new AppError('状态版本无效，请重新读取。');
    update.expectedManualRevision = input.expectedManualRevision;
    if (!('mode' in update) && !Object.keys(update.fields).length && !update.reset.length && !update.clear && !update.familiarity) throw new AppError('没有需要保存的状态修改。');
    return update;
  }
  function update(personaId, conversationId, input, createConversation) {
    const patch = validateUpdate(input); let conversation = conversationId ? store.get('SELECT * FROM conversations WHERE id=?', conversationId) : null;
    store.transaction(() => {
      const record = raw(conversationId);
      if (record.manualRevision !== patch.expectedManualRevision) throw new AppError('状态已被另一处修改，请重新读取后再保存。', 409);
      if (patch.familiarity && familiarity(personaId).revision !== patch.familiarity.expectedRevision) throw new AppError('该角色的熟悉程度已变化，请重新读取后再保存。', 409);
      const changesConversation = 'mode' in patch || patch.clear || patch.reset.length || Object.keys(patch.fields).length;
      if (changesConversation) {
        if (!conversation) { conversation = createConversation(); conversationId = conversation.id; }
        if (patch.clear) record.fields = {};
        if (patch.mode) record.mode = patch.mode;
        for (const key of patch.reset) delete record.fields[key];
        if (record.mode === 'off') record.fields = {};
        else {
          if (record.mode === 'manual') for (const key of KEYS) if (record.fields[key]?.origin !== 'manual') delete record.fields[key];
          for (const [key, value] of Object.entries(patch.fields)) record.fields[key] = { ...value, confidence: 'confirmed', evidence: [], origin: 'manual', updatedAt: stamp(), expiresAt: new Date(stateClock() + STATE_TTL).toISOString() };
        }
        save(conversationId, record, true);
      }
      if (patch.familiarity) store.run('INSERT INTO familiarity_state(personaId,score,note,revision,updatedAt) VALUES (?,?,?,1,?) ON CONFLICT(personaId) DO UPDATE SET score=excluded.score,note=excluded.note,revision=familiarity_state.revision+1,updatedAt=excluded.updatedAt',
        personaId, patch.familiarity.mode === 'manual' ? patch.familiarity.score : null, patch.familiarity.mode === 'manual' ? patch.familiarity.note : '', stamp());
    });
    return { conversation, chatState: view(personaId, conversationId) };
  }
  return { view, forModel, prompt, commit, preview, update, familiarity, normalizePrediction, evidenceMessages };
}
