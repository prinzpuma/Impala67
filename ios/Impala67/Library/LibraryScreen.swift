import SwiftUI
import UniformTypeIdentifiers

/// Ansichten der Bibliothek wie `libModeTabsHtml` in web/library.js. Dieselbe Seite gibt es nur einmal;
/// die Ansichten ordnen sie nur anders an (Baum, Heft-Regal, Archiv, Gemini Notebook).
enum LibraryMode: String, CaseIterable, Identifiable {
    case notion, hefte, archive, nlm

    var id: String { rawValue }

    var label: String {
        switch self {
        case .notion: "Notion"
        case .hefte: "GoodNotes"
        case .archive: "Archiv"
        case .nlm: "Gemini Notebook"
        }
    }

    var icon: String {
        switch self {
        case .notion: "note"
        case .hefte: "notebook"
        case .archive: "archive"
        case .nlm: "inbox"
        }
    }
}

/// Bibliothek als Hauptansicht wie in der PWA (`S.view = "library"`, nicht als Fenster): oben Titel mit Zähler,
/// darunter ein warmes Papier-Panel mit einer Leiste (Ansichten + Suche), Filter bzw. Pfad und dem Inhalt.
/// PDFs öffnen nativ mit PDFKit, alles andere öffnet die Seite im Tab.
struct LibraryScreen: View {
    @Environment(ImpalaStore.self) private var store
    @Environment(ShellModel.self) private var shell
    @AppStorage("impala67LibMode") private var modeRaw = LibraryMode.notion.rawValue
    @State private var path: [String] = []
    @State private var query = ""
    @State private var importing = false
    @State private var failed = false
    @State private var counts: (pages: Int, hefte: Int)?
    @Namespace private var zoom

    private var mode: LibraryMode { LibraryMode(rawValue: modeRaw) ?? .notion }

    var body: some View {
        NavigationStack(path: $path) {
            VStack(alignment: .leading, spacing: Space.s3) {
                header
                Group {
                    switch mode {
                    case .notion: NotionTree(query: $query, onOpen: open, onImport: { importing = true })
                    case .hefte: HeftShelf(query: $query, onOpen: open)
                    case .archive: ArchiveList(query: $query, onOpen: open)
                    case .nlm:
                        VStack(spacing: 0) {
                            LibToolbar(query: $query, prompt: nil) { EmptyView() } trailing: { EmptyView() }
                            NotebookView(background: .clear)
                        }
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                .background(Shelf.paper)
                .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 24, style: .continuous).strokeBorder(Shelf.edge, lineWidth: 1))
                .padding(.horizontal, Space.s6)
                .padding(.bottom, Space.s4)
            }
            .background(Impala.panel)
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: String.self) { id in
                if let page = store.core.page(id: id)?.summary {
                    PdfScreen(page: page)
                        .navigationTransition(.zoom(sourceID: id, in: zoom))
                }
            }
        }
        .environment(\.libraryZoom, zoom)
        .onChange(of: modeRaw) { query = "" }
        .task(id: store.pageMetaRevision) {
            let core = store.core
            let next = await Task.detached(priority: .utility) { () -> (pages: Int, hefte: Int) in
                let all = core.recentPages(limit: UInt32.max)
                let hefte = all.filter { $0.kind == .heft }.count
                return (pages: all.count - hefte, hefte: hefte)
            }.value
            if !Task.isCancelled { counts = next }
        }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.pdf], allowsMultipleSelection: true) { result in
            guard case .success(let urls) = result else { return }
            importPdfs(urls)
        }
        .alert("PDF-Datei konnte nicht geladen werden.", isPresented: $failed) { Button("OK", role: .cancel) {} }
    }

    /// Titel mit Zähler wie `.lib-head`: „Bibliothek  12 Seiten · 3 Hefte“.
    private var header: some View {
        HStack(alignment: .firstTextBaseline, spacing: 14) {
            Text("Bibliothek")
                .font(.system(size: TextSize.xl, weight: .bold, design: .rounded))
                .foregroundStyle(Impala.text)
            if let counts {
                Text(Self.count(counts.pages, "Seite", "Seiten") + " · " + Self.count(counts.hefte, "Heft", "Hefte"))
                    .font(.system(size: TextSize.sm).monospacedDigit())
                    .foregroundStyle(Impala.text2)
                    .contentTransition(.numericText())
            }
        }
        .padding(.horizontal, Space.s6)
        .padding(.top, Space.s6)
        .animation(.snappy, value: counts?.pages)
        .animation(.snappy, value: counts?.hefte)
    }

    private static func count(_ n: Int, _ one: String, _ many: String) -> String {
        "\(n) \(n == 1 ? one : many)"
    }

    /// PDF-Seiten nativ lesen, alles andere als Tab öffnen.
    private func open(_ page: PageSummary) {
        if page.pdfId != nil { path.append(page.id) } else { shell.open(page.id) }
    }

    /// Gewählte PDFs in den Kern; das letzte öffnet sich gleich.
    private func importPdfs(_ urls: [URL]) {
        var last: String?
        for url in urls {
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            guard let data = try? Data(contentsOf: url),
                  let id = attempt("importPdf", { try store.core.importPdf(name: url.lastPathComponent, bytes: data) }) else {
                failed = true
                continue
            }
            last = id
        }
        if let last { path = [last] }
    }
}

