package org.impala67.app.editor

import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.launch
import org.impala67.app.notes.pageTitle
import uniffi.impala_ffi.MdBlock
import uniffi.impala_ffi.MdBlockKind
import uniffi.impala_ffi.PageSummary
import uniffi.impala_ffi.blocksToMarkdown
import uniffi.impala_ffi.markdownPlainText
import uniffi.impala_ffi.markdownToBlocks

/** Block in einen Textblock wandeln; [rest] ersetzt den Text, der Caret landet bei [caret]. */
internal fun EditorViewModel.retype(id: String, type: BlockType, rest: String, caret: Int) {
    mutate(true) { list -> list.map { if (it.id == id) it.withText(rest).convertTo(type) else it } }
    activate(id, EditMode.Text, caret)
}

/** Slash-Befehl gewählt: "/suchbegriff" vor dem Caret entfällt, dann wirkt der Befehl (applySlash). */
internal fun EditorViewModel.applySlash(id: String, q: SlashQuery, cmd: SlashCmd, menus: EditorMenus) {
    val full = blocks.firstOrNull { it.id == id }?.text() ?: return
    val end = q.end.coerceIn(0, full.length)
    val start = end - q.query.length - 1
    val cut = start >= 0 && full.getOrNull(start) == '/'
    val rest = if (cut) full.removeRange(start, end) else full
    val caret = if (cut) start else end
    val type = cmd.type
    when {
        type != null -> retype(id, type, rest, caret)
        cmd == SlashCmd.Divider -> insertDivider(id, rest)
        cmd in STRUCTURE -> insertStructure(id, rest, cmd)
        cmd == SlashCmd.Link -> {
            // „[[“ an die Caret-Stelle, dann sofort das Link-Menü.
            val withLink = rest.substring(0, caret) + "[[" + rest.substring(caret)
            setTextAt(id, withLink, caret + 2)
            menus.links.open(id, "", caret + 2)
        }
        cmd == SlashCmd.Heft -> { setTextAt(id, rest, caret); insertHeft(id) }
        else -> {
            setTextAt(id, rest, caret)
            menus.pick(id, if (cmd == SlashCmd.Image) MediaKind.Image else if (cmd == SlashCmd.Pdf) MediaKind.Pdf else MediaKind.File)
        }
    }
}

internal fun EditorViewModel.setTextAt(id: String, text: String, caret: Int) {
    mutate(true) { list -> list.map { if (it.id == id) it.withText(text) else it } }
    activate(id, EditMode.Text, caret)
}

/** Trennlinie: der Block wird zur Linie, der Rest steht darunter in einem neuen Absatz (wie "---" in editor.js). */
internal fun EditorViewModel.insertDivider(id: String, rest: String) {
    val i = blocks.indexOfFirst { it.id == id }.takeIf { it >= 0 } ?: return
    val after = paragraph(rest)
    mutate(true) { list -> list.take(i) + newBlock(MdBlockKind.Divider) + after + list.drop(i + 1) }
    activate(after.id, EditMode.Text, 0)
}

private val STRUCTURE = setOf(SlashCmd.Toggle, SlashCmd.Callout, SlashCmd.Math, SlashCmd.Mermaid, SlashCmd.Svg, SlashCmd.Table, SlashCmd.Columns)

/**
 * Strukturblock aus dem Slash-Menü (`applySlash`, Blöcke wie `newBlock` in editor.js): Callout und Toggle
 * nehmen den Resttext auf, sonst bleibt er als eigener Block davor stehen. Danach wird der neue Block
 * bearbeitet – Codeblöcke als Text, alles andere als Markdown-Rohtext.
 */
