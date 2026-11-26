import { id, now } from './store.mjs';
import { AppError } from './model.mjs';

const SECRET_KEY_PATTERN = /key|secret|password|pass|token|credential|auth/i;

export function filterSafeSettings(raw = {}) {
  const safe = {};
  for (const [key, val] of Object.entries(raw || {})) {
    if (SECRET_KEY_PATTERN.test(key)) continue;
    if (val === undefined) continue;
    safe[key] = val;
  }
  return safe;
}

export function exportPersonaCard(store, personaId, { includeMemories = false } = {}) {
  const role = store.get('SELECT * FROM personas WHERE id=?', String(personaId || ''));
  if (!role) throw new AppError('角色不存在。', 404);
  const memories = includeMemories
    ? store.all(
        "SELECT content, category, importance, confidence, pinned, createdAt FROM memories WHERE personaId=? AND status='active' ORDER BY pinned DESC, createdAt DESC LIMIT 200",
        role.id
      )
    : [];
  return {
    format: 'qiyi-persona-card',
    version: 1,
    exportedAt: now(),
    persona: {
      name: role.name,
      description: role.description || '',
      systemPrompt: role.systemPrompt,
      tone: role.tone || '',
      greeting: role.greeting || '',
      avatar: role.avatar || '',
      model: role.model || ''
    },
    memories: memories.map(m => ({
      content: m.content,
      category: m.category || 'fact',
      importance: Number(m.importance ?? 0.7),
      confidence: Number(m.confidence ?? 0.8),
      pinned: Boolean(m.pinned)
    }))
  };
}

export function importPersonaCard(store, payload = {}, { sanitizeAvatar } = {}) {
  if (!payload || typeof payload !== 'object') throw new AppError('角色卡 JSON 格式无效。', 400);
  if (payload.format && payload.format !== 'qiyi-persona-card') {
    throw new AppError('不支持的文件格式，请导入栖忆角色卡 JSON。', 400);
  }
  const rawPersona = payload.persona;
  if (!rawPersona || typeof rawPersona !== 'object') throw new AppError('角色卡缺少 persona 字段。', 400);

  const name = typeof rawPersona.name === 'string' ? rawPersona.name.trim().slice(0, 60) : '';
  const systemPrompt = typeof rawPersona.systemPrompt === 'string' ? rawPersona.systemPrompt.trim().slice(0, 8000) : '';
  if (!name || !systemPrompt) throw new AppError('角色卡必须包含有效的角色名称和人设提示词。', 400);

  const description = typeof rawPersona.description === 'string' ? rawPersona.description.trim().slice(0, 300) : '';
  const tone = typeof rawPersona.tone === 'string' ? rawPersona.tone.trim().slice(0, 200) : '';
  const greeting = typeof rawPersona.greeting === 'string' ? rawPersona.greeting.trim().slice(0, 1000) : '';
  const avatar = sanitizeAvatar ? sanitizeAvatar(rawPersona.avatar ?? '') : '';
  const personaModel = typeof rawPersona.model === 'string' ? rawPersona.model.trim().slice(0, 160) : '';

  const newPersonaId = id();
  const stamp = now();
  const rawMemories = Array.isArray(payload.memories) ? payload.memories.slice(0, 200) : [];
  let importedMemories = 0;

  store.transaction(() => {
    store.run(
      'INSERT INTO personas (id,name,description,systemPrompt,tone,greeting,createdAt,avatar,model) VALUES (?,?,?,?,?,?,?,?,?)',
      newPersonaId, name, description, systemPrompt, tone, greeting, stamp, avatar, personaModel
    );
    for (const mem of rawMemories) {
      if (!mem || typeof mem.content !== 'string' || !mem.content.trim()) continue;
      const content = mem.content.trim().slice(0, 1000);
      const category = ['fact', 'preference', 'goal', 'constraint', 'summary'].includes(mem.category) ? mem.category : 'fact';
      const importance = Math.max(0, Math.min(1, Number.isFinite(Number(mem.importance)) ? Number(mem.importance) : 0.7));
      const confidence = Math.max(0, Math.min(1, Number.isFinite(Number(mem.confidence)) ? Number(mem.confidence) : 0.8));
      const pinned = mem.pinned ? 1 : 0;
      store.run(
        'INSERT INTO memories (id,personaId,content,category,importance,confidence,source,mentions,accessCount,pinned,status,createdAt,reinforcedAt,lastAccessedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        id(), newPersonaId, content, category, importance, confidence, '角色卡导入', 1, 0, pinned, 'active', stamp, stamp, stamp
      );
      importedMemories++;
    }
  });

  return {
    persona: store.get('SELECT * FROM personas WHERE id=?', newPersonaId),
    importedMemories
  };
}

