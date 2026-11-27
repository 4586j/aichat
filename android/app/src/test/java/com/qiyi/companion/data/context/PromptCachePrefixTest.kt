package com.qiyi.companion.data.context

import com.qiyi.companion.data.db.KnowledgeChunkEntity
import com.qiyi.companion.data.db.MemoryEntity
import com.qiyi.companion.data.db.MemoryTripleEntity
import com.qiyi.companion.data.db.MessageEntity
import com.qiyi.companion.data.knowledge.KnowledgeEngine
import com.qiyi.companion.data.knowledge.KnowledgeHit
import com.qiyi.companion.data.knowledge.MemoryHit
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PromptCachePrefixTest {

    @Test
    fun `static memory block is byte-for-byte deterministic regardless of input order`() {
        val m1 = MemoryEntity(id = "m_b", content = "喜欢清茶", isPinned = true, importance = 4)
        val m2 = MemoryEntity(id = "m_a", content = "使用 Android 手机", isPinned = true, importance = 5)
        val m3 = MemoryEntity(id = "m_c", content = "今天有点困", isPinned = false, importance = 2)
        val t1 = MemoryTripleEntity(id = "t_2", subject = "我", predicate = "喜欢", objectValue = "园林")
        val t2 = MemoryTripleEntity(id = "t_1", subject = "我", predicate = "居住", objectValue = "苏州")

        val blockA = KnowledgeEngine.buildStaticMemoryBlock(listOf(m1, m2, m3), listOf(t1, t2))
        val blockB = KnowledgeEngine.buildStaticMemoryBlock(listOf(m3, m2, m1), listOf(t2, t1))

        assertEquals(blockA, blockB)
        assertTrue(blockA.contains("使用 Android 手机"))
        assertTrue(blockA.contains("喜欢清茶"))
        assertFalse(blockA.contains("今天有点困"))
    }

    @Test
    fun `dynamic turn reference block excludes pinned memories and isolates RAG chunks`() {
        val pinned = MemoryHit(MemoryEntity(id = "p1", content = "固定偏好", isPinned = true), 12.0)
        val dynamic = MemoryHit(MemoryEntity(id = "d1", content = "上次聊过咖啡", isPinned = false), 5.0)
        val chunk = KnowledgeHit(
            KnowledgeChunkEntity(id = 1L, documentId = "doc1", documentTitle = "测试文档", chunkIndex = 0, content = "重要片段"),
            8.0
        )

        val tail = KnowledgeEngine.buildDynamicTurnReferenceBlock(listOf(chunk), listOf(pinned, dynamic))
        assertFalse(tail.contains("固定偏好"))
        assertTrue(tail.contains("上次聊过咖啡"))
        assertTrue(tail.contains("重要片段"))
    }

    @Test
    fun `stepwise history window keeps identical prefix across 12 consecutive turns above threshold`() {
        val msgs37 = (1L..37L).map { MessageEntity(id = it, conversationId = "c1", role = "user", content = "m$it") }
        val msgs48 = (1L..48L).map { MessageEntity(id = it, conversationId = "c1", role = "user", content = "m$it") }
        val msgs49 = (1L..49L).map { MessageEntity(id = it, conversationId = "c1", role = "user", content = "m$it") }

        val win37 = ContextCompactionEngine.selectCacheFriendlyHistoryWindow(msgs37, maxWindow = 36, stepDrop = 12)
        val win48 = ContextCompactionEngine.selectCacheFriendlyHistoryWindow(msgs48, maxWindow = 36, stepDrop = 12)
        val win49 = ContextCompactionEngine.selectCacheFriendlyHistoryWindow(msgs49, maxWindow = 36, stepDrop = 12)

        // Turns 37..48 all start from message id 13 -> identical prefix for 12 turns!
        assertEquals(13L, win37.first().id)
        assertEquals(13L, win48.first().id)
        // Turn 49 advances cleanly by one batch of 12 -> starts from message id 25
        assertEquals(25L, win49.first().id)
    }
}
