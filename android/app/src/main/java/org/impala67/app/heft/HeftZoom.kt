package org.impala67.app.heft

import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculateCentroid
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.PointerType
import androidx.compose.ui.input.pointer.pointerInput

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
        const val MAX = 4f
    }
}

/**
 * Pinch mit zwei Fingern (nur Touch, Stift ignoriert). Läuft im Initial-Durchgang vor den Kindern und
 * verbraucht die Berührungen, damit die Liste dabei nicht scrollt; [onEnd] bekommt Faktor und Mittelpunkt.
 */
fun Modifier.heftPinch(zoom: HeftZoom, onEnd: (scale: Float, centroid: Offset) -> Unit): Modifier = pointerInput(zoom) {
    awaitEachGesture {
        awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial)
        var pinching = false
        do {
            val event = awaitPointerEvent(PointerEventPass.Initial)
            val touches = event.changes.filter { it.pressed && it.type == PointerType.Touch }
            val penDown = event.changes.any { it.pressed && it.type != PointerType.Touch }
            if (touches.size >= 2 && !penDown) {
                if (!pinching) zoom.origin = event.calculateCentroid()
                pinching = true
                zoom.live = (zoom.live * event.calculateZoom()).coerceIn(1f / zoom.zoom, HeftZoom.MAX / zoom.zoom)
                event.changes.forEach { it.consume() }
            }
        } while (event.changes.any { it.pressed })
        if (pinching) onEnd(zoom.live, zoom.origin)
    }
}
