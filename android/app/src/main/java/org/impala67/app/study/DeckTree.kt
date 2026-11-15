package org.impala67.app.study

import uniffi.impala_ffi.DeckEntry
import uniffi.impala_ffi.DeckOverview

/**
 * Stapel hierarchisch einordnen (Unterstapel direkt unter ihrem Eltern-Stapel, wie `ankiDecksHtml`);
 * die Reihenfolge bestimmt der Kern. Eingeklappte Äste entfallen.
 */
fun flattenDecks(overview: List<DeckOverview>, collapsed: Set<String>): List<DeckEntry> =
    uniffi.impala_ffi.flattenDecks(overview, collapsed.toList())
