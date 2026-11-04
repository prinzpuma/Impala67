import Foundation

/// Eine angebotene Entscheidung mit Text (`cf-action` in conflict-ui.js).
struct ConflictAction: Identifiable {
    let resolution: ConflictResolution
    let title: String
    let sub: String
    let badge: String?
    let recommended: Bool
    var id: String { title }
}

/// Texte des Konflikt-Dialogs (wörtlich aus web/conflict-ui.js, wie `ConflictText.kt`). Art, Empfehlung
/// und Entscheidungen kommen aus dem Rust-Kern (`ConflictInfo`); hier steht nur die Darstellung.
enum ConflictText {
    static let title = "Synchronisation braucht eine Entscheidung"
    static let here = "Dieses Gerät"
    static let other = "Anderes Gerät / Drive"
    static let noText = "(Kein Text vorhanden.)"
    static let copyLabel = "Gerettete Kopie"
    static let currentLabel = "Aktuelle Seite"
    static let failed = "Die Entscheidung konnte nicht angewendet werden. Es wurde nichts geändert."
    static let bulkFailed = "Nicht alle Konflikte konnten gelöst werden."

    static func bulkButton(_ n: Int) -> String { "Alle \(n) Konflikte mit Empfehlung lösen" }

    /// Hinweis der Startseite (`hv-alert`).
    static func homeAlert(_ count: Int) -> String {
        (count == 1 ? "Ein Sync-Konflikt wartet" : "\(count) Sync-Konflikte warten") + " auf deine Entscheidung."
    }

    /// Zeitpunkt wie `fmtConflictTime` (de-DE, zweistelliges Jahr); ohne Angabe „unbekannt“.
    static func time(_ iso: String?) -> String {
        guard let iso, !iso.isEmpty else { return "unbekannt" }
        guard let date = parse(iso) else { return iso }
        return date.formatted(Date.FormatStyle()
            .day(.twoDigits).month(.twoDigits).year(.twoDigits).hour(.twoDigits(amPM: .omitted)).minute(.twoDigits)
            .locale(Locale(identifier: "de_DE")))
    }

    private static func parse(_ iso: String) -> Date? {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = f.date(from: iso) { return d }
        f.formatOptions = [.withInternetDateTime]
        return f.date(from: iso)
    }

    static func kindLabel(_ c: ConflictInfo) -> String {
        switch c.kind {
        case .both: "Beide geändert"
        case .delete: "Gelöscht vs. geändert"
        case .legacy: c.pageId == nil ? "Original fehlt" : lines(c.extraLines).map { "\($0) neu" } ?? "Nichts Neues"
        }
    }

    static func explain(_ c: ConflictInfo) -> String {
        switch c.kind {
        case .both: "Auf diesem Gerät und auf Drive wurde die Seite unterschiedlich geändert."
        case .delete: "Auf einem Gerät wurde die Seite gelöscht, auf dem anderen geändert oder verschoben."
        case .legacy: legacyExplain(c)
        }
    }

    /// Entscheidungen des Kerns mit Texten; `recommended` markiert die Empfehlung.
    static func actions(_ c: ConflictInfo) -> [ConflictAction] {
        c.choices.map { choice in
            let t: (title: String, sub: String, badge: String?) = switch c.kind {
            case .both: both(choice.resolution, localWins: c.winner != .remote)
            case .delete: delete(choice.resolution)
            case .legacy: legacy(choice.resolution)
            }
            return ConflictAction(resolution: choice.resolution, title: t.title, sub: t.sub, badge: t.badge, recommended: choice.recommended)
        }
    }

    private static func lines(_ n: UInt32?) -> String? {
        guard let n, n > 0 else { return nil }
        return "\(n) \(n == 1 ? "Zeile" : "Zeilen")"
    }

    private static func legacyExplain(_ c: ConflictInfo) -> String {
        let original = c.originalTitle.flatMap { $0.trimmingCharacters(in: .whitespaces).isEmpty ? nil : $0 } ?? "Seite"
        let page = "„\(original)“"
        if c.pageId == nil {
            return "Die ursprüngliche Seite gibt es nicht mehr (umbenannt oder gelöscht). Schau kurz rein, ob du den Text noch brauchst."
        }
        guard let extra = lines(c.extraLines) else {
            return "Alles aus dieser Kopie steht schon in \(page). Du verlierst nichts, wenn du sie verwirfst."
        }
        return "Die Kopie enthält \(extra), die in \(page) fehlen (unten grün markiert). Brauchst du sie, behalte die Kopie als eigene Seite."
    }

    private static func both(_ r: ConflictResolution, localWins: Bool) -> (String, String, String?) {
        let keepHere: ConflictResolution = localWins ? .keepWinner : .useLoser
        if r == .keepBoth {
            return ("Beide behalten", "Die Konfliktkopie bleibt als eigene Seite. Nichts wird gelöscht.", nil)
        }
        if r == keepHere {
            return ("Dieses Gerät behalten",
                    localWins ? "Die Fassung von Drive kommt in den Papierkorb." : "Die Seite bekommt diesen Stand. Der Drive-Stand bleibt im Verlauf.",
                    "Empfohlen · neuer")
        }
        return ("Anderen Stand behalten",
                localWins ? "Die Seite bekommt den Drive-Stand. Der Stand von diesem Gerät bleibt im Verlauf." : "Die Fassung von diesem Gerät kommt in den Papierkorb.",
                "Empfohlen · neuer")
    }

    private static func delete(_ r: ConflictResolution) -> (String, String, String?) {
        switch r {
        case .useLoser: ("Seite behalten (wiederherstellen)", "Die Seite kommt mit dem geänderten Stand zurück.", nil)
        case .keepWinner: ("Gelöscht lassen", "Die Seite bleibt gelöscht. Der geänderte Stand landet im Papierkorb.", "Empfohlen · Löschen gewinnt")
        case .keepBoth: ("Beide behalten", "Die Konfliktkopie bleibt als eigene Seite. Nichts wird gelöscht.", nil)
        }
    }

    private static func legacy(_ r: ConflictResolution) -> (String, String, String?) {
        switch r {
        case .keepWinner: ("Kopie verwerfen", "Die Kopie landet im Papierkorb. Die Seite bleibt unverändert.", "Empfohlen · nichts geht verloren")
        case .keepBoth: ("Als eigene Seite behalten", "Die Kopie wird eine normale Seite mit dem Zusatz „(Kopie)“. Nichts wird gelöscht.", nil)
        case .useLoser: ("Kopie übernehmen", "Der Stand der Kopie wird übernommen.", nil)
        }
    }
}
