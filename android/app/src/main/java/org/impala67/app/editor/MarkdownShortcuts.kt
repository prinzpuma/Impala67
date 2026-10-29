package org.impala67.app.editor

/**
 * Blocktyp für ein Markdown-Kürzel am Blockanfang (TRANSFORMS in web/editor.js). [prefix] ist der
 * Text bis zum Caret; nur das volle Kürzel zählt, z. B. "# " oder "1. ".
 */
internal fun shortcutType(prefix: String): BlockType? = when (prefix) {
    "# " -> BlockType.H1
    "## " -> BlockType.H2
    "### " -> BlockType.H3
    "- ", "* ", "+ " -> BlockType.Bullet
    "1. ", "1) " -> BlockType.Number
    "[] ", "[ ] " -> BlockType.Todo
    "> " -> BlockType.Quote
    else -> null
}

/** `/befehl` direkt vor dem Caret, am Zeilenanfang oder nach einem Leerzeichen (Gruppe 1 = Suchbegriff). */
internal val SLASH_TRIGGER = Regex("""(?:^|\s)/([a-zA-ZäöüÄÖÜß0-9]*)$""")
