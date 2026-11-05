import Foundation
import Observation

/// Zustand einer offenen Notiz wie `EditorViewModel.kt`: Blöcke aus `markdownToBlocks`, aktiver Block,
/// Verlauf, entprelltes Speichern über `updatePage`. Parsen und Schreiben des Markdowns macht der Kern;
/// hier liegen nur die Block-Operationen der Bedienung (Enter teilt, Rücktaste verschmilzt, Umwandeln).
@MainActor @Observable
final class NoteModel {
    let pageId: String
    @ObservationIgnored let core: ImpalaCore

    private(set) var title = ""
    private(set) var blocks: [MdBlock] = []
    /// Block mit Eingabefeld; nil = nur Anzeige.
    private(set) var activeId: String?
    /// Gewünschte Caret-Position (UTF-16) beim Aktivieren; nil = ans Ende.
    private(set) var cursor: Int?
    /// Zählt bei jedem Aktivieren hoch, damit das Eingabefeld den Fokus (neu) setzt.
    private(set) var focusToken = 0
    private var undoStack: [[MdBlock]] = []
    private var redoStack: [[MdBlock]] = []

    /// Auswahl im aktiven Feld (UTF-16), für Umwandeln ohne Sprung und Inline-Formate.
    @ObservationIgnored var selection = NSRange(location: 0, length: 0)
    var caret: Int { selection.location }
    /// Offenes Slash- oder Link-Menü am aktiven Block.
    var menu: MenuQuery?
    /// Link-Adresse wird abgefragt (Strg+K bzw. Link-Knopf).
    var linkPrompt: LinkPrompt?
    /// Dateiauswahl für Bild/PDF/Datei ist offen; neue Blöcke folgen hinter `mediaAfter`.
    var mediaRequest: MediaKind?
    @ObservationIgnored var mediaAfter: String?
    /// Art der Meldung; färbt den Rand wie `.toast.success` / `.toast.error` der PWA.
    enum ToastStyle: Equatable { case info, success, error }

    struct ToastMessage: Equatable {
        let text: String
        let style: ToastStyle
    }

    /// Kurze Meldung unten (wie `toast` der PWA).
    private(set) var toast: ToastMessage?
    @ObservationIgnored private var toastTask: Task<Void, Never>?