private fun EditorViewModel.insertStructure(id: String, rest: String, cmd: SlashCmd) {
    val i = blocks.indexOfFirst { it.id == id }.takeIf { it >= 0 } ?: return
    val nb = newBlock(
        when (cmd) {
            SlashCmd.Toggle -> MdBlockKind.Toggle(rest, true, listOf(paragraph()))
            SlashCmd.Callout -> MdBlockKind.Callout("blue", listOf(paragraph(rest)))
            SlashCmd.Mermaid -> MdBlockKind.Code("mermaid", "")
            SlashCmd.Svg -> MdBlockKind.Code("svg", "")
            SlashCmd.Table -> MdBlockKind.Table(listOf(listOf("", ""), listOf("", "")))
            SlashCmd.Columns -> MdBlockKind.Columns(listOf(listOf(paragraph()), listOf(paragraph())))
            else -> MdBlockKind.Math("")
        },
    )
    val keep = rest.isNotEmpty() && cmd != SlashCmd.Toggle && cmd != SlashCmd.Callout
    mutate(true) { list -> list.take(i) + (if (keep) listOf(list[i].withText(rest), nb) else listOf(nb)) + list.drop(i + 1) }
    activate(nb.id, if (nb.kind is MdBlockKind.Code) EditMode.Text else EditMode.Raw, 0)
}

/** `applyLink` (editor-menus.js): „[[suche“ vor dem Caret wird zu `[Titel](#id)`, Text dahinter bleibt. */
internal fun EditorViewModel.applyLink(id: String, q: LinkQuery, page: PageSummary) {
    val full = blocks.firstOrNull { it.id == id }?.text() ?: return
    val end = q.end.coerceIn(0, full.length)
    val start = full.lastIndexOf("[[", end - 2)
    // Eckige Klammern im Titel beendeten den Link-Text vorzeitig.
    val link = "[" + pageTitle(page).replace(Regex("[\\[\\]]"), "") + "](#" + page.id + ")"
    val text = if (start >= 0) full.substring(0, start) + link + full.substring(end) else full + link
    setTextAt(id, text, if (start >= 0) start + link.length else text.length)
}

/** Plus im Griff: neuer Absatz mit „/“ darunter, das Slash-Menü öffnet sofort. */
internal fun EditorViewModel.insertSlashBelow(id: String, menus: EditorMenus) {
    val i = blocks.indexOfFirst { it.id == id }.takeIf { it >= 0 } ?: return
    val b = paragraph("/")
    mutate(true) { list -> list.take(i + 1) + b + list.drop(i + 1) }
    activate(b.id, EditMode.Text, 1)
    menus.slash.open(b.id, "", 1)
}

// ---- Blockmenü (editor-menus.js `openBlockMenu`, Aktionen in editor.js) ----

/** Ziele von „Umwandeln in“ (TURN_TYPES in editor-menus.js); Toggle und Callout sind keine Textblöcke. */
internal enum class TurnInto(val label: String, val type: BlockType?) {
    Text("Text", BlockType.Text), H1("Überschrift 1", BlockType.H1), H2("Überschrift 2", BlockType.H2),
    H3("Überschrift 3", BlockType.H3), Todo("To-do-Liste", BlockType.Todo), Bullet("Aufzählung", BlockType.Bullet),
    Number("Nummerierte Liste", BlockType.Number), Toggle("Toggle-Liste", null), Quote("Zitat", BlockType.Quote),
    Callout("Callout", null), Code("Code", BlockType.Code),
}

/** Text eines Blocks ohne Struktur (`plainTextOf`): Toggle-Titel und Kinder von Toggle/Callout. */
private fun MdBlock.plainText(): String = when (val k = kind) {
    is MdBlockKind.Toggle -> (listOf(k.summary) + k.children.map { it.text() }).filter { it.isNotBlank() }.joinToString(" ")
    is MdBlockKind.Callout -> k.children.map { it.text() }.filter { it.isNotBlank() }.joinToString(" ")
    else -> text()
}

