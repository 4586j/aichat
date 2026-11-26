package com.qiyi.companion.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.qiyi.companion.data.QiYiRepository
import com.qiyi.companion.data.db.ConversationEntity
import com.qiyi.companion.data.db.KnowledgeDocumentEntity
import com.qiyi.companion.data.db.MailDraftEntity
import com.qiyi.companion.data.db.MemoryEntity
import com.qiyi.companion.data.db.MemoryTripleEntity
import com.qiyi.companion.data.db.MessageEntity
import com.qiyi.companion.data.db.MusicTrackEntity
import com.qiyi.companion.data.db.PersonaEntity
import com.qiyi.companion.data.db.ResumableRunEntity
import com.qiyi.companion.data.db.ScheduledTaskEntity
import com.qiyi.companion.data.db.UsageRecordEntity
import com.qiyi.companion.data.knowledge.KnowledgeHit
import com.qiyi.companion.data.media.MusicIntentDetector
import com.qiyi.companion.data.media.MusicPlaybackState
import com.qiyi.companion.data.media.MusicPlayerController
import com.qiyi.companion.data.media.StickerCatalog
import com.qiyi.companion.data.network.ModelServiceException
import com.qiyi.companion.data.network.StreamChunk
import com.qiyi.companion.data.prefs.AppSettings
import com.qiyi.companion.data.prefs.GardenThemeMode
import com.qiyi.companion.data.usage.UsageAnalytics
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

data class DraftAttachment(
    val name: String,
    val content: String = "",
    val isImage: Boolean = false,
    val imageDataUri: String? = null
)

