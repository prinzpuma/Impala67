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

    private struct Action: Identifiable {
        let icon: String
        let label: String
        let run: () -> Void
        var id: String { label }
    }

    var body: some View {
        let ql = query.trimmingCharacters(in: .whitespaces).lowercased()
        let pages: [(id: String, title: String, snippet: String)] = ql.isEmpty
            ? store.core.recentPages(limit: 6).map { ($0.id, $0.title, "") }
            : store.core.search(query: query, includeArchived: true).map { ($0.pageId, $0.title, $0.snippet) }
        let chats = Array(store.core.chats().filter { c in
            ql.isEmpty || c.title.lowercased().contains(ql)
                || (store.core.chat(id: c.id)?.messages.contains { ($0.content ?? "").lowercased().contains(ql) } ?? false)
        }.prefix(ql.isEmpty ? 3 : 5))
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
            if !ql.isEmpty && pages.isEmpty && chats.isEmpty && acts.isEmpty { ContentUnavailableView.search(text: query) }
        }
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
        let _ = store.pagesRevision
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
