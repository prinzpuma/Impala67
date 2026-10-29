package org.impala67.app.library

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import androidx.core.content.FileProvider
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.impala67.app.core.ImpalaStore

/**
 * Schreibt die PDF-Bytes des Kerns nach `cacheDir/pdf/<Titel>.pdf`. `null`, solange der Kern die Datei
 * noch nicht hat (wie in der PWA: „PDF wird geladen…“).
 */
suspend fun cachePdf(context: Context, store: ImpalaStore, fileId: String, title: String): File? {
    val data = store.write { it.file(fileId) } ?: return null
    return withContext(Dispatchers.IO) {
        val dir = File(context.cacheDir, "pdf").apply { mkdirs() }
        val name = title.replace(Regex("[\\\\/:*?\"<>|]"), "_").ifBlank { "Dokument" }
        File(dir, "$name.pdf").apply { writeBytes(data.bytes) }
    }
}

/** Öffnet die Datei mit einer externen PDF-App. `false`, wenn keine App sie öffnen kann. */
fun openPdfExternally(context: Context, file: File): Boolean {
    // Authority wie im Manifest; `cache-path` in res/xml/file_paths.xml deckt cacheDir ab.
    val uri = FileProvider.getUriForFile(context, context.packageName + ".fileprovider", file)
    val intent = Intent(Intent.ACTION_VIEW)
        .setDataAndType(uri, "application/pdf")
        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    return try {
        context.startActivity(intent)
        true
    } catch (e: ActivityNotFoundException) {
        false
    }
}
