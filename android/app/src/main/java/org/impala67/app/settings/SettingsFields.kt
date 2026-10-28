package org.impala67.app.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import org.impala67.app.ui.theme.Impala
import org.impala67.app.ui.theme.Space

/** Titel, Erläuterung und eine Auswahl als Segmente über die ganze Breite (`UI.segmented` der PWA). */
@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun <T> SettingsChoiceRow(title: String, description: String?, options: List<Pair<T, String>>, selected: T, onSelect: (T) -> Unit) {
    Column(
        Modifier.fillMaxWidth().padding(horizontal = Space.s4, vertical = Space.s3),
        verticalArrangement = Arrangement.spacedBy(Space.s2),
    ) {
        Text(title, style = MaterialTheme.typography.titleMedium)
        if (description != null) Text(description, style = MaterialTheme.typography.bodySmall, color = Impala.colors.text2)
        SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
            options.forEachIndexed { index, (value, label) ->
                SegmentedButton(
                    selected = value == selected,
                    onClick = { onSelect(value) },
                    shape = SegmentedButtonDefaults.itemShape(index = index, count = options.size),
                    label = { Text(label) },
                )
            }
        }
    }
}

/**
 * Einzeiliges Feld, das beim Verlassen (oder Enter) speichert – wie `inpHomeName` und `inpHomeTopics`
 * in der PWA. Ohne Änderung wird nichts geschrieben.
 */
@Composable
fun SettingsTextField(label: String, stored: String, placeholder: String, supporting: String?, onCommit: (String) -> Unit) {
    var text by remember(stored) { mutableStateOf(stored) }
    var wasFocused by remember { mutableStateOf(false) }
    fun commit() {
        if (text.trim() != stored.trim()) onCommit(text)
    }
    OutlinedTextField(
        value = text,
        onValueChange = { text = it },
        label = { Text(label) },
        placeholder = { Text(placeholder) },
        supportingText = if (supporting != null) { { Text(supporting) } } else null,
        singleLine = true,
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
        keyboardActions = KeyboardActions(onDone = { commit() }),
        modifier = Modifier.fillMaxWidth().padding(horizontal = Space.s4, vertical = Space.s2).onFocusChanged { state ->
            if (wasFocused && !state.isFocused) commit()
            wasFocused = state.isFocused
        },
    )
}
