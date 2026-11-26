package com.qiyi.companion.data

import com.qiyi.companion.data.card.PersonaCardCodec
import com.qiyi.companion.data.db.ConversationEntity
import com.qiyi.companion.data.db.KnowledgeChunkEntity
import com.qiyi.companion.data.db.KnowledgeDocumentEntity
import com.qiyi.companion.data.db.MemoryEntity
import com.qiyi.companion.data.db.MessageEntity
import com.qiyi.companion.data.db.PersonaEntity
import com.qiyi.companion.data.db.QiYiDatabase
import com.qiyi.companion.data.knowledge.KnowledgeEngine
import com.qiyi.companion.data.knowledge.KnowledgeHit
import com.qiyi.companion.data.network.ChatPromptMessage
import com.qiyi.companion.data.network.OpenAiClient
import com.qiyi.companion.data.network.StreamChunk
import com.qiyi.companion.data.prefs.AppSettings
import com.qiyi.companion.data.prefs.GardenThemeMode
import com.qiyi.companion.data.prefs.SecurePreferences
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow
import java.util.UUID

class QiYiRepository(
    private val db: QiYiDatabase,
    private val prefs: SecurePreferences,
    private val client: OpenAiClient = OpenAiClient()
) {
    val settings: StateFlow<AppSettings> = prefs.settings
    val personas: Flow<List<PersonaEntity>> = db.personaDao().observeAll()
    val allConversations: Flow<List<ConversationEntity>> = db.conversationDao().observeAll()
    val knowledgeDocuments: Flow<List<KnowledgeDocumentEntity>> = db.knowledgeDao().observeDocuments()
    val memories: Flow<List<MemoryEntity>> = db.memoryDao().observeAll()

    suspend fun ensureDefaultPersona(): PersonaEntity {
        val existing = db.personaDao().listAll()
        if (existing.isNotEmpty()) return existing.first()
        val defaultRole = PersonaEntity(
            id = UUID.randomUUID().toString(),
            name = "望舒",
            description = "认真倾听，也帮你把事情想清楚。",
            systemPrompt = "你是「望舒」，一位温和、简洁、有条理的个人 AI 伴侣。用自然真诚的中文交流，尊重用户节奏，不空泛说教。",
            tone = "温和、简洁、有条理",
            greeting = "你好呀，今天想聊点什么？可以随口聊聊近况，也可以一起把一件事理清楚。",
            avatar = "🌿"
        )
        db.personaDao().upsert(defaultRole)
        return defaultRole
    }

    fun observeConversations(personaId: String): Flow<List<ConversationEntity>> =
        db.conversationDao().observeByPersona(personaId)

    fun observeMessages(conversationId: String): Flow<List<MessageEntity>> =
        db.messageDao().observeByConversation(conversationId)

    suspend fun getPersona(id: String): PersonaEntity? = db.personaDao().getById(id)

    suspend fun savePersona(
        existingId: String?,
        name: String,
        description: String,
        tone: String,
        greeting: String,
        systemPrompt: String,
        avatar: String,
        model: String
    ): PersonaEntity {
        val cleanName = name.trim().take(60)
        val cleanPrompt = systemPrompt.trim().take(8000)
        require(cleanName.isNotEmpty() && cleanPrompt.isNotEmpty()) { "角色名称和人设提示词不能为空。" }
        val existing = existingId?.let { db.personaDao().getById(it) }
        val entity = PersonaEntity(
            id = existing?.id ?: UUID.randomUUID().toString(),
            name = cleanName,
            description = description.trim().take(300),
            systemPrompt = cleanPrompt,
            tone = tone.trim().take(200),
            greeting = greeting.trim().take(1000),
            avatar = avatar.trim().take(524288),
            model = model.trim().take(160),
            createdAt = existing?.createdAt ?: System.currentTimeMillis()
        )
        db.personaDao().upsert(entity)
        return entity
    }

    suspend fun deletePersona(id: String) {
        if (db.personaDao().count() <= 1) {
            throw IllegalStateException("请至少保留一位角色。")
        }
        db.personaDao().deleteById(id)
    }

    suspend fun exportPersonaCard(personaId: String): String {
        val role = db.personaDao().getById(personaId) ?: throw IllegalArgumentException("角色不存在。")
        return PersonaCardCodec.encode(role)
    }

    suspend fun importPersonaCard(rawJson: String): PersonaEntity {
        val entity = PersonaCardCodec.decodeToNewPersona(rawJson)
        db.personaDao().upsert(entity)
        return entity
    }

    suspend fun getConversation(id: String): ConversationEntity? = db.conversationDao().getById(id)

    suspend fun createConversation(personaId: String, title: String = "新的对话"): ConversationEntity {
        val now = System.currentTimeMillis()
        val conv = ConversationEntity(
            id = UUID.randomUUID().toString(),
            personaId = personaId,
            title = title.trim().ifEmpty { "新的对话" }.take(100),
            createdAt = now,
            updatedAt = now
        )
        db.conversationDao().upsert(conv)
        return conv
    }

    suspend fun createGroupConversation(participantIds: List<String>, title: String = "雅集群聊"): ConversationEntity {
        val uniqueIds = participantIds.map { it.trim() }.filter { it.isNotEmpty() }.distinct()
        require(uniqueIds.size >= 2) { "群聊请至少选择 2 位角色。" }
        val now = System.currentTimeMillis()
        val conv = ConversationEntity(
            id = UUID.randomUUID().toString(),
            personaId = uniqueIds.first(),
            title = title.trim().ifEmpty { "雅集群聊" }.take(100),
            isGroup = true,
            participantIds = uniqueIds.joinToString(","),
            createdAt = now,
            updatedAt = now
        )
        db.conversationDao().upsert(conv)
        return conv
    }

    fun resolveGroupResponders(userText: String, participants: List<PersonaEntity>): List<PersonaEntity> {
        if (participants.isEmpty()) return emptyList()
        val mentioned = participants.filter { role ->
            role.name.isNotBlank() && userText.contains("@${role.name}")
        }
        return mentioned.ifEmpty { participants }
    }

    suspend fun branchConversation(sourceConversationId: String, upToMessageId: Long): ConversationEntity {
        val source = db.conversationDao().getById(sourceConversationId)
            ?: throw IllegalArgumentException("原对话不存在。")
        val copiedMessages = db.messageDao().listUpTo(sourceConversationId, upToMessageId)
        val now = System.currentTimeMillis()
        val branch = ConversationEntity(
            id = UUID.randomUUID().toString(),
            personaId = source.personaId,
            title = "${source.title.take(28)} · 分支",
            parentConversationId = source.parentConversationId ?: source.id,
            branchedFromMessageId = upToMessageId,
            createdAt = now,
            updatedAt = now
        )
        db.conversationDao().upsert(branch)
        db.messageDao().insertAll(
            copiedMessages.map {
                MessageEntity(
                    conversationId = branch.id,
                    role = it.role,
                    content = it.content,
                    reasoning = it.reasoning,
                    createdAt = it.createdAt
                )
            }
        )
        return branch
    }

    suspend fun saveUserMessage(conversationId: String, content: String): Long {
        val now = System.currentTimeMillis()
        val id = db.messageDao().insert(
            MessageEntity(conversationId = conversationId, role = "user", content = content, createdAt = now)
        )
        val conv = db.conversationDao().getById(conversationId)
        if (conv != null && conv.title == "新的对话") {
            db.conversationDao().updateTitleAndTime(conversationId, content.trim().take(28), now)
        } else {
            db.conversationDao().touch(conversationId, now)
        }
        return id
    }

    suspend fun saveAssistantMessage(
        conversationId: String,
        content: String,
        reasoning: String,
        senderPersonaId: String? = null,
        senderName: String? = null
    ): Long {
        val now = System.currentTimeMillis()
        val id = db.messageDao().insert(
            MessageEntity(
                conversationId = conversationId,
                role = "assistant",
                content = content,
                reasoning = reasoning,
                senderPersonaId = senderPersonaId,
                senderName = senderName,
                createdAt = now
            )
        )
        db.conversationDao().touch(conversationId, now)
        return id
    }

    suspend fun importKnowledgeDocument(title: String, rawContent: String, sourceName: String = ""): KnowledgeDocumentEntity {
        val cleanTitle = title.trim().ifEmpty { "未命名文档" }.take(120)
        val cleanContent = rawContent.trim()
        require(cleanContent.isNotEmpty()) { "文档内容不能为空。" }
        val chunks = KnowledgeEngine.chunkText(cleanContent)
        require(chunks.isNotEmpty()) { "未能从文档中解析出有效文本段落。" }
        val docId = UUID.randomUUID().toString()
        val doc = KnowledgeDocumentEntity(
            id = docId,
            title = cleanTitle,
            sourceName = sourceName.trim().take(120),
            chunkCount = chunks.size,
            charCount = cleanContent.length,
            createdAt = System.currentTimeMillis()
        )
        db.knowledgeDao().upsertDocument(doc)
        db.knowledgeDao().insertChunks(
            chunks.mapIndexed { idx, text ->
                KnowledgeChunkEntity(
                    documentId = docId,
                    documentTitle = cleanTitle,
                    chunkIndex = idx,
                    content = text
                )
            }
        )
        return doc
    }

    suspend fun deleteKnowledgeDocument(documentId: String) {
        db.knowledgeDao().deleteDocument(documentId)
    }

    suspend fun searchKnowledge(query: String, topK: Int = 5): List<KnowledgeHit> {
        val allChunks = db.knowledgeDao().listAllChunks()
        return KnowledgeEngine.searchChunks(query, allChunks, topK)
    }

    suspend fun saveMemory(
        existingId: String?,
        personaId: String?,
        category: String,
        content: String,
        importance: Int
    ): MemoryEntity {
        val cleanContent = content.trim().take(500)
        require(cleanContent.isNotEmpty()) { "记忆内容不能为空。" }
        val now = System.currentTimeMillis()
        val entity = MemoryEntity(
            id = existingId ?: UUID.randomUUID().toString(),
            personaId = personaId?.takeIf { it.isNotBlank() },
            category = category.trim().ifEmpty { "fact" },
            content = cleanContent,
            importance = importance.coerceIn(1, 5),
            createdAt = now,
            updatedAt = now
        )
        db.memoryDao().upsert(entity)
        return entity
    }

    suspend fun deleteMemory(id: String) {
        db.memoryDao().deleteById(id)
    }

    suspend fun buildPromptMessages(
        persona: PersonaEntity,
        conversationId: String,
        latestQuery: String = "",
        isGroupChat: Boolean = false
    ): List<ChatPromptMessage> {
        val history = db.messageDao().listByConversation(conversationId).takeLast(24)
        val effectiveQuery = latestQuery.trim().ifEmpty {
            history.lastOrNull { it.role == "user" }?.content.orEmpty()
        }
        val knowledgeHits = if (effectiveQuery.isNotBlank()) {
            KnowledgeEngine.searchChunks(effectiveQuery, db.knowledgeDao().listAllChunks(), topK = 3)
        } else {
            emptyList()
        }
        val memoryHits = KnowledgeEngine.recallMemories(
            query = effectiveQuery,
            candidates = db.memoryDao().listRelevantCandidates(persona.id),
            topK = 5
        )
        val referenceBlock = KnowledgeEngine.buildReferenceContextBlock(knowledgeHits, memoryHits)

        val sys = buildString {
            append("角色名称：").append(persona.name).append('\n')
            if (persona.tone.isNotBlank()) append("说话语气：").append(persona.tone).append('\n')
            append("人设设定：\n").append(persona.systemPrompt)
            if (isGroupChat) {
                append("\n当前处于多角色群聊，请仅以「").append(persona.name).append("」的身份自然接话，无需重复他人已说内容，也不要在开头自报姓名。")
            }
            if (referenceBlock.isNotBlank()) append(referenceBlock)
        }
        return buildList {
            add(ChatPromptMessage("system", sys))
            history.forEach { msg ->
                val text = if (isGroupChat && msg.role == "assistant" && !msg.senderName.isNullOrBlank()) {
                    "[${msg.senderName}]：${msg.content}"
                } else {
                    msg.content
                }
                add(ChatPromptMessage(msg.role, text))
            }
        }
    }

    fun effectiveModelFor(persona: PersonaEntity?): String {
        val custom = persona?.model?.trim().orEmpty()
        return custom.ifEmpty { prefs.settings.value.defaultModel.trim() }
    }

    fun streamReply(persona: PersonaEntity, promptMessages: List<ChatPromptMessage>): Flow<StreamChunk> {
        val current = prefs.settings.value
        val targetModel = effectiveModelFor(persona)
        return client.streamChat(
            baseUrl = current.baseUrl,
            apiKey = prefs.getApiKey(),
            model = targetModel,
            messages = promptMessages
        )
    }

    suspend fun fetchAvailableModels(baseUrlOverride: String? = null, apiKeyOverride: String? = null): List<String> {
        val current = prefs.settings.value
        return client.listModels(
            baseUrl = baseUrlOverride?.takeIf { it.isNotBlank() } ?: current.baseUrl,
            apiKey = apiKeyOverride?.takeIf { it.isNotBlank() } ?: prefs.getApiKey()
        )
    }

    suspend fun testModelConnection(baseUrl: String, apiKey: String?, model: String): String {
        val effectiveKey = apiKey?.takeIf { it.isNotBlank() } ?: prefs.getApiKey()
        return client.testConnection(baseUrl, effectiveKey, model)
    }

    fun saveModelSettings(baseUrl: String, defaultModel: String, newApiKey: String?, clearApiKey: Boolean) {
        prefs.saveModelSettings(baseUrl, defaultModel, newApiKey, clearApiKey)
    }

    fun setThemeMode(mode: GardenThemeMode) = prefs.setThemeMode(mode)

    fun setUserAvatar(avatar: String) = prefs.setUserAvatar(avatar)
}
