package org.impala67.app.home

import uniffi.impala_ffi.HomeArticleInfo
import uniffi.impala_ffi.PageKind
import uniffi.impala_ffi.PageSummary
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.TextStyle
import java.util.Locale
import kotlin.math.roundToInt

/** Alles, was die Startseite zeigt – fertig berechnet (wie die Daten für `homeViewHtml`). */
data class HomeState(
    val dateLine: String,
    val greeting: String,
    val name: String,
    val conflictCount: Int,
    val last: ContinueItem?,
    val pins: List<PageSummary>,
    /** Fällige Karten (neu + Wiederholung + Lernschritte). */
    val open: Int,
    val hasCards: Boolean,
    val todaySeconds: Long,
    /** Sekunden Mo–So der laufenden Woche. */
    val week: List<Long>,
    val goalMin: Int,
    val streak: Int,
    val recall: Recall?,
    val article: ArticleState?,
) {
    /** Eine Karte dauert ohne eigene Messwerte 20 s (`secPerCard` in home-view.js). */
    val estMin get() = maxOf(1, (open * SEC_PER_CARD / 60.0).roundToInt())
    val weekMin get() = week.sum() / 60.0
    val goalPct get() = minOf(100, (weekMin / goalMin * 100).roundToInt())
    val fresh get() = last == null && !hasCards

    private companion object { const val SEC_PER_CARD = 20 }
}

data class ContinueItem(val page: PageSummary, val excerpt: List<String>, val heftPages: Int) {
    val meta get() = when (page.kind) {
        PageKind.HEFT -> "Heft · Seite 1" + if (heftPages > 1) " von $heftPages" else ""
        PageKind.NOTE -> "Notiz"
    }
}

/** „Weißt du's noch?“: Frage und Antwort einer schon gelernten Karte. */
data class Recall(val cardId: String, val question: String, val answer: String)

/** Tagesartikel: offen (ungelesen oder von heute) oder nur noch als Hinweis „gelesen“. */
data class ArticleState(val article: HomeArticleInfo, val teaser: String, val bodyText: String, val count: Int) {
    val read get() = article.readAt != null
}

/** Texte und Zeitangaben wie in home-view.js (deutsch, relative Zeiten). */
object HomeText {
    private val de = Locale.GERMAN
    private val time = DateTimeFormatter.ofPattern("HH:mm", de)
    private val shortDate = DateTimeFormatter.ofPattern("d. MMM", de)
    private val dateLine = DateTimeFormatter.ofPattern("EEEE, d. MMMM", de)
    val days = listOf("Mo", "Di", "Mi", "Do", "Fr", "Sa", "So")

    fun greeting(now: LocalTime = LocalTime.now()) = when (now.hour) {
        in 0..4 -> "Gute Nacht"
        in 5..10 -> "Guten Morgen"
        in 11..17 -> "Guten Tag"
        else -> "Guten Abend"
    }

    fun dateLine(day: LocalDate = LocalDate.now()): String = day.format(dateLine)

    /** `when()`: „gerade eben“, „vor 5 Min.“, „heute 14:02“, „gestern …“, Wochentag, Datum. */
    fun whenText(iso: String, zone: ZoneId = ZoneId.systemDefault()): String {
        val at = runCatching { Instant.parse(iso) }.getOrNull() ?: return ""
        val min = Duration.between(at, Instant.now()).toMillis() / 60_000.0
        if (min < 1) return "gerade eben"
        if (min < 60) return "vor ${min.roundToInt()} Min."
        val local = at.atZone(zone)
        val today = LocalDate.now(zone)
        val day = local.toLocalDate()
        return when {
            !day.isBefore(today) -> "heute ${local.format(time)}"
            !day.isBefore(today.minusDays(1)) -> "gestern ${local.format(time)}"
            !day.isBefore(today.minusDays(6)) -> day.dayOfWeek.getDisplayName(TextStyle.FULL, de)
            else -> local.format(shortDate)
        }
    }

    /** `dur()`: „45 Min“, „2 h“, „1 h 30“. */
    fun dur(minutes: Double): String {
        val m = minutes.roundToInt()
        val h = m / 60
        val r = m % 60
        return if (h > 0) "$h h" + (if (r > 0) " $r" else "") else "$m Min"
    }

    fun cards(n: Int) = "$n " + if (n == 1) "Karte" else "Karten"
    fun dayCount(n: Int, singular: String = "Tag", plural: String = "Tagen") = "$n " + if (n == 1) singular else plural

    /** Ein Satz, was heute zählt: Streak in Gefahr > Ziel in Reichweite > Ziel geschafft > heutige Zeit. */
    fun nudge(s: HomeState, now: LocalTime = LocalTime.now()): String {
        val todayMin = (s.todaySeconds / 60.0).roundToInt()
        val left = s.goalMin - s.weekMin
        return when {
            s.streak > 0 && todayMin == 0 && now.hour >= 14 -> " Dein Streak von ${dayCount(s.streak)} wartet noch auf heute."
            left > 0 && left <= 60 -> " Nur noch ${dur(left)} bis zum Wochenziel."
            left <= 0 && s.weekMin > 0 -> " Das Wochenziel hast du schon geschafft."
            todayMin > 0 -> " Heute schon ${dur(todayMin.toDouble())} gelernt."
            else -> ""
        }
    }

    fun title(page: PageSummary) = (if (page.icon.isNotEmpty()) page.icon + " " else "") + page.title.ifEmpty { "Ohne Titel" }

    fun cut(text: String, max: Int) = if (text.length > max) text.take(max - 1) + "…" else text
}
