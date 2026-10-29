package org.impala67.app.editor

import uniffi.impala_ffi.MdBlockKind

/** Block in einen Textblock wandeln; [rest] ersetzt den Text, der Caret landet bei [caret]. */
internal fun EditorViewModel.retype(id: String, type: BlockType, rest: String, caret: Int) {
    mutate(true) { list -> list.map { if (it.id == id) it.withText(rest).convertTo(type) else it } }
    activate(id, EditMode.Text, caret)
}

/** Slash-Befehl gewählt: "/suchbegriff" vor dem Caret entfällt, dann wird der Block gewandelt (applySlash). */
internal fun EditorViewModel.applySlash(id: String, q: SlashQuery, cmd: SlashCmd) {
    val full = blocks.firstOrNull { it.id == id }?.text() ?: return
    val end = q.end.coerceIn(0, full.length)
    val start = end - q.query.length - 1
    val cut = start >= 0 && full.getOrNull(start) == '/'
    val rest = if (cut) full.removeRange(start, end) else full
    val caret = if (cut) start else end
    val type = cmd.type
    if (type != null) retype(id, type, rest, caret) else insertDivider(id, rest)
}

/** Trennlinie: der Block wird zur Linie, der Rest steht darunter in einem neuen Absatz (wie "---" in editor.js). */
internal fun EditorViewModel.insertDivider(id: String, rest: String) {
    val i = blocks.indexOfFirst { it.id == id }.takeIf { it >= 0 } ?: return
    val after = paragraph(rest)
    mutate(true) { list -> list.take(i) + newBlock(MdBlockKind.Divider) + after + list.drop(i + 1) }
    activate(after.id, EditMode.Text, 0)
}
