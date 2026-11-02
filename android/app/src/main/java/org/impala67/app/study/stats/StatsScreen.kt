package org.impala67.app.study.stats

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import org.impala67.app.core.ImpalaStore
import org.impala67.app.settings.DevicePrefs
import org.impala67.app.study.CardEditorSheet
import org.impala67.app.ui.theme.Impala
import org.impala67.app.ui.theme.Radius
import org.impala67.app.ui.theme.Space
import org.impala67.app.ui.theme.TextSize
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale

/** Statistik-Tab der Karteikarten (anki-stats.js `statsPageHtml` + lernmuster.js `statsHtml`). */
@Composable
fun StatsScreen(store: ImpalaStore, prefs: DevicePrefs, onToast: (String) -> Unit, modifier: Modifier = Modifier) {
    val vm = viewModel { StatsViewModel(store, prefs) }
    val view by vm.view.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    var editing by remember { mutableStateOf<Pair<String, String>?>(null) }
    val c = Impala.colors
    val v = view ?: return
    val d = v.stats
    val today = LocalDate.now()
    Box(modifier.fillMaxSize().background(c.panel), contentAlignment = Alignment.TopCenter) {
        Column(Modifier.widthIn(max = 860.dp).fillMaxWidth().verticalScroll(rememberScrollState()).padding(Space.s5)) {
            Text(d.lead, color = c.text, fontSize = TextSize.md)
            Row(Modifier.fillMaxWidth().padding(top = Space.s3), horizontalArrangement = Arrangement.spacedBy(Space.s2)) {
                Kpi("Trefferquote", d.rate?.let(::pct) ?: "—", d.trendNote)
                Kpi("Wiederholungen", "${d.last}", "Ø " + String.format(Locale.GERMAN, "%.1f", d.avg) + " pro Tag")
                Kpi("Reife Karten", "${d.reif}", "Intervall ab 3 Wochen · von ${d.gelernt} gelernten")
                Kpi("Denkzeit", if (d.thinkMs > 0) String.format(Locale.GERMAN, "%.1f s", d.thinkMs / 1000.0) else "—", "Median pro Karte")
            }
            if (d.n > 0) {
                Section("Lernbestand", "${d.n} Karten, nach Stand")
                StackBar(
                    listOf(
                        Triple("Neu", d.bestand.neu, c.accent),
                        Triple("Lernen", d.bestand.lernen, c.warn),
                        Triple("Wiederholen", d.bestand.wiederholen, c.success),
                        Triple("Ausgesetzt", d.bestand.ausgesetzt, c.text2.copy(alpha = 0.5f)),
                    ),
                )
            }
            val short = DateTimeFormatter.ofPattern("d. MMM", Locale.GERMAN)
            Section("Wiederholungen — letzte 30 Tage", d.peak?.let { "Spitze: ${it.n} am ${it.day.format(short)}." }.orEmpty())
            BarChart(d.series.map { it.n.toFloat() }, d.series.map { "${it.day.dayOfMonth}" })
            Section("Prognose — nächste 7 Tage", "Fällige Karten pro Tag. „Heute“ enthält auch alles Überfällige.")
            BarChart(d.forecast.map { it.n.toFloat() }, d.forecast.map { it.label }, top = d.forecast.map { "${it.n}" })
            if (d.decks.size >= 2) {
                Section("Stapel", "Trefferquote der letzten 30 Tage; ab $MIN_N Abfragen pro Stapel.")
                SimpleTable(
                    listOf("Stapel", "Karten", "Fällig", "Reif", "Trefferquote"),
                    d.decks.map { listOf(it.name, "${it.n}", "${it.due}", if (it.n > 0) "${it.reif * 100 / it.n} %" else "—", "") },
                ) { r, _ ->
                    val rate = d.decks[r].rate
                    if (rate == null) Text("—", color = c.text2, fontSize = TextSize.sm) else Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        Meter(rate, Modifier.weight(1f))
                        Text(pct(rate), color = c.text, fontSize = TextSize.xs)
                    }
                }
            }
            if (d.hard.isNotEmpty()) {
                Section("Schwierigste Karten", "Am häufigsten vergessen. Ein Klick öffnet die Karte zum Bearbeiten.")
                d.hard.forEach { card ->
                    val front = card.front.replace(Regex("\\{\\{c\\d+::|\\}\\}"), "").replace(Regex("\\s+"), " ").trim()
                    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(front.ifEmpty { "Ohne Vorderseite" }, color = c.text, fontSize = TextSize.sm, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                            Text("${card.deck} · ${card.lapses}× vergessen · Intervall ${maxOf(1, card.stability.toInt())} T", color = c.text2, fontSize = TextSize.xs)
                        }
                        TextButton({ editing = card.id to card.deck }) { Text("Bearbeiten") }
                    }
                }
            }
            Section("Behalten nach Wiederholungsabstand", "Wie oft eine Karte richtig war, wenn sie nach etwa so vielen Tagen wieder auftauchte.")
            val rt = d.retention
            SimpleTable(
                listOf("Abstand", "Wiederholungen", "Richtig"),
                listOf("ca. 1 Tag" to rt.day1, "ca. 3 Tage" to rt.day3, "ca. 7 Tage" to rt.day7, "ca. 14 Tage" to rt.day14)
                    .map { (l, b) -> listOf(l, "${b.n}", b.rate?.let(::pct) ?: "—") },
            )
            Section("Aktivität — letzte 12 Monate", "Serie: " + plural(d.streakCurrent, "Tag", "Tage") + " aktuell · längste " + plural(d.streakLongest, "Tag", "Tage") + ".")
            Heatmap(d.perDay, today)
            Patterns(v, busy) { id -> vm.cardFromPage(id, onToast) }
        }
    }
    editing?.let { (id, deck) -> CardEditorSheet(store, id, deck, onDismiss = { editing = null }, onSaved = {}) }
}

