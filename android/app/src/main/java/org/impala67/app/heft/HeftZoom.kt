package org.impala67.app.heft

import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculateCentroid
import androidx.compose.foundation.gestures.calculatePan
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.foundation.gestures.calculateCentroidSize
import androidx.compose.runtime.State
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.isSpecified
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.PointerEventType
import androidx.compose.ui.input.pointer.PointerType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.unit.dp
import kotlin.math.abs
import kotlin.math.max

/** Rückmeldungen der Finger-Gesten an das Heft. */
class HeftGestureCallbacks(
    /** Pinch, live je Ereignis: Mittelpunkt (Pixel der Ansicht), Verschiebung und Zoomfaktor seit dem letzten Ereignis. */
    val transform: (centroid: Offset, pan: Offset, zoom: Float) -> Unit,
    /** Pinch fertig (die Zoomstufe steht, Auflösungen dürfen nachziehen). */
    val transformEnd: () -> Unit,
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
 * Finger-Gesten des Hefts (heft-viewport.js): Pinch mit zwei Fingern zoomt und verschiebt live (Stift
 * ignoriert); kurze Tipps ohne Bewegung lösen aus: Doppeltipp zoomt, zwei Finger zweimal = Rückgängig,
 * drei Finger = Wiederholen. Läuft im Initial-Durchgang vor den Kindern; zwei Finger verbrauchen die
 * Berührung, damit nichts zeichnet oder scrollt. Erst nach der Berührungsschwelle bewegt sich die Ansicht,
 * damit ein Zwei-Finger-Tipp nichts verrückt. Kurz nach dem Stift zählen Finger nicht (Handballen).
 * [callbacks] wird bei jedem Ereignis frisch gelesen.
 */
fun Modifier.heftGestures(callbacks: State<HeftGestureCallbacks>): Modifier = pointerInput(Unit) {
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
        var travel = 0f
        // Pinch: bis zur Schwelle gesammelt, danach live weitergereicht.
        var moving = false
        var zoomAcc = 1f
        var panAcc = Offset.Zero
        do {
            val event = awaitPointerEvent(PointerEventPass.Initial)
            val touches = event.changes.filter { it.pressed && it.type == PointerType.Touch }
            val penDown = event.changes.any { it.pressed && it.type != PointerType.Touch }
            maxCount = max(maxCount, touches.size)
            travel += event.calculatePan().getDistance()
            event.changes.firstOrNull()?.let { endedAt = it.uptimeMillis }
            if (touches.size >= 2 && !penDown) {
                val zoom = event.calculateZoom()
                val pan = event.calculatePan()
                val centroid = event.calculateCentroid()
                if (!moving) {
                    zoomAcc *= zoom
                    panAcc += pan
                    val span = event.calculateCentroidSize()
                    if (abs(1f - zoomAcc) * span > slop || panAcc.getDistance() > slop) {
                        moving = true
                        if (centroid.isSpecified) callbacks.value.transform(centroid - panAcc, panAcc, zoomAcc)
                    }
                } else if (centroid.isSpecified && (zoom != 1f || pan != Offset.Zero)) {
                    // Mittelpunkt vor diesem Ereignis: dort hält die Ansicht fest, dann wandert sie um `pan`.
                    callbacks.value.transform(centroid - pan, pan, zoom)
                }
                event.changes.forEach { it.consume() }
            }
        } while (event.changes.any { it.pressed })
        val on = callbacks.value
        if (moving) on.transformEnd()
        val quick = !moving && endedAt - startedAt < 300 && travel < slop
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

/**
 * Mausrad und Touchpad verschieben das Heft (Berührungen verschiebt die Stift-Ebene, `PageInput`).
 * [pan] bekommt die Bewegung in Bildschirmpixeln (wie ein Finger: positiv = Inhalt nach rechts/unten).
 */
fun Modifier.heftWheel(wheelStep: Float, pan: (Offset) -> Unit): Modifier = pointerInput(Unit) {
    awaitPointerEventScope {
        while (true) {
            val event = awaitPointerEvent()
            if (event.type != PointerEventType.Scroll || event.changes.any { it.isConsumed }) continue
            val d = event.changes.fold(Offset.Zero) { a, c -> a + c.scrollDelta }
            if (d == Offset.Zero) continue
            pan(-d * wheelStep)
            event.changes.forEach { it.consume() }
        }
    }
}
