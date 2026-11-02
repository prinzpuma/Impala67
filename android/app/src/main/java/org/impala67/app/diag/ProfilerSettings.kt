package org.impala67.app.diag

import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.impala67.app.settings.DevicePrefs
import org.impala67.app.settings.SettingsGroup
import org.impala67.app.settings.SettingsRow
import org.impala67.app.settings.SettingsSwitchRow
import org.impala67.app.ui.theme.Space
import java.time.LocalDate

/** „Für Entwickler“ (performance-profiler-settings.js): Schalter, Zähler, Kopieren, JSON-Export, Löschen. */
@Composable
fun ProfilerGroup(prefs: DevicePrefs, version: String) {
    val context = LocalContext.current
    val clipboard = LocalClipboardManager.current
    val scope = rememberCoroutineScope()
    val on by prefs.profiler.collectAsStateWithLifecycle(false)
    val count by Profiler.count.collectAsStateWithLifecycle()
    val toast = { text: String -> Toast.makeText(context, text, Toast.LENGTH_SHORT).show() }
    val export = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { uri ->
        if (uri != null) scope.launch {
            runCatching { withContext(Dispatchers.IO) { context.contentResolver.openOutputStream(uri, "wt")!!.use { it.write(Profiler.report(version).toByteArray()) } } }
                .onSuccess { toast("Performance-Diagnose gespeichert.") }.onFailure { toast("Speichern fehlgeschlagen.") }
        }
    }
    SettingsGroup("Für Entwickler") {
        SettingsSwitchRow("Performance-Profiler", "Misst Hänger, Start, Kern-Aufrufe und Fehler – nur auf diesem Gerät", on) { v ->
            scope.launch { prefs.setProfiler(v) }
            Profiler.allPoints = false
        }
        SettingsRow("Modus", if (Profiler.allPoints) "Alle Messpunkte" else "Auffälligkeiten") {
            OutlinedButton({ Profiler.allPoints = !Profiler.allPoints }, enabled = on) { Text(if (Profiler.allPoints) "Nur Auffälligkeiten" else "Alle Messpunkte") }
        }
        SettingsRow("Protokoll", "${count.first} Auffälligkeiten / ${count.second} Messpunkte")
        FlowRow(Modifier.fillMaxWidth().padding(horizontal = Space.s4, vertical = Space.s2), horizontalArrangement = Arrangement.spacedBy(Space.s2)) {
            OutlinedButton({ clipboard.setText(AnnotatedString(Profiler.report(version))); toast("Performance-Diagnose kopiert.") }, enabled = count.second > 0) { Text("Diagnose kopieren") }
            OutlinedButton({ export.launch("impala67-performance-${LocalDate.now()}.json") }, enabled = count.second > 0) { Text("JSON exportieren") }
            OutlinedButton({ Profiler.clear(); toast("Protokoll gelöscht.") }, enabled = count.second > 0) { Text("Protokoll löschen") }
        }
    }
}
