package org.impala67.app.notes

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.LoadingIndicator
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import android.util.Log
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import org.impala67.app.core.ImpalaStore
import org.impala67.app.core.Touches
import org.impala67.app.ui.theme.Impala
import org.impala67.app.ui.theme.Space
import uniffi.impala_ffi.PageSummary

/** Papierkorb-Seiten lesen, wiederherstellen und endgültig löschen (in der PWA: Ansicht „Papierkorb“). */
class TrashViewModel(private val store: ImpalaStore) : ViewModel() {
    val pages: StateFlow<List<PageSummary>?> = store.query(Touches.pages) { it.trashedPages() }

    fun restore(id: String) = write { store.write { it.restorePage(id) } }

    fun deleteForever(id: String) = write { store.write { it.deletePageForever(id) } }

    fun emptyTrash() = write { store.write { it.emptyPageTrash() } }

    private fun write(block: suspend () -> Unit) = viewModelScope.launch {
        runCatching { block() }.onFailure { Log.w(TAG, "Papierkorb-Aktion fehlgeschlagen", it) }
    }

    private companion object {
        const val TAG = "TrashViewModel"
    }
}

/**
 * Papierkorb: Seiten wiederherstellen oder endgültig löschen (mit Bestätigung), den ganzen Papierkorb
 * leeren. Stapel und Karten bleiben im Karten-Bereich (noch nicht portiert). Gelöschte Seiten lassen
 * sich nicht öffnen (wie in der PWA), daher nutzt der Bildschirm [onOpenPage] derzeit nicht.
 */
@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Suppress("UNUSED_PARAMETER")
@Composable
fun TrashScreen(store: ImpalaStore, onOpenPage: (String) -> Unit, modifier: Modifier = Modifier) {
    val vm: TrashViewModel = viewModel { TrashViewModel(store) }
    val pages by vm.pages.collectAsStateWithLifecycle()
    var purging by remember { mutableStateOf<PageSummary?>(null) }
    var confirmEmpty by remember { mutableStateOf(false) }
    val c = Impala.colors

    Box(modifier.fillMaxSize().background(c.panel), contentAlignment = Alignment.TopCenter) {
        val list = pages
        if (list == null) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { LoadingIndicator() }
            return@Box
        }
        LazyColumn(Modifier.widthIn(max = 720.dp).fillMaxSize().padding(horizontal = Space.s4)) {
            item {
                Row(
                    Modifier.fillMaxWidth().padding(top = Space.s4, bottom = Space.s2),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(Space.s3),
                ) {
                    Text(
                        "Seiten – wiederherstellbar, bis du sie endgültig löschst.",
                        Modifier.weight(1f), color = c.text2, fontSize = 13.sp,
                    )
                    if (list.isNotEmpty()) {
                        TextButton(onClick = { confirmEmpty = true }) {
                            Text("Papierkorb leeren", color = c.danger, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                        }
                    }
                }
            }
            if (list.isEmpty()) {
                item { EmptyState("Der Papierkorb ist leer.") }
            } else {
                item {
                    RowGroup {
                        list.forEachIndexed { index, page ->
                            if (index > 0) RowDivider(inset = 14.dp)
                            TrashRow(
                                page = page,
                                onRestore = { vm.restore(page.id) },
                                onPurge = { purging = page },
                            )
                        }
                    }
                }
            }
        }
    }

    purging?.let { page ->
        ConfirmDialog(
            title = "Endgültig löschen",
            text = "„${pageTitle(page)}“ endgültig löschen? Das kann nicht rückgängig gemacht werden.",
            confirmLabel = "Löschen",
            onConfirm = {
                vm.deleteForever(page.id)
                purging = null
            },
            onDismiss = { purging = null },
        )
    }
    if (confirmEmpty) {
        val count = pages?.size ?: 0
        ConfirmDialog(
            title = "Papierkorb leeren",
            text = "Alle $count Seiten im Papierkorb endgültig löschen? Das kann nicht rückgängig gemacht werden.",
            confirmLabel = "Endgültig löschen",
            onConfirm = {
                vm.emptyTrash()
                confirmEmpty = false
            },
            onDismiss = { confirmEmpty = false },
        )
    }
}

/** Zeile im Papierkorb: Titel mit Datum, darunter „Wiederherstellen“ und „Endgültig löschen“. */
@Composable
private fun TrashRow(page: PageSummary, onRestore: () -> Unit, onPurge: () -> Unit) {
    val c = Impala.colors
    Column(Modifier.fillMaxWidth().padding(start = 14.dp, end = 6.dp, top = 10.dp, bottom = 6.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.s3)) {
            PageGlyph(page)
            Column(Modifier.weight(1f)) {
                Text(
                    pageTitle(page), color = c.text, fontSize = 15.sp, fontWeight = FontWeight.SemiBold,
                    maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
                MetaText("gelöscht " + formatDate(page.updated))
            }
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
            TextButton(onClick = onRestore) { Text("Wiederherstellen", color = c.text, fontSize = 13.sp) }
            TextButton(onClick = onPurge) { Text("Endgültig löschen", color = c.danger, fontSize = 13.sp) }
        }
    }
}
