import SwiftUI

/// Overlays der Shell: Suche, Papierkorb, Einstellungen, Bibliothek, Sync-Konflikte; Graph und Notebook folgen.
struct ShellSheetView: View {
    let sheet: ShellSheet

    var body: some View {
        if sheet == .library {
            // Eigener Stapel: PDFs werden darin geöffnet (Zoom aus der Zeile).
            LibrarySheet().presentationDetents([.large])
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
                case .settings: SettingsSheet()
                case .conflicts: ConflictsSheet()
                case .library: EmptyView()
                case .graph: Placeholder(icon: "graph", title: "Wissensgraph", text: "Folgt in der iPad-App.")
                case .notebook: Placeholder(icon: "book", title: "Gemini Notebook", text: "Folgt in der iPad-App.")
                }
            }
            .toolbar { ToolbarItem(placement: .cancellationAction) { CloseButton() } }
        }
        .presentationDetents(sheet == .search || sheet == .conflicts ? [.large] : [.medium, .large])
    }
}

struct CloseButton: View {
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        Button("Schließen") { dismiss() }
    }
}

/// Volltextsuche über den Kern (`search`), wie die Suche der PWA (Titel und Inhalt, Ausschnitt).
private struct SearchSheet: View {
    @Environment(ImpalaStore.self) private var store
    @Environment(ShellModel.self) private var shell
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""

    var body: some View {
        let hits = query.trimmingCharacters(in: .whitespaces).isEmpty ? [] : store.core.search(query: query, includeArchived: false)
        List(hits, id: \.pageId) { hit in
            Button {
                shell.open(hit.pageId)
                dismiss()
            } label: {
                VStack(alignment: .leading, spacing: 2) {
                    Text(hit.title.isEmpty ? "Ohne Titel" : hit.title).font(.system(size: TextSize.md, weight: .medium)).foregroundStyle(Impala.text)
                    if !hit.snippet.isEmpty {
                        Text(hit.snippet).font(.system(size: TextSize.sm)).foregroundStyle(Impala.text2).lineLimit(2)
                    }
                }
            }
        }
        .overlay {
            if !query.isEmpty && hits.isEmpty { ContentUnavailableView.search(text: query) }
        }
        .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Notizen durchsuchen")
        .navigationTitle("Suchen")
        .navigationBarTitleDisplayMode(.inline)
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
                Button("Löschen", role: .destructive) { try? store.core.deletePageForever(id: p.id) }
                Button("Wiederherstellen") { try? store.core.restorePage(id: p.id) }.tint(Impala.accent)
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
            Button("Endgültig löschen", role: .destructive) { _ = try? store.core.emptyPageTrash() }
        }
    }
}