@Composable
private fun androidx.compose.foundation.layout.RowScope.Kpi(label: String, value: String, note: String) {
    val c = Impala.colors
    Column(
        Modifier.weight(1f).clip(RoundedCornerShape(Radius.md)).background(c.surface).padding(Space.s3),
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Text(label, color = c.text2, fontSize = TextSize.xs)
        Text(value, color = c.text, fontSize = TextSize.lg, fontWeight = FontWeight.SemiBold)
        Text(note, color = c.text2, fontSize = TextSize.xs2)
    }
}

/** Lern-Analyse (lernmuster.js): Beobachtungen, keine Regeln. */
@Composable
private fun Patterns(v: StatsView, busy: String?, onCard: (String) -> Unit) {
    val c = Impala.colors
    val p = v.patterns
    Section("Lern-Analyse", "Beobachtungen aus deinem Lernverlauf: Muster zum Prüfen, keine Regeln.")
    if (p.empty) {
        Note("Noch zu wenig Telemetrie — nach ein paar Lerntagen erscheinen hier Sitzungsverlauf × Erfolg, die Tageszeit-Analyse, Experimente × Bewertung und Problemzonen mit 1-Klick-Kartenerstellung.")
        return
    }
    if (p.position.size >= 2 || p.timer.isNotEmpty()) {
        Section("Sitzungsverlauf × Erfolg")
        SimpleTable(listOf("Abschnitt", "Reviews", "richtig"), (p.position + p.timer).map { listOf(it.label, "${it.n}", pct(it.rate)) })
        Note("Beobachtung, keine Regel — Tageszeit, Fach und Schwierigkeit sind nicht herausgerechnet.")
    }
    p.hours?.let { hours ->
        Section("Erfolgsquote nach Tageszeit", "Höhe = Anteil richtiger Antworten. Stunden mit unter 8 Reviews bleiben leer. Als Tendenz lesen, nicht als Stundenplan.")
        BarChart(hours.map { if (it.n >= 8) maxOf(0.04f, it.rate.toFloat()) else 0f }, hours.map { if (it.hour % 6 == 0) "${it.hour}" else "" })
    }
    if (p.experiments.isNotEmpty()) {
        Section("Experimente × Bewertung")
        SimpleTable(listOf("Experiment", "Reviews", "Ø Bewertung"), p.experiments.map { listOf(it.label, "${it.n}", String.format(Locale.GERMAN, "%.2f", it.average)) })
        Note("Skala: 1 = Nochmal, 2 = Schwer, 3 = Gut, 4 = Einfach. Vorsicht bei der Deutung: Hinweise & Co. laufen eher auf schweren Karten — Unterschiede sind Beobachtungen, keine Wirkungsnachweise.")
    }
    if (p.problems.isNotEmpty()) {
        Section("Problemzonen (viel Lesezeit)")
        p.problems.forEach { x ->
            Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(v.titles[x.pageId].orEmpty().ifBlank { "Ohne Titel" }, color = c.text, fontSize = TextSize.sm, fontWeight = FontWeight.SemiBold)
                    Text("${x.minutes} min gelesen · ${x.lost}× App gewechselt", color = c.text2, fontSize = TextSize.xs)
                }
                TextButton({ onCard(x.pageId) }, enabled = busy == null) { Text(if (busy == x.pageId) "…" else "＋ Karte") }
            }
        }
        Note("Viel Wiederlesen + häufige App-Wechsel = Kandidat für aktives Abrufen. ＋ legt eine Abruf-Karte im Stapel „Problemzonen“ an.")
    }
}

@Composable
private fun Note(text: String) = Text(text, Modifier.padding(top = Space.s1), color = Impala.colors.text2, fontSize = TextSize.xs)
