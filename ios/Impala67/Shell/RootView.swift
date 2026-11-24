import SwiftUI

/// Layout der PWA am iPad (`DeskShell.kt`): links die Seitenleiste, in der Mitte Tab-Leiste und Inhalt.
/// `NavigationSplitView` liefert das Ein-/Ausklappen der Seitenleiste und ab iOS 26 deren Liquid Glass.
struct RootView: View {
    @Environment(ImpalaStore.self) private var store
    @State private var shell: ShellModel?
    @Namespace private var namespace
    @AppStorage(AppAccent.key) private var accent = AppAccent.blue.rawValue
    @AppStorage(AppDensity.key) private var density = AppDensity.standard.rawValue
    @AppStorage(AppMotion.key) private var motion = AppMotion.full.rawValue
    @AppStorage(AppTabsPosition.key) private var tabsPosition = AppTabsPosition.top.rawValue
    @AppStorage(AppStatusBar.hiddenKey) private var statusBarHidden = false
    /// Fensterbreite: im Hochformat (< 1100 pt) schwebt das KI-Panel über dem Inhalt wie die PWA ≤ 1024 px.
    @State private var windowWidth: CGFloat = 1366
    /// Bildschirmtastatur offen: Der KI-Knopf tritt zur Seite, statt über Blockleiste und Text zu liegen.
    @State private var keyboardUp = false

