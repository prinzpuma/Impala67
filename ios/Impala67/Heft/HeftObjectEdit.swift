import SwiftUI
import UIKit

/// Bilder und Textfelder im Heft direkt auswählen (wie heft-input.js der PWA): Zeichnet der Finger nicht,
/// wählt ein Fingertipp aus; Halten mit dem Finger wählt immer aus (auch seitenfüllende Scans) und
/// verschiebt gleich weiter. Der Stift zeichnet immer. Auf der Auswahl verschiebt Ziehen, der Griff unten
/// rechts skaliert (Bilder mit festem Seitenverhältnis, Textfelder nur in der Breite), Antippen eines
/// ausgewählten Textfelds bearbeitet den Text. Liegt in Seitenkoordinaten über allen Ebenen und nimmt nur
/// auf der Auswahl Berührungen an; sonst geht alles an die Leinwand.
final class HeftSelectLayer: UIView, UIGestureRecognizerDelegate {
    enum Item: Equatable, Hashable {
        case image(String)
        case text(String)
    }

    /// Gewähltes Element (nil = nichts) – nach Antippen oder Halten.
    var onSelect: ((Item?) -> Void)?
    /// Während des Ziehens: neue Lage zur Vorschau.
    var onPreview: ((Item, CGRect) -> Void)?
    /// Ziehen beendet: neue Lage speichern.
    var onCommit: ((Item, CGRect) -> Void)?
    /// Antippen eines ausgewählten Textfelds.
    var onEditText: ((String) -> Void)?
    /// Halten hat ein Element gegriffen: angefangenen Fingerstrich verwerfen.
    var onHoldBegan: (() -> Void)?
    /// Zeichnet der Finger gerade? Dann wählt nur das Halten aus.
    var fingerDraws: () -> Bool = { false }
    /// Strich-Erkennung der Leinwand; Halten darf neben ihr anlaufen und bricht sie dann ab.
    weak var drawingRecognizer: UIGestureRecognizer?

    let pan = UIPanGestureRecognizer()
    /// Auf der Leinwand: Fingertipp bzw. Halten auf ein noch nicht gewähltes Element.
    let canvasTap = UITapGestureRecognizer()
    let canvasHold = UILongPressGestureRecognizer()
    private var targets: [(item: Item, frame: CGRect)] = []
    private(set) var selected: Item?
    private var frame0: CGRect?
    private var current: CGRect?
    private var holdStart: CGPoint?
    private var resizing = false
    private var zoom: CGFloat = 1
    private let outline = CAShapeLayer()
    private let handle = CAShapeLayer()
    /// Seitenfüllende Bilder (Scans, PDF-Seiten) nur per Halten – sonst griffe jeder Tipp die Seite.
    private static let pageArea: CGFloat = 1000 * 1414 * 0.6

