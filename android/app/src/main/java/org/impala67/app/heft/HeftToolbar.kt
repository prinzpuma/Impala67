package org.impala67.app.heft

import androidx.annotation.DrawableRes
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import org.impala67.app.R
import org.impala67.app.ui.theme.Impala
import kotlin.math.roundToInt

/**
 * Schwebende Fläche der Heft-Leisten (`.heft-pill`, `.heft-tray`, `.heft-corner`, `.heft-lasso-bar`):
 * Menüfläche, 1-px-Rand und weicher Schatten (`--elev-2`).
 */
fun Modifier.heftFloat(shape: Shape = CircleShape, border: Boolean = true): Modifier = composed {
    val c = Impala.colors
    shadow(10.dp, shape, ambientColor = Color.Black.copy(alpha = 0.25f), spotColor = Color.Black.copy(alpha = 0.5f))
        .clip(shape)
        .background(c.menu)
        .border(1.dp, if (border) c.edge else c.edgeSoft, shape)
}

/** Durchmesser des Farbpunkts für eine Strichdicke (heft-toolbar-ui.js `dotPx`). */
private fun dotDp(size: Double): Dp = (2 + size * 1.6).coerceIn(4.0, 12.0).roundToInt().dp

/**
 * Werkzeugleiste (heft-toolbar-ui.js `toolbarHtml`): Kapsel mit drei Stift-Favoriten, Marker | Radierer |
 * Lasso | Rückgängig, Wiederholen. Waagerecht oben (Tablet) bzw. unten, senkrecht am Rand auf schmalen
 * Bildschirmen. Ein zweiter Tipp auf das aktive Werkzeug öffnet die Optionen ([HeftOptions]).
 */
@Composable
fun HeftToolbar(vm: HeftViewModel, vertical: Boolean, modifier: Modifier = Modifier) {
    val t = vm.tools
    val items: @Composable () -> Unit = {
        t.pens.forEachIndexed { i, pen ->
            val on = t.tool == HeftTool.PEN && t.penSlot == i
            ToolButton(R.drawable.ic_i_pen_tool, "Stift ${i + 1}", on, open = on && t.expanded, onClick = { vm.selectTool(HeftTool.PEN, i) }) {
                PenDot(HeftPalette.color(pen.color), dotDp(pen.size), Modifier.align(Alignment.BottomEnd).padding(4.dp))
            }
        }
        val marker = t.tool == HeftTool.MARKER
        ToolButton(R.drawable.ic_i_marker, "Marker", marker, open = marker && t.expanded, onClick = { vm.selectTool(HeftTool.MARKER) })
        Sep(vertical)
        val eraser = t.tool == HeftTool.ERASER
        ToolButton(R.drawable.ic_i_eraser, "Radierer", eraser, open = eraser && t.expanded, onClick = { vm.selectTool(HeftTool.ERASER) })
        Sep(vertical)
        ToolButton(R.drawable.ic_i_lasso, "Lasso — Striche auswählen", t.tool == HeftTool.LASSO, onClick = { vm.selectTool(HeftTool.LASSO) })
        Sep(vertical)
        ToolButton(R.drawable.ic_i_undo, "Rückgängig", enabled = vm.canUndo, onClick = vm::undo)
        ToolButton(R.drawable.ic_i_redo, "Wiederholen", enabled = vm.canRedo, onClick = vm::redo)
    }
    if (vertical) {
        Column(modifier.heftFloat().padding(4.dp), Arrangement.spacedBy(2.dp), Alignment.CenterHorizontally) { items() }
    } else {
        Row(modifier.heftFloat().padding(4.dp), Arrangement.spacedBy(2.dp), Alignment.CenterVertically) { items() }
    }
}

/**
 * Optionen des aktiven Werkzeugs (`.heft-tray`): Strichstärken als Punkte | Farben | „Nur Stift zeichnet“ /
 * „Finger dürfen zeichnen“; beim Radierer drei Balken (Klein, Mittel, Groß).
 */
