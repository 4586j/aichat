package com.qiyi.companion.ui.theme

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AttachFile
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

sealed interface MarkdownBlock {
    data class Heading(val level: Int, val text: String) : MarkdownBlock
    data class Paragraph(val text: String) : MarkdownBlock
    data class Quote(val text: String) : MarkdownBlock
    data class BulletItem(val bullet: String, val text: String) : MarkdownBlock
    data class CodeBlock(val language: String, val code: String) : MarkdownBlock
    data class AttachmentPill(val name: String) : MarkdownBlock
}

/**
 * Pure-Kotlin lightweight Markdown + `<user_attachment>` block parser.
 */
object GardenMarkdownParser {
    private val ATTACHMENT_REGEX = Regex(
        """<user_attachment\s+name="([^"]*)">[\s\S]*?</user_attachment>""",
        setOf(RegexOption.MULTILINE)
    )
    private val HEADING_REGEX = Regex("""^(#{1,3})\s+(.+)$""")
    private val BULLET_REGEX = Regex("""^(\s*[-*•]|\s*\d+\.)\s+(.+)$""")

    fun parse(raw: String): List<MarkdownBlock> {
        val attachments = mutableListOf<String>()
        val cleaned = ATTACHMENT_REGEX.replace(raw) { match ->
            attachments.add(match.groupValues[1].ifBlank { "附件" })
            ""
        }.trim()

        val blocks = mutableListOf<MarkdownBlock>()
        val lines = cleaned.replace("\r\n", "\n").split("\n")
        var i = 0
        val paragraphBuf = StringBuilder()

        fun flushParagraph() {
            val text = paragraphBuf.toString().trim()
            if (text.isNotEmpty()) blocks.add(MarkdownBlock.Paragraph(text))
            paragraphBuf.clear()
        }

        while (i < lines.size) {
            val line = lines[i]
            val trimmed = line.trim()

            if (trimmed.startsWith("```")) {
                flushParagraph()
                val lang = trimmed.removePrefix("```").trim()
                val codeBuf = StringBuilder()
                i++
                while (i < lines.size && !lines[i].trim().startsWith("```")) {
                    if (codeBuf.isNotEmpty()) codeBuf.append('\n')
                    codeBuf.append(lines[i])
                    i++
                }
                blocks.add(MarkdownBlock.CodeBlock(lang, codeBuf.toString()))
                i++
                continue
            }

            if (trimmed.isEmpty()) {
                flushParagraph()
                i++
                continue
            }

            val headingMatch = HEADING_REGEX.matchEntire(trimmed)
            if (headingMatch != null) {
                flushParagraph()
                blocks.add(MarkdownBlock.Heading(headingMatch.groupValues[1].length, headingMatch.groupValues[2].trim()))
                i++
                continue
            }

            if (trimmed.startsWith("> ")) {
                flushParagraph()
                blocks.add(MarkdownBlock.Quote(trimmed.removePrefix("> ").trim()))
                i++
                continue
            }

            val bulletMatch = BULLET_REGEX.matchEntire(line)
            if (bulletMatch != null) {
                flushParagraph()
                blocks.add(MarkdownBlock.BulletItem(bulletMatch.groupValues[1].trim(), bulletMatch.groupValues[2].trim()))
                i++
                continue
            }

            if (paragraphBuf.isNotEmpty()) paragraphBuf.append('\n')
            paragraphBuf.append(line)
            i++
        }
        flushParagraph()

        attachments.forEach { name ->
            blocks.add(MarkdownBlock.AttachmentPill(name))
        }
        return blocks
    }

    fun parseInline(
        text: String,
        codeBg: Color,
        codeFg: Color
    ): AnnotatedString = buildAnnotatedString {
        var idx = 0
        while (idx < text.length) {
            when {
                text.startsWith("**", idx) -> {
                    val end = text.indexOf("**", idx + 2)
                    if (end > idx + 2) {
                        withStyle(SpanStyle(fontWeight = FontWeight.Bold)) {
                            append(text.substring(idx + 2, end))
                        }
                        idx = end + 2
                    } else {
                        append("**")
                        idx += 2
                    }
                }
                text[idx] == '`' -> {
                    val end = text.indexOf('`', idx + 1)
                    if (end > idx + 1) {
                        withStyle(
                            SpanStyle(
                                fontFamily = FontFamily.Monospace,
                                background = codeBg,
                                color = codeFg,
                                fontSize = 13.sp
                            )
                        ) {
                            append(" ${text.substring(idx + 1, end)} ")
                        }
                        idx = end + 1
                    } else {
                        append('`')
                        idx++
                    }
                }
                text[idx] == '*' && !text.startsWith("**", idx) -> {
                    val end = text.indexOf('*', idx + 1)
                    if (end > idx + 1) {
                        withStyle(SpanStyle(fontStyle = FontStyle.Italic)) {
                            append(text.substring(idx + 1, end))
                        }
                        idx = end + 1
                    } else {
                        append('*')
                        idx++
                    }
                }
                else -> {
                    append(text[idx])
                    idx++
                }
            }
        }
    }
}

