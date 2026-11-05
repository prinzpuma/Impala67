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

    /// Deckkraft der Tinte gespeicherter Striche im Canvas: PencilKit macht aus dicht gespeicherten Punkten
    /// (ältere PWA-Striche: 0,1–0,2 pt Abstand, viele doppelt) blasse bis unsichtbare Linien. Sichtbar zeichnet
    /// sie deshalb [HeftInkView] wie die PWA; PencilKit behält sie fast durchsichtig für Radierer und Lasso.
    static let hiddenAlpha: CGFloat = 0.01

    /// Gespeicherter (von [HeftInkView] gezeichneter) Strich statt frischer Stifteingabe?
    static func isHidden(_ stroke: PKStroke) -> Bool {
        stroke.ink.color.cgColor.alpha < 0.05
    }

    /// Zeichenfähiger PencilKit-Strich aus Kerndaten; `nil` ohne Punkte. Der `randomSeed` ist aus der
    /// Strich-ID abgeleitet und dient beim Vergleichen als Schlüssel (`HeftCanvas`). `hidden`: fast
    /// durchsichtig (Canvas, sichtbar über [HeftInkView]).
    static func pkStroke(_ s: HeftStroke, seed: UInt32, hidden: Bool = false) -> PKStroke? {
        let p = points(s)
        let n = p.count / 3
        guard n > 0 else { return nil }
        let marker = s.tool == "marker"
        let color = UIColor(css: s.color)
        // Gleichmäßige Linie wie die PWA (`drawStroke`: Segmente mit runder Kappe). Die Füller-Tinte formt
        // Striche nach Tempo und Kraft – bei gespeicherten Strichen (feste Zeitabstände, doppelte Punkte)
        // sah ältere Schrift damit verzerrt aus.
        let alpha = hidden ? hiddenAlpha : (marker ? markerAlpha : 1)
        let ink = PKInk(marker ? .marker : .monoline, color: color.withAlphaComponent(alpha))
        var points: [PKStrokePoint] = []
        points.reserveCapacity(n + 1)
        var last: CGPoint?
        for i in 0..<n {
            let loc = CGPoint(x: CGFloat(p[i * 3]), y: CGFloat(p[i * 3 + 1]))
            // Doppelte Punkte (Stift steht still) weglassen; PencilKit glättet sonst Knoten hinein.
            if let last, i < n - 1, abs(loc.x - last.x) < 0.05, abs(loc.y - last.y) < 0.05 { continue }
            last = loc
            var pr = Double(p[i * 3 + 2])
            if pr.isNaN { pr = 0.5 }
            pr = s.tool == "shape" ? 0.5 : min(1, max(0, pr))
            let w = marker ? CGFloat(s.size * 3) : width(size: s.size, pressure: pr)
            points.append(PKStrokePoint(
                location: loc,
                timeOffset: TimeInterval(points.count) * 0.008,
                size: CGSize(width: w, height: w),
                // Feste, normale Kraft: Der Druck steckt schon in `size`. Als Kraft weitergereicht machte ein
                // niedriger Druck (Stifte ohne Druckstufen speichern 0,12) die Striche blass bis unsichtbar.
                opacity: 1, force: 1, azimuth: 0, altitude: .pi / 2
            ))
        }
        // Ein einzelner Punkt (Tupfer, i-Punkt) braucht einen zweiten, sonst zeichnet PencilKit nichts.
        if points.count == 1, let only = points.first {
            points.append(PKStrokePoint(
                location: CGPoint(x: only.location.x + 0.01, y: only.location.y), timeOffset: 0.008,
                size: only.size, opacity: 1, force: 1, azimuth: 0, altitude: .pi / 2
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

    // MARK: Zeichnen wie die PWA (`drawStroke` in web/heft.js)

    /// Striche in einen Grafikkontext zeichnen (Seitenkoordinaten): Segmente als Kurven durch die
    /// Mittelpunkte mit runder Kappe, Breite je Segment aus dem Druck; Marker halbtransparent und
    /// dreifach breit; Formen als Umriss in Werkzeugbreite. Für Vorschau, Export und Handschrift-Erkennung.
    static func draw(_ strokes: [HeftStroke], in ctx: CGContext) {
        ctx.saveGState()
        ctx.setLineCap(.round)
        ctx.setLineJoin(.round)
        for s in strokes {
            let p = points(s)
            let n = p.count / 3
            guard n > 0 else { continue }
            let color = UIColor(css: s.color)
            let pt = { (i: Int) in CGPoint(x: CGFloat(p[i * 3]), y: CGFloat(p[i * 3 + 1])) }
            let pr = { (i: Int) -> Double in
                let v = Double(p[i * 3 + 2])
                return v.isNaN || v <= 0 ? 0.5 : min(1, v)
            }
            if s.tool == "marker" || s.tool == "shape" {
                let marker = s.tool == "marker"
                ctx.setStrokeColor(color.withAlphaComponent(marker ? markerAlpha : 1).cgColor)
                ctx.setLineWidth(CGFloat(marker ? s.size * 3 : s.size))
                ctx.beginPath()
                ctx.move(to: pt(0))
                for i in 1..<max(n, 1) { ctx.addLine(to: pt(i)) }
                if n == 1 { ctx.addLine(to: pt(0)) }
                ctx.strokePath()
                continue
            }
            ctx.setStrokeColor(color.cgColor)
            if n == 1 {
                let r = width(size: s.size, pressure: pr(0)) / 2
                ctx.setFillColor(color.cgColor)
                ctx.fillEllipse(in: CGRect(x: pt(0).x - r, y: pt(0).y - r, width: 2 * r, height: 2 * r))
                continue
            }
            var from = pt(0)
            for i in 1..<n {
                let cur = pt(i)
                let to = i < n - 1 ? CGPoint(x: (cur.x + pt(i + 1).x) / 2, y: (cur.y + pt(i + 1).y) / 2) : cur
                ctx.setLineWidth(width(size: s.size, pressure: (pr(i - 1) + pr(i)) / 2))
                ctx.beginPath()
                ctx.move(to: from)
                ctx.addQuadCurve(to: to, control: cur)
                ctx.strokePath()
                from = to
            }
        }
        ctx.restoreGState()
    }

    /// Umgebendes Rechteck der Punkte (ohne Strichbreite).
    static func bounds(_ strokes: [HeftStroke]) -> CGRect {
        var r = CGRect.null
        for s in strokes {
            let p = points(s)
            for i in stride(from: 0, to: p.count - 2, by: 3) {
                r = r.union(CGRect(x: CGFloat(p[i]), y: CGFloat(p[i + 1]), width: 0, height: 0))
            }
        }
        return r
    }

    /// Fester Schlüssel aus der Strich-ID (FNV-1a), damit derselbe Strich nach dem Neuladen gleich bleibt.
    static func seed(_ id: String) -> UInt32 {
        var h: UInt32 = 2_166_136_261
        for b in id.utf8 { h = (h ^ UInt32(b)) &* 16_777_619 }
        return h
    }
}