export function exportWorkspaceBackup(store) {
  const safeSettings = filterSafeSettings(store.settings());
  const personas = store.all('SELECT * FROM personas ORDER BY createdAt');
  const relationships = store.all('SELECT * FROM persona_relationships ORDER BY updatedAt DESC');
  const conversations = store.all('SELECT * FROM conversations ORDER BY createdAt');
  const conversationMembers = store.all('SELECT * FROM conversation_members ORDER BY conversationId, sortOrder');
  const messages = store.all('SELECT * FROM messages ORDER BY id');
  const bookmarks = store.all('SELECT * FROM message_bookmarks ORDER BY createdAt DESC');
  const journals = store.all('SELECT * FROM daily_journals ORDER BY date DESC');
  const memories = store.all('SELECT * FROM memories ORDER BY createdAt');
  const documents = store.all('SELECT * FROM documents ORDER BY createdAt');
  const chunks = store.all('SELECT * FROM chunks ORDER BY documentId, chunkIndex');
  const tasks = store.all('SELECT * FROM tasks ORDER BY createdAt');

  return {
    format: 'qiyi-workspace-backup',
    version: 1,
    exportedAt: now(),
    securityNotice: '本备份已自动剥离模型 API Key、SMTP 密码、媒体密钥等所有敏感凭据。',
    data: {
      settings: safeSettings,
      personas,
      relationships,
      conversations,
      conversationMembers,
      messages,
      bookmarks,
      journals,
      memories,
      documents,
      chunks,
      tasks
    }
  };
}