extension EnvironmentValues {
    /// Zoom-Quelle für das Öffnen eines PDFs aus einer Bibliothekszeile.
    @Entry var libraryZoom: Namespace.ID? = nil
}

// MARK: Werkzeugzeile

/// Filter-Chip mit Anzahl wie `.lib-tab` + `.lib-tab-n`.
struct LibFilter: Identifiable {
    let id: String
    let label: String
    let count: Int
}

/// Leiste wie `libToolbarHtml`: oben die Ansichten als Reiter und rechts Suche bzw. Aktion (eine helle Pille),
/// darunter links Filter oder Pfad. In jeder Ansicht an derselben Stelle.
struct LibToolbar<Left: View, Trailing: View>: View {
    @AppStorage("impala67LibMode") private var modeRaw = LibraryMode.notion.rawValue
    @Binding var query: String
    /// `nil` = keine Suche (Gemini Notebook).
    let prompt: String?
    let left: Left
    let trailing: Trailing

    init(query: Binding<String>, prompt: String?, @ViewBuilder left: () -> Left, @ViewBuilder trailing: () -> Trailing) {
        _query = query
        self.prompt = prompt
        self.left = left()
        self.trailing = trailing()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            ViewThatFits(in: .horizontal) {
                HStack(spacing: Space.s2) {
                    modes
                    search
                    trailing
                }
                VStack(alignment: .leading, spacing: 6) {
                    ScrollView(.horizontal) { modes }.scrollIndicators(.hidden)
                    HStack(spacing: Space.s2) {
                        search
                        trailing
                    }
                }
            }
            .padding(6)
            .background(Shelf.sheet, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Shelf.edge, lineWidth: 1))
            .shadow(color: Color(uiColor: UIColor(hex: 0x3C230F, alpha: 0.18)), radius: 4, y: 2)
            left
        }
        .padding(.horizontal, 26)
        .padding(.top, 16)
    }

    /// Ansichten als Reiter (`.lib-modes`): aktiver Reiter warm getönt.
    private var modes: some View {
        HStack(spacing: 2) {
            ForEach(LibraryMode.allCases) { m in
                Button {
                    withAnimation(.snappy) { modeRaw = m.rawValue }
                } label: {
                    HStack(spacing: 6) {
                        Icon(m.icon, size: 15)
                        Text(m.label).lineLimit(1)
                    }
                    .font(.system(size: TextSize.sm, weight: .semibold))
                    .foregroundStyle(modeRaw == m.rawValue ? Shelf.ink : Impala.text2)
                    .padding(.horizontal, 12)
                    .frame(height: 36)
                    .background(modeRaw == m.rawValue ? Shelf.tint2 : .clear, in: RoundedRectangle(cornerRadius: 11, style: .continuous))
                    .contentShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
                }
                .buttonStyle(.plain)
                .hoverEffect(.highlight)
                .accessibilityAddTraits(modeRaw == m.rawValue ? .isSelected : [])
            }
        }
        .fixedSize()
        .sensoryFeedback(.selection, trigger: modeRaw)
    }

    @ViewBuilder
    private var search: some View {
        if let prompt {
            HStack(spacing: Space.s2) {
                Icon("search", size: 15).foregroundStyle(Impala.text2)
                TextField(prompt, text: $query)
                    .font(.system(size: 14))
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                if !query.isEmpty {
                    Button { query = "" } label: { Icon("x", size: 12).foregroundStyle(Impala.text2) }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Suche leeren")
                }
            }
            .padding(.horizontal, Space.s3)
            .frame(minWidth: 180, maxWidth: .infinity)
            .frame(height: 36)
            .background(Shelf.tint, in: RoundedRectangle(cornerRadius: 11, style: .continuous))
        } else {
            Spacer(minLength: 0)
        }
    }
}

