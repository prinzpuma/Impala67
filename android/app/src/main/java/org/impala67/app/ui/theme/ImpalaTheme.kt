package org.impala67.app.ui.theme

import android.app.Activity
import android.content.Context
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
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.view.WindowCompat

// ============================================================================
// Konstante PWA-Akzentfarben & Statusfarben
// ============================================================================

val AccentBlueConst = Color(0xFF4A9EFF)
val AccentViolet = Color(0xFFA78BFA)
val AccentGreen = Color(0xFF34D399)
val AccentOrange = Color(0xFFFB923C)

val Danger = Color(0xFFE97366)
val DangerRed = Color(0xFFE97366)
val DangerSoft = Color(0x24E97366)
val DangerBorder = Color(0x80E97366)

val Success = Color(0xFF72BC8F)
val SuccessGreen = Color(0xFF34D399)
val SuccessSoft = Color(0x2672BC8F)
val SuccessBorder = Color(0x7372BC8F)

val Warn = Color(0xFFE8C65A)
val WarningAmber = Color(0xFFF59E0B)
val WarnSoft = Color(0x2EE8C65A)

// ============================================================================
// Reaktiver Theme-Zustand (aus SharedPreferences "impala_ui_prefs" aktualisiert)
// ============================================================================

const val IMPALA_UI_PREFS = "impala_ui_prefs"
const val PREF_THEME_MODE = "theme_mode"        // "dark", "light", "system"
const val PREF_ACCENT_COLOR = "accent_color"    // "blue", "violet", "green", "orange"
const val PREF_UI_MODE_OVERRIDE = "ui_mode_override" // "auto", "tablet", "mobile"

var themeRevision by mutableIntStateOf(0)
var isImpalaLightMode by mutableStateOf(false)
var currentThemeMode by mutableStateOf("dark")
var currentAccentKey by mutableStateOf("blue")

var BgDeep by mutableStateOf(Color(0xFF05070D))
var BgPanel by mutableStateOf(Color(0xFF191919))
var BgSidebar by mutableStateOf(Color(0xFF202020))
var BgBubble by mutableStateOf(Color(0xFF2C2E33))
var BgCard by mutableStateOf(Color(0xFF222327))
var BgElevated by mutableStateOf(Color(0xFF282A2F))
var BgHover by mutableStateOf(Color(0xFF2A2C32))

var TextMain by mutableStateOf(Color(0xFFECECEC))
var TextPrimary by mutableStateOf(Color(0xFFECECEC))
var TextSecondary by mutableStateOf(Color(0xFFB8BDC4))
var TextMuted by mutableStateOf(Color(0xFF9AA0A6))
var TextLight by mutableStateOf(Color(0xFF6E747C))

var AccentBlue by mutableStateOf(Color(0xFF4A9EFF))
var AccentBlueSoft by mutableStateOf(Color(0x244A9EFF))
var Accent by mutableStateOf(Color(0xFF4A9EFF))
var AccentSoft by mutableStateOf(Color(0x244A9EFF))
var AccentBorder by mutableStateOf(Color(0x4D4A9EFF))

var BorderHairline by mutableStateOf(Color(0x14FFFFFF))
var BorderStrong by mutableStateOf(Color(0x29FFFFFF))
var EdgeSoft by mutableStateOf(Color(0x14FFFFFF))
var Edge by mutableStateOf(Color(0x26FFFFFF))

var SurfaceSubtle by mutableStateOf(Color(0x0AFFFFFF))
var SurfaceHover by mutableStateOf(Color(0x12FFFFFF))
var SurfaceActive by mutableStateOf(Color(0x1FFFFFFF))

/**
 * Liest Theme-Modus ("dark", "light", "system") und Akzentfarbe ("blue", "violet", "green", "orange")
 * aus SharedPreferences("impala_ui_prefs", MODE_PRIVATE) und aktualisiert alle reaktiven Farb-Tokens.
 */
