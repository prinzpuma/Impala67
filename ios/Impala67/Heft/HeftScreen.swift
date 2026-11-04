import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

/// Heft: eine Seite zum Zeichnen auf dem Arbeitsflächen-Hintergrund der PWA. Stifte, Farben, Radierer
/// und Lasso kommen nur aus Apples Werkzeugleiste (PencilKit). Darüber schweben (Liquid Glass) links
/// Blättern und Seitenübersicht, rechts „Bilder“ (Auswählen & Bearbeiten, Text, Bild, Kamera,
/// Handschrift → Text), „+“ (neue Seite, Papier, Bild als Seite, Import, Scannen) und Teilen (PDF, SVG).
struct HeftScreen: View {
    @Environment(ImpalaStore.self) private var store
    let pageId: String
    @State private var pageIds: [String] = []
    /// Aktuelle Seite über ihre ID, damit sie beim Umsortieren und Löschen erhalten bleibt.
    @State private var currentId: String?
    /// Zählt hoch, wenn das Heft außerhalb des Canvas geändert wurde (anderes Gerät, Seitenübersicht).
    @State private var revision = 0
    /// Blätterrichtung für den Übergang (vor: von rechts, zurück: von links).
    @State private var forward = true
    @State private var showPages = false
    @State private var link = HeftCanvasLink()
    @State private var photoTarget: PhotoTarget?
    @State private var photos: [PhotosPickerItem] = []
    @State private var showCamera = false
    @State private var showScanner = false
    @State private var showImporter = false
    @State private var share: SharedFile?
    @State private var busy: String?
    @Namespace private var namespace

    /// Wohin ausgewählte Fotos gehen: auf die Seite oder je als neue Seite.
    private enum PhotoTarget { case insert, page }

    private var index: Int { currentId.flatMap { pageIds.firstIndex(of: $0) } ?? 0 }

