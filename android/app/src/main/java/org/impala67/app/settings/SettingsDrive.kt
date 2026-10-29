package org.impala67.app.settings

import android.text.format.Formatter
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.launch
import org.impala67.app.ImpalaApp
import org.impala67.app.sync.DriveConnect
import org.impala67.app.sync.DriveUi
import org.impala67.app.ui.theme.Impala
import org.impala67.app.ui.theme.Space
import uniffi.impala_ffi.driveSyncIntervalOptions
import java.time.Instant
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/**
 * Google Drive (settings-renderer.js `driveContent`). Anmeldung und Ablauf liegen in [org.impala67.app.sync.DriveController];
 * hier nur Anzeige und Eingabe. Meldungen gehen an [toast].
 */
@Composable
fun DriveSyncGroup(toast: (String) -> Unit) {
    val context = LocalContext.current
    val drive = (context.applicationContext as ImpalaApp).drive
    val ui by drive.ui.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    val live = ui.connected && !ui.needsLogin
    val label = when {
        ui.needsLogin -> "Neu anmelden"
        !ui.connected -> "Mit Google verbinden"
        else -> "Jetzt synchronisieren"
    }

    val consent = rememberLauncherForActivityResult(ActivityResultContracts.StartIntentSenderForResult()) { result ->
        scope.launch { toastConnect(drive.completeConsent(result.data), toast) }
    }
    val connect: () -> Unit = {
        scope.launch {
            when (val result = drive.connect()) {
                is DriveConnect.NeedsConsent -> consent.launch(IntentSenderRequest.Builder(result.intent).build())
                else -> toastConnect(result, toast)
            }
        }
    }

    SettingsGroup(
        "Google Drive",
        footnote = "Drive verwendet den privaten App-Speicher. OAuth-Zugriffstokens bleiben immer gerätelokal.",
    ) {
        DriveStatusBlock(ui)
        ui.message.takeIf { it.isNotBlank() }?.let {
            Text(it, style = MaterialTheme.typography.bodySmall, color = Impala.colors.text2,
                modifier = Modifier.padding(horizontal = Space.s4, vertical = Space.s2))
        }
        if (ui.running) {
            Column(Modifier.fillMaxWidth().padding(horizontal = Space.s4, vertical = Space.s2)) {
                if (ui.progress.isNotBlank()) {
                    Text(ui.progress, style = MaterialTheme.typography.bodySmall, color = Impala.colors.text2)
                }
                LinearProgressIndicator(Modifier.fillMaxWidth().padding(top = Space.s1))
            }
        }
        Row(
            Modifier.fillMaxWidth().padding(horizontal = Space.s4, vertical = Space.s2),
            horizontalArrangement = Arrangement.End,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (ui.connected || ui.needsLogin) {
                OutlinedButton(onClick = { scope.launch { drive.logout() } }) { Text("Abmelden") }
                Spacer(Modifier.size(Space.s2))
            }
            Button(
                enabled = !ui.running,
                onClick = { if (live) scope.launch { drive.sync() } else connect() },
            ) { Text(label) }
        }

        val limit = ui.limitBytes
        if (ui.connected && limit != null) {
            fun fmt(bytes: Double?): String = Formatter.formatShortFileSize(context, (bytes ?: 0.0).toLong())
            Text(
                "Speicher: ${fmt(ui.appBytes)} im App-Ordner · ${fmt(ui.usedBytes)} von ${fmt(limit)} belegt",
                style = MaterialTheme.typography.bodySmall,
                color = Impala.colors.text2,
                modifier = Modifier.padding(horizontal = Space.s4, vertical = Space.s2),
            )
        }
    }
}

