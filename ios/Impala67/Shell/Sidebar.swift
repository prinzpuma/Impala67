import SwiftUI

/// Linke Spalte der PWA (`#sidebar` in index.html, `DeskSidebar.kt`): Pillen Home · Chat · Karten · Suche,
/// darunter Seitenbaum (Favoriten + Arbeitsbereiche), unten die sekundäre Navigation (`.side-foot`).
struct Sidebar: View {
    @Environment(ImpalaStore.self) private var store
    @Environment(ShellModel.self) private var shell

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 2) {
                Pill(icon: "home", label: "Home", active: shell.sidebarMode == .files && shell.active == nil) {
                    shell.sidebarMode = .files
                    shell.goHome()
                }
                Pill(icon: "chat", label: "Chat", active: shell.sidebarMode == .chats) { shell.sidebarMode = .chats }
                Pill(icon: "cards", label: "Karten", active: shell.sidebarMode == .cards) { shell.sidebarMode = .cards }
                Spacer(minLength: 0)
                Pill(icon: "search", label: "Suchen", active: false) { shell.sheet = .search }
            }
            Group {
                switch shell.sidebarMode {
                case .files: PageTree()
                case .chats: SidebarPlaceholder(text: "Chats folgen mit der KI.")
                case .cards: SidebarPlaceholder(text: "Karteikarten folgen.")
                }
            }
            .frame(maxHeight: .infinity, alignment: .top)
            Divider().overlay(Impala.edgeSoft)
            VStack(spacing: 2) {
                FootButton(icon: "book", label: "Gemini Notebook") { shell.sheet = .notebook }
                FootButton(icon: "graph", label: "Wissensgraph") { shell.sheet = .graph }
                FootButton(icon: "library", label: "Bibliothek") { shell.sheet = .library }
                FootButton(icon: "trash", label: "Papierkorb") { shell.sheet = .trash }
                FootButton(icon: "sliders", label: "Einstellungen") { shell.sheet = .settings }
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
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Icon(icon, size: 16)
                if active { Text(label).font(.system(size: TextSize.sm, weight: .medium)) }
            }
            .foregroundStyle(active ? Impala.text : Impala.text2)
            .padding(.horizontal, 10)
            .frame(minHeight: 36)
            .background(active ? Impala.activeTint : .clear, in: Capsule())
        }
        .pressable()
        .accessibilityLabel(label)
        .animation(.spring(duration: 0.25), value: active)
    }
}

/// Knopf der sekundären Navigation (`.side-foot button`).
private struct FootButton: View {
    let icon: String
    let label: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: Space.s2) {
                Icon(icon, size: 15)
                Text(label).font(.system(size: TextSize.sm))
                Spacer(minLength: 0)
            }
            .foregroundStyle(Impala.text2)
            .padding(.horizontal, Space.s2)
            .frame(minHeight: 40)
        }
        .pressable()
    }
}

private struct SidebarPlaceholder: View {
    let text: String
    var body: some View {
        Text(text)
            .font(.system(size: TextSize.sm))
            .foregroundStyle(Impala.text2)
            .padding(Space.s2)
    }
}
