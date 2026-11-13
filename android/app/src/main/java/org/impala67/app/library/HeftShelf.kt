package org.impala67.app.library

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.launch
import org.impala67.app.R
import org.impala67.app.core.ImpalaStore
import org.impala67.app.notes.formatDate
import org.impala67.app.notes.pageTitle
import org.impala67.app.ui.theme.Impala
import org.impala67.app.ui.theme.Space
import org.impala67.app.ui.theme.TextSize
import uniffi.impala_ffi.HeftFolder
import uniffi.impala_ffi.PageSummary

/** GoodNotes-Regal mit Holzbrettern, Mappen, Covern, Deko und Pfad-Brotkrumen (`HeftShelf.swift`). */
@Composable
fun HeftShelfContent(
    vm: LibraryViewModel,
    query: String,
    onQueryChange: (String) -> Unit,
    onOpenPage: (String) -> Unit,
) {
    val shelf by vm.shelf.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    var newChoiceOpen by remember { mutableStateOf(false) }
    var newHeftOpen by remember { mutableStateOf(false) }
    var newFolderOpen by remember { mutableStateOf(false) }
    var folderMenu by remember { mutableStateOf<HeftFolder?>(null) }
    var options by remember { mutableStateOf<PageSummary?>(null) }
    val s = shelf

    Column(Modifier.fillMaxSize()) {
        LibToolbar(
            mode = vm.mode,
            onModeChange = { vm.mode = it; vm.openFolder(null); onQueryChange("") },
            query = query,
            onQueryChange = onQueryChange,
            prompt = "Hefte suchen",
            left = { ShelfCrumbs(query, s?.path.orEmpty(), vm.folder.collectAsStateWithLifecycle().value, vm::openFolder) },
            trailing = {
                Box {
                    Row(
                        Modifier.shadow(2.dp, RoundedCornerShape(11.dp)).clip(RoundedCornerShape(11.dp))
                            .background(ShelfColors.button).clickable { newChoiceOpen = true }
                            .padding(start = 12.dp, end = 16.dp).height(36.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Icon(painterResource(R.drawable.ic_i_plus), null, Modifier.size(15.dp), tint = Color(0xFFFFFAF2))
                        Text("Neu", color = Color(0xFFFFFAF2), fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                    }
                    DropdownMenu(expanded = newChoiceOpen, onDismissRequest = { newChoiceOpen = false }) {
                        DropdownMenuItem(
                            text = { Text("Neues Heft") },
                            leadingIcon = { Icon(painterResource(R.drawable.ic_i_notebook), null, Modifier.size(16.dp)) },
                            onClick = { newChoiceOpen = false; newHeftOpen = true },
                        )
                        DropdownMenuItem(
                            text = { Text("Neuer Ordner") },
                            leadingIcon = { Icon(painterResource(R.drawable.ic_i_folder), null, Modifier.size(16.dp)) },
                            onClick = { newChoiceOpen = false; newFolderOpen = true },
                        )
                    }
                }
            },
        )
        BoxWithConstraints(Modifier.weight(1f).fillMaxWidth()) {
            val pad = if (maxWidth < 640.dp) 14.dp else 26.dp
            val m = remember(maxWidth, pad) { ShelfMetrics((maxWidth - pad * 2).value) }
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = pad).padding(top = 18.dp, bottom = 26.dp)) {
                if (s != null) {
                    if (s.entries.isEmpty()) {
                        EmptyShelf(query.isNotEmpty(), vm.folder.collectAsStateWithLifecycle().value != null, s.total == 0) { newHeftOpen = true }
                    } else {
                        val rows = s.entries.chunked(m.columns)
                        val books = s.entries.size % 2 == 0
                        val decoFits = rows.last().size < m.columns
                        Column(verticalArrangement = Arrangement.spacedBy(m.rowGap)) {
                            rows.forEachIndexed { idx, row ->
                                ShelfRow(vm.store, row, m, deco = if (!m.narrow && decoFits && idx == rows.lastIndex) books else null, onOpenFolder = vm::openFolder, onFolderMenu = { folderMenu = it }, onOpenPage = onOpenPage, onOptions = { options = it })
                            }
                            if (!m.narrow && !decoFits) {
                                ShelfRow(vm.store, emptyList(), m, deco = books, onOpenFolder = vm::openFolder, onFolderMenu = { folderMenu = it }, onOpenPage = onOpenPage, onOptions = { options = it })
                            }
                        }
                    }
                }
            }
        }
    }

    if (newFolderOpen) NewFolderDialog({ newFolderOpen = false }) { vm.createFolder(it); newFolderOpen = false }
    if (newHeftOpen) NewHeftDialog({ newHeftOpen = false }) { title, cover, imgBytes ->
        newHeftOpen = false
        scope.launch { runCatching { vm.createHeft(title, cover, imgBytes) }.onSuccess(onOpenPage) }
    }
    folderMenu?.let { f -> FolderDialog(f, { folderMenu = null }) { vm.deleteFolder(f.id); folderMenu = null } }
    options?.let { p -> HeftOptionsDialog(p, vm, s?.rootFolders.orEmpty()) { options = null } }
}

