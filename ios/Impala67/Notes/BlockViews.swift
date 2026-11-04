import QuickLook
import SwiftUI
import UIKit

/// Ein Block, wie ihn die PWA zeigt (editor.css). Textblöcke und Formeln werden beim Antippen zum
/// Eingabefeld, Tabellen zum Raster aus Zellen; alles andere lässt sich über Halten → „Als Markdown
/// bearbeiten“ ändern – auch in Callout, Toggle und Spalten. Nur in reinen Anzeigen
/// (`NoteModel.isReadOnly`: Lernkarten, Chat) bleibt alles außer Checkboxen und Toggles stehen.
struct BlockRow: View {
    let block: MdBlock
    let number: Int?
    let first: Bool
    let model: NoteModel
    @State private var raw: String?

    private var editing: Bool { model.activeId == block.id }

    var body: some View {
        content
            .frame(maxWidth: .infinity, alignment: .leading)
            .background {
                if let bg = block.bgColor {
                    RoundedRectangle(cornerRadius: Radius.xs).fill(noteColor(bg).opacity(0.28))
                }
            }
            .blockMenu(!model.isReadOnly && !editing, block: block, model: model) { raw = model.rawOf(block) }
            .sheet(isPresented: Binding(get: { raw != nil }, set: { if !$0 { raw = nil } })) {
                RawMarkdownSheet(text: raw ?? "") { model.commitRaw(block.id, markdown: $0) }
            }
    }

    @ViewBuilder private var content: some View {
        switch block.kind {
        case .paragraph:
            BlockText(block: block, editing: editing, model: model)
                .padding(.vertical, 3).padding(.horizontal, 2)
        case .heading(let level, _):
            BlockText(block: block, editing: editing, model: model)
                .padding(.top, first ? 0 : level.topSpace).padding(.bottom, 2).padding(.horizontal, 2)
        case .listItem(let style, let indent, _):
            HStack(alignment: .top, spacing: 0) {
                ListMarker(style: style, number: number) { model.toggleTodo(block.id) }
                BlockText(block: block, editing: editing, model: model)
                    .padding(.vertical, 3).padding(.horizontal, 2)
            }
            .padding(.leading, CGFloat(indent) * 24)
        case .quote:
            BlockText(block: block, editing: editing, model: model)
                .padding(.leading, 14).padding(.vertical, 2)
                .overlay(alignment: .leading) { Rectangle().fill(Impala.text).frame(width: 3) }
                .padding(.leading, 3)
        case .code(let language, let text):
            CodeBlockView(block: block, language: language, text: text, editing: editing, model: model)
        case .math(let text):
            MathBlockView(block: block, text: text, editing: editing, model: model)
        case .table(let rows):
            if editing {
                TableEditor(rows: rows) { model.setTable(block.id, $0) }
            } else {
                TableBlock(rows: rows)
                    .contentShape(Rectangle())
                    .onTapGesture { if !model.isReadOnly { model.activate(block.id, at: nil) } }
            }
        case .divider:
            Rectangle().fill(Impala.edge).frame(height: 1).padding(.vertical, 13)
        default:
            ComplexBlockView(block: block, model: model)
        }
    }
}

private extension MdHeadingLevel {
    /// Abstand über Überschriften (nicht beim ersten Block).
    var topSpace: CGFloat {
        switch self {
        case .h1: 22
        case .h2: 16
        case .h3: 10
        }
    }
}

private let blockColors = ["gray", "red", "orange", "yellow", "green", "blue", "purple", "pink"]

/// Farbnamen wie im Farbmenü der PWA.
private func colorLabel(_ name: String) -> String {
    switch name {
    case "gray": "Grau"
    case "red": "Rot"
    case "orange": "Orange"
    case "yellow": "Gelb"
    case "green": "Grün"
    case "blue": "Blau"
    case "purple": "Lila"
    default: "Pink"
    }
}

extension View {
    /// Blockmenü (editor-menus.js `openBlockMenu`) als Kontextmenü (Halten); nicht am aktiven Feld, dort
    /// gehört Halten der Textauswahl. Der Griff neben dem aktiven Block zeigt dasselbe Menü.
    @ViewBuilder func blockMenu(_ on: Bool, block: MdBlock, model: NoteModel, editRaw: @escaping () -> Void) -> some View {
        if on {
            contextMenu { BlockMenuItems(block: block, model: model, editRaw: editRaw) }
        } else {
            self
        }
    }
}

