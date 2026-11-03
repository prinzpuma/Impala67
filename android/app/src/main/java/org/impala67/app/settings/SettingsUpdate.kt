package org.impala67.app.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import org.impala67.app.settings.AppUpdater.Phase
import org.impala67.app.ui.theme.Impala
import org.impala67.app.ui.theme.Space
import kotlin.math.roundToInt

/** App-Updates (settings-renderer.js „App-Updates“): auf Wunsch prüfen, APK laden und installieren. */
@Composable
fun UpdateGroup(installed: String) {
    val context = LocalContext.current
    val ui by AppUpdater.ui.collectAsStateWithLifecycle()

    val status = when (ui.phase) {
        Phase.IDLE -> "Updates werden nur auf Wunsch geprüft"
        Phase.CHECKING -> "Suche Update …"
        Phase.UP_TO_DATE -> "Aktuell – neueste Version ist v${ui.latest}"
        Phase.AVAILABLE -> "Update verfügbar: v${ui.latest}"
        Phase.DOWNLOADING -> "Lade v${ui.latest}" + (if (ui.progress >= 0) " · ${(ui.progress * 100).roundToInt()} %" else " …")
        Phase.READY -> "v${ui.latest} ist geladen und bereit zur Installation"
        Phase.ERROR -> ui.message
    }

    SettingsGroup("App-Updates", footnote = "Updates kommen als APK aus den GitHub-Releases. Deine Daten bleiben beim Installieren erhalten.") {
        SettingsRow(
            "App-Version",
            status,
            trailing = { Text("Installiert v$installed", style = MaterialTheme.typography.bodyMedium) },
        )
        if (ui.phase == Phase.DOWNLOADING) {
            val mod = Modifier.fillMaxWidth().padding(horizontal = Space.s4)
            if (ui.progress >= 0) LinearProgressIndicator(progress = { ui.progress }, modifier = mod)
            else LinearProgressIndicator(mod)
        }
        if (ui.phase == Phase.READY && ui.message.isNotEmpty()) {
            Text(ui.message, style = MaterialTheme.typography.bodySmall, color = Impala.colors.warn, modifier = Modifier.padding(horizontal = Space.s4))
        }
        Row(
            Modifier.fillMaxWidth().padding(horizontal = Space.s4, vertical = Space.s2),
            horizontalArrangement = Arrangement.spacedBy(Space.s2),
        ) {
            when (ui.phase) {
                Phase.AVAILABLE -> Button(onClick = { AppUpdater.download(context) }) { Text("Herunterladen") }
                Phase.DOWNLOADING -> TextButton(onClick = AppUpdater::cancel) { Text("Abbrechen") }
                Phase.READY -> Button(onClick = { AppUpdater.install(context) }) { Text("Installieren") }
                else -> {}
            }
            if (ui.phase != Phase.DOWNLOADING) {
                OutlinedButton(onClick = { AppUpdater.check(installed) }, enabled = ui.phase != Phase.CHECKING) { Text("Nach Updates suchen") }
            }
        }
    }
}
