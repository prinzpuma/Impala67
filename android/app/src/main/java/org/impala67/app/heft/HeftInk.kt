package org.impala67.app.heft

import android.graphics.Bitmap
import android.graphics.PorterDuff
import android.graphics.RectF
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.ink.brush.Brush
import androidx.ink.brush.InputToolType
import androidx.ink.brush.StockBrushes
import androidx.ink.rendering.android.canvas.CanvasStrokeRenderer
import androidx.ink.strokes.MutableStrokeInputBatch
import androidx.ink.strokes.Stroke
import androidx.ink.strokes.StrokeInput
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.impala67.app.diag.Profiler
import uniffi.impala_ffi.HeftStroke
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.roundToInt

/**
 * Brücke zwischen dem Strichformat des Kerns (`HeftStroke`: Werkzeug, CSS-Farbe, Breite, flache
 * Punkte `[x, y, druck, …]` in Seitenkoordinaten) und `androidx.ink`. Gespeichert wird immer nur das
 * Kernformat, damit PWA und App dieselben Hefte zeigen; ink-Striche entstehen daraus nur zum Zeichnen.
 */
object HeftInk {
    /** Markerstriche: halbtransparent, dreifache Breite (heft.js `drawStroke`). */
    private const val MARKER_ALPHA = 0.32f
    private const val EPSILON = 0.1f

    val renderer: CanvasStrokeRenderer by lazy { CanvasStrokeRenderer.create() }

    private val pressurePen by lazy { StockBrushes.pressurePen() }
    private val highlighter by lazy { StockBrushes.highlighter() }

    /** Pinsel für `tool` (`pen`/`marker`/`shape`), Farbe als CSS und Breite wie im Kern. */
    fun brush(tool: String, color: String, size: Double): Brush {
        val argb = HeftPalette.parse(color)
        return if (tool == "marker") {
            val alpha = (MARKER_ALPHA * 255).toInt() shl 24
            Brush.createWithColorIntArgb(highlighter, (argb and 0x00FFFFFF) or alpha, (size * 3).toFloat(), EPSILON)
        } else {
            // Der Druckstift zeichnet bei Druck 1 etwa so breit wie `size`; die PWA bei 0,5 (segW).
            Brush.createWithColorIntArgb(pressurePen, argb, (size * 1.1).toFloat(), EPSILON)
        }
    }

    /** Zeichenfähiger ink-Strich aus Kerndaten; `null` ohne Punkte. */
    fun stroke(s: HeftStroke): Stroke? {
        val p = s.points
        val n = p.size / 3
        if (n == 0) return null
        val batch = MutableStrokeInputBatch()
        for (i in 0 until n) {
            val pressure = p[i * 3 + 2].let { if (it.isNaN()) 0.5f else it.coerceIn(0f, 1f) }
            batch.add(
                InputToolType.STYLUS, p[i * 3], p[i * 3 + 1], i * 8L,
                StrokeInput.NO_STROKE_UNIT_LENGTH, if (s.tool == "shape") 0.7f else pressure,
            )
        }
        return Stroke(brush(s.tool, s.color, s.size), batch)
    }

    /** Punkte eines fertigen ink-Strichs im Kernformat `[x, y, druck, …]` (Strichkoordinaten = Seitenkoordinaten). */
    fun points(stroke: Stroke): List<Float> {
        val inputs = stroke.inputs
        val tmp = StrokeInput()
        val out = ArrayList<Float>(inputs.size * 3)
        for (i in 0 until inputs.size) {
            inputs.populate(i, tmp)
            out += tmp.x
            out += tmp.y
            out += if (tmp.hasPressure) tmp.pressure else 0.5f
        }
        return out
    }
}

/** Gezeichnete ink-Striche samt Rahmen je Strich-ID; geänderte Striche werden bei Bedarf neu gebaut. */
class StrokeCache {
    class Entry(val key: String, val stroke: Stroke, val bounds: RectF)

    private val entries = HashMap<String, Entry>()

