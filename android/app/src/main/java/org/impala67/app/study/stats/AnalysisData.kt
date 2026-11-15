package org.impala67.app.study.stats

import org.impala67.app.study.LearningTime
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
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

/** Direkte Lernmuster aus dem Rust-Kern über [uniffi.impala_ffi.ImpalaCore]. */
fun uniffi.impala_ffi.ImpalaCore.patterns(livePages: Collection<String>? = null): PatternData {
    return patternData(livePages?.toList())
}

// ---------- Lernanalyse der Startseite (lernanalyse.js) ----------

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
    return homeAnalysis(now.toEpochMilli(), org.impala67.app.study.SystemZone(zone), goalMin, days, pace)
}
