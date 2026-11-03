package org.impala67.app.editor

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.text.InlineTextContent
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.Placeholder
import androidx.compose.ui.text.PlaceholderVerticalAlign
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.sp

/** Kennung der Inline-Formeln im [AnnotatedString] (`appendInlineContent`), danach folgt der TeX-Text. */
internal const val MATH_PREFIX = "math:"

// Tag, unter dem Compose `appendInlineContent` ablegt (foundation `InlineTextContent.kt`).
private const val INLINE_TAG = "androidx.compose.foundation.text.inlineContent"

/** Gemessene Größe je Formel (dp), damit Platzhalter beim nächsten Zeichnen sofort passen. */
private val mathSizes = mutableStateMapOf<String, Pair<Float, Float>>()

/**
 * Text mit Inline-Formeln (`$…$`, `\(…\)`) wie in der PWA als KaTeX gesetzt (editor-inline.js
 * `.inline-math`). Ohne Formeln ist das ein normales [Text].
 */
@Composable
internal fun MathText(text: AnnotatedString, modifier: Modifier = Modifier, style: TextStyle = TextStyle.Default) {
    val ids = remember(text) { text.getStringAnnotations(INLINE_TAG, 0, text.length).map { it.item }.filter { it.startsWith(MATH_PREFIX) }.distinct() }
    if (ids.isEmpty()) {
        Text(text, modifier, style = style)
        return
    }
    val fontScale = LocalDensity.current.fontScale
    val content = ids.associateWith { id ->
        val tex = id.removePrefix(MATH_PREFIX)
        // Vor dem ersten Messen grob: 0,55 em je Zeichen.
        val (w, h) = mathSizes[id] ?: ((tex.length * 9f).coerceAtLeast(12f) to 20f)
        InlineTextContent(Placeholder((w / fontScale).sp, (h / fontScale).sp, PlaceholderVerticalAlign.TextCenter)) {
            InlineMathView(tex, onSize = { nw, nh -> if (mathSizes[id] != (nw to nh)) mathSizes[id] = nw to nh }, Modifier.fillMaxSize())
        }
    }
    Text(text, modifier, style = style, inlineContent = content)
}
