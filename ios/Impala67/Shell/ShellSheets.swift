import SwiftUI

/// Overlays der Shell: Suche, Papierkorb, Einstellungen, Sync-Konflikte, Wissensgraph.
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
                }
            }
            .toolbar { ToolbarItem(placement: .cancellationAction) { CloseButton() } }
        }
        .presentationDetents(sheet == .search || sheet == .conflicts || sheet == .graph || sheet == .trash ? [.large] : [.medium, .large])
    }
}

struct CloseButton: View {
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        Button("Schließen") { dismiss() }
    }
}

/// Befehls-Menü wie die PWA (`web/search.js`): ohne Suchtext „Zuletzt bearbeitet“ (6), Chats (3) und
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

    private struct Action: Identifiable {
        let id: String
        let icon: String
        let label: String
        let run: () -> Void
    }

    private struct Found: Sendable {
        let query: String
        let pages: [PalettePageHit]
        let chats: [ChatInfo]
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
        let loaded = await Task.detached(priority: .userInitiated) { () -> Found in
            let pages = core.palettePages(query: text, recentLimit: 6)
            let chats = core.paletteChats(query: text, includeMessages: true, limit: ql.isEmpty ? 3 : 5)
            return Found(query: ql, pages: pages, chats: chats)
        }.value
        if !Task.isCancelled { found = loaded }
    }

    var body: some View {
        let ql = query.trimmingCharacters(in: .whitespaces).lowercased()
        let pages = found.pages
        let chats = found.chats
        let allActions = actions()
        let matchedActionIds = Set(
            searchFilterActions(
                actions: allActions.map { PaletteActionDef(id: $0.id, label: $0.label) },
                query: query
            )
        )
        let acts = allActions.filter { matchedActionIds.contains($0.id) }
        List {
            if !pages.isEmpty {
                Section(ql.isEmpty ? "Zuletzt bearbeitet" : "Seiten") {
                    ForEach(pages, id: \.summary.id) { p in
                        Button { dismiss(); shell.open(p.summary.id) } label: {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(p.summary.title.isEmpty ? "Ohne Titel" : p.summary.title)
                                    .font(.system(size: TextSize.md, weight: .medium)).foregroundStyle(Impala.text)
                                if !p.snippet.isEmpty {
                                    Text(p.snippet).font(.system(size: TextSize.sm)).foregroundStyle(Impala.text2).lineLimit(2)
                                }
                            }
                        }
                        .contextMenu {
                            Button {
                                dismiss()
                                shell.openNewTab(p.summary.id)
                            } label: {
                                Label { Text("In neuem Tab öffnen") } icon: { Icon("external") }
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
            Action(id: "new-page", icon: "plus", label: "Neue Seite") {
                dismiss()
                if let id = store.core.createNew(.note, parent: nil, workspace: nil) { shell.open(id) }
            },
            Action(id: "review-cards", icon: "cards", label: "Karten wiederholen" + (due > 0 ? " — \(due) fällig" : "")) {
                dismiss(); shell.openCards(.review(deck: nil, mix: false))
            },
            Action(id: "manage-cards", icon: "cards", label: "Karten verwalten") { dismiss(); shell.openCards(.decks) },
            Action(id: "toggle-theme", icon: light ? "moon" : "sun", label: light ? "Dunkles Design" : "Helles Design") {
                theme = light ? AppTheme.dark.rawValue : AppTheme.light.rawValue
            },
            Action(id: "open-archive", icon: "archive", label: "Archiv in Bibliothek öffnen") {
                libMode = LibraryMode.archive.rawValue
                dismiss(); shell.open("library")
            },
            Action(id: "open-trash", icon: "trash", label: "Papierkorb öffnen") { shell.sheet = .trash },
            Action(id: "open-sync-settings", icon: "cloud", label: "Drive-Sync in Einstellungen öffnen") { shell.sheet = .settings },
            Action(id: "open-settings", icon: "sliders", label: "Einstellungen öffnen") { shell.sheet = .settings },
        ]
    }
}
/// Papierkorb: wiederherstellen oder endgültig löschen.
private struct TrashSheet: View {
    private enum TrashFilter: String, CaseIterable, Identifiable {
        case all = "Alle"
        case pages = "Seiten"
        case decks = "Stapel"
        case cards = "Karten"
        var id: String { rawValue }
    }

    /// Endgültig zu löschendes Element (Rückfrage wie `data-deckpurge`/`data-cardpurge` der PWA).
    private enum Purge: Identifiable {
        case page(PageSummary), deck(DeckInfo), card(CardInfo)
        var id: String {
            switch self {
            case .page(let p): "p:" + p.id
            case .deck(let d): "d:" + d.name
            case .card(let c): "c:" + c.id
            }
        }
    }

    @Environment(ImpalaStore.self) private var store
    @State private var filter: TrashFilter = .all
    @State private var confirmEmpty = false
    @State private var purge: Purge?
    @State private var pages: [PageSummary] = []
    @State private var decks: [DeckInfo] = []
    @State private var cards: [CardInfo] = []

    var body: some View {
        let total = pages.count + decks.count + cards.count
        let showPages = (filter == .all || filter == .pages) && !pages.isEmpty
        let showDecks = (filter == .all || filter == .decks) && !decks.isEmpty
        let showCards = (filter == .all || filter == .cards) && !cards.isEmpty
        let isEmpty = !showPages && !showDecks && !showCards
        let hasAnyTrash = total > 0

        ScrollView {
            VStack(alignment: .leading, spacing: Space.s4) {
                Text("Seiten, Stapel und Karten — wiederherstellbar, bis du sie endgültig löschst.")
                    .font(.system(size: TextSize.sm))
                    .foregroundStyle(Impala.text2)

                if hasAnyTrash {
                    trashFilterBar(total: total)
                }

                trashContent(
                    showPages: showPages,
                    showDecks: showDecks,
                    showCards: showCards,
                    isEmpty: isEmpty,
                    hasAnyTrash: hasAnyTrash
                )
            }
            .padding(Space.s5)
        }
        .background(Impala.panel)
        .navigationTitle("Papierkorb")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if hasAnyTrash {
                ToolbarItem(placement: .primaryAction) {
                    Button("Leeren", role: .destructive) { confirmEmpty = true }
                }
            }
        }
        .confirmationDialog("Papierkorb endgültig leeren?", isPresented: $confirmEmpty, titleVisibility: .visible) {
            Button("Endgültig löschen", role: .destructive) {
                _ = attempt("emptyPageTrash", { try store.core.emptyPageTrash() })
                _ = attempt("emptyCardTrash", { try store.core.emptyCardTrash() })
            }
        }
        .confirmationDialog("Endgültig löschen?", isPresented: Binding(get: { purge != nil }, set: { if !$0 { purge = nil } }),
                            titleVisibility: .visible, presenting: purge) { p in
            Button("Löschen", role: .destructive) {
                switch p {
                case .page(let pg): attempt("deletePageForever", { try store.core.deletePageForever(id: pg.id) })
                case .deck(let d): attempt("deleteDeck", { try store.core.deleteDeck(name: d.name) })
                case .card(let c): attempt("deleteCard", { try store.core.deleteCard(id: c.id) })
                }
            }
        } message: { p in
            switch p {
            case .page(let pg):
                Text("Seite „\(PageStyle.title(pg))“ wird unwiderruflich entfernt.")
            case .deck(let d):
                Text("Stapel „\(Deck.label(d.name))“" + (d.cards > 0 ? " samt \(Deck.cardsText(Int(d.cards)))" : "") + " wird unwiderruflich entfernt.")
            case .card:
                Text("Die Karte wird unwiderruflich entfernt.")
            }
        }
        .task(id: "\(store.pageMetaRevision):\(store.cardsRevision)") {
            await loadTrash()
        }
    }

    private func trashFilterBar(total: Int) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: Space.s2) {
                filterChip(.all, count: total)
                if !pages.isEmpty { filterChip(.pages, count: pages.count) }
                if !decks.isEmpty { filterChip(.decks, count: decks.count) }
                if !cards.isEmpty { filterChip(.cards, count: cards.count) }
            }
        }
    }

    @ViewBuilder
    private func trashContent(showPages: Bool, showDecks: Bool, showCards: Bool, isEmpty: Bool, hasAnyTrash: Bool) -> some View {
        if isEmpty {
            Placeholder(
                icon: "trash",
                title: hasAnyTrash ? "Keine Einträge in diesem Filter." : "Der Papierkorb ist leer.",
                text: hasAnyTrash ? "Wähle oben einen anderen Filter." : "Gelöschte Seiten, Stapel und Karten landen hier."
            )
            .padding(.vertical, Space.s6)
        } else {
            if showPages {
                trashSection("Seiten") {
                    ForEach(Array(pages.enumerated()), id: \.element.id) { idx, p in
                        if idx > 0 { Divider().overlay(Impala.edgeSoft) }
                        trashRow(
                            title: PageStyle.title(p),
                            subtitle: p.kind == .heft ? "Heft" : (p.pdfId != nil ? "PDF" : "Notiz"),
                            icon: { PageIcon(page: p, size: 16).foregroundStyle(Impala.text2) },
                            onRestore: { attempt("restorePage", { try store.core.restorePage(id: p.id) }) },
                            onDelete: { purge = .page(p) }
                        )
                    }
                }
            }

            if showDecks {
                trashSection("Stapel") {
                    ForEach(Array(decks.enumerated()), id: \.element.name) { idx, d in
                        if idx > 0 { Divider().overlay(Impala.edgeSoft) }
                        trashRow(
                            title: Deck.label(d.name),
                            subtitle: d.cards > 0 ? Deck.cardsText(Int(d.cards)) : "Stapel",
                            icon: { Icon("cards", size: 16).foregroundStyle(Impala.text2) },
                            onRestore: { attempt("restoreDeck", { try store.core.restoreDeck(name: d.name) }) },
                            onDelete: { purge = .deck(d) }
                        )
                    }
                }
            }

            if showCards {
                trashSection("Karten") {
                    ForEach(Array(cards.enumerated()), id: \.element.id) { idx, c in
                        if idx > 0 { Divider().overlay(Impala.edgeSoft) }
                        let preview = markdownPlainText(markdown: c.front).trimmingCharacters(in: .whitespacesAndNewlines)
                        trashRow(
                            title: preview.isEmpty ? "(leer)" : preview,
                            subtitle: Deck.label(c.deck),
                            icon: { Icon("cards", size: 16).foregroundStyle(Impala.text2) },
                            onRestore: { attempt("restoreCard", { try store.core.restoreCard(id: c.id) }) },
                            onDelete: { purge = .card(c) }
                        )
                    }
                }
            }
        }
    }

    private func loadTrash() async {
        let core = store.core
        let sep = Deck.sep
        let loaded = await Task.detached(priority: .userInitiated) { () -> ([PageSummary], [DeckInfo], [CardInfo]) in
            let p = core.trashedPages()
            let d = core.trashedDecks()
            let deckNames = d.map(\.name)
            let c = core.trashedCards().filter { card in
                !deckNames.contains { name in
                    card.deck == name || card.deck.hasPrefix(name + sep)
                }
            }
            return (p, d, c)
        }.value
        if !Task.isCancelled {
            pages = loaded.0
            decks = loaded.1
            cards = loaded.2
        }
    }

    private func filterChip(_ item: TrashFilter, count: Int) -> some View {
        let active = filter == item
        return Button { withAnimation(.snappy) { filter = item } } label: {
            Text("\(item.rawValue) (\(count))")
                .font(.system(size: TextSize.xs, weight: active ? .semibold : .medium))
                .foregroundStyle(active ? Impala.accent : Impala.text2)
                .padding(.horizontal, Space.s3)
                .frame(minHeight: 32)
                .background(active ? Impala.activeTint : Impala.surface, in: Capsule())
                .overlay(Capsule().stroke(active ? Impala.accentBorder : Impala.edgeSoft, lineWidth: 1))
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
    }

    private func trashSection<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: Space.s2) {
            Text(title)
                .font(.system(size: TextSize.xs, weight: .semibold))
                .foregroundStyle(Impala.text2)
                .padding(.horizontal, Space.s1)
            VStack(spacing: 0) {
                content()
            }
            .background(Impala.surface, in: RoundedRectangle(cornerRadius: Radius.lg, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Radius.lg, style: .continuous).stroke(Impala.edgeSoft, lineWidth: 1))
        }
    }

    private func trashRow<IconView: View>(
        title: String,
        subtitle: String,
        @ViewBuilder icon: () -> IconView,
        onRestore: @escaping () -> Void,
        onDelete: @escaping () -> Void
    ) -> some View {
        HStack(spacing: Space.s3) {
            icon()
                .frame(width: 24)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(size: TextSize.md, weight: .medium))
                    .foregroundStyle(Impala.text)
                    .lineLimit(2)
                Text(subtitle)
                    .font(.system(size: TextSize.xs))
                    .foregroundStyle(Impala.text2)
                    .lineLimit(1)
            }
            Spacer(minLength: Space.s2)
            Button(action: onRestore) {
                Text("Wiederherstellen")
                    .font(.system(size: TextSize.xs, weight: .semibold))
                    .foregroundStyle(Impala.accent)
                    .padding(.horizontal, Space.s3)
                    .frame(minHeight: 30)
                    .background(Impala.activeTint, in: Capsule())
                    .contentShape(Capsule())
            }
            .buttonStyle(.plain)

            Button(action: onDelete) {
                Icon("trash", size: 14)
                    .foregroundStyle(Impala.danger)
                    .frame(width: 32, height: 32)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Endgültig löschen")
        }
        .padding(.horizontal, Space.s4)
        .padding(.vertical, Space.s3)
    }
}
