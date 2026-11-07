package org.impala67.app.study.stats

import java.time.DayOfWeek
import java.time.LocalDate
import java.time.format.TextStyle
import java.time.temporal.TemporalAdjusters
import java.util.Locale
import kotlin.math.abs
import kotlin.math.roundToInt
import uniffi.impala_ffi.LearningStats

const val REIF_TAGE = 21
const val MIN_N = 10

data class Bestand(val neu: Int, val lernen: Int, val wiederholen: Int, val ausgesetzt: Int)
data class DeckRow(val name: String, val n: Int, val due: Int, val reif: Int, val rate: Double?)
data class DayCount(val day: LocalDate, val n: Int)
data class Forecast(val label: String, val n: Int)
data class Bucket(val n: Int, val rate: Double?)
data class Retention(val day1: Bucket, val day3: Bucket, val day7: Bucket, val day14: Bucket)

/** Alle Kennzahlen des Statistik-Tabs (anki-stats.js `statsData`). */
data class StatsData(
    val reviewsAll: Int,
    val last: Int,
    val rate: Double?,
    val trend: Int?,
    val avg: Double,
    val bestand: Bestand,
    val n: Int,
    val reif: Int,
    val gelernt: Int,
    val decks: List<DeckRow>,
    val series: List<DayCount>,
    val peak: DayCount?,
    val forecast: List<Forecast>,
    val perDay: Map<LocalDate, Int>,
    val streakCurrent: Int,
    val streakLongest: Int,
    val hard: List<SCard>,
    val thinkMs: Long,
    val retention: Retention,
) {
    companion object {
        fun from(stats: LearningStats, today: LocalDate = LocalDate.now()): StatsData {
            val perDay = stats.heatmap.associate { LocalDate.parse(it.date) to it.n.toInt() }
            val series = stats.series.map { DayCount(LocalDate.parse(it.date), it.n.toInt()) }
            val peak = if (stats.peak.n > 0u) DayCount(LocalDate.parse(stats.peak.date), stats.peak.n.toInt()) else null
            val forecast = stats.forecast.map { f ->
                val offset = f.dayOffset.toLong()
                val label = if (offset == 0L) "Heute" else today.plusDays(offset).dayOfWeek.getDisplayName(TextStyle.SHORT, Locale.GERMAN)
                Forecast(label, f.n.toInt())
            }
            val decks = stats.decks.map { DeckRow(it.name, it.n.toInt(), it.due.toInt(), it.reif.toInt(), it.rate) }
            val hard = stats.hard.map { SCard(it.id, it.front, it.deck, null, "review", it.stability, it.lapses.toInt(), null, false) }
            val retention = Retention(
                Bucket(stats.retention.day1.n.toInt(), stats.retention.day1.rate),
                Bucket(stats.retention.day3.n.toInt(), stats.retention.day3.rate),
                Bucket(stats.retention.day7.n.toInt(), stats.retention.day7.rate),
                Bucket(stats.retention.day14.n.toInt(), stats.retention.day14.rate),
            )
            val bestand = Bestand(
                stats.bestand.neu.toInt(),
                stats.bestand.lernen.toInt(),
                stats.bestand.wiederholen.toInt(),
                stats.bestand.ausgesetzt.toInt(),
            )
            return StatsData(
                reviewsAll = stats.reviewsAll.toInt(),
                last = stats.last.toInt(),
                rate = stats.rate,
                trend = stats.trend,
                avg = stats.avg,
                bestand = bestand,
                n = stats.n.toInt(),
                reif = stats.reif.toInt(),
                gelernt = stats.gelernt.toInt(),
                decks = decks,
                series = series,
                peak = peak,
                forecast = forecast,
                perDay = perDay,
                streakCurrent = stats.streakCurrent.toInt(),
                streakLongest = stats.streakLongest.toInt(),
                hard = hard,
                thinkMs = stats.thinkMs,
                retention = retention,
            )
        }
    }

    /** Lead-Satz (anki-stats.js `leadText`). */
    val lead: String
        get() {
            if (reviewsAll == 0) return "Noch keine Wiederholungen — sobald du lernst, füllt sich diese Seite."
            if (last == 0) return "In den letzten 30 Tagen hast du nichts wiederholt."
            var text = "In den letzten 30 Tagen " + plural(last, "Wiederholung", "Wiederholungen") +
                (rate?.let { ", " + pct(it) + " davon richtig" } ?: "") + "."
            if (trend != null && abs(trend) >= 3) text += " Das sind ${abs(trend)} Punkte " + (if (trend > 0) "mehr" else "weniger") + " als in den 30 Tagen davor."
            return text
        }

    val trendNote: String
        get() = when {
            rate == null -> "ab $MIN_N Abfragen"
            trend == null -> "vorher zu wenig Daten"
            trend == 0 -> "wie in den 30 Tagen davor"
            else -> (if (trend > 0) "↑ " else "↓ ") + abs(trend) + " Punkte ggü. davor"
        }
}

fun pct(x: Double) = "${(x * 100).roundToInt()} %"
fun plural(n: Int, one: String, many: String) = "$n " + if (n == 1) one else many

/** Erste Montag-Spalte der Heatmap (53 Wochen bis heute). */
fun heatmapStart(today: LocalDate): LocalDate = today.minusDays(364).with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY))

/** Farbstufe einer Heatmap-Zelle (0–4). */
fun heatLevel(n: Int) = when { n == 0 -> 0; n < 5 -> 1; n < 15 -> 2; n < 30 -> 3; else -> 4 }
