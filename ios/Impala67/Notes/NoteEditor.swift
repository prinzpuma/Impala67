import SwiftUI

/// Notiz wie die Seitenansicht der PWA: Brotkrumen, Emoji, großer Titel, darunter die Blöcke
/// (`markdownToBlocks` im Kern). Antippen macht einen Block zum Eingabefeld; solange einer aktiv ist,
/// schwebt die Block-Leiste (Liquid Glass) über der Tastatur. Speichert kurz nach dem Tippen über den
/// Kern; fremde Änderungen laden nach, solange hier nichts ungespeichert ist.
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

private struct NoteBody: View {
    let model: NoteModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let numbers = listNumbers(model.blocks)
        let editing = model.activeId != nil
        ScrollView {
            VStack(alignment: .leading, spacing: Space.s3) {
                NoteHeader(pageId: model.pageId)
                TextField("Ohne Titel", text: Binding(get: { model.title }, set: { model.setTitle($0) }), axis: .vertical)
                    .font(.system(size: 34, weight: .bold))
                    .foregroundStyle(Impala.text)
                    .riseIn(0)
                VStack(alignment: .leading, spacing: 2) {
                    ForEach(Array(model.blocks.enumerated()), id: \.element.id) { i, b in
                        BlockRow(block: b, number: numbers[b.id], first: i == 0, model: model)
                            .transition(.opacity.combined(with: .offset(y: -6)))
                    }
                }
                .animation(reduceMotion ? nil : .snappy(duration: 0.28), value: model.blocks.map(\.id))
                .riseIn(1)
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
        .background(Impala.panel)
        .safeAreaInset(edge: .bottom) {
            if editing {
                BlockBar(model: model)
                    .padding(.bottom, Space.s3)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(reduceMotion ? nil : .spring(duration: 0.35, bounce: 0.2), value: editing)
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

/// Schwebende Block-Leiste (Werkzeugleiste der Android-App): Verlauf, Blocktyp, Einzug, Löschen, Fertig.
/// Die Markierung des aktuellen Typs gleitet beim Umwandeln.
private struct BlockBar: View {
    let model: NoteModel
    @Namespace private var ns

    var body: some View {
        let current = model.activeBlock?.type
        let isList = [BlockType.bullet, .number, .todo].contains { $0 == current }
        HStack(spacing: 2) {
            BarIcon(icon: "undo", label: "Rückgängig", enabled: model.canUndo) { model.undo() }
            BarIcon(icon: "redo", label: "Wiederholen", enabled: model.canRedo) { model.redo() }
            separator
            ForEach(BlockType.allCases, id: \.self) { t in
                Button {
                    withAnimation(.snappy(duration: 0.25)) { model.convert(t) }
                } label: {
                    Text(t.glyph)
                        .font(.system(size: TextSize.base, weight: .semibold, design: t == .code ? .monospaced : .default))
                        .foregroundStyle(current == t ? Impala.accent : Impala.text)
                        .frame(minWidth: 34, minHeight: 34)
                        .background {
                            if current == t {
                                Capsule().fill(Impala.activeTint).matchedGeometryEffect(id: "type", in: ns)
                            }
                        }
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .disabled(current == nil)
                .accessibilityLabel(t.label)
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
        .sensoryFeedback(.selection, trigger: current)
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
