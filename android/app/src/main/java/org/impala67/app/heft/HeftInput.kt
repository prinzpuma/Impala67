package org.impala67.app.heft

import android.graphics.Matrix
import android.os.Build
import android.os.SystemClock
import android.view.HapticFeedbackConstants
import android.view.MotionEvent
import androidx.ink.authoring.InProgressStrokeId
import androidx.ink.authoring.InProgressStrokesFinishedListener
import androidx.ink.authoring.InProgressStrokesView
import androidx.ink.strokes.Stroke
import uniffi.impala_ffi.HeftLassoTouch
import uniffi.impala_ffi.HeftShape
import uniffi.impala_ffi.heftFitShape
import uniffi.impala_ffi.heftLassoTouchAction
import kotlin.math.hypot

/** Ereignisse einer Seite an ihren Besitzer (Zeichnen, Radieren, Lasso; Koordinaten in Seiteneinheiten). */
interface PageInputSink {
    fun strokeFinished(tool: String, color: String, size: Double, points: List<Float>)
    /** Erkannte Form als Vorschau (`null`: Vorschau weg). */
    fun shapePreview(shape: HeftShape?, color: String, size: Double)
    /** Gehaltene Form fertig: speichern. */
    fun shapeFinished(shape: HeftShape, color: String, size: Double)
    /** Stift oder Radierer liegt auf (Leisten treten zurück) bzw. ist abgehoben. */
    fun writing(on: Boolean)
    fun eraseMove(x: Float, y: Float)
    fun eraseEnd()
    val lasso: LassoGesture
    /** Fingertipp neben die Auswahl: Lasso beenden. */
    fun lassoDismiss()
}

/** Handballen-Schutz (heft-input.js `PEN_GRACE_MS`): kurz nach dem Stift zählt ein Finger nicht. */
private const val PEN_GRACE_MS = 400L
private var lastPenUpAt = 0L

/** Stift kürzlich abgehoben: Finger-Gesten (Tippen, Zoom) zählen dann nicht (Handballen). */
fun penRecently() = SystemClock.uptimeMillis() - lastPenUpAt < PEN_GRACE_MS

/** Halten ohne Bewegung, bis aus dem Strich eine Form wird (heft-input.js `armHoldSnap`). */
private const val SNAP_HOLD_MS = 550L

/** So weit (Seiteneinheiten) darf der Stift beim Halten wandern. */
private const val SNAP_SLOP = 6f