    @Synchronized
    fun entry(s: HeftStroke): Entry? {
        val key = strokeKey(s)
        entries[s.id]?.takeIf { it.key == key }?.let { return it }
        val stroke = HeftInk.stroke(s) ?: return null
        val created = Entry(key, stroke, strokeBounds(s))
        entries[s.id] = created
        return created
    }

    fun get(s: HeftStroke): Stroke? = entry(s)?.stroke

    /** Verwaiste Einträge verwerfen (nur die IDs der sichtbaren Seite bleiben). */
    @Synchronized
    fun retain(ids: Set<String>) {
        entries.keys.retainAll(ids)
    }
}

private fun strokeKey(s: HeftStroke): String = "${s.tool}|${s.color}|${s.size}|${s.points.size}|${s.mark()}"

/** Umgebendes Rechteck eines Strichs in Seiteneinheiten inklusive Pinselbreite. */
private fun strokeBounds(s: HeftStroke): RectF {
    val p = s.points
    val n = p.size / 3
    if (n == 0) return RectF()
    var minX = p[0]
    var maxX = p[0]
    var minY = p[1]
    var maxY = p[1]
    for (i in 1 until n) {
        val x = p[i * 3]
        val y = p[i * 3 + 1]
        if (x < minX) minX = x else if (x > maxX) maxX = x
        if (y < minY) minY = y else if (y > maxY) maxY = y
    }
    val pad = (s.size * 2.2 + 4.0).toFloat()
    return RectF(minX - pad, minY - pad, maxX + pad, maxY + pad)
}

/** Fertig gerenderter Stand der Strich-Schicht samt den darin enthaltenen Strich-Schlüsseln. */
class StrokeLayerSnapshot(
    val image: ImageBitmap? = null,
    val drawnKeys: Map<String, String> = emptyMap(),
)

/**
 * Zwischengespeicherte Bitmap der gesetzten Striche einer Seite (ohne `pending`, `erased`, `moving`).
 * Rendert auf einem Hintergrund-Thread: neue Striche werden angehängt, beim Radieren oder Greifen mit
 * dem Lasso wird nur das betroffene Teilrechteck (`dirty`) gelöscht und neu gezeichnet.
 */
class PageStrokeLayer {
    private class DrawnStroke(val id: String, val key: String, val bounds: RectF)

    private val mutex = Mutex()
    private var bitmap: Bitmap? = null
    private var canvas: android.graphics.Canvas? = null
    private var width = 0
    private var height = 0
    private val drawn = ArrayList<DrawnStroke>()
    private var current = StrokeLayerSnapshot()

    suspend fun render(strokes: List<HeftStroke>, cache: StrokeCache, targetWidth: Int): StrokeLayerSnapshot =
        withContext(Dispatchers.Default) {
            mutex.withLock {
                Profiler.measure("heft", "strokeLayer") {
                    renderLocked(strokes, cache, targetWidth)
                }
            }
        }

