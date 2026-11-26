package com.qiyi.companion.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.qiyi.companion.data.QiYiRepository
import com.qiyi.companion.data.db.ConversationEntity
import com.qiyi.companion.data.db.KnowledgeDocumentEntity
import com.qiyi.companion.data.db.MemoryEntity
import com.qiyi.companion.data.db.MessageEntity
import com.qiyi.companion.data.db.PersonaEntity
import com.qiyi.companion.data.knowledge.KnowledgeHit
import com.qiyi.companion.data.network.ModelServiceException
import com.qiyi.companion.data.network.StreamChunk
import com.qiyi.companion.data.prefs.AppSettings
import com.qiyi.companion.data.prefs.GardenThemeMode
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

data class StreamingState(
    val isStreaming: Boolean = false,
    val conversationId: String? = null,
    val speakerName: String = "",
    val speakerAvatar: String = "",
    val content: String = "",
    val reasoning: String = ""
)

data class QuotaCheckpointState(
    val conversationId: String,
    val pendingPersonaIds: List<String>,
    val latestQuery: String,
    val isGroupChat: Boolean,
    val remainingSeconds: Long,
    val reason: String
)

@OptIn(ExperimentalCoroutinesApi::class)
class QiYiViewModel(private val repository: QiYiRepository) : ViewModel() {

    val settings: StateFlow<AppSettings> = repository.settings

