package org.impala67.app.study

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import org.impala67.app.R
import org.impala67.app.ui.components.TintButton
import org.impala67.app.ui.components.TintLabel
import org.impala67.app.ui.theme.Impala
import org.impala67.app.ui.theme.Space
import org.impala67.app.ui.theme.TextSize

/** Was das ⋯-Menü eines Stapels auslösen kann (`deckMenuHtml` in render-anki.js). */
data class DeckMenuActions(
    val browse: () -> Unit,
    val subdeck: () -> Unit,
    val rename: () -> Unit,
    val duplicate: () -> Unit,
    val options: () -> Unit,
    val archive: () -> Unit,
    val trash: () -> Unit,
)

/** Stapel-Zeile (`.deck-row`): Auf-/Zuklappen, Name mit Kartenzahl, Zähler, „Lernen“, ⋯-Menü. */
@Composable
fun DeckRow(e: DeckEntry, compact: Boolean, onStudy: () -> Unit, onToggle: () -> Unit, menu: DeckMenuActions) {
    val c = Impala.colors
    val d = e.deck
    Row(
        Modifier.fillMaxWidth().padding(start = (e.depth * 22).dp).clip(MaterialTheme.shapes.medium)
            .clickable(enabled = e.open, onClick = onStudy).defaultMinSize(minHeight = 60.dp).padding(vertical = Space.s1),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Chevron(e, onToggle)
        Column(Modifier.weight(1f).padding(end = Space.s2)) {
            Text(e.label, fontSize = TextSize.md, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(
                cardsText(d.total.toInt()) + if (d.suspended > 0uL) " · ${d.suspended} ausgesetzt" else "",
                fontSize = TextSize.xs, color = c.text2, maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
        }
        Counts(e)
        if (!compact && e.open) TintButton(onStudy, Modifier.padding(start = Space.s2)) { TintLabel("Lernen") }
        DeckMenu(e.name, menu)
    }
}

private fun cardsText(n: Int) = if (n == 1) "1 Karte" else "$n Karten"

@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
private fun Chevron(e: DeckEntry, onToggle: () -> Unit) {
    if (!e.hasKids) {
        Box(Modifier.width(Space.s2))
        return
    }
    val turn by animateFloatAsState(if (e.collapsed) 0f else 90f, MaterialTheme.motionScheme.fastSpatialSpec(), label = "chevron")
    IconButton(onToggle, modifier = Modifier.size(36.dp), shapes = IconButtonDefaults.shapes()) {
        Icon(
            painterResource(R.drawable.ic_i_chevron_right), if (e.collapsed) "Unterstapel anzeigen" else "Unterstapel ausblenden",
            Modifier.size(16.dp).graphicsLayer { rotationZ = turn }, tint = Impala.colors.text2,
        )
    }
}

/** Fällige Wiederholungen oder offene Karten groß, darunter „lernen · neu“; sonst „fertig für heute“. */
@Composable
private fun Counts(e: DeckEntry) {
    val c = Impala.colors
    val d = e.deck
    Column(horizontalAlignment = Alignment.End) {
        if (e.open) {
            if (d.review > 0uL) Text("${d.review} fällig", fontSize = TextSize.base, fontWeight = FontWeight.Bold, color = c.accent)
            else Text("${d.learn + d.new} offen", fontSize = TextSize.base, fontWeight = FontWeight.SemiBold)
            Text("${d.learn} lernen · ${d.new} neu", fontSize = TextSize.xs2, color = c.text2)
        } else {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.s1)) {
                Icon(painterResource(R.drawable.ic_i_check), null, Modifier.size(12.dp), tint = c.success)
                Text("fertig für heute", fontSize = TextSize.xs2, color = c.success)
            }
        }
    }
}

@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
private fun DeckMenu(name: String, a: DeckMenuActions) {
    var open by remember { mutableStateOf(false) }
    val standard = name == DEFAULT_DECK
    Box {
        IconButton({ open = true }, modifier = Modifier.size(44.dp), shapes = IconButtonDefaults.shapes()) {
            Icon(painterResource(R.drawable.ic_i_dots), "Weitere Optionen", Modifier.size(18.dp), tint = Impala.colors.text2)
        }
        DropdownMenu(open, { open = false }, shape = MaterialTheme.shapes.large) {
            @Composable
            fun item(text: String, icon: Int, danger: Boolean = false, action: () -> Unit) = DropdownMenuItem(
                text = { Text(text, color = if (danger) Impala.colors.danger else Impala.colors.text) },
                leadingIcon = { Icon(painterResource(icon), null, Modifier.size(18.dp), tint = if (danger) Impala.colors.danger else Impala.colors.text2) },
                onClick = { open = false; action() },
            )
            item("Karten ansehen", R.drawable.ic_i_search, action = a.browse)
            item("Unterstapel anlegen", R.drawable.ic_i_plus, action = a.subdeck)
            if (!standard) item("Umbenennen", R.drawable.ic_i_pen, action = a.rename)
            item("Duplizieren", R.drawable.ic_i_copy, action = a.duplicate)
            item("Optionen", R.drawable.ic_i_gear, action = a.options)
            item("Archivieren", R.drawable.ic_i_archive, action = a.archive)
            if (!standard) item("In Papierkorb", R.drawable.ic_i_trash, danger = true, action = a.trash)
        }
    }
}
