import PhotosUI
import SwiftUI

/// Cover-Farben der PWA (`COVER_PRESETS`, Verläufe aus styles.css `.cover-*`) für die Auswahl.
/// Auf dem Regal macht `CoverLook` daraus je Heft ein eigenes Cover.
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
}

/// Eintrag im Regal: Ordner (mit Anzahl Objekte) oder Heft (mit Seitenzahl).
fileprivate enum ShelfEntry: Identifiable {
    case folder(HeftFolder, Int)
    case heft(PageSummary, Int)

    var id: String {
        switch self {
        case .folder(let f, _): "f:" + f.id
        case .heft(let p, _): "p:" + p.id
        }
    }
}

/// Heft-Regal wie `renderHefteShelf`: Hefte und Mappen stehen auf Holzbrettern, links der Pfad
/// („Dokumente / Ordner“), rechts Suche und „Neu“. Am Ende des letzten Bretts steht Deko.
struct HeftShelf: View {
    @Environment(ImpalaStore.self) private var store
    @Environment(ShellModel.self) private var shell
    @Binding var query: String
    let onOpen: (PageSummary) -> Void
    @State private var options: PageSummary?
    @State private var folderId: String? = nil
    @State private var newHeft = false
    @State private var showNewFolder = false
    @State private var newFolderTitle = ""
    @State private var width: CGFloat = 0

    fileprivate struct Loaded {
        var entries: [ShelfEntry] = []
        var total = 0
        var crumbs: [HeftFolder] = []
    }

    private struct LoadKey: Hashable {
        let meta: Int, ui: Int, query: String, folder: String?
    }

    /// Im Hintergrund gelesen (Ordner, Hefte, Seitenzahl je Heft); der Body rechnet nur noch aus diesem Zustand.
    @State private var loaded: Loaded?

    init(query: Binding<String>, onOpen: @escaping (PageSummary) -> Void) {
        _query = query
        self.onOpen = onOpen
    }

    private var pad: CGFloat { width > 0 && width < 640 ? 14 : 26 }

