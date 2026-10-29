package org.impala67.app.heft

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.impala67.app.core.ImpalaStore
import org.impala67.app.core.Touches
import org.impala67.app.heft.ink.HeftIndexer
import org.impala67.app.heft.scan.ScannedPage
import org.impala67.app.heft.scan.insertScannedPages
import uniffi.impala_ffi.Changes
import uniffi.impala_ffi.HeftChange
import uniffi.impala_ffi.HeftEdit
import uniffi.impala_ffi.HeftPageData
import uniffi.impala_ffi.HeftStroke
import uniffi.impala_ffi.heftNewId

/**
 * Zustand eines geöffneten Hefts. Gelesen wird Seite für Seite (nur die sichtbaren), geschrieben
 * ausschließlich über `heftApply` des Kerns: jede Geste ein Event, dazu die Umkehr für Rückgängig.
 * Der Kern hält keinen Undo-Stapel (`heft_undo.rs`); er liegt hier und gilt nur für diese Sitzung.
 */
class HeftViewModel(private val store: ImpalaStore, val pageId: String) : ViewModel() {
    private val touched: (Changes) -> Boolean = { pageId in it.hefte || pageId in it.closedPages }

    /** Erkennt die Handschrift einer Seite nach Strich-Änderungen und macht sie durchsuchbar. */
    private val indexer = HeftIndexer(store, viewModelScope, pageId)

    val title: StateFlow<String?> = store.query(Touches.pages) { it.page(pageId)?.summary?.title }

    /** IDs der Heftseiten in Reihenfolge. */
    val pageIds: StateFlow<List<String>?> = store.query(touched) { it.heftPageIds(pageId) }

    private val pages = HashMap<String, StateFlow<HeftPageData?>>()

    /** Eine Heftseite zum Zeichnen; liest bei jeder Änderung des Hefts neu, solange sie sichtbar ist. */
    fun page(heftPageId: String): StateFlow<HeftPageData?> = pages.getOrPut(heftPageId) {
        store.query(touched) { core -> runCatching { core.heftPage(pageId, heftPageId) }.getOrNull() }
    }

    var tools by mutableStateOf(HeftTools())
        private set

    var canUndo by mutableStateOf(false)
        private set
    var canRedo by mutableStateOf(false)
        private set

    private val _messages = MutableSharedFlow<String>(extraBufferCapacity = 4)

    /** Kurze Meldungen für die Snackbar (z. B. „Die letzte Seite lässt sich nicht löschen“). */
    val messages: SharedFlow<String> = _messages

    private val undoStack = ArrayDeque<String>()
    private val redoStack = ArrayDeque<String>()
    private val writes = Mutex()

    // ---- Werkzeuge (heft.js: tool, color, size, pens, penSlot) ----

    /** Zweiter Tipp auf das aktive Werkzeug klappt die Optionen auf bzw. zu. */
    fun selectTool(tool: HeftTool, slot: Int = tools.penSlot) {
        val same = tools.tool == tool && (tool != HeftTool.PEN || tools.penSlot == slot)
        tools = tools.copy(tool = tool, penSlot = slot, expanded = if (same) !tools.expanded else true)
    }

    fun collapseOptions() { tools = tools.copy(expanded = false) }

    fun setColor(css: String) {
        tools = if (tools.tool == HeftTool.MARKER) tools.copy(markerColor = css) else tools.withPen { it.copy(color = css) }
    }

    fun setSize(size: Double) {
        tools = when (tools.tool) {
            HeftTool.MARKER -> tools.copy(markerSize = size)
            HeftTool.ERASER -> tools.copy(eraserSize = size)
            HeftTool.PEN -> tools.withPen { it.copy(size = size) }
        }
    }

    fun toggleOnlyPen() { tools = tools.copy(onlyPen = !tools.onlyPen) }

    private fun HeftTools.withPen(change: (PenSlot) -> PenSlot) =
        copy(pens = pens.mapIndexed { i, p -> if (i == penSlot) change(p) else p })

    // ---- Schreiben ----

    /** Fertigen Strich speichern; Punkte im Kernformat `[x, y, druck, …]`. */
    fun addStroke(heftPageId: String, tool: String, color: String, size: Double, points: List<Float>, id: String) {
        edit { HeftChange.AddStroke(heftPageId, HeftStroke(id, tool, color, size, points, null)) }
        indexer.schedule(heftPageId)
    }

