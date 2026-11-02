package org.impala67.app.study

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import kotlinx.coroutines.launch
import org.impala67.app.core.ImpalaStore
import org.impala67.app.ui.theme.Impala
import org.impala67.app.ui.theme.Space
import org.impala67.app.ui.theme.TextSize
import uniffi.impala_ffi.DeckConfig
import uniffi.impala_ffi.LeechAction

/** Welcher Stapel-Dialog offen ist (Lernen-Übersicht und Stapelbaum der Seitenleiste). */
sealed interface DeckDialog {
    data object New : DeckDialog
    data class Sub(val parent: String) : DeckDialog
    data class Rename(val name: String) : DeckDialog
    data class Trash(val name: String) : DeckDialog
    data class Options(val name: String) : DeckDialog
}

/** ⋯-Menü eines Stapels: Dialoge über [open], der Rest direkt über [vm]. */
fun deckMenuActions(name: String, vm: StudyViewModel, browse: () -> Unit, open: (DeckDialog) -> Unit) = DeckMenuActions(
    browse = browse, subdeck = { open(DeckDialog.Sub(name)) },
    rename = { open(DeckDialog.Rename(name)) }, duplicate = { vm.duplicate(name) },
    options = { open(DeckDialog.Options(name)) }, archive = { vm.archive(name) },
    trash = { open(DeckDialog.Trash(name)) },
)

@Composable
fun DeckDialogs(dialog: DeckDialog?, close: () -> Unit, store: ImpalaStore, vm: StudyViewModel) {
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

/** Name eingeben: neuer Stapel, Unterstapel oder Umbenennen. */
@Composable
fun DeckNameDialog(title: String, hint: String?, initial: String, confirm: String, onConfirm: (String) -> Unit, onDismiss: () -> Unit) {
    var text by rememberSaveable { mutableStateOf(initial) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(Space.s2)) {
                OutlinedTextField(text, { text = it }, Modifier.fillMaxWidth(), singleLine = true, label = { Text("Name") })
                if (hint != null) Text(hint, fontSize = TextSize.xs, color = Impala.colors.text2)
            }
        },
        confirmButton = { TextButton({ onConfirm(text.trim()) }, enabled = text.isNotBlank()) { Text(confirm) } },
        dismissButton = { TextButton(onDismiss) { Text("Abbrechen") } },
    )
}

/** Stapel in den Papierkorb: Nachfrage wie in der PWA. */
@Composable
fun DeckTrashDialog(name: String, onConfirm: () -> Unit, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Stapel in den Papierkorb?") },
        text = { Text("„$name“ samt Unterstapeln und allen Karten wandert in den Papierkorb.") },
        confirmButton = { TextButton(onConfirm) { Text("In Papierkorb", color = Impala.colors.danger) } },
        dismissButton = { TextButton(onDismiss) { Text("Abbrechen") } },
    )
}

/** Fehlermeldung des Kerns (z. B. Name schon vergeben). */
@Composable
fun ErrorDialog(message: String, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Das hat nicht geklappt") },
        text = { Text(message) },
        confirmButton = { TextButton(onDismiss) { Text("OK") } },
    )
}

/**
 * Stapel-Optionen (`openDeckConf` in extras.js): Tageslimits und Leech-Verhalten. `deck = null` sind
 * die Standardwerte für alle Stapel; Unterstapel erben von ihrem Eltern-Stapel.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DeckConfigDialog(store: ImpalaStore, deck: String?, onDismiss: () -> Unit) {
    val scope = rememberCoroutineScope()
    val conf by produceState<DeckConfig?>(null, deck) { value = store.write { it.deckConfig(deck) } }
    val c = conf
    if (c == null) return
    var newPerDay by rememberSaveable { mutableStateOf(c.newPerDay.toString()) }
    var revPerDay by rememberSaveable { mutableStateOf(c.revPerDay.toString()) }
    var leech by rememberSaveable { mutableStateOf(c.leechThreshold.toString()) }
    var action by rememberSaveable { mutableStateOf(c.leechAction.name) }
    val number = KeyboardOptions(keyboardType = KeyboardType.Number)
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Stapel-Optionen — " + (deck?.let { deckLabel(it) } ?: "Standardwerte (alle Stapel)")) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(Space.s3)) {
                OutlinedTextField(newPerDay, { newPerDay = it.filter(Char::isDigit) }, Modifier.fillMaxWidth(), singleLine = true, keyboardOptions = number, label = { Text("Neue Karten pro Tag") })
                OutlinedTextField(revPerDay, { revPerDay = it.filter(Char::isDigit) }, Modifier.fillMaxWidth(), singleLine = true, keyboardOptions = number, label = { Text("Wiederholungen pro Tag") })
                OutlinedTextField(leech, { leech = it.filter(Char::isDigit) }, Modifier.fillMaxWidth(), singleLine = true, keyboardOptions = number, label = { Text("Leech-Schwelle (Fehler bis zur Markierung)") })
                Text("Leech-Aktion", fontSize = TextSize.xs, color = Impala.colors.text2)
                val options = listOf(LeechAction.SUSPEND to "Karte aussetzen", LeechAction.MARK to "Nur markieren")
                SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                    options.forEachIndexed { i, (value, label) ->
                        SegmentedButton(
                            selected = action == value.name, onClick = { action = value.name },
                            shape = SegmentedButtonDefaults.itemShape(i, options.size),
                        ) { Text(label, fontSize = TextSize.sm, maxLines = 1) }
                    }
                }
                Text("Unterstapel erben die Einstellungen ihres Eltern-Stapels.", fontSize = TextSize.xs, color = Impala.colors.text2)
            }
        },
        confirmButton = {
            TextButton({
                val conf2 = DeckConfig(
                    newPerDay.toUIntOrNull() ?: 0u, revPerDay.toUIntOrNull() ?: 0u,
                    (leech.toUIntOrNull() ?: 8u).coerceAtLeast(1u), LeechAction.valueOf(action),
                )
                scope.launch { store.write { it.setDeckConfig(deck, conf2) }; onDismiss() }
            }) { Text("Speichern") }
        },
        dismissButton = {
            Row {
                // `btnDeckConfUndo`: letzte Bewertung zurücknehmen.
                val canUndo by produceState(false) { value = store.write { it.canUndoReview() } }
                TextButton({ scope.launch { store.write { it.undoReview() }; onDismiss() } }, enabled = canUndo) { Text("↺ Rückgängig") }
                TextButton({ scope.launch { store.write { it.resetDeckConfig(deck) }; onDismiss() } }) { Text("Zurücksetzen") }
                TextButton(onDismiss) { Text("Abbrechen") }
            }
        },
    )
}

