package org.impala67.app.library

import android.util.Log
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.Icon
import androidx.compose.material3.LoadingIndicator
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.launch
import org.impala67.app.R
import org.impala67.app.core.ImpalaStore
import org.impala67.app.notes.EmptyState
import org.impala67.app.notes.MetaText
import org.impala67.app.notes.PageGlyph
import org.impala67.app.notes.RowDivider
import org.impala67.app.notes.RowGroup
import org.impala67.app.notes.formatDate
import org.impala67.app.notes.pageTitle
import org.impala67.app.ui.theme.Impala
import org.impala67.app.ui.theme.Radius
import org.impala67.app.ui.theme.Space
import org.impala67.app.ui.theme.TextSize
import uniffi.impala_ffi.HeftFolder
import uniffi.impala_ffi.PageSummary

private const val TAG = "LibraryScreen"

/**
 * Bibliothek (web/library.js): „Dokumente“ (Seiten mit PDF; Antippen öffnet die PDF-Ansicht) und „Hefte“
 * als Regal mit Ordnern, Neu-Dialog, Heftoptionen (Cover, Archiv, Papierkorb) und Favoriten-Stern.
 */
@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun LibraryScreen(
    store: ImpalaStore,
    onOpenPage: (String) -> Unit,
    onToast: (String) -> Unit,
    modifier: Modifier = Modifier,
    onOpenPdf: ((fileId: String, title: String) -> Unit)? = null,
) {
    val vm: LibraryViewModel = viewModel { LibraryViewModel(store) }
    val pages by vm.pages.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val c = Impala.colors
    var dialog by remember { mutableStateOf<String?>(null) }
    val pickPdf = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            val id = runCatching {
                val picked = readPickedPdf(context, uri)
                vm.importPdf(picked.name, picked.bytes)
            }.onFailure { Log.w(TAG, "PDF-Import fehlgeschlagen", it) }.getOrNull()
            if (id != null) onOpenPage(id) else onToast("PDF-Datei konnte nicht geladen werden.")
        }
    }
    val openPdf: (PageSummary) -> Unit = { page ->
        val pdfId = page.pdfId
        if (pdfId != null) {
            if (onOpenPdf != null) onOpenPdf(pdfId, pageTitle(page)) else scope.launch {
                val file = runCatching { cachePdf(context, store, pdfId, pageTitle(page)) }.getOrNull()
                if (file == null) onToast("PDF nicht gefunden") else if (!openPdfExternally(context, file)) onToast("Keine App zum Öffnen von PDFs gefunden.")
            }
        }
    }

    Box(modifier.fillMaxSize().background(c.panel), contentAlignment = Alignment.TopCenter) {
        LazyColumn(Modifier.widthIn(max = 900.dp).fillMaxSize().padding(horizontal = Space.s4)) {
            item {
                LibraryHeader(vm.heftMode, onAdd = { if (vm.heftMode) dialog = "new" else pickPdf.launch(arrayOf("application/pdf")) })
                Row(Modifier.padding(bottom = Space.s3), horizontalArrangement = Arrangement.spacedBy(Space.s2)) {
                    Chip("Dokumente", !vm.heftMode) { vm.heftMode = false }
                    Chip("Hefte", vm.heftMode) { vm.heftMode = true }
                }
            }
            if (vm.heftMode) {
                item { HeftShelf(vm, onOpenPage, onNewFolder = { dialog = "folder" }) }
            } else {
                val list = pages
                when {
                    list == null -> item { Box(Modifier.fillMaxWidth().padding(Space.s6), contentAlignment = Alignment.Center) { LoadingIndicator() } }
                    list.isEmpty() -> item { EmptyState("Keine Seiten für diesen Filter") }
                    else -> item {
                        RowGroup {
                            list.forEachIndexed { index, page ->
                                if (index > 0) RowDivider(inset = 14.dp)
                                LibraryRow(page, onOpen = { openPdf(page) }, onOpenPage = { onOpenPage(page.id) }, onFavorite = { vm.toggleFavorite(page) })
                            }
                        }
                    }
                }
            }
        }
    }
    when (dialog) {
        "new" -> NewChoiceDialog({ dialog = null }, onHeft = { dialog = "heft" }, onFolder = { dialog = "folder" })
        "folder" -> NewFolderDialog({ dialog = null }) { vm.createFolder(it); dialog = null }
        "heft" -> NewHeftDialog({ dialog = null }) { title, cover ->
            dialog = null
            scope.launch { runCatching { vm.createHeft(title, cover) }.onSuccess(onOpenPage) }
        }
    }
}

@Composable
private fun Chip(label: String, active: Boolean, onClick: () -> Unit) {
    val c = Impala.colors
    Text(
        label,
        Modifier.clip(CircleShape).background(if (active) c.tint2 else c.surface).clickable(onClick = onClick).padding(horizontal = Space.s3, vertical = Space.s1),
        color = if (active) c.text else c.text2, fontSize = TextSize.sm,
    )
}

/** Kopfzeile: Titel und Untertitel, daneben „PDF hinzufügen“ bzw. „+ Neu“. */
@Composable
private fun LibraryHeader(hefte: Boolean, onAdd: () -> Unit) {
    val c = Impala.colors
    Row(Modifier.fillMaxWidth().padding(top = Space.s4, bottom = Space.s2), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.s3)) {
        Column(Modifier.weight(1f)) {
            Text("Bibliothek", color = c.text, fontSize = 22.sp, fontWeight = FontWeight.Bold)
            Text(if (hefte) "Hefte & Ordner" else "PDFs & Dokumente", color = c.text2, fontSize = 13.sp)
        }
        TextButton(onClick = onAdd) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.s1)) {
                Icon(painterResource(R.drawable.ic_i_plus), null, Modifier.size(16.dp), tint = c.accent)
                Text(if (hefte) "Neu" else "PDF hinzufügen", color = c.accent, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
            }
        }
    }
}