/** Laser (heft-input.js): rot, 7 breit, verschwindet 900 ms nach dem Abheben. */
private const val LASER_COLOR = "#ef4444"
private const val LASER_SIZE = 7.0
private const val LASER_FADE_MS = 900L

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

    private class Meta(val tool: String, val color: String, val size: Double, val laser: Boolean)

    private val running = HashMap<InProgressStrokeId, Meta>()
    private val identity = Matrix()
    private var current: InProgressStrokeId? = null
    private var pointerId = -1
    private var mode = Mode.INK

    private enum class Mode { INK, ERASE, LASSO }

    /** Punkte des laufenden Strichs in Seiteneinheiten `[x, y, druck, …]` (für die Formerkennung). */
    private val pts = ArrayList<Float>()
    private var anchorX = 0f
    private var anchorY = 0f
    private var snapped: HeftShape? = null
    private var meta: Meta? = null
    private val snap = Runnable { trySnap() }

    init {
        view.eagerInit()
        view.addFinishedStrokesListener(object : InProgressStrokesFinishedListener {
            override fun onStrokesFinished(strokes: Map<InProgressStrokeId, Stroke>) {
                val done = HashSet<InProgressStrokeId>()
                for ((id, stroke) in strokes) {
                    val info = running.remove(id)
                    if (info?.laser == true) {
                        // Laserstriche werden nie gespeichert und verschwinden nach kurzer Zeit.
                        view.postDelayed({ view.removeFinishedStrokes(setOf(id)) }, LASER_FADE_MS)
                        continue
                    }
                    done += id
                    if (info != null) sink.strokeFinished(info.tool, info.color, info.size, HeftInk.points(stroke))
                }
                // Erst zwei Frames später entfernen: bis dahin zeichnet die Seite den Strich selbst.
                if (done.isNotEmpty()) view.postOnAnimation { view.postOnAnimation { view.removeFinishedStrokes(done) } }
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
                val type = ev.getToolType(i)
                val finger = type == MotionEvent.TOOL_TYPE_FINGER
                val lasso = tools.tool == HeftTool.LASSO && type != MotionEvent.TOOL_TYPE_ERASER
                if (lasso) {
                    // Finger im Lasso-Modus (lassoTouchAction): auf der Auswahl greifen, daneben beenden.
                    val x = ev.getX(i) / k
                    val y = ev.getY(i) / k
                    when (heftLassoTouchAction(finger, true, sink.lasso.onSelection(x, y))) {
                        HeftLassoTouch.DISMISS -> { if (!penRecently()) sink.lassoDismiss(); return false }
                        HeftLassoTouch.INTERACT, HeftLassoTouch.NONE -> Unit
                    }
                } else if (!accepts(type)) {
                    return false
                }
                pointerId = ev.getPointerId(i)
                view.parent?.requestDisallowInterceptTouchEvent(true)
                mode = when {
                    lasso -> Mode.LASSO
                    tools.tool == HeftTool.ERASER || type == MotionEvent.TOOL_TYPE_ERASER -> Mode.ERASE
                    else -> Mode.INK
                }
                when (mode) {
                    Mode.ERASE -> { sink.writing(true); erase(ev, i, history = false) }
                    Mode.LASSO -> sink.lasso.down(ev.getX(i) / k, ev.getY(i) / k, finger)
                    Mode.INK -> begin(ev, i)
                }
                return true
            }
            MotionEvent.ACTION_MOVE -> {
                val i = ev.findPointerIndex(pointerId)
                if (i < 0) return pointerId != -1
                when (mode) {
                    Mode.ERASE -> erase(ev, i, history = true)
                    Mode.LASSO -> sink.lasso.move(ev.getX(i) / k, ev.getY(i) / k)
                    Mode.INK -> inkMove(ev, i)
                }
                return true
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_POINTER_UP -> {
                if (ev.getPointerId(ev.actionIndex) != pointerId) return pointerId != -1
                when (mode) {
                    Mode.ERASE -> sink.eraseEnd()
                    Mode.LASSO -> sink.lasso.up()
                    Mode.INK -> inkUp(ev)
                }
                if (ev.getToolType(ev.actionIndex) != MotionEvent.TOOL_TYPE_FINGER) lastPenUpAt = SystemClock.uptimeMillis()
                reset()
                return true
            }
            MotionEvent.ACTION_CANCEL -> {
                if (pointerId == -1) return false
                when (mode) {
                    Mode.ERASE -> sink.eraseEnd()
                    Mode.LASSO -> sink.lasso.cancel()
                    Mode.INK -> {
                        current?.let { running.remove(it); view.cancelStroke(it, ev) }
                        if (snapped != null) meta?.let { sink.shapePreview(null, it.color, it.size) }
                    }
                }
                reset()
                return true
            }
        }
        return pointerId != -1
    }

    private fun begin(ev: MotionEvent, i: Int) {
        val t = tools
        val laser = t.tool == HeftTool.LASER
        val name = if (t.tool == HeftTool.MARKER) "marker" else "pen"
        val m = if (laser) Meta("pen", LASER_COLOR, LASER_SIZE, laser = true) else Meta(name, t.color, t.size, laser = false)
        val brush = HeftInk.brush(m.tool, m.color, m.size)
        val strokeToWorld = Matrix().apply { setScale(k, k) }
        val id = view.startStroke(ev, pointerId, brush, identity, strokeToWorld)
        running[id] = m
        current = id
        meta = m
        if (laser) return
        sink.writing(true)
        pts.clear()
        addPoint(ev.getX(i) / k, ev.getY(i) / k, ev.getPressure(i))
        armSnap(ev.getX(i) / k, ev.getY(i) / k)
    }

    private fun addPoint(x: Float, y: Float, p: Float) {
        pts += x; pts += y; pts += p.coerceIn(0f, 1f)
    }

    private fun inkMove(ev: MotionEvent, i: Int) {
        val shape = snapped
        if (shape != null) {
            // Eine erkannte Linie folgt dem Stift weiter (heft-input.js: x2/y2 nachführen).
            if (shape is HeftShape.Line) {
                val next = shape.copy(x2 = (ev.getX(i) / k).toDouble(), y2 = (ev.getY(i) / k).toDouble())
                snapped = next
                meta?.let { sink.shapePreview(next, it.color, it.size) }
            }
            return
        }
        current?.let { view.addToStroke(ev, pointerId, it) }
        if (meta?.laser != false) return
        for (h in 0 until ev.historySize) addPoint(ev.getHistoricalX(i, h) / k, ev.getHistoricalY(i, h) / k, ev.getHistoricalPressure(i, h))
        val x = ev.getX(i) / k
        val y = ev.getY(i) / k
        addPoint(x, y, ev.getPressure(i))
        if (hypot(x - anchorX, y - anchorY) > SNAP_SLOP) armSnap(x, y)
    }

    private fun inkUp(ev: MotionEvent) {
        view.removeCallbacks(snap)
        val shape = snapped
        val m = meta
        if (shape != null && m != null) {
            sink.shapeFinished(shape, m.color, m.size)
            sink.shapePreview(null, m.color, m.size)
        } else {
            current?.let { view.finishStroke(ev, pointerId, it) }
        }
    }

    /** Halte-Uhr neu stellen: erst wenn der Stift 550 ms an einer Stelle bleibt, wird erkannt. */
    private fun armSnap(x: Float, y: Float) {
        anchorX = x
        anchorY = y
        view.removeCallbacks(snap)
        view.postDelayed(snap, SNAP_HOLD_MS)
    }

    /** Aus dem gehaltenen Strich eine Form machen (Kern: `heftFitShape`); der Tintenstrich verschwindet. */
    private fun trySnap() {
        val m = meta ?: return
        if (mode != Mode.INK || snapped != null || m.laser || pts.size < 8 * 3) return
        val shape = runCatching { heftFitShape(pts.toList()) }.getOrNull() ?: return
        snapped = shape
        current?.let { running.remove(it); view.cancelStroke(it, null) }
        current = null
        sink.shapePreview(shape, m.color, m.size)
        view.performHapticFeedback(if (Build.VERSION.SDK_INT >= 30) HapticFeedbackConstants.CONFIRM else HapticFeedbackConstants.VIRTUAL_KEY)
    }

    /** Radierer: alle Zwischenpunkte der Bewegung, damit schnelle Züge keinen Strich überspringen. */
    private fun erase(ev: MotionEvent, i: Int, history: Boolean) {
        if (history) for (h in 0 until ev.historySize) sink.eraseMove(ev.getHistoricalX(i, h) / k, ev.getHistoricalY(i, h) / k)
        sink.eraseMove(ev.getX(i) / k, ev.getY(i) / k)
    }

    private fun reset() {
        if (mode == Mode.INK || mode == Mode.ERASE) sink.writing(false)
        view.removeCallbacks(snap)
        snapped = null
        meta = null
        pts.clear()
        current = null
        pointerId = -1
        mode = Mode.INK
    }
}
