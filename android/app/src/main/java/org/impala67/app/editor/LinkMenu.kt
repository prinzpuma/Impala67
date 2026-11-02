package org.impala67.app.editor

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.PopupProperties
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import org.impala67.app.notes.ownEmoji
import org.impala67.app.notes.pageIconRes
import org.impala67.app.notes.pageTitle
import org.impala67.app.ui.theme.Impala
import uniffi.impala_ffi.PageSummary

/** Eine „[[“-Eingabe: Block, Suchbegriff und Caret-Position hinter „[[suche“. */
internal data class LinkQuery(val blockId: String, val query: String, val end: Int)

/** Offenes Seiten-Link-Menü (wie [SlashState]). */
internal class LinkState {
    var current by mutableStateOf<LinkQuery?>(null); private set
    var selected by mutableIntStateOf(0)
    fun open(blockId: String, query: String, end: Int) {
        if (current?.query != query || current?.blockId != blockId) selected = 0
        current = LinkQuery(blockId, query, end)
    }
    fun close() { current = null }
}

/** „[[suche“ direkt vor dem Caret (Gruppe 1 = Suchbegriff). */
internal val LINK_TRIGGER = Regex("""\[\[([^\[\]\n]*)$""")

/** Höchstens 8 Seiten ohne die aktuelle, Titel enthält [query] (`openLinkMenu`). */
internal fun linkItems(pages: List<PageSummary>, currentId: String, query: String): List<PageSummary> {
    val q = query.lowercase()
    return pages.asSequence().filter { it.id != currentId && (q.isEmpty() || it.title.lowercase().contains(q)) }.take(8).toList()
}

/** Seiten-Link-Menü am Eingabefeld von [blockId]; nimmt den Fokus nicht, wie das Slash-Menü. */
@Composable
internal fun LinkDropdown(menus: EditorMenus, vm: EditorViewModel, blockId: String) {
    val q = menus.links.current?.takeIf { it.blockId == blockId } ?: return
    val c = Impala.colors
    val pages by vm.linkPages.collectAsStateWithLifecycle()
    val items = remember(q.query, pages) { linkItems(pages.orEmpty(), vm.pageId, q.query) }
    DropdownMenu(
        expanded = true,
        onDismissRequest = { menus.links.close() },
        properties = PopupProperties(focusable = false),
        containerColor = c.menu,
    ) {
        if (items.isEmpty()) DropdownMenuItem({ Text("Keine Seite gefunden", color = c.text2) }, {}, enabled = false)
        items.forEachIndexed { i, p ->
            DropdownMenuItem(
                modifier = if (i == menus.links.selected) Modifier.background(c.hoverBg) else Modifier,
                text = { Text(pageTitle(p)) },
                onClick = { menus.links.close(); vm.applyLink(blockId, q, p) },
                leadingIcon = {
                    val emoji = ownEmoji(p)
                    if (emoji != null) Text(emoji) else Icon(painterResource(pageIconRes(p)), null, Modifier.size(18.dp))
                },
            )
        }
    }
}
