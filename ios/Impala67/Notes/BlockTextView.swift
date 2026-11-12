import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// Eingabefeld des aktiven Blocks. `UITextView`, weil SwiftUI weder die Rücktaste am Anfang noch Auswahl
/// und Tastenkürzel meldet; wächst mit dem Text (kein eigenes Scrollen). Enter landet als Zeilenumbruch
/// im Text – das Teilen übernimmt `NoteModel.edit`. Inline-Markdown wird live formatiert (Marker
/// abgeblendet), Code und Formeln bleiben roh.
struct BlockTextView: UIViewRepresentable {
    let text: String
    let font: BlockFont
    let color: UIColor
    /// Code und Formeln: keine Autokorrektur, keine typografischen Anführungszeichen, keine Formatierung.
    let raw: Bool
    let focusToken: Int
    let cursor: Int?
    let onChange: (String, Int) -> Void
    let onSelection: (NSRange) -> Void
    let onBackspaceAtStart: () -> Void
    let onBlur: (Int) -> Void
    /// Ob die Taste hier etwas tut (sonst normales Verhalten des Textfelds), und was sie tut.
    let wants: (BlockKey, String) -> Bool
    let onKey: (BlockKey) -> Void
    /// Bilder in der Zwischenablage (ohne Text) werden nicht in den Text, sondern als Bildblock eingefügt.
    let onPasteImages: ([(data: Data, mime: String)]) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> BlockUITextView {
        let v = BlockUITextView()
        v.isScrollEnabled = false
        v.backgroundColor = .clear
        v.textContainerInset = .zero
        v.textContainer.lineFragmentPadding = 0
        v.delegate = context.coordinator
        v.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        weak var c = context.coordinator
        v.onBackspaceAtStart = { c?.parent.onBackspaceAtStart() }
        v.wants = { key, text in c?.parent.wants(key, text) ?? false }
        v.onKey = { c?.parent.onKey($0) }
        v.onPasteImages = { c?.parent.onPasteImages($0) }
        return v
    }

    func updateUIView(_ v: BlockUITextView, context: Context) {
        let c = context.coordinator
        c.parent = self
        // Neu setzen nur bei anderem Text oder anderer Schrift – sonst stört es Autokorrektur und Diktat.
        let style = "\(font.size)|\(font.weight.rawValue)|\(font.mono)|\(raw)"
        if v.text != text || c.style != style {
            let selection = v.selectedRange
            v.attributedText = NSAttributedString(string: text, attributes: baseAttributes)
            v.selectedRange = NSRange(location: min(selection.location, (text as NSString).length), length: 0)
            c.style = style
            c.restyle(v)
        }
        v.typingAttributes = baseAttributes
        v.autocorrectionType = raw ? .no : .default
        v.smartQuotesType = raw ? .no : .default
        v.smartDashesType = raw ? .no : .default
        v.autocapitalizationType = raw ? .none : .sentences
        if c.focusToken != focusToken {
            c.focusToken = focusToken
            let target = cursor
            DispatchQueue.main.async {
                v.becomeFirstResponder()
                let len = (v.text as NSString).length
                v.selectedRange = NSRange(location: min(target ?? len, len), length: 0)
            }
        }
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView: BlockUITextView, context: Context) -> CGSize? {
        let width = proposal.width ?? 600
        let fit = uiView.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude))
        return CGSize(width: width, height: ceil(fit.height))
    }

    fileprivate var baseAttributes: [NSAttributedString.Key: Any] {
        let p = NSMutableParagraphStyle()
        p.lineSpacing = font.lineSpacing
        return [.font: font.uiFont, .foregroundColor: color, .kern: font.kern, .paragraphStyle: p]
    }

    final class Coordinator: NSObject, UITextViewDelegate {
        var parent: BlockTextView
        var focusToken = -1
        var style = ""

        init(_ parent: BlockTextView) { self.parent = parent }

        func restyle(_ tv: UITextView) {
            guard !parent.raw, tv.markedTextRange == nil else { return }
            styleInline(tv.textStorage, base: parent.baseAttributes, font: parent.font)
        }

        func textViewDidChange(_ tv: UITextView) {
            restyle(tv)
            parent.onChange(tv.text, tv.selectedRange.location)
        }

        func textViewDidChangeSelection(_ tv: UITextView) {
            parent.onSelection(tv.selectedRange)
        }

        func textViewDidEndEditing(_ tv: UITextView) {
            parent.onBlur(focusToken)
        }
    }
}

