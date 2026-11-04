import QuickLook
import SwiftUI
import UIKit

/// Ein Block, wie ihn die PWA zeigt (editor.css). Textblöcke werden beim Antippen zum Eingabefeld;
/// alle anderen lassen sich über Halten → „Als Markdown bearbeiten“ ändern. `nested` = in Callout,
/// Toggle oder Spalten (dort nur Anzeige, Checkboxen und Toggles bleiben bedienbar).
struct BlockRow: View {
    let block: MdBlock
    let number: Int?
    let first: Bool
    let model: NoteModel
    var nested = false
    @State private var raw: String?

    private var editing: Bool { !nested && model.activeId == block.id }

    var body: some View {
        content
            .frame(maxWidth: .infinity, alignment: .leading)
            .background {
                if let bg = block.bgColor {
                    RoundedRectangle(cornerRadius: Radius.xs).fill(noteColor(bg).opacity(0.28))
                }
            }
            .blockMenu(!nested && !editing, edit: { raw = model.rawOf(block) }, delete: { model.delete(block.id) })
            .sheet(isPresented: Binding(get: { raw != nil }, set: { if !$0 { raw = nil } })) {
                RawMarkdownSheet(text: raw ?? "") { model.commitRaw(block.id, markdown: $0) }
            }
    }

    @ViewBuilder private var content: some View {
        switch block.kind {
        case .paragraph:
            BlockText(block: block, editing: editing, model: model, nested: nested)
                .padding(.vertical, 3).padding(.horizontal, 2)
        case .heading(let level, _):
            BlockText(block: block, editing: editing, model: model, nested: nested)
                .padding(.top, first ? 0 : level.topSpace).padding(.bottom, 2).padding(.horizontal, 2)
        case .listItem(let style, let indent, _):
            HStack(alignment: .top, spacing: 0) {
                ListMarker(style: style, number: number) { model.toggleTodo(block.id) }
                BlockText(block: block, editing: editing, model: model, nested: nested)
                    .padding(.vertical, 3).padding(.horizontal, 2)
            }
            .padding(.leading, CGFloat(indent) * 24)
        case .quote:
            BlockText(block: block, editing: editing, model: model, nested: nested)
                .padding(.leading, 14).padding(.vertical, 2)
                .overlay(alignment: .leading) { Rectangle().fill(Impala.text).frame(width: 3) }
                .padding(.leading, 3)
        case .code(let language, let text):
            CodeBlockView(block: block, language: language, text: text, editing: editing, model: model, nested: nested)
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

private extension View {
    /// Kontextmenü (Halten) eines Blocks; nicht am aktiven Feld, dort gehört Halten der Textauswahl.
    @ViewBuilder func blockMenu(_ on: Bool, edit: @escaping () -> Void, delete: @escaping () -> Void) -> some View {
        if on {
            contextMenu {
                Button(action: edit) { Label { Text("Als Markdown bearbeiten") } icon: { Icon("pen") } }
                Button(role: .destructive, action: delete) { Label { Text("Block löschen") } icon: { Icon("trash") } }
            }
        } else {
            self
        }
    }
}

/// Text eines Blocks: angezeigt mit Inline-Markdown, aktiv als Eingabefeld mit dem Rohtext.
private struct BlockText: View {
    let block: MdBlock
    let editing: Bool
    let model: NoteModel
    let nested: Bool

    var body: some View {
        let font = BlockFont.of(block)
        let color = block.textColor.map(noteColor) ?? Impala.text
        if editing {
            let id = block.id
            BlockTextView(
                text: block.text, font: font, color: UIColor(color), code: block.isCode,
                focusToken: model.focusToken, cursor: model.cursor,
                onChange: { model.edit(id, text: $0, caret: $1) },
                onCaret: { model.caret = $0 },
                onBackspaceAtStart: { model.backspaceAtStart(id) },
                onBlur: { model.blurred(id, token: $0) }
            )
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
            .onTapGesture { if !nested { model.activate(block.id, at: nil) } }
        }
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
private struct CodeBlockView: View {
    let block: MdBlock
    let language: String
    let text: String
    let editing: Bool
    let model: NoteModel
    let nested: Bool
    @State private var copied = false

    var body: some View {
        let font = BlockFont.of(block)
        VStack(alignment: .leading, spacing: Space.s1) {
            if !language.isEmpty || !editing {
                HStack {
                    Text(language).font(.system(size: TextSize.xs)).foregroundStyle(Impala.text2)
                    Spacer()
                    if !editing {
                        Button {
                            UIPasteboard.general.string = text
                            withAnimation(.snappy) { copied = true }
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
                BlockText(block: block, editing: true, model: model, nested: nested)
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    Text(text.isEmpty ? " " : text)
                        .font(font.font).lineSpacing(font.lineSpacing).foregroundStyle(Impala.text)
                        .fixedSize()
                }
                .contentShape(Rectangle())
                .onTapGesture { if !nested { model.activate(block.id, at: nil) } }
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
        case .math(let text):
            // Formeln vorerst als TeX-Quelltext (Satz folgt).
            Text(text).font(.system(size: 16, design: .serif)).italic().foregroundStyle(Impala.text)
                .frame(maxWidth: .infinity).padding(.vertical, 6)
        case .table(let rows):
            TableBlock(rows: rows)
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
                BlockRow(block: b, number: numbers[b.id], first: i == 0, model: model, nested: true)
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
                guard let file = try? core.file(id: id) else { return nil }
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
            guard let id = blobId(src), let file = try? store.core.file(id: id) else { return }
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
private struct RawMarkdownSheet: View {
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
