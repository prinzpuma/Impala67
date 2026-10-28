package org.impala67.app.study

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import org.impala67.app.core.ImpalaStore
import org.impala67.app.core.Touches
import uniffi.impala_ffi.DeckOverview

/** Stapel plus Summe über alle Stapel (`studySnapshot(null).counts` in der PWA). */
data class DeckData(val decks: List<DeckOverview>, val new: Int, val learn: Int, val review: Int)

/** Stapelübersicht (in der PWA: `ankiDecksHtml` in render-anki.js und ihre Klick-Handler). */
class StudyViewModel(private val store: ImpalaStore) : ViewModel() {
    val data: StateFlow<DeckData?> = store.query(Touches.cards) { core ->
        val offset = utcOffsetMinutes()
        val q = core.studyQueue(null, offset, false)
        DeckData(core.deckOverview(offset, false), q.new.toInt(), q.learn.toInt(), q.review.toInt())
    }

    private val _collapsed = MutableStateFlow<Set<String>>(emptySet())
    val collapsed: StateFlow<Set<String>> = _collapsed.asStateFlow()

    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error.asStateFlow()

    fun toggle(name: String) = _collapsed.update { if (name in it) it - name else it + name }

    fun dismissError() { _error.value = null }

    fun create(name: String) = viewModelScope.guarded(_error) { store.write { it.createDeck(name) } }

    fun rename(from: String, to: String) = viewModelScope.guarded(_error) { store.write { it.renameDeck(from, to) } }

    fun duplicate(name: String) = viewModelScope.guarded(_error) { store.write { it.duplicateDeck(name) } }

    fun archive(name: String) = viewModelScope.guarded(_error) { store.write { it.archiveDeck(name) } }

    fun trash(name: String) = viewModelScope.guarded(_error) { store.write { it.trashDeck(name) } }
}
