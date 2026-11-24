package org.impala67.app.heft.scan

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.graphics.pdf.PdfDocument
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import uniffi.impala_ffi.ScanImage
import uniffi.impala_ffi.scanDetect
import uniffi.impala_ffi.scanProcess
import java.io.ByteArrayOutputStream
import java.io.OutputStream
import java.nio.ByteBuffer
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/** Filter des Scanners (heft-scan.js `SCAN_MODES`). */
enum class ScanFilter(val key: String, val label: String) { COLOR("color", "Farbe"), BW("bw", "S/W"), GRAY("gray", "Graustufen"), PHOTO("photo", "Foto") }

/** Längste Kante des aufbewahrten Originals: genug Reserve fürs Entzerren auf [SCAN_MAX_EDGE]. */
const val SCAN_SOURCE_EDGE = 3000
/** Längste Kante der Miniaturen in der Aufnahmeleiste. */
private const val SCAN_PREVIEW_EDGE = 360

/**
 * Ein aufgenommenes Blatt. Das Original liegt als JPEG im Speicher, nicht als Bitmap – sonst
 * belegte jede Seite um die 40 MB und viele Scans hintereinander brachten die App an ihre Grenze.
 * Ecken in Originalpixeln, Filter, Drehung, Qualitätsnotiz. Fertiger Scan ([page]) und Miniatur
 * ([preview]) entstehen gleich nach der Aufnahme im Hintergrund ([ensure]), damit „Ins Heft“ und
 * „PDF“ nicht mehr auf alle Seiten warten müssen.
 */
class ScanShot(private val source: ByteArray, val width: Int, val height: Int, corners: List<Double>, filter: ScanFilter, val note: String) {
    @Volatile var corners: List<Double> = corners
    @Volatile var filter: ScanFilter = filter
    @Volatile var rotation: Int = 0

    /** Fertiger Scan als JPEG; null, solange er berechnet wird. */
    var page by mutableStateOf<ScannedPage?>(null)
        private set

    /** Miniatur des fertigen Scans (Aufnahmeleiste, erste Anzeige in der Bearbeitung). */
    var preview by mutableStateOf<Bitmap?>(null)
        private set

    var failed by mutableStateOf(false)
        private set

    private var doneFor: Triple<List<Double>, ScanFilter, Int>? = null
    private fun settings() = Triple(corners, filter, rotation)

    /** Original als Bitmap; mit [maxEdge] per inSampleSize verkleinert gelesen (Vorschauen). */
    fun original(maxEdge: Int = Int.MAX_VALUE): Bitmap {
        var sample = 1
        while (max(width, height) / (sample * 2) >= maxEdge) sample *= 2
        return BitmapFactory.decodeByteArray(source, 0, source.size, BitmapFactory.Options().apply { inSampleSize = sample })
    }

    /** Fertigen Scan berechnen: entzerren, Filter, Drehung (im Kern), dann auf [maxEdge] verkleinern. */
    fun render(maxEdge: Int = SCAN_MAX_EDGE): Bitmap {
        // Für kleine Vorschauen reicht ein verkleinertes Original (Ecken entsprechend umrechnen).
        val src = original(if (maxEdge < SCAN_MAX_EDGE) maxEdge else Int.MAX_VALUE)
        val k0 = src.width / width.toDouble()
        val out = try {
            scanProcess(src.toScanImage(), corners.map { it * k0 }, filter.key, rotation).toBitmap()
        } finally {
            src.recycle()
        }
        return out.scaledDown(maxEdge)
    }

    /**
     * Fertigen Scan berechnen, falls er zu den aktuellen Einstellungen fehlt. Läuft im Hintergrund und
     * nacheinander (ein Arbeits-Thread im Scanner); ein Ergebnis für überholte Einstellungen wird verworfen.
     */
    fun ensure() {
        val want = settings()
        if (doneFor == want && page != null) return
        val bmp = runCatching { render() }.getOrElse { failed = true; return }
        val out = ByteArrayOutputStream()
        bmp.compress(Bitmap.CompressFormat.JPEG, SCAN_JPEG_QUALITY, out)
        val result = ScannedPage(out.toByteArray(), bmp.width, bmp.height)
        val thumb = bmp.scaledDown(SCAN_PREVIEW_EDGE)
        if (thumb !== bmp) bmp.recycle()
        if (settings() != want) return
        doneFor = want
        page = result
        preview = thumb
        failed = false
    }

    companion object {
        /** Neues Blatt aus einem Kamerabild oder Foto: verkleinern, Kanten suchen, als JPEG aufbewahren. */
        fun of(raw: Bitmap, filter: ScanFilter): ScanShot {
            val img = raw.scaledDown(SCAN_SOURCE_EDGE)
            if (img !== raw) raw.recycle()
            val k = min(1f, 1200f / max(img.width, img.height))
            val det = runCatching { scanDetect(img.toScanImage(1200)) }.getOrNull()
            val corners = det?.corners?.map { it / k } ?: listOf(0.0, 0.0, img.width - 1.0, 0.0, img.width - 1.0, img.height - 1.0, 0.0, img.height - 1.0)
            val note = when {
                det == null -> ""
                det.check.tooDark -> "Mehr Licht nötig"
                det.check.glare -> "Spiegelung"
                det.check.flat -> "Kontrast zu gering"
                det.check.soft -> "Unscharf"
                else -> ""
            }
            val out = ByteArrayOutputStream()
            img.compress(Bitmap.CompressFormat.JPEG, 92, out)
            val shot = ScanShot(out.toByteArray(), img.width, img.height, corners, filter, note)
            img.recycle()
            return shot
        }
    }
}

/** Auf höchstens [maxEdge] verkleinern (gleiches Bitmap, wenn es schon klein genug ist). */
fun Bitmap.scaledDown(maxEdge: Int): Bitmap {
    val k = min(1f, maxEdge / max(width, height).toFloat())
    return if (k < 1f) Bitmap.createScaledBitmap(this, (width * k).roundToInt().coerceAtLeast(1), (height * k).roundToInt().coerceAtLeast(1), true) else this
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

/** Kamerabild in einem Schritt auf [maxEdge] verkleinern und um [degrees] drehen; das Ausgangsbild wird freigegeben. */
fun Bitmap.scaledRotated(maxEdge: Int, degrees: Int): Bitmap {
    val k = min(1f, maxEdge / max(width, height).toFloat())
    if (k >= 1f && degrees % 360 == 0) return this
    val m = Matrix().apply { postScale(k, k); postRotate(degrees.toFloat()) }
    val out = Bitmap.createBitmap(this, 0, 0, width, height, m, true)
    if (out !== this) recycle()
    return out
}

/** „Als PDF speichern“: je fertigem Scan eine Seite in Bildgröße (Punkte = Pixel × 72/150); immer nur ein Bitmap im Speicher. */
fun writeScanPdf(pages: List<ScannedPage>, out: OutputStream) {
    val doc = PdfDocument()
    try {
        pages.forEachIndexed { i, p ->
            val bmp = BitmapFactory.decodeByteArray(p.jpeg, 0, p.jpeg.size)
            val w = (bmp.width * 72 / 150f).roundToInt()
            val h = (bmp.height * 72 / 150f).roundToInt()
            val page = doc.startPage(PdfDocument.PageInfo.Builder(w, h, i + 1).create())
            page.canvas.drawBitmap(bmp, null, android.graphics.Rect(0, 0, w, h), android.graphics.Paint(android.graphics.Paint.FILTER_BITMAP_FLAG))
            doc.finishPage(page)
            bmp.recycle()
        }
        doc.writeTo(out)
    } finally {
        doc.close()
    }
}
