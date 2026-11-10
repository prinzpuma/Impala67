import PencilKit
import UIKit

/// Sichtbare gespeicherte Striche: von PencilKit selbst mit derselben Tinte wie beim Schreiben gezeichnet
/// (`PKDrawing.image`, sonst sähe die Schrift nach dem Neuladen anders aus als beim Schreiben) in eine
/// Seiten-Bitmap fester Auflösung; bei starkem Zoom kommt wie
/// die Detail-Kacheln in heft-viewport.js eine scharfe Bitmap des sichtbaren Ausschnitts darüber.
/// Während einer Geste wird nur die fertige Bitmap mitskaliert (billig); gezeichnet wird im Hintergrund.
///
/// PencilKit hält dieselben Striche fast durchsichtig (Radierer, Lasso, Rückgängig). Frische Stiftstriche
/// zeigt PencilKit selbst, bis die Seite neu geladen wird. Bei Änderungen wird nur der betroffene Bereich
/// neu gezeichnet (gelöschte, verschobene, neue Striche), nicht die ganze Seite.
final class HeftInkView: UIView {
    /// Ein gespeicherter Strich, wie er gerade liegt: Kerndaten und Lage seit dem Laden (Lasso-Verschieben).
    struct Item {
        let data: HeftStroke
        let transform: CGAffineTransform
        /// Umgebendes Rechteck in Seitenkoordinaten inklusive Strichbreite.
        let bounds: CGRect
    }

    private struct Key: Hashable {
        let id: String
        let a, b, c, d, tx, ty: CGFloat
        init(_ id: String, _ t: CGAffineTransform) {
            self.id = id
            a = t.a
            b = t.b
            c = t.c
            d = t.d
            tx = t.tx
            ty = t.ty
        }
    }

    private let baseLayer = CALayer()
    private let detailLayer = CALayer()
    /// Loch in der Seiten-Bitmap unter der Detail-Bitmap: Vergrößert hat jeder Strich der Seiten-Bitmap einen
    /// breiten, verschwommenen Rand, der sonst neben dem scharfen Strich darüber hervorschaut (doppelt
    /// gezeichnete, „überzeichnete“ Schrift beim Zoomen).
    private let baseMask = CAShapeLayer()
    private var size = CGSize.zero
    private var zoom: CGFloat = 1
    /// Lage der Seite in der durchlaufenden Heft-Ansicht (Seitenkoordinaten).
    var origin = CGPoint.zero
    private var items: [Item] = []
    /// Umrisse der aktuell gezeichneten Striche (zugleich die Menge der bekannten Schlüssel).
    private var boundsCache: [Key: CGRect] = [:]

    private let renderer = HeftInkRenderer()
    private var pendingDirty: [CGRect] = []
    private var pendingFull = false
    private var pendingDetail: HeftInkRenderer.DetailRequest?
    private var inFlight = false
    private var flushScheduled = false
    private var tokens = 0
    /// Aktuelle Detail-Bitmap (0 = keine) und ihr Ausschnitt.
    private var detailToken = 0
    private var detailArea: (rect: CGRect, scale: CGFloat)?
    private var detailWork: DispatchWorkItem?

    override init(frame: CGRect) {
        super.init(frame: frame)
        isUserInteractionEnabled = false
        backgroundColor = .clear
        layer.anchorPoint = .zero
        for l in [baseLayer, detailLayer] {
            l.anchorPoint = .zero
            l.contentsGravity = .resize
            l.minificationFilter = .trilinear
            layer.addSublayer(l)
        }
        detailLayer.isHidden = true
        baseMask.fillRule = .evenOdd
        baseMask.anchorPoint = .zero
    }

    /// Seiten-Bitmap unter `hole` ausblenden (`nil`: ganz zeigen). Aufruf innerhalb einer CATransaction.
    private func setBaseHole(_ hole: CGRect?) {
        guard let hole else {
            baseLayer.mask = nil
            return
        }
        let page = CGRect(origin: .zero, size: size)
        let path = CGMutablePath()
        path.addRect(page)
        path.addRect(hole.intersection(page))
        baseMask.frame = page
        baseMask.path = path
        baseLayer.mask = baseMask
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError() }

