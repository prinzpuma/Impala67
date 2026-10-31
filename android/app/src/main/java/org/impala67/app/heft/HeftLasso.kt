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
import uniffi.impala_ffi.heftIsLassoBodyHit
import uniffi.impala_ffi.heftLassoHandles
import uniffi.impala_ffi.heftLassoResizeFactor
import uniffi.impala_ffi.heftLassoResizeStartDist
import kotlin.math.hypot

/** Lasso-Blau der PWA (`drawLassoSelection`, `drawLassoPath`). */
private val LassoBlue = Color(0xFF2F6FED)
private const val HANDLE_RADIUS = 5.5f

/** Ausgewählte Striche einer Seite mit ihren Grenzen; [drag] ist die laufende Geste darauf. */
@Immutable
data class LassoSel(val heftPageId: String, val ids: List<String>, val bounds: HeftRect, val drag: LassoDrag? = null) {
    /** Rahmen wie er gerade zu sehen ist (während der Geste mitbewegt). */
    val shown: HeftRect get() = drag?.takeIf { it.live }?.map(drag.bounds0) ?: bounds
}

/**
 * Vorschau einer Geste auf der Auswahl: erst um [ax]/[ay] mit [factor] skalieren, dann um [dx]/[dy]
 * verschieben. [marks] kennzeichnet die Striche vor der Geste; nur sie bekommen die Vorschau, damit
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
    /** `false`, sobald die Änderung geschrieben ist. */
    val live: Boolean = true,
) {
    val isIdentity get() = dx == 0f && dy == 0f && factor == 1f

    fun map(b: HeftRect): HeftRect {
        fun x(v: Double) = ax + (v - ax) * factor + dx
        fun y(v: Double) = ay + (v - ay) * factor + dy
        return HeftRect(x(b.minX), y(b.minY), x(b.maxX), y(b.maxY))
    }
}

/** Kennzeichen der Lage eines Strichs (erster Punkt bzw. Form). */
fun HeftStroke.mark(): Any = if (points.size >= 2) points[0] to points[1] else (shape ?: id)

/**
 * Lasso-Geste einer Seite (heft-input.js): Auf einem Eckgriff skalieren, im Rahmen verschieben,
 * sonst ein neues Lasso ziehen. Koordinaten in Seiteneinheiten.
 */
class LassoGesture(private val vm: HeftViewModel, private val heftPageId: String) {
    private enum class Mode { NONE, PATH, MOVE, RESIZE }

    /** Freihandpfad `[x, y, …]` während der Auswahl. */
    val path = mutableStateListOf<Float>()
    private var mode = Mode.NONE
    private var sx = 0f
    private var sy = 0f
    private var startDist = 0.0

    private fun selection() = vm.lasso?.takeIf { it.heftPageId == heftPageId && it.ids.isNotEmpty() }

    /** Liegt der Fingertipp auf der Auswahl (Rahmen + 20)? */
    fun onSelection(x: Float, y: Float) = selection()?.let { heftIsLassoBodyHit(x.toDouble(), y.toDouble(), it.shown, 20.0) } ?: false

    fun down(x: Float, y: Float, finger: Boolean) {
        sx = x
        sy = y
        val sel = selection()?.takeIf { it.drag?.live != true }
        if (sel != null) {
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
            Mode.NONE -> Unit
        }
    }

    fun up() {
        when (mode) {
            Mode.PATH -> { if (path.size >= 6) vm.lassoSelect(heftPageId, path.toList()); path.clear() }
            Mode.MOVE, Mode.RESIZE -> vm.lassoRelease()
            Mode.NONE -> Unit
        }
        mode = Mode.NONE
    }

    fun cancel() {
        if (mode == Mode.MOVE || mode == Mode.RESIZE) {
            vm.lassoPreview { it.copy(dx = 0f, dy = 0f, factor = 1f) }
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

/** Auswahlrahmen mit den vier Eckgriffen (wie `drawLassoSelection`). */
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
}
