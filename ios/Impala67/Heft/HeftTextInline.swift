import UIKit

/// Text direkt auf der Seite schreiben wie in GoodNotes: ein Eingabefeld genau an der Stelle des
/// Textfelds, in derselben Schrift und Größe wie gezeichnet (`HeftTextStyle`). Antippen daneben, Esc
/// oder das Ausblenden der Tastatur übernimmt den Text. Liegt in gezoomten Koordinaten der Leinwand
/// (nicht skaliert, damit die Schrift beim Zoomen scharf bleibt).
final class HeftInlineText: UITextView, UITextViewDelegate {
    /// Schreiben beendet: der fertige Text.
    var onEnd: ((String) -> Void)?

    /// Linke obere Ecke und Breite des Felds in Inhaltskoordinaten (ungezoomt).
    private var origin = CGPoint.zero
    private var width: CGFloat = 400
    private var size: CGFloat = 30
    private var ink = UIColor.black
    private var zoom: CGFloat = 1

    init() {
        super.init(frame: .zero, textContainer: nil)
        delegate = self
        isScrollEnabled = false
        backgroundColor = UIColor.white.withAlphaComponent(0.35)
        layer.borderColor = UIColor(Impala.accent).cgColor
        layer.borderWidth = 1.5
        layer.cornerRadius = 6
        textContainer.lineFragmentPadding = 0
        autocorrectionType = .default
        smartDashesType = .no
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError() }

    func begin(text: String, origin: CGPoint, width: CGFloat, size: CGFloat, color: UIColor, zoom: CGFloat) {
        self.origin = origin
        self.width = width
        self.size = size
        ink = color
        self.zoom = max(zoom, 0.01)
        self.text = text
        relayout()
    }

    func follow(zoom: CGFloat) {
        self.zoom = max(zoom, 0.01)
        relayout()
    }

    private func relayout() {
        let s = size * zoom
        let p = NSMutableParagraphStyle()
        p.minimumLineHeight = s * HeftTextStyle.lineHeight
        p.maximumLineHeight = s * HeftTextStyle.lineHeight
        p.lineBreakMode = .byWordWrapping
        let attrs: [NSAttributedString.Key: Any] = [.font: HeftTextStyle.font(s), .foregroundColor: ink, .paragraphStyle: p]
        typingAttributes = attrs
        let sel = selectedRange
        attributedText = NSAttributedString(string: text ?? "", attributes: attrs)
        selectedRange = sel
        tintColor = UIColor(Impala.accent)
        let pad = HeftTextStyle.pad * zoom
        textContainerInset = UIEdgeInsets(top: pad, left: pad, bottom: pad, right: pad)
        let w = width * zoom
        let h = max(s * HeftTextStyle.lineHeight + 2 * pad, sizeThatFits(CGSize(width: w, height: .greatestFiniteMagnitude)).height)
        frame = CGRect(x: origin.x * zoom, y: origin.y * zoom, width: w, height: h)
    }

    func textViewDidChange(_ textView: UITextView) {
        let w = width * zoom
        let pad = HeftTextStyle.pad * zoom
        let h = max(size * zoom * HeftTextStyle.lineHeight + 2 * pad, sizeThatFits(CGSize(width: w, height: .greatestFiniteMagnitude)).height)
        if abs(frame.height - h) > 0.5 { frame.size.height = h }
    }

    func textViewDidEndEditing(_ textView: UITextView) {
        onEnd?(text ?? "")
    }

    override var keyCommands: [UIKeyCommand]? {
        let esc = UIKeyCommand(input: UIKeyCommand.inputEscape, modifierFlags: [], action: #selector(finish))
        esc.wantsPriorityOverSystemBehavior = true
        return [esc] + (super.keyCommands ?? [])
    }

    @objc private func finish() { _ = resignFirstResponder() }
}
