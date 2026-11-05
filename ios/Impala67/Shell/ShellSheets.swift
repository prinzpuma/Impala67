import SwiftUI

/// Overlays der Shell: Suche, Papierkorb, Einstellungen, Sync-Konflikte, Wissensgraph, Gemini Notebook.
struct ShellSheetView: View {
    let sheet: ShellSheet

    var body: some View {
        if sheet == .settings {
            // Eigene geteilte Ansicht (Bereiche links, Inhalt rechts) wie die PWA.
            SettingsSheet().presentationSizing(.page)
        } else {
            stack
        }
    }

    private var stack: some View {
        NavigationStack {
            Group {
                switch sheet {
                case .search: SearchSheet()
                case .trash: TrashSheet()
                case .settings: EmptyView()
                case .conflicts: ConflictsSheet()
                case .graph: GraphView()
                case .notebook: NotebookView()
                }
            }
            .toolbar { ToolbarItem(placement: .cancellationAction) { CloseButton() } }
        }
        .presentationDetents(sheet == .search || sheet == .conflicts || sheet == .graph ? [.large] : [.medium, .large])
    }
}

struct CloseButton: View {
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        Button("Schließen") { dismiss() }
    }
}

/// Befehls-Menü wie die PWA (search.js `buildRows`): ohne Suchtext „Zuletzt bearbeitet“ (6), Chats (3) und
/// Aktionen; mit Suchtext Seiten (Volltext, auch Archiv), Chats (Titel oder Inhalt, 5) und passende Aktionen.
private struct SearchSheet: View {
    @Environment(ImpalaStore.self) private var store
    @Environment(ShellModel.self) private var shell
    @Environment(\.dismiss) private var dismiss
    @AppStorage(AppTheme.key) private var theme = AppTheme.system.rawValue
    @AppStorage("impala67LibMode") private var libMode = LibraryMode.notion.rawValue
    @State private var query = ""
    /// Ergebnisse der letzten Suche (im Hintergrund gelesen; der Kern hat nur eine Sperre) samt Suchtext.
    @State private var found = Found(query: "", pages: [], chats: [])
    /// Chats mit kleingeschriebenem Titel und Text, einmal je Öffnen geladen (`loadChats` in search.js).
    @State private var chatIndex: [ChatEntry]?

    private struct Action: Identifiable {
        let icon: String
        let label: String
        let run: () -> Void
        var id: String { label }
    }

    private struct PageRow: Identifiable, Sendable {
        let id: String
        let title: String
        let snippet: String
    }

    private struct ChatEntry: Sendable {
        let info: ChatInfo
        let title: String
        let text: String
    }

    private struct Found: Sendable {
        let query: String
        let pages: [PageRow]
        let chats: [ChatInfo]
    }

    /// Alle Chats einmal mit vollen Nachrichten lesen (läuft im Hintergrund).
    nonisolated private static func buildChatIndex(_ core: ImpalaCore) -> [ChatEntry] {
        core.chats().map { c in
            let text = core.chat(id: c.id)?.messages.compactMap { $0.content }.joined(separator: "\n").lowercased() ?? ""
            return ChatEntry(info: c, title: c.title.lowercased(), text: text)
        }
    }

    nonisolated private static func searchPages(_ core: ImpalaCore, query: String, ql: String) -> [PageRow] {
        ql.isEmpty
            ? core.recentPages(limit: 6).map { PageRow(id: $0.id, title: $0.title, snippet: "") }
            : core.search(query: query, includeArchived: true).map { PageRow(id: $0.pageId, title: $0.title, snippet: $0.snippet) }
    }

    /// Suche entprellt (~150 ms wie die PWA) im Hintergrund; leerer Text zeigt sofort „Zuletzt bearbeitet“.
    private func runSearch() async {
        let ql = query.trimmingCharacters(in: .whitespaces).lowercased()
        let text = query
        let core = store.core
        if !ql.isEmpty {
            try? await Task.sleep(for: .milliseconds(150))
            if Task.isCancelled { return }
        }
        var index = chatIndex
        if !ql.isEmpty, index == nil {
            let built = await Task.detached(priority: .userInitiated) { Self.buildChatIndex(core) }.value
            chatIndex = built
            index = built
        }
        if Task.isCancelled { return }
        let entries = index ?? []
        let loaded = await Task.detached(priority: .userInitiated) { () -> Found in
            let pages = Self.searchPages(core, query: text, ql: ql)
            let chats: [ChatInfo]
            if ql.isEmpty {
                chats = Array(core.chats().prefix(3))
            } else {
                chats = Array(entries.filter { $0.title.contains(ql) || $0.text.contains(ql) }.map(\.info).prefix(5))
            }
            return Found(query: ql, pages: pages, chats: chats)
        }.value
        if !Task.isCancelled { found = loaded }
    }

