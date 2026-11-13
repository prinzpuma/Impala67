package org.impala67.app.ui.desk

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.State
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.layout.layout
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.Dp
import kotlin.math.roundToInt

/**
 * Ein- und Ausklappen einer Seitenspalte (Seitenleiste, KI-Panel), ohne die Mitte jedes Bild neu zu messen.
 *
 * `expandHorizontally`/`shrinkHorizontally` ändern die Breite der Spalte in jedem Bild; die Mitte (Editor, Heft)
 * bekommt dadurch jedes Bild neue Maße und baut sich neu auf – das ruckelt. Hier misst sich die Spalte einmal
 * in voller Breite und wird nur abgeschnitten und verschoben; die Mitte misst sich gleich in ihrer Endbreite
 * ([slideContent]) und gleitet nur mit. Die Animation läuft allein in der Layout-Phase (keine Recomposition).
 */
class DeskSlide internal constructor(private val progress: State<Float>, private val open: State<Boolean>, private val gapPx: Int) {
    /** Volle Breite der Spalte; die Zeile misst sie vor der gewichteten Mitte. */
    private var fullPx = 0

    /** Spalte gehört in die Komposition, solange sie offen ist oder noch zuklappt. */
    val shown by derivedStateOf { open.value || progress.value > 0f }

    private val fraction get() = progress.value.coerceIn(0f, 1f)

    /** Wie viel Platz die Spalte gerade mehr belegt als am Ende der Animation (inklusive Abstand zur Mitte). */
    internal fun pendingPx(): Int {
        if (!shown) return 0
        val now = (fullPx * fraction).roundToInt() + gapPx
        val target = if (open.value) fullPx + gapPx else 0
        return now - target
    }

    /** Modifier der Spalte; [fromStart] = links (gleitet von links herein), sonst rechts. */
    fun Modifier.slidePanel(fromStart: Boolean): Modifier = clipToBounds().layout { m, c ->
        val p = m.measure(c.copy(minWidth = 0, maxWidth = Constraints.Infinity))
        fullPx = p.width
        val w = (p.width * fraction).roundToInt()
        layout(w, p.height) { p.place(if (fromStart) w - p.width else 0, 0) }
    }
}

@Composable
fun rememberDeskSlide(open: Boolean, gap: Dp): DeskSlide {
    // Das Motion-Schema schaltet bei „Bewegung reduzieren“ selbst auf `snap()` (ImpalaTheme).
    val progress = animateFloatAsState(if (open) 1f else 0f, MaterialTheme.motionScheme.defaultSpatialSpec(), label = "desk-slide")
    val openState = rememberUpdatedState(open)
    val gapPx = with(LocalDensity.current) { gap.roundToPx() }
    return remember(progress, gapPx) { DeskSlide(progress, openState, gapPx) }
}

/** Mitte zwischen den Spalten: gleich in der Endbreite messen, links anlegen und auf den eigenen Platz zuschneiden. */
fun Modifier.slideContent(vararg slides: DeskSlide): Modifier = clipToBounds().layout { m, c ->
    val w = (c.maxWidth + slides.sumOf { it.pendingPx() }).coerceAtLeast(0)
    val p = m.measure(c.copy(minWidth = w, maxWidth = w))
    layout(c.maxWidth, p.height) { p.place(0, 0) }
}
