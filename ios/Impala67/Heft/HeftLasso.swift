import PencilKit
import UIKit

/// Eigenes Lasso wie in GoodNotes (statt `PKLassoTool`, dessen Auswahl bei den hier fast durchsichtigen
/// PencilKit-Strichen unsichtbar blieb): Umkreisen wählt Striche aus, die überwiegend innerhalb liegen.
/// Die Auswahl zeigt einen gestrichelten Rahmen mit Griffen an den Ecken; Ziehen im Rahmen verschiebt,
/// Ziehen an einer Ecke skaliert (Seitenverhältnis fest, um die gegenüberliegende Ecke). Während des
/// Ziehens bewegt sich ein Bild der Auswahl; geschrieben wird erst beim Loslassen (über die Leinwand).
/// Liegt in Inhaltskoordinaten der Leinwand über allen Ebenen.
final class HeftLassoLayer: UIView, UIGestureRecognizerDelegate {
    /// Lasso geschlossen: Umriss in Inhaltskoordinaten.
    var onLasso: (([CGPoint]) -> Void)?
    /// Verschieben/Skalieren beginnt: Bild der Auswahl für die Vorschau (nil = keins).
    var onBegin: (() -> UIImage?)?
    /// Verschieben/Skalieren beendet: Transformation in Inhaltskoordinaten.
    var onCommit: ((CGAffineTransform) -> Void)?
    /// Neues Lasso bzw. Tipp neben die Auswahl hebt sie auf.
    var onClear: (() -> Void)?
    /// Zeichnet der Finger gerade? Sonst umkreist nur der Stift.
    var fingerDraws: () -> Bool = { false }

    /// Lasso-Werkzeug aktiv: Umkreisen statt Zeichnen.
    var active = false {
        didSet {
            draw.isEnabled = active
            tap.isEnabled = active
            if !active { show(nil) }
        }
    }

    /// Zieht das Lasso (auf der Leinwand angemeldet).
    let draw = UIPanGestureRecognizer()
    /// Tipp neben die Auswahl (auf der Leinwand angemeldet).
    let tap = UITapGestureRecognizer()
    /// Verschieben/Skalieren auf der Auswahl.
    let pan = UIPanGestureRecognizer()

    private(set) var box: CGRect?
    private var points: [CGPoint] = []
    private var zoom: CGFloat = 1
    private let path = CAShapeLayer()
    private let frameLayer = CAShapeLayer()
    private let handles = CAShapeLayer()
    private let snapshot = CALayer()
    private var corner: Int?
    private var start = CGPoint.zero
    private var drag = CGAffineTransform.identity

