import SwiftUI

/// Layout der PWA am iPad (`DeskShell.kt`): links die Seitenleiste, in der Mitte Tab-Leiste und Inhalt.
/// `NavigationSplitView` liefert das Ein-/Ausklappen der Seitenleiste und ab iOS 26 deren Liquid Glass.
struct RootView: View {
    @Environment(ImpalaStore.self) private var store
    @State private var shell: ShellModel?
    @Namespace private var namespace

    var body: some View {
        if let shell {
            @Bindable var shell = shell
            NavigationSplitView(columnVisibility: $shell.columns) {
                Sidebar()
                    .navigationSplitViewColumnWidth(min: 236, ideal: 260, max: 320)
            } detail: {
                VStack(spacing: 0) {
                    TabBar()
                    MainContent()
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
                .background(Impala.panel)
                .toolbar(.hidden, for: .navigationBar)
            }
            .navigationSplitViewStyle(.balanced)
            .environment(shell)
            .environment(\.shellNamespace, namespace)
            .sheet(item: $shell.sheet) { sheet in
                ShellSheetView(sheet: sheet)
                    .environment(shell)
                    .navigationTransition(.zoom(sourceID: sheet.id, in: namespace))
            }
            .onChange(of: store.uiRevision) { shell.reload() }
        } else {
            Color.clear.onAppear { shell = ShellModel(store: store) }
        }
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
            content.id(shell.active ?? "home").transition(.opacity.combined(with: .scale(scale: 0.995)))
        }
        .animation(.smooth(duration: 0.22), value: shell.active)
        .sensoryFeedback(.selection, trigger: shell.active)
    }

    @ViewBuilder
    private var content: some View {
        if let tab = shell.active {
            if let page = store.core.page(id: tab), !page.trashed {
                PageScreen(summary: page.summary).id(tab)
            } else if tab.hasPrefix("chat:") {
                Placeholder(icon: "chat", title: "KI-Chat", text: "Chats folgen in der iPad-App.")
            } else if tab == "anki:main" {
                Placeholder(icon: "cards", title: "Karteikarten", text: "Karteikarten folgen in der iPad-App.")
            } else if tab == "nlm:main" {
                Placeholder(icon: "book", title: "Gemini Notebook", text: "Folgt in der iPad-App.")
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
