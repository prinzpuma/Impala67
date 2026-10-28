package org.impala67.app.study

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.Text
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import org.impala67.app.ui.theme.Impala
import uniffi.impala_ffi.CoreException
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.TimeZone

/** Versatz der Ortszeit zu UTC für die Tagesgrenze des Kerns (MEZ +60, MESZ +120). */
fun utcOffsetMinutes(): Int = TimeZone.getDefault().getOffset(System.currentTimeMillis()) / 60_000

/** Name des Standard-Stapels (nicht umbenennbar, nicht löschbar). */
const val DEFAULT_DECK = "Standard"

/** Trennzeichen zwischen Eltern- und Unterstapel. */
const val DECK_SEP = "::"

/** Letzter Namensteil: „Mathe::Analysis“ → „Analysis“. */
fun deckLabel(name: String): String = name.substringAfterLast(DECK_SEP)

/** Fehlertext des Kerns ohne Typ-Präfix. */
fun Throwable.reason(): String = when (this) {
    is CoreException.Invalid -> reason
    is CoreException.Storage -> reason
    else -> message ?: "Unbekannter Fehler"
}

/** Schreibaufruf im Hintergrund; ein Fehler des Kerns landet als Text in [error]. */
fun CoroutineScope.guarded(error: MutableStateFlow<String?>, block: suspend () -> Unit) {
    launch {
        try {
            block()
        } catch (e: CoreException) {
            error.value = e.reason()
        }
    }
}

/** ISO-Zeitpunkt → „dd.MM.yyyy“ (leer bei fehlendem oder unlesbarem Wert). */
fun formatDate(iso: String): String = runCatching {
    DateTimeFormatter.ofPattern("dd.MM.yyyy").format(Instant.parse(iso).atZone(ZoneId.systemDefault()))
}.getOrDefault("")

/** ISO-Zeitpunkt → „HH:mm“. */
fun formatTime(iso: String): String = runCatching {
    DateTimeFormatter.ofPattern("HH:mm").format(Instant.parse(iso).atZone(ZoneId.systemDefault()))
}.getOrDefault("")

private val INLINE = Regex("""\*\*(.+?)\*\*|==(.+?)==|\*(.+?)\*|`(.+?)`""")
private val IMAGE = Regex("""!\[[^\]]*]\([^)]*\)""")
private val TAGS = Regex("""<[^>]+>""")

private fun AnnotatedString.Builder.inline(text: String, mark: Color, code: Color) {
    var last = 0
    for (m in INLINE.findAll(text)) {
        append(text.substring(last, m.range.first))
        val g = m.groups
        when {
            g[1] != null -> withStyle(SpanStyle(fontWeight = FontWeight.Bold)) { inline(g[1]!!.value, mark, code) }
            g[2] != null -> withStyle(SpanStyle(background = mark)) { inline(g[2]!!.value, mark, code) }
            g[3] != null -> withStyle(SpanStyle(fontStyle = FontStyle.Italic)) { inline(g[3]!!.value, mark, code) }
            else -> withStyle(SpanStyle(background = code)) { append(g[4]!!.value) }
        }
        last = m.range.last + 1
    }
    append(text.substring(last))
}

/** Markdown einer Kartenseite als Text: **fett**, ==Markierung==, *kursiv*, `Code`; Bilder/HTML entfallen. */
fun cardAnnotated(markdown: String, mark: Color, code: Color): AnnotatedString {
    val clean = markdown.replace(IMAGE, "[Bild]").replace(TAGS, "")
    return buildAnnotatedString { inline(clean, mark, code) }
}

/**
 * Anzeige einer Kartenseite. Vorerst eine kleine Inline-Darstellung (reicht für Lückentext-Karten:
 * `**[…]**` vorn, `**==Antwort==**` hinten); sobald der Editor-Teil ein `MarkdownView` liefert,
 * wird nur der Rumpf dieser Funktion ersetzt.
 */
@Composable
fun CardContent(markdown: String, modifier: Modifier = Modifier, style: TextStyle = androidx.compose.material3.MaterialTheme.typography.titleLarge) {
    val c = Impala.colors
    val text = cardAnnotated(markdown, c.accent.copy(alpha = 0.22f), c.text.copy(alpha = 0.08f))
    SelectionContainer { Text(text, modifier, style = style, color = c.text) }
}