    var body: some View {
        let l = loaded ?? Loaded()
        let m = ShelfMetrics(width: width - 2 * pad)
        VStack(spacing: 0) {
            LibToolbar(query: $query, prompt: "Hefte suchen") {
                crumbs(l.crumbs)
            } trailing: {
                newMenu
            }
            ScrollView {
                shelf(l, m)
                    .padding(.horizontal, pad)
                    .padding(.top, 18)
                    .padding(.bottom, 26)
            }
            .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
        }
        .task(id: LoadKey(meta: store.pageMetaRevision, ui: store.uiRevision, query: query, folder: folderId)) {
            let core = store.core
            let query = query, folderId = folderId
            // Suche entprellt: erst nach kurzer Tipp-Pause lesen.
            if !query.isEmpty {
                try? await Task.sleep(for: .milliseconds(150))
                if Task.isCancelled { return }
            }
            let next = await Task.detached(priority: .userInitiated) {
                Self.load(core: core, folderId: folderId, query: query)
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
        .sheet(isPresented: $newHeft) {
            NewHeftSheet { title, cover, image in create(title: title, cover: cover, image: image) }
        }
    }

    // MARK: Regal

    @ViewBuilder
    private func shelf(_ l: Loaded, _ m: ShelfMetrics) -> some View {
        if l.entries.isEmpty {
            if loaded != nil { emptyShelf(l) }
        } else {
            let rows = stride(from: 0, to: l.entries.count, by: m.columns).map { Array(l.entries[$0..<min($0 + m.columns, l.entries.count)]) }
            // Deko in der letzten Spalte des letzten Bretts; ist es voll, auf einem eigenen Brett (wie `grid-column: -2`).
            let books = l.entries.count % 2 == 0
            let decoFits = (rows.last?.count ?? 0) < m.columns
            VStack(alignment: .leading, spacing: m.rowGap) {
                ForEach(rows.indices, id: \.self) { i in
                    shelfRow(rows[i], m, deco: !m.narrow && decoFits && i == rows.count - 1 ? books : nil)
                }
                if !m.narrow && !decoFits { shelfRow([], m, deco: books) }
            }
            .animation(.snappy(duration: 0.28), value: l.entries.map(\.id))
        }
    }

    private func shelfRow(_ row: [ShelfEntry], _ m: ShelfMetrics, deco: Bool?) -> some View {
        ZStack(alignment: .topLeading) {
            ShelfBoard()
                .padding(.horizontal, -14)
                .offset(y: m.book)
            HStack(alignment: .top, spacing: m.gap) {
                ForEach(row) { entry in
                    cell(entry, m).frame(width: m.cell)
                }
                if let deco {
                    Spacer(minLength: 0)
                    ShelfDeco(books: deco)
                        .frame(width: 92, height: 115)
                        .frame(width: m.cell, height: m.book, alignment: .bottom)
                }
            }
        }
        .frame(maxWidth: .infinity, minHeight: m.row - m.rowGap, alignment: .topLeading)
    }

    @ViewBuilder
    private func cell(_ entry: ShelfEntry, _ m: ShelfMetrics) -> some View {
        switch entry {
        case .folder(let f, let count):
            FolderCell(folder: f, count: count, metrics: m, onOpen: { folderId = f.id }) {
                _ = attempt("heftFolderDelete", { try store.core.heftFolderDelete(id: f.id) })
            }
        case .heft(let p, let pages):
            HeftCard(page: p, pages: pages, metrics: m) { options = p }
                .onTapGesture { onOpen(p) }
                .contextMenu { PageMenu(page: p, onOpen: onOpen) }
        }
    }

    /// Leerzustand: ein leeres Brett mit Hinweis (`.lib-body > .empty`).
    private func emptyShelf(_ l: Loaded) -> some View {
        VStack(spacing: Space.s4) {
            Text(!query.isEmpty ? "Keine Treffer" : folderId != nil ? "Dieser Ordner ist leer." : "Noch keine Hefte oder Ordner.")
                .font(.system(size: TextSize.base))
                .foregroundStyle(Impala.text2)
            if query.isEmpty && l.total == 0 && folderId == nil {
                Button("Neues Heft") { newHeft = true }
                    .buttonStyle(.glassProminent)
                    .tint(Shelf.button)
            }
            ShelfBoard()
                .padding(.horizontal, -14)
                .padding(.top, Space.s4)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 70)
    }

    // MARK: Werkzeugzeile

    /// Pfad wie `.gn-crumbs`: „Dokumente / Ordner / …“, bei einer Suche „Suche“.
    private func crumbs(_ path: [HeftFolder]) -> some View {
        HStack(spacing: 6) {
            if !query.isEmpty {
                Text("Suche").foregroundStyle(Shelf.ink)
            } else {
                Button("Dokumente") { folderId = nil }
                    .foregroundStyle(path.isEmpty ? Shelf.ink : Impala.text2)
                    .fontWeight(path.isEmpty ? .semibold : .regular)
                ForEach(path, id: \.id) { f in
                    Text("/").foregroundStyle(Impala.text2.opacity(0.6))
                    Button(f.title) { folderId = f.id }
                        .foregroundStyle(f.id == folderId ? Shelf.ink : Impala.text2)
                        .fontWeight(f.id == folderId ? .semibold : .regular)
                }
            }
        }
        .font(.system(size: TextSize.sm))
        .buttonStyle(.plain)
        .lineLimit(1)
    }

    /// „Neu“ in Holzbraun (`.gn-new`): Heft oder Ordner.
    private var newMenu: some View {
        Menu {
            Button { newHeft = true } label: { Label("Neues Heft", systemImage: "book") }
            Button {
                newFolderTitle = ""
                showNewFolder = true
            } label: {
                Label("Neuer Ordner", systemImage: "folder.badge.plus")
            }
        } label: {
            HStack(spacing: 6) {
                Icon("plus", size: 15)
                Text("Neu")
            }
            .font(.system(size: 14, weight: .semibold))
            .foregroundStyle(Color(uiColor: UIColor(hex: 0xFFFAF2)))
            .padding(.leading, 12)
            .padding(.trailing, 16)
            .frame(height: 36)
            .background(Shelf.button, in: RoundedRectangle(cornerRadius: 11, style: .continuous))
            .shadow(color: Color(uiColor: UIColor(hex: 0x3C230F, alpha: 0.45)), radius: 3, y: 2)
        }
    }

    // MARK: Daten

    /// Neues Heft im aktuellen Ordner (`data-libcreateheft`), mit Farbe oder eigenem Bild; öffnet sich gleich.
    private func create(title: String, cover: String, image: Data?) {
        let core = store.core
        guard let id = attempt("createHeft", { try core.createHeft(title: title, parentId: nil, workspaceId: nil) }) else { return }
        core.patchPage(id, ["cover": cover])
        if let folderId {
            _ = attempt("heftMoveToFolder", { try core.heftMoveToFolder(heftId: id, folderId: folderId, order: nil) })
        }
        if let image {
            _ = attempt("setCoverImage", { try core.setCoverImage(pageId: id, bytes: image, mime: "image/jpeg", name: "Cover.jpg") })
        }
        shell.open(id)
    }

    private nonisolated static func load(core: ImpalaCore, folderId: String?, query: String) -> Loaded {
        let searching = !query.trimmingCharacters(in: .whitespaces).isEmpty
        let folders = searching ? [] : core.heftFolders(parentId: folderId)
        let raw = searching ? core.recentPages(limit: UInt32.max).filter { $0.kind == .heft } : core.heftInFolder(folderId: folderId)
        let hefte = raw.filter { libMatches($0, query) }
        let entries: [ShelfEntry] =
            folders.map { .folder($0, core.heftFolders(parentId: $0.id).count + core.heftInFolder(folderId: $0.id).count) } +
            hefte.map { .heft($0, core.heftPageIds(pageId: $0.id).count) }
        return Loaded(
            entries: entries,
            total: raw.count + folders.count,
            crumbs: folderId.map { core.heftFolderPath(folderId: $0) } ?? []
        )
    }
}

// MARK: Kacheln

/// Heft auf dem Brett wie `libCardHtml`: Notizbuch, darunter Titel und „Heft · n Seiten · Datum“.
/// ★ oben rechts, ••• unten rechts öffnet die Heftoptionen.
private struct HeftCard: View {
    let page: PageSummary
    let pages: Int
    let metrics: ShelfMetrics
    let onOptions: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            NotebookCover(page: page, height: metrics.book)
                .overlay(alignment: .topTrailing) {
                    if page.favorite {
                        Text("★")
                            .font(.system(size: TextSize.xs))
                            .foregroundStyle(Impala.warn)
                            .shadow(color: .black.opacity(0.5), radius: 1.5, y: 1)
                            .padding(.top, 6)
                            .padding(.trailing, 10)
                    }
                }
                .overlay(alignment: .bottomTrailing) {
                    Button(action: onOptions) {
                        Text("•••")
                            .font(.system(size: 10, weight: .bold))
                            .kerning(1)
                            .foregroundStyle(.white)
                            .frame(width: 34, height: 26)
                            .background(.black.opacity(0.45), in: RoundedRectangle(cornerRadius: 7, style: .continuous))
                    }
                    .buttonStyle(.plain)
                    .padding(6)
                    .accessibilityLabel("Heftoptionen")
                }
                .contentShape(.hoverEffect, UnevenRoundedRectangle(topLeadingRadius: 5, bottomLeadingRadius: 5, bottomTrailingRadius: 12, topTrailingRadius: 12, style: .continuous))
                .hoverEffect(.lift)
            Text(PageStyle.title(page))
                .font(.system(size: TextSize.sm, weight: .semibold))
                .foregroundStyle(Shelf.ink)
                .lineLimit(2)
                .padding(.top, Shelf.ledge + 10)
            Text("Heft · \(max(pages, 1)) Seite\(max(pages, 1) == 1 ? "" : "n") · " + ChatList.when(page.updated))
                .font(.system(size: TextSize.xs))
                .foregroundStyle(Impala.text2)
                .lineLimit(1)
        }
        .contentShape(Rectangle())
    }
}

