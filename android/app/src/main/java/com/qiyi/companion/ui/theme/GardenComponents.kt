package com.qiyi.companion.ui.theme

import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Outline
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.qiyi.companion.data.media.AvatarImageHelper

/**
 * Authentic iOS-style continuous curvature squircle (G2 smooth corner transitions).
 * Eliminates the abrupt line-to-arc kink of standard RoundedCornerShape.
 */
class IosSquircleShape(
    private val cornerRadius: Dp = 22.dp,
    private val smoothing: Float = 0.6f
) : Shape {
    override fun createOutline(size: Size, layoutDirection: LayoutDirection, density: Density): Outline {
        val w = size.width
        val h = size.height
        if (w <= 0f || h <= 0f) return Outline.Generic(Path())

        val r = with(density) { cornerRadius.toPx() }.coerceAtMost(minOf(w, h) / 2f)
        // Extended tangent length for smooth iOS continuous curvature
        val ext = (r * (1f + 0.52f * smoothing)).coerceAtMost(minOf(w, h) / 2f)
        val c1 = ext * 0.42f
        val c2 = r * 0.14f

        val path = Path().apply {
            // Start top edge after top-left continuous curve
            moveTo(ext, 0f)
            // Top edge -> Top-right continuous corner
            lineTo(w - ext, 0f)
            cubicTo(w - c1, 0f, w, c2, w, ext)
            // Right edge -> Bottom-right continuous corner
            lineTo(w, h - ext)
            cubicTo(w, h - c1, w - c2, h, w - ext, h)
            // Bottom edge -> Bottom-left continuous corner
            lineTo(ext, h)
            cubicTo(c1, h, 0f, h - c2, 0f, h - ext)
            // Left edge -> Top-left continuous corner
            lineTo(0f, ext)
            cubicTo(0f, c1, c2, 0f, ext, 0f)
            close()
        }
        return Outline.Generic(path)
    }
}

/**
 * Classical inverted-corner plaque shape preserved for optional compatibility.
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
 * iOS 26-inspired Liquid Glass container:
 * - Translucent multi-stop glass fill adapted to Spring / Autumn / Night themes
 * - Specular top-edge refraction highlight & subtle bottom caustic rim
 * - Soft ambient glass elevation
 */
@Composable
fun LiquidGlassSurface(
    modifier: Modifier = Modifier,
    shape: Shape = RoundedCornerShape(999.dp),
    tinted: Boolean = false,
    accentColor: Color? = null,
    elevation: Dp = 3.dp,
    onClick: (() -> Unit)? = null,
    content: @Composable () -> Unit
) {
    val garden = LocalGardenColors.current
    val isDark = garden.paper.luminance() < 0.35f

    val topFill = when {
        tinted -> (accentColor ?: garden.bamboo).copy(alpha = if (isDark) 0.88f else 0.90f)
        isDark -> garden.paperCard.copy(alpha = 0.72f)
        else -> Color.White.copy(alpha = 0.76f)
    }
    val midFill = when {
        tinted -> (accentColor ?: garden.bambooDark).copy(alpha = if (isDark) 0.76f else 0.82f)
        isDark -> garden.paper.copy(alpha = 0.52f)
        else -> garden.paperCard.copy(alpha = 0.56f)
    }
    val bottomFill = when {
        tinted -> (accentColor ?: garden.bamboo).copy(alpha = if (isDark) 0.84f else 0.88f)
        isDark -> garden.paperCard.copy(alpha = 0.64f)
        else -> garden.paperDeep.copy(alpha = 0.44f)
    }

    val specularTop = when {
        tinted -> Color.White.copy(alpha = if (isDark) 0.38f else 0.52f)
        isDark -> Color(0xFFDCEEE8).copy(alpha = 0.30f)
        else -> Color.White.copy(alpha = 0.95f)
    }
    val specularBottom = when {
        tinted -> garden.gold.copy(alpha = 0.42f)
        isDark -> garden.gold.copy(alpha = 0.18f)
        else -> garden.line.copy(alpha = 0.48f)
    }

    val clickableMod = if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier

    Box(
        modifier = modifier
            .shadow(
                elevation = elevation,
                shape = shape,
                ambientColor = if (isDark) Color.Black.copy(alpha = 0.45f) else garden.ink.copy(alpha = 0.14f),
                spotColor = if (isDark) Color.Black.copy(alpha = 0.55f) else garden.ink.copy(alpha = 0.18f)
            )
            .clip(shape)
            .background(
                brush = Brush.verticalGradient(
                    0.0f to topFill,
                    0.52f to midFill,
                    1.0f to bottomFill
                )
            )
            .drawWithContent {
                drawContent()
                // Glossy top-half liquid meniscus reflection
                drawRect(
                    brush = Brush.verticalGradient(
                        0.0f to Color.White.copy(alpha = if (tinted) 0.22f else if (isDark) 0.08f else 0.34f),
                        0.45f to Color.Transparent
                    ),
                    size = Size(size.width, size.height * 0.55f)
                )
            }
            .border(
                width = 1.dp,
                brush = Brush.linearGradient(
                    colors = listOf(specularTop, Color.Transparent, specularBottom),
                    start = Offset(0f, 0f),
                    end = Offset(Float.POSITIVE_INFINITY, Float.POSITIVE_INFINITY)
                ),
                shape = shape
            )
            .then(clickableMod),
        contentAlignment = Alignment.Center
    ) {
        content()
    }
}