    var body: some View {
        if let shell {
            @Bindable var shell = shell
            @Bindable var cards = shell.cards
            let isCompact = density == AppDensity.compact.rawValue
            NavigationSplitView(columnVisibility: $shell.columns) {
                Sidebar()
                    .navigationSplitViewColumnWidth(
                        min: isCompact ? 220 : 236,
                        ideal: isCompact ? 236 : 260,
                        max: isCompact ? 320 : 340
                    )
            } detail: {
                HStack(spacing: isCompact ? 0 : 6) {
                    VStack(spacing: 0) {
                        if showTopTabBar(shell) {
                            TabBar()
                        }
                        MainContent()
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                    }
                    .background(Impala.panel)
                    .clipShape(RoundedRectangle(cornerRadius: isCompact ? 0 : Radius.lg, style: .continuous))
                    .overlay {
                        if !isCompact {
                            RoundedRectangle(cornerRadius: Radius.lg, style: .continuous)
                                .stroke(Impala.edgeSoft, lineWidth: 1)
                        }
                    }

                    if showsAiPanel(shell) && !aiOverlay {
                        AiPanel(activePageId: activePage(shell))
                            .transition(.move(edge: .trailing).combined(with: .opacity))
                            .background(Impala.panel)
                            .clipShape(RoundedRectangle(cornerRadius: isCompact ? 0 : Radius.lg, style: .continuous))
                            .overlay {
                                if isCompact {
                                    Rectangle().fill(Impala.edgeSoft).frame(width: 1)
                                        .frame(maxWidth: .infinity, alignment: .leading)
                                } else {
                                    RoundedRectangle(cornerRadius: Radius.lg, style: .continuous)
                                        .stroke(Impala.edgeSoft, lineWidth: 1)
                                }
                            }
                    }
                }
                .padding(isCompact ? 0 : 6)
                // Bis an die Unterkante: Sonst blieb unter den Panels der Streifen der Home-Leiste als
                // dunkler Balken stehen (Komfortabel). Die Tastatur weicht weiterhin aus (nur `.container`).
                .ignoresSafeArea(.container, edges: .bottom)
                // Hochformat: schwebendes Panel rechts (`#panel` mit `position: fixed` ≤ 1024 px), der Inhalt
                // behält seine volle Breite statt auf einen schmalen Streifen zu schrumpfen.
                .overlay(alignment: .trailing) {
                    if showsAiPanel(shell) && aiOverlay {
                        AiPanel(activePageId: activePage(shell), width: min(400, windowWidth * 0.46))
                            .background(Impala.panel)
                            .clipShape(RoundedRectangle(cornerRadius: Radius.lg, style: .continuous))
                            .overlay {
                                RoundedRectangle(cornerRadius: Radius.lg, style: .continuous).stroke(Impala.edgeSoft, lineWidth: 1)
                            }
                            .shadow(color: .black.opacity(0.28), radius: 20, x: -6)
                            .padding(6)
                            .transition(.move(edge: .trailing).combined(with: .opacity))
                    }
                }
                .overlay(alignment: .bottomTrailing) {
                    if !showsAiPanel(shell) && !isChatTab(shell) && !keyboardUp {
                        AiOrbButton()
                            .padding(.trailing, Space.s4)
                            // Über der Home-Leiste: Ganz unten fing die Systemgeste Tipps auf den Knopf ab.
                            .padding(.bottom, Space.s6)
                            .transition(.scale(scale: 0.4).combined(with: .opacity))
                    }
                }
                .animation(.spring(duration: 0.4, bounce: 0.15), value: showsAiPanel(shell))
                .animation(.snappy, value: keyboardUp)
                .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillShowNotification)) { note in
                    // Hardware-Tastatur: nur die schmale Kürzelleiste erscheint – dann bleibt der Knopf.
                    let frame = (note.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? NSValue)?.cgRectValue ?? .zero
                    keyboardUp = frame.height > 120
                }
                .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)) { _ in keyboardUp = false }
                .background(isCompact ? Impala.panel : Impala.bg0)
                .toolbar(.hidden, for: .navigationBar)
                .modifier(DeckDialogsModifier(cards: cards, core: store.core))
                .sheet(item: $cards.editor) { target in
                    CardEditorSheet(target: target).environment(shell)
                }
            }
            .navigationSplitViewStyle(.balanced)
            .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { windowWidth = $0 }
            .statusBarHidden(statusBarHidden)
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
            // Stapel und Lernschlange einmal je Kartenänderung, im Hintergrund (Stapelbaum, Übersicht, Suche).
            .task(id: store.cardsRevision) { await shell.cards.refresh(core: store.core) }
            // Semantischer Index („Verwandt“): nach Seitenänderungen entprellt im Hintergrund nachführen.
            .task(id: [store.pagesRevision, store.settingsRevision]) { await SemanticStatus.shared.pagesChanged(core: store.core) }
            .onChange(of: store.chatsRevision) { shell.chatsChanged() }
            .task(id: [store.pageMetaRevision, store.chatsRevision]) { shell.refreshTabInfos() }
        } else {
            Color.clear.onAppear { shell = ShellModel(store: store) }
        }
    }
}

extension RootView {
    private func isChatTab(_ shell: ShellModel) -> Bool { shell.active?.hasPrefix("chat:") == true }

    /// Das KI-Panel steht rechts, solange es aufgeklappt ist und kein Chat-Tab vorne liegt.
    private func showsAiPanel(_ shell: ShellModel) -> Bool { shell.aiPanelOpen && !isChatTab(shell) }

    /// Hochformat: KI-Panel schwebt über dem Inhalt (PWA ≤ 1024 px). Alle iPads sind hochkant schmaler
    /// als 1100 pt und quer breiter.
    private var aiOverlay: Bool { windowWidth < 1100 }

    /// Geöffnete Notiz bzw. Heft als Kontext für die KI.
    private func activePage(_ shell: ShellModel) -> String? {
        guard let id = shell.active, shell.tabInfo(id).kind != nil else { return nil }
        return id
    }

    /// Ob die obere Tab-Leiste gezeichnet werden soll.
    /// In der PWA (.tabs-in-sidebar): In Notiz und Heft wird #tabbar komplett ausgeblendet (`display: none`),
    /// da ☰ ‹ › direkt in der Kopfzeile des Editors bzw. Hefts sitzen.
    private func showTopTabBar(_ shell: ShellModel) -> Bool {
        if tabsPosition == AppTabsPosition.top.rawValue { return true }
        if shell.libraryOpen { return true }
        guard let active = shell.active else { return true } // Startseite
        let kind = shell.tabInfo(active).kind
        if kind == .note || kind == .heft { return false }
        return true
    }
}

