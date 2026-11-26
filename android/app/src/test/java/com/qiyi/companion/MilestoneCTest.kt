package com.qiyi.companion

import com.qiyi.companion.data.db.KnowledgeChunkEntity
import com.qiyi.companion.data.db.MemoryEntity
import com.qiyi.companion.data.db.MemoryTripleEntity
import com.qiyi.companion.data.knowledge.KnowledgeEngine
import com.qiyi.companion.data.knowledge.WebClipper
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class MilestoneCTest {

    @Test
    fun webClipperExtractsTitleAndStripsNoiseScripts() {
        val html = """
            <html><head><title>古典园林造景指南</title><style>body{color:red}</style></head>
            <body>
              <nav>首页 | 登录</nav>
              <article>
                <h1>借景与框景</h1>
                <p>苏州园林讲究移步换景，窗棂本身即是画框。</p>
                <script>alert('xss')</script>
              </article>
              <footer>Copyright 2026</footer>
            </body></html>
        """.trimIndent()

        val clipped = WebClipper.extractReadableContent("https://example.com/garden", html)
        assertEquals("古典园林造景指南", clipped.title)
        assertTrue(clipped.content.contains("苏州园林讲究移步换景"))
        assertTrue(!clipped.content.contains("alert('xss')"))
        assertTrue(!clipped.content.contains("Copyright 2026"))
    }

    @Test
    fun hybridRrfSearchCombinesVectorSimilarityWithLexicalRank() {
        val vecA = KnowledgeEngine.encodeEmbedding(listOf(1.0, 0.0, 0.0))
        val vecB = KnowledgeEngine.encodeEmbedding(listOf(0.0, 1.0, 0.0))
        val chunks = listOf(
            KnowledgeChunkEntity(id = 1, documentId = "d1", documentTitle = "语义匹配", chunkIndex = 0, content = "完全不同的词句", embeddingJson = vecA),
            KnowledgeChunkEntity(id = 2, documentId = "d2", documentTitle = "无关文档", chunkIndex = 0, content = "无关内容", embeddingJson = vecB)
        )

        val hits = KnowledgeEngine.hybridSearchChunks("查询词", listOf(0.99, 0.01, 0.0), chunks, topK = 2)
        assertEquals(1, hits.size)
        assertEquals("语义匹配", hits.first().chunk.documentTitle)

        val encoded = KnowledgeEngine.encodeCitations(hits)
        val decoded = KnowledgeEngine.decodeCitations(encoded)
        assertEquals(1, decoded.size)
        assertEquals("语义匹配", decoded.first().documentTitle)
    }

    @Test
    fun pinnedMemoriesAndGraphTriplesAreAlwaysIncluded() {
        val memories = listOf(
            MemoryEntity(id = "m1", category = "fact", content = "我是Android开发者", importance = 2, isPinned = true),
            MemoryEntity(id = "m2", category = "event", content = "今天吃了面条", importance = 3, isPinned = false)
        )
        val recalled = KnowledgeEngine.recallMemories("讲个笑话", memories, topK = 4)
        assertTrue(recalled.any { it.memory.id == "m1" })

        val block = KnowledgeEngine.buildReferenceContextBlock(
            knowledgeHits = emptyList(),
            memoryHits = recalled,
            triples = listOf(MemoryTripleEntity(id = "t1", subject = "我", predicate = "喜欢", objectValue = "龙井茶"))
        )
        assertTrue(block.contains("[固定]"))
        assertTrue(block.contains("我 — 喜欢 → 龙井茶"))
    }
}
