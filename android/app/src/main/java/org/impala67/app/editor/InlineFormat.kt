package org.impala67.app.editor

import androidx.compose.material3.AlertDialog
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEvent
import androidx.compose.ui.input.key.isCtrlPressed
import androidx.compose.ui.input.key.isMetaPressed
import androidx.compose.ui.input.key.isShiftPressed
import androidx.compose.ui.input.key.key
import androidx.compose.ui.text.input.KeyboardType
import uniffi.impala_ffi.MdBlockKind

/** Inline-Formate der Tastenkürzel (editor.js 1228–1237); Marker wie im Markdown der Seite. */
internal enum class InlineFormat(val before: String, val after: String, val label: String) {
    Bold("**", "**", "Fett"),
    Italic("*", "*", "Kursiv"),
    Underline("<u>", "</u>", "Unterstrichen"),
    Code("`", "`", "Code"),
    Strike("~~", "~~", "Durchgestrichen"),
    Highlight("{bg-yellow}", "{/}", "Markieren"),
}

/** Link-Adresse für die Auswahl [start]–[end] im Block [id] abfragen (Strg+K, „Link-Adresse:“). */
internal data class LinkPrompt(val id: String, val start: Int, val end: Int)

/**
 * `wrapSelection` (editor.js): Auswahl mit Markern umschließen – oder, wenn sie schon umschlossen ist,
 * die Marker entfernen. Kursiv entfettet **Fett** dabei nicht. Liefert neuen Text und Caret-Position.
 * Ohne Auswahl entsteht ein leeres Markerpaar mit dem Caret dazwischen.
 */
internal fun wrapMarkers(text: String, start: Int, end: Int, before: String, after: String): Pair<String, Int> {
    val s = start.coerceIn(0, text.length)
    val e = end.coerceIn(s, text.length)
    val pre = text.substring(0, s)
    val mid = text.substring(s, e)
    val post = text.substring(e)
    val midIsWrapped = mid.startsWith(before) && mid.endsWith(after) && mid.length >= before.length + after.length &&
        (before != "*" || (mid.startsWith("***") && mid.endsWith("***")) || (!mid.startsWith("**") && !mid.endsWith("**")))
    return when {
        mid.isEmpty() -> Pair(pre + before + after + post, s + before.length)
        midIsWrapped -> {
            val inner = mid.substring(before.length, mid.length - after.length)
            Pair(pre + inner + post, s + inner.length)
        }
        pre.endsWith(before) && post.startsWith(after) ->
            Pair(pre.dropLast(before.length) + mid + post.drop(after.length), s - before.length + mid.length)
        else -> Pair(pre + before + mid + after + post, s + before.length + mid.length + after.length)
    }
}

/** Auswahl im aktiven Textblock formatieren (Tasten und Werkzeugleiste). Codeblöcke bleiben roh. */
internal fun EditorViewModel.formatInline(before: String, after: String) {
    val a = active?.takeIf { it.mode == EditMode.Text } ?: return
    val b = blocks.firstOrNull { it.id == a.id }?.takeIf { it.kind !is MdBlockKind.Code } ?: return
    val (text, caret) = wrapMarkers(b.text(), selectionStart, selectionEnd, before, after)
    setTextAt(a.id, text, caret)
}

internal fun EditorViewModel.formatInline(f: InlineFormat) = formatInline(f.before, f.after)

/** Strg+K bzw. Link-Knopf: Adresse abfragen, die Auswahl bleibt gemerkt. */
internal fun EditorViewModel.askLink() {
    val a = active?.takeIf { it.mode == EditMode.Text } ?: return
    if (blocks.firstOrNull { it.id == a.id }?.kind is MdBlockKind.Code) return
    linkPrompt = LinkPrompt(a.id, selectionStart, selectionEnd)
}

internal fun EditorViewModel.finishLink(url: String?) {
    val p = linkPrompt ?: return
    linkPrompt = null
    val full = blocks.firstOrNull { it.id == p.id }?.text() ?: return
    if (url.isNullOrBlank()) { activate(p.id, EditMode.Text, p.end.coerceAtMost(full.length)); return }
    val href = url.trim()
    // Ohne Auswahl wird die Adresse selbst zum Linktext.
    val (text, caret) = if (p.start == p.end) {
        val at = p.start.coerceIn(0, full.length)
        val link = "[$href]($href)"
        Pair(full.substring(0, at) + link + full.substring(at), at + link.length)
    } else wrapMarkers(full, p.start, p.end, "[", "]($href)")
    setTextAt(p.id, text, caret)
}

/** Tastenkürzel im Textfeld (Hardware-Tastatur): Formate, Link, Rückgängig/Wiederholen. */
internal fun EditorViewModel.handleFormatKey(e: KeyEvent): Boolean {
    if (!e.isCtrlPressed && !e.isMetaPressed) return false
    val shift = e.isShiftPressed
    when {
        !shift && e.key == Key.B -> formatInline(InlineFormat.Bold)
        !shift && e.key == Key.I -> formatInline(InlineFormat.Italic)
        !shift && e.key == Key.U -> formatInline(InlineFormat.Underline)
        !shift && e.key == Key.E -> formatInline(InlineFormat.Code)
        shift && e.key == Key.S -> formatInline(InlineFormat.Strike)
        shift && e.key == Key.H -> formatInline(InlineFormat.Highlight)
        !shift && e.key == Key.K -> askLink()
        !shift && e.key == Key.Z -> undo()
        e.key == Key.Y || (shift && e.key == Key.Z) -> redo()
        else -> return false
    }
    return true
}

@Composable
internal fun LinkPromptDialog(vm: EditorViewModel) {
    if (vm.linkPrompt == null) return
    var url by rememberSaveable { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = { vm.finishLink(null) },
        title = { Text("Link einfügen") },
        text = {
            OutlinedTextField(
                url, { url = it }, Modifier.fillMaxWidth(), singleLine = true, label = { Text("Link-Adresse") },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
            )
        },
        confirmButton = { TextButton({ vm.finishLink(url) }, enabled = url.isNotBlank()) { Text("Einfügen") } },
        dismissButton = { TextButton({ vm.finishLink(null) }) { Text("Abbrechen") } },
    )
}
