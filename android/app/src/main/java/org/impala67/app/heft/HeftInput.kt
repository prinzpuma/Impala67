package org.impala67.app.heft

import android.graphics.Matrix
import android.os.Build
import android.os.SystemClock
import android.view.HapticFeedbackConstants
import android.view.MotionEvent
import android.view.VelocityTracker
import android.view.ViewConfiguration
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
    /** Bilder und Textfelder direkt auswählen, verschieben, skalieren. */
    val objects: ObjGesture
    /** Jede angenommene Berührung der Seite (schließt z. B. ein offenes Textfeld). */
    fun touchStart()
}

/** Seite unter einem Zeiger: Empfänger und Lage auf dem Bildschirm (links/oben in Pixeln, [k] Pixel je Seiteneinheit). */
class PageHit(val sink: PageInputSink, val left: Float, val top: Float, val k: Float)

/** Die Ansicht hinter der Stift-Ebene: Seite unter einem Punkt finden, verschieben und mit Schwung auslaufen lassen. */
interface PageInputHost {
    fun locate(x: Float, y: Float): PageHit?
    /** Verschieben um Bildschirmpixel (Finger nach rechts/unten = Inhalt folgt). */
    fun pan(dx: Float, dy: Float)
    /** Loslassen mit Schwung (Pixel je Sekunde). */
    fun fling(vx: Float, vy: Float)
    /** Laufenden Schwung anhalten (neue Berührung). */
    fun stopFling()
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
 * Stifteingabe des Hefts (in der PWA `heft-input.js`): eine `InProgressStrokesView` über der ganzen
 * Ansicht (Frontbuffer, geringe Latenz, Größe = Bildschirm statt Seite). Beim Aufsetzen sucht [locate]
 * die Seite unter dem Zeiger; deren Empfänger bekommt die ganze Geste in Seiteneinheiten. Die
 * MotionEvent→Welt-Matrix rechnet Bildschirmpixel in Seiteneinheiten um, Strichkoordinaten sind gleich
 * Seitenkoordinaten. Der Finger scrollt und zoomt, solange „nur Stift“ gilt.
 */
class PageInput(private val view: InProgressStrokesView, private val host: PageInputHost) {
    /** Seite der laufenden Geste: Empfänger, Bildschirmlage und Pixel je Seiteneinheit (beim Aufsetzen festgelegt). */
    private var sink: PageInputSink = NoSink
    private var k = 1f
    private var ox = 0f
    private var oy = 0f
    var tools = HeftTools()

    /** Lesemodus: keine Eingabe auf der Seite, Finger und Stift scrollen die Liste. */
    var reading = false

    private class Meta(val tool: String, val color: String, val size: Double, val laser: Boolean, val sink: PageInputSink)

    private val running = HashMap<InProgressStrokeId, Meta>()
    private val identity = Matrix()
    private var current: InProgressStrokeId? = null
    private var pointerId = -1
    private var mode = Mode.INK

    private enum class Mode { INK, ERASE, LASSO, OBJ, PAN }

    /** Verschieben (Finger bei „nur Stift“, alles im Lesemodus, alles neben den Seiten). */
    private val velocity = VelocityTracker.obtain()
    private val slop = ViewConfiguration.get(view.context).scaledTouchSlop.toFloat()
    private var lastX = 0f
    private var lastY = 0f
    private var travel = 0f
    private var dragging = false

