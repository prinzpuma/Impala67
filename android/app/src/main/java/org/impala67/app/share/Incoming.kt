package org.impala67.app.share

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import android.net.Uri
import android.os.Build
import android.provider.OpenableColumns
import java.io.ByteArrayOutputStream
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlin.math.max
import kotlin.math.roundToInt
import org.impala67.app.core.ImpalaStore
import org.impala67.app.heft.scan.SCAN_JPEG_QUALITY
import org.impala67.app.heft.scan.SCAN_MAX_EDGE
import org.impala67.app.heft.scan.ScannedPage
import org.impala67.app.heft.scan.decodeScanPage
import org.impala67.app.heft.scan.insertScannedPages

/** Was die App von außen startet: App-Shortcuts (`res/xml/shortcuts.xml`) und „Teilen mit Impala67“. */
sealed interface Incoming {
    data object NewNote : Incoming
    data object NewHeft : Incoming
    data object Study : Incoming
    data class Text(val subject: String?, val text: String) : Incoming
    data class Files(val uris: List<Uri>) : Incoming
}

private const val PKG = "org.impala67.app"

/** Liest den Start-Intent; `null` für den normalen Start aus dem Launcher. */
fun Intent.toIncoming(): Incoming? = when (action) {
    "$PKG.ACTION_NEW_NOTE" -> Incoming.NewNote
    "$PKG.ACTION_NEW_HEFT" -> Incoming.NewHeft
    "$PKG.ACTION_STUDY_CARDS" -> Incoming.Study
    Intent.ACTION_SEND -> {
        val uri = streamExtra()
        val text = getStringExtra(Intent.EXTRA_TEXT)
        when {
            uri != null -> Incoming.Files(listOf(uri))
            !text.isNullOrBlank() -> Incoming.Text(getStringExtra(Intent.EXTRA_SUBJECT), text)
            else -> null
        }
    }
    Intent.ACTION_SEND_MULTIPLE -> streamListExtra().takeIf { it.isNotEmpty() }?.let { Incoming.Files(it) }
    else -> null
}

@Suppress("DEPRECATION")
private fun Intent.streamExtra(): Uri? =
    if (Build.VERSION.SDK_INT >= 33) getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java) else getParcelableExtra(Intent.EXTRA_STREAM)

@Suppress("DEPRECATION")
private fun Intent.streamListExtra(): List<Uri> =
    (if (Build.VERSION.SDK_INT >= 33) getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java) else getParcelableArrayListExtra(Intent.EXTRA_STREAM))
        .orEmpty()

/** Geteilter Text als neue Seite: Titel aus dem Betreff, sonst aus der ersten Zeile. Liefert die Seiten-ID. */
suspend fun importSharedText(store: ImpalaStore, shared: Incoming.Text): String {
    val title = shared.subject?.trim()?.takeIf { it.isNotEmpty() }
        ?: shared.text.lineSequence().first().trim().take(80).ifEmpty { "Geteilt" }
    return store.write { it.createPage(title, shared.text, null, null) }
}

/**
 * Geteilte Bilder und PDFs als neues Heft: jedes Bild bzw. jede PDF-Seite wird eine Seite
 * (wie der Datei-Import in heft-import.js). Liefert die Heft-ID oder `null`, wenn nichts lesbar war.
 */
suspend fun importSharedFiles(context: Context, store: ImpalaStore, uris: List<Uri>): String? {
    val title = withContext(Dispatchers.IO) { displayName(context, uris.first())?.substringBeforeLast('.')?.ifBlank { null } } ?: "Geteilt"
    // Erst lesen (JPEGs sind klein), damit bei unlesbaren Dateien kein leeres Heft entsteht.
    val pages = withContext(Dispatchers.IO) {
        uris.flatMap { uri ->
            if (context.contentResolver.getType(uri) == "application/pdf") pdfPages(context, uri).toList()
            else listOfNotNull(decodeScanPage(context, uri))
        }
    }
    if (pages.isEmpty()) return null
    return store.write { core ->
        val heftId = core.createHeft(title, null, null)
        val blank = core.heftPageIds(heftId)
        core.insertScannedPages(heftId, 0, pages)
        // Die leere Startseite des neuen Hefts wird nicht gebraucht.
        blank.forEach { core.heftRemovePage(heftId, it) }
        heftId
    }
}

private fun displayName(context: Context, uri: Uri): String? = runCatching {
    context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
        if (c.moveToFirst()) c.getString(0) else null
    }
}.getOrNull()

/** PDF-Seiten einzeln als JPEG (längste Kante [SCAN_MAX_EDGE]); es liegt immer nur ein Bitmap im Speicher. */
private fun pdfPages(context: Context, uri: Uri): Sequence<ScannedPage> = sequence {
    val fd = context.contentResolver.openFileDescriptor(uri, "r") ?: return@sequence
    fd.use {
        val renderer = runCatching { PdfRenderer(fd) }.getOrNull() ?: return@sequence
        renderer.use {
            for (i in 0 until renderer.pageCount) {
                val page = renderer.openPage(i)
                val k = SCAN_MAX_EDGE / max(page.width, page.height).toFloat()
                val bmp = Bitmap.createBitmap((page.width * k).roundToInt(), (page.height * k).roundToInt(), Bitmap.Config.ARGB_8888)
                bmp.eraseColor(Color.WHITE)
                page.render(bmp, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                page.close()
                val out = ByteArrayOutputStream()
                bmp.compress(Bitmap.CompressFormat.JPEG, SCAN_JPEG_QUALITY, out)
                val scanned = ScannedPage(out.toByteArray(), bmp.width, bmp.height)
                bmp.recycle()
                yield(scanned)
            }
        }
    }
}
