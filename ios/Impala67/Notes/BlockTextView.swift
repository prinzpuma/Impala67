import SwiftUI
import UIKit

/// Eingabefeld des aktiven Blocks. `UITextView`, weil SwiftUI weder die Rücktaste am Anfang noch das
/// Caret meldet; wächst mit dem Text (kein eigenes Scrollen). Enter landet als Zeilenumbruch im Text –
/// das Teilen übernimmt `NoteModel.edit`.
struct BlockTextView: UIViewRepresentable {
    let text: String
    let font: BlockFont
    let color: UIColor
    /// Code: kein Autokorrektur, keine typografischen Anführungszeichen.
    let code: Bool
    let focusToken: Int
    let cursor: Int?
    let onChange: (String, Int) -> Void
    let onCaret: (Int) -> Void
    let onBackspaceAtStart: () -> Void
    let onBlur: (Int) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> BlockUITextView {
        let v = BlockUITextView()
        v.isScrollEnabled = false
        v.backgroundColor = .clear
        v.textContainerInset = .zero
        v.textContainer.lineFragmentPadding = 0
        v.delegate = context.coordinator
        v.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        v.onBackspaceAtStart = { [weak coordinator = context.coordinator] in coordinator?.parent.onBackspaceAtStart() }
        return v
    }

    func updateUIView(_ v: BlockUITextView, context: Context) {
        let c = context.coordinator
        c.parent = self
        let attrs = attributes
        // Neu setzen nur bei anderem Text oder anderer Schrift – sonst stört es Autokorrektur und Diktat.
        let style = "\(font.size)|\(font.weight.rawValue)|\(font.mono)"
        if v.text != text || c.style != style {
            let selection = v.selectedRange
            v.attributedText = NSAttributedString(string: text, attributes: attrs)
            v.selectedRange = NSRange(location: min(selection.location, (text as NSString).length), length: 0)
            c.style = style
        }
        v.typingAttributes = attrs
        v.autocorrectionType = code ? .no : .default
        v.smartQuotesType = code ? .no : .default
        v.smartDashesType = code ? .no : .default
        v.autocapitalizationType = code ? .none : .sentences
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

    private var attributes: [NSAttributedString.Key: Any] {
        let p = NSMutableParagraphStyle()
        p.lineSpacing = font.lineSpacing
        return [.font: font.uiFont, .foregroundColor: color, .kern: font.kern, .paragraphStyle: p]
    }

    final class Coordinator: NSObject, UITextViewDelegate {
        var parent: BlockTextView
        var focusToken = -1
        var style = ""

        init(_ parent: BlockTextView) { self.parent = parent }

        func textViewDidChange(_ tv: UITextView) {
            parent.onChange(tv.text, tv.selectedRange.location)
        }

        func textViewDidChangeSelection(_ tv: UITextView) {
            parent.onCaret(tv.selectedRange.location)
        }

        func textViewDidEndEditing(_ tv: UITextView) {
            parent.onBlur(focusToken)
        }
    }
}

/// Meldet die Rücktaste bei leerer Auswahl am Textanfang, statt nichts zu tun.
final class BlockUITextView: UITextView {
    var onBackspaceAtStart: (() -> Void)?

    override func deleteBackward() {
        if selectedRange.location == 0, selectedRange.length == 0 {
            onBackspaceAtStart?()
            return
        }
        super.deleteBackward()
    }
}
