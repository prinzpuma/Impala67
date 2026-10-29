package org.impala67.app.editor

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.size
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.PopupProperties
import org.impala67.app.R
import org.impala67.app.ui.theme.Impala
import org.impala67.app.ui.theme.TextSize

/** Eine Slash-Eingabe: Block [blockId], Suchbegriff und Caret-Position (Markdown-Index) hinter "/befehl". */
internal data class SlashQuery(val blockId: String, val query: String, val end: Int)

/** Offenes Slash-Menü; die Eingabe schreibt hinein, das Menü liest daraus (EditorScreen hält eine Instanz). */
internal class SlashState {
    var current by mutableStateOf<SlashQuery?>(null); private set
    fun open(blockId: String, query: String, end: Int) { current = SlashQuery(blockId, query, end) }
    fun close() { current = null }
}

/**
 * Befehle des Slash-Menüs, Texte wörtlich aus SLASH in web/editor-menus.js. Nur Blöcke, die der Editor
 * nativ anlegen kann. TODO(desk): Toggle-Liste, Callout, Gleichung, Diagramm, SVG-Grafik, Tabelle,
 * 2 Spalten, Bild, PDF, Datei/Medien, Heft und „Seite verlinken“ fehlen noch.
 */
internal enum class SlashCmd(
    val key: String, val label: String, val hint: String, val glyph: String,
    val type: BlockType?, val drawable: Int? = null,
) {
    Paragraph("p", "Text", "Einfacher Absatz", "¶", BlockType.Text),
    H1("h1", "Überschrift 1", "# ", "H1", BlockType.H1),
    H2("h2", "Überschrift 2", "## ", "H2", BlockType.H2),
    H3("h3", "Überschrift 3", "### ", "H3", BlockType.H3),
    Todo("todo", "To-do-Liste", "[] ", "", BlockType.Todo, R.drawable.ic_i_check_square),
    Bullet("bullet", "Aufzählung", "- ", "•", BlockType.Bullet),
    Number("number", "Nummerierte Liste", "1. ", "1.", BlockType.Number),
    Quote("quote", "Zitat", "> ", "”", BlockType.Quote),
    Code("code", "Code", "Codeblock mit Syntax", "</>", BlockType.Code),
    Divider("divider", "Trennlinie", "---", "—", null),
}

/** Befehle, deren Name oder Schlüssel [query] enthält (leer = alle), wie in web/editor-menus.js. */
internal fun slashItems(query: String): List<SlashCmd> {
    val q = query.lowercase()
    return SlashCmd.entries.filter { q.isEmpty() || it.label.lowercase().contains(q) || it.key.contains(q) }
}

/**
 * Slash-Menü am Eingabefeld von [blockId]. Das Menü nimmt den Fokus nicht (focusable = false), damit
 * die Tastatur und der Textblock offen bleiben. Ohne Treffer oder für einen anderen Block bleibt es zu.
 * TODO(desk): Auswahl per Pfeiltasten/Enter/Esc (Hardware-Tastatur) fehlt; bisher nur per Tipp.
 */
@Composable
internal fun SlashDropdown(slash: SlashState, vm: EditorViewModel, blockId: String) {
    val c = Impala.colors
    val q = slash.current?.takeIf { it.blockId == blockId }
    val items = slashItems(q?.query.orEmpty())
    DropdownMenu(
        expanded = q != null && items.isNotEmpty(),
        onDismissRequest = { slash.close() },
        properties = PopupProperties(focusable = false),
        containerColor = c.menu,
    ) {
        items.forEach { cmd ->
            DropdownMenuItem(
                text = {
                    Column {
                        Text(cmd.label)
                        Text(cmd.hint, color = c.text2, fontSize = TextSize.xs)
                    }
                },
                onClick = {
                    slash.close()
                    q?.let { vm.applySlash(blockId, it, cmd) }
                },
                leadingIcon = { SlashIcon(cmd) },
            )
        }
    }
}

@Composable
private fun SlashIcon(cmd: SlashCmd) {
    val drawable = cmd.drawable
    if (drawable != null) {
        Icon(painterResource(drawable), null, Modifier.size(20.dp))
    } else {
        Text(cmd.glyph, Modifier.width(28.dp), color = Impala.colors.text2, textAlign = TextAlign.Center)
    }
}