/// Filter-Chips mit Anzahl (`.lib-tabs`), warm getönt wie das Panel.
struct LibFilterChips: View {
    let filters: [LibFilter]
    @Binding var selection: String

    var body: some View {
        ScrollView(.horizontal) {
            HStack(spacing: Space.s1) {
                ForEach(filters) { f in
                    Button {
                        withAnimation(.snappy) { selection = f.id }
                    } label: {
                        HStack(spacing: 6) {
                            Text(f.label).font(.system(size: TextSize.sm, weight: .semibold))
                            Text("\(f.count)")
                                .font(.system(size: 11, weight: .semibold).monospacedDigit())
                                .padding(.horizontal, 7)
                                .padding(.vertical, 1)
                                .background(Shelf.tint2, in: Capsule())
                        }
                        .foregroundStyle(selection == f.id ? Shelf.ink : Impala.text2)
                        .padding(.horizontal, Space.s3)
                        .frame(minHeight: 32)
                        .background(selection == f.id ? Shelf.tint2 : .clear, in: Capsule())
                        .contentShape(Capsule())
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .scrollIndicators(.hidden)
    }
}

/// Knopf rechts in der Leiste (z. B. „PDF hinzufügen“).
private struct LibAction: View {
    let title: String
    let icon: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Icon(icon, size: 15)
                Text(title).lineLimit(1)
            }
            .font(.system(size: TextSize.sm, weight: .semibold))
            .foregroundStyle(Shelf.ink)
            .padding(.horizontal, 12)
            .frame(height: 36)
            .background(Shelf.tint, in: RoundedRectangle(cornerRadius: 11, style: .continuous))
            .contentShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
        }
        .buttonStyle(.plain)
        .hoverEffect(.highlight)
        .fixedSize()
    }
}

/// Suche wie `renderNotionTree`: Titel oder Schlagwort enthält die Suche.
func libMatches(_ p: PageSummary, _ query: String) -> Bool {
    let q = query.trimmingCharacters(in: .whitespaces).lowercased()
    return q.isEmpty || p.title.lowercased().contains(q) || p.tags.contains { $0.lowercased().contains(q) }
}

// MARK: Notion

/// Kompakter Seitenbaum je Arbeitsbereich mit Filtern Alle · Favoriten · PDFs · Vorlagen
/// (`renderNotionTree`). Auf-/Zuklappen teilt sich den Zustand mit der Seitenleiste (`setTreeOpen`).
private struct NotionTree: View {
    @Environment(ImpalaStore.self) private var store
    @Environment(ShellModel.self) private var shell
    @Environment(\.libraryZoom) private var zoom
    @Binding var query: String
    let onOpen: (PageSummary) -> Void
    let onImport: () -> Void
    @AppStorage("impala67LibSmart") private var smart = "all"

    struct Row: Identifiable {
        let page: PageSummary
        let depth: Int
        let hasKids: Bool
        let collapsed: Bool
        var id: String { page.id }
    }

    /// Gelesenes Ergebnis: Zähler der Filter und die sichtbaren Zeilen je Arbeitsbereich.
    struct Loaded {
        var all = 0, fav = 0, pdf = 0, tpl = 0
        var sections: [(ws: WorkspaceInfo, rows: [Row])] = []
    }

    private struct LoadKey: Hashable {
        let meta: Int, ui: Int, query: String, smart: String
    }

    /// Im Hintergrund gelesen (Seitenliste und Kinder je Seite), der Body rechnet nur noch aus diesem Zustand.
    @State private var loaded: Loaded?

