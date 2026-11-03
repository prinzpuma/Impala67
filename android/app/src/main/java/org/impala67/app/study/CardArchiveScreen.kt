package org.impala67.app.study

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.launch
import org.impala67.app.R
import org.impala67.app.core.ImpalaStore
import org.impala67.app.core.Touches
import org.impala67.app.ui.components.TintButton
import org.impala67.app.ui.components.TintLabel
import org.impala67.app.ui.theme.Impala
import org.impala67.app.ui.theme.Space
import org.impala67.app.ui.theme.TextSize
import uniffi.impala_ffi.CardInfo
import uniffi.impala_ffi.DeckInfo

private data class ArchiveData(val decks: List<DeckInfo>, val cards: List<CardInfo>)

/**
 * Archiv der Karteikarten (render-anki.js `ankiArchiveHtml`): archivierte Stapel-Wurzeln und daneben
 * nur eigenständig archivierte Karten, jeweils mit „Wiederherstellen“.
 */
@Composable
fun CardArchiveScreen(store: ImpalaStore, onToast: (String) -> Unit, modifier: Modifier = Modifier) {
    val c = Impala.colors
    val scope = rememberCoroutineScope()
    val data by remember(store) { store.query(Touches.cards) { ArchiveData(it.archivedDecks(), it.orphanArchivedCards()) } }
        .collectAsStateWithLifecycle()
    fun run(done: String, block: (uniffi.impala_ffi.ImpalaCore) -> Unit) {
        scope.launch { runCatching { store.write(block) }.onSuccess { onToast(done) }.onFailure { onToast(it.message ?: "Fehlgeschlagen.") } }
    }
    Column(modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(Space.s5), horizontalAlignment = Alignment.CenterHorizontally) {
        Column(Modifier.widthIn(max = 800.dp).fillMaxWidth()) {
            Text("Archiv", style = MaterialTheme.typography.headlineSmall, color = c.text)
            Text(
                "Archivierte Karten bleiben erhalten, erscheinen aber nicht beim Lernen, in der aktiven Kartensuche oder im Wissensgraphen.",
                Modifier.padding(top = 4.dp, bottom = Space.s5), color = c.text2, fontSize = TextSize.sm,
            )
            val d = data ?: return@Column
            Section("Stapel")
            if (d.decks.isEmpty()) Empty("Keine archivierten Stapel")
            d.decks.forEachIndexed { i, deck ->
                val n = deck.cards.toInt()
                ArchiveRow(R.drawable.ic_i_archive, deck.name, "$n ${if (n == 1) "Karte" else "Karten"} inklusive Unterstapel") {
                    run("Stapel wiederhergestellt.") { it.unarchiveDeck(deck.name) }
                }
                if (i < d.decks.lastIndex) HorizontalDivider(color = c.edgeSoft)
            }
            Section("Einzelne Karten")
            if (d.cards.isEmpty()) Empty("Keine einzeln archivierten Karten")
            d.cards.forEachIndexed { i, card ->
                ArchiveRow(R.drawable.ic_i_cards, card.front.ifBlank { "Ohne Vorderseite" }.take(100), card.deck.ifBlank { "Standard" }) {
                    run("Karte wiederhergestellt.") { it.unarchiveCard(card.id) }
                }
                if (i < d.cards.lastIndex) HorizontalDivider(color = c.edgeSoft)
            }
        }
    }
}

@Composable
private fun Section(title: String) =
    Text(title, Modifier.padding(top = Space.s5, bottom = Space.s2), fontSize = TextSize.xs, color = Impala.colors.text2, fontWeight = FontWeight.SemiBold)

@Composable
private fun Empty(text: String) = Text(text, Modifier.padding(vertical = Space.s3), fontSize = TextSize.sm, color = Impala.colors.text2)

@Composable
private fun ArchiveRow(icon: Int, name: String, meta: String, onRestore: () -> Unit) {
    val c = Impala.colors
    Row(Modifier.fillMaxWidth().padding(vertical = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Icon(painterResource(icon), null, Modifier.size(18.dp), tint = c.text2)
        Column(Modifier.weight(1f)) {
            Text(name, color = c.text, fontSize = TextSize.md, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text(meta, color = c.text2, fontSize = TextSize.xs)
        }
        TintButton(onRestore, strong = false) { TintLabel("Wiederherstellen", strong = false) }
    }
}
