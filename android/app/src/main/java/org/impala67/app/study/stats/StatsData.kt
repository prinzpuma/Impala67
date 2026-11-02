package org.impala67.app.study.stats

import java.time.DayOfWeek
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.TextStyle
import java.time.temporal.ChronoUnit
import java.time.temporal.TemporalAdjusters
import java.util.Locale
import kotlin.math.abs
import kotlin.math.roundToInt

const val REIF_TAGE = 21
const val MIN_N = 10
private const val WINDOW = 30L

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

/** Behalten zählt nur echte Abfragen: Erstkontakt und Lernschritte sagen noch nichts über das Gedächtnis. */
private fun hitRate(list: List<SReview>): Double? {
    val g = list.filter { it.grade > 0 && !it.first && !it.learning }
    return if (g.size >= MIN_N) g.count { it.grade > 1 }.toDouble() / g.size else null
}

fun LearnData.stats(now: Instant = Instant.now(), zone: ZoneId = ZoneId.systemDefault()): StatsData {
    val today = now.atZone(zone).toLocalDate()
    val ago = { r: SReview -> ChronoUnit.MILLIS.between(r.t, now) / 86_400_000.0 }
    val last = reviews.filter { ago(it) in 0.0..<WINDOW.toDouble() }
    val before = reviews.filter { ago(it) >= WINDOW && ago(it) < 2 * WINDOW }
    val rate = hitRate(last)
    val rateBefore = hitRate(before)

    var neu = 0; var lernen = 0; var wieder = 0; var aus = 0; var reif = 0; var gelernt = 0
    val decks = LinkedHashMap<String, IntArray>()
    for (c in cards) {
        val row = decks.getOrPut(c.deck) { IntArray(3) }
        row[0]++
        if (c.suspended) { aus++; continue }
        when (c.state) {
            "new" -> neu++
            "review" -> { wieder++; gelernt++ }
            else -> lernen++
        }
        if (c.state == "review" && c.stability >= REIF_TAGE) { reif++; row[2]++ }
        if (c.due != null && !c.due.isAfter(now)) row[1]++
    }
    val deckRows = decks.map { (name, r) -> DeckRow(name, r[0], r[1], r[2], hitRate(last.filter { it.deck == name })) }
        .sortedWith(compareByDescending<DeckRow> { it.due }.thenBy { it.name.lowercase() })

    val perDay = reviews.groupingBy { it.t.atZone(zone).toLocalDate() }.eachCount()
    val series = (WINDOW - 1 downTo 0).map { i -> today.minusDays(i).let { DayCount(it, perDay[it] ?: 0) } }
    val peak = series.maxByOrNull { it.n }?.takeIf { it.n > 0 }
    val forecast = (0L until 7L).map { i ->
        val d0 = today.plusDays(i)
        val end = d0.plusDays(1).atStartOfDay(zone).toInstant()
        val start = if (i == 0L) Instant.EPOCH else d0.atStartOfDay(zone).toInstant()
        val n = cards.count { !it.suspended && it.due != null && !it.due.isBefore(start) && it.due.isBefore(end) }
        Forecast(if (i == 0L) "Heute" else d0.dayOfWeek.getDisplayName(TextStyle.SHORT, Locale.GERMAN), n)
    }
    var longest = 0; var run = 0; var prev: LocalDate? = null
    for (k in perDay.keys.sorted()) {
        run = if (prev != null && ChronoUnit.DAYS.between(prev, k) == 1L) run + 1 else 1
        longest = maxOf(longest, run)
        prev = k
    }
    var d = today
    if ((perDay[d] ?: 0) == 0) d = d.minusDays(1)
    var current = 0
    while ((perDay[d] ?: 0) > 0) { current++; d = d.minusDays(1) }

    return StatsData(
        reviewsAll = reviews.size, last = last.size, rate = rate,
        trend = if (rate != null && rateBefore != null) ((rate - rateBefore) * 100).roundToInt() else null,
        avg = last.size / WINDOW.toDouble(), bestand = Bestand(neu, lernen, wieder, aus), n = cards.size,
        reif = reif, gelernt = gelernt, decks = deckRows, series = series, peak = peak, forecast = forecast,
        perDay = perDay, streakCurrent = current, streakLongest = longest,
        hard = cards.filter { it.lapses > 0 }.sortedByDescending { it.lapses }.take(5),
        thinkMs = thinkMedian, retention = retention(last),
    )
}

/** Behalten nach Wiederholungsabstand (telemetrie.js `retentionStats`). */
fun LearnData.retention(subset: List<SReview>): Retention {
    val ids = subset.map { it.id }.toHashSet()
    val prev = HashMap<String, Instant>()
    val rows = reviews.filter { it.grade > 0 }.map { r ->
        val gap = r.intervalDays?.takeIf { it >= 0 } ?: prev[r.cardId]?.let { ChronoUnit.MILLIS.between(it, r.t) / 86_400_000.0 }
        prev[r.cardId] = r.t
        r to gap
    }.filter { it.first.id in ids }
    fun bucket(target: Int): Bucket {
        val min = if (target == 1) 0.5 else target * 0.6
        val max = if (target == 1) 2.0 else target * 1.6
        val ok = rows.filter { (r, g) -> !r.first && !r.learning && g != null && g in min..max }
        return Bucket(ok.size, if (ok.isEmpty()) null else ok.count { it.first.grade > 1 }.toDouble() / ok.size)
    }
    return Retention(bucket(1), bucket(3), bucket(7), bucket(14))
}

/** Erste Montag-Spalte der Heatmap (53 Wochen bis heute). */
fun heatmapStart(today: LocalDate): LocalDate = today.minusDays(364).with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY))

/** Farbstufe einer Heatmap-Zelle (0–4). */
fun heatLevel(n: Int) = when { n == 0 -> 0; n < 5 -> 1; n < 15 -> 2; n < 30 -> 3; else -> 4 }
