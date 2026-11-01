package org.impala67.app.heft

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.impala67.app.core.ImpalaStore
import org.impala67.app.core.Touches
import org.impala67.app.heft.ink.HandwritingRecognizer
import org.impala67.app.heft.ink.HeftIndexer
import org.impala67.app.heft.scan.ScannedPage
import org.impala67.app.heft.scan.insertScannedPages
import org.impala67.app.settings.DevicePrefs
import uniffi.impala_ffi.Changes
import uniffi.impala_ffi.HeftChange
import uniffi.impala_ffi.HeftEdit
import uniffi.impala_ffi.HeftPageData
import uniffi.impala_ffi.HeftShape
import uniffi.impala_ffi.HeftStroke
import uniffi.impala_ffi.ImpalaCore
import uniffi.impala_ffi.heftNewId

/**
 * Zustand eines geöffneten Hefts. Gelesen wird Seite für Seite (nur die sichtbaren), geschrieben
 * ausschließlich über `heftApply` des Kerns: jede Geste ein Event, dazu die Umkehr für Rückgängig.
 * Der Kern hält keinen Undo-Stapel (`heft_undo.rs`); er liegt hier und gilt nur für diese Sitzung.
 */
class HeftViewModel(val store: ImpalaStore, val pageId: String, private val prefs: DevicePrefs) : ViewModel() {
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

