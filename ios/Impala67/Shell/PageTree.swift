import SwiftUI

/// Seitenbaum der Seitenleiste (`renderSidebar` in render.js, `DeskTree.kt`): Favoriten oben, darunter je
/// Arbeitsbereich die Seiten in Benutzer-Reihenfolge. Auf- und Zuklappen geht über den Kern
/// (`setTreeOpen`) und gilt damit auf allen Geräten.
struct PageTree: View {
    @Environment(ImpalaStore.self) private var store
    @Environment(ShellModel.self) private var shell
    @State private var renaming: PageSummary?
    @State private var renameText = ""

    var body: some View {
        let _ = (store.pagesRevision, store.uiRevision)
        let rows = TreeRows.read(store.core)
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 1) {
                ForEach(rows) { row in
                    switch row.kind {
                    case let .head(title, collapseKey, workspaceId):
                        TreeHead(title: title, collapsed: collapseKey.map { rows.isCollapsed($0) }, onToggle: { if let k = collapseKey { toggle(k) } }) {
                            workspaceId.map { ws in NewPageMenu(label: "Neue Seite in \(title)") { create($0, parent: nil, workspace: ws) } }
                        }
                    case let .page(page, depth, hasKids):
                        TreePageRow(
                            page: page, depth: depth, hasKids: hasKids,
                            collapsed: rows.isCollapsed(page.id),
                            active: shell.active == page.id,
                            onOpen: { shell.open(page.id) },
                            onToggle: { toggle(page.id) },
                            menu: { menu(page) },
                            onAddChild: { create($0, parent: page.id, workspace: nil) }
                        )
                    case .empty:
                        Text("Keine Seiten")
                            .font(.system(size: TextSize.sm))
                            .foregroundStyle(Impala.text2)
                            .padding(.leading, 30)
                            .padding(.vertical, Space.s1)
                    }
                }
            }
        }
        .scrollIndicators(.hidden)
        .alert("Umbenennen", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
            TextField("Titel", text: $renameText)
            Button("Abbrechen", role: .cancel) {}
            Button("Speichern") {
                if let p = renaming, renameText != p.title { try? store.core.updatePage(id: p.id, title: renameText, content: nil) }
            }
        }
    }

    /// Seiten-⋯-Menü wie `pageMenuHtml` in render.js.
    @ViewBuilder
    private func menu(_ page: PageSummary) -> some View {
        MenuItem("In neuem Tab öffnen", icon: "external") { shell.openNewTab(page.id) }
        MenuItem("Umbenennen", icon: "pen") { renameText = page.title; renaming = page }
        MenuItem(page.isTemplate ? "Vorlage entfernen" : "Als Vorlage", icon: "template") {
            patch(page.id, ["isTemplate": !page.isTemplate])
        }
        MenuItem(page.favorite ? "Favorit entfernen" : "Zu Favoriten", icon: "star") {
            patch(page.id, ["favorite": !page.favorite])
        }
        MenuItem("Archivieren", icon: "archive") {
            shell.close(page.id)
            try? store.core.archivePage(id: page.id)
        }
        MenuItem("Löschen", icon: "trash", role: .destructive) {
            shell.close(page.id)
            try? store.core.trashPage(id: page.id)
        }
    }

    private func toggle(_ key: String) {
        let open = TreeRows.read(store.core).isCollapsed(key)
        try? store.core.setTreeOpen(key: key, open: open)
    }

    private func patch(_ id: String, _ patch: [String: Any]) {
        guard let json = try? JSONSerialization.data(withJSONObject: ["id": id, "patch": patch]),
              let s = String(data: json, encoding: .utf8) else { return }
        _ = try? store.core.dispatch(kind: "pageUpdate", payloadJson: s)
    }

    private func create(_ kind: PageKind, parent: String?, workspace: String?) {
        let id: String? = switch kind {
        case .note: try? store.core.createPage(title: "", content: "", parentId: parent, workspaceId: workspace)
        case .heft: try? store.core.createHeft(title: "Heft", parentId: parent, workspaceId: workspace)
        }
        if let parent { try? store.core.setTreeOpen(key: parent, open: true) }
        if let id { shell.open(id) }
    }
}

/// „+“ mit Auswahl Notiz/Heft (wie die Vorlagenwahl der PWA, ohne Vorlagen).
struct NewPageMenu: View {
    let label: String
    let create: (PageKind) -> Void

    var body: some View {
        Menu {
            MenuItem("Notiz", icon: "note") { create(.note) }
            MenuItem("Heft", icon: "notebook") { create(.heft) }
        } label: {
            Icon("plus", size: 14)
                .foregroundStyle(Impala.text2)
                .frame(width: 26, height: 26)
                .contentShape(Rectangle())
        }
        .accessibilityLabel(label)
    }
}

/// Abschnittskopf (`.ws-head`): Pfeil, Name, „+“.
private struct TreeHead<Trailing: View>: View {
    let title: String
    let collapsed: Bool?
    let onToggle: () -> Void
    @ViewBuilder let trailing: () -> Trailing

    var body: some View {
        HStack(spacing: 2) {
            if let collapsed { Chevron(open: !collapsed, action: onToggle) }
            Text(title)
                .font(.system(size: TextSize.xs, weight: .semibold))
                .foregroundStyle(Impala.text2)
                .lineLimit(1)
            Spacer(minLength: 0)
            trailing()
        }
        .padding(.leading, Space.s1)
        .padding(.top, Space.s2 + Space.s1)
        .padding(.bottom, Space.s1)
        .contentShape(Rectangle())
        .onTapGesture(perform: onToggle)
    }
}

