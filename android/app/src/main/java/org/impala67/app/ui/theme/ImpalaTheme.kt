package org.impala67.app.ui.theme

import androidx.compose.animation.core.FiniteAnimationSpec
import androidx.compose.animation.core.snap
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.hapticfeedback.HapticFeedback
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.unit.Density
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.MaterialExpressiveTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.MotionScheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp

import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import org.impala67.app.R

/** Nunito ist eine variable Schrift: ohne gesetzte `wght`-Achse sähe jede Stufe gleich (dünn) aus. */
private fun nunito(weight: FontWeight) =
    Font(R.font.nunito, weight, variationSettings = FontVariation.Settings(FontVariation.weight(weight.weight)))

val Nunito = FontFamily(
    nunito(FontWeight.Normal),
    nunito(FontWeight.Medium),
    nunito(FontWeight.SemiBold),
    nunito(FontWeight.Bold),
)

/** Schrift auf dem Akzent: dunkel bei hellen Akzenten (z. B. Hintergrundbild-Farbe im Dunkelmodus). */
private fun onAccentFor(accent: Color) = if (accent.luminance() > 0.4f) Color(0xFF081018) else Color.White

/** Material-Rollen aus den PWA-Tokens: Die PWA bestimmt das Aussehen, Material liefert die Bausteine. */
private fun colorScheme(c: ImpalaColors): ColorScheme {
    fun over(top: Color) = top.compositeOver(c.panel)
    val base = if (c.isDark) darkColorScheme() else lightColorScheme()
    val onAccent = onAccentFor(c.accent)
    return base.copy(
        primary = c.accent,
        onPrimary = onAccent,
        primaryContainer = over(c.tint2),
        onPrimaryContainer = c.text,
        secondary = c.accent,
        onSecondary = onAccent,
        secondaryContainer = over(c.tint2),
        onSecondaryContainer = c.text,
        tertiary = c.success,
        onTertiary = if (c.isDark) Color.White else c.onAccent,
        tertiaryContainer = over(c.success.copy(alpha = 0.15f)),
        onTertiaryContainer = c.text,
        background = c.panel,
        onBackground = c.text,
        surface = c.panel,
        onSurface = c.text,
        surfaceVariant = over(c.surface),
        onSurfaceVariant = c.text2,
        surfaceTint = Color.Transparent,
        surfaceBright = c.panel,
        surfaceDim = c.bg0,
        surfaceContainerLowest = c.panel,
        surfaceContainerLow = over(c.surfaceSubtle),
        surfaceContainer = c.sidebar,
        surfaceContainerHigh = c.menu,
        surfaceContainerHighest = c.menu,
        inverseSurface = c.text,
        inverseOnSurface = c.panel,
        inversePrimary = c.accent,
        outline = c.edge,
        outlineVariant = c.edgeSoft,
        error = c.danger,
        onError = Color.White,
        errorContainer = over(c.danger.copy(alpha = 0.14f)),
        onErrorContainer = c.text,
        scrim = Color.Black.copy(alpha = if (c.isDark) 0.45f else 0.24f),
    )
}

private val Shapes = Shapes(
    extraSmall = RoundedCornerShape(Radius.xs),
    small = RoundedCornerShape(Radius.sm),
    medium = RoundedCornerShape(Radius.md),
    large = RoundedCornerShape(Radius.lg),
    extraLarge = RoundedCornerShape(Radius.xl),
)

private fun style(
    size: TextUnit,
    weight: FontWeight = FontWeight.Normal,
    line: Float = 1.5f,
    tracking: TextUnit = 0.sp,
    font: FontFamily = FontFamily.Default,
) = TextStyle(
    fontFamily = font,
    fontSize = size,
    fontWeight = weight,
    lineHeight = size * line,
    letterSpacing = tracking,
)