@Composable
private fun ShelfCrumbs(query: String, path: List<HeftFolder>, folderId: String?, onSelect: (String?) -> Unit) {
    val c = Impala.colors
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        if (query.isNotBlank()) {
            Text("Suche", color = ShelfColors.ink, fontSize = TextSize.sm, fontWeight = FontWeight.SemiBold)
        } else {
            Text(
                "Dokumente",
                Modifier.clickable { onSelect(null) },
                color = if (path.isEmpty()) ShelfColors.ink else c.text2,
                fontSize = TextSize.sm,
                fontWeight = if (path.isEmpty()) FontWeight.SemiBold else FontWeight.Normal,
            )
            path.forEach { f ->
                Text("/", color = c.text2.copy(alpha = 0.6f), fontSize = TextSize.sm)
                Text(
                    f.title,
                    Modifier.clickable { onSelect(f.id) },
                    color = if (f.id == folderId) ShelfColors.ink else c.text2,
                    fontSize = TextSize.sm,
                    fontWeight = if (f.id == folderId) FontWeight.SemiBold else FontWeight.Normal,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

@Composable
private fun ShelfRow(
    store: ImpalaStore,
    entries: List<ShelfEntry>,
    m: ShelfMetrics,
    deco: Boolean?,
    onOpenFolder: (String?) -> Unit,
    onFolderMenu: (HeftFolder) -> Unit,
    onOpenPage: (String) -> Unit,
    onOptions: (PageSummary) -> Unit,
) {
    Box(Modifier.fillMaxWidth().heightIn(min = m.row - m.rowGap)) {
        ShelfBoard(Modifier.padding(horizontal = (-14).dp).offset(y = m.book))
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(m.gap), verticalAlignment = Alignment.Top) {
            entries.forEach { entry ->
                Box(Modifier.width(m.cell)) {
                    when (entry) {
                        is ShelfEntry.Folder -> FolderCell(entry.folder, entry.count, m, { onOpenFolder(entry.folder.id) }, { onFolderMenu(entry.folder) })
                        is ShelfEntry.Heft -> HeftCell(store, entry.page, entry.pages, m, { onOpenPage(entry.page.id) }, { onOptions(entry.page) })
                    }
                }
            }
            if (deco != null) {
                Spacer(Modifier.weight(1f))
                Box(Modifier.width(m.cell).height(m.book), contentAlignment = Alignment.BottomCenter) {
                    ShelfDeco(books = deco, Modifier.size(width = 92.dp, height = 115.dp))
                }
            }
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun HeftCell(store: ImpalaStore, page: PageSummary, pages: Int, m: ShelfMetrics, onOpen: () -> Unit, onOptions: () -> Unit) {
    val c = Impala.colors
    Column(Modifier.fillMaxWidth().combinedClickable(onClick = onOpen, onLongClick = onOptions)) {
        Box(Modifier.fillMaxWidth().height(m.book)) {
            NotebookCover(store, page, m.book, Modifier.fillMaxWidth())
            if (page.favorite) {
                Text("★", Modifier.align(Alignment.TopEnd).padding(top = 6.dp, end = 10.dp), color = c.warn, fontSize = TextSize.xs)
            }
            Box(
                Modifier.align(Alignment.BottomEnd).padding(6.dp).size(34.dp, 26.dp).clip(RoundedCornerShape(7.dp))
                    .background(Color.Black.copy(alpha = 0.45f)).clickable(onClick = onOptions),
                contentAlignment = Alignment.Center,
            ) { Text("•••", color = Color.White, fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.sp) }
        }
        Text(pageTitle(page), Modifier.padding(top = ShelfColors.ledge + 10.dp), color = ShelfColors.ink, fontSize = TextSize.sm, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
        val n = maxOf(pages, 1)
        Text("Heft · $n Seite${if (n == 1) "" else "n"} · ${formatDate(page.updated)}", color = c.text2, fontSize = TextSize.xs, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun FolderCell(folder: HeftFolder, count: Int, m: ShelfMetrics, onOpen: () -> Unit, onMenu: () -> Unit) {
    val c = Impala.colors
    Column(Modifier.fillMaxWidth().combinedClickable(onClick = onOpen, onLongClick = onMenu)) {
        FolderVisual(folderTone(folder.id.ifEmpty { folder.title }), Modifier.fillMaxWidth().padding(top = m.book - m.folder).height(m.folder))
        Row(Modifier.padding(top = ShelfColors.ledge + 8.dp), verticalAlignment = Alignment.Top) {
            Column(Modifier.weight(1f)) {
                Text(folder.title, color = ShelfColors.ink, fontSize = TextSize.base, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text("$count ${if (count == 1) "Objekt" else "Objekte"}", color = c.text2, fontSize = TextSize.xs)
            }
            Box(Modifier.size(30.dp, 24.dp).clickable(onClick = onMenu), contentAlignment = Alignment.Center) {
                Text("•••", color = c.text2, fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.sp)
            }
        }
    }
}

@Composable
private fun EmptyShelf(searching: Boolean, inFolder: Boolean, emptyAll: Boolean, onCreate: () -> Unit) {
    Column(Modifier.fillMaxWidth().padding(top = 70.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(Space.s4)) {
        Text(
            when {
                searching -> "Keine Treffer"
                inFolder -> "Dieser Ordner ist leer."
                else -> "Noch keine Hefte oder Ordner."
            },
            color = Impala.colors.text2,
            fontSize = TextSize.base,
        )
        if (!searching && emptyAll && !inFolder) {
            Button(onClick = onCreate, colors = ButtonDefaults.buttonColors(containerColor = ShelfColors.button, contentColor = Color(0xFFFFFAF2))) {
                Text("Neues Heft")
            }
        }
        ShelfBoard(Modifier.padding(horizontal = (-14).dp))
    }
}