    var body: some View {
        let l = loaded ?? Loaded()
        let sections = l.sections
        VStack(spacing: 0) {
            LibToolbar(query: $query, prompt: "Seiten suchen…") {
                LibFilterChips(filters: [
                    LibFilter(id: "all", label: "Alle", count: l.all),
                    LibFilter(id: "fav", label: "Favoriten", count: l.fav),
                    LibFilter(id: "pdf", label: "PDFs", count: l.pdf),
                    LibFilter(id: "tpl", label: "Vorlagen", count: l.tpl),
                ], selection: $smart)
            } trailing: {
                LibAction(title: "PDF hinzufügen", icon: "upload", action: onImport)
            }
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 22) {
                    ForEach(sections, id: \.ws.id) { section in
                        TreeSection(title: section.ws.name, count: section.rows.count) {
                            ForEach(section.rows) { row in
                                TreeLine(row: row, onToggle: { toggle(row) })
                                    .contentShape(Rectangle())
                                    .onTapGesture { onOpen(row.page) }
                                    .hoverEffect(.highlight)
                                    .modifier(ZoomSource(id: row.page.id, ns: zoom))
                                    .contextMenu { PageMenu(page: row.page, onOpen: onOpen) }
                            }
                        }
                    }
                }
                .padding(.horizontal, 26)
                .padding(.top, 18)
                .padding(.bottom, 26)
                // Auf-/Zuklappen und neue Seiten: Zeilen gleiten (Animation an den geladenen Zeilen, wie PageTree).
                .animation(.snappy(duration: 0.28), value: sections.flatMap { $0.rows.map(\.id) })
            }
            .overlay {
                if loaded != nil, sections.isEmpty { ContentUnavailableView("Keine Seiten für diesen Filter", image: "i-search") }
            }
        }
        .task(id: LoadKey(meta: store.pageMetaRevision, ui: store.uiRevision, query: query, smart: smart)) {
            let core = store.core
            let smart = smart, query = query
            // Suche entprellt: erst nach kurzer Tipp-Pause lesen.
            if !query.isEmpty {
                try? await Task.sleep(for: .milliseconds(150))
                if Task.isCancelled { return }
            }
            let next = await Task.detached(priority: .userInitiated) { Self.load(core: core, smart: smart, query: query) }.value
            if !Task.isCancelled { loaded = next }
        }
    }

    private nonisolated static func ownMatch(_ p: PageSummary, smart: String, query: String) -> Bool {
        let filter = switch smart {
        case "fav": p.favorite
        case "pdf": p.pdfId != nil
        case "tpl": p.isTemplate
        default: true
        }
        return filter && libMatches(p, query)
    }

    private nonisolated static func load(core: ImpalaCore, smart: String, query: String) -> Loaded {
        let all = core.recentPages(limit: UInt32.max)
        return Loaded(
            all: all.count,
            fav: all.filter(\.favorite).count,
            pdf: all.filter { $0.pdfId != nil }.count,
            tpl: all.filter(\.isTemplate).count,
            sections: build(core: core, smart: smart, query: query)
        )
    }

    /// Sichtbar = passt selbst oder hat eine passende Unterseite (je Durchlauf gemerkt).
    private nonisolated static func build(core: ImpalaCore, smart: String, query: String) -> [(ws: WorkspaceInfo, rows: [Row])] {
        let open = core.treeOpen()
        var kidsMemo: [String: [PageSummary]] = [:]
        var visibleMemo: [String: Bool] = [:]
        func kids(_ p: PageSummary) -> [PageSummary] {
            if let k = kidsMemo[p.id] { return k }
            let k = core.childrenOf(parentId: p.id, workspaceId: nil)
            kidsMemo[p.id] = k
            return k
        }
        func visible(_ p: PageSummary) -> Bool {
            if let v = visibleMemo[p.id] { return v }
            let v = ownMatch(p, smart: smart, query: query) || kids(p).contains(where: visible)
            visibleMemo[p.id] = v
            return v
        }
        func branch(_ list: [PageSummary], _ depth: Int, _ rows: inout [Row]) {
            for p in list where visible(p) {
                let k = depth < 8 ? kids(p).filter(visible) : []
                let collapsed = !k.isEmpty && open[p.id] != true
                rows.append(Row(page: p, depth: depth, hasKids: !k.isEmpty, collapsed: collapsed))
                if !collapsed { branch(k, depth + 1, &rows) }
            }
        }
        return core.workspaces().compactMap { ws -> (ws: WorkspaceInfo, rows: [Row])? in
            var rows: [Row] = []
            branch(core.childrenOf(parentId: nil, workspaceId: ws.id), 0, &rows)
            return rows.isEmpty ? nil : (ws: ws, rows: rows)
        }
    }

    private func toggle(_ row: Row) {
        attempt("setTreeOpen", { try store.core.setTreeOpen(key: row.page.id, open: row.collapsed) })
    }
}