    var body: some View {
        ZStack(alignment: .top) {
            if let id = currentId, pageIds.contains(id) {
                HeftCanvas(core: store.core, pageId: pageId, heftPageId: id, revision: revision,
                           link: link, selecting: link.selecting, lassoText: link.lassoText)
                    .id(id)
                    .ignoresSafeArea(edges: .bottom)
                    .transition(.push(from: forward ? .trailing : .leading))
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            VStack(alignment: .trailing, spacing: Space.s2) {
                // Links Seiten, rechts Bilder, „+“ und Teilen. Zeichenwerkzeuge kommen nur aus Apples Leiste.
                HStack(alignment: .top, spacing: Space.s2) {
                    pageNav
                    Spacer(minLength: 0)
                    corner
                }
                if link.selecting { SelectBar(link: link) }
                if link.lassoText { hint("Umkreise die Handschrift, die als Text erkannt werden soll.") { link.lassoText = false } }
                if let busy { hint(busy, onCancel: nil) }
            }
            .padding(Space.s3)
            .animation(.snappy, value: link.selecting)
            .animation(.snappy, value: link.lassoText)
        }
        .clipped()
        .sensoryFeedback(.selection, trigger: currentId)
        // Angezeigte Seite als Kontext für die KI (Seitenbild, `view_heft_page`).
        .onChange(of: currentId, initial: true) { HeftLastPage.index[pageId] = index }
        // Neue Seite: Auswahl und Lasso gelten nur für die Seite, auf der sie begonnen wurden.
        .onChange(of: currentId) {
            link.selecting = false
            link.lassoText = false
            link.selection = nil
        }
        .background(Impala.bg0)
        .onAppear(perform: loadPages)
        .onChange(of: store.lastRemote) {
            guard store.remoteTouches(pageId) else { return }
            loadPages()
            revision += 1
        }
        .sheet(isPresented: $showPages) {
            HeftPagesSheet(
                pageId: pageId, pageIds: pageIds, currentId: currentId, revision: revision,
                onJump: jump, onAdd: addPage,
                onChanged: { loadPages(); revision += 1 }
            )
            .presentationSizing(.form)
            .navigationTransition(.zoom(sourceID: "heft-pages", in: namespace))
        }
        .sheet(item: $link.textEdit) { edit in
            HeftTextSheet(title: edit.textId == nil ? "Text schreiben" : "Text bearbeiten", initial: edit.text,
                          canDelete: edit.textId != nil, onSave: { saveText(edit, $0) }, onDelete: { deleteText(edit) })
                .presentationSizing(.form)
        }
        .sheet(item: $link.ocr) { result in
            HeftOcrSheet(result: result) { text in link.coordinator?.replaceWithText(result, text: text, color: link.coordinator?.currentColor ?? HeftPalette.colors[0].css) }
                .presentationSizing(.form)
        }
        .sheet(item: $share) { ShareSheet(items: [$0.url]) }
        .photosPicker(
            isPresented: Binding(get: { photoTarget != nil }, set: { if !$0 && photos.isEmpty { photoTarget = nil } }),
            selection: $photos, maxSelectionCount: photoTarget == .insert ? 1 : 20, matching: .images
        )
        .onChange(of: photos) { _, items in
            guard !items.isEmpty else { return }
            Task { await importPhotos(items) }
        }
        .fullScreenCover(isPresented: $showCamera) {
            CameraPicker { image in
                showCamera = false
                if let image { insertImage(image) }
            }
            .ignoresSafeArea()
        }
        .fullScreenCover(isPresented: $showScanner) {
            DocumentScanner { images in
                showScanner = false
                guard !images.isEmpty else { return }
                pagesAdded(HeftImport.addScans(core: store.core, pageId: pageId, images: images, at: index + 1))
            }
            .ignoresSafeArea()
        }
        .fileImporter(isPresented: $showImporter, allowedContentTypes: [.pdf, .image], allowsMultipleSelection: true) { result in
            guard case .success(let urls) = result else { return }
            run("Importiere …") { pagesAdded(HeftImport.importFiles(core: store.core, pageId: pageId, urls: urls, at: index + 1)) }
        }
    }

    // MARK: Leisten

    /// „Bilder“ (heft-toolbar-ui.js `imgPopHtml`), dazu „Handschrift → Text“ mit Apple Vision.
    private var imageMenu: some View {
        Menu {
            Section("Bilder") {
                Toggle(isOn: Binding(get: { link.selecting }, set: { on in
                    link.lassoText = false
                    link.selecting = on
                })) {
                    Label { Text("Bilder & Texte auswählen & bearbeiten") } icon: { Icon("select") }
                }
            }
            Button { newText() } label: { Label { Text("Text schreiben") } icon: { Icon("pen") } }
            Button { photos = []; photoTarget = .insert } label: { Label { Text("Bild hinzufügen") } icon: { Icon("image") } }
            if CameraPicker.isAvailable {
                Button { showCamera = true } label: { Label { Text("Bild aufnehmen") } icon: { Icon("camera") } }
            }
            Divider()
            Button {
                link.selecting = false
                link.lassoText = true
            } label: { Label { Text("Handschrift → Text") } icon: { Icon("note") } }
        } label: {
            Icon("image", size: 18)
                .foregroundStyle(link.selecting || link.lassoText ? Impala.accent : Impala.text)
                .frame(width: 40, height: 40)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Bilder einfügen oder bearbeiten")
    }

    /// Rechte Ecke: Bilder, „Seite hinzufügen“ (`plusPopHtml`) und Teilen (Apple-Teilen-Blatt).
    private var corner: some View {
        GlassEffectContainer {
            HStack(spacing: 2) {
                imageMenu
                AddPageMenu(
                    currentPaper: currentId.flatMap { try? store.core.heftPage(pageId: pageId, heftPageId: $0).paper },
                    onAdd: addPage, onPaper: setPaper,
                    onImagePage: { photos = []; photoTarget = .page },
                    onImport: { showImporter = true },
                    onScan: DocumentScanner.isAvailable ? { showScanner = true } : nil
                )
                Menu {
                    Button { exportPdf() } label: { Label { Text("Als PDF exportieren") } icon: { Icon("printer") } }
                    Button { exportSvg() } label: { Label { Text("Seite als SVG") } icon: { Icon("download") } }
                    Button {
                        UIPasteboard.general.string = "#" + pageId
                    } label: { Label { Text("Internen Link kopieren") } icon: { Icon("link") } }
                } label: {
                    Icon("upload", size: 18)
                        .foregroundStyle(Impala.text)
                        .frame(width: 40, height: 40)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Exportieren & Teilen")
            }
            .padding(.horizontal, Space.s1)
            .frame(height: 48)
            .impalaGlass(interactive: true)
        }
    }

    private func hint(_ text: String, onCancel: (() -> Void)?) -> some View {
        HStack(spacing: Space.s2) {
            Text(text).font(.system(size: TextSize.sm)).foregroundStyle(Impala.text)
            if let onCancel {
                Button("Abbrechen", action: onCancel).font(.system(size: TextSize.sm, weight: .semibold))
            }
        }
        .padding(.horizontal, Space.s3)
        .frame(minHeight: 40)
        .impalaGlass(interactive: true)
        .transition(.move(edge: .top).combined(with: .opacity))
    }

    /// Linke Ecke wie `heft-corner-l-group`: Seiten (‹ n / m ›, Antippen öffnet die Seitenübersicht).
    private var pageNav: some View {
        PageNav(index: index, count: pageIds.count, namespace: namespace, onMove: move, onPages: { showPages = true })
    }

    // MARK: Seiten

    private func loadPages() {
        let old = index
        pageIds = store.core.heftPageIds(pageId: pageId)
        if !(currentId.map { pageIds.contains($0) } ?? false) {
            currentId = pageIds.isEmpty ? nil : pageIds[min(old, pageIds.count - 1)]
        }
    }

    /// Neue Seite am Ende; ohne Wahl mit dem Papier der letzten Seite (wie PWA und Android).
    private func addPage(_ paper: HeftPaperKind?) {
        let last = pageIds.last.flatMap { try? store.core.heftPage(pageId: pageId, heftPageId: $0).paper }
        guard let id = try? store.core.heftAddPage(pageId: pageId, at: nil, paper: paper?.rawValue ?? last) else { return }
        loadPages()
        jump(id)
    }

    /// Nach einem Import: Seiten neu lesen und zur letzten neuen Seite springen.
    private func pagesAdded(_ last: String?) {
        loadPages()
        revision += 1
        if let last { jump(last) }
    }

    private func setPaper(_ paper: HeftPaperKind) {
        guard let id = currentId else { return }
        _ = try? store.core.heftSetPaper(pageId: pageId, heftPageId: id, paper: paper.rawValue)
        revision += 1
    }

    private func jump(_ id: String) {
        guard let to = pageIds.firstIndex(of: id) else { return }
        forward = to >= index
        withAnimation(.smooth(duration: 0.35)) { currentId = id }
    }

    private func move(_ by: Int) {
        let to = min(max(0, index + by), pageIds.count - 1)
        guard pageIds.indices.contains(to) else { return }
        jump(pageIds[to])
    }

    // MARK: Bilder und Texte

    private func importPhotos(_ items: [PhotosPickerItem]) async {
        let target = photoTarget
        var images: [UIImage] = []
        for item in items {
            if let data = try? await item.loadTransferable(type: Data.self), let img = UIImage(data: data) { images.append(img) }
        }
        photos = []
        photoTarget = nil
        switch target {
        case .insert: if let img = images.first { insertImage(img) }
        case .page:
            var at = index + 1
            var last: String?
            for img in images {
                if let id = HeftImport.addImagePage(core: store.core, pageId: pageId, image: img, at: at, bleed: false) {
                    last = id
                    at += 1
                }
            }
            pagesAdded(last)
        case nil: break
        }
    }

    /// Bild auf die aktuelle Seite; danach ist es ausgewählt (verschieben, skalieren, löschen).
    private func insertImage(_ image: UIImage) {
        guard let id = currentId,
              let imageId = HeftImport.insertImage(core: store.core, pageId: pageId, heftPageId: id, image: image) else { return }
        link.lassoText = false
        link.selecting = true
        link.coordinator?.reload()
        link.coordinator?.selectAfterReload(.image(imageId))
    }

    private func newText() {
        link.lassoText = false
        link.textEdit = HeftTextEdit(textId: nil, text: "")
    }

    private func saveText(_ edit: HeftTextEdit, _ text: String) {
        guard let id = currentId, let canvas = link.coordinator else { return }
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if let textId = edit.textId {
            guard var t = canvas.text(textId) else { return }
            if trimmed.isEmpty {
                _ = try? store.core.heftRemoveTexts(pageId: pageId, heftPageId: id, ids: [textId])
            } else {
                t.text = text
                _ = try? store.core.heftSetText(pageId: pageId, heftPageId: id, text: t)
            }
            canvas.reload()
        } else if !trimmed.isEmpty {
            let c = canvas.visibleCenter()
            let new = try? store.core.heftAddText(pageId: pageId, heftPageId: id, text: text,
                                                  x: Double(c.x) - 200, y: Double(c.y) - 30, w: 400, color: canvas.currentColor, size: 30)
            link.selecting = true
            canvas.reload()
            if let tid = new?.ids.first { canvas.selectAfterReload(.text(tid)) }
        }
    }

    private func deleteText(_ edit: HeftTextEdit) {
        guard let id = currentId, let textId = edit.textId else { return }
        _ = try? store.core.heftRemoveTexts(pageId: pageId, heftPageId: id, ids: [textId])
        link.selection = nil
        link.coordinator?.reload()
    }

    // MARK: Export

    private func exportPdf() {
        run("Erzeuge PDF …") {
            if let url = HeftExport.pdf(core: store.core, pageId: pageId) { share = SharedFile(url: url) }
        }
    }

    private func exportSvg() {
        guard let id = currentId, let url = HeftExport.svg(core: store.core, pageId: pageId, heftPageId: id) else { return }
        share = SharedFile(url: url)
    }

    /// Längere Arbeit nach dem nächsten Bild ausführen, damit der Hinweis vorher erscheint.
    private func run(_ status: String, _ work: @escaping () -> Void) {
        busy = status
        Task {
            try? await Task.sleep(for: .milliseconds(60))
            work()
            busy = nil
        }
    }
}

/// Leiste im Auswahlmodus: Text bearbeiten, Löschen, Fertig.
private struct SelectBar: View {
    let link: HeftCanvasLink

    var body: some View {
        HStack(spacing: Space.s2) {
            Text(link.selection == nil ? "Bild oder Text antippen" : "Ziehen verschiebt, der Griff skaliert")
                .font(.system(size: TextSize.sm))
                .foregroundStyle(Impala.text2)
            if case .text(let id) = link.selection {
                Button("Text bearbeiten") {
                    if let t = link.coordinator?.text(id) { link.textEdit = HeftTextEdit(textId: t.id, text: t.text) }
                }
            }
            if link.selection != nil {
                Button(role: .destructive) { link.coordinator?.deleteSelection() } label: { Icon("trash", size: 16) }
                    .accessibilityLabel("Löschen")
            }
            Button("Fertig") { link.selecting = false }
                .fontWeight(.semibold)
        }
        .font(.system(size: TextSize.sm))
        .padding(.horizontal, Space.s3)
        .frame(minHeight: 40)
        .impalaGlass(interactive: true)
        .transition(.move(edge: .top).combined(with: .opacity))
    }
}

/// Seitenanzeige der PWA-Heftleiste: ‹ n / m ›, Antippen der Zahl öffnet die Seitenübersicht.
private struct PageNav: View {
    let index: Int
    let count: Int
    let namespace: Namespace.ID
    let onMove: (Int) -> Void
    let onPages: () -> Void

    var body: some View {
        GlassEffectContainer {
            HStack(spacing: 2) {
                button("chevron-left", "Vorige Seite", enabled: index > 0) { onMove(-1) }
                Button(action: onPages) {
                    HStack(spacing: 6) {
                        Icon("pages-stack", size: 16)
                        Text(count == 0 ? "–" : "\(index + 1) / \(count)")
                            .font(.system(size: TextSize.sm, weight: .medium).monospacedDigit())
                            .contentTransition(.numericText(value: Double(index)))
                            .animation(.snappy, value: index)
                    }
                    .foregroundStyle(Impala.text)
                    .frame(minWidth: 64, minHeight: 40)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .matchedTransitionSource(id: "heft-pages", in: namespace)
                .accessibilityLabel("Seitenübersicht")
                button("chevron-right", "Nächste Seite", enabled: index < count - 1) { onMove(1) }
            }
            .padding(.horizontal, Space.s1)
            .frame(height: 48)
            .impalaGlass(interactive: true)
        }
    }

    private func button(_ icon: String, _ label: String, enabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Icon(icon, size: 16)
                .foregroundStyle(enabled ? Impala.text : Impala.text2.opacity(0.4))
                .frame(width: 36, height: 40)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .accessibilityLabel(label)
    }
}

/// „Seite hinzufügen“ (Tippen: Papier der letzten Seite, Halten: `plusPopHtml` – neue Seite mit Papier,
/// Papier dieser Seite, Bild als Seite, PDF oder Bild importieren, Dokument scannen).
private struct AddPageMenu: View {
    let currentPaper: String?
    let onAdd: (HeftPaperKind?) -> Void
    let onPaper: (HeftPaperKind) -> Void
    let onImagePage: () -> Void
    let onImport: () -> Void
    let onScan: (() -> Void)?

    var body: some View {
        Menu {
            Section("Neue Seite") {
                ForEach(HeftPaperKind.allCases) { kind in
                    Button { onAdd(kind) } label: { Label(kind.label, systemImage: kind.symbol) }
                }
            }
            Menu("Papier dieser Seite") {
                ForEach(HeftPaperKind.allCases) { kind in
                    Button { onPaper(kind) } label: {
                        Label(kind.label, systemImage: currentPaper == kind.rawValue ? "checkmark" : kind.symbol)
                    }
                }
            }
            Divider()
            Button(action: onImagePage) { Label { Text("Bild als Seite") } icon: { Icon("image") } }
            Button(action: onImport) { Label { Text("PDF oder Bild importieren") } icon: { Icon("upload") } }
            if let onScan {
                Button(action: onScan) { Label { Text("Dokument scannen") } icon: { Icon("camera") } }
            }
        } label: {
            Icon("plus", size: 18)
                .foregroundStyle(Impala.text)
                .frame(width: 40, height: 40)
                .contentShape(Rectangle())
        } primaryAction: {
            onAdd(nil)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Seite hinzufügen")
    }
}
