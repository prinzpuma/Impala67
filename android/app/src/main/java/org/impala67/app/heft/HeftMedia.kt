package org.impala67.app.heft

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Paint
import android.graphics.Typeface
import android.util.LruCache
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.impala67.app.core.ImpalaStore
import uniffi.impala_ffi.HeftImage
import uniffi.impala_ffi.HeftText
import kotlin.math.roundToInt

/**
 * Dekodierte Heft-Bilder (Scans, eingefügte Bilder, PDF-Seiten), für alle Hefte gemeinsam und nach
 * Speicher begrenzt. Schlüssel: Inhalts-Hash (bzw. Bild-ID bei Altbildern) und Zielgröße.
 */
private object HeftImageCache : LruCache<String, ImageBitmap>(48 * 1024 * 1024) {
    override fun sizeOf(key: String, value: ImageBitmap) = value.width * value.height * 4
}

/**
 * Bilder einer Heftseite (heft.js `imgEl`), heruntergerechnet auf höchstens [maxSide] Pixel. Fehlende
 * Daten (Fremdgerät hat sie noch nicht geschickt) bleiben weg, bis die Seite neu geliefert wird.
 */
@Composable
fun rememberHeftImages(store: ImpalaStore, pageId: String, heftPageId: String?, images: List<HeftImage>, maxSide: Int): Map<String, ImageBitmap> {
    var loaded by remember(heftPageId) { mutableStateOf(emptyMap<String, ImageBitmap>()) }
    LaunchedEffect(heftPageId, images, maxSide) {
        loaded = if (heftPageId == null) emptyMap() else loadHeftImages(store, pageId, heftPageId, images, maxSide)
    }
    return loaded
}

/** Bilder einer Heftseite dekodieren (für Anzeige und Export); fehlende Daten bleiben weg. */
suspend fun loadHeftImages(store: ImpalaStore, pageId: String, heftPageId: String, images: List<HeftImage>, maxSide: Int): Map<String, ImageBitmap> {
    val out = HashMap<String, ImageBitmap>()
    for (im in images) {
        val key = (im.blobId ?: im.id) + "@" + maxSide
        val bmp = HeftImageCache.get(key) ?: withContext(Dispatchers.IO) {
            val data = runCatching { store.write { it.heftImageData(pageId, heftPageId, im.id) } }.getOrNull()
            data?.bytes?.let { decodeSampled(it, maxSide) }?.asImageBitmap()?.also { HeftImageCache.put(key, it) }
        }
        if (bmp != null) out[im.id] = bmp
    }
    return out
}

private fun decodeSampled(bytes: ByteArray, maxSide: Int): Bitmap? {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    var sample = 1
    while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= maxSide) sample *= 2
    return BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })
}

/** Bilder in Seitenkoordinaten (`renderPageTo`: unter den Strichen). */
fun DrawScope.drawHeftImages(images: List<HeftImage>, bitmaps: Map<String, ImageBitmap>, k: Float) {
    for (im in images) {
        val bmp = bitmaps[im.id] ?: continue
        drawImage(
            bmp,
            dstOffset = IntOffset((im.x * k).roundToInt(), (im.y * k).roundToInt()),
            dstSize = IntSize((im.w * k).roundToInt().coerceAtLeast(1), (im.h * k).roundToInt().coerceAtLeast(1)),
        )
    }
}

private const val TEXT_LH = 1.4f
private const val TEXT_PAD = 10f
private val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL) }

/** Textfelder wie `drawTextBox` (heft.js): Umbruch an Wörtern in Feldbreite, Zeilenhöhe 1,4. */
fun DrawScope.drawHeftTexts(texts: List<HeftText>, k: Float) {
    if (texts.isEmpty()) return
    drawIntoCanvas { canvas ->
        val nc = canvas.nativeCanvas
        nc.save()
        nc.scale(k, k)
        for (t in texts) {
            val size = (t.size ?: 30.0).toFloat()
            textPaint.textSize = size
            textPaint.color = HeftPalette.parse(t.color ?: "#1c1c1e")
            val maxW = maxOf(60f, (t.w ?: 400.0).toFloat() - TEXT_PAD * 2)
            val baseline = -textPaint.fontMetrics.ascent
            wrapLines(t.text, maxW).forEachIndexed { i, line ->
                nc.drawText(line, t.x.toFloat() + TEXT_PAD, t.y.toFloat() + TEXT_PAD + i * size * TEXT_LH + baseline, textPaint)
            }
        }
        nc.restore()
    }
}

/** Höhe eines Textfelds in Seiteneinheiten wie `drawTextBox` (`t.h`): Zeilen × Zeilenhöhe + Rand. */
fun heftTextHeight(t: HeftText): Float {
    val size = (t.size ?: 30.0).toFloat()
    textPaint.textSize = size
    return wrapLines(t.text, maxOf(60f, (t.w ?: 400.0).toFloat() - TEXT_PAD * 2)).size * size * TEXT_LH + TEXT_PAD * 2
}

private fun wrapLines(text: String, maxW: Float): List<String> {
    val lines = ArrayList<String>()
    for (raw in text.split("\n")) {
        var line = ""
        for (word in raw.split(Regex("\\s+"))) {
            val probe = if (line.isEmpty()) word else "$line $word"
            if (line.isNotEmpty() && textPaint.measureText(probe) > maxW) {
                lines += line
                line = word
            } else {
                line = probe
            }
        }
        lines += line
    }
    return lines
}
