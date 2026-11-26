package com.qiyi.companion.data.context

import com.qiyi.companion.data.db.ConversationEntity
import com.qiyi.companion.data.db.MessageEntity
import com.qiyi.companion.data.db.PersonaEntity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ContextCompactionEngineTest {

    private val testPersona = PersonaEntity(
        id = "p1",
        name = "望舒",
        systemPrompt = "你是望舒，温和简洁的个人伴侣。",
        tone = "温和"
    )

    @Test
    fun `infers context window limits by model family and respects override`() {
        assertEquals(1_000_000, ContextCompactionEngine.inferContextWindowTokens("gemini-2.5-flash"))
        assertEquals(200_000, ContextCompactionEngine.inferContextWindowTokens("claude-3.7-sonnet"))
        assertEquals(128_000, ContextCompactionEngine.inferContextWindowTokens("gpt-4o"))
        assertEquals(64_000, ContextCompactionEngine.inferContextWindowTokens("deepseek-chat"))
        assertEquals(32_000, ContextCompactionEngine.inferContextWindowTokens("gpt-4o", overrideLimit = 32_000))
    }

    @Test
    fun `buildCompactionPlan preserves recent messages and folds older turns`() {
        val msgs = (1L..8L).map { idx ->
            MessageEntity(
                id = idx,
                conversationId = "c1",
                role = if (idx % 2L == 1L) "user" else "assistant",
                content = "第 $idx 条测试消息内容，包含讨论细节。"
            )
        }
        val plan = ContextCompactionEngine.buildCompactionPlan(
            allMessages = msgs,
            currentCompactedUpToId = 0L,
            keepRecentCount = 4
        )
        assertNotNull(plan)
        assertEquals(4, plan!!.messagesToCompact.size)
        assertEquals(4, plan.keptRecentMessages.size)
        assertEquals(4L, plan.newCompactedUpToMessageId)
        assertTrue(plan.tokensBeforeCompact > 0)

        // Too few remaining messages after compaction should return null
        val secondPlan = ContextCompactionEngine.buildCompactionPlan(
            allMessages = msgs,
            currentCompactedUpToId = 6L,
            keepRecentCount = 4
        )
        assertNull(secondPlan)
    }

    @Test
    fun `calculateSnapshot separates compacted summary from active messages`() {
        val msgs = (1L..6L).map { idx ->
            MessageEntity(
                id = idx,
                conversationId = "c1",
                role = if (idx % 2L == 1L) "user" else "assistant",
                content = "这是第 $idx 条较长的对话内容，用来估算上下文占用量。"
            )
        }
        val uncompactedConv = ConversationEntity(id = "c1", personaId = "p1", title = "测试")
        val before = ContextCompactionEngine.calculateSnapshot(
            persona = testPersona,
            conversation = uncompactedConv,
            messages = msgs,
            effectiveModel = "deepseek-chat"
        )
        assertFalse(before.hasCompaction)
        assertEquals(6, before.activeMessageCount)
        assertEquals(0, before.compactedMessageCount)
        assertTrue(before.canCompact)

        val compactedConv = uncompactedConv.copy(
            contextSummary = "- 讨论了前端架构与测试方案。",
            compactedUpToMessageId = 4L,
            compactedAt = 123456L
        )
        val after = ContextCompactionEngine.calculateSnapshot(
            persona = testPersona,
            conversation = compactedConv,
            messages = msgs,
            effectiveModel = "deepseek-chat"
        )
        assertTrue(after.hasCompaction)
        assertEquals(2, after.activeMessageCount)
        assertEquals(4, after.compactedMessageCount)
        assertTrue(after.summaryTokens > 0)
        assertTrue(after.activeHistoryTokens < before.activeHistoryTokens)
    }

    @Test
    fun `local fallback summary redacts raw attachment blocks and merges previous summary`() {
        val msgs = listOf(
            MessageEntity(
                id = 1L,
                conversationId = "c1",
                role = "user",
                content = "帮我看文档\n<user_attachment name=\"a.txt\">\n很长的附件正文内容\n</user_attachment>"
            ),
            MessageEntity(
                id = 2L,
                conversationId = "c1",
                role = "assistant",
                content = "好的，我整理了核心要点。"
            )
        )
        val summary = ContextCompactionEngine.buildLocalFallbackSummary(
            existingSummary = "- 之前已确定采用本地离线方案。",
            messagesToCompact = msgs,
            defaultPersonaName = "望舒"
        )
        assertTrue(summary.contains("之前已确定采用本地离线方案"))
        assertTrue(summary.contains("[附带文本附件]"))
        assertFalse(summary.contains("很长的附件正文内容"))
        assertTrue(summary.contains("望舒"))
    }
}
