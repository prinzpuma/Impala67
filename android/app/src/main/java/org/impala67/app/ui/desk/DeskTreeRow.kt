package org.impala67.app.ui.desk

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
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
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.MenuDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.TextFieldValue
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
import uniffi.impala_ffi.PageKind
import uniffi.impala_ffi.PageSummary

/** Was eine Baumzeile auslöst (Seiten-⋯-Menü wie `pageMenuHtml` in render.js). */
data class DeskTreeActions(
    val open: (String) -> Unit,
    val openNewTab: (String) -> Unit,
    val addChild: (String) -> Unit,
    val newPage: (workspaceId: String) -> Unit,
    val rename: (PageSummary) -> Unit,
    /** Inline-Umbenennen beendet: neuer Titel oder `null` (Esc). */
    val renamed: (PageSummary, String?) -> Unit,
    val favorite: (PageSummary) -> Unit,
    val archive: (PageSummary) -> Unit,
    val trash: (PageSummary) -> Unit,
    val duplicate: (PageSummary) -> Unit,
    val template: (PageSummary) -> Unit,
    val lectureDb: (PageSummary, Boolean) -> Unit,
    val move: (PageSummary) -> Unit,
    /** Gezogene Seite abgelegt (`Drop.row` = Schlüssel der Zielzeile). */
    val drop: (PageSummary, Drop) -> Unit,
)

