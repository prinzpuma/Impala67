package org.impala67.app.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
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
import org.impala67.app.R

val Nunito = FontFamily(
    Font(R.font.nunito, FontWeight.Normal),
    Font(R.font.nunito, FontWeight.Medium),
    Font(R.font.nunito, FontWeight.SemiBold),
    Font(R.font.nunito, FontWeight.Bold),
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
    font: FontFamily = Nunito,
) = TextStyle(
    fontFamily = font,
    fontSize = size,
    fontWeight = weight,
    lineHeight = size * line,
    letterSpacing = tracking,
)

/** Schriftgrößen der PWA (--text-*); Überschriften mit der Rundschrift von --b-display (Nunito). */
private val Typography = Typography(
    displayLarge = style(TextSize.xl * 1.3f, FontWeight.Bold, 1.15f, (-0.03).em),
    displayMedium = style(TextSize.xl * 1.1f, FontWeight.Bold, 1.2f, (-0.025).em),
    displaySmall = style(TextSize.xl, FontWeight.SemiBold, 1.2f, (-0.02).em),
    headlineLarge = style(32.sp, FontWeight.Bold, 1.25f, (-0.025).em),
    headlineMedium = style(28.sp, FontWeight.Medium, 1.3f, (-0.02).em),
    headlineSmall = style(24.sp, FontWeight.SemiBold, 1.2f, (-0.015).em),
    titleLarge = style(TextSize.lg, FontWeight.SemiBold, 1.3f, (-0.01).em),
    titleMedium = style(TextSize.md, FontWeight.SemiBold),
    titleSmall = style(TextSize.base, FontWeight.SemiBold),
    bodyLarge = style(TextSize.md),
    bodyMedium = style(TextSize.base),
    bodySmall = style(TextSize.sm),
    labelLarge = style(TextSize.base, FontWeight.SemiBold, 1.3f),
    labelMedium = style(TextSize.xs, FontWeight.Medium, 1.3f),
    labelSmall = style(TextSize.xs2, FontWeight.Medium, 1.3f),
)

@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun ImpalaTheme(dark: Boolean = isSystemInDarkTheme(), accent: Color? = null, content: @Composable () -> Unit) {
    val base = if (dark) DarkColors else LightColors
    val colors = accent?.let {
        base.copy(accent = it, onAccent = onAccentFor(it))
    } ?: base
    CompositionLocalProvider(LocalImpalaColors provides colors) {
        MaterialExpressiveTheme(
            colorScheme = colorScheme(colors),
            motionScheme = MotionScheme.expressive(),
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
}