struct BlockMenuItems: View {
    let block: MdBlock
    let model: NoteModel
    let editRaw: () -> Void

    var body: some View {
        let id = block.id
        Menu {
            ForEach(TurnInto.allCases, id: \.self) { t in
                Button(t.label) { model.turnInto(id, t) }
            }
        } label: { Label { Text("Umwandeln in") } icon: { Icon("rotate") } }
        Menu {
            Section("Text") {
                ForEach(blockColors, id: \.self) { n in Button(colorLabel(n)) { model.setColor(id, n, background: false) } }
            }
            Section("Hintergrund") {
                ForEach(blockColors, id: \.self) { n in Button(colorLabel(n)) { model.setColor(id, n, background: true) } }
            }
            Button("Farbe entfernen") { model.setColor(id, nil, background: false) }
        } label: { Label { Text("Farbe") } icon: { Icon("palette") } }
        Divider()
        Button { model.duplicate(id) } label: { Label { Text("Duplizieren") } icon: { Icon("copy") } }
        Button {
            UIPasteboard.general.string = model.rawOf(block).trimmingCharacters(in: .newlines)
            model.showToast("Als Markdown kopiert")
        } label: { Label { Text("Als Markdown kopieren") } icon: { Icon("file") } }
        Button(action: editRaw) { Label { Text("Als Markdown bearbeiten") } icon: { Icon("pen") } }
        Button { model.moveBlock(id, -1) } label: { Label { Text("Nach oben") } icon: { Icon("arrow-up") } }
        Button { model.moveBlock(id, 1) } label: { Label { Text("Nach unten") } icon: { Icon("arrow-down") } }
        if block.isText {
            Button {
                model.showToast(model.cardFromBlock(id) ? "Lernkarte erstellt — Rückseite in Anki ergänzen" : "Lernkarte konnte nicht erstellt werden")
            } label: { Label { Text("Lernkarte erstellen") } icon: { Icon("cards") } }
        }
        Divider()
        Button(role: .destructive) { model.delete(id) } label: { Label { Text("Löschen") } icon: { Icon("trash") } }
    }
}

/// Text eines Blocks: angezeigt mit Inline-Markdown (mit Formeln über KaTeX), aktiv als Eingabefeld.
private struct BlockText: View {
    let block: MdBlock
    let editing: Bool
    let model: NoteModel

    var body: some View {
        let font = BlockFont.of(block)
        let color = block.textColor.map(noteColor) ?? Impala.text
        if editing {
            BlockInput(block: block, color: color, model: model)
        } else if !block.isCode, hasInlineMath(block.text) {
            RichBlock(kind: .inline(size: font.size, weight: font.weight == .regular ? 400 : 600,
                                    lineHeight: font.size + font.lineSpacing + 3),
                      source: inlineHTML(block.text))
                .opacity(block.isChecked ? 0.6 : 1)
                .contentShape(Rectangle())
                .onTapGesture { if !model.isReadOnly { model.activate(block.id, at: nil) } }
        } else {
            Group {
                if block.text.isEmpty {
                    Text(block.placeholder.isEmpty ? " " : block.placeholder)
                        .foregroundStyle(Impala.text2.opacity(0.45))
                } else {
                    Text(inlineMarkdown(block.text))
                        .foregroundStyle(block.isChecked ? Impala.text2 : color)
                        .strikethrough(block.isChecked, color: Impala.text2)
                }
            }
            .font(font.font)
            .kerning(font.kern)
            .lineSpacing(font.lineSpacing)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
            // Gleichzeitig, damit Links im Text antippbar bleiben.
            .simultaneousGesture(TapGesture().onEnded { if !model.isReadOnly { model.activate(block.id, at: nil) } })
        }
    }
}

/// Eingabefeld eines Blocks, verbunden mit dem Modell.
private struct BlockInput: View {
    let block: MdBlock
    let color: Color
    let model: NoteModel

    var body: some View {
        let id = block.id
        BlockTextView(
            text: block.text, font: BlockFont.of(block), color: UIColor(color), raw: block.keepsNewlines,
            focusToken: model.focusToken, cursor: model.cursor,
            onChange: { model.edit(id, text: $0, caret: $1) },
            onSelection: { model.selection = $0 },
            onBackspaceAtStart: { model.backspaceAtStart(id) },
            onBlur: { model.blurred(id, token: $0) },
            wants: { model.wants($0, id: id, text: $1) },
            onKey: { model.handle($0, id: id) },
            onPasteImages: { model.insertImages($0, after: id) }
        )
    }
}

