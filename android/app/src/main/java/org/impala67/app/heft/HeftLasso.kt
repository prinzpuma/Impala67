package org.impala67.app.heft

import androidx.compose.runtime.Immutable
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke as DrawStroke
import uniffi.impala_ffi.HeftRect
import uniffi.impala_ffi.HeftStroke
import uniffi.impala_ffi.heftHitLassoHandle
import uniffi.impala_ffi.heftHitLassoRotateHandle
import uniffi.impala_ffi.heftIsLassoBodyHit
import uniffi.impala_ffi.heftLassoHandles
import uniffi.impala_ffi.heftLassoResizeFactor
import uniffi.impala_ffi.heftLassoResizeStartDist
import uniffi.impala_ffi.heftLassoRotateHandle
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.sin

/** Lasso-Blau der PWA (`drawLassoSelection`, `drawLassoPath`). */
private val LassoBlue = Color(0xFF2F6FED)
private const val HANDLE_RADIUS = 5.5f

/** Ausgewählte Striche, Bilder und Textfelder einer Seite mit ihren Grenzen; [drag] ist die laufende Geste darauf. */
// funktion: heft.lasso-objekte
@Immutable
data class LassoSel(
    val heftPageId: String,
    val ids: List<String>,
    val bounds: HeftRect,
    val imageIds: List<String> = emptyList(),
    val textIds: List<String> = emptyList(),
    val drag: LassoDrag? = null,
) {
    val hasItems: Boolean get() = ids.isNotEmpty() || imageIds.isNotEmpty() || textIds.isNotEmpty()
    /** Rahmen wie er gerade zu sehen ist (während der Geste mitbewegt). */
    val shown: HeftRect get() = drag?.takeIf { it.live }?.map(drag.bounds0) ?: bounds
}

/**
 * Vorschau einer Geste auf der Auswahl: Verschieben, Skalieren oder Drehen.
 * [marks] kennzeichnet die Striche vor der Geste; nur sie bekommen die Vorschau, damit
 * nach dem Speichern weder doppelt verschoben wird noch etwas aufblitzt.
 */
@Immutable
data class LassoDrag(
    val bounds0: HeftRect,
    val marks: Map<String, Any>,
    val dx: Float = 0f,
    val dy: Float = 0f,
    val ax: Float = 0f,
    val ay: Float = 0f,
    val factor: Float = 1f,
    val cx: Float = 0f,
    val cy: Float = 0f,
    val angleRad: Float = 0f,
    /** `false`, sobald die Änderung geschrieben ist. */
    val live: Boolean = true,
) {
    val isIdentity get() = dx == 0f && dy == 0f && factor == 1f && angleRad == 0f
    val angleDeg: Float get() = Math.toDegrees(angleRad.toDouble()).toFloat()

    fun map(b: HeftRect): HeftRect {
        if (angleRad != 0f) {
            val s = sin(angleRad.toDouble())
            val c = cos(angleRad.toDouble())
            val pts = listOf(b.minX to b.minY, b.maxX to b.minY, b.maxX to b.maxY, b.minX to b.maxY).map { (px, py) ->
                val mx = px - cx
                val my = py - cy
                (cx + mx * c - my * s) to (cy + mx * s + my * c)
            }
            return HeftRect(pts.minOf { it.first }, pts.minOf { it.second }, pts.maxOf { it.first }, pts.maxOf { it.second })
        }
        fun x(v: Double) = ax + (v - ax) * factor + dx
        fun y(v: Double) = ay + (v - ay) * factor + dy
        return HeftRect(x(b.minX), y(b.minY), x(b.maxX), y(b.maxY))
    }

    fun mapRect(x: Double, y: Double, w: Double, h: Double, minW: Double, minH: Double): DoubleArray = when {
        angleRad != 0f -> {
            val s = sin(angleRad.toDouble())
            val c = cos(angleRad.toDouble())
            val mx = x + w / 2.0 - cx
            val my = y + h / 2.0 - cy
            doubleArrayOf(cx + mx * c - my * s - w / 2.0, cy + mx * s + my * c - h / 2.0, w, h)
        }
        factor != 1f -> doubleArrayOf(ax + (x - ax) * factor, ay + (y - ay) * factor, max(minW, w * factor), max(minH, h * factor))
        else -> doubleArrayOf(x + dx, y + dy, w, h)
    }
}

/** Kennzeichen der Lage eines Strichs (erster Punkt bzw. Form). */
fun HeftStroke.mark(): Any = if (points.size >= 2) points[0] to points[1] else (shape ?: id)

/**
 * Lasso-Geste einer Seite (heft-input.js): Auf dem Drehgriff drehen, auf einem Eckgriff skalieren,
 * im Rahmen verschieben, sonst ein neues Lasso ziehen. Koordinaten in Seiteneinheiten.
 */
class LassoGesture(private val vm: HeftViewModel, private val heftPageId: String) {
    private enum class Mode { NONE, PATH, MOVE, RESIZE, ROTATE }

    /** Freihandpfad `[x, y, …]` während der Auswahl. */
    val path = mutableStateListOf<Float>()
    private var mode = Mode.NONE
    private var sx = 0f
    private var sy = 0f
    private var startDist = 0.0
    private var startAngle = 0.0

    private fun selection() = vm.lasso?.takeIf { it.heftPageId == heftPageId && it.hasItems }

    /** Liegt der Fingertipp auf der Auswahl (Rahmen + 20 oder Drehgriff)? */
    fun onSelection(x: Float, y: Float) = selection()?.let {
        heftIsLassoBodyHit(x.toDouble(), y.toDouble(), it.shown, 20.0) ||
            heftHitLassoRotateHandle(x.toDouble(), y.toDouble(), it.shown, 24.0)
    } ?: false

