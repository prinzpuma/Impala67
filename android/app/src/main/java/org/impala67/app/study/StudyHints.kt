package org.impala67.app.study

/**
 * Hinweise während des Lernens (web/lernmuster.js, Teil 4 und 5) – Kandidat für den Rust-Kern:
 * - Ehrlichkeit: lange gezögert (nicht getippt, deutlich über der eigenen Median-Denkzeit) und dann
 *   „Gut“/„Einfach“ → höchstens einmal je Sitzung und alle 10 Minuten ein Hinweis.
 * - Pause: in den letzten Karten steigen Fehlerquote und Denkzeit gemeinsam → höchstens alle 20 Minuten.
 */
class StudyHints(private val clock: () -> Long = System::currentTimeMillis) {
    private data class Review(val grade: Int, val thinkMs: Long?)

    private val recent = ArrayDeque<Review>()
    private val thinkTimes = ArrayList<Long>()
    private var lastHint = 0L
    private var lastPause = 0L
    private var hintShown = false

    /** Nach jeder Bewertung; liefert höchstens einen Hinweistext. [pos] 0 = neue Sitzung. */
    fun onReview(grade: Int, thinkMs: Long, pos: Int, typed: Boolean): String? {
        val now = clock()
        if (pos == 0) { recent.clear(); hintShown = false }
        recent.addLast(Review(grade, if (typed) null else thinkMs))
        if (recent.size > 12) recent.removeFirst()
        val median = median()
        if (!typed) thinkTimes += thinkMs
        val slow = if (median > 0) thinkMs > maxOf(25_000L, median * 4) else thinkMs > 45_000L
        if (!typed && slow && grade >= 3 && !hintShown && now - lastHint > 600_000L) {
            hintShown = true
            lastHint = now
            return "${Math.round(thinkMs / 1000.0)} s bis zum Aufdecken und dann „${if (grade >= 4) "Einfach" else "Gut"}“? Ehrlich bewerten hilft dem Planer."
        }
        if (recent.size >= 10 && now - lastPause > 20 * 60_000L) {
            val half = recent.size / 2
            val a = recent.take(half)
            val b = recent.drop(half)
            val ta = think(a)
            val tb = think(b)
            if (errRate(b) >= 0.4 && errRate(b) > errRate(a) + 0.15 && ta > 0 && tb > 0 && tb > ta * 1.3) {
                lastPause = now
                return "Fehler und Denkzeit steigen — 5 Minuten Pause bringen hier mehr als Weitermachen."
            }
        }
        return null
    }

    private fun median(): Long {
        if (thinkTimes.size < 5) return 0
        val s = thinkTimes.sorted()
        return s[s.size / 2]
    }

    private fun errRate(l: List<Review>) = l.count { it.grade == 1 } / maxOf(1, l.size).toDouble()

    private fun think(l: List<Review>): Double {
        val v = l.mapNotNull { it.thinkMs }
        return if (v.size >= 3) v.average() else 0.0
    }
}
