import Foundation

/// Eine Karte zum Importieren bzw. Exportieren.
struct PlainCard: Equatable {
    let front: String
    let back: String
    let deck: String
}

/// Ergebnis einer gelesenen Datei: Karten, Probleme und erkanntes Format („Impala-TXT“, „CSV/TSV“, „Anki-Text“).
struct ParsedCards {
    let cards: [PlainCard]
    let errors: [String]
    let format: String
}

/// Text-, CSV- und Anki-Text-Format der Karteikarten (web/extras.js, `CardText.kt`). Kandidat für den
/// Rust-Kern, sobald die PWA Import und Export ebenfalls dorthin verlagert.
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

    /// Zeile beginnt mit einem Formatmarker (bzw. „\“): eine führende „\“ schützt sie.
    private static func isMarker(_ line: String) -> Bool {
        let l = line.lowercased()
        if l.hasPrefix("\\") { return true }
        for m in ["@stapel", "@frage", "@antwort"] where l.hasPrefix(m) {
            let rest = l.dropFirst(m.count)
            if rest.isEmpty || !(rest.first!.isLetter || rest.first!.isNumber || rest.first == "_") { return true }
        }
        return line.hasPrefix("---") && line.dropFirst(3).allSatisfy(\.isWhitespace)
    }

    private static func escape(_ s: String) -> String {
        s.components(separatedBy: "\n").map { isMarker($0) ? "\\" + $0 : $0 }.joined(separator: "\n")
    }

    static func exportTxt(_ cards: [PlainCard]) -> String {
        var parts = [header]
        var order: [String] = []
        var byDeck: [String: [PlainCard]] = [:]
        for c in cards {
            if byDeck[c.deck] == nil { order.append(c.deck) }
            byDeck[c.deck, default: []].append(c)
        }
        for deck in order {
            parts += ["", "@stapel \(deck)"]
            for c in byDeck[deck] ?? [] { parts += ["@frage", escape(c.front), "@antwort", escape(c.back), "---"] }
        }
        return parts.joined(separator: "\n")
    }

    private static func csvEscape(_ s: String) -> String {
        s.contains(where: { "\";\n\t".contains($0) }) ? "\"" + s.replacingOccurrences(of: "\"", with: "\"\"") + "\"" : s
    }

    static func exportCsv(_ cards: [PlainCard]) -> String {
        "front;back;deck\n" + cards.map { [$0.front, $0.back, $0.deck].map(csvEscape).joined(separator: ";") }.joined(separator: "\n")
    }

    // MARK: Import

    static func parse(_ raw: String, defaultDeck: String = Deck.standard) -> ParsedCards {
        let text = raw.hasPrefix("\u{FEFF}") ? String(raw.dropFirst()) : raw
        let lines = text.components(separatedBy: "\n").map { $0.hasSuffix("\r") ? String($0.dropLast()) : $0 }
        let hasMarkers = lines.contains { l in
            let t = l.lowercased()
            return ["@stapel", "@frage", "@antwort"].contains { t.hasPrefix($0) }
        }
        return hasMarkers ? parseTxt(lines, defaultDeck) : parseTable(text, lines, defaultDeck)
    }

    private static func parseTxt(_ lines: [String], _ defaultDeck: String) -> ParsedCards {
        var cards: [PlainCard] = []
        var errors: [String] = []
        var deck = defaultDeck
        var mode = ""
        var value: [String] = []
        var draft: (front: String, back: String, deck: String, line: Int)?

        func saveValue() {
            guard draft != nil, !mode.isEmpty else { return }
            let v = value.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
            if mode == "front" { draft?.front = v } else { draft?.back = v }
            value.removeAll()
        }
        func saveCard() {
            saveValue()
            guard let d = draft else { return }
            if d.front.isEmpty || d.back.isEmpty || d.deck.isEmpty {
                errors.append("Zeile \(d.line): Frage, Antwort oder gültiger Stapel fehlt.")
            } else {
                cards.append(PlainCard(front: d.front, back: d.back, deck: d.deck))
            }
            draft = nil
            mode = ""
            value.removeAll()
        }

        for (i, raw) in lines.enumerated() {
            let lineNo = i + 1
            let line = raw.trimmingCharacters(in: .whitespaces)
            let lower = line.lowercased()
            if lower.hasPrefix("@stapel"), line.count > 7, line.dropFirst(7).first?.isWhitespace == true {
                saveCard()
                let parts = line.dropFirst(7).trimmingCharacters(in: .whitespaces).components(separatedBy: "::")
                    .map { $0.trimmingCharacters(in: .whitespaces) }
                deck = parts.contains(where: \.isEmpty) ? "" : parts.joined(separator: "::")
                if deck.isEmpty { errors.append("Zeile \(lineNo): Ungültiger Stapelpfad.") }
            } else if lower == "@frage" {
                saveCard()
                draft = ("", "", deck, lineNo)
                mode = "front"
            } else if lower == "@antwort" {
                saveValue()
                if draft == nil { errors.append("Zeile \(lineNo): Antwort ohne Frage.") } else { mode = "back" }
            } else if line.hasPrefix("---"), line.dropFirst(3).allSatisfy(\.isWhitespace) {
                saveCard()
            } else if draft != nil, !mode.isEmpty {
                value.append(raw.hasPrefix("\\") && isMarker(String(raw.dropFirst())) ? String(raw.dropFirst()) : raw)
            }
        }
        saveCard()
        return ParsedCards(cards: cards, errors: errors, format: "Impala-TXT")
    }

    private static func parseCsv(_ text: String, _ lines: [String]) -> [[String]] {
        let sepName = lines.first { $0.lowercased().hasPrefix("#separator:") }
            .map { String($0.dropFirst(11)).trimmingCharacters(in: .whitespaces).lowercased() }
        let named: [String: Character] = ["tab": "\t", "comma": ",", "semicolon": ";", "colon": ":", "pipe": "|", "space": " "]
        let content = lines.first { !$0.isEmpty && !$0.hasPrefix("#") } ?? ""
        let sep: Character = sepName.flatMap { named[$0] ?? ($0.count == 1 ? $0.first : nil) }
            ?? (content.contains("\t") ? "\t" : content.contains(";") ? ";" : ",")
        var rows: [[String]] = []
        var row: [String] = []
        var cur = ""
        var inQ = false
        let chars = Array(text)
        var i = 0
        while i < chars.count {
            let ch = chars[i]
            if inQ {
                if ch == "\"" {
                    if i + 1 < chars.count, chars[i + 1] == "\"" { cur.append("\""); i += 1 } else { inQ = false }
                } else {
                    cur.append(ch)
                }
            } else if ch == "\"" {
                inQ = true
            } else if ch == sep {
                row.append(cur)
                cur = ""
            } else if ch == "\n" || ch == "\r" || ch == "\r\n" {
                row.append(cur)
                cur = ""
                if row.contains(where: { !$0.isEmpty }) { rows.append(row) }
                row = []
            } else {
                cur.append(ch)
            }
            i += 1
        }
        row.append(cur)
        if row.contains(where: { !$0.isEmpty }) { rows.append(row) }
        return rows
    }

    private static func parseTable(_ text: String, _ lines: [String], _ fallbackDeck: String) -> ParsedCards {
        let rows = parseCsv(text, lines)
        let directives = lines.filter { $0.hasPrefix("#") }
        let deckDirective = directives.first { $0.lowercased().hasPrefix("#deck:") }.map { String($0.dropFirst(6)) }
        let defaultDeck = (deckDirective ?? fallbackDeck).trimmingCharacters(in: .whitespaces)
        func columnOf(_ name: String) -> Int {
            let prefix = "#\(name) column:"
            for d in directives where d.lowercased().hasPrefix(prefix) {
                if let n = Int(d.dropFirst(prefix.count).trimmingCharacters(in: .whitespaces)) { return n - 1 }
            }
            return -1
        }
        let special = ["guid", "notetype", "deck", "tags"].map(columnOf).filter { $0 >= 0 }
        let deckColumn = columnOf("deck")
        var cards: [PlainCard] = []
        var errors: [String] = []
        for row in rows {
            guard let first = row.first, !first.hasPrefix("#") else { continue }
            let head = row.map { $0.trimmingCharacters(in: .whitespaces).lowercased() }
            if head.first == "front", head.count > 1, head[1] == "back" { continue }
            let content = row.indices.filter { !special.contains($0) }
            let front = content.first.map { row[$0] }?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            let back = (content.count > 1 ? row[content[1]] : "").trimmingCharacters(in: .whitespacesAndNewlines)
            let rawDeck: String? = deckColumn >= 0 ? (row.indices.contains(deckColumn) ? row[deckColumn] : nil)
                : deckDirective != nil ? defaultDeck : (row.count > 2 ? row[2] : nil)
            let trimmedDeck = rawDeck?.trimmingCharacters(in: .whitespaces) ?? ""
            let deck = trimmedDeck.isEmpty ? (defaultDeck.isEmpty ? Deck.standard : defaultDeck) : trimmedDeck
            if !front.isEmpty, !back.isEmpty {
                cards.append(PlainCard(front: front, back: back, deck: deck))
            } else if !front.isEmpty {
                errors.append("Eine Karte hat keine Antwort: " + String(front.prefix(60)))
            }
        }
        return ParsedCards(cards: cards, errors: errors, format: directives.isEmpty ? "CSV/TSV" : "Anki-Text")
    }

    /// Gleiche Karte = gleicher Stapel, gleiche Vorder- und Rückseite (`cardKey`).
    static func key(_ c: PlainCard) -> String {
        [c.deck, c.front, c.back].map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.joined(separator: "\u{1F}")
    }
}