/// Meldet die Rücktaste am Textanfang und Tastenkürzel der Hardware-Tastatur.
final class BlockUITextView: UITextView {
    var onBackspaceAtStart: (() -> Void)?
    var wants: ((BlockKey, String) -> Bool)?
    var onKey: ((BlockKey) -> Void)?
    var onPasteImages: (([(data: Data, mime: String)]) -> Void)?

    /// Nur Bilder in der Zwischenablage: als Bildblöcke einfügen (PNG bleibt PNG, sonst JPEG).
    override func paste(_ sender: Any?) {
        let pb = UIPasteboard.general
        guard pb.hasImages, !pb.hasStrings, !pb.hasURLs, let onPasteImages else { return super.paste(sender) }
        let images: [(data: Data, mime: String)] = pb.itemProviders.indices.compactMap { i in
            if let png = pb.data(forPasteboardType: UTType.png.identifier, inItemSet: IndexSet(integer: i))?.first { return (png, "image/png") }
            return pb.images.flatMap { $0.indices.contains(i) ? $0[i].jpegData(compressionQuality: 0.85) : nil }.map { ($0, "image/jpeg") }
        }
        if !images.isEmpty { onPasteImages(images) }
    }

    override func canPerformAction(_ action: Selector, withSender sender: Any?) -> Bool {
        if action == #selector(paste(_:)), UIPasteboard.general.hasImages { return true }
        return super.canPerformAction(action, withSender: sender)
    }

    override func deleteBackward() {
        if selectedRange.location == 0, selectedRange.length == 0 {
            onBackspaceAtStart?()
            return
        }
        super.deleteBackward()
    }

    private static let bindings: [(String, UIKeyModifierFlags, BlockKey, String?)] = [
        ("\t", [], .tab, nil),
        ("\t", .shift, .shiftTab, nil),
        (UIKeyCommand.inputUpArrow, [], .up, nil),
        (UIKeyCommand.inputDownArrow, [], .down, nil),
        (UIKeyCommand.inputEscape, [], .escape, nil),
        ("\r", .shift, .softBreak, nil),
        (UIKeyCommand.inputDelete, [], .deleteForward, nil),
        ("b", .command, .format(.bold), "Fett"),
        ("i", .command, .format(.italic), "Kursiv"),
        ("u", .command, .format(.underline), "Unterstrichen"),
        ("e", .command, .format(.code), "Code"),
        ("s", [.command, .shift], .format(.strike), "Durchgestrichen"),
        ("h", [.command, .shift], .format(.highlight), "Markieren"),
        ("k", .command, .link, "Link einfügen"),
        ("z", .command, .undo, "Rückgängig"),
        ("z", [.command, .shift], .redo, "Wiederholen"),
        ("d", .command, .duplicate, "Duplizieren"),
        ("a", .command, .selectAll, "Alle Blöcke auswählen"),
        (UIKeyCommand.inputUpArrow, [.command, .shift], .moveUp, "Nach oben"),
        (UIKeyCommand.inputDownArrow, [.command, .shift], .moveDown, "Nach unten"),
    ]

    override var keyCommands: [UIKeyCommand]? {
        guard isFirstResponder else { return super.keyCommands }
        let current = text ?? ""
        var out: [UIKeyCommand] = []
        for (i, b) in Self.bindings.enumerated() where wants?(b.2, current) == true {
            let cmd = UIKeyCommand(title: b.3 ?? "", action: #selector(runKey(_:)), input: b.0, modifierFlags: b.1,
                                   propertyList: i)
            cmd.wantsPriorityOverSystemBehavior = true
            out.append(cmd)
        }
        return out + (super.keyCommands ?? [])
    }

    @objc private func runKey(_ sender: UIKeyCommand) {
        guard let i = sender.propertyList as? Int, Self.bindings.indices.contains(i) else { return }
        onKey?(Self.bindings[i].2)
    }
}
