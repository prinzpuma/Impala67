package org.impala67.app.study

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.impala67.app.core.ImpalaStore
import org.impala67.app.core.Touches
import uniffi.impala_ffi.CardInfo
import uniffi.impala_ffi.markdownCardText

/** Zeile des Kartenbrowsers: Klartext der Vorderseite für Suche und Liste. */
data class BrowserCard(val card: CardInfo, val frontText: String, val backText: String)

/** Kartenbrowser (`ankiBrowserHtml` in render-anki.js): alle aktiven Karten, Suche und Filter lokal. */
class CardBrowserViewModel(private val store: ImpalaStore) : ViewModel() {
    val cards: StateFlow<List<BrowserCard>?> = store.query(Touches.cards) { core ->
        core.decks().flatMap { core.cardsInDeck(it.name) }.distinctBy { it.id }
            .map { BrowserCard(it, markdownCardText(it.front), markdownCardText(it.back)) }
    }

    val decks: StateFlow<List<String>?> = store.query(Touches.cards) { core -> core.decks().map { it.name }.sorted() }

    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error.asStateFlow()

    fun dismissError() { _error.value = null }

    fun setSuspended(card: CardInfo, suspended: Boolean) =
        viewModelScope.guarded(_error) { store.write { it.setCardSuspended(card.id, suspended) } }

    fun trash(card: CardInfo) = viewModelScope.guarded(_error) { store.write { it.trashCard(card.id) } }
}
