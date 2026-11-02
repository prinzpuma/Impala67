package org.impala67.app.study.stats

import org.impala67.app.study.LearningTime
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.TextStyle
import java.util.Locale
import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

// ---------- Lern-Analyse im Statistik-Tab (lernmuster.js) ----------

data class RateRow(val label: String, val n: Int, val rate: Double)
data class HourRate(val hour: Int, val n: Int, val rate: Double)
data class ProblemPage(val pageId: String, val minutes: Int, val lost: Int)
data class ExpRow(val label: String, val n: Int, val average: Double)

data class PatternData(
    val position: List<RateRow>,
    val timer: List<RateRow>,
    val hours: List<HourRate>?,
    val experiments: List<ExpRow>,
    val problems: List<ProblemPage>,
) {
    val empty get() = position.size < 2 && timer.isEmpty() && hours == null && experiments.isEmpty() && problems.isEmpty()
}

private fun passRate(list: List<STele>) = if (list.isEmpty()) 0.0 else list.count { it.data.optInt("grade") > 1 }.toDouble() / list.size

/** [livePages]: Seiten, die es noch gibt (nicht im Papierkorb). */
fun LearnData.patterns(livePages: Set<String>): PatternData {
    val rs = reviewEvents
    val position = listOf("Karte 1–10" to 0..9, "Karte 11–25" to 10..24, "Karte 26–40" to 25..39, "Karte 41+" to 40..Int.MAX_VALUE)
        .map { (label, range) -> rs.filter { it.data.optInt("pos", -1) in range }.let { RateRow(label, it.size, passRate(it)) } }
        .filter { it.n >= 12 }
    val on = rs.filter { it.data.opt("timer") == true }
    val off = rs.filter { it.data.opt("timer") == false }
    val timer = if (on.size >= 15 && off.size >= 15) listOf(RateRow("mit Lerntimer", on.size, passRate(on)), RateRow("ohne Timer", off.size, passRate(off))) else emptyList()
    val hours = if (rs.size < 60) null else (0..23).map { h -> rs.filter { it.data.optInt("hour", -1) == h }.let { HourRate(h, it.size, passRate(it)) } }
        .takeIf { list -> list.count { it.n >= 8 } >= 3 }
    val names = linkedMapOf("feynman" to "Feynman", "scaffolding" to "Hinweise", "variation" to "Variation", "mc" to "Quiz")
    fun exps(e: STele) = e.data.optJSONArray("exp")?.let { a -> (0 until a.length()).map { a.optString(it) } }.orEmpty()
    fun avg(list: List<STele>) = list.map { it.data.optInt("grade") }.filter { it in 1..4 }.let { if (it.isEmpty()) 0.0 else it.average() }
    val base = rs.filter { exps(it).isEmpty() }
    val expRows = names.map { (k, label) -> rs.filter { k in exps(it) }.let { ExpRow(label, it.size, avg(it)) } }.filter { it.n >= 15 }
    val experiments = if (expRows.isEmpty() || base.size < 30) emptyList() else expRows + ExpRow("ohne Experimente", base.size, avg(base))
    val dwell = HashMap<String, LongArray>()
    telemetry.filter { it.kind == "dwell" }.forEach { e ->
        val id = e.data.optString("pageId").ifEmpty { return@forEach }
        val b = dwell.getOrPut(id) { LongArray(2) }
        b[0] += e.data.optLong("ms"); b[1] += e.data.optLong("lost")
    }
    val problems = dwell.filter { (id, v) -> id in livePages && v[0] >= 5 * 60_000 }
        .entries.sortedByDescending { (_, v) -> v[0] + v[1] * 60_000 }.take(5)
        .map { (id, v) -> ProblemPage(id, (v[0] / 60_000).toInt(), v[1].toInt()) }
    return PatternData(position, timer, hours, experiments, problems)
}

// ---------- Lernanalyse der Startseite (lernanalyse.js) ----------

private val DAY_LONG = listOf("Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag")

fun dur(minutes: Double): String {
    val m0 = minutes.roundToInt()
    val h = m0 / 60
    val m = m0 % 60
    return if (h > 0) "$h h" + (if (m > 0) " $m" else "") else "$m Min"
}

