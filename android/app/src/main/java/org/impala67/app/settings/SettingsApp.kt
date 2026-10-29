package org.impala67.app.settings

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.collectAsStateWithLifecycle

/** Übersicht (settings-renderer.js `renderOverview`): Status der Bereiche, bis deren Module stehen. */
@Composable
fun OverviewSettings() {
    val version = appVersion()
    // TODO(desk): Werte der Kacheln (KI-Modell, Sync- und Drive-Status, letztes Backup, Speicher) folgen
    // mit ihren Modulen; die Zustände liegen nativ in CloudSyncController und DriveController.
    SettingsGroup("Status") {
        SettingsPlaceholderRow("KI", "Folgt mit dem KI-Modul")
        SettingsPlaceholderRow("Sync", "Folgt mit dem Sync-Modul")
        SettingsPlaceholderRow("Backup", "Folgt mit dem Sync-Modul")
        SettingsPlaceholderRow("Speicher", "Folgt mit dem Speicher-Modul")
        SettingsRow("App-Version", "v$version · Offline-App")
    }
}

/** App & Speicher (settings-renderer.js `renderApp`). Löschen und Speicherwerte folgen mit ihren Modulen. */
@Composable
fun AppSettings(vm: SettingsViewModel, prefs: DevicePrefs) {
    val betaUi by prefs.betaUi.collectAsStateWithLifecycle(true)
    val version = appVersion()

    SettingsGroup("Lokaler Speicher") {
        SettingsPlaceholderRow("Verwendeter Speicher", "Anzeige folgt mit dem Speicher-Modul")
    }
    SettingsGroup("App-Updates") {
        SettingsRow(
            "App-Version",
            "Updates werden nur auf Wunsch geprüft",
            trailing = { Text("Installiert v$version", style = MaterialTheme.typography.bodyMedium) },
        )
        // TODO(desk): „Verfügbar“-Wert und Prüfen-Schaltfläche folgen mit dem Release-Modul (APK-Update).
    }
    SettingsGroup("Gerät") {
        // TODO(desk): Scanner-Auswahl (Google-Scanner oder Impala-Scanner) – nativ gibt es nur den Google-Scanner.
        SettingsPlaceholderRow("Dokumenten-Scanner", "Google-Scanner oder Impala-Scanner folgen mit dem Heft-Modul")
    }
    SettingsGroup(
        "Experimente",
        footnote = "Experimente können sich noch ändern und gelten nur auf diesem Gerät.",
    ) {
        SettingsSwitchRow("Beta-Design", "Platz zum Testen neuer Design-Ideen – aktuell ohne Wirkung", betaUi) {
            vm.setPref { setBetaUi(it) }
        }
    }
    SettingsGroup("Gefahrenzone") {
        SettingsPlaceholderRow("Alle lokalen Seiten löschen", "Folgt mit dem Datenmodul")
        SettingsPlaceholderRow("Alle Chats löschen", "Folgt mit dem KI-Modul")
        SettingsPlaceholderRow("Alle Karteikarten löschen", "Folgt mit dem Lern-Modul")
    }
    // MCP-Live-Bridge entfällt nativ (PORTING § 8); der Profiler folgt über Android-Profiler und Logcat.
    SettingsGroup("Für Entwickler") {
        SettingsPlaceholderRow("Performance-Profiler", "Folgt (Android-Profiler und Logcat)")
    }
}

/** Versionsname aus dem Paket (ohne BuildConfig). */
@Suppress("DEPRECATION")
@Composable
private fun appVersion(): String {
    val context: Context = LocalContext.current
    return remember(context) {
        runCatching {
            val info = if (Build.VERSION.SDK_INT >= 33) {
                context.packageManager.getPackageInfo(context.packageName, PackageManager.PackageInfoFlags.of(0))
            } else {
                context.packageManager.getPackageInfo(context.packageName, 0)
            }
            info.versionName
        }.getOrNull() ?: "unbekannt"
    }
}
