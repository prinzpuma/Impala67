package org.impala67.app.heft

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PointMode
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke as DrawStroke
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import org.impala67.app.R
import org.impala67.app.ui.theme.Impala
import org.impala67.app.ui.theme.Radius
import org.impala67.app.ui.theme.TextSize

/** Links oben im Tablet-Heft (`.heft-corner-l`): Seitenübersicht mit „x/y“. */
@Composable
fun HeftCornerPages(pageLabel: String, onClick: () -> Unit, modifier: Modifier = Modifier) {
    CornerButton("Seiten", onClick, modifier) {
        Icon(painterResource(R.drawable.ic_i_pages_stack), null, Modifier.size(16.dp))
        if (pageLabel.isNotEmpty()) Text(pageLabel, fontSize = TextSize.xs, fontWeight = FontWeight.Bold)
    }
}

/**
 * Rechts oben im Tablet-Heft (`.heft-corner-r`): KI-Chat und „+“ mit dem Menü der PWA (`plusPopHtml`):
 * neue Seite danach, Papier dieser Seite, Dokument scannen – dazu „Seite löschen“.
 */
@Composable
fun HeftCornerActions(actions: HeftPageActions, onAi: () -> Unit, modifier: Modifier = Modifier) {
    val c = Impala.colors
    var menu by remember { mutableStateOf(false) }
    var confirm by remember { mutableStateOf(false) }
    Row(modifier, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        CornerButton("KI-Chat", onAi) { Icon(painterResource(R.drawable.ic_i_sparkles), null, Modifier.size(16.dp)) }
        Box {
            CornerButton("Seite hinzufügen", { menu = true }, active = menu) { Icon(painterResource(R.drawable.ic_i_plus), null, Modifier.size(18.dp)) }
            DropdownMenu(
                expanded = menu,
                onDismissRequest = { menu = false },
                modifier = Modifier.width(280.dp),
                shape = RoundedCornerShape(Radius.lg),
                containerColor = c.menu,
                border = BorderStroke(1.dp, c.edge),
                shadowElevation = 12.dp,
            ) {
                Column(Modifier.padding(horizontal = 10.dp, vertical = 6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    MenuHead("NEUE SEITE DANACH")
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Paper.entries.forEach { p ->
                            PaperChip(p, modifier = Modifier.weight(1f)) {
                                menu = false
                                actions.add(p)
                            }
                        }
                    }
                    HorizontalDivider(Modifier.padding(vertical = 2.dp), color = c.edgeSoft)
                    MenuHead("PAPIER DIESER SEITE")
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Paper.entries.forEach { p ->
                            PaperChip(p, modifier = Modifier.weight(1f)) {
                                menu = false
                                actions.setPaper(p)
                            }
                        }
                    }
                    HorizontalDivider(Modifier.padding(vertical = 2.dp), color = c.edgeSoft)
                    PopActionRow("Dokument scannen", R.drawable.ic_i_camera) {
                        menu = false
                        actions.scan()
                    }
                    PopActionRow("Seite löschen", R.drawable.ic_i_trash, danger = true, enabled = actions.canRemove) {
                        menu = false
                        confirm = true
                    }
                }
            }
        }
    }
    if (confirm) DeletePageDialog(onDismiss = { confirm = false }, onConfirm = { confirm = false; actions.remove() })
}

