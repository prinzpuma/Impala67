import SwiftUI

/// Linke Spalte der PWA (`#sidebar` in index.html, `DeskSidebar.kt`): Pillen Home · Chat · Karten · Suche,
/// darunter Seitenbaum (Favoriten + Arbeitsbereiche), unten die sekundäre Navigation (`.side-foot`).
struct Sidebar: View {
    @Environment(ImpalaStore.self) private var store
    @Environment(ShellModel.self) private var shell
    @Environment(SyncController.self) private var sync
    @Environment(\.shellNamespace) private var zoom
    @AppStorage(AppTabsPosition.key) private var tabsPosition = AppTabsPosition.top.rawValue
    @AppStorage(AppDensity.key) private var density = AppDensity.compact.rawValue
    @Namespace private var pills
    @State private var controlsInset: CGFloat = 0

    var body: some View {
        let isCompact = density == AppDensity.compact.rawValue
        VStack(alignment: .leading, spacing: isCompact ? 8 : 10) {
            // Die Pillen schweben als Liquid Glass über der Seitenleiste (wie die Leisten über dem Inhalt).
            GlassEffectContainer(spacing: 8) {
                HStack(spacing: 2) {
                    NavPills(ns: pills)
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
                // Platz für die Fensterknöpfe oben links; die Messung sitzt auf der ganzen Zeile, damit
                // der Abstand sie nicht selbst verschiebt.
                .padding(.leading, controlsInset)
                .background(WindowControlsInset(leading: $controlsInset))
                .animation(.smooth(duration: 0.2), value: controlsInset)
            }

            // In der PWA (.topbar): im Komfortabelmodus gibt es eine Kante unter den Pillen, im Kompaktmodus keine.
            if !isCompact {
                Divider().overlay(Impala.edgeSoft)
            }

            if tabsPosition == AppTabsPosition.sidebar.rawValue && shell.sidebarMode == .files {
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
        .padding(.horizontal, isCompact ? Space.s2 : 10)
        .padding(.vertical, isCompact ? 8 : 10)
        .background(Impala.sidebar)
        .clipShape(RoundedRectangle(cornerRadius: isCompact ? 0 : Radius.lg, style: .continuous))
        .overlay {
            if !isCompact {
                RoundedRectangle(cornerRadius: Radius.lg, style: .continuous)
                    .stroke(Impala.edgeSoft, lineWidth: 1)
            }
        }
        .padding(isCompact ? 0 : 6)
        // Bis an die Unterkante (wie der Inhalt rechts): sonst lagen die Fußknöpfe kompakt um die Höhe der
        // Home-Leiste zu hoch und komfortabel stand darunter ein dunkler Balken.
        .ignoresSafeArea(.container, edges: .bottom)
        .background(isCompact ? Impala.sidebar : Impala.bg0)
        .toolbar(.hidden, for: .navigationBar)
    }
}

/// Home · Chat · Karten (`.topbar`, genau eine aktiv wie render.js `renderTopbar`). Antippen wählt;
/// Wischen über die Leiste zieht die Markierung mit dem Finger mit und wählt beim Loslassen.
private struct NavPills: View {
    @Environment(ShellModel.self) private var shell
    let ns: Namespace.ID
    @State private var frames: [Int: CGRect] = [:]
    @State private var dragging: Int?

    private static let items = [("home", "Home"), ("chat", "Chat"), ("cards", "Karten")]

    private var current: Int {
        switch shell.sidebarMode {
        case .files: 0
        case .chats: 1
        case .cards: 2
        }
    }

    var body: some View {
        let shown = dragging ?? current
        HStack(spacing: 2) {
            ForEach(Self.items.indices, id: \.self) { i in
                Pill(icon: Self.items[i].0, label: Self.items[i].1, active: shown == i, ns: ns) { select(i) }
                    .onGeometryChange(for: CGRect.self) { $0.frame(in: .named("navPills")) } action: { frames[i] = $0 }
            }
        }
        .coordinateSpace(.named("navPills"))
        .simultaneousGesture(
            DragGesture(minimumDistance: 8, coordinateSpace: .named("navPills"))
                .onChanged { v in
                    let i = index(at: v.location.x)
                    if i != dragging { withAnimation(.bouncy(duration: 0.3)) { dragging = i } }
                }
                .onEnded { v in
                    let i = index(at: v.location.x)
                    dragging = nil
                    select(i)
                }
        )
    }

    /// Pille unter dem Finger, außerhalb die nächstgelegene.
    private func index(at x: CGFloat) -> Int {
        if let hit = frames.first(where: { x >= $0.value.minX && x <= $0.value.maxX }) { return hit.key }
        return frames.min(by: { abs($0.value.midX - x) < abs($1.value.midX - x) })?.key ?? current
    }

    private func select(_ i: Int) {
        withAnimation(.bouncy(duration: 0.35, extraBounce: 0.05)) {
            switch i {
            // Ein Tipp öffnet die Startseite (am iPad statt Doppelklick wie in der PWA).
            case 0: shell.goHome()
            case 1: shell.sidebarMode = .chats
            // `btnAnki` → `openAnki()`: Karten-Tab mit Stapelübersicht.
            default: shell.openCards(.decks)
            }
        }
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
        Button(action: action) { content }
            .contentShape(Capsule())
            .pressable()
            .accessibilityLabel(label)
            .sensoryFeedback(.selection, trigger: active) { _, now in AppHaptics.isEnabled && now }
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
    @AppStorage(AppDensity.key) private var density = AppDensity.compact.rawValue
    let icon: String
    let label: String
    /// Sync-Zustand als Punkt (nur am Einstellungen-Knopf, wenn gekoppelt).
    var status: SyncController.State?
    /// Angezeigte Hauptansicht (Bibliothek), wie `btnLibrary.active`.
    var active = false
    let action: () -> Void

    var body: some View {
        let isCompact = density == AppDensity.compact.rawValue
        Button(action: action) {
            HStack(spacing: Space.s2) {
                Icon(icon, size: 15)
                Text(label).font(.system(size: TextSize.sm))
                Spacer(minLength: 0)
                if let status { StatusDot(state: status) }
            }
            .foregroundStyle(active ? Impala.text : Impala.text2)
            .padding(.horizontal, Space.s2)
            .frame(minHeight: isCompact ? 32 : 40)
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
        let isCompact = density == AppDensity.compact.rawValue
        if !shell.tabs.isEmpty {
            VStack(alignment: .leading, spacing: 3) {
                HStack {
                    Text("Offene Tabs")
                        .font(.system(size: TextSize.xs, weight: .semibold))
                        .foregroundStyle(Impala.text2)
                    Spacer()
                    Menu {
                        MenuItem("Neuer Chat", icon: "sparkles") {
                            shell.openNewTab("chat:\(UUID().uuidString)")
                        }
                        MenuItem("Neue Notiz", icon: "note") { newPage(.note) }
                        MenuItem("Neues Heft", icon: "notebook") { newPage(.heft) }
                        TemplateMenuSection(create: newPage)
                        MenuItem("In neuem Tab öffnen…", icon: "search") { shell.sheet = .search }
                    } label: {
                        Icon("plus", size: 13)
                            .foregroundStyle(Impala.text2)
                            .frame(width: 24, height: 24)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .hoverEffect(.highlight)
                    .accessibilityLabel("Neuen Tab öffnen")
                }
                .padding(.horizontal, Space.s1)

                VStack(spacing: 2) {
                    ForEach(shell.tabs, id: \.self) { tab in
                        let active = !shell.libraryOpen && tab == shell.active
                        let inf = info(tab)
                        HStack(spacing: 6) {
                            Button {
                                shell.openTab(tab)
                            } label: {
                                HStack(spacing: 6) {
                                    if let emoji = inf.emoji { Text(emoji).font(.system(size: TextSize.xs)) }
                                    else { Icon(inf.icon, size: 14) }
                                    Text(inf.title)
                                        .font(.system(size: TextSize.sm, weight: active ? .medium : .regular))
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
                            .hoverEffect(.highlight)
                            .accessibilityLabel("Tab schließen")
                        }
                        .foregroundStyle(active ? Impala.text : Impala.text2)
                        .padding(.horizontal, 8)
                        .padding(.vertical, isCompact ? 3 : 6)
                        .frame(minHeight: isCompact ? 30 : 38)
                        .background(active ? Impala.activeTint : .clear, in: RoundedRectangle(cornerRadius: Radius.sm, style: .continuous))
                        .contentShape(RoundedRectangle(cornerRadius: Radius.sm, style: .continuous))
                        .hoverEffect(.highlight)
                    }
                }
            }
            .padding(.bottom, 6)
        }
    }

    private func info(_ tab: String) -> (title: String, icon: String, emoji: String?) {
        let item = shell.tabInfo(tab)
        return (item.title, item.icon, item.emoji)
    }

    private func newPage(_ choice: NewPageChoice) {
        if let id = store.core.createNew(choice, parent: nil, workspace: nil) { shell.openNewTab(id) }
    }
}