    init() {
        super.init(frame: .zero)
        backgroundColor = .clear
        layer.anchorPoint = .zero
        let accent = UIColor(Impala.accent).cgColor
        path.fillColor = UIColor(Impala.accent).withAlphaComponent(0.06).cgColor
        path.strokeColor = accent
        frameLayer.fillColor = UIColor(Impala.accent).withAlphaComponent(0.04).cgColor
        frameLayer.strokeColor = accent
        handles.fillColor = UIColor.white.cgColor
        handles.strokeColor = accent
        snapshot.anchorPoint = .zero
        snapshot.isHidden = true
        for l in [snapshot, frameLayer, handles, path] as [CALayer] { layer.addSublayer(l) }

        draw.addTarget(self, action: #selector(drawn(_:)))
        draw.maximumNumberOfTouches = 1
        draw.delegate = self
        draw.isEnabled = false
        tap.addTarget(self, action: #selector(tapped(_:)))
        tap.cancelsTouchesInView = false
        tap.delegate = self
        tap.isEnabled = false
        pan.addTarget(self, action: #selector(panned(_:)))
        pan.maximumNumberOfTouches = 1
        pan.delegate = self
        addGestureRecognizer(pan)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError() }

    func configure(size: CGSize) {
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        bounds = CGRect(origin: .zero, size: size)
        CATransaction.commit()
    }

    func follow(zoom: CGFloat) {
        self.zoom = max(zoom, 0.01)
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        transform = CGAffineTransform(scaleX: zoom, y: zoom)
        layer.position = .zero
        redraw()
        CATransaction.commit()
    }

    /// Auswahlrahmen zeigen (nil = keine Auswahl).
    func show(_ rect: CGRect?) {
        box = rect.map { $0.insetBy(dx: -6, dy: -6) }
        snapshot.isHidden = true
        snapshot.contents = nil
        drag = .identity
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        redraw()
        CATransaction.commit()
    }

    /// Nur der Auswahlrahmen samt Griffen fängt Berührungen; sonst gehen sie an die Leinwand.
    override func point(inside point: CGPoint, with event: UIEvent?) -> Bool {
        guard active, let box else { return false }
        let pad = 22 / zoom
        return box.insetBy(dx: -pad, dy: -pad).contains(point)
    }

    private var shown: CGRect? { box?.applying(drag) }

    private func corners(_ r: CGRect) -> [CGPoint] {
        [CGPoint(x: r.minX, y: r.minY), CGPoint(x: r.maxX, y: r.minY), CGPoint(x: r.maxX, y: r.maxY), CGPoint(x: r.minX, y: r.maxY)]
    }

    private func redraw() {
        let line = 1.5 / zoom
        path.lineWidth = line
        path.lineDashPattern = [NSNumber(value: Double(6 / zoom)), NSNumber(value: Double(4 / zoom))]
        if points.count > 1 {
            let p = CGMutablePath()
            p.addLines(between: points)
            p.closeSubpath()
            path.path = p
        } else {
            path.path = nil
        }
        guard let r = shown else {
            frameLayer.path = nil
            handles.path = nil
            return
        }
        frameLayer.lineWidth = line
        frameLayer.lineDashPattern = [NSNumber(value: Double(6 / zoom)), NSNumber(value: Double(4 / zoom))]
        frameLayer.path = CGPath(rect: r, transform: nil)
        let h = 7 / zoom
        let hp = CGMutablePath()
        for c in corners(r) { hp.addEllipse(in: CGRect(x: c.x - h, y: c.y - h, width: 2 * h, height: 2 * h)) }
        handles.lineWidth = line
        handles.path = hp
    }

    // MARK: Lasso ziehen

    @objc private func drawn(_ g: UIPanGestureRecognizer) {
        let p = g.location(in: self)
        switch g.state {
        case .began:
            if box != nil { onClear?() }
            points = [p]
        case .changed:
            // Ein Punkt je 2 Bildschirmpunkte reicht für den Umriss.
            if let last = points.last, hypot(p.x - last.x, p.y - last.y) * zoom < 2 { return }
            points.append(p)
        case .ended:
            let closed = points
            points = []
            if closed.count > 4 { onLasso?(closed) }
        default:
            points = []
        }
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        redraw()
        CATransaction.commit()
    }

    @objc private func tapped(_ g: UITapGestureRecognizer) {
        guard box != nil, !point(inside: g.location(in: self), with: nil) else { return }
        onClear?()
    }

    // MARK: Verschieben und Skalieren

    @objc private func panned(_ g: UIPanGestureRecognizer) {
        guard let box else { return }
        let p = g.location(in: self)
        switch g.state {
        case .began:
            start = p
            let pad = 22 / zoom
            corner = corners(box).firstIndex { hypot($0.x - p.x, $0.y - p.y) <= pad }
            CATransaction.begin()
            CATransaction.setDisableActions(true)
            snapshot.setAffineTransform(.identity)
            if let img = onBegin?() {
                snapshot.contents = img.cgImage
                snapshot.frame = box
                snapshot.isHidden = false
            }
            CATransaction.commit()
        case .changed:
            drag = currentTransform(p, box)
            CATransaction.begin()
            CATransaction.setDisableActions(true)
            // Ankerpunkt oben links: Inhalts-Transformation auf die Ebene umrechnen.
            let o = box.origin
            let m = CGAffineTransform(translationX: o.x, y: o.y).concatenating(drag).concatenating(CGAffineTransform(translationX: -o.x, y: -o.y))
            snapshot.setAffineTransform(m)
            snapshot.position = o
            redraw()
            CATransaction.commit()
        case .ended:
            let t = currentTransform(p, box)
            drag = t
            onCommit?(t)
        default:
            show(self.box.map { $0.insetBy(dx: 6, dy: 6) })
        }
    }

    private func currentTransform(_ p: CGPoint, _ box: CGRect) -> CGAffineTransform {
        guard let corner else { return CGAffineTransform(translationX: p.x - start.x, y: p.y - start.y) }
        // Gegenüberliegende Ecke bleibt; Maßstab aus dem Abstand zur Ecke (mindestens 10 %).
        let cs = corners(box)
        let fixed = cs[(corner + 2) % 4]
        let from = hypot(cs[corner].x - fixed.x, cs[corner].y - fixed.y)
        guard from > 0 else { return .identity }
        let s = max(0.1, hypot(p.x - fixed.x, p.y - fixed.y) / from)
        return CGAffineTransform(translationX: -fixed.x, y: -fixed.y)
            .concatenating(CGAffineTransform(scaleX: s, y: s))
            .concatenating(CGAffineTransform(translationX: fixed.x, y: fixed.y))
    }

    // MARK: Gesten

    override func gestureRecognizerShouldBegin(_ g: UIGestureRecognizer) -> Bool {
        if g === draw {
            guard active else { return false }
            // Auf der Auswahl verschiebt `pan`, nicht ein neues Lasso.
            if let box, box.insetBy(dx: -22 / zoom, dy: -22 / zoom).contains(g.location(in: self)) { return false }
            return true
        }
        return active
    }

    func gestureRecognizer(_ g: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
        guard g === draw else { return true }
        return touch.type == .pencil || fingerDraws()
    }

    /// Ob ein Strich überwiegend im Lasso liegt (über die Hälfte seiner Punkte, wie GoodNotes beim Umkreisen).
    static func contains(_ polygon: [CGPoint], stroke: PKStroke) -> Bool {
        let t = stroke.transform
        var inside = 0, total = 0
        for point in stroke.path.interpolatedPoints(by: .distance(6)) {
            total += 1
            if contains(polygon, point.location.applying(t)) { inside += 1 }
        }
        if total == 0, let first = stroke.path.first { return contains(polygon, first.location.applying(t)) }
        return total > 0 && inside * 2 > total
    }

    /// Punkt im Polygon (Strahlverfahren).
    static func contains(_ polygon: [CGPoint], _ p: CGPoint) -> Bool {
        var inside = false
        var j = polygon.count - 1
        for i in polygon.indices {
            let a = polygon[i], b = polygon[j]
            if (a.y > p.y) != (b.y > p.y), p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x { inside.toggle() }
            j = i
        }
        return inside
    }
}

/// Laserpointer wie in GoodNotes: ein leuchtend roter Strich, der nach kurzer Zeit verblasst und nie
/// gespeichert wird. Zum Zeigen beim Vorführen oder Erklären. Liegt in Inhaltskoordinaten über allem.
final class HeftLaserLayer: UIView, UIGestureRecognizerDelegate {
    /// Zieht den Laser (auf der Leinwand angemeldet).
    let draw = UIPanGestureRecognizer()
    var fingerDraws: () -> Bool = { false }
    var active = false {
        didSet {
            draw.isEnabled = active
            if !active { reset() }
        }
    }

    private var trail: [(p: CGPoint, t: CFTimeInterval)] = []
    private var zoom: CGFloat = 1
    private let line = CAShapeLayer()
    private var ticker: CADisplayLink?
    /// So lange bleibt ein Stück der Spur sichtbar.
    private static let life: CFTimeInterval = 0.7

    init() {
        super.init(frame: .zero)
        isUserInteractionEnabled = false
        backgroundColor = .clear
        layer.anchorPoint = .zero
        line.fillColor = nil
        line.strokeColor = UIColor(red: 1, green: 0.2, blue: 0.2, alpha: 1).cgColor
        line.lineCap = .round
        line.lineJoin = .round
        line.shadowColor = UIColor.red.cgColor
        line.shadowOpacity = 0.9
        line.shadowOffset = .zero
        layer.addSublayer(line)
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
        line.lineWidth = 4 / self.zoom
        line.shadowRadius = 6
        CATransaction.commit()
    }

    @objc private func drawn(_ g: UIPanGestureRecognizer) {
        switch g.state {
        case .began, .changed:
            trail.append((p: g.location(in: self), t: CACurrentMediaTime()))
            startTicker()
        default:
            break
        }
        render()
    }

    private func startTicker() {
        guard ticker == nil else { return }
        let link = CADisplayLink(target: self, selector: #selector(tick))
        link.add(to: .main, forMode: .common)
        ticker = link
    }

    @objc private func tick() {
        render()
        if trail.isEmpty {
            ticker?.invalidate()
            ticker = nil
        }
    }

    /// Alte Punkte fallen weg; die Spur wird zum Ende hin dünner sichtbar, indem sie einfach kürzer wird.
    private func render() {
        let now = CACurrentMediaTime()
        trail.removeAll { now - $0.t > Self.life }
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        if trail.count > 1 {
            let p = CGMutablePath()
            p.addLines(between: trail.map(\.p))
            line.path = p
        } else {
            line.path = nil
        }
        CATransaction.commit()
    }

    private func reset() {
        trail = []
        ticker?.invalidate()
        ticker = nil
        line.path = nil
    }

    override func gestureRecognizerShouldBegin(_ g: UIGestureRecognizer) -> Bool { active }

    func gestureRecognizer(_ g: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
        touch.type == .pencil || fingerDraws()
    }
}