/**
 * iOS 26 Liquid Glass Segmented Selector with spring-animated floating glass lens thumb.
 */
@Composable
fun LiquidGlassSegmentedControl(
    labels: List<String>,
    selectedIndex: Int,
    onSelect: (Int) -> Unit,
    modifier: Modifier = Modifier,
    icons: List<ImageVector?>? = null,
    height: Dp = 38.dp,
    fontSize: TextUnit = 12.5.sp
) {
    if (labels.isEmpty()) return
    val garden = LocalGardenColors.current
    val isDark = garden.paper.luminance() < 0.35f
    val pillShape = RoundedCornerShape(999.dp)

    val animatedIndex by animateFloatAsState(
        targetValue = selectedIndex.coerceIn(0, labels.lastIndex).toFloat(),
        animationSpec = spring(
            dampingRatio = 0.74f,
            stiffness = Spring.StiffnessMediumLow
        ),
        label = "liquid_glass_thumb"
    )

    val trackTop = if (isDark) garden.paperCard.copy(alpha = 0.66f) else Color.White.copy(alpha = 0.56f)
    val trackBottom = if (isDark) garden.paper.copy(alpha = 0.72f) else garden.paperDeep.copy(alpha = 0.62f)
    val trackBorderTop = if (isDark) Color(0xFFD6ECE6).copy(alpha = 0.22f) else Color.White.copy(alpha = 0.92f)
    val trackBorderBottom = if (isDark) Color.Black.copy(alpha = 0.35f) else garden.line.copy(alpha = 0.45f)

    Box(
        modifier = modifier
            .height(height)
            .shadow(
                elevation = 2.dp,
                shape = pillShape,
                ambientColor = garden.ink.copy(alpha = if (isDark) 0.4f else 0.10f),
                spotColor = garden.ink.copy(alpha = if (isDark) 0.45f else 0.14f)
            )
            .clip(pillShape)
            .background(
                brush = Brush.verticalGradient(listOf(trackTop, trackBottom))
            )
            .border(
                width = 0.9.dp,
                brush = Brush.linearGradient(
                    colors = listOf(trackBorderTop, Color.Transparent, trackBorderBottom),
                    start = Offset(0f, 0f),
                    end = Offset(Float.POSITIVE_INFINITY, Float.POSITIVE_INFINITY)
                ),
                shape = pillShape
            )
            .padding(3.dp)
    ) {
        BoxWithConstraints(modifier = Modifier.fillMaxSize()) {
            val segmentWidth = maxWidth / labels.size
            val thumbOffsetX = segmentWidth * animatedIndex

            val thumbTop = if (isDark) Color(0xFF2E6E58).copy(alpha = 0.88f) else garden.bamboo.copy(alpha = 0.86f)
            val thumbMid = if (isDark) Color(0xFF245947).copy(alpha = 0.94f) else garden.bamboo.copy(alpha = 0.94f)
            val thumbBot = if (isDark) Color(0xFF1A4235).copy(alpha = 0.94f) else garden.bambooDark.copy(alpha = 0.92f)

            // Sliding Liquid Glass Lens Thumb
            Box(
                modifier = Modifier
                    .offset(x = thumbOffsetX)
                    .width(segmentWidth)
                    .fillMaxHeight()
                    .shadow(
                        elevation = 4.dp,
                        shape = pillShape,
                        ambientColor = garden.bambooDark.copy(alpha = 0.25f),
                        spotColor = garden.bambooDark.copy(alpha = 0.35f)
                    )
                    .clip(pillShape)
                    .background(
                        brush = Brush.verticalGradient(
                            0.0f to thumbTop,
                            0.48f to thumbMid,
                            1.0f to thumbBot
                        )
                    )
                    .drawWithContent {
                        drawContent()
                        // Specular top curved liquid reflection inside the lens
                        drawRoundRect(
                            brush = Brush.verticalGradient(
                                0.0f to Color.White.copy(alpha = if (isDark) 0.26f else 0.36f),
                                0.6f to Color.Transparent
                            ),
                            topLeft = Offset(2.dp.toPx(), 1.dp.toPx()),
                            size = Size(
                                (size.width - 4.dp.toPx()).coerceAtLeast(0f),
                                size.height * 0.52f
                            ),
                            cornerRadius = CornerRadius(size.height / 2f, size.height / 2f)
                        )
                        // Subtle bottom luminous refraction line
                        drawRoundRect(
                            brush = Brush.horizontalGradient(
                                listOf(
                                    Color.Transparent,
                                    garden.gold.copy(alpha = 0.42f),
                                    Color.Transparent
                                )
                            ),
                            topLeft = Offset(size.width * 0.18f, size.height - 2.dp.toPx()),
                            size = Size(size.width * 0.64f, 1.2.dp.toPx()),
                            cornerRadius = CornerRadius(2f, 2f)
                        )
                    }
                    .border(
                        width = 0.9.dp,
                        brush = Brush.linearGradient(
                            colors = listOf(
                                Color.White.copy(alpha = if (isDark) 0.42f else 0.62f),
                                Color.White.copy(alpha = 0.10f),
                                garden.gold.copy(alpha = 0.45f)
                            ),
                            start = Offset(0f, 0f),
                            end = Offset(Float.POSITIVE_INFINITY, Float.POSITIVE_INFINITY)
                        ),
                        shape = pillShape
                    )
            )

            // Foreground Labels Row
            Row(
                modifier = Modifier.fillMaxSize(),
                verticalAlignment = Alignment.CenterVertically
            ) {
                labels.forEachIndexed { index, label ->
                    val selected = index == selectedIndex
                    val icon = icons?.getOrNull(index)
                    val interaction = remember { MutableInteractionSource() }
                    val activeFg = if (isDark) Color(0xFFF3F8F5) else garden.paperCard
                    Row(
                        modifier = Modifier
                            .weight(1f)
                            .fillMaxHeight()
                            .clip(pillShape)
                            .clickable(
                                interactionSource = interaction,
                                indication = null,
                                onClick = { onSelect(index) }
                            ),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.Center
                    ) {
                        if (icon != null) {
                            Icon(
                                imageVector = icon,
                                contentDescription = null,
                                tint = if (selected) activeFg else garden.muted,
                                modifier = Modifier.size(15.dp)
                            )
                            Spacer(Modifier.width(4.dp))
                        }
                        Text(
                            text = label,
                            fontFamily = FontFamily.Serif,
                            fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium,
                            fontSize = fontSize,
                            color = if (selected) activeFg else garden.muted,
                            maxLines = 1
                        )
                    }
                }
            }
        }
    }
}

