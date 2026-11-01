package org.impala67.app.library

import androidx.lifecycle.ViewModel
import kotlinx.coroutines.flow.StateFlow
import org.impala67.app.core.ImpalaStore
import org.impala67.app.core.Touches
import uniffi.impala_ffi.PageSummary

/** Bibliothek: PDF-Seiten lesen und PDFs importieren (wie `PDFS.ingest` in der PWA, ohne KI-Schritt). */
class LibraryViewModel(private val store: ImpalaStore) : ViewModel() {
    /** Aktive Seiten mit PDF (`pdfId`), neueste zuerst – wie der Tab „PDFs“ der PWA. */
    val pages: StateFlow<List<PageSummary>?> =
        store.query(Touches.pages) { core -> core.recentPages(UInt.MAX_VALUE).filter { it.pdfId != null } }

    /** Legt das PDF als Notiz-Seite an. Liefert die neue Seiten-ID. */
    suspend fun importPdf(name: String, bytes: ByteArray): String = store.importPdfPage(name, bytes)
}
