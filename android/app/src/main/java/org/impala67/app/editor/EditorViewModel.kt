package org.impala67.app.editor

import android.os.SystemClock
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.impala67.app.core.ImpalaStore
import org.impala67.app.core.Touches
import uniffi.impala_ffi.MdBlock
import uniffi.impala_ffi.MdBlockKind
import uniffi.impala_ffi.PageDetail
import uniffi.impala_ffi.PageSummary
import uniffi.impala_ffi.blocksToMarkdown
import uniffi.impala_ffi.markdownToBlocks

/** Was gerade bearbeitet wird: Text eines Blocks, Rohtext eines komplexen Blocks oder nur ausgewählt. */
internal enum class EditMode { Text, Raw, Select }

/** [nonce] ändert sich bei jeder neuen Aktivierung, damit das Feld neu aufgebaut wird und den Fokus holt. */
internal data class Active(val id: String, val mode: EditMode, val cursor: Int, val nonce: Int)

/** Kopfdaten der Seite (Icon, Brotkrumen, Rückverweise), getrennt vom Inhalt, damit Tippen sie nicht neu liest. */
internal data class PageHeaderData(
    val page: PageDetail?,
    val workspace: String,
    val ancestors: List<PageSummary>,
    val backlinks: List<PageSummary>,
)

/**
 * Zustand einer offenen Seite (web/editor.js): Blöcke aus dem Kern, Bearbeiten im Speicher mit lokalem
 * Verlauf, entprelltes Speichern über `updatePage`. Änderungen von außen (Sync) kommen nur an, wenn
 * gerade nichts Ungespeichertes vorliegt und nicht getippt wird.
 */
internal class EditorViewModel(private val store: ImpalaStore, private val pageId: String) : ViewModel() {
    var title by mutableStateOf(""); private set
    var blocks by mutableStateOf<List<MdBlock>>(emptyList()); private set
    var loaded by mutableStateOf(false); private set
    var missing by mutableStateOf(false); private set
    var active by mutableStateOf<Active?>(null); private set
    var canUndo by mutableStateOf(false); private set
    var canRedo by mutableStateOf(false); private set

    val header: StateFlow<PageHeaderData?> = store.query(Touches.pages) { core ->
        val page = core.page(pageId)
        PageHeaderData(
            page,
            core.workspaces().firstOrNull { it.id == page?.summary?.workspaceId }?.name ?: "Privat",
            if (page == null) emptyList() else core.ancestorsOf(pageId),
            if (page == null) emptyList() else core.backlinks(pageId),
        )
    }

    private val undoStack = ArrayDeque<List<MdBlock>>()
    private val redoStack = ArrayDeque<List<MdBlock>>()
    private var lastEdit = 0L
    private var nonce = 0
    private var cursor = 0
    private var dirtyContent = false
    private var dirtyTitle = false
    private var saveJob: Job? = null
    @Volatile private var lastMarkdown = ""
    @Volatile private var lastTitle = ""

    init {
        viewModelScope.launch { header.filterNotNull().collect { applyRemote(it.page) } }
    }

    private fun applyRemote(page: PageDetail?) {
        if (page == null) { if (!loaded) missing = true; return }
        val idle = !dirtyContent && !dirtyTitle && SystemClock.uptimeMillis() - lastEdit > 1_500
        if (!loaded) {
            title = page.summary.title; lastTitle = title
            blocks = markdownToBlocks(page.content); lastMarkdown = page.content
            loaded = true; missing = false
        } else if (idle) {
            if (page.summary.title != lastTitle) { title = page.summary.title; lastTitle = title }
            if (page.content != lastMarkdown) {
                blocks = markdownToBlocks(page.content); lastMarkdown = page.content
                undoStack.clear(); redoStack.clear(); updateHistoryFlags()
                if (active != null && blocks.none { it.id == active?.id }) active = null
            }
        }
    }

    // ---- Speichern ----

    fun onTitle(value: String) {
        if (value == title) return
        title = value; dirtyTitle = true; lastEdit = SystemClock.uptimeMillis(); scheduleSave()
    }