/// Mappe auf dem Brett wie `gnFolderHtml`: Name, „n Objekte“, ••• mit „Ordner löschen“.
private struct FolderCell: View {
    let folder: HeftFolder
    let count: Int
    let metrics: ShelfMetrics
    let onOpen: () -> Void
    let onDelete: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            FolderVisual(tone: FolderVisual.tone(folder.id.isEmpty ? folder.title : folder.id))
                .frame(height: metrics.folder)
                .hoverEffect(.lift)
                .padding(.top, metrics.book - metrics.folder)
            HStack(alignment: .top, spacing: 4) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(folder.title)
                        .font(.system(size: TextSize.base, weight: .semibold))
                        .foregroundStyle(Shelf.ink)
                        .lineLimit(1)
                    Text("\(count) \(count == 1 ? "Objekt" : "Objekte")")
                        .font(.system(size: TextSize.xs))
                        .foregroundStyle(Impala.text2)
                }
                Spacer(minLength: 0)
                Menu {
                    Button("Ordner löschen", role: .destructive, action: onDelete)
                } label: {
                    Text("•••")
                        .font(.system(size: 10, weight: .bold))
                        .kerning(1)
                        .foregroundStyle(Impala.text2)
                        .frame(width: 30, height: 24)
                        .contentShape(Rectangle())
                }
                .accessibilityLabel("Ordneroptionen")
            }
            .padding(.top, Shelf.ledge + 8)
        }
        .contentShape(Rectangle())
        .onTapGesture(perform: onOpen)
        .contextMenu {
            Button("Ordner löschen", role: .destructive, action: onDelete)
        }
    }
}