/** Automatische Synchronisierung (settings-renderer.js `renderSync`, Gruppe „Automatische Synchronisierung“). */
@Composable
fun DriveAutomationGroup(vm: SettingsViewModel) {
    val values by vm.values.collectAsStateWithLifecycle()
    val s = values
    val options = remember { driveSyncIntervalOptions() }
    var menuOpen by remember { mutableStateOf(false) }
    // Standard wie policy::DEFAULT_SYNC_MINUTES (30 Minuten), wenn kein gültiger Wert gespeichert ist.
    val current = options.firstOrNull { it.minutes.toInt() == s?.driveAutoSyncMinutes }
        ?: options.firstOrNull { it.minutes == 30u } ?: options.first()

    SettingsGroup(
        "Automatische Synchronisierung",
        footnote = "Tipp: Bei aktivem Cloudflare-Sync reicht das tägliche Backup-Intervall völlig aus.",
    ) {
        SettingsRow(
            "Sync-Intervall",
            "Holt und sichert Daten regelmäßig, solange die App geöffnet ist",
            trailing = {
                Box {
                    TextButton(onClick = { menuOpen = true }) { Text(current.label) }
                    DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                        options.forEach { option ->
                            DropdownMenuItem(
                                text = { Text(option.label) },
                                onClick = {
                                    menuOpen = false
                                    vm.setDriveAutoSyncMinutes(option.minutes.toInt())
                                },
                            )
                        }
                    }
                }
            },
        )
        SettingsSwitchRow(
            "Nach jeder Änderung synchronisieren",
            "Sichert Änderungen nach kurzer Bündelung zusätzlich zum Intervall",
            s?.driveSyncAfterChange ?: false,
        ) { vm.setDriveSyncAfterChange(it) }
        // TODO(desk): „Tokens über Drive synchronisieren“ (settingsSet syncSecrets) fehlt bewusst: Beim
        // Ausschalten bereinigt die PWA auch alte Drive-Kopien (`impala67_drive_secret_scrub`); das fehlt nativ.
    }
}

/** Ergebnis von „Verbinden“: nur Meldung; ein Zustimmungsfenster startet der Aufrufer. */
private fun toastConnect(result: DriveConnect, toast: (String) -> Unit) {
    when (result) {
        DriveConnect.Done -> toast("Google Drive verbunden.")
        is DriveConnect.Error -> toast(result.message)
        is DriveConnect.NeedsConsent -> Unit
    }
}

/** Statuspunkt, Titel und Beschreibung (Muster von `StatusBlock` in SettingsCloudflare.kt). */
@Composable
private fun DriveStatusBlock(ui: DriveUi) {
    val dot: Color = when {
        ui.connected && !ui.needsLogin -> Impala.colors.accent
        ui.needsLogin -> Impala.colors.warn
        else -> Impala.colors.text2
    }
    val title = when {
        ui.connected && !ui.needsLogin -> "Verbunden"
        ui.needsLogin -> "Pausiert"
        else -> "Nicht verbunden"
    }
    val saved = formatSaved(ui.lastOk)?.let { "Zuletzt gesichert $it" }
    val detail = when {
        ui.connected && !ui.needsLogin -> listOfNotNull(ui.email.ifBlank { "Google Drive" }, saved).joinToString(" · ")
        ui.needsLogin -> listOfNotNull(saved, "Zum Weitersichern neu anmelden").joinToString(" · ")
        else -> "Google öffnet erst nach deinem Klick ein Anmeldefenster"
    }
    Row(
        Modifier.fillMaxWidth().padding(horizontal = Space.s4, vertical = Space.s3),
        verticalAlignment = Alignment.Top,
    ) {
        Box(Modifier.padding(top = 6.dp).size(10.dp).clip(CircleShape).background(dot))
        Column(Modifier.padding(start = Space.s3).weight(1f)) {
            Text(title, style = MaterialTheme.typography.titleSmall)
            Text(detail, style = MaterialTheme.typography.bodySmall, color = Impala.colors.text2)
        }
    }
}

private val SAVED_FORMAT = DateTimeFormatter.ofPattern("dd.MM.yyyy, HH:mm")

/** ISO-Zeit des letzten Syncs lokal formatiert; nicht lesbare Werte ergeben `null`. */
private fun formatSaved(iso: String?): String? {
    if (iso.isNullOrBlank()) return null
    val instant = runCatching { OffsetDateTime.parse(iso).toInstant() }.getOrNull()
        ?: runCatching { Instant.parse(iso) }.getOrNull()
        ?: return null
    return SAVED_FORMAT.format(instant.atZone(ZoneId.systemDefault()))
}
