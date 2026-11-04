import PhotosUI
import SwiftUI
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
        .onChange(of: store.lastRemote) {
            if store.remoteTouches(pageId) { model?.applyRemote() }
        }
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
    @AppStorage(AppDensity.key) private var density = AppDensity.compact.rawValue

    var body: some View {
        let editing = model.activeId != nil
        ScrollView {
            VStack(alignment: .leading, spacing: density == AppDensity.compact.rawValue ? Space.s2 : Space.s3) {
                ArchivedBanner(pageId: model.pageId) { model.showToast($0) }
                NoteHeader(pageId: model.pageId)
                TextField("Ohne Titel", text: Binding(get: { model.title }, set: { model.setTitle($0) }), axis: .vertical)
                    .font(.system(size: 34, weight: .bold))
                    .foregroundStyle(Impala.text)
                    .riseIn(0)
                BacklinksChip(pageId: model.pageId)
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
                Text(toast)
                    .font(.system(size: TextSize.base))
                    .foregroundStyle(Impala.text)
                    .padding(.horizontal, Space.s4).padding(.vertical, 10)
                    .impalaGlass()
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
                            grip(b).offset(x: -34)
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

    /// Griff „⋮⋮“ links vom Block (wie in der PWA): Ziehen verschiebt, Halten zeigt das Blockmenü.
    private func grip(_ b: MdBlock) -> some View {
        Text("⋮⋮")
            .font(.system(size: TextSize.xs, weight: .bold))
            .foregroundStyle(Impala.text2)
            .frame(width: 28, height: 28)
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
            if let p = store.core.findPageByTitle(title: rest) { shell.open(p.id) } else { model.showToast("Seite nicht gefunden") }
        default: break
        }
        return .handled
    }

    private func importFile(_ url: URL) {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        let mime = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
        guard let data = try? Data(contentsOf: url), model.addMedia(data, mime: mime, name: url.lastPathComponent) else {
            model.showToast("Datei konnte nicht gelesen werden.")
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
                model.showToast("Datei konnte nicht gelesen werden.")
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

    var body: some View {
        let _ = store.pagesRevision
        if store.core.page(id: pageId)?.archived == true {
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
}

/// Brotkrumen und Emoji; liest nur bei Änderungen am Seitenbaum neu, nicht bei jedem Tastendruck.
private struct NoteHeader: View {
    @Environment(ImpalaStore.self) private var store
    @Environment(ShellModel.self) private var shell
    let pageId: String

    var body: some View {
        let _ = store.pagesRevision
        let ancestors = store.core.ancestorsOf(id: pageId)
        if !ancestors.isEmpty { Breadcrumbs(pages: ancestors) { shell.open($0) } }
        if let summary = store.core.page(id: pageId)?.summary, let emoji = PageStyle.emoji(summary) {
            Text(emoji).font(.system(size: 52))
        }
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

/// Brotkrumen über dem Titel (`.crumbs`): Elternkette, antippen öffnet.
private struct Breadcrumbs: View {
    let pages: [PageSummary]
    let open: (String) -> Void

    var body: some View {
        HStack(spacing: Space.s1) {
            ForEach(Array(pages.enumerated()), id: \.element.id) { i, p in
                if i > 0 { Icon("chevron-right", size: 10).foregroundStyle(Impala.text2) }
                Button { open(p.id) } label: {
                    HStack(spacing: 4) {
                        PageIcon(page: p, size: 12)
                        Text(PageStyle.title(p)).lineLimit(1)
                    }
                    .font(.system(size: TextSize.sm))
                    .foregroundStyle(Impala.text2)
                }
                .buttonStyle(.plain)
            }
        }
    }
}
