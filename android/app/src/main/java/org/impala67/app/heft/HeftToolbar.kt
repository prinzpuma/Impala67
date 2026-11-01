package org.impala67.app.heft

import androidx.annotation.DrawableRes
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.PressInteraction
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ripple
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.draw.scale
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.impala67.app.R
import org.impala67.app.ui.components.pressScale
import org.impala67.app.ui.theme.Impala
import kotlin.math.roundToInt

/** Kapsel der Werkzeugleiste (`.heft-pill`, radius-lg) und Knöpfe darin (radius-md) – konzentrisch gerundet. */
private val CapsuleShape = RoundedCornerShape(18.dp)
private val ButtonShape = RoundedCornerShape(12.dp)
private val TrayShape = RoundedCornerShape(16.dp)

/** Halten des Radierer-Knopfs (heft.js `onHostPointerDown`): ab 380 ms vorübergehend radieren. */
private const val ERASER_HOLD_MS = 380L

/**
 * Schwebende Fläche der Heft-Leisten (`.heft-pill`, `.heft-tray`, `.heft-corner`, `.heft-lasso-bar`):
 * Menüfläche, 1-px-Rand und weicher Schatten (`--elev-2`).
 */
fun Modifier.heftFloat(shape: Shape = CircleShape, border: Boolean = true): Modifier = composed {
    val c = Impala.colors
    shadow(12.dp, shape, ambientColor = Color.Black.copy(alpha = 0.18f), spotColor = Color.Black.copy(alpha = 0.32f))
        .clip(shape)
        .background(c.menu)
        .border(1.dp, if (border) c.edge else c.edgeSoft, shape)
}

/** Durchmesser des Farbpunkts für eine Strichdicke (heft-toolbar-ui.js `dotPx`). */
private fun dotDp(size: Double): Dp = (2 + size * 1.6).coerceIn(4.0, 12.0).roundToInt().dp

/**
 * Werkzeugleiste oben mittig (heft-toolbar-ui.js `toolbarHtml`) mit der Optionsleiste direkt darunter:
 * drei Stift-Favoriten und Marker | Radierer (halten = kurz radieren) | Lasso, Laser | Rückgängig,
 * Wiederholen | Einklappen. Auf dem Telefon ([phone]) ohne Laser; Rückgängig/Wiederholen stehen dort
 * in der Kopfzeile. Ein zweiter Tipp auf das aktive Werkzeug öffnet die Optionen.
 */
@Composable
fun HeftToolbar(vm: HeftViewModel, phone: Boolean, modifier: Modifier = Modifier) {
    val t = vm.tools
    Column(modifier, Arrangement.spacedBy(6.dp), Alignment.CenterHorizontally) {
        AnimatedContent(
            targetState = t.collapsed,
            transitionSpec = {
                (fadeIn(MaterialTheme.motionScheme.defaultEffectsSpec()) + scaleIn(initialScale = 0.9f))
                    .togetherWith(fadeOut(MaterialTheme.motionScheme.fastEffectsSpec()) + scaleOut(targetScale = 0.9f))
            },
            contentAlignment = Alignment.TopCenter,
            label = "heft-toolbar",
        ) { collapsed ->
            if (collapsed) MiniCapsule(vm) else FullCapsule(vm, phone)
        }
        AnimatedVisibility(
            visible = t.expanded && !t.collapsed && t.tool.hasOptions,
            enter = fadeIn(MaterialTheme.motionScheme.defaultEffectsSpec()) + expandVertically(expandFrom = Alignment.Top),
            exit = fadeOut(MaterialTheme.motionScheme.fastEffectsSpec()) + shrinkVertically(shrinkTowards = Alignment.Top),
            label = "heft-tray",
        ) {
            HeftOptions(vm, phone)
        }
    }
}