    fun removeStrokes(heftPageId: String, ids: List<String>) {
        if (ids.isNotEmpty()) {
            edit { HeftChange.RemoveStrokes(heftPageId, ids) }
            indexer.schedule(heftPageId)
        }
    }

    override fun onCleared() {
        indexer.close()
        super.onCleared()
    }

    /** Striche unter dem Radierer, oberster zuerst (nur Lesen, schreibt nichts). */
    suspend fun strokesAt(heftPageId: String, x: Double, y: Double, radius: Double): List<String> =
        store.write { runCatching { it.heftStrokesAt(pageId, heftPageId, x, y, radius) }.getOrDefault(emptyList()) }

    /** Neue Seite nach Position `at` (`null`: hinten). */
    fun addPage(at: Int?, paper: Paper): String {
        val id = heftNewId()
        edit { HeftChange.AddPage(at?.toUInt(), id, paper.id) }
        return id
    }

    /** Gescannte Seiten ab Position [at] als Heftseiten einfügen; liefert die erste neue Seiten-ID. */
    suspend fun addScanned(at: Int, scans: List<ScannedPage>): String? = writes.withLock {
        runCatching { store.write { it.insertScannedPages(pageId, at, scans) } }
            .onFailure { _messages.tryEmit(it.message ?: "Scan nicht eingefügt") }
            .getOrNull()
    }

    /** Kurze Meldung in der Snackbar. */
    fun message(text: String) { _messages.tryEmit(text) }

    fun removePage(heftPageId: String) = edit { HeftChange.RemovePage(heftPageId) }

    /**
     * Mehrere Seiten nacheinander löschen (je eine Umkehr für Rückgängig). Der Kern prüft „letzte Seite
     * bleibt“ je Aufruf gegen den aktuellen Stand.
     * TODO(desk): `heftApply` prüft einen Stapel aus mehreren `RemovePage` gegen den Stand vor dem Stapel;
     * die Regel im Kern (`change_op`) für Stapel nachziehen, dann in einem Schritt löschen.
     */
    fun removePages(heftPageIds: List<String>) {
        viewModelScope.launch {
            writes.withLock {
                for (id in heftPageIds) {
                    val edit = runCatching { store.write { it.heftApply(pageId, listOf(HeftChange.RemovePage(id))) } }
                        .onFailure { _messages.tryEmit(it.message ?: "Änderung nicht möglich") }
                        .getOrNull() ?: break
                    record(edit)
                }
            }
        }
    }

    /** Papier der letzten Seite; eine neue Seite am Ende übernimmt es (wie `addPageAtEnd` in der PWA). */
    suspend fun lastPaper(): Paper = Paper.of(
        store.write { core -> core.heftPageIds(pageId).lastOrNull()?.let { runCatching { core.heftPage(pageId, it).paper }.getOrNull() } }.orEmpty(),
    )

    fun setPaper(heftPageId: String, paper: Paper) = edit { HeftChange.SetPaper(heftPageId, paper.id) }

    fun undo() = replay(undoStack, redoStack)

    fun redo() = replay(redoStack, undoStack)

    private fun edit(change: () -> HeftChange) {
        viewModelScope.launch {
            writes.withLock {
                runCatching { store.write { it.heftApply(pageId, listOf(change())) } }
                    .onSuccess { record(it) }
                    .onFailure { _messages.tryEmit(it.message ?: "Änderung nicht möglich") }
            }
        }
    }

    /** Neue Änderung: ihre Umkehr kommt auf den Undo-Stapel, Wiederholen verfällt. */
    private fun record(edit: HeftEdit) {
        if (edit.undo == "[]") return
        undoStack.addLast(edit.undo)
        redoStack.clear()
        refreshStacks()
    }

    /** Umkehr anwenden; deren Umkehr (Wiederholen bzw. wieder Rückgängig) wandert auf den anderen Stapel. */
    private fun replay(from: ArrayDeque<String>, to: ArrayDeque<String>) {
        viewModelScope.launch {
            writes.withLock {
                val ops = from.removeLastOrNull() ?: return@withLock
                runCatching { store.write { it.heftApplyOps(pageId, ops) } }
                    .onSuccess { if (it.undo != "[]") to.addLast(it.undo) }
                    .onFailure { _messages.tryEmit(it.message ?: "Änderung nicht möglich") }
                refreshStacks()
            }
        }
    }

    private fun refreshStacks() {
        canUndo = undoStack.isNotEmpty()
        canRedo = redoStack.isNotEmpty()
    }
}

