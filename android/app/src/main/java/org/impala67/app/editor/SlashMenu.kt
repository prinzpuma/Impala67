package org.impala67.app.editor

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.runtime.mutableIntStateOf
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
    /** Mit ↑/↓ gewählter Eintrag (Enter/Tab übernimmt ihn). */
    var selected by mutableIntStateOf(0)
    fun open(blockId: String, query: String, end: Int) {
        if (current?.query != query || current?.blockId != blockId) selected = 0
        current = SlashQuery(blockId, query, end)
    }
    fun close() { current = null }
}

/** Menüs am Eingabefeld: Slash, „[[“-Links und die Dateiauswahl für Bild/PDF/Datei. */
internal class EditorMenus(val slash: SlashState, val links: LinkState, val pick: (blockId: String, kind: MediaKind) -> Unit) {
    fun close() { slash.close(); links.close() }
}

/**
 * Befehle des Slash-Menüs, Texte wörtlich aus SLASH in web/editor-menus.js. Nur Blöcke, die der Editor
 * nativ anlegen kann. Strukturblöcke (Toggle, Callout, Gleichung, Tabelle, Spalten) öffnen danach
 * gleich ihren Markdown-Rohtext, Diagramm und SVG sind Codeblöcke mit eigener Sprache.
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
    Toggle("toggle", "Toggle-Liste", "> aufklappbar", "▸", null),
    Quote("quote", "Zitat", "> ", "”", BlockType.Quote),
    Callout("callout", "Callout", "Hervorgehobener Kasten", "", null, R.drawable.ic_i_bulb),
    Code("code", "Code", "Codeblock mit Syntax", "</>", BlockType.Code),
    Math("math", "Gleichung", "KaTeX-Formel", "√", null),
    Mermaid("mermaid", "Diagramm", "Mermaid: Ablauf, Zustände, Zeitachse", "", null, R.drawable.ic_i_graph),
    Svg("svg", "SVG-Grafik", "Zeichnung als SVG-Code", "", null, R.drawable.ic_i_pen_tool),
    Table("table", "Tabelle", "Einfache Tabelle", "▦", null),
    Columns("columns", "2 Spalten", "Nebeneinander", "", null, R.drawable.ic_i_columns),
    Divider("divider", "Trennlinie", "---", "—", null),
    Image("image", "Bild", "Hochladen", "", null, R.drawable.ic_i_image),
    Pdf("pdf", "PDF", "PDF einbetten", "", null, R.drawable.ic_i_file),
    File("file", "Datei / Medien", "Video, Audio, Sonstige", "", null, R.drawable.ic_i_paperclip),
    Heft("heft", "Heft", "Handschrift-Einbettung", "", null, R.drawable.ic_i_notebook),
    Link("link", "Seite verlinken", "[[", "", null, R.drawable.ic_i_link),
}

/** Befehle, deren Name oder Schlüssel [query] enthält (leer = alle), wie in web/editor-menus.js. */
internal fun slashItems(query: String): List<SlashCmd> {
    val q = query.lowercase()
    return SlashCmd.entries.filter { q.isEmpty() || it.label.lowercase().contains(q) || it.key.contains(q) }
}

/**
 * Slash-Menü am Eingabefeld von [blockId]. Das Menü nimmt den Fokus nicht (focusable = false), damit
 * die Tastatur und der Textblock offen bleiben. Ohne Treffer oder für einen anderen Block bleibt es zu.
 * Pfeiltasten, Enter/Tab und Esc behandelt das Textfeld ([handleMenuKey]).
 */
@Composable
internal fun SlashDropdown(menus: EditorMenus, vm: EditorViewModel, blockId: String) {
    val c = Impala.colors
    val slash = menus.slash
    val q = slash.current?.takeIf { it.blockId == blockId }
    val items = slashItems(q?.query.orEmpty())
    DropdownMenu(
        expanded = q != null && items.isNotEmpty(),
        onDismissRequest = { slash.close() },
        properties = PopupProperties(focusable = false),
        containerColor = c.menu,
    ) {
        items.forEachIndexed { i, cmd ->
            DropdownMenuItem(
                modifier = if (i == slash.selected) Modifier.background(c.hoverBg) else Modifier,
                text = {
                    Column {
                        Text(cmd.label)
                        Text(cmd.hint, color = c.text2, fontSize = TextSize.xs)
                    }
                },
                onClick = {
                    slash.close()
                    q?.let { vm.applySlash(blockId, it, cmd, menus) }
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
