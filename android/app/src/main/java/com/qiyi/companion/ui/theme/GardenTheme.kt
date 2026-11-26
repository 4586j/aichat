package com.qiyi.companion.ui.theme

import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import com.qiyi.companion.data.prefs.GardenThemeMode

/**
 * Exact Classical Garden V4 color tokens synced with web `public/garden.css`.
 */
@Immutable
data class GardenExtraColors(
    val paper: Color,
    val paperDeep: Color,
    val paperCard: Color,
    val paperTint: Color,
    val ink: Color,
    val text: Color,
    val muted: Color,
    val bamboo: Color,
    val bambooDark: Color,
    val bambooSoft: Color,
    val cinnabar: Color,
    val cinnabarDark: Color,
    val cinnabarSoft: Color,
    val gold: Color,
    val goldSoft: Color,
    val line: Color,
    val lineStrong: Color,
    val lineSoft: Color,
    // Semantic aliases preserved for existing screens
    val userBubble: Color,
    val onUserBubble: Color,
    val assistantBubble: Color,
    val onAssistantBubble: Color,
    val reasoningBg: Color,
    val reasoningBorder: Color,
    val goldAccent: Color,
    val subtleBorder: Color
)

val LocalGardenColors = staticCompositionLocalOf { SpringExtraColors }

// 春园 (spring) — exact tokens from public/garden.css
private val SpringExtraColors = GardenExtraColors(
    paper = Color(0xFFF4F1E8),
    paperDeep = Color(0xFFE9E3D4),
    paperCard = Color(0xFFFCFAF4),
    paperTint = Color(0xFFEEF3ED),
    ink = Color(0xFF17221E),
    text = Color(0xFF22302B),
    muted = Color(0xFF5A6961),
    bamboo = Color(0xFF284D3B),
    bambooDark = Color(0xFF1B3629),
    bambooSoft = Color(0xFFE3ECE5),
    cinnabar = Color(0xFFA33227),
    cinnabarDark = Color(0xFF7A2017),
    cinnabarSoft = Color(0xFFFAECE9),
    gold = Color(0xFF947034),
    goldSoft = Color(0xFFF6EEDC),
    line = Color(0xFFCABFA9),
    lineStrong = Color(0xFF9FB0A4),
    lineSoft = Color(0xFFDFD8C8),
    userBubble = Color(0xFF1B3629),
    onUserBubble = Color(0xFFFCFAF4),
    assistantBubble = Color(0xFFFCFAF4),
    onAssistantBubble = Color(0xFF22302B),
    reasoningBg = Color(0xFFF1EDE2),
    reasoningBorder = Color(0xFFCABFA9),
    goldAccent = Color(0xFF947034),
    subtleBorder = Color(0xFFCABFA9)
)

private val SpringColorScheme: ColorScheme = lightColorScheme(
    primary = SpringExtraColors.bamboo,
    onPrimary = SpringExtraColors.paperCard,
    primaryContainer = SpringExtraColors.bambooSoft,
    onPrimaryContainer = SpringExtraColors.bambooDark,
    secondary = SpringExtraColors.gold,
    onSecondary = SpringExtraColors.paperCard,
    secondaryContainer = SpringExtraColors.goldSoft,
    onSecondaryContainer = SpringExtraColors.ink,
    tertiary = SpringExtraColors.cinnabar,
    onTertiary = SpringExtraColors.paperCard,
    tertiaryContainer = SpringExtraColors.cinnabarSoft,
    onTertiaryContainer = SpringExtraColors.cinnabarDark,
    background = SpringExtraColors.paper,
    onBackground = SpringExtraColors.text,
    surface = SpringExtraColors.paperCard,
    onSurface = SpringExtraColors.text,
    surfaceVariant = SpringExtraColors.paperDeep,
    onSurfaceVariant = SpringExtraColors.muted,
    outline = SpringExtraColors.line,
    outlineVariant = SpringExtraColors.lineSoft,
    error = SpringExtraColors.cinnabar,
    onError = SpringExtraColors.paperCard
)

// 秋庭 (autumn) — exact tokens from public/garden.css
private val AutumnExtraColors = GardenExtraColors(
    paper = Color(0xFFF3EDE0),
    paperDeep = Color(0xFFE6DCC7),
    paperCard = Color(0xFFFDF9F0),
    paperTint = Color(0xFFF2EAD9),
    ink = Color(0xFF241C15),
    text = Color(0xFF332920),
    muted = Color(0xFF6E5E4E),
    bamboo = Color(0xFF634627),
    bambooDark = Color(0xFF473119),
    bambooSoft = Color(0xFFEFE5D4),
    cinnabar = Color(0xFFA83625),
    cinnabarDark = Color(0xFF7D2316),
    cinnabarSoft = Color(0xFFFAECE7),
    gold = Color(0xFFAD7B26),
    goldSoft = Color(0xFFF7ECD2),
    line = Color(0xFFCBBBA2),
    lineStrong = Color(0xFFB09878),
    lineSoft = Color(0xFFE3D6C0),
    userBubble = Color(0xFF473119),
    onUserBubble = Color(0xFFFDF9F0),
    assistantBubble = Color(0xFFFDF9F0),
    onAssistantBubble = Color(0xFF332920),
    reasoningBg = Color(0xFFF2EAD9),
    reasoningBorder = Color(0xFFCBBBA2),
    goldAccent = Color(0xFFAD7B26),
    subtleBorder = Color(0xFFCBBBA2)
)