    private fun renderLocked(strokes: List<HeftStroke>, cache: StrokeCache, targetWidth: Int): StrokeLayerSnapshot {
        if (strokes.isEmpty() || targetWidth <= 0) {
            drawn.clear()
            bitmap = null
            canvas = null
            width = 0
            height = 0
            current = StrokeLayerSnapshot()
            return current
        }
        val targetHeight = (targetWidth / HeftPage.RATIO).roundToInt().coerceAtLeast(1)
        val resolved = ArrayList<Pair<String, StrokeCache.Entry>>(strokes.size)
        for (s in strokes) {
            val e = cache.entry(s) ?: continue
            resolved += s.id to e
        }
        val sizeChanged = targetWidth != width || targetHeight != height || bitmap == null
        val prefixMatches = !sizeChanged && resolved.size >= drawn.size &&
            drawn.indices.all { i -> resolved[i].first == drawn[i].id && resolved[i].second.key == drawn[i].key }
        if (prefixMatches && resolved.size == drawn.size) return current

        if (sizeChanged) {
            val fresh = Bitmap.createBitmap(targetWidth, targetHeight, Bitmap.Config.ARGB_8888)
            bitmap = fresh
            canvas = android.graphics.Canvas(fresh)
            width = targetWidth
            height = targetHeight
            drawn.clear()
        }
        val native = canvas ?: return current
        val k = targetWidth / HeftPage.WIDTH
        val matrix = android.graphics.Matrix().apply { setScale(k, k) }

        if (prefixMatches) {
            val saved = native.save()
            native.concat(matrix)
            for (i in drawn.size until resolved.size) {
                val (id, e) = resolved[i]
                HeftInk.renderer.draw(native, e.stroke, matrix)
                drawn += DrawnStroke(id, e.key, e.bounds)
            }
            native.restoreToCount(saved)
        } else {
            val dirty = if (!sizeChanged && drawn.isNotEmpty()) dirtyRegion(drawn, resolved) else null
            if (dirty != null) {
                val saved = native.save()
                native.clipRect(
                    floor(dirty.left * k) - 2f,
                    floor(dirty.top * k) - 2f,
                    ceil(dirty.right * k) + 2f,
                    ceil(dirty.bottom * k) + 2f,
                )
                native.drawColor(android.graphics.Color.TRANSPARENT, PorterDuff.Mode.CLEAR)
                native.concat(matrix)
                for ((_, e) in resolved) {
                    if (RectF.intersects(e.bounds, dirty)) {
                        HeftInk.renderer.draw(native, e.stroke, matrix)
                    }
                }
                native.restoreToCount(saved)
            } else {
                if (!sizeChanged) bitmap?.eraseColor(android.graphics.Color.TRANSPARENT)
                val saved = native.save()
                native.concat(matrix)
                for ((_, e) in resolved) {
                    HeftInk.renderer.draw(native, e.stroke, matrix)
                }
                native.restoreToCount(saved)
            }
            drawn.clear()
            for ((id, e) in resolved) drawn += DrawnStroke(id, e.key, e.bounds)
        }

        val snap = bitmap?.copy(Bitmap.Config.ARGB_8888, false)?.apply { prepareToDraw() }?.asImageBitmap()
        val keys = HashMap<String, String>(drawn.size).apply { for (d in drawn) put(d.id, d.key) }
        current = StrokeLayerSnapshot(snap, keys)
        return current
    }

    /**
     * Vereinigtes Rechteck aller entfernten, geänderten oder neu hinzugekommenen Striche, sofern sich
     * höchstens 32 Striche geändert haben; sonst `null` (Komplett-Neuzeichnen ist dann günstiger).
     */
    private fun dirtyRegion(
        oldList: List<DrawnStroke>,
        newList: List<Pair<String, StrokeCache.Entry>>,
    ): RectF? {
        val oldMap = HashMap<String, DrawnStroke>(oldList.size)
        for (d in oldList) oldMap[d.id] = d
        val newMap = HashMap<String, StrokeCache.Entry>(newList.size)
        for ((id, e) in newList) newMap[id] = e
        val dirty = RectF()
        var changed = 0
        for (d in oldList) {
            if (newMap[d.id]?.key != d.key) {
                dirty.union(d.bounds)
                if (++changed > 32) return null
            }
        }
        for ((id, e) in newList) {
            if (oldMap[id]?.key != e.key) {
                dirty.union(e.bounds)
                if (++changed > 32) return null
            }
        }
        return dirty.takeUnless { it.isEmpty }
    }

    fun release() {
        current = StrokeLayerSnapshot()
    }
}

/** Hält die Strich-Bitmap einer Heftseite im Hintergrund aktuell. */
@Composable
fun rememberStrokeLayer(strokes: List<HeftStroke>, cache: StrokeCache, targetWidth: Int): StrokeLayerSnapshot {
    val layer = remember { PageStrokeLayer() }
    DisposableEffect(layer) { onDispose { layer.release() } }
    var snapshot by remember { mutableStateOf(StrokeLayerSnapshot()) }
    LaunchedEffect(strokes, targetWidth) {
        snapshot = layer.render(strokes, cache, targetWidth)
    }
    return snapshot
}
