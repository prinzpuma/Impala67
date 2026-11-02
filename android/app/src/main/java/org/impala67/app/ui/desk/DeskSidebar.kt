package org.impala67.app.ui.desk

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation3.runtime.NavKey
import kotlinx.coroutines.launch
import org.impala67.app.R
import org.impala67.app.ai.AiChatViewModel
import org.impala67.app.ai.ChatList
import org.impala67.app.core.ImpalaStore
import org.impala67.app.core.Touches
import org.impala67.app.editor.LECTURE_SCHEMA
import org.impala67.app.notes.MovePageDialog
import org.impala67.app.notes.duplicatePage
import org.impala67.app.study.reason
import org.impala67.app.ui.shell.ChatRoute
import org.impala67.app.ui.shell.PageRoute
import org.impala67.app.ui.shell.ShellNav
import org.impala67.app.ui.shell.StudyRoute
import org.impala67.app.ui.shell.TopLevel
import org.impala67.app.ui.shell.topLevel
import org.impala67.app.ui.theme.Impala
import org.impala67.app.ui.theme.Radius
import org.impala67.app.ui.theme.Space
import org.impala67.app.ui.theme.TextSize
import uniffi.impala_ffi.PageSummary

/** Inhalt der Seitenleiste wie die Pillen oben in der PWA (`renderTopbar`): Seiten, Chats oder Karten. */
enum class SidebarMode { Files, Chats, Cards }

/** Breite der linken Spalte (`--sidebar-w` bei kompakter Dichte, dem PWA-Standard). */
val SidebarWidth = 236.dp

/** Breite bei komfortabler Dichte (`--sidebar-w` in variables.css). */
val SidebarWidthComfortable = 260.dp

/**
 * Linke Spalte der PWA (`#sidebar` in index.html): Pillen Home · Chat · Karten · Suche, bei „Tabs in
 * Seitenleiste“ die offenen Tabs, darunter Seitenbaum (Favoriten + Arbeitsbereiche), Chat-Verlauf oder
 * Stapelbaum, unten die sekundäre Navigation (`.side-foot`).
 */
