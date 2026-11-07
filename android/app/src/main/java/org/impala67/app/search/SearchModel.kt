package org.impala67.app.search

import androidx.annotation.DrawableRes
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import org.impala67.app.R
import uniffi.impala_ffi.PageSummary
import uniffi.impala_ffi.PaletteActionDef
import uniffi.impala_ffi.searchFilterActions
import uniffi.impala_ffi.searchHighlightRanges
import uniffi.impala_ffi.searchPreview

/** Ein Eintrag der Suche: Seite mit Ausschnitt oder Schnell-Aktion (Ids wie in web/search.js). */
sealed interface SearchRow {
    data class Page(val page: PageSummary, val archived: Boolean, val snippet: String) : SearchRow
    data class Action(val id: String, val label: String, @DrawableRes val icon: Int) : SearchRow
}

data class SearchSection(val title: String, val rows: List<SearchRow>)

/** Texte und Aktionen der Suche (wörtlich aus search.js; Filter/Ausschnitt/Hervorhebung im Rust-Kern). */
object SearchText {
    const val PLACEHOLDER = "Suchen oder Befehl eingeben…"
    const val NOTHING = "Nichts gefunden"
    const val RECENT = "Zuletzt bearbeitet"
    const val PAGES = "Seiten"
    const val ACTIONS = "Aktionen"
    const val ACTION_KIND = "Aktion"

    /** Ausschnitt wie in search.js über den Rust-Kern (`searchPreview`). */
    fun snippet(raw: String): String = searchPreview(raw)

    /**
     * Schnell-Aktionen. Die Ids löst die Shell aus; „Helles/Dunkles Design“ entfällt, weil die App dem
     * System folgt (PORTING.md § 3).
     */
    fun actions(dueCards: Int): List<SearchRow.Action> = listOf(
        SearchRow.Action("newpage", "Neue Seite", R.drawable.ic_i_plus),
        SearchRow.Action("cards", "Karten wiederholen" + (if (dueCards > 0) " — $dueCards fällig" else ""), R.drawable.ic_i_cards),
        SearchRow.Action("cards-manage", "Karten verwalten", R.drawable.ic_i_cards),
        SearchRow.Action("daily", "Daily Note von heute öffnen", R.drawable.ic_i_calendar),
        SearchRow.Action("daily-calendar", "Daily-Notes-Kalender öffnen", R.drawable.ic_i_calendar),
        SearchRow.Action("notebook", "Gemini Notebook öffnen (ehemals NotebookLM)", R.drawable.ic_i_book),
        SearchRow.Action("archive", "Archiv in Bibliothek öffnen", R.drawable.ic_i_archive),
        SearchRow.Action("trash", "Papierkorb öffnen", R.drawable.ic_i_trash),
        SearchRow.Action("sync", "Drive-Sync in Einstellungen öffnen", R.drawable.ic_i_cloud),
        SearchRow.Action("settings", "Einstellungen öffnen", R.drawable.ic_i_sliders),
    )

    /** Filtert Schnell-Aktionen über den Rust-Kern (`searchFilterActions`). */
    fun filteredActions(dueCards: Int, query: String): List<SearchRow.Action> {
        val all = actions(dueCards)
        val matchedIds = searchFilterActions(
            all.map { PaletteActionDef(id = it.id, label = it.label) },
            query,
        ).toSet()
        return all.filter { it.id in matchedIds }
    }
}

/** Trefferwörter fett und getönt hervorheben über die UTF-16-Bereiche des Rust-Kerns (`searchHighlightRanges`). */
fun highlight(text: String, query: String, color: Color): AnnotatedString {
    val q = query.trim()
    if (q.isEmpty() || text.isEmpty()) return AnnotatedString(text)
    val spans = searchHighlightRanges(text, q, emptyList())
    if (spans.isEmpty()) return AnnotatedString(text)
    val style = SpanStyle(fontWeight = FontWeight.SemiBold, background = color)
    return buildAnnotatedString {
        var last = 0
        for (span in spans) {
            val start = span.start.toInt().coerceIn(last, text.length)
            val end = span.end.toInt().coerceIn(start, text.length)
            append(text.substring(last, start))
            withStyle(style) { append(text.substring(start, end)) }
            last = end
        }
        append(text.substring(last))
    }
}
