package org.impala67.app.settings

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import org.impala67.app.ImpalaApp
import org.impala67.app.sync.CloudSyncState
import org.impala67.app.ui.theme.Impala

/** Übersicht (settings-renderer.js `overviewTiles`): Status von KI, Sync, Backup, Speicher und Version. */
@Composable
fun OverviewSettings(vm: SettingsViewModel, prefs: DevicePrefs, onOpen: (String) -> Unit) {
    val context = LocalContext.current
    val app = context.applicationContext as ImpalaApp
    val values by vm.values.collectAsStateWithLifecycle()
    val cloud by app.cloudSync.ui.collectAsStateWithLifecycle()
    val drive by app.drive.ui.collectAsStateWithLifecycle()
    val last by prefs.lastBackup.collectAsStateWithLifecycle(null)
    val storage = rememberStorageUse()
    val version = appVersion()
    val c = Impala.colors

    val s = values
    val provider = s?.let { v -> v.providers.firstOrNull { it.id == v.providerId } ?: v.providers.firstOrNull() }
    val aiReady = s != null && s.model.isNotEmpty() && provider != null
    val cfOn = cloud.state in setOf(CloudSyncState.CONNECTED, CloudSyncState.SYNCING, CloudSyncState.CONNECTING)
    val (syncDot, syncText) = when {
        cfOn -> c.accent to "Cloudflare Live-Sync aktiv"
        drive.connected && !drive.needsLogin -> c.accent to (if (drive.email.isNotEmpty()) "Google Drive · ${drive.email}" else "Google Drive verbunden")
        drive.needsLogin -> c.warn to "Google Drive · zum Weitersichern neu anmelden"
        else -> c.text2 to "Noch nicht eingerichtet"
    }

    SettingsGroup("Status") {
        StatusRow(
            "KI", if (aiReady) provider!!.name.ifEmpty { provider.id } + " · " + s!!.model else "Noch kein Modell gewählt",
            if (aiReady) c.accent else c.text2, if (aiReady) "Konfigurieren" else "Einrichten",
        ) { onOpen("ai") }
        StatusRow("Sync", syncText, syncDot, if (syncText.startsWith("Noch")) "Einrichten" else "Verwalten") { onOpen("sync") }
        StatusRow(
            "Backup", last?.let { "Zuletzt ${formatBackupTime(it)}" } ?: "Noch kein lokales Backup",
            if (last != null) c.accent else c.warn, "Backup",
        ) { onOpen("sync") }
        StatusRow(
            "Speicher", storage?.let { "${formatBytes(context, it.used)} belegt · ${formatBytes(context, it.free)} frei" } ?: "Wird berechnet …",
            c.text2, "Verwalten",
        ) { onOpen("app") }
        StatusRow("App-Version", "v$version · Offline-App", c.accent, null) {}
    }
}

@Composable
private fun StatusRow(title: String, description: String, dot: Color, action: String?, onAction: () -> Unit) {
    ListItem(
        leadingContent = { Box(Modifier.size(10.dp).clip(CircleShape).background(dot)) },
        supportingContent = { Text(description) },
        trailingContent = action?.let { { TextButton(onClick = onAction) { Text(it) } } },
        colors = ListItemDefaults.colors(containerColor = Color.Transparent),
    ) { Text(title) }
}

/** App & Speicher (settings-renderer.js `renderApp`). */
@Composable
fun AppSettings(vm: SettingsViewModel, prefs: DevicePrefs) {
    val betaUi by prefs.betaUi.collectAsStateWithLifecycle(true)
    val version = appVersion()

    StorageGroup()
    UpdateGroup(version)
    val impalaScanner by prefs.impalaScanner.collectAsStateWithLifecycle(false)
    SettingsGroup("Gerät") {
        SettingsSwitchRow(
            "Impala-Scanner",
            if (impalaScanner) "Eigener Scanner mit Kamera, Auto-Scan, Ecken und Filtern" else "Aus: Dokumente mit dem Google-Scanner scannen",
            impalaScanner,
        ) { vm.setPref { setImpalaScanner(it) } }
    }
    SettingsGroup(
        "Experimente",
        footnote = "Experimente können sich noch ändern und gelten nur auf diesem Gerät.",
    ) {
        SettingsSwitchRow("Beta-Design", "Platz zum Testen neuer Design-Ideen – aktuell ohne Wirkung", betaUi) {
            vm.setPref { setBetaUi(it) }
        }
    }
    DangerZoneGroup(vm)
    // MCP-Live-Bridge entfällt nativ (PORTING § 8).
    org.impala67.app.diag.ProfilerGroup(prefs, version)
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