/** Abschnittskopf (`.ws-head`): Einklapp-Pfeil, Name, „+“ für eine neue Seite im Arbeitsbereich. Ziel beim Ziehen. */
@Composable
fun DeskTreeHead(item: DeskTreeItem.Head, collapsed: Boolean, drag: TreeDrag, onToggle: () -> Unit, onNew: (String) -> Unit) {
    val c = Impala.colors
    Row(
        Modifier.fillMaxWidth().padding(top = Space.s2)
            .treeRow(drag, item.key, item.title, enabled = false, onHold = {}, onDrop = {})
            .dropMark(drag.zoneOf(item.key)?.let { DropZone.Into })
            .padding(start = Space.s1, top = Space.s1, bottom = Space.s1),
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

/**
 * Seitenzeile (`.row`): Einrückung 16 dp je Ebene, aktiv mit Akzent-Tönung. Halten öffnet das ⋯-Menü,
 * Halten und Ziehen verschiebt die Seite; beim Umbenennen steht der Titel als Eingabefeld in der Zeile.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun DeskTreePageRow(
    item: DeskTreeItem.Page,
    active: Boolean,
    collapsed: Boolean,
    isDb: Boolean,
    renaming: Boolean,
    drag: TreeDrag,
    onToggle: () -> Unit,
    actions: DeskTreeActions,
) {
    val c = Impala.colors
    val page = item.page
    var menuOpen by remember { mutableStateOf(false) }
    // Ein Ziehen schließt das per Halten geöffnete Menü wieder.
    LaunchedEffect(drag.source) { if (drag.source == item.key) menuOpen = false }
    Row(
        Modifier.fillMaxWidth().heightIn(min = 36.dp)
            .dropMark(drag.zoneOf(item.key))
            .clip(RoundedCornerShape(Radius.md))
            .background(if (active) c.accent.copy(alpha = 0.14f) else Color.Transparent)
            .combinedClickable(onLongClickLabel = "Weitere Optionen", onLongClick = {}) { actions.open(page.id) }
            // Nach dem Klick-Modifier, damit das Ziehen die Zeigerereignisse zuerst sieht.
            .treeRow(drag, item.key, pageTitle(page), enabled = !renaming && item.section == "tree", onHold = { menuOpen = true }) { actions.drop(page, it) }
            .padding(start = (6 + item.depth * 16).dp, end = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        if (item.hasKids) Chevron(open = !collapsed, onToggle) else Spacer(Modifier.width(24.dp))
        val emoji = ownEmoji(page)
        if (emoji != null) Text(emoji, fontSize = TextSize.sm)
        else Icon(painterResource(pageIconRes(page)), null, Modifier.size(15.dp), tint = c.text2)
        if (renaming) {
            RenameField(pageTitle(page), Modifier.weight(1f).padding(start = Space.s1)) { actions.renamed(page, it) }
        } else {
            Text(
                pageTitle(page), Modifier.weight(1f).padding(start = Space.s1),
                color = if (active) c.text else c.text2, fontSize = TextSize.base,
                maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
        }
        Box {
            RowButton(R.drawable.ic_i_dots, "Weitere Optionen") { menuOpen = true }
            PageMenu(page, isDb, menuOpen, { menuOpen = false }, actions)
        }
        RowButton(R.drawable.ic_i_plus, "Unterseite anlegen") { actions.addChild(page.id) }
    }
}

/**
 * Titel in der Zeile bearbeiten (`data-renamename`): Enter und Fokusverlust bestätigen, Esc bricht ab.
 * Nach dem ersten Ende ist Schluss, damit der Fokusverlust nach Enter/Esc nicht noch einmal speichert.
 */
@Composable
private fun RenameField(initial: String, modifier: Modifier, onDone: (String?) -> Unit) {
    val c = Impala.colors
    var value by remember { mutableStateOf(TextFieldValue(initial, TextRange(0, initial.length))) }
    var done by remember { mutableStateOf(false) }
    var focused by remember { mutableStateOf(false) }
    val focus = remember { FocusRequester() }
    fun finish(text: String?) { if (!done) { done = true; onDone(text) } }
    BasicTextField(
        value, { value = it },
        modifier.focusRequester(focus)
            .onFocusChanged { if (it.isFocused) focused = true else if (focused) finish(value.text) }
            .onPreviewKeyEvent { if (it.key == Key.Escape) { finish(null); true } else false },
        singleLine = true,
        textStyle = TextStyle(color = c.text, fontSize = TextSize.base),
        cursorBrush = SolidColor(c.accent),
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
        keyboardActions = KeyboardActions(onDone = { finish(value.text) }),
    )
    LaunchedEffect(Unit) { focus.requestFocus() }
}

@Composable
private fun PageMenu(page: PageSummary, isDb: Boolean, open: Boolean, close: () -> Unit, actions: DeskTreeActions) {
    DropdownMenu(open, close, containerColor = Impala.colors.menu) {
        MenuEntry(R.drawable.ic_i_external, "In neuem Tab öffnen") { close(); actions.openNewTab(page.id) }
        MenuEntry(R.drawable.ic_i_pen, "Umbenennen") { close(); actions.rename(page) }
        MenuEntry(R.drawable.ic_i_copy, "Duplizieren") { close(); actions.duplicate(page) }
        MenuEntry(R.drawable.ic_i_template, if (page.isTemplate) "Vorlage entfernen" else "Als Vorlage") { close(); actions.template(page) }
        if (page.kind != PageKind.HEFT) {
            MenuEntry(R.drawable.ic_i_grid, if (isDb) "Übersicht aufheben" else "Als Vorlesungsübersicht") { close(); actions.lectureDb(page, !isDb) }
        }
        MenuEntry(R.drawable.ic_i_star, if (page.favorite) "Favorit entfernen" else "Zu Favoriten") { close(); actions.favorite(page) }
        MenuEntry(R.drawable.ic_i_folder_move, "Verschieben nach…") { close(); actions.move(page) }
        MenuEntry(R.drawable.ic_i_archive, "Archivieren") { close(); actions.archive(page) }
        MenuEntry(R.drawable.ic_i_trash, "Löschen", danger = true) { close(); actions.trash(page) }
    }
}

@Composable
internal fun MenuEntry(
    icon: Int,
    label: String,
    danger: Boolean = false,
    hint: String? = null,
    enabled: Boolean = true,
    onClick: () -> Unit,
) {
    val c = Impala.colors
    DropdownMenuItem(
        text = { Text(label) },
        leadingIcon = { Icon(painterResource(icon), null, Modifier.size(16.dp)) },
        // `.menu-hint` (z. B. „Strg+Z“)
        trailingIcon = hint?.let { { Text(it, color = c.text2, fontSize = TextSize.xs) } },
        enabled = enabled,
        onClick = onClick,
        colors = if (danger) MenuDefaults.itemColors(textColor = c.danger, leadingIconColor = c.danger) else MenuDefaults.itemColors(),
    )
}

/** Kleiner Pfeil (`.row-chevron`), gedreht, wenn offen. Trefferfläche 24 dp. */
@Composable
internal fun Chevron(open: Boolean, onToggle: () -> Unit, labels: Pair<String, String> = "Einklappen" to "Ausklappen") {
    Box(Modifier.size(24.dp).clip(RoundedCornerShape(Radius.xs)).clickable(onClick = onToggle), contentAlignment = Alignment.Center) {
        Icon(
            painterResource(R.drawable.ic_i_chevron_right), if (open) labels.first else labels.second,
            Modifier.size(12.dp).rotate(if (open) 90f else 0f), tint = Impala.colors.text2,
        )
    }
}

/** `.row-add`: auf Touch immer sichtbar (kein Hover). */
@Composable
internal fun RowButton(icon: Int, label: String, onClick: () -> Unit) {
    Box(Modifier.size(32.dp).clip(RoundedCornerShape(Radius.xs)).clickable(onClick = onClick), contentAlignment = Alignment.Center) {
        Icon(painterResource(icon), label, Modifier.size(15.dp), tint = Impala.colors.text2)
    }
}
