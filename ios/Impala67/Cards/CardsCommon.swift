import Foundation
import Observation
import SwiftUI

/// Was der Karten-Tab (`anki:main`) zeigt: Stapelübersicht, Lernen oder die Karten eines Stapels
/// (wie `S.ankiTab`/`S.ankiDeck` der PWA).
enum CardsView: Equatable {
    case decks
    /// `deck` nil = alle Stapel; `mix` mischt die fälligen Karten aller Stapel.
    case review(deck: String?, mix: Bool)
    case browse(deck: String)
    /// Statistik-Tab (`ankiStatsHtml`).
    case stats
    /// Archiv-Tab (`ankiArchiveHtml`).
    case archive

    var deck: String? {
        switch self {
        case .decks, .stats, .archive: nil
        case .review(let d, _): d
        case .browse(let d): d
        }
    }
}

/// Leech-Pille (`render-anki.js:450`, `ReviewParts.kt:89`): roter Hintergrund, roter Text, Käfer-Icon.
struct LeechBadge: View {
    var body: some View {
        HStack(spacing: 3) {
            Icon("bug", size: 11)
            Text("Leech")
                .font(.system(size: 11, weight: .semibold))
        }
        .foregroundStyle(Impala.danger)
        .padding(.horizontal, 6)
        .padding(.vertical, 2)
        .background(Impala.danger.opacity(0.12), in: Capsule())
    }
}

enum Deck {
    /// Standard-Stapel (nicht umbenennbar, nicht löschbar).
    static let standard = "Standard"
    /// Trennzeichen zwischen Eltern- und Unterstapel.
    static let sep = "::"

    /// Letzter Namensteil: „Mathe::Analysis“ → „Analysis“.
    static func label(_ name: String) -> String {
        deckLabel(name: name)
    }

    /// Eltern-Name („“ für oberste Ebene).
    static func parent(_ name: String) -> String {
        deckParent(name: name) ?? ""
    }

    /// Versatz der Ortszeit zu UTC für die Tagesgrenze des Kerns (MEZ +60, MESZ +120).
    static var utcOffset: Int32 { Int32(TimeZone.current.secondsFromGMT() / 60) }

    static func cardsText(_ n: Int) -> String { n == 1 ? "1 Karte" : "\(n) Karten" }
}

/// Ortszeit für Tagesgrenzen im Kern: Versatz je Zeitpunkt (Sommer-/Winterzeit des jeweiligen Datums).
final class SystemZone: DeviceZone, @unchecked Sendable {
    static let shared = SystemZone()

    func offsetMinutes(utcMs: Int64) -> Int32 {
        Int32(TimeZone.current.secondsFromGMT(for: Date(timeIntervalSince1970: Double(utcMs) / 1000)) / 60)
    }
}

extension DeckEntry: Identifiable {
    public var id: String { name }

    /// Unterstapel direkt unter ihrem Eltern-Stapel; die Reihenfolge bestimmt der Kern.
    static func flatten(_ overview: [DeckOverview], collapsed: Set<String>) -> [DeckEntry] {
        flattenDecks(overview: overview, collapsed: Array(collapsed))
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
    /// Stapel mit Zählern und die heutige Lernschlange (alle Stapel). Einmal je Kartenänderung im
    /// Hintergrund gelesen ([refresh]) und von Stapelbaum, Übersicht und Suche geteilt.
    private(set) var overview: [DeckOverview] = []
    private(set) var queue: StudyQueue?

    /// Heute offene Karten aller Stapel (neu + lernen + wiederholen).
    var openCount: Int { queue.map { Int($0.new + $0.learn + $0.review) } ?? 0 }

    /// Stapel und Lernschlange neu lesen, ohne den Hauptthread auf die Kern-Sperre warten zu lassen.
    func refresh(core: ImpalaCore) async {
        let (overview, queue) = await Task.detached(priority: .userInitiated) {
            let offset = Deck.utcOffset
            return (core.deckOverview(utcOffsetMinutes: offset, mix: false),
                    core.studyQueue(deck: nil, utcOffsetMinutes: offset, mix: false))
        }.value
        guard !Task.isCancelled else { return }
        self.overview = overview
        self.queue = queue
    }

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
