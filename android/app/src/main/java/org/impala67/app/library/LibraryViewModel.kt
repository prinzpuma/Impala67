package org.impala67.app.library

import androidx.lifecycle.ViewModel
import java.util.UUID
import kotlinx.coroutines.flow.StateFlow
import org.impala67.app.core.ImpalaStore
import org.impala67.app.core.Touches
import uniffi.impala_ffi.PageSummary

/** Bibliothek: PDF-Seiten lesen und PDFs importieren (wie `PDFS.ingest` in der PWA, ohne KI-Schritt). */
class LibraryViewModel(private val store: ImpalaStore) : ViewModel() {
    /** Aktive Seiten mit PDF (`pdfId`), neueste zuerst – wie der Tab „PDFs“ der PWA. */
    val pages: StateFlow<List<PageSummary>?> =
        store.query(Touches.pages) { core -> core.recentPages(UInt.MAX_VALUE).filter { it.pdfId != null } }

    /** Legt das PDF als Datei im Kern ab und eine Seite mit `pdfId` darauf an. Liefert die neue Seiten-ID. */
    suspend fun importPdf(name: String, bytes: ByteArray): String {
        val fileId = store.write { it.addFile(bytes, "application/pdf", name) }
        val workspaceId = store.write { core -> core.workspaces().firstOrNull()?.id ?: "default" }
        val id = UUID.randomUUID().toString()
        store.dispatch(
            "pageCreate",
            mapOf(
                "id" to id,
                "title" to name.replace(PDF_SUFFIX, ""),
                "parentId" to null,
                "content" to PDF_PLACEHOLDER,
                "pdfId" to fileId,
                "tags" to emptyList<String>(),
                "workspaceId" to workspaceId,
            ),
        )
        return id
    }

    private companion object {
        val PDF_SUFFIX = Regex("\\.pdf$", RegexOption.IGNORE_CASE)

        /** Zusammenfassung ohne KI, derselbe Text wie in `PDFS.ingest`, wenn die KI keine Antwort liefert. */
        const val PDF_PLACEHOLDER = "## Zusammenfassung\n\n_KI war nicht erreichbar — Zusammenfassung später über den Chat erstellen._\n"
    }
}
