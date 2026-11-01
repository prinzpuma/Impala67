package org.impala67.app.library

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import java.io.IOException
import java.util.UUID
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.impala67.app.core.ImpalaStore

/** Vom Dateidialog gewähltes PDF: Anzeigename und Bytes. */
class PickedPdf(val name: String, val bytes: ByteArray)

/** Liest das gewählte PDF im Hintergrund. Wirft [IOException], wenn die Datei nicht lesbar ist. */
suspend fun readPickedPdf(context: Context, uri: Uri): PickedPdf = withContext(Dispatchers.IO) {
    val resolver = context.contentResolver
    val name = resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
        val column = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
        if (cursor.moveToFirst() && column >= 0) cursor.getString(column) else null
    } ?: "Dokument.pdf"
    val bytes = resolver.openInputStream(uri)?.use { it.readBytes() } ?: throw IOException("PDF nicht lesbar")
    PickedPdf(name, bytes)
}

/**
 * PDF als Notiz-Seite (`PDFS.ingest` ohne KI): legt das PDF als Datei im Kern ab und eine Seite mit
 * `pdfId` darauf an. Liefert die neue Seiten-ID.
 */
suspend fun ImpalaStore.importPdfPage(name: String, bytes: ByteArray): String {
    val fileId = write { it.addFile(bytes, "application/pdf", name) }
    val workspaceId = write { core -> core.workspaces().firstOrNull()?.id ?: "default" }
    val id = UUID.randomUUID().toString()
    dispatch(
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

private val PDF_SUFFIX = Regex("\\.pdf$", RegexOption.IGNORE_CASE)

/** Zusammenfassung ohne KI, derselbe Text wie in `PDFS.ingest`, wenn die KI keine Antwort liefert. */
private const val PDF_PLACEHOLDER = "## Zusammenfassung\n\n_KI war nicht erreichbar — Zusammenfassung später über den Chat erstellen._\n"