@Composable
private fun FullCapsule(vm: HeftViewModel, phone: Boolean) {
    val t = vm.tools
    val btn = if (phone) 34.dp else 36.dp
    Row(
        Modifier.heftFloat(CapsuleShape).padding(5.dp),
        Arrangement.spacedBy(2.dp),
        Alignment.CenterVertically,
    ) {
        t.pens.forEachIndexed { i, pen ->
            val on = t.tool == HeftTool.PEN && t.penSlot == i
            ToolButton(
                R.drawable.ic_i_pen_tool, "Stift ${i + 1}" + if (on) " – nochmal tippen für Farbe und Dicke" else "",
                btn, active = on, open = on && t.expanded, onClick = { vm.selectTool(HeftTool.PEN, i) },
            ) {
                PenDot(HeftPalette.color(pen.color), dotDp(pen.size), Modifier.align(Alignment.BottomEnd).padding(3.dp))
            }
        }
        val marker = t.tool == HeftTool.MARKER
        ToolButton(R.drawable.ic_i_marker, "Marker", btn, active = marker, open = marker && t.expanded, onClick = { vm.selectTool(HeftTool.MARKER) }) {
            // Marker schreibt in der aktuellen Farbe: kleiner Balken darunter.
            Box(
                Modifier.align(Alignment.BottomCenter).padding(bottom = 4.dp).width(14.dp).height(3.dp).clip(CircleShape)
                    .background(HeftPalette.color(t.color).copy(alpha = 0.55f)),
            )
        }
        Sep()
        val eraser = t.tool == HeftTool.ERASER
        ToolButton(
            R.drawable.ic_i_eraser, "Radierer (halten: kurz radieren)", btn, active = eraser, open = eraser && t.expanded,
            onClick = { vm.selectTool(HeftTool.ERASER) }, onHold = vm::holdEraser,
        )
        Sep()
        ToolButton(R.drawable.ic_i_lasso, "Lasso — Striche auswählen", btn, active = t.tool == HeftTool.LASSO, onClick = { vm.selectTool(HeftTool.LASSO) })
        if (!phone) {
            ToolButton(
                R.drawable.ic_i_laser, "Laserpointer — nicht speichern", btn, active = t.tool == HeftTool.LASER,
                danger = true, onClick = { vm.selectTool(HeftTool.LASER) },
            )
            Sep()
            ToolButton(R.drawable.ic_i_undo, "Rückgängig", btn, enabled = vm.canUndo, onClick = vm::undo)
            ToolButton(R.drawable.ic_i_redo, "Wiederholen", btn, enabled = vm.canRedo, onClick = vm::redo)
        }
        Sep()
        ToolButton(R.drawable.ic_i_chevron_down, "Leiste einklappen — mehr Platz zum Schreiben", btn, onClick = vm::toggleCollapsed)
    }
}

/** Eingeklappt (`.heft-pill-min`): Werkzeug-Icon mit Farbpunkt und Chevron; Tipp klappt aus. */
@Composable
private fun MiniCapsule(vm: HeftViewModel) {
    val t = vm.tools
    val c = Impala.colors
    val interaction = remember { MutableInteractionSource() }
    Row(
        Modifier.heftFloat(CapsuleShape)
            .pressScale(interaction, 0.96f)
            .clickable(interaction, ripple(), role = Role.Button, onClickLabel = "Werkzeugleiste ausklappen", onClick = vm::toggleCollapsed)
            .padding(horizontal = 12.dp, vertical = 9.dp),
        Arrangement.spacedBy(7.dp),
        Alignment.CenterVertically,
    ) {
        val icon = when (t.tool) {
            HeftTool.MARKER -> R.drawable.ic_i_marker
            HeftTool.ERASER -> R.drawable.ic_i_eraser
            HeftTool.LASSO -> R.drawable.ic_i_lasso
            HeftTool.LASER -> R.drawable.ic_i_laser
            HeftTool.PEN -> R.drawable.ic_i_pen_tool
        }
        Icon(painterResource(icon), null, Modifier.size(18.dp), c.text)
        Box(Modifier.size(12.dp).clip(CircleShape).background(HeftPalette.color(t.color)).border(1.dp, c.edge, CircleShape))
        Icon(painterResource(R.drawable.ic_i_chevron_down), null, Modifier.size(14.dp).rotate(180f), c.text2)
    }
}

/**
 * Optionen des aktiven Werkzeugs (`.heft-tray`): Strichstärken als Punkte | Farben | „Nur Stift zeichnet“ /
 * „Finger dürfen zeichnen“; beim Radierer drei Balken (Klein, Mittel, Groß).
 */
@Composable
fun HeftOptions(vm: HeftViewModel, phone: Boolean, modifier: Modifier = Modifier) {
    val t = vm.tools
    val cell = if (phone) 30.dp else 32.dp
    Row(
        modifier.heftFloat(TrayShape).horizontalScroll(rememberScrollState()).padding(horizontal = 6.dp, vertical = 5.dp),
        Arrangement.spacedBy(2.dp),
        Alignment.CenterVertically,
    ) {
        if (t.tool == HeftTool.ERASER) {
            HeftPalette.eraser.forEach { (label, value) ->
                SizeButton("Radierer: $label", t.eraserSize == value, cell, { vm.setSize(value) }) { color ->
                    Box(Modifier.width(16.dp).height(maxOf(2, (value / 5).roundToInt()).dp).clip(CircleShape).background(color))
                }
            }
        } else {
            val pen = HeftPalette.color(t.color)
            HeftPalette.sizes.forEach { (label, value) ->
                SizeButton("Strich: $label", t.size == value, cell, { vm.setSize(value) }) { _ ->
                    Box(Modifier.size(dotDp(value)).clip(CircleShape).background(pen))
                }
            }
            Sep(tray = true)
            HeftPalette.colors.forEach { css -> Swatch(css, t.color.equals(css, ignoreCase = true), cell) { vm.setColor(css) } }
            Sep(tray = true)
            SizeButton(if (t.onlyPen) "Nur Stift zeichnet" else "Finger dürfen zeichnen", t.onlyPen, cell, vm::toggleOnlyPen) { color ->
                Icon(painterResource(if (t.onlyPen) R.drawable.ic_i_pen else R.drawable.ic_i_hand), null, Modifier.size(17.dp), color)
            }
        }
    }
}

