package org.impala67.app.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import org.impala67.app.ui.theme.Space

/** Lernen (settings-renderer.js `renderLearning`): Lernverhalten, Beta-Funktionen, Controller. */
@Composable
fun LearningSettings(vm: SettingsViewModel, prefs: DevicePrefs) {
    val overlearn by prefs.overlearn.collectAsStateWithLifecycle(true)
    val confidence by prefs.confidence.collectAsStateWithLifecycle(false)
    val telemetry by prefs.telemetry.collectAsStateWithLifecycle(true)
    val breakReminder by prefs.breakReminder.collectAsStateWithLifecycle(true)
    val weekGoal by prefs.weekGoalMinutes.collectAsStateWithLifecycle(300)

    SettingsGroup("Lernverhalten") {
        SettingsSwitchRow("Overlearning-Sperre", "Verhindert sofortiges Wiederholen frisch bewerteter Karten", overlearn) {
            vm.setPref { setOverlearn(it) }
        }
        SettingsSwitchRow(
            "Selbsteinschätzung abfragen",
            if (confidence) "Du bewertest deine Sicherheit bewusst" else "Die App schätzt Sicherheit aus der Antwortzeit",
            confidence,
        ) { vm.setPref { setConfidence(it) } }
        SettingsSwitchRow(
            "Lernanalyse aufzeichnen",
            "Speichert Lernzeiten und Bewertungen für Statistik und Lernanalyse – nur auf deinen eigenen Geräten",
            telemetry,
        ) { vm.setPref { setTelemetry(it) } }
        SettingsSwitchRow("Pausen-Erinnerung", "Erinnert nach 40 Minuten Lernen an eine kurze Pause", breakReminder) {
            vm.setPref { setBreakReminder(it) }
        }
        WeekGoalRow(weekGoal) { vm.setPref { cycleWeekGoal() } }
    }
    SettingsGroup(
        "Beta-Lernfunktionen",
        footnote = "Beta-Funktionen sind standardmäßig aus und lassen sich einzeln aktivieren.",
    ) {
        SettingsPlaceholderRow("Beta-Lernfunktionen", "Folgt mit dem Lern-Modul (Feynman, Fehlerhinweise, Multiple Choice)")
    }
    SettingsGroup("Controller") {
        SettingsPlaceholderRow("Mit Controller lernen", "Gamepad, Tastenhinweise, Vibration und Tastenbelegung folgen mit dem Lern-Modul")
    }
}

/** Wochenziel wie `cycleGoal` in lernzeit.js: Die Schaltfläche springt zur nächsten Stufe. */
@Composable
private fun WeekGoalRow(minutes: Int, onCycle: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = Space.s4, vertical = Space.s3),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text("Wochenziel", style = MaterialTheme.typography.titleMedium)
        Button(onClick = onCycle) { Text(formatHours(minutes)) }
    }
}

/** 120 → „2 h“, 480 → „8 h“. */
internal fun formatHours(minutes: Int): String =
    if (minutes % 60 == 0) "${minutes / 60} h" else "%.1f h".format(minutes / 60.0)
