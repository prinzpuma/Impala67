package org.impala67.app.heft.scan

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
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
fun decodeScanPage(context: Context, uri: Uri): ScannedPage? {
    val resolver = context.contentResolver
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
    val longest = max(bounds.outWidth, bounds.outHeight)
    if (longest <= 0) return null

    var sample = 1
    while (longest / (sample * 2) >= SCAN_MAX_EDGE) sample *= 2
    val opts = BitmapFactory.Options().apply { inSampleSize = sample }
    val raw = resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, opts) } ?: return null

    val k = min(1f, SCAN_MAX_EDGE / max(raw.width, raw.height).toFloat())
    val bitmap = if (k < 1f) {
        Bitmap.createScaledBitmap(raw, (raw.width * k).roundToInt(), (raw.height * k).roundToInt(), true).also { raw.recycle() }
    } else {
        raw
    }
    val out = ByteArrayOutputStream()
    bitmap.compress(Bitmap.CompressFormat.JPEG, SCAN_JPEG_QUALITY, out)
    val result = ScannedPage(out.toByteArray(), bitmap.width, bitmap.height)
    bitmap.recycle()
    return result
}

/** Seitenfüllend und zentriert ohne Rand, wie `imagePage(im, "blank", true)` in heft-import.js. */
fun scanFrame(scan: ScannedPage): ScanFrame {
    val pageW = HeftPage.WIDTH.toDouble()
    val pageH = HeftPage.HEIGHT.toDouble()
    val k = min(pageW / scan.width, pageH / scan.height)
    val w = scan.width * k
    val h = scan.height * k
    return ScanFrame((pageW - w) / 2, (pageH - h) / 2, w, h)
}
