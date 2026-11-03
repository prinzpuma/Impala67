package org.impala67.app.settings

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import org.impala67.app.R
import org.impala67.app.ui.theme.Impala
import org.impala67.app.ui.theme.Radius
import org.impala67.app.ui.theme.Space
import org.impala67.app.ui.theme.TextSize
import java.text.Normalizer
import java.util.Locale

/** Ein Eintrag des Suchindex (settings-schema.js `SETTINGS_ITEMS`). */
data class SettingsItem(val section: String, val group: String, val label: String, val description: String, val keywords: String)

/** Die Einträge, die es in der App gibt (ohne reine Browser-Einträge wie die MCP-Live-Bridge). */
val SETTINGS_ITEMS = listOf(
    SettingsItem("overview", "Status", "App-Status", "KI, Sync, Backup, Speicher und Version auf einen Blick", "zustand start dashboard diagnose"),
    SettingsItem("appearance", "Design", "Erscheinungsbild", "System, Hell oder Dunkel", "theme modus mode dark light gerätemodus"),
    SettingsItem("appearance", "Design", "Akzentfarbe", "Farbe für aktive Elemente", "blau violett grün orange farbe"),
    SettingsItem("appearance", "Design", "Darstellungsdichte", "Kompakt oder komfortabel", "abstand platz layout"),
    SettingsItem("appearance", "Lesbarkeit", "Schriftgröße", "Klein, normal oder groß", "text schrift lesbar zoom"),
    SettingsItem("appearance", "Lesbarkeit", "Bewegung reduzieren", "Weniger Übergänge und Animationen, keine Handschrift-Erkennung", "animation motion barrierefreiheit performance handschrift erkennung speicher"),
    SettingsItem("appearance", "Lesbarkeit", "Haptisches Feedback", "Taktile Vibrationen bei Aktionen, Werkzeugwechsel und Bewertungen", "vibration haptik feedback touch motor"),
    SettingsItem("appearance", "Oberfläche", "Tab-Anordnung", "Horizontale Leiste oben oder vertikale Tabs in der Seitenleiste", "tabs leiste vertikal horizontal seitenleiste navigation anordnung"),
    SettingsItem("appearance", "Oberfläche", "Begrüßungsname", "Name in der Begrüßung auf der Startseite", "anzeigename profil startseite home"),
    SettingsItem("appearance", "Oberfläche", "Tagesartikel", "KI-Zusammenfassung deiner Notizen auf der Startseite", "artikel zusammenfassung ki startseite home täglich"),
    SettingsItem("appearance", "Oberfläche", "Verwandte Seiten", "Inhaltlich ähnliche Seiten unter jeder Notiz", "ähnlich verwandt vorschläge embedding notiz verknüpfung"),
    SettingsItem("appearance", "Oberfläche", "Themen für den Tagesartikel", "Themen, über die der Tagesartikel schreibt", "artikel themen fächer startseite"),
    SettingsItem("ai", "Aktives Modell", "Chat-Modell", "Aktives Modell suchen und auswählen", "llm modell provider quelle"),
    SettingsItem("ai", "Quellen", "KI-Quellen", "OpenAI, Gemini, LM Studio und eigene Endpunkte", "api key schlüssel token url endpoint anbieter"),
    SettingsItem("ai", "Verhalten", "Tools mitsenden", "Der KI die App-Werkzeuge zur Verfügung stellen", "werkzeuge tools funktionen"),
    SettingsItem("ai", "Verhalten", "Eigene Anweisungen", "Tonfall und dauerhafte Vorgaben", "prompt system text"),
    SettingsItem("learning", "Lernverhalten", "Lernverhalten", "Overlearning, Selbsteinschätzung und Lernanalyse", "karten telemetrie sicherheit confidence statistik"),
    SettingsItem("learning", "Lernverhalten", "Pausen-Erinnerung", "Erinnert nach 40 Minuten Lernen an eine kurze Pause", "pause karten lernzeit timer 40 min break reminder"),
    SettingsItem("sync", "Cloudflare Live-Sync", "Cloudflare Live-Sync", "Echtzeit-Synchronisierung mit Ende-zu-Ende-Verschlüsselung", "cloudflare echtzeit sync websocket live server speicher quota e2ee koppeln qr"),
    SettingsItem("sync", "Google Drive", "Google Drive", "Backup und Sync über den privaten App-Speicher", "google login konto cloud verbinden"),
    SettingsItem("sync", "Google Drive", "Automatische Synchronisierung", "Intervall und Sync nach Änderungen festlegen", "automatisch intervall minuten häufigkeit jede änderung"),
    SettingsItem("sync", "Backup", "Backup & Wiederherstellung", "Event-Log und Dateien exportieren oder importieren", "json sichern wiederherstellen import export"),
    SettingsItem("sync", "Backup", "Weitere Exporte", "Lerndaten und Markdown-Workspace exportieren", "telemetrie zip markdown rohdatei"),
    SettingsItem("app", "Speicher", "Lokaler Speicher", "Verwendeten Gerätespeicher anzeigen", "indexeddb quota größe"),
    SettingsItem("app", "Gerät", "Dokumenten-Scanner", "Google-Scanner oder Impala-Scanner verwenden", "scanner scannen kamera dokument google ml kit impala foto"),
    SettingsItem("app", "Experimente", "Beta-Design", "Platz zum Testen neuer Design-Ideen – aktuell ohne Wirkung", "beta ui design modern experimentell oberfläche layout heft stift werkzeugleiste"),
    SettingsItem("app", "Gefahrenzone", "Lokale Seiten löschen", "Alle lokalen Seiten unwiderruflich entfernen", "reset löschen zurücksetzen"),
    SettingsItem("app", "Gefahrenzone", "Alle Chats löschen", "Gespeicherte Chats auf diesem und synchronisierten Geräten entfernen", "chat verlauf unterhaltung löschen zurücksetzen"),
    SettingsItem("app", "Gefahrenzone", "Alle Karteikarten löschen", "Alle Karteikarten, Stapel und Lernfortschritte entfernen", "karteikarten anki karten stapel deck löschen zurücksetzen"),
    SettingsItem("app", "Für Entwickler", "Performance-Profiler", "Hänger, App- und KI-Fehler lokal protokollieren", "langsam hänger profiler long task diagnose ruckeln fehler ki debug protokoll entwickler"),
)

