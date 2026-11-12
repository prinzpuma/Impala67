import Foundation

/// Kinderlisten aller Seiten aus EINEM Kern-Aufruf, für Seitenbaum und Bibliothek. Je Knoten
/// `childrenOf` zu rufen durchsucht jedes Mal alle Seiten – der ganze Baum kostete so quadratisch viel.
struct PageChildren {
    private var lists: [String: [PageSummary]] = [:]

    init(_ core: ImpalaCore) {
        for list in core.pageChildrenIndex() {
            lists[Self.key(list.parentId, list.workspaceId)] = list.pages
        }
    }

    /// Wurzeln eines Arbeitsbereichs (wie `childrenOf(parentId: nil, workspaceId:)`).
    func roots(_ workspaceId: String) -> [PageSummary] {
        lists[Self.key(nil, workspaceId)] ?? []
    }

    /// Unterseiten im Arbeitsbereich der Seite (wie `childrenOf(parentId:, workspaceId: nil)`).
    func of(_ page: PageSummary) -> [PageSummary] {
        lists[Self.key(page.id, page.workspaceId)] ?? []
    }

    private static func key(_ parent: String?, _ workspaceId: String) -> String {
        (parent ?? "") + "\u{0}" + workspaceId
    }
}
