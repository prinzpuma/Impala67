package org.impala67.app.heft

import androidx.ink.brush.Brush
import androidx.ink.brush.InputToolType
import androidx.ink.brush.StockBrushes
import androidx.ink.rendering.android.canvas.CanvasStrokeRenderer
import androidx.ink.strokes.MutableStrokeInputBatch
import androidx.ink.strokes.Stroke
import androidx.ink.strokes.StrokeInput
import uniffi.impala_ffi.HeftStroke

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

/** Gezeichnete ink-Striche je Strich-ID; ein geänderter Strich (Farbe, Breite, Punktzahl) wird neu gebaut. */
class StrokeCache {
    private class Entry(val key: String, val stroke: Stroke)

    private val entries = HashMap<String, Entry>()

    fun get(s: HeftStroke): Stroke? {
        val key = "${s.tool}|${s.color}|${s.size}|${s.points.size}"
        entries[s.id]?.takeIf { it.key == key }?.let { return it.stroke }
        val stroke = HeftInk.stroke(s) ?: return null
        entries[s.id] = Entry(key, stroke)
        return stroke
    }

    /** Verwaiste Einträge verwerfen (nur die IDs der sichtbaren Seite bleiben). */
    fun retain(ids: Set<String>) = entries.keys.retainAll(ids)
}