/** Zeile: Symbol, Titel, Änderungsdatum und Stern. Antippen öffnet das PDF, langes Drücken „Als Seite öffnen“. */
@Composable
private fun LibraryRow(page: PageSummary, onOpen: () -> Unit, onOpenPage: () -> Unit, onFavorite: () -> Unit) {
    val c = Impala.colors
    var menuOpen by remember { mutableStateOf(false) }
    Box {
        Row(
            Modifier.fillMaxWidth().combinedClickable(onClick = onOpen, onLongClick = { menuOpen = true }).padding(horizontal = 14.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Space.s3),
        ) {
            PageGlyph(page)
            Column(Modifier.weight(1f)) {
                Text(pageTitle(page), color = c.text, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                MetaText(formatDate(page.updated) + " · PDF")
            }
            Text(if (page.favorite) "★" else "☆", Modifier.clip(CircleShape).clickable(onClick = onFavorite).padding(6.dp), color = if (page.favorite) c.accent else c.text2)
        }
        DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
            DropdownMenuItem(text = { Text("Als Seite öffnen") }, onClick = { menuOpen = false; onOpenPage() })
        }
    }
}

/** Heft-Regal (GoodNotes-Ansicht): Brotkrumen, Ordner, Hefte als Notizbücher. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun HeftShelf(vm: LibraryViewModel, onOpenPage: (String) -> Unit, onNewFolder: () -> Unit) {
    val c = Impala.colors
    val shelf by vm.shelf.collectAsStateWithLifecycle()
    val s = shelf ?: return
    var folderMenu by remember { mutableStateOf<HeftFolder?>(null) }
    var options by remember { mutableStateOf<PageSummary?>(null) }
    Row(Modifier.padding(bottom = Space.s3), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.s1)) {
        Text("Dokumente", Modifier.clickable { vm.openFolder(null) }, color = if (s.path.isEmpty()) c.text else c.accent, fontSize = TextSize.sm)
        s.path.forEach { f -> Text(" › ", color = c.text2); Text(f.title, Modifier.clickable { vm.openFolder(f.id) }, color = c.text, fontSize = TextSize.sm) }
        Text("  + Neu", Modifier.clickable(onClick = onNewFolder), color = c.accent, fontSize = TextSize.sm)
    }
    if (s.folders.isEmpty() && s.hefte.isEmpty()) EmptyState("Noch keine Hefte in diesem Ordner")
    FlowRow(horizontalArrangement = Arrangement.spacedBy(Space.s4), verticalArrangement = Arrangement.spacedBy(Space.s4)) {
        s.folders.forEach { (f, n) ->
            Column(Modifier.width(120.dp).combinedClickable(onClick = { vm.openFolder(f.id) }, onLongClick = { folderMenu = f })) {
                Box(Modifier.fillMaxWidth().aspectRatio(1.2f).clip(RoundedCornerShape(Radius.md)).background(c.tint2), contentAlignment = Alignment.Center) {
                    Icon(painterResource(R.drawable.ic_i_folder), null, Modifier.size(36.dp), tint = c.accent)
                }
                Text(f.title, color = c.text, fontSize = TextSize.sm, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Row {
                    Text("$n " + if (n == 1) "Objekt" else "Objekte", Modifier.weight(1f), color = c.text2, fontSize = TextSize.xs2)
                    Text("•••", Modifier.clickable { folderMenu = f }, color = c.text2, fontSize = TextSize.xs)
                }
            }
        }
        s.hefte.forEach { p ->
            Column(Modifier.width(120.dp).clickable { onOpenPage(p.id) }) {
                Box(Modifier.fillMaxWidth().aspectRatio(0.75f)) {
                    val (a, b) = (COVER_PRESETS.firstOrNull { it.first == p.cover.ifEmpty { defaultCover(p) } } ?: COVER_PRESETS[0]).second
                    Box(Modifier.fillMaxSize().clip(RoundedCornerShape(topEnd = Radius.md, bottomEnd = Radius.md, topStart = 4.dp, bottomStart = 4.dp)).background(Brush.linearGradient(listOf(Color(a), Color(b)))).padding(Space.s2)) {
                        Text(pageTitle(p).take(28), Modifier.align(Alignment.BottomStart), color = Color.White, fontSize = TextSize.xs, fontWeight = FontWeight.SemiBold)
                    }
                    if (p.favorite) Text("★", Modifier.align(Alignment.TopStart).padding(6.dp), color = Color.White)
                    Text("•••", Modifier.align(Alignment.TopEnd).clip(CircleShape).clickable { options = p }.padding(6.dp), color = Color.White, fontSize = TextSize.xs)
                }
                Text(pageTitle(p), color = c.text, fontSize = TextSize.sm, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text("Heft · " + formatDate(p.updated), color = c.text2, fontSize = TextSize.xs2)
            }
        }
    }
    folderMenu?.let { f -> FolderDialog(f, { folderMenu = null }) { vm.deleteFolder(f.id); folderMenu = null } }
    options?.let { p -> HeftOptionsDialog(p, vm) { options = null } }
}
