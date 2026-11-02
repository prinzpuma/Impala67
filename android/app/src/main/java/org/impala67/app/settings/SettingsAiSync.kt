package org.impala67.app.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.lifecycle.compose.collectAsStateWithLifecycle
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
        SettingsPlaceholderRow("Semantische Suche (Bekko a8m)", "Modell für semantische Suche folgt mit dem KI-Modul")
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
    // TODO(desk): „Weitere Exporte“ (Lerndaten als JSON, Workspace als Markdown-ZIP) fehlt noch.
    // „Erweitert“ mit Google Client-ID entfällt nativ (die Client-ID liegt im Projekt).
}
