import SwiftUI
import UniformTypeIdentifiers

/// Ablage relativ zur Zielzeile wie `dropZoneFor` der PWA (`TreeDrag.kt`): oberes/unteres Viertel
/// davor/danach, Mitte hinein.
enum DropZone { case before, after, into }

/// Ziehobjekt einer Baumzeile: Text mit Präfix, damit fremder Text (aus anderen Apps) nichts verschiebt.
enum TreeDragItem {
    static let prefix = "impala-page:"

    static func provider(_ pageId: String) -> NSItemProvider {
        NSItemProvider(object: (prefix + pageId) as NSString)
    }
}

extension ImpalaCore {
    /// Gezogene Seite auf eine Seitenzeile ablegen (`dropPage` in DeskTree.kt, `movePageRelative`/
    /// `movePageInto` der PWA): davor/danach = Geschwister des Ziels (auch in einem anderen
    /// Arbeitsbereich), Mitte = Unterseite. Zyklen lehnt der Kern ab.
    func dropPage(_ movedId: String, onto target: PageSummary, zone: DropZone) {
        guard let moved = page(id: movedId)?.summary, moved.id != target.id else { return }
        if zone == .into {
            try? movePage(id: moved.id, parentId: target.id, index: nil)
            return
        }
        if target.parentId == nil && target.workspaceId != moved.workspaceId {
            try? movePageToWorkspace(id: moved.id, workspaceId: target.workspaceId)
        }
        let siblings = childrenOf(parentId: target.parentId, workspaceId: target.workspaceId).filter { $0.id != moved.id }
        guard let i = siblings.firstIndex(where: { $0.id == target.id }) else { return }
        try? movePage(id: moved.id, parentId: target.parentId, index: UInt32(zone == .before ? i : i + 1))
    }

    /// Auf einen Arbeitsbereich-Kopf (oder „Keine Seiten“) ablegen = Wurzel dieses Bereichs.
    func dropPage(_ movedId: String, toWorkspace ws: String) {
        guard let moved = page(id: movedId)?.summary else { return }
        if ws != moved.workspaceId || moved.parentId != nil { try? movePageToWorkspace(id: moved.id, workspaceId: ws) }
    }
}

extension View {
    /// Ablageziel im Seitenbaum. `zones: false` kennt nur „hinein“ (Köpfe, leere Bereiche).
    func treeDrop(enabled: Bool, zones: Bool, perform: @escaping (String, DropZone) -> Void) -> some View {
        modifier(TreeDropTarget(enabled: enabled, zones: zones, perform: perform))
    }
}

private struct TreeDropTarget: ViewModifier {
    let enabled: Bool
    let zones: Bool
    let perform: (String, DropZone) -> Void
    @State private var zone: DropZone?
    @State private var height: CGFloat = 34

    func body(content: Content) -> some View {
        if enabled {
            content
                .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { height = $0 }
                .overlay { DropMark(zone: zone).animation(.snappy(duration: 0.18), value: zone) }
                .onDrop(of: [.text], delegate: TreeDropDelegate(zones: zones, height: height, zone: $zone, perform: perform))
        } else {
            content
        }
    }
}

private struct TreeDropDelegate: DropDelegate {
    let zones: Bool
    let height: CGFloat
    @Binding var zone: DropZone?
    let perform: (String, DropZone) -> Void

    private func zoneAt(_ info: DropInfo) -> DropZone {
        guard zones else { return .into }
        let y = info.location.y
        return y < height / 4 ? .before : y > height * 3 / 4 ? .after : .into
    }

    func validateDrop(info: DropInfo) -> Bool { info.hasItemsConforming(to: [.text]) }

    func dropEntered(info: DropInfo) { zone = zoneAt(info) }

    func dropUpdated(info: DropInfo) -> DropProposal? {
        let z = zoneAt(info)
        if z != zone { zone = z }
        return DropProposal(operation: .move)
    }

    func dropExited(info: DropInfo) { zone = nil }

    func performDrop(info: DropInfo) -> Bool {
        let z = zoneAt(info)
        zone = nil
        guard let provider = info.itemProviders(for: [.text]).first else { return false }
        let perform = perform
        _ = provider.loadObject(ofClass: NSString.self) { object, _ in
            guard let ns = object as? NSString else { return }
            let text = ns as String
            guard text.hasPrefix(TreeDragItem.prefix) else { return }
            let id = String(text.dropFirst(TreeDragItem.prefix.count))
            DispatchQueue.main.async { perform(id, z) }
        }
        return true
    }
}

/// Markierung der Zielzeile wie `.drop-before/-after/-into`: Linie oben/unten bzw. getönte Fläche.
private struct DropMark: View {
    let zone: DropZone?

    var body: some View {
        RoundedRectangle(cornerRadius: Radius.sm, style: .continuous)
            .fill(Impala.accent.opacity(zone == .into ? 0.18 : 0))
            .overlay(alignment: .top) {
                if zone == .before { Capsule().fill(Impala.accent).frame(height: 2).transition(.opacity) }
            }
            .overlay(alignment: .bottom) {
                if zone == .after { Capsule().fill(Impala.accent).frame(height: 2).transition(.opacity) }
            }
            .allowsHitTesting(false)
    }
}

/// Vorschau am Finger beim Ziehen: Symbol und Titel als kleine Karte.
struct TreeDragPreview: View {
    let page: PageSummary

    var body: some View {
        HStack(spacing: Space.s2) {
            PageIcon(page: page).foregroundStyle(Impala.text2)
            Text(PageStyle.title(page)).lineLimit(1)
        }
        .font(.system(size: TextSize.sm, weight: .medium))
        .foregroundStyle(Impala.text)
        .padding(.horizontal, Space.s3)
        .padding(.vertical, Space.s2)
        .frame(maxWidth: 240)
        .background(Impala.panel, in: RoundedRectangle(cornerRadius: Radius.sm, style: .continuous))
    }
}

/// „Verschieben nach…“ (`openMoveDialog` in app-dialogs.js, `MovePageDialog`): Arbeitsbereiche und Seiten
/// als Ziel, ohne die Seite selbst und ihre Unterseiten; der jetzige Ort ist abgehakt.
struct MovePageSheet: View {
    let page: PageSummary
    @Environment(ImpalaStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List(store.core.moveTargets(for: page.id)) { t in
                Button {
                    withAnimation(.snappy(duration: 0.3)) { store.core.move(page.id, to: t) }
                    if let parent = t.pageId { attempt("setTreeOpen", { try store.core.setTreeOpen(key: parent, open: true) }) }
                    dismiss()
                } label: {
                    HStack(spacing: Space.s2) {
                        Icon(t.pageId == nil ? "folder" : "file", size: 15).foregroundStyle(Impala.text2)
                        Text(t.label)
                            .font(.system(size: TextSize.base, weight: t.depth == 0 ? .semibold : .regular))
                            .foregroundStyle(t.depth == 0 ? Impala.text2 : Impala.text)
                            .lineLimit(1)
                        Spacer(minLength: 0)
                        if isCurrent(t) { Icon("check", size: 15).foregroundStyle(Impala.accent) }
                    }
                    .padding(.leading, CGFloat(t.depth) * 16)
                }
            }
            .navigationTitle("„\(PageStyle.title(page))“ verschieben nach…")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Abbrechen") { dismiss() } }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func isCurrent(_ t: MoveTarget) -> Bool {
        if let parent = page.parentId { return t.pageId == parent }
        return t.pageId == nil && t.workspaceId == page.workspaceId
    }
}
