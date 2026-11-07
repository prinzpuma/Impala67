package org.impala67.app.heft

import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.ripple
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PointMode
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke as DrawStroke
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import org.impala67.app.R
import org.impala67.app.ui.components.pressScale
import org.impala67.app.ui.theme.Impala
import org.impala67.app.ui.theme.Radius
import org.impala67.app.ui.theme.TextSize

/** Aktionen der Seitenverwaltung (heft-pages-ui.js, „+“-Menü `plusPopHtml`). */
class HeftPageActions(
    val add: (Paper, InsertPos) -> Unit,
    val setPaper: (Paper) -> Unit,
    val remove: () -> Unit,
    val canRemove: Boolean,
    val scan: () -> Unit,
    /** „PDF oder Bild importieren“ (heft-toolbar-ui.js `plusPopHtml`): je Bild bzw. PDF-Seite eine Seite. */
    val importFiles: () -> Unit,
    val overview: () -> Unit,
    /** Papier der aktuellen Seite (im Menü markiert). */
    val currentPaper: Paper?,
    /** Wohin neue Seiten kommen (Davor / Danach / Am Ende), gilt für die Sitzung. */
    val insertPos: InsertPos,
    val setInsertPos: (InsertPos) -> Unit,
)

/** Links oben im Tablet-Heft (`.heft-corner-l`): Seitenübersicht. */
@Composable
fun HeftCornerPages(onClick: () -> Unit, modifier: Modifier = Modifier) {
    HeftCornerButton("Seiten", onClick, modifier) {
        Icon(painterResource(R.drawable.ic_i_pages_stack), null, Modifier.size(18.dp))
    }
}

/** Rechts oben im Tablet-Heft (`.heft-corner-r`): KI-Chat und „+“ mit dem Menü der PWA. */
@Composable
fun HeftCornerActions(actions: HeftPageActions, onAi: () -> Unit, modifier: Modifier = Modifier) {
    var menu by remember { mutableStateOf(false) }
    Row(modifier, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        HeftCornerButton("KI-Chat", onAi) { Icon(painterResource(R.drawable.ic_i_sparkles), null, Modifier.size(18.dp)) }
        Box {
            HeftCornerButton("Seite hinzufügen", { menu = true }, active = menu) { Icon(painterResource(R.drawable.ic_i_plus), null, Modifier.size(18.dp)) }
            HeftAddMenu(menu, { menu = false }, actions)
        }
    }
}

/**
 * „+“-Menü (heft-toolbar-ui.js `plusPopHtml`): neue Seite Davor / Danach / Am Ende mit Papierwahl,
 * Papier dieser Seite, Dokument scannen und Seite löschen (mit Rückfrage). Am Anker in einer `Box`.
 */
@Composable
fun HeftAddMenu(expanded: Boolean, onDismiss: () -> Unit, actions: HeftPageActions) {
    val c = Impala.colors
    var confirm by remember { mutableStateOf(false) }
    DropdownMenu(
        expanded = expanded,
        onDismissRequest = onDismiss,
        modifier = Modifier.width(296.dp),
        shape = RoundedCornerShape(Radius.lg),
        containerColor = c.menu,
        border = BorderStroke(1.dp, c.edge),
        shadowElevation = 12.dp,
    ) {
        Column(Modifier.padding(horizontal = 10.dp, vertical = 4.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            MenuHead("NEUE SEITE")
            Segmented(InsertPos.entries, actions.insertPos, { it.label }, actions.setInsertPos)
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Paper.entries.forEach { p ->
                    PaperChip(p, active = false, modifier = Modifier.weight(1f)) {
                        onDismiss()
                        actions.add(p, actions.insertPos)
                    }
                }
            }
            HorizontalDivider(color = c.edgeSoft)
            MenuHead("PAPIER DIESER SEITE")
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Paper.entries.forEach { p ->
                    PaperChip(p, active = p == actions.currentPaper, modifier = Modifier.weight(1f)) {
                        onDismiss()
                        actions.setPaper(p)
                    }
                }
            }
            HorizontalDivider(color = c.edgeSoft)
            Column {
                PopActionRow("PDF oder Bild importieren", R.drawable.ic_i_upload) {
                    onDismiss()
                    actions.importFiles()
                }
                PopActionRow("Dokument scannen", R.drawable.ic_i_camera) {
                    onDismiss()
                    actions.scan()
                }
                PopActionRow("Seite löschen", R.drawable.ic_i_trash, danger = true, enabled = actions.canRemove) {
                    onDismiss()
                    confirm = true
                }
            }
        }
    }
    if (confirm) DeletePageDialog(onDismiss = { confirm = false }, onConfirm = { confirm = false; actions.remove() })
}