    private fun scheduleSave() {
        saveJob?.cancel()
        saveJob = viewModelScope.launch {
            delay(SAVE_DELAY_MS)
            val snapshot = blocks
            val newTitle = if (dirtyTitle) title else null
            val hasContent = dirtyContent
            dirtyTitle = false; dirtyContent = false
            withContext(NonCancellable + Dispatchers.IO) {
                val md = if (hasContent) blocksToMarkdown(snapshot) else null
                md?.let { lastMarkdown = it }
                newTitle?.let { lastTitle = it }
                runCatching { store.core.updatePage(pageId, newTitle, md) }
            }
        }
    }

    /** Sofort speichern (App im Hintergrund, Seite verlassen). */
    fun flush() {
        if (!dirtyContent && !dirtyTitle) return
        saveJob?.cancel()
        val newTitle = if (dirtyTitle) title else null
        val md = if (dirtyContent) blocksToMarkdown(blocks) else null
        dirtyTitle = false; dirtyContent = false
        md?.let { lastMarkdown = it }
        newTitle?.let { lastTitle = it }
        runCatching { store.core.updatePage(pageId, newTitle, md) }
    }

    override fun onCleared() = flush()

    // ---- Verlauf ----

    internal fun mutate(structural: Boolean, change: (List<MdBlock>) -> List<MdBlock>) {
        val old = blocks
        val new = change(old)
        if (new == old) return
        val now = SystemClock.uptimeMillis()
        if (structural || now - lastEdit > COALESCE_MS || undoStack.isEmpty()) {
            undoStack.addLast(old)
            if (undoStack.size > MAX_HISTORY) undoStack.removeFirst()
        }
        redoStack.clear()
        lastEdit = now
        blocks = new
        dirtyContent = true
        updateHistoryFlags()
        scheduleSave()
    }

    private fun updateHistoryFlags() { canUndo = undoStack.isNotEmpty(); canRedo = redoStack.isNotEmpty() }

    fun undo() = step(undoStack, redoStack)
    fun redo() = step(redoStack, undoStack)

    private fun step(from: ArrayDeque<List<MdBlock>>, to: ArrayDeque<List<MdBlock>>) {
        val target = from.removeLastOrNull() ?: return
        to.addLast(blocks)
        blocks = target
        dirtyContent = true; lastEdit = 0
        updateHistoryFlags()
        scheduleSave()
        active?.let { a -> if (blocks.none { it.id == a.id }) active = null else activate(a.id, a.mode, cursor) }
    }

    // ---- Auswahl und Fokus ----

    internal fun activate(id: String, mode: EditMode, at: Int) {
        cursor = at
        active = Active(id, mode, at, ++nonce)
    }

    fun onCursor(position: Int) { cursor = position }

    /** Das Feld hat den Fokus verloren (Tastatur weg, anderer Block): nur wenn es noch das aktive ist. */
    fun blur(a: Active) { if (active == a) active = null }

    fun clearActive() { active = null }

    fun tap(block: MdBlock) {
        val k = block.kind
        when {
            block.isText() -> activate(block.id, EditMode.Text, block.text().length)
            k is MdBlockKind.Table || k is MdBlockKind.Other || k is MdBlockKind.Math -> activate(block.id, EditMode.Raw, 0)
            else -> activate(block.id, EditMode.Select, 0)
        }
    }

    fun editRaw(block: MdBlock) = activate(block.id, EditMode.Raw, 0)

    /** Tipp unter den letzten Block: dort weiterschreiben. */
    fun focusEnd() {
        val last = blocks.lastOrNull()
        if (last != null && last.isText() && last.text().isEmpty()) {
            activate(last.id, EditMode.Text, 0)
        } else {
            val b = paragraph()
            mutate(true) { it + b }
            activate(b.id, EditMode.Text, 0)
        }
    }

    // ---- Bearbeiten ----

    fun setText(id: String, text: String) = mutate(false) { list -> list.map { if (it.id == id) it.withText(text) else it } }

    fun toggleTodo(id: String) = mutate(true) { list ->
        list.map { b ->
            val style = (b.kind as? MdBlockKind.ListItem)?.style
            if (b.id == id && style is uniffi.impala_ffi.MdListStyle.Todo) b.withChecked(!style.checked) else b
        }
    }