/// Punkt, Nummer oder Checkbox vor einem Listenpunkt.
private struct ListMarker: View {
    let style: MdListStyle
    let number: Int?
    let toggle: () -> Void

    var body: some View {
        switch style {
        case .bullet:
            Text("•").font(.system(size: 16)).foregroundStyle(Impala.text)
                .frame(width: 24, height: 31)
        case .number:
            Text("\(number ?? 1).").font(.system(size: 15)).monospacedDigit().foregroundStyle(Impala.text)
                .frame(width: 26, height: 31, alignment: .trailing)
                .padding(.trailing, 2)
        case .todo(let checked):
            Button(action: toggle) {
                Icon(checked ? "check-square" : "square", size: 18)
                    .foregroundStyle(checked ? Impala.accent : Impala.text2)
                    .scaleEffect(checked ? 1 : 0.94)
                    .animation(.spring(duration: 0.3, bounce: 0.45), value: checked)
                    .frame(width: 28, height: 31)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(checked ? "Erledigt" : "Offen")
            .sensoryFeedback(.selection, trigger: checked)
        }
    }
}

/// Codeblock mit Sprache und Kopier-Knopf (app.js: Haken für einen Moment nach dem Kopieren).
/// Mermaid und SVG zeigen die Grafik; beim Bearbeiten Code mit Live-Vorschau darunter (350 ms).
private struct CodeBlockView: View {
    let block: MdBlock
    let language: String
    let text: String
    let editing: Bool
    let model: NoteModel
    @State private var copied = false

    var body: some View {
        let diagram = diagramKind(language)
        if let diagram, !editing {
            RichBlock(kind: diagram, source: text)
                .padding(.vertical, Space.s1)
                .contentShape(Rectangle())
                .onTapGesture { if !model.isReadOnly { model.activate(block.id, at: nil) } }
        } else {
            panel(diagram)
        }
    }

    private func panel(_ diagram: RichKind?) -> some View {
        let font = BlockFont.of(block)
        return VStack(alignment: .leading, spacing: Space.s1) {
            if !language.isEmpty || !editing {
                HStack {
                    Text(language).font(.system(size: TextSize.xs)).foregroundStyle(Impala.text2)
                    Spacer()
                    if !editing {
                        Button {
                            UIPasteboard.general.string = text
                            withAnimation(.snappy) { copied = true }
                            model.showToast("Code kopiert.")
                        } label: {
                            Icon(copied ? "check" : "copy", size: 14).foregroundStyle(Impala.text2)
                                .contentTransition(.opacity)
                                .frame(width: 26, height: 22)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Code kopieren")
                        .sensoryFeedback(.success, trigger: copied) { _, now in now }
                    }
                }
            }
            if editing {
                BlockInput(block: block, color: Impala.text, model: model)
                if let diagram {
                    RichBlock(kind: diagram, source: text, debounce: .milliseconds(350)).padding(.top, Space.s2)
                }
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    Text(text.isEmpty ? " " : text)
                        .font(font.font).lineSpacing(font.lineSpacing).foregroundStyle(Impala.text)
                        .fixedSize()
                }
                .contentShape(Rectangle())
                .onTapGesture { if !model.isReadOnly { model.activate(block.id, at: nil) } }
            }
        }
        .padding(.horizontal, Space.s4).padding(.vertical, 10)
        .background(Impala.surface, in: RoundedRectangle(cornerRadius: Radius.sm))
        .overlay(RoundedRectangle(cornerRadius: Radius.sm).strokeBorder(Impala.edgeSoft))
        .padding(.vertical, Space.s1)
        .task(id: copied) {
            guard copied else { return }
            try? await Task.sleep(for: .seconds(1.5))
            withAnimation(.snappy) { copied = false }
        }
    }
}

/// Formelblock: gesetzt mit KaTeX; beim Bearbeiten TeX mit Live-Vorschau.
private struct MathBlockView: View {
    let block: MdBlock
    let text: String
    let editing: Bool
    let model: NoteModel

