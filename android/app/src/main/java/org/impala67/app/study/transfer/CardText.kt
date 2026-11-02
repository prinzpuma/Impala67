package org.impala67.app.study.transfer

/** Eine Karte zum Importieren bzw. Exportieren. */
data class PlainCard(val front: String, val back: String, val deck: String)

/** Ergebnis einer gelesenen Datei: Karten, Probleme und erkanntes Format („Impala-TXT“, „CSV/TSV“, „Anki-Text“). */
data class ParsedCards(val cards: List<PlainCard>, val errors: List<String>, val format: String)

/**
 * Text-, CSV- und Anki-Text-Format der Karteikarten (web/extras.js). Kandidat für den Rust-Kern, sobald die
 * PWA Import und Export ebenfalls dorthin verlagert.
 */
object CardText {
    const val TXT_HEADER = "# Impala67-Karteikarten v1"

    val AI_CARD_PROMPT = """Erstelle eine UTF-8-Textdatei mit Karteikarten im Impala67-Format.
Nutze für jede Themengruppe "@stapel Eltern::Unterstapel". Schreibe jede Karte als
"@frage", danach die Frage, dann "@antwort" und danach die Antwort. Frage und
Antwort dürfen mehrere Zeilen und Markdown enthalten. Trenne Karten mit "---".
Gib ausschließlich den Inhalt der Textdatei aus.

$TXT_HEADER

@stapel Biologie::Zellbiologie
@frage
Welche Aufgabe haben Mitochondrien?
@antwort
Sie erzeugen den Großteil des ATP durch Zellatmung.
---"""

    /** Beispiel ohne die Einleitung (Aufklappbereich „TXT-Format anzeigen“). */
    val FORMAT_EXAMPLE get() = AI_CARD_PROMPT.split("\n\n").drop(1).joinToString("\n\n")

    private val ESCAPE = Regex("^(?=\\\\|@(?:stapel|frage|antwort)\\b|---\\s*$)", setOf(RegexOption.IGNORE_CASE, RegexOption.MULTILINE))
    private val UNESCAPE = Regex("^\\\\(?=\\\\|@(?:stapel|frage|antwort)\\b|---\\s*$)", RegexOption.IGNORE_CASE)

    private fun textEscape(s: String) = s.replace(ESCAPE, "\\\\")

    fun exportTxt(cards: List<PlainCard>): String {
        val parts = mutableListOf(TXT_HEADER)
        cards.groupBy { it.deck }.forEach { (deck, list) ->
            parts += listOf("", "@stapel $deck")
            list.forEach { parts += listOf("@frage", textEscape(it.front), "@antwort", textEscape(it.back), "---") }
        }
        return parts.joinToString("\n")
    }

    private fun csvEscape(s: String) = if (Regex("[\";\\n\\t]").containsMatchIn(s)) "\"" + s.replace("\"", "\"\"") + "\"" else s

    fun exportCsv(cards: List<PlainCard>): String =
        "front;back;deck\n" + cards.joinToString("\n") { listOf(it.front, it.back, it.deck).joinToString(";", transform = ::csvEscape) }

    fun parse(raw: String, defaultDeck: String = "Standard"): ParsedCards {
        val text = raw.removePrefix("﻿")
        return if (Regex("(^|\\n)@(?:stapel|frage|antwort)\\b", RegexOption.IGNORE_CASE).containsMatchIn(text)) parseTxt(text, defaultDeck) else parseTable(text, defaultDeck)
    }

    private fun parseTxt(text: String, defaultDeck: String): ParsedCards {
        val cards = ArrayList<PlainCard>()
        val errors = ArrayList<String>()
        var deck = defaultDeck
        var mode = ""
        val value = ArrayList<String>()
        var draft: Array<String>? = null // front, back, deck, line
        fun saveValue() {
            val d = draft ?: return
            if (mode.isEmpty()) return
            val v = value.joinToString("\n").trim()
            if (mode == "front") d[0] = v else d[1] = v
            value.clear()
        }
        fun saveCard() {
            saveValue()
            val d = draft ?: return
            if (d[0].isEmpty() || d[1].isEmpty() || d[2].isEmpty()) errors += "Zeile ${d[3]}: Frage, Antwort oder gültiger Stapel fehlt."
            else cards += PlainCard(d[0], d[1], d[2])
            draft = null; mode = ""; value.clear()
        }
        text.split(Regex("\\r?\\n")).forEachIndexed { i, raw ->
            val lineNo = i + 1
            val line = raw.trim()
            val deckMatch = Regex("^@stapel\\s+(.+)$", RegexOption.IGNORE_CASE).find(line)
            when {
                deckMatch != null -> {
                    saveCard()
                    val parts = deckMatch.groupValues[1].split("::").map { it.trim() }
                    deck = if (parts.any { it.isEmpty() }) "" else parts.joinToString("::")
                    if (deck.isEmpty()) errors += "Zeile $lineNo: Ungültiger Stapelpfad."
                }
                Regex("^@frage\\s*$", RegexOption.IGNORE_CASE).matches(line) -> { saveCard(); draft = arrayOf("", "", deck, "$lineNo"); mode = "front" }
                Regex("^@antwort\\s*$", RegexOption.IGNORE_CASE).matches(line) -> {
                    saveValue()
                    if (draft == null) errors += "Zeile $lineNo: Antwort ohne Frage." else mode = "back"
                }
                Regex("^---\\s*$").matches(line) -> saveCard()
                draft != null && mode.isNotEmpty() -> value += raw.replace(UNESCAPE, "")
            }
        }
        saveCard()
        return ParsedCards(cards, errors, "Impala-TXT")
    }

