import SwiftUI

/// „↙ N Rückverweise“ unter dem Titel (render.js `backlinksChipHtml`): Antippen klappt die Liste auf.
struct BacklinksChip: View {
    @Environment(ImpalaStore.self) private var store
    @Environment(ShellModel.self) private var shell
    let pageId: String
    @State private var open = false

    var body: some View {
        let _ = store.pagesRevision
        let links = store.core.backlinks(id: pageId)
        if !links.isEmpty {
            VStack(alignment: .leading, spacing: Space.s1) {
                Button {
                    withAnimation(.spring(duration: 0.3, bounce: 0.15)) { open.toggle() }
                } label: {
                    HStack(spacing: Space.s1) {
                        Icon("backlink", size: 13)
                        Text("\(links.count) Rückverweise")
                    }
                    .font(.system(size: TextSize.sm))
                    .foregroundStyle(Impala.text2)
                    .padding(.horizontal, Space.s1).padding(.vertical, 2)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                if open {
                    BacklinkRow(links: Array(links.prefix(20))) { shell.open($0) }
                        .transition(.opacity.combined(with: .offset(y: -4)))
                }
            }
        }
    }
}

private struct BacklinkRow: View {
    let links: [PageSummary]
    let open: (String) -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 14) {
                ForEach(links) { p in
                    Button { open(p.id) } label: {
                        HStack(spacing: 4) {
                            PageIcon(page: p, size: 13)
                            Text(PageStyle.title(p)).lineLimit(1)
                        }
                        .font(.system(size: TextSize.sm))
                        .foregroundStyle(Impala.text)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, Space.s1)
        }
    }
}

/// Unterseiten wie in Notion am Ende des Inhalts (editor.js `childPagesHtml`), ohne bereits als
/// Heft-Block eingebettete; Datenbank-Seiten zeigen ihre Unterseiten nicht hier.
struct ChildPagesList: View {
    @Environment(ImpalaStore.self) private var store
    @Environment(ShellModel.self) private var shell
    let pageId: String
    let blocks: [MdBlock]

    var body: some View {
        let _ = store.pagesRevision
        let kids = children()
        if !kids.isEmpty {
            VStack(alignment: .leading, spacing: 0) {
                Rectangle().fill(Impala.edgeSoft).frame(height: 1).padding(.bottom, 6)
                ForEach(kids) { k in
                    Button { shell.open(k.id) } label: {
                        HStack(spacing: Space.s2) {
                            PageIcon(page: k, size: 16)
                            Text(PageStyle.title(k)).font(.system(size: TextSize.md)).underline()
                                .foregroundStyle(Impala.text).lineLimit(1)
                            Spacer(minLength: 0)
                        }
                        .padding(.horizontal, Space.s1).padding(.vertical, 6)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .hoverEffect(.highlight)
                }
            }
            .padding(.top, 18)
        }
    }

    private func children() -> [PageSummary] {
        guard let page = store.core.page(id: pageId), store.core.pageDb(id: pageId) == nil else { return [] }
        var embedded = Set<String>()
        collectHefte(blocks, into: &embedded)
        return store.core.childrenOf(parentId: pageId, workspaceId: page.summary.workspaceId).filter { !embedded.contains($0.id) }
    }

    private func collectHefte(_ list: [MdBlock], into set: inout Set<String>) {
        for b in list {
            switch b.kind {
            case .heft(let id): set.insert(id)
            case .callout(_, let ch), .toggle(_, _, let ch): collectHefte(ch, into: &set)
            case .columns(let cols): cols.forEach { collectHefte($0, into: &set) }
            default: break
            }
        }
    }
}
