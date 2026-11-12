import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

/// Heft: alle Seiten in einer Fläche auf dem Arbeitsflächen-Hintergrund der PWA. Darüber schweben (Liquid
/// Glass) links die Seitenanzeige (öffnet die Übersicht samt Teilen), in der Mitte die Werkzeug-Pille wie
/// `heft-pill` der PWA (`HeftToolPill`: Stifte, Marker, Radierer, Lasso, Lineal, Rückgängig), rechts „+“ (ein Panel wie `plusPopHtml`: neue Seite
/// davor/danach/am Ende, Papier, Text, Bild, Kamera, Import, Scannen). Bilder und Texte werden direkt
/// angetippt bzw. gehalten (`HeftSelectLayer`).
struct HeftScreen: View {
    @Environment(ImpalaStore.self) private var store
    @Environment(ShellModel.self) private var shell
    @AppStorage(AppTabsPosition.key) private var tabsPosition = AppTabsPosition.top.rawValue
    let pageId: String
    @State private var pageIds: [String] = []
    /// Aktuelle Seite über ihre ID, damit sie beim Umsortieren und Löschen erhalten bleibt.
    @State private var currentId: String?
    /// Zählt hoch, wenn das Heft außerhalb des Canvas geändert wurde (anderes Gerät, Seitenübersicht).
    @State private var revision = 0
    @State private var showPages = false
    @State private var link = HeftCanvasLink()
    private let tools = HeftTools.shared
    @State private var pickPhoto = false
    @State private var photos: [PhotosPickerItem] = []
    @State private var showCamera = false
    @State private var showScanner = false
    @State private var showImporter = false
    @State private var busy: String?
    @State private var currentPaper: String?
    @State private var showAdd = false
    /// Wo „Neue Seite“ einfügt (`insertPos` der PWA): before, after, last.
    @AppStorage("impala.heft.insertPos") private var insertPos = "after"
    @Namespace private var namespace

    private var index: Int { currentId.flatMap { pageIds.firstIndex(of: $0) } ?? 0 }