/// Ordner-Karte im Seitenbaum (`.notion-tree-workspace`): Name mit Anzahl, darunter die Zeilen auf hellem Blatt.
private struct TreeSection<Rows: View>: View {
    let title: String
    let count: Int
    @ViewBuilder let rows: () -> Rows

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: Space.s2) {
                Text(title)
                    .font(.system(size: 15.5, weight: .semibold, design: .rounded))
                    .foregroundStyle(Shelf.ink)
                Text("\(count)")
                    .font(.system(size: 11.5, weight: .semibold).monospacedDigit())
                    .foregroundStyle(Impala.text2)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 1)
                    .background(Shelf.tint, in: Capsule())
            }
            .padding(.horizontal, 2)
            LazyVStack(alignment: .leading, spacing: 0) { rows() }
                .padding(6)
                .background(Shelf.sheet, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Shelf.edge, lineWidth: 1))
                .shadow(color: Color(uiColor: UIColor(hex: 0x3C230F, alpha: 0.12)), radius: 4, y: 2)
        }
    }
}

/// Art der Seite als kleine Marke (`.lib-kind`); Hefte in Akzentfarbe.
private struct KindBadge: View {
    let page: PageSummary

    var body: some View {
        Text(page.kind == .heft ? "Heft" : page.pdfId != nil ? "PDF" : "Seite")
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(page.kind == .heft ? Impala.accent : Impala.text2)
            .padding(.horizontal, 9)
            .padding(.vertical, 2)
            .background(Shelf.tint, in: Capsule())
    }
}

/// Zeile wie `.notion-tree-row`: Führungslinien je Ebene, Pfeil, Symbol-Kachel, Titel, Marke und Datum.
private struct TreeLine: View {
    let row: NotionTree.Row
    let onToggle: () -> Void

    var body: some View {
        HStack(spacing: Space.s2) {
            Group {
                if row.hasKids {
                    Button(action: onToggle) {
                        Icon("chevron-right", size: 13)
                            .rotationEffect(.degrees(row.collapsed ? 0 : 90))
                            .frame(width: 22, height: 28)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(row.collapsed ? "Aufklappen" : "Zuklappen")
                } else {
                    Color.clear.frame(width: 22, height: 28)
                }
            }
            .foregroundStyle(Impala.text2)
            PageGlyph(page: row.page)
            Text(PageStyle.title(row.page))
                .font(.system(size: TextSize.base, weight: row.depth == 0 ? .semibold : .medium))
                .foregroundStyle(Impala.text)
                .lineLimit(1)
            if row.page.favorite { Icon("star", size: 12).foregroundStyle(Impala.accent) }
            Spacer(minLength: Space.s2)
            KindBadge(page: row.page)
            Text(ChatList.when(row.page.updated))
                .font(.system(size: TextSize.xs).monospacedDigit())
                .foregroundStyle(Impala.text2)
                .lineLimit(1)
                .frame(minWidth: 58, alignment: .trailing)
        }
        .frame(minHeight: 42)
        .padding(.trailing, 10)
        .padding(.leading, 6 + CGFloat(row.depth) * 22)
        .background(alignment: .leading) {
            // Führungslinien genau unter dem Pfeil der Elternzeile
            HStack(spacing: 0) {
                ForEach(0..<row.depth, id: \.self) { _ in
                    Rectangle().fill(Impala.edgeSoft).frame(width: 1).padding(.leading, 10).frame(width: 22, alignment: .leading)
                }
            }
            .padding(.leading, 6)
        }
        .animation(.snappy, value: row.collapsed)
    }
}

/// Symbol-Kachel (`.notion-tree-icon`): eigenes Cover-Bild des Hefts, Emoji oder Symbol nach Art.
private struct PageGlyph: View {
    let page: PageSummary

    var body: some View {
        Group {
            if let img = page.coverImg {
                CoverImage(id: img)
                    .frame(width: 28, height: 28)
                    .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
            } else if let emoji = PageStyle.emoji(page) {
                Text(emoji).font(.system(size: 14))
            } else {
                Icon(page.kind == .heft ? "notebook" : page.pdfId != nil ? "file" : "note", size: 15)
                    .foregroundStyle(page.kind == .heft ? Impala.accent : Impala.text2)
            }
        }
        .frame(width: 28, height: 28)
        .background(Shelf.tint, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
    }
}

/// Menü beim Halten einer Bibliothekszeile bzw. Kachel.
struct PageMenu: View {
    @Environment(ImpalaStore.self) private var store
    @Environment(ShellModel.self) private var shell
    let page: PageSummary
    let onOpen: (PageSummary) -> Void

    init(page: PageSummary, onOpen: @escaping (PageSummary) -> Void) {
        self.page = page
        self.onOpen = onOpen
    }