private val MARKS = Regex("\\p{M}+")
private val NON_WORD = Regex("[^a-z0-9]+")

/** Wie `normalize` in settings-schema.js: klein, ohne Akzente, nur Buchstaben und Ziffern. */
private fun normalize(v: String) = NON_WORD.replace(MARKS.replace(Normalizer.normalize(v.lowercase(Locale.GERMAN), Normalizer.Form.NFD), ""), " ").trim()

/** `searchSettings`: alle Wörter müssen vorkommen; Titelanfang zählt am meisten. */
fun searchSettings(query: String, limit: Int = 8): List<SettingsItem> {
    val terms = normalize(query).split(' ').filter { it.isNotEmpty() }
    if (terms.isEmpty()) return emptyList()
    return SETTINGS_ITEMS.mapNotNull { item ->
        val title = normalize(item.label)
        val section = SettingsSectionInfo.resolve(item.section).label
        val hay = normalize(listOf(item.label, item.description, item.group, item.keywords, section).joinToString(" "))
        if (!terms.all { hay.contains(it) }) return@mapNotNull null
        item to terms.sumOf { t -> if (title.startsWith(t)) 4 else if (title.contains(t)) 2 else 1 }
    }.sortedWith(compareByDescending<Pair<SettingsItem, Int>> { it.second }.thenBy { it.first.label }).take(limit).map { it.first }
}

/** Suchfeld der Übersicht mit höchstens acht Treffern; ein Treffer öffnet seinen Bereich. */
@Composable
fun SettingsSearchBox(onOpen: (String) -> Unit) {
    val c = Impala.colors
    var query by rememberSaveable { mutableStateOf("") }
    val hits = remember(query) { searchSettings(query) }
    Column(Modifier.fillMaxWidth().padding(bottom = Space.s4)) {
        OutlinedTextField(
            query, { query = it }, Modifier.fillMaxWidth(), singleLine = true,
            placeholder = { Text("Einstellungen suchen…") },
            leadingIcon = { Icon(painterResource(R.drawable.ic_i_search), null, Modifier.size(18.dp)) },
        )
        if (query.isNotBlank() && hits.isEmpty()) {
            Text("Keine Einstellung gefunden", Modifier.padding(Space.s3), color = c.text2, fontSize = TextSize.sm)
        }
        hits.forEach { item ->
            Row(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(Radius.md)).clickable { onOpen(item.section) }.padding(horizontal = Space.s3, vertical = Space.s2),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Text(item.label, color = c.text, fontSize = TextSize.base, fontWeight = FontWeight.SemiBold)
                    Text(SettingsSectionInfo.resolve(item.section).label + " · " + item.description, color = c.text2, fontSize = TextSize.xs)
                }
                Icon(painterResource(R.drawable.ic_i_chevron_right), null, Modifier.size(16.dp), tint = c.text2)
            }
        }
    }
}
