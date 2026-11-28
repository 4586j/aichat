package com.qiyi.companion.data.db

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

@Dao
interface PersonaDao {
    @Query("SELECT * FROM personas ORDER BY createdAt ASC")
    fun observeAll(): Flow<List<PersonaEntity>>

    @Query("SELECT * FROM personas ORDER BY createdAt ASC")
    suspend fun listAll(): List<PersonaEntity>

    @Query("SELECT * FROM personas WHERE id = :id LIMIT 1")
    suspend fun getById(id: String): PersonaEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(persona: PersonaEntity)

    @Query("DELETE FROM personas WHERE id = :id")
    suspend fun deleteById(id: String)

    @Query("SELECT COUNT(*) FROM personas")
    suspend fun count(): Int
}

@Dao
interface ConversationDao {
    @Query("SELECT * FROM conversations WHERE personaId = :personaId ORDER BY updatedAt DESC")
    fun observeByPersona(personaId: String): Flow<List<ConversationEntity>>

    @Query("SELECT * FROM conversations ORDER BY updatedAt DESC")
    fun observeAll(): Flow<List<ConversationEntity>>

    @Query("SELECT * FROM conversations ORDER BY updatedAt DESC")
    suspend fun listAll(): List<ConversationEntity>

    @Query("SELECT * FROM conversations WHERE id = :id LIMIT 1")
    suspend fun getById(id: String): ConversationEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(conversation: ConversationEntity)

    @Query("UPDATE conversations SET title = :title, updatedAt = :updatedAt WHERE id = :id")
    suspend fun updateTitleAndTime(id: String, title: String, updatedAt: Long)

    @Query("UPDATE conversations SET updatedAt = :updatedAt WHERE id = :id")
    suspend fun touch(id: String, updatedAt: Long)

    @Query("UPDATE conversations SET userMood = :userMood, assistantStyle = :assistantStyle, relationshipStage = :relationshipStage, updatedAt = :updatedAt WHERE id = :id")
    suspend fun updateChatState(
        id: String,
        userMood: String,
        assistantStyle: String,
        relationshipStage: String,
        updatedAt: Long
    )

    @Query("UPDATE conversations SET contextSummary = :contextSummary, compactedUpToMessageId = :compactedUpToMessageId, compactedAt = :compactedAt, updatedAt = :updatedAt WHERE id = :id")
    suspend fun updateCompaction(
        id: String,
        contextSummary: String,
        compactedUpToMessageId: Long,
        compactedAt: Long,
        updatedAt: Long
    )

    @Query("DELETE FROM conversations WHERE id = :id")
    suspend fun deleteById(id: String)
}

@Dao
interface MessageDao {
    @Query("SELECT * FROM messages WHERE conversationId = :conversationId ORDER BY id ASC")
    fun observeByConversation(conversationId: String): Flow<List<MessageEntity>>

    @Query("SELECT * FROM messages WHERE conversationId = :conversationId ORDER BY id ASC")
    suspend fun listByConversation(conversationId: String): List<MessageEntity>

    @Query("SELECT * FROM messages WHERE conversationId = :conversationId AND id <= :upToId ORDER BY id ASC")
    suspend fun listUpTo(conversationId: String, upToId: Long): List<MessageEntity>

    @Query("SELECT * FROM messages ORDER BY id ASC")
    suspend fun listAll(): List<MessageEntity>

    @Query("DELETE FROM messages WHERE conversationId = :conversationId")
    suspend fun deleteByConversation(conversationId: String)

    @Query("DELETE FROM messages WHERE id = :id")
    suspend fun deleteById(id: Long)

    @Insert
    suspend fun insert(message: MessageEntity): Long

    @Insert
    suspend fun insertAll(messages: List<MessageEntity>)
}

@Dao
interface KnowledgeDao {
    @Query("SELECT * FROM knowledge_documents ORDER BY createdAt DESC")
    fun observeDocuments(): Flow<List<KnowledgeDocumentEntity>>

