package org.impala67.app.study.transfer

/** Eine Karte zum Importieren bzw. Exportieren. */
typealias PlainCard = uniffi.impala_ffi.PlainCard

/** Ergebnis einer gelesenen Datei: Karten, Probleme und erkanntes Format („Impala-TXT“, „CSV/TSV“, „Anki-Text“). */
typealias ParsedCards = uniffi.impala_ffi.ParsedCards

/**
 * Text-, CSV- und Anki-Text-Format der Karteikarten (web/extras.js, `CardText.swift`).
 * Reines Datenformat, delegiert an den Rust-Kern (`uniffi.impala_ffi` / `impala-model`).
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

    fun exportTxt(cards: List<PlainCard>): String = uniffi.impala_ffi.cardExportTxt(cards)

    fun exportCsv(cards: List<PlainCard>): String = uniffi.impala_ffi.cardExportCsv(cards)

    fun parse(raw: String, defaultDeck: String = "Standard"): ParsedCards =
        uniffi.impala_ffi.cardParseCardText(raw, defaultDeck)

    /** Gleiche Karte = gleicher Stapel, gleiche Vorder- und Rückseite (`cardKey`). */
    fun key(c: PlainCard): String = uniffi.impala_ffi.cardKey(c.front, c.back, c.deck)
}
