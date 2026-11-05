import Foundation

// Befehle des Editors über `NoteModel` (wie EditorBlockCommands.kt, EditorKeys.kt, InlineFormat.kt).

/// Offenes Menü am Eingabefeld: „/befehl“ oder „[[suche“ vor dem Caret (`end` = Caret, UTF-16).
struct MenuQuery: Equatable {
    enum Kind { case slash, link }
    let kind: Kind
    let blockId: String
    let query: String
    let end: Int
    var selected = 0
}

/// Link-Adresse für die Auswahl `start`–`end` im Block `id` abfragen.
struct LinkPrompt: Equatable {
    let id: String
    let start: Int
    let end: Int
}

/// Slash „Bild“, „PDF“, „Datei / Medien“.
enum MediaKind: Equatable { case image, pdf, file }

/// Befehle des Slash-Menüs, Texte wörtlich aus SLASH in web/editor-menus.js.
enum SlashCmd: CaseIterable {
    case paragraph, h1, h2, h3, todo, bullet, number, toggle, quote, callout, code, math, mermaid, svg,
         table, columns, divider, image, pdf, file, heft, link

    var key: String {
        switch self {
        case .paragraph: "p"
        case .h1: "h1"
        case .h2: "h2"
        case .h3: "h3"
        case .todo: "todo"
        case .bullet: "bullet"
        case .number: "number"
        case .toggle: "toggle"
        case .quote: "quote"
        case .callout: "callout"
        case .code: "code"
        case .math: "math"
        case .mermaid: "mermaid"
        case .svg: "svg"
        case .table: "table"
        case .columns: "columns"
        case .divider: "divider"
        case .image: "image"
        case .pdf: "pdf"
        case .file: "file"
        case .heft: "heft"
        case .link: "link"
        }
    }

    var label: String {
        switch self {
        case .paragraph: "Text"
        case .h1: "Überschrift 1"
        case .h2: "Überschrift 2"
        case .h3: "Überschrift 3"
        case .todo: "To-do-Liste"
        case .bullet: "Aufzählung"
        case .number: "Nummerierte Liste"
        case .toggle: "Toggle-Liste"
        case .quote: "Zitat"
        case .callout: "Callout"
        case .code: "Code"
        case .math: "Gleichung"
        case .mermaid: "Diagramm"
        case .svg: "SVG-Grafik"
        case .table: "Tabelle"
        case .columns: "2 Spalten"
        case .divider: "Trennlinie"
        case .image: "Bild"
        case .pdf: "PDF"
        case .file: "Datei / Medien"
        case .heft: "Heft"
        case .link: "Seite verlinken"
        }
    }

    var hint: String {
        switch self {
        case .paragraph: "Einfacher Absatz"
        case .h1: "# "
        case .h2: "## "
        case .h3: "### "
        case .todo: "[] "
        case .bullet: "- "
        case .number: "1. "
        case .toggle: "> aufklappbar"
        case .quote: "> "
        case .callout: "Hervorgehobener Kasten"
        case .code: "Codeblock mit Syntax"
        case .math: "KaTeX-Formel"
        case .mermaid: "Mermaid: Ablauf, Zustände, Zeitachse"
        case .svg: "Zeichnung als SVG-Code"
        case .table: "Einfache Tabelle"
        case .columns: "Nebeneinander"
        case .divider: "---"
        case .image: "Hochladen"
        case .pdf: "PDF einbetten"
        case .file: "Video, Audio, Sonstige"
        case .heft: "Handschrift-Einbettung"
        case .link: "[["
        }
    }

    /// Sprite-Icon oder (nil) das Zeichen aus `glyph`.
    var icon: String? {
        switch self {
        case .todo: "check-square"
        case .callout: "bulb"
        case .mermaid: "graph"
        case .svg: "pen-tool"
        case .columns: "columns"
        case .image: "image"
        case .pdf: "file"
        case .file: "paperclip"
        case .heft: "notebook"
        case .link: "link"
        default: nil
        }
    }

    var glyph: String {
        switch self {
        case .paragraph: "¶"
        case .h1: "H1"
        case .h2: "H2"
        case .h3: "H3"
        case .bullet: "•"
        case .number: "1."
        case .toggle: "▸"
        case .quote: "”"
        case .code: "</>"
        case .math: "√"
        case .table: "▦"
        case .divider: "—"
        default: ""
        }
    }

