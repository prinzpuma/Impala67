package org.impala67.app.notes

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LoadingIndicator
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import org.impala67.app.R
import org.impala67.app.core.ImpalaStore
import org.impala67.app.ui.components.TintButton
import org.impala67.app.ui.components.TintLabel
import org.impala67.app.ui.theme.Impala
import org.impala67.app.ui.theme.Radius
import org.impala67.app.ui.theme.Space
import uniffi.impala_ffi.PageSummary

/**
 * Notizen-Liste (web/mobile-notes.js): Arbeitsbereiche, Suche, Favoriten, zuletzt bearbeitet und der
 * Seitenbaum als Drill-down. Die Shell verdrahtet [onOpenPage] (Seite öffnen) und [onNewPage]
 * (Neue Seite; `parentId` = `null` für die Wurzel).
 */
@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun NotesScreen(
    store: ImpalaStore,
    onOpenPage: (String) -> Unit,
    onNewPage: (parentId: String?) -> Unit,
    modifier: Modifier = Modifier,
) {
    val vm: NotesViewModel = viewModel { NotesViewModel(store) }
    val state by vm.state.collectAsStateWithLifecycle()
    val query by vm.query.collectAsStateWithLifecycle()
    var renaming by remember { mutableStateOf<PageSummary?>(null) }

    // Eine Ebene zurück, bevor die Shell die Zurück-Geste bekommt (wie `notesGoUp` in mobile.js).
    BackHandler(enabled = state?.parent != null) { vm.goUp() }

    val s = state
    if (s == null) {
        Box(modifier.fillMaxSize(), contentAlignment = Alignment.Center) { LoadingIndicator() }
        return
    }
    val actions = NoteActions(
        open = onOpenPage,
        drill = vm::enter,
        addChild = { vm.createChild(it.id, onOpenPage) },
        rename = { renaming = it },
        favorite = vm::toggleFavorite,
        archive = vm::archive,
        trash = vm::trash,
    )
    val searching = query.isNotBlank()

    Box(modifier.fillMaxSize().background(Impala.colors.panel), contentAlignment = Alignment.TopCenter) {
        Column(Modifier.widthIn(max = 720.dp).fillMaxSize().padding(horizontal = Space.s4)) {
            if (s.workspaces.size > 1) {
                LazyRow(
                    horizontalArrangement = Arrangement.spacedBy(Space.s2),
                    contentPadding = PaddingValues(top = Space.s2),
                ) {
                    items(s.workspaces, key = { it.id }) { ws ->
                        FilterChip(
                            selected = ws.id == s.workspaceId,
                            onClick = { vm.selectWorkspace(ws.id) },
                            label = { Text(ws.name, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                        )
                    }
                }
            }
            OutlinedTextField(
                value = query,
                onValueChange = vm::setQuery,
                modifier = Modifier.fillMaxWidth().padding(vertical = Space.s2),
                placeholder = { Text("Notizen durchsuchen") },
                singleLine = true,
                shape = RoundedCornerShape(Radius.lg),
                leadingIcon = { Icon(painterResource(R.drawable.ic_i_search), null, Modifier.size(18.dp)) },
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
            )

            LazyColumn(Modifier.fillMaxWidth().weight(1f), contentPadding = PaddingValues(bottom = 48.dp)) {
                when {
                    searching -> {
                        if (s.hits.isEmpty()) {
                            item { EmptyState("Keine Treffer", "Für „${query.trim()}“ wurde nichts gefunden.") }
                        } else {
                            item { NoteGroup(s.hits, actions) }
                        }
                    }
                    s.parent != null -> {
                        val parent = s.parent
                        item { Crumb(parent, onUp = vm::goUp, onAddChild = { onNewPage(parent.id) }) }
                        if (s.level.isEmpty()) {
                            item { EmptyState("Noch keine Unterseiten") }
                        } else {
                            item { NoteGroup(s.level, actions) }
                        }
                    }
                    !s.hasPages -> item {
                        EmptyState("Noch keine Notizen", action = {
                            TintButton(onClick = { onNewPage(null) }, strong = false) { TintLabel("Erste Notiz anlegen", strong = false) }
                        })
                    }
                    else -> {
                        if (s.favorites.isNotEmpty()) {
                            item { SectionLabel("Favoriten") }
                            item { NoteGroup(s.favorites, actions) }
                        }
                        if (s.recent.isNotEmpty()) {
                            item { SectionLabel("Zuletzt bearbeitet") }
                            item { NoteGroup(s.recent, actions) }
                        }
                        if (s.level.isNotEmpty()) {
                            item { SectionLabel("Alle Notizen") }
                            item { NoteGroup(s.level, actions) }
                        }
                    }
                }
            }
        }
    }

    renaming?.let { page ->
        RenameDialog(
            page = page,
            onDismiss = { renaming = null },
            onConfirm = { title ->
                vm.rename(page, title)
                renaming = null
            },
        )
    }
}

/** Gruppe aus Notizzeilen mit Trennlinien ab dem Text. */
@Composable
private fun NoteGroup(rows: List<NoteRow>, actions: NoteActions) {
    RowGroup {
        rows.forEachIndexed { index, row ->
            if (index > 0) RowDivider(inset = 60.dp)
            NoteRowItem(row, actions)
        }
    }
}

/** Kopfzeile der Ebene (`.m-notes-crumb`): Zurück, Titel der Seite und „＋ Unterseite“. */
@Composable
private fun Crumb(parent: PageSummary, onUp: () -> Unit, onAddChild: () -> Unit) {
    val c = Impala.colors
    Row(
        Modifier.fillMaxWidth().padding(top = Space.s2, bottom = Space.s1),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Space.s2),
    ) {
        IconButton(onClick = onUp) {
            Icon(painterResource(R.drawable.ic_i_chevron_left), "Zurück", Modifier.size(20.dp), tint = c.text)
        }
        Text(
            pageTitle(parent), Modifier.weight(1f), color = c.text, fontSize = 20.sp, fontWeight = FontWeight.Bold,
            maxLines = 1, overflow = TextOverflow.Ellipsis,
        )
        TintButton(onClick = onAddChild, strong = false) { TintLabel("＋ Unterseite", strong = false) }
    }
}
