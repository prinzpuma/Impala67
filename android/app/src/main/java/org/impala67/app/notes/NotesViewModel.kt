package org.impala67.app.notes

import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.mapLatest
import kotlinx.coroutines.flow.onStart
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.impala67.app.core.ImpalaStore
import org.impala67.app.core.Touches
import uniffi.impala_ffi.PageSummary

/** Notizen-Ebene: Lesen über den Kern bei jeder Seiten-Änderung, Schreiben nur über Kern-Funktionen. */
class NotesViewModel(private val store: ImpalaStore) : ViewModel() {
    private val workspace = MutableStateFlow<String?>(null)
    private val parent = MutableStateFlow<String?>(null)

    /** Suchtext wie er im Feld steht (ungetrimmt); die Trefferliste nutzt die getrimmte Fassung. */
    private val _query = MutableStateFlow("")
    val query: StateFlow<String> = _query.asStateFlow()

    private val reload = store.changes
        .filter { it.everything || Touches.pages(it) }
        .map { Unit }
        .onStart { emit(Unit) }

    private data class Input(val workspace: String?, val parent: String?, val query: String)

    @OptIn(ExperimentalCoroutinesApi::class)
    val state: StateFlow<NotesState?> = combine(reload, workspace, parent, _query) { _, ws, p, q -> Input(ws, p, q) }
        .mapLatest { input ->
            withContext(Dispatchers.IO) { readNotes(store.core, input.workspace, input.parent, input.query) }
        }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    fun selectWorkspace(id: String) {
        workspace.value = id
        parent.value = null
        _query.value = ""
    }

    /** Ebene öffnen (Drill-down); `null` = Wurzel. Der Suchtext wird geleert, wie in der PWA. */
    fun enter(id: String?) {
        parent.value = id
        _query.value = ""
    }

    /** Eine Ebene nach oben: Elternseite der aktuellen Ebene, sonst Wurzel. */
    fun goUp() {
        parent.value = state.value?.parent?.parentId
    }

    fun setQuery(text: String) {
        _query.value = text
    }

    /** Anheften umschalten (wie `pageFav` in der PWA). */
    fun toggleFavorite(page: PageSummary) = write {
        store.dispatch("pageUpdate", mapOf("id" to page.id, "patch" to mapOf("favorite" to !page.favorite)))
    }

    /** Unterseite anlegen und sofort öffnen. Ohne Titel, wie „Ohne Titel“ in der Liste. */
    fun createChild(parentId: String, onCreated: (String) -> Unit) = viewModelScope.launch {
        runCatching { store.write { it.createPage("", "", parentId, null) } }
            .onSuccess(onCreated)
            .onFailure { Log.w(TAG, "Unterseite konnte nicht angelegt werden", it) }
    }

    fun rename(page: PageSummary, title: String) = write {
        store.write { it.updatePage(page.id, title, null) }
    }

    fun archive(page: PageSummary) = write { store.write { it.archivePage(page.id) } }

    fun trash(page: PageSummary) = write { store.write { it.trashPage(page.id) } }

    private fun write(block: suspend () -> Unit) = viewModelScope.launch {
        runCatching { block() }.onFailure { Log.w(TAG, "Schreiben im Kern fehlgeschlagen", it) }
    }

    private companion object {
        const val TAG = "NotesViewModel"
    }
}