    var type: BlockType? {
        switch self {
        case .paragraph: .text
        case .h1: .h1
        case .h2: .h2
        case .h3: .h3
        case .todo: .todo
        case .bullet: .bullet
        case .number: .number
        case .quote: .quote
        case .code: .code
        default: nil
        }
    }
}

/// Befehle, deren Name oder Schlüssel `query` enthält (leer = alle), wie in web/editor-menus.js.
func slashItems(_ query: String) -> [SlashCmd] {
    let q = query.lowercased()
    return SlashCmd.allCases.filter { q.isEmpty || $0.label.lowercased().contains(q) || $0.key.contains(q) }
}

/// Ziele von „Umwandeln in“ (TURN_TYPES in editor-menus.js); Toggle und Callout sind keine Textblöcke.
enum TurnInto: CaseIterable {
    case text, h1, h2, h3, todo, bullet, number, toggle, quote, callout, code

    var label: String {
        switch self {
        case .text: "Text"
        case .h1: "Überschrift 1"
        case .h2: "Überschrift 2"
        case .h3: "Überschrift 3"
        case .todo: "To-do-Liste"
        case .bullet: "Aufzählung"
        case .number: "Nummerierte Liste"
        case .toggle: "Toggle-Liste"
        case .quote: "Zitat"
        case .callout: "Callout"
        case .code: "Code"
        }
    }

    var type: BlockType? {
        switch self {
        case .text: .text
        case .h1: .h1
        case .h2: .h2
        case .h3: .h3
        case .todo: .todo
        case .bullet: .bullet
        case .number: .number
        case .quote: .quote
        case .code: .code
        case .toggle, .callout: nil
        }
    }
}

/// Tasten der Hardware-Tastatur im Eingabefeld (web/editor-keys.js).
enum BlockKey {
    case tab, shiftTab, up, down, escape, softBreak, deleteForward
    case format(InlineFormat), link, undo, redo, duplicate, moveUp, moveDown
}