    fun down(x: Float, y: Float, finger: Boolean) {
        sx = x
        sy = y
        val sel = selection()?.takeIf { it.drag?.live != true }
        if (sel != null) {
            if (heftHitLassoRotateHandle(x.toDouble(), y.toDouble(), sel.bounds, if (finger) 24.0 else 18.0)) {
                val rot = heftLassoRotateHandle(sel.bounds)
                mode = Mode.ROTATE
                startAngle = atan2(y.toDouble() - rot.cy, x.toDouble() - rot.cx)
                vm.lassoGrab()
                vm.lassoPreview { it.copy(cx = rot.cx.toFloat(), cy = rot.cy.toFloat()) }
                return
            }
            val handle = heftHitLassoHandle(x.toDouble(), y.toDouble(), sel.bounds, if (finger) 22.0 else 18.0)
            if (handle != null) {
                mode = Mode.RESIZE
                startDist = heftLassoResizeStartDist(handle.anchorX, handle.anchorY, x.toDouble(), y.toDouble())
                vm.lassoGrab()
                vm.lassoPreview { it.copy(ax = handle.anchorX.toFloat(), ay = handle.anchorY.toFloat()) }
                return
            }
            if (heftIsLassoBodyHit(x.toDouble(), y.toDouble(), sel.bounds, 12.0)) {
                mode = Mode.MOVE
                vm.lassoGrab()
                return
            }
        }
        // Neue Auswahl: alte Markierung sofort wegräumen.
        vm.clearLasso()
        mode = Mode.PATH
        path.clear()
        path += x
        path += y
    }

    fun move(x: Float, y: Float) {
        when (mode) {
            Mode.PATH -> if (hypot(x - path[path.size - 2], y - path[path.size - 1]) >= 2.5f) { path += x; path += y }
            Mode.MOVE -> vm.lassoPreview { it.copy(dx = x - sx, dy = y - sy) }
            Mode.RESIZE -> vm.lassoPreview {
                val f = heftLassoResizeFactor(
                    it.ax.toDouble(), it.ay.toDouble(), sx.toDouble(), sy.toDouble(), startDist, x.toDouble(), y.toDouble(), it.bounds0,
                )
                it.copy(factor = f.toFloat())
            }
            Mode.ROTATE -> vm.lassoPreview {
                val angle = atan2(y.toDouble() - it.cy, x.toDouble() - it.cx) - startAngle
                it.copy(angleRad = angle.toFloat())
            }
            Mode.NONE -> Unit
        }
    }

    fun up() {
        when (mode) {
            Mode.PATH -> { if (path.size >= 6) vm.lassoSelect(heftPageId, path.toList()); path.clear() }
            Mode.MOVE, Mode.RESIZE, Mode.ROTATE -> vm.lassoRelease()
            Mode.NONE -> Unit
        }
        mode = Mode.NONE
    }

    fun cancel() {
        if (mode == Mode.MOVE || mode == Mode.RESIZE || mode == Mode.ROTATE) {
            vm.lassoPreview { it.copy(dx = 0f, dy = 0f, factor = 1f, angleRad = 0f) }
            vm.lassoRelease()
        }
        path.clear()
        mode = Mode.NONE
    }
}

private val dash = floatArrayOf(7f, 4f)

/** Freihandpfad des Lassos (gestrichelt, wie `drawLassoPath`). */
fun DrawScope.drawLassoPath(pts: List<Float>, k: Float) {
    if (pts.size < 4) return
    val path = Path().apply {
        moveTo(pts[0] * k, pts[1] * k)
        for (i in 2 until pts.size - 1 step 2) lineTo(pts[i] * k, pts[i + 1] * k)
    }
    drawPath(path, LassoBlue, style = DrawStroke(1.7f * k, pathEffect = PathEffect.dashPathEffect(dash.map { it * k }.toFloatArray())))
}

/** Auswahlrahmen mit den vier Eckgriffen und Drehgriff (wie `drawLassoSelection`). */
fun DrawScope.drawLassoSelection(bounds: HeftRect, k: Float) {
    val h = heftLassoHandles(bounds).associateBy { it.corner }
    val tl = h.getValue("tl")
    val br = h.getValue("br")
    drawRect(
        LassoBlue,
        topLeft = Offset(tl.x.toFloat() * k, tl.y.toFloat() * k),
        size = androidx.compose.ui.geometry.Size((br.x - tl.x).toFloat() * k, (br.y - tl.y).toFloat() * k),
        style = DrawStroke(1.8f * k, pathEffect = PathEffect.dashPathEffect(dash.map { it * k }.toFloatArray())),
    )
    for (p in h.values) {
        val c = Offset(p.x.toFloat() * k, p.y.toFloat() * k)
        drawCircle(LassoBlue, HANDLE_RADIUS * k, c)
        drawCircle(Color.White, HANDLE_RADIUS * k, c, style = DrawStroke(2f * k))
    }
    val rot = heftLassoRotateHandle(bounds)
    val rotPos = Offset(rot.x.toFloat() * k, rot.y.toFloat() * k)
    drawLine(LassoBlue, Offset(rot.cx.toFloat() * k, tl.y.toFloat() * k), rotPos, strokeWidth = 1.6f * k)
    drawCircle(Color.White, (HANDLE_RADIUS + 1.5f) * k, rotPos)
    drawCircle(LassoBlue, (HANDLE_RADIUS + 1.5f) * k, rotPos, style = DrawStroke(2f * k))
}
