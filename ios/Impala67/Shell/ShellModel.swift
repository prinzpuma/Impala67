import Observation
import SwiftUI

/// Was links in der Seitenleiste steht (Pillen oben, wie `renderTopbar` der PWA).
enum SidebarMode { case files, chats, cards }

extension EnvironmentValues {
    /// Namensraum der Shell: Sheets zoomen aus dem Knopf, der sie geöffnet hat.
    @Entry var shellNamespace: Namespace.ID? = nil
}

/// Overlays der Shell (Suche, Papierkorb …).
enum ShellSheet: String, Identifiable {
    case search, trash, settings, graph, notebook, conflicts
    var id: String { rawValue }
}

/// Offene Tabs wie `web/tabs.js` (und `ShellNav.kt`): Seiten-IDs bzw. `chat:<id>`, `anki:main`, `nlm:main`.
/// Gespeichert im Kern (`setUiTabs`) und damit auf allen Geräten gleich; höchstens 12.
@MainActor @Observable
final class ShellModel {
    private let store: ImpalaStore
    private(set) var tabs: [String] = []
    private(set) var active: String?
    var sidebarMode: SidebarMode = .files
    var sheet: ShellSheet?
    /// Bibliothek statt des aktiven Tabs im Hauptbereich (wie `S.view = "library"` der PWA); jedes
    /// Öffnen eines Tabs oder der Startseite schließt sie wieder.
    private(set) var libraryOpen = false

    func openLibrary() {
        navigateTarget("library", push: true)
    }
    /// Karteikarten: Ansicht des Tabs `anki:main`, Stapel-Dialoge, Karten-Editor.
    let cards = CardsModel()
    /// KI-Chat (KI-Panel rechts, Tabs `chat:<id>`, Chat-Liste der Seitenleiste).
    let chat: ChatModel
    /// Seitenleiste ein-/ausgeklappt (☰ wie `#btnSidebarToggle`).
    var columns: NavigationSplitViewVisibility = .all

    func toggleSidebar() {
        withAnimation(.spring(duration: 0.35)) { columns = columns == .detailOnly ? .all : .detailOnly }
    }

    private static let maxTabs = 12

    // Navigations-Verlauf wie die PWA (`tabs.js` / `btnNavBack` / `btnNavForward`):
    private var history: [String] = []
    private var historyIndex = -1

    var canGoBack: Bool { historyIndex > 0 }
    var canGoForward: Bool { historyIndex >= 0 && historyIndex < history.count - 1 }

    func goBack() {
        guard canGoBack else { return }
        historyIndex -= 1
        navigateTarget(history[historyIndex], push: false)
    }

    func goForward() {
        guard canGoForward else { return }
        historyIndex += 1
        navigateTarget(history[historyIndex], push: false)
    }

    private func pushHistory(_ target: String) {
        if historyIndex >= 0 && historyIndex < history.count && history[historyIndex] == target { return }
        if historyIndex < history.count - 1 {
            history.removeSubrange((historyIndex + 1)...)
        }
        history.append(target)
        if history.count > 30 { history.removeFirst() }
        historyIndex = history.count - 1
    }

    private func navigateTarget(_ target: String, push: Bool) {
        if target == "home" {
            libraryOpen = false
            active = nil
            save()
        } else if target == "library" {
            libraryOpen = true
        } else {
            libraryOpen = false
            if !tabs.contains(target) {
                if let a = active, let i = tabs.firstIndex(of: a) { tabs[i] = target } else { append(target) }
            }
            active = target
            save()
        }
        if push { pushHistory(target) }
    }

    /// KI-Panel rechts ein-/ausklappen (bleibt über Neustarts gemerkt, nur dieses Gerät).
    func setAiPanel(_ open: Bool) {
        withAnimation(.spring(duration: 0.4, bounce: 0.15)) { chat.panelOpen = open }
        UserDefaults.standard.set(open, forKey: "aiPanelOpen")
    }

    init(store: ImpalaStore) {
        self.store = store
        chat = ChatModel(core: store.core)
        chat.panelOpen = UserDefaults.standard.bool(forKey: "aiPanelOpen")
        reload()
    }

    /// Vom Kern neu lesen (Start, Änderung auf einem anderen Gerät).
    func reload() {
        let ui = store.core.uiTabs()
        tabs = ui.tabs
        active = ui.activeTabId.flatMap { tabs.contains($0) ? $0 : nil } ?? tabs.first
        if history.isEmpty {
            pushHistory(active ?? "home")
        }
    }

    /// Wie `activateTab`: Ist das Ziel schon offen, wird sein Tab aktiv; sonst ersetzt es den aktiven Tab.
    func open(_ tab: String) {
        navigateTarget(tab, push: true)
    }

    /// „In neuem Tab öffnen“ bzw. „＋“.
    func openNewTab(_ tab: String) {
        libraryOpen = false
        if !tabs.contains(tab) { append(tab) }
        active = tab
        save()
        pushHistory(tab)
    }

    func close(_ tab: String) {
        guard let i = tabs.firstIndex(of: tab) else { return }
        tabs.remove(at: i)
        if active == tab { active = tabs.indices.contains(i) ? tabs[i] : tabs.last }
        save()
    }

    /// Karten-Tab öffnen (wie `data-ankistudy` bzw. Klick auf einen Stapel in der Seitenleiste).
    /// Karten-Tab zeigen; `feynman` lernt im Feynman-Modus (erst erklären, dann aufdecken).
    func openCards(_ view: CardsView, feynman: Bool = false) {
        cards.feynman = feynman
        cards.view = view
        open(Self.cardsTab)
    }

    static let cardsTab = "anki:main"

    /// Startseite: kein aktiver Tab (wie `TopLevel.Home`).
    func goHome() {
        navigateTarget("home", push: true)
    }

    private func append(_ tab: String) {
        tabs.append(tab)
        if tabs.count > Self.maxTabs { tabs.removeFirst(tabs.count - Self.maxTabs) }
    }

    private func save() {
        attempt("setUiTabs", { try store.core.setUiTabs(tabs: tabs, activeTabId: active) })
    }
}
