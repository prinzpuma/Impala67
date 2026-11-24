import PencilKit
import UIKit

/// Präziser Radierer wie in GoodNotes (Kern: `HeftEraseGesture`, PWA: `eraseAt` in heft-input.js): eigene
/// Geste statt PencilKits Radierer, damit nur die überfahrene Stelle verschwindet und die Reste als eigene
/// Striche im Kern landen. Zeigt den Radierer als Ring in echter Größe. Lage wie der Laser: liegt über der
/// ganzen Fläche und folgt dem Zoom, Koordinaten sind also Zeichenkoordinaten.
// funktion: heft.radierer-praezise
final class HeftEraseLayer: UIView, UIGestureRecognizerDelegate {
    let draw = UIPanGestureRecognizer()
    var fingerDraws: () -> Bool = { false }
    var onBegin: (CGPoint) -> Void = { _ in }
    var onMove: (CGPoint) -> Void = { _ in }
    var onEnd: () -> Void = {}
    /// Radius in Seiteneinheiten (`eraserSize`).
    var radius: CGFloat = 16
    /// `precise` oder `stroke` (aus der Leiste, `HeftToolSetting.eraserMode`).
    var mode = "precise"
    var active = false {
        didSet {
            draw.isEnabled = active
            if !active { ring.path = nil }
        }
    }

    private let ring = CAShapeLayer()
    private var zoom: CGFloat = 1

    init() {
        super.init(frame: .zero)
        isUserInteractionEnabled = false
        backgroundColor = .clear
        layer.anchorPoint = .zero
        ring.fillColor = nil
        ring.strokeColor = UIColor.systemGray.cgColor
        layer.addSublayer(ring)
        draw.addTarget(self, action: #selector(drawn(_:)))
        draw.maximumNumberOfTouches = 1
        draw.delegate = self
        draw.isEnabled = false
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError() }

    func configure(size: CGSize) {
        bounds = CGRect(origin: .zero, size: size)
    }

    func follow(zoom: CGFloat) {
        self.zoom = max(zoom, 0.01)
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        transform = CGAffineTransform(scaleX: zoom, y: zoom)
        layer.position = .zero
        ring.lineWidth = 1.5 / self.zoom
        CATransaction.commit()
    }

    @objc private func drawn(_ g: UIPanGestureRecognizer) {
        let p = g.location(in: self)
        switch g.state {
        case .began:
            show(p)
            onBegin(p)
        case .changed:
            show(p)
            onMove(p)
        default:
            ring.path = nil
            onEnd()
        }
    }

    private func show(_ p: CGPoint) {
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        ring.path = UIBezierPath(ovalIn: CGRect(x: p.x - radius, y: p.y - radius, width: radius * 2, height: radius * 2)).cgPath
        CATransaction.commit()
    }

    override func gestureRecognizerShouldBegin(_ g: UIGestureRecognizer) -> Bool { active }

    func gestureRecognizer(_ g: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
        touch.type == .pencil || fingerDraws()
    }
}

extension HeftInk {
    /// Strich um (dx, dy) verschoben (Lasso-Verschiebung, die bisher nur im PencilKit-Transform steckt).
    static func translated(_ s: HeftStroke, dx: Double, dy: Double) -> HeftStroke {
        var out = s
        let (fx, fy) = (Float(dx), Float(dy))
        out.points = s.points.enumerated().map { i, v in i % 3 == 0 ? v + fx : i % 3 == 1 ? v + fy : v }
        out.shape = s.shape.map { (shape: HeftShape) -> HeftShape in
            switch shape {
            case let .line(x1, y1, x2, y2): return .line(x1: x1 + dx, y1: y1 + dy, x2: x2 + dx, y2: y2 + dy)
            case let .rect(x1, y1, x2, y2): return .rect(x1: x1 + dx, y1: y1 + dy, x2: x2 + dx, y2: y2 + dy)
            case let .triangle(x1, y1, x2, y2, x3, y3):
                return .triangle(x1: x1 + dx, y1: y1 + dy, x2: x2 + dx, y2: y2 + dy, x3: x3 + dx, y3: y3 + dy)
            case let .arrow(x1, y1, x2, y2, h1x, h1y, h2x, h2y):
                return .arrow(x1: x1 + dx, y1: y1 + dy, x2: x2 + dx, y2: y2 + dy, h1x: h1x + dx, h1y: h1y + dy, h2x: h2x + dx, h2y: h2y + dy)
            case let .ellipse(cx, cy, rx, ry): return .ellipse(cx: cx + dx, cy: cy + dy, rx: rx, ry: ry)
            case let .circle(cx, cy, r): return .circle(cx: cx + dx, cy: cy + dy, r: r)
            }
        }
        return out
    }
}
