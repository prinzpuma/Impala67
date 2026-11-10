import PhotosUI
import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// Notiz wie die Seitenansicht der PWA: Brotkrumen, Emoji, großer Titel, Rückverweise, darunter die
/// Blöcke (`markdownToBlocks` im Kern) und die Unterseiten. Antippen macht einen Block zum Eingabefeld;
/// solange einer aktiv ist, schweben Block-Leiste und Slash-/Link-Menü (Liquid Glass) über der Tastatur.
/// Speichert kurz nach dem Tippen über den Kern; fremde Änderungen laden nach, solange hier nichts
/// ungespeichert ist.
struct NoteEditor: View {
    @Environment(ImpalaStore.self) private var store
    @Environment(\.scenePhase) private var scenePhase
    let pageId: String
    @State private var model: NoteModel?

    var body: some View {
        Group {
            if let model, model.pageId == pageId {
                NoteBody(model: model)
            } else {
                Impala.panel
            }
        }
        .task(id: pageId) {
            model?.flush()
            model = NoteModel(core: store.core, pageId: pageId)
        }
        .onDisappear { model?.flush() }
        .onChange(of: scenePhase) { _, phase in
            if phase != .active { model?.flush() }
        }
        .onChange(of: store.remoteRevision) {
            if store.remoteTouches(pageId) { model?.applyRemote() }
        }
        .learningTime(LearnContext(category: "notes", sourceId: pageId))
    }
}

/// Bildschirm-Rahmen der Blöcke (Zeilen-Positionen fürs Ziehen; ändert keine Ansicht).
private final class BlockFrames {
    var rects: [String: CGRect] = [:]
}

private struct NoteBody: View {
    let model: NoteModel
    @Environment(ImpalaStore.self) private var store
    @Environment(ShellModel.self) private var shell
    @Environment(\.accessibilityReduceMotion) private var systemReduceMotion
    private var reduceMotion: Bool { systemReduceMotion || AppMotion.isReduced }
    @State private var frames = BlockFrames()
    @State private var dragId: String?
    @State private var dragOffset: CGFloat = 0
    @State private var hovered: String?
    @State private var rawBlock: MdBlock?
    @State private var linkURL = ""
    @State private var photos: [PhotosPickerItem] = []
    @State private var showIconPicker = false
    @State private var isDbPage = false
    @AppStorage(AppDensity.key) private var density = AppDensity.compact.rawValue

