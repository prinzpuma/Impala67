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
    case search, trash, settings, library, graph, notebook
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
    /// Seitenleiste ein-/ausgeklappt (☰ wie `#btnSidebarToggle`).
    var columns: NavigationSplitViewVisibility = .all

    func toggleSidebar() {
        withAnimation(.spring(duration: 0.35)) { columns = columns == .detailOnly ? .all : .detailOnly }
    }

    private static let maxTabs = 12

    init(store: ImpalaStore) {
        self.store = store
        reload()
    }

    /// Vom Kern neu lesen (Start, Änderung auf einem anderen Gerät).
    func reload() {
        let ui = store.core.uiTabs()
        tabs = ui.tabs
        active = ui.activeTabId.flatMap { tabs.contains($0) ? $0 : nil } ?? tabs.first
    }

    /// Wie `activateTab`: Ist das Ziel schon offen, wird sein Tab aktiv; sonst ersetzt es den aktiven Tab.
    func open(_ tab: String) {
        if !tabs.contains(tab) {
            if let a = active, let i = tabs.firstIndex(of: a) { tabs[i] = tab } else { append(tab) }
        }
        active = tab
        save()
    }

    /// „In neuem Tab öffnen“ bzw. „＋“.
    func openNewTab(_ tab: String) {
        if !tabs.contains(tab) { append(tab) }
        active = tab
        save()
    }

    func close(_ tab: String) {
        guard let i = tabs.firstIndex(of: tab) else { return }
        tabs.remove(at: i)
        if active == tab { active = tabs.indices.contains(i) ? tabs[i] : tabs.last }
        save()
    }

    /// Startseite: kein aktiver Tab (wie `TopLevel.Home`).
    func goHome() {
        active = nil
        save()
    }

    private func append(_ tab: String) {
        tabs.append(tab)
        if tabs.count > Self.maxTabs { tabs.removeFirst(tabs.count - Self.maxTabs) }
    }

    private func save() {
        try? store.core.setUiTabs(tabs: tabs, activeTabId: active)
    }
}