    var body: some View {
        if editing {
            VStack(alignment: .leading, spacing: Space.s2) {
                Text("TeX").font(.system(size: TextSize.xs)).foregroundStyle(Impala.text2)
                BlockInput(block: block, color: Impala.text, model: model)
                RichBlock(kind: .math, source: text, debounce: .milliseconds(350))
            }
            .padding(.horizontal, Space.s4).padding(.vertical, 10)
            .background(Impala.surface, in: RoundedRectangle(cornerRadius: Radius.sm))
            .overlay(RoundedRectangle(cornerRadius: Radius.sm).strokeBorder(Impala.edgeSoft))
            .padding(.vertical, Space.s1)
        } else {
            RichBlock(kind: .math, source: text)
                .padding(.vertical, Space.s1)
                .contentShape(Rectangle())
                .onTapGesture { if !model.isReadOnly { model.activate(block.id, at: nil) } }
        }
    }
}

/// Blöcke ohne direkt tippbaren Text: Bild, Heft, Datei, Formel, Tabelle, Callout, Toggle, Spalten.
private struct ComplexBlockView: View {
    let block: MdBlock
    let model: NoteModel
    @Environment(ShellModel.self) private var shell

    var body: some View {
        switch block.kind {
        case .image(let alt, let src):
            NoteImage(alt: alt, src: src)
        case .heft(let heftId):
            LinkCard(icon: "notebook", label: "Heft") { shell.open(heftId) }
        case .file(let src, let name):
            FileCard(src: src, name: name)
        case .callout(let color, let children):
            let tone = noteColor(color)
            HStack(alignment: .top, spacing: 10) {
                Circle().fill(tone).frame(width: 18, height: 18).padding(.top, 3)
                NestedBlocks(blocks: children, model: model)
            }
            .padding(14)
            .background(tone.opacity(0.14), in: RoundedRectangle(cornerRadius: Radius.sm))
            .overlay(RoundedRectangle(cornerRadius: Radius.sm).strokeBorder(Impala.edgeSoft))
            .padding(.vertical, Space.s1)
        case .toggle(let summary, let isOpen, let children):
            ToggleBlock(id: block.id, summary: summary, isOpen: isOpen, children: children, model: model)
        case .columns(let columns):
            HStack(alignment: .top, spacing: Space.s6) {
                ForEach(columns.indices, id: \.self) { i in
                    NestedBlocks(blocks: columns[i], model: model)
                }
            }
        case .other(_, let text):
            Text(inlineMarkdown(text)).font(.system(size: 16)).lineSpacing(6).foregroundStyle(Impala.text)
                .padding(.vertical, 3).padding(.horizontal, 2)
        default:
            EmptyView()
        }
    }
}

/// Kind-Blöcke in Callout, Toggle und Spalten.
private struct NestedBlocks: View {
    let blocks: [MdBlock]
    let model: NoteModel

