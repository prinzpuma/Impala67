package org.impala67.app.study

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.LoadingIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import org.impala67.app.R
import org.impala67.app.core.ImpalaStore
import org.impala67.app.ui.components.TintButton
import org.impala67.app.ui.components.TintLabel
import org.impala67.app.ui.theme.Impala
import org.impala67.app.ui.theme.Space
import org.impala67.app.ui.theme.TextSize
import uniffi.impala_ffi.CardInfo
import uniffi.impala_ffi.CardStage

private const val PAGE = 200

/** Kartenbrowser einer Stapel-Ebene (`null`: alle) mit Suche, Stapel-Filter, Bearbeiten, Aussetzen, Löschen. */
@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun CardBrowserScreen(store: ImpalaStore, deck: String?, onBack: () -> Unit, modifier: Modifier = Modifier) {
    val vm = viewModel { CardBrowserViewModel(store) }
    val all by vm.cards.collectAsStateWithLifecycle()
    val decks by vm.decks.collectAsStateWithLifecycle()
    val error by vm.error.collectAsStateWithLifecycle()
    var query by rememberSaveable { mutableStateOf("") }
    var filter by rememberSaveable(deck) { mutableStateOf(deck) }
    var limit by remember { mutableIntStateOf(PAGE) }
    var editor by remember { mutableStateOf<Editor?>(null) }
    BackHandler(onBack = onBack)

    val cards = all
    val shown = remember(cards, query, filter) {
        val q = query.trim().lowercase()
        cards.orEmpty().filter { b ->
            (filter == null || b.card.deck == filter || b.card.deck.startsWith(filter + DECK_SEP)) &&
                (q.isEmpty() || (b.frontText + "\n" + b.backText).lowercase().contains(q))
        }.sortedWith(compareBy({ it.card.deck.lowercase() }, { it.card.due }))
    }
    Column(modifier.fillMaxSize().background(Impala.colors.panel)) {
        Row(Modifier.fillMaxWidth().padding(horizontal = Space.s1, vertical = Space.s1), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onBack, modifier = Modifier.size(44.dp), shapes = IconButtonDefaults.shapes()) {
                Icon(painterResource(R.drawable.ic_i_chevron_left), "Zurück", Modifier.size(20.dp))
            }
            Text(
                filter?.let { deckLabel(it) } ?: "Karteikarten", Modifier.weight(1f), style = MaterialTheme.typography.titleLarge,
                maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
            TintButton({ editor = Editor(null) }, Modifier.padding(end = Space.s3)) { TintLabel("+ Neue Karte") }
        }
        OutlinedTextField(
            query, { query = it; limit = PAGE }, Modifier.fillMaxWidth().padding(horizontal = Space.s4), singleLine = true, shape = CircleShape,
            placeholder = { Text("Karten durchsuchen…") },
            leadingIcon = { Icon(painterResource(R.drawable.ic_i_search), null, Modifier.size(18.dp)) },
        )
        LazyRow(contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = Space.s4, vertical = Space.s2), horizontalArrangement = Arrangement.spacedBy(Space.s2)) {
            item { FilterChip(filter == null, { filter = null; limit = PAGE }, { Text("Alle") }) }
            items(decks.orEmpty()) { d -> FilterChip(filter == d, { filter = d; limit = PAGE }, { Text(d) }) }
        }
        if (cards == null) {
            Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) { LoadingIndicator() }
        } else if (shown.isEmpty()) {
            Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                Text(if (cards.isEmpty()) "Noch keine Karten — mit „Neue Karte“ eine anlegen" else "Keine Karte gefunden", fontSize = TextSize.sm, color = Impala.colors.text2)
            }
        } else {
            LazyColumn(Modifier.weight(1f).fillMaxWidth(), contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = Space.s4, vertical = Space.s2)) {
                items(shown.take(limit), key = { it.card.id }) { b ->
                    CardRow(b, filter == null, { editor = Editor(b.card.id) }, vm)
                    HorizontalDivider(color = Impala.colors.edgeSoft)
                }
                if (shown.size > limit) item {
                    TextButton({ limit += PAGE }, Modifier.fillMaxWidth()) { Text("Mehr anzeigen (${shown.size - limit} weitere)") }
                }
            }
        }
    }
    editor?.let { e -> CardEditorSheet(store, e.cardId, filter, onDismiss = { editor = null }) }
    error?.let { ErrorDialog(it, vm::dismissError) }
}

private data class Editor(val cardId: String?)

@Composable
private fun CardRow(b: BrowserCard, showDeck: Boolean, onEdit: () -> Unit, vm: CardBrowserViewModel) {
    val c = Impala.colors
    val card = b.card
    var menu by remember { mutableStateOf(false) }
    Row(Modifier.fillMaxWidth().widthIn(max = 800.dp).clickable(onClick = onEdit).padding(vertical = Space.s2), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(
                b.frontText.ifBlank { "(leer)" }, fontSize = TextSize.md, fontWeight = FontWeight.Medium, maxLines = 2, overflow = TextOverflow.Ellipsis,
                color = if (card.suspended) c.text2 else c.text,
            )
            Text(meta(card, showDeck), fontSize = TextSize.xs, color = c.text2, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Box {
            IconButton({ menu = true }, Modifier.size(44.dp)) {
                Icon(painterResource(R.drawable.ic_i_dots), "Weitere Optionen", Modifier.size(18.dp), tint = c.text2)
            }
            DropdownMenu(menu, { menu = false }, shape = MaterialTheme.shapes.large) {
                DropdownMenuItem({ Text("Bearbeiten") }, { menu = false; onEdit() }, leadingIcon = { Icon(painterResource(R.drawable.ic_i_pen), null, Modifier.size(18.dp)) })
                DropdownMenuItem(
                    { Text(if (card.suspended) "Fortsetzen" else "Aussetzen") }, { menu = false; vm.setSuspended(card, !card.suspended) },
                    leadingIcon = { Icon(painterResource(if (card.suspended) R.drawable.ic_i_play else R.drawable.ic_i_pause), null, Modifier.size(18.dp)) },
                )
                DropdownMenuItem(
                    { Text("In Papierkorb", color = c.danger) }, { menu = false; vm.trash(card) },
                    leadingIcon = { Icon(painterResource(R.drawable.ic_i_trash), null, Modifier.size(18.dp), tint = c.danger) },
                )
            }
        }
    }
}

/** „Stapel · Status · fällig dd.MM.yyyy“ (Spalten des PWA-Browsers). */
private fun meta(card: CardInfo, showDeck: Boolean): String {
    val stage = when (card.stage) {
        CardStage.NEW -> "Neu"
        CardStage.LEARNING -> "Lernen"
        CardStage.RELEARNING -> "Neu lernen"
        CardStage.REVIEW -> "Wiederholen"
    }
    val due = if (card.stage == CardStage.NEW) "" else formatDate(card.due).let { if (it.isEmpty()) "" else "fällig $it" }
    return listOfNotNull(
        deckLabel(card.deck).takeIf { showDeck }, if (card.suspended) "Ausgesetzt" else stage,
        "Leech".takeIf { card.leech }, due.takeIf { it.isNotEmpty() },
    ).joinToString(" · ")
}
