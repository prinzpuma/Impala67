import SwiftUI
import UIKit

/// Auswahl im Heft („Bilder & Texte auswählen & bearbeiten“ der PWA, Werkzeug `select`): Antippen wählt
/// ein Bild oder Textfeld, Ziehen verschiebt es, der Griff unten rechts skaliert (Bilder mit festem
/// Seitenverhältnis, Textfelder nur in der Breite), Doppeltipp auf ein Textfeld bearbeitet den Text.
/// Liegt in Seitenkoordinaten über allen Ebenen und nimmt nur im Auswahlmodus Berührungen an; ein Ziehen
/// außerhalb der Auswahl scrollt weiter die Seite.
final class HeftSelectLayer: UIView, UIGestureRecognizerDelegate {
    enum Item: Equatable, Hashable {
        case image(String)
        case text(String)
    }

    /// Gewähltes Element (nil = nichts) – nach Antippen oder Ziehen.
    var onSelect: ((Item?) -> Void)?
    /// Während des Ziehens: neue Lage zur Vorschau.
    var onPreview: ((Item, CGRect) -> Void)?
    /// Ziehen beendet: neue Lage speichern.
    var onCommit: ((Item, CGRect) -> Void)?
    /// Doppeltipp auf ein Textfeld.
    var onEditText: ((String) -> Void)?

    let pan = UIPanGestureRecognizer()
    private var targets: [(item: Item, frame: CGRect)] = []
    private(set) var selected: Item?
    private var frame0: CGRect?
    private var current: CGRect?
    private var resizing = false
    private var zoom: CGFloat = 1
    private let outline = CAShapeLayer()
    private let handle = CAShapeLayer()