private let slashTrigger = try! NSRegularExpression(pattern: #"(?:^|\s)/([a-zA-ZäöüÄÖÜß0-9]*)$"#)
private let linkTrigger = try! NSRegularExpression(pattern: #"\[\[([^\[\]\n]*)$"#)

extension NoteModel {
    // MARK: Menüs

    /// Nach jeder Eingabe: „/befehl“ bzw. „[[suche“ direkt vor dem Caret öffnet oder filtert das Menü.
    func updateMenu(_ id: String, text: String, caret: Int) {
        let prefix = (text as NSString).substring(to: caret)
        let range = NSRange(location: 0, length: (prefix as NSString).length)
        func query(_ m: NSTextCheckingResult) -> String { (prefix as NSString).substring(with: m.range(at: 1)) }
        if let m = linkTrigger.firstMatch(in: prefix, range: range) {
            open(.link, id, query(m), caret)
        } else if let m = slashTrigger.firstMatch(in: prefix, range: range), !slashItems(query(m)).isEmpty {
            open(.slash, id, query(m), caret)
        } else {
            menu = nil
        }
    }

    private func open(_ kind: MenuQuery.Kind, _ id: String, _ query: String, _ end: Int) {
        let keep = menu?.kind == kind && menu?.blockId == id && menu?.query == query
        menu = MenuQuery(kind: kind, blockId: id, query: query, end: end, selected: keep ? menu?.selected ?? 0 : 0)
    }

    /// Seiten für das Link-Menü: höchstens 8 ohne die aktuelle, Titel enthält die Suche (`openLinkMenu`).
    func linkItems(_ query: String) -> [PageSummary] {
        let q = query.lowercased()
        return Array(core.recentPages(limit: UInt32.max)
            .lazy.filter { $0.id != self.pageId && (q.isEmpty || $0.title.lowercased().contains(q)) }
            .prefix(8))
    }

    private var menuCount: Int {
        guard let m = menu else { return 0 }
        return m.kind == .slash ? slashItems(m.query).count : linkItems(m.query).count
    }

    func moveMenuSelection(_ d: Int) {
        let n = menuCount
        guard n > 0, var m = menu else { return }
        m.selected = (m.selected + d + n) % n
        menu = m
    }

    /// Enter/Tab im offenen Menü: markierten Eintrag übernehmen.
    func pickMenuItem() {
        guard let m = menu else { return }
        switch m.kind {
        case .slash: if let cmd = slashItems(m.query)[safe: m.selected] { applySlash(cmd) }
        case .link: if let page = linkItems(m.query)[safe: m.selected] { applyLink(page) }
        }
    }

    /// Slash-Befehl gewählt: „/suchbegriff“ vor dem Caret entfällt, dann wirkt der Befehl.
    func applySlash(_ cmd: SlashCmd) {
        guard let q = menu, q.kind == .slash, let b = blocks.deep(q.blockId) else { return }
        menu = nil
        let id = b.id
        let full = b.text as NSString
        let end = min(q.end, full.length)
        let start = end - (q.query as NSString).length - 1
        let cut = start >= 0 && full.character(at: start) == 47 // "/"
        let rest = cut ? full.replacingCharacters(in: NSRange(location: start, length: end - start), with: "") : b.text
        let caret = cut ? start : end
        if let type = cmd.type {
            mutate(structural: true) { list in list.mapDeep(id) { $0.withText(rest).converted(to: type) } }
            activate(id, at: caret)
            return
        }
        switch cmd {
        case .divider:
            guard let (_, i) = place(id) else { return }
            let after = MdBlock.paragraph(rest)
            mutateSiblings(of: id) { list in Array(list[..<i]) + [MdBlock.make(.divider), after] + Array(list[(i + 1)...]) }
            activate(after.id, at: 0)
        case .link:
            // „[[“ an die Caret-Stelle, dann sofort das Link-Menü.
            let ns = rest as NSString
            let withLink = ns.substring(to: caret) + "[[" + ns.substring(from: caret)
            setTextAt(id, withLink, caret + 2)
            open(.link, id, "", caret + 2)
        case .heft:
            setTextAt(id, rest, caret)
            insertHeft(after: id)
        case .image, .pdf, .file:
            setTextAt(id, rest, caret)
            mediaAfter = id
            mediaRequest = cmd == .image ? .image : cmd == .pdf ? .pdf : .file
        default:
            insertStructure(id, rest: rest, cmd: cmd)
        }
    }

    /// Strukturblock (`newBlock` in editor.js): Callout und Toggle nehmen den Resttext auf, sonst bleibt
    /// er als eigener Block davor. Danach wird der neue Block bearbeitet, soweit er ein Eingabefeld hat.
    private func insertStructure(_ id: String, rest: String, cmd: SlashCmd) {
        guard let (sib, i) = place(id) else { return }
        let kind: MdBlockKind = switch cmd {
        case .toggle: .toggle(summary: rest, open: true, children: [.paragraph()])
        case .callout: .callout(color: "blue", children: [.paragraph(rest)])
        case .mermaid: .code(language: "mermaid", text: "")
        case .svg: .code(language: "svg", text: "")
        case .table: .table(rows: [["", ""], ["", ""]])
        case .columns: .columns(columns: [[.paragraph()], [.paragraph()]])
        default: .math(text: "")
        }
        let nb = MdBlock.make(kind)
        let keep = !rest.isEmpty && cmd != .toggle && cmd != .callout
        let current = sib[i]
        mutateSiblings(of: id) { list in
            Array(list[..<i]) + (keep ? [current.withText(rest), nb] : [nb]) + Array(list[(i + 1)...])
        }
        if nb.isEditable || cmd == .table { activate(nb.id, at: 0) } else { endEditing() }
    }

    /// Plus im Griff: neuer Absatz mit „/“ darunter, das Slash-Menü öffnet sofort (wie in PWA & Android).
    func insertSlashBelow(_ id: String) {
        guard let (_, i) = place(id) else { return }
        let b = MdBlock.paragraph("/")
        mutateSiblings(of: id) { list in
            var copy = list
            let target = list.firstIndex(where: { $0.id == id }).map { $0 + 1 } ?? (i + 1)
            copy.insert(b, at: min(target, copy.count))
            return copy
        }
        activate(b.id, at: 1)
        menu = MenuQuery(kind: .slash, blockId: b.id, query: "", end: 1, selected: 0)
    }

    /// `applyLink` (editor-menus.js): „[[suche“ vor dem Caret wird zu `[Titel](#id)`.
    func applyLink(_ page: PageSummary) {
        guard let q = menu, q.kind == .link, let b = blocks.deep(q.blockId) else { return }
        menu = nil
        let full = b.text as NSString
        let end = min(q.end, full.length)
        let start = full.range(of: "[[", options: .backwards, range: NSRange(location: 0, length: end)).location
        let title = PageStyle.title(page).replacingOccurrences(of: "[", with: "").replacingOccurrences(of: "]", with: "")
        let link = "[\(title)](#\(page.id))"
        let len = (link as NSString).length
        if start != NSNotFound {
            let text = full.substring(to: start) + link + full.substring(from: end)
            setTextAt(b.id, text, start + len)
        } else {
            setTextAt(b.id, b.text + link, full.length + len)
        }
    }

    func setTextAt(_ id: String, _ text: String, _ caret: Int) {
        mutate(structural: true) { list in list.mapDeep(id) { $0.withText(text) } }
        activate(id, at: caret)
    }

    // MARK: Inline-Formate und Links

    func format(_ f: InlineFormat) {
        guard let b = activeBlock, b.isText, !b.isCode else { return }
        let (text, caret) = wrapMarkers(b.text, selection.location, NSMaxRange(selection), f.markers.before, f.markers.after)
        setTextAt(b.id, text, caret)
    }

    func askLink() {
        guard let b = activeBlock, b.isText, !b.isCode else { return }
        linkPrompt = LinkPrompt(id: b.id, start: selection.location, end: NSMaxRange(selection))
    }

    func finishLink(_ url: String?) {
        guard let p = linkPrompt else { return }
        linkPrompt = nil
        guard let full = blocks.deep(p.id)?.text else { return }
        let len = (full as NSString).length
        let href = url?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if href.isEmpty {
            activate(p.id, at: min(p.end, len))
            return
        }
        if p.start == p.end {
            // Ohne Auswahl wird die Adresse selbst zum Linktext.
            let at = min(p.start, len)
            let link = "[\(href)](\(href))"
            let ns = full as NSString
            setTextAt(p.id, ns.substring(to: at) + link + ns.substring(from: at), at + (link as NSString).length)
        } else {
            let (text, caret) = wrapMarkers(full, p.start, p.end, "[", "](\(href))")
            setTextAt(p.id, text, caret)
        }
    }

    // MARK: Tasten

    /// Ob eine Taste hier etwas tut; sonst bleibt sie beim Textfeld (Cursor bewegen, Tab …).
    func wants(_ key: BlockKey, id: String, text: String) -> Bool {
        guard let b = blocks.deep(id) else { return false }
        let menuOpen = menu?.blockId == id
        let ns = text as NSString
        let at = min(selection.location, ns.length)
        switch key {
        case .tab: return menuOpen || b.indent > 0 || b.isCode || b.type == .bullet || b.type == .number || b.type == .todo
        case .shiftTab: return b.indent > 0
        // Wie editor-keys.js: ↑ verlässt den Block nur am Textanfang, ↓ nur am Textende.
        case .up: return menuOpen || (selection.length == 0 && at == 0)
        case .down: return menuOpen || (selection.length == 0 && at == ns.length)
        case .deleteForward: return selection.length == 0 && at == ns.length && place(id).flatMap { $0.list[safe: $0.index + 1] }?.isText == true
        case .softBreak: return !b.keepsNewlines
        case .format, .link: return b.isText && !b.isCode
        default: return true
        }
    }

    func handle(_ key: BlockKey, id: String) {
        let menuOpen = menu?.blockId == id
        switch key {
        case .tab:
            if menuOpen { pickMenuItem() }
            else if let b = blocks.deep(id), b.isCode { insertAtCaret(id, "  ") }
            else { indent(1) }
        case .shiftTab: indent(-1)
        case .up: if menuOpen { moveMenuSelection(-1) } else { focusNeighbor(id, -1) }
        case .down: if menuOpen { moveMenuSelection(1) } else { focusNeighbor(id, 1) }
        case .escape: if menuOpen { menu = nil } else { endEditing() }
        case .softBreak: insertAtCaret(id, "\n")
        case .deleteForward: joinNext(id)
        case .format(let f): format(f)
        case .link: askLink()
        case .undo: undo()
        case .redo: redo()
        case .duplicate: duplicate(id)
        case .moveUp: moveBlock(id, -1)
        case .moveDown: moveBlock(id, 1)
        }
    }

    /// Text an der Auswahl einsetzen, ohne zu teilen (Shift+Enter, Tab im Code).
    private func insertAtCaret(_ id: String, _ s: String) {
        guard let b = blocks.deep(id) else { return }
        let ns = b.text as NSString
        let start = min(selection.location, ns.length)
        let end = min(NSMaxRange(selection), ns.length)
        let text = ns.replacingCharacters(in: NSRange(location: start, length: end - start), with: s)
        setTextAt(id, text, start + (s as NSString).length)
    }

    /// ↑ am Anfang bzw. ↓ am Ende: in den Nachbarblock wechseln.
    private func focusNeighbor(_ id: String, _ dir: Int) {
        guard let (sib, i) = place(id), let n = sib[safe: i + dir], n.isEditable else { return }
        activate(n.id, at: dir < 0 ? (n.text as NSString).length : 0)
    }

    /// Entf am Blockende: den nächsten Textblock anhängen.
    private func joinNext(_ id: String) {
        guard let (sib, i) = place(id), let next = sib[safe: i + 1], next.isText else { return }
        let b = sib[i]
        let join = (b.text as NSString).length
        let merged = b.withText(b.text + next.text)
        mutateSiblings(of: id) { list in Array(list[..<i]) + [merged] + Array(list[(i + 2)...]) }
        activate(id, at: join)
    }

    // MARK: Blockmenü

    /// Block um eine Stelle verschieben (Strg+Shift+↑/↓, Kontextmenü).
    func moveBlock(_ id: String, _ delta: Int) {
        guard let (_, i) = place(id) else { return }
        move(id, to: i + delta + (delta > 0 ? 1 : 0))
    }

    /// Block vor die Stelle `target` seiner Liste setzen (0…count; Ziehen mit dem Griff).
    func move(_ id: String, to target: Int) {
        guard let (sib, i) = place(id) else { return }
        let t = min(max(target, 0), sib.count)
        guard t != i, t != i + 1 else { return }
        mutateSiblings(of: id) { list in
            var l = list
            let b = l.remove(at: i)
            l.insert(b, at: t > i ? t - 1 : t)
            return l
        }
        if activeId == id { activate(id, at: caret) }
    }

    /// Kopie direkt darunter; über Markdown, damit auch verschachtelte Blöcke neue IDs bekommen.
    func duplicate(_ id: String) {
        guard let (sib, i) = place(id) else { return }
        let copy = markdownToBlocks(markdown: blocksToMarkdown(blocks: [sib[i]]))
        mutateSiblings(of: id) { list in Array(list[...i]) + copy + Array(list[(i + 1)...]) }
    }

    /// Farbe setzen: Text- und Hintergrundfarbe schließen sich aus; nil entfernt beide.
    func setColor(_ id: String, _ name: String?, background: Bool) {
        mutate(structural: true) { list in
            list.mapDeep(id) { b in
                var c = b
                c.textColor = name != nil && !background ? name : nil
                c.bgColor = name != nil && background ? name : nil
                return c
            }
        }
    }

    /// `turnInto` (editor.js): Textblöcke behalten ihren Text, Toggle/Callout Kinder bzw. Klartext.
    func turnInto(_ id: String, _ to: TurnInto) {
        guard let b = blocks.deep(id) else { return }
        let texty = b.isText && !b.isCode
        var nb = b
        if let type = to.type {
            nb = (b.isText ? b : b.withKind(.paragraph(text: b.plainText))).converted(to: type)
        } else if to == .toggle {
            if case .toggle = b.kind { return }
            var children: [MdBlock] = [.paragraph()]
            if case .callout(_, let ch) = b.kind { children = ch }
            nb = b.withKind(.toggle(summary: texty ? b.text : "", open: true, children: children))
        } else {
            if case .callout = b.kind { return }
            nb = b.withKind(.callout(color: "blue", children: [.paragraph(texty ? b.text : b.plainText)]))
        }
        let result = nb
        mutate(structural: true) { list in list.mapDeep(id) { _ in result } }
        if result.isEditable { activate(id, at: (result.text as NSString).length) } else if activeId == id { endEditing() }
    }

    /// „Lernkarte erstellen“: Klartext des Blocks als Vorderseite, mit Verweis auf die Seite.
    func cardFromBlock(_ id: String) -> Bool {
        guard let b = blocks.deep(id) else { return false }
        return (attempt("createCard", { try core.createCard(front: markdownPlainText(markdown: b.plainText), back: "", deck: nil, pageId: pageId) })) != nil
    }

    // MARK: Tabellen und Medien

    /// Tabellenzellen geändert; neue Zeilen/Spalten zählen als eigener Verlaufsschritt.
    func setTable(_ id: String, _ rows: [[String]]) {
        guard let b = blocks.deep(id), case .table(let old) = b.kind else { return }
        let structural = old.count != rows.count || old.first?.count != rows.first?.count
        mutate(structural: structural) { list in list.mapDeep(id) { $0.withKind(.table(rows: rows)) } }
    }

    /// Datei im Kern ablegen und als Bild- bzw. Dateiblock hinter `mediaAfter` einfügen.
    func addMedia(_ data: Data, mime: String, name: String) -> Bool {
        guard let fileId = attempt("addFile", { try core.addFile(bytes: data, mime: mime, name: name) }) else { return false }
        let kind: MdBlockKind = mime.hasPrefix("image/")
            ? .image(alt: name.replacingOccurrences(of: #"\.[A-Za-z0-9]+$"#, with: "", options: .regularExpression), src: fileId)
            : .file(src: fileId, name: name)
        let nb = MdBlock.make(kind)
        let after = mediaAfter
        mutate(structural: true) { all in
            guard let after, all.deep(after) != nil else { return all + [nb] }
            return all.withSiblings(of: after) { list in
                guard let i = list.firstIndex(where: { $0.id == after }) else { return list + [nb] }
                let b = list[i]
                if b.isText, !b.isCode, b.text.trimmingCharacters(in: .whitespaces).isEmpty {
                    return Array(list[..<i]) + [nb] + Array(list[(i + 1)...])
                }
                return Array(list[...i]) + [nb] + Array(list[(i + 1)...])
            }
        }
        mediaAfter = nb.id
        return true
    }

    func finishMedia() {
        mediaRequest = nil
        endEditing()
    }

    /// Bilder aus der Zwischenablage oder per Drag & Drop hinter `after` einfügen (ohne: am Ende), als
    /// PNG bzw. JPEG wie beim Foto-Import. Ein leerer Absatz an der Stelle wird durch das Bild ersetzt.
    func insertImages(_ images: [(data: Data, mime: String)], after id: String?) {
        mediaAfter = id ?? blocks.last?.id
        var n = 0
        for (i, im) in images.enumerated() {
            let ext = im.mime == "image/png" ? "png" : "jpg"
            if addMedia(im.data, mime: im.mime, name: images.count > 1 ? "Bild \(i + 1).\(ext)" : "Bild.\(ext)") { n += 1 }
        }
        mediaAfter = nil
        if let a = activeId, blocks.deep(a) == nil { endEditing() }
        if n > 0 { showToast(n == 1 ? "Bild eingefügt" : "\(n) Bilder eingefügt", style: .success) } else { showToast("Bild konnte nicht eingefügt werden.", style: .error) }
    }

    /// Slash „Heft“: neues Heft als Unterseite anlegen und dahinter einbetten.
    private func insertHeft(after id: String) {
        guard let (_, i) = place(id), let heftId = attempt("createHeft", { try core.createHeft(title: "Heft", parentId: pageId, workspaceId: nil) }) else { return }
        mutateSiblings(of: id) { list in Array(list[...i]) + [MdBlock.make(.heft(heftId: heftId))] + Array(list[(i + 1)...]) }
    }
}

extension MdBlock {
    func withKind(_ k: MdBlockKind) -> MdBlock {
        var b = self
        b.kind = k
        return b
    }

    /// Text ohne Struktur (`plainTextOf`): Toggle-Titel und Kinder von Toggle/Callout.
    var plainText: String {
        switch kind {
        case .toggle(let summary, _, let children):
            ([summary] + children.map(\.text)).filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }.joined(separator: " ")
        case .callout(_, let children):
            children.map(\.text).filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }.joined(separator: " ")
        default: text
        }
    }
}

extension Array where Element == MdBlock {
    func after(_ id: String) -> MdBlock? {
        guard let i = firstIndex(where: { $0.id == id }), i + 1 < count else { return nil }
        return self[i + 1]
    }
}

extension Array {
    subscript(safe i: Int) -> Element? { indices.contains(i) ? self[i] : nil }
}
