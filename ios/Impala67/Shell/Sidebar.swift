import SwiftUI

/// Seitenleiste wie in der PWA: Arbeitsbereich, Seitenbaum (Unterseiten aufklappbar), Neu anlegen.
struct Sidebar: View {
    @Environment(ImpalaStore.self) private var store
    @Binding var selection: String?
    @State private var workspaceId = "default"
    @State private var error: String?

    var body: some View {
        let _ = store.pagesRevision
        let workspaces = store.core.workspaces()
        List(selection: $selection) {
            PageChildren(parentId: nil, workspaceId: workspaceId)
        }
        .listStyle(.sidebar)
        .navigationTitle(workspaces.first { $0.id == workspaceId }?.name ?? "Impala67")
        .toolbar {
            if workspaces.count > 1 {
                ToolbarItem(placement: .topBarLeading) {
                    Menu {
                        Picker("Arbeitsbereich", selection: $workspaceId) {
                            ForEach(workspaces, id: \.id) { Text($0.name).tag($0.id) }
                        }
                    } label: { Image(systemName: "square.stack") }
                }
            }
            ToolbarItem(placement: .primaryAction) {
                Menu {
                    Button("Neue Seite", systemImage: "doc.text") { create(heft: false) }
                    Button("Neues Heft", systemImage: "pencil.and.scribble") { create(heft: true) }
                } label: { Image(systemName: "plus") }
            }
        }
        .alert("Fehler", isPresented: Binding(get: { error != nil }, set: { if !$0 { error = nil } })) {
            Button("OK", role: .cancel) {}
        } message: { Text(error ?? "") }
    }

    private func create(heft: Bool) {
        do {
            selection = heft
                ? try store.core.createHeft(title: "Neues Heft", parentId: nil, workspaceId: workspaceId)
                : try store.core.createPage(title: "", content: "", parentId: nil, workspaceId: workspaceId)
        } catch {
            self.error = String(describing: error)
        }
    }
}

/// Unterseiten einer Seite (bzw. die Wurzeln eines Arbeitsbereichs), rekursiv aufklappbar.
private struct PageChildren: View {
    @Environment(ImpalaStore.self) private var store
    let parentId: String?
    let workspaceId: String

    var body: some View {
        let _ = store.pagesRevision
        ForEach(store.core.childrenOf(parentId: parentId, workspaceId: parentId == nil ? workspaceId : nil)) { page in
            PageRow(page: page, workspaceId: workspaceId)
        }
    }
}

private struct PageRow: View {
    @Environment(ImpalaStore.self) private var store
    let page: PageSummary
    let workspaceId: String
    @State private var expanded = false

    var body: some View {
        let hasChildren = !store.core.childrenOf(parentId: page.id, workspaceId: nil).isEmpty
        Group {
            if hasChildren {
                DisclosureGroup(isExpanded: $expanded) {
                    PageChildren(parentId: page.id, workspaceId: workspaceId)
                } label: { label }
            } else {
                label
            }
        }
        .tag(Optional(page.id))
        .contextMenu {
            Button("Unterseite", systemImage: "plus") {
                _ = try? store.core.createPage(title: "", content: "", parentId: page.id, workspaceId: nil)
                expanded = true
            }
            Button("In den Papierkorb", systemImage: "trash", role: .destructive) {
                try? store.core.trashPage(id: page.id)
            }
        }
    }

    private var label: some View {
        Label {
            Text(page.title.isEmpty ? "Unbenannt" : page.title)
                .foregroundStyle(page.title.isEmpty ? Impala.text2 : Impala.text)
                .lineLimit(1)
        } icon: {
            if !page.icon.isEmpty {
                Text(page.icon)
            } else {
                Image(systemName: page.kind == .heft ? "pencil.and.scribble" : "doc.text")
            }
        }
    }
}