fun syncThemeFromPrefs(context: Context, systemInDarkTheme: Boolean = true) {
    val prefs = context.getSharedPreferences(IMPALA_UI_PREFS, Context.MODE_PRIVATE)
    val rawMode = prefs.getString(PREF_THEME_MODE, null)
        ?: if (prefs.contains("dark_mode")) {
            if (prefs.getBoolean("dark_mode", true)) "dark" else "light"
        } else {
            "dark"
        }
    val rawAccent = prefs.getString(PREF_ACCENT_COLOR, "blue") ?: "blue"

    currentThemeMode = rawMode
    currentAccentKey = rawAccent

    val light = when (rawMode) {
        "light" -> true
        "system" -> !systemInDarkTheme
        else -> false
    }
    isImpalaLightMode = light

    val chosenAccent = when (rawAccent) {
        "violet" -> Color(0xFFA78BFA)
        "green" -> Color(0xFF34D399)
        "orange" -> Color(0xFFFB923C)
        else -> Color(0xFF4A9EFF)
    }

    AccentBlue = chosenAccent
    Accent = chosenAccent
    AccentBlueSoft = chosenAccent.copy(alpha = if (light) 0.14f else 0.16f)
    AccentSoft = AccentBlueSoft
    AccentBorder = chosenAccent.copy(alpha = if (light) 0.34f else 0.38f)

    if (light) {
        // Light Mode exakt wie PWA body.light
        BgDeep = Color(0xFFEAE7E1)
        BgPanel = Color(0xFFFFFFFF)
        BgSidebar = Color(0xFFF4F2EE)
        BgBubble = Color(0xFFE8E6E1)
        BgCard = Color(0xFFF8F7F4)
        BgElevated = Color(0xFFFFFFFF)
        BgHover = Color(0xFFECEAE4)

        TextMain = Color(0xFF1F1F1F)
        TextPrimary = Color(0xFF1F1F1F)
        TextSecondary = Color(0xFF4B5563)
        TextMuted = Color(0xFF6B7280)
        TextLight = Color(0xFF9CA3AF)

        BorderHairline = Color(0x14000000)
        BorderStrong = Color(0x26000000)
        EdgeSoft = Color(0x14000000)
        Edge = Color(0x24000000)

        SurfaceSubtle = Color(0x08000000)
        SurfaceHover = Color(0x0F000000)
        SurfaceActive = Color(0x1A000000)
    } else {
        // Dark Mode (Standard, exakt wie PWA variables.css)
        BgDeep = Color(0xFF0F1013)
        BgPanel = Color(0xFF191919)
        BgSidebar = Color(0xFF202020)
        BgBubble = Color(0xFF2C2E33)
        BgCard = Color(0xFF222327)
        BgElevated = Color(0xFF282A2F)
        BgHover = Color(0xFF2A2D32)

        TextMain = Color(0xFFECECEC)
        TextPrimary = Color(0xFFECECEC)
        TextSecondary = Color(0xFFB8BDC4)
        TextMuted = Color(0xFF9AA0A6)
        TextLight = Color(0xFF6E747C)

        BorderHairline = Color(0x14FFFFFF)
        BorderStrong = Color(0x29FFFFFF)
        EdgeSoft = Color(0x14FFFFFF)
        Edge = Color(0x26FFFFFF)

        SurfaceSubtle = Color(0x0AFFFFFF)
        SurfaceHover = Color(0x12FFFFFF)
        SurfaceActive = Color(0x1FFFFFFF)
    }

    themeRevision++
}

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

object ImpalaSprings {
    val bouncyFloat = spring<Float>(
        dampingRatio = Spring.DampingRatioLowBouncy,
        stiffness = Spring.StiffnessMediumLow
    )
    val smoothFloat = spring<Float>(
        dampingRatio = Spring.DampingRatioNoBouncy,
        stiffness = Spring.StiffnessMedium
    )
    val snappyFloat = spring<Float>(
        dampingRatio = Spring.DampingRatioMediumBouncy,
        stiffness = Spring.StiffnessMedium
    )
    val bouncyDp = spring<Dp>(
        dampingRatio = Spring.DampingRatioLowBouncy,
        stiffness = Spring.StiffnessMediumLow
    )
    val smoothDp = spring<Dp>(
        dampingRatio = Spring.DampingRatioNoBouncy,
        stiffness = Spring.StiffnessMedium
    )
    val smoothOffset = spring<IntOffset>(
        dampingRatio = Spring.DampingRatioNoBouncy,
        stiffness = Spring.StiffnessMedium
    )
    fun <T> bouncy() = spring<T>(
        dampingRatio = Spring.DampingRatioLowBouncy,
        stiffness = Spring.StiffnessMediumLow
    )
    fun <T> smooth() = spring<T>(
        dampingRatio = Spring.DampingRatioNoBouncy,
        stiffness = Spring.StiffnessMedium
    )
    fun <T> snappy() = spring<T>(
        dampingRatio = Spring.DampingRatioMediumBouncy,
        stiffness = Spring.StiffnessMedium
    )
}

// ============================================================================
// Design-Tokens & Farbschema
// ============================================================================

