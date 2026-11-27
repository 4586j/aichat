package com.qiyi.companion.ui.theme

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Outline
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.qiyi.companion.data.media.AvatarImageHelper

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
 * Rounded-square classical seal avatar (matching mobile web `[望]` / `[我]`),
 * supporting uploaded local images, PC Base64 image avatars, emojis, and serif text.
 */
@Composable
fun GardenSealAvatar(
    label: String,
    size: Dp = 32.dp,
    isUser: Boolean = false
) {
    val garden = LocalGardenColors.current
    val imageBitmap = remember(label) {
        if (AvatarImageHelper.isImageAvatar(label)) AvatarImageHelper.decodeAvatarBitmap(label) else null
    }
    val text = if (AvatarImageHelper.isImageAvatar(label)) {
        if (isUser) "我" else "望"
    } else {
        label.trim().ifEmpty { if (isUser) "我" else "望" }.take(2)
    }

    val avatarShape = RoundedCornerShape(size * 0.34f)
    Box(
        modifier = Modifier
            .size(size)
            .clip(avatarShape)
            .background(if (isUser) garden.bambooSoft else garden.paperTint)
            .border(0.8.dp, if (isUser) garden.lineStrong.copy(alpha = 0.65f) else garden.gold.copy(alpha = 0.5f), avatarShape),
        contentAlignment = Alignment.Center
    ) {
        if (imageBitmap != null) {
            Image(
                bitmap = imageBitmap,
                contentDescription = "头像",
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize()
            )
        } else {
            Text(
                text = text,
                fontFamily = FontFamily.Serif,
                fontWeight = FontWeight.SemiBold,
                fontSize = if (size >= 44.dp) 18.sp else 13.sp,
                color = if (isUser) garden.bambooDark else garden.ink
            )
        }
    }
}

/**
 * Smooth jade-like Classical Garden pill button with satin gradient and delicate border.
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
    val topColor = if (primary) garden.bamboo else garden.paperCard
    val bottomColor = if (primary) garden.bambooDark else garden.paper
    val fg = if (primary) garden.paperCard else garden.ink
    val outerBorder = if (primary) garden.gold.copy(alpha = 0.55f) else garden.line.copy(alpha = 0.85f)
    val alpha = if (enabled) 1f else 0.48f
    val pillShape = RoundedCornerShape(999.dp)

    Surface(
        modifier = modifier
            .height(36.dp)
            .clip(pillShape)
            .clickable(enabled = enabled, onClick = onClick),
        shape = pillShape,
        color = Color.Transparent,
        shadowElevation = if (enabled && primary) 2.dp else 0.dp,
        border = BorderStroke(0.9.dp, outerBorder.copy(alpha = outerBorder.alpha * alpha))
    ) {
        Box(
            modifier = Modifier
                .fillMaxHeight()
                .background(
                    brush = Brush.verticalGradient(
                        colors = listOf(topColor.copy(alpha = alpha), bottomColor.copy(alpha = alpha))
                    )
                )
                .padding(horizontal = 15.dp),
            contentAlignment = Alignment.Center
        ) {
            Text(
                text = text,
                fontFamily = FontFamily.Serif,
                fontSize = 12.5.sp,
                letterSpacing = 0.5.sp,
                color = fg.copy(alpha = alpha),
                fontWeight = FontWeight.SemiBold,
                maxLines = 1
            )
        }
    }
}

/**
 * Carved vermilion cinnabar pill button (matching mobile web `发送` button)
 * with vertical gradient, inner mud-gold highlight ring, and soft drop shadow.
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
    val alpha = if (enabled) 1f else 0.45f
    Surface(
        modifier = modifier
            .height(38.dp)
            .clip(RoundedCornerShape(999.dp))
            .clickable(enabled = enabled, onClick = onClick),
        shape = RoundedCornerShape(999.dp),
        color = Color.Transparent,
        shadowElevation = if (enabled) 3.dp else 0.dp,
        border = BorderStroke(1.2.dp, garden.cinnabarDark.copy(alpha = alpha))
    ) {
        Box(
            modifier = Modifier
                .background(
                    brush = Brush.verticalGradient(
                        colors = listOf(
                            garden.cinnabar.copy(alpha = alpha),
                            garden.cinnabarDark.copy(alpha = alpha)
                        )
                    )
                )
                .padding(2.dp)
                .border(0.7.dp, garden.gold.copy(alpha = 0.5f * alpha), RoundedCornerShape(999.dp)),
            contentAlignment = Alignment.Center
        ) {
            Row(
                modifier = Modifier.padding(PaddingValues(horizontal = 15.dp, vertical = 4.dp)),
                verticalAlignment = Alignment.CenterVertically
            ) {
                if (icon != null) {
                    icon()
                    Spacer(Modifier.width(6.dp))
                }
                Text(
                    text = text,
                    fontFamily = FontFamily.Serif,
                    fontSize = 13.sp,
                    letterSpacing = 0.8.sp,
                    color = garden.paperCard.copy(alpha = alpha),
                    fontWeight = FontWeight.SemiBold
                )
            }
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
        shape = RoundedCornerShape(999.dp),
        color = bg,
        border = BorderStroke(0.6.dp, fg.copy(alpha = 0.38f))
    ) {
        Text(
            text = text,
            style = MaterialTheme.typography.labelSmall,
            color = fg,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.padding(horizontal = 9.dp, vertical = 2.5.dp)
        )
    }
}