/// Seitenzeile (`.row`): 16 pt Einrückung je Ebene, aktiv mit Akzent-Tönung; Halten öffnet das Menü.
private struct TreePageRow<MenuContent: View>: View {
    let page: PageSummary
    let depth: Int
    let hasKids: Bool
    let collapsed: Bool
    let active: Bool
    let onOpen: () -> Void
    let onToggle: () -> Void
    @ViewBuilder let menu: () -> MenuContent
    let onAddChild: (PageKind) -> Void

    var body: some View {
        HStack(spacing: Space.s1) {
            Group {
                if hasKids { Chevron(open: !collapsed, action: onToggle) } else { Color.clear }
            }
            .frame(width: 22, height: 22)
            PageIcon(page: page)
                .foregroundStyle(active ? Impala.text : Impala.text2)
            Text(PageStyle.title(page))
                .font(.system(size: TextSize.sm, weight: active ? .medium : .regular))
                .foregroundStyle(active ? Impala.text : Impala.text2)
                .lineLimit(1)
            Spacer(minLength: 0)
            if active { NewPageMenu(label: "Unterseite anlegen", create: onAddChild) }
        }
        .padding(.leading, CGFloat(depth) * 16)
        .padding(.trailing, 2)
        .frame(minHeight: 34)
        .background(active ? Impala.activeTint : .clear, in: RoundedRectangle(cornerRadius: Radius.sm, style: .continuous))
        .contentShape(RoundedRectangle(cornerRadius: Radius.sm))
        .onTapGesture(perform: onOpen)
        .contextMenu { menu() }
        .hoverEffect(.highlight)
    }
}

struct Chevron: View {
    let open: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Icon("chevron-right", size: 12)
                .foregroundStyle(Impala.text2)
                .rotationEffect(.degrees(open ? 90 : 0))
                .frame(width: 22, height: 22)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(open ? "Einklappen" : "Ausklappen")
        .animation(.spring(duration: 0.25), value: open)
    }
}

/// Sichtbare Zeilen des Baums (ausgeklappte Äste aufgelöst), wie `DeskTree.items()`.
struct TreeRows: RandomAccessCollection {
    enum Kind {
        case head(title: String, collapseKey: String?, workspaceId: String?)
        case page(PageSummary, depth: Int, hasKids: Bool)
        case empty
    }

    struct Row: Identifiable {
        let id: String
        let kind: Kind
    }

    private var rows: [Row] = []
    private var open: [String: Bool] = [:]

    var startIndex: Int { rows.startIndex }
    var endIndex: Int { rows.endIndex }
    subscript(i: Int) -> Row { rows[i] }

    /// Wie `COLLAPSE.isCollapsed`: Seiten sind standardmäßig zu, Arbeitsbereiche offen.
    func isCollapsed(_ key: String) -> Bool {
        key.hasPrefix("ws:") ? open[key] == false : open[key] != true
    }

    /// Tiefe wie in der PWA (`depth > 8` wird nicht mehr gezeichnet).
    private static let maxDepth = 8

    static func read(_ core: ImpalaCore) -> TreeRows {
        var t = TreeRows()
        t.open = core.treeOpen()
        let favorites = core.recentPages(limit: UInt32.max).filter(\.favorite)
        if !favorites.isEmpty {
            t.rows.append(Row(id: "head:fav", kind: .head(title: "★ Favoriten", collapseKey: nil, workspaceId: nil)))
            for p in favorites { t.rows.append(Row(id: "fav:\(p.id)", kind: .page(p, depth: 0, hasKids: false))) }
        }
        func branch(_ parent: String?, _ ws: String?, _ depth: Int) {
            for p in core.childrenOf(parentId: parent, workspaceId: ws) {
                let kids = depth < maxDepth && !core.childrenOf(parentId: p.id, workspaceId: nil).isEmpty
                t.rows.append(Row(id: "tree:\(p.id)", kind: .page(p, depth: depth, hasKids: kids)))
                if kids && !t.isCollapsed(p.id) { branch(p.id, nil, depth + 1) }
            }
        }
        for ws in core.workspaces() {
            let key = "ws:\(ws.id)"
            t.rows.append(Row(id: "head:\(key)", kind: .head(title: ws.name, collapseKey: key, workspaceId: ws.id)))
            guard !t.isCollapsed(key) else { continue }
            let before = t.rows.count
            branch(nil, ws.id, 0)
            if t.rows.count == before { t.rows.append(Row(id: "empty:\(ws.id)", kind: .empty)) }
        }
        return t
    }
}

/// Menüeintrag mit Sprite-Symbol.
struct MenuItem: View {
    let title: String
    let icon: String
    var role: ButtonRole?
    let action: () -> Void

    init(_ title: String, icon: String, role: ButtonRole? = nil, action: @escaping () -> Void) {
        self.title = title
        self.icon = icon
        self.role = role
        self.action = action
    }

    var body: some View {
        Button(role: role, action: action) {
            Label { Text(title) } icon: { Image("i-\(icon)").renderingMode(.template) }
        }
    }
}
