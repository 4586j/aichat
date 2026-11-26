package com.qiyi.companion.data.network

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
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
    val content: String
)

sealed interface StreamChunk {
    data class ContentDelta(val text: String) : StreamChunk
    data class ReasoningDelta(val text: String) : StreamChunk
    data object Done : StreamChunk
}

class ModelServiceException(
    message: String,
    val httpStatus: Int? = null,
    val isQuotaLimit: Boolean = false,
    val retryAfterSeconds: Long? = null
) : Exception(message)

@Serializable
private data class ChatCompletionRequest(
    val model: String,
    val messages: List<RequestMessage>,
    val stream: Boolean = false,
    val max_tokens: Int = 3000
)

@Serializable
private data class RequestMessage(
    val role: String,
    val content: String
)

class OpenAiClient(
    private val httpClient: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(120, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .build()
) {
    private val json = Json { ignoreUnknownKeys = true }
    private val jsonMediaType = "application/json; charset=utf-8".toMediaType()

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
                messages = listOf(RequestMessage("user", "请只回答：连接成功")),
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
        val payload = json.encodeToString(
            ChatCompletionRequest.serializer(),
            ChatCompletionRequest(
                model = cleanModel,
                messages = messages.map { RequestMessage(it.role, it.content) },
                stream = true,
                max_tokens = 3000
            )
        )
        val reqBuilder = Request.Builder()
            .url("$normalized/chat/completions")
            .header("Accept", "text/event-stream")
            .post(payload.toRequestBody(jsonMediaType))
        if (apiKey.isNotBlank()) reqBuilder.header("Authorization", "Bearer ${apiKey.trim()}")

        val call: Call = httpClient.newCall(reqBuilder.build())
        val worker = Thread {
            try {
                call.execute().use { resp ->
                    if (!resp.isSuccessful) {
                        close(mapHttpError(resp.code, resp.header("Retry-After")))
                        return@use
                    }
                    val contentType = resp.header("Content-Type").orEmpty().lowercase()
                    val body = resp.body ?: run {
                        close(ModelServiceException("模型服务返回空响应。"))
                        return@use
                    }
                    if (contentType.contains("application/json")) {
                        val root = json.parseToJsonElement(body.string()).jsonObject
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
                        while (!call.isCanceled()) {
                            val line = reader.readLine() ?: break
                            val trimmed = line.trim()
                            if (!trimmed.startsWith("data:")) continue
                            val data = trimmed.removePrefix("data:").trim()
                            if (data.isEmpty()) continue
                            if (data == "[DONE]") break
                            val parsed = runCatching { json.parseToJsonElement(data).jsonObject }.getOrNull() ?: continue
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
                if (call.isCanceled()) {
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
            call.cancel()
        }
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
