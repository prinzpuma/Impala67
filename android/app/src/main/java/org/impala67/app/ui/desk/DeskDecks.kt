package org.impala67.app.ui.desk

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.DropdownMenu
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation3.runtime.NavKey
import org.impala67.app.R
import org.impala67.app.core.ImpalaStore
import org.impala67.app.study.DEFAULT_DECK
import org.impala67.app.study.DECK_SEP
import org.impala67.app.study.DeckDialog
import org.impala67.app.study.DeckDialogs
import org.impala67.app.study.DeckEntry
import org.impala67.app.study.DeckMenuActions
import org.impala67.app.study.ErrorDialog
import org.impala67.app.study.StudyViewModel
import org.impala67.app.study.deckMenuActions
import org.impala67.app.study.flattenDecks
import org.impala67.app.ui.shell.CardBrowserRoute
import org.impala67.app.ui.shell.ReviewRoute
import org.impala67.app.ui.shell.ShellNav
import org.impala67.app.ui.theme.Impala
import org.impala67.app.ui.theme.Radius
import org.impala67.app.ui.theme.Space
import org.impala67.app.ui.theme.TextSize

/**
 * Stapelbaum der Seitenleiste (Modus „Karten“, `deckTreeHtml` in der PWA): Unterstapel eingerückt und
 * einklappbar, Zähler für fällige und neue Karten. Antippen öffnet die Lernansicht des Stapels; ⋯ oder Halten
 * öffnet das Stapelmenü, Halten und Ziehen sortiert (davor/danach, nur unter Geschwistern) oder hängt den
 * Stapel unter einen anderen (Mitte) bzw. nach oben (freie Fläche) – wie das Stapel-Ziehen in app-sidebar-events.js.
 * Daten und Einklapp-Zustand kommen aus [StudyViewModel], wie in der Lernen-Übersicht.
 */