    /** Enter (oder eingefügte Zeilen): der Text des Blocks wird auf [lines] aufgeteilt. */
    fun split(id: String, lines: List<String>) {
        val i = blocks.indexOfFirst { it.id == id }.takeIf { it >= 0 } ?: return
        val b = blocks[i]
        val emptyBreak = lines.size == 2 && lines[0].isEmpty() && lines[1].isEmpty()
        if (emptyBreak && (b.kind is MdBlockKind.ListItem || b.kind is MdBlockKind.Quote)) {
            // Enter in leerer Zeile beendet die Liste bzw. rückt aus.
            val outdent = (b.kind as? MdBlockKind.ListItem)?.indent?.let { it > 0u } == true
            mutate(true) { list -> list.map { if (it.id == id) (if (outdent) it.withIndent(-1) else it.convertTo(BlockType.Text)) else it } }
            activate(id, EditMode.Text, 0)
            return
        }
        var prev = b.withText(lines.first())
        val tail = lines.drop(1).map { line -> prev.continuation().withText(line).also { prev = it } }
        mutate(true) { list -> list.take(i) + b.withText(lines.first()) + tail + list.drop(i + 1) }
        activate(tail.last().id, EditMode.Text, if (lines.size == 2) 0 else tail.last().text().length)
    }

    /** Rücktaste am Blockanfang: erst zum Absatz machen/ausrücken, dann mit dem vorigen verschmelzen. */
    fun backspaceAtStart(id: String) {
        val i = blocks.indexOfFirst { it.id == id }.takeIf { it >= 0 } ?: return
        val b = blocks[i]
        val k = b.kind
        if (k is MdBlockKind.ListItem && k.indent > 0u) {
            mutate(true) { list -> list.map { if (it.id == id) it.withIndent(-1) else it } }
            activate(id, EditMode.Text, 0)
        } else if (b.type() != BlockType.Text) {
            mutate(true) { list -> list.map { if (it.id == id) it.convertTo(BlockType.Text) else it } }
            activate(id, EditMode.Text, 0)
        } else if (i > 0) {
            val prev = blocks[i - 1]
            if (prev.isText()) {
                val join = prev.text().length
                mutate(true) { list -> list.take(i - 1) + prev.withText(prev.text() + b.text()) + list.drop(i + 1) }
                activate(prev.id, EditMode.Text, join)
            } else {
                activate(prev.id, EditMode.Select, 0)
            }
        }
    }

    fun indent(id: String, delta: Int) {
        mutate(true) { list -> list.map { if (it.id == id) it.withIndent(delta) else it } }
        active?.let { activate(it.id, it.mode, cursor) }
    }

    fun convert(type: BlockType) {
        val a = active ?: return
        mutate(true) { list -> list.map { if (it.id == a.id && it.isText()) it.convertTo(type) else it } }
        activate(a.id, EditMode.Text, cursor)
    }

    /** Titel fertig getippt (Enter): in den ersten Block springen. */
    fun focusFirst() {
        val first = blocks.firstOrNull()
        if (first == null) focusEnd() else tap(first)
    }

    fun deleteActive() {
        val a = active ?: return
        val i = blocks.indexOfFirst { it.id == a.id }
        if (i < 0) return
        mutate(true) { list -> list.filterIndexed { n, _ -> n != i } }
        val near = blocks.getOrNull(i - 1)?.takeIf { it.isText() }
        if (near != null) activate(near.id, EditMode.Text, near.text().length) else active = null
    }

    /** Rohtext eines komplexen Blocks ist fertig: wieder in Blöcke umwandeln (0, 1 oder mehrere). */
    fun commitRaw(id: String, markdown: String) {
        val i = blocks.indexOfFirst { it.id == id }.takeIf { it >= 0 } ?: return
        val old = blocks[i]
        if (markdown == blocksToMarkdown(listOf(old))) return
        val parsed = markdownToBlocks(markdown).let { if (it.size == 1) listOf(it[0].copy(id = id)) else it }
        mutate(true) { list -> list.take(i) + parsed + list.drop(i + 1) }
    }

    /** Aktueller Markdown-Text eines Blocks für die Rohtext-Bearbeitung. */
    fun rawOf(block: MdBlock): String = blocksToMarkdown(listOf(block))

    private companion object {
        const val SAVE_DELAY_MS = 600L
        const val COALESCE_MS = 900L
        const val MAX_HISTORY = 100
    }
}