    var body: some View {
        let numbers = listNumbers(blocks)
        VStack(alignment: .leading, spacing: 2) {
            ForEach(Array(blocks.enumerated()), id: \.element.id) { i, b in
                BlockRow(block: b, number: numbers[b.id], first: i == 0, model: model)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Aufklappbarer Block (`<details>`); der Zustand wird in der Seite gespeichert.
private struct ToggleBlock: View {
    let id: String
    let summary: String
    let isOpen: Bool
    let children: [MdBlock]
    let model: NoteModel

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Button {
                withAnimation(.spring(duration: 0.35, bounce: 0.15)) { model.toggleOpen(id) }
            } label: {
                HStack(alignment: .top, spacing: 0) {
                    Icon("chevron-right", size: 14).foregroundStyle(Impala.text2)
                        .rotationEffect(.degrees(isOpen ? 90 : 0))
                        .frame(width: 24, height: 25)
                    Text(inlineMarkdown(summary)).font(.system(size: 16)).lineSpacing(6).foregroundStyle(Impala.text)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .padding(.vertical, 3)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(isOpen ? "Zuklappen" : "Aufklappen")
            if isOpen {
                NestedBlocks(blocks: children, model: model)
                    .padding(.leading, 24)
                    .transition(.opacity.combined(with: .offset(y: -6)))
            }
        }
    }
}

private struct TableBlock: View {
    let rows: [[String]]

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            Grid(alignment: .topLeading, horizontalSpacing: 0, verticalSpacing: 0) {
                ForEach(rows.indices, id: \.self) { r in
                    GridRow {
                        ForEach(rows[r].indices, id: \.self) { c in
                            Text(inlineMarkdown(cellText(rows[r][c])))
                                .font(.system(size: TextSize.base, weight: r == 0 ? .semibold : .regular))
                                .foregroundStyle(Impala.text)
                                .padding(.horizontal, 10).padding(.vertical, 7)
                                .frame(minWidth: 80, alignment: .leading)
                                .background(r == 0 ? Impala.surface : Color.clear)
                                .border(Impala.edgeSoft, width: 0.5)
                        }
                    }
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: Radius.xs))
            .overlay(RoundedRectangle(cornerRadius: Radius.xs).strokeBorder(Impala.edgeSoft))
        }
        .padding(.vertical, Space.s1)
    }

    private func cellText(_ s: String) -> String {
        s.replacingOccurrences(of: "<br\\s*/?>", with: "\n", options: [.regularExpression, .caseInsensitive])
    }
}

/// Bild aus dem Kern (`img:…`) oder aus dem Netz.
private struct NoteImage: View {
    let alt: String
    let src: String
    @Environment(ImpalaStore.self) private var store
    @State private var image: UIImage?

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image).resizable().scaledToFit()
                    .frame(maxWidth: image.size.width)
                    .clipShape(RoundedRectangle(cornerRadius: Radius.md))
                    .accessibilityLabel(alt)
            } else if src.hasPrefix("http"), let url = URL(string: src) {
                AsyncImage(url: url) { img in
                    img.resizable().scaledToFit().clipShape(RoundedRectangle(cornerRadius: Radius.md))
                } placeholder: {
                    placeholder
                }
            } else {
                placeholder
            }
        }
        .padding(.vertical, 6)
        .task(id: src) {
            guard let id = blobId(src) else { return }
            let core = store.core
            image = await Task.detached {
                guard let file = attempt("file", { try core.file(id: id) }) ?? nil else { return nil }
                return UIImage(data: file.bytes)?.preparingThumbnail(of: CGSize(width: 1600, height: 1600))
            }.value
        }
    }

    private var placeholder: some View {
        RoundedRectangle(cornerRadius: Radius.md).fill(Impala.surface)
            .frame(height: 96)
            .overlay { Text(alt.isEmpty ? "Bild" : alt).font(.system(size: TextSize.sm)).foregroundStyle(Impala.text2) }
    }
}

/// Datei aus dem Kern: Antippen zeigt sie in der Vorschau (Quick Look).
private struct FileCard: View {
    let src: String
    let name: String
    @Environment(ImpalaStore.self) private var store
    @State private var preview: URL?

    var body: some View {
        LinkCard(icon: "paperclip", label: name.isEmpty ? "Datei" : name) {
            guard let id = blobId(src), let file = attempt("file", { try store.core.file(id: id) }) ?? nil else { return }
            let url = FileManager.default.temporaryDirectory.appending(path: name.isEmpty ? (file.name.isEmpty ? "Datei" : file.name) : name)
            if (try? file.bytes.write(to: url)) != nil { preview = url }
        }
        .quickLookPreview($preview)
    }
}

private struct LinkCard: View {
    let icon: String
    let label: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: Space.s2) {
                Icon(icon, size: 16).foregroundStyle(Impala.text2)
                Text(label).font(.system(size: TextSize.md)).foregroundStyle(Impala.text).lineLimit(1)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, Space.s3).padding(.vertical, 10)
            .background(Impala.surface, in: RoundedRectangle(cornerRadius: Radius.sm))
            .overlay(RoundedRectangle(cornerRadius: Radius.sm).strokeBorder(Impala.edgeSoft))
        }
        .pressable()
        .padding(.vertical, Space.s1)
    }
}

/// Markdown eines Blocks als Text bearbeiten (für alles ohne eigenes Eingabefeld).
struct RawMarkdownSheet: View {
    @State var text: String
    let onDone: (String) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            TextEditor(text: $text)
                .font(.system(size: TextSize.base, design: .monospaced))
                .foregroundStyle(Impala.text)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .scrollContentBackground(.hidden)
                .padding(Space.s4)
                .background(Impala.panel)
                .navigationTitle("Als Markdown bearbeiten")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Abbrechen") { dismiss() } }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Fertig") {
                            onDone(text)
                            dismiss()
                        }
                    }
                }
        }
    }
}
