package org.impala67.app.study

import androidx.compose.foundation.text.TextAutoSize
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.LoadingIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import org.impala67.app.R
import org.impala67.app.core.ImpalaStore
import org.impala67.app.ui.components.PanelCard
import org.impala67.app.ui.components.TintButton
import org.impala67.app.ui.components.TintLabel
import org.impala67.app.ui.components.riseIn
import org.impala67.app.ui.theme.Impala
import org.impala67.app.ui.theme.Space
import org.impala67.app.ui.theme.TextSize
import kotlin.math.roundToInt

/** Welcher Dialog der Stapelübersicht offen ist. */
private sealed interface DeckDialog {
    data object New : DeckDialog
    data class Sub(val parent: String) : DeckDialog
    data class Rename(val name: String) : DeckDialog
    data class Trash(val name: String) : DeckDialog
    data class Options(val name: String) : DeckDialog
}

/**
 * Lernen-Übersicht (`ankiDecksHtml` in web/render-anki.js): ein Satz mit der Kartenzahl als Startknopf,
 * zwei Kennzahlen, darunter die Stapelliste (Unterstapel eingerückt und einklappbar).
 * [onStudyDeck] startet das Lernen (`null`: alle Stapel), [onBrowse] öffnet den Kartenbrowser.
 * [onStudyMixed] (optional) zeigt „Gemischt“: fällige Karten aller Stapel durcheinander.
 */
@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun StudyScreen(
    store: ImpalaStore,
    onStudyDeck: (deck: String?) -> Unit,
    onBrowse: (deck: String?) -> Unit,
    modifier: Modifier = Modifier,
    onStudyMixed: (() -> Unit)? = null,
) {
    val vm = viewModel { StudyViewModel(store) }
    val data by vm.data.collectAsStateWithLifecycle()
    val collapsed by vm.collapsed.collectAsStateWithLifecycle()
    val error by vm.error.collectAsStateWithLifecycle()
    var dialog by remember { mutableStateOf<DeckDialog?>(null) }
    val d = data
    if (d == null) {
        Box(modifier.fillMaxSize().background(Impala.colors.panel), contentAlignment = Alignment.Center) { LoadingIndicator() }
        return
    }
    val entries = flattenDecks(d.decks, collapsed)
    val open = d.new + d.learn + d.review
    BoxWithConstraints(modifier.fillMaxSize().background(Impala.colors.panel)) {
        val narrow = maxWidth < 520.dp
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState())
                .padding(horizontal = if (narrow) Space.s5 else 40.dp)
                .padding(top = if (narrow) Space.s4 else 48.dp, bottom = if (narrow) 48.dp else 80.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Column(Modifier.widthIn(max = 800.dp).fillMaxWidth()) {
                Lead(d, entries.isNotEmpty(), narrow, { onStudyDeck(null) }, Modifier.riseIn(0))
                if (open > 0 && onStudyMixed != null) {
                    TintButton(onStudyMixed, Modifier.padding(top = Space.s4).riseIn(1), strong = false) {
                        Icon(painterResource(R.drawable.ic_i_shuffle), null, Modifier.size(16.dp))
                        Text("  Gemischt", fontSize = TextSize.sm, fontWeight = FontWeight.Medium)
                    }
                }
                Stats(d, entries.isNotEmpty(), { onStudyDeck(null) }, Modifier.padding(top = Space.s6).riseIn(1))
                Row(
                    Modifier.fillMaxWidth().padding(top = 40.dp, bottom = Space.s2).riseIn(2),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Text("Deine Stapel", fontSize = TextSize.xs, color = Impala.colors.text2)
                    TintButton({ dialog = DeckDialog.New }, strong = false) { TintLabel("+ Neuer Stapel", strong = false) }
                }
                if (entries.isEmpty()) {
                    Text("Noch keine Stapel — mit „Neuer Stapel“ einen anlegen", fontSize = TextSize.sm, color = Impala.colors.text2, modifier = Modifier.padding(vertical = Space.s4))
                }
                entries.forEachIndexed { i, e ->
                    DeckRow(
                        e, narrow, onStudy = { onStudyDeck(e.name) }, onToggle = { vm.toggle(e.name) },
                        menu = DeckMenuActions(
                            browse = { onBrowse(e.name) }, subdeck = { dialog = DeckDialog.Sub(e.name) },
                            rename = { dialog = DeckDialog.Rename(e.name) }, duplicate = { vm.duplicate(e.name) },
                            options = { dialog = DeckDialog.Options(e.name) }, archive = { vm.archive(e.name) },
                            trash = { dialog = DeckDialog.Trash(e.name) },
                        ),
                    )
                    if (i < entries.lastIndex) HorizontalDivider(color = Impala.colors.edgeSoft)
                }
            }
        }
    }
    Dialogs(dialog, { dialog = null }, store, vm)
    error?.let { ErrorDialog(it, vm::dismissError) }
}