/// Inhalt des aktiven Tabs.
private struct MainContent: View {
    @Environment(ImpalaStore.self) private var store
    @Environment(ShellModel.self) private var shell

    var body: some View {
        let _ = store.pageMetaRevision
        // Tabwechsel blendet weich über (wie der Seitenwechsel der PWA), Haptik beim Wechsel.
        ZStack {
            if shell.libraryOpen {
                LibraryScreen().transition(.opacity.combined(with: .scale(scale: 0.995)))
            } else {
                content.id(shell.active ?? "home").transition(.opacity.combined(with: .scale(scale: 0.995)))
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
        if let kind = shell.tabInfo(tab).kind { return kind == .heft ? "heft" : "note" }
        if tab.hasPrefix("chat:") { return "chat" }
        if tab == ShellModel.cardsTab { return "cards" }
        return "other"
    }

    @ViewBuilder
    private var content: some View {
        if let tab = shell.active {
            let item = shell.tabInfo(tab)
            if let kind = item.kind {
                PageScreen(pageId: tab, kind: kind).id(tab)
            } else if tab.hasPrefix("chat:") {
                ChatScreen(chatId: String(tab.dropFirst(5))).id(tab)
            } else if tab == ShellModel.cardsTab {
                CardsScreen()
            } else {
                Placeholder(icon: "file", title: "Seite nicht gefunden", text: "Die Seite wurde gelöscht oder ist noch nicht synchronisiert.")
            }
        } else {
            HomeScreen()
        }
    }
}

/// Notiz oder Heft, je nach Seitenart. Nur ID und Art: Ändert sich bloß Titel oder Zeitstempel
/// der Seite (jedes Speichern), bleiben die Eingaben gleich und Editor bzw. Heft werden nicht neu
/// aufgebaut.
struct PageScreen: View, Equatable {
    let pageId: String
    let kind: PageKind

    var body: some View {
        switch kind {
        case .note: NoteEditor(pageId: pageId)
        case .heft: HeftScreen(pageId: pageId)
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

/// Tastenkürzel der Shell wie shortcuts.js: nur Strg/Cmd+K öffnet bzw. schließt das Befehls-Menü
/// (Lernen und Heft haben ihre eigenen Kürzel an Ort und Stelle).
private struct ShellShortcuts: ViewModifier {
    let shell: ShellModel

    func body(content: Content) -> some View {
        content.background {
            Button("") { shell.sheet = shell.sheet == .search ? nil : .search }
                .keyboardShortcut("k", modifiers: .command)
                .hidden()
            // ⌥Leertaste: Diktat im KI-Panel (web/shortcuts.js → `VOICE.toggle("side")`).
            Button("") {
                if shell.active?.hasPrefix("chat:") != true { shell.setAiPanel(true) }
                shell.activeChat.dictationRequest = true
            }
            .keyboardShortcut(.space, modifiers: .option)
            .hidden()
            // ⌘[ : Zurück wie im Browser / iPadOS / macOS
            Button("") { shell.goBack() }
                .keyboardShortcut("[", modifiers: .command)
                .disabled(!shell.canGoBack)
                .hidden()
            // ⌘] : Vor wie im Browser / iPadOS / macOS
            Button("") { shell.goForward() }
                .keyboardShortcut("]", modifiers: .command)
                .disabled(!shell.canGoForward)
                .hidden()
            // Escape: Schließt offene Sheets, Bibliothek oder Lern-Unteransichten
            Button("") { shell.handleEscape() }
                .keyboardShortcut(.escape, modifiers: [])
                .hidden()
        }
    }
}