private val AutumnColorScheme: ColorScheme = lightColorScheme(
    primary = AutumnExtraColors.bamboo,
    onPrimary = AutumnExtraColors.paperCard,
    primaryContainer = AutumnExtraColors.bambooSoft,
    onPrimaryContainer = AutumnExtraColors.bambooDark,
    secondary = AutumnExtraColors.gold,
    onSecondary = AutumnExtraColors.paperCard,
    secondaryContainer = AutumnExtraColors.goldSoft,
    onSecondaryContainer = AutumnExtraColors.ink,
    tertiary = AutumnExtraColors.cinnabar,
    onTertiary = AutumnExtraColors.paperCard,
    tertiaryContainer = AutumnExtraColors.cinnabarSoft,
    onTertiaryContainer = AutumnExtraColors.cinnabarDark,
    background = AutumnExtraColors.paper,
    onBackground = AutumnExtraColors.text,
    surface = AutumnExtraColors.paperCard,
    onSurface = AutumnExtraColors.text,
    surfaceVariant = AutumnExtraColors.paperDeep,
    onSurfaceVariant = AutumnExtraColors.muted,
    outline = AutumnExtraColors.line,
    outlineVariant = AutumnExtraColors.lineSoft,
    error = AutumnExtraColors.cinnabar,
    onError = AutumnExtraColors.paperCard
)

// 夜雨 (night) — exact tokens from public/garden.css (zero #FFFFFF leaks)
private val NightExtraColors = GardenExtraColors(
    paper = Color(0xFF151E1B),
    paperDeep = Color(0xFF0F1614),
    paperCard = Color(0xFF1D2925),
    paperTint = Color(0xFF23322D),
    ink = Color(0xFFF2EEE4),
    text = Color(0xFFE2DDD0),
    muted = Color(0xFF96A69E),
    bamboo = Color(0xFF396650),
    bambooDark = Color(0xFF284A39),
    bambooSoft = Color(0xFF263B33),
    cinnabar = Color(0xFFB84337),
    cinnabarDark = Color(0xFF8C2E24),
    cinnabarSoft = Color(0xFF3D2320),
    gold = Color(0xFFD4AE66),
    goldSoft = Color(0xFF362E1F),
    line = Color(0xFF354740),
    lineStrong = Color(0xFF4D695D),
    lineSoft = Color(0xFF283832),
    userBubble = Color(0xFF284A39),
    onUserBubble = Color(0xFFF2EEE4),
    assistantBubble = Color(0xFF1D2925),
    onAssistantBubble = Color(0xFFE2DDD0),
    reasoningBg = Color(0xFF18221F),
    reasoningBorder = Color(0xFF354740),
    goldAccent = Color(0xFFD4AE66),
    subtleBorder = Color(0xFF354740)
)

private val NightColorScheme: ColorScheme = darkColorScheme(
    primary = NightExtraColors.bamboo,
    onPrimary = NightExtraColors.ink,
    primaryContainer = NightExtraColors.bambooSoft,
    onPrimaryContainer = NightExtraColors.ink,
    secondary = NightExtraColors.gold,
    onSecondary = Color(0xFF241C0D),
    secondaryContainer = NightExtraColors.goldSoft,
    onSecondaryContainer = NightExtraColors.ink,
    tertiary = NightExtraColors.cinnabar,
    onTertiary = NightExtraColors.ink,
    tertiaryContainer = NightExtraColors.cinnabarSoft,
    onTertiaryContainer = NightExtraColors.ink,
    background = NightExtraColors.paper,
    onBackground = NightExtraColors.text,
    surface = NightExtraColors.paperCard,
    onSurface = NightExtraColors.text,
    surfaceVariant = NightExtraColors.paperTint,
    onSurfaceVariant = NightExtraColors.muted,
    outline = NightExtraColors.line,
    outlineVariant = NightExtraColors.lineSoft,
    error = NightExtraColors.cinnabar,
    onError = NightExtraColors.ink
)

private val GardenTypography = Typography(
    titleLarge = TextStyle(
        fontFamily = FontFamily.Serif,
        fontWeight = FontWeight.SemiBold,
        fontSize = 20.sp,
        lineHeight = 28.sp,
        letterSpacing = 0.5.sp
    ),
    titleMedium = TextStyle(
        fontFamily = FontFamily.Serif,
        fontWeight = FontWeight.SemiBold,
        fontSize = 16.sp,
        lineHeight = 22.sp,
        letterSpacing = 0.4.sp
    ),
    titleSmall = TextStyle(
        fontFamily = FontFamily.Serif,
        fontWeight = FontWeight.SemiBold,
        fontSize = 14.sp,
        lineHeight = 20.sp,
        letterSpacing = 0.3.sp
    ),
    bodyMedium = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontSize = 14.5.sp,
        lineHeight = 22.sp
    ),
    bodySmall = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontSize = 12.5.sp,
        lineHeight = 18.sp
    ),
    labelMedium = TextStyle(
        fontFamily = FontFamily.Serif,
        fontWeight = FontWeight.Medium,
        fontSize = 12.sp,
        letterSpacing = 0.4.sp
    ),
    labelSmall = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Medium,
        fontSize = 11.sp
    )
)

@Composable
fun QiYiGardenTheme(
    themeMode: GardenThemeMode,
    content: @Composable () -> Unit
) {
    val (scheme, extras) = when (themeMode) {
        GardenThemeMode.SPRING -> SpringColorScheme to SpringExtraColors
        GardenThemeMode.AUTUMN -> AutumnColorScheme to AutumnExtraColors
        GardenThemeMode.NIGHT -> NightColorScheme to NightExtraColors
    }

    CompositionLocalProvider(LocalGardenColors provides extras) {
        MaterialTheme(
            colorScheme = scheme,
            typography = GardenTypography,
            content = content
        )
    }
}