data class Goal(val goalMin: Int, val days: List<Double>, val done: Double, val today: Int, val pace: Double, val need: Double, val left: Int, val text: String, val warn: Boolean, val reachDay: Int?)
data class SubjectRow(val subject: String, val now: Double, val before: Double, val delta: Int, val deck: String)
data class Subjects(val rows: List<SubjectRow>, val worst: SubjectRow?, val text: String)
data class Slot(val label: String, val hint: String, val n: Int, val rate: Double?)
data class BestTime(val slots: List<Slot>, val best: Slot?, val text: String)
data class DueWeek(val counts: List<Int>, val labels: List<String>, val peak: Int, val text: String)
data class HomeAnalysis(val goal: Goal, val subjects: Subjects, val time: BestTime, val forecast: DueWeek, val headline: String, val action: String?, val actionDeck: String?)

fun goalOf(time: LearningTime, goalMin: Int, today: LocalDate = LocalDate.now()): Goal {
    val days = time.week(today).map { it / 60.0 }
    val idx = today.dayOfWeek.value - 1
    val done = days.sum()
    val pace = (1L..14L).sumOf { time.seconds(today.minusDays(it)) / 60.0 } / 14
    val left = 7 - idx
    val need = max(0.0, goalMin - done)
    var reach: Int? = null
    var warn = false
    val text = when {
        need == 0.0 -> "Geschafft: ${dur(done)} von ${dur(goalMin.toDouble())}."
        pace > 0 && pace * left >= need -> {
            reach = min(6, idx + ceil(need / pace).toInt() - 1)
            "Bei deinem Tempo schaffst du es " + (if (reach == idx) "heute" else "am " + DAY_LONG[reach]) + "."
        }
        else -> { warn = true; "Es fehlen noch ${dur(need)}, also etwa ${dur(need / left)} pro Tag." }
    }
    return Goal(goalMin, days, done, idx, pace, need, left, text, warn, reach)
}

