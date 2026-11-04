import SwiftUI
import UIKit

/// Inline-Markdown der PWA (web/editor-inline.js `inlineHtml`, wie `InlineMarkdown.kt`): fett, kursiv,
/// durchgestrichen, unterstrichen, Markierung `==…==`, Farben `{red}…{/}` / `{bg-red}…{/}`, Code,
/// Formeln `$…$`, Links und `[[Wiki-Links]]`. Einmal in Läufe zerlegt, daraus entstehen Anzeige
/// (Marker verschwinden), Live-Formatierung im Eingabefeld (Marker abgeblendet) und HTML für Formeln.
struct InlineStyle: Equatable {
    var bold = false
    var italic = false
    var strike = false
    var underline = false
    var code = false
    var color: String?
    var bg: String?
    var link: String?
}

struct InlineRun {
    enum Kind { case text, marker, math }
    let range: NSRange
    let kind: Kind
    let style: InlineStyle
}

private let inlinePattern: NSRegularExpression = {
    // Reihenfolge wie in editor-inline.js; Gruppen 1…15, siehe `walk`.
    let parts = [
        #"\[\[([^\]\n]+)\]\]"#,
        #"`([^`\n]+)`"#,
        #"\{(bg-)?(gray|red|orange|yellow|green|blue|purple|pink)\}([\s\S]*?)\{/\}"#,
        #"==([^=\n]+)=="#,
        #"\*\*\*([^*]+)\*\*\*"#,
        #"\*\*([^*]+)\*\*"#,
        #"~~([^~]+)~~"#,
        #"<u>([\s\S]*?)</u>"#,
        #"(?<![*\\])\*([^*\n]+)\*"#,
        #"\[([^\]]+)\]\(([^)\s]+)\)"#,
        #"(?<!\\)\$([^$\n]+?)(?<!\\)\$"#,
        #"\\\((.+?)\\\)"#,
    ]
    return try! NSRegularExpression(pattern: parts.joined(separator: "|"))
}()