@Composable
private fun PaperChip(paper: Paper, modifier: Modifier = Modifier, onClick: () -> Unit) {
    val c = Impala.colors
    val shape = RoundedCornerShape(Radius.sm)
    Column(
        modifier = modifier
            .clip(shape)
            .background(c.surfaceSubtle)
            .border(1.dp, c.edgeSoft, shape)
            .clickable(onClick = onClick)
            .padding(vertical = 6.dp, horizontal = 2.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        PaperMiniVisual(paper)
        Text(paper.label, color = c.text, fontSize = TextSize.xs3, fontWeight = FontWeight.Medium, maxLines = 1)
    }
}

@Composable
private fun PaperMiniVisual(paper: Paper) {
    val ink = Impala.colors.accent
    val borderCol = Impala.colors.edgeSoft
    Canvas(Modifier.size(24.dp, 30.dp)) {
        val w = size.width
        val h = size.height
        // Blatt-Hintergrund
        drawRect(Color(0xFFFBFAF7))
        drawRect(borderCol, style = DrawStroke(1f))
        when (paper) {
            Paper.LINED -> {
                for (y in listOf(h * 0.32f, h * 0.52f, h * 0.72f)) {
                    drawLine(ink.copy(alpha = 0.45f), androidx.compose.ui.geometry.Offset(w * 0.18f, y), androidx.compose.ui.geometry.Offset(w * 0.85f, y), strokeWidth = 1.2f)
                }
            }
            Paper.GRID -> {
                for (y in listOf(h * 0.3f, h * 0.5f, h * 0.7f)) {
                    drawLine(ink.copy(alpha = 0.3f), androidx.compose.ui.geometry.Offset(2f, y), androidx.compose.ui.geometry.Offset(w - 2f, y), strokeWidth = 1f)
                }
                for (x in listOf(w * 0.33f, w * 0.66f)) {
                    drawLine(ink.copy(alpha = 0.3f), androidx.compose.ui.geometry.Offset(x, 2f), androidx.compose.ui.geometry.Offset(x, h - 2f), strokeWidth = 1f)
                }
            }
            Paper.DOTS -> {
                val dots = listOf(
                    androidx.compose.ui.geometry.Offset(w * 0.3f, h * 0.32f),
                    androidx.compose.ui.geometry.Offset(w * 0.7f, h * 0.32f),
                    androidx.compose.ui.geometry.Offset(w * 0.3f, h * 0.52f),
                    androidx.compose.ui.geometry.Offset(w * 0.7f, h * 0.52f),
                    androidx.compose.ui.geometry.Offset(w * 0.3f, h * 0.72f),
                    androidx.compose.ui.geometry.Offset(w * 0.7f, h * 0.72f),
                )
                drawPoints(dots, PointMode.Points, ink.copy(alpha = 0.6f), strokeWidth = 2.5f, cap = StrokeCap.Round)
            }
            Paper.BLANK -> Unit
        }
    }
}

@Composable
private fun PopActionRow(text: String, icon: Int, danger: Boolean = false, enabled: Boolean = true, onClick: () -> Unit) {
    val c = Impala.colors
    val color = if (danger) c.danger else c.text
    val shape = RoundedCornerShape(Radius.sm)
    Row(
        Modifier
            .fillMaxWidth()
            .height(34.dp)
            .clip(shape)
            .then(if (enabled) Modifier.clickable(onClick = onClick) else Modifier)
            .padding(horizontal = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Icon(
            painterResource(icon),
            null,
            Modifier.size(16.dp),
            tint = if (enabled) color else c.text2.copy(alpha = 0.4f),
        )
        Text(
            text,
            color = if (enabled) color else c.text2.copy(alpha = 0.4f),
            fontSize = TextSize.sm,
            fontWeight = FontWeight.Medium,
        )
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

/** `.heft-chrome .heft-corner`: kleine Kapsel mit Menü-Hintergrund und Rahmen. */
@Composable
private fun CornerButton(label: String, onClick: () -> Unit, modifier: Modifier = Modifier, active: Boolean = false, content: @Composable RowScope.() -> Unit) {
    val c = Impala.colors
    val shape = RoundedCornerShape(Radius.md)
    Row(
        modifier.height(36.dp).widthIn(min = 36.dp).clip(shape)
            .background(if (active) c.accent.copy(alpha = 0.14f) else c.menu)
            .border(1.dp, if (active) Color.Transparent else c.edge, shape)
            .clickable(onClickLabel = label, onClick = onClick).padding(horizontal = 9.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp, Alignment.CenterHorizontally),
    ) {
        CompositionLocalProvider(LocalContentColor provides if (active) c.accent else c.text) { content() }
    }
}