    func showToast(_ text: String, style: ToastStyle = .info) {
        toast = ToastMessage(text: text, style: style)
        toastTask?.cancel()
        toastTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(2.2))
            if !Task.isCancelled { self?.toast = nil }
        }
    }
    @ObservationIgnored private var savedTitle = ""
    @ObservationIgnored private var savedMarkdown = ""
    @ObservationIgnored private var dirtyTitle = false
    @ObservationIgnored private var dirtyContent = false
    @ObservationIgnored private var lastEdit = Date.distantPast
    @ObservationIgnored private var saveTask: Task<Void, Never>?
    /// Nur Anzeige (Lernkarten): Änderungen bleiben im Speicher, nichts geht in den Kern.
    @ObservationIgnored private var readOnly = false

    var canUndo: Bool { !undoStack.isEmpty }
    var canRedo: Bool { !redoStack.isEmpty }
    var activeBlock: MdBlock? { activeId.flatMap { blocks.deep($0) } }
    /// Nur Anzeige (Lernkarten, Chat): kein Antippen zum Bearbeiten, kein Blockmenü.
    var isReadOnly: Bool { readOnly }

    init(core: ImpalaCore, pageId: String) {
        self.core = core
        self.pageId = pageId
        guard let page = core.page(id: pageId) else { return }
        title = page.summary.title
        savedTitle = title
        savedMarkdown = page.content
        blocks = markdownToBlocks(markdown: page.content)
    }

    /// Markdown ohne Seite anzeigen (Vorder-/Rückseite einer Lernkarte über `MarkdownView`).
    init(core: ImpalaCore, markdown: String) {
        self.core = core
        pageId = ""
        readOnly = true
        blocks = markdownToBlocks(markdown: markdown)
    }

    // MARK: Laden und Speichern

    /// Fremde Änderung (Sync): nur übernehmen, wenn hier nichts ungespeichert ist und gerade niemand tippt.
    func applyRemote() {
        guard !dirtyTitle, !dirtyContent, Date().timeIntervalSince(lastEdit) > 1.5,
              let page = core.page(id: pageId) else { return }
        if page.summary.title != savedTitle {
            title = page.summary.title
            savedTitle = title
        }
        if page.content != savedMarkdown {
            savedMarkdown = page.content
            // Fremder Stand: kein Rückgängig-Schritt – „Rückgängig“ machte sonst die Änderung des anderen Geräts weg.
            blocks = markdownToBlocks(markdown: page.content)
            undoStack = []
            redoStack = []
            if let a = activeId, !blocks.contains(where: { $0.id == a }) { activeId = nil }
        }
    }

    func setTitle(_ value: String) {
        // Enter im Titel springt in den ersten Block (Titel bleibt einzeilig).
        let clean = value.replacingOccurrences(of: "\n", with: "")
        if clean != value { focusFirst() }
        guard clean != title else { return }
        title = clean
        dirtyTitle = true
        lastEdit = Date()
        scheduleSave()
    }

    private func scheduleSave() {
        guard !readOnly else { return }
        saveTask?.cancel()
        saveTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(600))
            guard !Task.isCancelled else { return }
            self?.flush()
        }
    }

    /// Sofort speichern (Seite verlassen, App im Hintergrund).
    func flush() {
        saveTask?.cancel()
        saveTask = nil
        guard dirtyTitle || dirtyContent else { return }
        let newTitle = dirtyTitle && title != savedTitle ? title : nil
        var md: String?
        if dirtyContent {
            let m = blocksToMarkdown(blocks: blocks)
            if m != savedMarkdown { md = m }
        }
        dirtyTitle = false
        dirtyContent = false
        if let newTitle { savedTitle = newTitle }
        if let md { savedMarkdown = md }
        guard newTitle != nil || md != nil else { return }
        attempt("updatePage", { try core.updatePage(id: pageId, title: newTitle, content: md) })
    }

    // MARK: Verlauf

    /// Jede Änderung der Blöcke läuft hierüber; Tippen in kurzer Folge ist ein Verlaufsschritt.
    func mutate(structural: Bool, _ change: ([MdBlock]) -> [MdBlock]) {
        let next = change(blocks)
        guard next != blocks else { return }
        let now = Date()
        // Wie `checkpoint` in editor.js: Tippen bis zu einer Pause von 700 ms ist ein Schritt, Struktur sofort.
        if structural || now.timeIntervalSince(lastEdit) > 0.7 {
            undoStack.append(blocks)
            if undoStack.count > 100 { undoStack.removeFirst() }
        }
        redoStack.removeAll()
        blocks = next
        lastEdit = now
        dirtyContent = true
        scheduleSave()
    }

    func undo() {
        guard let prev = undoStack.popLast() else { return }
        redoStack.append(blocks)
        restore(prev)
    }

    func redo() {
        guard let next = redoStack.popLast() else { return }
        undoStack.append(blocks)
        restore(next)
    }

    private func restore(_ list: [MdBlock]) {
        blocks = list
        lastEdit = .distantPast
        dirtyContent = true
        scheduleSave()
        if let a = activeId {
            if list.deep(a) != nil { activate(a, at: nil) } else { activeId = nil }
        }
    }

    // MARK: Fokus

    func activate(_ id: String, at position: Int?) {
        if activeId != id { menu = nil }
        activeId = id
        cursor = position
        focusToken += 1
    }

    func endEditing() {
        activeId = nil
        menu = nil
    }

    /// Eingabefeld hat den Fokus verloren. Ein veraltetes `token` heißt: der Block wurde gerade neu
    /// aktiviert (z. B. umgewandelt) – dann bleibt er aktiv.
    func blurred(_ id: String, token: Int) {
        if activeId == id, token == focusToken, linkPrompt == nil, mediaRequest == nil {
            activeId = nil
            menu = nil
        }
    }

    /// Titel fertig getippt: in den ersten Block springen.
    func focusFirst() {
        if let first = blocks.first {
            if first.isText { activate(first.id, at: 0) }
        } else {
            focusEnd()
        }
    }

    /// Tippen unter den Blöcken: in einen leeren Absatz am Ende schreiben.
    func focusEnd() {
        if let last = blocks.last, last.type == .text, last.text.isEmpty {
            activate(last.id, at: 0)
            return
        }
        let p = MdBlock.paragraph()
        mutate(structural: true) { list in list + [p] }
        activate(p.id, at: 0)
    }

    // MARK: Bearbeiten

    /// Text eines Blocks geändert. Ein neuer Zeilenumbruch teilt den Block (außer in Code und Formel)
    /// bzw. übernimmt den gewählten Menüeintrag; ein Kürzel am Anfang eines Absatzes („# “, „- “, „[] “,
    /// „---“, „```“, „$$“) wandelt ihn um; „/“ und „[[“ öffnen die Menüs.
    func edit(_ id: String, text: String, caret: Int) {
        guard let b = blocks.deep(id) else { return }
        selection = NSRange(location: caret, length: 0)
        let ns = text as NSString
        let at = min(caret, ns.length)
        let added = newlineCount(text) - newlineCount(b.text)
        if !b.keepsNewlines, added > 0 {
            if added == 1, at > 0, ns.character(at: at - 1) == 10 {
                let before = ns.substring(to: at - 1), after = ns.substring(from: at)
                if menu != nil, menu?.blockId == id {
                    // Enter im offenen Menü: Eintrag übernehmen statt teilen.
                    mutate(structural: false) { list in list.mapDeep(id) { $0.withText(before + after) } }
                    selection = NSRange(location: at - 1, length: 0)
                    pickMenuItem()
                    return
                }
                split(id, lines: [before, after])
            } else {
                split(id, lines: text.components(separatedBy: "\n"))
            }
            return
        }
        if b.type == .text {
            // Live-Markdown-Kürzel (wie in web/editor.js:1065-1085)
            if text == "---" {
                guard let (_, i) = place(id) else { return }
                menu = nil
                let after = MdBlock.paragraph("")
                mutateSiblings(of: id) { list in
                    Array(list[..<i]) + [MdBlock.make(.divider), after] + Array(list[(i + 1)...])
                }
                activate(after.id, at: 0)
                return
            }
            if text.hasPrefix("```") {
                menu = nil
                let lang = String(text.dropFirst(3)).trimmingCharacters(in: .whitespaces)
                let language = lang.isEmpty ? "javascript" : lang
                mutate(structural: true) { list in
                    list.mapDeep(id) { $0.withKind(.code(language: language, text: "")) }
                }
                activate(id, at: 0)
                return
            }
            if text == "$$" {
                menu = nil
                mutate(structural: true) { list in
                    list.mapDeep(id) { $0.withKind(.math(text: "")) }
                }
                activate(id, at: 0)
                return
            }
            if let t = shortcutType(ns.substring(to: at)) {
                let rest = ns.substring(from: at)
                mutate(structural: true) { list in list.mapDeep(id) { $0.withText(rest).converted(to: t) } }
                activate(id, at: 0)
                return
            }
        }
        mutate(structural: false) { list in list.mapDeep(id) { $0.withText(text) } }
        if !b.keepsNewlines { updateMenu(id, text: text, caret: at) }
    }

    private func newlineCount(_ s: String) -> Int { s.utf16.reduce(0) { $0 + ($1 == 10 ? 1 : 0) } }

    /// Enter (oder eingefügte Zeilen): der Text des Blocks wird auf `lines` aufgeteilt.
    func split(_ id: String, lines: [String]) {
        guard let (sib, i) = place(id), let firstLine = lines.first else { return }
        let b = sib[i]
        let emptyEnter = lines.count == 2 && lines[0].isEmpty && lines[1].isEmpty
        if emptyEnter, b.isListOrQuote {
            // Enter in leerer Zeile beendet die Liste bzw. rückt aus.
            let outdent = b.indent > 0
            mutate(structural: true) { list in
                list.mapDeep(id) { outdent ? $0.indented(-1) : $0.converted(to: .text) }
            }
            activate(id, at: 0)
            return
        }
        if emptyEnter, b.type == .text, sib.count > 1, i == sib.count - 1, let box = blocks.container(of: id) {
            // Enter im leeren letzten Absatz eines Callouts/Toggles bzw. einer Spalte: dahinter weiterschreiben.
            mutate(structural: true) { list in
                list.withSiblings(of: id) { l in l.filter { $0.id != id } }
                    .withSiblings(of: box.id) { l in
                        guard let j = l.firstIndex(where: { $0.id == box.id }) else { return l }
                        return Array(l[...j]) + [b] + Array(l[(j + 1)...])
                    }
            }
            activate(id, at: 0)
            return
        }
        let head = b.withText(firstLine)
        var prev = b
        var tail: [MdBlock] = []
        for line in lines.dropFirst() {
            let next = prev.continuation().withText(line)
            tail.append(next)
            prev = next
        }
        guard let last = tail.last else { return }
        mutateSiblings(of: id) { list in Array(list[..<i]) + [head] + tail + Array(list[(i + 1)...]) }
        activate(last.id, at: lines.count == 2 ? 0 : last.text.utf16.count)
    }

    /// Rücktaste am Blockanfang: erst ausrücken bzw. zum Absatz machen, dann mit dem vorigen verschmelzen.
    func backspaceAtStart(_ id: String) {
        guard let (sib, i) = place(id) else { return }
        let b = sib[i]
        guard b.isText else { return }
        if b.indent > 0 {
            mutate(structural: true) { list in list.mapDeep(id) { $0.indented(-1) } }
        } else if b.type != .text {
            mutate(structural: true) { list in list.mapDeep(id) { $0.converted(to: .text) } }
            activate(id, at: 0)
        } else if i > 0 {
            let prev = sib[i - 1]
            if prev.isText {
                let join = prev.text.utf16.count
                let merged = prev.withText(prev.text + b.text)
                mutateSiblings(of: id) { list in Array(list[..<(i - 1)]) + [merged] + Array(list[(i + 1)...]) }
                activate(prev.id, at: join)
            } else if b.text.isEmpty {
                delete(id)
            }
        } else if b.text.isEmpty, sib.count > 1 {
            // Leerer erster Kind-Absatz: entfernen, weiter im nächsten.
            delete(id)
        }
    }

    func indent(_ delta: Int) {
        guard let id = activeId else { return }
        mutate(structural: true) { list in list.mapDeep(id) { $0.indented(delta) } }
    }

    func convert(_ type: BlockType) {
        guard let id = activeId else { return }
        mutate(structural: true) { list in list.mapDeep(id) { $0.isText ? $0.converted(to: type) : $0 } }
        activate(id, at: caret)
    }

    func toggleTodo(_ id: String) {
        mutate(structural: true) { list in list.mapDeep(id) { b in b.toggledTodo() } }
    }

    /// Toggle auf-/zuklappen; der Zustand wird mitgespeichert (editor.js: `b.open = !b.open`).
    func toggleOpen(_ id: String) {
        mutate(structural: false) { list in list.mapDeep(id) { b in b.toggledOpen() } }
    }

    /// Toggle-Titel ändern.
    func setToggleSummary(_ id: String, summary: String) {
        mutate(structural: false) { list in
            list.mapDeep(id) { b in
                if case .toggle(_, let isOpen, let children) = b.kind {
                    var copy = b
                    copy.kind = .toggle(summary: summary, open: isOpen, children: children)
                    return copy
                }
                return b
            }
        }
    }

    /// Kastenfarbe eine weiter schalten, Reihenfolge wie `data-bcalloutcolor` in web/editor.js.
    func cycleCalloutColor(_ id: String) {
        let order = ["blue", "green", "yellow", "red", "gray", "purple"]
        mutate(structural: false) { list in
            list.mapDeep(id) { b in
                guard case .callout(let color, let children) = b.kind else { return b }
                let next = order[((order.firstIndex(of: color.isEmpty ? "blue" : color) ?? -1) + 1) % order.count]
                return b.withKind(.callout(color: next, children: children))
            }
        }
    }

    func deleteActive() {
        if let id = activeId { delete(id) }
    }

    func delete(_ id: String) {
        guard let (sib, i) = place(id) else { return }
        mutateSiblings(of: id) { list in list.filter { $0.id != id } }
        guard activeId == id else { return }
        if i > 0, sib[i - 1].isText {
            activate(sib[i - 1].id, at: nil)
        } else if i + 1 < sib.count, sib[i + 1].isText {
            activate(sib[i + 1].id, at: 0)
        } else {
            activeId = nil
        }
    }

    /// Markdown eines Blocks für die Rohtext-Bearbeitung (Tabellen, Callouts, Bilder …).
    func rawOf(_ block: MdBlock) -> String { blocksToMarkdown(blocks: [block]) }

    /// Rohtext fertig: wieder in Blöcke umwandeln (0, 1 oder mehrere).
    func commitRaw(_ id: String, markdown: String) {
        guard let (sib, i) = place(id), markdown != blocksToMarkdown(blocks: [sib[i]]) else { return }
        var parsed = markdownToBlocks(markdown: markdown)
        if parsed.count == 1 { parsed[0].id = id }
        mutateSiblings(of: id) { list in Array(list[..<i]) + parsed + Array(list[(i + 1)...]) }
    }

    // MARK: Verschachtelte Blöcke

    /// Liste, in der `id` steht (auch Kinder von Callout, Toggle und Spalten), und seine Stelle darin.
    func place(_ id: String) -> (list: [MdBlock], index: Int)? {
        guard let list = blocks.siblings(of: id), let i = list.firstIndex(where: { $0.id == id }) else { return nil }
        return (list, i)
    }

    /// Strukturänderung an der Liste, in der `id` steht.
    func mutateSiblings(of id: String, _ change: ([MdBlock]) -> [MdBlock]) {
        mutate(structural: true) { $0.withSiblings(of: id, change) }
    }
}
