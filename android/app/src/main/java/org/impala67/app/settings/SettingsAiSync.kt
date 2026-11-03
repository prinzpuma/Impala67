package org.impala67.app.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.launch
import org.impala67.app.ai.SemanticState
import org.impala67.app.ai.semanticIndex
import org.impala67.app.ui.theme.Space

/** KI (settings-renderer.js `renderAi`): Modell, Quellen, lokale KI und Verhalten. */
@Composable
fun AiSettings(vm: SettingsViewModel) {
    val values by vm.values.collectAsStateWithLifecycle()
    val s = values

    if (s != null) {
        AiModelsGroup(vm, s)
        AiSourcesGroup(vm, s)
    }
    SettingsGroup(
        "Lokale KI",
        footnote = "Beide Modelle laufen direkt auf dem Gerät; deine Inhalte verlassen dafür das Gerät nicht.",
    ) {
        SemanticSearchRow()
        SettingsPlaceholderRow("Handschrifterkennung (Digital Ink)", "Folgt mit dem Heft-Modul")
    }
    SettingsGroup("Verhalten") {
        SettingsSwitchRow("Tools mitsenden", "Stellt der KI die App-Werkzeuge zur Verfügung", s?.alwaysSendTools ?: true) {
            vm.setAlwaysSendTools(it)
        }
        CustomInstructionsField(stored = s?.customInstructions ?: "") { vm.saveCustomInstructions(it) }
    }
}

/**
 * Lokales Embedding-Modell (settings.js `updateLocalEmbeddingManagerUi`): laden und aktivieren, Fortschritt,
 * Index-Stand, vom Gerät löschen. Eine Cloud-Quelle für Embeddings wird nur angezeigt.
 */
@Composable
private fun SemanticSearchRow() {
    val semantic = semanticIndex()
    val state by semantic.state.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    var error by remember { mutableStateOf<String?>(null) }
    val model = remember(state) { semantic.model() }
    val size = "ca. ${model.sizeMb} MB"
    val download = { error = null; scope.launch { error = semantic.downloadAndEnable() }; Unit }
    val description = error ?: when (val s = state) {
        SemanticState.Off -> "Aus – findet Notizen nach Bedeutung (KI-Chat, „Verwandt“). Download $size."
        SemanticState.NeedsModel -> "Aktiviert, aber das Modell fehlt auf diesem Gerät ($size)."
        is SemanticState.Downloading -> "Lädt… ${s.percent} %" + if (s.files > 1) " (Datei ${s.file + 1} von ${s.files})" else ""
        SemanticState.Loading -> "Modell wird geladen…"
        is SemanticState.Indexing -> "Indexiert Notizen… noch ${s.remaining}"
        is SemanticState.Ready -> if (s.cloudModel != null) "Aktiv über Cloud-Quelle (${s.cloudModel})" else "Aktiv – läuft lokal auf dem Gerät"
        is SemanticState.Failed -> "Fehler: ${s.message}"
    }
    SettingsRow("Semantische Suche (Bekko a8m)", description) {
        when (state) {
            SemanticState.Off -> Button(onClick = download) { Text("Laden & aktivieren") }
            SemanticState.NeedsModel -> Button(onClick = download) { Text("Herunterladen") }
            is SemanticState.Downloading -> OutlinedButton(onClick = { semantic.cancelDownload() }) { Text("Abbrechen") }
            else -> if (model.downloaded) {
                OutlinedButton(onClick = { error = null; scope.launch { semantic.deleteModel() } }) { Text("Modell löschen") }
            }
        }
    }
    (state as? SemanticState.Downloading)?.let { s ->
        LinearProgressIndicator(
            progress = { s.percent / 100f },
            modifier = Modifier.fillMaxWidth().padding(horizontal = Space.s4, vertical = Space.s2),
        )
    }
}

/**
 * Eigene Anweisungen: mehrzeilig mit eigener Speichern-Schaltfläche, wie die Speichern-Leiste der PWA.
 */
@Composable
private fun CustomInstructionsField(stored: String, onSave: (String) -> Unit) {
    var text by remember(stored) { mutableStateOf(stored) }
    val dirty = text != stored
    OutlinedTextField(
        value = text,
        onValueChange = { text = it },
        label = { Text("Eigene Anweisungen") },
        placeholder = { Text("Optional") },
        supportingText = { Text("Tonfall, Fach und dauerhafte Vorlieben") },
        minLines = 4,
        modifier = Modifier.fillMaxWidth().padding(horizontal = Space.s4, vertical = Space.s2),
    )
    if (dirty) {
        Row(Modifier.fillMaxWidth().padding(horizontal = Space.s2), horizontalArrangement = Arrangement.End) {
            TextButton(onClick = { onSave(text) }) { Text("Speichern") }
        }
    }
}

/** Sync & Backup (settings-renderer.js `renderSync`): Cloudflare, Google Drive, Automatik, Backup. */
@Composable
fun SyncSettings(vm: SettingsViewModel, prefs: DevicePrefs, toast: (String) -> Unit) {
    CloudflareSyncGroup(toast)
    DriveSyncGroup(toast)
    DriveAutomationGroup(vm)
    BackupGroup(vm, prefs)
    org.impala67.app.diag.MoreExportsGroup()
    // „Erweitert“ mit Google Client-ID entfällt nativ (die Client-ID liegt im Projekt).
}