/** Einträge des „Bilder“-Menüs, die die Plattform braucht (Galerie, Kamera) bzw. die aktuelle Seite kennen. */
class HeftMediaActions(val writeText: () -> Unit, val pickImage: () -> Unit, val takePhoto: () -> Unit)

/**
 * „Bilder“-Menü (heft-toolbar-ui.js `imgPopHtml`): Auswahl-Werkzeug für Bilder und Texte, Text
 * schreiben, Bild aus der Galerie oder von der Kamera.
 */
@Composable
fun HeftImageMenu(expanded: Boolean, onDismiss: () -> Unit, vm: HeftViewModel, media: HeftMediaActions) {
    val c = Impala.colors
    DropdownMenu(
        expanded = expanded,
        onDismissRequest = onDismiss,
        modifier = Modifier.width(296.dp),
        shape = RoundedCornerShape(Radius.lg),
        containerColor = c.menu,
        border = BorderStroke(1.dp, c.edge),
        shadowElevation = 12.dp,
    ) {
        Column(Modifier.padding(horizontal = 10.dp, vertical = 4.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            MenuHead("BILDER")
            Column {
                PopActionRow("Text schreiben", R.drawable.ic_i_pen) { onDismiss(); media.writeText() }
                PopActionRow("Bild hinzufügen", R.drawable.ic_i_image) { onDismiss(); media.pickImage() }
                PopActionRow("Bild aufnehmen", R.drawable.ic_i_camera) { onDismiss(); media.takePhoto() }
            }
            Text(
                "Bild oder Text antippen oder halten, dann verschieben, skalieren oder löschen. Ausgewählten Text nochmal antippen zum Bearbeiten.",
                Modifier.padding(horizontal = 2.dp, vertical = 2.dp),
                color = c.text2,
                fontSize = TextSize.xs,
            )
        }
    }
}

/** `.heft-seg-row`: Segmentwahl in einer Rille; das aktive Segment hebt sich als Fläche ab. */
@Composable
internal fun <T> Segmented(options: List<T>, selected: T, label: (T) -> String, onSelect: (T) -> Unit) {
    val c = Impala.colors
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(Radius.md)).background(c.surfaceSubtle).border(1.dp, c.edgeSoft, RoundedCornerShape(Radius.md)).padding(3.dp),
        horizontalArrangement = Arrangement.spacedBy(3.dp),
    ) {
        options.forEach { o ->
            val on = o == selected
            val bg by animateColorAsState(if (on) c.menu else Color.Transparent, MaterialTheme.motionScheme.defaultEffectsSpec(), label = "seg")
            Box(
                Modifier.weight(1f).height(30.dp).clip(RoundedCornerShape(Radius.sm)).background(bg)
                    .then(if (on) Modifier.border(1.dp, c.edge, RoundedCornerShape(Radius.sm)) else Modifier)
                    .clickable(role = Role.RadioButton) { onSelect(o) },
                Alignment.Center,
            ) {
                Text(label(o), color = if (on) c.text else c.text2, fontSize = TextSize.xs, fontWeight = if (on) FontWeight.SemiBold else FontWeight.Medium)
            }
        }
    }
}