@Composable
fun DeskDecks(store: ImpalaStore, nav: ShellNav, current: NavKey, modifier: Modifier = Modifier) {
    val vm = viewModel { StudyViewModel(store) }
    val data by vm.data.collectAsStateWithLifecycle()
    val collapsed by vm.collapsed.collectAsStateWithLifecycle()
    val error by vm.error.collectAsStateWithLifecycle()
    var dialog by remember { mutableStateOf<DeckDialog?>(null) }
    val activeDeck = (current as? ReviewRoute)?.deck
    val entries = remember(data, collapsed) { data?.let { flattenDecks(it.decks, collapsed) }.orEmpty() }
    val drag = remember { TreeDrag() }
    val list = rememberLazyListState()
    fun drop(moved: String, d: Drop) {
        val target = d.row?.removePrefix(DECK_KEY)
        val parent = { n: String -> n.substringBeforeLast(DECK_SEP, "") }
        when {
            target == null -> if (moved.contains(DECK_SEP)) vm.move(moved, null)
            d.zone == DropZone.Into -> if (target != DEFAULT_DECK) vm.move(moved, target)
            parent(target) == parent(moved) -> {
                val sibs = data?.decks.orEmpty().map { it.name }.filter { parent(it) == parent(target) && it != moved }.toMutableList()
                val i = sibs.indexOf(target)
                if (i < 0) return
                sibs.add(if (d.zone == DropZone.Before) i else i + 1, moved)
                vm.reorder(sibs)
            }
        }
    }
    TreeDragArea(drag, list, modifier.fillMaxSize()) {
        LazyColumn(Modifier.fillMaxSize(), state = list) {
            item(key = "head") {
                Text(
                    "Stapel", Modifier.padding(start = Space.s1, top = Space.s3, bottom = Space.s1),
                    color = Impala.colors.text2, fontSize = TextSize.xs, fontWeight = FontWeight.SemiBold,
                    maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
            }
            if (data != null && entries.isEmpty()) {
                item(key = "empty") {
                    Text(
                        "Noch keine Stapel", Modifier.padding(start = Space.s2, top = Space.s1),
                        color = Impala.colors.text2, fontSize = TextSize.sm,
                    )
                }
            }
            items(entries, key = { DECK_KEY + it.name }) { e ->
                DeckTreeRow(
                    e,
                    active = e.name == activeDeck,
                    drag = drag,
                    onToggle = { vm.toggle(e.name) },
                    onOpen = { nav.open(ReviewRoute(e.name)) },
                    onDrop = { drop(e.name, it) },
                    menu = deckMenuActions(e.name, vm, { nav.open(CardBrowserRoute(e.name)) }) { dialog = it },
                )
            }
        }
    }
    DeckDialogs(dialog, { dialog = null }, store, vm)
    error?.let { ErrorDialog(it, vm::dismissError) }
}

/** Schlüssel der Stapelzeilen (auch Ziel beim Ziehen). */
private const val DECK_KEY = "deck:"

/** Stapelzeile (`.deck-tree-row`) wie die Seitenzeilen: 36 dp, Radius md, aktiv mit Akzent-Tönung. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun DeckTreeRow(
    e: DeckEntry,
    active: Boolean,
    drag: TreeDrag,
    onToggle: () -> Unit,
    onOpen: () -> Unit,
    onDrop: (Drop) -> Unit,
    menu: DeckMenuActions,
) {
    val c = Impala.colors
    val d = e.deck
    val key = DECK_KEY + e.name
    var menuOpen by remember { mutableStateOf(false) }
    LaunchedEffect(drag.source) { if (drag.source == key) menuOpen = false }
    Row(
        Modifier.fillMaxWidth().heightIn(min = 36.dp)
            .dropMark(drag.zoneOf(key))
            .clip(RoundedCornerShape(Radius.md))
            .background(if (active) c.accent.copy(alpha = 0.14f) else Color.Transparent)
            .combinedClickable(onLongClickLabel = "Weitere Optionen", onLongClick = { if (e.name == DEFAULT_DECK) menuOpen = true }, onClick = onOpen)
            // Nach dem Klick-Modifier, damit das Ziehen die Zeigerereignisse zuerst sieht.
            .treeRow(drag, key, e.label, enabled = e.name != DEFAULT_DECK, onHold = { menuOpen = true }, onDrop = onDrop)
            .padding(start = (6 + e.depth * 16).dp, end = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        if (e.hasKids) Chevron(open = !e.collapsed, onToggle, "Unterstapel ausblenden" to "Unterstapel anzeigen") else Spacer(Modifier.width(24.dp))
        Text(
            e.label, Modifier.weight(1f).padding(start = Space.s1),
            color = if (active) c.text else c.text2, fontSize = TextSize.base,
            maxLines = 1, overflow = TextOverflow.Ellipsis,
        )
        val due = d.review + d.learn
        if (due > 0uL) CountBadge("$due", c.accent)
        if (d.new > 0uL) CountBadge("${d.new}", c.success)
        Box {
            RowButton(R.drawable.ic_i_dots, "Weitere Optionen") { menuOpen = true }
            DeckMenu(e.name, menuOpen, { menuOpen = false }, menu)
        }
    }
}

/** Stapel-⋯-Menü (`deckMenuHtml` in render-anki.js); „Standard“ lässt sich weder umbenennen noch löschen. */
@Composable
private fun DeckMenu(name: String, open: Boolean, close: () -> Unit, a: DeckMenuActions) {
    val standard = name == DEFAULT_DECK
    DropdownMenu(open, close, containerColor = Impala.colors.menu) {
        MenuEntry(R.drawable.ic_i_search, "Karten ansehen") { close(); a.browse() }
        MenuEntry(R.drawable.ic_i_plus, "Unterstapel anlegen") { close(); a.subdeck() }
        if (!standard) MenuEntry(R.drawable.ic_i_pen, "Umbenennen") { close(); a.rename() }
        MenuEntry(R.drawable.ic_i_copy, "Duplizieren") { close(); a.duplicate() }
        MenuEntry(R.drawable.ic_i_gear, "Optionen") { close(); a.options() }
        MenuEntry(R.drawable.ic_i_archive, "Archivieren") { close(); a.archive() }
        if (!standard) MenuEntry(R.drawable.ic_i_trash, "In Papierkorb", danger = true) { close(); a.trash() }
    }
}

/** Zähler-Pille (`.deck-badge`): Fällige in Akzent, neue in Erfolgsfarbe, je mit leichter Tönung. */
@Composable
private fun CountBadge(text: String, color: Color) {
    Box(
        Modifier.defaultMinSize(minWidth = 18.dp).clip(CircleShape).background(color.copy(alpha = 0.14f))
            .padding(horizontal = 5.dp, vertical = 1.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, color = color, fontSize = TextSize.xs2, fontWeight = FontWeight.SemiBold)
    }
}
