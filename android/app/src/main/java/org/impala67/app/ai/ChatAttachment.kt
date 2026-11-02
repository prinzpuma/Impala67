package org.impala67.app.ai

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.pdf.PdfRenderer
import android.net.Uri
import android.os.Build
import android.os.ext.SdkExtensions
import android.provider.OpenableColumns
import android.util.Base64
import androidx.compose.ui.graphics.Color
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.impala67.app.core.ImpalaStore
import org.impala67.app.heft.loadHeftImages
import org.impala67.app.heft.renderHeftPage
import uniffi.impala_ffi.heftExportSize
import java.io.ByteArrayOutputStream
import java.io.File
import kotlin.math.max

/**
 * Anhang einer Nachricht (chat-fullscreen.js `setAttachment`): höchstens einer, ein neuer ersetzt den alten.
 * Bilder gehen als Data-URL, Text- und PDF-Dateien als Text an den Kern ([uniffi.impala_ffi.AiFile]).
 */
sealed interface ChatAttachment {
    val name: String

    class Image(override val name: String, val dataUrl: String, val preview: Bitmap) : ChatAttachment
    class TextFile(override val name: String, val content: String) : ChatAttachment
    class Pdf(override val name: String, val content: String, val pages: Int) : ChatAttachment
}

/** Ab so viel Text wird Einfügen zum Anhang „geklebter-text.txt“ (chat-fullscreen.js:480). */
fun isLongPaste(text: String) = text.length > 600 || text.count { it == '\n' } >= 15

fun pastedText(text: String) = ChatAttachment.TextFile("geklebter-text.txt", text)

/** Gewählte Datei lesen: Bild, PDF (Text je Seite) oder sonst Text. `null` = nicht lesbar. */
suspend fun readAttachment(context: Context, uri: Uri): ChatAttachment? = withContext(Dispatchers.IO) {
    runCatching {
        val resolver = context.contentResolver
        val mime = resolver.getType(uri).orEmpty()
        val name = resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use {
            if (it.moveToFirst()) it.getString(0) else null
        } ?: "Datei"
        val bytes = resolver.openInputStream(uri)!!.use { it.readBytes() }
        when {
            mime.startsWith("image/") -> imageAttachment(name, bytes)
            mime == "application/pdf" || name.endsWith(".pdf", true) -> pdfAttachment(context, name, bytes)
            else -> ChatAttachment.TextFile(name, bytes.decodeToString())
        }
    }.getOrNull()
}

/** Bild verkleinern (längste Seite 1600 px) und als JPEG-Data-URL anhängen. */
fun imageAttachment(name: String, bytes: ByteArray): ChatAttachment.Image? {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    var sample = 1
    while (max(bounds.outWidth, bounds.outHeight) / (sample * 2) >= MAX_SIDE) sample *= 2
    val bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample }) ?: return null
    return bitmapAttachment(name, bmp)
}

private fun bitmapAttachment(name: String, src: Bitmap): ChatAttachment.Image {
    val k = MAX_SIDE.toFloat() / max(src.width, src.height)
    val bmp = if (k < 1f) Bitmap.createScaledBitmap(src, (src.width * k).toInt(), (src.height * k).toInt(), true) else src
    val out = ByteArrayOutputStream()
    bmp.compress(Bitmap.CompressFormat.JPEG, 85, out)
    val url = "data:image/jpeg;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
    val pk = 160f / max(bmp.width, bmp.height)
    val preview = Bitmap.createScaledBitmap(bmp, max(1, (bmp.width * pk).toInt()), max(1, (bmp.height * pk).toInt()), true)
    return ChatAttachment.Image(name, url, preview)
}

/** PDF-Text lokal herauslesen (PWA: pdf.js); der Text geht als PDF-Kontext mit. */
@SuppressLint("NewApi")
private fun pdfAttachment(context: Context, name: String, bytes: ByteArray): ChatAttachment.Pdf {
    val file = File.createTempFile("chat", ".pdf", context.cacheDir).apply { writeBytes(bytes) }
    try {
        val fd = android.os.ParcelFileDescriptor.open(file, android.os.ParcelFileDescriptor.MODE_READ_ONLY)
        PdfRenderer(fd).use { pdf ->
            val text = StringBuilder()
            if (pdfTextSupported()) {
                for (i in 0 until pdf.pageCount) {
                    pdf.openPage(i).use { page ->
                        val pageText = page.textContents.joinToString("\n") { it.text }
                        if (pageText.isNotBlank()) text.append("--- Seite ${i + 1} ---\n").append(pageText.trim()).append("\n\n")
                    }
                }
            }
            return ChatAttachment.Pdf(name, text.toString().trim(), pdf.pageCount)
        }
    } finally {
        file.delete()
    }
}

/** Texterkennung im `PdfRenderer` gibt es erst mit der SDK-Erweiterung 13 (Android 15). */
private fun pdfTextSupported() =
    Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && SdkExtensions.getExtensionVersion(Build.VERSION_CODES.S) >= 13

/** Heftseite [index] als Bild (`attachHeft` bzw. `view_heft_page`). */
suspend fun heftPageAttachment(store: ImpalaStore, pageId: String, index: Int, ink: Color): ChatAttachment.Image? {
    val ids = store.write { it.heftPageIds(pageId) }
    val id = ids.getOrNull(index.coerceIn(0, max(0, ids.size - 1))) ?: return null
    val data = store.write { it.heftPage(pageId, id) }
    val size = heftExportSize(null)
    val w = 1200
    val h = (w * size.height.toFloat() / size.width.toFloat()).toInt()
    val images = loadHeftImages(store, pageId, id, data.images, maxSide = w)
    return withContext(Dispatchers.Default) {
        bitmapAttachment("Heftseite ${index + 1}.jpg", renderHeftPage(data, images, w, h, ink))
    }
}

private const val MAX_SIDE = 1600