    var body: some View {
        let editing = model.activeId != nil
        ScrollView {
            VStack(alignment: .leading, spacing: density == AppDensity.compact.rawValue ? Space.s2 : Space.s3) {
                PageChrome(model: model, onPickIcon: { showIconPicker = true })
                ArchivedBanner(pageId: model.pageId) { model.showToast($0, style: .success) }
                NoteEmoji(pageId: model.pageId) { showIconPicker = true }
                TextField("Unbenannt", text: Binding(get: { model.title }, set: { model.setTitle($0) }))
                    .font(.system(size: 34, weight: .bold))
                    .foregroundStyle(Impala.text)
                    .submitLabel(.next)
                    .onSubmit { model.focusFirst() }
                    .riseIn(0)
                BacklinksChip(pageId: model.pageId)
                // Datenbank-Seite: Unterseiten als Karten vor den Blöcken (render.js `dbViewHtml`).
                if isDbPage { DatabaseView(pageId: model.pageId) }
                blockList
                    .riseIn(1)
                ChildPagesList(pageId: model.pageId, blocks: model.blocks)
                RelatedPagesRow(pageId: model.pageId)
                // Tippen unter dem letzten Block schreibt weiter (wie der Klick unter die Blöcke in der PWA).
                Color.clear
                    .frame(height: 160)
                    .contentShape(Rectangle())
                    .onTapGesture { model.focusEnd() }
            }
            .padding(.horizontal, 48)
            .padding(.top, 40)
            .frame(maxWidth: 820, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
        .task(id: "\(model.pageId):\(store.pageMetaRevision)") {
            isDbPage = store.core.pageDb(id: model.pageId) != nil
        }
        // Bilder aus anderen Apps hineinziehen: hinter den aktiven Block bzw. ans Ende.
        .onDrop(of: [.image], isTargeted: nil) { providers in
            let after = model.activeId
            Task {
                let images = await Self.loadImages(providers)
                model.insertImages(images, after: after)
            }
            return true
        }
        .background(Impala.panel)
        .safeAreaInset(edge: .bottom) {
            if editing {
                VStack(spacing: Space.s2) {
                    if model.menu != nil {
                        EditorMenuPanel(model: model)
                            .transition(.scale(scale: 0.9, anchor: .bottom).combined(with: .opacity))
                    }
                    BlockBar(model: model)
                }
                .padding(.bottom, Space.s3)
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .overlay(alignment: .bottom) {
            if let toast = model.toast {
                Text(toast.text)
                    .font(.system(size: TextSize.base))
                    .foregroundStyle(Impala.text)
                    .padding(.horizontal, Space.s4).padding(.vertical, 10)
                    .impalaGlass()
                    .overlay {
                        // Wie die PWA: nur der Rand zeigt Erfolg (grün) oder Fehler (rot).
                        if toast.style != .info {
                            Capsule().stroke((toast.style == .error ? Impala.danger : Impala.success).opacity(0.55), lineWidth: 1)
                        }
                    }
                .padding(.bottom, editing ? 72 : 24)
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(reduceMotion ? nil : .spring(duration: 0.35, bounce: 0.2), value: editing)
        .animation(reduceMotion ? nil : .snappy(duration: 0.22), value: model.menu?.kind)
        .animation(reduceMotion ? nil : .snappy, value: model.toast)
        .environment(\.openURL, OpenURLAction { url in open(url) })
        .sheet(item: $rawBlock) { b in
            RawMarkdownSheet(text: model.rawOf(b)) { model.commitRaw(b.id, markdown: $0) }
        }
        .sheet(isPresented: $showIconPicker) {
            IconPickerSheet(pageId: model.pageId)
        }
        .alert("Link einfügen", isPresented: Binding(get: { model.linkPrompt != nil }, set: { if !$0 { model.finishLink(nil) } })) {
            TextField("Link-Adresse", text: $linkURL)
                .keyboardType(.URL)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            Button("Einfügen") {
                model.finishLink(linkURL)
                linkURL = ""
            }
            Button("Abbrechen", role: .cancel) {
                model.finishLink(nil)
                linkURL = ""
            }
        }
        .fileImporter(
            isPresented: Binding(get: { model.mediaRequest == .pdf || model.mediaRequest == .file },
                                 set: { if !$0 { model.finishMedia() } }),
            allowedContentTypes: model.mediaRequest == .pdf ? [.pdf] : [.item],
            allowsMultipleSelection: true
        ) { result in
            if case .success(let urls) = result { urls.forEach(importFile) }
        }
        .photosPicker(
            isPresented: Binding(get: { model.mediaRequest == .image }, set: { if !$0 && photos.isEmpty { model.finishMedia() } }),
            selection: $photos, matching: .images
        )
        .onChange(of: photos) { _, items in
            guard !items.isEmpty else { return }
            Task { await importPhotos(items) }
        }
    }

    // MARK: Blöcke mit Griff zum Ziehen

    private var blockList: some View {
        let numbers = listNumbers(model.blocks)
        return VStack(alignment: .leading, spacing: 2) {
            ForEach(Array(model.blocks.enumerated()), id: \.element.id) { i, b in
                BlockRow(block: b, number: numbers[b.id], first: i == 0, model: model)
                    .overlay(alignment: .topLeading) {
                        if dragId == b.id || (dragId == nil && (model.activeId == b.id || hovered == b.id)) {
                            blockGutter(b).offset(x: -48)
                        }
                    }
                    .onHover { inside in
                        if inside { hovered = b.id } else if hovered == b.id { hovered = nil }
                    }
                    .onGeometryChange(for: CGRect.self) { $0.frame(in: .named("blocks")) } action: { frames.rects[b.id] = $0 }
                    .offset(y: dragId == b.id ? dragOffset : 0)
                    .scaleEffect(dragId == b.id ? 1.01 : 1, anchor: .leading)
                    .shadow(color: .black.opacity(dragId == b.id ? 0.12 : 0), radius: 10, y: 4)
                    .zIndex(dragId == b.id ? 1 : 0)
                    .transition(.opacity.combined(with: .offset(y: -6)))
            }
        }
        .coordinateSpace(.named("blocks"))
        .animation(reduceMotion ? nil : .snappy(duration: 0.28), value: model.blocks.map(\.id))
        .sensoryFeedback(.impact(weight: .light), trigger: dragId) { old, new in old == nil && new != nil }
    }

    /// Griff links am Block: „+“ fügt darunter einen Absatz mit „/“ ein, „⋮⋮“ verschiebt oder öffnet das Menü.
    private func blockGutter(_ b: MdBlock) -> some View {
        HStack(spacing: 2) {
            if dragId == nil {
                Button {
                    model.insertSlashBelow(b.id)
                } label: {
                    Icon("plus", size: 14)
                        .foregroundStyle(Impala.text2)
                        .frame(width: 22, height: 26)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .hoverEffect(.highlight)
                .accessibilityLabel("Block darunter einfügen")
            }
            grip(b)
        }
    }

    /// Griff „⋮⋮“ links vom Block (wie in der PWA): Ziehen verschiebt, Halten zeigt das Blockmenü.
    private func grip(_ b: MdBlock) -> some View {
        Text("⋮⋮")
            .font(.system(size: TextSize.xs, weight: .bold))
            .foregroundStyle(Impala.text2)
            .frame(width: 22, height: 26)
            .contentShape(Rectangle())
            .hoverEffect(.highlight)
            .contextMenu { BlockMenuItems(block: b, model: model) { rawBlock = b } }
            .gesture(
                DragGesture(minimumDistance: 3, coordinateSpace: .named("blocks"))
                    .onChanged { v in
                        dragId = b.id
                        dragOffset = v.translation.height
                    }
                    .onEnded { v in drop(b.id, by: v.translation.height) }
            )
            .accessibilityLabel("Blockmenü")
    }

    /// Losgelassen: vor den ersten Block setzen, dessen Mitte unter der neuen Mitte liegt.
    private func drop(_ id: String, by dy: CGFloat) {
        let y = (frames.rects[id]?.midY ?? 0) + dy
        let target = model.blocks.firstIndex { $0.id != id && (frames.rects[$0.id]?.midY ?? 0) > y } ?? model.blocks.count
        withAnimation(reduceMotion ? nil : .spring(duration: 0.35, bounce: 0.2)) {
            model.move(id, to: target)
            dragId = nil
            dragOffset = 0
        }
    }

    // MARK: Links, Medien

    /// Seitenlinks (`#id`) und Wiki-Links öffnen die Seite im Tab; alles andere der Browser.
    private func open(_ url: URL) -> OpenURLAction.Result {
        guard url.scheme == "impala" else { return .systemAction }
        let rest = String(url.path(percentEncoded: false).dropFirst())
        switch url.host() {
        case "page": shell.open(rest)
        case "wiki":
            if let p = store.core.findPageByTitle(title: rest) { shell.open(p.id) } else { model.showToast("Seite nicht gefunden", style: .error) }
        default: break
        }
        return .handled
    }

    private func importFile(_ url: URL) {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        let mime = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
        guard let data = try? Data(contentsOf: url), model.addMedia(data, mime: mime, name: url.lastPathComponent) else {
            model.showToast("Datei konnte nicht gelesen werden.", style: .error)
            return
        }
    }

    /// Gezogene Bilder lesen: PNG und JPEG unverändert, alles andere (HEIC …) als JPEG.
    private static func loadImages(_ providers: [NSItemProvider]) async -> [(data: Data, mime: String)] {
        var out: [(data: Data, mime: String)] = []
        for p in providers {
            let png = p.hasItemConformingToTypeIdentifier(UTType.png.identifier)
            let jpeg = p.hasItemConformingToTypeIdentifier(UTType.jpeg.identifier)
            let type = png ? UTType.png : jpeg ? UTType.jpeg : UTType.image
            let data: Data? = await withCheckedContinuation { c in
                _ = p.loadDataRepresentation(forTypeIdentifier: type.identifier) { d, _ in c.resume(returning: d) }
            }
            guard let data else { continue }
            if png { out.append((data, "image/png")) }
            else if jpeg { out.append((data, "image/jpeg")) }
            else if let j = UIImage(data: data)?.jpegData(compressionQuality: 0.85) { out.append((j, "image/jpeg")) }
        }
        return out
    }

    private func importPhotos(_ items: [PhotosPickerItem]) async {
        for (i, item) in items.enumerated() {
            let type = item.supportedContentTypes.first { $0.conforms(to: .image) } ?? .jpeg
            let ext = type.preferredFilenameExtension ?? "jpg"
            guard let data = try? await item.loadTransferable(type: Data.self),
                  model.addMedia(data, mime: type.preferredMIMEType ?? "image/jpeg", name: items.count > 1 ? "Bild \(i + 1).\(ext)" : "Bild.\(ext)")
            else {
                model.showToast("Datei konnte nicht gelesen werden.", style: .error)
                continue
            }
        }
        photos = []
        model.finishMedia()
    }
}

/// „Diese Seite ist archiviert.“ mit „Wiederherstellen“ (render.js `.archived-banner`, PageFooter.kt).
private struct ArchivedBanner: View {
    @Environment(ImpalaStore.self) private var store
    let pageId: String
    let onToast: (String) -> Void
    @State private var isArchived = false

    var body: some View {
        Group {
            if isArchived {
                HStack(spacing: 8) {
                    Icon("archive", size: 16).foregroundStyle(Impala.text2)
                    Text("Diese Seite ist archiviert.")
                        .font(.system(size: TextSize.sm))
                        .foregroundStyle(Impala.text2)
                    Spacer()
                    Button {
                        attempt("unarchivePage", { try store.core.unarchivePage(id: pageId) })
                        onToast("Wiederhergestellt.")
                    } label: {
                        HStack(spacing: 4) {
                            Icon("undo", size: 13)
                            Text("Wiederherstellen")
                        }
                        .font(.system(size: TextSize.sm, weight: .medium))
                        .foregroundStyle(Impala.accent)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 4)
                        .background(Impala.activeTint, in: Capsule())
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, Space.s3)
                .padding(.vertical, 8)
                .background(Impala.surface, in: RoundedRectangle(cornerRadius: Radius.sm, style: .continuous))
            }
        }
        .task(id: "\(pageId):\(store.pageMetaRevision)") {
            let core = store.core
            let next = await Task.detached(priority: .userInitiated) { () -> Bool in
                core.page(id: pageId)?.archived == true
            }.value
            if !Task.isCancelled {
                isArchived = next
            }
        }
    }
}

/// Emoji-Icon der Notiz über dem Titel wie in render.js:696-699 (`.page-icon`).
private struct NoteEmoji: View {
    @Environment(ImpalaStore.self) private var store
    let pageId: String
    let onPick: () -> Void
    @State private var emoji: String?

    var body: some View {
        Group {
            if let emoji {
                Button(action: onPick) {
                    Text(emoji).font(.system(size: 52))
                }
                .buttonStyle(.plain)
                .hoverEffect(.highlight)
                .accessibilityLabel("Icon ändern: \(emoji)")
            } else {
                Button(action: onPick) {
                    HStack(spacing: Space.s1) {
                        Icon("smile", size: 14)
                        Text("Icon hinzufügen")
                            .font(.system(size: TextSize.xs, weight: .medium))
                    }
                    .foregroundStyle(Impala.text2.opacity(0.45))
                    .padding(.vertical, 2)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .hoverEffect(.highlight)
                .accessibilityLabel("Icon hinzufügen")
            }
        }
        .task(id: "\(pageId):\(store.pageMetaRevision)") {
            let core = store.core
            let next = await Task.detached(priority: .userInitiated) { () -> String? in
                guard let s = core.page(id: pageId)?.summary else { return nil }
                return PageStyle.emoji(s)
            }.value
            if !Task.isCancelled {
                emoji = next
            }
        }
    }
}

/// Icon-Auswahl für eine Seite (`openIconPicker` in render.js:1715-1723, `IconDialog` in PageDialogs.kt).
struct IconPickerSheet: View {
    let pageId: String
    @Environment(ImpalaStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    static let icons: [String] = [
        "📝", "📘", "📕", "📙", "📗", "🧪", "🧮", "⚡",
        "🧢", "📐", "🔬", "💡", "🎯", "📊", "🗂", "📎",
        "✅", "⭐", "🔥", "🎓", "🧠", "📚", "🛠", "🚀"
    ]

    private let columns = [GridItem(.adaptive(minimum: 52), spacing: Space.s2)]

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVGrid(columns: columns, spacing: Space.s2) {
                    ForEach(Self.icons, id: \.self) { emoji in
                        Button {
                            selectIcon(emoji)
                        } label: {
                            Text(emoji)
                                .font(.system(size: 28))
                                .frame(width: 52, height: 52)
                                .background(Impala.surface, in: RoundedRectangle(cornerRadius: Radius.sm, style: .continuous))
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .hoverEffect(.highlight)
                    }
                }
                .padding(Space.s4)
            }
            .background(Impala.panel)
            .navigationTitle("Icon wählen")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Schließen") { dismiss() }
                }
                ToolbarItem(placement: .destructiveAction) {
                    Button("Entfernen") {
                        selectIcon(nil)
                    }
                }
            }
        }
        .presentationDetents([.height(340), .medium])
    }

    private func selectIcon(_ icon: String?) {
        let patch: [String: Any?] = ["icon": icon]
        store.core.patchPage(pageId, patch)
        dismiss()
    }
}

/// Kopfzeile der Notiz wie in Android (`DeskPageActions.kt`) und PWA (`render.js:755-763`):
/// Brotkrumen (Arbeitsbereich / Eltern / Aktuelle Seite), Teilen, Favoriten-Stern und ⋯-Menü.
private struct PageChrome: View {
    @Environment(ImpalaStore.self) private var store
    @Environment(ShellModel.self) private var shell
    @AppStorage(AppTabsPosition.key) private var tabsPosition = AppTabsPosition.top.rawValue
    let model: NoteModel
    let onPickIcon: () -> Void
    @State private var shareItem: ShareItem?
    @State private var movingPage: PageSummary?
    @State private var summary: PageSummary?
    @State private var isArchived = false
    @State private var marks = 0
    @State private var isDb = false

    var body: some View {
        let isFavorite = summary?.favorite == true
        let currentTitle = model.title.isEmpty ? (summary?.title.isEmpty == false ? summary!.title : "") : model.title

        HStack(alignment: .center, spacing: Space.s2) {
            if tabsPosition == AppTabsPosition.sidebar.rawValue {
                HStack(spacing: Space.s1) {
                    Button { shell.toggleSidebar() } label: {
                        Icon("columns", size: 16)
                            .foregroundStyle(Impala.text2)
                            .frame(width: 30, height: 30)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .hoverEffect(.highlight)
                    .accessibilityLabel("Linke Spalte ein-/ausklappen")

                    Button { shell.goBack() } label: {
                        Icon("chevron-left", size: 15)
                            .foregroundStyle(shell.canGoBack ? Impala.text : Impala.text2.opacity(0.35))
                            .frame(width: 26, height: 26)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .disabled(!shell.canGoBack)
                    .hoverEffect(.highlight)
                    .contextMenu {
                        ForEach(shell.backHistoryItems()) { item in
                            MenuItem(item.title, icon: item.icon) { shell.jumpToHistory(item.index) }
                        }
                    }
                    .accessibilityLabel("Zurück")

                    Button { shell.goForward() } label: {
                        Icon("chevron-right", size: 15)
                            .foregroundStyle(shell.canGoForward ? Impala.text : Impala.text2.opacity(0.35))
                            .frame(width: 26, height: 26)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .disabled(!shell.canGoForward)
                    .hoverEffect(.highlight)
                    .contextMenu {
                        ForEach(shell.forwardHistoryItems()) { item in
                            MenuItem(item.title, icon: item.icon) { shell.jumpToHistory(item.index) }
                        }
                    }
                    .accessibilityLabel("Vor")
                }
                .padding(.trailing, 2)
            }

            ScrollView(.horizontal, showsIndicators: false) {
                Breadcrumbs(
                    pageId: model.pageId,
                    workspaceId: summary?.workspaceId,
                    currentTitle: currentTitle
                ) { shell.open($0) }
            }

            Spacer(minLength: Space.s2)

            HStack(spacing: 4) {
                // 1. Teilen-Menü wie `shareMenuHtml` in render.js:765-768
                Menu {
                    MenuItem("Als PDF exportieren / drucken", icon: "printer") {
                        exportPdf()
                    }
                    MenuItem("Als Markdown (.md) speichern", icon: "download") {
                        exportMarkdown()
                    }
                    MenuItem("Internen Link kopieren", icon: "link") {
                        copyLink()
                    }
                } label: {
                    HStack(spacing: 4) {
                        Icon("upload", size: 14)
                        Text("Teilen")
                            .font(.system(size: TextSize.sm, weight: .medium))
                    }
                    .foregroundStyle(Impala.text2)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 5)
                    .background(Impala.surface.opacity(0.6), in: RoundedRectangle(cornerRadius: Radius.sm, style: .continuous))
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .hoverEffect(.highlight)
                .accessibilityLabel("Exportieren & Teilen")

                // 2. Favoriten-Stern wie render.js:761
                Button(action: toggleFavorite) {
                    Icon("star", size: 15)
                        .foregroundStyle(isFavorite ? Impala.accent : Impala.text2)
                        .frame(width: 30, height: 30)
                        .background(isFavorite ? Impala.activeTint : Impala.surface.opacity(0.6), in: RoundedRectangle(cornerRadius: Radius.sm, style: .continuous))
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .hoverEffect(.highlight)
                .accessibilityLabel(isFavorite ? "Aus Favoriten entfernen" : "Zu Favoriten hinzufügen")

                // 3. ⋯-Aktionsmenü („Weitere Optionen“) wie `moreMenuHtml` in render.js:770-790
                Menu {
                    MenuItem("Rückgängig", icon: "undo") {
                        model.undo()
                    }
                    .disabled(!model.canUndo)

                    MenuItem("Wiederholen", icon: "redo") {
                        model.redo()
                    }
                    .disabled(!model.canRedo)

                    Divider()

                    MenuItem(isFavorite ? "Favorit entfernen" : "Zu Favoriten", icon: "star") {
                        toggleFavorite()
                    }

                    MenuItem("Als PDF exportieren / drucken", icon: "printer") {
                        exportPdf()
                    }

                    MenuItem("Als Markdown (.md) speichern", icon: "download") {
                        exportMarkdown()
                    }

                    MenuItem("Internen Link kopieren", icon: "link") {
                        copyLink()
                    }

                    Divider()

                    if let pdfId = summary?.pdfId {
                        MenuItem("PDF im neuen Tab öffnen", icon: "external") {
                            shell.openNewTab(model.pageId)
                        }
                        MenuItem("PDF herunterladen", icon: "download") {
                            downloadPdf(pdfId: pdfId)
                        }
                    }

                    MenuItem("Icon ändern", icon: "smile") {
                        onPickIcon()
                    }

                    if marks > 0 {
                        MenuItem("Karten aus Markierungen (\(marks))", icon: "cards") {
                            cardsFromHighlights()
                        }
                    }

                    MenuItem("Duplizieren", icon: "copy") {
                        duplicate()
                    }

                    let isTemplate = summary?.isTemplate == true
                    MenuItem(isTemplate ? "Vorlage entfernen" : "Als Vorlage", icon: "template") {
                        toggleTemplate()
                    }

                    MenuItem(isDb ? "Übersicht aufheben" : "Als Vorlesungsübersicht", icon: "grid") {
                        attempt("setPageDb", { try store.core.setPageDb(id: model.pageId, schema: isDb ? nil : lectureSchema) })
                    }

                    MenuItem("Verschieben nach…", icon: "folder-move") {
                        if let summary { movingPage = summary }
                    }

                    MenuItem(isArchived ? "Aus Archiv holen" : "Archivieren", icon: isArchived ? "undo" : "archive") {
                        toggleArchive(isArchived: isArchived)
                    }

                    Divider()

                    MenuItem("Löschen", icon: "trash", role: .destructive) {
                        trash()
                    }
                } label: {
                    Icon("dots", size: 16)
                        .foregroundStyle(Impala.text2)
                        .frame(width: 30, height: 30)
                        .background(Impala.surface.opacity(0.6), in: RoundedRectangle(cornerRadius: Radius.sm, style: .continuous))
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .hoverEffect(.highlight)
                .accessibilityLabel("Weitere Optionen")
            }
        }
        .padding(.vertical, 2)
        .sheet(item: $shareItem) { item in
            ShareSheet(items: item.items)
        }
        .sheet(item: $movingPage) { p in
            MovePageSheet(page: p)
        }
        .task(id: "\(model.pageId):\(store.pageMetaRevision):\(store.pagesRevision)") {
            let pageId = model.pageId
            let core = store.core
            let loaded = await Task.detached(priority: .userInitiated) { () -> (PageSummary?, Bool, Int, Bool) in
                guard let detail = core.page(id: pageId) else { return (nil, false, 0, false) }
                let marksCount = highlightCount(detail.content)
                return (detail.summary, detail.archived, marksCount, core.pageDb(id: pageId) != nil)
            }.value
            if !Task.isCancelled {
                summary = loaded.0
                isArchived = loaded.1
                marks = loaded.2
                isDb = loaded.3
            }
        }
    }

    private func toggleFavorite() {
        let isFavorite = summary?.favorite == true
        let haptic = UIImpactFeedbackGenerator(style: .medium)
        haptic.impactOccurred()
        store.core.setFavorite(id: model.pageId, favorite: !isFavorite)
    }

    private func toggleTemplate() {
        let isTemplate = summary?.isTemplate == true
        store.core.patchPage(model.pageId, ["isTemplate": !isTemplate])
    }

    private func exportPdf() {
        model.flush()
        let page = store.core.page(id: model.pageId)
        let title = model.title.trimmingCharacters(in: .whitespaces)
        let content = page?.content ?? blocksToMarkdown(blocks: model.blocks)
        let icon = summary?.icon ?? page?.summary.icon
        let heading = [icon, title].compactMap { $0?.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }.joined(separator: " ")
        let html = printableHtml(heading: heading.isEmpty ? "Unbenannt" : heading, content: content)
        if let url = renderPdfFile(title: title, html: html) {
            shareItem = ShareItem(items: [url])
        } else {
            model.showToast("PDF konnte nicht erstellt werden.", style: .error)
        }
    }

    private func exportMarkdown() {
        model.flush()
        let page = store.core.page(id: model.pageId)
        let title = model.title.trimmingCharacters(in: .whitespaces)
        let content = page?.content ?? blocksToMarkdown(blocks: model.blocks)
        let safeTitle = title.replacingOccurrences(of: #"[\\/:*?\"<>|#]"#, with: "_", options: .regularExpression)
            .trimmingCharacters(in: .whitespaces)
            .prefix(80)
        let fileName = (safeTitle.isEmpty ? "Seite" : String(safeTitle)) + ".md"
        let md = title.isEmpty ? content : "# \(title)\n\n\(content)"
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(fileName)
        do {
            try md.write(to: url, atomically: true, encoding: .utf8)
            shareItem = ShareItem(items: [url])
        } catch {
            model.showToast("Markdown-Datei konnte nicht erstellt werden.", style: .error)
        }
    }

    private func copyLink() {
        let link = "#\(model.pageId)"
        UIPasteboard.general.string = link
        let haptic = UIImpactFeedbackGenerator(style: .light)
        haptic.impactOccurred()
        model.showToast("Interner Link kopiert: \(link) — auf anderen Seiten als [Text](\(link)) einfügen.", style: .success)
    }

    private func downloadPdf(pdfId: String) {
        let core = store.core
        let title = model.title.trimmingCharacters(in: .whitespaces)
        let clean = title.replacingOccurrences(of: #"[\\/:*?"<>|]"#, with: "_", options: .regularExpression)
            .trimmingCharacters(in: .whitespaces)
        let fileName = (clean.isEmpty ? "Dokument" : clean) + ".pdf"
        Task {
            let url = await Task.detached { () -> URL? in
                guard let file = attempt("file", { try core.file(id: pdfId) }) ?? nil else { return nil }
                let tmp = FileManager.default.temporaryDirectory.appendingPathComponent(fileName)
                return (try? file.bytes.write(to: tmp)) != nil ? tmp : nil
            }.value
            if let url {
                shareItem = ShareItem(items: [url])
            } else {
                model.showToast("PDF konnte nicht geladen werden.", style: .error)
            }
        }
    }

    private func cardsFromHighlights() {
        model.flush()
        do {
            let count = try store.core.cardsFromHighlights(pageId: model.pageId, deck: nil)
            if count > 0 {
                model.showToast("\(count) Karteikarte(n) erstellt.", style: .success)
            } else {
                model.showToast("Keine neuen Markierungen — für alle gibt es schon Karten.")
            }
        } catch {
            model.showToast("Karten konnten nicht erstellt werden.", style: .error)
        }
    }

    private func duplicate() {
        model.flush()
        if let newId = store.core.duplicatePage(id: model.pageId) {
            shell.open(newId)
            model.showToast("Seite dupliziert.", style: .success)
        }
    }

    private func toggleArchive(isArchived: Bool) {
        model.flush()
        if isArchived {
            attempt("unarchivePage", { try store.core.unarchivePage(id: model.pageId) })
            model.showToast("Wiederhergestellt.", style: .success)
        } else {
            attempt("archivePage", { try store.core.archivePage(id: model.pageId) })
            model.showToast("Seite archiviert.", style: .success)
        }
    }

    private func trash() {
        model.flush()
        attempt("trashPage", { try store.core.trashPage(id: model.pageId) })
        shell.close(model.pageId)
    }
}

/// Brotkrumen über dem Titel (`.page-chrome` / `.crumbs`): Arbeitsbereich / Eltern / Aktuelle Seite.
private struct Breadcrumbs: View {
    @Environment(ImpalaStore.self) private var store
    @Environment(ShellModel.self) private var shell
    let pageId: String
    let workspaceId: String?
    let currentTitle: String
    let open: (String) -> Void

    var body: some View {
        let wsName = store.core.workspaces().first(where: { $0.id == workspaceId })?.name ?? "Privat"
        let ancestors = store.core.ancestorsOf(id: pageId)

        HStack(spacing: Space.s1) {
            // Arbeitsbereich: öffnet die Startseite (app.js `data-crumbws` → `openHomeOverview`).
            Button { shell.goHome() } label: {
                Text(wsName)
                    .font(.system(size: TextSize.sm))
                    .foregroundStyle(Impala.text2)
                    .lineLimit(1)
            }
            .buttonStyle(.plain)

            sep

            // Elternseiten
            if ancestors.count > 2 {
                if let first = ancestors.first {
                    crumbButton(first)
                    sep
                    Text("…")
                        .font(.system(size: TextSize.sm))
                        .foregroundStyle(Impala.text2.opacity(0.6))
                    sep
                }
                if let last = ancestors.last {
                    crumbButton(last)
                    sep
                }
            } else {
                ForEach(ancestors, id: \.id) { a in
                    crumbButton(a)
                    sep
                }
            }

            // Aktuelle Seite
            Text(currentTitle.isEmpty ? "Unbenannt" : currentTitle)
                .font(.system(size: TextSize.sm, weight: .semibold))
                .foregroundStyle(Impala.text)
                .lineLimit(1)
        }
        .padding(.vertical, 4)
    }

    private var sep: some View {
        Text("/")
            .font(.system(size: TextSize.sm))
            .foregroundStyle(Impala.text2.opacity(0.4))
            .padding(.horizontal, 2)
    }

    private func crumbButton(_ p: PageSummary) -> some View {
        Button {
            open(p.id)
        } label: {
            HStack(spacing: 4) {
                PageIcon(page: p, size: 12)
                Text(PageStyle.title(p))
                    .lineLimit(1)
            }
            .font(.system(size: TextSize.sm))
            .foregroundStyle(Impala.text2)
        }
        .buttonStyle(.plain)
        .hoverEffect(.highlight)
    }
}

/// Schwebende Block-Leiste (Werkzeugleiste der Android-App): Verlauf, Inline-Formate, Blocktyp, Einzug,
/// Löschen, Fertig. Die Markierung des aktuellen Typs gleitet beim Umwandeln. Wird es zu eng
/// (Split View), wandern Formate und Typen in Menüs.
private struct BlockBar: View {
    let model: NoteModel
    @Namespace private var ns

    var body: some View {
        ViewThatFits(in: .horizontal) {
            bar(compact: false)
            bar(compact: true)
        }
        .padding(.horizontal, Space.s3)
        .sensoryFeedback(.selection, trigger: model.activeBlock?.type)
    }

    private func bar(compact: Bool) -> some View {
        let block = model.activeBlock
        let current = block?.type
        let isList = [BlockType.bullet, .number, .todo].contains { $0 == current }
        let inline = block.map { $0.isText && !$0.isCode } ?? false
        return HStack(spacing: 2) {
            BarIcon(icon: "undo", label: "Rückgängig", enabled: model.canUndo) { model.undo() }
            BarIcon(icon: "redo", label: "Wiederholen", enabled: model.canRedo) { model.redo() }
            separator
            if compact {
                Menu {
                    ForEach(InlineFormat.allCases, id: \.self) { f in Button(f.label) { model.format(f) } }
                    Button("Link einfügen") { model.askLink() }
                } label: { glyph("Aa", active: false) }
                .disabled(!inline)
                Menu {
                    ForEach(BlockType.allCases, id: \.self) { t in Button(t.label) { model.convert(t) } }
                } label: { glyph(current?.glyph ?? "T", active: true) }
                .disabled(current == nil)
            } else {
                formatButton(.bold, Text("B").bold(), enabled: inline)
                formatButton(.italic, Text("I").italic(), enabled: inline)
                formatButton(.underline, Text("U").underline(), enabled: inline)
                formatButton(.strike, Text("S").strikethrough(), enabled: inline)
                formatButton(.code, Text("`").monospaced(), enabled: inline)
                BarIcon(icon: "marker", label: InlineFormat.highlight.label, enabled: inline) { model.format(.highlight) }
                BarIcon(icon: "link", label: "Link einfügen", enabled: inline) { model.askLink() }
                separator
                ForEach(BlockType.allCases, id: \.self) { t in
                    Button {
                        withAnimation(.snappy(duration: 0.25)) { model.convert(t) }
                    } label: {
                        glyph(t.glyph, active: current == t, mono: t == .code)
                    }
                    .buttonStyle(.plain)
                    .disabled(current == nil)
                    .accessibilityLabel(t.label)
                }
            }
            separator
            BarIcon(icon: "chevron-left", label: "Ausrücken", enabled: isList) { model.indent(-1) }
            BarIcon(icon: "chevron-right", label: "Einrücken", enabled: isList) { model.indent(1) }
            BarIcon(icon: "trash", label: "Block löschen", tint: Impala.danger) { model.deleteActive() }
            separator
            BarIcon(icon: "check", label: "Fertig") { model.endEditing() }
        }
        .padding(.horizontal, Space.s2)
        .padding(.vertical, 6)
        .impalaGlass(interactive: true)
        .fixedSize()
    }

    private func glyph(_ s: String, active: Bool, mono: Bool = false) -> some View {
        Text(s)
            .font(.system(size: TextSize.base, weight: .semibold, design: mono ? .monospaced : .default))
            .foregroundStyle(active ? Impala.accent : Impala.text)
            .frame(minWidth: 34, minHeight: 34)
            .background {
                if active { Capsule().fill(Impala.activeTint).matchedGeometryEffect(id: "type", in: ns) }
            }
            .contentShape(Capsule())
    }

    private func formatButton(_ f: InlineFormat, _ label: Text, enabled: Bool) -> some View {
        Button { model.format(f) } label: {
            label.font(.system(size: TextSize.md)).foregroundStyle(Impala.text)
                .frame(width: 30, height: 34).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.35)
        .accessibilityLabel(f.label)
    }

    private var separator: some View {
        Rectangle().fill(Impala.edge).frame(width: 1, height: 20).padding(.horizontal, Space.s1)
    }
}

private struct BarIcon: View {
    let icon: String
    let label: String
    var enabled = true
    var tint: Color = Impala.text
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Icon(icon, size: 16)
                .foregroundStyle(tint)
                .frame(width: 34, height: 34)
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.35)
        .accessibilityLabel(label)
    }
}

private struct ShareItem: Identifiable, @unchecked Sendable {
    let id = UUID()
    let items: [Any]
}

/// Druckbares HTML mit Absätzen (wie PageOps.kt in Android).
private func printableHtml(heading: String, content: String) -> String {
    func esc(_ s: String) -> String {
        s.replacingOccurrences(of: "&", with: "&amp;")
         .replacingOccurrences(of: "<", with: "&lt;")
         .replacingOccurrences(of: ">", with: "&gt;")
    }
    let paragraphs = content.components(separatedBy: "\n\n")
        .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        .filter { !$0.isEmpty }
        .map { "<p>\(esc($0).replacingOccurrences(of: "\n", with: "<br>"))</p>" }
        .joined()
    return "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><style>" +
        "body{font:15px/1.6 -apple-system,BlinkMacSystemFont,sans-serif;color:#111;margin:24px}p{margin:0 0 12px}h1{margin:0 0 16px;font-size:24px}" +
        "</style></head><body><h1>\(esc(heading))</h1>\(paragraphs)</body></html>"
}

/// PDF aus druckbarem HTML rendern (DIN A4).
@MainActor
private func renderPdfFile(title: String, html: String) -> URL? {
    let printFormatter = UIMarkupTextPrintFormatter(markupText: html)
    let renderer = UIPrintPageRenderer()
    renderer.addPrintFormatter(printFormatter, startingAtPageAt: 0)
    let paperRect = CGRect(x: 0, y: 0, width: 595.2, height: 841.8)
    let printableRect = paperRect.insetBy(dx: 36, dy: 36)
    renderer.setValue(paperRect, forKey: "paperRect")
    renderer.setValue(printableRect, forKey: "printableRect")
    let pdfData = NSMutableData()
    UIGraphicsBeginPDFContextToData(pdfData, paperRect, nil)
    for i in 0..<renderer.numberOfPages {
        UIGraphicsBeginPDFPage()
        renderer.drawPage(at: i, in: UIGraphicsGetPDFContextBounds())
    }
    UIGraphicsEndPDFContext()
    let safeTitle = title.replacingOccurrences(of: #"[\\/:*?\"<>|#]"#, with: "_", options: .regularExpression)
        .trimmingCharacters(in: .whitespaces)
        .prefix(80)
    let fileName = (safeTitle.isEmpty ? "Dokument" : String(safeTitle)) + ".pdf"
    let url = FileManager.default.temporaryDirectory.appendingPathComponent(fileName)
    do {
        try (pdfData as Data).write(to: url, options: .atomic)
        return url
    } catch {
        return nil
    }
}

/// Zahl für „Karten aus Markierungen (n)“ wie `moreMenuHtml` und `highlightCount` in DeskPageActions.kt:
/// `==…==` und `{{cN::`.
private func highlightCount(_ content: String) -> Int {
    let hl = (try? NSRegularExpression(pattern: #"==[^=\n]+=="#))?.numberOfMatches(in: content, range: NSRange(content.startIndex..., in: content)) ?? 0
    let cloze = (try? NSRegularExpression(pattern: #"\{\{c\d+::"#))?.numberOfMatches(in: content, range: NSRange(content.startIndex..., in: content)) ?? 0
    return hl + cloze
}