/** `.heft-swatch`: Farbfeld; aktiv größer mit Akzent-Ring und kleiner Lücke. */
@Composable
private fun Swatch(css: String, on: Boolean, cell: Dp, onClick: () -> Unit) {
    val c = Impala.colors
    val ring by animateColorAsState(if (on) c.accent else Color.Transparent, MaterialTheme.motionScheme.defaultEffectsSpec(), label = "ring")
    val scale by animateFloatAsState(if (on) 1f else 0.82f, MaterialTheme.motionScheme.fastSpatialSpec(), label = "swatch")
    Box(
        Modifier.size(cell).clip(CircleShape)
            .clickable(role = Role.Button, onClickLabel = "Farbe") { onClick() }
            .semantics { contentDescription = "Farbe $css" },
        Alignment.Center,
    ) {
        Box(Modifier.size(cell - 4.dp).border(2.dp, ring, CircleShape))
        Box(
            Modifier.size(cell - 10.dp).scale(scale).clip(CircleShape).background(HeftPalette.color(css))
                .border(1.dp, c.text.copy(alpha = 0.12f), CircleShape),
        )
    }
}

/**
 * `.heft-main`: Knopf der Kapsel; aktiv in Akzent-Tönung (Laser in Rot), offen (Optionen sichtbar)
 * kräftiger. Farben gleiten über das Expressive-MotionScheme, Drücken federt. [onHold] meldet
 * gedrückt halten (ab 380 ms) und Loslassen; ein Tipp nach dem Halten zählt nicht.
 */
@Composable
private fun ToolButton(
    @DrawableRes icon: Int,
    label: String,
    size: Dp,
    active: Boolean = false,
    open: Boolean = false,
    enabled: Boolean = true,
    danger: Boolean = false,
    onClick: () -> Unit,
    onHold: ((Boolean) -> Unit)? = null,
    extra: @Composable BoxScope.() -> Unit = {},
) {
    val c = Impala.colors
    val hue = if (danger) c.danger else c.accent
    val bg by animateColorAsState(
        when {
            open -> hue.copy(alpha = 0.24f)
            active -> hue.copy(alpha = 0.14f)
            else -> Color.Transparent
        },
        MaterialTheme.motionScheme.defaultEffectsSpec(), label = "tool-bg",
    )
    val tint by animateColorAsState(if (active) hue else c.text2, MaterialTheme.motionScheme.defaultEffectsSpec(), label = "tool-tint")
    val interaction = remember { MutableInteractionSource() }
    val click by rememberUpdatedState(onClick)
    val hold by rememberUpdatedState(onHold)
    val base = Modifier.size(size).alpha(if (enabled) 1f else 0.35f).pressScale(interaction, 0.92f).clip(ButtonShape).background(bg)
    val input = if (onHold == null) {
        Modifier.clickable(interaction, ripple(), enabled = enabled, role = Role.Button, onClick = onClick).semantics { contentDescription = label }
    } else {
        Modifier
            .semantics {
                role = Role.Button
                contentDescription = label
                onClick { click(); true }
            }
            .pointerInput(Unit) {
                var held = false
                detectTapGestures(
                    onPress = { at ->
                        held = false
                        val press = PressInteraction.Press(at)
                        interaction.emit(press)
                        coroutineScope {
                            val timer = launch { delay(ERASER_HOLD_MS); held = true; hold?.invoke(true) }
                            tryAwaitRelease()
                            timer.cancel()
                        }
                        interaction.emit(PressInteraction.Release(press))
                        if (held) hold?.invoke(false)
                    },
                    onTap = { if (!held) click() },
                )
            }
    }
    Box(base.then(input), Alignment.Center) {
        Icon(painterResource(icon), null, Modifier.size(19.dp), tint)
        extra()
    }
}

/** `.heft-size`: Knopf im Tray; aktiv mit Akzent-Tönung. */
@Composable
private fun SizeButton(label: String, active: Boolean, cell: Dp, onClick: () -> Unit, content: @Composable (Color) -> Unit) {
    val c = Impala.colors
    val bg by animateColorAsState(if (active) c.tint3 else Color.Transparent, MaterialTheme.motionScheme.defaultEffectsSpec(), label = "size-bg")
    Box(
        Modifier.size(cell).clip(ButtonShape).background(bg)
            .clickable(role = Role.Button, onClick = onClick).semantics { contentDescription = label },
        Alignment.Center,
    ) { content(if (active) c.accent else c.text2) }
}

/** `.heft-sep`: feiner senkrechter Trenner. */
@Composable
private fun Sep(tray: Boolean = false) {
    val color = if (tray) Impala.colors.surfaceActive else Impala.colors.edge
    Box(Modifier.padding(horizontal = 4.dp).width(1.dp).height(18.dp).background(color))
}

/** `.heft-penfav-dot`: Farbpunkt in Stiftdicke mit Ring in Menüfarbe. */
@Composable
private fun PenDot(color: Color, d: Dp, modifier: Modifier) {
    val c = Impala.colors
    Box(
        modifier.size(d + 4.dp).clip(CircleShape).background(c.menu).padding(1.5.dp)
            .clip(CircleShape).background(color),
    )
}
