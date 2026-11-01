package org.impala67.app.editor

import org.impala67.app.notes.pageTitle
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

private fun EditorViewModel.setTextAt(id: String, text: String, caret: Int) {
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

internal fun EditorViewModel.convertBlock(id: String, type: BlockType) {
    val b = blocks.firstOrNull { it.id == id }?.takeIf { it.isText() } ?: return
    mutate(true) { list -> list.map { if (it.id == id) it.convertTo(type) else it } }
    activate(id, EditMode.Text, b.text().length)
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
    val heftId = runCatching { store.core.createHeft("Heft", pageId, null) }.getOrNull() ?: return
    val i = blocks.indexOfFirst { it.id == afterId }.takeIf { it >= 0 } ?: return
    mutate(true) { list -> list.take(i + 1) + newBlock(MdBlockKind.Heft(heftId)) + list.drop(i + 1) }
}