/** `turnInto` (editor.js): Textblöcke behalten ihren Text, Toggle/Callout behalten Kinder bzw. Klartext. */
internal fun EditorViewModel.turnInto(id: String, to: TurnInto) {
    val b = blocks.firstOrNull { it.id == id } ?: return
    val k = b.kind
    val texty = b.isText() && k !is MdBlockKind.Code
    val type = to.type
    val nb = when {
        type != null -> (if (b.isText()) b else b.copy(kind = MdBlockKind.Paragraph(b.plainText()))).convertTo(type)
        to == TurnInto.Toggle -> if (k is MdBlockKind.Toggle) return else
            b.copy(kind = MdBlockKind.Toggle(if (texty) b.text() else "", true, (k as? MdBlockKind.Callout)?.children ?: listOf(paragraph())))
        else -> if (k is MdBlockKind.Callout) return else
            b.copy(kind = MdBlockKind.Callout("blue", listOf(paragraph(if (texty) b.text() else b.plainText()))))
    }
    mutate(true) { list -> list.map { if (it.id == id) nb else it } }
    if (nb.isText()) activate(id, EditMode.Text, nb.text().length) else activate(id, EditMode.Raw, 0)
}

/** Farbe setzen: Text- und Hintergrundfarbe schließen sich aus; [name] `null` entfernt beide. */
internal fun EditorViewModel.setBlockColor(id: String, name: String?, background: Boolean) = mutate(true) { list ->
    list.map {
        if (it.id != id) it
        else if (name == null) it.copy(textColor = null, bgColor = null)
        else if (background) it.copy(textColor = null, bgColor = name)
        else it.copy(textColor = name, bgColor = null)
    }
}

/** Kopie direkt darunter; über Markdown, damit auch verschachtelte Blöcke neue IDs bekommen. */
internal fun EditorViewModel.duplicateBlock(id: String) {
    val i = blocks.indexOfFirst { it.id == id }.takeIf { it >= 0 } ?: return
    val copy = markdownToBlocks(blocksToMarkdown(listOf(blocks[i])))
    mutate(true) { list -> list.take(i + 1) + copy + list.drop(i + 1) }
}

internal fun EditorViewModel.deleteBlock(id: String) {
    mutate(true) { list -> list.filter { it.id != id } }
    if (active?.id == id) clearActive()
}

/** „Lernkarte erstellen“: Klartext des Blocks als Vorderseite, Rückseite leer, mit Verweis auf die Seite. */
internal suspend fun EditorViewModel.cardFromBlock(id: String): Boolean {
    val b = blocks.firstOrNull { it.id == id } ?: return false
    val front = markdownPlainText(b.text())
    store.write { it.createCard(front, "", null, pageId) }
    return true
}

// ---- Medien ----

/**
 * Neuer Bild-/Dateiblock hinter [afterId] (`insertFileBlock`): ein leerer Textblock wird ersetzt. Liefert
 * die ID des neuen Blocks, damit mehrere Dateien der Reihe nach folgen.
 */
internal fun EditorViewModel.insertMediaBlock(afterId: String?, kind: MdBlockKind): String {
    val nb = newBlock(kind)
    mutate(true) { list ->
        val i = list.indexOfFirst { it.id == afterId }
        val b = list.getOrNull(i)
        when {
            b == null -> list + nb
            b.isText() && b.kind !is MdBlockKind.Code && b.text().isBlank() -> list.take(i) + nb + list.drop(i + 1)
            else -> list.take(i + 1) + nb + list.drop(i + 1)
        }
    }
    if (active?.id == afterId) clearActive()
    return nb.id
}

/** Slash „Heft“: neues Heft als Unterseite anlegen und dahinter einbetten. */
private fun EditorViewModel.insertHeft(afterId: String) {
    viewModelScope.launch {
        val heftId = runCatching { store.write { it.createHeft("Heft", pageId, null) } }.getOrNull() ?: return@launch
        val i = blocks.indexOfFirst { it.id == afterId }.takeIf { it >= 0 } ?: return@launch
        mutate(true) { list -> list.take(i + 1) + newBlock(MdBlockKind.Heft(heftId)) + list.drop(i + 1) }
    }
}
