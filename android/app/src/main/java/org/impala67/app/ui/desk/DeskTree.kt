package org.impala67.app.ui.desk

import uniffi.impala_ffi.ImpalaCore
import uniffi.impala_ffi.PageSummary
import uniffi.impala_ffi.WorkspaceInfo

/**
 * Seitenbaum der Seitenleiste (in der PWA: `renderSidebar` in render.js): Favoriten oben, darunter je
 * Arbeitsbereich die Seiten in Benutzer-Reihenfolge (`childrenOf`). [kids] ist nach Eltern-ID
 * geschlüsselt; `null` steht für die Wurzel eines Arbeitsbereichs (Schlüssel `ws:<id>`).
 */
data class DeskTree(
    val workspaces: List<WorkspaceInfo>,
    val favorites: List<PageSummary>,
    val kids: Map<String, List<PageSummary>>,
    /** Seiten mit Datenbankansicht („Als Vorlesungsübersicht“). */
    val dbPages: Set<String>,
    /** Aufklapp-Zustand wie `S.treeOpen` (geräteübergreifend, `uiTreeSet`). */
    val open: Map<String, Boolean>,
)
    val sidebarRows: List<uniffi.impala_ffi.SidebarRowInfo> = emptyList(),
)

/** Wie `COLLAPSE.isCollapsed` (web/collapse.js): Seiten sind standardmäßig zu, Arbeitsbereiche offen. */
fun DeskTree.isCollapsed(key: String): Boolean = if (key.startsWith("ws:")) open[key] == false else open[key] != true

/** Schlüssel der Wurzel eines Arbeitsbereichs in [DeskTree.kids] (wie `ws:<id>` beim Einklappen). */
fun wsKey(id: String) = "ws:$id"

private const val MAX_DEPTH = 8

internal fun readDeskTree(core: ImpalaCore): DeskTree {
    val workspaces = core.workspaces()
    val rows = core.sidebarTreeRows()
    val kids = HashMap<String, List<PageSummary>>()
    fun walk(parent: PageSummary?, ws: String, depth: Int) {
        val list = core.childrenOf(parent?.id, ws)
        kids[parent?.id ?: wsKey(ws)] = list
        if (depth < MAX_DEPTH) list.forEach { walk(it, ws, depth + 1) }
    }
    workspaces.forEach { walk(null, it.id, 0) }
    val favorites = rows.filter { it.kind == "page" && it.section == "fav" }.mapNotNull { it.page }
    val db = kids.values.flatten().filter { core.pageDb(it.id) != null }.mapTo(HashSet()) { it.id }
    return DeskTree(workspaces, favorites, kids, db, core.treeOpen(), rows)
}
/**
 * Gezogene Seite ablegen (`movePageRelative`/`movePageInto` in app-sidebar-events.js): davor/danach =
 * Geschwister des Ziels (auch in einem anderen Arbeitsbereich), Mitte = Unterseite, Arbeitsbereich-Kopf =
 * Wurzel dieses Bereichs, freie Fläche (`target == null`) = Wurzel des eigenen Bereichs. Zyklen lehnt der Kern ab.
 */
internal fun dropPage(core: ImpalaCore, moved: PageSummary, target: DeskTreeItem?, zone: DropZone) {
    when (target) {
        null -> core.movePage(moved.id, null, null)
        is DeskTreeItem.Head -> target.workspaceId?.let { ws ->
            if (ws != moved.workspaceId || moved.parentId != null) core.movePageToWorkspace(moved.id, ws)
        }
        is DeskTreeItem.Page -> {
            val t = target.page
            if (zone == DropZone.Into) { core.movePage(moved.id, t.id, null); return }
            if (t.parentId == null && t.workspaceId != moved.workspaceId) core.movePageToWorkspace(moved.id, t.workspaceId)
            val sibs = core.childrenOf(t.parentId, t.workspaceId).filter { it.id != moved.id }
            val i = sibs.indexOfFirst { it.id == t.id }
            if (i < 0) return
            core.movePage(moved.id, t.parentId, (if (zone == DropZone.Before) i else i + 1).toUInt())
        }
        is DeskTreeItem.Empty -> core.movePageToWorkspace(moved.id, target.workspaceId)
    }
}

/** Eine sichtbare Zeile im Baum (ausgeklappte Äste aufgelöst). */
sealed interface DeskTreeItem {
    val key: String
    data class Head(val title: String, val collapseKey: String?, val workspaceId: String?) : DeskTreeItem {
        override val key get() = "head:${collapseKey ?: title}"
    }
    data class Page(val page: PageSummary, val depth: Int, val hasKids: Boolean, val section: String) : DeskTreeItem {
        override val key get() = "$section:${page.id}"
    }
    data class Empty(val workspaceId: String) : DeskTreeItem {
        override val key get() = "empty:$workspaceId"
    }
}

/** Baum in Zeilen auflösen; zugeklappt nach [isCollapsed] (Seiten-IDs und `ws:<id>` wie `COLLAPSE` in der PWA). */
/** Baum-Zeilen aus dem Rust-Kern (`sidebarTreeRows`). */
fun DeskTree.items(): List<DeskTreeItem> = sidebarRows.mapNotNull { r ->
    when (r.kind) {
        "head" -> DeskTreeItem.Head(r.title, r.collapseKey, r.workspaceId)
        "page" -> r.page?.let { DeskTreeItem.Page(it, r.depth.toInt(), r.hasKids, r.section) }
        "empty" -> r.workspaceId?.let { DeskTreeItem.Empty(it) }
        else -> null
    }
}
