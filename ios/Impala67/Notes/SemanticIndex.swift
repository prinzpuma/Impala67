import Foundation
import NaturalLanguage
import Observation

/// Vektoren von Apples Satz-Embedding (`NLEmbedding.sentenceEmbedding`, Deutsch): fest im System, ohne
/// Download, für Satz-Ähnlichkeit gebaut. Statt Bekko (165 MB) der PWA; die Vektoren bleiben auf dem
/// Gerät und tragen eine eigene Kennung, mischen sich also nie mit Bekko-Vektoren.
final class AppleEmbedder: TextEmbedder, @unchecked Sendable {
    static let shared = AppleEmbedder()

    private let lock = NSLock()
    private let embedding: NLEmbedding?

    private init() {
        embedding = NLEmbedding.sentenceEmbedding(for: .german)
    }

    var available: Bool { embedding != nil }

    func modelKey() -> String {
        "apple:nl-sentence-de#r\(embedding?.revision ?? 0)"
    }

    func providerId() -> String { "apple" }

    /// Ein normierter Vektor je Text. Ohne Vektor (leer, nicht lesbar) ein Nullvektor: passt zu nichts.
    func embed(texts: [String]) throws -> [[Float]] {
        guard let embedding else { throw EmbedFailure.Failed(reason: "Apples Satz-Embedding fehlt auf diesem Gerät.") }
        // NLEmbedding ist nicht für gleichzeitige Aufrufe gedacht.
        return lock.withLock {
            texts.map { text in
                guard let v = embedding.vector(for: text) else { return [Float](repeating: 0, count: embedding.dimension) }
                let norm = sqrt(v.reduce(0) { $0 + $1 * $1 })
                return norm > 0 ? v.map { Float($0 / norm) } : v.map(Float.init)
            }
        }
    }
}

/// Semantischer Index der iPad-App (`SemanticIndex.kt` der Android-App): Der Kern rechnet alles
/// (`SemanticSearch`, Abschnitte, gespeicherte Vektoren); hier nur nach Seitenänderungen entprellt
/// nachführen und „Verwandt“ abfragen.
enum SemanticIndex {
    private static let lock = NSLock()
    nonisolated(unsafe) private static var search: SemanticSearch?

    private static func shared(_ core: ImpalaCore) -> SemanticSearch? {
        lock.withLock {
            if search == nil, AppleEmbedder.shared.available {
                search = SemanticSearch(core: core, embedder: AppleEmbedder.shared)
            }
            return search
        }
    }

    /// Geänderte und neue Seiten einbetten (im Hintergrund aufrufen). `true`, wenn sich der Index änderte.
    static func update(_ core: ImpalaCore) -> Bool {
        guard let search = shared(core) else { return false }
        var changed = false
        // In Stücken, damit ein großer Erstlauf die Kern-Sperre nie lange am Stück hält.
        for _ in 0..<1000 {
            guard let report = attempt("semanticUpdate", { try search.update(maxPages: 20) }) else { break }
            if report.indexed > 0 || report.removed > 0 { changed = true }
            if report.remaining == 0 { break }
        }
        return changed
    }

    /// Seiten, die noch eingebettet werden müssen; `nil` = Modell fehlt.
    static func pending(_ core: ImpalaCore) -> Int? {
        guard let search = shared(core) else { return nil }
        return (try? search.pendingPages()).map(Int.init) ?? 0
    }

    /// Bis zu drei inhaltlich ähnliche Seiten (ab Ähnlichkeit 0,5 wie in der PWA).
    static func related(_ core: ImpalaCore, pageId: String) -> [String] {
        guard let search = shared(core) else { return [] }
        // `try?`: Noch kein Index ist der Normalfall beim ersten Start – nichts für den Profiler.
        return ((try? search.relatedPages(pageId: pageId, k: 3)) ?? []).map(\.pageId)
    }
}

/// Zählt nach jedem Indexlauf mit Änderungen hoch, damit „Verwandt“ neu liest.
@MainActor @Observable
final class SemanticStatus {
    static let shared = SemanticStatus()
    private(set) var revision = 0
    private var running = false
    /// Während eines Laufs kam eine Änderung: danach noch einmal nachführen.
    private var again = false

    /// Nach einer Seitenänderung: kurz warten (Tippen), dann im Hintergrund nachführen.
    func pagesChanged(core: ImpalaCore) async {
        guard HomeSettings.read(core).relatedPages else { return }
        try? await Task.sleep(for: .seconds(3))
        guard !Task.isCancelled else { return }
        if running {
            again = true
            return
        }
        running = true
        repeat {
            again = false
            let changed = await Task.detached(priority: .utility) { SemanticIndex.update(core) }.value
            if changed { revision += 1 }
        } while again
        running = false
    }
}