/**
 * iOS continuous-squircle avatar supporting local uploaded images, emojis, and serif initials.
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

    val avatarShape = remember(size) { IosSquircleShape(cornerRadius = size * 0.28f) }
    Box(
        modifier = Modifier
            .size(size)
            .clip(avatarShape)
            .background(if (isUser) garden.bambooSoft else garden.paperTint)
            .border(
                width = 0.8.dp,
                color = if (isUser) garden.lineStrong.copy(alpha = 0.55f) else garden.gold.copy(alpha = 0.45f),
                shape = avatarShape
            ),
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
            val isDark = garden.paper.luminance() < 0.35f
            Text(
                text = text,
                fontFamily = FontFamily.Serif,
                fontWeight = FontWeight.SemiBold,
                fontSize = if (size >= 44.dp) 18.sp else 13.sp,
                color = if (isUser && !isDark) garden.bambooDark else garden.ink
            )
        }
    }
}

/**
 * Liquid-glass inspired smooth pill button with subtle specular highlight.
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
    val isDark = garden.paper.luminance() < 0.35f
    val topColor = when {
        primary && isDark -> Color(0xFF2E6E58)
        primary -> garden.bamboo
        isDark -> garden.paperCard
        else -> Color.White.copy(alpha = 0.84f)
    }
    val bottomColor = when {
        primary && isDark -> Color(0xFF1A4235)
        primary -> garden.bambooDark
        else -> garden.paper
    }
    val fg = when {
        primary && isDark -> Color(0xFFF3F8F5)
        primary -> garden.paperCard
        else -> garden.ink
    }
    val alpha = if (enabled) 1f else 0.46f
    val pillShape = RoundedCornerShape(999.dp)

    Surface(
        modifier = modifier
            .height(36.dp)
            .clip(pillShape)
            .clickable(enabled = enabled, onClick = onClick),
        shape = pillShape,
        color = Color.Transparent,
        shadowElevation = if (enabled && primary) 2.5.dp else 0.5.dp,
        border = BorderStroke(
            width = 0.85.dp,
            brush = Brush.linearGradient(
                colors = listOf(
                    (if (primary) Color.White.copy(alpha = 0.48f) else Color.White.copy(alpha = if (isDark) 0.22f else 0.9f)),
                    (if (primary) garden.gold.copy(alpha = 0.5f) else garden.line.copy(alpha = 0.72f))
                )
            )
        )
    ) {
        Box(
            modifier = Modifier
                .fillMaxHeight()
                .background(
                    brush = Brush.verticalGradient(
                        colors = listOf(topColor.copy(alpha = alpha), bottomColor.copy(alpha = alpha))
                    )
                )
                .drawWithContent {
                    drawContent()
                    if (enabled) {
                        drawRect(
                            brush = Brush.verticalGradient(
                                0f to Color.White.copy(alpha = if (primary) 0.16f else if (isDark) 0.05f else 0.25f),
                                0.5f to Color.Transparent
                            ),
                            size = Size(size.width, size.height * 0.5f)
                        )
                    }
                }
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
 * Carved vermilion cinnabar liquid pill button with specular top highlight.
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
    val pillShape = RoundedCornerShape(999.dp)
    Surface(
        modifier = modifier
            .height(38.dp)
            .clip(pillShape)
            .clickable(enabled = enabled, onClick = onClick),
        shape = pillShape,
        color = Color.Transparent,
        shadowElevation = if (enabled) 3.dp else 0.dp,
        border = BorderStroke(
            width = 0.9.dp,
            brush = Brush.linearGradient(
                colors = listOf(
                    Color.White.copy(alpha = 0.42f * alpha),
                    garden.cinnabarDark.copy(alpha = 0.8f * alpha)
                )
            )
        )
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
                .drawWithContent {
                    drawContent()
                    drawRect(
                        brush = Brush.verticalGradient(
                            0f to Color.White.copy(alpha = 0.22f * alpha),
                            0.5f to Color.Transparent
                        ),
                        size = Size(size.width, size.height * 0.5f)
                    )
                },
            contentAlignment = Alignment.Center
        ) {
            Row(
                modifier = Modifier.padding(PaddingValues(horizontal = 16.dp, vertical = 4.dp)),
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
 * Small smooth pill badge.
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
        border = BorderStroke(0.6.dp, fg.copy(alpha = 0.35f))
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
