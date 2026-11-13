package org.impala67.app.library

import android.util.Log
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.launch
import org.impala67.app.R
import org.impala67.app.core.ImpalaStore
import org.impala67.app.notebook.NotebookScreen
import org.impala67.app.notes.EmptyState
import org.impala67.app.notes.formatDate
import org.impala67.app.notes.ownEmoji
import org.impala67.app.notes.pageIconRes
import org.impala67.app.notes.pageTitle
import org.impala67.app.ui.theme.Impala
import org.impala67.app.ui.theme.Space
import org.impala67.app.ui.theme.TextSize
import uniffi.impala_ffi.PageKind
import uniffi.impala_ffi.PageSummary

private const val TAG = "LibraryScreen"

/** Bibliothek (`web/library.js` & `LibraryScreen.swift`): Notion-Baum, GoodNotes-Regal, Archiv und Gemini Notebook. */
@Composable
fun LibraryScreen(
    store: ImpalaStore,
    onOpenPage: (String) -> Unit,
    onToast: (String) -> Unit,
    modifier: Modifier = Modifier,
    onOpenPdf: ((fileId: String, title: String) -> Unit)? = null,
) {
    val vm: LibraryViewModel = viewModel { LibraryViewModel(store) }
    val counts by vm.counts.collectAsStateWithLifecycle()
    val query by vm.query.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val pickPdf = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        if (uris.isEmpty()) return@rememberLauncherForActivityResult
        scope.launch {
            var last: String? = null
            for (uri in uris) runCatching { readPickedPdf(context, uri) }.onSuccess { last = vm.importPdf(it.name, it.bytes) }.onFailure { Log.w(TAG, "PDF-Import", it) }
            last?.let(onOpenPage) ?: onToast("PDF-Datei konnte nicht geladen werden.")
        }
    }
    val openPage: (PageSummary) -> Unit = { p ->
        val pdfId = p.pdfId
        if (pdfId != null && onOpenPdf != null) onOpenPdf(pdfId, pageTitle(p)) else onOpenPage(p.id)
    }

    Column(modifier.fillMaxSize().background(Impala.colors.panel).padding(horizontal = Space.s5).padding(top = Space.s5, bottom = Space.s4), verticalArrangement = Arrangement.spacedBy(Space.s3)) {
        Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            Text("Bibliothek", color = Impala.colors.text, fontSize = TextSize.xl, fontWeight = FontWeight.Bold)
            counts?.let { (pages, hefte) ->
                Text("$pages ${if (pages == 1) "Seite" else "Seiten"} · $hefte ${if (hefte == 1) "Heft" else "Hefte"}", color = Impala.colors.text2, fontSize = TextSize.sm)
            }
        }
        Column(Modifier.weight(1f).fillMaxWidth().clip(RoundedCornerShape(24.dp)).background(ShelfColors.paper).border(1.dp, ShelfColors.edge, RoundedCornerShape(24.dp))) {
            when (vm.mode) {
                LibraryMode.NOTION -> NotionTreeContent(vm, query, openPage, onOpenPage) { pickPdf.launch(arrayOf("application/pdf")) }
                LibraryMode.HEFTE -> HeftShelfContent(vm, query, vm::setQuery) { onOpenPage(it) }
                LibraryMode.ARCHIVE -> ArchiveListContent(vm, query, openPage)
                LibraryMode.NLM -> {
                    LibToolbar(vm.mode, { vm.mode = it; vm.setQuery("") }, query, vm::setQuery, prompt = null)
                    NotebookScreen(store, null, onOpenPage, onToast, Modifier.weight(1f), background = Color.Transparent)
                }
            }
        }
    }
}

