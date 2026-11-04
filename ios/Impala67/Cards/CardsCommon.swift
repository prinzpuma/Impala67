import Foundation
import Observation

/// Was der Karten-Tab (`anki:main`) zeigt: Stapelübersicht, Lernen oder die Karten eines Stapels
/// (wie `S.ankiTab`/`S.ankiDeck` der PWA).
enum CardsView: Equatable {
    case decks
    /// `deck` nil = alle Stapel; `mix` mischt die fälligen Karten aller Stapel.
    case review(deck: String?, mix: Bool)
    case browse(deck: String)
    /// Statistik-Tab (`ankiStatsHtml`).
    case stats

    var deck: String? {
        switch self {
        case .decks, .stats: nil
        case .review(let d, _): d
        case .browse(let d): d
        }
    }
}

enum Deck {
    /// Standard-Stapel (nicht umbenennbar, nicht löschbar).
    static let standard = "Standard"
    /// Trennzeichen zwischen Eltern- und Unterstapel.
    static let sep = "::"

    /// Letzter Namensteil: „Mathe::Analysis“ → „Analysis“.
    static func label(_ name: String) -> String {
        name.components(separatedBy: sep).last ?? name
    }

    /// Eltern-Name („“ für oberste Ebene).
    static func parent(_ name: String) -> String {
        guard let r = name.range(of: sep, options: .backwards) else { return "" }
        return String(name[..<r.lowerBound])
    }

    /// Versatz der Ortszeit zu UTC für die Tagesgrenze des Kerns (MEZ +60, MESZ +120).
    static var utcOffset: Int32 { Int32(TimeZone.current.secondsFromGMT() / 60) }

    static func cardsText(_ n: Int) -> String { n == 1 ? "1 Karte" : "\(n) Karten" }
}

/// Eine sichtbare Zeile des Stapelbaums.
struct DeckEntry: Identifiable {
    let deck: DeckOverview
    let depth: Int
    let hasKids: Bool
    let collapsed: Bool

    var id: String { deck.name }
    var name: String { deck.name }
    var label: String { Deck.label(deck.name) }
    var due: UInt64 { deck.review + deck.learn }
    /// Etwas zu lernen (neu, lernen oder fällig).
    var open: Bool { deck.new + deck.learn + deck.review > 0 }

    /// Unterstapel direkt unter ihrem Eltern-Stapel (wie `flattenDecks` der Android-App); die
    /// Reihenfolge innerhalb einer Ebene liefert der Kern. Eingeklappte Äste entfallen.
    static func flatten(_ overview: [DeckOverview], collapsed: Set<String>) -> [DeckEntry] {
        func kids(_ parent: String?) -> [DeckOverview] {
            overview.filter { d in
                guard let parent else { return !d.name.contains(Deck.sep) }
                let prefix = parent + Deck.sep
                return d.name.hasPrefix(prefix) && !d.name.dropFirst(prefix.count).contains(Deck.sep)
            }
        }
        var out: [DeckEntry] = []
        func walk(_ parent: String?, _ depth: Int) {
            for d in kids(parent) {
                let hasKids = !kids(d.name).isEmpty
                let isCollapsed = hasKids && collapsed.contains(d.name)
                out.append(DeckEntry(deck: d, depth: depth, hasKids: hasKids, collapsed: isCollapsed))
                if !isCollapsed { walk(d.name, depth + 1) }
            }
        }
        walk(nil, 0)
        return out
    }
}

/// Welcher Stapel-Dialog offen ist (Seitenleiste und Stapelübersicht).
enum DeckDialog: Identifiable, Equatable {
    case new
    case sub(parent: String)
    case rename(String)
    case trash(String)

    var id: String {
        switch self {
        case .new: "new"
        case .sub(let p): "sub:\(p)"
        case .rename(let n): "rename:\(n)"
        case .trash(let n): "trash:\(n)"
        }
    }
}

/// Karten-Zustand der Shell: Ansicht des Karten-Tabs, eingeklappte Stapel, offene Dialoge und der
/// Karten-Editor. Geteilt von Seitenleiste, Karten-Tab und Startseite.
@MainActor @Observable
final class CardsModel {
    var view: CardsView = .decks
    var collapsed: Set<String> = []
    var dialog: DeckDialog?
    /// Karten-Editor: `.some(nil)` = neue Karte.
    var editor: CardEditorTarget?
    /// Stapel-Optionen offen (`deck` nil = Standardwerte aller Stapel).
    var options: DeckOptionsTarget?
    /// Import- bzw. Export-Blatt offen.
    var io: CardIoMode?
    /// Lernen im Feynman-Modus (beim Start gewählt, wie `S.ankiFeyn`).
    var feynman = false
    /// Fehlertext des Kerns (z. B. Name schon vergeben).
    var error: String?

    func toggle(_ name: String) {
        if collapsed.contains(name) { collapsed.remove(name) } else { collapsed.insert(name) }
    }

    /// Kern-Aufruf; ein Fehler landet als Text in `error`.
    func run(_ block: () throws -> Void) {
        do { try block() } catch { self.error = Self.reason(error) }
    }

    static func reason(_ e: Error) -> String {
        switch e as? CoreError {
        case .Invalid(let r)?, .Storage(let r)?: r
        case nil: e.localizedDescription
        }
    }
}

/// Stapel für die Stapel-Optionen (`deck` nil = „*“, alle Stapel).
struct DeckOptionsTarget: Identifiable {
    let deck: String?
    var id: String { deck ?? "*" }
}

/// Karte zum Bearbeiten (`id` nil = neue Karte, Stapel-Vorgabe `deck`).
struct CardEditorTarget: Identifiable, Equatable {
    var id: String { cardId ?? "new:\(deck ?? "")" }
    let cardId: String?
    let deck: String?
}