    @Query("SELECT * FROM knowledge_documents ORDER BY createdAt DESC")
    suspend fun listDocuments(): List<KnowledgeDocumentEntity>

    @Query("SELECT * FROM knowledge_chunks")
    suspend fun listAllChunks(): List<KnowledgeChunkEntity>

    @Query("DELETE FROM knowledge_chunks WHERE documentId = :documentId")
    suspend fun deleteChunksByDocument(documentId: String)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertDocument(doc: KnowledgeDocumentEntity)

    @Insert
    suspend fun insertChunks(chunks: List<KnowledgeChunkEntity>)

    @Query("DELETE FROM knowledge_documents WHERE id = :documentId")
    suspend fun deleteDocument(documentId: String)
}

@Dao
interface MemoryDao {
    @Query("SELECT * FROM memories ORDER BY isPinned DESC, importance DESC, updatedAt DESC")
    fun observeAll(): Flow<List<MemoryEntity>>

    @Query("SELECT * FROM memories ORDER BY isPinned DESC, importance DESC, updatedAt DESC")
    suspend fun listAll(): List<MemoryEntity>

    @Query("SELECT * FROM memories WHERE personaId IS NULL OR personaId = :personaId ORDER BY isPinned DESC, importance DESC, updatedAt DESC")
    suspend fun listRelevantCandidates(personaId: String): List<MemoryEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(memory: MemoryEntity)

    @Query("UPDATE memories SET isPinned = :pinned, updatedAt = :updatedAt WHERE id = :id")
    suspend fun setPinned(id: String, pinned: Boolean, updatedAt: Long)

    @Query("DELETE FROM memories WHERE id = :id")
    suspend fun deleteById(id: String)
}

@Dao
interface MusicTrackDao {
    @Query("SELECT * FROM music_tracks ORDER BY isFavorite DESC, lastPlayedAt DESC, createdAt DESC")
    fun observeAll(): Flow<List<MusicTrackEntity>>

    @Query("SELECT * FROM music_tracks ORDER BY isFavorite DESC, lastPlayedAt DESC, createdAt DESC")
    suspend fun listAll(): List<MusicTrackEntity>

    @Query("SELECT * FROM music_tracks WHERE id = :id LIMIT 1")
    suspend fun getById(id: String): MusicTrackEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(track: MusicTrackEntity)

    @Query("UPDATE music_tracks SET isFavorite = :isFavorite WHERE id = :id")
    suspend fun setFavorite(id: String, isFavorite: Boolean)

    @Query("UPDATE music_tracks SET lastPlayedAt = :playedAt WHERE id = :id")
    suspend fun touchPlayed(id: String, playedAt: Long)

    @Query("DELETE FROM music_tracks WHERE id = :id")
    suspend fun deleteById(id: String)
}

@Dao
interface UsageDao {
    @Query("SELECT * FROM usage_records ORDER BY createdAt DESC LIMIT 200")
    fun observeRecent(): Flow<List<UsageRecordEntity>>

    @Query("SELECT * FROM usage_records ORDER BY createdAt DESC")
    suspend fun listAll(): List<UsageRecordEntity>

    @Insert
    suspend fun insert(record: UsageRecordEntity)

    @Query("DELETE FROM usage_records")
    suspend fun clearAll()
}

@Dao
interface MemoryTripleDao {
    @Query("SELECT * FROM memory_triples ORDER BY createdAt DESC")
    fun observeAll(): Flow<List<MemoryTripleEntity>>

    @Query("SELECT * FROM memory_triples ORDER BY createdAt DESC")
    suspend fun listAll(): List<MemoryTripleEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(triple: MemoryTripleEntity)

    @Query("DELETE FROM memory_triples WHERE id = :id")
    suspend fun deleteById(id: String)
}

@Dao
interface ScheduledTaskDao {
    @Query("SELECT * FROM scheduled_tasks ORDER BY createdAt DESC")
    fun observeAll(): Flow<List<ScheduledTaskEntity>>

