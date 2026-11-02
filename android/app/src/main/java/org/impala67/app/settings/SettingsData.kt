package org.impala67.app.settings

import android.content.Context
import android.os.StatFs
import android.text.format.Formatter
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.impala67.app.ui.theme.Space
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** Belegter App-Speicher (Datenbank, Dateien, Cache) und frei auf dem Gerät, in Bytes. */
data class StorageUse(val used: Long, val free: Long)

/** Wie `navigator.storage.estimate()` der PWA, nur nativ: Größe der App-Ordner und freier Platz. */
suspend fun storageUse(context: Context): StorageUse = withContext(Dispatchers.IO) {
    fun size(f: File?): Long = f?.walkBottomUp()?.filter { it.isFile }?.sumOf { it.length() } ?: 0L
    StorageUse(size(context.filesDir) + size(context.cacheDir), StatFs(context.filesDir.path).availableBytes)
}

@Composable
fun rememberStorageUse(): StorageUse? {
    val context = LocalContext.current
    return produceState<StorageUse?>(null, context) { value = storageUse(context) }.value
}

fun formatBytes(context: Context, bytes: Long): String = Formatter.formatShortFileSize(context, bytes)

fun formatBackupTime(ms: Long): String = SimpleDateFormat("dd.MM.yyyy, HH:mm", Locale.GERMANY).format(Date(ms))

/** „Backup & Wiederherstellung“ (settings-renderer.js `renderSync` → `backup`). */
@Composable
fun BackupGroup(vm: SettingsViewModel, prefs: DevicePrefs) {
    val context = LocalContext.current
    val last by prefs.lastBackup.collectAsStateWithLifecycle(null)
    val export = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { uri ->
        if (uri != null) vm.exportBackup(context.contentResolver, uri)
    }
    val import = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) vm.importBackup(context.contentResolver, uri)
    }
    SettingsGroup("Backup & Wiederherstellung") {
        SettingsRow(
            "Vollständiges Backup",
            (last?.let { "Zuletzt ${formatBackupTime(it)} · " } ?: "") +
                "Event-Log und Dateien als JSON; Importe werden konfliktfrei zusammengeführt",
        )
        Row(
            Modifier.fillMaxWidth().padding(horizontal = Space.s4, vertical = Space.s2),
            horizontalArrangement = Arrangement.spacedBy(Space.s2, androidx.compose.ui.Alignment.End),
        ) {
            OutlinedButton(onClick = { import.launch(arrayOf("application/json", "text/plain", "*/*")) }) { Text("Importieren") }
            OutlinedButton(onClick = {
                export.launch("impala67-export-" + SimpleDateFormat("yyyy-MM-dd", Locale.ROOT).format(Date()) + ".json")
            }) { Text(if (last != null) "Backup erneut erstellen" else "Backup erstellen") }
        }
    }
}

/** „Lokaler Speicher“: belegter Platz der App und freier Platz auf dem Gerät. */
@Composable
fun StorageGroup() {
    val context = LocalContext.current
    val use = rememberStorageUse()
    SettingsGroup("Lokaler Speicher") {
        SettingsRow(
            "Verwendeter Speicher",
            use?.let { "${formatBytes(context, it.used)} belegt · ${formatBytes(context, it.free)} frei auf dem Gerät" }
                ?: "Wird berechnet …",
        )
        use?.let {
            LinearProgressIndicator(
                progress = { (it.used.toFloat() / (it.used + it.free).coerceAtLeast(1)).coerceIn(0.01f, 1f) },
                modifier = Modifier.fillMaxWidth().padding(horizontal = Space.s4, vertical = Space.s2),
            )
        }
    }
}

private enum class Danger(val title: String, val ok: String) {
    PAGES("Alle Seiten löschen", "Alles löschen"),
    CHATS("Alle Chats löschen", "Alle löschen"),
    CARDS("Alle Karteikarten löschen", "Alle löschen"),
}

/** „Gefahrenzone“ (settings-renderer.js `renderApp` → `danger`); jede Aktion fragt vorher nach. */
@Composable
fun DangerZoneGroup(vm: SettingsViewModel) {
    val counts by vm.counts.collectAsStateWithLifecycle()
    var ask by remember { mutableStateOf<Danger?>(null) }
    val chats = counts?.chats ?: 0
    val cards = counts?.cards ?: 0
    val decks = counts?.decks ?: 0

    SettingsGroup("Gefahrenzone") {
        SettingsRow(
            "Alle lokalen Seiten löschen", "Einstellungen, API-Keys, Chats und Karteikarten bleiben erhalten",
            trailing = { DangerButton("Seiten löschen", true) { ask = Danger.PAGES } },
        )
        SettingsRow(
            "Alle Chats löschen",
            if (chats > 0) "$chats ${if (chats == 1) "Chat" else "Chats"} · wird per Sync auch auf deinen anderen Geräten gelöscht"
            else "Keine gespeicherten Chats vorhanden",
            trailing = { DangerButton("Chats löschen", chats > 0) { ask = Danger.CHATS } },
        )
        SettingsRow(
            "Alle Karteikarten löschen",
            if (cards > 0 || decks > 0) "$cards ${if (cards == 1) "Karte" else "Karten"} in $decks ${if (decks == 1) "Stapel" else "Stapeln"} · samt Lernfortschritt"
            else "Keine Karteikarten vorhanden",
            trailing = { DangerButton("Karten löschen", cards > 0 || decks > 0) { ask = Danger.CARDS } },
        )
    }

    ask?.let { danger ->
        val text = when (danger) {
            Danger.PAGES -> "Möchtest du wirklich alle lokalen Seiten unwiderruflich löschen?\n\n" +
                "Deine Einstellungen, API-Keys, Karteikarten und Stapel bleiben erhalten. Bereits synchronisierte " +
                "Seiten können beim nächsten Sync zurückkommen."
            Danger.CHATS -> "$chats ${if (chats == 1) "Chat" else "Chats"} wirklich löschen? Die Löschung wird auch mit " +
                "deinen anderen Geräten synchronisiert und kann nicht rückgängig gemacht werden."
            Danger.CARDS -> if (cards > 0) {
                "Möchtest du wirklich alle $cards ${if (cards == 1) "Karteikarte" else "Karteikarten"} unwiderruflich löschen?\n\n" +
                    "Alle Karten, Stapel und Lernfortschritte werden gelöscht. Die Löschung wird auch mit deinen anderen Geräten synchronisiert."
            } else {
                "Möchtest du wirklich alle Stapel unwiderruflich löschen? Die Löschung wird auch mit deinen anderen Geräten synchronisiert."
            }
        }
        AlertDialog(
            onDismissRequest = { ask = null },
            title = { Text(danger.title) },
            text = { Text(text) },
            confirmButton = {
                TextButton(
                    onClick = {
                        ask = null
                        when (danger) {
                            Danger.PAGES -> vm.clearPages()
                            Danger.CHATS -> vm.deleteAllChats()
                            Danger.CARDS -> vm.deleteAllCards()
                        }
                    },
                    colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error),
                ) { Text(danger.ok) }
            },
            dismissButton = { TextButton(onClick = { ask = null }) { Text("Abbrechen") } },
        )
    }
}

@Composable
private fun DangerButton(label: String, enabled: Boolean, onClick: () -> Unit) {
    TextButton(
        onClick = onClick,
        enabled = enabled,
        colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error),
    ) { Text(label) }
}