@Composable
fun LibToolbar(
    mode: LibraryMode,
    onModeChange: (LibraryMode) -> Unit,
    query: String,
    onQueryChange: (String) -> Unit,
    prompt: String?,
    left: (@Composable () -> Unit)? = null,
    trailing: (@Composable () -> Unit)? = null,
) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp).padding(top = 16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        val modesBar = @Composable {
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                LibraryMode.entries.forEach { m ->
                    val active = mode == m
                    Row(
                        Modifier.height(36.dp).clip(RoundedCornerShape(11.dp))
                            .background(if (active) ShelfColors.tint2 else Color.Transparent)
                            .clickable { onModeChange(m) }.padding(horizontal = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Icon(painterResource(m.icon), null, Modifier.size(15.dp), tint = if (active) ShelfColors.ink else Impala.colors.text2)
                        Text(m.label, color = if (active) ShelfColors.ink else Impala.colors.text2, fontSize = TextSize.sm, fontWeight = FontWeight.SemiBold, maxLines = 1)
                    }
                }
            }
        }
        val searchAndTrailing = @Composable { m: Modifier ->
            Row(m, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.s2)) {
                if (prompt != null) {
                    Row(
                        Modifier.weight(1f).height(36.dp).clip(RoundedCornerShape(11.dp)).background(ShelfColors.tint).padding(horizontal = Space.s3),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(Space.s2),
                    ) {
                        Icon(painterResource(R.drawable.ic_i_search), null, Modifier.size(15.dp), tint = Impala.colors.text2)
                        Box(Modifier.weight(1f), contentAlignment = Alignment.CenterStart) {
                            if (query.isEmpty()) Text(prompt, color = Impala.colors.text2, fontSize = 14.sp, maxLines = 1)
                            BasicTextField(query, onQueryChange, singleLine = true, textStyle = TextStyle(color = Impala.colors.text, fontSize = 14.sp), cursorBrush = SolidColor(Impala.colors.accent), modifier = Modifier.fillMaxWidth())
                        }
                        if (query.isNotEmpty()) Icon(painterResource(R.drawable.ic_i_x), "Leeren", Modifier.size(14.dp).clickable { onQueryChange("") }, tint = Impala.colors.text2)
                    }
                } else Spacer(Modifier.weight(1f))
                trailing?.invoke()
            }
        }
        BoxWithConstraints(
            Modifier.fillMaxWidth().shadow(2.dp, RoundedCornerShape(16.dp)).clip(RoundedCornerShape(16.dp))
                .background(ShelfColors.sheet).border(1.dp, ShelfColors.edge, RoundedCornerShape(16.dp)).padding(6.dp),
        ) {
            if (maxWidth < 680.dp) Column(verticalArrangement = Arrangement.spacedBy(6.dp)) { modesBar(); searchAndTrailing(Modifier.fillMaxWidth()) }
            else Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.s2)) { modesBar(); searchAndTrailing(Modifier.weight(1f)) }
        }
        left?.invoke()
    }
}

