package com.qiyi.companion.data.backup

import com.qiyi.companion.data.db.ConversationEntity
import com.qiyi.companion.data.db.KnowledgeChunkEntity
import com.qiyi.companion.data.db.KnowledgeDocumentEntity
import com.qiyi.companion.data.db.MemoryEntity
import com.qiyi.companion.data.db.MessageEntity
import com.qiyi.companion.data.db.PersonaEntity
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

@Serializable
data class QiYiBackupEnvelope(
    val format: String = BackupCodec.FORMAT_NAME,
    val version: Int = BackupCodec.FORMAT_VERSION,
    val exportedAt: String = "",
    val personas: List<BackupPersona> = emptyList(),
    val conversations: List<BackupConversation> = emptyList(),
    val messages: List<BackupMessage> = emptyList(),
    val knowledgeDocuments: List<BackupKnowledgeDocument> = emptyList(),
    val knowledgeChunks: List<BackupKnowledgeChunk> = emptyList(),
    val memories: List<BackupMemory> = emptyList()
)

@Serializable
data class BackupPersona(
    val id: String,
    val name: String,
    val description: String = "",
    val systemPrompt: String,
    val tone: String = "",
    val greeting: String = "",
    val avatar: String = "",
    val model: String = "",
    val createdAt: Long = 0L
)

@Serializable
data class BackupConversation(
    val id: String,
    val personaId: String,
    val title: String,
    val parentConversationId: String? = null,
    val branchedFromMessageId: Long? = null,
    val isGroup: Boolean = false,
    val participantIds: String = "",
    val userMood: String = "",
    val assistantStyle: String = "",
    val relationshipStage: String = "初识",
    val createdAt: Long = 0L,
    val updatedAt: Long = 0L
)

@Serializable
data class BackupMessage(
    val id: Long = 0L,
    val conversationId: String,
    val role: String,
    val content: String,
    val reasoning: String = "",
    val senderPersonaId: String? = null,
    val senderName: String? = null,
    val createdAt: Long = 0L
)

@Serializable
data class BackupKnowledgeDocument(
    val id: String,
    val title: String,
    val sourceName: String = "",
    val chunkCount: Int = 0,
    val charCount: Int = 0,
    val createdAt: Long = 0L
)

@Serializable
data class BackupKnowledgeChunk(
    val documentId: String,
    val documentTitle: String,
    val chunkIndex: Int,
    val content: String
)

@Serializable
data class BackupMemory(
    val id: String,
    val personaId: String? = null,
    val category: String = "fact",
    val content: String,
    val importance: Int = 3,
    val createdAt: Long = 0L,
    val updatedAt: Long = 0L
)

data class BackupPayload(
    val personas: List<PersonaEntity>,
    val conversations: List<ConversationEntity>,
    val messages: List<MessageEntity>,
    val knowledgeDocuments: List<KnowledgeDocumentEntity>,
    val knowledgeChunks: List<KnowledgeChunkEntity>,
    val memories: List<MemoryEntity>
)

/**
 * Encodes/decodes full local offline backups (STRICTLY excluding API keys & credentials)
 * and formats conversations into clean Markdown files.
 */
object BackupCodec {
    const val FORMAT_NAME = "qiyi-android-backup"
    const val FORMAT_VERSION = 1

    private val json = Json {
        prettyPrint = true
        ignoreUnknownKeys = true
        encodeDefaults = true
    }

    fun encodeBackup(payload: BackupPayload): String {
        val iso = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
            timeZone = TimeZone.getTimeZone("UTC")
        }.format(Date())

