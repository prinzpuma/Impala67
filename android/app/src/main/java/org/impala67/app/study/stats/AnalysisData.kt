package org.impala67.app.study.stats

import org.impala67.app.study.LearningTime
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.TextStyle
import java.util.Locale
import kotlin.math.max
import kotlin.math.roundToInt

// UniFFI-Datensätze aus dem Rust-Kern (core/impala-ffi/src/analysis.rs)
typealias RateRow = uniffi.impala_ffi.RateRow
typealias HourRate = uniffi.impala_ffi.HourRate
typealias ProblemPage = uniffi.impala_ffi.ProblemPage
typealias ExpRow = uniffi.impala_ffi.ExpRow
typealias PatternData = uniffi.impala_ffi.PatternData

typealias Goal = uniffi.impala_ffi.Goal
typealias SubjectRow = uniffi.impala_ffi.SubjectRow
typealias Subjects = uniffi.impala_ffi.Subjects
typealias Slot = uniffi.impala_ffi.Slot
typealias BestTime = uniffi.impala_ffi.BestTime
typealias DueWeek = uniffi.impala_ffi.DueWeek
typealias HomeAnalysis = uniffi.impala_ffi.HomeAnalysis

// ---------- Lern-Analyse im Statistik-Tab (lernmuster.js) ----------

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
    val empty = position.size < 2 && timer.isEmpty() && hours == null && experiments.isEmpty() && problems.isEmpty()
    return PatternData(position, timer, hours, experiments, problems, empty)
}

/** Direkte Lernmuster aus dem Rust-Kern über [uniffi.impala_ffi.ImpalaCore]. */
fun uniffi.impala_ffi.ImpalaCore.patterns(livePages: Collection<String>? = null): PatternData {
    return patternData(livePages?.toList())
}

// ---------- Lernanalyse der Startseite (lernanalyse.js) ----------

private val DAY_LONG = listOf("Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag")

fun dur(minutes: Double): String {
    val m0 = minutes.roundToInt()
    val h = m0 / 60
    val m = m0 % 60
    return if (h > 0) "$h h" + (if (m > 0) " $m" else "") else "$m Min"
}

fun goalOf(time: LearningTime, goalMin: Int, today: LocalDate = LocalDate.now()): Goal {
    val days = time.week(today).map { it / 60.0 }
    val idx = today.dayOfWeek.value - 1
    val pace = (1L..14L).sumOf { time.seconds(today.minusDays(it)) / 60.0 } / 14.0
    return uniffi.impala_ffi.computeGoal(goalMin, days, idx, pace)
}

/** Direkte Lernanalyse aus dem Rust-Kern über [uniffi.impala_ffi.ImpalaCore]. */
fun uniffi.impala_ffi.ImpalaCore.homeAnalysis(
    time: LearningTime,
    goalMin: Int,
    now: Instant = Instant.now(),
    zone: ZoneId = ZoneId.systemDefault(),
): HomeAnalysis? {
    val today = now.atZone(zone).toLocalDate()
    val days = time.week(today).map { it / 60.0 }
    val pace = (1L..14L).sumOf { time.seconds(today.minusDays(it)) / 60.0 } / 14.0
    val tzOffset = zone.rules.getOffset(now).totalSeconds / 60
    return homeAnalysis(now.toEpochMilli(), tzOffset, goalMin, days, pace)
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
