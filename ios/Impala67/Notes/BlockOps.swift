import SwiftUI
import UIKit

/// Blocktypen der Werkzeugleiste (SLASH-Liste in web/editor-menus.js, soweit tippbar), wie `BlockOps.kt`.
enum BlockType: CaseIterable {
    case text, h1, h2, h3, bullet, number, todo, quote, code

    var label: String {
        switch self {
        case .text: "Text"
        case .h1: "Überschrift 1"
        case .h2: "Überschrift 2"
        case .h3: "Überschrift 3"
        case .bullet: "Aufzählung"
        case .number: "Nummerierte Liste"
        case .todo: "To-do-Liste"
        case .quote: "Zitat"
        case .code: "Code"
        }
    }

    /// Kurzzeichen in der Leiste (wie die Android-Werkzeugleiste).
    var glyph: String {
        switch self {
        case .text: "T"
        case .h1: "H1"
        case .h2: "H2"
        case .h3: "H3"
        case .bullet: "•"
        case .number: "1."
        case .todo: "☑"
        case .quote: "”"
        case .code: "</>"
        }
    }
}

extension MdBlock: Identifiable {}

extension MdBlock {
    static func make(_ kind: MdBlockKind) -> MdBlock {
        MdBlock(id: String(UUID().uuidString.lowercased().prefix(8)), kind: kind, textColor: nil, bgColor: nil)
    }

    static func paragraph(_ text: String = "") -> MdBlock { make(.paragraph(text: text)) }

    /// Blöcke mit direkt tippbarem Text; alles andere wird als Ganzes gezeigt bzw. als Markdown bearbeitet.
    var isText: Bool {
        switch kind {
        case .paragraph, .heading, .listItem, .quote, .code: true
        default: false
        }
    }

    var isCode: Bool { if case .code = kind { true } else { false } }

    var isMath: Bool { if case .math = kind { true } else { false } }

    /// Code und Formeln: Enter bleibt ein Zeilenumbruch, keine Autokorrektur.
    var keepsNewlines: Bool { isCode || isMath }

    /// Blöcke mit eigenem Eingabefeld (Textblöcke und Formeln).
    var isEditable: Bool { isText || isMath }

    var isListOrQuote: Bool {
        switch kind {
        case .listItem, .quote: true
        default: false
        }
    }

    var indent: UInt32 { if case .listItem(_, let i, _) = kind { i } else { 0 } }

    var isChecked: Bool { if case .listItem(.todo(true), _, _) = kind { true } else { false } }

    var text: String {
        switch kind {
        case .paragraph(let t), .quote(let t): t
        case .heading(_, let t): t
        case .listItem(_, _, let t): t
        case .code(_, let t): t
        case .math(let t): t
        default: ""
        }
    }

    func withText(_ t: String) -> MdBlock {
        var b = self
        switch kind {
        case .paragraph: b.kind = .paragraph(text: t)
        case .heading(let level, _): b.kind = .heading(level: level, text: t)
        case .listItem(let style, let indent, _): b.kind = .listItem(style: style, indent: indent, text: t)
        case .quote: b.kind = .quote(text: t)
        case .code(let language, _): b.kind = .code(language: language, text: t)
        case .math: b.kind = .math(text: t)
        default: break
        }
        return b
    }

    var type: BlockType? {
        switch kind {
        case .paragraph: .text
        case .heading(.h1, _): .h1
        case .heading(.h2, _): .h2
        case .heading(.h3, _): .h3
        case .listItem(.bullet, _, _): .bullet
        case .listItem(.number, _, _): .number
        case .listItem(.todo, _, _): .todo
        case .quote: .quote
        case .code: .code
        default: nil
        }
    }

    /// In einen anderen Textblock umwandeln; Text, Einzug und Farben bleiben.
    func converted(to type: BlockType) -> MdBlock {
        let t = text
        var language = ""
        if case .code(let l, _) = kind { language = l }
        var b = self
        b.kind = switch type {
        case .text: .paragraph(text: t)
        case .h1: .heading(level: .h1, text: t)
        case .h2: .heading(level: .h2, text: t)
        case .h3: .heading(level: .h3, text: t)
        case .bullet: .listItem(style: .bullet, indent: indent, text: t)
        case .number: .listItem(style: .number, indent: indent, text: t)
        case .todo: .listItem(style: .todo(checked: false), indent: indent, text: t)
        case .quote: .quote(text: t)
        case .code: .code(language: language, text: t)
        }
        return b
    }

    /// Der Block, der beim Enter hinter diesem entsteht: Listen und Zitate setzen sich fort, sonst Absatz.
    func continuation() -> MdBlock {
        switch kind {
        case .listItem(let style, let indent, _):
            if case .todo = style { return .make(.listItem(style: .todo(checked: false), indent: indent, text: "")) }
            return .make(.listItem(style: style, indent: indent, text: ""))
        case .quote: return .make(.quote(text: ""))
        default: return .paragraph()
        }
    }

    func indented(_ delta: Int) -> MdBlock {
        guard case .listItem(let style, let indent, let t) = kind else { return self }
        var b = self
        b.kind = .listItem(style: style, indent: UInt32(min(max(Int(indent) + delta, 0), 6)), text: t)
        return b
    }

    func toggledTodo() -> MdBlock {
        guard case .listItem(.todo(let checked), let indent, let t) = kind else { return self }
        var b = self
        b.kind = .listItem(style: .todo(checked: !checked), indent: indent, text: t)
        return b
    }

