package org.impala67.app.library

import android.content.Context
import android.net.Uri
import androidx.annotation.DrawableRes
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import org.impala67.app.R
import org.impala67.app.core.ImpalaStore
import org.impala67.app.core.Touches
import org.json.JSONObject
import uniffi.impala_ffi.HeftFolder
import uniffi.impala_ffi.ImpalaCore
import uniffi.impala_ffi.PageKind
import uniffi.impala_ffi.PageSummary
import uniffi.impala_ffi.WorkspaceInfo

enum class LibraryMode(val label: String, @DrawableRes val icon: Int) {
    NOTION("Notion", R.drawable.ic_i_note),
    HEFTE("GoodNotes", R.drawable.ic_i_notebook),
    ARCHIVE("Archiv", R.drawable.ic_i_archive),
    NLM("Gemini Notebook", R.drawable.ic_i_inbox),
}

data class TreeRow(val page: PageSummary, val depth: Int, val hasKids: Boolean, val collapsed: Boolean)
data class TreeSectionData(val workspace: WorkspaceInfo, val rows: List<TreeRow>)
data class NotionLoaded(val all: Int, val fav: Int, val pdf: Int, val tpl: Int, val sections: List<TreeSectionData>)

sealed interface ShelfEntry {
    val key: String
    data class Folder(val folder: HeftFolder, val count: Int) : ShelfEntry { override val key = "f:${folder.id}" }
    data class Heft(val page: PageSummary, val pages: Int) : ShelfEntry { override val key = "p:${page.id}" }
}

data class ShelfLoaded(val path: List<HeftFolder>, val entries: List<ShelfEntry>, val total: Int, val rootFolders: List<HeftFolder>)

/** Bibliothek (web/library.js & LibraryScreen.swift): Notion-Baum, Heft-Regal, Archiv und Gemini Notebook. */
@OptIn(ExperimentalCoroutinesApi::class)
class LibraryViewModel(val store: ImpalaStore) : ViewModel() {
    var mode by mutableStateOf(initialMode.also { initialMode = LibraryMode.NOTION })
    private val _query = MutableStateFlow("")
    val query: StateFlow<String> = _query
    private val _smartFilter = MutableStateFlow("all")
    val smartFilter: StateFlow<String> = _smartFilter
    var archiveFilter by mutableStateOf("all")
    private val _folder = MutableStateFlow<String?>(null)
    val folder: StateFlow<String?> = _folder

    val counts: StateFlow<Pair<Int, Int>?> = store.query(Touches.pagesMeta) { core ->
        val all = core.recentPages(UInt.MAX_VALUE)
        val hefte = all.count { it.kind == PageKind.HEFT }
        (all.size - hefte) to hefte
    }

