import SwiftUI

/// Slash- bzw. „[[“-Menü des aktiven Blocks; schwebt über der Block-Leiste und nimmt den Fokus nicht,
/// damit Tastatur und Eingabefeld offen bleiben. ↑/↓ und Enter/Tab der Hardware-Tastatur wählen.
struct EditorMenuPanel: View {
    let model: NoteModel

    var body: some View {
        if let m = model.menu {
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        switch m.kind {
                        case .slash:
                            ForEach(Array(slashItems(m.query).enumerated()), id: \.offset) { i, cmd in
                                MenuRow(selected: i == m.selected, title: cmd.label, hint: cmd.hint) {
                                    if let icon = cmd.icon { Icon(icon, size: 18) } else { Text(cmd.glyph).font(.system(size: TextSize.base, weight: .semibold)) }
                                } action: {
                                    model.applySlash(cmd)
                                }
                                .id(i)
                            }
                        case .link:
                            let pages = model.linkItems(m.query)
                            if pages.isEmpty {
                                Text("Keine Seite gefunden").font(.system(size: TextSize.md)).foregroundStyle(Impala.text2)
                                    .padding(Space.s3)
                            }
                            ForEach(Array(pages.enumerated()), id: \.element.id) { i, p in
                                MenuRow(selected: i == m.selected, title: PageStyle.title(p), hint: nil) {
                                    PageIcon(page: p, size: 16)
                                } action: {
                                    model.applyLink(p)
                                }
                                .id(i)
                            }
                        }
                    }
                    .padding(Space.s1)
                }
                .frame(width: 340, height: min(CGFloat(max(rowCount(m), 1)) * 46 + 8, 300))
                .impalaGlass(in: RoundedRectangle(cornerRadius: Radius.lg))
                .onChange(of: m.selected) { _, i in withAnimation(.snappy) { proxy.scrollTo(i) } }
            }
        }
    }
}

extension EditorMenuPanel {
    private func rowCount(_ m: MenuQuery) -> Int {
        m.kind == .slash ? slashItems(m.query).count : model.linkItems(m.query).count
    }
}

private struct MenuRow<Lead: View>: View {
    let selected: Bool
    let title: String
    let hint: String?
    @ViewBuilder let lead: () -> Lead
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: Space.s3) {
                lead()
                    .foregroundStyle(Impala.text2)
                    .frame(width: 28)
                VStack(alignment: .leading, spacing: 1) {
                    Text(title).font(.system(size: TextSize.md)).foregroundStyle(Impala.text).lineLimit(1)
                    if let hint { Text(hint).font(.system(size: TextSize.xs)).foregroundStyle(Impala.text2).lineLimit(1) }
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, Space.s2).padding(.vertical, 6)
            .background(selected ? Impala.activeTint : Color.clear, in: RoundedRectangle(cornerRadius: Radius.sm))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}
