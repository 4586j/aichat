package com.qiyi.companion.data.db

import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(tableName = "personas")
data class PersonaEntity(
    @PrimaryKey val id: String,
    val name: String,
    val description: String = "",
    val systemPrompt: String,
    val tone: String = "",
    val greeting: String = "",
    val avatar: String = "",
    val model: String = "",
    val createdAt: Long = System.currentTimeMillis()
)

@Entity(
    tableName = "conversations",
    foreignKeys = [
        ForeignKey(
            entity = PersonaEntity::class,
            parentColumns = ["id"],
            childColumns = ["personaId"],
            onDelete = ForeignKey.CASCADE
        )
    ],
    indices = [Index("personaId"), Index("updatedAt")]
)
data class ConversationEntity(
    @PrimaryKey val id: String,
    val personaId: String,
    val title: String,
    val parentConversationId: String? = null,
    val branchedFromMessageId: Long? = null,
    val isGroup: Boolean = false,
    val participantIds: String = "",
    val userMood: String = "",
    val assistantStyle: String = "",
    val relationshipStage: String = "初识",
    val createdAt: Long = System.currentTimeMillis(),
    val updatedAt: Long = System.currentTimeMillis()
)

@Entity(
    tableName = "messages",
    foreignKeys = [
        ForeignKey(
            entity = ConversationEntity::class,
            parentColumns = ["id"],
            childColumns = ["conversationId"],
            onDelete = ForeignKey.CASCADE
        )
    ],
    indices = [Index("conversationId")]
)
data class MessageEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val conversationId: String,
    val role: String, // "user" | "assistant"
    val content: String,
    val reasoning: String = "",
    val senderPersonaId: String? = null,
    val senderName: String? = null,
    val stickerId: String = "",
    val citationsJson: String = "",
    val toolTrace: String = "",
    val createdAt: Long = System.currentTimeMillis()
)

@Entity(tableName = "knowledge_documents")
data class KnowledgeDocumentEntity(
    @PrimaryKey val id: String,
    val title: String,
    val sourceName: String = "",
    val chunkCount: Int = 0,
    val charCount: Int = 0,
    val createdAt: Long = System.currentTimeMillis()
)

@Entity(
    tableName = "knowledge_chunks",
    foreignKeys = [
        ForeignKey(
            entity = KnowledgeDocumentEntity::class,
            parentColumns = ["id"],
            childColumns = ["documentId"],
            onDelete = ForeignKey.CASCADE
        )
    ],
    indices = [Index("documentId")]
)
data class KnowledgeChunkEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val documentId: String,
    val documentTitle: String,
    val chunkIndex: Int,
    val content: String,
    val embeddingJson: String = ""
)

@Entity(
    tableName = "memories",
    indices = [Index("personaId"), Index("updatedAt")]
)
data class MemoryEntity(
    @PrimaryKey val id: String,
    val personaId: String? = null, // null = global user memory
    val category: String = "fact", // "fact" | "preference" | "event" | "relationship"
    val content: String,
    val importance: Int = 3, // 1..5
    val isPinned: Boolean = false,
    val createdAt: Long = System.currentTimeMillis(),
    val updatedAt: Long = System.currentTimeMillis()
)

@Entity(tableName = "music_tracks")
data class MusicTrackEntity(
    @PrimaryKey val id: String,
    val title: String,
    val artist: String = "",
    val source: String = "local", // "local" | "qq" | "netease"
    val localPath: String = "",
    val remoteUrl: String = "",
    val durationMs: Long = 0L,
    val createdAt: Long = System.currentTimeMillis()
)

@Entity(
    tableName = "usage_records",
    indices = [Index("createdAt"), Index("model")]
)
data class UsageRecordEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val conversationId: String,
    val personaId: String,
    val model: String,
    val promptTokens: Int = 0,
    val completionTokens: Int = 0,
    val totalTokens: Int = 0,
    val createdAt: Long = System.currentTimeMillis()
)

@Entity(tableName = "memory_triples")
data class MemoryTripleEntity(
    @PrimaryKey val id: String,
    val subject: String,
    val predicate: String,
    val objectValue: String,
    val createdAt: Long = System.currentTimeMillis()
)

@Entity(tableName = "scheduled_tasks")
data class ScheduledTaskEntity(
    @PrimaryKey val id: String,
    val personaId: String,
    val title: String,
    val prompt: String,
    val intervalMinutes: Int = 60,
    val enabled: Boolean = true,
    val lastRunAt: Long = 0L,
    val lastResult: String = "",
    val createdAt: Long = System.currentTimeMillis()
)

@Entity(tableName = "mail_drafts")
data class MailDraftEntity(
    @PrimaryKey val id: String,
    val recipient: String = "",
    val subject: String = "",
    val body: String = "",
    val status: String = "draft", // "draft" | "sent"
    val createdAt: Long = System.currentTimeMillis(),
    val updatedAt: Long = System.currentTimeMillis()
)

@Entity(tableName = "resumable_runs")
data class ResumableRunEntity(
    @PrimaryKey val id: String,
    val conversationId: String,
    val pendingPersonaIds: String,
    val latestQuery: String,
    val isGroupChat: Boolean = false,
    val resumeAtEpochMs: Long,
    val reason: String = "",
    val createdAt: Long = System.currentTimeMillis()
)
