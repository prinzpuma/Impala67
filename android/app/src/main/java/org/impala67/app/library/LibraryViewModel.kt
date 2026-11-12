package org.impala67.app.library

import android.content.Context
import android.net.Uri
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.impala67.app.core.ImpalaStore
import org.impala67.app.core.Touches
import uniffi.impala_ffi.HeftFolder
import uniffi.impala_ffi.PageSummary

/** Inhalt des Heft-Regals in einem Ordner: Pfad (Brotkrumen), Unterordner samt Anzahl, Hefte. */
data class Shelf(val path: List<HeftFolder>, val folders: List<Pair<HeftFolder, Int>>, val hefte: List<PageSummary>)

/** Bibliothek (web/library.js): Dokumente mit PDF, das Heft-Regal mit Ordnern sowie Cover, Archiv und Favoriten. */
class LibraryViewModel(private val store: ImpalaStore) : ViewModel() {
    /** Aktive Seiten mit PDF (`pdfId`), neueste zuerst – wie der Tab „PDFs“ der PWA. */
    val pages: StateFlow<List<PageSummary>?> =
        store.query(Touches.pagesMeta) { core -> core.recentPages(UInt.MAX_VALUE).filter { it.pdfId != null } }

    /** Offener Ordner im Regal (`S.libFolder`); `null` = Stamm. */
    private val _folder = MutableStateFlow<String?>(null)
    val folder: StateFlow<String?> = _folder

    var heftMode by mutableStateOf(false)

    @OptIn(ExperimentalCoroutinesApi::class)
    val shelf: StateFlow<Shelf?> = _folder.flatMapLatest { id ->
        store.query({ c -> Touches.pagesMeta(c) || c.heftFolders }) { core ->
            val folders = core.heftFolders(id).map { f -> f to (core.heftFolders(f.id).size + core.heftInFolder(f.id).size) }
            Shelf(id?.let { core.heftFolderPath(it) }.orEmpty(), folders, core.heftInFolder(id))
        }
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    fun openFolder(id: String?) { _folder.value = id }

    /** Legt das PDF als Notiz-Seite an. Liefert die neue Seiten-ID. */
    suspend fun importPdf(name: String, bytes: ByteArray): String = store.importPdfPage(name, bytes)

    fun createFolder(title: String) = launch { store.write { it.heftFolderCreate(title.trim(), _folder.value) } }

    fun deleteFolder(id: String) = launch {
        store.write { it.heftFolderDelete(id) }
        if (_folder.value == id) _folder.value = null
    }

    /** „Heft erstellen“: im offenen Ordner, mit gewähltem Cover. Liefert die neue Seiten-ID. */
    suspend fun createHeft(title: String, cover: String): String {
        val id = store.write { it.createHeft(title.trim().ifEmpty { "Neues Heft" }, null, null) }
        store.dispatch("pageUpdate", mapOf("id" to id, "patch" to mapOf("cover" to cover)))
        _folder.value?.let { f -> store.write { it.heftMoveToFolder(id, f, null) } }
        return id
    }

    /** Cover-Vorlage setzen; `null` entfernt Cover und eigenes Bild. */
    fun setCover(id: String, preset: String?) = launch {
        store.dispatch("pageUpdate", mapOf("id" to id, "patch" to mapOf("cover" to preset, "coverImg" to null)))
    }

    /** Eigenes Bild als Deckblatt (`coverImg`). */
    fun setCoverImage(context: Context, id: String, uri: Uri) = launch {
        val resolver = context.contentResolver
        val bytes = withContext(Dispatchers.IO) { resolver.openInputStream(uri)!!.use { it.readBytes() } }
        val fileId = store.write { it.addFile(bytes, resolver.getType(uri) ?: "image/jpeg", "Cover") }
        store.dispatch("pageUpdate", mapOf("id" to id, "patch" to mapOf("coverImg" to fileId, "cover" to null)))
    }

    fun toggleFavorite(page: PageSummary) = launch { store.dispatch("pageUpdate", mapOf("id" to page.id, "patch" to mapOf("favorite" to !page.favorite))) }

    fun archive(id: String, archived: Boolean) = launch { store.write { if (archived) it.unarchivePage(id) else it.archivePage(id) } }

    fun trash(id: String) = launch { store.write { it.trashPage(id) } }

    private fun launch(block: suspend () -> Unit) = viewModelScope.launch { runCatching { block() } }
}

/** Cover-Vorlagen (library.js `COVER_PRESETS`) mit den Verläufen aus styles.css. */
val COVER_PRESETS = listOf(
    "sunset" to (0xFFFF9A4D to 0xFFFF5F6D),
    "ocean" to (0xFF2B5876 to 0xFF4E4376),
    "forest" to (0xFF134E5E to 0xFF71B280),
    "grape" to (0xFF6A11CB to 0xFF2575FC),
    "mono" to (0xFF3A3A3A to 0xFF101010),
)

/** Standard-Cover aus Titel und ID (`defaultCover`). */
fun defaultCover(p: PageSummary): String {
    var h = 0L
    for (ch in p.title + p.id) h = (h * 31 + ch.code) and 0xFFFFFFFFL
    return COVER_PRESETS[(h % COVER_PRESETS.size).toInt()].first
}
