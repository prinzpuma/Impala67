package org.impala67.app.library

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import java.io.IOException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

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
