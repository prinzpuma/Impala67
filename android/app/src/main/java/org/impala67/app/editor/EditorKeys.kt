package org.impala67.app.editor

import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEvent
import androidx.compose.ui.input.key.isCtrlPressed
import androidx.compose.ui.input.key.isMetaPressed
import androidx.compose.ui.input.key.isShiftPressed
import androidx.compose.ui.input.key.key
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.TextFieldValue
import uniffi.impala_ffi.MdBlockKind

/**
 * Tastaturkürzel im Textblock (web/editor.js:1168–1275, web/editor-keys.js). [value] ist der Feldinhalt,
 * [setValue] setzt ihn (z. B. Tab im Code). `true` = verbraucht.
 */
internal fun EditorViewModel.handleBlockKey(
    e: KeyEvent,
    id: String,
    value: TextFieldValue,
    menus: EditorMenus,
    setValue: (TextFieldValue) -> Unit,
): Boolean {
    if (handleMenuKey(e, id, menus)) return true
    val b = blocks.firstOrNull { it.id == id } ?: return false
    val ctrl = e.isCtrlPressed || e.isMetaPressed
    val sel = value.selection
    val text = value.text
    val isCode = b.kind is MdBlockKind.Code
    if (ctrl && e.isShiftPressed) {
        // Strg+Shift+0–8: Blocktyp; Strg+Shift+↑/↓: Block verschieben.
        val type = when (e.key) {
            Key.Zero -> TurnInto.Text; Key.One -> TurnInto.H1; Key.Two -> TurnInto.H2; Key.Three -> TurnInto.H3
            Key.Four -> TurnInto.Todo; Key.Five -> TurnInto.Bullet; Key.Six -> TurnInto.Number
            Key.Seven -> TurnInto.Toggle; Key.Eight -> TurnInto.Code
            else -> null
        }
        if (type != null) { turnInto(id, type); return true }
        if (e.key == Key.DirectionUp) { moveBlock(id, -1); return true }
        if (e.key == Key.DirectionDown) { moveBlock(id, 1); return true }
        return false
    }
    if (ctrl) {
        return when (e.key) {
            Key.D -> { duplicateBlock(id); true }
            Key.A -> {
                // Zweistufig: erst das Feld, dann alle Blöcke (Auswahl-Modus des ersten Blocks).
                if (sel.min == 0 && sel.max == text.length) { selectAll(); true } else false
            }
            else -> false
        }
    }
    val atStart = sel.collapsed && sel.start == 0
    val atEnd = sel.collapsed && sel.start == text.length
    return when (e.key) {
        Key.Escape -> { activate(id, EditMode.Select, 0); true }
        Key.Tab -> if (isCode && !e.isShiftPressed) {
            val t = text.replaceRange(sel.min, sel.max, "  ")
            setValue(TextFieldValue(t, TextRange(sel.min + 2)))
            setText(id, t)
            true
        } else false
        Key.Enter -> if (e.isShiftPressed && !isCode) {
            // Shift+Enter: weicher Umbruch im Block (editor-keys.js:25).
            val t = text.replaceRange(sel.min, sel.max, "\n")
            setValue(TextFieldValue(t, TextRange(sel.min + 1)))
            setText(id, t)
            true
        } else false
        Key.Backspace -> if (isCode && text.isEmpty()) { turnInto(id, TurnInto.Text); true } else false
        Key.Delete -> if (atEnd) { joinNext(id); true } else false
        Key.DirectionUp -> if (sel.collapsed && !text.substring(0, sel.start).contains('\n')) focusNeighbor(id, -1) else false
        Key.DirectionDown -> if (sel.collapsed && !text.substring(sel.start).contains('\n')) focusNeighbor(id, 1) else false
        else -> false
    }
}

/** ↑/↓, Enter/Tab und Esc im offenen Slash- oder Link-Menü (editor.js:1168–1181). */
private fun EditorViewModel.handleMenuKey(e: KeyEvent, id: String, menus: EditorMenus): Boolean {
    val slash = menus.slash.current?.takeIf { it.blockId == id }
    val link = menus.links.current?.takeIf { it.blockId == id }
    if (slash == null && link == null) return false
    val count = if (slash != null) slashItems(slash.query).size else linkItems(linkPages.value.orEmpty(), pageId, link!!.query).size
    if (count == 0) return false
    fun move(d: Int) {
        if (slash != null) menus.slash.selected = (menus.slash.selected + d + count) % count
        else menus.links.selected = (menus.links.selected + d + count) % count
    }
    return when (e.key) {
        Key.DirectionDown -> { move(1); true }
        Key.DirectionUp -> { move(-1); true }
        Key.Escape -> { menus.close(); true }
        Key.Enter, Key.NumPadEnter, Key.Tab -> {
            if (slash != null) {
                val cmd = slashItems(slash.query).getOrNull(menus.slash.selected) ?: return false
                menus.slash.close()
                applySlash(id, slash, cmd, menus)
            } else {
                val page = linkItems(linkPages.value.orEmpty(), pageId, link!!.query).getOrNull(menus.links.selected) ?: return false
                menus.links.close()
                applyLink(id, link, page)
            }
            true
        }
        else -> false
    }
}

/** Strg+Shift+↑/↓: Block um eine Stelle verschieben (editor.js:1266–1275). */
internal fun EditorViewModel.moveBlock(id: String, delta: Int) {
    val i = blocks.indexOfFirst { it.id == id }
    val j = i + delta
    if (i < 0 || j !in blocks.indices) return
    mutate(true) { list -> list.toMutableList().apply { add(j, removeAt(i)) } }
    active?.let { activate(it.id, it.mode, cursor) }
}

/** Entf am Blockende: den nächsten Textblock anhängen (editor-keys.js:159–180). */
private fun EditorViewModel.joinNext(id: String) {
    val i = blocks.indexOfFirst { it.id == id }
    val b = blocks.getOrNull(i) ?: return
    val next = blocks.getOrNull(i + 1) ?: return
    if (!next.isText()) return
    val join = b.text().length
    mutate(true) { list -> list.take(i) + b.withText(b.text() + next.text()) + list.drop(i + 2) }
    activate(id, EditMode.Text, join)
}

/** ↑ am Anfang bzw. ↓ am Ende: in den Nachbarblock wechseln (editor-keys.js:182–200). */
private fun EditorViewModel.focusNeighbor(id: String, dir: Int): Boolean {
    val i = blocks.indexOfFirst { it.id == id }
    val n = blocks.getOrNull(i + dir) ?: return false
    if (n.isText()) activate(n.id, EditMode.Text, if (dir < 0) n.text().length else 0)
    else activate(n.id, EditMode.Select, 0)
    return true
}

/** Strg+A zum zweiten Mal: alle Blöcke auswählen (hier: Auswahl-Modus, Kopieren/Löschen über das Blockmenü). */
private fun EditorViewModel.selectAll() {
    val first = blocks.firstOrNull() ?: return
    activate(first.id, EditMode.Select, 0)
}
