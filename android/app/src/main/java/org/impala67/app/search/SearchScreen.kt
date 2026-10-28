package org.impala67.app.search

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.input.rememberTextFieldState
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.SearchBarDefaults
import androidx.compose.material3.SearchBarValue
import androidx.compose.material3.Text
import androidx.compose.material3.rememberSearchBarState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import org.impala67.app.R
import org.impala67.app.core.ImpalaStore
import org.impala67.app.home.HomeText
import org.impala67.app.ui.theme.Impala
import org.impala67.app.ui.theme.Space
import org.impala67.app.ui.theme.TextSize
import uniffi.impala_ffi.PageKind

/**
 * Befehls-Menü der PWA (Strg+K, search.js) als Vollbild: Suchfeld oben, darunter Seiten mit
 * Ausschnitt, zuletzt bearbeitete Seiten ohne Suchbegriff und Schnell-Aktionen. Treffer und Aktionen
 * gehen nur über Callbacks; die Shell schließt die Suche selbst.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SearchScreen(
    store: ImpalaStore,
    onOpenPage: (String) -> Unit,
    onAction: (String) -> Unit,
    onClose: () -> Unit,
) {
    val vm = viewModel { SearchViewModel(store) }
    val sections by vm.sections.collectAsStateWithLifecycle()
    val text = rememberTextFieldState()
    val barState = rememberSearchBarState(initialValue = SearchBarValue.Expanded)
    val query = text.text.toString()
    val c = Impala.colors

    LaunchedEffect(text) { snapshotFlow { text.text.toString() }.collect { vm.setQuery(it) } }
    val clear: @Composable () -> Unit = { ClearButton { text.edit { replace(0, length, "") } } }

    fun run(row: SearchRow) = when (row) {
        is SearchRow.Page -> onOpenPage(row.page.id)
        is SearchRow.Action -> onAction(row.id)
    }

    Column(Modifier.fillMaxSize().background(c.panel)) {
        SearchBarDefaults.InputField(
            searchBarState = barState,
            textFieldState = text,
            onSearch = { sections.orEmpty().firstOrNull()?.rows?.firstOrNull()?.let(::run) },
            modifier = Modifier.fillMaxWidth().padding(horizontal = Space.s4, vertical = Space.s2),
            placeholder = { Text(SearchText.PLACEHOLDER, color = c.text2) },
            leadingIcon = {
                IconButton(onClose, shapes = IconButtonDefaults.shapes()) {
                    Icon(painterResource(R.drawable.ic_i_chevron_left), "Schließen", tint = c.text2)
                }
            },
            trailingIcon = if (query.isEmpty()) null else clear,
        )

        val list = sections
        if (list != null) {
            LazyColumn(Modifier.fillMaxSize()) {
                if (list.isEmpty()) item { EmptyHint() }
                list.forEach { section ->
                    item(key = "h-" + section.title) { SectionHead(section.title) }
                    items(section.rows, key = { row -> rowKey(row) }) { row ->
                        when (row) {
                            is SearchRow.Page -> PageRowItem(row, query) { run(row) }
                            is SearchRow.Action -> ActionRowItem(row, query) { run(row) }
                        }
                    }
                }
            }
        }
    }
}

private fun rowKey(row: SearchRow): String = when (row) {
    is SearchRow.Page -> "p-" + row.page.id
    is SearchRow.Action -> "a-" + row.id
}

@Composable
private fun ClearButton(onClick: () -> Unit) {
    IconButton(onClick, shapes = IconButtonDefaults.shapes()) {
        Icon(painterResource(R.drawable.ic_i_x), "Eingabe löschen", Modifier.size(18.dp), tint = Impala.colors.text2)
    }
}

@Composable
private fun SectionHead(title: String) {
    Text(
        title, fontSize = TextSize.xs, color = Impala.colors.text2,
        modifier = Modifier.padding(start = Space.s5, end = Space.s5, top = Space.s4, bottom = Space.s1),
    )
}

@Composable
private fun EmptyHint() {
    Box(Modifier.fillMaxWidth().padding(Space.s6), contentAlignment = Alignment.Center) {
        Text(SearchText.NOTHING, fontSize = TextSize.base, color = Impala.colors.text2)
    }
}

/** Seitenzeile: Symbol, Titel (Treffer markiert), Ausschnitt, Datum (wie `.palette-item` in der PWA). */
@Composable
private fun PageRowItem(row: SearchRow.Page, query: String, onClick: () -> Unit) {
    val c = Impala.colors
    val page = row.page
    ListItem(
        supportingContent = if (row.snippet.isEmpty()) null else snippet(row.snippet, query),
        leadingContent = {
            if (page.icon.isNotBlank()) Text(page.icon, fontSize = TextSize.md)
            else Icon(
                painterResource(if (page.kind == PageKind.HEFT) R.drawable.ic_i_notebook else R.drawable.ic_i_note),
                null, Modifier.size(18.dp), tint = c.text2,
            )
        },
        trailingContent = {
            Text(
                (if (row.archived) "Archiv · " else "") + HomeText.whenText(page.updated),
                fontSize = TextSize.xs2, color = c.text2,
            )
        },
        colors = ListItemDefaults.colors(containerColor = c.panel),
        modifier = Modifier.clickable(onClick = onClick),
    ) {
        Text(highlight(page.title, query, c.tint3), fontSize = TextSize.base, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/** Ausschnitt unter dem Titel, Treffer markiert, höchstens zwei Zeilen. */
private fun snippet(raw: String, query: String): @Composable () -> Unit = {
    Text(
        highlight(raw, query, Impala.colors.tint3), fontSize = TextSize.sm, color = Impala.colors.text2,
        maxLines = 2, overflow = TextOverflow.Ellipsis,
    )
}

/** Aktionszeile (Symbol, Bezeichnung, „Aktion“). */
@Composable
private fun ActionRowItem(row: SearchRow.Action, query: String, onClick: () -> Unit) {
    val c = Impala.colors
    ListItem(
        leadingContent = { Icon(painterResource(row.icon), null, Modifier.size(18.dp), tint = c.text2) },
        trailingContent = { Text(SearchText.ACTION_KIND, fontSize = TextSize.xs2, color = c.text2) },
        colors = ListItemDefaults.colors(containerColor = c.panel),
        modifier = Modifier.clickable(onClick = onClick),
    ) {
        Text(highlight(row.label, query, c.tint3), fontSize = TextSize.base, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}
