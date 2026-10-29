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
)

/** Schlüssel der Wurzel eines Arbeitsbereichs in [DeskTree.kids] (wie `ws:<id>` beim Einklappen). */
fun wsKey(id: String) = "ws:$id"

/** Tiefe wie in der PWA (`depth > 8` wird nicht mehr gezeichnet). */
private const val MAX_DEPTH = 8

internal fun readDeskTree(core: ImpalaCore): DeskTree {
    val workspaces = core.workspaces()
    val kids = HashMap<String, List<PageSummary>>()
    fun walk(parent: PageSummary?, ws: String, depth: Int) {
        val list = core.childrenOf(parent?.id, ws)
        kids[parent?.id ?: wsKey(ws)] = list
        if (depth < MAX_DEPTH) list.forEach { walk(it, ws, depth + 1) }
    }
    workspaces.forEach { walk(null, it.id, 0) }
    val favorites = core.recentPages(UInt.MAX_VALUE).filter { it.favorite }
    return DeskTree(workspaces, favorites, kids)
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

/** Baum in Zeilen auflösen; [collapsed] enthält Seiten-IDs und `ws:<id>` wie `COLLAPSE` in der PWA. */
fun DeskTree.items(collapsed: Set<String>): List<DeskTreeItem> = buildList {
    if (favorites.isNotEmpty()) {
        add(DeskTreeItem.Head("★ Favoriten", null, null))
        favorites.forEach { add(DeskTreeItem.Page(it, 0, false, "fav")) }
    }
    fun branch(parentKey: String, depth: Int) {
        kids[parentKey].orEmpty().forEach { pg ->
            val sub = kids[pg.id].orEmpty()
            add(DeskTreeItem.Page(pg, depth, sub.isNotEmpty(), "tree"))
            if (sub.isNotEmpty() && pg.id !in collapsed && depth < MAX_DEPTH) branch(pg.id, depth + 1)
        }
    }
    workspaces.forEach { ws ->
        add(DeskTreeItem.Head(ws.name, wsKey(ws.id), ws.id))
        if (wsKey(ws.id) !in collapsed) {
            if (kids[wsKey(ws.id)].isNullOrEmpty()) add(DeskTreeItem.Empty(ws.id)) else branch(wsKey(ws.id), 0)
        }
    }
}
