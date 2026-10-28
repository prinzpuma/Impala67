package org.impala67.app.heft

import androidx.annotation.DrawableRes
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.HorizontalFloatingToolbar
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconToggleButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.VerticalFloatingToolbar
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import org.impala67.app.R
import org.impala67.app.ui.theme.Impala

/**
 * Werkzeugleiste (heft-toolbar-ui.js): Expressive Floating Toolbar mit drei Stiften, Marker,
 * Radierer und Rückgängig/Wiederholen. Waagerecht unten auf breiten Bildschirmen, sonst senkrecht
 * am Rand. Ein zweiter Tipp auf das aktive Werkzeug öffnet die Optionen ([HeftOptions]).
 */
@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun HeftToolbar(vm: HeftViewModel, vertical: Boolean, modifier: Modifier = Modifier) {
    val t = vm.tools
    val buttons: @Composable () -> Unit = {
        t.pens.forEachIndexed { i, pen ->
            ToolToggle(t.tool == HeftTool.PEN && t.penSlot == i, "Stift ${i + 1}", { vm.selectTool(HeftTool.PEN, i) }) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(painterResource(R.drawable.ic_i_pen_tool), null, Modifier.size(22.dp))
                    Dot(HeftPalette.color(pen.color), Modifier.align(Alignment.BottomEnd))
                }
            }
        }
        ToolToggle(t.tool == HeftTool.MARKER, "Marker", { vm.selectTool(HeftTool.MARKER) }) {
            Box(contentAlignment = Alignment.Center) {
                Icon(painterResource(R.drawable.ic_i_marker), null, Modifier.size(22.dp))
                Dot(HeftPalette.color(t.markerColor), Modifier.align(Alignment.BottomEnd))
            }
        }
        ToolToggle(t.tool == HeftTool.ERASER, "Radierer", { vm.selectTool(HeftTool.ERASER) }) {
            Icon(painterResource(R.drawable.ic_i_eraser), null, Modifier.size(22.dp))
        }
        ToolButton(R.drawable.ic_i_undo, "Rückgängig", vm.canUndo, vm::undo)
        ToolButton(R.drawable.ic_i_redo, "Wiederholen", vm.canRedo, vm::redo)
    }
    if (vertical) {
        VerticalFloatingToolbar(expanded = true, modifier = modifier, content = { buttons() })
    } else {
        HorizontalFloatingToolbar(expanded = true, modifier = modifier, content = { buttons() })
    }
}

/**
 * Optionen des aktiven Werkzeugs: Dicken und Farben (Stift, Marker) bzw. Radiergröße, dazu „Nur Stift
 * zeichnet“ / „Finger dürfen zeichnen“ (heft-toolbar-ui.js `tray`).
 */
@Composable
fun HeftOptions(vm: HeftViewModel, vertical: Boolean, modifier: Modifier = Modifier) {
    val t = vm.tools
    val c = Impala.colors
    val eraser = t.tool == HeftTool.ERASER
    val content: @Composable () -> Unit = {
        val sizes = if (eraser) HeftPalette.eraser else HeftPalette.sizes
        sizes.forEach { (label, value) ->
            val on = (if (eraser) t.eraserSize else t.size) == value
            Box(
                Modifier.size(40.dp).clip(CircleShape).background(if (on) c.tint2 else Color.Transparent)
                    .clickable(onClickLabel = label) { vm.setSize(value) },
                contentAlignment = Alignment.Center,
            ) {
                val d = if (eraser) (value / 2.2).coerceIn(6.0, 16.0) else (4 + value * 1.6).coerceIn(4.0, 12.0)
                Box(Modifier.size(d.dp).clip(CircleShape).background(if (eraser) c.text2 else HeftPalette.color(t.color)))
            }
        }
        if (!eraser) {
            HeftPalette.colors.forEach { css ->
                val on = t.color == css
                Box(
                    Modifier.size(40.dp).clip(CircleShape).clickable(onClickLabel = "Farbe") { vm.setColor(css) },
                    contentAlignment = Alignment.Center,
                ) {
                    Box(
                        Modifier.size(26.dp).clip(CircleShape).background(HeftPalette.color(css))
                            .border(if (on) 3.dp else 1.dp, if (on) c.accent else c.edge, CircleShape),
                    )
                }
            }
            IconButton(vm::toggleOnlyPen) {
                Icon(
                    painterResource(if (t.onlyPen) R.drawable.ic_i_pen else R.drawable.ic_i_hand),
                    if (t.onlyPen) "Nur Stift zeichnet" else "Finger dürfen zeichnen",
                    Modifier.size(22.dp),
                )
            }
        }
    }
    Surface(modifier, shape = CircleShape, color = MaterialTheme.colorScheme.surfaceContainerHigh, shadowElevation = 6.dp) {
        if (vertical) {
            Column(Modifier.padding(vertical = 8.dp, horizontal = 4.dp), Arrangement.spacedBy(2.dp), Alignment.CenterHorizontally) { content() }
        } else {
            Row(Modifier.padding(horizontal = 8.dp, vertical = 4.dp), Arrangement.spacedBy(2.dp), Alignment.CenterVertically) { content() }
        }
    }
}

@Composable
private fun ToolToggle(checked: Boolean, label: String, onClick: () -> Unit, content: @Composable () -> Unit) {
    IconToggleButton(checked = checked, onCheckedChange = { onClick() }, modifier = Modifier.size(48.dp).semantics { contentDescription = label }) {
        Box(Modifier.size(48.dp).clip(CircleShape).background(if (checked) Impala.colors.tint2 else Color.Transparent), Alignment.Center) {
            content()
        }
    }
}

@Composable
private fun ToolButton(@DrawableRes icon: Int, label: String, enabled: Boolean, onClick: () -> Unit) {
    IconButton(onClick, Modifier.size(48.dp), enabled = enabled) {
        Icon(painterResource(icon), label, Modifier.size(22.dp))
    }
}

@Composable
private fun Dot(color: Color, modifier: Modifier) {
    Box(modifier.size(9.dp).clip(CircleShape).background(color).border(1.dp, Impala.colors.edge, CircleShape))
}
