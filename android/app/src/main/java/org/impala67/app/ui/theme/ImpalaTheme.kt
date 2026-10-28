package org.impala67.app.ui.theme

import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

// ============================================================================
// Farbwelt aus web/css/variables.css
// ============================================================================

val BgDeep = Color(0xFF05070D)
val BgPanel = Color(0xFF191919)
val BgSidebar = Color(0xFF202020)
val BgBubble = Color(0xFF2C2E33)

val TextPrimary = Color(0xEBFFFFFF)    // 92% Alpha
val TextSecondary = Color(0xADFFFFFF)  // 68% Alpha
val TextMuted = Color(0x70FFFFFF)      // 44% Alpha

val Accent = Color(0xFF6B8CAE)
val AccentSoft = Color(0x246B8CAE)
val AccentBorder = Color(0x406B8CAE)

val Danger = Color(0xFFE97366)
val DangerSoft = Color(0x24E97366)
val DangerBorder = Color(0x80E97366)

val Success = Color(0xFF72BC8F)
val SuccessSoft = Color(0x2672BC8F)
val SuccessBorder = Color(0x7372BC8F)

val Warn = Color(0xFFE8C65A)
val WarnSoft = Color(0x2EE8C65A)

val EdgeSoft = Color(0x0FFFFFFF)       // 6% Alpha
val Edge = Color(0x24FFFFFF)           // 14% Alpha
val SurfaceSubtle = Color(0x0AFFFFFF)  // 4% Alpha
val SurfaceHover = Color(0x0FFFFFFF)   // 6% Alpha
val SurfaceActive = Color(0x1AFFFFFF)  // 10% Alpha

// ============================================================================
// Material 3 Expressive Motion-Hilfen (Federphysik & Transitions)
// ============================================================================

val ImpalaEaseOut = CubicBezierEasing(0.2f, 0.8f, 0.2f, 1.0f)
val ImpalaBouncySpringFloat = spring<Float>(
    dampingRatio = Spring.DampingRatioLowBouncy,
    stiffness = Spring.StiffnessMediumLow
)
val ImpalaBouncySpringDp = spring<Dp>(
    dampingRatio = Spring.DampingRatioLowBouncy,
    stiffness = Spring.StiffnessMediumLow
)
val ImpalaFastTweenFloat = tween<Float>(durationMillis = 180, easing = ImpalaEaseOut)

// ============================================================================
// Design-Tokens & Farbschema
// ============================================================================

@Immutable
data class ImpalaColors(
    val bgDeep: Color = BgDeep,
    val bgPanel: Color = BgPanel,
    val bgSidebar: Color = BgSidebar,
    val bgBubble: Color = BgBubble,
    val textPrimary: Color = TextPrimary,
    val textSecondary: Color = TextSecondary,
    val textMuted: Color = TextMuted,
    val accent: Color = Accent,
    val accentSoft: Color = AccentSoft,
    val accentBorder: Color = AccentBorder,
    val danger: Color = Danger,
    val dangerSoft: Color = DangerSoft,
    val dangerBorder: Color = DangerBorder,
    val success: Color = Success,
    val successSoft: Color = SuccessSoft,
    val successBorder: Color = SuccessBorder,
    val warn: Color = Warn,
    val warnSoft: Color = WarnSoft,
    val edgeSoft: Color = EdgeSoft,
    val edge: Color = Edge,
    val surfaceSubtle: Color = SurfaceSubtle,
    val surfaceHover: Color = SurfaceHover,
    val surfaceActive: Color = SurfaceActive
)

val LocalImpalaColors = staticCompositionLocalOf { ImpalaColors() }

val ImpalaPillShape = RoundedCornerShape(999.dp)

val ImpalaShapes = Shapes(
    extraSmall = RoundedCornerShape(6.dp),
    small = RoundedCornerShape(10.dp),
    medium = RoundedCornerShape(14.dp),
    large = RoundedCornerShape(20.dp),
    extraLarge = RoundedCornerShape(26.dp)
)

val ImpalaTypography = Typography(
    headlineLarge = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Bold,
        fontSize = 28.sp,
        lineHeight = 34.sp,
        color = TextPrimary
    ),
    headlineMedium = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.SemiBold,
        fontSize = 22.sp,
        lineHeight = 28.sp,
        color = TextPrimary
    ),
    headlineSmall = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.SemiBold,
        fontSize = 18.sp,
        lineHeight = 24.sp,
        color = TextPrimary
    ),
    titleLarge = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.SemiBold,
        fontSize = 16.sp,
        lineHeight = 22.sp,
        color = TextPrimary
    ),
    titleMedium = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Medium,
        fontSize = 14.sp,
        lineHeight = 20.sp,
        color = TextPrimary
    ),
    bodyLarge = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Normal,
        fontSize = 15.sp,
        lineHeight = 22.sp,
        color = TextPrimary
    ),
    bodyMedium = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Normal,
        fontSize = 13.sp,
        lineHeight = 18.sp,
        color = TextSecondary
    ),
    bodySmall = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Normal,
        fontSize = 11.sp,
        lineHeight = 15.sp,
        color = TextSecondary
    ),
    labelLarge = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Medium,
        fontSize = 13.sp,
        lineHeight = 18.sp,
        color = TextPrimary
    ),
    labelSmall = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Normal,
        fontSize = 10.sp,
        lineHeight = 14.sp,
        color = TextSecondary
    )
)

private val DarkColorScheme = darkColorScheme(
    primary = Accent,
    onPrimary = Color(0xFF081018),
    primaryContainer = AccentSoft,
    onPrimaryContainer = TextPrimary,
    secondary = Accent,
    onSecondary = Color(0xFF081018),
    secondaryContainer = AccentSoft,
    onSecondaryContainer = TextPrimary,
    tertiary = Warn,
    onTertiary = Color(0xFF081018),
    background = BgPanel,
    onBackground = TextPrimary,
    surface = BgSidebar,
    onSurface = TextPrimary,
    surfaceVariant = BgBubble,
    onSurfaceVariant = TextSecondary,
    outline = Edge,
    outlineVariant = EdgeSoft,
    error = Danger,
    onError = Color(0xFF081018)
)

/**
 * Impala67 Theme für Android (Material 3 Expressive & Dark Mode)
 */
@Composable
fun ImpalaTheme(
    content: @Composable () -> Unit
) {
    val colors = ImpalaColors()
    CompositionLocalProvider(
        LocalImpalaColors provides colors
    ) {
        MaterialTheme(
            colorScheme = DarkColorScheme,
            typography = ImpalaTypography,
            shapes = ImpalaShapes,
            content = content
        )
    }
}

object ImpalaTheme {
    val colors: ImpalaColors
        @Composable
        @ReadOnlyComposable
        get() = LocalImpalaColors.current
}
