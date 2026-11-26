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
    val content: String
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
    val createdAt: Long = System.currentTimeMillis(),
    val updatedAt: Long = System.currentTimeMillis()
)