// MARK: Dialoge

/// Farbauswahl für die Hefte (`cover-grid` der PWA).
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

/// Foto aus der Mediathek als JPEG fürs Cover; `nil`, wenn es sich nicht lesen ließ.
private func coverData(_ item: PhotosPickerItem) async -> Data? {
    guard let data = try? await item.loadTransferable(type: Data.self) else { return nil }
    return await Task.detached(priority: .userInitiated) { CoverImages.jpeg(data) }.value
}

/// „Neues Heft“ (`openShelfHeftDialog`): Name, eigenes Bild oder Farbe.
private struct NewHeftSheet: View {
    @Environment(\.dismiss) private var dismiss
    let onCreate: (String, String, Data?) -> Void
    @State private var title = "Neues Heft"
    @State private var cover = HeftCover.presets[0]
    @State private var photo: PhotosPickerItem?
    @State private var image: Data?
    @State private var thumb: UIImage?

    var body: some View {
        NavigationStack {
            Form {
                Section("Name") { TextField("Heftname", text: $title) }
                Section {
                    HStack(spacing: Space.s4) {
                        if let thumb {
                            Image(uiImage: thumb)
                                .resizable()
                                .scaledToFill()
                                .frame(width: 58, height: 78)
                                .clipShape(UnevenRoundedRectangle(topLeadingRadius: 3, bottomLeadingRadius: 3, bottomTrailingRadius: 8, topTrailingRadius: 8, style: .continuous))
                        }
                        PhotosPicker(selection: $photo, matching: .images) {
                            Label(image == nil ? "Eigenes Bild wählen" : "Anderes Bild", systemImage: "photo")
                        }
                        if image != nil {
                            Spacer()
                            Button("Entfernen", role: .destructive) { withAnimation(.snappy) { image = nil; thumb = nil } }
                        }
                    }
                } header: {
                    Text("Eigenes Cover")
                } footer: {
                    Text("Ein eigenes Bild füllt das ganze Cover und hat Vorrang vor der Farbe.")
                }
                Section("Farbe") { CoverPicker(cover: $cover) }
            }
            .navigationTitle("Neues Heft")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Abbrechen") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Heft erstellen") {
                        let t = title.trimmingCharacters(in: .whitespaces)
                        onCreate(t.isEmpty ? "Neues Heft" : t, cover, image)
                        dismiss()
                    }
                }
            }
            .onChange(of: photo) { _, item in
                guard let item else { return }
                Task {
                    let data = await coverData(item)
                    photo = nil
                    guard let data else { return }
                    withAnimation(.snappy) {
                        image = data
                        thumb = UIImage(data: data)
                    }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }
}

