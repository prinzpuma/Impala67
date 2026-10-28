package org.impala67.app.study

import uniffi.impala_ffi.LearningSessionInfo
import java.time.DayOfWeek
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.temporal.TemporalAdjusters

/**
 * Auswertung der Lernzeit wie in web/lernzeit.js (`mergedSeconds`, `totalsByDay`, `weekData`,
 * `streakDays`). Überlappende Abschnitte zweier Geräte zählen nur einmal (Wanduhr-Zeit).
 * Kandidat für den Rust-Kern, sobald die PWA die Auswertung ebenfalls dorthin verlagert.
 */
class LearningTime(sessions: List<LearningSessionInfo>, private val zone: ZoneId = ZoneId.systemDefault()) {
    /** Sekunden je Kalendertag (lokal), nach Beginn der Sitzung. */
    val totals: Map<LocalDate, Long> = sessions
        .filter { it.durationSeconds > 0u }
        .groupBy { day(it.startedAt) }
        .filterKeys { it != null }
        .mapKeys { it.key!! }
        .mapValues { (_, list) -> mergedSeconds(list) }

    fun seconds(day: LocalDate): Long = totals[day] ?: 0

    /** Die 7 Tage der Woche (Mo–So) mit `offset` Wochen Abstand zu heute. */
    fun week(today: LocalDate = LocalDate.now(zone), offset: Long = 0): List<Long> {
        val monday = today.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY)).plusWeeks(offset)
        return (0L until 7L).map { seconds(monday.plusDays(it)) }
    }

    /** Aufeinanderfolgende Tage mit ≥ 5 Minuten; ein noch leerer heutiger Tag bricht die Serie nicht. */
    fun streakDays(today: LocalDate = LocalDate.now(zone)): Int {
        var streak = 0
        for (i in 0L until 365L) {
            if (seconds(today.minusDays(i)) >= 5 * 60) streak++
            else if (i == 0L) continue
            else break
        }
        return streak
    }

    private fun day(iso: String): LocalDate? = millis(iso)?.let { Instant.ofEpochMilli(it).atZone(zone).toLocalDate() }

    private companion object {
        fun millis(iso: String): Long? = runCatching { Instant.parse(iso).toEpochMilli() }.getOrNull()

        fun mergedSeconds(sessions: List<LearningSessionInfo>): Long {
            val intervals = sessions.flatMap { s ->
                if (s.segments.isNotEmpty()) {
                    s.segments.map { millis(it.startedAt) to millis(it.endedAt) }
                } else {
                    val start = millis(s.startedAt)
                    val end = millis(s.endedAt) ?: start?.plus(s.durationSeconds.toLong() * 1000)
                    listOf(start to end?.let { e -> maxOf(e, start ?: e) })
                }
            }.mapNotNull { (a, b) -> if (a != null && b != null && b >= a) a to b else null }.sortedBy { it.first }
            var total = 0L
            var cur: Pair<Long, Long>? = null
            for ((start, end) in intervals) {
                val c = cur
                cur = when {
                    c == null -> start to end
                    start > c.second -> { total += c.second - c.first; start to end }
                    else -> c.first to maxOf(c.second, end)
                }
            }
            cur?.let { total += it.second - it.first }
            return Math.round(total / 1000.0)
        }
    }
}
