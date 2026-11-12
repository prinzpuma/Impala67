package org.impala67.app.ui.desk

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.zIndex
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import org.impala67.app.R
import org.impala67.app.core.ImpalaStore
import org.impala67.app.core.Touches
import org.impala67.app.notes.ownEmoji
import org.impala67.app.notes.pageIconRes
import org.impala67.app.notes.pageTitle
import org.impala67.app.ui.shell.ANKI_TAB
import org.impala67.app.ui.shell.CHAT_TAB
import org.impala67.app.ui.shell.SearchRoute
import org.impala67.app.ui.shell.ShellNav
import org.impala67.app.ui.theme.Impala
import org.impala67.app.ui.theme.Radius
import org.impala67.app.ui.theme.Space
import org.impala67.app.ui.theme.TextSize

/** Titel und Symbol eines Tabs (`tabchip` in render.js: ✦ für Chats, Karten-Symbol, Seiten-Icon). */
data class TabInfo(val title: String, val icon: Int, val emoji: String?)

/** Titel/Symbol je Tab-Schlüssel, nachgeführt bei Änderungen an Seiten und Chats. */
@Composable
internal fun rememberTabInfo(store: ImpalaStore): (String) -> TabInfo {
    val pages by remember(store) {
        store.query(Touches.pagesMeta) { core -> core.recentPages(UInt.MAX_VALUE).associateBy { it.id } }
    }.collectAsStateWithLifecycle()
    val chats by remember(store) { store.query(Touches.chats) { core -> core.chats().associateBy { it.id } } }.collectAsStateWithLifecycle()
    return { tab ->
        when {
            tab == ANKI_TAB -> TabInfo("Karteikarten", R.drawable.ic_i_cards, null)
            tab.startsWith(CHAT_TAB) ->
                TabInfo(chats?.get(tab.removePrefix(CHAT_TAB))?.title?.ifBlank { "Chat" } ?: "Neuer Chat", R.drawable.ic_i_sparkles, null)
            else -> pages?.get(tab)?.let { TabInfo(pageTitle(it), pageIconRes(it), ownEmoji(it)) } ?: TabInfo("Ohne Titel", R.drawable.ic_i_note, null)
        }
    }
}

/**
 * Tab-Leiste über dem Inhalt (`#tabbar`, `renderTabs` in render.js): ☰ (Seitenleiste ein-/ausklappen), Zurück, Vor,
 * offene Tabs als Chips (Seiten, Chats, Karteikarten; 170 dp, aktiv getönt, × zum Schließen, halten und ziehen
 * ordnet um), „+“ mit „Neuen Chat starten“ / „Neue Seite“ / „In neuem Tab öffnen…“. Mit „Tabs in Seitenleiste“
 * ([tabsInSidebar]) stehen die Chips links in der Seitenleiste; hier bleiben ☰, Zurück und Vor.
 * Teilen/Stern/⋯ sitzen wie in der PWA in der Seitenzeile über dem Editor ([PageActions]).
 */
@Composable
fun DeskTabBar(
    store: ImpalaStore,
    nav: ShellNav,
    canGoBack: Boolean,
    tabsInSidebar: Boolean,
    onToggleSidebar: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val c = Impala.colors
    val info = rememberTabInfo(store)
    val active = nav.currentTab
    Column(modifier.fillMaxWidth().background(c.panel)) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = Space.s2, vertical = Space.s1_5),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            SidebarToggle(onToggleSidebar)
            SmallButton(R.drawable.ic_i_chevron_left, "Zurück", enabled = canGoBack, onClick = nav::back)
            SmallButton(R.drawable.ic_i_chevron_right, "Vor", enabled = nav.canGoForward, onClick = nav::forward)
            if (tabsInSidebar) return@Row
            Row(
                Modifier.weight(1f).horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(TabGap),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                ReorderableTabs(nav) { tab, drag ->
                    TabChip(info(tab), tab == active, drag, { nav.openTab(tab) }, { nav.closeTab(tab) })
                }
                // „+“ sitzt wie `#btnTabNew` direkt hinter dem letzten Tab.
                NewTabButton(nav)
            }
        }
        HorizontalDivider(color = c.edgeSoft)
    }
}

private val TabGap = 2.dp

/** „+“ wie `#btnTabNew`: Menü wie `newTabActions` in search.js plus Seitensuche für einen neuen Tab. */
@Composable
internal fun NewTabButton(nav: ShellNav, size: Int = 32) {
    var open by remember { mutableStateOf(false) }
    Box {
        SmallButton(R.drawable.ic_i_plus, "Neuen Tab öffnen", size = size) { open = true }
        DropdownMenu(open, { open = false }, containerColor = Impala.colors.menu) {
            MenuEntry(R.drawable.ic_i_sparkles, "Neuen Chat starten") { open = false; nav.openNewChatTab() }
            MenuEntry(R.drawable.ic_i_file, "Neue Seite") { open = false; nav.askNewPage(newTab = true) }
            MenuEntry(R.drawable.ic_i_search, "In neuem Tab öffnen…") { open = false; nav.searchInNewTab = true; nav.open(SearchRoute) }
        }
    }
}

