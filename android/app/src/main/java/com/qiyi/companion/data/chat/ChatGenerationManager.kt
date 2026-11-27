package com.qiyi.companion.data.chat

import android.content.Context
import com.qiyi.companion.data.QiYiRepository
import com.qiyi.companion.data.media.StickerCatalog
import com.qiyi.companion.data.network.ModelServiceException
import com.qiyi.companion.data.network.StreamChunk
import com.qiyi.companion.data.usage.UsageAnalytics
import com.qiyi.companion.ui.QuotaCheckpointState
import com.qiyi.companion.ui.StreamingState
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.util.concurrent.ConcurrentHashMap

/**
 * Application-scoped per-conversation streaming generation coordinator.
 * - Isolates streaming state & Job per conversationId so users can freely switch conversations,
 *   personas, tabs, or background the app while replies continue streaming and persisting to Room.
 * - Enforces per-conversation single-concurrency lock (preventing overlapping replies in the same chat).
 * - Coordinates lightweight foreground keep-alive notification during active generation.
 */
class ChatGenerationManager(
    private val appContext: Context,
    private val repository: QiYiRepository
) {
    private val appScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val activeJobs = ConcurrentHashMap<String, Job>()

    private val _streamingByConversation = MutableStateFlow<Map<String, StreamingState>>(emptyMap())
    val streamingByConversation: StateFlow<Map<String, StreamingState>> = _streamingByConversation.asStateFlow()

    private val _notices = MutableSharedFlow<String>(extraBufferCapacity = 16)
    val notices: SharedFlow<String> = _notices.asSharedFlow()

    private val _quotaCheckpoints = MutableSharedFlow<QuotaCheckpointState>(extraBufferCapacity = 8)
    val quotaCheckpoints: SharedFlow<QuotaCheckpointState> = _quotaCheckpoints.asSharedFlow()

    fun isGenerating(conversationId: String?): Boolean {
        if (conversationId.isNullOrBlank()) return false
        return activeJobs[conversationId]?.isActive == true
    }

    fun stopGeneration(conversationId: String?) {
        if (conversationId.isNullOrBlank()) return
        activeJobs[conversationId]?.cancel()
    }

    fun startResponderQueue(
        convId: String,
        responderIds: List<String>,
        latestQuery: String,
        isGroupChat: Boolean,
        latestImageDataUris: List<String> = emptyList()
    ): Boolean {
        if (responderIds.isEmpty()) return false
        if (isGenerating(convId)) return false

        val job = appScope.launch {
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

                    updateStreamState(
                        convId,
                        StreamingState(
                            isStreaming = true,
                            conversationId = convId,
                            speakerName = persona.name,
                            speakerAvatar = persona.avatar.ifBlank { persona.name.take(1) },
                            content = "",
                            reasoning = ""
                        )
                    )
                    syncForegroundNotification(persona.name)

                    try {
                        val settingsNow = repository.settings.value
                        val useTools = settingsNow.toolsEnabled && latestImageDataUris.isEmpty()
                        repository.streamReply(persona, promptMessages, toolsEnabled = useTools).collect { chunk ->
                            when (chunk) {
                                is StreamChunk.ContentDelta -> {
                                    contentBuilder.append(chunk.text)
                                    updateStreamContent(convId, content = contentBuilder.toString())
                                }
                                is StreamChunk.ReasoningDelta -> {
                                    reasoningBuilder.append(chunk.text)
                                    updateStreamContent(convId, reasoning = reasoningBuilder.toString())
                                }
                                is StreamChunk.ToolStep -> {
                                    toolSteps.add(chunk.summary)
                                    reasoningBuilder.append("\n[工具] ").append(chunk.summary)
                                    updateStreamContent(convId, reasoning = reasoningBuilder.toString())
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
                            val matchedSticker = if (repository.settings.value.stickerEnabled) {
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
                        _notices.tryEmit("已停止生成。")
                        throw cancel
                    } catch (err: ModelServiceException) {
                        val partialContent = contentBuilder.toString().trim()
                        if (partialContent.isNotEmpty()) {
                            repository.saveAssistantMessage(
                                conversationId = convId,
                                content = "$partialContent\n\n（连接中断，已保留已生成内容）",
                                reasoning = reasoningBuilder.toString().trim(),
                                senderPersonaId = persona.id,
                                senderName = persona.name
                            )
                        }
                        if (err.isQuotaLimit) {
                            val waitSeconds = (err.retryAfterSeconds ?: 60L).coerceIn(5L, 600L)
                            _quotaCheckpoints.tryEmit(
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
                            _notices.tryEmit(err.message ?: "生成回复失败，请检查网络或模型配置。")
                            return@launch
                        }
                    } catch (err: Exception) {
                        val partialContent = contentBuilder.toString().trim()
                        if (partialContent.isNotEmpty()) {
                            repository.saveAssistantMessage(
                                conversationId = convId,
                                content = "$partialContent\n\n（网络异常，已保留已生成内容）",
                                reasoning = reasoningBuilder.toString().trim(),
                                senderPersonaId = persona.id,
                                senderName = persona.name
                            )
                        }
                        _notices.tryEmit(err.message ?: "生成回复失败，请检查网络或模型配置。")
                        return@launch
                    }
                }
            } finally {
                activeJobs.remove(convId)
                _streamingByConversation.update { it - convId }
                syncForegroundNotification("")
            }
        }
        activeJobs[convId] = job
        return true
    }

    private fun updateStreamState(convId: String, state: StreamingState) {
        _streamingByConversation.update { it + (convId to state) }
    }

    private fun updateStreamContent(convId: String, content: String? = null, reasoning: String? = null) {
        _streamingByConversation.update { map ->
            val prev = map[convId] ?: return@update map
            map + (convId to prev.copy(
                content = content ?: prev.content,
                reasoning = reasoning ?: prev.reasoning
            ))
        }
    }

    private fun syncForegroundNotification(latestSpeaker: String) {
        val activeMap = _streamingByConversation.value
        val count = activeMap.size
        val speaker = latestSpeaker.ifBlank { activeMap.values.firstOrNull()?.speakerName.orEmpty() }
        ChatGenerationService.update(appContext, speaker, count)
    }
}