    func configure(size: CGSize) {
        guard size != self.size else { return }
        self.size = size
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        bounds = CGRect(origin: .zero, size: size)
        baseLayer.frame = CGRect(origin: .zero, size: size)
        baseLayer.contents = nil
        CATransaction.commit()
        dropDetail()
        pendingFull = true
        scheduleFlush()
    }

    /// Nach jeder Änderung der Zeichnung: gespeicherte Striche in Zeichenreihenfolge mit ihrer Lage.
    /// Unveränderte Striche kosten nichts; neu gezeichnet werden nur die Bereiche, in denen ein Strich
    /// verschwunden oder hinzugekommen ist.
    func update(_ list: [(data: HeftStroke, transform: CGAffineTransform)]) {
        var next: [Item] = []
        next.reserveCapacity(list.count)
        var nextCache: [Key: CGRect] = [:]
        nextCache.reserveCapacity(list.count)
        for (data, t) in list {
            let key = Key(data.id, t)
            let b = boundsCache[key] ?? Self.bounds(data, t)
            nextCache[key] = b
            next.append(Item(data: data, transform: t, bounds: b))
        }
        var dirty: [CGRect] = []
        for (key, b) in boundsCache where nextCache[key] == nil { dirty.append(b) }
        for (key, b) in nextCache where boundsCache[key] == nil { dirty.append(b) }
        items = next
        boundsCache = nextCache
        guard !dirty.isEmpty else { return }
        pendingDirty += dirty
        // Viele verstreute Änderungen (fremdes Gerät, neue Seite): einmal alles statt vieler Stücke.
        if pendingDirty.count > 48 {
            pendingFull = true
            pendingDirty.removeAll()
        }
        scheduleFlush()
    }

    /// Dem Zoom des Canvas folgen (Ursprung oben links = Seitenursprung). Nur das Transform: die Bitmaps
    /// werden mitskaliert, die scharfe Detail-Bitmap kommt nach der Geste (`viewportChanged`).
    func follow(zoom: CGFloat) {
        self.zoom = zoom
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        transform = CGAffineTransform(scaleX: zoom, y: zoom)
        layer.position = CGPoint(x: origin.x * zoom, y: origin.y * zoom)
        CATransaction.commit()
    }