    init() {
        super.init(frame: .zero)
        backgroundColor = .clear
        layer.anchorPoint = .zero
        isUserInteractionEnabled = false
        outline.fillColor = UIColor.clear.cgColor
        outline.strokeColor = UIColor(Impala.accent).cgColor
        handle.fillColor = UIColor.white.cgColor
        handle.strokeColor = UIColor(Impala.accent).cgColor
        layer.addSublayer(outline)
        layer.addSublayer(handle)
        let double = UITapGestureRecognizer(target: self, action: #selector(doubleTapped(_:)))
        double.numberOfTapsRequired = 2
        let tap = UITapGestureRecognizer(target: self, action: #selector(tapped(_:)))
        tap.require(toFail: double)
        pan.addTarget(self, action: #selector(panned(_:)))
        pan.delegate = self
        pan.maximumNumberOfTouches = 1
        for g in [double, tap, pan] as [UIGestureRecognizer] { addGestureRecognizer(g) }
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError() }

    /// Elemente der Seite; eine Auswahl bleibt, solange es das Element noch gibt.
    func configure(size: CGSize, data: HeftPageData) {
        bounds = CGRect(origin: .zero, size: size)
        targets = data.images.map { (.image($0.id), CGRect(x: $0.x, y: $0.y, width: $0.w, height: $0.h)) }
            + data.texts.filter { !$0.text.isEmpty }.map { (.text($0.id), HeftTextStyle.frame($0)) }
        if let s = selected, !targets.contains(where: { $0.item == s }) { selected = nil }
        current = nil
        redraw()
    }

    func follow(zoom: CGFloat) {
        self.zoom = zoom
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        transform = CGAffineTransform(scaleX: zoom, y: zoom)
        layer.position = .zero
        CATransaction.commit()
        redraw()
    }

    func select(_ item: Item?) {
        selected = item
        current = nil
        redraw()
    }

    private func frame(of item: Item) -> CGRect? { targets.first { $0.item == item }?.frame }

    /// Oberstes Element unter `p` (Textfelder liegen über Bildern).
    private func hit(_ p: CGPoint) -> Item? {
        targets.reversed().first { $0.frame.insetBy(dx: -6 / zoom, dy: -6 / zoom).contains(p) }?.item
    }

    private var handleRadius: CGFloat { 9 / zoom }

    private func onHandle(_ p: CGPoint) -> Bool {
        guard let r = current ?? selected.flatMap(frame(of:)) else { return false }
        return hypot(p.x - r.maxX, p.y - r.maxY) <= 26 / zoom
    }

    private func redraw() {
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        defer { CATransaction.commit() }
        guard let r = current ?? selected.flatMap(frame(of:)) else {
            outline.path = nil
            handle.path = nil
            return
        }
        outline.lineWidth = 2 / zoom
        outline.lineDashPattern = [NSNumber(value: Double(6 / zoom)), NSNumber(value: Double(4 / zoom))]
        outline.path = UIBezierPath(rect: r).cgPath
        handle.lineWidth = 2 / zoom
        let h = handleRadius
        handle.path = UIBezierPath(ovalIn: CGRect(x: r.maxX - h, y: r.maxY - h, width: 2 * h, height: 2 * h)).cgPath
    }

    @objc private func tapped(_ g: UITapGestureRecognizer) {
        let item = hit(g.location(in: self))
        select(item)
        onSelect?(item)
    }

    @objc private func doubleTapped(_ g: UITapGestureRecognizer) {
        guard let item = hit(g.location(in: self)) else { return }
        select(item)
        onSelect?(item)
        if case .text(let id) = item { onEditText?(id) }
    }

    /// Nur auf der Auswahl, ihrem Griff oder einem anderen Element; sonst scrollt die Seite.
    override func gestureRecognizerShouldBegin(_ g: UIGestureRecognizer) -> Bool {
        guard g === pan else { return true }
        let p = g.location(in: self)
        if selected != nil, onHandle(p) {
            resizing = true
        } else if let s = selected, frame(of: s)?.contains(p) == true {
            resizing = false
        } else if let other = hit(p) {
            select(other)
            onSelect?(other)
            resizing = false
        } else {
            return false
        }
        frame0 = selected.flatMap(frame(of:))
        return frame0 != nil
    }

    @objc private func panned(_ g: UIPanGestureRecognizer) {
        guard let item = selected, let r0 = frame0 else { return }
        let t = g.translation(in: self)
        var r = r0
        if resizing {
            switch item {
            case .image:
                let w = max(40, r0.width + t.x)
                r.size = CGSize(width: w, height: w * r0.height / max(r0.width, 1))
            case .text:
                r.size.width = max(80, r0.width + t.x)
            }
        } else {
            r = r0.offsetBy(dx: t.x, dy: t.y)
        }
        switch g.state {
        case .changed:
            current = r
            redraw()
            onPreview?(item, r)
        case .ended:
            current = r
            redraw()
            onCommit?(item, r)
        case .cancelled, .failed:
            current = nil
            redraw()
            onPreview?(item, r0)
        default: break
        }
    }
}

/// Text eines Heft-Textfelds schreiben bzw. ändern (Doppeltipp, „Text schreiben“).
struct HeftTextSheet: View {
    let title: String
    let initial: String
    let canDelete: Bool
    let onSave: (String) -> Void
    let onDelete: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @FocusState private var focused: Bool

    var body: some View {
        NavigationStack {
            TextEditor(text: $text)
                .font(.system(size: TextSize.lg, design: .rounded))
                .focused($focused)
                .padding(Space.s3)
                .navigationTitle(title)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Abbrechen") { dismiss() } }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Fertig") {
                            onSave(text)
                            dismiss()
                        }
                        .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !canDelete)
                    }
                    if canDelete {
                        ToolbarItem(placement: .bottomBar) {
                            Button("Textfeld löschen", role: .destructive) {
                                onDelete()
                                dismiss()
                            }
                        }
                    }
                }
        }
        .onAppear {
            text = initial
            focused = true
        }
    }
}

/// Verbindung zwischen Heft-Leiste (SwiftUI) und Leinwand: Modi, Auswahl und offene Blätter.
@MainActor @Observable
final class HeftCanvasLink {
    /// „Bilder & Texte auswählen & bearbeiten“.
    var selecting = false
    /// „Handschrift → Text“: der nächste Strich umkreist die Handschrift.
    var lassoText = false
    var selection: HeftSelectLayer.Item?
    /// Textfeld wird geschrieben bzw. bearbeitet.
    var textEdit: HeftTextEdit?
    /// Ergebnis der Handschrifterkennung.
    var ocr: HeftOcrResult?
    @ObservationIgnored weak var coordinator: HeftCanvas.Coordinator?
}

/// Textfeld im Blatt `HeftTextSheet`: `id` nil = neues Feld.
struct HeftTextEdit: Identifiable {
    var textId: String?
    var text: String
    var id: String { textId ?? "new" }
}
