package org.impala67.app.home

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextDecoration
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.impala67.app.ImpalaApp
import org.impala67.app.ui.theme.Impala
import org.impala67.app.ui.theme.Space
import org.impala67.app.ui.theme.TextSize
import uniffi.impala_ffi.DriveBackupLevel
import uniffi.impala_ffi.DriveBackupView
import uniffi.impala_ffi.driveBackupView

/**
 * Backup-Hinweis der Startseite (home-view.js `backupAlert`, backup-status.js): nur wenn Änderungen
 * dieses Geräts seit über 24 h nirgends gesichert sind. „Später“ blendet ihn 3 Tage (Sync hängt) bzw.
 * 14 Tage (gar kein Sync) aus. Den Zustand berechnet der Kern (`driveBackupView`).
 */
@Composable
fun BackupAlert(onSetup: () -> Unit, onToast: (String) -> Unit, modifier: Modifier = Modifier) {
    val c = Impala.colors
    val app = LocalContext.current.applicationContext as ImpalaApp
    val scope = rememberCoroutineScope()
    val snoozeUntil by app.prefs.backupSnoozeUntil.collectAsStateWithLifecycle(Long.MAX_VALUE)
    val drive by app.drive.ui.collectAsStateWithLifecycle()
    val cloud by app.cloudSync.ui.collectAsStateWithLifecycle()
    var view by remember { mutableStateOf<DriveBackupView?>(null) }
    var tick by remember { mutableIntStateOf(0) }
    // Neu berechnen bei Sync-Zuständen und jede Minute (die 24-h-Grenze läuft auch ohne Ereignis ab).
    LaunchedEffect(drive.running, drive.connected, drive.needsLogin, cloud.state, tick) {
        val store = app.store.await()
        val cf = app.cloudSync.uploadedSeq()
        view = withContext(Dispatchers.IO) {
            runCatching { driveBackupView(store.core, cf, drive.connected || drive.needsLogin, System.currentTimeMillis().toDouble()) }.getOrNull()
        }
        delay(60_000)
        tick++
    }
    val v = view ?: return
    if (!v.needsHint || snoozeUntil > System.currentTimeMillis()) return
    val stale = v.level == DriveBackupLevel.STALE
    Row(
        modifier.padding(top = Space.s4).fillMaxWidth().clip(CircleShape).background(c.alertBg).padding(start = Space.s4, end = Space.s1),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            if (stale) "Änderungen seit ${HomeText.whenText(v.unsafeSince.orEmpty())} sind noch nicht gesichert."
            else "Deine Notizen liegen bisher nur auf diesem Gerät.",
            fontSize = TextSize.sm, color = c.alertText, modifier = Modifier.weight(1f).padding(vertical = Space.s2),
        )
        TextButton({
            if (!stale) onSetup() else scope.launch {
                // Bewusster Klick: Cloudflare sofort abgleichen, Drive synchronisieren (BACKUP.backupNow).
                app.cloudSync.syncNow()
                if (drive.connected) app.drive.sync()
                onToast("Sicherung gestartet.")
                tick++
            }
        }) { Text(if (stale) "Jetzt sichern" else "Sync einrichten", fontSize = TextSize.sm, color = c.alertText, textDecoration = TextDecoration.Underline) }
        TextButton({ scope.launch { app.prefs.setBackupSnoozeUntil(System.currentTimeMillis() + v.snoozeMs.toLong()) } }) {
            Text("Später", fontSize = TextSize.sm, color = c.alertText.copy(alpha = 0.75f))
        }
    }
}
