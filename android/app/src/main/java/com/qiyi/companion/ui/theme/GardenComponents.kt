package com.qiyi.companion.ui.theme

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Outline
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * Classical inverted-corner plaque shape (海棠缺角匾额) matching the web user message bubble.
 */
class BegoniaPlaqueShape(private val notchSize: Dp = 8.dp) : Shape {
    override fun createOutline(size: Size, layoutDirection: LayoutDirection, density: Density): Outline {
        val n = with(density) { notchSize.toPx() }.coerceAtMost(minOf(size.width, size.height) / 3f)
        val w = size.width
        val h = size.height
        val path = Path().apply {
            moveTo(n, 0f)
            lineTo(w - n, 0f)
            quadraticTo(w - n, n, w, n)
            lineTo(w, h - n)
            quadraticTo(w - n, h - n, w - n, h)
            lineTo(n, h)
            quadraticTo(n, h - n, 0f, h - n)
            lineTo(0f, n)
            quadraticTo(n, n, n, 0f)
            close()
        }
        return Outline.Generic(path)
    }
}

/**
 * Rounded-square classical seal avatar (matching mobile web `[望]` / `[我]`).
 */
@Composable
fun GardenSealAvatar(
    label: String,
    size: Dp = 32.dp,
    isUser: Boolean = false
) {
    val garden = LocalGardenColors.current
    val text = label.trim().ifEmpty { if (isUser) "我" else "望" }.take(2)
    Box(
        modifier = Modifier
            .size(size)
            .clip(RoundedCornerShape(8.dp))
            .background(if (isUser) garden.bambooSoft else garden.paperTint)
            .border(1.dp, if (isUser) garden.lineStrong else garden.gold.copy(alpha = 0.7f), RoundedCornerShape(8.dp)),
        contentAlignment = Alignment.Center
    ) {
        Text(
            text = text,
            fontFamily = FontFamily.Serif,
            fontWeight = FontWeight.SemiBold,
            fontSize = if (size >= 44.dp) 18.sp else 13.sp,
            color = if (isUser) garden.bambooDark else garden.ink
        )
    }
}

/**
 * Classical framed Xuan-paper / Bamboo action button (matching mobile web `历史对话` / `新建对话`).
 */
@Composable
fun GardenWindowButton(
    text: String,
    onClick: () -> Unit,
    primary: Boolean = false,
    enabled: Boolean = true,
    modifier: Modifier = Modifier
) {
    val garden = LocalGardenColors.current
    val bg = if (primary) garden.bamboo else garden.paperCard
    val fg = if (primary) garden.paperCard else garden.ink
    val border = if (primary) garden.gold.copy(alpha = 0.75f) else garden.line

    Surface(
        modifier = modifier
            .height(34.dp)
            .clip(RoundedCornerShape(6.dp))
            .clickable(enabled = enabled, onClick = onClick),
        shape = RoundedCornerShape(6.dp),
        color = if (enabled) bg else bg.copy(alpha = 0.5f),
        border = BorderStroke(1.dp, border)
    ) {
        Box(
            modifier = Modifier
                .padding(2.dp)
                .border(
                    width = 0.6.dp,
                    color = if (primary) garden.gold.copy(alpha = 0.45f) else garden.lineSoft,
                    shape = RoundedCornerShape(4.dp)
                )
                .padding(horizontal = 10.dp),
            contentAlignment = Alignment.Center
        ) {
            Text(
                text = text,
                style = MaterialTheme.typography.labelMedium,
                color = fg,
                fontWeight = FontWeight.SemiBold
            )
        }
    }
}

/**
 * Vermilion cinnabar pill button (matching mobile web `发送` button).
 */
@Composable
fun CinnabarPillButton(
    text: String,
    onClick: () -> Unit,
    enabled: Boolean = true,
    icon: (@Composable () -> Unit)? = null,
    modifier: Modifier = Modifier
) {
    val garden = LocalGardenColors.current
    Surface(
        modifier = modifier
            .height(38.dp)
            .clip(RoundedCornerShape(999.dp))
            .clickable(enabled = enabled, onClick = onClick),
        shape = RoundedCornerShape(999.dp),
        color = if (enabled) garden.cinnabar else garden.cinnabar.copy(alpha = 0.42f),
        border = BorderStroke(1.2.dp, garden.cinnabarDark)
    ) {
        Row(
            modifier = Modifier
                .padding(PaddingValues(horizontal = 16.dp, vertical = 6.dp)),
            verticalAlignment = Alignment.CenterVertically
        ) {
            if (icon != null) {
                icon()
                Spacer(Modifier.width(6.dp))
            }
            Text(
                text = text,
                style = MaterialTheme.typography.labelMedium,
                color = garden.paperCard,
                fontWeight = FontWeight.SemiBold
            )
        }
    }
}

/**
 * Small cinnabar/gold seal badge (matching mobile web `当前对话` / `群聊`).
 */
@Composable
fun GardenTagPill(
    text: String,
    accent: Color? = null,
    background: Color? = null
) {
    val garden = LocalGardenColors.current
    val fg = accent ?: garden.cinnabar
    val bg = background ?: garden.cinnabarSoft
    Surface(
        shape = RoundedCornerShape(4.dp),
        color = bg,
        border = BorderStroke(0.8.dp, fg.copy(alpha = 0.55f))
    ) {
        Text(
            text = text,
            style = MaterialTheme.typography.labelSmall,
            color = fg,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.padding(horizontal = 7.dp, vertical = 2.dp)
        )
    }
}
