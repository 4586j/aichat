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
import com.qiyi.companion.data.prefs.GardenThemeMode

@Immutable
data class GardenExtraColors(
    val userBubble: Color,
    val onUserBubble: Color,
    val assistantBubble: Color,
    val onAssistantBubble: Color,
    val reasoningBg: Color,
    val reasoningBorder: Color,
    val goldAccent: Color,
    val subtleBorder: Color
)

val LocalGardenColors = staticCompositionLocalOf {
    SpringExtraColors
}

// 春园 (Spring Garden): Warm Xuan paper + Bamboo Jade + Antique Gold
private val SpringColorScheme: ColorScheme = lightColorScheme(
    primary = Color(0xFF2E5E4E),
    onPrimary = Color(0xFFFBF8F1),
    primaryContainer = Color(0xFFD9EAE3),
    onPrimaryContainer = Color(0xFF16352B),
    secondary = Color(0xFFB5832C),
    onSecondary = Color(0xFFFBF8F1),
    secondaryContainer = Color(0xFFF2E5CA),
    onSecondaryContainer = Color(0xFF4A330B),
    tertiary = Color(0xFF8F3E36),
    onTertiary = Color(0xFFFBF8F1),
    background = Color(0xFFF4EFE4),
    onBackground = Color(0xFF26231F),
    surface = Color(0xFFFBF8F1),
    onSurface = Color(0xFF26231F),
    surfaceVariant = Color(0xFFECE4D3),
    onSurfaceVariant = Color(0xFF5D564C),
    outline = Color(0xFFCBBFA9),
    outlineVariant = Color(0xFFE0D6C3),
    error = Color(0xFFA8332B),
    onError = Color(0xFFFBF8F1)
)

private val SpringExtraColors = GardenExtraColors(
    userBubble = Color(0xFF2E5E4E),
    onUserBubble = Color(0xFFFBF8F1),
    assistantBubble = Color(0xFFFBF8F1),
    onAssistantBubble = Color(0xFF26231F),
    reasoningBg = Color(0xFFF1EADC),
    reasoningBorder = Color(0xFFD5C7AD),
    goldAccent = Color(0xFFB5832C),
    subtleBorder = Color(0xFFDAD0BC)
)

// 秋庭 (Autumn Courtyard): Frost Maple + Warm Amber + Terracotta
private val AutumnColorScheme: ColorScheme = lightColorScheme(
    primary = Color(0xFF8C462B),
    onPrimary = Color(0xFFFCF6EC),
    primaryContainer = Color(0xFFF2D7C7),
    onPrimaryContainer = Color(0xFF431C0D),
    secondary = Color(0xFFC4442F),
    onSecondary = Color(0xFFFCF6EC),
    secondaryContainer = Color(0xFFF7DCD4),
    onSecondaryContainer = Color(0xFF54180F),
    tertiary = Color(0xFF9A6F26),
    onTertiary = Color(0xFFFCF6EC),
    background = Color(0xFFF5E9D6),
    onBackground = Color(0xFF2E221A),
    surface = Color(0xFFFCF6EC),
    onSurface = Color(0xFF2E221A),
    surfaceVariant = Color(0xFFECDAC1),
    onSurfaceVariant = Color(0xFF664F3E),
    outline = Color(0xFFCDB396),
    outlineVariant = Color(0xFFE2CEB6),
    error = Color(0xFFB33225),
    onError = Color(0xFFFCF6EC)
)

private val AutumnExtraColors = GardenExtraColors(
    userBubble = Color(0xFF8C462B),
    onUserBubble = Color(0xFFFCF6EC),
    assistantBubble = Color(0xFFFCF6EC),
    onAssistantBubble = Color(0xFF2E221A),
    reasoningBg = Color(0xFFF2E2CA),
    reasoningBorder = Color(0xFFD6B998),
    goldAccent = Color(0xFFB57A28),
    subtleBorder = Color(0xFFDFC7AB)
)

// 夜雨 (Night Rain): Lacquer Ink + Celadon Glow + Mother-of-Pearl Gold (Zero #FFFFFF leaks)
private val NightColorScheme: ColorScheme = darkColorScheme(
    primary = Color(0xFF69B8AE),
    onPrimary = Color(0xFF102523),
    primaryContainer = Color(0xFF213C3B),
    onPrimaryContainer = Color(0xFFCBECE7),
    secondary = Color(0xFFD4B06A),
    onSecondary = Color(0xFF29200D),
    secondaryContainer = Color(0xFF3A3120),
    onSecondaryContainer = Color(0xFFF1DDB4),
    tertiary = Color(0xFFD47B6A),
    onTertiary = Color(0xFF2B130E),
    background = Color(0xFF161D1E),
    onBackground = Color(0xFFE7E2D8),
    surface = Color(0xFF1F282A),
    onSurface = Color(0xFFE7E2D8),
    surfaceVariant = Color(0xFF273335),
    onSurfaceVariant = Color(0xFFA7B3B1),
    outline = Color(0xFF3E4E50),
    outlineVariant = Color(0xFF2E3B3D),
    error = Color(0xFFE07A72),
    onError = Color(0xFF2B110F)
)

private val NightExtraColors = GardenExtraColors(
    userBubble = Color(0xFF254845),
    onUserBubble = Color(0xFFEAF4F2),
    assistantBubble = Color(0xFF1F282A),
    onAssistantBubble = Color(0xFFE7E2D8),
    reasoningBg = Color(0xFF1A2325),
    reasoningBorder = Color(0xFF334345),
    goldAccent = Color(0xFFD4B06A),
    subtleBorder = Color(0xFF314042)
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
            typography = Typography(),
            content = content
        )
    }
}