    var body: some View {
        MenuItem(page.pdfId != nil ? "PDF öffnen" : "Öffnen", icon: page.pdfId != nil ? "book-open" : "note") { onOpen(page) }
        if page.pdfId != nil {
            MenuItem("Als Seite öffnen", icon: "note") { shell.open(page.id) }
        }
        MenuItem(page.favorite ? "Favorit entfernen" : "Zu Favoriten", icon: "star") {
            store.core.patchPage(page.id, ["favorite": !page.favorite])
        }
        MenuItem("Archivieren", icon: "archive") {
            shell.close(page.id)
            attempt("archivePage", { try store.core.archivePage(id: page.id) })
        }
        MenuItem("In Papierkorb", icon: "trash", role: .destructive) {
            shell.close(page.id)
            attempt("trashPage", { try store.core.trashPage(id: page.id) })
        }
    }
}

private struct ZoomSource: ViewModifier {
    let id: String
    let ns: Namespace.ID?

    func body(content: Content) -> some View {
        if let ns { content.matchedTransitionSource(id: id, in: ns) } else { content }
    }
}

// MARK: Archiv

/// Archiv wie `renderArchiveLibrary`: archivierte Seiten und Hefte, Filter nach Art, Suche,
/// „Aus Archiv holen“.
private struct ArchiveList: View {
    @Environment(ImpalaStore.self) private var store
    @Binding var query: String
    let onOpen: (PageSummary) -> Void
    @State private var filter = "all"
    /// Archivierte Seiten; im Hintergrund gelesen (`.task` unten), der Body filtert nur noch lokal.
    @State private var loaded: [PageSummary]?

    var body: some View {
        let all = loaded ?? []
        let shown = all.filter { p in
            (filter == "all" || (filter == "heft") == (p.kind == .heft)) && libMatches(p, query)
        }
        VStack(spacing: 0) {
            LibToolbar(query: $query, prompt: "Archiv durchsuchen…") {
                LibFilterChips(filters: [
                    LibFilter(id: "all", label: "Alle", count: all.count),
                    LibFilter(id: "page", label: "Seiten", count: all.filter { $0.kind != .heft }.count),
                    LibFilter(id: "heft", label: "Hefte", count: all.filter { $0.kind == .heft }.count),
                ], selection: $filter)
            } trailing: { EmptyView() }
            ScrollView {
                if !shown.isEmpty {
                    TreeSection(title: "Archiv", count: shown.count) {
                        ForEach(shown) { p in
                            HStack(spacing: Space.s2) {
                                PageGlyph(page: p)
                                Text(PageStyle.title(p))
                                    .font(.system(size: TextSize.base, weight: .semibold))
                                    .foregroundStyle(Impala.text)
                                    .lineLimit(1)
                                Spacer(minLength: Space.s2)
                                KindBadge(page: p)
                                Text(ChatList.when(p.updated))
                                    .font(.system(size: TextSize.xs).monospacedDigit())
                                    .foregroundStyle(Impala.text2)
                                    .lineLimit(1)
                                Button {
                                    attempt("unarchivePage", { try store.core.unarchivePage(id: p.id) })
                                } label: {
                                    Label { Text("Aus Archiv holen") } icon: { Image("i-undo").renderingMode(.template) }
                                        .font(.system(size: TextSize.sm, weight: .medium))
                                        .foregroundStyle(Shelf.ink)
                                        .padding(.horizontal, 10)
                                        .frame(height: 30)
                                        .background(Shelf.tint, in: Capsule())
                                }
                                .buttonStyle(.plain)
                            }
                            .frame(minHeight: 46)
                            .padding(.horizontal, 10)
                            .contentShape(Rectangle())
                            .onTapGesture { onOpen(p) }
                            .hoverEffect(.highlight)
                        }
                    }
                    .padding(.horizontal, 26)
                    .padding(.top, 18)
                    .padding(.bottom, 26)
                    .animation(.snappy(duration: 0.28), value: shown.map(\.id))
                }
            }
            .overlay {
                if loaded != nil, shown.isEmpty {
                    ContentUnavailableView {
                        Label { Text(all.isEmpty ? "Archiv ist leer" : "Nichts gefunden") } icon: { Icon("archive", size: 40).foregroundStyle(Impala.text2) }
                    } description: {
                        if all.isEmpty { Text("Archivierte Seiten und Hefte erscheinen hier.") }
                    }
                }
            }
        }
        .task(id: store.pageMetaRevision) {
            let core = store.core
            let next = await Task.detached(priority: .userInitiated) { core.archivedPages() }.value
            if !Task.isCancelled { loaded = next }
        }
    }
}