@Composable
fun DeskSidebar(store: ImpalaStore, nav: ShellNav, current: NavKey, ai: AiChatViewModel, tabsInSidebar: Boolean, modifier: Modifier = Modifier) {
    val c = Impala.colors
    var mode by rememberSaveable { mutableStateOf(SidebarMode.Files) }
    // Wie `openPage` in tabs.js: Karteikarten zeigen den Stapelbaum, ein Chat-Tab den Chat-Verlauf.
    val shownMode = when {
        mode == SidebarMode.Files && current.topLevel() == TopLevel.Study -> SidebarMode.Cards
        mode == SidebarMode.Files && current is ChatRoute -> SidebarMode.Chats
        else -> mode
    }
    Column(
        modifier.fillMaxHeight().background(c.sidebar).padding(horizontal = 8.dp, vertical = 10.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(2.dp), verticalAlignment = Alignment.CenterVertically) {
            Pill(R.drawable.ic_i_home, "Home", shownMode == SidebarMode.Files) { mode = SidebarMode.Files; nav.go(TopLevel.Home) }
            Pill(R.drawable.ic_i_chat, "Chat", shownMode == SidebarMode.Chats) { mode = SidebarMode.Chats }
            // `#btnAnki`: Karteikarten als eigener Tab (`anki:main`).
            Pill(R.drawable.ic_i_cards, "Karten", shownMode == SidebarMode.Cards) { mode = SidebarMode.Files; nav.open(StudyRoute) }
            Spacer(Modifier.weight(1f))
            Pill(R.drawable.ic_i_search, "Suchen", false) { nav.action("search") }
        }
        if (tabsInSidebar) SidebarTabs(store, nav)
        Box(Modifier.weight(1f)) {
            when (shownMode) {
                SidebarMode.Files -> PageTree(store, nav)
                SidebarMode.Chats -> ChatList(ai, onOpenTab = { id ->
                    // Ein Chat lebt nur an einer Stelle: das Panel gibt ihn an den Tab ab.
                    if (ai.chatId.value == id) ai.newChat(reveal = false)
                    nav.openNewTab(ChatRoute(id))
                })
                SidebarMode.Cards -> DeskDecks(store, nav, current)
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

/** „Offene Tabs“ (`sidebarTabsHtml` in render.js): Kopf mit „＋“, je Tab Symbol, Titel, ✕; halten und ziehen ordnet um. */
@Composable
private fun SidebarTabs(store: ImpalaStore, nav: ShellNav) {
    if (nav.tabs.isEmpty()) return
    val c = Impala.colors
    val info = rememberTabInfo(store)
    val active = nav.currentTab
    Column {
        Row(Modifier.fillMaxWidth().padding(start = Space.s1), verticalAlignment = Alignment.CenterVertically) {
            Text("Offene Tabs", Modifier.weight(1f), color = c.text2, fontSize = TextSize.xs, fontWeight = FontWeight.SemiBold)
            NewTabButton(nav, size = 28)
        }
        ReorderableTabs(nav, horizontal = false) { tab, m ->
            val t = info(tab)
            val on = tab == active
            Row(
                m.fillMaxWidth().heightIn(min = 34.dp).clip(RoundedCornerShape(Radius.md))
                    .background(if (on) c.accent.copy(alpha = 0.14f) else c.sidebar)
                    .clickable { nav.openTab(tab) }.padding(start = Space.s2, end = 2.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Space.s2),
            ) {
                TabIcon(t, on)
                Text(t.title, Modifier.weight(1f), color = if (on) c.text else c.text2, fontSize = TextSize.sm, maxLines = 1, overflow = TextOverflow.Ellipsis)
                SmallButton(R.drawable.ic_i_x, "Tab schließen", size = 26) { nav.closeTab(tab) }
            }
        }
    }
}

@Composable
private fun PageTree(store: ImpalaStore, nav: ShellNav) {
    val tree by remember(store) { store.query(Touches.any(Touches.pages, Touches.ui), ::readDeskTree) }.collectAsStateWithLifecycle()
    var renaming by remember { mutableStateOf<String?>(null) }
    var moving by remember { mutableStateOf<PageSummary?>(null) }
    val drag = remember { TreeDrag() }
    val list = rememberLazyListState()
    val scope = rememberCoroutineScope()
    val t = tree
    val rows = t?.items().orEmpty()
    val byKey = rows.associateBy { it.key }
    // Wie `COLLAPSE.toggle`: geht über das Ereignisprotokoll und gilt damit auf allen Geräten.
    fun toggle(key: String) { val open = t?.isCollapsed(key) ?: return; scope.launch { store.write { it.setTreeOpen(key, open) } } }
    fun patch(id: String, patch: Map<String, Any?>) = scope.launch { store.dispatch("pageUpdate", mapOf("id" to id, "patch" to patch)) }
    val actions = DeskTreeActions(
        open = { if (it != nav.currentPageId) nav.open(PageRoute(it)) },
        openNewTab = nav::openNewTab,
        addChild = { nav.askNewPage(parentId = it) },
        newPage = { ws -> nav.askNewPage(workspaceId = ws) },
        rename = { renaming = it.id },
        renamed = { p, title ->
            renaming = null
            if (title != null && title != p.title) scope.launch { store.write { it.updatePage(p.id, title, null) } }
        },
        favorite = { patch(it.id, mapOf("favorite" to !it.favorite)) },
        template = { patch(it.id, mapOf("isTemplate" to !it.isTemplate)) },
        lectureDb = { p, on -> scope.launch { store.write { it.setPageDb(p.id, if (on) LECTURE_SCHEMA else null) } } },
        archive = { p -> nav.closeTab(p.id); scope.launch { store.write { it.archivePage(p.id) } } },
        trash = { p -> nav.closeTab(p.id); scope.launch { store.write { it.trashPage(p.id) } } },
        duplicate = { p -> scope.launch { duplicatePage(store, p.id)?.let { nav.open(PageRoute(it)) } } },
        move = { moving = it },
        drop = { p, d ->
            scope.launch {
                runCatching { store.write { core -> dropPage(core, p, d.row?.let(byKey::get), d.zone) } }
                    .onFailure { nav.toast(it.reason()) }
            }
        },
    )
    TreeDragArea(drag, list, Modifier.fillMaxSize()) {
        LazyColumn(Modifier.fillMaxSize(), state = list) {
            items(rows, key = { it.key }) { item ->
                when (item) {
                    is DeskTreeItem.Head -> DeskTreeHead(item, item.collapseKey?.let { t?.isCollapsed(it) } == true, drag, { item.collapseKey?.let(::toggle) }, actions.newPage)
                    is DeskTreeItem.Page -> DeskTreePageRow(
                        item, item.page.id == nav.currentPageId, t?.isCollapsed(item.page.id) == true,
                        isDb = t?.dbPages?.contains(item.page.id) == true,
                        renaming = renaming == item.page.id && item.section == "tree",
                        drag = drag, onToggle = { toggle(item.page.id) }, actions = actions,
                    )
                    is DeskTreeItem.Empty -> Text(
                        "Keine Seiten",
                        Modifier.fillMaxWidth().treeRow(drag, item.key, "", enabled = false, onHold = {}, onDrop = {})
                            .dropMark(drag.zoneOf(item.key)?.let { DropZone.Into }).padding(start = 30.dp, top = Space.s1, bottom = Space.s1),
                        color = Impala.colors.text2, fontSize = TextSize.sm,
                    )
                }
            }
        }
    }
    moving?.let { page -> MovePageDialog(store, page) { moving = null } }
}

/** Pille der Kopfzeile (`.topbar .tab`), aktiv mit Akzent-Tönung; nur die aktive zeigt ihr Label (`.tab.active .tab-label`). */
@Composable
private fun Pill(icon: Int, label: String, active: Boolean, onClick: () -> Unit) {
    val c = Impala.colors
    Row(
        Modifier.heightIn(min = 36.dp).clip(CircleShape)
            .background(if (active) c.accent.copy(alpha = 0.14f) else Color.Transparent)
            .clickable(onClick = onClick).padding(horizontal = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Space.s1_5),
    ) {
        Icon(painterResource(icon), label, Modifier.size(16.dp), tint = if (active) c.text else c.text2)
        if (active) Text(label, color = if (active) c.text else c.text2, fontSize = TextSize.sm, fontWeight = FontWeight.Medium)
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
