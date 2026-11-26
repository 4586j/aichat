package com.qiyi.companion

import com.qiyi.companion.ui.theme.GardenMarkdownParser
import com.qiyi.companion.ui.theme.MarkdownBlock
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class GardenMarkdownParserTest {

    @Test
    fun parsesHeadingsCodeBlocksBulletsAndAttachmentPills() {
        val sample = """
            ## 架构要点
            - 纯离线存储
            > 凭据绝不入库

            ```kotlin
            val x = 42
            ```

            <user_attachment name="notes.md">
            hidden raw body
            </user_attachment>
        """.trimIndent()

        val blocks = GardenMarkdownParser.parse(sample)
        assertTrue(blocks[0] is MarkdownBlock.Heading)
        assertEquals("架构要点", (blocks[0] as MarkdownBlock.Heading).text)
        assertTrue(blocks.any { it is MarkdownBlock.BulletItem && it.text == "纯离线存储" })
        assertTrue(blocks.any { it is MarkdownBlock.Quote && it.text == "凭据绝不入库" })
        val code = blocks.filterIsInstance<MarkdownBlock.CodeBlock>().first()
        assertEquals("kotlin", code.language)
        assertEquals("val x = 42", code.code)
        val att = blocks.filterIsInstance<MarkdownBlock.AttachmentPill>().first()
        assertEquals("notes.md", att.name)
    }
}
