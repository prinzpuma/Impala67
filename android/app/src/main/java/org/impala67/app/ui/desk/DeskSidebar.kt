package org.impala67.app.ui.desk

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation3.runtime.NavKey
import kotlinx.coroutines.launch
import org.impala67.app.R
import org.impala67.app.core.ImpalaStore
import org.impala67.app.core.Touches
import org.impala67.app.notes.RenameDialog
import org.impala67.app.ui.shell.PageRoute
import org.impala67.app.ui.shell.ShellNav
import org.impala67.app.ui.shell.TopLevel
import org.impala67.app.ui.shell.topLevel
import org.impala67.app.ui.theme.Impala
import org.impala67.app.ui.theme.Radius
import org.impala67.app.ui.theme.Space
import org.impala67.app.ui.theme.TextSize
import uniffi.impala_ffi.PageSummary

/** Inhalt der Seitenleiste wie die Pillen oben in der PWA (`renderTopbar`): Seiten, Chats oder Karten. */
enum class SidebarMode { Files, Chats, Cards }

/** Breite der linken Spalte (`--sidebar-w`). */
val SidebarWidth = 260.dp

/**
 * Linke Spalte der PWA (`#sidebar` in index.html): Pillen Home · Chat · Karten · Suche, darunter der
 * Seitenbaum (Favoriten + Arbeitsbereiche), unten die sekundäre Navigation (`.side-foot`).
 */
@Composable
fun DeskSidebar(store: ImpalaStore, nav: ShellNav, current: NavKey, modifier: Modifier = Modifier) {
    val c = Impala.colors
    var mode by rememberSaveable { mutableStateOf(SidebarMode.Files) }
    val shownMode = if (mode == SidebarMode.Files && current.topLevel() == TopLevel.Study) SidebarMode.Cards else mode
    Column(
        modifier.fillMaxHeight().background(c.sidebar).padding(horizontal = 10.dp, vertical = 14.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(2.dp), verticalAlignment = Alignment.CenterVertically) {
            Pill(R.drawable.ic_i_home, "Home", shownMode == SidebarMode.Files) { mode = SidebarMode.Files; nav.go(TopLevel.Home) }
            Pill(R.drawable.ic_i_chat, "Chat", shownMode == SidebarMode.Chats) { mode = SidebarMode.Chats }
            Pill(R.drawable.ic_i_cards, "Karten", shownMode == SidebarMode.Cards) { mode = SidebarMode.Files; nav.go(TopLevel.Study) }
            Pill(R.drawable.ic_i_search, null, false) { nav.action("search") }
        }
        Box(Modifier.weight(1f)) {
            when (shownMode) {
                SidebarMode.Files -> PageTree(store, nav)
                // TODO(desk): Chat-Verlauf (`chatListHtml`) – folgt mit der Rust-KI.
                SidebarMode.Chats -> Hint("+ Neuer Chat", "Chats folgen mit dem KI-Modul.")
                // TODO(desk): Stapelbaum (`deckTreeHtml`) wie in der PWA statt Hinweis.
                SidebarMode.Cards -> Hint("Karteikarten", "Stapel stehen rechts in der Lernansicht.")
            }
        }
        HorizontalDivider(color = c.edgeSoft)
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            FootButton(R.drawable.ic_i_book, "Gemini Notebook") { nav.action("notebooklm") }
            FootButton(R.drawable.ic_i_graph, "Wissensgraph") { nav.action("graph") }
            FootButton(R.drawable.ic_i_library, "Bibliothek") { nav.action("library") }
            FootButton(R.drawable.ic_i_trash, "Papierkorb") { nav.action("trash") }
            FootButton(R.drawable.ic_i_sliders, "Einstellungen") { nav.action("settings") }
        }
    }
}

