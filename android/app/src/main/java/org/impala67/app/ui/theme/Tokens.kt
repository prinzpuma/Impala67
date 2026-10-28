package org.impala67.app.ui.theme

import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * Design-Tokens der PWA (web/css/variables.css, `body.light` in web/styles.css). Die Namen folgen den
 * CSS-Variablen, damit Bildschirme 1:1 aus dem Web-CSS übertragen werden können.
 */
@Immutable
data class ImpalaColors(
    val isDark: Boolean,
    /** --panel-solid: Grundfläche der Ansichten und Karten. */
    val panel: Color,
    val bg0: Color,
    val sidebar: Color,
    val menu: Color,
    val bubble: Color,
    val text: Color,
    val text2: Color,
    val accent: Color,
    val onAccent: Color,
    val danger: Color,
    val success: Color,
    val warn: Color,
    val surfaceSubtle: Color,
    val surface: Color,
    val surfaceHover: Color,
    val surfaceActive: Color,
    val edgeSoft: Color,
    val edge: Color,
    /** Hinweisleiste (.hv-alert): Text und Fläche. */
    val alertText: Color,
    val alertBg: Color,
    /** Papierfarbe der Heft-Vorschau (.hv-prev.heft). */
    val paper: Color = Color(0xFFFBF9F4),
    /** Text-Vorschau im Dunkeln (#222), hell wie die Fläche. */
    val previewBg: Color,
) {
    /** --b-tint / -2 / -3: Akzent 9 / 16 / 24 % über der Fläche. */
    val tint get() = accent.copy(alpha = 0.09f)
    val tint2 get() = accent.copy(alpha = 0.16f)
    val tint3 get() = accent.copy(alpha = 0.24f)
    /** --accent-border */
    val accentBorder get() = accent.copy(alpha = if (isDark) 0.25f else 0.36f)
    /** --b-hover-bg: 4 % Text über der Fläche. */
    val hoverBg get() = text.copy(alpha = 0.04f).compositeOver(panel)
    /** Erfolg 12 % über der Fläche (.hv-cards.done). */
    val successPanel get() = success.copy(alpha = 0.12f).compositeOver(panel)
}

private fun white(a: Float) = Color.White.copy(alpha = a)

val DarkColors = ImpalaColors(
    isDark = true,
    panel = Color(0xFF191919),
    bg0 = Color(0xFF05070D),
    sidebar = Color(0xFF202020),
    menu = Color(0xFF202020),
    bubble = Color(0xFF2C2E33),
    text = white(0.92f),
    text2 = white(0.68f),
    accent = Color(0xFF6B8CAE),
    onAccent = Color(0xFF081018),
    danger = Color(0xFFE97366),
    success = Color(0xFF72BC8F),
    warn = Color(0xFFE8C65A),
    surfaceSubtle = white(0.03f),
    surface = white(0.04f),
    surfaceHover = white(0.06f),
    surfaceActive = white(0.10f),
    edgeSoft = white(0.06f),
    edge = white(0.14f),
    alertText = Color(0xFFE8C65A),
    alertBg = Color(0xFFE8C65A).copy(alpha = 0.12f),
    previewBg = Color(0xFF222222),
)

val LightColors = ImpalaColors(
    isDark = false,
    panel = Color(0xFFFFFDFA),
    bg0 = Color(0xFFF2EFE9),
    sidebar = Color(0xFF000000).copy(alpha = 0.03f).compositeOver(Color(0xFFFFFDFA)),
    menu = Color(0xFFFFFDFA),
    bubble = Color(0xFFE4F0FB),
    text = Color(0xFF292926),
    text2 = Color(0xFF5C5A54),
    accent = Color(0xFF2478C7),
    onAccent = Color.White,
    danger = Color(0xFFD84D43),
    success = Color(0xFF37845A),
    warn = Color(0xFFE8C65A),
    surfaceSubtle = Color(0xFFF7F4EE),
    surface = Color(0xFFF0EDE6),
    surfaceHover = Color(0xFFE9E5DD),
    surfaceActive = Color(0xFFD5CEC3),
    edgeSoft = Color(0xFFDDD6CA),
    edge = Color(0xFFC9C1B2),
    alertText = Color(0xFF8A6412),
    alertBg = Color(0xFFF8EECF),
    previewBg = Color(0xFFFFFDFA),
)

/** --space-*: 8-px-Raster mit Halbschritten. */
object Space {
    val s1 = 4.dp
    val s1_5 = 6.dp
    val s2 = 8.dp
    val s3 = 12.dp
    val s4 = 16.dp
    val s5 = 20.dp
    val s6 = 24.dp
    val s8 = 32.dp
}

/** --radius-*. Pillen nutzen CircleShape. */
object Radius {
    val xs = 6.dp
    val sm = 10.dp
    val md = 12.dp
    val lg = 16.dp
    val xl = 22.dp
}

/** --text-*. */
object TextSize {
    val xs3 = 10.sp
    val xs2 = 11.sp
    val xs = 12.sp
    val sm = 13.sp
    val base = 14.sp
    val md = 15.sp
    val lg = 20.sp
    val xl = 30.sp
}

val LocalImpalaColors = staticCompositionLocalOf { DarkColors }