    /// Sichtbarer Ausschnitt (Seitenkoordinaten dieser Seite) hat sich geändert; kurz nach dem Ende der Bewegung
    /// wird die Detail-Bitmap passend gezeichnet oder entfernt.
    func viewportChanged(visible: CGRect, displayScale: CGFloat) {
        detailWork?.cancel()
        let work = DispatchWorkItem { [weak self] in self?.updateDetail(visible: visible, displayScale: displayScale) }
        detailWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15, execute: work)
    }

    // MARK: Detail-Bitmap

    private func updateDetail(visible: CGRect, displayScale: CGFloat) {
        guard size.width > 0, size.height > 0 else { return }
        let page = CGRect(origin: .zero, size: size)
        let want = max(1, displayScale) * zoom
        let vis = visible.intersection(page)
        // Reicht die Seiten-Bitmap (wie `view.k` nahe Passbreite in der PWA), braucht es keine Detail-Ebene.
        // Schon leicht hochskaliert wirkt die Schrift weich, deshalb ab knapp über der Seiten-Auflösung.
        guard want > HeftInkRenderer.baseScale(size) * 1.02, !vis.isNull, vis.width > 1, vis.height > 1 else {
            dropDetail()
            return
        }
        if let cur = detailArea, abs(cur.scale - want) < want * 0.02, cur.rect.contains(vis) { return }
        // Etwas Rand um den sichtbaren Bereich, damit kurzes Verschieben scharf bleibt (höchstens ~6 Mio. Pixel).
        let px = vis.width * vis.height * want * want
        let grow = max(1, min(1.5, sqrt(6_000_000 / max(px, 1))))
        let rect = vis.insetBy(dx: -vis.width * (grow - 1) / 2, dy: -vis.height * (grow - 1) / 2).intersection(page)
        let scale = min(want, sqrt(8_000_000 / max(rect.width * rect.height, 1)))
        tokens += 1
        detailToken = tokens
        detailArea = (rect, want)
        pendingDetail = .show(rect: rect, scale: scale, token: detailToken)
        scheduleFlush()
    }

    private func dropDetail() {
        guard detailToken != 0 || detailArea != nil else { return }
        detailToken = 0
        detailArea = nil
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        detailLayer.isHidden = true
        detailLayer.contents = nil
        setBaseHole(nil)
        CATransaction.commit()
        pendingDetail = .drop
        scheduleFlush()
    }

    // MARK: Zeichnen im Hintergrund

    /// Höchstens ein Auftrag gleichzeitig; was währenddessen anfällt, geht gesammelt in den nächsten.
    private func scheduleFlush() {
        guard !flushScheduled, !inFlight else { return }
        flushScheduled = true
        DispatchQueue.main.async { [weak self] in self?.flush() }
    }

    private func flush() {
        flushScheduled = false
        guard !inFlight, size.width > 0, size.height > 0 else { return }
        guard pendingFull || !pendingDirty.isEmpty || pendingDetail != nil else { return }
        let job = HeftInkRenderer.Job(size: size, items: items, full: pendingFull, dirty: pendingDirty, detail: pendingDetail)
        pendingFull = false
        pendingDirty.removeAll()
        pendingDetail = nil
        inFlight = true
        renderer.run(job) { [weak self] results in
            guard let self else { return }
            self.inFlight = false
            self.apply(results)
            self.scheduleFlush()
        }
    }

    private func apply(_ results: [HeftInkRenderer.Result]) {
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        for r in results {
            switch r.target {
            case .base:
                baseLayer.contents = r.image
            case .detail(let token):
                guard token == detailToken, token != 0 else { continue }
                detailLayer.frame = r.rect
                detailLayer.contents = r.image
                detailLayer.isHidden = false
                setBaseHole(r.rect)
            }
        }
        CATransaction.commit()
    }

    /// Umgebendes Rechteck eines Strichs in seiner Lage, mit Rand für die größte Strichbreite.
    private static func bounds(_ s: HeftStroke, _ t: CGAffineTransform) -> CGRect {
        let raw = HeftInk.bounds([s])
        guard !raw.isNull else { return .null }
        // Großzügig: Apples Füller wird bei starkem Druck breiter als `size`.
        let width = CGFloat(s.tool == "marker" ? s.size * 3 : s.size * 2.5)
        let scale = max(1, sqrt(abs(t.a * t.d - t.b * t.c)))
        let pad = width * scale / 2 + 2
        return raw.applying(t).insetBy(dx: -pad, dy: -pad)
    }
}

/// Zeichnet die Bitmaps von [HeftInkView] auf einer eigenen Warteschlange. Seiten- und Detail-Bitmap
/// leben nur hier; die Ansicht schickt Aufträge mit dem aktuellen Stand und bekommt fertige Bilder zurück.
final class HeftInkRenderer: @unchecked Sendable {
    enum DetailRequest {
        case show(rect: CGRect, scale: CGFloat, token: Int)
        case drop
    }

    struct Job: @unchecked Sendable {
        let size: CGSize
        let items: [HeftInkView.Item]
        let full: Bool
        let dirty: [CGRect]
        let detail: DetailRequest?
    }

    enum Target { case base, detail(Int) }

    struct Result: @unchecked Sendable {
        let target: Target
        let rect: CGRect
        let image: CGImage
    }

    /// Auflösung der Seiten-Bitmap: höchstens 3 Pixel je Punkt und 4 Mio. Pixel (16 MB; bis zu fünf Seiten
    /// sind gleichzeitig geladen) – für eine Heftseite (1000 × 1414) rund 1,7 Pixel je Punkt; ab der
    /// Passbreite des iPads zeichnet die Detail-Bitmap den sichtbaren Teil scharf darüber.
    static func baseScale(_ size: CGSize) -> CGFloat {
        min(3, sqrt(4_000_000 / max(size.width * size.height, 1)))
    }

    private let queue = DispatchQueue(label: "impala.heft.ink", qos: .userInteractive)
    private var base: Surface?
    private var detail: (surface: Surface, token: Int)?

