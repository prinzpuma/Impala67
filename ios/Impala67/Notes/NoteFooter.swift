import SwiftUI

/// „↙ N Rückverweise“ unter dem Titel (render.js `backlinksChipHtml`): Antippen klappt die Liste auf.
struct BacklinksChip: View {
    @Environment(ImpalaStore.self) private var store
    @Environment(ShellModel.self) private var shell
    let pageId: String
    @State private var open = false
    /// Im Hintergrund gesucht (über alle Seiten). Andere Seiten verweisen nur durch Änderungen an
    /// ihnen selbst neu hierher, also durch fremde Änderungen oder neue/umbenannte Seiten.
    @State private var links: [PageSummary] = []

    var body: some View {
        content
            .task(id: [store.pageMetaRevision, store.remoteRevision]) {
                let (core, id) = (store.core, pageId)
                let next = await Task.detached(priority: .utility) { core.backlinks(id: id) }.value
                if !Task.isCancelled { links = next }
            }
    }

    @ViewBuilder
    private var content: some View {
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
    /// Unterseiten aus dem Kern; neu nur bei Änderungen an Seitenbaum/Titeln, nicht bei jedem Tastendruck.
    @State private var all: [PageSummary] = []

    var body: some View {
        var embedded = Set<String>()
        collectHefte(blocks, into: &embedded)
        let kids = all.filter { !embedded.contains($0.id) }
        return list(kids)
            .task(id: store.pageMetaRevision) {
                let (core, id) = (store.core, pageId)
                let next = await Task.detached(priority: .utility) { Self.children(core, id) }.value
                if !Task.isCancelled { all = next }
            }
    }

    @ViewBuilder
    private func list(_ kids: [PageSummary]) -> some View {
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

    private nonisolated static func children(_ core: ImpalaCore, _ pageId: String) -> [PageSummary] {
        guard let page = core.page(id: pageId), core.pageDb(id: pageId) == nil else { return [] }
        return core.childrenOf(parentId: pageId, workspaceId: page.summary.workspaceId)
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

/// „Verwandt“: bis zu drei inhaltlich ähnliche Seiten aus dem semantischen Index (related-pages.js / PageFooter.kt).
/// Ohne Index, bei Datenbank-Seiten oder mit Einstellung `relatedPages = false` bleibt die Leiste weg;
/// das × schaltet sie aus.
struct RelatedPagesRow: View {
    @Environment(ImpalaStore.self) private var store
    @Environment(ShellModel.self) private var shell
    let pageId: String
    @State private var related: [PageSummary] = []

    var body: some View {
        // Äußerer Stapel, damit `.task` auch läuft, solange die Leiste noch leer ist.
        VStack(alignment: .leading, spacing: 0) {
            if !related.isEmpty { row }
        }
        .task(id: "\(pageId)|\(store.settingsRevision)|\(SemanticStatus.shared.revision)") { await loadRelated() }
    }

    private var row: some View {
            VStack(alignment: .leading, spacing: Space.s2) {
                Rectangle().fill(Impala.edgeSoft).frame(height: 1).padding(.bottom, 4)
                HStack(spacing: Space.s2) {
                    Text("Verwandt")
                        .font(.system(size: TextSize.sm, weight: .semibold))
                        .foregroundStyle(Impala.text2)
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: Space.s2) {
                            ForEach(related) { p in
                                Button { shell.open(p.id) } label: {
                                    HStack(spacing: 5) {
                                        PageIcon(page: p, size: 13)
                                        Text(PageStyle.title(p)).lineLimit(1)
                                    }
                                    .font(.system(size: TextSize.sm))
                                    .foregroundStyle(Impala.text)
                                    .padding(.horizontal, 8)
                                    .padding(.vertical, 4)
                                    .background(Impala.surface, in: RoundedRectangle(cornerRadius: Radius.sm, style: .continuous))
                                }
                                .buttonStyle(.plain)
                                .hoverEffect(.highlight)
                            }
                        }
                    }
                    Spacer(minLength: 0)
                    Button {
                        AiSettings.patch(store.core, ["relatedPages": false])
                    } label: {
                        Icon("x", size: 12)
                            .foregroundStyle(Impala.text2)
                            .frame(width: 24, height: 24)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Verwandte Seiten ausblenden")
                }
            }
            .padding(.top, 14)
    }

    /// Suche im Hintergrund – der Index kann bei vielen Seiten dauern und darf die Notiz nicht anhalten.
    private func loadRelated() async {
        guard HomeSettings.read(store.core).relatedPages, store.core.pageDb(id: pageId) == nil else {
            related = []
            return
        }
        let core = store.core
        let id = pageId
        let ids = await Task.detached(priority: .utility) { SemanticIndex.related(core, pageId: id) }.value
        guard !Task.isCancelled else { return }
        related = ids.compactMap { store.core.page(id: $0)?.summary }
    }
}
