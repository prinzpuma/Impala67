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
        libraryOpen.toggle()
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

    // Navigations-Verlauf wie die PWA (`tabs.js` / `nav-history.js` / `btnNavBack` / `btnNavForward`):
    // "home" ist die feste Basis (Index 0). Gelöschte/ungültige Seiten werden übersprungen.
    private var history: [String] = []
    private var historyIndex = -1

    var canGoBack: Bool {
        if sheet != nil { return true }
        if libraryOpen { return true }
        if active == Self.cardsTab && cards.view != .decks { return true }
        return prevValidIndex() >= 0
    }

    var canGoForward: Bool {
        if sheet != nil || libraryOpen { return false }
        return nextValidIndex() != -1
    }

    func goBack() {
        if sheet != nil {
            sheet = nil
            return
        }
        if libraryOpen {
            libraryOpen = false
            return
        }
        if active == Self.cardsTab && cards.view != .decks {
            withAnimation(.smooth) { cards.view = .decks }
            return
        }
        let prev = prevValidIndex()
        guard prev >= 0 && prev < historyIndex else { return }
        historyIndex = prev
        navigateTarget(history[historyIndex], push: false)
    }

    func goForward() {
        guard sheet == nil && !libraryOpen else { return }
        let next = nextValidIndex()
        guard next >= 0 && next < history.count else { return }
        historyIndex = next
        navigateTarget(history[historyIndex], push: false)
    }

    func handleEscape() {
        if sheet != nil {
            sheet = nil
            return
        }
        if libraryOpen {
            libraryOpen = false
            return
        }
        if active == Self.cardsTab && cards.view != .decks {
            withAnimation(.smooth) { cards.view = .decks }
            return
        }
    }

    private func isValidEntry(_ id: String) -> Bool {
        if id == "home" || id == Self.cardsTab || id == "nlm:main" { return true }
        if id.hasPrefix("chat:") {
            let chatId = String(id.dropFirst(5))
            return store.core.chat(id: chatId) != nil
        }
        guard let p = store.core.page(id: id) else { return false }
        return !p.trashed
    }

    private func prevValidIndex() -> Int {
        var i = historyIndex - 1
        while i >= 0 && !isValidEntry(history[i]) { i -= 1 }
        return i
    }

    private func nextValidIndex() -> Int {
        var i = historyIndex + 1
        while i < history.count && !isValidEntry(history[i]) { i += 1 }
        return i < history.count ? i : -1
    }

    private func pushHistory(_ target: String) {
        if historyIndex >= 0 && historyIndex < history.count && history[historyIndex] == target { return }
        if historyIndex < history.count - 1 {
            history.removeSubrange((historyIndex + 1)...)
        }
        history.append(target)
        if history.count > 40 {
            if history.first == "home" {
                history.remove(at: 1)
            } else {
                history.removeFirst()
            }
        }
        historyIndex = history.count - 1
    }

    private func replaceHistory(_ target: String) {
        guard historyIndex >= 0 && historyIndex < history.count else {
            pushHistory(target)
            return
        }
        if history[historyIndex] == "home" {
            pushHistory(target)
        } else {
            history[historyIndex] = target
        }
    }

    struct HistoryItem: Identifiable {
        let id: Int
        let index: Int
        let title: String
        let icon: String
    }

    func backHistoryItems() -> [HistoryItem] {
        var items: [HistoryItem] = []
        var i = historyIndex - 1
        while i >= 0 && items.count < 8 {
            if isValidEntry(history[i]) {
                items.append(historyItem(at: i))
            }
            i -= 1
        }
        return items
    }

    func forwardHistoryItems() -> [HistoryItem] {
        var items: [HistoryItem] = []
        var i = historyIndex + 1
        while i < history.count && items.count < 8 {
            if isValidEntry(history[i]) {
                items.append(historyItem(at: i))
            }
            i += 1
        }
        return items
    }

    private func historyItem(at i: Int) -> HistoryItem {
        let target = history[i]
        if target == "home" {
            return HistoryItem(id: i, index: i, title: "Startseite", icon: "home")
        }
        if target == Self.cardsTab {
            return HistoryItem(id: i, index: i, title: "Karteikarten", icon: "cards")
        }
        if target == "nlm:main" {
            return HistoryItem(id: i, index: i, title: "Gemini Notebook", icon: "book")
        }
        if target.hasPrefix("chat:") {
            let chatId = String(target.dropFirst(5))
            let chatTitle = store.core.chat(id: chatId)?.title ?? ""
            return HistoryItem(id: i, index: i, title: chatTitle.isEmpty ? "Chat" : chatTitle, icon: "sparkles")
        }
        guard let p = store.core.page(id: target)?.summary else {
            return HistoryItem(id: i, index: i, title: target, icon: "note")
        }
        return HistoryItem(id: i, index: i, title: PageStyle.title(p), icon: PageStyle.iconName(p))
    }

    func jumpToHistory(_ targetIndex: Int) {
        guard targetIndex >= 0 && targetIndex < history.count else { return }
        sheet = nil
        libraryOpen = false
        historyIndex = targetIndex
        navigateTarget(history[targetIndex], push: false)
    }

    private func navigateTarget(_ target: String, push: Bool) {
        if target == "home" {
            libraryOpen = false
            active = nil
            save()
        } else {
            libraryOpen = false
            // Wie `openPage` (tabs.js): Karten zeigen den Stapel-Baum, jede andere Seite den Seitenbaum.
            sidebarMode = target == Self.cardsTab ? .cards : .files
            if !tabs.contains(target) {
                if let a = active, let i = tabs.firstIndex(of: a) { tabs[i] = target } else { append(target) }
            }
            active = target
            save()
        }
        if push { pushHistory(target) }
        refreshTabInfos()
    }

    /// KI-Panel rechts ein-/ausklappen (bleibt über Neustarts gemerkt, nur dieses Gerät).
    func setAiPanel(_ open: Bool) {
        withAnimation(.spring(duration: 0.4, bounce: 0.15)) { chat.panelOpen = open }
        UserDefaults.standard.set(open, forKey: "aiPanelOpen")
    }

    struct TabItem: Equatable {
        let title: String
        let icon: String
        let emoji: String?
        let kind: PageKind?
    }

    private(set) var tabInfoMap: [String: TabItem] = [:]

    func tabInfo(_ tab: String) -> TabItem {
        if let info = tabInfoMap[tab] { return info }
        let info = computeTabInfo(tab)
        tabInfoMap[tab] = info
        return info
    }

    private func computeTabInfo(_ tab: String) -> TabItem {
        if tab.hasPrefix("chat:") {
            let title = store.core.chat(id: String(tab.dropFirst(5)))?.title ?? ""
            return TabItem(title: title.isEmpty ? "Chat" : title, icon: "sparkles", emoji: nil, kind: nil)
        }
        if tab == Self.cardsTab { return TabItem(title: "Karteikarten", icon: "cards", emoji: nil, kind: nil) }
        if tab == "nlm:main" { return TabItem(title: "Gemini Notebook", icon: "book", emoji: nil, kind: nil) }
        guard let p = store.core.page(id: tab), !p.trashed else {
            return TabItem(title: "Unbenannt", icon: "file", emoji: nil, kind: nil)
        }
        let summary = p.summary
        return TabItem(title: PageStyle.title(summary), icon: PageStyle.iconName(summary), emoji: PageStyle.emoji(summary), kind: summary.kind)
    }

    func refreshTabInfos() {
        var map: [String: TabItem] = [:]
        for tab in tabs {
            map[tab] = computeTabInfo(tab)
        }
        if let active, map[active] == nil {
            map[active] = computeTabInfo(active)
        }
        tabInfoMap = map
    }

    init(store: ImpalaStore) {
        self.store = store
        chat = ChatModel(core: store.core)
        chat.panelOpen = UserDefaults.standard.bool(forKey: "aiPanelOpen")
        reload()
        if UserDefaults.standard.bool(forKey: "impala67StartLibrary") {
            UserDefaults.standard.set(LibraryMode.hefte.rawValue, forKey: "impala67LibMode")
            libraryOpen = true
        }
        DevBridge.shared.shell = self
    }

    /// Vom Kern neu lesen (Start, Änderung auf einem anderen Gerät).
    func reload() {
        let ui = store.core.uiTabs()
        let before = active
        tabs = ui.tabs
        // Startseite offen (nicht beim Start): bleibt offen. Der Kern speichert „kein aktiver Tab“ nie –
        // bei offenen Tabs macht der Reducer (`uiTabsSet`) daraus den letzten Tab. Das eigene Speichern
        // in goHome() löst dieses reload() aus und holte so sofort den letzten Tab wieder nach vorne.
        // Die PWA trennt das genauso: `S.view = "home"` bleibt, egal was `activeTabId` im Kern steht.
        if before == nil && !history.isEmpty {
            active = nil
        } else if let id = ui.activeTabId {
            active = tabs.contains(id) ? id : tabs.first
        } else {
            active = nil
        }
        // Nur wenn der Karten-Tab dadurch erst vorne liegt: Jeder Sync und jedes eigene Speichern lädt hier
        // neu, und sonst sprang die gewählte Pille (Home, Chat) bei offenem Karten-Tab zurück auf „Karten“.
        if active == Self.cardsTab && before != Self.cardsTab {
            sidebarMode = .cards
        }
        if history.isEmpty {
            if let active {
                history = ["home", active]
                historyIndex = 1
            } else {
                history = ["home"]
                historyIndex = 0
            }
        }
        refreshTabInfos()
    }

    /// Klick auf einen bereits offenen Tab (TabBar oder SidebarTabs) – wie `openPage(..., { replaceHistory: true })`.
    func openTab(_ tab: String) {
        if tab == Self.cardsTab { sidebarMode = .cards }
        libraryOpen = false
        active = tab
        save()
        replaceHistory(tab)
        refreshTabInfos()
    }

    /// Navigation zu einer Seite (Link, Suche, Brotkrumen, Seitenbaum) – wie `pushNav(pageId)`.
    func open(_ tab: String) {
        if tab == Self.cardsTab {
            sidebarMode = .cards
        }
        navigateTarget(tab, push: true)
    }

    /// „In neuem Tab öffnen“ bzw. „＋“.
    func openNewTab(_ tab: String) {
        if tab == Self.cardsTab {
            sidebarMode = .cards
        }
        libraryOpen = false
        if !tabs.contains(tab) { append(tab) }
        active = tab
        save()
        pushHistory(tab)
        refreshTabInfos()
    }

    func close(_ tab: String) {
        guard let i = tabs.firstIndex(of: tab) else { return }
        tabs.remove(at: i)
        if active == tab {
            if let next = tabs.indices.contains(i) ? tabs[i] : tabs.last {
                openTab(next)
            } else {
                active = nil
                replaceHistory("home")
            }
        }
        save()
        refreshTabInfos()
    }

    /// Karten-Tab öffnen (wie `data-ankistudy` bzw. Klick auf einen Stapel in der Seitenleiste).
    /// Karten-Tab zeigen; `feynman` lernt im Feynman-Modus (erst erklären, dann aufdecken).
    func openCards(_ view: CardsView, feynman: Bool = false) {
        sidebarMode = .cards
        cards.feynman = feynman
        cards.view = view
        open(Self.cardsTab)
    }

    static let cardsTab = "anki:main"

    /// Startseite: kein aktiver Tab (wie `openHomeOverview` in tabs.js). Bewusste Abweichung von der PWA:
    /// Am iPad öffnet schon ein Tipp auf die Home-Pille die Startseite (kein Doppeltipp nötig).
    func goHome() {
        sidebarMode = .files
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