    func run(_ job: Job, done: @escaping ([Result]) -> Void) {
        queue.async {
            let results = self.render(job)
            DispatchQueue.main.async { done(results) }
        }
    }

    private func render(_ job: Job) -> [Result] {
        var out: [Result] = []
        var full = job.full
        if base == nil || base?.rect.size != job.size {
            base = Surface(rect: CGRect(origin: .zero, size: job.size), scale: Self.baseScale(job.size))
            full = true
        }
        var freshDetail = false
        switch job.detail {
        case .show(let rect, let scale, let token)?:
            detail = Surface(rect: rect, scale: scale).map { (surface: $0, token: token) }
            freshDetail = detail != nil
        case .drop?:
            detail = nil
        case nil:
            break
        }
        if let base, base.draw(job.items, dirty: full ? nil : job.dirty), let img = base.ctx.makeImage() {
            out.append(Result(target: .base, rect: base.rect, image: img))
        }
        if let d = detail,
           d.surface.draw(job.items, dirty: full || freshDetail ? nil : job.dirty),
           let img = d.surface.ctx.makeImage() {
            out.append(Result(target: .detail(d.token), rect: d.surface.rect, image: img))
        }
        return out
    }

    /// Eine Bitmap für einen Ausschnitt der Seite (`rect`, Seitenkoordinaten) mit `scale` Pixeln je Punkt.
    private final class Surface {
        let rect: CGRect
        let scale: CGFloat
        let ctx: CGContext

        init?(rect: CGRect, scale: CGFloat) {
            let w = Int(ceil(rect.width * scale)), h = Int(ceil(rect.height * scale))
            guard w > 0, h > 0, let space = CGColorSpace(name: CGColorSpace.sRGB),
                  let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0, space: space,
                                      bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue)
            else { return nil }
            // Seitenkoordinaten mit Ursprung oben links (wie UIKit) auf die Pixel des Ausschnitts.
            ctx.concatenate(CGAffineTransform(a: scale, b: 0, c: 0, d: -scale,
                                              tx: -rect.minX * scale, ty: CGFloat(h) + rect.minY * scale))
            ctx.interpolationQuality = .high
            self.rect = rect
            self.scale = scale
            self.ctx = ctx
        }

        /// Bereiche leeren und alle Striche darin in Reihenfolge neu zeichnen (`dirty` nil: alles).
        /// Gibt zurück, ob sich etwas geändert hat.
        func draw(_ items: [HeftInkView.Item], dirty: [CGRect]?) -> Bool {
            let areas: [CGRect] = (dirty ?? [rect]).compactMap { r in
                let i = r.intersection(rect)
                return i.isNull || i.isEmpty ? nil : snap(i)
            }
            guard !areas.isEmpty else { return false }
            UIGraphicsPushContext(ctx)
            defer { UIGraphicsPopContext() }
            for area in areas {
                ctx.saveGState()
                ctx.clip(to: area)
                ctx.clear(area)
                var strokes: [PKStroke] = []
                for item in items where item.bounds.intersects(area) {
                    guard var pk = HeftInk.pkStroke(item.data, seed: 0) else { continue }
                    pk.transform = item.transform
                    strokes.append(pk)
                }
                if !strokes.isEmpty {
                    // Papier ist immer hell; im Dunkelmodus kehrte PencilKit die Farben sonst um.
                    var image: UIImage?
                    UITraitCollection(userInterfaceStyle: .light).performAsCurrent {
                        image = PKDrawing(strokes: strokes).image(from: area, scale: scale)
                    }
                    image?.draw(in: area)
                }
                ctx.restoreGState()
            }
            return true
        }

        /// Auf ganze Pixel erweitern, damit Leeren und Neuzeichnen keine Kanten hinterlassen.
        private func snap(_ r: CGRect) -> CGRect {
            let x0 = floor((r.minX - rect.minX) * scale) / scale + rect.minX
            let y0 = floor((r.minY - rect.minY) * scale) / scale + rect.minY
            let x1 = ceil((r.maxX - rect.minX) * scale) / scale + rect.minX
            let y1 = ceil((r.maxY - rect.minY) * scale) / scale + rect.minY
            return CGRect(x: x0, y: y0, width: x1 - x0, height: y1 - y0)
        }
    }
}
