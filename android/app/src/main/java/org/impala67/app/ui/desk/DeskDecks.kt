package org.impala67.app.ui.desk

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.item
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation3.runtime.NavKey
import org.impala67.app.R
import org.impala67.app.core.ImpalaStore
import org.impala67.app.study.DeckEntry
import org.impala67.app.study.StudyViewModel
import org.impala67.app.study.flattenDecks
import org.impala67.app.ui.shell.ReviewRoute
import org.impala67.app.ui.shell.ShellNav
import org.impala67.app.ui.theme.Impala
import org.impala67.app.ui.theme.Radius
import org.impala67.app.ui.theme.Space
import org.impala67.app.ui.theme.TextSize

/**
 * Stapelbaum der Seitenleiste (Modus „Karten“, `deckTreeHtml` in der PWA): Unterstapel eingerückt und
 * einklappbar, Zähler für fällige und neue Karten. Antippen öffnet die Lernansicht des Stapels.
 * Daten und Einklapp-Zustand kommen aus [StudyViewModel], wie in der Lernen-Übersicht.
 */
@Composable
fun DeskDecks(store: ImpalaStore, nav: ShellNav, current: NavKey, modifier: Modifier = Modifier) {
    val vm = viewModel { StudyViewModel(store) }
    val data by vm.data.collectAsStateWithLifecycle()
    val collapsed by vm.collapsed.collectAsStateWithLifecycle()
    val activeDeck = (current as? ReviewRoute)?.deck
    val entries = remember(data, collapsed) { data?.let { flattenDecks(it.decks, collapsed) }.orEmpty() }
    LazyColumn(modifier.fillMaxSize()) {
        item(key = "head") {
            Text(
                "Stapel", Modifier.padding(start = Space.s1, top = Space.s3, bottom = Space.s1),
                color = Impala.colors.text2, fontSize = TextSize.xs, fontWeight = FontWeight.SemiBold,
                maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
        }
        if (data != null && entries.isEmpty()) {
            item(key = "empty") {
                Text(
                    "Noch keine Stapel", Modifier.padding(start = Space.s2, top = Space.s1),
                    color = Impala.colors.text2, fontSize = TextSize.sm,
                )
            }
        }
        items(entries, key = { "deck:" + it.name }) { e ->
            DeckTreeRow(
                e,
                active = e.name == activeDeck,
                onToggle = { vm.toggle(e.name) },
                onOpen = { nav.open(ReviewRoute(e.name)) },
            )
        }
    }
}

/** Stapelzeile (`.deck-tree-row`) wie die Seitenzeilen: 36 dp, Radius md, aktiv mit Akzent-Tönung. */
@Composable
private fun DeckTreeRow(e: DeckEntry, active: Boolean, onToggle: () -> Unit, onOpen: () -> Unit) {
    val c = Impala.colors
    val d = e.deck
    Row(
        Modifier.fillMaxWidth().heightIn(min = 36.dp).clip(RoundedCornerShape(Radius.md))
            .background(if (active) c.accent.copy(alpha = 0.14f) else Color.Transparent)
            .clickable(onClick = onOpen)
            .padding(start = (6 + e.depth * 16).dp, end = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        if (e.hasKids) DeckChevron(open = !e.collapsed, onToggle = onToggle) else Spacer(Modifier.width(24.dp))
        Text(
            e.label, Modifier.weight(1f).padding(start = Space.s1),
            color = if (active) c.text else c.text2, fontSize = TextSize.base,
            maxLines = 1, overflow = TextOverflow.Ellipsis,
        )
        val due = d.review + d.learn
        if (due > 0uL) CountBadge("$due", c.accent)
        if (d.new > 0uL) CountBadge("${d.new}", c.success)
    }
}

/** Kleiner Pfeil (`.row-chevron`), gedreht, wenn offen. Trefferfläche 24 dp. */
@Composable
private fun DeckChevron(open: Boolean, onToggle: () -> Unit) {
    Box(Modifier.size(24.dp).clip(RoundedCornerShape(Radius.xs)).clickable(onClick = onToggle), contentAlignment = Alignment.Center) {
        Icon(
            painterResource(R.drawable.ic_i_chevron_right), if (open) "Unterstapel ausblenden" else "Unterstapel anzeigen",
            Modifier.size(12.dp).rotate(if (open) 90f else 0f), tint = Impala.colors.text2,
        )
    }
}

/** Zähler-Pille (`.deck-badge`): Fällige in Akzent, neue in Erfolgsfarbe, je mit leichter Tönung. */
@Composable
private fun CountBadge(text: String, color: Color) {
    Box(
        Modifier.defaultMinSize(minWidth = 18.dp).clip(CircleShape).background(color.copy(alpha = 0.14f))
            .padding(horizontal = 5.dp, vertical = 1.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, color = color, fontSize = TextSize.xs2, fontWeight = FontWeight.SemiBold)
    }
}