    var body: some View {
        ZStack(alignment: .top) {
            if !pageIds.isEmpty {
                // Alle Seiten untereinander in einer Fläche (wie `.heft-pages` der PWA).
                HeftCanvas(core: store.core, pageId: pageId, pageIds: pageIds, initialPageId: currentId, revision: revision,
                           link: link, tools: tools.setting,
                           onCurrentPage: { id in if currentId != id { currentId = id } },
                           onPullAdd: { addPage(nil) })
                    .ignoresSafeArea(edges: .bottom)
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            VStack(alignment: .trailing, spacing: Space.s2) {
                // Links Seiten (mit Teilen), in der Mitte die Werkzeuge, rechts „+“.
                HStack(alignment: .top, spacing: Space.s2) {
                    if tabsPosition == AppTabsPosition.sidebar.rawValue {
                        GlassEffectContainer {
                            HStack(spacing: 2) {
                                Button { shell.toggleSidebar() } label: {
                                    Icon("columns", size: 16)
                                        .foregroundStyle(Impala.text2)
                                        .frame(width: 36, height: 40)
                                        .contentShape(Rectangle())
                                }
                                .buttonStyle(.plain)
                                .accessibilityLabel("Linke Spalte ein-/ausklappen")

                                Button { shell.goBack() } label: {
                                    Icon("chevron-left", size: 15)
                                        .foregroundStyle(shell.canGoBack ? Impala.text : Impala.text2.opacity(0.35))
                                        .frame(width: 32, height: 40)
                                        .contentShape(Rectangle())
                                }
                                .buttonStyle(.plain)
                                .disabled(!shell.canGoBack)
                                .contextMenu {
                                    ForEach(shell.backHistoryItems()) { item in
                                        MenuItem(item.title, icon: item.icon) { shell.jumpToHistory(item.index) }
                                    }
                                }
                                .accessibilityLabel("Zurück")

                                Button { shell.goForward() } label: {
                                    Icon("chevron-right", size: 15)
                                        .foregroundStyle(shell.canGoForward ? Impala.text : Impala.text2.opacity(0.35))
                                        .frame(width: 32, height: 40)
                                        .contentShape(Rectangle())
                                }
                                .buttonStyle(.plain)
                                .disabled(!shell.canGoForward)
                                .contextMenu {
                                    ForEach(shell.forwardHistoryItems()) { item in
                                        MenuItem(item.title, icon: item.icon) { shell.jumpToHistory(item.index) }
                                    }
                                }
                                .accessibilityLabel("Vor")
                            }
                            .padding(.horizontal, Space.s1)
                            .frame(height: 48)
                            .impalaGlass(interactive: true)
                        }
                    }
                    pageNav
                    Spacer(minLength: 0)
                    HeftToolPill(tools: tools, link: link)
                    Spacer(minLength: 0)
                    corner
                }
                if link.selection != nil { SelectBar(link: link) }
                if tools.tool == .lasso && (link.lassoCount > 0 || link.canPaste) { LassoBar(link: link) }
                if let busy { hint(busy) }
            }
            .padding(Space.s3)
            .animation(.snappy, value: link.selection)
            .animation(.snappy, value: link.lassoCount > 0)
        }
        .clipped()
        // Angezeigte Seite als Kontext für die KI (Seitenbild, `view_heft_page`) und Startseite beim
        // nächsten Öffnen (wie `rememberPos` der PWA).
        .onChange(of: currentId, initial: true) { HeftLastPage.index[pageId] = index }
        // Für den Profiler-Bericht: Strichzahlen dieses Hefts (Vergleich mit PWA/Android).
        .onAppear { HeftLastPage.open = pageId }
        .background(Impala.bg0)
        .onAppear(perform: loadPages)
        // Papierart der Seite nur bei Seitenwechsel/Änderung lesen, im Hintergrund: `heftPage` lädt alle
        // Striche – bisher bei jedem Neuzeichnen der Leiste auf dem Hauptthread (Hänger bei vollen Seiten).
        .task(id: "\(currentId ?? "")|\(revision)") {
            guard let hid = currentId else { currentPaper = nil; return }
            let core = store.core, pid = pageId
            let paper = await Task.detached(priority: .userInitiated) {
                attempt("heftPage", { try core.heftPage(pageId: pid, heftPageId: hid) })?.paper
            }.value
            if !Task.isCancelled { currentPaper = paper }
        }
        .onChange(of: store.remoteRevision) {
            guard store.remoteTouches(pageId) else { return }
            loadPages()
            revision += 1
        }
        .learningTime(LearnContext(category: "notebook", sourceId: pageId))
        .sheet(isPresented: $showPages) {
            HeftPagesSheet(
                pageId: pageId, pageIds: pageIds, currentId: currentId, revision: revision,
                onJump: jump, onAdd: { addPage($0) },
                onChanged: { loadPages(); revision += 1 },
                writes: link.coordinator
            )
            .presentationSizing(.form)
            .navigationTransition(.zoom(sourceID: "heft-pages", in: namespace))
        }
        .sheet(item: $link.textEdit) { edit in
            HeftTextSheet(title: edit.textId == nil ? "Text schreiben" : "Text bearbeiten", initial: edit.text,
                          canDelete: edit.textId != nil, onSave: { saveText(edit, $0) }, onDelete: { deleteText(edit) })
                .presentationSizing(.form)
        }
        .photosPicker(isPresented: $pickPhoto, selection: $photos, maxSelectionCount: 1, matching: .images)
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

    /// Rechte Ecke: „+“ (ein Panel für Seiten und Einfügen, wie `plusPopHtml` der PWA bzw. GoodNotes).
    /// Teilen sitzt in der Seitenübersicht.
    private var corner: some View {
        GlassEffectContainer {
            HStack(spacing: 2) {
                Button { showAdd = true } label: {
                    Icon("plus", size: 18)
                        .foregroundStyle(Impala.text)
                        .frame(width: 40, height: 40)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Seite hinzufügen oder einfügen")
                .popover(isPresented: $showAdd, arrowEdge: .top) {
                    HeftAddPanel(
                        insertPos: $insertPos, currentPaper: currentPaper,
                        onAdd: { kind in showAdd = false; addPage(kind, at: insertPos) },
                        onPaper: setPaper,
                        onText: { afterPanel(newText) },
                        onImage: { afterPanel { photos = []; pickPhoto = true } },
                        onCamera: CameraPicker.isAvailable ? { afterPanel { showCamera = true } } : nil,
                        onImport: { afterPanel { showImporter = true } },
                        onScan: DocumentScanner.isAvailable ? { afterPanel { showScanner = true } } : nil
                    )
                    .presentationCompactAdaptation(.popover)
                }
            }
            .padding(.horizontal, Space.s1)
            .frame(height: 48)
            .impalaGlass(interactive: true)
        }
    }

    /// Panel schließen, dann ein Blatt öffnen (Fotos, Kamera, Import): zwei Präsentationen zugleich
    /// verweigert SwiftUI.
    private func afterPanel(_ action: @escaping () -> Void) {
        showAdd = false
        Task {
            try? await Task.sleep(for: .milliseconds(350))
            action()
        }
    }

    private func hint(_ text: String) -> some View {
        HStack(spacing: Space.s2) {
            Text(text).font(.system(size: TextSize.sm)).foregroundStyle(Impala.text)
        }
        .padding(.horizontal, Space.s3)
        .frame(minHeight: 40)
        .impalaGlass(interactive: true)
        .transition(.move(edge: .top).combined(with: .opacity))
    }

    /// Linke Ecke wie `heft-corner-l-group`: Seitenanzeige „n / m“, Antippen öffnet die Seitenübersicht.
    /// Geblättert wird durch Scrollen (alle Seiten liegen untereinander).
    private var pageNav: some View {
        PageNav(index: index, count: pageIds.count, namespace: namespace, onPages: { showPages = true })
    }

    // MARK: Seiten

    private func loadPages() {
        let done = Profiler.shared.begin("heft.loadPages")
        defer { done() }
        // Beim ersten Laden die zuletzt angezeigte Seite dieses Hefts.
        let old = currentId == nil ? (HeftLastPage.index[pageId] ?? 0) : index
        pageIds = store.core.heftPageIds(pageId: pageId)
        if !(currentId.map { pageIds.contains($0) } ?? false) {
            currentId = pageIds.isEmpty ? nil : pageIds[min(old, pageIds.count - 1)]
        }
    }

    /// Neue Seite (Standard: am Ende); ohne Wahl mit dem Papier der letzten Seite (wie PWA und Android).
    /// `pos` wie `insertPos` der PWA: vor oder nach der aktuellen Seite bzw. am Ende.
    private func addPage(_ paper: HeftPaperKind?, at pos: String = "last") {
        let last = pageIds.last.flatMap { hid in attempt("heftPage", { try store.core.heftPage(pageId: pageId, heftPageId: hid) })?.paper }
        let at: UInt32? = switch pos {
        case "before" where !pageIds.isEmpty: UInt32(index)
        case "after" where !pageIds.isEmpty: UInt32(index + 1)
        default: nil
        }
        guard let id = attempt("heftAddPage", { try store.core.heftAddPage(pageId: pageId, at: at, paper: paper?.rawValue ?? last) }) else { return }
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
        _ = attempt("heftSetPaper", { try store.core.heftSetPaper(pageId: pageId, heftPageId: id, paper: paper.rawValue) })
        revision += 1
    }

    /// Zu einer Seite scrollen (‹ ›, Seitenübersicht, neue Seite). Eine eben angelegte Seite kennt der
    /// Canvas erst nach dem nächsten Aktualisieren; er springt dann hin.
    private func jump(_ id: String) {
        guard pageIds.contains(id) else { return }
        currentId = id
        link.coordinator?.scroll(to: id, animated: true)
    }

    // MARK: Bilder und Texte

    /// Ausgewähltes Foto auf die aktuelle Seite (Bilder als eigene Seiten kommen über den Import).
    private func importPhotos(_ items: [PhotosPickerItem]) async {
        let data = try? await items.first?.loadTransferable(type: Data.self)
        photos = []
        if let data, let img = UIImage(data: data) { insertImage(img) }
    }

    /// Bild auf die aktuelle Seite; danach ist es ausgewählt (verschieben, skalieren, löschen).
    private func insertImage(_ image: UIImage) {
        guard let id = currentId,
              let imageId = HeftImport.insertImage(core: store.core, pageId: pageId, heftPageId: id, image: image) else { return }
        link.coordinator?.reload()
        link.coordinator?.selectAfterReload(.image(imageId))
    }

    /// Neues Textfeld direkt auf der Seite (wie GoodNotes); ohne Leinwand über das Blatt.
    private func newText() {
        if let canvas = link.coordinator { canvas.newInlineText() } else { link.textEdit = HeftTextEdit(textId: nil, text: "") }
    }

    /// Textfeld speichern; die Seite des Felds kennt der Canvas (alle Seiten liegen in einer Fläche).
    private func saveText(_ edit: HeftTextEdit, _ text: String) {
        guard let canvas = link.coordinator else { return }
        if let textId = edit.textId {
            canvas.setText(textId, to: text)
        } else if !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            canvas.addText(text)
        }
    }

    private func deleteText(_ edit: HeftTextEdit) {
        guard let textId = edit.textId else { return }
        link.coordinator?.removeText(textId)
        link.selection = nil
    }

    /// Längere Arbeit nach dem nächsten Bild ausführen, damit der Hinweis vorher erscheint (Import).
    private func run(_ status: String, _ work: @escaping () -> Void) {
        busy = status
        Task {
            try? await Task.sleep(for: .milliseconds(60))
            work()
            busy = nil
        }
    }
}

/// Leiste zur Lasso-Auswahl wie in GoodNotes: Farbe, Duplizieren, Kopieren, Ausschneiden, Löschen;
/// ohne Auswahl „Einfügen“, sobald etwas kopiert ist.
private struct LassoBar: View {
    let link: HeftCanvasLink

    var body: some View {
        HStack(spacing: Space.s3) {
            if link.lassoCount > 0 {
                Text(link.lassoCount == 1 ? "1 Strich" : "\(link.lassoCount) Striche")
                    .font(.system(size: TextSize.sm))
                    .foregroundStyle(Impala.text2)
                Menu {
                    ForEach(HeftPalette.colors, id: \.css) { c in
                        Button(c.name) { link.coordinator?.lassoColor(c.css) }
                    }
                } label: {
                    Icon("palette", size: 16)
                }
                .accessibilityLabel("Farbe")
                Button { link.coordinator?.lassoDuplicate() } label: { Icon("pages-stack", size: 16) }
                    .accessibilityLabel("Duplizieren")
                Button { link.coordinator?.lassoCopy() } label: { Icon("copy", size: 16) }
                    .accessibilityLabel("Kopieren")
                Button("Ausschneiden") { link.coordinator?.lassoCut() }
                Button(role: .destructive) { link.coordinator?.lassoDelete() } label: { Icon("trash", size: 16) }
                    .accessibilityLabel("Löschen")
                Button("Fertig") { link.coordinator?.clearLasso() }
                    .fontWeight(.semibold)
            } else {
                Button("Einfügen") { link.coordinator?.lassoPaste() }
                    .fontWeight(.semibold)
            }
        }
        .font(.system(size: TextSize.sm))
        .padding(.horizontal, Space.s3)
        .frame(minHeight: 40)
        .impalaGlass(interactive: true)
        .transition(.move(edge: .top).combined(with: .opacity))
    }
}

/// Leiste, solange ein Bild oder Textfeld ausgewählt ist: Text bearbeiten, Löschen, Fertig.
private struct SelectBar: View {
    let link: HeftCanvasLink

    var body: some View {
        HStack(spacing: Space.s2) {
            Text("Ziehen verschiebt, der Griff skaliert")
                .font(.system(size: TextSize.sm))
                .foregroundStyle(Impala.text2)
            if case .text(let id) = link.selection {
                Button("Text bearbeiten") { link.coordinator?.editText(id) }
            }
            Button(role: .destructive) { link.coordinator?.deleteSelection() } label: { Icon("trash", size: 16) }
                .accessibilityLabel("Löschen")
            Button("Fertig") { link.coordinator?.clearSelection() }
                .fontWeight(.semibold)
        }
        .font(.system(size: TextSize.sm))
        .padding(.horizontal, Space.s3)
        .frame(minHeight: 40)
        .impalaGlass(interactive: true)
        .transition(.move(edge: .top).combined(with: .opacity))
    }
}

/// Seitenanzeige der PWA-Heftleiste (`heft-corner-l`): „n / m“, Antippen öffnet die Seitenübersicht.
private struct PageNav: View {
    let index: Int
    let count: Int
    let namespace: Namespace.ID
    let onPages: () -> Void

    var body: some View {
        GlassEffectContainer {
            HStack(spacing: 2) {
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
                    .padding(.horizontal, Space.s2)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .matchedTransitionSource(id: "heft-pages", in: namespace)
                .accessibilityLabel("Seitenübersicht")
            }
            .padding(.horizontal, Space.s1)
            .frame(height: 48)
            .impalaGlass(interactive: true)
        }
    }
}

/// „+“-Panel wie `plusPopHtml`/`imgPopHtml` der PWA in einem: neue Seite (davor, danach, am Ende) mit
/// Papier-Vorschau, Papier dieser Seite, dann Einfügen auf der Seite und Seiten aus Bildern/Dateien.
private struct HeftAddPanel: View {
    @Binding var insertPos: String
    let currentPaper: String?
    let onAdd: (HeftPaperKind) -> Void
    let onPaper: (HeftPaperKind) -> Void
    let onText: () -> Void
    let onImage: () -> Void
    let onCamera: (() -> Void)?
    let onImport: () -> Void
    let onScan: (() -> Void)?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Space.s3) {
                head("Neue Seite")
                Picker("Position", selection: $insertPos) {
                    Text("Davor").tag("before")
                    Text("Danach").tag("after")
                    Text("Am Ende").tag("last")
                }
                .pickerStyle(.segmented)
                HStack(spacing: Space.s2) {
                    ForEach(HeftPaperKind.allCases) { kind in
                        Button { onAdd(kind) } label: {
                            VStack(spacing: Space.s1) {
                                HeftPaperSwatch(kind: kind)
                                    .frame(height: 78)
                                Text(kind.label)
                                    .font(.system(size: TextSize.xs))
                                    .foregroundStyle(Impala.text2)
                            }
                            .frame(maxWidth: .infinity)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Neue Seite \(kind.label)")
                    }
                }

                head("Papier dieser Seite")
                HStack(spacing: Space.s1) {
                    ForEach(HeftPaperKind.allCases) { kind in
                        let on = currentPaper == kind.rawValue
                        Button { onPaper(kind) } label: {
                            Text(kind.label)
                                .font(.system(size: TextSize.sm, weight: on ? .semibold : .regular))
                                .foregroundStyle(on ? Impala.accent : Impala.text)
                                .frame(maxWidth: .infinity, minHeight: 32)
                                .background(on ? Impala.activeTint : Impala.surface, in: Capsule())
                                .contentShape(Capsule())
                        }
                        .buttonStyle(.plain)
                    }
                }

                Divider()
                head("Einfügen")
                row("Text", "pen", onText)
                row("Bild", "image", onImage)
                if let onCamera { row("Foto aufnehmen", "camera", onCamera) }

                Divider()
                head("Seiten aus Dateien")
                row("PDF oder Bilder importieren", "upload", onImport)
                if let onScan { row("Dokument scannen", "camera", onScan) }

                Text("Bild oder Text antippen oder halten, dann verschieben, skalieren oder löschen.")
                    .font(.system(size: TextSize.xs))
                    .foregroundStyle(Impala.text2)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(Space.s4)
        }
        .frame(width: 360)
        .frame(maxHeight: 640)
    }

    private func head(_ text: String) -> some View {
        Text(text)
            .font(.system(size: TextSize.xs, weight: .semibold))
            .foregroundStyle(Impala.text2)
            .textCase(.uppercase)
    }

    private func row(_ title: String, _ icon: String, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: Space.s3) {
                Icon(icon, size: 16).foregroundStyle(Impala.text2).frame(width: 22)
                Text(title).font(.system(size: TextSize.base)).foregroundStyle(Impala.text)
                Spacer(minLength: 0)
            }
            .frame(minHeight: 40)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

/// Kleine Papier-Vorschau (Ausschnitt oben links, damit Linien und Punkte erkennbar bleiben).
private struct HeftPaperSwatch: View {
    let kind: HeftPaperKind

    var body: some View {
        Canvas { ctx, size in
            let crop = CGSize(width: 300, height: 300 * size.height / max(size.width, 1))
            ctx.withCGContext { cg in
                cg.scaleBy(x: size.width / crop.width, y: size.height / crop.height)
                cg.clip(to: CGRect(origin: .zero, size: crop))
                HeftPaperDraw.draw(in: cg, size: CGSize(width: 1000, height: 1414), paper: kind.rawValue)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: Radius.xs))
        .overlay(RoundedRectangle(cornerRadius: Radius.xs).stroke(Impala.edge, lineWidth: 1))
    }
}