    @Query("SELECT * FROM scheduled_tasks WHERE enabled = 1")
    suspend fun listEnabled(): List<ScheduledTaskEntity>

    @Query("SELECT * FROM scheduled_tasks WHERE id = :id LIMIT 1")
    suspend fun getById(id: String): ScheduledTaskEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(task: ScheduledTaskEntity)

    @Query("UPDATE scheduled_tasks SET lastRunAt = :runAt, lastResult = :result WHERE id = :id")
    suspend fun recordRun(id: String, runAt: Long, result: String)

    @Query("DELETE FROM scheduled_tasks WHERE id = :id")
    suspend fun deleteById(id: String)
}

@Dao
interface MailDraftDao {
    @Query("SELECT * FROM mail_drafts ORDER BY updatedAt DESC")
    fun observeAll(): Flow<List<MailDraftEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(draft: MailDraftEntity)

    @Query("DELETE FROM mail_drafts WHERE id = :id")
    suspend fun deleteById(id: String)
}

@Dao
interface ResumableRunDao {
    @Query("SELECT * FROM resumable_runs ORDER BY resumeAtEpochMs ASC")
    fun observeAll(): Flow<List<ResumableRunEntity>>

    @Query("SELECT * FROM resumable_runs ORDER BY resumeAtEpochMs ASC")
    suspend fun listAll(): List<ResumableRunEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(run: ResumableRunEntity)

    @Query("DELETE FROM resumable_runs WHERE id = :id")
    suspend fun deleteById(id: String)

    @Query("DELETE FROM resumable_runs WHERE conversationId = :conversationId")
    suspend fun deleteByConversation(conversationId: String)
}

@Dao
interface AuthorizedDirectoryDao {
    @Query("SELECT * FROM authorized_directories ORDER BY createdAt DESC")
    fun observeAll(): Flow<List<AuthorizedDirectoryEntity>>

    @Query("SELECT * FROM authorized_directories ORDER BY createdAt DESC")
    suspend fun listAll(): List<AuthorizedDirectoryEntity>

    @Query("SELECT * FROM authorized_directories WHERE id = :id LIMIT 1")
    suspend fun getById(id: String): AuthorizedDirectoryEntity?

    @Query("SELECT * FROM authorized_directories WHERE alias = :alias LIMIT 1")
    suspend fun getByAlias(alias: String): AuthorizedDirectoryEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(dir: AuthorizedDirectoryEntity)

    @Query("DELETE FROM authorized_directories WHERE id = :id")
    suspend fun deleteById(id: String)
}

@Dao
interface FileSnapshotDao {
    @Query("SELECT * FROM file_snapshots ORDER BY createdAt DESC LIMIT 50")
    fun observeRecent(): Flow<List<FileSnapshotEntity>>

    @Query("SELECT * FROM file_snapshots ORDER BY createdAt DESC")
    suspend fun listAll(): List<FileSnapshotEntity>

    @Query("SELECT * FROM file_snapshots WHERE id = :id LIMIT 1")
    suspend fun getById(id: String): FileSnapshotEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(snapshot: FileSnapshotEntity)

    @Query("UPDATE file_snapshots SET restoredAt = :restoredAt WHERE id = :id")
    suspend fun markRestored(id: String, restoredAt: Long)

    @Query("DELETE FROM file_snapshots WHERE id = :id")
    suspend fun deleteById(id: String)
}

@Dao
interface AgentAuditLogDao {
    @Query("SELECT * FROM agent_audit_logs ORDER BY createdAt DESC LIMIT 100")
    fun observeRecent(): Flow<List<AgentAuditLogEntity>>

    @Query("SELECT * FROM agent_audit_logs ORDER BY createdAt DESC LIMIT 100")
    suspend fun listRecent(): List<AgentAuditLogEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(log: AgentAuditLogEntity)

    @Query("DELETE FROM agent_audit_logs")
    suspend fun clearAll()
}
