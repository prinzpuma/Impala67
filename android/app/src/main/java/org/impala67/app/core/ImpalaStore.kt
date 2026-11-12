package org.impala67.app.core

import org.impala67.app.diag.Profiler
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.conflate
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.onStart
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import uniffi.impala_ffi.ChangeListener
import uniffi.impala_ffi.Changes
import uniffi.impala_ffi.ImpalaCore
import java.util.concurrent.atomic.AtomicInteger

/**
 * Dünne Schicht über dem Rust-Kern (wie `STATE` in web/state.js): Lesen über [query], Schreiben nur
 * über den Kern ([write] / [dispatch]). Der Kern meldet jede Änderung – eigene wie fremde aus dem
 * Sync – als [Changes]; Abfragen lesen daraufhin neu. Keine Logik, die im Kern liegt, hier nachbauen.
 */
class ImpalaStore(val core: ImpalaCore, val scope: CoroutineScope) {
    // Unbegrenzt, damit tryEmit nie scheitert: ein fester Puffer verwarf bei einem Sync-Schwall
    // still Meldungen, und Ansichten blieben veraltet. Die Abnehmer sind schnell ([query] fasst zusammen).
    private val _changes = MutableSharedFlow<Changes>(extraBufferCapacity = Channel.UNLIMITED)
    private val writesSinceCheckpoint = AtomicInteger(0)

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
     * Gelesen wird im Hintergrund; `null` bis zum ersten Ergebnis. Kommen während eines Lesens
     * weitere Änderungen, wird danach genau einmal neu gelesen (nicht einmal je Änderung).
     */
    fun <T> query(relevant: (Changes) -> Boolean, read: (ImpalaCore) -> T): StateFlow<T?> =
        changes
            .filter { it.everything || relevant(it) }
            .map { }
            .onStart { emit(Unit) }
            .conflate()
            .map { Profiler.measure("core", "query") { read(core) } }
            .flowOn(Dispatchers.IO)
            .stateIn(scope, SharingStarted.WhileSubscribed(5_000), null)

    /** Schreibender Aufruf im Hintergrund (z. B. `store.write { it.markHomeArticleRead(id) }`). */
    suspend fun <T> write(block: (ImpalaCore) -> T): T = withContext(Dispatchers.IO) {
        val out = Profiler.measure("core", "write") { block(core) }
        if (writesSinceCheckpoint.incrementAndGet() >= CHECKPOINT_INTERVAL) {
            writesSinceCheckpoint.set(0)
            scope.launch(Dispatchers.IO) { runCatching { core.saveCheckpoint() } }
        }
        out
    }

    /** Beliebiges Event wie `STATE.dispatch(kind, payload)` in der PWA; liefert die Event-ID. */
    suspend fun dispatch(kind: String, payload: Map<String, Any?>): String =
        write { it.dispatch(kind, JSONObject(payload).toString()) }

    private companion object {
        const val CHECKPOINT_INTERVAL = 300
    }
}

/** Gruppen von Änderungen für [ImpalaStore.query]. */
object Touches {
    val pages: (Changes) -> Boolean = { it.pagesAll || it.pages.isNotEmpty() || it.workspaces }
    /** Titel, Icon, Ort, Favorit, Archiv, neue/gelöschte Seiten – reine Inhaltsänderungen (Tippen im Editor, Heft-Striche) nicht. */
    val pagesMeta: (Changes) -> Boolean = { it.pagesAll || it.pagesMeta || it.workspaces }
    fun page(id: String): (Changes) -> Boolean = { it.pagesAll || it.pagesMeta || it.workspaces || id in it.pages }
    val cards: (Changes) -> Boolean = { it.cardsAll || it.cards.isNotEmpty() || it.decks || it.reviews }
    val learning: (Changes) -> Boolean = { it.learningSessions }
    val articles: (Changes) -> Boolean = { it.homeArticles }
    val settings: (Changes) -> Boolean = { it.settings }
    val chats: (Changes) -> Boolean = { it.chatsAll || it.chats.isNotEmpty() }
    /** Offene Tabs und Aufklapp-Zustand des Seitenbaums. */
    val ui: (Changes) -> Boolean = { it.ui }

    fun any(vararg groups: (Changes) -> Boolean): (Changes) -> Boolean = { c -> groups.any { it(c) } }
}