@OptIn(ExperimentalCoroutinesApi::class)
class QiYiViewModel(
    private val repository: QiYiRepository,
    private val musicPlayer: MusicPlayerController
) : ViewModel() {

    val settings: StateFlow<AppSettings> = repository.settings
    val musicState: StateFlow<MusicPlaybackState> = musicPlayer.state

    val musicTracks: StateFlow<List<MusicTrackEntity>> = repository.musicTracks.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(5000),
        initialValue = emptyList()
    )

    val usageRecords: StateFlow<List<UsageRecordEntity>> = repository.usageRecords.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(5000),
        initialValue = emptyList()
    )

    val memoryTriples: StateFlow<List<MemoryTripleEntity>> = repository.memoryTriples.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(5000),
        initialValue = emptyList()
    )

    val scheduledTasks: StateFlow<List<ScheduledTaskEntity>> = repository.scheduledTasks.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(5000),
        initialValue = emptyList()
    )

    val mailDrafts: StateFlow<List<MailDraftEntity>> = repository.mailDrafts.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(5000),
        initialValue = emptyList()
    )

    private val _runningTaskId = MutableStateFlow<String?>(null)
    val runningTaskId: StateFlow<String?> = _runningTaskId.asStateFlow()

    private val _isClippingWeb = MutableStateFlow(false)
    val isClippingWeb: StateFlow<Boolean> = _isClippingWeb.asStateFlow()

    private val _onlineMusicResults = MutableStateFlow<List<MusicTrackEntity>>(emptyList())
    val onlineMusicResults: StateFlow<List<MusicTrackEntity>> = _onlineMusicResults.asStateFlow()

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

    private val _draftAttachments = MutableStateFlow<List<DraftAttachment>>(emptyList())
    val draftAttachments: StateFlow<List<DraftAttachment>> = _draftAttachments.asStateFlow()

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
        viewModelScope.launch {
            repository.musicTracks.collect { list ->
                musicPlayer.updatePlaylist(list)
            }
        }
        // Restore persisted HTTP 429 resumable checkpoints on cold start
        viewModelScope.launch {
            val savedRuns = runCatching { repository.listResumableRuns() }.getOrDefault(emptyList())
            val first = savedRuns.firstOrNull()
            if (first != null) {
                val remaining = ((first.resumeAtEpochMs - System.currentTimeMillis()) / 1000L).coerceAtLeast(3L)
                val pendingIds = first.pendingPersonaIds.split(",").map { it.trim() }.filter { it.isNotEmpty() }
                if (pendingIds.isNotEmpty()) {
                    scheduleQuotaResume(
                        QuotaCheckpointState(
                            conversationId = first.conversationId,
                            pendingPersonaIds = pendingIds,
                            latestQuery = first.latestQuery,
                            isGroupChat = first.isGroupChat,
                            remainingSeconds = remaining,
                            reason = first.reason.ifBlank { "上次限流中断断点已恢复" }
                        ),
                        persistToDb = false
                    )
                }
            }
        }
        // Lightweight foreground periodic scheduler for enabled tasks
        viewModelScope.launch {
            while (true) {
                delay(60_000L)
                val now = System.currentTimeMillis()
                val due = scheduledTasks.value.filter {
                    it.enabled && (now - it.lastRunAt) >= it.intervalMinutes * 60_000L
                }
                for (task in due) {
                    if (_runningTaskId.value == null && !_streaming.value.isStreaming) {
                        runCatching { repository.runScheduledTaskNow(task) }
                    }
                }
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

    fun addDraftAttachment(name: String, content: String) {
        val cleanContent = content.trim()
        if (cleanContent.isEmpty()) {
            notify("附件内容为空，未添加。")
            return
        }
        val current = _draftAttachments.value
        if (current.size >= 4) {
            notify("单次最多添加 4 个文本附件。")
            return
        }
        _draftAttachments.value = current + DraftAttachment(name.trim().ifEmpty { "附件.txt" }, cleanContent.take(16000))
        notify("已添加附件「${name.trim().ifEmpty { "附件.txt" }}」")
    }

    fun addDraftImage(name: String, dataUri: String) {
        if (!dataUri.startsWith("data:image/")) {
            notify("不支持的图片格式。")
            return
        }
        val current = _draftAttachments.value
        if (current.size >= 4) {
            notify("单次最多添加 4 个附件。")
            return
        }
        val cleanName = name.trim().ifEmpty { "图片.jpg" }
        _draftAttachments.value = current + DraftAttachment(
            name = cleanName,
            content = "",
            isImage = true,
            imageDataUri = dataUri
        )
        notify("已添加图片「$cleanName」")
    }

    fun removeDraftAttachment(index: Int) {
        val current = _draftAttachments.value
        if (index in current.indices) {
            _draftAttachments.value = current.filterIndexed { i, _ -> i != index }
        }
    }

    fun sendMessage(rawText: String) {
        val text = rawText.trim()
        val attachments = _draftAttachments.value
        if ((text.isEmpty() && attachments.isEmpty()) || _streaming.value.isStreaming) return

        cancelQuotaCheckpoint()

        viewModelScope.launch {
            val existingConv = _activeConversationId.value?.let { repository.getConversation(it) }
            val isGroup = existingConv?.isGroup == true

            val responderIds: List<String>
            val convId: String
            val pureQuery = text.ifEmpty { "请阅读我附带的文件并给出简明总结。" }

            if (isGroup && existingConv != null) {
                val allMap = personas.value.associateBy { it.id }
                val participants = existingConv.participantIds
                    .split(",")
                    .mapNotNull { allMap[it.trim()] }
                if (participants.isEmpty()) {
                    notify("群聊成员不存在，请重新创建群聊。")
                    return@launch
                }
                val responders = repository.resolveGroupResponders(pureQuery, participants)
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

            val textAttachments = attachments.filter { !it.isImage }
            val imageAttachments = attachments.filter { it.isImage && !it.imageDataUri.isNullOrBlank() }
            val imageMarker = if (imageAttachments.isNotEmpty()) {
                imageAttachments.joinToString(" ") { "[图片：${it.name}]" }
            } else {
                ""
            }
            val displayBase = listOf(pureQuery, imageMarker).filter { it.isNotBlank() }.joinToString("\n")
            val fullUserContent = repository.buildMessageWithAttachments(
                userText = displayBase,
                attachments = textAttachments.map { it.name to it.content }
            )
            val imageDataUris = imageAttachments.mapNotNull { it.imageDataUri }
            _draftAttachments.value = emptyList()
            repository.saveUserMessage(convId, fullUserContent)
            maybeHandleChatMusicIntent(pureQuery)
            runResponderQueue(
                convId = convId,
                responderIds = responderIds,
                latestQuery = pureQuery,
                isGroupChat = isGroup,
                latestImageDataUris = imageDataUris
            )
        }
    }

    fun regenerateAssistantMessage(message: MessageEntity) {
        if (_streaming.value.isStreaming) {
            notify("正在生成回复，请先停止当前生成。")
            return
        }
        val convId = message.conversationId
        viewModelScope.launch {
            val conv = repository.getConversation(convId) ?: return@launch
            val targetPersonaId = message.senderPersonaId ?: conv.personaId
            repository.deleteMessage(message.id)
            runResponderQueue(
                convId = convId,
                responderIds = listOf(targetPersonaId),
                latestQuery = "",
                isGroupChat = conv.isGroup
            )
        }
    }

    fun deleteConversation(conversationId: String) {
        if (_streaming.value.isStreaming && _streaming.value.conversationId == conversationId) {
            stopGeneration()
        }
        viewModelScope.launch {
            runCatching { repository.deleteConversation(conversationId) }
                .onSuccess {
                    if (_activeConversationId.value == conversationId) {
                        _activeConversationId.value = null
                    }
                    notify("已删除该段对话。")
                }
                .onFailure { notify(it.message ?: "删除对话失败。") }
        }
    }

    fun updateChatState(userMood: String, assistantStyle: String, relationshipStage: String) {
        viewModelScope.launch {
            val convId = _activeConversationId.value ?: run {
                val pid = _activePersonaId.value ?: personas.value.firstOrNull()?.id ?: return@launch
                repository.createConversation(pid).id.also { _activeConversationId.value = it }
            }
            runCatching {
                repository.updateConversationState(convId, userMood, assistantStyle, relationshipStage)
            }.onSuccess {
                notify("已更新当前对话状态。")
            }.onFailure {
                notify(it.message ?: "更新对话状态失败。")
            }
        }
    }

    private fun runResponderQueue(
        convId: String,
        responderIds: List<String>,
        latestQuery: String,
        isGroupChat: Boolean,
        latestImageDataUris: List<String> = emptyList()
    ) {
        if (responderIds.isEmpty()) return
        activeStreamJob = viewModelScope.launch {
            try {
                for ((index, pid) in responderIds.withIndex()) {
                    val persona = repository.getPersona(pid) ?: continue
                    val promptContext = repository.buildPromptContext(
                        persona = persona,
                        conversationId = convId,
                        latestQuery = latestQuery,
                        isGroupChat = isGroupChat,
                        latestImageDataUris = latestImageDataUris
                    )
                    val promptMessages = promptContext.messages

                    val contentBuilder = StringBuilder()
                    val reasoningBuilder = StringBuilder()
                    val toolSteps = mutableListOf<String>()
                    val startedAt = System.currentTimeMillis()
                    var promptTok = 0
                    var cachedTok = 0
                    var completionTok = 0
                    var reasoningTok = 0
                    var totalTok = 0
                    var usageFromProvider = false
                    _streaming.value = StreamingState(
                        isStreaming = true,
                        conversationId = convId,
                        speakerName = persona.name,
                        speakerAvatar = persona.avatar.ifBlank { persona.name.take(1) },
                        content = "",
                        reasoning = ""
                    )

                    try {
                        val useTools = settings.value.toolsEnabled && latestImageDataUris.isEmpty()
                        repository.streamReply(persona, promptMessages, toolsEnabled = useTools).collect { chunk ->
                            when (chunk) {
                                is StreamChunk.ContentDelta -> {
                                    contentBuilder.append(chunk.text)
                                    _streaming.value = _streaming.value.copy(content = contentBuilder.toString())
                                }
                                is StreamChunk.ReasoningDelta -> {
                                    reasoningBuilder.append(chunk.text)
                                    _streaming.value = _streaming.value.copy(reasoning = reasoningBuilder.toString())
                                }
                                is StreamChunk.ToolStep -> {
                                    toolSteps.add(chunk.summary)
                                    reasoningBuilder.append("\n[工具] ").append(chunk.summary)
                                    _streaming.value = _streaming.value.copy(reasoning = reasoningBuilder.toString())
                                }
                                is StreamChunk.Usage -> {
                                    usageFromProvider = true
                                    promptTok += chunk.promptTokens
                                    cachedTok += chunk.cachedPromptTokens
                                    completionTok += chunk.completionTokens
                                    reasoningTok += chunk.reasoningTokens
                                    totalTok += chunk.totalTokens
                                }
                                StreamChunk.Done -> Unit
                            }
                        }
                        val elapsedMs = (System.currentTimeMillis() - startedAt).coerceAtLeast(1L)
                        val finalContent = contentBuilder.toString().trim()
                        val finalReasoning = reasoningBuilder.toString().trim()
                        if (finalContent.isNotEmpty() || finalReasoning.isNotEmpty()) {
                            val matchedSticker = if (settings.value.stickerEnabled) {
                                StickerCatalog.matchSticker(latestQuery, finalContent)?.id.orEmpty()
                            } else {
                                ""
                            }
                            repository.saveAssistantMessage(
                                conversationId = convId,
                                content = finalContent.ifEmpty { "（模型未返回正文）" },
                                reasoning = finalReasoning,
                                senderPersonaId = persona.id,
                                senderName = persona.name,
                                stickerId = matchedSticker,
                                citationsJson = promptContext.citationsJson,
                                toolTrace = toolSteps.joinToString("\n")
                            )
                            val estPrompt = if (usageFromProvider && promptTok > 0) promptTok
                            else promptMessages.sumOf { UsageAnalytics.estimateTextTokens(it.content) + 4 }.coerceAtLeast(1)
                            val estReasoning = if (usageFromProvider && reasoningTok > 0) reasoningTok
                            else UsageAnalytics.estimateTextTokens(finalReasoning)
                            val estComp = if (usageFromProvider && completionTok > 0) completionTok
                            else (UsageAnalytics.estimateTextTokens(finalContent) + estReasoning).coerceAtLeast(1)
                            val estTotal = if (usageFromProvider && totalTok > 0) totalTok else (estPrompt + estComp)
                            repository.recordUsage(
                                conversationId = convId,
                                personaId = persona.id,
                                model = repository.effectiveModelFor(persona),
                                promptTokens = estPrompt,
                                cachedPromptTokens = cachedTok,
                                completionTokens = estComp,
                                reasoningTokens = estReasoning,
                                totalTokens = estTotal,
                                durationMs = elapsedMs,
                                source = if (usageFromProvider) "provider" else "estimated"
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

    private fun scheduleQuotaResume(checkpoint: QuotaCheckpointState, persistToDb: Boolean = true) {
        quotaTimerJob?.cancel()
        _quotaCheckpoint.value = checkpoint
        if (persistToDb) {
            viewModelScope.launch {
                repository.saveResumableRun(
                    ResumableRunEntity(
                        id = "run_${checkpoint.conversationId}",
                        conversationId = checkpoint.conversationId,
                        pendingPersonaIds = checkpoint.pendingPersonaIds.joinToString(","),
                        latestQuery = checkpoint.latestQuery,
                        isGroupChat = checkpoint.isGroupChat,
                        resumeAtEpochMs = System.currentTimeMillis() + checkpoint.remainingSeconds * 1000L,
                        reason = checkpoint.reason
                    )
                )
            }
        }
        notify("额度受限已持久化存档，将在 ${checkpoint.remainingSeconds} 秒后自动续跑。")
        quotaTimerJob = viewModelScope.launch {
            var left = checkpoint.remainingSeconds
            while (left > 0) {
                delay(1000L)
                left -= 1
                _quotaCheckpoint.value = _quotaCheckpoint.value?.copy(remainingSeconds = left)
            }
            val current = _quotaCheckpoint.value ?: return@launch
            _quotaCheckpoint.value = null
            repository.deleteResumableRunsForConversation(current.conversationId)
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
        viewModelScope.launch { repository.deleteResumableRunsForConversation(current.conversationId) }
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
        val prev = _quotaCheckpoint.value
        quotaTimerJob?.cancel()
        quotaTimerJob = null
        _quotaCheckpoint.value = null
        if (prev != null) {
            viewModelScope.launch { repository.deleteResumableRunsForConversation(prev.conversationId) }
        }
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

    fun saveModelSettings(
        baseUrl: String,
        defaultModel: String,
        newApiKey: String?,
        clearApiKey: Boolean,
        embeddingModel: String? = null
    ) {
        runCatching {
            repository.saveModelSettings(baseUrl, defaultModel, newApiKey, clearApiKey, embeddingModel)
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
        isPinned: Boolean = false,
        onSaved: () -> Unit = {}
    ) {
        viewModelScope.launch {
            runCatching { repository.saveMemory(existingId, personaId, category, content, importance, isPinned) }
                .onSuccess {
                    notify(if (existingId == null) "已写入长期记忆" else "已更新长期记忆")
                    onSaved()
                }
                .onFailure { notify(it.message ?: "保存记忆失败。") }
        }
    }

    fun toggleMemoryPinned(memory: MemoryEntity) {
        viewModelScope.launch {
            runCatching { repository.setMemoryPinned(memory.id, !memory.isPinned) }
                .onSuccess { notify(if (!memory.isPinned) "已置顶为固定记忆" else "已移回活跃记忆") }
                .onFailure { notify(it.message ?: "更新记忆状态失败。") }
        }
    }

    fun clipWebPage(url: String, onDone: () -> Unit = {}) {
        if (_isClippingWeb.value) return
        viewModelScope.launch {
            _isClippingWeb.value = true
            runCatching { repository.clipWebPageToKnowledge(url) }
                .onSuccess { doc ->
                    notify("已剪藏《${doc.title}》（${doc.chunkCount} 个片段）")
                    onDone()
                }
                .onFailure { notify(it.message ?: "网页剪藏失败。") }
            _isClippingWeb.value = false
        }
    }

    fun addMemoryTriple(subject: String, predicate: String, objectValue: String, onSaved: () -> Unit = {}) {
        viewModelScope.launch {
            runCatching { repository.addMemoryTriple(subject, predicate, objectValue) }
                .onSuccess {
                    notify("已添加关系三元组")
                    onSaved()
                }
                .onFailure { notify(it.message ?: "添加关系失败。") }
        }
    }

    fun deleteMemoryTriple(triple: MemoryTripleEntity) {
        viewModelScope.launch {
            runCatching { repository.deleteMemoryTriple(triple.id) }
                .onSuccess { notify("已删除关系三元组") }
                .onFailure { notify(it.message ?: "删除失败。") }
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

    private fun maybeHandleChatMusicIntent(pureQuery: String) {
        if (!settings.value.musicEnabled) return
        val songQuery = MusicIntentDetector.extractSongQuery(pureQuery) ?: return
        viewModelScope.launch {
            val localMatches = MusicIntentDetector.matchLocalTracks(songQuery, repository.listMusicTracks())
            if (localMatches.isNotEmpty()) {
                val track = localMatches.first()
                musicPlayer.play(track, repository.getMusicApiKey())
                notify("已为你播放本地曲目《${track.title}》")
                return@launch
            }
            if (settings.value.musicBaseUrl.isNotBlank()) {
                runCatching { repository.searchOnlineMusic(songQuery) }
                    .onSuccess { results ->
                        if (results.isNotEmpty()) {
                            _onlineMusicResults.value = results
                            val track = results.first()
                            musicPlayer.play(track, repository.getMusicApiKey())
                            notify("已为你点播《${track.title}》")
                        }
                    }
            }
        }
    }

    fun importLocalAudio(displayName: String, bytes: ByteArray) {
        viewModelScope.launch {
            runCatching {
                val track = musicPlayer.copyAudioIntoAppStorage(displayName, bytes)
                repository.saveMusicTrack(track)
                track
            }.onSuccess { track ->
                notify("已导入歌曲《${track.title}》")
            }.onFailure {
                notify(it.message ?: "导入音频失败。")
            }
        }
    }

    fun searchMusic(query: String) {
        val clean = query.trim()
        if (clean.isEmpty()) {
            _onlineMusicResults.value = emptyList()
            return
        }
        viewModelScope.launch {
            val localMatches = MusicIntentDetector.matchLocalTracks(clean, repository.listMusicTracks())
            if (settings.value.musicBaseUrl.isBlank()) {
                notify(if (localMatches.isNotEmpty()) "本地曲库找到 ${localMatches.size} 首匹配歌曲。" else "本地曲库无匹配歌曲，可在设置中配置兼容音乐服务或导入本地音频。")
                return@launch
            }
            runCatching { repository.searchOnlineMusic(clean) }
                .onSuccess { list ->
                    _onlineMusicResults.value = list
                    notify(if (list.isEmpty()) "未搜到在线曲目。" else "已搜到 ${list.size} 首在线曲目。")
                }
                .onFailure { notify(it.message ?: "在线搜歌失败。") }
        }
    }

    fun playTrack(track: MusicTrackEntity) = musicPlayer.play(track, repository.getMusicApiKey())
    fun togglePlayPause() = musicPlayer.togglePlayPause()
    fun seekMusic(positionMs: Long) = musicPlayer.seekTo(positionMs)
    fun playNextTrack() = musicPlayer.playNext(repository.getMusicApiKey())
    fun playPreviousTrack() = musicPlayer.playPrevious(repository.getMusicApiKey())
    fun toggleLoopSingle() = musicPlayer.toggleLoopSingle()

    fun deleteTrack(track: MusicTrackEntity) {
        viewModelScope.launch {
            if (musicState.value.currentTrack?.id == track.id) musicPlayer.stop()
            repository.deleteMusicTrack(track)
            notify("已移除曲目《${track.title}》")
        }
    }

    fun setLinkageFlags(
        musicEnabled: Boolean? = null,
        stickerEnabled: Boolean? = null,
        toolsEnabled: Boolean? = null
    ) {
        repository.setLinkageFlags(musicEnabled, stickerEnabled, toolsEnabled)
    }

    fun saveMusicServiceSettings(baseUrl: String, source: String, newApiKey: String?, clearApiKey: Boolean) {
        repository.saveMusicServiceSettings(baseUrl, source, newApiKey, clearApiKey)
        notify("音乐服务配置已保存。")
    }

    fun clearUsageRecords() {
        viewModelScope.launch {
            repository.clearUsageRecords()
            notify("已清空 Token 用量统计。")
        }
    }

    fun setCustomPricing(inputPer1M: Double, outputPer1M: Double) {
        repository.setCustomPricing(inputPer1M, outputPer1M)
        notify(
            if (inputPer1M <= 0.0 && outputPer1M <= 0.0) "已恢复按模型默认单价估算。"
            else "已保存自定义单价（输入 \$${inputPer1M} / 输出 \$${outputPer1M} 每百万 Token）。"
        )
    }

    fun saveScheduledTask(
        existingId: String?,
        personaId: String,
        title: String,
        prompt: String,
        intervalMinutes: Int,
        enabled: Boolean,
        onSaved: () -> Unit = {}
    ) {
        viewModelScope.launch {
            runCatching {
                repository.saveScheduledTask(existingId, personaId, title, prompt, intervalMinutes, enabled)
            }.onSuccess {
                notify(if (existingId == null) "已创建定时任务「${it.title}」" else "已更新任务状态")
                onSaved()
            }.onFailure { notify(it.message ?: "保存任务失败。") }
        }
    }

    fun runScheduledTaskNow(task: ScheduledTaskEntity) {
        if (_runningTaskId.value != null) return
        viewModelScope.launch {
            _runningTaskId.value = task.id
            runCatching { repository.runScheduledTaskNow(task) }
                .onSuccess { notify("定时任务「${task.title}」执行完成。") }
                .onFailure { notify(it.message ?: "任务执行失败。") }
            _runningTaskId.value = null
        }
    }

    fun deleteScheduledTask(task: ScheduledTaskEntity) {
        viewModelScope.launch {
            runCatching { repository.deleteScheduledTask(task.id) }
                .onSuccess { notify("已删除定时任务「${task.title}」") }
                .onFailure { notify(it.message ?: "删除任务失败。") }
        }
    }

    fun saveMailDraft(
        existingId: String?,
        recipient: String,
        subject: String,
        body: String,
        status: String = "draft"
    ) {
        viewModelScope.launch {
            runCatching { repository.saveMailDraft(existingId, recipient, subject, body, status) }
                .onSuccess { notify(if (status == "sent") "已记录邮件并唤起发送" else "已保存到本地邮件草稿箱") }
                .onFailure { notify(it.message ?: "保存草稿失败。") }
        }
    }

    fun deleteMailDraft(draft: MailDraftEntity) {
        viewModelScope.launch {
            runCatching { repository.deleteMailDraft(draft.id) }
                .onSuccess { notify("已删除邮件草稿") }
                .onFailure { notify(it.message ?: "删除失败。") }
        }
    }

    fun notify(message: String) {
        _notices.tryEmit(message)
    }

    companion object {
        fun factory(repository: QiYiRepository, musicPlayer: MusicPlayerController): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T {
                    return QiYiViewModel(repository, musicPlayer) as T
                }
            }
    }
}
