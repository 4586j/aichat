package com.qiyi.companion.data.network

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import com.qiyi.companion.data.tools.DeterministicToolRegistry
import okhttp3.Call
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.net.URI
import java.util.concurrent.TimeUnit

data class ChatPromptMessage(
    val role: String,
    val content: String,
    val imageDataUris: List<String> = emptyList()
)

sealed interface StreamChunk {
    data class ContentDelta(val text: String) : StreamChunk
    data class ReasoningDelta(val text: String) : StreamChunk
    data class ToolStep(val summary: String) : StreamChunk
    data class Usage(
        val promptTokens: Int,
        val cachedPromptTokens: Int = 0,
        val completionTokens: Int = 0,
        val reasoningTokens: Int = 0,
        val totalTokens: Int = 0
    ) : StreamChunk
    data object Done : StreamChunk
}

class ModelServiceException(
    message: String,
    val httpStatus: Int? = null,
    val isQuotaLimit: Boolean = false,
    val retryAfterSeconds: Long? = null
) : Exception(message)

@Serializable
private data class StreamOptions(
    val include_usage: Boolean = true
)

@Serializable
private data class ChatCompletionRequest(
    val model: String,
    val messages: List<RequestMessage>,
    val stream: Boolean = false,
    val max_tokens: Int = 3000,
    val stream_options: StreamOptions? = null
)

@Serializable
private data class RequestMessage(
    val role: String,
    val content: JsonElement
)