export function importWorkspaceBackup(store, payload = {}, { sanitizeAvatar } = {}) {
  if (!payload || typeof payload !== 'object') throw new AppError('备份文件无效。', 400);
  if (payload.format !== 'qiyi-workspace-backup' || !payload.data || typeof payload.data !== 'object') {
    throw new AppError('不支持的备份格式，请选择栖忆整站备份 JSON 文件。', 400);
  }
  const mode = payload.mode === 'replace' ? 'replace' : 'merge';
  if (mode === 'replace' && payload.confirmReplace !== true) {
    throw new AppError('覆盖恢复将清空当前所有本地对话与角色数据，请先勾选明确确认。', 400);
  }

  const d = payload.data;
  const personas = Array.isArray(d.personas) ? d.personas : [];
  const relationships = Array.isArray(d.relationships) ? d.relationships : [];
  const conversations = Array.isArray(d.conversations) ? d.conversations : [];
  const conversationMembers = Array.isArray(d.conversationMembers) ? d.conversationMembers : [];
  const messages = Array.isArray(d.messages) ? d.messages : [];
  const bookmarks = Array.isArray(d.bookmarks) ? d.bookmarks : [];
  const journals = Array.isArray(d.journals) ? d.journals : [];
  const memories = Array.isArray(d.memories) ? d.memories : [];
  const documents = Array.isArray(d.documents) ? d.documents : [];
  const chunks = Array.isArray(d.chunks) ? d.chunks : [];
  const tasks = Array.isArray(d.tasks) ? d.tasks : [];

  const counts = { personas: 0, conversations: 0, messages: 0, memories: 0, documents: 0, journals: 0 };

  store.transaction(() => {
    if (mode === 'replace') {
      store.db.exec(`
        DELETE FROM message_bookmarks;
        DELETE FROM daily_journals;
        DELETE FROM persona_relationships;
        DELETE FROM conversation_members;
        DELETE FROM messages;
        DELETE FROM conversation_intent_state;
        DELETE FROM conversation_response;
        DELETE FROM chat_states;
        DELETE FROM conversations;
        DELETE FROM graph_evidence;
        DELETE FROM memory_graph_state;
        DELETE FROM graph_relations;
        DELETE FROM graph_entities;
        DELETE FROM memories;
        DELETE FROM chunk_vectors;
        DELETE FROM chunks_fts;
        DELETE FROM chunks;
        DELETE FROM documents;
        DELETE FROM task_runs;
        DELETE FROM tasks;
        DELETE FROM familiarity_state;
        DELETE FROM personas;
      `);
      if (d.settings && typeof d.settings === 'object') {
        const safeSettings = filterSafeSettings(d.settings);
        if (typeof safeSettings.userAvatar === 'string' && sanitizeAvatar) {
          try { safeSettings.userAvatar = sanitizeAvatar(safeSettings.userAvatar); } catch { safeSettings.userAvatar = ''; }
        }
        for (const [k, v] of Object.entries(safeSettings)) {
          store.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)', k, JSON.stringify(v));
        }
      }
    }

    const existingPersonaIds = new Set(store.all('SELECT id FROM personas').map(r => r.id));
    for (const p of personas) {
      if (!p?.id || !p?.name || !p?.systemPrompt) continue;
      if (existingPersonaIds.has(p.id)) continue;
      let avatar = '';
      if (typeof p.avatar === 'string' && sanitizeAvatar) {
        try { avatar = sanitizeAvatar(p.avatar); } catch { avatar = ''; }
      }
      store.run(
        'INSERT INTO personas (id,name,description,systemPrompt,tone,greeting,createdAt,avatar,model) VALUES (?,?,?,?,?,?,?,?,?)',
        String(p.id), String(p.name).slice(0, 60), String(p.description || '').slice(0, 300),
        String(p.systemPrompt).slice(0, 8000), String(p.tone || '').slice(0, 200),
        String(p.greeting || '').slice(0, 1000), String(p.createdAt || now()), avatar,
        typeof p.model === 'string' ? p.model.trim().slice(0, 160) : ''
      );
      existingPersonaIds.add(p.id);
      counts.personas++;
    }

    const existingRelIds = new Set(store.all('SELECT id FROM persona_relationships').map(r => r.id));
    for (const rel of relationships) {
      if (!rel?.id || !rel?.personaAId || !rel?.personaBId) continue;
      if (!existingPersonaIds.has(rel.personaAId) || !existingPersonaIds.has(rel.personaBId)) continue;
      if (existingRelIds.has(rel.id)) continue;
      const [lo, hi] = rel.personaAId < rel.personaBId ? [rel.personaAId, rel.personaBId] : [rel.personaBId, rel.personaAId];
      const dup = store.get('SELECT id FROM persona_relationships WHERE personaAId=? AND personaBId=?', lo, hi);
      if (dup) continue;
      store.run(
        'INSERT INTO persona_relationships (id,personaAId,personaBId,sharedLabel,aToBNote,bToANote,updatedAt) VALUES (?,?,?,?,?,?,?)',
        String(rel.id), lo, hi, String(rel.sharedLabel || ''), String(rel.aToBNote || ''), String(rel.bToANote || ''), String(rel.updatedAt || now())
      );
      existingRelIds.add(rel.id);
    }

    const existingConvIds = new Set(store.all('SELECT id FROM conversations').map(r => r.id));
    const insertedConvIds = new Set();
    // Insert parent conversations first, then children, falling back cleanly if parent isn't present.
    const sortedConvs = [...conversations].sort((a, b) => (a?.parentConversationId ? 1 : 0) - (b?.parentConversationId ? 1 : 0));
    for (const c of sortedConvs) {
      if (!c?.id || !existingPersonaIds.has(c.personaId)) continue;
      if (existingConvIds.has(c.id)) continue;
      const parentId = c.parentConversationId && existingConvIds.has(c.parentConversationId) ? c.parentConversationId : null;
      store.run(
        'INSERT INTO conversations (id,personaId,title,kind,scenePrompt,maxAutoTurns,parentConversationId,branchedFromMessageId,summaryCursor,summarizedAt,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
        String(c.id), String(c.personaId), String(c.title || '新的对话').slice(0, 100),
        c.kind === 'group' ? 'group' : 'direct', String(c.scenePrompt || ''), Number(c.maxAutoTurns || 3),
        parentId, c.branchedFromMessageId ?? null, Number(c.summaryCursor || 0),
        String(c.summarizedAt || c.createdAt || now()), String(c.createdAt || now()), String(c.updatedAt || now())
      );
      existingConvIds.add(c.id);
      insertedConvIds.add(c.id);
      counts.conversations++;
    }

    for (const cm of conversationMembers) {
      if (!cm?.conversationId || !cm?.personaId) continue;
      if (!insertedConvIds.has(cm.conversationId) || !existingPersonaIds.has(cm.personaId)) continue;
      store.run(
        'INSERT OR IGNORE INTO conversation_members (conversationId,personaId,sortOrder,joinedAt) VALUES (?,?,?,?)',
        String(cm.conversationId), String(cm.personaId), Number(cm.sortOrder || 0), String(cm.joinedAt || now())
      );
    }

    const msgIdMap = new Map();
    for (const m of messages) {
      if (!m?.conversationId || !insertedConvIds.has(m.conversationId)) continue;
      const spId = m.speakerPersonaId && existingPersonaIds.has(m.speakerPersonaId) ? m.speakerPersonaId : null;
      const inserted = mode === 'replace' && Number.isInteger(Number(m.id))
        ? store.run(
            'INSERT INTO messages (id,conversationId,role,content,sources,recalledMemories,attachments,responseBehavior,musicFeedback,reasoning,origin,readAt,speakerPersonaId,directorNote,createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
            Number(m.id), String(m.conversationId), m.role === 'assistant' ? 'assistant' : 'user', String(m.content || ''),
            JSON.stringify(m.sources || []), JSON.stringify(m.recalledMemories || []), JSON.stringify(m.attachments || []),
            JSON.stringify(m.responseBehavior || {}), String(m.musicFeedback || ''), String(m.reasoning || ''),
            String(m.origin || 'user'), m.readAt || null, spId, String(m.directorNote || ''), String(m.createdAt || now())
          )
        : store.run(
            'INSERT INTO messages (conversationId,role,content,sources,recalledMemories,attachments,responseBehavior,musicFeedback,reasoning,origin,readAt,speakerPersonaId,directorNote,createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
            String(m.conversationId), m.role === 'assistant' ? 'assistant' : 'user', String(m.content || ''),
            JSON.stringify(m.sources || []), JSON.stringify(m.recalledMemories || []), JSON.stringify(m.attachments || []),
            JSON.stringify(m.responseBehavior || {}), String(m.musicFeedback || ''), String(m.reasoning || ''),
            String(m.origin || 'user'), m.readAt || null, spId, String(m.directorNote || ''), String(m.createdAt || now())
          );
      if (m.id != null) msgIdMap.set(Number(m.id), Number(inserted.lastInsertRowid));
      counts.messages++;
    }

    for (const b of bookmarks) {
      if (!b?.id || !b?.conversationId) continue;
      const mappedMsgId = msgIdMap.get(Number(b.messageId));
      if (!mappedMsgId || !existingConvIds.has(b.conversationId)) continue;
      const pid = b.personaId && existingPersonaIds.has(b.personaId) ? b.personaId : null;
      store.run(
        'INSERT OR IGNORE INTO message_bookmarks (id,messageId,conversationId,personaId,note,createdAt) VALUES (?,?,?,?,?,?)',
        String(b.id), mappedMsgId, String(b.conversationId), pid, String(b.note || ''), String(b.createdAt || now())
      );
    }

    const existingMemIds = new Set(store.all('SELECT id FROM memories').map(r => r.id));
    for (const m of memories) {
      if (!m?.id || !m?.personaId || !existingPersonaIds.has(m.personaId) || existingMemIds.has(m.id)) continue;
      store.run(
        'INSERT INTO memories (id,personaId,content,category,importance,confidence,source,mentions,accessCount,pinned,status,createdAt,reinforcedAt,lastAccessedAt,confirmedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        String(m.id), String(m.personaId), String(m.content || ''), String(m.category || 'fact'),
        Number(m.importance ?? 0.7), Number(m.confidence ?? 0.8), String(m.source || '备份恢复'),
        Number(m.mentions || 1), Number(m.accessCount || 0), m.pinned ? 1 : 0,
        m.status === 'archived' ? 'archived' : 'active', String(m.createdAt || now()),
        String(m.reinforcedAt || m.createdAt || now()), m.lastAccessedAt || null, m.confirmedAt || null
      );
      existingMemIds.add(m.id);
      counts.memories++;
    }

    const existingDocIds = new Set(store.all('SELECT id FROM documents').map(r => r.id));
    const insertedDocIds = new Set();
    for (const doc of documents) {
      if (!doc?.id || !doc?.name || existingDocIds.has(doc.id)) continue;
      store.run(
        'INSERT INTO documents (id,name,format,charCount,chunkCount,createdAt) VALUES (?,?,?,?,?,?)',
        String(doc.id), String(doc.name), String(doc.format || 'md'),
        Number(doc.charCount || 0), Number(doc.chunkCount || 0), String(doc.createdAt || now())
      );
      existingDocIds.add(doc.id);
      insertedDocIds.add(doc.id);
      counts.documents++;
    }

    for (const chunk of chunks) {
      if (!chunk?.id || !chunk?.documentId || !insertedDocIds.has(chunk.documentId)) continue;
      store.run(
        'INSERT OR IGNORE INTO chunks (id,documentId,chunkIndex,content) VALUES (?,?,?,?)',
        String(chunk.id), String(chunk.documentId), Number(chunk.chunkIndex || 1), String(chunk.content || '')
      );
      // Note: chunk_vectors & chunks_fts will be automatically hydrated on next knowledge.search()/ensureIndex().
    }

    for (const j of journals) {
      if (!j?.date || !/^\d{4}-\d{2}-\d{2}$/.test(String(j.date))) continue;
      const pid = j.personaId && existingPersonaIds.has(j.personaId) ? j.personaId : null;
      store.run(
        'INSERT OR IGNORE INTO daily_journals (date,mood,userNote,summary,companionComment,personaId,scope,updatedAt) VALUES (?,?,?,?,?,?,?,?)',
        String(j.date), String(j.mood || 'calm'), String(j.userNote || ''),
        String(j.summary || ''), String(j.companionComment || ''), pid,
        j.scope === 'persona' ? 'persona' : 'all', String(j.updatedAt || now())
      );
      counts.journals++;
    }

    const existingTaskIds = new Set(store.all('SELECT id FROM tasks').map(r => r.id));
    for (const t of tasks) {
      if (!t?.id || !t?.name || existingTaskIds.has(t.id)) continue;
      const pid = t.personaId && existingPersonaIds.has(t.personaId) ? t.personaId : null;
      store.run(
        'INSERT INTO tasks (id,name,type,personaId,prompt,scheduleType,intervalMinutes,nextRunAt,enabled,running,createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        String(t.id), String(t.name), String(t.type || 'reminder'), pid, String(t.prompt || ''),
        t.scheduleType === 'interval' ? 'interval' : 'once', t.intervalMinutes ?? null,
        String(t.nextRunAt || now()), t.enabled ? 1 : 0, 0, String(t.createdAt || now())
      );
      existingTaskIds.add(t.id);
    }
  });

  return { ok: true, mode, counts };
}
