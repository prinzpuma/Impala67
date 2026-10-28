package org.impala67.app.study

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenu
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.ExposedDropdownMenuAnchorType
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import org.impala67.app.core.ImpalaStore
import org.impala67.app.ui.components.TintButton
import org.impala67.app.ui.components.TintLabel
import org.impala67.app.ui.theme.Impala
import org.impala67.app.ui.theme.Space
import org.impala67.app.ui.theme.TextSize
import uniffi.impala_ffi.CardInfo
import uniffi.impala_ffi.CoreException

private val CLOZE_NUMBER = Regex("""\{\{c(\d+)::""")
private const val NEW_DECK = "\u0000new"

/**
 * Karten-Editor (`openCardEditor` in render-anki.js): Stapel, Vorder- und Rückseite, Lückentext.
 * [cardId] `null` legt eine neue Karte an (Stapel-Vorgabe [defaultDeck]). [onSaved] meldet jede Änderung
 * (auch Löschen), danach schließt das Sheet.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CardEditorSheet(store: ImpalaStore, cardId: String?, defaultDeck: String?, onDismiss: () -> Unit, onSaved: () -> Unit = {}) {
    val loaded by produceState<Pair<CardInfo?, List<String>>?>(null, cardId) {
        value = store.write { core ->
            cardId?.let { core.card(it) } to (core.decks().map { it.name } + DEFAULT_DECK).distinct().sorted()
        }
    }
    val data = loaded
    ModalBottomSheet(onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = Impala.colors.panel) {
        if (data != null) EditorBody(store, data.first, data.second, defaultDeck, onDismiss, onSaved)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun EditorBody(store: ImpalaStore, card: CardInfo?, decks: List<String>, defaultDeck: String?, onDismiss: () -> Unit, onSaved: () -> Unit) {
    val scope = rememberCoroutineScope()
    val current = card?.deck ?: defaultDeck ?: DEFAULT_DECK
    val choices = remember { (decks + current).distinct() }
    var deck by remember { mutableStateOf(current) }
    var newDeck by remember { mutableStateOf("") }
    var menu by remember { mutableStateOf(false) }
    var front by remember { mutableStateOf(TextFieldValue(card?.front.orEmpty())) }
    var back by remember { mutableStateOf(card?.back.orEmpty()) }
    var error by remember { mutableStateOf<String?>(null) }
    val target = if (deck == NEW_DECK) newDeck.trim().ifEmpty { current } else deck

    fun run(block: suspend () -> Unit) = scope.launch {
        try {
            block()
            onSaved()
            onDismiss()
        } catch (e: CoreException) {
            error = e.reason()
        }
    }

    Column(
        Modifier.fillMaxWidth().imePadding().navigationBarsPadding().verticalScroll(rememberScrollState()).padding(horizontal = Space.s5).padding(bottom = Space.s4),
        verticalArrangement = Arrangement.spacedBy(Space.s3),
    ) {
        Text(if (card == null) "Neue Karte" else "Karte bearbeiten", style = androidx.compose.material3.MaterialTheme.typography.titleLarge)
        ExposedDropdownMenuBox(menu, { menu = it }) {
            OutlinedTextField(
                if (deck == NEW_DECK) "+ Neuer Stapel…" else deck, {}, Modifier.fillMaxWidth().menuAnchor(ExposedDropdownMenuAnchorType.PrimaryNotEditable),
                readOnly = true, singleLine = true, label = { Text("Stapel") },
                trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(menu) },
            )
            ExposedDropdownMenu(menu, { menu = false }) {
                choices.forEach { d -> DropdownMenuItem({ Text(d) }, { deck = d; menu = false }) }
                DropdownMenuItem({ Text("+ Neuer Stapel…") }, { deck = NEW_DECK; menu = false })
            }
        }
        if (deck == NEW_DECK) {
            OutlinedTextField(newDeck, { newDeck = it }, Modifier.fillMaxWidth(), singleLine = true, label = { Text("Name des neuen Stapels") })
        }
        OutlinedTextField(front, { front = it }, Modifier.fillMaxWidth(), minLines = 3, label = { Text("Vorderseite") }, placeholder = { Text("Frage…") })
        OutlinedTextField(back, { back = it }, Modifier.fillMaxWidth(), minLines = 3, label = { Text("Rückseite") }, placeholder = { Text("Antwort…") })
        Text(
            "Lückentext: Text markieren → „Lücke einfügen“. „Als Lückentext speichern“ erzeugt pro Lücke eine Karte.",
            fontSize = TextSize.xs, color = Impala.colors.text2,
        )
        Row(horizontalArrangement = Arrangement.spacedBy(Space.s2)) {
            TintButton({ front = wrapCloze(front) }, strong = false) { TintLabel("［…］ Lücke einfügen", strong = false) }
            TintButton({
                run {
                    val n = store.write { it.createClozeCards(front.text, target, card?.pageId) }
                    if (n == 0u) throw CoreException.Invalid("Keine Lücke im Text — erst Text markieren und „Lücke einfügen“.")
                }
            }, strong = false) { TintLabel("Als Lückentext speichern", strong = false) }
        }
        error?.let { Text(it, color = Impala.colors.danger, fontSize = TextSize.sm) }
        Row(Modifier.fillMaxWidth().padding(top = Space.s2), horizontalArrangement = Arrangement.spacedBy(Space.s2)) {
            TintButton({
                if (front.text.isBlank() && back.isBlank()) error = "Die Karte braucht eine Vorder- oder Rückseite."
                else run {
                    store.write {
                        if (card == null) it.createCard(front.text, back, target, null)
                        else it.updateCard(card.id, front.text, back, target)
                    }
                }
            }) { TintLabel("Speichern") }
            TextButton(onDismiss) { Text("Abbrechen") }
            if (card != null) {
                Row(Modifier.weight(1f), horizontalArrangement = Arrangement.End) {
                    TextButton({ run { store.write { it.trashCard(card.id) } } }) { Text("Löschen", color = Impala.colors.danger) }
                }
            }
        }
    }
}

/** Markierten Text in `{{cN::…}}` setzen (N = nächste freie Nummer); ohne Markierung eine leere Lücke. */
private fun wrapCloze(v: TextFieldValue): TextFieldValue {
    val next = (CLOZE_NUMBER.findAll(v.text).maxOfOrNull { it.groupValues[1].toInt() } ?: 0) + 1
    val sel = v.selection
    val picked = v.text.substring(sel.min, sel.max)
    val open = "{{c$next::"
    val text = v.text.substring(0, sel.min) + open + picked + "}}" + v.text.substring(sel.max)
    val caret = if (picked.isEmpty()) sel.min + open.length else sel.min + open.length + picked.length + 2
    return TextFieldValue(text, TextRange(caret))
}