@Immutable
data class ImpalaColors(
    val bgDeep: Color = BgDeep,
    val bgPanel: Color = BgPanel,
    val bgSidebar: Color = BgSidebar,
    val bgBubble: Color = BgBubble,
    val bgCard: Color = BgCard,
    val bgElevated: Color = BgElevated,
    val bgHover: Color = BgHover,
    val textMain: Color = TextMain,
    val textPrimary: Color = TextPrimary,
    val textSecondary: Color = TextSecondary,
    val textMuted: Color = TextMuted,
    val textLight: Color = TextLight,
    val accent: Color = Accent,
    val accentBlue: Color = AccentBlue,
    val accentSoft: Color = AccentSoft,
    val accentBlueSoft: Color = AccentBlueSoft,
    val accentBorder: Color = AccentBorder,
    val danger: Color = Danger,
    val dangerSoft: Color = DangerSoft,
    val dangerBorder: Color = DangerBorder,
    val success: Color = Success,
    val successSoft: Color = SuccessSoft,
    val successBorder: Color = SuccessBorder,
    val warn: Color = Warn,
    val warnSoft: Color = WarnSoft,
    val borderHairline: Color = BorderHairline,
    val borderStrong: Color = BorderStrong,
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

val ImpalaTypography: Typography
    get() = Typography(
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

/**
 * Impala67 Theme für Android (Material 3 Expressive, Dark/Light Mode & 4 PWA-Akzentfarben)
 */
@Composable
fun ImpalaTheme(
    themeTrigger: Int = 0,
    content: @Composable () -> Unit
) {
    val context = LocalContext.current
    val systemDark = isSystemInDarkTheme()
    val view = LocalView.current

    // Initialisieren & bei Trigger aktualisieren
    val rev = themeRevision + themeTrigger
    SideEffect {
        syncThemeFromPrefs(context, systemDark)
        val activity = context as? Activity
        if (activity != null && !view.isInEditMode) {
            val window = activity.window
            val insetsController = WindowCompat.getInsetsController(window, view)
            insetsController.isAppearanceLightStatusBars = isImpalaLightMode
            insetsController.isAppearanceLightNavigationBars = isImpalaLightMode
        }
    }

    val colors = ImpalaColors(
        bgDeep = BgDeep,
        bgPanel = BgPanel,
        bgSidebar = BgSidebar,
        bgBubble = BgBubble,
        bgCard = BgCard,
        bgElevated = BgElevated,
        bgHover = BgHover,
        textMain = TextMain,
        textPrimary = TextPrimary,
        textSecondary = TextSecondary,
        textMuted = TextMuted,
        textLight = TextLight,
        accent = Accent,
        accentBlue = AccentBlue,
        accentSoft = AccentSoft,
        accentBlueSoft = AccentBlueSoft,
        accentBorder = AccentBorder,
        danger = Danger,
        dangerSoft = DangerSoft,
        dangerBorder = DangerBorder,
        success = Success,
        successSoft = SuccessSoft,
        successBorder = SuccessBorder,
        warn = Warn,
        warnSoft = WarnSoft,
        borderHairline = BorderHairline,
        borderStrong = BorderStrong,
        edgeSoft = EdgeSoft,
        edge = Edge,
        surfaceSubtle = SurfaceSubtle,
        surfaceHover = SurfaceHover,
        surfaceActive = SurfaceActive
    )

    val colorScheme = if (isImpalaLightMode) {
        lightColorScheme(
            primary = AccentBlue,
            onPrimary = Color.White,
            primaryContainer = AccentBlueSoft,
            onPrimaryContainer = TextMain,
            secondary = AccentBlue,
            onSecondary = Color.White,
            secondaryContainer = AccentBlueSoft,
            onSecondaryContainer = TextMain,
            tertiary = Warn,
            onTertiary = Color(0xFF1F1F1F),
            background = BgPanel,
            onBackground = TextMain,
            surface = BgSidebar,
            onSurface = TextMain,
            surfaceVariant = BgBubble,
            onSurfaceVariant = TextMuted,
            outline = BorderStrong,
            outlineVariant = BorderHairline,
            error = DangerRed,
            onError = Color.White
        )
    } else {
        darkColorScheme(
            primary = AccentBlue,
            onPrimary = Color(0xFF081018),
            primaryContainer = AccentBlueSoft,
            onPrimaryContainer = TextMain,
            secondary = AccentBlue,
            onSecondary = Color(0xFF081018),
            secondaryContainer = AccentBlueSoft,
            onSecondaryContainer = TextMain,
            tertiary = Warn,
            onTertiary = Color(0xFF081018),
            background = BgPanel,
            onBackground = TextMain,
            surface = BgSidebar,
            onSurface = TextMain,
            surfaceVariant = BgBubble,
            onSurfaceVariant = TextMuted,
            outline = BorderStrong,
            outlineVariant = BorderHairline,
            error = DangerRed,
            onError = Color(0xFF081018)
        )
    }

    if (rev >= 0) {
        CompositionLocalProvider(
            LocalImpalaColors provides colors
        ) {
            MaterialTheme(
                colorScheme = colorScheme,
                typography = ImpalaTypography,
                shapes = ImpalaShapes,
                content = content
            )
        }
    }
}

object ImpalaTheme {
    val colors: ImpalaColors
        @Composable
        @ReadOnlyComposable
        get() = LocalImpalaColors.current
}
