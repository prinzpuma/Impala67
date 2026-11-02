package org.impala67.app.heft.scan

import android.graphics.Bitmap
import android.graphics.Matrix
import android.graphics.pdf.PdfDocument
import uniffi.impala_ffi.ScanImage
import uniffi.impala_ffi.scanProcess
import java.io.ByteArrayOutputStream
import java.io.OutputStream
import java.nio.ByteBuffer
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/** Filter des Scanners (heft-scan.js `SCAN_MODES`). */
enum class ScanFilter(val key: String, val label: String) { COLOR("color", "Farbe"), BW("bw", "S/W"), GRAY("gray", "Graustufen"), PHOTO("photo", "Foto") }

/**
 * Ein aufgenommenes Blatt: Originalbild (längste Kante ≤ 4096), Ecken in Originalpixeln, Filter, Drehung
 * und Qualitätsnotiz. Das Ergebnis entsteht erst beim Fertigstellen ([render]).
 */
class ScanShot(val original: Bitmap, var corners: List<Double>, var filter: ScanFilter = ScanFilter.COLOR, var rotation: Int = 0, val note: String = "") {
    /** Verkleinerte Vorschau des fertigen Scans (für Miniaturen und Vorher/Nachher). */
    var preview: Bitmap? = null
}

/** Bitmap als RGBA-Bytes für den Kern (längste Kante höchstens [maxEdge]). */
fun Bitmap.toScanImage(maxEdge: Int = 4096): ScanImage {
    val k = min(1f, maxEdge / max(width, height).toFloat())
    val src = if (k < 1f) Bitmap.createScaledBitmap(this, (width * k).roundToInt().coerceAtLeast(1), (height * k).roundToInt().coerceAtLeast(1), true) else this
    val argb = if (src.config == Bitmap.Config.ARGB_8888) src else src.copy(Bitmap.Config.ARGB_8888, false)
    val buf = ByteBuffer.allocate(argb.byteCount)
    argb.copyPixelsToBuffer(buf)
    return ScanImage(argb.width.toUInt(), argb.height.toUInt(), buf.array())
}

fun ScanImage.toBitmap(): Bitmap =
    Bitmap.createBitmap(width.toInt(), height.toInt(), Bitmap.Config.ARGB_8888).apply { copyPixelsFromBuffer(ByteBuffer.wrap(rgba)) }

/** Bitmap um [degrees] drehen (Kamerabilder kommen je nach Haltung gedreht). */
fun Bitmap.rotated(degrees: Int): Bitmap =
    if (degrees % 360 == 0) this else Bitmap.createBitmap(this, 0, 0, width, height, Matrix().apply { postRotate(degrees.toFloat()) }, true)

/** Fertigen Scan berechnen: entzerren, Filter, Drehung (im Kern), dann auf [SCAN_MAX_EDGE] verkleinern. */
fun ScanShot.render(maxEdge: Int = SCAN_MAX_EDGE): Bitmap {
    val out = scanProcess(original.toScanImage(), corners, filter.key, rotation).toBitmap()
    val k = min(1f, maxEdge / max(out.width, out.height).toFloat())
    return if (k < 1f) Bitmap.createScaledBitmap(out, (out.width * k).roundToInt(), (out.height * k).roundToInt(), true) else out
}

/** Fertigen Scan als JPEG (78 %) wie die übrigen Heft-Scans. */
fun ScanShot.toPage(): ScannedPage {
    val bmp = render()
    val out = ByteArrayOutputStream()
    bmp.compress(Bitmap.CompressFormat.JPEG, SCAN_JPEG_QUALITY, out)
    return ScannedPage(out.toByteArray(), bmp.width, bmp.height)
}

/** „Als PDF speichern“: je Scan eine Seite in Bildgröße (Punkte = Pixel × 72/150). */
fun writeScanPdf(shots: List<ScanShot>, out: OutputStream) {
    val doc = PdfDocument()
    try {
        shots.forEachIndexed { i, s ->
            val bmp = s.render()
            val w = (bmp.width * 72 / 150f).roundToInt()
            val h = (bmp.height * 72 / 150f).roundToInt()
            val page = doc.startPage(PdfDocument.PageInfo.Builder(w, h, i + 1).create())
            page.canvas.drawBitmap(bmp, null, android.graphics.Rect(0, 0, w, h), android.graphics.Paint(android.graphics.Paint.FILTER_BITMAP_FLAG))
            doc.finishPage(page)
        }
        doc.writeTo(out)
    } finally {
        doc.close()
    }
}
