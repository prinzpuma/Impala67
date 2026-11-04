import Foundation
import Observation

/// Lernmodus wie `ReviewViewModel.kt` (`ankiStudyHtml`/app-click-anki.js der PWA). Planung, Intervalle
/// und FSRS liegen im Kern (`studyQueue`, `reviewPreview`, `reviewCard`); hier nur, welche Karte gerade
/// liegt und ob sie umgedreht ist. Die Karte bleibt bis zur Bewertung festgepinnt, auch wenn sich die
/// Warteschlange ändert (kein Wechsel mitten im Nachdenken).
@MainActor @Observable
final class ReviewModel {
    let deck: String?
    let mix: Bool
    @ObservationIgnored private let core: ImpalaCore

    private(set) var queue: StudyQueue?
    private(set) var card: CardInfo?
    /// Intervall-Texte der vier Knöpfe (Nochmal, Schwer, Gut, Einfach).
    private(set) var preview: [String] = []
    var showBack = false
    /// Größte offene Kartenzahl dieser Sitzung (für den Fortschritt).
    private(set) var total = 0
    private(set) var canUndo = false
    /// Zählt jede Bewertung (Haptik); `lastGrade` sagt, welche.
    private(set) var graded = 0
    private(set) var lastGrade = 0
    var error: String?
    /// Feynman-Modus: eigene Erklärung, Prüfung läuft, Rubrik der KI (gilt nur für die angezeigte Karte).
    var feynText = ""
    private(set) var checking = false
    private(set) var verdict: FeynmanVerdict?

    @ObservationIgnored private var pinned: String?
    @ObservationIgnored private var busy = false

    init(core: ImpalaCore, deck: String?, mix: Bool) {
        self.core = core
        self.deck = deck
        self.mix = mix
        refresh()
    }

    var remaining: Int { queue.map { Int($0.new + $0.learn + $0.review) } ?? 0 }
    var progress: Double { total == 0 ? 1 : min(1, max(0, 1 - Double(remaining) / Double(total))) }

    /// Warteschlange neu lesen; `unpin` nimmt die nächste fällige statt der angezeigten Karte.
    /// Bleibt dieselbe Karte liegen, bleibt sie umgedreht (z. B. nach dem Bearbeiten).
    func refresh(unpin: Bool = false) {
        if unpin { pinned = nil }
        let q = core.studyQueue(deck: deck, utcOffsetMinutes: Deck.utcOffset, mix: mix)
        let keep = pinned.flatMap { core.card(id: $0) }.flatMap { $0.trashed || $0.suspended || $0.archived ? nil : $0 }
        let next = keep ?? q.dueNow.first
        if unpin || next?.id != card?.id {
            showBack = false
            feynText = ""
            verdict = nil
        }
        pinned = next?.id
        queue = q
        card = next
        preview = next.flatMap { attempt(try core.reviewPreview(cardId: $0.id), "reviewPreview") } ?? []
        total = max(total, remaining)
        canUndo = core.canUndoReview()
    }

    /// Bewertung 1 = Nochmal … 4 = Einfach.
    func grade(_ grade: Int) {
        guard let card, showBack, !busy else { return }
        busy = true
        defer { busy = false }
        do {
            try core.reviewCard(cardId: card.id, grade: UInt8(grade))
            lastGrade = grade
            graded += 1
            refresh(unpin: true)
        } catch {
            self.error = CardsModel.reason(error)
        }
    }

    /// Erklärung von der KI prüfen lassen, danach aufdecken (die Note wählt weiter der Lernende).
    func checkFeynman(chat: ChatModel) {
        guard let card, !checking else { return }
        guard !feynText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            error = "Erst erklären — tippen oder diktieren."
            return
        }
        checking = true
        let text = feynText
        Task {
            defer { checking = false }
            do {
                let v = try await FeynmanVerdict.check(chat: chat, card: card, explanation: text)
                guard self.card?.id == card.id else { return }
                verdict = v
                showBack = true
            } catch {
                self.error = "KI nicht erreichbar — später erneut versuchen."
            }
        }
    }

    func suspend() {
        guard let card else { return }
        do {
            try core.setCardSuspended(id: card.id, suspended: true)
            refresh(unpin: true)
        } catch {
            self.error = CardsModel.reason(error)
        }
    }

    /// Letzte Bewertung zurücknehmen; die Karte kommt verdeckt wieder.
    func undo() {
        do {
            if let id = try core.undoReview() {
                pinned = id
                card = nil
            }
            refresh()
        } catch {
            self.error = CardsModel.reason(error)
        }
    }
}
