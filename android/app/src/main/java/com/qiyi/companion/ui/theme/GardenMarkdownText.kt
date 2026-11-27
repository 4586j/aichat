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
        verticalArrangement = Arrangement.spacedBy(9.dp)
    ) {
        blocks.forEach { block ->
            when (block) {
                is MarkdownBlock.Heading -> {
                    Text(
                        text = GardenMarkdownParser.parseInline(block.text, inlineCodeBg, inlineCodeFg),
                        fontFamily = FontFamily.Serif,
                        fontWeight = FontWeight.Bold,
                        fontSize = when (block.level) {
                            1 -> 19.sp
                            2 -> 17.sp
                            else -> 15.5.sp
                        },
                        lineHeight = when (block.level) {
                            1 -> 27.sp
                            2 -> 24.sp
                            else -> 22.sp
                        },
                        color = textColor,
                        modifier = Modifier.padding(top = 4.dp)
                    )
                }

                is MarkdownBlock.Paragraph -> {
                    Text(
                        text = GardenMarkdownParser.parseInline(block.text, inlineCodeBg, inlineCodeFg),
                        style = MaterialTheme.typography.bodyMedium.copy(
                            fontSize = 15.sp,
                            lineHeight = 24.sp
                        ),
                        color = textColor
                    )
                }

                is MarkdownBlock.Quote -> {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(IntrinsicSize.Min)
                            .padding(vertical = 2.dp)
                    ) {
                        Box(
                            modifier = Modifier
                                .width(3.dp)
                                .fillMaxHeight()
                                .background(
                                    (if (isOnDarkBubble) garden.gold else garden.bamboo).copy(alpha = 0.7f),
                                    RoundedCornerShape(999.dp)
                                )
                        )
                        Spacer(Modifier.width(10.dp))
                        Text(
                            text = GardenMarkdownParser.parseInline(block.text, inlineCodeBg, inlineCodeFg),
                            style = MaterialTheme.typography.bodyMedium.copy(
                                fontSize = 14.sp,
                                lineHeight = 22.sp
                            ),
                            color = textColor.copy(alpha = 0.82f)
                        )
                    }
                }

                is MarkdownBlock.BulletItem -> {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(start = 4.dp)
                    ) {
                        Text(
                            text = if (block.bullet in listOf("-", "*", "•")) "•" else block.bullet,
                            style = MaterialTheme.typography.bodyMedium.copy(
                                fontSize = 15.sp,
                                lineHeight = 24.sp
                            ),
                            fontWeight = FontWeight.SemiBold,
                            color = if (isOnDarkBubble) garden.gold else garden.bamboo
                        )
                        Spacer(Modifier.width(8.dp))
                        Text(
                            text = GardenMarkdownParser.parseInline(block.text, inlineCodeBg, inlineCodeFg),
                            style = MaterialTheme.typography.bodyMedium.copy(
                                fontSize = 15.sp,
                                lineHeight = 24.sp
                            ),
                            color = textColor,
                            modifier = Modifier.weight(1f)
                        )
                    }
                }

                is MarkdownBlock.CodeBlock -> {
                    Surface(
                        modifier = Modifier.fillMaxWidth(),
                        shape = IosSquircleShape(16.dp),
                        color = if (isOnDarkBubble) garden.ink.copy(alpha = 0.35f) else garden.paperCard,
                        border = BorderStroke(0.75.dp, garden.lineSoft)
                    ) {
                        Column {
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .background(if (isOnDarkBubble) garden.ink.copy(alpha = 0.25f) else garden.paperDeep.copy(alpha = 0.75f))
                                    .padding(horizontal = 12.dp, vertical = 6.dp),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text(
                                    text = block.language.ifBlank { "code" },
                                    fontFamily = FontFamily.Monospace,
                                    fontSize = 11.5.sp,
                                    fontWeight = FontWeight.Medium,
                                    color = if (isOnDarkBubble) garden.gold else garden.muted
                                )
                                if (onCopyCode != null) {
                                    Row(
                                        modifier = Modifier
                                            .clickable { onCopyCode(block.code) }
                                            .padding(horizontal = 6.dp, vertical = 2.dp),
                                        verticalAlignment = Alignment.CenterVertically
                                    ) {
                                        Icon(
                                            imageVector = Icons.Default.ContentCopy,
                                            contentDescription = "复制代码",
                                            modifier = Modifier.size(13.dp),
                                            tint = if (isOnDarkBubble) garden.paperCard else garden.muted
                                        )
                                        Spacer(Modifier.width(4.dp))
                                        Text(
                                            text = "复制代码",
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
                                lineHeight = 19.sp,
                                color = textColor,
                                modifier = Modifier
                                    .horizontalScroll(rememberScrollState())
                                    .padding(horizontal = 12.dp, vertical = 10.dp)
                            )
                        }
                    }
                }

                is MarkdownBlock.AttachmentPill -> {
                    Surface(
                        shape = RoundedCornerShape(999.dp),
                        color = if (isOnDarkBubble) garden.bamboo else garden.bambooSoft,
                        border = BorderStroke(0.6.dp, garden.gold.copy(alpha = 0.45f))
                    ) {
                        Row(
                            modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Icon(
                                imageVector = Icons.Default.AttachFile,
                                contentDescription = null,
                                modifier = Modifier.size(13.dp),
                                tint = if (isOnDarkBubble) garden.gold else garden.bamboo
                            )
                            Spacer(Modifier.width(5.dp))
                            Text(
                                text = "附件：${block.name}",
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