/// „Heftoptionen“ (`openLibCoverPicker`): großes Cover-Vorschaubild, eigenes Bild als erste Wahl,
/// darunter Farbe, Ordner, Archivieren und Papierkorb.
private struct HeftOptionsSheet: View {
    @Environment(ImpalaStore.self) private var store
    @Environment(ShellModel.self) private var shell
    @Environment(\.dismiss) private var dismiss
    let page: PageSummary
    @State private var cover = ""
    @State private var coverImg: String?
    @State private var photo: PhotosPickerItem?
    @State private var busy = false
    @State private var failed = false

    private var preview: PageSummary {
        var p = page
        p.cover = cover
        p.coverImg = coverImg
        return p
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    HStack(alignment: .center, spacing: Space.s6) {
                        NotebookCover(page: preview, height: 172)
                            .frame(width: 126)
                            .overlay { if busy { ProgressView().tint(.white) } }
                        VStack(alignment: .leading, spacing: Space.s3) {
                            Text(coverImg == nil
                                 ? "Ein eigenes Bild füllt das ganze Cover – so erkennst du das Heft im Regal sofort."
                                 : "Dein Bild ist das Cover dieses Hefts.")
                                .font(.system(size: TextSize.sm))
                                .foregroundStyle(Impala.text2)
                                .fixedSize(horizontal: false, vertical: true)
                            PhotosPicker(selection: $photo, matching: .images) {
                                Label(coverImg == nil ? "Eigenes Bild wählen" : "Anderes Bild wählen", systemImage: "photo")
                            }
                            .buttonStyle(.glassProminent)
                            .disabled(busy)
                            if coverImg != nil {
                                Button("Bild entfernen", role: .destructive) { setColor(cover) }
                                    .buttonStyle(.borderless)
                            }
                        }
                    }
                    .padding(.vertical, Space.s2)
                } header: {
                    Text("Eigenes Cover")
                }
                Section {
                    CoverPicker(cover: Binding(get: { coverImg == nil ? cover : "" }, set: { setColor($0) }))
                    Button("Farbe zurücksetzen") { setColor("") }
                        .disabled(cover.isEmpty && coverImg == nil)
                } header: {
                    Text(coverImg == nil ? "Farbe" : "Oder eine Farbe")
                } footer: {
                    Text("Aus der Farbe entsteht für jedes Heft ein eigenes Muster.")
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
            .onAppear {
                cover = page.cover
                coverImg = page.coverImg
            }
            .onChange(of: photo) { _, item in
                guard let item else { return }
                Task { await useImage(item) }
            }
            .alert("Bild konnte nicht als Cover gesetzt werden.", isPresented: $failed) { Button("OK", role: .cancel) {} }
        }
        .presentationDetents([.large])
    }

    /// Farbe wählen (leer = keine): ein eigenes Bild entfällt dabei wie in der PWA (`data-libcoverset`).
    private func setColor(_ c: String) {
        withAnimation(.snappy) {
            cover = c
            coverImg = nil
        }
        store.core.patchPage(page.id, ["cover": c.isEmpty ? nil : c, "coverImg": nil])
    }

    private func useImage(_ item: PhotosPickerItem) async {
        busy = true
        defer {
            busy = false
            photo = nil
        }
        guard let data = await coverData(item),
              let id = attempt("setCoverImage", { try store.core.setCoverImage(pageId: page.id, bytes: data, mime: "image/jpeg", name: "Cover.jpg") })
        else {
            failed = true
            return
        }
        withAnimation(.snappy) {
            coverImg = id
            cover = ""
        }
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
