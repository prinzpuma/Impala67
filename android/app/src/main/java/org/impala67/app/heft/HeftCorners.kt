package org.impala67.app.heft

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
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
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
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
    var menu by remember { mutableStateOf(false) }
    var confirm by remember { mutableStateOf(false) }
    Row(modifier, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        CornerButton("KI-Chat", onAi) { Icon(painterResource(R.drawable.ic_i_sparkles), null, Modifier.size(16.dp)) }
        Box {
            CornerButton("Seite hinzufügen", { menu = true }, active = menu) { Icon(painterResource(R.drawable.ic_i_plus), null, Modifier.size(18.dp)) }
            DropdownMenu(menu, { menu = false }) {
                MenuHead("Neue Seite danach")
                Paper.entries.forEach { p -> DropdownMenuItem({ Text(p.label) }, { menu = false; actions.add(p) }) }
                HorizontalDivider()
                MenuHead("Papier dieser Seite")
                Paper.entries.forEach { p -> DropdownMenuItem({ Text(p.label) }, { menu = false; actions.setPaper(p) }) }
                HorizontalDivider()
                DropdownMenuItem(
                    { Text("Dokument scannen") },
                    { menu = false; actions.scan() },
                    leadingIcon = { Icon(painterResource(R.drawable.ic_i_camera), null, Modifier.size(20.dp)) },
                )
                DropdownMenuItem(
                    { Text("Seite löschen", color = Impala.colors.danger) },
                    { menu = false; confirm = true },
                    enabled = actions.canRemove,
                    leadingIcon = { Icon(painterResource(R.drawable.ic_i_trash), null, Modifier.size(20.dp), Impala.colors.danger) },
                )
            }
        }
    }
    if (confirm) DeletePageDialog(onDismiss = { confirm = false }, onConfirm = { confirm = false; actions.remove() })
}

@Composable
private fun MenuHead(text: String) {
    Text(text, Modifier.padding(horizontal = 12.dp, vertical = 4.dp), color = Impala.colors.text2, fontSize = TextSize.xs)
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