@Composable
fun HeftOptions(vm: HeftViewModel, vertical: Boolean, modifier: Modifier = Modifier) {
    val t = vm.tools
    val c = Impala.colors
    val eraser = t.tool == HeftTool.ERASER
    val content: @Composable () -> Unit = {
        if (eraser) {
            HeftPalette.eraser.forEach { (label, value) ->
                SizeButton(label, t.eraserSize == value, { vm.setSize(value) }) { color ->
                    Box(Modifier.width(15.dp).height(maxOf(2, (value / 5).roundToInt()).dp).clip(CircleShape).background(color))
                }
            }
        } else {
            HeftPalette.sizes.forEach { (label, value) ->
                SizeButton(label, t.size == value, { vm.setSize(value) }) { color ->
                    Box(Modifier.size(dotDp(value)).clip(CircleShape).background(color))
                }
            }
            Sep(vertical, tray = true)
            HeftPalette.colors.forEach { css ->
                val on = t.color == css
                // `.heft-swatch`: 22 dp, aktiv mit Ring (2 dp Lücke, 1,5 dp Textfarbe).
                Box(
                    Modifier.size(28.dp).clip(CircleShape)
                        .then(if (on) Modifier.border(1.5.dp, c.text, CircleShape) else Modifier)
                        .clickable(role = Role.Button, onClickLabel = "Farbe") { vm.setColor(css) },
                    Alignment.Center,
                ) {
                    Box(
                        Modifier.size(if (on) 21.dp else 22.dp).clip(CircleShape).background(HeftPalette.color(css))
                            .then(if (on) Modifier else Modifier.border(1.dp, Color.White.copy(alpha = 0.17f), CircleShape)),
                    )
                }
            }
            Sep(vertical, tray = true)
            SizeButton(if (t.onlyPen) "Nur Stift zeichnet" else "Finger dürfen zeichnen", t.onlyPen, vm::toggleOnlyPen) { color ->
                Icon(painterResource(if (t.onlyPen) R.drawable.ic_i_pen else R.drawable.ic_i_hand), null, Modifier.size(17.dp), color)
            }
        }
    }
    if (vertical) {
        Column(modifier.heftFloat().padding(horizontal = 4.dp, vertical = 6.dp), Arrangement.spacedBy(2.dp), Alignment.CenterHorizontally) { content() }
    } else {
        Row(modifier.heftFloat().padding(horizontal = 6.dp, vertical = 4.dp), Arrangement.spacedBy(2.dp), Alignment.CenterVertically) { content() }
    }
}

/** `.heft-main`: 36-dp-Kreis; aktiv in Akzent-Tönung, offen (Optionen sichtbar) kräftiger. */
@Composable
private fun ToolButton(
    @DrawableRes icon: Int,
    label: String,
    active: Boolean = false,
    open: Boolean = false,
    enabled: Boolean = true,
    onClick: () -> Unit,
    extra: @Composable androidx.compose.foundation.layout.BoxScope.() -> Unit = {},
) {
    val c = Impala.colors
    Box(
        Modifier.size(36.dp).alpha(if (enabled) 1f else 0.38f).clip(CircleShape)
            .background(if (open) c.tint3 else if (active) c.accent.copy(alpha = 0.14f) else Color.Transparent)
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
            .semantics { contentDescription = label },
        Alignment.Center,
    ) {
        Icon(painterResource(icon), null, Modifier.size(19.dp), if (active) c.accent else c.text2)
        extra()
    }
}

/** `.heft-size`: 32-dp-Kreis im Tray, aktiv mit Akzent-Tönung. */
@Composable
private fun SizeButton(label: String, active: Boolean, onClick: () -> Unit, content: @Composable (Color) -> Unit) {
    val c = Impala.colors
    Box(
        Modifier.size(32.dp).clip(CircleShape).background(if (active) c.tint2 else Color.Transparent)
            .clickable(role = Role.Button, onClick = onClick).semantics { contentDescription = label },
        Alignment.Center,
    ) { content(if (active) c.text else c.text2) }
}

/** `.heft-sep`: 1 × 20 dp; in der Hauptleiste 4 dp, im Tray 4 dp Abstand. */
@Composable
private fun Sep(vertical: Boolean, tray: Boolean = false) {
    val color = if (tray) Impala.colors.surfaceActive else Impala.colors.edge
    if (vertical) Box(Modifier.padding(vertical = 4.dp).width(20.dp).height(1.dp).background(color))
    else Box(Modifier.padding(horizontal = 4.dp).width(1.dp).height(20.dp).background(color))
}

/** `.heft-penfav-dot`: Farbpunkt in Stiftdicke mit Ring in Menüfarbe. */
@Composable
private fun PenDot(color: Color, d: Dp, modifier: Modifier) {
    val c = Impala.colors
    Box(
        modifier.size(d + 5.dp).clip(CircleShape).background(c.text.copy(alpha = 0.22f)).padding(1.dp)
            .clip(CircleShape).background(c.menu).padding(1.5.dp).clip(CircleShape).background(color),
    )
}
