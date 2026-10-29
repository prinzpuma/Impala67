package org.impala67.app.settings

import android.content.ClipData
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
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.launch
import org.impala67.app.ImpalaApp
import org.impala67.app.sync.CloudSyncState
import org.impala67.app.sync.CloudSyncUi
import org.impala67.app.sync.SyncProgress
import org.impala67.app.ui.theme.Impala
import org.impala67.app.ui.theme.Space

/**
 * Cloudflare Live-Sync (settings-renderer.js `cloudflareContent`). Der Ablauf liegt im Rust-Kern;
 * hier nur Anzeige und Eingabe über [CloudSyncController]. Meldungen gehen an [toast].
 */
@Composable
fun CloudflareSyncGroup(toast: (String) -> Unit) {
    val cloud = (LocalContext.current.applicationContext as ImpalaApp).cloudSync
    val ui by cloud.ui.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    val clipboard = LocalClipboard.current
    var url by remember(ui.url) { mutableStateOf(ui.url) }
    var syncKey by remember(ui.syncKey) { mutableStateOf(ui.syncKey) }
    var confirmPurge by remember { mutableStateOf(false) }
    val busy = ui.state == CloudSyncState.CONNECTING || ui.state == CloudSyncState.SYNCING

    SettingsGroup(
        "Cloudflare Live-Sync",
        footnote = "100 % Ende-zu-Ende verschlüsselt (AES-GCM 256-Bit). Der Server sieht niemals Klartext-Notizen.",
    ) {
        StatusBlock(ui)
        Row(
            Modifier.fillMaxWidth().padding(horizontal = Space.s4, vertical = Space.s2),
            horizontalArrangement = Arrangement.End,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (ui.active) {
                OutlinedButton(onClick = { scope.launch { cloud.disconnect() } }) { Text("Trennen") }
                Spacer(Modifier.size(Space.s2))
            }
            Button(
                enabled = !busy,
                onClick = {
                    if (ui.active) {
                        cloud.syncNow()
                    } else {
                        scope.launch { cloud.configure(url, syncKey)?.let(toast) }
                    }
                },
            ) { Text(if (ui.active) "Jetzt synchronisieren" else "Verbinden") }
        }

        ui.progress?.takeIf { ui.state == CloudSyncState.SYNCING && it.total > 0 }?.let { ProgressBlock(it) }

        OutlinedTextField(
            value = url,
            onValueChange = { url = it },
            label = { Text("Cloudflare Worker URL") },
            placeholder = { Text("https://impala67-sync.<account>.workers.dev") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth().padding(horizontal = Space.s4, vertical = Space.s2),
        )
        OutlinedTextField(
            value = syncKey,
            onValueChange = { syncKey = it },
            label = { Text("Sync-Schlüssel (E2EE)") },
            placeholder = { Text("impala-xxxx-xxxx-xxxx-xxxx") },
            singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
            modifier = Modifier.fillMaxWidth().padding(horizontal = Space.s4, vertical = Space.s2),
        )
        if (syncKey.isBlank()) {
            Row(Modifier.fillMaxWidth().padding(horizontal = Space.s4), horizontalArrangement = Arrangement.End) {
                OutlinedButton(onClick = {
                    syncKey = cloud.newKey()
                    toast("Neuer Sync-Schlüssel generiert. Kopiere ihn auf deine anderen Geräte!")
                }) { Text("Schlüssel generieren") }
            }
        } else {
            Row(Modifier.fillMaxWidth().padding(horizontal = Space.s4), horizontalArrangement = Arrangement.End) {
                OutlinedButton(onClick = {
                    scope.launch {
                        clipboard.setClipEntry(ClipEntry(ClipData.newPlainText("Sync-Schlüssel", syncKey.trim())))
                        toast("Sync-Schlüssel in die Zwischenablage kopiert.")
                    }
                }) { Text("Schlüssel kopieren") }
            }
        }

        SettingsRow(
            "Cloud-Speicher",
            "Verwendeter Speicherplatz auf deinem Cloudflare Sync-Server",
            trailing = { Text(ui.usage, style = MaterialTheme.typography.bodyMedium, color = Impala.colors.text2) },
        )
        if (ui.configured) {
            SettingsRow(
                "Cloud-Daten löschen",
                "Löscht den synchronisierten Datenstand auf dem Cloudflare-Server",
                trailing = {
                    TextButton(
                        onClick = { confirmPurge = true },
                        colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error),
                    ) { Text("Cloud-Stand leeren") }
                },
            )
        }
    }

    if (confirmPurge) {
        AlertDialog(
            onDismissRequest = { confirmPurge = false },
            title = { Text("Cloud-Daten löschen") },
            text = {
                Text("Möchtest du wirklich alle synchronisierten Daten auf dem Cloudflare-Server löschen?\n\n" +
                    "Deine lokalen Daten auf diesem Gerät bleiben vollständig erhalten.")
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        confirmPurge = false
                        scope.launch { cloud.resetCloud()?.let(toast) }
                    },
                    colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error),
                ) { Text("Cloud leeren") }
            },
            dismissButton = { TextButton(onClick = { confirmPurge = false }) { Text("Abbrechen") } },
        )
    }
}

/** Statuspunkt, Titel und Beschreibung. */
@Composable
private fun StatusBlock(ui: CloudSyncUi) {
    val dot: Color = when (ui.state) {
        CloudSyncState.CONNECTED -> Impala.colors.accent
        CloudSyncState.CONNECTING, CloudSyncState.SYNCING -> Impala.colors.warn
        CloudSyncState.ERROR -> MaterialTheme.colorScheme.error
        CloudSyncState.DISCONNECTED -> Impala.colors.text2
    }
    Row(
        Modifier.fillMaxWidth().padding(horizontal = Space.s4, vertical = Space.s3),
        verticalAlignment = Alignment.Top,
    ) {
        Box(Modifier.padding(top = 6.dp).size(10.dp).clip(CircleShape).background(dot))
        Column(Modifier.padding(start = Space.s3).weight(1f)) {
            Text(ui.label, style = MaterialTheme.typography.titleSmall)
            Text(ui.detail, style = MaterialTheme.typography.bodySmall, color = Impala.colors.text2)
        }
    }
}

/** Fortschritt eines laufenden Durchgangs: Etikett und Prozent darüber, dann der Balken. */
@Composable
private fun ProgressBlock(progress: SyncProgress) {
    Column(Modifier.fillMaxWidth().padding(horizontal = Space.s4, vertical = Space.s2)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(
                progress.label.ifBlank { "Synchronisiere …" },
                style = MaterialTheme.typography.bodySmall,
                color = Impala.colors.text2,
            )
            Text("${progress.percent} %", style = MaterialTheme.typography.bodySmall, color = Impala.colors.text2)
        }
        LinearProgressIndicator(
            progress = { progress.percent / 100f },
            modifier = Modifier.fillMaxWidth().padding(top = Space.s1),
        )
    }
}