@Composable
fun GardenMarkdownText(
    markdown: String,
    textColor: Color,
    isOnDarkBubble: Boolean = false,
    onCopyCode: ((String) -> Unit)? = null,
    modifier: Modifier = Modifier
) {
    val garden = LocalGardenColors.current
    val blocks = remember(markdown) { GardenMarkdownParser.parse(markdown) }
    val inlineCodeBg = if (isOnDarkBubble) garden.bamboo else garden.paperDeep
    val inlineCodeFg = if (isOnDarkBubble) garden.paperCard else garden.bambooDark

    Column(
        modifier = modifier,
        verticalArrangement = Arrangement.spacedBy(6.dp)
    ) {
        blocks.forEach { block ->
            when (block) {
                is MarkdownBlock.Heading -> {
                    Text(
                        text = GardenMarkdownParser.parseInline(block.text, inlineCodeBg, inlineCodeFg),
                        fontFamily = FontFamily.Serif,
                        fontWeight = FontWeight.Bold,
                        fontSize = when (block.level) {
                            1 -> 18.sp
                            2 -> 16.sp
                            else -> 15.sp
                        },
                        color = textColor
                    )
                }

                is MarkdownBlock.Paragraph -> {
                    Text(
                        text = GardenMarkdownParser.parseInline(block.text, inlineCodeBg, inlineCodeFg),
                        style = MaterialTheme.typography.bodyMedium,
                        color = textColor
                    )
                }

                is MarkdownBlock.Quote -> {
                    Row(modifier = Modifier.height(IntrinsicSize.Min)) {
                        Box(
                            modifier = Modifier
                                .width(2.5.dp)
                                .fillMaxHeight()
                                .background(if (isOnDarkBubble) garden.gold else garden.bamboo)
                        )
                        Spacer(Modifier.width(8.dp))
                        Text(
                            text = GardenMarkdownParser.parseInline(block.text, inlineCodeBg, inlineCodeFg),
                            style = MaterialTheme.typography.bodySmall,
                            color = textColor.copy(alpha = 0.85f)
                        )
                    }
                }

                is MarkdownBlock.BulletItem -> {
                    Row(modifier = Modifier.fillMaxWidth()) {
                        Text(
                            text = if (block.bullet in listOf("-", "*", "•")) "•" else block.bullet,
                            style = MaterialTheme.typography.bodyMedium,
                            fontWeight = FontWeight.SemiBold,
                            color = if (isOnDarkBubble) garden.gold else garden.bamboo
                        )
                        Spacer(Modifier.width(6.dp))
                        Text(
                            text = GardenMarkdownParser.parseInline(block.text, inlineCodeBg, inlineCodeFg),
                            style = MaterialTheme.typography.bodyMedium,
                            color = textColor,
                            modifier = Modifier.weight(1f)
                        )
                    }
                }

                is MarkdownBlock.CodeBlock -> {
                    Surface(
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(6.dp),
                        color = if (isOnDarkBubble) garden.ink.copy(alpha = 0.35f) else garden.reasoningBg,
                        border = BorderStroke(0.8.dp, garden.line)
                    ) {
                        Column {
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .background(if (isOnDarkBubble) garden.ink.copy(alpha = 0.25f) else garden.paperDeep)
                                    .padding(horizontal = 10.dp, vertical = 4.dp),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text(
                                    text = block.language.ifBlank { "code" },
                                    fontFamily = FontFamily.Monospace,
                                    fontSize = 11.sp,
                                    color = if (isOnDarkBubble) garden.gold else garden.muted
                                )
                                if (onCopyCode != null) {
                                    Row(
                                        modifier = Modifier
                                            .clickable { onCopyCode(block.code) }
                                            .padding(horizontal = 4.dp, vertical = 2.dp),
                                        verticalAlignment = Alignment.CenterVertically
                                    ) {
                                        Icon(
                                            imageVector = Icons.Default.ContentCopy,
                                            contentDescription = "复制代码",
                                            modifier = Modifier.size(12.dp),
                                            tint = if (isOnDarkBubble) garden.paperCard else garden.muted
                                        )
                                        Spacer(Modifier.width(3.dp))
                                        Text(
                                            text = "复制",
                                            style = MaterialTheme.typography.labelSmall,
                                            color = if (isOnDarkBubble) garden.paperCard else garden.muted
                                        )
                                    }
                                }
                            }
                            Text(
                                text = block.code,
                                fontFamily = FontFamily.Monospace,
                                fontSize = 12.5.sp,
                                lineHeight = 18.sp,
                                color = textColor,
                                modifier = Modifier
                                    .horizontalScroll(rememberScrollState())
                                    .padding(horizontal = 10.dp, vertical = 8.dp)
                            )
                        }
                    }
                }

                is MarkdownBlock.AttachmentPill -> {
                    Surface(
                        shape = RoundedCornerShape(6.dp),
                        color = if (isOnDarkBubble) garden.bamboo else garden.bambooSoft,
                        border = BorderStroke(0.7.dp, garden.gold.copy(alpha = 0.6f))
                    ) {
                        Row(
                            modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Icon(
                                imageVector = Icons.Default.AttachFile,
                                contentDescription = null,
                                modifier = Modifier.size(13.dp),
                                tint = if (isOnDarkBubble) garden.gold else garden.bamboo
                            )
                            Spacer(Modifier.width(4.dp))
                            Text(
                                text = "已附文件：${block.name}",
                                style = MaterialTheme.typography.labelSmall,
                                color = textColor
                            )
                        }
                    }
                }
            }
        }
    }
}