@Composable
private fun LibFilterChips(filters: List<Triple<String, String, Int>>, selected: String, onSelect: (String) -> Unit) {
    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(Space.s1)) {
        filters.forEach { (id, label, count) ->
            val active = id == selected
            Row(
                Modifier.heightIn(min = 32.dp).clip(CircleShape).background(if (active) ShelfColors.tint2 else Color.Transparent)
                    .clickable { onSelect(id) }.padding(horizontal = Space.s3, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Text(label, color = if (active) ShelfColors.ink else Impala.colors.text2, fontSize = TextSize.sm, fontWeight = FontWeight.SemiBold)
                Text("$count", Modifier.clip(CircleShape).background(ShelfColors.tint2).padding(horizontal = 7.dp, vertical = 1.dp), color = if (active) ShelfColors.ink else Impala.colors.text2, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
            }
        }
    }
}

@Composable
private fun NotionTreeContent(vm: LibraryViewModel, query: String, onOpen: (PageSummary) -> Unit, onOpenRaw: (String) -> Unit, onImportPdf: () -> Unit) {
    val data by vm.notionData.collectAsStateWithLifecycle()
    val smart by vm.smartFilter.collectAsStateWithLifecycle()
    val d = data
    Column(Modifier.fillMaxSize()) {
        LibToolbar(
            vm.mode, { vm.mode = it; vm.setQuery("") }, query, vm::setQuery, "Seiten suchen…",
            left = { LibFilterChips(listOf(Triple("all", "Alle", d?.all ?: 0), Triple("fav", "Favoriten", d?.fav ?: 0), Triple("pdf", "PDFs", d?.pdf ?: 0), Triple("tpl", "Vorlagen", d?.tpl ?: 0)), smart, vm::setSmartFilter) },
            trailing = {
                Row(Modifier.height(36.dp).clip(RoundedCornerShape(11.dp)).background(ShelfColors.tint).clickable(onClick = onImportPdf).padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Icon(painterResource(R.drawable.ic_i_upload), null, Modifier.size(15.dp), tint = ShelfColors.ink)
                    Text("PDF hinzufügen", color = ShelfColors.ink, fontSize = TextSize.sm, fontWeight = FontWeight.SemiBold)
                }
            },
        )
        if (d != null && d.sections.isEmpty()) EmptyState("Keine Seiten für diesen Filter")
        else LazyColumn(Modifier.weight(1f).fillMaxWidth().padding(horizontal = 20.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
            item { Spacer(Modifier.height(4.dp)) }
            items(d?.sections.orEmpty(), key = { it.workspace.id }) { sec ->
                TreeCard(sec.workspace.name, sec.rows.size) {
                    sec.rows.forEach { row -> TreeLine(vm, row, onOpen, onOpenRaw) }
                }
            }
            item { Spacer(Modifier.height(14.dp)) }
        }
    }
}

@Composable
private fun TreeCard(title: String, count: Int, content: @Composable () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(Modifier.padding(horizontal = 2.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.s2)) {
            Text(title, color = ShelfColors.ink, fontSize = 15.5.sp, fontWeight = FontWeight.SemiBold)
            Text("$count", Modifier.clip(CircleShape).background(ShelfColors.tint).padding(horizontal = 8.dp, vertical = 1.dp), color = Impala.colors.text2, fontSize = 11.5.sp, fontWeight = FontWeight.SemiBold)
        }
        Column(Modifier.fillMaxWidth().shadow(2.dp, RoundedCornerShape(16.dp)).clip(RoundedCornerShape(16.dp)).background(ShelfColors.sheet).border(1.dp, ShelfColors.edge, RoundedCornerShape(16.dp)).padding(6.dp)) { content() }
    }
}

@OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
private fun TreeLine(vm: LibraryViewModel, row: TreeRow, onOpen: (PageSummary) -> Unit, onOpenRaw: (String) -> Unit) {
    val p = row.page; val c = Impala.colors; var menu by remember { mutableStateOf(false) }
    Box {
        Row(
            Modifier.fillMaxWidth().heightIn(min = 42.dp).clip(RoundedCornerShape(11.dp))
                .combinedClickable(onClick = { onOpen(p) }, onLongClick = { menu = true })
                .padding(start = (6 + row.depth * 20).dp, end = 10.dp, top = 4.dp, bottom = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Space.s2),
        ) {
            if (row.hasKids) Icon(painterResource(R.drawable.ic_i_chevron_right), null, Modifier.size(20.dp).clickable { vm.toggleTreeOpen(row) }.padding(3.dp).rotate(if (row.collapsed) 0f else 90f), tint = c.text2)
            else Spacer(Modifier.width(20.dp))
            LibGlyph(vm.store, p)
            Text(pageTitle(p), Modifier.weight(1f), color = c.text, fontSize = TextSize.base, fontWeight = if (row.depth == 0) FontWeight.SemiBold else FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (p.favorite) Text("★", color = c.accent, fontSize = TextSize.xs)
            Text(if (p.kind == PageKind.HEFT) "Heft" else if (p.pdfId != null) "PDF" else "Seite", Modifier.clip(CircleShape).background(ShelfColors.tint).padding(horizontal = 9.dp, vertical = 2.dp), color = if (p.kind == PageKind.HEFT) c.accent else c.text2, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
            Text(formatDate(p.updated), color = c.text2, fontSize = TextSize.xs)
        }
        DropdownMenu(menu, { menu = false }) {
            DropdownMenuItem(text = { Text(if (p.pdfId != null) "PDF öffnen" else "Öffnen") }, onClick = { menu = false; onOpen(p) })
            if (p.pdfId != null) DropdownMenuItem(text = { Text("Als Seite öffnen") }, onClick = { menu = false; onOpenRaw(p.id) })
            DropdownMenuItem(text = { Text(if (p.favorite) "Favorit entfernen" else "Zu Favoriten") }, onClick = { menu = false; vm.toggleFavorite(p) })
            DropdownMenuItem(text = { Text("Archivieren") }, onClick = { menu = false; vm.archive(p.id, archived = false) })
            DropdownMenuItem(text = { Text("In Papierkorb", color = c.danger) }, onClick = { menu = false; vm.trash(p.id) })
        }
    }
}

@Composable
private fun LibGlyph(store: ImpalaStore, p: PageSummary) {
    val img = p.coverImg; val emoji = ownEmoji(p)
    Box(Modifier.size(28.dp).clip(RoundedCornerShape(9.dp)).background(ShelfColors.tint), contentAlignment = Alignment.Center) {
        when {
            img != null -> CoverImage(store, img, Modifier.fillMaxSize())
            emoji != null -> Text(emoji, fontSize = 14.sp)
            else -> Icon(painterResource(pageIconRes(p)), null, Modifier.size(15.dp), tint = if (p.kind == PageKind.HEFT) Impala.colors.accent else Impala.colors.text2)
        }
    }
}

@Composable
private fun ArchiveListContent(vm: LibraryViewModel, query: String, onOpen: (PageSummary) -> Unit) {
    val all by vm.archived.collectAsStateWithLifecycle()
    val list = all.orEmpty()
    val shown = list.filter { p -> (vm.archiveFilter == "all" || (vm.archiveFilter == "heft") == (p.kind == PageKind.HEFT)) && libMatches(p, query) }
    Column(Modifier.fillMaxSize()) {
        LibToolbar(vm.mode, { vm.mode = it; vm.setQuery("") }, query, vm::setQuery, "Archiv durchsuchen…",
            left = { LibFilterChips(listOf(Triple("all", "Alle", list.size), Triple("page", "Seiten", list.count { it.kind != PageKind.HEFT }), Triple("heft", "Hefte", list.count { it.kind == PageKind.HEFT })), vm.archiveFilter) { vm.archiveFilter = it } })
        if (all != null && shown.isEmpty()) EmptyState(if (list.isEmpty()) "Archiv ist leer" else "Nichts gefunden")
        else LazyColumn(Modifier.weight(1f).fillMaxWidth().padding(horizontal = 20.dp)) {
            item { Spacer(Modifier.height(14.dp)) }
            item {
                TreeCard("Archiv", shown.size) {
                    shown.forEach { p ->
                        Row(Modifier.fillMaxWidth().heightIn(min = 46.dp).clickable { onOpen(p) }.padding(horizontal = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.s2)) {
                            LibGlyph(vm.store, p)
                            Text(pageTitle(p), Modifier.weight(1f), color = Impala.colors.text, fontSize = TextSize.base, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text(formatDate(p.updated), color = Impala.colors.text2, fontSize = TextSize.xs)
                            Row(Modifier.height(30.dp).clip(CircleShape).background(ShelfColors.tint).clickable { vm.archive(p.id, archived = true) }.padding(horizontal = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                                Icon(painterResource(R.drawable.ic_i_undo), null, Modifier.size(13.dp), tint = ShelfColors.ink)
                                Text("Aus Archiv holen", color = ShelfColors.ink, fontSize = TextSize.xs, fontWeight = FontWeight.Medium)
                            }
                        }
                    }
                }
            }
            item { Spacer(Modifier.height(14.dp)) }
        }
    }
}
