import SwiftUI

/// Linke Spalte der PWA (`#sidebar` in index.html, `DeskSidebar.kt`): Pillen Home · Chat · Karten · Suche,
/// darunter Seitenbaum (Favoriten + Arbeitsbereiche), unten die sekundäre Navigation (`.side-foot`).
struct Sidebar: View {
    @Environment(ImpalaStore.self) private var store
    @Environment(ShellModel.self) private var shell
    @Environment(SyncController.self) private var sync
    @Environment(\.shellNamespace) private var zoom
    @AppStorage(AppTabsPosition.key) private var tabsPosition = AppTabsPosition.top.rawValue
    @Namespace private var pills

    var body: some View {
        // Genau eine Pille aktiv (render.js `renderTopbar`).
        let isChat = shell.sidebarMode == .chats
        let isCards = shell.sidebarMode == .cards
        let isHome = shell.sidebarMode == .files

        VStack(alignment: .leading, spacing: 10) {
            // Die Pillen schweben als Liquid Glass über der Seitenleiste (wie die Leisten über dem Inhalt).
            GlassEffectContainer(spacing: 8) {
                HStack(spacing: 2) {
                    HStack(spacing: 2) {
                        // Tipp: Seitenbaum (`btnHome`); Doppeltipp: Startseite (app.js `dblclick` → `openHomeOverview`).
                        Pill(icon: "home", label: "Home", active: isHome, ns: pills,
                             doubleTap: { shell.goHome() }) { shell.homePill() }
                        Pill(icon: "chat", label: "Chat", active: isChat, ns: pills) {
                            shell.sidebarMode = .chats
                        }
                        // `btnAnki` → `openAnki()`: Karten-Tab mit Stapelübersicht.
                        Pill(icon: "cards", label: "Karten", active: isCards, ns: pills) { shell.openCards(.decks) }
                    }
                    .padding(3)
                    .impalaGlass(interactive: true)
                    Spacer(minLength: 0)
                    Pill(icon: "search", label: "Suchen", active: false, ns: pills) {
                        shell.sheet = .search
                    }
                    .padding(3)
                    .impalaGlass(interactive: true)
                    .zoomSource(ShellSheet.search, zoom)
                }
            }
            if tabsPosition == AppTabsPosition.sidebar.rawValue {
                SidebarTabs()
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
/// Mit `doubleTap` erkennt das System Einzel- und Doppeltipp an den Berührungen selbst (Einzeltipp wartet
/// kurz ab); eine eigene Zeitmessung in der Aktion verpasste den zweiten Tipp, sobald die Oberfläche nach
/// dem ersten kurz beschäftigt war.
private struct Pill: View {
    let icon: String
    let label: String
    let active: Bool
    let ns: Namespace.ID
    var doubleTap: (() -> Void)? = nil
    let action: () -> Void

    var body: some View {
        if let doubleTap {
            content
                .onTapGesture(count: 2) { run(doubleTap) }
                .onTapGesture { run(action) }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(label)
                .accessibilityAddTraits(.isButton)
                .accessibilityAction { run(action) }
                .accessibilityAction(named: "Startseite") { run(doubleTap) }
                .hoverEffect(.highlight)
                .sensoryFeedback(.selection, trigger: active) { _, now in AppHaptics.isEnabled && now }
        } else {
            Button { run(action) } label: { content }
                .contentShape(Capsule())
                .pressable()
                .accessibilityLabel(label)
                .sensoryFeedback(.selection, trigger: active) { _, now in AppHaptics.isEnabled && now }
        }
    }

    private func run(_ f: () -> Void) {
        withAnimation(.bouncy(duration: 0.35, extraBounce: 0.05)) { f() }
    }

    private var content: some View {
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
        .frame(minWidth: 38, minHeight: 36)
        .background {
            // Die Tönung gleitet von Pille zu Pille.
            if active { Capsule().fill(Impala.activeTint).matchedGeometryEffect(id: "pill", in: ns) }
        }
        .contentShape(Capsule())
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
            .contentShape(RoundedRectangle(cornerRadius: Radius.sm, style: .continuous))
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

/// Offene Tabs in der Seitenleiste (`sidebarTabsHtml` der PWA, `SidebarTabs` in `DeskSidebar.kt`).
private struct SidebarTabs: View {
    @Environment(ImpalaStore.self) private var store
    @Environment(ShellModel.self) private var shell

    @AppStorage(AppDensity.key) private var density = AppDensity.compact.rawValue

    var body: some View {
        let _ = store.pageMetaRevision
        if !shell.tabs.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text("Offene Tabs")
                        .font(.system(size: TextSize.xs, weight: .semibold))
                        .foregroundStyle(Impala.text2)
                    Spacer()
                    Menu {
                        MenuItem("Neue Notiz", icon: "note") { newPage(.note) }
                        MenuItem("Neues Heft", icon: "notebook") { newPage(.heft) }
                        TemplateMenuSection(create: newPage)
                        MenuItem("Seite suchen", icon: "search") { shell.sheet = .search }
                    } label: {
                        Icon("plus", size: 13)
                            .foregroundStyle(Impala.text2)
                            .frame(width: 24, height: 24)
                            .contentShape(Rectangle())
                    }
                    .accessibilityLabel("Neuen Tab öffnen")
                }
                .padding(.horizontal, Space.s1)

                VStack(spacing: 2) {
                    ForEach(shell.tabs, id: \.self) { tab in
                        let active = !shell.libraryOpen && tab == shell.active
                        let inf = info(tab)
                        HStack(spacing: 6) {
                            Button {
                                shell.open(tab)
                            } label: {
                                HStack(spacing: 6) {
                                    if let emoji = inf.emoji { Text(emoji).font(.system(size: TextSize.xs)) }
                                    else { Icon(inf.icon, size: 14) }
                                    Text(inf.title)
                                        .font(.system(size: TextSize.sm))
                                        .lineLimit(1)
                                    Spacer(minLength: 0)
                                }
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)

                            Button {
                                shell.close(tab)
                            } label: {
                                Icon("x", size: 12)
                                    .foregroundStyle(Impala.text2)
                                    .frame(width: 22, height: 22)
                                    .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel("Tab schließen")
                        }
                        .foregroundStyle(active ? Impala.text : Impala.text2)
                        .padding(.horizontal, 8)
                        .frame(minHeight: density == AppDensity.compact.rawValue ? 30 : 36)
                        .background(active ? Impala.activeTint : .clear, in: RoundedRectangle(cornerRadius: Radius.sm, style: .continuous))
                    }
                }
            }
            .padding(.bottom, 6)
        }
    }

    private func info(_ tab: String) -> (title: String, icon: String, emoji: String?) {
        if tab.hasPrefix("chat:") {
            let _ = store.chatsRevision
            let title = store.core.chat(id: String(tab.dropFirst(5)))?.title ?? ""
            return (title.isEmpty ? "Chat" : title, "sparkles", nil)
        }
        if tab == "anki:main" { return ("Karteikarten", "cards", nil) }
        if tab == "nlm:main" { return ("Gemini Notebook", "book", nil) }
        guard let p = store.core.page(id: tab)?.summary else { return ("Ohne Titel", "file", nil) }
        return (PageStyle.title(p), PageStyle.iconName(p), PageStyle.emoji(p))
    }

    private func newPage(_ choice: NewPageChoice) {
        if let id = store.core.createNew(choice, parent: nil, workspace: nil) { shell.openNewTab(id) }
    }
}
