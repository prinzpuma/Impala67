import Foundation

/// Text-, CSV- und Anki-Text-Format der Karteikarten (web/extras.js, `CardText.kt`).
/// Reines Datenformat, delegiert an den Rust-Kern (`impala-ffi` / `impala-model`).
enum CardText {
    static let header = "# Impala67-Karteikarten v1"

    static let aiPrompt = """
    Erstelle eine UTF-8-Textdatei mit Karteikarten im Impala67-Format.
    Nutze für jede Themengruppe "@stapel Eltern::Unterstapel". Schreibe jede Karte als
    "@frage", danach die Frage, dann "@antwort" und danach die Antwort. Frage und
    Antwort dürfen mehrere Zeilen und Markdown enthalten. Trenne Karten mit "---".
    Gib ausschließlich den Inhalt der Textdatei aus.

    \(header)

    @stapel Biologie::Zellbiologie
    @frage
    Welche Aufgabe haben Mitochondrien?
    @antwort
    Sie erzeugen den Großteil des ATP durch Zellatmung.
    ---
    """

    /// Beispiel ohne die Einleitung („TXT-Format anzeigen“).
    static var formatExample: String { aiPrompt.components(separatedBy: "\n\n").dropFirst().joined(separator: "\n\n") }

    // MARK: Export

    static func exportTxt(_ cards: [PlainCard]) -> String {
        cardExportTxt(cards: cards)
    }

    static func exportCsv(_ cards: [PlainCard]) -> String {
        cardExportCsv(cards: cards)
    }

    // MARK: Import

    static func parse(_ raw: String, defaultDeck: String = Deck.standard) -> ParsedCards {
        cardParseCardText(text: raw, defaultDeck: defaultDeck)
    }

    /// Gleiche Karte = gleicher Stapel, gleiche Vorder- und Rückseite (`cardKey`).
    static func key(_ c: PlainCard) -> String {
        cardKey(front: c.front, back: c.back, deck: c.deck)
    }
}
