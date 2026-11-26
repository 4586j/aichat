package com.qiyi.companion

import com.qiyi.companion.data.network.ChatPromptMessage
import com.qiyi.companion.data.network.ModelServiceException
import com.qiyi.companion.data.network.OpenAiClient
import com.qiyi.companion.data.network.StreamChunk
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test

class OpenAiClientTest {

    private lateinit var server: MockWebServer
    private lateinit var client: OpenAiClient

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
        client = OpenAiClient()
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    @Test
    fun listModelsParsesSortedUniqueIds() = runTest {
        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setHeader("Content-Type", "application/json")
                .setBody("""{"data":[{"id":"gpt-4o"},{"id":"deepseek-chat"},{"id":"gpt-4o"}]}""")
        )

        val baseUrl = server.url("/v1").toString().trimEnd('/')
        val models = client.listModels(baseUrl, "sk-test")

        assertEquals(listOf("deepseek-chat", "gpt-4o"), models)
        val recorded = server.takeRequest()
        assertEquals("/v1/models", recorded.path)
        assertEquals("Bearer sk-test", recorded.getHeader("Authorization"))
    }

    @Test
    fun streamChatEmitsReasoningAndContentChunks() = runTest {
        val sseBody = buildString {
            append("data: {\"choices\":[{\"delta\":{\"reasoning_content\":\"先思考一下\"}}]}\n\n")
            append("data: {\"choices\":[{\"delta\":{\"content\":\"你好\"}}]}\n\n")
            append("data: {\"choices\":[{\"delta\":{\"content\":\"，世界！\"}}]}\n\n")
            append("data: [DONE]\n\n")
        }
        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setHeader("Content-Type", "text/event-stream")
                .setBody(sseBody)
        )

        val baseUrl = server.url("/v1").toString().trimEnd('/')
        val chunks = client.streamChat(
            baseUrl = baseUrl,
            apiKey = "sk-test",
            model = "deepseek-reasoner",
            messages = listOf(ChatPromptMessage("user", "hello"))
        ).toList()

        val reasoning = chunks.filterIsInstance<StreamChunk.ReasoningDelta>().joinToString("") { it.text }
        val content = chunks.filterIsInstance<StreamChunk.ContentDelta>().joinToString("") { it.text }
        assertEquals("先思考一下", reasoning)
        assertEquals("你好，世界！", content)
        assertTrue(chunks.last() is StreamChunk.Done)
    }

    @Test
    fun testConnectionMapsHttp429WithRetryAfter() = runTest {
        server.enqueue(
            MockResponse()
                .setResponseCode(429)
                .setHeader("Retry-After", "45")
                .setBody("""{"error":{"message":"rate limit"}}""")
        )

        val baseUrl = server.url("/v1").toString().trimEnd('/')
        try {
            client.testConnection(baseUrl, "sk-test", "gpt-4o")
            fail("Expected ModelServiceException")
        } catch (err: ModelServiceException) {
            assertEquals(429, err.httpStatus)
            assertTrue(err.isQuotaLimit)
            assertEquals(45L, err.retryAfterSeconds)
        }
    }

    @Test
    fun streamChatSerializesMultipartImageUrlPayloadWhenImagesPresent() = runTest {
        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setHeader("Content-Type", "text/event-stream")
                .setBody("data: {\"choices\":[{\"delta\":{\"content\":\"看到了图片\"}}]}\n\ndata: [DONE]\n\n")
        )

        val baseUrl = server.url("/v1").toString().trimEnd('/')
        val chunks = client.streamChat(
            baseUrl = baseUrl,
            apiKey = "sk-test",
            model = "gpt-4o",
            messages = listOf(
                ChatPromptMessage(
                    role = "user",
                    content = "描述这张图",
                    imageDataUris = listOf("data:image/jpeg;base64,AAAA")
                )
            )
        ).toList()

        val recordedBody = server.takeRequest().body.readUtf8()
        assertTrue(recordedBody.contains("\"type\":\"image_url\""))
        assertTrue(recordedBody.contains("data:image/jpeg;base64,AAAA"))
        assertEquals("看到了图片", chunks.filterIsInstance<StreamChunk.ContentDelta>().joinToString("") { it.text })
    }
}