        val envelope = QiYiBackupEnvelope(
            format = FORMAT_NAME,
            version = FORMAT_VERSION,
            exportedAt = iso,
            personas = payload.personas.map {
                BackupPersona(it.id, it.name, it.description, it.systemPrompt, it.tone, it.greeting, it.avatar, it.model, it.createdAt)
            },
            conversations = payload.conversations.map {
                BackupConversation(it.id, it.personaId, it.title, it.parentConversationId, it.branchedFromMessageId, it.isGroup, it.participantIds, it.userMood, it.assistantStyle, it.relationshipStage, it.createdAt, it.updatedAt)
            },
            messages = payload.messages.map {
                BackupMessage(it.id, it.conversationId, it.role, it.content, it.reasoning, it.senderPersonaId, it.senderName, it.createdAt)
            },
            knowledgeDocuments = payload.knowledgeDocuments.map {
                BackupKnowledgeDocument(it.id, it.title, it.sourceName, it.chunkCount, it.charCount, it.createdAt)
            },
            knowledgeChunks = payload.knowledgeChunks.map {
                BackupKnowledgeChunk(it.documentId, it.documentTitle, it.chunkIndex, it.content)
            },
            memories = payload.memories.map {
                BackupMemory(it.id, it.personaId, it.category, it.content, it.importance, it.createdAt, it.updatedAt)
            }
        )
        return json.encodeToString(QiYiBackupEnvelope.serializer(), envelope)
    }

    fun decodeBackup(rawJson: String): BackupPayload {
        val envelope = runCatching {
            json.decodeFromString(QiYiBackupEnvelope.serializer(), rawJson)
        }.getOrElse {
            throw IllegalArgumentException("备份文件 JSON 格式无效，无法解析。")
        }
        require(envelope.format == FORMAT_NAME) { "不是有效的栖忆备份文件（format=${envelope.format}）。" }

        return BackupPayload(
            personas = envelope.personas.map {
                PersonaEntity(it.id, it.name, it.description, it.systemPrompt, it.tone, it.greeting, it.avatar, it.model, it.createdAt)
            },
            conversations = envelope.conversations.map {
                ConversationEntity(it.id, it.personaId, it.title, it.parentConversationId, it.branchedFromMessageId, it.isGroup, it.participantIds, it.userMood, it.assistantStyle, it.relationshipStage, it.createdAt, it.updatedAt)
            },
            messages = envelope.messages.map {
                MessageEntity(id = 0L, conversationId = it.conversationId, role = it.role, content = it.content, reasoning = it.reasoning, senderPersonaId = it.senderPersonaId, senderName = it.senderName, createdAt = it.createdAt)
            },
            knowledgeDocuments = envelope.knowledgeDocuments.map {
                KnowledgeDocumentEntity(it.id, it.title, it.sourceName, it.chunkCount, it.charCount, it.createdAt)
            },
            knowledgeChunks = envelope.knowledgeChunks.map {
                KnowledgeChunkEntity(id = 0L, documentId = it.documentId, documentTitle = it.documentTitle, chunkIndex = it.chunkIndex, content = it.content)
            },
            memories = envelope.memories.map {
                MemoryEntity(it.id, it.personaId, it.category, it.content, it.importance, it.createdAt, it.updatedAt)
            }
        )
    }

    fun formatConversationMarkdown(
        conversation: ConversationEntity,
        messages: List<MessageEntity>,
        defaultSpeakerName: String
    ): String {
        val formatter = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.getDefault())
        return buildString {
            append("# ").append(conversation.title).append("\n\n")
            append("- 类型：").append(if (conversation.isGroup) "多角色群聊" else "单聊").append('\n')
            append("- 导出时间：").append(formatter.format(Date())).append("\n\n")
            append("---\n\n")
            for (msg in messages) {
                val speaker = if (msg.role == "user") {
                    "我"
                } else {
                    msg.senderName?.ifBlank { null } ?: defaultSpeakerName
                }
                append("### ").append(speaker).append("（").append(formatter.format(Date(msg.createdAt))).append("）\n\n")
                if (msg.reasoning.isNotBlank()) {
                    append("<details>\n<summary>思考过程</summary>\n\n")
                    append(msg.reasoning.trim()).append("\n\n</details>\n\n")
                }
                append(msg.content.trim()).append("\n\n")
            }
        }
    }
}
