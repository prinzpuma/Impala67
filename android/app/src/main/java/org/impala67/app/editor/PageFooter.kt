package org.impala67.app.editor

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.impala67.app.ai.semanticIndex
import org.json.JSONObject
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.launch
import org.impala67.app.R
import org.impala67.app.core.ImpalaStore
import org.impala67.app.core.Touches
import org.impala67.app.notes.ownEmoji
import org.impala67.app.notes.pageIconRes
import org.impala67.app.notes.pageTitle
import org.impala67.app.ui.components.TintButton
import org.impala67.app.ui.theme.Impala
import org.impala67.app.ui.theme.Radius
import uniffi.impala_ffi.ImpalaCore
import uniffi.impala_ffi.MdBlock
import uniffi.impala_ffi.MdBlockKind
import uniffi.impala_ffi.PageSummary

/** „Diese Seite ist archiviert.“ mit „Wiederherstellen“ (render.js `.archived-banner`). */
@Composable
internal fun ArchivedBanner(store: ImpalaStore, pageId: String, onToast: (String) -> Unit) {
    val c = Impala.colors
    val scope = rememberCoroutineScope()
    Row(
        Modifier.fillMaxWidth().padding(vertical = 6.dp).clip(RoundedCornerShape(Radius.sm)).background(c.surfaceHover)
            .padding(start = 12.dp, end = 6.dp, top = 6.dp, bottom = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(painterResource(R.drawable.ic_i_archive), null, Modifier.size(16.dp), tint = c.text2)
        Text("Diese Seite ist archiviert.", Modifier.weight(1f).padding(start = 8.dp), color = c.text2, fontSize = 13.sp)
        TintButton(onClick = {
            scope.launch {
                runCatching { store.write { it.unarchivePage(pageId) } }
                    .onSuccess { onToast("Wiederhergestellt.") }.onFailure { onToast("Wiederherstellen fehlgeschlagen.") }
            }
        }, strong = false, height = 32.dp) {
            Icon(painterResource(R.drawable.ic_i_undo), null, Modifier.size(14.dp))
            Text("  Wiederherstellen", fontSize = 13.sp)
        }
    }
}

/** Sichtbare Unterseiten ohne Datenbank-Seiten (die zeigen sie als Karten, db-view.js). */
private fun childPages(core: ImpalaCore, pageId: String): List<PageSummary> {
    val page = core.page(pageId) ?: return emptyList()
    return if (core.pageDb(pageId) != null) emptyList() else core.childrenOf(pageId, page.summary.workspaceId)
}

/**
 * Unterseiten wie in Notion am Ende des Inhalts (editor.js `childPagesHtml`), ohne bereits als
 * Heft-Block eingebettete Unterseiten; darunter „Verwandt“ (related-pages.js).
 */
@Composable
internal fun PageFooter(
    store: ImpalaStore,
    pageId: String,
    blocks: List<MdBlock>,
    onOpenPage: (String) -> Unit,
    onToast: (String) -> Unit,
) {
    Column(Modifier.fillMaxWidth()) {
        ChildPages(store, pageId, blocks, onOpenPage)
        RelatedPages(store, pageId, onOpenPage, onToast)
    }
}

@Composable
private fun ChildPages(store: ImpalaStore, pageId: String, blocks: List<MdBlock>, onOpenPage: (String) -> Unit) {
    val c = Impala.colors
    val children by remember(store, pageId) { store.query(Touches.pages) { core -> childPages(core, pageId) } }
        .collectAsStateWithLifecycle()
    val embedded = remember(blocks) { buildSet { collectHefte(blocks) } }
    val kids = children.orEmpty().filter { it.id !in embedded }
    if (kids.isEmpty()) return
    Column(Modifier.fillMaxWidth().padding(top = 18.dp)) {
        HorizontalDivider(color = c.edgeSoft)
        Column(Modifier.padding(vertical = 6.dp)) {
            kids.forEach { k ->
                Row(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(Radius.xs)).clickable { onOpenPage(k.id) }.padding(horizontal = 4.dp, vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    PageMark(k)
                    Text(
                        pageTitle(k), Modifier.padding(start = 8.dp), color = c.text, fontSize = 15.sp, maxLines = 1,
                        overflow = TextOverflow.Ellipsis, textDecoration = TextDecoration.Underline,
                    )
                }
            }
        }
    }
}

/**
 * „Verwandt“: bis zu drei inhaltlich ähnliche Seiten aus dem semantischen Index (related-pages.js).
 * Ohne Index, bei Datenbank-Seiten oder mit Einstellung `relatedPages = false` bleibt die Leiste weg;
 * das × schaltet sie für alle Seiten aus.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun RelatedPages(store: ImpalaStore, pageId: String, onOpenPage: (String) -> Unit, onToast: (String) -> Unit) {
    val c = Impala.colors
    val semantic = semanticIndex()
    val revision by semantic.revision.collectAsStateWithLifecycle()
    val on by remember(store) {
        store.query(Touches.settings) { core -> runCatching { JSONObject(core.settingsJson()).optBoolean("relatedPages", true) }.getOrDefault(true) }
    }.collectAsStateWithLifecycle()
    var related by remember(pageId) { mutableStateOf(emptyList<PageSummary>()) }
    LaunchedEffect(pageId, revision, on) {
        if (on != true) {
            related = emptyList()
            return@LaunchedEffect
        }
        val hits = semantic.related(pageId, 3)
        related = withContext(Dispatchers.IO) {
            if (store.core.pageDb(pageId) != null) emptyList() else hits.mapNotNull { store.core.page(it.pageId)?.summary }
        }
    }
    if (related.isEmpty()) return
    val scope = rememberCoroutineScope()
    FlowRow(
        Modifier.fillMaxWidth().padding(top = 14.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
        itemVerticalAlignment = Alignment.CenterVertically,
    ) {
        Text("Verwandt", color = c.text2, fontSize = 13.sp, modifier = Modifier.padding(end = 2.dp))
        related.forEach { p ->
            Row(
                Modifier.clip(RoundedCornerShape(Radius.sm)).background(c.surfaceHover).clickable { onOpenPage(p.id) }
                    .padding(horizontal = 8.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                PageMark(p)
                Text(pageTitle(p), Modifier.padding(start = 6.dp).widthIn(max = 220.dp), color = c.text, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        IconButton(
            onClick = {
                scope.launch {
                    runCatching { store.dispatch("settingsSet", mapOf("relatedPages" to false)) }
                        .onSuccess { onToast("Verwandte Seiten ausgeblendet. Unter Einstellungen → Darstellung wieder einschalten.") }
                }
            },
            modifier = Modifier.size(28.dp),
        ) { Icon(painterResource(R.drawable.ic_i_x), "Verwandte Seiten ausblenden", Modifier.size(14.dp), tint = c.text2) }
    }
}

@Composable
private fun PageMark(p: PageSummary) {
    val emoji = ownEmoji(p)
    if (emoji != null) Text(emoji, fontSize = 15.sp) else Icon(painterResource(pageIconRes(p)), null, Modifier.size(16.dp), tint = Impala.colors.text2)
}

private fun MutableSet<String>.collectHefte(list: List<MdBlock>) {
    list.forEach { b ->
        when (val k = b.kind) {
            is MdBlockKind.Heft -> add(k.heftId)
            is MdBlockKind.Callout -> collectHefte(k.children)
            is MdBlockKind.Toggle -> collectHefte(k.children)
            is MdBlockKind.Columns -> k.columns.forEach { collectHefte(it) }
            else -> Unit
        }
    }
}