fun LearnData.homeAnalysis(time: LearningTime, goalMin: Int, now: Instant = Instant.now(), zone: ZoneId = ZoneId.systemDefault()): HomeAnalysis? {
    val learned = reviews.any { it.grade > 0 } || time.totals.values.any { it > 0 }
    if (!learned) return null
    val today = now.atZone(zone).toLocalDate()
    val g = goalOf(time, goalMin, today)

    // 2) Fächer (letzte 14 Tage gegen die 14 davor); ohne Fächer-Modul gilt das Fach der Bewertung bzw. der Wurzel-Stapel.
    fun subjectOf(r: SReview) = r.subject ?: r.deck.substringBefore("::")
    val d14 = 14L * 86_400_000
    val nowMs = now.toEpochMilli()
    fun range(from: Long, to: Long) = reviews.filter { it.grade > 0 && it.t.toEpochMilli() in from until to }.groupBy(::subjectOf)
    val cur = range(nowMs - d14, nowMs + 1)
    val prev = range(nowMs - 2 * d14, nowMs - d14)
    val rate = { l: List<SReview> -> l.count { it.grade > 1 }.toDouble() / l.size }
    val rows = cur.filter { (s, l) -> l.size >= 15 && (prev[s]?.size ?: 0) >= 15 }.map { (s, l) ->
        val n = rate(l); val b = rate(prev[s]!!)
        SubjectRow(s, n, b, (n * 100).roundToInt() - (b * 100).roundToInt(), l.groupingBy { it.deck.substringBefore("::") }.eachCount().maxByOrNull { it.value }?.key ?: s)
    }.sortedBy { it.delta }
    val worst = rows.firstOrNull { it.delta <= -8 }
    val subText = when {
        rows.isEmpty() -> "Noch zu wenig Daten: Pro Fach braucht es 15 Wiederholungen in zwei Wochen hintereinander."
        worst != null -> "${worst.subject} lässt nach: ${(worst.now * 100).roundToInt()} % richtig, vorher ${(worst.before * 100).roundToInt()} %."
        else -> "Kein Fach lässt nach. Alle halten ihr Niveau."
    }
    val subjects = Subjects(rows.take(5), worst, subText)

    // 3) Tageszeit (letzte 8 Wochen)
    val cut = now.minusSeconds(56L * 86_400)
    val defs = listOf(Triple("Morgens", "5–12 Uhr", 5 until 12), Triple("Mittags", "12–17 Uhr", 12 until 17), Triple("Abends", "17–22 Uhr", 17 until 22))
    val slotOf = { h: Int -> defs.indexOfFirst { h in it.third }.takeIf { it >= 0 } ?: 3 }
    val n = IntArray(4); val ok = IntArray(4)
    reviews.filter { it.grade > 0 && !it.t.isBefore(cut) }.forEach { r ->
        val s = slotOf(r.t.atZone(zone).hour); n[s]++; if (r.grade > 1) ok[s]++
    }
    val labels = defs.map { it.first to it.second } + ("Nachts" to "22–5 Uhr")
    val slots = labels.mapIndexed { i, (l, h) -> Slot(l, h, n[i], if (n[i] > 0) ok[i].toDouble() / n[i] else null) }
    val valid = slots.filter { it.n >= 20 }.sortedByDescending { it.rate }
    val best = if (valid.size >= 2 && ((valid[0].rate!! - valid.last().rate!!) * 100).roundToInt() >= 5) valid[0] else null
    val timeText = when {
        valid.size < 2 -> "Noch zu wenig Daten: Es braucht je 20 Wiederholungen zu zwei Tageszeiten."
        best != null -> "${best.label} bist du am stärksten: ${(best.rate!! * 100).roundToInt()} % richtig, ${valid.last().label.lowercase()} nur ${(valid.last().rate!! * 100).roundToInt()} %."
        else -> "Die Tageszeit macht bei dir kaum einen Unterschied."
    }

    // 4) Fällige Wiederholungen der nächsten 7 Tage
    val ends = (1L..7L).map { today.plusDays(it).atStartOfDay(zone).toInstant() }
    val counts = IntArray(7)
    cards.filter { !it.suspended && it.state != "new" && it.due != null }.forEach { c ->
        val i = ends.indexOfFirst { c.due!!.isBefore(it) }
        if (i >= 0) counts[i]++
    }
    val avg = counts.average()
    var peak = -1
    for (i in 1 until 7) if (counts[i] >= 30 && counts[i] >= 1.8 * max(avg, 1.0) && (peak < 0 || counts[i] > counts[peak])) peak = i
    val dayLabels = (0L until 7L).map { if (it == 0L) "Heute" else today.plusDays(it).dayOfWeek.getDisplayName(TextStyle.SHORT, Locale.GERMAN) }
    val name = { i: Int -> if (i == 1) "Morgen" else "Am " + DAY_LONG[today.plusDays(i.toLong()).dayOfWeek.value - 1] }
    val fcText = when {
        counts.sum() == 0 -> "In den nächsten 7 Tagen wird nichts fällig."
        peak > 0 -> "${name(peak)} werden ${counts[peak]} Karten fällig. Heute ein paar vorzuziehen entzerrt das."
        else -> "Ruhige Woche: im Schnitt ${avg.roundToInt()} Karten pro Tag."
    }
    val fc = DueWeek(counts.toList(), dayLabels, peak, fcText)

    // Wichtigste Aussage für den zugeklappten Zustand: Warnung vor Prognose vor Lob.
    val (headline, action, deck) = when {
        worst != null -> Triple(subText, worst.subject + " lernen", worst.deck)
        peak > 0 -> Triple(fcText, "Jetzt lernen", null)
        g.warn && g.today >= 2 -> Triple("Wochenziel: " + g.text, "Jetzt lernen", null)
        g.need == 0.0 || g.reachDay != null -> Triple("Wochenziel: " + g.text, null, null)
        best != null -> Triple(timeText, null, null)
        else -> Triple("Sobald du ein paar Tage gelernt hast, steht hier, was gut läuft und wo es hakt.", null, null)
    }
    return HomeAnalysis(g, subjects, BestTime(slots, best, timeText), fc, headline, action, deck)
}