    val notionData: StateFlow<NotionLoaded?> = combine(_smartFilter, _query) { f, q -> f to q }.flatMapLatest { (smart, q) ->
        store.query(Touches.any(Touches.pagesMeta, Touches.ui)) { core -> buildNotion(core, smart, q) }
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    val shelf: StateFlow<ShelfLoaded?> = combine(_folder, _query) { id, q -> id to q }.flatMapLatest { (id, q) ->
        store.query({ c -> Touches.pagesMeta(c) || c.heftFolders }) { core -> buildShelf(core, id, q) }
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    val archived: StateFlow<List<PageSummary>?> = store.query(Touches.pagesMeta) { it.archivedPages() }

    fun setQuery(q: String) { _query.value = q }
    fun setSmartFilter(f: String) { _smartFilter.value = f }
    fun openFolder(id: String?) { _folder.value = id }
    fun toggleTreeOpen(row: TreeRow) = launch { store.write { it.setTreeOpen(row.page.id, row.collapsed) } }

    suspend fun importPdf(name: String, bytes: ByteArray): String = store.importPdfPage(name, bytes)
    fun createFolder(title: String) = launch { store.write { it.heftFolderCreate(title.trim(), _folder.value) } }
    fun deleteFolder(id: String) = launch {
        store.write { it.heftFolderDelete(id) }
        if (_folder.value == id) _folder.value = null
    }

    suspend fun createHeft(title: String, cover: String, imageBytes: ByteArray?): String {
        val id = store.write { it.createHeft(title.trim().ifEmpty { "Neues Heft" }, null, null) }
        if (imageBytes != null) {
            store.write { it.setCoverImage(id, imageBytes, "image/jpeg", "Cover.jpg") }
        } else {
            store.dispatch("pageUpdate", mapOf("id" to id, "patch" to mapOf("cover" to cover)))
        }
        _folder.value?.let { f -> store.write { it.heftMoveToFolder(id, f, null) } }
        return id
    }

    fun setCover(id: String, preset: String?) = launch {
        store.dispatch("pageUpdate", mapOf("id" to id, "patch" to mapOf("cover" to (preset ?: JSONObject.NULL), "coverImg" to JSONObject.NULL)))
    }

    fun setCoverImage(context: Context, id: String, uri: Uri) = launch {
        val bytes = encodeCoverJpeg(context, uri) ?: return@launch
        store.write { it.setCoverImage(id, bytes, "image/jpeg", "Cover.jpg") }
    }

    fun moveToFolder(heftId: String, folderId: String?) = launch { store.write { it.heftMoveToFolder(heftId, folderId, null) } }
    fun toggleFavorite(page: PageSummary) = launch { store.dispatch("pageUpdate", mapOf("id" to page.id, "patch" to mapOf("favorite" to !page.favorite))) }
    fun archive(id: String, archived: Boolean) = launch { store.write { if (archived) it.unarchivePage(id) else it.archivePage(id) } }
    fun trash(id: String) = launch { store.write { it.trashPage(id) } }

    private fun launch(block: suspend () -> Unit) = viewModelScope.launch { runCatching { block() } }

    companion object {
        var initialMode = LibraryMode.NOTION
        val COVER_PRESETS = listOf("sunset" to (0xFFFF9A4D to 0xFFFF5F6D), "ocean" to (0xFF2B5876 to 0xFF4E4376), "forest" to (0xFF134E5E to 0xFF71B280), "grape" to (0xFF6A11CB to 0xFF2575FC), "mono" to (0xFF3A3A3A to 0xFF101010))
    }
}

fun libMatches(p: PageSummary, query: String): Boolean {
    val q = query.trim().lowercase()
    return q.isEmpty() || p.title.lowercase().contains(q) || p.tags.any { it.lowercase().contains(q) }
}

private fun buildNotion(core: ImpalaCore, smart: String, query: String): NotionLoaded {
    val all = core.recentPages(UInt.MAX_VALUE)
    val open = core.treeOpen()
    val byParent = HashMap<String?, MutableList<PageSummary>>()
    for (entry in core.pageChildrenIndex()) {
        val key = entry.parentId ?: "ws:${entry.workspaceId}"
        byParent.getOrPut(key) { mutableListOf() }.addAll(entry.pages)
    }
    val memo = HashMap<String, Boolean>()
    fun ownMatch(p: PageSummary) = when (smart) {
        "fav" -> p.favorite; "pdf" -> p.pdfId != null; "tpl" -> p.isTemplate; else -> true
    } && libMatches(p, query)
    fun visible(p: PageSummary): Boolean = memo.getOrPut(p.id) { ownMatch(p) || byParent[p.id].orEmpty().any(::visible) }
    fun branch(list: List<PageSummary>, depth: Int, rows: MutableList<TreeRow>) {
        for (p in list) if (visible(p)) {
            val kids = if (depth < 8) byParent[p.id].orEmpty().filter(::visible) else emptyList()
            val collapsed = kids.isNotEmpty() && open[p.id] != true
            rows += TreeRow(p, depth, kids.isNotEmpty(), collapsed)
            if (!collapsed) branch(kids, depth + 1, rows)
        }
    }
    val sections = core.workspaces().mapNotNull { ws ->
        val rows = mutableListOf<TreeRow>()
        branch(byParent["ws:${ws.id}"].orEmpty(), 0, rows)
        if (rows.isEmpty()) null else TreeSectionData(ws, rows)
    }
    return NotionLoaded(all.size, all.count { it.favorite }, all.count { it.pdfId != null }, all.count { it.isTemplate }, sections)
}

private fun buildShelf(core: ImpalaCore, folderId: String?, query: String): ShelfLoaded {
    val searching = query.trim().isNotEmpty()
    val folders = if (searching) emptyList() else core.heftFolders(folderId)
    val raw = if (searching) core.recentPages(UInt.MAX_VALUE).filter { it.kind == PageKind.HEFT } else core.heftInFolder(folderId)
    val hefte = raw.filter { libMatches(it, query) }
    val entries = folders.map { ShelfEntry.Folder(it, core.heftFolders(it.id).size + core.heftInFolder(it.id).size) } +
        hefte.map { ShelfEntry.Heft(it, core.heftPageIds(it.id).size) }
    return ShelfLoaded(folderId?.let { core.heftFolderPath(it) }.orEmpty(), entries, raw.size + folders.size, core.heftFolders(null))
}