    init {
        viewModelScope.launch { tools = HeftTools.fromJson(prefs.heftTools.first()).copy(tool = tools.tool, expanded = tools.expanded) }
    }

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
        // Das Lasso hat keine Optionen; ein anderes Werkzeug hebt die Auswahl auf (heft.js `dropLasso`).
        val expanded = tool.hasOptions && (if (same) !tools.expanded else true)
        // Ein Stift-Favorit setzt Farbe und Dicke (heft.js `hepen`); der Marker übernimmt sie.
        tools = if (tool == HeftTool.PEN) tools.copy(tool = tool, penSlot = slot, color = tools.pens[slot].color, size = tools.pens[slot].size, expanded = expanded)
        else tools.copy(tool = tool, expanded = expanded)
        if (tool != HeftTool.LASSO) lasso = null
        saveTools()
    }

    fun collapseOptions() { tools = tools.copy(expanded = false) }

    /** Leiste ein- bzw. ausklappen (Chevron; eingeklappt bleibt nur ein Farbpunkt). */
    fun toggleCollapsed() {
        tools = tools.copy(collapsed = !tools.collapsed, expanded = false)
        saveTools()
    }

    /** Werkzeug vor dem Halten des Radierers (heft.js `holdTool`). */
    private var heldTool: HeftTool? = null

    /** Radierer-Knopf gehalten: vorübergehend radieren, beim Loslassen zurück zum vorigen Werkzeug. */
    fun holdEraser(on: Boolean) {
        if (on) {
            if (heldTool != null) return
            heldTool = tools.tool
            lasso = null
            tools = tools.copy(tool = HeftTool.ERASER, expanded = false)
        } else {
            val back = heldTool ?: return
            heldTool = null
            tools = tools.copy(tool = back)
        }
    }

    /** Gerade wird geschrieben: die Leisten treten zurück (heft.js `setWriting`, 700 ms Nachlauf). */
    var writing by mutableStateOf(false)
        private set
    private var writingOff: Job? = null

    @JvmName("updateWriting")
    fun setWriting(on: Boolean) {
        writingOff?.cancel()
        if (on) { writing = true; return }
        if (!writing) return
        writingOff = viewModelScope.launch { delay(700); writing = false }
    }

    /** heft.js `hecolor`: Radierer/Lasso wechseln dabei zum Stift; der Stift merkt sich die Farbe im Favoriten. */
    fun setColor(css: String) {
        val t = if (!tools.tool.writes) tools.copy(tool = HeftTool.PEN, expanded = true) else tools
        if (t.tool == HeftTool.PEN) lasso = null
        tools = t.copy(color = css).syncPen()
        saveTools()
    }

    fun setSize(size: Double) {
        tools = when (tools.tool) {
            HeftTool.ERASER -> tools.copy(eraserSize = size)
            HeftTool.PEN, HeftTool.MARKER -> tools.copy(size = size).syncPen()
            HeftTool.LASSO, HeftTool.LASER -> tools
        }
        saveTools()
    }

    fun toggleOnlyPen() {
        tools = tools.copy(onlyPen = !tools.onlyPen)
        saveTools()
    }

    private fun HeftTools.syncPen() =
        if (tool != HeftTool.PEN) this else copy(pens = pens.mapIndexed { i, p -> if (i == penSlot) PenSlot(color, size) else p })

    private fun saveTools() {
        val t = tools
        viewModelScope.launch { prefs.setHeftTools(t.toJson()) }
    }

    // ---- Schreiben ----

    /** Fertigen Strich speichern; Punkte im Kernformat `[x, y, druck, …]`. */
    fun addStroke(heftPageId: String, tool: String, color: String, size: Double, points: List<Float>, id: String) {
        edit { HeftChange.AddStroke(heftPageId, HeftStroke(id, tool, color, size, points, null)) }
        indexer.schedule(heftPageId)
    }

    /** Gehaltene und erkannte Form (Linie, Rechteck, Dreieck, Pfeil, Ellipse) als Strich `shape` speichern. */
    fun addShape(heftPageId: String, color: String, size: Double, shape: HeftShape, id: String) {
        edit { HeftChange.AddStroke(heftPageId, HeftStroke(id, "shape", color, size, emptyList(), shape)) }
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
        lassoText.close()
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

    /** Seite an Position [to] schieben (Seitenübersicht, Griff ⠿). */
    fun movePage(heftPageId: String, to: Int) {
        lasso = null
        write { it.heftMovePage(pageId, heftPageId, to.toUInt()) }
    }

    // ---- Lasso (heft-lasso.js; Geometrie im Kern) ----

    /** Aktuelle Lasso-Auswahl (höchstens eine, auf einer Seite). */
    var lasso by mutableStateOf<LassoSel?>(null)
        private set

    private val lassoText = HandwritingRecognizer()

    fun clearLasso() { lasso = null }

    /** Fingertipp neben die Auswahl: Lasso beenden, zurück zum Stift mit offenen Optionen. */
    fun dismissLasso() {
        lasso = null
        tools = tools.copy(tool = HeftTool.PEN, expanded = true)
    }

    /** Striche im Lasso-Polygon (`[x, y, …]`) auswählen. */
    fun lassoSelect(heftPageId: String, polygon: List<Float>) {
        viewModelScope.launch {
            val ids = store.write { runCatching { it.heftSelectByLasso(pageId, heftPageId, polygon) }.getOrDefault(emptyList()) }
            lasso = selection(heftPageId, ids)
        }
    }

    /** Beginn einer Geste auf der Auswahl: merkt sich die Striche, die die Vorschau verschiebt. */
    fun lassoGrab() {
        val sel = lasso ?: return
        val want = sel.ids.toHashSet()
        val marks = page(sel.heftPageId).value?.strokes.orEmpty().filter { it.id in want }.associate { it.id to it.mark() }
        lasso = sel.copy(drag = LassoDrag(sel.bounds, marks))
    }

    /** Vorschau während der Geste (nur Anzeige, schreibt nichts). */
    fun lassoPreview(change: (LassoDrag) -> LassoDrag) {
        val sel = lasso ?: return
        val drag = sel.drag ?: return
        lasso = sel.copy(drag = change(drag))
    }

    /** Geste fertig: ein Event (Verschieben oder Skalieren), ein Rückgängig-Schritt. */
    fun lassoRelease() {
        val sel = lasso ?: return
        val drag = sel.drag ?: return
        if (drag.isIdentity) { lasso = sel.copy(drag = null); return }
        write(after = { refreshLasso(sel.heftPageId, sel.ids, drag) }) { core ->
            if (drag.factor != 1f) core.heftScaleStrokes(pageId, sel.heftPageId, sel.ids, drag.ax.toDouble(), drag.ay.toDouble(), drag.factor.toDouble())
            else core.heftMoveStrokes(pageId, sel.heftPageId, sel.ids, drag.dx.toDouble(), drag.dy.toDouble())
        }
        indexer.schedule(sel.heftPageId)
    }

    /** Kopien 28 Einheiten versetzt; die Auswahl wandert auf die Kopien. */
    fun lassoDuplicate() {
        val sel = lasso ?: return
        write(after = { lasso = selection(sel.heftPageId, it.ids) }) { it.heftDuplicateStrokes(pageId, sel.heftPageId, sel.ids) }
        indexer.schedule(sel.heftPageId)
    }

    fun lassoDelete() {
        val sel = lasso ?: return
        lasso = null
        removeStrokes(sel.heftPageId, sel.ids)
    }

    /** Handschrift der Auswahl erkennen (ML Kit); `null`, wenn kein Text erkannt wurde. */
    suspend fun lassoRecognize(): String? {
        val sel = lasso ?: return null
        val want = sel.ids.toHashSet()
        val strokes = page(sel.heftPageId).value?.strokes.orEmpty().filter { it.id in want }
        return lassoText.recognize(strokes)
    }

    private suspend fun selection(heftPageId: String, ids: List<String>): LassoSel? {
        if (ids.isEmpty()) return null
        val bounds = store.write { runCatching { it.heftStrokesBounds(pageId, heftPageId, ids) }.getOrNull() } ?: return null
        return LassoSel(heftPageId, ids, bounds)
    }

    /** Neue Grenzen aus dem Kern; die Vorschau bleibt, bis die Seite die neue Fassung zeigt. */
    private suspend fun refreshLasso(heftPageId: String, ids: List<String>, drag: LassoDrag) {
        val fresh = selection(heftPageId, ids) ?: return
        if (lasso?.ids == ids) lasso = fresh.copy(drag = drag.copy(live = false))
    }

    fun undo() { lasso = null; replay(undoStack, redoStack) }

    fun redo() { lasso = null; replay(redoStack, undoStack) }

    private fun edit(change: () -> HeftChange) = write { it.heftApply(pageId, listOf(change())) }

    /** Eine Änderung schreiben und ihre Umkehr merken; [after] läuft nach Erfolg mit dem Ergebnis. */
    private fun write(after: suspend (HeftEdit) -> Unit = {}, block: (ImpalaCore) -> HeftEdit) {
        viewModelScope.launch {
            writes.withLock {
                runCatching { store.write(block) }
                    .onSuccess { record(it); after(it) }
                    .onFailure { _messages.tryEmit(it.message ?: "Änderung nicht möglich") }
            }
        }
    }

    /** Neue Änderung: ihre Umkehr kommt auf den Undo-Stapel, Wiederholen verfällt. */
    private fun record(edit: HeftEdit) {
        if (edit.undo == "[]") return
        undoStack.addLast(edit.undo)
        // Wie die PWA höchstens 100 Schritte (heft.js `pushUndo`).
        while (undoStack.size > UNDO_LIMIT) undoStack.removeFirst()
        redoStack.clear()
        refreshStacks()
    }

    /** Umkehr anwenden; deren Umkehr (Wiederholen bzw. wieder Rückgängig) wandert auf den anderen Stapel. */
    private fun replay(from: ArrayDeque<String>, to: ArrayDeque<String>) {
        viewModelScope.launch {
            writes.withLock {
                val ops = from.removeLastOrNull() ?: return@withLock
                runCatching { store.write { it.heftApplyOps(pageId, ops) } }
                    .onSuccess { if (it.undo != "[]") { to.addLast(it.undo); while (to.size > UNDO_LIMIT) to.removeFirst() } }
                    .onFailure { _messages.tryEmit(it.message ?: "Änderung nicht möglich") }
                refreshStacks()
            }
        }
    }

    private fun refreshStacks() {
        canUndo = undoStack.isNotEmpty()
        canRedo = redoStack.isNotEmpty()
    }

    private companion object {
        const val UNDO_LIMIT = 100
    }
}