    private fun parseCsv(text: String): List<List<String>> {
        val sepName = Regex("^#separator:(.+)$", setOf(RegexOption.MULTILINE, RegexOption.IGNORE_CASE)).find(text)?.groupValues?.get(1)?.trim()?.lowercase()
        val named = mapOf("tab" to '\t', "comma" to ',', "semicolon" to ';', "colon" to ':', "pipe" to '|', "space" to ' ')
        val content = text.split(Regex("\\r?\\n")).firstOrNull { it.isNotEmpty() && !it.startsWith("#") }.orEmpty()
        val sep = named[sepName] ?: sepName?.singleOrNull() ?: when { '\t' in content -> '\t'; ';' in content -> ';'; else -> ',' }
        val rows = ArrayList<List<String>>()
        var row = ArrayList<String>()
        val cur = StringBuilder()
        var inQ = false
        var i = 0
        while (i < text.length) {
            val ch = text[i]
            if (inQ) {
                if (ch == '"') { if (text.getOrNull(i + 1) == '"') { cur.append('"'); i++ } else inQ = false } else cur.append(ch)
            } else when (ch) {
                '"' -> inQ = true
                sep -> { row += cur.toString(); cur.clear() }
                '\n', '\r' -> {
                    if (ch == '\r' && text.getOrNull(i + 1) == '\n') i++
                    row += cur.toString(); cur.clear()
                    if (row.any { it.isNotEmpty() }) rows += row
                    row = ArrayList()
                }
                else -> cur.append(ch)
            }
            i++
        }
        row += cur.toString()
        if (row.any { it.isNotEmpty() }) rows += row
        return rows
    }

    private fun parseTable(text: String, fallbackDeck: String): ParsedCards {
        val rows = parseCsv(text)
        val directives = text.split(Regex("\\r?\\n")).filter { it.startsWith("#") }
        val deckDirective = directives.firstNotNullOfOrNull { Regex("^#deck:(.+)$", RegexOption.IGNORE_CASE).find(it)?.groupValues?.get(1) }
        val defaultDeck = (deckDirective ?: fallbackDeck).trim()
        fun columnOf(name: String) = directives.firstNotNullOfOrNull { Regex("^#$name column:(\\d+)$", RegexOption.IGNORE_CASE).find(it)?.groupValues?.get(1)?.toInt()?.minus(1) } ?: -1
        val special = listOf("guid", "notetype", "deck", "tags").map(::columnOf).filter { it >= 0 }
        val deckColumn = columnOf("deck")
        val cards = ArrayList<PlainCard>()
        val errors = ArrayList<String>()
        for (row in rows) {
            if (row.isEmpty() || row[0].startsWith("#")) continue
            val head = row.map { it.trim().lowercase() }
            if (head.getOrNull(0) == "front" && head.getOrNull(1) == "back") continue
            val content = row.indices.filter { it !in special }
            val front = row.getOrNull(content.getOrElse(0) { -1 }).orEmpty().trim()
            val back = row.getOrNull(content.getOrElse(1) { -1 }).orEmpty().trim()
            val deck = (if (deckColumn >= 0) row.getOrNull(deckColumn) else if (deckDirective != null) defaultDeck else row.getOrNull(2))
                ?.trim()?.ifEmpty { null } ?: defaultDeck.ifEmpty { "Standard" }
            if (front.isNotEmpty() && back.isNotEmpty()) cards += PlainCard(front, back, deck)
            else if (front.isNotEmpty()) errors += "Eine Karte hat keine Antwort: " + front.take(60)
        }
        return ParsedCards(cards, errors, if (directives.isNotEmpty()) "Anki-Text" else "CSV/TSV")
    }

    /** Gleiche Karte = gleicher Stapel, gleiche Vorder- und Rückseite (`cardKey`). */
    fun key(c: PlainCard) = listOf(c.deck, c.front, c.back).joinToString("\u001f") { it.trim() }
}
