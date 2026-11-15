package org.impala67.app.study

import uniffi.impala_ffi.LearningSessionInfo
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

/**
 * Auswertung der Lernzeit wie in web/lernzeit.js (`mergedSeconds`, `totalsByDay`, `weekData`,
 * `streakDays`). Überlappende Abschnitte zweier Geräte zählen nur einmal (Wanduhr-Zeit).
 * Delegiert an den Rust-Kern (`core/impala-ffi`).
 */
class LearningTime(sessions: List<LearningSessionInfo>, private val zone: ZoneId = ZoneId.systemDefault()) {
    private val offsetMinutes: Int = zone.rules.getOffset(Instant.now()).totalSeconds / 60

    private val rawTotals: Map<String, ULong> = uniffi.impala_ffi.learningTimeTotalsByDay(sessions, offsetMinutes)

    /** Sekunden je Kalendertag (lokal), nach Beginn der Sitzung. */
    val totals: Map<LocalDate, Long> = rawTotals.mapNotNull { (k, v) ->
        runCatching { LocalDate.parse(k) to v.toLong() }.getOrNull()
    }.toMap()

    fun seconds(day: LocalDate = LocalDate.now(zone)): Long = totals[day] ?: 0L

    /** Die 7 Tage der Woche (Mo–So) mit `offset` Wochen Abstand zu heute. */
    fun week(today: LocalDate = LocalDate.now(zone), offset: Long = 0): List<Long> {
        val nowMs = today.atTime(12, 0).atZone(zone).toInstant().toEpochMilli()
        return uniffi.impala_ffi.learningTimeWeekData(rawTotals, nowMs, offset.toInt(), offsetMinutes).map { it.toLong() }
    }

    /** Aufeinanderfolgende Tage mit ≥ 5 Minuten; ein noch leerer heutiger Tag bricht die Serie nicht. */
    fun streakDays(today: LocalDate = LocalDate.now(zone)): Int {
        val nowMs = today.atTime(12, 0).atZone(zone).toInstant().toEpochMilli()
        return uniffi.impala_ffi.learningTimeStreakDays(rawTotals, nowMs, offsetMinutes).toInt()
    }

    companion object {
        fun mergedSeconds(sessions: List<LearningSessionInfo>): Long {
            return uniffi.impala_ffi.learningTimeMergedSeconds(sessions).toLong()
        }

        /** Montag als 0, Sonntag als 6 (wie in iOS LearningTime.weekdayIndex). */
        fun weekdayIndex(nowMs: Long = System.currentTimeMillis(), zone: ZoneId = ZoneId.systemDefault()): Int {
            val offsetMinutes = zone.rules.getOffset(Instant.ofEpochMilli(nowMs)).totalSeconds / 60
            return uniffi.impala_ffi.learningTimeWeekdayIndex(nowMs, offsetMinutes).toInt()
        }
    }
}