@Composable
private fun Dialogs(dialog: DeckDialog?, close: () -> Unit, store: ImpalaStore, vm: StudyViewModel) {
    when (dialog) {
        null -> Unit
        DeckDialog.New -> DeckNameDialog(
            "Neuer Stapel", "Unterstapel per „Eltern::Kind“", "", "Anlegen",
            { vm.create(it); close() }, close,
        )
        is DeckDialog.Sub -> DeckNameDialog(
            "Unterstapel von „${deckLabel(dialog.parent)}“", null, "", "Anlegen",
            { vm.create(dialog.parent + DECK_SEP + it); close() }, close,
        )
        is DeckDialog.Rename -> DeckNameDialog(
            "Stapel umbenennen", null, deckLabel(dialog.name), "Umbenennen",
            { text ->
                val prefix = dialog.name.substringBeforeLast(DECK_SEP, "")
                vm.rename(dialog.name, if (prefix.isEmpty()) text else prefix + DECK_SEP + text)
                close()
            }, close,
        )
        is DeckDialog.Trash -> DeckTrashDialog(dialog.name, { vm.trash(dialog.name); close() }, close)
        is DeckDialog.Options -> DeckConfigDialog(store, dialog.name, close)
    }
}

/** Ein Satz: „N Karten warten auf dich, etwa M Minuten.“ – die Kartenzahl startet das Lernen. */
@Composable
private fun Lead(d: DeckData, hasDecks: Boolean, narrow: Boolean, onStudy: () -> Unit, modifier: Modifier) {
    val c = Impala.colors
    val total = d.new + d.learn + d.review
    val text = buildAnnotatedString {
        when {
            !hasDecks -> append("Lege deinen ersten Stapel an.")
            total > 0 -> {
                val link = LinkAnnotation.Clickable("study", TextLinkStyles(SpanStyle(color = c.text, textDecoration = TextDecoration.Underline))) { onStudy() }
                withLink(link) { append(cards(total)) }
                val min = minutes(total)
                append(" ${if (total == 1) "wartet" else "warten"} auf dich, etwa $min ${if (min == 1) "Minute" else "Minuten"}.")
            }
            else -> withStyle(SpanStyle(color = c.text)) { append("Für heute ist alles gelernt.") }
        }
    }
    Text(text, modifier.widthIn(max = 720.dp), color = c.text2, style = MaterialTheme.typography.headlineMedium.copy(fontSize = if (narrow) 24.sp else 28.sp))
}

private fun cards(n: Int) = if (n == 1) "1 Karte" else "$n Karten"

/** Grobe Schätzung der PWA: etwa 2,5 Karten pro Minute, mindestens eine Minute. */
private fun minutes(total: Int) = maxOf(1, (total / 2.5).roundToInt())

/** „Heute fällig“ (Akzent / Grün / leer) und „Neue Karten“ (`.anki-stats`). */
@Composable
private fun Stats(d: DeckData, hasDecks: Boolean, onStudy: () -> Unit, modifier: Modifier) {
    val c = Impala.colors
    val total = d.new + d.learn + d.review
    val big = MaterialTheme.typography.displaySmall
    val pad = androidx.compose.foundation.layout.PaddingValues(horizontal = 22.dp, vertical = 20.dp)
    Row(modifier.height(IntrinsicSize.Max), horizontalArrangement = Arrangement.spacedBy(Space.s4)) {
        val cell = Modifier.weight(1f).fillMaxHeight()
        when {
            total > 0 -> PanelCard(cell, color = c.tint2, border = c.accentBorder, padding = pad, onClick = onStudy) {
                Small("Heute fällig")
                Text(cards(total), style = big, color = c.accent)
                Text("etwa ${minutes(total)} Min · Lernen starten", fontSize = TextSize.sm, color = c.text2)
            }
            hasDecks -> PanelCard(cell, color = c.successPanel, padding = pad) {
                Small("Heute fällig")
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.s2)) {
                    Icon(painterResource(R.drawable.ic_i_check), null, Modifier.size(18.dp), tint = c.success)
                    Text("Alles gelernt", style = big, color = c.success, maxLines = 1, autoSize = TextAutoSize.StepBased(minFontSize = 18.sp, maxFontSize = big.fontSize))
                }
                Text("Morgen geht's weiter", fontSize = TextSize.sm, color = c.text2)
            }
            else -> PanelCard(cell, padding = pad) {
                Small("Heute fällig")
                Text("Keine Karten", fontSize = TextSize.md, fontWeight = FontWeight.SemiBold)
                Text("Stapel anlegen", fontSize = TextSize.sm, color = c.text2)
            }
        }
        PanelCard(cell, padding = pad) {
            Small("Neue Karten")
            Text("${d.new}", style = big)
            Text("im heutigen Tageslimit", fontSize = TextSize.sm, color = c.text2)
        }
    }
}

@Composable
private fun Small(text: String) = Text(text, fontSize = TextSize.xs, color = Impala.colors.text2)
