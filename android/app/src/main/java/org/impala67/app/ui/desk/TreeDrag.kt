package org.impala67.app.ui.desk

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.foundation.gestures.scrollBy
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.layout.LayoutCoordinates
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInRoot
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import org.impala67.app.ui.theme.Impala
import org.impala67.app.ui.theme.Radius
import org.impala67.app.ui.theme.TextSize
import kotlin.math.roundToInt

/** Ablage relativ zur Zielzeile wie `dropZoneFor` in der PWA: oberes/unteres Viertel davor/danach, Mitte hinein. */
enum class DropZone { Before, After, Into }

/** Ziel beim Loslassen: [row] = Schlüssel der Zielzeile, `null` = freie Fläche im Baum (Wurzel). */
data class Drop(val row: String?, val zone: DropZone)

/**
 * Ziehen im Seiten- bzw. Stapelbaum (app-sidebar-events.js): Halten startet, ab 6 dp Bewegung wird gezogen,
 * eine Vorschau folgt dem Finger. Jede Zeile meldet ihre Lage ([treeRow]); die Ziel-Zone ergibt sich aus der
 * Fingerhöhe in der Zeile. Über der eigenen Zeile gibt es kein Ziel, außerhalb des Baums auch nicht.
 */
class TreeDrag {
    var source by mutableStateOf<String?>(null); private set
    var label by mutableStateOf(""); private set
    var pointer by mutableStateOf(Offset.Zero); private set
    var drop by mutableStateOf<Drop?>(null); private set
    internal val rows = HashMap<String, Rect>()
    internal var area = Rect.Zero

    val active: Boolean get() = source != null

    /** Zone, in der diese Zeile gerade Ziel ist (für die Markierung). */
    fun zoneOf(row: String): DropZone? = drop?.takeIf { it.row == row }?.zone

    internal fun start(row: String, text: String, at: Offset) {
        source = row
        label = text
        move(at)
    }

    internal fun move(at: Offset) {
        pointer = at
        val hit = rows.entries.firstOrNull { it.value.contains(at) }
        drop = when {
            hit == null -> if (area.contains(at)) Drop(null, DropZone.Into) else null
            hit.key == source -> null
            else -> {
                val r = hit.value
                val y = at.y - r.top
                Drop(hit.key, if (y < r.height / 4) DropZone.Before else if (y > r.height * 3 / 4) DropZone.After else DropZone.Into)
            }
        }
    }

    internal fun finish(): Drop? = drop.also { cancel() }

    internal fun cancel() {
        source = null
        drop = null
    }
}

/** Ab dieser Bewegung nach dem Halten wird gezogen (`PAGE_DRAG_THRESHOLD`). */
private val DragThreshold = 6.dp

/**
 * Zeile im Baum: meldet ihre Lage an [drag], Halten und Loslassen öffnet das Zeilenmenü ([onHold],
 * wie Langdruck in popovers.js), Halten und Ziehen verschiebt sie ([onDrop]). Tippen bleibt beim
 * `clickable` der Zeile; dort `onLongClick` setzen, damit Halten nicht zusätzlich öffnet.
 */
@Composable
fun Modifier.treeRow(drag: TreeDrag, key: String, label: String, enabled: Boolean, onHold: () -> Unit, onDrop: (Drop) -> Unit): Modifier {
    val coords = remember { arrayOfNulls<LayoutCoordinates>(1) }
    val hold by rememberUpdatedState(onHold)
    val dropTo by rememberUpdatedState(onDrop)
    val text by rememberUpdatedState(label)
    DisposableEffect(drag, key) { onDispose { drag.rows.remove(key) } }
    val placed = onGloballyPositioned { coords[0] = it; drag.rows[key] = it.boundsInRoot() }
    if (!enabled) return placed
    return placed.pointerInput(drag, key) {
        val threshold = DragThreshold.toPx()
        var start = Offset.Zero
        var dragging = false
        detectDragGesturesAfterLongPress(
            // Das Halte-Feedback (Vibration) kommt vom `onLongClick` der Zeile.
            onDragStart = { pos -> start = pos; dragging = false },
            onDrag = { change, _ ->
                val c = coords[0] ?: return@detectDragGesturesAfterLongPress
                if (!dragging && (change.position - start).getDistance() < threshold) return@detectDragGesturesAfterLongPress
                change.consume()
                val at = c.localToRoot(change.position)
                if (!dragging) { dragging = true; drag.start(key, text, at) } else drag.move(at)
            },
            // Ein offenes Menü finge die laufende Geste ab; deshalb öffnet es erst beim Loslassen ohne Ziehen.
            onDragEnd = { if (dragging) drag.finish()?.let(dropTo) else hold() },
            onDragCancel = { if (dragging) drag.cancel() },
        )
    }
}

/** Markierung der Zielzeile: Linie oben/unten oder Rahmen für „hinein“ (`.drop-before/-after/-into`). */
@Composable
fun Modifier.dropMark(zone: DropZone?): Modifier {
    if (zone == null) return this
    val accent = Impala.colors.accent
    return drawBehind { mark(zone, accent) }
}

private fun androidx.compose.ui.graphics.drawscope.DrawScope.mark(zone: DropZone, accent: Color) {
    val line = 2.dp.toPx()
    when (zone) {
        DropZone.Before -> drawRect(accent, Offset.Zero, Size(size.width, line))
        DropZone.After -> drawRect(accent, Offset(0f, size.height - line), Size(size.width, line))
        DropZone.Into -> drawRoundRect(accent.copy(alpha = 0.18f), cornerRadius = CornerRadius(Radius.md.toPx()))
    }
}

/**
 * Hülle um eine Baumliste: misst die freie Fläche, zeichnet die Vorschau am Finger und scrollt am Rand mit.
 */
@Composable
fun TreeDragArea(drag: TreeDrag, list: LazyListState, modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    val origin = remember { arrayOf(Offset.Zero) }
    val edge = with(LocalDensity.current) { 40.dp.toPx() }
    Box(modifier.onGloballyPositioned { origin[0] = it.positionInRoot(); drag.area = it.boundsInRoot() }) {
        content()
        if (drag.active) {
            val c = Impala.colors
            val p = drag.pointer - origin[0]
            Text(
                drag.label, maxLines = 1, overflow = TextOverflow.Ellipsis, color = c.text, fontSize = TextSize.sm,
                modifier = Modifier.offset { IntOffset((p.x + 12.dp.toPx()).roundToInt(), (p.y + 12.dp.toPx()).roundToInt()) }
                    .widthIn(max = 200.dp).shadow(6.dp, RoundedCornerShape(Radius.sm))
                    .background(c.menu, RoundedCornerShape(Radius.sm)).border(1.dp, c.edgeSoft, RoundedCornerShape(Radius.sm))
                    .padding(horizontal = 10.dp, vertical = 6.dp),
            )
        }
    }
    // Am oberen/unteren Rand mitscrollen, damit weit entfernte Ziele erreichbar sind.
    LaunchedEffect(drag.active) {
        while (drag.active) {
            val a = drag.area
            val y = drag.pointer.y
            val dy = when { y < a.top + edge -> -12f; y > a.bottom - edge -> 12f; else -> 0f }
            if (dy != 0f && list.scrollBy(dy) != 0f) drag.move(drag.pointer)
            delay(16)
        }
    }
}
