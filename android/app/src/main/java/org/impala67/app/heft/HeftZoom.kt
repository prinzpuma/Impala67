package org.impala67.app.heft

import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculateCentroid
import androidx.compose.foundation.gestures.calculatePan
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.runtime.Stable
import androidx.compose.runtime.State
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.PointerType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.unit.dp
import kotlin.math.abs
import kotlin.math.max

/**
 * Zoom und waagerechtes Verschieben der Seitenspalte (heft-viewport.js). [zoom] ist die festgeschriebene
 * Stufe (Seitenbreite = Passbreite × zoom), [panX] der Versatz nach links in Pixeln. Während zweier
 * Finger skaliert nur [live] die Ebene (scharf wird sie erst beim Loslassen, wenn die Seiten neu
 * gelegt sind); [origin] ist der Fixpunkt in Pixeln der Ansicht.
 */
@Stable
class HeftZoom {
    var zoom by mutableFloatStateOf(1f)
    var panX by mutableFloatStateOf(0f)
    var live by mutableFloatStateOf(1f)
    var origin by mutableStateOf(Offset.Zero)

    companion object {
        const val MIN = 0.4f
        const val MAX = 6f
    }
}

/** Rückmeldungen der Finger-Gesten an das Heft. */
class HeftGestureCallbacks(
    /** Pinch fertig: Faktor und Mittelpunkt (in Pixeln der Ansicht). */
    val pinchEnd: (scale: Float, centroid: Offset) -> Unit,
    /** Doppeltipp mit einem Finger (heft-viewport.js: auf ca. 2,2× bzw. zurück auf Passbreite). */
    val doubleTap: (Offset) -> Unit,
    /** Zwei-Finger-Doppeltipp. */
    val undo: () -> Unit,
    /** Drei-Finger-Tipp. */
    val redo: () -> Unit,
    /** Einfinger-Gesten erlaubt (nur, wenn der Finger nicht zeichnet). */
    val fingerFree: () -> Boolean,
)

/**
 * Finger-Gesten des Hefts (heft-viewport.js): Pinch mit zwei Fingern zoomt (Stift ignoriert); kurze
 * Tipps ohne Bewegung lösen aus: Doppeltipp zoomt, zwei Finger zweimal = Rückgängig, drei Finger =
 * Wiederholen. Läuft im Initial-Durchgang vor den Kindern; nur der Pinch verbraucht Berührungen,
 * damit die Liste dabei nicht scrollt. Kurz nach dem Stift zählen Finger nicht (Handballen).
 * [callbacks] wird bei jeder Geste frisch gelesen (die Rückmeldungen hängen von der Zoomstufe ab).
 */
fun Modifier.heftGestures(zoom: HeftZoom, callbacks: State<HeftGestureCallbacks>): Modifier = pointerInput(zoom) {
    var lastTap = 0L
    var tapAt = Offset.Zero
    var lastTwoTap = 0L
    val slop = viewConfiguration.touchSlop
    awaitEachGesture {
        val down = awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial)
        val touch = down.type == PointerType.Touch
        val startedAt = down.uptimeMillis
        var endedAt = startedAt
        var maxCount = 1
        var pinching = false
        var travel = 0f
        do {
            val event = awaitPointerEvent(PointerEventPass.Initial)
            val touches = event.changes.filter { it.pressed && it.type == PointerType.Touch }
            val penDown = event.changes.any { it.pressed && it.type != PointerType.Touch }
            maxCount = max(maxCount, touches.size)
            travel += event.calculatePan().getDistance()
            event.changes.firstOrNull()?.let { endedAt = it.uptimeMillis }
            if (touches.size >= 2 && !penDown) {
                if (!pinching) zoom.origin = event.calculateCentroid()
                pinching = true
                zoom.live = (zoom.live * event.calculateZoom()).coerceIn(HeftZoom.MIN / zoom.zoom, HeftZoom.MAX / zoom.zoom)
                event.changes.forEach { it.consume() }
            }
        } while (event.changes.any { it.pressed })
        val on = callbacks.value
        val quick = endedAt - startedAt < 300 && travel < slop && abs(zoom.live - 1f) < 0.04f
        if (pinching) {
            if (quick) zoom.live = 1f else on.pinchEnd(zoom.live, zoom.origin)
        }
        if (!touch || !quick || penRecently()) return@awaitEachGesture
        when {
            maxCount == 2 -> {
                // Erst der Doppeltipp mit zwei Fingern macht rückgängig (einer kam beim Abstützen zu oft vor).
                if (endedAt - lastTwoTap < 500) { lastTwoTap = 0; on.undo() } else lastTwoTap = endedAt
            }
            maxCount >= 3 -> on.redo()
            on.fingerFree() -> {
                if (endedAt - lastTap < 330 && (down.position - tapAt).getDistance() < 64.dp.toPx()) {
                    lastTap = 0
                    on.doubleTap(down.position)
                } else {
                    lastTap = endedAt
                    tapAt = down.position
                }
            }
        }
    }
}