private let safeHref = try! NSRegularExpression(pattern: #"^(https?:|mailto:|tel:|#)"#, options: .caseInsensitive)

/// Text in Läufe zerlegen (UTF-16-Bereiche des Originals, lückenlos).
func inlineRuns(_ text: String) -> [InlineRun] {
    let s = text as NSString
    var out: [InlineRun] = []
    walk(s, NSRange(location: 0, length: s.length), InlineStyle(), &out)
    return out
}

private func walk(_ s: NSString, _ range: NSRange, _ style: InlineStyle, _ out: inout [InlineRun]) {
    var pos = range.location
    let end = NSMaxRange(range)
    while pos < end, let m = inlinePattern.firstMatch(in: s as String, range: NSRange(location: pos, length: end - pos)) {
        let whole = m.range
        if whole.location > pos { out.append(InlineRun(range: NSRange(location: pos, length: whole.location - pos), kind: .text, style: style)) }
        func g(_ i: Int) -> NSRange? {
            let r = m.range(at: i)
            return r.location == NSNotFound || r.length == 0 ? nil : r
        }
        func marker(_ from: Int, _ to: Int) {
            if to > from { out.append(InlineRun(range: NSRange(location: from, length: to - from), kind: .marker, style: style)) }
        }
        func wrap(_ inner: NSRange, _ st: InlineStyle) {
            marker(whole.location, inner.location)
            walk(s, inner, st, &out)
            marker(NSMaxRange(inner), NSMaxRange(whole))
        }
        func plain(_ inner: NSRange, _ st: InlineStyle, kind: InlineRun.Kind = .text) {
            marker(whole.location, inner.location)
            out.append(InlineRun(range: inner, kind: kind, style: st))
            marker(NSMaxRange(inner), NSMaxRange(whole))
        }
        var st = style
        if let r = g(1) {
            st.link = "wiki:" + s.substring(with: r)
            plain(r, st)
        } else if let r = g(2) {
            st.code = true
            plain(r, st)
        } else if let name = g(4) {
            if g(3) != nil { st.bg = s.substring(with: name) } else { st.color = s.substring(with: name) }
            if let inner = g(5) { wrap(inner, st) } else { marker(whole.location, NSMaxRange(whole)) }
        } else if let r = g(6) {
            st.bg = "yellow"
            wrap(r, st)
        } else if let r = g(7) {
            st.bold = true
            st.italic = true
            wrap(r, st)
        } else if let r = g(8) {
            st.bold = true
            wrap(r, st)
        } else if let r = g(9) {
            st.strike = true
            wrap(r, st)
        } else if let r = g(10) {
            st.underline = true
            wrap(r, st)
        } else if let r = g(11) {
            st.italic = true
            wrap(r, st)
        } else if let label = g(12), let hrefRange = g(13) {
            let href = s.substring(with: hrefRange)
            if safeHref.firstMatch(in: href, range: NSRange(location: 0, length: (href as NSString).length)) != nil {
                st.link = href
                wrap(label, st)
            } else {
                out.append(InlineRun(range: whole, kind: .text, style: style))
            }
        } else if let r = g(14) ?? g(15) {
            plain(r, st, kind: .math)
        } else {
            out.append(InlineRun(range: whole, kind: .text, style: style))
        }
        pos = NSMaxRange(whole)
    }
    if pos < end { out.append(InlineRun(range: NSRange(location: pos, length: end - pos), kind: .text, style: style)) }
}

/// Ob der Text Inline-Formeln enthält (dann zeigt die Anzeige ihn mit KaTeX, `RichView`).
func hasInlineMath(_ text: String) -> Bool {
    text.contains("$") || text.contains("\\(") ? inlineRuns(text).contains { $0.kind == .math } : false
}

/// Link-Ziel als URL für SwiftUI-`Text`: Seiten über `impala://page/<id>`, Wiki-Links über
/// `impala://wiki/<titel>`; `NoteBody` fängt beide ab und öffnet die Seite.
func inlineLinkURL(_ target: String) -> URL? {
    if target.hasPrefix("wiki:") {
        let title = String(target.dropFirst(5)).addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? ""
        return URL(string: "impala://wiki/" + title)
    }
    if target.hasPrefix("#") { return URL(string: "impala://page/" + target.dropFirst()) }
    return URL(string: target)
}

/// Anzeige: Marker entfallen, Links sind antippbar.
func inlineMarkdown(_ text: String) -> AttributedString {
    let s = text as NSString
    var out = AttributedString()
    for run in inlineRuns(text) where run.kind != .marker {
        var a = AttributedString(s.substring(with: run.range))
        let st = run.style
        var intent: InlinePresentationIntent = []
        if st.bold { intent.insert(.stronglyEmphasized) }
        if st.italic || run.kind == .math { intent.insert(.emphasized) }
        if st.strike { intent.insert(.strikethrough) }
        if st.code { intent.insert(.code) }
        if !intent.isEmpty { a.inlinePresentationIntent = intent }
        if st.code {
            a.foregroundColor = noteColor("red")
            a.backgroundColor = Impala.surface
        }
        if st.underline { a.underlineStyle = .single }
        if let c = st.color { a.foregroundColor = noteColor(c) }
        if let b = st.bg { a.backgroundColor = noteColor(b).opacity(0.28) }
        if let l = st.link, let url = inlineLinkURL(l) {
            a.link = url
            a.foregroundColor = Impala.accent
            a.underlineStyle = .single
        }
        out.append(a)
    }
    return out
}

/// Live-Formatierung im Eingabefeld: der Text bleibt zeichengleich (Caret-Positionen stimmen),
/// Marker sind abgeblendet. Ändert nur Attribute, nicht den Text.
func styleInline(_ storage: NSTextStorage, base: [NSAttributedString.Key: Any], font: BlockFont) {
    let full = NSRange(location: 0, length: storage.length)
    storage.beginEditing()
    storage.setAttributes(base, range: full)
    for run in inlineRuns(storage.string) {
        let st = run.style
        var attrs: [NSAttributedString.Key: Any] = [:]
        var traits: UIFontDescriptor.SymbolicTraits = []
        if st.bold { traits.insert(.traitBold) }
        if st.italic { traits.insert(.traitItalic) }
        if st.code || run.kind == .math {
            attrs[.font] = UIFont.monospacedSystemFont(ofSize: font.size * 0.92, weight: st.bold ? .bold : .regular)
        } else if !traits.isEmpty, let d = font.uiFont.fontDescriptor.withSymbolicTraits(traits) {
            attrs[.font] = UIFont(descriptor: d, size: font.size)
        }
        if st.code { attrs[.foregroundColor] = UIColor(noteColor("red")) }
        if let c = st.color { attrs[.foregroundColor] = UIColor(noteColor(c)) }
        if let b = st.bg { attrs[.backgroundColor] = UIColor(noteColor(b).opacity(0.28)) }
        if st.strike { attrs[.strikethroughStyle] = NSUnderlineStyle.single.rawValue }
        if st.underline || st.link != nil { attrs[.underlineStyle] = NSUnderlineStyle.single.rawValue }
        if st.link != nil { attrs[.foregroundColor] = UIColor(Impala.accent) }
        if run.kind == .marker { attrs[.foregroundColor] = UIColor(Impala.text2).withAlphaComponent(0.55) }
        if !attrs.isEmpty { storage.addAttributes(attrs, range: run.range) }
    }
    storage.endEditing()
}

/// HTML eines Textblocks für die Anzeige mit gesetzten Inline-Formeln (KaTeX in `RichView`).
func inlineHTML(_ text: String) -> String {
    let s = text as NSString
    var html = ""
    for run in inlineRuns(text) where run.kind != .marker {
        let t = htmlEscape(s.substring(with: run.range))
        if run.kind == .math {
            html += "<span class=\"m\" data-tex=\"\(t)\">\(t)</span>"
            continue
        }
        let st = run.style
        var open = "", close = ""
        func tag(_ name: String, _ attrs: String = "") {
            open += "<\(name)\(attrs)>"
            close = "</\(name)>" + close
        }
        if st.bold { tag("b") }
        if st.italic { tag("i") }
        if st.strike { tag("s") }
        if st.underline || st.link != nil { tag("u") }
        if st.code { tag("code") }
        if let c = st.color { tag("span", " class=\"c-\(c)\"") }
        if let b = st.bg { tag("span", " class=\"bg-\(b)\"") }
        if st.link != nil { tag("span", " class=\"a\"") }
        html += open + t.replacingOccurrences(of: "\n", with: "<br>") + close
    }
    return html
}

func htmlEscape(_ s: String) -> String {
    s.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;")
        .replacingOccurrences(of: ">", with: "&gt;").replacingOccurrences(of: "\"", with: "&quot;")
}

/// Inline-Formate der Tastenkürzel und der Leiste (editor.js 1228–1237), Marker wie im Markdown.
enum InlineFormat: CaseIterable {
    case bold, italic, underline, strike, code, highlight

    var markers: (before: String, after: String) {
        switch self {
        case .bold: ("**", "**")
        case .italic: ("*", "*")
        case .underline: ("<u>", "</u>")
        case .strike: ("~~", "~~")
        case .code: ("`", "`")
        case .highlight: ("{bg-yellow}", "{/}")
        }
    }

    var label: String {
        switch self {
        case .bold: "Fett"
        case .italic: "Kursiv"
        case .underline: "Unterstrichen"
        case .strike: "Durchgestrichen"
        case .code: "Code"
        case .highlight: "Markieren"
        }
    }
}

/// `wrapSelection` (editor.js): Auswahl mit Markern umschließen – oder, wenn sie schon umschlossen ist,
/// die Marker entfernen. Ohne Auswahl entsteht ein leeres Markerpaar mit dem Caret dazwischen.
/// Positionen in UTF-16; liefert neuen Text und Caret.
func wrapMarkers(_ text: String, _ start: Int, _ end: Int, _ before: String, _ after: String) -> (String, Int) {
    let ns = text as NSString
    let s = min(max(start, 0), ns.length)
    let e = min(max(end, s), ns.length)
    let pre = ns.substring(to: s), mid = ns.substring(with: NSRange(location: s, length: e - s)), post = ns.substring(from: e)
    let b = (before as NSString).length, a = (after as NSString).length, m = (mid as NSString).length
    let midIsWrapped = mid.hasPrefix(before) && mid.hasSuffix(after) && m >= b + a &&
        (before != "*" || (mid.hasPrefix("***") && mid.hasSuffix("***")) || (!mid.hasPrefix("**") && !mid.hasSuffix("**")))
    if mid.isEmpty { return (pre + before + after + post, s + b) }
    if midIsWrapped {
        let inner = (mid as NSString).substring(with: NSRange(location: b, length: m - b - a))
        return (pre + inner + post, s + (inner as NSString).length)
    }
    if pre.hasSuffix(before), post.hasPrefix(after) {
        let p = (pre as NSString).substring(to: (pre as NSString).length - b)
        return (p + mid + (post as NSString).substring(from: a), s - b + m)
    }
    return (pre + before + mid + after + post, s + b + m + a)
}
