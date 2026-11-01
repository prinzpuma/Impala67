package org.impala67.app.heft.scan

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.pdf.PdfRenderer
import android.net.Uri
import java.io.ByteArrayOutputStream
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import org.impala67.app.heft.HeftPage

/** Kante der gespeicherten Scans in Pixeln und JPEG-Qualität wie `SCAN_OUT_MAX_EDGE` / `SCAN_JPEG_QUALITY` (heft-scan-pixels.js). */
const val SCAN_MAX_EDGE = 1800
const val SCAN_JPEG_QUALITY = 78

/** Eine gescannte Seite als JPEG mit den Maßen in Pixeln. */
class ScannedPage(val jpeg: ByteArray, val width: Int, val height: Int)

/** Position und Größe des Bildes auf der Heftseite (Seitenmaße 1000 × 1414). */
class ScanFrame(val x: Double, val y: Double, val w: Double, val h: Double)

/**
 * Liest eine Scan-Datei und skaliert sie wie `fileToImageData` in der PWA. Die Größe wird
 * vorab mit `inSampleSize` verkleinert, damit der Speicher bei großen Fotos reicht.
 * Liefert null, wenn die Datei nicht lesbar ist.
 */
fun decodeScanPage(context: Context, uri: Uri, maxEdge: Int = SCAN_MAX_EDGE): ScannedPage? {
    val resolver = context.contentResolver
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
    val longest = max(bounds.outWidth, bounds.outHeight)
    if (longest <= 0) return null

    var sample = 1
    while (longest / (sample * 2) >= maxEdge) sample *= 2
    val opts = BitmapFactory.Options().apply { inSampleSize = sample }
    val raw = resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, opts) } ?: return null

    val k = min(1f, maxEdge / max(raw.width, raw.height).toFloat())
    val w = max(1, (raw.width * k).roundToInt())
    val h = max(1, (raw.height * k).roundToInt())
    // Auf Weiß zeichnen wie `fileToImageData`: Transparenz (PNG) würde im JPEG sonst schwarz.
    val bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
    Canvas(bitmap).apply {
        drawColor(Color.WHITE)
        drawBitmap(raw, null, Rect(0, 0, w, h), Paint(Paint.FILTER_BITMAP_FLAG))
    }
    raw.recycle()
    val result = jpegPage(bitmap)
    bitmap.recycle()
    return result
}

private fun jpegPage(bitmap: Bitmap): ScannedPage {
    val out = ByteArrayOutputStream()
    bitmap.compress(Bitmap.CompressFormat.JPEG, SCAN_JPEG_QUALITY, out)
    return ScannedPage(out.toByteArray(), bitmap.width, bitmap.height)
}

/** PDF-Seiten einzeln als JPEG (längste Kante [SCAN_MAX_EDGE]); es liegt immer nur ein Bitmap im Speicher. */
fun pdfPages(context: Context, uri: Uri): Sequence<ScannedPage> = sequence {
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
                val scanned = jpegPage(bmp)
                bmp.recycle()
                yield(scanned)
            }
        }
    }
}

/**
 * Datei für den Heft-Import lesen (heft-import.js `importFilesIntoHeft`): eine PDF wird Seite für
 * Seite, ein Bild ein Blatt (längste Kante 1600). Unlesbares liefert eine leere Liste.
 */
fun importPages(context: Context, uri: Uri): List<ScannedPage> =
    if (context.contentResolver.getType(uri) == "application/pdf" || uri.toString().endsWith(".pdf", ignoreCase = true)) pdfPages(context, uri).toList()
    else listOfNotNull(decodeScanPage(context, uri, IMPORT_MAX_EDGE))

/** Längste Kante importierter Bilder und Bild-Seiten (heft-import.js `fileToImageData(f, 1600)`). */
const val IMPORT_MAX_EDGE = 1600

/** Seitenfüllend und zentriert ohne Rand, wie `imagePage(im, "blank", true)` in heft-import.js. */
fun scanFrame(scan: ScannedPage, pad: Double = 0.0): ScanFrame {
    val pageW = HeftPage.WIDTH.toDouble()
    val pageH = HeftPage.HEIGHT.toDouble()
    val k = min((pageW - pad * 2) / scan.width, (pageH - pad * 2) / scan.height)
    val w = scan.width * k
    val h = scan.height * k
    return ScanFrame((pageW - w) / 2, (pageH - h) / 2, w, h)
}
