import SwiftUI

/// Layout der PWA am iPad (`DeskShell.kt`): links die Seitenleiste, in der Mitte Tab-Leiste und Inhalt.
/// `NavigationSplitView` liefert das Ein-/Ausklappen der Seitenleiste und ab iOS 26 deren Liquid Glass.
struct RootView: View {
    @Environment(ImpalaStore.self) private var store
    @State private var shell: ShellModel?
    @Namespace private var namespace
    @AppStorage(AppAccent.key) private var accent = AppAccent.blue.rawValue
    @AppStorage(AppDensity.key) private var density = AppDensity.compact.rawValue
    @AppStorage(AppMotion.key) private var motion = AppMotion.full.rawValue
    @AppStorage(AppTabsPosition.key) private var tabsPosition = AppTabsPosition.top.rawValue

    var body: some View {
        if let shell {
            @Bindable var shell = shell
            @Bindable var cards = shell.cards
            NavigationSplitView(columnVisibility: $shell.columns) {
                Sidebar()
                    .navigationSplitViewColumnWidth(min: 236, ideal: 260, max: 320)
            } detail: {
                HStack(spacing: 0) {
                    VStack(spacing: 0) {
                        TabBar()
                        MainContent()
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                    }
                    if showsAiPanel(shell) {
                        AiPanel(activePageId: activePage(shell))
                            .transition(.move(edge: .trailing).combined(with: .opacity))
                    }
                }
                .overlay(alignment: .bottomTrailing) {
                    if !showsAiPanel(shell) && !isChatTab(shell) {
                        AiOrbButton()
                            .padding(Space.s4)
                            .transition(.scale(scale: 0.4).combined(with: .opacity))
                    }
                }
                .animation(.spring(duration: 0.4, bounce: 0.15), value: showsAiPanel(shell))
                .background(Impala.panel)
                .toolbar(.hidden, for: .navigationBar)
                .modifier(DeckDialogsModifier(cards: cards, core: store.core))
                .sheet(item: $cards.editor) { target in
                    CardEditorSheet(target: target).environment(shell)
                }
            }
            .navigationSplitViewStyle(.balanced)
            .tint(AppAccent(rawValue: accent)?.color ?? Impala.accent)
            .environment(shell)
            .environment(\.shellNamespace, namespace)
            .modifier(ShellShortcuts(shell: shell))
            .sheet(item: $shell.sheet) { sheet in
                ShellSheetView(sheet: sheet)
                    .environment(shell)
                    .navigationTransition(.zoom(sourceID: sheet.id, in: namespace))
            }
            .onChange(of: store.uiRevision) { shell.reload() }
            .onChange(of: store.chatsRevision) { shell.chat.reloadIfIdle() }
        } else {
            Color.clear.onAppear { shell = ShellModel(store: store) }
        }
    }
}

extension RootView {
    private func isChatTab(_ shell: ShellModel) -> Bool { shell.active?.hasPrefix("chat:") == true }

    /// Das KI-Panel steht rechts, solange es aufgeklappt ist und kein Chat-Tab vorne liegt.
    private func showsAiPanel(_ shell: ShellModel) -> Bool { shell.chat.panelOpen && !isChatTab(shell) }

    /// Geöffnete Notiz bzw. Heft als Kontext für die KI.
    private func activePage(_ shell: ShellModel) -> String? {
        guard let id = shell.active, let page = store.core.page(id: id), !page.trashed else { return nil }
        return id
    }
}

/// Inhalt des aktiven Tabs.
private struct MainContent: View {
    @Environment(ImpalaStore.self) private var store
    @Environment(ShellModel.self) private var shell

    var body: some View {
        let _ = store.pagesRevision
        // Tabwechsel blendet weich über (wie der Seitenwechsel der PWA), Haptik beim Wechsel.
        ZStack {
            if shell.libraryOpen {
                LibraryScreen().transition(.opacity.combined(with: .scale(scale: 0.995)))
            } else {
                content.transition(.opacity.combined(with: .scale(scale: 0.995)))
            }
        }
        .animation(.smooth(duration: 0.22), value: shell.active)
        .animation(.smooth(duration: 0.22), value: shell.libraryOpen)
        // Ansicht als Kontext für den Profiler (welche Ansicht hing bzw. scheiterte).
        .onChange(of: screenName, initial: true) { Profiler.shared.setScreen(screenName) }
        .sensoryFeedback(trigger: shell.active) { _, _ in AppHaptics.isEnabled ? .selection : nil }
    }

