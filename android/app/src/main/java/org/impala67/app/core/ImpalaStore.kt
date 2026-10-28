package org.impala67.app.core

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.onStart
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.withContext
import org.json.JSONObject
import uniffi.impala_ffi.ChangeListener
import uniffi.impala_ffi.Changes
import uniffi.impala_ffi.ImpalaCore

/**
 * Dünne Schicht über dem Rust-Kern (wie `STATE` in web/state.js): Lesen über [query], Schreiben nur
 * über den Kern ([write] / [dispatch]). Der Kern meldet jede Änderung – eigene wie fremde aus dem
 * Sync – als [Changes]; Abfragen lesen daraufhin neu. Keine Logik, die im Kern liegt, hier nachbauen.
 */
class ImpalaStore(val core: ImpalaCore, private val scope: CoroutineScope) {
    private val _changes = MutableSharedFlow<Changes>(extraBufferCapacity = 64)

    /** Jede angewandte Änderung. Kommt aus beliebigen Threads an; der Rückruf kehrt sofort zurück. */
    val changes: SharedFlow<Changes> = _changes

    init {
        core.setChangeListener(object : ChangeListener {
            override fun onChanged(changes: Changes) {
                _changes.tryEmit(changes)
            }
        })
    }

    /**
     * Wert aus dem Kern, neu gelesen bei jeder Änderung, die [relevant] betrifft (`everything` immer).
     * Gelesen wird im Hintergrund; `null` bis zum ersten Ergebnis.
     */
    fun <T> query(relevant: (Changes) -> Boolean, read: (ImpalaCore) -> T): StateFlow<T?> =
        changes
            .filter { it.everything || relevant(it) }
            .map { }
            .onStart { emit(Unit) }
            .map { read(core) }
            .flowOn(Dispatchers.IO)
            .stateIn(scope, SharingStarted.WhileSubscribed(5_000), null)

    /** Schreibender Aufruf im Hintergrund (z. B. `store.write { it.markHomeArticleRead(id) }`). */
    suspend fun <T> write(block: (ImpalaCore) -> T): T = withContext(Dispatchers.IO) { block(core) }

    /** Beliebiges Event wie `STATE.dispatch(kind, payload)` in der PWA; liefert die Event-ID. */
    suspend fun dispatch(kind: String, payload: Map<String, Any?>): String =
        write { it.dispatch(kind, JSONObject(payload).toString()) }
}

/** Gruppen von Änderungen für [ImpalaStore.query]. */
object Touches {
    val pages: (Changes) -> Boolean = { it.pagesAll || it.pages.isNotEmpty() || it.workspaces }
    val cards: (Changes) -> Boolean = { it.cardsAll || it.cards.isNotEmpty() || it.decks || it.reviews }
    val learning: (Changes) -> Boolean = { it.learningSessions }
    val articles: (Changes) -> Boolean = { it.homeArticles }
    val settings: (Changes) -> Boolean = { it.settings }

    fun any(vararg groups: (Changes) -> Boolean): (Changes) -> Boolean = { c -> groups.any { it(c) } }
}