/**
 * Tabs in Reihenfolge zeichnen; halten und ziehen verschiebt einen Tab, bis er seinen Nachbarn zur Hälfte
 * überholt hat – dann tauschen beide die Plätze ([ShellNav.moveTab]). [horizontal]: Leiste oben, sonst Liste.
 */
@Composable
internal fun ReorderableTabs(nav: ShellNav, horizontal: Boolean = true, chip: @Composable (String, Modifier) -> Unit) {
    var dragging by remember { mutableStateOf<String?>(null) }
    var shift by remember { mutableFloatStateOf(0f) }
    val sizes = remember { HashMap<String, Int>() }
    val gap = with(LocalDensity.current) { TabGap.toPx() }
    nav.tabs.forEach { tab ->
        key(tab) {
            val m = Modifier
                .onSizeChanged { sizes[tab] = if (horizontal) it.width else it.height }
                .zIndex(if (dragging == tab) 1f else 0f)
                .graphicsLayer { if (dragging == tab) { if (horizontal) translationX = shift else translationY = shift } }
                .pointerInput(tab) {
                    detectDragGesturesAfterLongPress(
                        onDragStart = { dragging = tab; shift = 0f },
                        onDrag = { change, amount ->
                            change.consume()
                            shift += if (horizontal) amount.x else amount.y
                            val i = nav.tabs.indexOf(tab)
                            val j = if (shift > 0) i + 1 else i - 1
                            val other = nav.tabs.getOrNull(j) ?: return@detectDragGesturesAfterLongPress
                            val size = (sizes[other] ?: return@detectDragGesturesAfterLongPress) + gap
                            if (kotlin.math.abs(shift) > size / 2) {
                                nav.moveTab(i, j)
                                shift -= if (shift > 0) size else -size
                            }
                        },
                        onDragEnd = { dragging = null; shift = 0f },
                        onDragCancel = { dragging = null; shift = 0f },
                    )
                }
            chip(tab, m)
        }
    }
}

/** ☰ wie `#btnSidebarToggle` der PWA (das Icon-Set hat kein Menü-Symbol). */
@Composable
private fun SidebarToggle(onClick: () -> Unit) {
    Box(
        Modifier.size(32.dp).clip(RoundedCornerShape(Radius.sm)).clickable(onClickLabel = "Linke Spalte ein-/ausklappen", onClick = onClick),
        contentAlignment = Alignment.Center,
    ) { Text("☰", color = Impala.colors.text2, fontSize = TextSize.base) }
}

@Composable
private fun TabChip(info: TabInfo, active: Boolean, modifier: Modifier, onClick: () -> Unit, onClose: () -> Unit) {
    val c = Impala.colors
    Row(
        modifier.widthIn(min = 96.dp, max = 170.dp).height(32.dp).clip(RoundedCornerShape(Radius.sm))
            .background(if (active) c.accent.copy(alpha = 0.14f) else c.panel)
            .clickable(onClick = onClick).padding(start = Space.s2, end = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Space.s1_5),
    ) {
        TabIcon(info, active)
        Text(info.title, Modifier.weight(1f, fill = false), color = if (active) c.text else c.text2, fontSize = TextSize.sm, maxLines = 1, overflow = TextOverflow.Ellipsis)
        SmallButton(R.drawable.ic_i_x, "Tab schließen", size = 24, onClick = onClose)
    }
}

@Composable
internal fun TabIcon(info: TabInfo, active: Boolean) {
    val c = Impala.colors
    if (info.emoji != null) Text(info.emoji, fontSize = TextSize.xs)
    else Icon(painterResource(info.icon), null, Modifier.size(13.dp), tint = if (active) c.text else c.text2)
}

@Composable
internal fun SmallButton(icon: Int, label: String, enabled: Boolean = true, size: Int = 32, active: Boolean = false, danger: Boolean = false, onClick: () -> Unit) {
    val c = Impala.colors
    Box(
        Modifier.size(size.dp).clip(RoundedCornerShape(Radius.sm)).clickable(enabled = enabled, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        val tint = if (!enabled) c.text2.copy(alpha = 0.3f) else if (active) c.accent else if (danger) c.danger else c.text2
        Icon(painterResource(icon), label, Modifier.size((size / 2).dp), tint = tint)
    }
}
