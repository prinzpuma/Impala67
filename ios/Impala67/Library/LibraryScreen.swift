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

/// Bibliothek als Hauptansicht wie in der PWA (`S.view = "library"`, nicht als Fenster): oben Titel und
/// Ansichten, darunter eine feste Werkzeugzeile (links Filter, rechts Suche), dann der Inhalt.
/// PDFs öffnen nativ mit PDFKit, alles andere öffnet die Seite im Tab.
struct LibraryScreen: View {
    @Environment(ImpalaStore.self) private var store
    @Environment(ShellModel.self) private var shell
    @AppStorage("impala67LibMode") private var modeRaw = LibraryMode.notion.rawValue
    @State private var path: [String] = []
    @State private var query = ""
    @State private var importing = false
    @State private var failed = false
    @State private var newHeft = false
    @Namespace private var zoom

    private var mode: LibraryMode { LibraryMode(rawValue: modeRaw) ?? .notion }

    var body: some View {
        NavigationStack(path: $path) {
            VStack(alignment: .leading, spacing: Space.s3) {
                header
                Group {
                    switch mode {
                    case .notion: NotionTree(query: $query, onOpen: open, onImport: { importing = true })
                    case .hefte: HeftShelf(query: $query, onOpen: open, onNew: { newHeft = true })
                    case .archive: ArchiveList(query: $query, onOpen: open)
                    case .nlm: NotebookView()
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
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
        .fileImporter(isPresented: $importing, allowedContentTypes: [.pdf], allowsMultipleSelection: true) { result in
            guard case .success(let urls) = result else { return }
            importPdfs(urls)
        }
        .alert("PDF-Datei konnte nicht geladen werden.", isPresented: $failed) { Button("OK", role: .cancel) {} }
        .sheet(isPresented: $newHeft) {
            NewHeftSheet { title, cover in
                guard let id = attempt("createHeft", { try store.core.createHeft(title: title, parentId: nil, workspaceId: nil) }) else { return }
                store.core.patchPage(id, ["cover": cover])
                shell.open(id)
            }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: Space.s3) {
            Text("Bibliothek")
                .font(.system(size: TextSize.xl, weight: .bold, design: .rounded))
                .foregroundStyle(Impala.text)
            Picker("Ansicht", selection: $modeRaw) {
                ForEach(LibraryMode.allCases) { m in
                    Text(m.label).tag(m.rawValue)
                }
            }
            .pickerStyle(.segmented)
            .frame(maxWidth: 620)
        }
        .padding(.horizontal, Space.s6)
        .padding(.top, Space.s6)
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
private struct LibFilter: Identifiable {
    let id: String
    let label: String
    let count: Int
}

/// Links Filter bzw. Aktion, rechts Suche – in jeder Ansicht an derselben Stelle (`libToolbarHtml`).
private struct LibToolbar<Trailing: View>: View {
    let filters: [LibFilter]
    @Binding var selection: String
    @Binding var query: String
    let prompt: String
    @ViewBuilder let trailing: () -> Trailing

    var body: some View {
        HStack(spacing: Space.s2) {
            ScrollView(.horizontal) {
                HStack(spacing: Space.s1) {
                    ForEach(filters) { f in
                        Button {
                            withAnimation(.snappy) { selection = f.id }
                        } label: {
                            HStack(spacing: 6) {
                                Text(f.label).font(.system(size: TextSize.sm, weight: .medium))
                                Text("\(f.count)").font(.system(size: TextSize.xs).monospacedDigit()).foregroundStyle(Impala.text2)
                            }
                            .foregroundStyle(selection == f.id ? Impala.text : Impala.text2)
                            .padding(.horizontal, Space.s3)
                            .frame(minHeight: 32)
                            .background(selection == f.id ? Impala.activeTint : .clear, in: Capsule())
                            .contentShape(Capsule())
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .scrollIndicators(.hidden)
            trailing()
            HStack(spacing: 6) {
                Icon("search", size: 14).foregroundStyle(Impala.text2)
                TextField(prompt, text: $query)
                    .font(.system(size: TextSize.sm))
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                if !query.isEmpty {
                    Button { query = "" } label: { Icon("x", size: 12).foregroundStyle(Impala.text2) }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Suche leeren")
                }
            }
            .padding(.horizontal, Space.s3)
            .frame(width: 240, height: 34)
            .background(Impala.surface, in: Capsule())
        }
        .padding(.horizontal, Space.s6)
    }
}

/// Knopf rechts in der Werkzeugzeile (z. B. „+ Neu“).
private struct LibAction: View {
    let title: String
    let icon: String
    let action: () -> Void

    var body: some View {
        Button(action: action) { Label { Text(title) } icon: { Image("i-\(icon)").renderingMode(.template) } }
            .buttonStyle(.glass)
            .font(.system(size: TextSize.sm, weight: .medium))
    }
}

/// Suche wie `renderNotionTree`: Titel oder Schlagwort enthält die Suche.
private func libMatches(_ p: PageSummary, _ query: String) -> Bool {
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
        VStack(spacing: Space.s3) {
            LibToolbar(filters: [
                LibFilter(id: "all", label: "Alle", count: l.all),
                LibFilter(id: "fav", label: "Favoriten", count: l.fav),
                LibFilter(id: "pdf", label: "PDFs", count: l.pdf),
                LibFilter(id: "tpl", label: "Vorlagen", count: l.tpl),
            ], selection: $smart, query: $query, prompt: "Seiten suchen…") {
                LibAction(title: "PDF hinzufügen", icon: "upload", action: onImport)
            }
            List {
                ForEach(sections, id: \.ws.id) { section in
                    Section(section.ws.name) {
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
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            // Auf-/Zuklappen und neue Seiten: Zeilen gleiten (Animation an den geladenen Zeilen, wie PageTree).
            .animation(.snappy(duration: 0.28), value: sections.flatMap { $0.rows.map(\.id) })
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

/// Zeile wie `.notion-tree-row`: Pfeil, Symbol, Titel, „Heft/Seite · Datum“.
private struct TreeLine: View {
    let row: NotionTree.Row
    let onToggle: () -> Void

    var body: some View {
        HStack(spacing: Space.s2) {
            Group {
                if row.hasKids {
                    Button(action: onToggle) {
                        Icon("chevron-right", size: 12)
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
                .font(.system(size: TextSize.base, weight: .medium))
                .foregroundStyle(Impala.text)
                .lineLimit(1)
            if row.page.favorite { Icon("star", size: 12).foregroundStyle(Impala.accent) }
            Spacer(minLength: Space.s2)
            Text((row.page.kind == .heft ? "Heft" : row.page.pdfId != nil ? "PDF" : "Seite") + " · " + ChatList.when(row.page.updated))
                .font(.system(size: TextSize.xs))
                .foregroundStyle(Impala.text2)
                .lineLimit(1)
        }
        .padding(.leading, CGFloat(row.depth) * 18)
        .animation(.snappy, value: row.collapsed)
    }
}

/// Emoji der Seite oder Symbol nach Art.
private struct PageGlyph: View {
    let page: PageSummary

    var body: some View {
        Group {
            if let emoji = PageStyle.emoji(page) {
                Text(emoji).font(.system(size: 15))
            } else {
                Icon(page.kind == .heft ? "notebook" : page.pdfId != nil ? "file" : "note", size: 16)
            }
        }
        .foregroundStyle(Impala.text2)
        .frame(width: 22)
    }
}

/// Menü beim Halten einer Bibliothekszeile bzw. Kachel.
private struct PageMenu: View {
    @Environment(ImpalaStore.self) private var store
    @Environment(ShellModel.self) private var shell
    let page: PageSummary
    let onOpen: (PageSummary) -> Void

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

// MARK: GoodNotes

/// Cover-Presets der PWA (`COVER_PRESETS`, Verläufe aus styles.css `.cover-*`).
enum HeftCover {
    static let presets = ["sunset", "ocean", "forest", "grape", "mono"]

    static func colors(_ name: String) -> [Color] {
        let pair: (UInt32, UInt32) = switch name {
        case "sunset": (0xFF9A4D, 0xFF5F6D)
        case "ocean": (0x2B5876, 0x4E4376)
        case "forest": (0x134E5E, 0x71B280)
        case "grape": (0x6A11CB, 0x2575FC)
        default: (0x3A3A3A, 0x101010)
        }
        return [Color(uiColor: UIColor(hex: pair.0)), Color(uiColor: UIColor(hex: pair.1))]
    }

    /// Wie `defaultCover`: fester Verlauf aus Titel und ID, wenn keiner gewählt ist.
    static func resolved(_ p: PageSummary) -> String {
        if presets.contains(p.cover) { return p.cover }
        var h: UInt32 = 0
        for c in (p.title + p.id).utf16 { h = h &* 31 &+ UInt32(c) }
        return presets[Int(h % UInt32(presets.count))]
    }
}

/// Heft-Regal wie `renderHefteShelf`: Hefte als Notizbücher mit Cover, Ordner-Hierarchie und „+ Neu“.
private struct HeftShelf: View {
    @Environment(ImpalaStore.self) private var store
    @Environment(\.libraryZoom) private var zoom
    @Binding var query: String
    let onOpen: (PageSummary) -> Void
    let onNew: () -> Void
    @State private var options: PageSummary?
    @State private var filter = "all"
    @State private var folderId: String? = nil
    @State private var showNewFolder = false
    @State private var newFolderTitle = ""

    /// Gelesenes Ergebnis: Ordner (mit Inhaltszahl), gefilterte Hefte (mit Seitenzahl), Filterzähler, Brotkrumen.
    struct Loaded {
        var folders: [(folder: HeftFolder, count: Int)] = []
        var shown: [(page: PageSummary, pages: Int)] = []
        var all = 0, fav = 0
        var crumbs: [HeftFolder] = []
    }

    private struct LoadKey: Hashable {
        let meta: Int, ui: Int, query: String, filter: String, folder: String?
    }

    /// Im Hintergrund gelesen (Ordner, Hefte, Seitenzahl je Karte); der Body rechnet nur noch aus diesem Zustand.
    @State private var loaded: Loaded?

    var body: some View {
        let l = loaded ?? Loaded()
        let folders = l.folders, shown = l.shown, crumbs = l.crumbs

        VStack(spacing: Space.s3) {
            LibToolbar(filters: [
                LibFilter(id: "all", label: "Alle Hefte", count: l.all),
                LibFilter(id: "fav", label: "Favoriten", count: l.fav),
            ], selection: $filter, query: $query, prompt: "Suchen") {
                Menu {
                    Button(action: onNew) {
                        Label("Neues Heft", systemImage: "book")
                    }
                    Button {
                        newFolderTitle = ""
                        showNewFolder = true
                    } label: {
                        Label("Neuer Ordner", systemImage: "folder.badge.plus")
                    }
                } label: {
                    HStack(spacing: Space.s1) {
                        Icon("plus", size: 14)
                        Text("Neu")
                    }
                    .font(.system(size: TextSize.sm, weight: .semibold))
                    .padding(.horizontal, Space.s3)
                    .frame(height: 32)
                    .foregroundStyle(Impala.onAccent)
                    .background(Impala.accent, in: RoundedRectangle(cornerRadius: Radius.xs, style: .continuous))
                }
            }

            if !crumbs.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: Space.s2) {
                        Button("Dokumente") { folderId = nil }
                            .font(.system(size: TextSize.sm, weight: .medium))
                            .foregroundStyle(Impala.accent)
                        ForEach(crumbs, id: \.id) { f in
                            Image(systemName: "chevron.right")
                                .font(.system(size: 11))
                                .foregroundStyle(Impala.text2)
                            Button(f.title) { folderId = f.id }
                                .font(.system(size: TextSize.sm, weight: f.id == folderId ? .bold : .medium))
                                .foregroundStyle(f.id == folderId ? Impala.text : Impala.accent)
                        }
                    }
                    .padding(.horizontal, Space.s6)
                }
            }

            ScrollView {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 150, maximum: 190), spacing: Space.s6, alignment: .top)],
                          alignment: .leading, spacing: Space.s6) {
                    ForEach(folders, id: \.folder.id) { entry in
                        let f = entry.folder
                        FolderCard(folder: f, count: entry.count)
                            .onTapGesture { folderId = f.id }
                            .contextMenu {
                                Button("Löschen", role: .destructive) {
                                    _ = attempt("heftFolderDelete", { try store.core.heftFolderDelete(id: f.id) })
                                }
                            }
                    }
                    ForEach(shown, id: \.page.id) { entry in
                        let p = entry.page
                        HeftCard(page: p, pages: entry.pages) { options = p }
                            .onTapGesture { onOpen(p) }
                            .hoverEffect(.lift)
                            .contextMenu { PageMenu(page: p, onOpen: onOpen) }
                    }
                }
                .padding(.horizontal, Space.s6)
                .padding(.bottom, Space.s6)
                // Karten gleiten, wenn sich die geladene Auswahl ändert (wie PageTree an den Zeilen).
                .animation(.snappy(duration: 0.28), value: folders.map(\.folder.id) + shown.map(\.page.id))
            }
            .overlay {
                if loaded != nil, folders.isEmpty && shown.isEmpty {
                    ContentUnavailableView {
                        Label { Text(l.all == 0 ? "Noch keine Hefte" : "Keine Hefte für diese Suche") } icon: { Icon("notebook", size: 40).foregroundStyle(Impala.text2) }
                    } actions: {
                        if l.all == 0 { Button("Neues Heft", action: onNew).buttonStyle(.glassProminent) }
                    }
                }
            }
        }
        .task(id: LoadKey(meta: store.pageMetaRevision, ui: store.uiRevision, query: query, filter: filter, folder: folderId)) {
            let core = store.core
            let query = query, filter = filter, folderId = folderId
            // Suche entprellt: erst nach kurzer Tipp-Pause lesen.
            if !query.isEmpty {
                try? await Task.sleep(for: .milliseconds(150))
                if Task.isCancelled { return }
            }
            let next = await Task.detached(priority: .userInitiated) {
                Self.load(core: core, folderId: folderId, filter: filter, query: query)
            }.value
            if !Task.isCancelled { loaded = next }
        }
        .alert("Neuer Ordner", isPresented: $showNewFolder) {
            TextField("Ordnername", text: $newFolderTitle)
            Button("Abbrechen", role: .cancel) { newFolderTitle = "" }
            Button("Erstellen") {
                let title = newFolderTitle.trimmingCharacters(in: .whitespaces)
                if !title.isEmpty {
                    _ = attempt("heftFolderCreate", { try store.core.heftFolderCreate(title: title, parentId: folderId) })
                }
                newFolderTitle = ""
            }
        }
        .sheet(item: $options) { HeftOptionsSheet(page: $0) }
    }

    private nonisolated static func load(core: ImpalaCore, folderId: String?, filter: String, query: String) -> Loaded {
        let searching = !query.isEmpty
        let folders = searching ? [] : core.heftFolders(parentId: folderId)
        let raw = searching ? core.recentPages(limit: UInt32.max).filter { $0.kind == .heft } : core.heftInFolder(folderId: folderId)
        let shown = raw.filter { (filter == "all" || $0.favorite) && libMatches($0, query) }
        return Loaded(
            folders: folders.map { (folder: $0, count: core.heftInFolder(folderId: $0.id).count) },
            shown: shown.map { (page: $0, pages: core.heftPageIds(pageId: $0.id).count) },
            all: raw.count,
            fav: raw.filter(\.favorite).count,
            crumbs: folderId.map { core.heftFolderPath(folderId: $0) } ?? []
        )
    }
}

/// Ordnerkarte im GoodNotes-Regal.
private struct FolderCard: View {
    let folder: HeftFolder
    let count: Int

    var body: some View {
        VStack(alignment: .leading, spacing: Space.s2) {
            ZStack {
                RoundedRectangle(cornerRadius: Radius.md, style: .continuous)
                    .fill(Impala.surface)
                    .frame(height: 140)
                    .overlay(RoundedRectangle(cornerRadius: Radius.md, style: .continuous).stroke(Impala.edge))
                VStack(spacing: Space.s2) {
                    Icon("archive", size: 36)
                        .foregroundStyle(Impala.accent)
                    if count > 0 {
                        Text("\(count) Objekte")
                            .font(.system(size: TextSize.xs))
                            .foregroundStyle(Impala.text2)
                    }
                }
            }
            Text(folder.title)
                .font(.system(size: TextSize.sm, weight: .semibold))
                .foregroundStyle(Impala.text)
                .lineLimit(1)
        }
        .frame(width: 150)
        .contentShape(Rectangle())
    }
}

/// Notizbuch wie `libCoverHtml`: Rücken, Verlauf, Titel auf dem Cover, darunter Titel und
/// „Heft · n Seiten · Datum“; ••• öffnet die Heftoptionen.
private struct HeftCard: View {
    let page: PageSummary
    let pages: Int
    let onOptions: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Space.s2) {
            ZStack(alignment: .topTrailing) {
                HStack(spacing: 0) {
                    Rectangle().fill(.black.opacity(0.28)).frame(width: 9)
                    ZStack(alignment: .bottomLeading) {
                        LinearGradient(colors: HeftCover.colors(HeftCover.resolved(page)), startPoint: .topLeading, endPoint: .bottomTrailing)
                        VStack(alignment: .leading, spacing: Space.s2) {
                            if let emoji = PageStyle.emoji(page) { Text(emoji).font(.system(size: 22)) }
                            Text(PageStyle.title(page))
                                .font(.system(size: TextSize.sm, weight: .semibold, design: .rounded))
                                .foregroundStyle(.white)
                                .lineLimit(3)
                        }
                        .padding(Space.s3)
                    }
                }
                .aspectRatio(0.76, contentMode: .fit)
                .clipShape(UnevenRoundedRectangle(topLeadingRadius: 4, bottomLeadingRadius: 4, bottomTrailingRadius: Radius.sm, topTrailingRadius: Radius.sm, style: .continuous))
                .shadow(color: .black.opacity(0.18), radius: 8, y: 4)
                HStack(spacing: 4) {
                    if page.favorite { Icon("star", size: 12).foregroundStyle(.white) }
                    Button(action: onOptions) {
                        Text("•••").font(.system(size: 12, weight: .bold)).foregroundStyle(.white)
                            .frame(width: 32, height: 26)
                            .background(.black.opacity(0.25), in: Capsule())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Heftoptionen")
                }
                .padding(Space.s2)
            }
            Text(PageStyle.title(page))
                .font(.system(size: TextSize.sm, weight: .semibold))
                .foregroundStyle(Impala.text)
                .lineLimit(1)
            Text("Heft · \(max(pages, 1)) Seite\(pages == 1 ? "" : "n") · " + ChatList.when(page.updated))
                .font(.system(size: TextSize.xs))
                .foregroundStyle(Impala.text2)
                .lineLimit(1)
        }
        .contentShape(Rectangle())
    }
}

/// Cover-Auswahl für die Hefte (`cover-grid` der PWA).
private struct CoverPicker: View {
    @Binding var cover: String

    var body: some View {
        HStack(spacing: Space.s3) {
            ForEach(HeftCover.presets, id: \.self) { c in
                Button { withAnimation(.snappy) { cover = c } } label: {
                    RoundedRectangle(cornerRadius: Radius.xs, style: .continuous)
                        .fill(LinearGradient(colors: HeftCover.colors(c), startPoint: .topLeading, endPoint: .bottomTrailing))
                        .frame(width: 44, height: 58)
                        .overlay {
                            RoundedRectangle(cornerRadius: Radius.xs + 3, style: .continuous)
                                .strokeBorder(cover == c ? Impala.accent : .clear, lineWidth: 2.5)
                                .padding(-4)
                        }
                }
                .buttonStyle(.plain)
                .accessibilityLabel(c)
                .accessibilityAddTraits(cover == c ? .isSelected : [])
            }
        }
        .padding(.vertical, Space.s2)
        .sensoryFeedback(.selection, trigger: cover)
    }
}

/// „Neues Heft“ (`openShelfHeftDialog`): Name und Cover.
private struct NewHeftSheet: View {
    @Environment(\.dismiss) private var dismiss
    let onCreate: (String, String) -> Void
    @State private var title = "Neues Heft"
    @State private var cover = HeftCover.presets[0]

    var body: some View {
        NavigationStack {
            Form {
                Section("Name") { TextField("Heftname", text: $title) }
                Section("Cover") { CoverPicker(cover: $cover) }
            }
            .navigationTitle("Neues Heft")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Abbrechen") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Heft erstellen") {
                        let t = title.trimmingCharacters(in: .whitespaces)
                        onCreate(t.isEmpty ? "Neues Heft" : t, cover)
                        dismiss()
                    }
                }
            }
        }
        .presentationDetents([.medium])
    }
}

/// „Heftoptionen“ (`openLibCoverPicker`): Cover, Cover entfernen, Archivieren, In Papierkorb.
private struct HeftOptionsSheet: View {
    @Environment(ImpalaStore.self) private var store
    @Environment(ShellModel.self) private var shell
    @Environment(\.dismiss) private var dismiss
    let page: PageSummary
    @State private var cover = ""

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    CoverPicker(cover: $cover)
                    Button("Cover entfernen") { cover = "" }.disabled(page.cover.isEmpty && cover.isEmpty)
                } header: {
                    Text("Cover")
                }
                Section("Ordner") {
                    let folders = store.core.heftFolders(parentId: nil)
                    Picker("In Ordner verschieben", selection: Binding(get: { "" }, set: { target in
                        if !target.isEmpty {
                            _ = attempt("heftMoveToFolder", { try store.core.heftMoveToFolder(heftId: page.id, folderId: target == "root" ? nil : target, order: nil) })
                            dismiss()
                        }
                    })) {
                        Text("Auswählen…").tag("")
                        Text("Hauptbereich (kein Ordner)").tag("root")
                        ForEach(folders, id: \.id) { f in Text(f.title).tag(f.id) }
                    }
                }
                Section {
                    Button { archive() } label: { Label { Text("Archivieren") } icon: { Image("i-archive").renderingMode(.template) } }
                    Button(role: .destructive) { trash() } label: { Label { Text("In Papierkorb") } icon: { Image("i-trash").renderingMode(.template) } }
                }
            }
            .navigationTitle("Heftoptionen")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Fertig") { dismiss() } } }
            .onAppear { cover = page.cover }
            .onChange(of: cover) { _, c in
                if c != page.cover { store.core.patchPage(page.id, ["cover": c.isEmpty ? nil : c]) }
            }
        }
        .presentationDetents([.medium])
    }

    private func archive() {
        shell.close(page.id)
        attempt("archivePage", { try store.core.archivePage(id: page.id) })
        dismiss()
    }

    private func trash() {
        shell.close(page.id)
        attempt("trashPage", { try store.core.trashPage(id: page.id) })
        dismiss()
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
        VStack(spacing: Space.s3) {
            LibToolbar(filters: [
                LibFilter(id: "all", label: "Alle", count: all.count),
                LibFilter(id: "page", label: "Seiten", count: all.filter { $0.kind != .heft }.count),
                LibFilter(id: "heft", label: "Hefte", count: all.filter { $0.kind == .heft }.count),
            ], selection: $filter, query: $query, prompt: "Archiv durchsuchen…") { EmptyView() }
            List(shown) { p in
                HStack(spacing: Space.s2) {
                    PageGlyph(page: p)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(PageStyle.title(p)).font(.system(size: TextSize.base, weight: .medium)).foregroundStyle(Impala.text).lineLimit(1)
                        Text((p.kind == .heft ? "Heft" : "Seite") + " · " + ChatList.when(p.updated))
                            .font(.system(size: TextSize.xs)).foregroundStyle(Impala.text2)
                    }
                    Spacer(minLength: Space.s2)
                    Button {
                        attempt("unarchivePage", { try store.core.unarchivePage(id: p.id) })
                    } label: {
                        Label { Text("Aus Archiv holen") } icon: { Image("i-undo").renderingMode(.template) }
                    }
                    .buttonStyle(.glass)
                    .font(.system(size: TextSize.sm))
                }
                .contentShape(Rectangle())
                .onTapGesture { onOpen(p) }
                .hoverEffect(.highlight)
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .animation(.snappy(duration: 0.28), value: shown.map(\.id))
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
