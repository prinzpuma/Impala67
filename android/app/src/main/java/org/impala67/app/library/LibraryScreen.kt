package org.impala67.app.library

import android.util.Log
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
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
import org.impala67.app.ui.theme.Space
import uniffi.impala_ffi.PageSummary

private const val TAG = "LibraryScreen"

/**
 * Bibliothek („PDFs & Dokumente“ in der PWA): Seiten mit PDF, neueste zuerst. Antippen öffnet das PDF
 * in einer externen App; ⋯ (langes Drücken) „Als Seite öffnen“. „PDF hinzufügen“ legt eine Seite mit
 * dem PDF an und öffnet sie.
 */
@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun LibraryScreen(
    store: ImpalaStore,
    onOpenPage: (String) -> Unit,
    onToast: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val vm: LibraryViewModel = viewModel { LibraryViewModel(store) }
    val pages by vm.pages.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val c = Impala.colors
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
        if (pdfId != null) scope.launch {
            val file = runCatching { cachePdf(context, store, pdfId, pageTitle(page)) }
                .onFailure { Log.w(TAG, "PDF konnte nicht gelesen werden", it) }
                .getOrNull()
            if (file == null) {
                onToast("PDF wird geladen…")
            } else if (!openPdfExternally(context, file)) {
                onToast("Keine App zum Öffnen von PDFs gefunden.")
            }
        }
    }

    Box(modifier.fillMaxSize().background(c.panel), contentAlignment = Alignment.TopCenter) {
        val list = pages
        if (list == null) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { LoadingIndicator() }
            return@Box
        }
        LazyColumn(Modifier.widthIn(max = 720.dp).fillMaxSize().padding(horizontal = Space.s4)) {
            item { LibraryHeader(onAdd = { pickPdf.launch(arrayOf("application/pdf")) }) }
            if (list.isEmpty()) {
                item { EmptyState("Keine Seiten für diesen Filter") }
            } else {
                item {
                    RowGroup {
                        list.forEachIndexed { index, page ->
                            if (index > 0) RowDivider(inset = 14.dp)
                            LibraryRow(
                                page = page,
                                onOpen = { openPdf(page) },
                                onOpenPage = { onOpenPage(page.id) },
                            )
                        }
                    }
                }
            }
        }
    }
}

/** Kopfzeile: Titel und Untertitel aus dem Mehr-Menü der PWA, daneben „PDF hinzufügen“. */
@Composable
private fun LibraryHeader(onAdd: () -> Unit) {
    val c = Impala.colors
    Row(
        Modifier.fillMaxWidth().padding(top = Space.s4, bottom = Space.s2),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Space.s3),
    ) {
        Column(Modifier.weight(1f)) {
            Text("Bibliothek", color = c.text, fontSize = 22.sp, fontWeight = FontWeight.Bold)
            Text("PDFs & Dokumente", color = c.text2, fontSize = 13.sp)
        }
        TextButton(onClick = onAdd) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.s1)) {
                Icon(painterResource(R.drawable.ic_i_plus), null, Modifier.size(16.dp), tint = c.accent)
                Text("PDF hinzufügen", color = c.accent, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
            }
        }
    }
}

/** Zeile: Symbol, Titel und Änderungsdatum. Antippen öffnet das PDF, langes Drücken das Menü mit „Als Seite öffnen“. */
@Composable
private fun LibraryRow(page: PageSummary, onOpen: () -> Unit, onOpenPage: () -> Unit) {
    val c = Impala.colors
    var menuOpen by remember { mutableStateOf(false) }
    Box {
        Row(
            Modifier
                .fillMaxWidth()
                .combinedClickable(onClick = onOpen, onLongClick = { menuOpen = true })
                .padding(horizontal = 14.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Space.s3),
        ) {
            PageGlyph(page)
            Column(Modifier.weight(1f)) {
                Text(
                    pageTitle(page), color = c.text, fontSize = 15.sp, fontWeight = FontWeight.SemiBold,
                    maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
                MetaText(formatDate(page.updated))
            }
        }
        DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
            DropdownMenuItem(
                text = { Text("Als Seite öffnen") },
                onClick = { menuOpen = false; onOpenPage() },
            )
        }
    }
}
