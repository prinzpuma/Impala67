import PencilKit
import UIKit

/// Brücke zwischen dem Strichformat des Kerns (`HeftStroke`: Werkzeug `pen`/`marker`/`shape`, CSS-Farbe,
/// Breite, flache Punkte `[x, y, druck, …]` in Seitenkoordinaten) und PencilKit. Gespeichert und
/// gesynct wird immer nur das Kernformat, damit PWA, Android und iPad dieselben Hefte zeigen;
/// PencilKit-Striche entstehen daraus nur zum Zeichnen (wie `HeftInk.kt` mit androidx.ink).
enum HeftInk {
    /// Markerstriche: halbtransparent, dreifache Breite (heft.js `drawStroke`).
    static let markerAlpha: CGFloat = 0.32

    /// Strichbreite der PWA bei Druck `p` (heft.js `segW`): bei Druck 0,5 genau `size`.
    static func width(size: Double, pressure: Double) -> CGFloat {
        CGFloat(max(0.5, size * (0.4 + pressure * 1.2)))
    }

    /// Druck aus der Punktbreite – Umkehrung von [width], damit Hin- und Rückweg verlustfrei sind.
    static func pressure(width: CGFloat, size: Double) -> Float {
        guard size > 0 else { return 0.5 }
        return Float(min(1, max(0, (Double(width) / size - 0.4) / 1.2)))
    }

    /// Zeichenfähiger PencilKit-Strich aus Kerndaten; `nil` ohne Punkte. Der `randomSeed` ist aus der
    /// Strich-ID abgeleitet und dient beim Vergleichen als Schlüssel (`HeftCanvas`).
    static func pkStroke(_ s: HeftStroke, seed: UInt32) -> PKStroke? {
        let p = points(s)
        let n = p.count / 3
        guard n > 0 else { return nil }
        let marker = s.tool == "marker"
        let color = UIColor(css: s.color)
        let ink = PKInk(marker ? .marker : .pen, color: marker ? color.withAlphaComponent(markerAlpha) : color)
        var points: [PKStrokePoint] = []
        points.reserveCapacity(n)
        for i in 0..<n {
            var pr = Double(p[i * 3 + 2])
            if pr.isNaN { pr = 0.5 }
            pr = s.tool == "shape" ? 0.5 : min(1, max(0, pr))
            let w = marker ? CGFloat(s.size * 3) : width(size: s.size, pressure: pr)
            points.append(PKStrokePoint(
                location: CGPoint(x: CGFloat(p[i * 3]), y: CGFloat(p[i * 3 + 1])),
                timeOffset: TimeInterval(i) * 0.008,
                size: CGSize(width: w, height: w),
                opacity: 1, force: CGFloat(pr), azimuth: 0, altitude: .pi / 2
            ))
        }
        let path = PKStrokePath(controlPoints: points, creationDate: Date())
        return PKStroke(ink: ink, path: path, transform: .identity, mask: nil, randomSeed: seed)
    }

    /// Punkte zum Zeichnen: Formen (`tool` „shape“) speichern keine Punkte, nur ihre Geometrie; der Umriss
    /// kommt aus dem Kern (`heftShapeOutline`, `[x, y, …]`) und bekommt Druck 0,5.
    static func points(_ s: HeftStroke) -> [Float] {
        guard s.points.isEmpty, let shape = s.shape else { return s.points }
        let o = heftShapeOutline(shape: shape)
        var out: [Float] = []
        out.reserveCapacity(o.count / 2 * 3)
        for i in stride(from: 0, to: o.count - 1, by: 2) { out += [o[i], o[i + 1], 0.5] }
        return out
    }

    /// Neuer Strich vom Stift im Kernformat. `size` kommt vom Werkzeug (PencilKit kennt nur Punktbreiten).
    static func coreStroke(_ stroke: PKStroke, toolWidth: CGFloat) -> (tool: String, color: String, size: Double, points: [Float]) {
        let marker = stroke.ink.inkType == .marker
        // Stift: Werkzeugbreite = Breite bei Druck 0,5 = size. Marker: size × 3.
        let size = Double(marker ? toolWidth / 3 : toolWidth)
        var out: [Float] = []
        out.reserveCapacity(stroke.path.count * 3)
        for point in stroke.path {
            let loc = point.location.applying(stroke.transform)
            out.append(Float(loc.x))
            out.append(Float(loc.y))
            out.append(marker ? 0.5 : pressure(width: point.size.width, size: size))
        }
        return (marker ? "marker" : "pen", stroke.ink.color.cssHex, (size * 100).rounded() / 100, out)
    }

    /// Fester Schlüssel aus der Strich-ID (FNV-1a), damit derselbe Strich nach dem Neuladen gleich bleibt.
    static func seed(_ id: String) -> UInt32 {
        var h: UInt32 = 2_166_136_261
        for b in id.utf8 { h = (h ^ UInt32(b)) &* 16_777_619 }
        return h
    }
}
