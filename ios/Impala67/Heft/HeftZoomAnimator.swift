import UIKit

/// Doppeltipp-Zoom wie `animateZoom` in `heft-viewport.js`: Der getippte Punkt bleibt unter dem Finger, das Heft
/// wächst um ihn herum. Eigene Animation je Frame statt `zoom(to:)`: Das schob die getippte Stelle in die
/// Bildschirmmitte, und die mitlaufenden Seitenränder (`contentInset`, je Zoomschritt neu) ließen die Seite am Ende
/// nachspringen. Hier folgt der Ausschnitt in jedem Schritt den Rändern, die zu genau diesem Zoom gehören.
@MainActor
final class HeftZoomAnimator: NSObject {
    private weak var scroll: UIScrollView?
    private var link: CADisplayLink?
    private var start: CFTimeInterval = 0
    private var from: CGFloat = 1
    private var to: CGFloat = 1
    /// Getippter Punkt in ungezoomten Inhaltskoordinaten …
    private var anchor: CGPoint = .zero
    /// … und seine Lage im sichtbaren Ausschnitt, die er behält.
    private var screen: CGPoint = .zero
    /// Wie `animateZoom` in der PWA (280 ms, easeOutCubic).
    private static let duration: CFTimeInterval = 0.28
    /// Wahr, solange ein eigener Zoomschritt läuft: `setZoomScale` meldet auch dann `scrollViewWillBeginZooming`,
    /// das darf die Animation nicht für einen Nutzer-Pinch halten und abbrechen.
    private(set) var stepping = false

    /// Ungezoomte Größe aller Seiten; je Schritt × Zoom als `contentSize` (wie `fitWidth`).
    private var base: CGSize = .zero

    /// Zoomt auf `target`; `p` ist der Tipp in (gezoomten) Inhaltskoordinaten des Scroll-Views.
    func zoom(_ scroll: UIScrollView, to target: CGFloat, at p: CGPoint, contentSize: CGSize) {
        stop()
        let z = max(scroll.zoomScale, 0.0001)
        self.scroll = scroll
        base = contentSize
        from = z
        to = target
        anchor = CGPoint(x: p.x / z, y: p.y / z)
        screen = CGPoint(x: p.x - scroll.contentOffset.x, y: p.y - scroll.contentOffset.y)
        if UIAccessibility.isReduceMotionEnabled {
            step(1)
            return
        }
        start = CACurrentMediaTime()
        let l = CADisplayLink(target: self, selector: #selector(tick))
        l.add(to: .main, forMode: .common)
        link = l
    }

    /// Bricht ab, z. B. wenn der Nutzer selbst schiebt oder zoomt.
    func stop() {
        link?.invalidate()
        link = nil
    }

    @objc private func tick() {
        let t = min(1, (CACurrentMediaTime() - start) / Self.duration)
        step(CGFloat(t))
        if t >= 1 { stop() }
    }

    private func step(_ t: CGFloat) {
        guard let scroll else { return stop() }
        stepping = true
        defer { stepping = false }
        let e = 1 - pow(1 - t, 3)
        let z = from + (to - from) * e
        // Ruft `scrollViewDidZoom` und setzt damit die Seitenränder für diesen Zoom.
        scroll.setZoomScale(z, animated: false)
        // Inhaltsgröße selbst setzen: Hinkt sie hinterher, klemmt der Ausschnitt unten an die alte Größe und das
        // Heft wächst von links oben statt um den Finger.
        scroll.contentSize = CGSize(width: base.width * z, height: base.height * z)
        let inset = scroll.contentInset
        let minX = -inset.left, minY = -inset.top
        let maxX = max(minX, scroll.contentSize.width + inset.right - scroll.bounds.width)
        let maxY = max(minY, scroll.contentSize.height + inset.bottom - scroll.bounds.height)
        let x = anchor.x * z - screen.x, y = anchor.y * z - screen.y
        scroll.setContentOffset(CGPoint(x: min(max(x, minX), maxX), y: min(max(y, minY), maxY)), animated: false)
    }
}