/** Schriftgrößen der PWA (--text-*); Fließtext in der Systemschrift (`body` in base.css), Überschriften mit der Rundschrift von --b-display (Nunito). */
private val Typography = Typography(
    displayLarge = style(TextSize.xl * 1.3f, FontWeight.Bold, 1.15f, (-0.03).em, font = Nunito),
    displayMedium = style(TextSize.xl * 1.1f, FontWeight.Bold, 1.2f, (-0.025).em, font = Nunito),
    displaySmall = style(TextSize.xl, FontWeight.SemiBold, 1.2f, (-0.02).em, font = Nunito),
    headlineLarge = style(32.sp, FontWeight.Bold, 1.25f, (-0.025).em, font = Nunito),
    headlineMedium = style(28.sp, FontWeight.Medium, 1.3f, (-0.02).em, font = Nunito),
    headlineSmall = style(24.sp, FontWeight.SemiBold, 1.2f, (-0.015).em, font = Nunito),
    titleLarge = style(TextSize.lg, FontWeight.SemiBold, 1.3f, (-0.01).em, font = Nunito),
    titleMedium = style(TextSize.md, FontWeight.SemiBold),
    titleSmall = style(TextSize.base, FontWeight.SemiBold),
    bodyLarge = style(TextSize.md),
    bodyMedium = style(TextSize.base),
    bodySmall = style(TextSize.sm),
    labelLarge = style(TextSize.base, FontWeight.SemiBold, 1.3f),
    labelMedium = style(TextSize.xs, FontWeight.Medium, 1.3f),
    labelSmall = style(TextSize.xs2, FontWeight.Medium, 1.3f),
)

/**
 * Darstellungsoptionen nur für dieses Gerät (Einstellungen → Darstellung), wie die Body-Klassen der PWA
 * (`applyAppearance` in settings.js): `density-compact`, `font-s`/`font-l`, `perf-mode`.
 */
@Immutable
data class Appearance(
    /** Kompakt: Spalten randlos bis an die Kante; Komfortabel: abgerundete Karten mit Abstand. */
    val compact: Boolean = true,
    /** Performance-Modus: keine Animationen. */
    val reduceMotion: Boolean = false,
)

val LocalAppearance = staticCompositionLocalOf { Appearance() }

/** Alle Bewegungen springen sofort ans Ziel (`body.perf-mode`: Dauer ≈ 0). */
@OptIn(ExperimentalMaterial3ExpressiveApi::class)
private object SnapMotion : MotionScheme {
    override fun <T> defaultSpatialSpec(): FiniteAnimationSpec<T> = snap()
    override fun <T> fastSpatialSpec(): FiniteAnimationSpec<T> = snap()
    override fun <T> slowSpatialSpec(): FiniteAnimationSpec<T> = snap()
    override fun <T> defaultEffectsSpec(): FiniteAnimationSpec<T> = snap()
    override fun <T> fastEffectsSpec(): FiniteAnimationSpec<T> = snap()
    override fun <T> slowEffectsSpec(): FiniteAnimationSpec<T> = snap()
}

/** Haptik aus: alle Rückmeldungen verschlucken. */
private object NoHaptics : HapticFeedback {
    override fun performHapticFeedback(hapticFeedbackType: HapticFeedbackType) = Unit
}

/**
 * [fontScale] wirkt wie `--font-base` der PWA (15 / 16 / 18 px) zusätzlich zur Schriftgröße des Systems.
 */
@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun ImpalaTheme(
    dark: Boolean = isSystemInDarkTheme(),
    accent: Color? = null,
    fontScale: Float = 1f,
    appearance: Appearance = Appearance(),
    haptics: Boolean = true,
    content: @Composable () -> Unit,
) {
    val base = if (dark) DarkColors else LightColors
    val colors = accent?.let {
        base.copy(accent = it, onAccent = onAccentFor(it))
    } ?: base
    val density = LocalDensity.current
    CompositionLocalProvider(
        LocalImpalaColors provides colors,
        LocalAppearance provides appearance,
        LocalDensity provides Density(density.density, density.fontScale * fontScale),
        LocalHapticFeedback provides if (haptics) LocalHapticFeedback.current else NoHaptics,
    ) {
        MaterialExpressiveTheme(
            colorScheme = colorScheme(colors),
            motionScheme = if (appearance.reduceMotion) SnapMotion else MotionScheme.expressive(),
            shapes = Shapes,
            typography = Typography,
            content = content,
        )
    }
}

/** Zugriff auf die PWA-Tokens: `Impala.colors.text2`. */
object Impala {
    val colors: ImpalaColors
        @Composable @ReadOnlyComposable get() = LocalImpalaColors.current
    val type: Typography
        @Composable @ReadOnlyComposable get() = MaterialTheme.typography
    val appearance: Appearance
        @Composable @ReadOnlyComposable get() = LocalAppearance.current
}
