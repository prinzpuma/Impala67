import Foundation
import Observation

/// Dünne Schicht über dem Rust-Kern (wie `ImpalaStore.kt` in der Android-App und `STATE` in der PWA):
/// Lesen direkt über [core], Schreiben nur über Kern-Funktionen. Der Kern meldet jede Änderung – eigene
/// wie fremde aus dem Sync – als `Changes`; daraufhin zählen die Revisionen hoch, und Ansichten, die sie
/// in `.task(id:)` beobachten, lesen neu. Keine Logik, die im Kern liegt, hier nachbauen.
@MainActor @Observable
final class ImpalaStore {
    let core: ImpalaCore

    /// Jede Seitenänderung, auch reiner Inhalt (Notiztext, Heft-Striche). Nur für Ansichten, die den
    /// Inhalt oder „zuletzt bearbeitet“ zeigen (Startseite, Suche).
    private(set) var pagesRevision = 0
    /// Seitenbaum, Titel, Icons, Ort, Favoriten, Archiv, Arbeitsbereiche – ohne reine Inhaltsänderungen.
    /// Wie `render.js` der PWA: Speichern im Editor bzw. ein Strich im Heft zeichnet Listen und
    /// Kopfzeilen nicht neu. Für fast alle Ansichten der richtige Zähler.
    private(set) var pageMetaRevision = 0
    /// Offene Tabs und Aufklapp-Zustand des Seitenbaums (geräteübergreifend gespeichert).
    private(set) var uiRevision = 0
    /// Karten, Stapel und Bewertungen (Stapelbaum, Lernen, „Heute fällig“).
    private(set) var cardsRevision = 0
    /// Chat-Liste und Chats (Seitenleiste, offener Chat).
    private(set) var chatsRevision = 0
    /// Einstellungen (KI-Quellen, Modell).
    private(set) var settingsRevision = 0
    /// Lernzeit und Tagesartikel (Startseite); auch Einstellungen (Name, Tagesartikel an/aus).
    private(set) var homeRevision = 0
    /// Jede Änderung (Sync-Konflikte entstehen und verschwinden bei beliebigen Änderungen).
    private(set) var revision = 0
    /// Letzte Änderung von einem anderen Gerät (Editor und Heft laden dann nach).
    private(set) var lastRemote: Changes?
    /// Zählt jede fremde Änderung. Ansichten beobachten diesen Zähler statt `lastRemote`: zwei gleiche
    /// `Changes` hintereinander (z. B. zweimal neue Striche im selben Heft) lösen sonst kein `onChange` aus.
    private(set) var remoteRevision = 0

    @ObservationIgnored private var listener: Listener?

    init(core: ImpalaCore) {
        self.core = core
        let listener = Listener { [weak self] changes in
            Task { @MainActor in self?.apply(changes) }
        }
        self.listener = listener
        core.setChangeListener(listener: listener)
    }

    private func apply(_ c: Changes) {
        revision += 1
        if c.everything || c.pagesAll || !c.pages.isEmpty || c.workspaces { pagesRevision += 1 }
        if c.everything || c.pagesAll || c.pagesMeta || c.workspaces { pageMetaRevision += 1 }
        if c.everything || c.ui { uiRevision += 1 }
        if c.everything || c.cardsAll || !c.cards.isEmpty || c.decks || c.reviews || c.settings { cardsRevision += 1 }
        if c.everything || c.chatsAll || !c.chats.isEmpty { chatsRevision += 1 }
        if c.everything || c.settings { settingsRevision += 1 }
        if c.everything || c.learningSessions || c.homeArticles || c.settings { homeRevision += 1 }
        if c.remote || c.everything {
            lastRemote = c
            remoteRevision += 1
            if c.everything || !c.hefte.isEmpty { HeftOcr.startBackgroundScan(core: core) }
        }
    }

    /// Ob eine fremde Änderung die Seite `id` betrifft (Notiz oder Heft).
    func remoteTouches(_ id: String) -> Bool {
        guard let c = lastRemote else { return false }
        return c.everything || c.pagesAll || c.pages.contains(id) || c.hefte.contains(id)
    }
}

/// Rückruf des Kerns; kommt aus beliebigen Threads und kehrt sofort zurück.
private final class Listener: ChangeListener, @unchecked Sendable {
    private let handler: @Sendable (Changes) -> Void
    init(_ handler: @escaping @Sendable (Changes) -> Void) { self.handler = handler }
    func onChanged(changes: Changes) { handler(changes) }
}

extension PageSummary: Identifiable {}
