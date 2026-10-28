package org.impala67.app.editor

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.OffsetMapping
import androidx.compose.ui.text.input.TransformedText
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.withStyle
import org.impala67.app.ui.theme.ImpalaColors

/**
 * Inline-Markdown der PWA (web/editor-inline.js `inlineHtml`) als [AnnotatedString]: fett, kursiv,
 * durchgestrichen, unterstrichen, Markierung, Farben, Code, Formeln, Links und `[[Wiki-Links]]`.
 * Block-Markdown kommt nie hierher, sondern aus dem Kern (`markdownToBlocks`).
 *
 * Zwei Arten: Anzeige ([keepMarkers] = false, Zeichen verschwinden, Links sind klickbar) und
 * Bearbeiten ([keepMarkers] = true, der Text bleibt zeichengleich, Markierungen sind nur abgeblendet,
 * damit die Cursor-Positionen stimmen).
 */
internal class InlineStyler(
    private val c: ImpalaColors,
    private val keepMarkers: Boolean,
    private val onLink: (String) -> Unit = {},
) {
    fun build(text: String): AnnotatedString = buildAnnotatedString { render(text) }

    private fun AnnotatedString.Builder.marker(s: String) {
        if (!keepMarkers) return
        withStyle(SpanStyle(color = c.text2.copy(alpha = 0.55f))) { append(s) }
    }

    private fun AnnotatedString.Builder.wrap(open: String, inner: String, close: String, style: SpanStyle) {
        marker(open)
        withStyle(style) { render(inner) }
        marker(close)
    }

    private fun AnnotatedString.Builder.render(text: String) {
        var pos = 0
        while (pos < text.length) {
            val m = PATTERN.find(text, pos) ?: break
            append(text.substring(pos, m.range.first))
            val g = m.groupValues
            when {
                g[1].isNotEmpty() -> link("[[", g[1], "]]", "wiki:" + g[1])
                g[2].isNotEmpty() -> {
                    marker("`")
                    withStyle(CODE.copy(color = rgb("red"), background = c.surfaceHover)) { append(g[2]) }
                    marker("`")
                }
                g[5].isNotEmpty() || m.value.endsWith("{/}") -> {
                    val open = "{" + g[3] + g[4] + "}"
                    val col = rgb(g[4])
                    val style = if (g[3].isNotEmpty()) SpanStyle(background = col.copy(alpha = 0.28f)) else SpanStyle(color = col)
                    wrap(open, g[5], "{/}", style)
                }
                g[6].isNotEmpty() -> wrap("==", g[6], "==", SpanStyle(background = rgb("yellow").copy(alpha = 0.35f)))
                g[7].isNotEmpty() -> wrap("***", g[7], "***", SpanStyle(fontWeight = FontWeight.Bold, fontStyle = FontStyle.Italic))
                g[8].isNotEmpty() -> wrap("**", g[8], "**", SpanStyle(fontWeight = FontWeight.Bold))
                g[9].isNotEmpty() -> wrap("~~", g[9], "~~", SpanStyle(textDecoration = TextDecoration.LineThrough))
                g[10].isNotEmpty() -> wrap("<u>", g[10], "</u>", SpanStyle(textDecoration = TextDecoration.Underline))
                g[11].isNotEmpty() -> wrap("*", g[11], "*", SpanStyle(fontStyle = FontStyle.Italic))
                g[12].isNotEmpty() -> {
                    val href = g[13]
                    if (SAFE.containsMatchIn(href)) link("[", g[12], "]($href)", href) else append(m.value)
                }
                g[14].isNotEmpty() -> {
                    marker("$")
                    withStyle(CODE) { append(g[14]) }
                    marker("$")
                }
                else -> append(m.value)
            }
            pos = m.range.last + 1
        }
        append(text.substring(pos))
    }

    private fun AnnotatedString.Builder.link(open: String, label: String, close: String, target: String) {
        val style = SpanStyle(color = c.accent, textDecoration = TextDecoration.Underline)
        marker(open)
        if (keepMarkers) {
            withStyle(style) { append(label) }
        } else {
            withLink(LinkAnnotation.Clickable(target, TextLinkStyles(style)) { onLink(target) }) { append(label) }
        }
        marker(close)
    }

    private fun rgb(name: String): Color = inlineColor(name, c.isDark)

    private companion object {
        val CODE = SpanStyle(fontFamily = FontFamily.Monospace)
        val SAFE = Regex("""^(https?:|mailto:|tel:|#)""", RegexOption.IGNORE_CASE)

        // Reihenfolge wie in editor-inline.js; Gruppen 1..14, siehe `render`.
        val PATTERN = Regex(
            listOf(
                """\[\[([^\]\n]+)\]\]""",
                "`([^`\\n]+)`",
                """\{(bg-)?(gray|red|orange|yellow|green|blue|purple|pink)\}([\s\S]*?)\{/\}""",
                """==([^=\n]+)==""",
                """\*\*\*([^*]+)\*\*\*""",
                """\*\*([^*]+)\*\*""",
                """~~([^~]+)~~""",
                """<u>([\s\S]*?)</u>""",
                """(?<![*\\])\*([^*\n]+)\*""",
                """\[([^\]]+)\]\(([^)\s]+)\)""",
                """(?<!\\)\$([^${'$'}\n]+?)(?<!\\)\$""",
            ).joinToString("|"),
        )
    }
}

/** Bearbeiten: Text bleibt zeichengleich, nur die Darstellung ändert sich. */
internal class InlineTransformation(private val styler: InlineStyler) : VisualTransformation {
    override fun filter(text: AnnotatedString) = TransformedText(styler.build(text.text), OffsetMapping.Identity)
}

/** `--c-<name>` aus variables.css / `body.light`. */
internal fun inlineColor(name: String, dark: Boolean): Color {
    val v = if (dark) {
        when (name) {
            "red" -> 0xFFFF7369; "orange" -> 0xFFFFA344; "yellow" -> 0xFFFFDC49; "green" -> 0xFF4DAB9A
            "blue" -> 0xFF529CCA; "purple" -> 0xFF9A6DD7; "pink" -> 0xFFE255A1; else -> 0xFF9B9B9B
        }
    } else {
        when (name) {
            "red" -> 0xFFC4554D; "orange" -> 0xFFCB7B37; "yellow" -> 0xFFC29343; "green" -> 0xFF548164
            "blue" -> 0xFF487CA5; "purple" -> 0xFF8A67AB; "pink" -> 0xFFB35488; else -> 0xFF787774
        }
    }
    return Color(v)
}