@Composable
private fun PaperChip(paper: Paper, active: Boolean, modifier: Modifier = Modifier, onClick: () -> Unit) {
    val c = Impala.colors
    val shape = RoundedCornerShape(Radius.sm)
    val interaction = remember { MutableInteractionSource() }
    Column(
        modifier = modifier
            .pressScale(interaction, 0.95f)
            .clip(shape)
            .background(if (active) c.tint2 else c.surfaceSubtle)
            .border(1.dp, if (active) c.accentBorder else c.edgeSoft, shape)
            .clickable(interaction, ripple(), onClick = onClick)
            .padding(vertical = 7.dp, horizontal = 2.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        PaperMiniVisual(paper)
        Text(paper.label, color = if (active) c.accent else c.text, fontSize = TextSize.xs3, fontWeight = FontWeight.Medium, maxLines = 1)
    }
}

/** Kleines Blatt mit dem Muster des Papiers (`.heft-tpl-paper`). */
@Composable
private fun PaperMiniVisual(paper: Paper) {
    val ink = Impala.colors.accent
    val borderCol = Impala.colors.edgeSoft
    Canvas(Modifier.size(24.dp, 30.dp)) {
        val w = size.width
        val h = size.height
        drawRect(PaperColor)
        drawRect(borderCol, style = DrawStroke(1f))
        when (paper) {
            Paper.LINED -> for (y in listOf(h * 0.32f, h * 0.52f, h * 0.72f)) {
                drawLine(ink.copy(alpha = 0.45f), Offset(w * 0.18f, y), Offset(w * 0.85f, y), strokeWidth = 1.2f)
            }
            Paper.GRID -> {
                for (y in listOf(h * 0.3f, h * 0.5f, h * 0.7f)) drawLine(ink.copy(alpha = 0.3f), Offset(2f, y), Offset(w - 2f, y), strokeWidth = 1f)
                for (x in listOf(w * 0.33f, w * 0.66f)) drawLine(ink.copy(alpha = 0.3f), Offset(x, 2f), Offset(x, h - 2f), strokeWidth = 1f)
            }
            Paper.DOTS -> {
                val dots = listOf(0.32f, 0.52f, 0.72f).flatMap { y -> listOf(Offset(w * 0.3f, h * y), Offset(w * 0.7f, h * y)) }
                drawPoints(dots, PointMode.Points, ink.copy(alpha = 0.6f), strokeWidth = 2.5f, cap = StrokeCap.Round)
            }
            Paper.BLANK -> Unit
        }
    }
}

@Composable
private fun PopActionRow(text: String, icon: Int, danger: Boolean = false, enabled: Boolean = true, onClick: () -> Unit) {
    val c = Impala.colors
    val color = when {
        !enabled -> c.text2.copy(alpha = 0.4f)
        danger -> c.danger
        else -> c.text
    }
    Row(
        Modifier
            .fillMaxWidth()
            .height(40.dp)
            .clip(RoundedCornerShape(Radius.sm))
            .clickable(enabled = enabled, onClick = onClick)
            .padding(horizontal = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Icon(painterResource(icon), null, Modifier.size(17.dp), tint = color)
        Text(text, color = color, fontSize = TextSize.sm, fontWeight = FontWeight.Medium)
    }
}

@Composable
private fun MenuHead(text: String) {
    Text(
        text,
        Modifier.padding(horizontal = 2.dp, vertical = 2.dp),
        color = Impala.colors.text2,
        fontSize = TextSize.xs3,
        fontWeight = FontWeight.Bold,
        letterSpacing = 0.06.em,
    )
}

/**
 * `.heft-corner`: runder Knopf in Menüfarbe mit feinem Ring und Schatten, Icon 18 dp; offen bzw.
 * [active] mit Akzent-Tönung. Auch für die Eckgruppe auf dem Telefon (Rückgängig/Wiederholen).
 */
@Composable
fun HeftCornerButton(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    active: Boolean = false,
    enabled: Boolean = true,
    content: @Composable () -> Unit,
) {
    val c = Impala.colors
    val interaction = remember { MutableInteractionSource() }
    val bg by animateColorAsState(if (active) c.accent.copy(alpha = 0.16f) else Color.Transparent, MaterialTheme.motionScheme.defaultEffectsSpec(), label = "corner")
    Box(
        modifier.size(38.dp).pressScale(interaction, 0.92f).heftFloat(border = false)
            .background(bg)
            .clickable(interaction, ripple(), enabled = enabled, onClickLabel = label, role = Role.Button, onClick = onClick)
            .semantics { contentDescription = label },
        Alignment.Center,
    ) {
        val tint = when {
            !enabled -> c.text2.copy(alpha = 0.4f)
            active -> c.accent
            else -> c.text
        }
        CompositionLocalProvider(LocalContentColor provides tint) { content() }
    }
}
