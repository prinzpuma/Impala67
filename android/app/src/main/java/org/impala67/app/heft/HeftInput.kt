package org.impala67.app.heft

import android.graphics.Matrix
import android.view.MotionEvent
import androidx.ink.authoring.InProgressStrokeId
import androidx.ink.authoring.InProgressStrokesFinishedListener
import androidx.ink.authoring.InProgressStrokesView
import androidx.ink.strokes.Stroke

/** Ereignisse einer Seite an ihren Besitzer (Zeichnen, Radieren; Koordinaten in Seiteneinheiten). */
interface PageInputSink {
    fun strokeFinished(tool: String, color: String, size: Double, points: List<Float>)
    fun eraseMove(x: Float, y: Float)
    fun eraseEnd()
}

/**
 * Stifteingabe einer Seite (in der PWA `heft-input.js`). Der Stift schreibt über `InProgressStrokesView`
 * (Frontbuffer, geringe Latenz), der Finger scrollt und zoomt, solange „nur Stift“ gilt. Die
 * Strichkoordinaten sind gleich Seitenkoordinaten: Eingaben liegen in View-Pixeln (Identität), die
 * Strich→Welt-Matrix skaliert mit [k] Pixel je Seiteneinheit.
 */
class PageInput(private val view: InProgressStrokesView, private val sink: PageInputSink) {
    /** Pixel je Seiteneinheit; wird mit jeder Zoomstufe nachgeführt. */
    var k = 1f
    var tools = HeftTools()

    private class Meta(val tool: String, val color: String, val size: Double)

    private val running = HashMap<InProgressStrokeId, Meta>()
    private val identity = Matrix()
    private var current: InProgressStrokeId? = null
    private var pointerId = -1
    private var erasing = false

    init {
        view.eagerInit()
        view.addFinishedStrokesListener(object : InProgressStrokesFinishedListener {
            override fun onStrokesFinished(strokes: Map<InProgressStrokeId, Stroke>) {
                for ((id, stroke) in strokes) {
                    val meta = running.remove(id) ?: continue
                    sink.strokeFinished(meta.tool, meta.color, meta.size, HeftInk.points(stroke))
                }
                // Erst zwei Frames später entfernen: bis dahin zeichnet die Seite den Strich selbst.
                val done = strokes.keys.toSet()
                view.postOnAnimation { view.postOnAnimation { view.removeFinishedStrokes(done) } }
            }
        })
    }

    private fun accepts(type: Int) = when (type) {
        MotionEvent.TOOL_TYPE_STYLUS, MotionEvent.TOOL_TYPE_ERASER, MotionEvent.TOOL_TYPE_MOUSE -> true
        else -> !tools.onlyPen
    }

    fun onTouch(ev: MotionEvent): Boolean {
        when (ev.actionMasked) {
            MotionEvent.ACTION_DOWN, MotionEvent.ACTION_POINTER_DOWN -> {
                if (pointerId != -1) return true
                val i = ev.actionIndex
                if (!accepts(ev.getToolType(i))) return false
                pointerId = ev.getPointerId(i)
                view.parent?.requestDisallowInterceptTouchEvent(true)
                erasing = tools.tool == HeftTool.ERASER || ev.getToolType(i) == MotionEvent.TOOL_TYPE_ERASER
                if (erasing) erase(ev, i, history = false) else begin(ev)
                return true
            }
            MotionEvent.ACTION_MOVE -> {
                val i = ev.findPointerIndex(pointerId)
                if (i < 0) return pointerId != -1
                if (erasing) erase(ev, i, history = true) else current?.let { view.addToStroke(ev, pointerId, it) }
                return true
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_POINTER_UP -> {
                if (ev.getPointerId(ev.actionIndex) != pointerId) return pointerId != -1
                if (erasing) sink.eraseEnd() else current?.let { view.finishStroke(ev, pointerId, it) }
                reset()
                return true
            }
            MotionEvent.ACTION_CANCEL -> {
                if (erasing) sink.eraseEnd() else current?.let { view.cancelStroke(it, ev) }
                reset()
                return pointerId != -1
            }
        }
        return pointerId != -1
    }

    private fun begin(ev: MotionEvent) {
        val t = tools
        val name = if (t.tool == HeftTool.MARKER) "marker" else "pen"
        val brush = HeftInk.brush(name, t.color, t.size)
        val strokeToWorld = Matrix().apply { setScale(k, k) }
        val id = view.startStroke(ev, pointerId, brush, identity, strokeToWorld)
        running[id] = Meta(name, t.color, t.size)
        current = id
    }

    /** Radierer: alle Zwischenpunkte der Bewegung, damit schnelle Züge keinen Strich überspringen. */
    private fun erase(ev: MotionEvent, i: Int, history: Boolean) {
        if (history) for (h in 0 until ev.historySize) sink.eraseMove(ev.getHistoricalX(i, h) / k, ev.getHistoricalY(i, h) / k)
        sink.eraseMove(ev.getX(i) / k, ev.getY(i) / k)
    }

    private fun reset() {
        current = null
        pointerId = -1
        erasing = false
    }
}
