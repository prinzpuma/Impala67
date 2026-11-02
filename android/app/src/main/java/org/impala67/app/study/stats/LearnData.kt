package org.impala67.app.study.stats

import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant

/** Karte mit Lernstand (`learningStatsJson` des Kerns). */
data class SCard(
    val id: String,
    val front: String,
    val deck: String,
    val pageId: String?,
    val state: String,
    val stability: Double,
    val lapses: Int,
    val due: Instant?,
    val suspended: Boolean,
)

/** Eine Bewertung (`S.reviews`). */
data class SReview(
    val id: String,
    val cardId: String,
    val deck: String,
    val t: Instant,
    val grade: Int,
    val first: Boolean,
    val learning: Boolean,
    val intervalDays: Double?,
    val subject: String?,
)

/** Ein Telemetrie-Eintrag (`S.telemetry`): Art, Zeit und freie Daten. */
data class STele(val kind: String, val t: Instant?, val data: JSONObject)

/**
 * Rohdaten für Statistik und Lernanalyse. Auswertung wie in anki-stats.js, lernmuster.js und
 * telemetrie.js. Kandidat für den Rust-Kern, sobald die PWA die Auswertung ebenfalls dorthin verlagert.
 */
class LearnData(val cards: List<SCard>, val reviews: List<SReview>, val telemetry: List<STele>) {
    /** Gültige Review-Telemetrie: Bewertung > 0, per Undo zurückgenommene fallen weg (`TELE.reviewEvents`). */
    val reviewEvents: List<STele> by lazy {
        val out = ArrayList<STele>()
        for (e in telemetry) {
            if (e.kind == "review" && e.data.optInt("grade") > 0) {
                out += e
            } else if (e.kind == "reviewUndo") {
                val rid = e.data.optString("reviewId")
                val index = if (rid.isNotEmpty()) out.indexOfFirst { it.data.optString("reviewId") == rid } else out.size - 1
                if (index >= 0) out.removeAt(index)
            }
        }
        out
    }

    /** Median der eigenen Denkzeit (letzte 300 Reviews, ab 12 Werten), sonst 0 (`TELE.thinkMedian`). */
    val thinkMedian: Long by lazy {
        val vals = reviewEvents.asReversed().asSequence()
            .map { it.data.optLong("thinkMs", -1) }
            .filter { it in 401 until 120_000 }
            .take(300).toList()
        if (vals.size >= 12) median(vals) else 0
    }

    companion object {
        fun parse(json: String): LearnData {
            val o = runCatching { JSONObject(json) }.getOrDefault(JSONObject())
            val cards = o.optJSONArray("cards").objects().map {
                SCard(
                    id = it.optString("id"),
                    front = it.optString("front"),
                    deck = it.optString("deck").ifEmpty { "Standard" },
                    pageId = it.optString("pageId").takeIf { p -> p.isNotEmpty() && p != "null" },
                    state = it.optString("state", "new"),
                    stability = it.optDouble("stability", 0.0).takeIf { s -> !s.isNaN() } ?: 0.0,
                    lapses = it.optInt("lapses"),
                    due = instant(it.optString("due")),
                    suspended = it.optBoolean("suspended"),
                )
            }
            val reviews = o.optJSONArray("reviews").objects().mapNotNull {
                val t = instant(it.optString("t")) ?: return@mapNotNull null
                SReview(
                    id = it.optString("id"),
                    cardId = it.optString("cardId"),
                    deck = it.optString("deck").ifEmpty { "Standard" },
                    t = t,
                    grade = it.optDouble("grade", 0.0).toInt(),
                    first = it.optBoolean("first"),
                    learning = it.optBoolean("learning"),
                    intervalDays = it.optDouble("intervalDays", Double.NaN).takeIf { d -> !d.isNaN() },
                    subject = it.optString("subject").takeIf { s -> s.isNotBlank() },
                )
            }.sortedBy { it.t }
            val tele = o.optJSONArray("telemetry").objects().map {
                STele(it.optString("kind"), instant(it.optString("t")), it.optJSONObject("data") ?: JSONObject())
            }
            return LearnData(cards, reviews, tele)
        }

        fun instant(s: String?): Instant? = s?.takeIf { it.isNotEmpty() }?.let { runCatching { Instant.parse(it) }.getOrNull() }

        private fun JSONArray?.objects(): List<JSONObject> = (0 until (this?.length() ?: 0)).mapNotNull { this!!.optJSONObject(it) }
    }
}

fun median(values: List<Long>): Long {
    if (values.isEmpty()) return 0
    val s = values.sorted()
    val m = s.size / 2
    return if (s.size % 2 == 1) s[m] else (s[m - 1] + s[m]) / 2
}
