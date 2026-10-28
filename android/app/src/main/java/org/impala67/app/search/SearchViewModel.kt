package org.impala67.app.search

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.mapLatest
import kotlinx.coroutines.flow.onStart
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.withContext
import org.impala67.app.core.ImpalaStore
import org.impala67.app.search.SearchText.ACTIONS
import org.impala67.app.search.SearchText.PAGES
import org.impala67.app.search.SearchText.RECENT
import java.util.TimeZone

/**
 * Treffer für die Suche (in der PWA: `gather` in search.js). Der Kern liefert Volltext-Treffer mit
 * Ausschnitt; die Seiten dazu werden einzeln gelesen. Entprellt (150 ms), Abfragen im Hintergrund.
 */
@OptIn(FlowPreview::class, ExperimentalCoroutinesApi::class)
class SearchViewModel(private val store: ImpalaStore) : ViewModel() {
    private val query = MutableStateFlow("")

    fun setQuery(text: String) {
        query.value = text
    }

    /** `null` bis zum ersten Ergebnis; sonst die Abschnitte (leer: „Nichts gefunden“). */
    val sections: StateFlow<List<SearchSection>?> = combine(
        query.debounce { if (it.isBlank()) 0L else DEBOUNCE_MS },
        store.changes.map { }.onStart { emit(Unit) },
    ) { text, _ -> text }
        .mapLatest { text -> withContext(Dispatchers.IO) { load(text) } }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    private fun load(text: String): List<SearchSection> {
        val core = store.core
        val ql = text.trim()
        val offset = TimeZone.getDefault().getOffset(System.currentTimeMillis()) / 60_000
        val queue = core.studyQueue(null, offset, false)
        val due = (queue.new + queue.review + queue.learn).toInt()

        val pages = if (ql.isEmpty()) {
            core.recentPages(RECENT_LIMIT).map { SearchRow.Page(it, archived = false, snippet = "") }
        } else {
            core.search(ql, true).mapNotNull { hit ->
                core.page(hit.pageId)?.let { detail ->
                    SearchRow.Page(detail.summary, detail.archived, SearchText.snippet(hit.snippet))
                }
            }
        }
        val actions = SearchText.actions(due).filter { ql.isEmpty() || it.label.contains(ql, ignoreCase = true) }

        return buildList {
            if (pages.isNotEmpty()) add(SearchSection(if (ql.isEmpty()) RECENT else PAGES, pages))
            if (actions.isNotEmpty()) add(SearchSection(ACTIONS, actions))
        }
    }

    private companion object {
        const val DEBOUNCE_MS = 150L
        const val RECENT_LIMIT = 6u
    }
}
