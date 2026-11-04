import SwiftUI

/// Seitenbaum der Seitenleiste (`renderSidebar` in render.js, `DeskTree.kt`): Favoriten oben, darunter je
/// Arbeitsbereich die Seiten in Benutzer-Reihenfolge. Auf- und Zuklappen geht über den Kern
/// (`setTreeOpen`) und gilt damit auf allen Geräten.
struct PageTree: View {
    @Environment(ImpalaStore.self) private var store
    @Environment(ShellModel.self) private var shell
    @State private var renaming: PageSummary?
    @State private var renameText = ""
    @State private var moving: PageSummary?
    @State private var drops = 0
    @Namespace private var highlight

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
                        // Auf den Kopf ziehen = Wurzel dieses Arbeitsbereichs.
                        .treeDrop(enabled: workspaceId != nil, zones: false) { id, _ in
                            if let ws = workspaceId { dropped { store.core.dropPage(id, toWorkspace: ws) } }
                        }
                    case let .page(page, depth, hasKids):
                        TreePageRow(
                            page: page, depth: depth, hasKids: hasKids,
                            collapsed: rows.isCollapsed(page.id),
                            active: shell.active == page.id,
                            ns: highlight,
                            onOpen: { shell.open(page.id) },
                            onToggle: { toggle(page.id) },
                            menu: { menu(page) },
                            onAddChild: { create($0, parent: page.id, workspace: nil) }
                        )
                        // Halten öffnet das Menü, Halten und Ziehen hebt die Zeile an (System-Ziehen).
                        .onDrag { TreeDragItem.provider(page.id) } preview: {
                            TreeDragPreview(page: page)
                        }
                        .treeDrop(enabled: true, zones: true) { id, zone in
                            guard id != page.id else { return }
                            dropped {
                                store.core.dropPage(id, onto: page, zone: zone)
                                if zone == .into { try? store.core.setTreeOpen(key: page.id, open: true) }
                            }
                        }
                    case let .empty(workspaceId):
                        Text("Keine Seiten")
                            .font(.system(size: TextSize.sm))
                            .foregroundStyle(Impala.text2)
                            .padding(.leading, 30)
                            .padding(.vertical, Space.s1)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .treeDrop(enabled: true, zones: false) { id, _ in
                                dropped { store.core.dropPage(id, toWorkspace: workspaceId) }
                            }
                    }
                }
            }
            // Auf-/Zuklappen und neue Seiten: Zeilen gleiten statt zu springen (der Kern meldet asynchron).
            .animation(.snappy(duration: 0.28), value: store.uiRevision)
            .animation(.snappy(duration: 0.28), value: store.pagesRevision)
            .animation(.smooth(duration: 0.3), value: shell.active)
        }
        .scrollIndicators(.hidden)
        .sensoryFeedback(.impact(weight: .medium), trigger: drops)
        .sheet(item: $moving) { MovePageSheet(page: $0) }
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
        MenuItem("Duplizieren", icon: "copy") {
            if let id = store.core.duplicate(page.id) { shell.open(id) }
        }
        MenuItem("Verschieben nach…", icon: "folder-move") { moving = page }
        MenuItem(page.isTemplate ? "Vorlage entfernen" : "Als Vorlage", icon: "template") {
            store.core.patchPage(page.id, ["isTemplate": !page.isTemplate])
        }
        MenuItem(page.favorite ? "Favorit entfernen" : "Zu Favoriten", icon: "star") {
            store.core.patchPage(page.id, ["favorite": !page.favorite])
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

    /// Abgelegt: Kern verschiebt, Zeilen gleiten an ihren Platz, kurze Haptik.
    private func dropped(_ move: () -> Void) {
        withAnimation(.snappy(duration: 0.3)) { move() }
        drops += 1
    }

    private func create(_ choice: NewPageChoice, parent: String?, workspace: String?) {
        let id = store.core.createNew(choice, parent: parent, workspace: workspace)
        if let parent { try? store.core.setTreeOpen(key: parent, open: true) }
        if let id { shell.open(id) }
    }
}

/// „+“ mit Auswahl Notiz/Heft und den Vorlagen darunter (wie `openTemplatePicker` der PWA).
struct NewPageMenu: View {
    let label: String
    let create: (NewPageChoice) -> Void

    var body: some View {
        Menu {
            MenuItem("Notiz", icon: "note") { create(.note) }
            MenuItem("Heft", icon: "notebook") { create(.heft) }
            TemplateMenuSection(create: create)
        } label: {
            Icon("plus", size: 14)
                .foregroundStyle(Impala.text2)
                .frame(width: 26, height: 26)
                .contentShape(Rectangle())
        }
        .accessibilityLabel(label)
    }
}

/// Abschnitt „Aus Vorlage“ in Neu-Menüs: als Vorlage markierte Seiten (Titel, Inhalt, Icon, Schlagwörter).
struct TemplateMenuSection: View {
    @Environment(ImpalaStore.self) private var store
    let create: (NewPageChoice) -> Void

    var body: some View {
        let _ = store.pagesRevision
        let templates = store.core.templates()
        if !templates.isEmpty {
            Section("Aus Vorlage") {
                ForEach(templates) { t in
                    MenuItem(PageStyle.title(t), icon: "template") { create(.template(t)) }
                }
            }
        }
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
    let ns: Namespace.ID
    let onOpen: () -> Void
    let onToggle: () -> Void
    @ViewBuilder let menu: () -> MenuContent
    let onAddChild: (NewPageChoice) -> Void

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
            if active {
                NewPageMenu(label: "Unterseite anlegen", create: onAddChild).transition(.opacity.combined(with: .scale(scale: 0.6)))
            }
        }
        .padding(.leading, CGFloat(depth) * 16)
        .padding(.trailing, 2)
        .frame(minHeight: 34)
        .background {
            // Die Markierung der aktiven Seite gleitet zur neuen Zeile.
            if active {
                RoundedRectangle(cornerRadius: Radius.sm, style: .continuous)
                    .fill(Impala.activeTint)
                    .matchedGeometryEffect(id: "active", in: ns)
            }
        }
        .contentShape(RoundedRectangle(cornerRadius: Radius.sm))
        .onTapGesture(perform: onOpen)
        .contextMenu { menu() }
        .transition(.opacity.combined(with: .move(edge: .top)))
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
        case empty(workspaceId: String)
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
            if t.rows.count == before { t.rows.append(Row(id: "empty:\(ws.id)", kind: .empty(workspaceId: ws.id))) }
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