class OpenAiClient(
    private val httpClient: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(120, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .build()
) {
    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false }
    private val jsonMediaType = "application/json; charset=utf-8".toMediaType()
    private val streamOptionsUnsupportedHosts = java.util.concurrent.ConcurrentHashMap<String, Boolean>()

    fun normalizeBaseUrl(raw: String): String {
        val trimmed = raw.trim().trimEnd('/')
        if (trimmed.isEmpty()) throw ModelServiceException("请先填写模型服务的 Base URL。")
        val uri = try {
            URI(trimmed)
        } catch (_: Exception) {
            throw ModelServiceException("Base URL 格式无效，请以 http:// 或 https:// 开头。")
        }
        val scheme = uri.scheme?.lowercase()
        if (scheme != "http" && scheme != "https") {
            throw ModelServiceException("Base URL 仅支持 http:// 或 https:// 协议。")
        }
        if (uri.host.isNullOrBlank()) {
            throw ModelServiceException("Base URL 缺少有效的主机名。")
        }
        return trimmed
    }

    suspend fun listModels(baseUrl: String, apiKey: String): List<String> = withContext(Dispatchers.IO) {
        val normalized = normalizeBaseUrl(baseUrl)
        val reqBuilder = Request.Builder().url("$normalized/models").get()
        if (apiKey.isNotBlank()) reqBuilder.header("Authorization", "Bearer ${apiKey.trim()}")
        httpClient.newCall(reqBuilder.build()).execute().use { resp ->
            if (!resp.isSuccessful) {
                throw ModelServiceException("获取模型列表失败（HTTP ${resp.code}），仍可手动输入模型 ID。", resp.code)
            }
            val body = resp.body?.string().orEmpty()
            val root = runCatching { json.parseToJsonElement(body).jsonObject }.getOrNull()
                ?: throw ModelServiceException("模型列表响应格式无效。")
            val rows: JsonArray = root["data"] as? JsonArray
                ?: root["models"] as? JsonArray
                ?: return@withContext emptyList()
            rows.mapNotNull { item ->
                when (item) {
                    is JsonObject -> item["id"]?.jsonPrimitive?.contentOrNull?.trim()
                    else -> item.jsonPrimitive.contentOrNull?.trim()
                }
            }.filter { it.isNotEmpty() && it.length <= 160 }.distinct().sorted().take(300)
        }
    }

    suspend fun testConnection(baseUrl: String, apiKey: String, model: String): String = withContext(Dispatchers.IO) {
        val normalized = normalizeBaseUrl(baseUrl)
        val cleanModel = model.trim()
        if (cleanModel.isEmpty()) throw ModelServiceException("请先填写模型 ID 再测试连接。")
        val payload = json.encodeToString(
            ChatCompletionRequest.serializer(),
            ChatCompletionRequest(
                model = cleanModel,
                messages = listOf(RequestMessage("user", JsonPrimitive("请只回答：连接成功"))),
                stream = false,
                max_tokens = 64
            )
        )
        val reqBuilder = Request.Builder()
            .url("$normalized/chat/completions")
            .post(payload.toRequestBody(jsonMediaType))
        if (apiKey.isNotBlank()) reqBuilder.header("Authorization", "Bearer ${apiKey.trim()}")
        httpClient.newCall(reqBuilder.build()).execute().use { resp ->
            if (!resp.isSuccessful) throw mapHttpError(resp.code, resp.header("Retry-After"))
            val body = resp.body?.string().orEmpty()
            val root = json.parseToJsonElement(body).jsonObject
            val content = root["choices"]?.jsonArray?.firstOrNull()?.jsonObject
                ?.get("message")?.jsonObject?.get("content")?.jsonPrimitive?.contentOrNull
                ?.trim().orEmpty()
            content.ifEmpty { "连接成功" }
        }
    }

    fun streamChat(
        baseUrl: String,
        apiKey: String,
        model: String,
        messages: List<ChatPromptMessage>
    ): Flow<StreamChunk> = callbackFlow {
        val normalized = normalizeBaseUrl(baseUrl)
        val cleanModel = model.trim()
        if (cleanModel.isEmpty()) {
            close(ModelServiceException("请先在设置或角色配置中填写模型 ID。"))
            return@callbackFlow
        }

        fun buildCall(withStreamOptions: Boolean): Call {
            val payload = json.encodeToString(
                ChatCompletionRequest.serializer(),
                ChatCompletionRequest(
                    model = cleanModel,
                    messages = messages.map { toRequestMessage(it) },
                    stream = true,
                    max_tokens = 3000,
                    stream_options = if (withStreamOptions) StreamOptions(include_usage = true) else null
                )
            )
            val reqBuilder = Request.Builder()
                .url("$normalized/chat/completions")
                .header("Accept", "text/event-stream")
                .post(payload.toRequestBody(jsonMediaType))
            if (apiKey.isNotBlank()) reqBuilder.header("Authorization", "Bearer ${apiKey.trim()}")
            return httpClient.newCall(reqBuilder.build())
        }

        val tryIncludeUsage = streamOptionsUnsupportedHosts[normalized] != true
        val currentCallRef = java.util.concurrent.atomic.AtomicReference(buildCall(tryIncludeUsage))
        val worker = Thread {
            try {
                var resp = currentCallRef.get().execute()
                // Auto-downgrade cleanly if an older gateway rejects stream_options with 400/422
                if (tryIncludeUsage && (resp.code == 400 || resp.code == 422)) {
                    resp.close()
                    streamOptionsUnsupportedHosts[normalized] = true
                    currentCallRef.set(buildCall(false))
                    resp = currentCallRef.get().execute()
                }
                resp.use { activeResp ->
                    if (!activeResp.isSuccessful) {
                        close(mapHttpError(activeResp.code, activeResp.header("Retry-After")))
                        return@use
                    }
                    val contentType = activeResp.header("Content-Type").orEmpty().lowercase()
                    val body = activeResp.body ?: run {
                        close(ModelServiceException("模型服务返回空响应。"))
                        return@use
                    }
                    if (contentType.contains("application/json")) {
                        val root = json.parseToJsonElement(body.string()).jsonObject
                        val usageObj = root["usage"] as? JsonObject
                        if (usageObj != null) {
                            parseUsageChunk(usageObj)?.let { trySend(it) }
                        }
                        val msg = root["choices"]?.jsonArray?.firstOrNull()?.jsonObject?.get("message")?.jsonObject
                        val reasoning = msg?.get("reasoning_content")?.jsonPrimitive?.contentOrNull.orEmpty()
                        val content = msg?.get("content")?.jsonPrimitive?.contentOrNull.orEmpty()
                        if (reasoning.isNotEmpty()) trySend(StreamChunk.ReasoningDelta(reasoning))
                        if (content.isNotEmpty()) trySend(StreamChunk.ContentDelta(content))
                        trySend(StreamChunk.Done)
                        close()
                        return@use
                    }

                    body.charStream().buffered().use { reader ->
                        while (!currentCallRef.get().isCanceled()) {
                            val line = reader.readLine() ?: break
                            val trimmed = line.trim()
                            if (!trimmed.startsWith("data:")) continue
                            val data = trimmed.removePrefix("data:").trim()
                            if (data.isEmpty()) continue
                            if (data == "[DONE]") break
                            val parsed = runCatching { json.parseToJsonElement(data).jsonObject }.getOrNull() ?: continue
                            val usageObj = parsed["usage"] as? JsonObject
                            if (usageObj != null) {
                                parseUsageChunk(usageObj)?.let { trySend(it) }
                            }
                            val delta = parsed["choices"]?.jsonArray?.firstOrNull()?.jsonObject?.get("delta")?.jsonObject ?: continue
                            val reasoning = delta["reasoning_content"]?.jsonPrimitive?.contentOrNull
                                ?: delta["reasoning"]?.jsonPrimitive?.contentOrNull
                            val content = delta["content"]?.jsonPrimitive?.contentOrNull
                            if (!reasoning.isNullOrEmpty()) trySend(StreamChunk.ReasoningDelta(reasoning))
                            if (!content.isNullOrEmpty()) trySend(StreamChunk.ContentDelta(content))
                        }
                    }
                    trySend(StreamChunk.Done)
                    close()
                }
            } catch (err: IOException) {
                if (currentCallRef.get().isCanceled()) {
                    close()
                } else {
                    close(ModelServiceException("连接模型服务中断，请检查网络或配置：${err.message ?: "IO 异常"}"))
                }
            } catch (err: Exception) {
                close(err)
            }
        }.apply { isDaemon = true }
        worker.start()

        awaitClose {
            currentCallRef.get().cancel()
        }
    }

    /**
     * Multi-turn ReAct tool-calling loop with 5-time duplicate call breaker and 5-time failure breaker,
     * falling back gracefully to standard streaming when tools are disabled or unsupported.
     */
    fun streamChatWithTools(
        baseUrl: String,
        apiKey: String,
        model: String,
        messages: List<ChatPromptMessage>,
        toolsEnabled: Boolean,
        knowledgeSearcher: suspend (String) -> String
    ): Flow<StreamChunk> {
        if (!toolsEnabled) return streamChat(baseUrl, apiKey, model, messages)
        return kotlinx.coroutines.flow.flow {
            val normalized = normalizeBaseUrl(baseUrl)
            val cleanModel = model.trim()
            if (cleanModel.isEmpty()) throw ModelServiceException("请先在设置或角色配置中填写模型 ID。")

            val conversation = mutableListOf<JsonObject>()
            messages.forEach { msg ->
                val req = toRequestMessage(msg)
                conversation.add(buildJsonObject {
                    put("role", req.role)
                    put("content", req.content)
                })
            }

            val toolsDef = DeterministicToolRegistry.openAiToolDefinitions()
            var lastFingerprint = ""
            var duplicateStreak = 0
            var failureStreak = 0

            for (round in 0 until 6) {
                val bodyJson = buildJsonObject {
                    put("model", cleanModel)
                    put("messages", JsonArray(conversation))
                    put("tools", toolsDef)
                    put("tool_choice", "auto")
                    put("stream", false)
                    put("max_tokens", 3000)
                }.toString()

                val reqBuilder = Request.Builder()
                    .url("$normalized/chat/completions")
                    .post(bodyJson.toRequestBody(jsonMediaType))
                if (apiKey.isNotBlank()) reqBuilder.header("Authorization", "Bearer ${apiKey.trim()}")

                val responseRoot: JsonObject = withContext(Dispatchers.IO) {
                    httpClient.newCall(reqBuilder.build()).execute().use { resp ->
                        if (resp.code == 400 || resp.code == 422) {
                            // Upstream model likely does not support function calling; fallback cleanly
                            return@withContext JsonObject(emptyMap())
                        }
                        if (!resp.isSuccessful) throw mapHttpError(resp.code, resp.header("Retry-After"))
                        json.parseToJsonElement(resp.body?.string().orEmpty()).jsonObject
                    }
                }

                if (responseRoot.isEmpty()) {
                    streamChat(baseUrl, apiKey, model, messages).collect { emit(it) }
                    return@flow
                }

                val usageObj = responseRoot["usage"] as? JsonObject
                if (usageObj != null) {
                    parseUsageChunk(usageObj)?.let { emit(it) }
                }

                val msgObj = responseRoot["choices"]?.jsonArray?.firstOrNull()?.jsonObject
                    ?.get("message")?.jsonObject ?: break
                val reasoning = msgObj["reasoning_content"]?.jsonPrimitive?.contentOrNull
                    ?: msgObj["reasoning"]?.jsonPrimitive?.contentOrNull.orEmpty()
                val content = msgObj["content"]?.jsonPrimitive?.contentOrNull.orEmpty()
                val toolCalls = msgObj["tool_calls"] as? JsonArray

                if (toolCalls == null || toolCalls.isEmpty()) {
                    if (reasoning.isNotBlank()) emit(StreamChunk.ReasoningDelta(reasoning))
                    if (content.isNotBlank()) emit(StreamChunk.ContentDelta(content))
                    emit(StreamChunk.Done)
                    return@flow
                }

                conversation.add(msgObj)
                var trippedBreaker = false

                for (callEl in toolCalls) {
                    val callObj = callEl.jsonObject
                    val callId = callObj["id"]?.jsonPrimitive?.contentOrNull ?: "call_$round"
                    val fnObj = callObj["function"]?.jsonObject ?: continue
                    val fnName = fnObj["name"]?.jsonPrimitive?.contentOrNull.orEmpty()
                    val argsRaw = fnObj["arguments"]?.jsonPrimitive?.contentOrNull ?: "{}"
                    val fingerprint = "$fnName:$argsRaw"

                    if (fingerprint == lastFingerprint) {
                        duplicateStreak++
                    } else {
                        lastFingerprint = fingerprint
                        duplicateStreak = 1
                    }
                    if (duplicateStreak >= 5) {
                        emit(StreamChunk.ToolStep("熔断：连续 5 次重复调用 $fnName，已强制收敛输出。"))
                        trippedBreaker = true
                        break
                    }

                    val argsObj = runCatching { json.parseToJsonElement(argsRaw).jsonObject }.getOrElse { JsonObject(emptyMap()) }
                    val toolOutput = runCatching {
                        DeterministicToolRegistry.execute(fnName, argsObj, knowledgeSearcher)
                    }.fold(
                        onSuccess = { out ->
                            failureStreak = 0
                            out
                        },
                        onFailure = { err ->
                            failureStreak++
                            "工具执行失败：${err.message ?: "未知错误"}"
                        }
                    )

                    emit(StreamChunk.ToolStep("调用 $fnName → ${toolOutput.take(160)}"))
                    conversation.add(buildJsonObject {
                        put("role", "tool")
                        put("tool_call_id", callId)
                        put("content", toolOutput)
                    })

                    if (failureStreak >= 5) {
                        emit(StreamChunk.ToolStep("阻断：工具连续失败 5 次，已中止工具链。"))
                        trippedBreaker = true
                        break
                    }
                }

                if (trippedBreaker) {
                    conversation.add(buildJsonObject {
                        put("role", "user")
                        put("content", "请直接基于以上已获得的工具结果给出清晰、完整的最终中文回答，不要再调用工具。")
                    })
                    break
                }
            }

            // Final convergence turn (streaming) after tool execution
            val finalMessages = conversation.mapNotNull { obj ->
                val role = obj["role"]?.jsonPrimitive?.contentOrNull ?: return@mapNotNull null
                if (role == "tool") {
                    ChatPromptMessage("user", "[工具执行结果]\n${obj["content"]?.jsonPrimitive?.contentOrNull.orEmpty()}")
                } else {
                    val text = obj["content"]?.jsonPrimitive?.contentOrNull.orEmpty()
                    if (text.isBlank()) null else ChatPromptMessage(role, text)
                }
            }
            streamChat(baseUrl, apiKey, model, finalMessages).collect { emit(it) }
        }
    }

    /**
     * Fetches a dense vector embedding via OpenAI-compatible `/embeddings` endpoint (optional hybrid RAG).
     */
    suspend fun fetchEmbedding(
        baseUrl: String,
        apiKey: String,
        embeddingModel: String,
        text: String
    ): List<Double>? = withContext(Dispatchers.IO) {
        val cleanModel = embeddingModel.trim()
        if (cleanModel.isEmpty() || text.isBlank()) return@withContext null
        val normalized = normalizeBaseUrl(baseUrl)
        val payload = buildJsonObject {
            put("model", cleanModel)
            put("input", text.take(2000))
        }.toString()
        val reqBuilder = Request.Builder()
            .url("$normalized/embeddings")
            .post(payload.toRequestBody(jsonMediaType))
        if (apiKey.isNotBlank()) reqBuilder.header("Authorization", "Bearer ${apiKey.trim()}")
        runCatching {
            httpClient.newCall(reqBuilder.build()).execute().use { resp ->
                if (!resp.isSuccessful) return@use null
                val root = json.parseToJsonElement(resp.body?.string().orEmpty()).jsonObject
                root["data"]?.jsonArray?.firstOrNull()?.jsonObject
                    ?.get("embedding")?.jsonArray
                    ?.mapNotNull { it.jsonPrimitive.doubleOrNull }
            }
        }.getOrNull()
    }

    private fun parseUsageChunk(usageObj: JsonObject): StreamChunk.Usage? {
        val pTok = usageObj["prompt_tokens"]?.jsonPrimitive?.intOrNull
            ?: usageObj["input_tokens"]?.jsonPrimitive?.intOrNull ?: 0
        val cTok = usageObj["completion_tokens"]?.jsonPrimitive?.intOrNull
            ?: usageObj["output_tokens"]?.jsonPrimitive?.intOrNull ?: 0
        val tTok = usageObj["total_tokens"]?.jsonPrimitive?.intOrNull ?: (pTok + cTok)
        val promptDetails = usageObj["prompt_tokens_details"] as? JsonObject
        val cached = promptDetails?.get("cached_tokens")?.jsonPrimitive?.intOrNull
            ?: usageObj["prompt_cache_hit_tokens"]?.jsonPrimitive?.intOrNull
            ?: usageObj["cache_read_input_tokens"]?.jsonPrimitive?.intOrNull
            ?: usageObj["cached_tokens"]?.jsonPrimitive?.intOrNull ?: 0
        val compDetails = usageObj["completion_tokens_details"] as? JsonObject
        val reasoning = compDetails?.get("reasoning_tokens")?.jsonPrimitive?.intOrNull
            ?: usageObj["reasoning_tokens"]?.jsonPrimitive?.intOrNull ?: 0
        return if (tTok > 0 || pTok > 0 || cTok > 0) {
            StreamChunk.Usage(
                promptTokens = pTok,
                cachedPromptTokens = cached.coerceAtMost(pTok.coerceAtLeast(cached)),
                completionTokens = cTok,
                reasoningTokens = reasoning,
                totalTokens = tTok
            )
        } else {
            null
        }
    }

    private fun toRequestMessage(msg: ChatPromptMessage): RequestMessage {
        if (msg.imageDataUris.isEmpty()) {
            return RequestMessage(msg.role, JsonPrimitive(msg.content))
        }
        val parts = buildJsonArray {
            if (msg.content.isNotBlank()) {
                add(buildJsonObject {
                    put("type", "text")
                    put("text", msg.content)
                })
            }
            for (uri in msg.imageDataUris) {
                add(buildJsonObject {
                    put("type", "image_url")
                    put("image_url", buildJsonObject {
                        put("url", uri)
                    })
                })
            }
        }
        return RequestMessage(msg.role, parts)
    }

    private fun mapHttpError(code: Int, retryAfterHeader: String?): ModelServiceException {
        val retrySecs = retryAfterHeader?.trim()?.toLongOrNull()
        val hint = when (code) {
            401, 403 -> "请检查 API Key 与权限。"
            402, 429 -> "服务限流或额度不足，请稍后重试或切换模型。"
            404 -> "请检查 Base URL 和模型名称。"
            else -> "请检查服务商状态或模型配置。"
        }
        return ModelServiceException(
            message = "模型服务返回 HTTP $code，$hint",
            httpStatus = code,
            isQuotaLimit = code == 429 || code == 402,
            retryAfterSeconds = retrySecs
        )
    }
}
