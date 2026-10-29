package org.impala67.app.ui.desk

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.MenuDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import org.impala67.app.R
import org.impala67.app.notes.ownEmoji
import org.impala67.app.notes.pageIconRes
import org.impala67.app.notes.pageTitle
import org.impala67.app.ui.theme.Impala
import org.impala67.app.ui.theme.Radius
import org.impala67.app.ui.theme.Space
import org.impala67.app.ui.theme.TextSize
import uniffi.impala_ffi.PageSummary

/** Was eine Baumzeile auslöst (Seiten-⋯-Menü wie `pageMenuHtml` in render.js). */
data class DeskTreeActions(
    val open: (String) -> Unit,
    val openNewTab: (String) -> Unit,
    val addChild: (String) -> Unit,
    val newPage: (workspaceId: String) -> Unit,
    val rename: (PageSummary) -> Unit,
    val favorite: (PageSummary) -> Unit,
    val archive: (PageSummary) -> Unit,
    val trash: (PageSummary) -> Unit,
    val duplicate: (PageSummary) -> Unit,
    val template: (PageSummary) -> Unit,
    val move: (PageSummary) -> Unit,
)

/** Abschnittskopf (`.ws-head`): Einklapp-Pfeil, Name, „+“ für eine neue Seite im Arbeitsbereich. */
@Composable
fun DeskTreeHead(item: DeskTreeItem.Head, collapsed: Boolean, onToggle: () -> Unit, onNew: (String) -> Unit) {
    val c = Impala.colors
    Row(
        Modifier.fillMaxWidth().padding(start = Space.s1, top = Space.s3, bottom = Space.s1),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (item.collapseKey != null) Chevron(open = !collapsed, onToggle)
        Text(
            item.title, Modifier.weight(1f).padding(start = 2.dp), color = c.text2,
            fontSize = TextSize.xs, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis,
        )
        item.workspaceId?.let { ws -> RowButton(R.drawable.ic_i_plus, "Neue Seite in ${item.title}") { onNew(ws) } }
    }
}

/** Seitenzeile (`.row`): Einrückung 16 dp je Ebene, aktiv mit Akzent-Tönung. */
@Composable
fun DeskTreePageRow(
    item: DeskTreeItem.Page,
    active: Boolean,
    collapsed: Boolean,
    onToggle: () -> Unit,
    actions: DeskTreeActions,
) {
    val c = Impala.colors
    val page = item.page
    Row(
        Modifier.fillMaxWidth().heightIn(min = 36.dp).clip(RoundedCornerShape(Radius.md))
            .background(if (active) c.accent.copy(alpha = 0.14f) else Color.Transparent)
            .clickable { actions.open(page.id) }
            .padding(start = (6 + item.depth * 16).dp, end = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        if (item.hasKids) Chevron(open = !collapsed, onToggle) else Spacer(Modifier.width(24.dp))
        val emoji = ownEmoji(page)
        if (emoji != null) Text(emoji, fontSize = TextSize.sm)
        else Icon(painterResource(pageIconRes(page)), null, Modifier.size(15.dp), tint = c.text2)
        Text(
            pageTitle(page), Modifier.weight(1f).padding(start = Space.s1),
            color = if (active) c.text else c.text2, fontSize = TextSize.base,
            maxLines = 1, overflow = TextOverflow.Ellipsis,
        )
        PageMenu(page, actions)
        RowButton(R.drawable.ic_i_plus, "Unterseite anlegen") { actions.addChild(page.id) }
    }
}

@Composable
private fun PageMenu(page: PageSummary, actions: DeskTreeActions) {
    var open by remember { mutableStateOf(false) }
    Box {
        RowButton(R.drawable.ic_i_dots, "Weitere Optionen") { open = true }
        DropdownMenu(open, { open = false }, containerColor = Impala.colors.menu) {
            MenuEntry(R.drawable.ic_i_external, "In neuem Tab öffnen") { open = false; actions.openNewTab(page.id) }
            MenuEntry(R.drawable.ic_i_pen, "Umbenennen") { open = false; actions.rename(page) }
            MenuEntry(R.drawable.ic_i_copy, "Duplizieren") { open = false; actions.duplicate(page) }
            MenuEntry(R.drawable.ic_i_template, if (page.isTemplate) "Vorlage entfernen" else "Als Vorlage") { open = false; actions.template(page) }
            MenuEntry(R.drawable.ic_i_star, if (page.favorite) "Favorit entfernen" else "Zu Favoriten") { open = false; actions.favorite(page) }
            MenuEntry(R.drawable.ic_i_folder_move, "Verschieben nach…") { open = false; actions.move(page) }
            MenuEntry(R.drawable.ic_i_archive, "Archivieren") { open = false; actions.archive(page) }
            MenuEntry(R.drawable.ic_i_trash, "Löschen", danger = true) { open = false; actions.trash(page) }
        }
    }
}

@Composable
internal fun MenuEntry(icon: Int, label: String, danger: Boolean = false, onClick: () -> Unit) {
    val c = Impala.colors
    DropdownMenuItem(
        text = { Text(label) },
        leadingIcon = { Icon(painterResource(icon), null, Modifier.size(16.dp)) },
        onClick = onClick,
        colors = if (danger) MenuDefaults.itemColors(textColor = c.danger, leadingIconColor = c.danger) else MenuDefaults.itemColors(),
    )
}

/** Kleiner Pfeil (`.row-chevron`), gedreht, wenn offen. Trefferfläche 24 dp. */
@Composable
private fun Chevron(open: Boolean, onToggle: () -> Unit) {
    Box(Modifier.size(24.dp).clip(RoundedCornerShape(Radius.xs)).clickable(onClick = onToggle), contentAlignment = Alignment.Center) {
        Icon(
            painterResource(R.drawable.ic_i_chevron_right), if (open) "Einklappen" else "Ausklappen",
            Modifier.size(12.dp).rotate(if (open) 90f else 0f), tint = Impala.colors.text2,
        )
    }
}

/** `.row-add`: auf Touch immer sichtbar (kein Hover). */
@Composable
private fun RowButton(icon: Int, label: String, onClick: () -> Unit) {
    Box(Modifier.size(32.dp).clip(RoundedCornerShape(Radius.xs)).clickable(onClick = onClick), contentAlignment = Alignment.Center) {
        Icon(painterResource(icon), label, Modifier.size(15.dp), tint = Impala.colors.text2)
    }
}
