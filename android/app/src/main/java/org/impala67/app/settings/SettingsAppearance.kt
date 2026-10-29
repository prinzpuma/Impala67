package org.impala67.app.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import org.impala67.app.ui.theme.Impala
import org.impala67.app.ui.theme.Space

/** Darstellung (settings-renderer.js `renderAppearance`): Design, Lesbarkeit, Oberfläche. */
@Composable
fun AppearanceSettings(vm: SettingsViewModel, prefs: DevicePrefs) {
    val values by vm.values.collectAsStateWithLifecycle()
    val theme by prefs.themeMode.collectAsStateWithLifecycle(ThemeMode.SYSTEM)
    val accent by prefs.accent.collectAsStateWithLifecycle(AccentColor.BLUE)
    val density by prefs.density.collectAsStateWithLifecycle(Density.COMPACT)
    val fontScale by prefs.fontScale.collectAsStateWithLifecycle(FontScale.NORMAL)
    val reduceMotion by prefs.reduceMotion.collectAsStateWithLifecycle(false)
    val haptics by prefs.nativeHaptics.collectAsStateWithLifecycle(true)
    val s = values

    SettingsGroup("Design") {
        SettingsChoiceRow(
            title = "Erscheinungsbild",
            description = if (theme == ThemeMode.SYSTEM) "Folgt automatisch deinem Gerät" else "Manuell festgelegt",
            options = listOf(ThemeMode.SYSTEM to "System", ThemeMode.LIGHT to "Hell", ThemeMode.DARK to "Dunkel"),
            selected = theme,
            onSelect = { mode -> vm.setPref { setThemeMode(mode) } },
        )
        AccentRow(accent) { color -> vm.setPref { setAccent(color) } }
        SettingsChoiceRow(
            title = "Darstellungsdichte",
            description = "Bestimmt Abstände und Informationsdichte",
            options = listOf(Density.COMPACT to "Kompakt", Density.COMFORTABLE to "Komfortabel"),
            selected = density,
            onSelect = { d -> vm.setPref { setDensity(d) } },
        )
    }
    SettingsGroup("Lesbarkeit") {
        SettingsChoiceRow(
            title = "Schriftgröße",
            description = "Gilt appweit",
            options = listOf(FontScale.SMALL to "Klein", FontScale.NORMAL to "Normal", FontScale.LARGE to "Groß"),
            selected = fontScale,
            onSelect = { f -> vm.setPref { setFontScale(f) } },
        )
        SettingsSwitchRow(
            "Performance-Modus", "Für ältere Geräte: ohne Animationen, Milchglas-Effekte und Handschrift-Erkennung", reduceMotion,
        ) { on -> vm.setPref { setReduceMotion(on) } }
        SettingsSwitchRow(
            "Haptisches Feedback", "Taktile Vibrationen bei Aktionen, Werkzeugwechsel und Bewertungen", haptics,
        ) { on -> vm.setPref { setNativeHaptics(on) } }
    }
    // Tab-Anordnung entfällt nativ (Navigationsleiste oder Seitenleiste je Gerät). TODO(desk): Vorschläge
    // „+ Fach“ unter den Themen (aus den aktiven Notizen) fehlen, bis die Fächer-Auswertung nativ ist.
    SettingsGroup("Oberfläche") {
        SettingsTextField(
            label = "Begrüßungsname",
            stored = s?.userName ?: "",
            placeholder = "Optional",
            supporting = "Erscheint in der Begrüßung auf der Startseite",
            onCommit = { vm.saveUserName(it) },
        )
        SettingsSwitchRow(
            "Tagesartikel", "Die KI fasst deine Notizen einmal am Tag als kurzen Artikel auf der Startseite zusammen",
            s?.homeArticle ?: true,
        ) { vm.setHomeArticle(it) }
        SettingsSwitchRow(
            "Verwandte Seiten", "Zeigt unter jeder Notiz bis zu drei inhaltlich ähnliche Seiten (braucht das Embedding-Modell unter KI)",
            s?.relatedPages ?: true,
        ) { vm.setRelatedPages(it) }
        SettingsTextField(
            label = "Themen für den Tagesartikel",
            stored = s?.homeTopics ?: "",
            placeholder = "Automatisch",
            supporting = "Kommagetrennt, wechseln täglich. Leer = jeden Tag eines deiner aktiven Fächer",
            onCommit = { vm.saveHomeTopics(it) },
        )
    }
}

/** Akzentfarbe als Kreise (`.settings-accents` der PWA), mit Titel und Erläuterung wie `UI.row`. */
@Composable
private fun AccentRow(selected: AccentColor, onSelect: (AccentColor) -> Unit) {
    Column(
        Modifier.fillMaxWidth().padding(horizontal = Space.s4, vertical = Space.s3),
        verticalArrangement = Arrangement.spacedBy(Space.s2),
    ) {
        Text("Akzentfarbe", style = MaterialTheme.typography.titleMedium)
        Text(
            "Für Auswahl, Fokus und wichtige Aktionen",
            style = MaterialTheme.typography.bodySmall,
            color = Impala.colors.text2,
        )
        Row(horizontalArrangement = Arrangement.spacedBy(Space.s3)) {
            AccentColor.entries.forEach { color ->
                AccentSwatch(color, color == selected, ACCENT_LABELS.getValue(color)) { onSelect(color) }
            }
        }
    }
}

private val ACCENT_LABELS = mapOf(
    AccentColor.BLUE to "Blau", AccentColor.VIOLET to "Violett", AccentColor.GREEN to "Grün", AccentColor.ORANGE to "Orange",
)
