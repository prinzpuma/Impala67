package org.impala67.app.sync

import androidx.lifecycle.ViewModel
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import org.impala67.app.core.ImpalaStore
import uniffi.impala_ffi.BulkResolve
import uniffi.impala_ffi.ConflictInfo
import uniffi.impala_ffi.ConflictResolution
import uniffi.impala_ffi.CoreException

/** Offene Sync-Konflikte und ihre Entscheidungen (Kern: `conflicts`, `resolveConflict`, …). */
class ConflictsViewModel(private val store: ImpalaStore) : ViewModel() {
    /** Jede Änderung kann einen Konflikt anlegen oder erledigen; die Liste liest der Kern neu. */
    val conflicts: StateFlow<List<ConflictInfo>?> = store.query({ true }) { it.conflicts() }

    private val _messages = MutableSharedFlow<String>(extraBufferCapacity = 8)

    /** Kurze Meldungen für die Snackbar. */
    val messages: SharedFlow<String> = _messages

    /** Wendet eine Entscheidung an; bei `false` ist nichts verändert (Meldung folgt). */
    suspend fun resolve(c: ConflictInfo, resolution: ConflictResolution): Boolean = try {
        store.write { it.resolveConflict(c.key, resolution) }
        true
    } catch (e: CoreException) {
        _messages.emit(ConflictText.FAILED)
        false
    }

    /** „Alle … mit Empfehlung lösen“: der Kern hält beim ersten Fehler an. */
    suspend fun resolveRecommended(): BulkResolve = store.write { it.resolveConflictsRecommended() }

    /** Volltext der gespeicherten Kopie (für Gegenüberstellung und Papierkorb-Ansicht). */
    suspend fun copyText(pageId: String?): String =
        if (pageId == null) "" else store.write { it.page(pageId)?.content }.orEmpty()
}