    /** Finger (wenn er zeichnet) oder Maus liegt auf einem Bild/Textfeld: Halten greift es. */
    private var pickHit: ObjGesture.Hit? = null
    private val pick = Runnable { holdPick() }

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
                    if (info != null) info.sink.strokeFinished(info.tool, info.color, info.size, HeftInk.points(stroke))
                }
                // Erst zwei Frames später entfernen: bis dahin zeichnet die Seite den Strich selbst.
                if (done.isNotEmpty()) view.postOnAnimation { view.postOnAnimation { view.removeFinishedStrokes(done) } }
            }
        })
    }

    private fun px(x: Float) = (x - ox) / k
    private fun py(y: Float) = (y - oy) / k

    private fun accepts(type: Int) = when (type) {
        MotionEvent.TOOL_TYPE_STYLUS, MotionEvent.TOOL_TYPE_ERASER, MotionEvent.TOOL_TYPE_MOUSE -> true
        else -> !tools.onlyPen
    }

    fun onTouch(ev: MotionEvent): Boolean {
        when (ev.actionMasked) {
            MotionEvent.ACTION_DOWN, MotionEvent.ACTION_POINTER_DOWN -> {
                val i = ev.actionIndex
                if (pointerId != -1) {
                    // Stift setzt auf, während die Hand verschiebt (Handballen): der Stift gewinnt.
                    if (mode != Mode.PAN || reading || !isPen(ev.getToolType(i))) return true
                    pointerId = -1
                    mode = Mode.INK
                }
                host.stopFling()
                if (reading) return startPan(ev, i)
                val hit = host.locate(ev.getX(i), ev.getY(i)) ?: return startPan(ev, i)
                sink = hit.sink
                k = hit.k
                ox = hit.left
                oy = hit.top
                val type = ev.getToolType(i)
                val finger = type == MotionEvent.TOOL_TYPE_FINGER
                val lasso = tools.tool == HeftTool.LASSO && type != MotionEvent.TOOL_TYPE_ERASER
                val picks = tools.tool != HeftTool.LASSO && tools.tool != HeftTool.LASER && type != MotionEvent.TOOL_TYPE_ERASER
                // Eine bestehende Auswahl greift jeder Zeiger (auch der Finger bei „Nur Stift“).
                if (picks && !(finger && penRecently()) && sink.objects.grab(px(ev.getX(i)), py(ev.getY(i)), finger)) {
                    pointerId = ev.getPointerId(i)
                    view.parent?.requestDisallowInterceptTouchEvent(true)
                    mode = Mode.OBJ
                    return true
                }
                if (lasso) {
                    // Finger im Lasso-Modus (lassoTouchAction): auf der Auswahl greifen, daneben beenden.
                    val x = px(ev.getX(i))
                    val y = py(ev.getY(i))
                    when (heftLassoTouchAction(finger, true, sink.lasso.onSelection(x, y))) {
                        HeftLassoTouch.DISMISS -> { if (!penRecently()) sink.lassoDismiss(); return startPan(ev, i) }
                        HeftLassoTouch.INTERACT, HeftLassoTouch.NONE -> Unit
                    }
                } else if (!accepts(type)) {
                    return startPan(ev, i)
                }
                pointerId = ev.getPointerId(i)
                view.parent?.requestDisallowInterceptTouchEvent(true)
                sink.touchStart()
                mode = when {
                    lasso -> Mode.LASSO
                    tools.tool == HeftTool.ERASER || type == MotionEvent.TOOL_TYPE_ERASER -> Mode.ERASE
                    else -> Mode.INK
                }
                when (mode) {
                    Mode.ERASE -> { sink.objects.clear(); sink.writing(true); erase(ev, i, history = false) }
                    Mode.LASSO -> sink.lasso.down(px(ev.getX(i)), py(ev.getY(i)), finger)
                    Mode.INK -> {
                        sink.objects.clear()
                        begin(ev, i)
                        val x = px(ev.getX(i))
                        val y = py(ev.getY(i))
                        if (picks && type != MotionEvent.TOOL_TYPE_STYLUS && tools.tool.writes) {
                            pickHit = sink.objects.hit(x, y)?.also { view.postDelayed(pick, PICK_HOLD_MS) }
                        }
                    }
                    Mode.OBJ, Mode.PAN -> Unit
                }
                return true
            }
            MotionEvent.ACTION_MOVE -> {
                val i = ev.findPointerIndex(pointerId)
                if (i < 0) return pointerId != -1
                when (mode) {
                    Mode.ERASE -> erase(ev, i, history = true)
                    Mode.LASSO -> sink.lasso.move(px(ev.getX(i)), py(ev.getY(i)))
                    Mode.OBJ -> sink.objects.move(px(ev.getX(i)), py(ev.getY(i)))
                    Mode.INK -> inkMove(ev, i)
                    Mode.PAN -> panMove(ev, i)
                }
                return true
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_POINTER_UP -> {
                if (ev.getPointerId(ev.actionIndex) != pointerId) return pointerId != -1
                when (mode) {
                    Mode.ERASE -> sink.eraseEnd()
                    Mode.LASSO -> sink.lasso.up()
                    Mode.OBJ -> sink.objects.up()
                    Mode.INK -> inkUp(ev)
                    Mode.PAN -> panUp(ev)
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
                    Mode.OBJ -> sink.objects.cancel()
                    Mode.INK -> {
                        current?.let { running.remove(it); view.cancelStroke(it, ev) }
                        if (snapped != null) meta?.let { sink.shapePreview(null, it.color, it.size) }
                    }
                    Mode.PAN -> Unit
                }
                reset()
                return true
            }
        }
        return pointerId != -1
    }

    private fun isPen(type: Int) = type == MotionEvent.TOOL_TYPE_STYLUS || type == MotionEvent.TOOL_TYPE_ERASER

    /** Verschieben beginnen (erst nach der Berührungsschwelle bewegt sich die Ansicht). */
    private fun startPan(ev: MotionEvent, i: Int): Boolean {
        pointerId = ev.getPointerId(i)
        mode = Mode.PAN
        lastX = ev.getX(i)
        lastY = ev.getY(i)
        travel = 0f
        dragging = false
        velocity.clear()
        velocity.addMovement(ev)
        return true
    }

    private fun panMove(ev: MotionEvent, i: Int) {
        velocity.addMovement(ev)
        val x = ev.getX(i)
        val y = ev.getY(i)
        var dx = x - lastX
        var dy = y - lastY
        lastX = x
        lastY = y
        if (!dragging) {
            travel += hypot(dx, dy)
            if (travel <= slop) return
            dragging = true
            // Den Weg bis zur Schwelle schlucken, damit die Seite nicht ruckt.
            val keep = (travel - slop) / travel
            dx *= keep
            dy *= keep
        }
        host.pan(dx, dy)
    }

    private fun panUp(ev: MotionEvent) {
        velocity.addMovement(ev)
        if (!dragging) return
        velocity.computeCurrentVelocity(1000)
        host.fling(velocity.getXVelocity(pointerId), velocity.getYVelocity(pointerId))
    }

    private fun begin(ev: MotionEvent, i: Int) {
        val t = tools
        val laser = t.tool == HeftTool.LASER
        val name = if (t.tool == HeftTool.MARKER) "marker" else "pen"
        val m = if (laser) Meta("pen", LASER_COLOR, LASER_SIZE, laser = true, sink) else Meta(name, t.color, t.size, laser = false, sink)
        val brush = HeftInk.brush(m.tool, m.color, m.size)
        // Welt = Seiteneinheiten: Bildschirmpixel minus Seitenecke, geteilt durch k; Strich = Welt.
        val motionToWorld = Matrix().apply { setTranslate(-ox, -oy); postScale(1f / k, 1f / k) }
        val id = view.startStroke(ev, pointerId, brush, motionToWorld, identity)
        running[id] = m
        current = id
        meta = m
        if (laser) return
        sink.writing(true)
        pts.clear()
        addPoint(px(ev.getX(i)), py(ev.getY(i)), ev.getPressure(i))
        armSnap(px(ev.getX(i)), py(ev.getY(i)))
    }

    private fun addPoint(x: Float, y: Float, p: Float) {
        pts += x; pts += y; pts += p.coerceIn(0f, 1f)
    }

    private fun inkMove(ev: MotionEvent, i: Int) {
        val shape = snapped
        if (shape != null) {
            // Eine erkannte Linie folgt dem Stift weiter (heft-input.js: x2/y2 nachführen).
            if (shape is HeftShape.Line) {
                val next = shape.copy(x2 = (px(ev.getX(i))).toDouble(), y2 = (py(ev.getY(i))).toDouble())
                snapped = next
                meta?.let { sink.shapePreview(next, it.color, it.size) }
            }
            return
        }
        current?.let { view.addToStroke(ev, pointerId, it) }
        if (meta?.laser != false) return
        for (h in 0 until ev.historySize) addPoint(px(ev.getHistoricalX(i, h)), py(ev.getHistoricalY(i, h)), ev.getHistoricalPressure(i, h))
        val x = px(ev.getX(i))
        val y = py(ev.getY(i))
        addPoint(x, y, ev.getPressure(i))
        if (pickHit != null && pts.size >= 3 && hypot(x - pts[0], y - pts[1]) > SNAP_SLOP) cancelPick()
        if (hypot(x - anchorX, y - anchorY) > SNAP_SLOP) armSnap(x, y)
    }

    private fun cancelPick() {
        view.removeCallbacks(pick)
        pickHit = null
    }

    /** Halten auf Bild/Textfeld: angefangenen Strich verwerfen, Element greifen und weiter verschieben. */
    private fun holdPick() {
        val h = pickHit ?: return
        pickHit = null
        if (mode != Mode.INK || snapped != null || pts.size < 3) return
        val x = pts[0]
        val y = pts[1]
        view.removeCallbacks(snap)
        current?.let { running.remove(it); view.cancelStroke(it, null) }
        current = null
        meta = null
        pts.clear()
        sink.writing(false)
        mode = Mode.OBJ
        sink.objects.pick(h, x, y)
        view.performHapticFeedback(HapticFeedbackConstants.LONG_PRESS)
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
        if (history) for (h in 0 until ev.historySize) sink.eraseMove(px(ev.getHistoricalX(i, h)), py(ev.getHistoricalY(i, h)))
        sink.eraseMove(px(ev.getX(i)), py(ev.getY(i)))
    }

    private fun reset() {
        if (mode == Mode.INK || mode == Mode.ERASE) sink.writing(false)
        view.removeCallbacks(snap)
        cancelPick()
        snapped = null
        meta = null
        pts.clear()
        current = null
        pointerId = -1
        mode = Mode.INK
    }
}

/** Empfänger ohne Seite (vor der ersten Geste). */
private object NoSink : PageInputSink {
    override fun strokeFinished(tool: String, color: String, size: Double, points: List<Float>) = Unit
    override fun shapePreview(shape: HeftShape?, color: String, size: Double) = Unit
    override fun shapeFinished(shape: HeftShape, color: String, size: Double) = Unit
    override fun writing(on: Boolean) = Unit
    override fun eraseMove(x: Float, y: Float) = Unit
    override fun eraseEnd() = Unit
    override val lasso: LassoGesture get() = error("keine Seite")
    override fun lassoDismiss() = Unit
    override val objects: ObjGesture get() = error("keine Seite")
    override fun touchStart() = Unit
}
