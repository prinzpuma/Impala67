import Foundation

/// Was „Neu“ anlegt (`openTemplatePicker` in render.js, `TemplatePicker.kt`): Notiz, Heft oder eine Vorlage.
enum NewPageChoice {
    case note, heft
    case template(PageSummary)
}

/// Seiten-Aktionen über den Kern, die mehrere Ansichten brauchen (Baum, Tab-Leiste, Startseite, Bibliothek).
/// Die Regeln (Reihenfolge, Zyklen, Arbeitsbereiche) prüft der Kern; hier wird nur zusammengesetzt.
extension ImpalaCore {
    /// Event mit JSON-Nutzlast (`nil` wird zu `null`).
    @discardableResult
    func dispatch(_ kind: String, _ payload: [String: Any?]) throws -> String {
        let clean = payload.mapValues { $0 ?? NSNull() }
        let data = try JSONSerialization.data(withJSONObject: clean)
        return try dispatch(kind: kind, payloadJson: String(decoding: data, as: UTF8.self))
    }

    func patchPage(_ id: String, _ patch: [String: Any?]) {
        _ = try? dispatch("pageUpdate", ["id": id, "patch": patch.mapValues { $0 ?? NSNull() }])
    }

    /// Neue Seite anlegen; eine Vorlage übernimmt Titel, Inhalt, Icon und Schlagwörter (wie `data-tpluse`).
    func createNew(_ choice: NewPageChoice, parent: String?, workspace: String?) -> String? {
        switch choice {
        case .note:
            return try? createPage(title: "", content: "", parentId: parent, workspaceId: workspace)
        case .heft:
            return try? createHeft(title: "Heft", parentId: parent, workspaceId: workspace)
        case .template(let tpl):
            if tpl.kind == .heft { return try? createHeft(title: tpl.title, parentId: parent, workspaceId: workspace) }
            let content = page(id: tpl.id)?.content ?? ""
            guard let id = try? createPage(title: tpl.title, content: content, parentId: parent, workspaceId: workspace) else { return nil }
            if !tpl.icon.isEmpty || !tpl.tags.isEmpty {
                patchPage(id, ["icon": tpl.icon.isEmpty ? nil : tpl.icon, "tags": tpl.tags])
            }
            return id
        }
    }

    /// Als Vorlage markierte Seiten für die Auswahl bei „Neu“.
    func templates() -> [PageSummary] {
        recentPages(limit: UInt32.max).filter(\.isTemplate)
    }

    /// Seite samt Unterseiten duplizieren wie `duplicatePage` in app-dialogs.js (`PageOps.kt`): Ohne
    /// `newParent` entsteht die Kopie neben dem Original mit „(Kopie)“; Unterseiten hängen an der Kopie.
    func duplicate(_ pageId: String, newParent: String? = nil, workspace: String? = nil) -> String? {
        guard let detail = page(id: pageId) else { return nil }
        let pg = detail.summary
        let id = UUID().uuidString.lowercased()
        let ws = workspace ?? pg.workspaceId
        let payload: [String: Any?] = [
            "id": id,
            "title": newParent == nil ? pg.title + " (Kopie)" : pg.title,
            "parentId": newParent ?? pg.parentId,
            "content": detail.content,
            "workspaceId": ws,
            "icon": pg.icon.isEmpty ? nil : pg.icon,
            "cover": pg.cover.isEmpty ? nil : pg.cover,
            "tags": pg.tags,
            "pdfId": pg.pdfId,
            "kind": pg.kind == .heft ? "heft" : "notion",
        ]
        guard (try? dispatch("pageCreate", payload)) != nil else { return nil }
        for kid in childrenOf(parentId: pg.id, workspaceId: pg.workspaceId) {
            _ = duplicate(kid.id, newParent: id, workspace: ws)
        }
        return id
    }

    /// PDF als Seite (`PDFS.ingest` ohne KI, wie `importPdfPage` in LibraryImport.kt): Datei in den Kern,
    /// Seite mit `pdfId` darauf. Liefert die neue Seiten-ID.
    func importPdf(name: String, bytes: Data) throws -> String {
        let fileId = try addFile(bytes: bytes, mime: "application/pdf", name: name)
        let id = UUID().uuidString.lowercased()
        let title = name.replacingOccurrences(of: #"\.pdf$"#, with: "", options: [.regularExpression, .caseInsensitive])
        try dispatch("pageCreate", [
            "id": id,
            "title": title,
            "parentId": nil,
            "content": "## Zusammenfassung\n\n_KI war nicht erreichbar — Zusammenfassung später über den Chat erstellen._\n",
            "pdfId": fileId,
            "tags": [String](),
            "workspaceId": workspaces().first?.id ?? "default",
        ])
        return id
    }
}

/// Ein Ziel in „Verschieben nach…“: Arbeitsbereich (`pageId == nil`) oder Seite.
struct MoveTarget: Identifiable {
    let label: String
    let depth: Int
    let workspaceId: String
    let pageId: String?
    var id: String { workspaceId + ":" + (pageId ?? "") }
}

extension ImpalaCore {
    /// Alle Ziele ohne die Seite selbst und ihren Unterbaum (`moveTargets` in PageOps.kt).
    func moveTargets(for pageId: String) -> [MoveTarget] {
        let excluded = Set(pageSubtree(id: pageId))
        var out: [MoveTarget] = []
        func walk(_ parent: String?, _ ws: String, _ depth: Int) {
            for p in childrenOf(parentId: parent, workspaceId: ws) where !excluded.contains(p.id) {
                out.append(MoveTarget(label: PageStyle.title(p), depth: depth, workspaceId: ws, pageId: p.id))
                walk(p.id, ws, depth + 1)
            }
        }
        for ws in workspaces() {
            out.append(MoveTarget(label: ws.name, depth: 0, workspaceId: ws.id, pageId: nil))
            walk(nil, ws.id, 1)
        }
        return out
    }

    func move(_ pageId: String, to target: MoveTarget) {
        if let parent = target.pageId { try? movePage(id: pageId, parentId: parent, index: nil) }
        else { try? movePageToWorkspace(id: pageId, workspaceId: target.workspaceId) }
    }
}
