import PencilKit
import UIKit

/// Sichtbare Striche des Canvas wie `drawStroke` der PWA. PencilKit macht aus dicht gespeicherten Punkten
/// (ältere PWA-Striche) blasse bis unsichtbare Linien; gespeicherte Striche liegen deshalb fast durchsichtig
/// im PencilKit-Canvas (Radierer, Lasso, Rückgängig arbeiten weiter darauf) und werden hier gezeichnet.
/// Frische Stiftstriche zeigt PencilKit selbst, bis die Seite neu geladen wird.
///
/// Quelle ist allein die aktuelle PencilKit-Zeichnung ([update]): Punkte, Punktbreiten und Lage (`transform`,
/// z. B. nach Lasso-Verschieben) kommen aus den Strichen dort – so bleibt diese Ebene immer deckungsgleich.
/// Eine Vektor-Ebene je Strich in Seitenkoordinaten, per Transform mit dem Zoom skaliert (wie das Papier).
final class HeftInkView: UIView {
    private struct Entry {
        var transform: CGAffineTransform
        var count: Int
        var layer: CAShapeLayer
    }

    private var entries: [UInt32: Entry] = [:]
    private var zoom: CGFloat = 1

    override init(frame: CGRect) {
        super.init(frame: frame)
        isUserInteractionEnabled = false
        backgroundColor = .clear
        layer.anchorPoint = .zero
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError() }

    func configure(size: CGSize) {
        bounds = CGRect(origin: .zero, size: size)
    }

    /// Nach jeder Änderung der PencilKit-Zeichnung: Ebenen für die gespeicherten (durchsichtigen) Striche
    /// anlegen, verschieben oder entfernen. Unveränderte Striche behalten ihre Ebene.
    func update(_ strokes: [PKStroke]) {
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        var next: [UInt32: Entry] = [:]
        var ordered: [CALayer] = []
        ordered.reserveCapacity(strokes.count)
        for stroke in strokes where HeftInk.isHidden(stroke) {
            let seed = stroke.randomSeed
            let count = stroke.path.count
            let entry: Entry
            if let e = entries[seed], e.transform == stroke.transform, e.count == count {
                entry = e
            } else {
                let l = entries[seed]?.layer ?? CAShapeLayer()
                Self.shape(l, stroke)
                l.contentsScale = traitCollection.displayScale * zoom
                entry = Entry(transform: stroke.transform, count: count, layer: l)
            }
            next[seed] = entry
            ordered.append(entry.layer)
        }
        entries = next
        layer.sublayers = ordered
        CATransaction.commit()
    }

    /// Dem Zoom des Canvas folgen (Ursprung oben links = Seitenursprung).
    func follow(zoom: CGFloat) {
        self.zoom = zoom
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        transform = CGAffineTransform(scaleX: zoom, y: zoom)
        layer.position = .zero
        let scale = traitCollection.displayScale * zoom
        for e in entries.values { e.layer.contentsScale = scale }
        CATransaction.commit()
    }

    /// Pfad wie die PWA: Kurven durch die Mittelpunkte, runde Kappe; Breite aus den Punktbreiten, die
    /// [HeftInk.pkStroke] aus dem gespeicherten Druck gesetzt hat (Mittelwert, eine Breite je Strich).
    private static func shape(_ l: CAShapeLayer, _ stroke: PKStroke) {
        let t = stroke.transform
        var pts: [CGPoint] = []
        var widths: CGFloat = 0
        pts.reserveCapacity(stroke.path.count)
        for p in stroke.path {
            pts.append(p.location.applying(t))
            widths += p.size.width
        }
        let path = CGMutablePath()
        if let first = pts.first {
            path.move(to: first)
            if pts.count == 1 {
                path.addLine(to: first)
            } else {
                for i in 1..<pts.count {
                    let cur = pts[i]
                    let to = i < pts.count - 1 ? CGPoint(x: (cur.x + pts[i + 1].x) / 2, y: (cur.y + pts[i + 1].y) / 2) : cur
                    path.addQuadCurve(to: to, control: cur)
                }
            }
        }
        // Lasso-Skalierung ändert die Breite mit.
        let scale = sqrt(abs(t.a * t.d - t.b * t.c))
        let marker = stroke.ink.inkType == .marker
        l.path = path
        l.fillColor = nil
        l.lineCap = .round
        l.lineJoin = .round
        l.lineWidth = max(0.5, widths / CGFloat(max(pts.count, 1)) * scale)
        l.strokeColor = stroke.ink.color.withAlphaComponent(marker ? HeftInk.markerAlpha : 1).cgColor
    }
}
