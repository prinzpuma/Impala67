package org.impala67.app.study

import uniffi.impala_ffi.DeckOverview

/** Eine sichtbare Zeile der Stapelübersicht. */
data class DeckEntry(val deck: DeckOverview, val depth: Int, val hasKids: Boolean, val collapsed: Boolean) {
    val name: String get() = deck.name
    val label: String get() = deckLabel(deck.name)

    /** Etwas zu lernen (Neu, Lernen oder Fällig). */
    val open: Boolean get() = deck.new + deck.learn + deck.review > 0uL
}

/**
 * Stapel hierarchisch einordnen (Unterstapel direkt unter ihrem Eltern-Stapel, wie `ankiDecksHtml`);
 * die Reihenfolge innerhalb einer Ebene bestimmt der Kern. Eingeklappte Äste entfallen.
 */
fun flattenDecks(overview: List<DeckOverview>, collapsed: Set<String>): List<DeckEntry> {
    val names = overview.associateBy { it.name }
    fun kidsOf(parent: String?): List<DeckOverview> = overview.filter { d ->
        if (parent == null) !d.name.contains(DECK_SEP)
        else d.name.startsWith(parent + DECK_SEP) && !d.name.substring(parent.length + DECK_SEP.length).contains(DECK_SEP)
    }
    val out = ArrayList<DeckEntry>()
    fun walk(parent: String?, depth: Int) {
        for (d in kidsOf(parent)) {
            val hasKids = kidsOf(d.name).isNotEmpty()
            val isCollapsed = hasKids && d.name in collapsed
            out += DeckEntry(names.getValue(d.name), depth, hasKids, isCollapsed)
            if (!isCollapsed) walk(d.name, depth + 1)
        }
    }
    walk(null, 0)
    return out
}
