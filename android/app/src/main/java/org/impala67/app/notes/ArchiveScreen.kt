package org.impala67.app.notes

import android.util.Log
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LoadingIndicator
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import org.impala67.app.R
import org.impala67.app.core.ImpalaStore
import org.impala67.app.core.Touches
import org.impala67.app.ui.theme.Impala
import org.impala67.app.ui.theme.Space
import uniffi.impala_ffi.PageKind
import uniffi.impala_ffi.PageSummary

/** Archivierte Seiten und Hefte lesen, zurückholen oder in den Papierkorb legen. */
class ArchiveViewModel(private val store: ImpalaStore) : ViewModel() {
    val pages: StateFlow<List<PageSummary>?> = store.query(Touches.pages) { it.archivedPages() }

    fun restore(id: String) = write { store.write { it.unarchivePage(id) } }

    fun trash(id: String) = write { store.write { it.trashPage(id) } }

    private fun write(block: suspend () -> Unit) = viewModelScope.launch {
        runCatching { block() }.onFailure { Log.w(TAG, "Archiv-Aktion fehlgeschlagen", it) }
    }

    private companion object {
        const val TAG = "ArchiveViewModel"
    }
}

/** Filter des Archivs: alle Einträge, nur Hefte oder nur Seiten (`libArchiveType` der PWA). */
private enum class ArchiveFilter(val label: String) { ALL("Alle"), HEFTE("Hefte"), SEITEN("Seiten") }

private fun PageSummary.matches(filter: ArchiveFilter) = when (filter) {
    ArchiveFilter.ALL -> true
    ArchiveFilter.HEFTE -> kind == PageKind.HEFT
    ArchiveFilter.SEITEN -> kind != PageKind.HEFT
}

/**
 * Archiv: Hefte und Seiten, die aus der Bibliothek ausgeblendet sind. Zurückholen oder in den
 * Papierkorb legen. Die Liste ist flach; die Baumansicht der PWA folgt mit der Bibliothek.
 */
@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun ArchiveScreen(store: ImpalaStore, onOpenPage: (String) -> Unit, modifier: Modifier = Modifier) {
    val vm: ArchiveViewModel = viewModel { ArchiveViewModel(store) }
    val pages by vm.pages.collectAsStateWithLifecycle()
    var filter by rememberSaveable { mutableStateOf(ArchiveFilter.ALL) }
    val c = Impala.colors

    Box(modifier.fillMaxSize().background(c.panel), contentAlignment = Alignment.TopCenter) {
        val list = pages
        if (list == null) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { LoadingIndicator() }
            return@Box
        }
        val shown = list.filter { it.matches(filter) }
        LazyColumn(
            Modifier.widthIn(max = 720.dp).fillMaxSize().padding(horizontal = Space.s4),
            contentPadding = PaddingValues(bottom = 48.dp),
        ) {
            item {
                LazyRow(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(Space.s2),
                    contentPadding = PaddingValues(top = Space.s4, bottom = Space.s2),
                ) {
                    items(ArchiveFilter.entries) { option ->
                        FilterChip(
                            selected = filter == option,
                            onClick = { filter = option },
                            label = { Text(option.label) },
                        )
                    }
                }
            }
            when {
                list.isEmpty() -> item {
                    EmptyState(
                        "Das Archiv ist leer.",
                        "Archivierte Hefte und Seiten erscheinen hier und können jederzeit wiederhergestellt werden.",
                    )
                }
                shown.isEmpty() -> item { EmptyState("Keine Einträge in dieser Ansicht.") }
                else -> item {
                    RowGroup {
                        shown.forEachIndexed { index, page ->
                            if (index > 0) RowDivider(inset = 60.dp)
                            ArchiveRow(
                                page,
                                onOpen = { onOpenPage(page.id) },
                                onRestore = { vm.restore(page.id) },
                                onTrash = { vm.trash(page.id) },
                            )
                        }
                    }
                }
            }
        }
    }
}

/** Zeile im Archiv: Titel, „Heft/Seite · archiviert …“, Zurückholen und Papierkorb-Symbol. */
@Composable
private fun ArchiveRow(page: PageSummary, onOpen: () -> Unit, onRestore: () -> Unit, onTrash: () -> Unit) {
    val c = Impala.colors
    Row(
        Modifier.fillMaxWidth().padding(start = 14.dp, end = 6.dp, top = 6.dp, bottom = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Space.s3),
    ) {
        PageGlyph(page)
        Column(Modifier.weight(1f).clickable(onClick = onOpen)) {
            Text(
                pageTitle(page), color = c.text, fontSize = 15.sp, fontWeight = FontWeight.SemiBold,
                maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
            MetaText((if (page.kind == PageKind.HEFT) "Heft" else "Seite") + " · archiviert " + formatDate(page.updated))
        }
        TextButton(onClick = onRestore) { Text("Wiederherstellen", color = c.text, fontSize = 13.sp) }
        IconButton(onClick = onTrash, modifier = Modifier.size(40.dp)) {
            Icon(painterResource(R.drawable.ic_i_trash), "In Papierkorb", Modifier.size(18.dp), tint = c.danger)
        }
    }
}