    init() {
        super.init(frame: .zero)
        backgroundColor = .clear
        layer.anchorPoint = .zero
        outline.fillColor = UIColor.clear.cgColor
        outline.strokeColor = UIColor(Impala.accent).cgColor
        handle.fillColor = UIColor.white.cgColor
        handle.strokeColor = UIColor(Impala.accent).cgColor
        layer.addSublayer(outline)
        layer.addSublayer(handle)
        let tap = UITapGestureRecognizer(target: self, action: #selector(tapped(_:)))
        pan.addTarget(self, action: #selector(panned(_:)))
        pan.delegate = self
        pan.maximumNumberOfTouches = 1
        for g in [tap, pan] as [UIGestureRecognizer] { addGestureRecognizer(g) }
        let finger = [NSNumber(value: UITouch.TouchType.direct.rawValue)]
        canvasTap.addTarget(self, action: #selector(canvasTapped(_:)))
        canvasTap.allowedTouchTypes = finger
        canvasTap.cancelsTouchesInView = false
        canvasTap.delegate = self
        canvasHold.addTarget(self, action: #selector(held(_:)))
        canvasHold.allowedTouchTypes = finger
        canvasHold.minimumPressDuration = 0.45
        canvasHold.delegate = self
    }

    /// Nur die Auswahl samt Griff fängt Berührungen; alles andere zeichnet bzw. scrollt die Leinwand.
    override func point(inside point: CGPoint, with event: UIEvent?) -> Bool {
        guard let r = current ?? selected.flatMap(frame(of:)) else { return false }
        let pad = 26 / zoom
        return r.insetBy(dx: -pad, dy: -pad).contains(point)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError() }

    /// Elemente der geladenen Seiten (Koordinaten der durchlaufenden Heft-Ansicht); eine Auswahl bleibt,
    /// solange es das Element noch gibt.
    func configure(size: CGSize, pages: [HeftPlaced]) {
        bounds = CGRect(origin: .zero, size: size)
        targets = []
        for page in pages {
            let (o, data) = (page.origin, page.data)
            for im in data.images {
                targets.append((item: Item.image(im.id), frame: CGRect(x: im.x + o.x, y: im.y + o.y, width: im.w, height: im.h)))
            }
            for t in data.texts where !t.text.isEmpty {
                targets.append((item: Item.text(t.id), frame: HeftTextStyle.frame(t).offsetBy(dx: o.x, dy: o.y)))
            }
        }
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

    /// Oberstes Element unter `p` (Textfelder liegen über Bildern); `tap`: ohne seitenfüllende Bilder.
    private func hit(_ p: CGPoint, tap: Bool = false) -> Item? {
        targets.reversed().first {
            $0.frame.insetBy(dx: -6 / zoom, dy: -6 / zoom).contains(p)
                && !(tap && $0.frame.width * $0.frame.height > Self.pageArea)
        }?.item
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

    private func choose(_ item: Item?) {
        guard item != selected else { return }
        select(item)
        onSelect?(item)
    }

    /// Antippen der Auswahl: ein Textfeld öffnet sich zum Bearbeiten.
    @objc private func tapped(_ g: UITapGestureRecognizer) {
        if case .text(let id) = selected { onEditText?(id) }
    }

    /// Fingertipp auf die Leinwand (Finger zeichnet nicht): Element wählen, daneben die Auswahl aufheben.
    @objc private func canvasTapped(_ g: UITapGestureRecognizer) {
        let p = g.location(in: self)
        // Auf der Auswahl samt Griff gilt der Tipp ihr (Text bearbeiten), nicht dem Abwählen.
        if self.point(inside: p, with: nil) { return }
        choose(hit(p, tap: true))
    }

    /// Halten: Element wählen und mit demselben Finger gleich verschieben.
    @objc private func held(_ g: UILongPressGestureRecognizer) {
        let p = g.location(in: self)
        switch g.state {
        case .began:
            guard let item = hit(p) else { return }
            onHoldBegan?()
            choose(item)
            frame0 = frame(of: item)
            holdStart = p
            if AppHaptics.isEnabled { UIImpactFeedbackGenerator(style: .medium).impactOccurred() }
        case .changed, .ended, .cancelled:
            guard let item = selected, let r0 = frame0, let s = holdStart else { return }
            let r = r0.offsetBy(dx: p.x - s.x, dy: p.y - s.y)
            let moved = hypot(p.x - s.x, p.y - s.y) > 2
            if g.state == .changed {
                current = r
                redraw()
                onPreview?(item, r)
                return
            }
            holdStart = nil
            if g.state == .ended, moved {
                current = r
                redraw()
                onCommit?(item, r)
            } else {
                current = nil
                redraw()
                if moved { onPreview?(item, r0) }
            }
        default: break
        }
    }

    override func gestureRecognizerShouldBegin(_ g: UIGestureRecognizer) -> Bool {
        let p = g.location(in: self)
        if g === canvasTap { return !fingerDraws() && (selected != nil || hit(p, tap: true) != nil) }
        if g === canvasHold { return hit(p) != nil }
        guard g === pan else { return true }
        if selected != nil, onHandle(p) {
            resizing = true
        } else if let s = selected, frame(of: s)?.contains(p) == true {
            resizing = false
        } else {
            return false
        }
        frame0 = selected.flatMap(frame(of:))
        return frame0 != nil
    }

    /// Halten läuft neben dem Fingerstrich an (der dann abbricht), nie neben dem Scrollen.
    func gestureRecognizer(_ g: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool {
        (g === canvasHold && other === drawingRecognizer) || (g === canvasTap && other !== canvasHold)
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

/// Text eines Heft-Textfelds schreiben bzw. ändern (ausgewähltes Feld antippen, „Text schreiben“).
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