    val personas: StateFlow<List<PersonaEntity>> = repository.personas.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(5000),
        initialValue = emptyList()
    )

    val knowledgeDocuments: StateFlow<List<KnowledgeDocumentEntity>> = repository.knowledgeDocuments.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(5000),
        initialValue = emptyList()
    )

    val memories: StateFlow<List<MemoryEntity>> = repository.memories.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(5000),
        initialValue = emptyList()
    )

    val allConversations: StateFlow<List<ConversationEntity>> = repository.allConversations.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(5000),
        initialValue = emptyList()
    )

    private val _knowledgeSearchResults = MutableStateFlow<List<KnowledgeHit>>(emptyList())
    val knowledgeSearchResults: StateFlow<List<KnowledgeHit>> = _knowledgeSearchResults.asStateFlow()

    private val _activePersonaId = MutableStateFlow<String?>(null)
    val activePersonaId: StateFlow<String?> = _activePersonaId.asStateFlow()

    private val _activeConversationId = MutableStateFlow<String?>(null)
    val activeConversationId: StateFlow<String?> = _activeConversationId.asStateFlow()

    val activeConversation: StateFlow<ConversationEntity?> =
        combine(allConversations, _activeConversationId) { list, id ->
            if (id.isNullOrBlank()) null else list.firstOrNull { it.id == id }
        }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), null)

    val conversations: StateFlow<List<ConversationEntity>> = _activePersonaId
        .flatMapLatest { pid ->
            if (pid.isNullOrBlank()) flowOf(emptyList()) else repository.observeConversations(pid)
        }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    val messages: StateFlow<List<MessageEntity>> = _activeConversationId
        .flatMapLatest { cid ->
            if (cid.isNullOrBlank()) flowOf(emptyList()) else repository.observeMessages(cid)
        }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    private val _streaming = MutableStateFlow(StreamingState())
    val streaming: StateFlow<StreamingState> = _streaming.asStateFlow()

    private val _quotaCheckpoint = MutableStateFlow<QuotaCheckpointState?>(null)
    val quotaCheckpoint: StateFlow<QuotaCheckpointState?> = _quotaCheckpoint.asStateFlow()

    private val _availableModels = MutableStateFlow<List<String>>(emptyList())
    val availableModels: StateFlow<List<String>> = _availableModels.asStateFlow()

    private val _isFetchingModels = MutableStateFlow(false)
    val isFetchingModels: StateFlow<Boolean> = _isFetchingModels.asStateFlow()

    private val _isTestingConnection = MutableStateFlow(false)
    val isTestingConnection: StateFlow<Boolean> = _isTestingConnection.asStateFlow()

    private val _notices = MutableSharedFlow<String>(extraBufferCapacity = 8)
    val notices: SharedFlow<String> = _notices.asSharedFlow()

    private var activeStreamJob: Job? = null
    private var quotaTimerJob: Job? = null

    init {
        viewModelScope.launch {
            val defaultPersona = repository.ensureDefaultPersona()
            if (_activePersonaId.value == null) {
                _activePersonaId.value = defaultPersona.id
            }
        }
    }

    fun selectPersona(personaId: String) {
        if (_streaming.value.isStreaming) {
            notify("正在生成回复，请先停止当前生成再切换角色。")
            return
        }
        _activePersonaId.value = personaId
        _activeConversationId.value = null
    }

    fun selectConversation(conversationId: String) {
        if (_streaming.value.isStreaming) {
            notify("正在生成回复，请先停止当前生成再切换对话。")
            return
        }
        val target = allConversations.value.firstOrNull { it.id == conversationId }
        if (target != null) {
            _activePersonaId.value = target.personaId
        }
        _activeConversationId.value = conversationId
    }

    fun startNewConversation() {
        if (_streaming.value.isStreaming) {
            notify("正在生成回复，请先停止当前生成。")
            return
        }
        _activeConversationId.value = null
    }

    fun createGroupConversation(participantIds: List<String>, title: String) {
        if (_streaming.value.isStreaming) {
            notify("正在生成回复，请先停止当前生成。")
            return
        }
        viewModelScope.launch {
            runCatching { repository.createGroupConversation(participantIds, title) }
                .onSuccess { conv ->
                    _activePersonaId.value = conv.personaId
                    _activeConversationId.value = conv.id
                    notify("已创建群聊「${conv.title}」")
                }
                .onFailure { notify(it.message ?: "创建群聊失败。") }
        }
    }

    fun sendMessage(rawText: String) {
        val text = rawText.trim()
        if (text.isEmpty() || _streaming.value.isStreaming) return

        cancelQuotaCheckpoint()

        viewModelScope.launch {
            val existingConv = _activeConversationId.value?.let { repository.getConversation(it) }
            val isGroup = existingConv?.isGroup == true

            val responderIds: List<String>
            val convId: String

            if (isGroup && existingConv != null) {
                val allMap = personas.value.associateBy { it.id }
                val participants = existingConv.participantIds
                    .split(",")
                    .mapNotNull { allMap[it.trim()] }
                if (participants.isEmpty()) {
                    notify("群聊成员不存在，请重新创建群聊。")
                    return@launch
                }
                val responders = repository.resolveGroupResponders(text, participants)
                if (responders.any { repository.effectiveModelFor(it).isBlank() }) {
                    notify("请先在「设置」或「人设」中配置模型 ID。")
                    return@launch
                }
                convId = existingConv.id
                responderIds = responders.map { it.id }
            } else {
                val personaId = _activePersonaId.value ?: personas.value.firstOrNull()?.id
                if (personaId == null) {
                    notify("请先创建一位角色。")
                    return@launch
                }
                val persona = repository.getPersona(personaId)
                if (persona == null) {
                    notify("未找到当前角色。")
                    return@launch
                }
                if (repository.effectiveModelFor(persona).isBlank()) {
                    notify("请先在「设置」或「人设」中填写模型 ID。")
                    return@launch
                }
                convId = existingConv?.id ?: repository.createConversation(persona.id).id.also {
                    _activeConversationId.value = it
                }
                responderIds = listOf(persona.id)
            }

            repository.saveUserMessage(convId, text)
            runResponderQueue(
                convId = convId,
                responderIds = responderIds,
                latestQuery = text,
                isGroupChat = isGroup
            )
        }
    }

    private fun runResponderQueue(
        convId: String,
        responderIds: List<String>,
        latestQuery: String,
        isGroupChat: Boolean
    ) {
        if (responderIds.isEmpty()) return
        activeStreamJob = viewModelScope.launch {
            try {
                for ((index, pid) in responderIds.withIndex()) {
                    val persona = repository.getPersona(pid) ?: continue
                    val promptMessages = repository.buildPromptMessages(
                        persona = persona,
                        conversationId = convId,
                        latestQuery = latestQuery,
                        isGroupChat = isGroupChat
                    )

                    val contentBuilder = StringBuilder()
                    val reasoningBuilder = StringBuilder()
                    _streaming.value = StreamingState(
                        isStreaming = true,
                        conversationId = convId,
                        speakerName = persona.name,
                        speakerAvatar = persona.avatar.ifBlank { persona.name.take(1) },
                        content = "",
                        reasoning = ""
                    )

                    try {
                        repository.streamReply(persona, promptMessages).collect { chunk ->
                            when (chunk) {
                                is StreamChunk.ContentDelta -> {
                                    contentBuilder.append(chunk.text)
                                    _streaming.value = _streaming.value.copy(content = contentBuilder.toString())
                                }
                                is StreamChunk.ReasoningDelta -> {
                                    reasoningBuilder.append(chunk.text)
                                    _streaming.value = _streaming.value.copy(reasoning = reasoningBuilder.toString())
                                }
                                StreamChunk.Done -> Unit
                            }
                        }
                        val finalContent = contentBuilder.toString().trim()
                        val finalReasoning = reasoningBuilder.toString().trim()
                        if (finalContent.isNotEmpty() || finalReasoning.isNotEmpty()) {
                            repository.saveAssistantMessage(
                                conversationId = convId,
                                content = finalContent.ifEmpty { "（模型未返回正文）" },
                                reasoning = finalReasoning,
                                senderPersonaId = persona.id,
                                senderName = persona.name
                            )
                        }
                    } catch (cancel: CancellationException) {
                        val partialContent = contentBuilder.toString().trim()
                        val partialReasoning = reasoningBuilder.toString().trim()
                        if (partialContent.isNotEmpty()) {
                            repository.saveAssistantMessage(
                                conversationId = convId,
                                content = "$partialContent\n\n（已手动停止生成）",
                                reasoning = partialReasoning,
                                senderPersonaId = persona.id,
                                senderName = persona.name
                            )
                        }
                        notify("已停止生成。")
                        throw cancel
                    } catch (err: ModelServiceException) {
                        if (err.isQuotaLimit) {
                            val waitSeconds = (err.retryAfterSeconds ?: 60L).coerceIn(5L, 600L)
                            scheduleQuotaResume(
                                QuotaCheckpointState(
                                    conversationId = convId,
                                    pendingPersonaIds = responderIds.drop(index),
                                    latestQuery = latestQuery,
                                    isGroupChat = isGroupChat,
                                    remainingSeconds = waitSeconds,
                                    reason = err.message ?: "模型额度受限（HTTP 429）"
                                )
                            )
                            return@launch
                        } else {
                            notify(err.message ?: "生成回复失败，请检查网络或模型配置。")
                            return@launch
                        }
                    } catch (err: Exception) {
                        notify(err.message ?: "生成回复失败，请检查网络或模型配置。")
                        return@launch
                    }
                }
            } finally {
                _streaming.value = StreamingState()
                activeStreamJob = null
            }
        }
    }

    private fun scheduleQuotaResume(checkpoint: QuotaCheckpointState) {
        quotaTimerJob?.cancel()
        _quotaCheckpoint.value = checkpoint
        notify("额度受限已存档，将在 ${checkpoint.remainingSeconds} 秒后自动续跑。")
        quotaTimerJob = viewModelScope.launch {
            var left = checkpoint.remainingSeconds
            while (left > 0) {
                delay(1000L)
                left -= 1
                _quotaCheckpoint.value = _quotaCheckpoint.value?.copy(remainingSeconds = left)
            }
            val current = _quotaCheckpoint.value ?: return@launch
            _quotaCheckpoint.value = null
            if (!_streaming.value.isStreaming) {
                runResponderQueue(
                    convId = current.conversationId,
                    responderIds = current.pendingPersonaIds,
                    latestQuery = current.latestQuery,
                    isGroupChat = current.isGroupChat
                )
            }
        }
    }

    fun retryQuotaCheckpointNow() {
        val current = _quotaCheckpoint.value ?: return
        quotaTimerJob?.cancel()
        _quotaCheckpoint.value = null
        if (!_streaming.value.isStreaming) {
            runResponderQueue(
                convId = current.conversationId,
                responderIds = current.pendingPersonaIds,
                latestQuery = current.latestQuery,
                isGroupChat = current.isGroupChat
            )
        }
    }

    fun cancelQuotaCheckpoint() {
        quotaTimerJob?.cancel()
        quotaTimerJob = null
        _quotaCheckpoint.value = null
    }

    fun stopGeneration() {
        activeStreamJob?.cancel()
    }

    fun branchFromMessage(messageId: Long) {
        val convId = _activeConversationId.value ?: return
        if (_streaming.value.isStreaming) {
            notify("请先停止当前生成再创建分支。")
            return
        }
        viewModelScope.launch {
            runCatching { repository.branchConversation(convId, messageId) }
                .onSuccess { branched ->
                    _activeConversationId.value = branched.id
                    notify("已创建分支对话：${branched.title}")
                }
                .onFailure { notify(it.message ?: "创建分支失败。") }
        }
    }

    fun savePersona(
        existingId: String?,
        name: String,
        description: String,
        tone: String,
        greeting: String,
        systemPrompt: String,
        avatar: String,
        model: String,
        onSaved: (PersonaEntity) -> Unit = {}
    ) {
        viewModelScope.launch {
            runCatching {
                repository.savePersona(
                    existingId = existingId,
                    name = name,
                    description = description,
                    tone = tone,
                    greeting = greeting,
                    systemPrompt = systemPrompt,
                    avatar = avatar,
                    model = model
                )
            }.onSuccess { saved ->
                if (_activePersonaId.value == null) _activePersonaId.value = saved.id
                notify(if (existingId == null) "已创建角色「${saved.name}」" else "已更新角色「${saved.name}」")
                onSaved(saved)
            }.onFailure {
                notify(it.message ?: "保存角色失败。")
            }
        }
    }

    fun deletePersona(persona: PersonaEntity) {
        viewModelScope.launch {
            runCatching { repository.deletePersona(persona.id) }
                .onSuccess {
                    if (_activePersonaId.value == persona.id) {
                        val fallback = personas.value.firstOrNull { it.id != persona.id }
                        _activePersonaId.value = fallback?.id
                        _activeConversationId.value = null
                    }
                    notify("已删除角色「${persona.name}」")
                }
                .onFailure { notify(it.message ?: "删除角色失败。") }
        }
    }

    fun exportPersonaCard(personaId: String, onReady: (fileName: String, jsonText: String) -> Unit) {
        viewModelScope.launch {
            runCatching {
                val role = repository.getPersona(personaId) ?: throw IllegalArgumentException("角色不存在。")
                val jsonText = repository.exportPersonaCard(personaId)
                val safeName = role.name.replace(Regex("[^\\p{L}\\p{N}_-]+"), "_").ifBlank { "persona" }
                "qiyi-persona-$safeName.json" to jsonText
            }.onSuccess { (fileName, jsonText) ->
                onReady(fileName, jsonText)
            }.onFailure {
                notify(it.message ?: "导出角色卡失败。")
            }
        }
    }

    fun importPersonaCard(rawJson: String) {
        viewModelScope.launch {
            runCatching { repository.importPersonaCard(rawJson) }
                .onSuccess { imported ->
                    _activePersonaId.value = imported.id
                    _activeConversationId.value = null
                    notify("已导入角色卡「${imported.name}」")
                }
                .onFailure { notify(it.message ?: "导入角色卡失败。") }
        }
    }

    fun fetchModels(baseUrlOverride: String? = null, apiKeyOverride: String? = null) {
        if (_isFetchingModels.value) return
        viewModelScope.launch {
            _isFetchingModels.value = true
            runCatching { repository.fetchAvailableModels(baseUrlOverride, apiKeyOverride) }
                .onSuccess { list ->
                    _availableModels.value = list
                    notify(if (list.isEmpty()) "接口返回空模型列表，请手动输入模型 ID。" else "已获取 ${list.size} 个可用模型。")
                }
                .onFailure { notify(it.message ?: "获取可用模型失败。") }
            _isFetchingModels.value = false
        }
    }

    fun saveModelSettings(baseUrl: String, defaultModel: String, newApiKey: String?, clearApiKey: Boolean) {
        runCatching {
            repository.saveModelSettings(baseUrl, defaultModel, newApiKey, clearApiKey)
        }.onSuccess {
            notify("模型连接设置已保存（API Key 仅存于系统 Keystore）。")
        }.onFailure {
            notify(it.message ?: "保存设置失败。")
        }
    }

    fun testModelConnection(baseUrl: String, apiKey: String?, model: String) {
        if (_isTestingConnection.value) return
        viewModelScope.launch {
            _isTestingConnection.value = true
            runCatching { repository.testModelConnection(baseUrl, apiKey, model) }
                .onSuccess { reply -> notify("测试成功：$reply") }
                .onFailure { notify(it.message ?: "连接测试失败。") }
            _isTestingConnection.value = false
        }
    }

    fun setThemeMode(mode: GardenThemeMode) {
        repository.setThemeMode(mode)
        notify("已切换至「${mode.label}」主题")
    }

    fun setUserAvatar(avatar: String) {
        repository.setUserAvatar(avatar)
        notify("已更新我的头像")
    }

    fun importKnowledgeDocument(title: String, rawContent: String, sourceName: String = "", onSaved: () -> Unit = {}) {
        viewModelScope.launch {
            runCatching { repository.importKnowledgeDocument(title, rawContent, sourceName) }
                .onSuccess { doc ->
                    notify("已导入《${doc.title}》（${doc.chunkCount} 个检索片段）")
                    onSaved()
                }
                .onFailure { notify(it.message ?: "导入文档失败。") }
        }
    }

    fun deleteKnowledgeDocument(doc: KnowledgeDocumentEntity) {
        viewModelScope.launch {
            runCatching { repository.deleteKnowledgeDocument(doc.id) }
                .onSuccess {
                    _knowledgeSearchResults.value = _knowledgeSearchResults.value.filterNot { it.chunk.documentId == doc.id }
                    notify("已移除文档《${doc.title}》")
                }
                .onFailure { notify(it.message ?: "删除文档失败。") }
        }
    }

    fun searchKnowledge(query: String) {
        val clean = query.trim()
        if (clean.isEmpty()) {
            _knowledgeSearchResults.value = emptyList()
            return
        }
        viewModelScope.launch {
            runCatching { repository.searchKnowledge(clean, topK = 6) }
                .onSuccess { hits -> _knowledgeSearchResults.value = hits }
                .onFailure { notify(it.message ?: "检索知识库失败。") }
        }
    }

    fun saveMemory(
        existingId: String?,
        personaId: String?,
        category: String,
        content: String,
        importance: Int,
        onSaved: () -> Unit = {}
    ) {
        viewModelScope.launch {
            runCatching { repository.saveMemory(existingId, personaId, category, content, importance) }
                .onSuccess {
                    notify(if (existingId == null) "已写入长期记忆" else "已更新长期记忆")
                    onSaved()
                }
                .onFailure { notify(it.message ?: "保存记忆失败。") }
        }
    }

    fun deleteMemory(memory: MemoryEntity) {
        viewModelScope.launch {
            runCatching { repository.deleteMemory(memory.id) }
                .onSuccess { notify("已删除该条记忆") }
                .onFailure { notify(it.message ?: "删除记忆失败。") }
        }
    }

    fun rememberFromChat(content: String) {
        val snippet = content.trim().replace(Regex("\\s+"), " ").take(240)
        if (snippet.isEmpty()) return
        saveMemory(
            existingId = null,
            personaId = null,
            category = "event",
            content = snippet,
            importance = 4
        )
    }

    fun effectiveModelFor(persona: PersonaEntity?): String = repository.effectiveModelFor(persona)

    fun exportFullBackup(onReady: (fileName: String, jsonText: String) -> Unit) {
        viewModelScope.launch {
            runCatching { repository.exportFullBackupJson() }
                .onSuccess { jsonText ->
                    onReady("qiyi-android-backup.json", jsonText)
                }
                .onFailure { notify(it.message ?: "生成备份失败。") }
        }
    }

    fun importFullBackup(rawJson: String) {
        viewModelScope.launch {
            runCatching { repository.importFullBackupJson(rawJson) }
                .onSuccess { summary -> notify(summary) }
                .onFailure { notify(it.message ?: "导入备份失败。") }
        }
    }

    fun exportActiveConversationMarkdown(onReady: (fileName: String, markdown: String) -> Unit) {
        val convId = _activeConversationId.value
        if (convId.isNullOrBlank()) {
            notify("当前为新对话，发送消息后再导出。")
            return
        }
        viewModelScope.launch {
            runCatching { repository.exportConversationMarkdown(convId) }
                .onSuccess { (fileName, md) -> onReady(fileName, md) }
                .onFailure { notify(it.message ?: "导出对话失败。") }
        }
    }

    fun notify(message: String) {
        _notices.tryEmit(message)
    }

    companion object {
        fun factory(repository: QiYiRepository): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T {
                    return QiYiViewModel(repository) as T
                }
            }
    }
}