    func toggledOpen() -> MdBlock {
        guard case .toggle(let summary, let isOpen, let children) = kind else { return self }
        var b = self
        b.kind = .toggle(summary: summary, open: !isOpen, children: children)
        return b
    }

    /// Platzhalter eines leeren Textblocks (editor.js `ph:`).
    var placeholder: String {
        switch kind {
        case .heading(.h1, _): "Überschrift 1"
        case .heading(.h2, _): "Überschrift 2"
        case .heading(.h3, _): "Überschrift 3"
        case .listItem(.todo, _, _): "To-do"
        case .listItem: "Liste"
        case .quote: "Zitat"
        default: ""
        }
    }
}

extension Array where Element == MdBlock {
    /// Wendet `f` auf den Block mit `id` an, auch wenn er in Callout, Toggle oder Spalten steckt.
    func mapDeep(_ id: String, _ f: (MdBlock) -> MdBlock) -> [MdBlock] {
        map { b in
            if b.id == id { return f(b) }
            var c = b
            switch b.kind {
            case .callout(let color, let children):
                c.kind = .callout(color: color, children: children.mapDeep(id, f))
            case .toggle(let summary, let isOpen, let children):
                c.kind = .toggle(summary: summary, open: isOpen, children: children.mapDeep(id, f))
            case .columns(let columns):
                c.kind = .columns(columns: columns.map { $0.mapDeep(id, f) })
            default: break
            }
            return c
        }
    }
}

/// Laufende Nummern nummerierter Listen je Ebene (wie `listNums` in editor.js).
func listNumbers(_ blocks: [MdBlock]) -> [String: Int] {
    var out: [String: Int] = [:]
    var counters = Array(repeating: 0, count: 8)
    for b in blocks {
        guard case .listItem(let style, let indent, _) = b.kind else {
            counters = Array(repeating: 0, count: 8)
            continue
        }
        let i = min(Int(indent), 7)
        for d in (i + 1)..<8 { counters[d] = 0 }
        if case .number = style {
            counters[i] += 1
            out[b.id] = counters[i]
        } else {
            counters[i] = 0
        }
    }
    return out
}

/// Blocktyp für ein Markdown-Kürzel am Blockanfang (TRANSFORMS in web/editor.js); `prefix` ist der Text
/// bis zum Caret, nur das volle Kürzel zählt.
func shortcutType(_ prefix: String) -> BlockType? {
    switch prefix {
    case "# ": .h1
    case "## ": .h2
    case "### ": .h3
    case "- ", "* ", "+ ": .bullet
    case "1. ", "1) ": .number
    case "[] ", "[ ] ": .todo
    case "> ": .quote
    default: nil
    }
}

/// Benannte Notizfarben der PWA (Text-, Hintergrund- und Callout-Farben), hell/dunkel.
func noteColor(_ name: String) -> Color {
    let hex: (light: UInt32, dark: UInt32) = switch name {
    case "red": (0xC4554D, 0xFF7369)
    case "orange": (0xCB7B37, 0xFFA344)
    case "yellow": (0xC29343, 0xFFDC49)
    case "green": (0x548164, 0x4DAB9A)
    case "blue": (0x487CA5, 0x529CCA)
    case "purple": (0x8A67AB, 0x9A6DD7)
    case "pink": (0xB35488, 0xE255A1)
    default: (0x787774, 0x9B9B9B)
    }
    return Color(uiColor: UIColor { $0.userInterfaceStyle == .dark ? UIColor(hex: hex.dark) : UIColor(hex: hex.light) })
}

/// Blob-ID eines Bildes oder einer Datei (`img:…`, `file:…`, Altformat `blob:<uuid>`), sonst nil.
func blobId(_ src: String) -> String? {
    if src.hasPrefix("img:") || src.hasPrefix("file:") { return src }
    if src.hasPrefix("blob:") {
        let id = String(src.dropFirst(5))
        return UUID(uuidString: id) != nil ? id : nil
    }
    return nil
}

/// Schrift je Blocktyp (editor.css: `.blk-text`, `.blk-h1…3`, `.blk-code`); gleich für Anzeige und Eingabe.
struct BlockFont {
    let size: CGFloat
    let weight: UIFont.Weight
    let mono: Bool
    /// Zeilenhöhe minus Schrifthöhe (25 px bei 16 px Text).
    let lineSpacing: CGFloat
    let kern: CGFloat

    var uiFont: UIFont {
        mono ? .monospacedSystemFont(ofSize: size, weight: weight) : .systemFont(ofSize: size, weight: weight)
    }

    var font: Font { Font(uiFont as CTFont) }

    static func of(_ block: MdBlock) -> BlockFont {
        switch block.kind {
        case .heading(.h1, _): BlockFont(size: 30, weight: .bold, mono: false, lineSpacing: 3, kern: -0.7)
        case .heading(.h2, _): BlockFont(size: 24, weight: .semibold, mono: false, lineSpacing: 2, kern: -0.4)
        case .heading(.h3, _): BlockFont(size: 20, weight: .semibold, mono: false, lineSpacing: 2, kern: 0)
        case .code: BlockFont(size: 13.6, weight: .regular, mono: true, lineSpacing: 5, kern: 0)
        default: BlockFont(size: 16, weight: .regular, mono: false, lineSpacing: 6, kern: 0)
        }
    }
}