@Composable
private fun PageTree(store: ImpalaStore, nav: ShellNav) {
    val tree by remember(store) { store.query(Touches.pages, ::readDeskTree) }.collectAsStateWithLifecycle()
    var collapsed by rememberSaveable { mutableStateOf(setOf<String>()) }
    var renaming by remember { mutableStateOf<PageSummary?>(null) }
    val scope = rememberCoroutineScope()
    fun toggle(key: String) { collapsed = if (key in collapsed) collapsed - key else collapsed + key }
    fun patch(id: String, patch: Map<String, Any?>) = scope.launch { store.dispatch("pageUpdate", mapOf("id" to id, "patch" to patch)) }
    val actions = remember(nav, store) {
        DeskTreeActions(
            open = { if (it != nav.currentPageId) nav.open(PageRoute(it)) },
            openNewTab = nav::openNewTab,
            addChild = { nav.create(heft = false, parentId = it) },
            newPage = { ws -> scope.launch { val id = store.write { it.createPage("", "", null, ws) }; nav.open(PageRoute(id)) } },
            rename = { renaming = it },
            favorite = { patch(it.id, mapOf("favorite" to !it.favorite)) },
            archive = { p -> scope.launch { store.write { it.archivePage(p.id) } } },
            trash = { p -> nav.closeTab(p.id); scope.launch { store.write { it.trashPage(p.id) } } },
            later = { nav.toast("$it folgt mit einem der nächsten Module.") },
        )
    }
    val rows = tree?.items(collapsed).orEmpty()
    LazyColumn(Modifier.fillMaxWidth()) {
        items(rows, key = { it.key }) { item ->
            when (item) {
                is DeskTreeItem.Head -> DeskTreeHead(item, item.collapseKey?.let { it in collapsed } == true, { item.collapseKey?.let(::toggle) }, actions.newPage)
                is DeskTreeItem.Page -> DeskTreePageRow(item, item.page.id == nav.currentPageId, item.page.id in collapsed, { toggle(item.page.id) }, actions)
                is DeskTreeItem.Empty -> Text("Keine Seiten", Modifier.padding(start = 30.dp, top = Space.s1), color = Impala.colors.text2, fontSize = TextSize.sm)
            }
        }
    }
    renaming?.let { page ->
        RenameDialog(page, onDismiss = { renaming = null }) { title ->
            renaming = null
            scope.launch { store.write { it.updatePage(page.id, title, null) } }
        }
    }
}

/** Pille der Kopfzeile (`.topbar .tab`), aktiv mit Akzent-Tönung. */
@Composable
private fun Pill(icon: Int, label: String?, active: Boolean, onClick: () -> Unit) {
    val c = Impala.colors
    Row(
        Modifier.heightIn(min = 36.dp).clip(CircleShape)
            .background(if (active) c.accent.copy(alpha = 0.14f) else Color.Transparent)
            .clickable(onClick = onClick).padding(horizontal = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Space.s1_5),
    ) {
        Icon(painterResource(icon), label ?: "Suchen", Modifier.size(16.dp), tint = if (active) c.text else c.text2)
        if (label != null) Text(label, color = if (active) c.text else c.text2, fontSize = TextSize.sm, fontWeight = FontWeight.Medium)
    }
}

/** Knopf der sekundären Navigation (`.side-foot button`). */
@Composable
private fun FootButton(icon: Int, label: String, onClick: () -> Unit) {
    val c = Impala.colors
    Row(
        Modifier.fillMaxWidth().heightIn(min = 40.dp).clip(RoundedCornerShape(Radius.sm)).clickable(onClick = onClick)
            .padding(horizontal = Space.s2),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Space.s2),
    ) {
        Icon(painterResource(icon), null, Modifier.size(15.dp), tint = c.text2)
        Text(label, color = c.text2, fontSize = TextSize.sm)
    }
}

@Composable
private fun Hint(title: String, body: String) {
    Column(Modifier.padding(Space.s2), verticalArrangement = Arrangement.spacedBy(Space.s1)) {
        Text(title, color = Impala.colors.text2, fontSize = TextSize.base)
        Text(body, color = Impala.colors.text2, fontSize = TextSize.xs)
    }
}
