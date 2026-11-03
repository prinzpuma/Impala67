package org.impala67.app.ai

import android.util.Log
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalContext
import org.impala67.app.ImpalaApp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.conflate
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.merge
import kotlinx.coroutines.flow.onStart
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.impala67.app.core.ImpalaStore
import org.impala67.app.core.Touches
import uniffi.impala_ffi.DownloadListener
import uniffi.impala_ffi.EmbeddingSetup
import uniffi.impala_ffi.LocalEmbeddingModel
import uniffi.impala_ffi.RelatedPage
import uniffi.impala_ffi.SemanticSearch
import uniffi.impala_ffi.downloadLocalEmbeddingModel
import uniffi.impala_ffi.embeddingSetup
import uniffi.impala_ffi.localEmbeddingModel
import java.io.File

/** Der eine [SemanticIndex] der App. */
@Composable
fun semanticIndex(): SemanticIndex = (LocalContext.current.applicationContext as ImpalaApp).semantic

/** Zustand der semantischen Suche für die Einstellungen. */
sealed interface SemanticState {
    /** Kein Embedding-Modell gewählt. */
    data object Off : SemanticState
    /** Lokales Modell gewählt, aber nicht auf diesem Gerät. */
    data object NeedsModel : SemanticState
    data class Downloading(val percent: Int, val file: Int, val files: Int) : SemanticState
    data object Loading : SemanticState
    data class Indexing(val remaining: Int) : SemanticState
    data class Ready(val cloudModel: String?) : SemanticState
    data class Failed(val message: String) : SemanticState
}

/**
 * Semantischer Index der App (rag.js der PWA). Der Kern rechnet alles ([SemanticSearch]); hier nur:
 * passendes Objekt zu den Einstellungen bauen, nach Änderungen entprellt nachführen und den Download
 * des lokalen Modells (Bekko a8m, ca. 165 MB) nach `filesDir/embedding/` anstoßen.
 */
@OptIn(FlowPreview::class)
class SemanticIndex(filesDir: File, private val store: Deferred<ImpalaStore>, private val scope: CoroutineScope) {
    private val modelDir = File(filesDir, "embedding/bekko-a8m")

    private val _state = MutableStateFlow<SemanticState>(SemanticState.Off)
    val state: StateFlow<SemanticState> = _state.asStateFlow()

    /** Steigt nach jedem Lauf, der den Index änderte (z. B. „Verwandt“ neu lesen). */
    private val _revision = MutableStateFlow(0)
    val revision: StateFlow<Int> = _revision.asStateFlow()

    /** Aktuelle Suche; `null` = aus oder noch nicht bereit. */
    @Volatile var search: SemanticSearch? = null
        private set
    private var searchKey = ""

    private val kick = MutableSharedFlow<Unit>(extraBufferCapacity = 1)
    @Volatile private var cancelDownload = false

    init {
        scope.launch(Dispatchers.IO) {
            val s = store.await()
            merge(s.changes.filter { it.everything || it.settings || Touches.pages(it) || it.hefte.isNotEmpty() }.map { }, kick)
                .onStart { emit(Unit) }
                // Tippen soll nicht jeden Anschlag einbetten.
                .debounce(DEBOUNCE_MS)
                .conflate()
                .collect { refresh(s) }
        }
    }

    fun model(): LocalEmbeddingModel = localEmbeddingModel(modelDir.path)

    /** Lokales Modell laden und als Embedding-Quelle setzen (gilt auf allen Geräten). `null` = gelungen. */
    suspend fun downloadAndEnable(): String? = withContext(Dispatchers.IO) {
        cancelDownload = false
        _state.value = SemanticState.Downloading(0, 0, 1)
        val listener = object : DownloadListener {
            override fun onProgress(file: UInt, files: UInt, done: ULong, total: ULong): Boolean {
                val pct = if (total > 0u) (done.toDouble() * 100 / total.toDouble()).toInt().coerceIn(0, 100) else 0
                // Der Rückruf kommt je 64 KB; StateFlow meldet nur neue Prozentwerte weiter.
                _state.value = SemanticState.Downloading(pct, file.toInt(), files.toInt())
                return !cancelDownload
            }
        }
        val error = runCatching { downloadLocalEmbeddingModel(modelDir.path, listener) }.exceptionOrNull()
        if (error != null) {
            _state.value = SemanticState.NeedsModel
            kick.tryEmit(Unit)
            return@withContext if (cancelDownload) "Download abgebrochen." else (error.message ?: "Download fehlgeschlagen.")
        }
        store.await().dispatch("settingsSet", mapOf("embedProviderId" to "local", "embedModel" to model().id))
        _state.value = SemanticState.Loading
        kick.tryEmit(Unit)
        null
    }

    fun cancelDownload() {
        cancelDownload = true
    }

    /** Modelldateien von diesem Gerät löschen; die Einstellung (auch für andere Geräte) bleibt. */
    suspend fun deleteModel() = withContext(Dispatchers.IO) {
        synchronized(this@SemanticIndex) {
            drop()
            modelDir.deleteRecursively()
        }
        kick.tryEmit(Unit)
    }

    suspend fun related(pageId: String, k: Int): List<RelatedPage> = withContext(Dispatchers.IO) {
        val s = search ?: return@withContext emptyList()
        runCatching { s.relatedPages(pageId, k.toUInt()) }.getOrDefault(emptyList())
    }

    private fun drop() {
        search?.close()
        search = null
        searchKey = ""
    }

    /** Ein Lauf zur Zeit; [deleteModel] wartet, bis er fertig ist. */
    @Synchronized
    private fun refresh(store: ImpalaStore) {
        if (_state.value is SemanticState.Downloading) return
        val setup = embeddingSetup(store.core, modelDir.path)
        // Cloud: jede Änderung an Modell oder Quelle baut neu; das lokale Modell nur einmal laden.
        val key = when (setup) {
            is EmbeddingSetup.Off -> ""
            is EmbeddingSetup.Local -> if (setup.downloaded) "local" else ""
            is EmbeddingSetup.Cloud -> "cloud:" + setup.model + "|" + store.core.settingsJson().hashCode()
        }
        if (key != searchKey) {
            drop()
            if (key.isEmpty()) {
                _state.value = if (setup is EmbeddingSetup.Local) SemanticState.NeedsModel else SemanticState.Off
                return
            }
            if (setup is EmbeddingSetup.Local) _state.value = SemanticState.Loading
            search = runCatching {
                if (setup is EmbeddingSetup.Local) SemanticSearch.withLocalModel(store.core, modelDir.path)
                else SemanticSearch.withCloudEmbeddings(store.core)
            }.onFailure { fail(it) }.getOrNull() ?: return
            searchKey = key
        }
        val s = search ?: return
        val cloudModel = (setup as? EmbeddingSetup.Cloud)?.model
        // In Schritten, damit der Fortschritt sichtbar ist und neue Änderungen bald drankommen.
        while (true) {
            val report = runCatching { s.update(PAGES_PER_STEP) }.onFailure { fail(it) }.getOrNull() ?: return
            if (report.indexed > 0u || report.removed > 0u) _revision.value++
            if (report.remaining == 0u) break
            _state.value = SemanticState.Indexing(report.remaining.toInt())
        }
        _state.value = SemanticState.Ready(cloudModel)
    }

    private fun fail(e: Throwable) {
        Log.w(TAG, "Semantische Suche", e)
        _state.value = SemanticState.Failed(e.message ?: e.toString())
    }

    private companion object {
        const val TAG = "SemanticIndex"
        const val DEBOUNCE_MS = 2_000L
        const val PAGES_PER_STEP = 8u
    }
}