    /// Art der Ansicht ohne Inhalte (keine Titel im Protokoll).
    private var screenName: String {
        if shell.libraryOpen { return "library" }
        guard let tab = shell.active else { return "home" }
        if let page = store.core.page(id: tab), !page.trashed { return page.summary.kind == .heft ? "heft" : "note" }
        if tab.hasPrefix("chat:") { return "chat" }
        if tab == ShellModel.cardsTab { return "cards" }
        return tab == "nlm:main" ? "notebook" : "other"
    }

    @ViewBuilder
    private var content: some View {
        if let tab = shell.active {
            if let page = store.core.page(id: tab), !page.trashed {
                PageScreen(summary: page.summary).id(tab)
            } else if tab.hasPrefix("chat:") {
                ChatScreen(chatId: String(tab.dropFirst(5)))
            } else if tab == ShellModel.cardsTab {
                CardsScreen()
            } else if tab == "nlm:main" {
                NotebookView()
            } else {
                Placeholder(icon: "file", title: "Seite nicht gefunden", text: "Die Seite wurde gelöscht oder ist noch nicht synchronisiert.")
            }
        } else {
            HomeScreen()
        }
    }
}

/// Notiz oder Heft, je nach Seitenart.
struct PageScreen: View {
    let summary: PageSummary

    var body: some View {
        switch summary.kind {
        case .note: NoteEditor(pageId: summary.id)
        case .heft: HeftScreen(pageId: summary.id)
        }
    }
}

/// Leerer Zustand mit Sprite-Symbol.
struct Placeholder: View {
    let icon: String
    let title: String
    let text: String

    var body: some View {
        ContentUnavailableView {
            Label { Text(title) } icon: { Icon(icon, size: 40).foregroundStyle(Impala.text2) }
        } description: {
            Text(text)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// Globale Hardware-Tastaturkürzel der Shell (iPad Magic Keyboard).
private struct ShellShortcuts: ViewModifier {
    let shell: ShellModel

    func body(content: Content) -> some View {
        content
            .background {
                Group {
                    Button("") { shell.openSearch() }.keyboardShortcut("k", modifiers: .command)
                    Button("") { shell.newNote() }.keyboardShortcut("n", modifiers: .command)
                    Button("") { shell.newHeft() }.keyboardShortcut("h", modifiers: [.command, .shift])
                    Button("") { shell.openNewTab("home") }.keyboardShortcut("t", modifiers: .command)
                    Button("") { shell.closeActive() }.keyboardShortcut("w", modifiers: .command)
                    Button("") { shell.toggleSidebar() }.keyboardShortcut("\\", modifiers: .command)
                    Button("") { shell.goBack() }.keyboardShortcut("[", modifiers: .command)
                    Button("") { shell.goForward() }.keyboardShortcut("]", modifiers: .command)
                    Button("") { shell.setAiPanel(!shell.chat.panelOpen) }.keyboardShortcut("j", modifiers: .command)
                    Button("") { shell.sheet = .settings }.keyboardShortcut(",", modifiers: .command)
                }
                .hidden()
            }
            .background {
                Group {
                    Button("") { shell.selectTab(at: 0) }.keyboardShortcut("1", modifiers: .command)
                    Button("") { shell.selectTab(at: 1) }.keyboardShortcut("2", modifiers: .command)
                    Button("") { shell.selectTab(at: 2) }.keyboardShortcut("3", modifiers: .command)
                    Button("") { shell.selectTab(at: 3) }.keyboardShortcut("4", modifiers: .command)
                    Button("") { shell.selectTab(at: 4) }.keyboardShortcut("5", modifiers: .command)
                    Button("") { shell.selectTab(at: 5) }.keyboardShortcut("6", modifiers: .command)
                    Button("") { shell.selectTab(at: 6) }.keyboardShortcut("7", modifiers: .command)
                    Button("") { shell.selectTab(at: 7) }.keyboardShortcut("8", modifiers: .command)
                    Button("") { shell.selectTab(at: 8) }.keyboardShortcut("9", modifiers: .command)
                }
                .hidden()
            }
    }
}