    var body: some View {
        let ql = query.trimmingCharacters(in: .whitespaces).lowercased()
        let pages = found.pages
        let chats = found.chats
        let acts = actions().filter { ql.isEmpty || $0.label.lowercased().contains(ql) }
        List {
            if !pages.isEmpty {
                Section(ql.isEmpty ? "Zuletzt bearbeitet" : "Seiten") {
                    ForEach(pages, id: \.id) { p in
                        Button { dismiss(); shell.open(p.id) } label: {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(p.title.isEmpty ? "Ohne Titel" : p.title)
                                    .font(.system(size: TextSize.md, weight: .medium)).foregroundStyle(Impala.text)
                                if !p.snippet.isEmpty {
                                    Text(p.snippet).font(.system(size: TextSize.sm)).foregroundStyle(Impala.text2).lineLimit(2)
                                }
                            }
                        }
                    }
                }
            }
            if !chats.isEmpty {
                Section("Chats") {
                    ForEach(chats, id: \.id) { c in
                        Button {
                            dismiss()
                            shell.chat.open(c.id, reveal: false)
                            shell.open("chat:" + c.id)
                        } label: {
                            HStack(spacing: Space.s2) {
                                Text("✦").foregroundStyle(Impala.accent)
                                Text(c.title.isEmpty ? "Chat" : c.title).foregroundStyle(Impala.text)
                            }
                        }
                    }
                }
            }
            if !acts.isEmpty {
                Section("Aktionen") {
                    ForEach(acts) { a in
                        Button { a.run() } label: {
                            Label { Text(a.label).foregroundStyle(Impala.text) } icon: { Icon(a.icon, size: 16).foregroundStyle(Impala.text2) }
                        }
                    }
                }
            }
        }
        .overlay {
            // Erst wenn die Ergebnisse zum Suchtext gehören (sonst blitzt „Keine Ergebnisse“ während des Entprellens auf).
            if !ql.isEmpty && found.query == ql && pages.isEmpty && chats.isEmpty && acts.isEmpty { ContentUnavailableView.search(text: query) }
        }
        .task(id: query) { await runSearch() }
        .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Suchen oder Befehl …")
        .navigationTitle("Suchen")
        .navigationBarTitleDisplayMode(.inline)
    }

    /// `actionItems()` in search.js.
    private func actions() -> [Action] {
        let due = shell.cards.queue?.dueNow.count ?? 0
        let light = theme == AppTheme.light.rawValue
        return [
            Action(icon: "plus", label: "Neue Seite") {
                dismiss()
                if let id = store.core.createNew(.note, parent: nil, workspace: nil) { shell.open(id) }
            },
            Action(icon: "cards", label: "Karten wiederholen" + (due > 0 ? " — \(due) fällig" : "")) {
                dismiss(); shell.openCards(.review(deck: nil, mix: false))
            },
            Action(icon: "cards", label: "Karten verwalten") { dismiss(); shell.openCards(.decks) },
            Action(icon: "book", label: "Gemini Notebook öffnen (ehemals NotebookLM)") { dismiss(); shell.open("nlm:main") },
            Action(icon: light ? "moon" : "sun", label: light ? "Dunkles Design" : "Helles Design") {
                theme = light ? AppTheme.dark.rawValue : AppTheme.light.rawValue
            },
            Action(icon: "archive", label: "Archiv in Bibliothek öffnen") {
                libMode = LibraryMode.archive.rawValue
                dismiss(); shell.open("library")
            },
            Action(icon: "trash", label: "Papierkorb öffnen") { shell.sheet = .trash },
            Action(icon: "cloud", label: "Drive-Sync in Einstellungen öffnen") { shell.sheet = .settings },
            Action(icon: "sliders", label: "Einstellungen öffnen") { shell.sheet = .settings },
        ]
    }
}
/// Papierkorb: wiederherstellen oder endgültig löschen.
private struct TrashSheet: View {
    @Environment(ImpalaStore.self) private var store
    @State private var confirmEmpty = false

    var body: some View {
        let _ = store.pageMetaRevision
        let pages = store.core.trashedPages()
        List(pages) { p in
            HStack(spacing: Space.s2) {
                PageIcon(page: p).foregroundStyle(Impala.text2)
                Text(PageStyle.title(p)).foregroundStyle(Impala.text)
            }
            .swipeActions(edge: .trailing) {
                Button("Löschen", role: .destructive) { attempt("deletePageForever", { try store.core.deletePageForever(id: p.id) }) }
                Button("Wiederherstellen") { attempt("restorePage", { try store.core.restorePage(id: p.id) }) }.tint(Impala.accent)
            }
        }
        .overlay {
            if pages.isEmpty { Placeholder(icon: "trash", title: "Papierkorb ist leer", text: "Gelöschte Seiten landen hier.") }
        }
        .navigationTitle("Papierkorb")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if !pages.isEmpty {
                ToolbarItem(placement: .primaryAction) {
                    Button("Leeren", role: .destructive) { confirmEmpty = true }
                }
            }
        }
        .confirmationDialog("Papierkorb endgültig leeren?", isPresented: $confirmEmpty, titleVisibility: .visible) {
            Button("Endgültig löschen", role: .destructive) { _ = attempt("emptyPageTrash", { try store.core.emptyPageTrash() }) }
        }
    }
}
