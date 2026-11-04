import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export const now = () => new Date().toISOString();
export const id = () => randomUUID();
export const DEFAULTS = {
  baseUrl: 'https://api.openai.com/v1', model: '', criticModel: '', musicToolMode: 'tags', intentMode: 'legacy',
  memoryMessageThreshold: 20, memoryIntervalHours: 6, memoryBudget: 300,
  agentMaxSteps: 20, agentDuplicateThreshold: 5, agentFailureThreshold: 5, agentSecurityLevel: 'standard',
  criticEnabled: true, criticMaxRetries: 1,
};

function decode(row) {
  if (!row) return null;
  const result = { ...row };
  for (const key of ['enabled', 'running', 'pinned']) {
    if (key in result) result[key] = Boolean(result[key]);
  }
  if ('criticPassed' in result && result.criticPassed !== null) {
    result.criticPassed = Boolean(result.criticPassed);
  }
  for (const key of ['sources', 'recalledMemories', 'attachments', 'responseBehavior']) {
    if (key in result) result[key] = JSON.parse(result[key]);
  }
  return result;
}

export const MIGRATIONS = [
  {
    version: 1,
    up(db) {
      if (!db.prepare('PRAGMA table_info(messages)').all().some(column => column.name === 'attachments')) {
        db.exec("ALTER TABLE messages ADD COLUMN attachments TEXT NOT NULL DEFAULT '[]'");
      }
      if (!db.prepare('PRAGMA table_info(memories)').all().some(column => column.name === 'confirmedAt')) {
        db.exec('ALTER TABLE memories ADD COLUMN confirmedAt TEXT');
      }
      if (!db.prepare('PRAGMA table_info(messages)').all().some(column => column.name === 'responseBehavior')) {
        db.exec("ALTER TABLE messages ADD COLUMN responseBehavior TEXT NOT NULL DEFAULT '{}'");
      }
      if (!db.prepare('PRAGMA table_info(messages)').all().some(column => column.name === 'musicFeedback')) {
        db.exec("ALTER TABLE messages ADD COLUMN musicFeedback TEXT NOT NULL DEFAULT ''");
      }
      if (!db.prepare('PRAGMA table_info(messages)').all().some(column => column.name === 'reasoning')) {
        db.exec("ALTER TABLE messages ADD COLUMN reasoning TEXT NOT NULL DEFAULT ''");
      }
      db.exec(`
        CREATE TABLE IF NOT EXISTS turn_traces (
          id TEXT PRIMARY KEY,
          conversationId TEXT,
          mode TEXT NOT NULL,
          modelCalls INTEGER NOT NULL DEFAULT 0,
          toolCalls INTEGER NOT NULL DEFAULT 0,
          criticScore INTEGER,
          criticPassed INTEGER,
          durationMs INTEGER NOT NULL DEFAULT 0,
          outcome TEXT NOT NULL DEFAULT 'completed',
          createdAt TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS turn_traces_conv ON turn_traces(conversationId, createdAt DESC);
      `);
    }
  },
  {
    version: 2,
    up(db) {
      db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
          chunkId UNINDEXED,
          content,
          tokenize = 'unicode61'
        );
        CREATE TRIGGER IF NOT EXISTS chunks_fts_ai AFTER INSERT ON chunks BEGIN
          INSERT INTO chunks_fts(chunkId, content) VALUES (new.id, new.content);
        END;
        CREATE TRIGGER IF NOT EXISTS chunks_fts_ad AFTER DELETE ON chunks BEGIN
          DELETE FROM chunks_fts WHERE chunkId = old.id;
        END;
        CREATE TRIGGER IF NOT EXISTS chunks_fts_au AFTER UPDATE ON chunks BEGIN
          DELETE FROM chunks_fts WHERE chunkId = old.id;
          INSERT INTO chunks_fts(chunkId, content) VALUES (new.id, new.content);
        END;
        INSERT INTO chunks_fts(chunkId, content)
          SELECT id, content FROM chunks WHERE id NOT IN (SELECT chunkId FROM chunks_fts);
      `);
    }
  }
];

export function createStore(filename = ':memory:') {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS personas (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL,
      systemPrompt TEXT NOT NULL, tone TEXT NOT NULL, greeting TEXT NOT NULL, createdAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY, personaId TEXT NOT NULL REFERENCES personas(id), title TEXT NOT NULL,
      summaryCursor INTEGER NOT NULL DEFAULT 0, summarizedAt TEXT NOT NULL,
      createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT, conversationId TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('user','assistant')), content TEXT NOT NULL,
      sources TEXT NOT NULL DEFAULT '[]', recalledMemories TEXT NOT NULL DEFAULT '[]', createdAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS messages_conversation ON messages(conversationId, id);
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, format TEXT NOT NULL, charCount INTEGER NOT NULL,
      chunkCount INTEGER NOT NULL, createdAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS chunks (
      id TEXT PRIMARY KEY, documentId TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      chunkIndex INTEGER NOT NULL, content TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS chunks_document ON chunks(documentId);
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY, personaId TEXT NOT NULL REFERENCES personas(id), content TEXT NOT NULL,
      category TEXT NOT NULL, importance REAL NOT NULL, confidence REAL NOT NULL, source TEXT NOT NULL,
      mentions INTEGER NOT NULL DEFAULT 1, accessCount INTEGER NOT NULL DEFAULT 0,
      pinned INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'active',
      createdAt TEXT NOT NULL, reinforcedAt TEXT NOT NULL, lastAccessedAt TEXT
    );
    CREATE INDEX IF NOT EXISTS memories_persona ON memories(personaId, status);
    CREATE TABLE IF NOT EXISTS graph_entities (
      id TEXT PRIMARY KEY, personaId TEXT NOT NULL REFERENCES personas(id),
      name TEXT NOT NULL, normalizedName TEXT NOT NULL, type TEXT NOT NULL,
      UNIQUE(personaId, normalizedName), UNIQUE(id, personaId)
    );
    CREATE TABLE IF NOT EXISTS graph_relations (
      id TEXT PRIMARY KEY, personaId TEXT NOT NULL REFERENCES personas(id),
      subjectId TEXT NOT NULL, predicate TEXT NOT NULL, normalizedPredicate TEXT NOT NULL, objectId TEXT NOT NULL,
      FOREIGN KEY(subjectId, personaId) REFERENCES graph_entities(id, personaId),
      FOREIGN KEY(objectId, personaId) REFERENCES graph_entities(id, personaId),
      UNIQUE(personaId, subjectId, normalizedPredicate, objectId)
    );
    CREATE INDEX IF NOT EXISTS graph_relations_subject ON graph_relations(subjectId);
    CREATE INDEX IF NOT EXISTS graph_relations_object ON graph_relations(objectId);
    CREATE TABLE IF NOT EXISTS graph_evidence (
      memoryId TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
      relationId TEXT NOT NULL REFERENCES graph_relations(id) ON DELETE CASCADE,
      PRIMARY KEY(memoryId, relationId)
    );
    CREATE INDEX IF NOT EXISTS graph_evidence_relation ON graph_evidence(relationId);
    CREATE TABLE IF NOT EXISTS memory_graph_state (
      memoryId TEXT PRIMARY KEY REFERENCES memories(id) ON DELETE CASCADE,
      contentHash TEXT NOT NULL, revision TEXT NOT NULL, extractedAt TEXT
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL,
      personaId TEXT REFERENCES personas(id), prompt TEXT NOT NULL, scheduleType TEXT NOT NULL,
      intervalMinutes INTEGER, nextRunAt TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
      running INTEGER NOT NULL DEFAULT 0, createdAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS task_runs (
      id TEXT PRIMARY KEY, taskId TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      taskName TEXT NOT NULL, status TEXT NOT NULL, result TEXT NOT NULL,
      startedAt TEXT NOT NULL, finishedAt TEXT
    );
    CREATE INDEX IF NOT EXISTS runs_task ON task_runs(taskId, startedAt);
  `);
  // Always ensure legacy columns exist even on pre-existing databases before running versioned migrations.
  if (!db.prepare('PRAGMA table_info(messages)').all().some(column => column.name === 'attachments')) {
    db.exec("ALTER TABLE messages ADD COLUMN attachments TEXT NOT NULL DEFAULT '[]'");
  }
  if (!db.prepare('PRAGMA table_info(memories)').all().some(column => column.name === 'confirmedAt')) db.exec('ALTER TABLE memories ADD COLUMN confirmedAt TEXT');
  if (!db.prepare('PRAGMA table_info(messages)').all().some(column => column.name === 'responseBehavior')) db.exec("ALTER TABLE messages ADD COLUMN responseBehavior TEXT NOT NULL DEFAULT '{}'");
  if (!db.prepare('PRAGMA table_info(messages)').all().some(column => column.name === 'musicFeedback')) db.exec("ALTER TABLE messages ADD COLUMN musicFeedback TEXT NOT NULL DEFAULT ''");
  if (!db.prepare('PRAGMA table_info(messages)').all().some(column => column.name === 'reasoning')) db.exec("ALTER TABLE messages ADD COLUMN reasoning TEXT NOT NULL DEFAULT ''");

  const currentVersion = db.prepare('PRAGMA user_version').get()?.user_version || 0;
  for (const migration of MIGRATIONS) {
    if (migration.version > currentVersion) {
      db.exec('BEGIN IMMEDIATE');
      try {
        migration.up(db);
        db.exec(`PRAGMA user_version = ${migration.version}`);
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    }
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversation_intent_state (
      conversationId TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
      value TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS response_settings (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS conversation_response (conversationId TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE, musicMuted INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS media_settings (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS stickers (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, tags TEXT NOT NULL,
      mime TEXT NOT NULL, data BLOB NOT NULL, animated INTEGER NOT NULL DEFAULT 0,
      builtin INTEGER NOT NULL DEFAULT 0, enabled INTEGER NOT NULL DEFAULT 1, createdAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS music_catalog (id TEXT PRIMARY KEY, service TEXT NOT NULL, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sticker_profiles (stickerId TEXT PRIMARY KEY REFERENCES stickers(id) ON DELETE CASCADE, scene TEXT NOT NULL, intensity INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS remote_stickers (id TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS mail_settings (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS configuration_guides (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS chat_states (
      conversationId TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
      value TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0, manualRevision INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS familiarity_state (
      personaId TEXT PRIMARY KEY REFERENCES personas(id), score INTEGER, note TEXT NOT NULL DEFAULT '',
      revision INTEGER NOT NULL DEFAULT 0, updatedAt TEXT
    );
    CREATE TABLE IF NOT EXISTS pet_state (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS pet_profiles (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, bond INTEGER NOT NULL DEFAULT 0,
      petCount INTEGER NOT NULL DEFAULT 0, feedCount INTEGER NOT NULL DEFAULT 0, playCount INTEGER NOT NULL DEFAULT 0,
      lastInteractionAt INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS mail_outbox (
      id TEXT PRIMARY KEY, status TEXT NOT NULL, value TEXT NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS chunk_vectors (
      chunkId TEXT PRIMARY KEY REFERENCES chunks(id) ON DELETE CASCADE,
      headingPath TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT 'qiyi-hybrid-vec-v1',
      dim INTEGER NOT NULL DEFAULT 256,
      vector BLOB NOT NULL
    );
  `);
  const stmtCache = new Map();
  const prepare = sql => {
    let stmt = stmtCache.get(sql);
    if (!stmt) {
      if (stmtCache.size >= 160) stmtCache.clear();
      stmt = db.prepare(sql);
      stmtCache.set(sql, stmt);
    }
    return stmt;
  };
  const store = {
    db,
    run(sql, ...params) { return prepare(sql).run(...params); },
    get(sql, ...params) { return decode(prepare(sql).get(...params)); },
    all(sql, ...params) { return prepare(sql).all(...params).map(decode); },
    transaction(fn) {
      db.exec('BEGIN IMMEDIATE');
      try { const value = fn(); db.exec('COMMIT'); return value; }
      catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    settings() {
      return { ...DEFAULTS, ...Object.fromEntries(store.all('SELECT * FROM settings').map(row => [row.key, JSON.parse(row.value)])) };
    },
    saveSettings(values) {
      store.transaction(() => {
        for (const [key, value] of Object.entries(values)) {
          store.run('INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, JSON.stringify(value));
        }
      });
      return store.settings();
    },
    schemaVersion() {
      return db.prepare('PRAGMA user_version').get()?.user_version || 0;
    },
    close() { db.close(); },
  };
  if (!store.get('SELECT id FROM personas LIMIT 1')) {
    store.run('INSERT INTO personas VALUES (?,?,?,?,?,?,?)', id(), '望舒', '认真倾听，也帮你把事情想清楚。',
      '你是望舒，一位温和、清醒、可靠的中文 AI 助手。认真理解用户的问题，优先给出具体、可执行的建议。不假装拥有人的经历或感受。无法确定的内容明确说明。',
      '温和、简洁、有条理', '你好，我是望舒。想聊聊今天的事，还是一起完成一个计划？', now());
  }
  const initial = {};
  if (process.env.AI_BASE_URL) initial.baseUrl = process.env.AI_BASE_URL;
  if (process.env.AI_MODEL) initial.model = process.env.AI_MODEL;
  if (Object.keys(initial).length) store.saveSettings(initial);
  return store;
}
