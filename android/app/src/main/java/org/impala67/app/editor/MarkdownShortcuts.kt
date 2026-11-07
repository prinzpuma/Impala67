package org.impala67.app.editor

import uniffi.impala_ffi.MdShortcutType
import uniffi.impala_ffi.mdShortcutType

/**
 * Blocktyp für ein Markdown-Kürzel am Blockanfang (TRANSFORMS in web/editor.js). [prefix] ist der
 * Text bis zum Caret; nur das volle Kürzel zählt, z. B. "# " oder "1. ".
 */
internal fun shortcutType(prefix: String): BlockType? {
    val res = mdShortcutType(prefix) ?: return null
    if (res.rest.isNotEmpty()) return null
    return when (res.shortcutType) {
        MdShortcutType.H1 -> BlockType.H1
        MdShortcutType.H2 -> BlockType.H2
        MdShortcutType.H3 -> BlockType.H3
        MdShortcutType.Bullet -> BlockType.Bullet
        MdShortcutType.Number -> BlockType.Number
        is MdShortcutType.Todo -> BlockType.Todo
        MdShortcutType.Quote -> BlockType.Quote
        MdShortcutType.Code -> null
    }
}

/** `/befehl` direkt vor dem Caret, am Zeilenanfang oder nach einem Leerzeichen (Gruppe 1 = Suchbegriff). */
internal val SLASH_TRIGGER = Regex("""(?:^|\s)/([a-zA-ZäöüÄÖÜß0-9]*)$""")
