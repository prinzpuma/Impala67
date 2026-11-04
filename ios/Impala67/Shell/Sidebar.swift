import SwiftUI

/// Linke Spalte der PWA (`#sidebar` in index.html, `DeskSidebar.kt`): Pillen Home · Chat · Karten · Suche,
/// darunter Seitenbaum (Favoriten + Arbeitsbereiche), unten die sekundäre Navigation (`.side-foot`).
struct Sidebar: View {
    @Environment(ImpalaStore.self) private var store
    @Environment(ShellModel.self) private var shell
    @Environment(SyncController.self) private var sync
    @Environment(\.shellNamespace) private var zoom
    @Namespace private var pills

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 2) {
                Pill(icon: "home", label: "Home", active: shell.sidebarMode == .files && shell.active == nil && !shell.libraryOpen, ns: pills) {
                    shell.sidebarMode = .files
                    shell.goHome()
                }
                Pill(icon: "chat", label: "Chat", active: shell.sidebarMode == .chats, ns: pills) { shell.sidebarMode = .chats }
                Pill(icon: "cards", label: "Karten", active: shell.sidebarMode == .cards, ns: pills) { shell.sidebarMode = .cards }
                Spacer(minLength: 0)
                Pill(icon: "search", label: "Suchen", active: false, ns: pills) { shell.sheet = .search }
                    .zoomSource(ShellSheet.search, zoom)
            }
            Group {
                switch shell.sidebarMode {
                case .files: PageTree()
                case .chats: ChatList()
                case .cards: DeckTree()
                }
            }
            .frame(maxHeight: .infinity, alignment: .top)
            .animation(.smooth(duration: 0.25), value: shell.sidebarMode)
            Divider().overlay(Impala.edgeSoft)
            VStack(spacing: 2) {
                FootButton(icon: "book", label: "Gemini Notebook") { shell.sheet = .notebook }.zoomSource(ShellSheet.notebook, zoom)
                FootButton(icon: "graph", label: "Wissensgraph") { shell.sheet = .graph }.zoomSource(ShellSheet.graph, zoom)
                FootButton(icon: "library", label: "Bibliothek", active: shell.libraryOpen) { shell.openLibrary() }
                FootButton(icon: "trash", label: "Papierkorb") { shell.sheet = .trash }.zoomSource(ShellSheet.trash, zoom)
                FootButton(icon: "sliders", label: "Einstellungen", status: sync.isPaired ? sync.state : nil) { shell.sheet = .settings }
                    .zoomSource(ShellSheet.settings, zoom)
            }
        }
        .padding(.horizontal, Space.s2)
        .padding(.vertical, 10)
        .background(Impala.sidebar)
        .toolbar(.hidden, for: .navigationBar)
    }
}

/// Pille der Kopfzeile (`.topbar .tab`): aktiv mit Akzent-Tönung und Label, sonst nur das Symbol.
private struct Pill: View {
    let icon: String
    let label: String
    let active: Bool
    let ns: Namespace.ID
    let action: () -> Void

    var body: some View {
        Button {
            withAnimation(.bouncy(duration: 0.35, extraBounce: 0.05)) { action() }
        } label: {
            HStack(spacing: 6) {
                Icon(icon, size: 16)
                if active {
                    Text(label)
                        .font(.system(size: TextSize.sm, weight: .medium))
                        .transition(.blurReplace)
                }
            }
            .foregroundStyle(active ? Impala.text : Impala.text2)
            .padding(.horizontal, 10)
            .frame(minHeight: 36)
            .background {
                // Die Tönung gleitet von Pille zu Pille.
                if active { Capsule().fill(Impala.activeTint).matchedGeometryEffect(id: "pill", in: ns) }
            }
        }
        .pressable()
        .accessibilityLabel(label)
        .sensoryFeedback(.selection, trigger: active) { _, now in now }
    }
}

/// Knopf der sekundären Navigation (`.side-foot button`).
private struct FootButton: View {
    let icon: String
    let label: String
    /// Sync-Zustand als Punkt (nur am Einstellungen-Knopf, wenn gekoppelt).
    var status: SyncController.State?
    /// Angezeigte Hauptansicht (Bibliothek), wie `btnLibrary.active`.
    var active = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: Space.s2) {
                Icon(icon, size: 15)
                Text(label).font(.system(size: TextSize.sm))
                Spacer(minLength: 0)
                if let status { StatusDot(state: status) }
            }
            .foregroundStyle(active ? Impala.text : Impala.text2)
            .padding(.horizontal, Space.s2)
            .frame(minHeight: 40)
            .background(active ? Impala.activeTint : .clear, in: RoundedRectangle(cornerRadius: Radius.sm, style: .continuous))
        }
        .pressable()
    }
}

extension View {
    /// Quelle eines Zoom-Übergangs für das Sheet `sheet`.
    @ViewBuilder
    func zoomSource(_ sheet: ShellSheet, _ ns: Namespace.ID?) -> some View {
        if let ns { matchedTransitionSource(id: sheet.id, in: ns) } else { self }
    }
}
