import ImageIO
import UIKit

/// Bilder und Textfelder einer Heftseite (bearbeitet über `HeftSelectLayer`), gezeichnet wie `renderPageTo` in heft.js:
/// Papier → Bilder → Striche → Textfelder. Bilder liegen deshalb unter, Textfelder über der PencilKit-Ebene.
/// Wie `HeftPaperView` in Seitenkoordinaten und per Transform mit dem Zoom skaliert.
final class HeftObjectsView: UIView {
    enum Kind { case images, texts }

    private let kind: Kind
    private var boxes: [HeftTextBox] = []
    /// Ebene bzw. Feld je Element-ID, für die Vorschau beim Verschieben und Skalieren.
    private var views: [String: Any] = [:]
    private var zoom: CGFloat = 1

    init(_ kind: Kind) {
        self.kind = kind
        super.init(frame: .zero)
        isUserInteractionEnabled = false
        backgroundColor = .clear
        layer.anchorPoint = .zero
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError() }

    /// Inhalt der geladenen Seiten setzen (Koordinaten der durchlaufenden Heft-Ansicht); `image` liefert
    /// das dekodierte Bild zu einer Bild-ID (`nil`: Daten fehlen noch).
    func configure(size: CGSize, pages: [HeftPlaced], image: (HeftImage) -> UIImage?) {
        bounds = CGRect(origin: .zero, size: size)
        subviews.forEach { $0.removeFromSuperview() }
        layer.sublayers?.forEach { $0.removeFromSuperlayer() }
        boxes.removeAll()
        views.removeAll()
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        for page in pages {
            let o = page.origin
            switch kind {
            case .images:
                for im in page.data.images {
                    guard let img = image(im)?.cgImage else { continue }
                    let l = CALayer()
                    l.frame = CGRect(x: im.x + o.x, y: im.y + o.y, width: im.w, height: im.h)
                    l.contents = img
                    l.contentsGravity = .resize
                    l.minificationFilter = .trilinear
                    layer.addSublayer(l)
                    views[im.id] = l
                }
            case .texts:
                for t in page.data.texts where !t.text.isEmpty {
                    let box = HeftTextBox(t, origin: o)
                    addSubview(box)
                    boxes.append(box)
                    views[t.id] = box
                }
            }
        }
        CATransaction.commit()
        follow(zoom: zoom)
    }

    /// Element `id` vorläufig an `frame` zeigen (bis zum Neuladen aus dem Kern).
    func preview(_ id: String, frame: CGRect) {
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        if let l = views[id] as? CALayer { l.frame = frame }
        if let v = views[id] as? HeftTextBox { v.frame = CGRect(origin: frame.origin, size: CGSize(width: frame.width, height: v.frame.height)) }
        CATransaction.commit()
    }

    func follow(zoom: CGFloat) {
        self.zoom = zoom
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        transform = CGAffineTransform(scaleX: zoom, y: zoom)
        layer.position = .zero
        CATransaction.commit()
        // Text scharf halten, aber den Bildspeicher begrenzen (bei starkem Zoom höchstens dreifach).
        let scale = max(1, traitCollection.displayScale) * min(max(zoom, 1), 3)
        for box in boxes where abs(box.contentScaleFactor - scale) > 0.25 {
            box.contentScaleFactor = scale
            box.setNeedsDisplay()
        }
    }
}

/// Eine geladene Heftseite und ihre Lage in der durchlaufenden Heft-Ansicht.
struct HeftPlaced {
    let origin: CGPoint
    let data: HeftPageData
}

/// Ein Textfeld wie `drawTextBox` in heft.js (Innenabstand 10, Zeilenhöhe 1,4, Breite `w` oder 400).
private final class HeftTextBox: UIView {
    private let text: HeftText

    init(_ text: HeftText, origin: CGPoint) {
        self.text = text
        super.init(frame: HeftTextStyle.frame(text).offsetBy(dx: origin.x, dy: origin.y))
        isOpaque = false
        backgroundColor = .clear
        isUserInteractionEnabled = false
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError() }

    override func draw(_ rect: CGRect) {
        HeftTextStyle.draw(text, at: .zero)
    }
}

/// Schrift und Umbruch der Heft-Textfelder (heft.js `wrapTextLines`/`drawTextBox`).
enum HeftTextStyle {
    static let pad: CGFloat = 10
    static let lineHeight: CGFloat = 1.4

    /// „500 30px ui-rounded“ der PWA.
    static func font(_ size: CGFloat) -> UIFont {
        let base = UIFont.systemFont(ofSize: size, weight: .medium)
        guard let d = base.fontDescriptor.withDesign(.rounded) else { return base }
        return UIFont(descriptor: d, size: size)
    }

    private static func attributed(_ t: HeftText) -> NSAttributedString {
        let size = CGFloat(t.size ?? 30)
        let p = NSMutableParagraphStyle()
        p.minimumLineHeight = size * lineHeight
        p.maximumLineHeight = size * lineHeight
        p.lineBreakMode = .byWordWrapping
        return NSAttributedString(string: t.text, attributes: [
            .font: font(size),
            .foregroundColor: UIColor(css: t.color ?? "#1c1c1e"),
            .paragraphStyle: p,
        ])
    }

    private static func textWidth(_ t: HeftText) -> CGFloat { max(60, CGFloat(t.w ?? 400) - 2 * pad) }

    /// Rahmen in Seitenkoordinaten; die Höhe ergibt sich aus dem Umbruch (wie `t.h` in der PWA).
    static func frame(_ t: HeftText) -> CGRect {
        let w = textWidth(t)
        let used = attributed(t).boundingRect(
            with: CGSize(width: w, height: .greatestFiniteMagnitude),
            options: [.usesLineFragmentOrigin], context: nil
        )
        return CGRect(x: t.x, y: t.y, width: w + 2 * pad, height: ceil(used.height) + 2 * pad)
    }

    /// Text in den aktuellen UIKit-Kontext zeichnen; `origin` ist die linke obere Ecke des Felds.
    static func draw(_ t: HeftText, at origin: CGPoint) {
        let rect = CGRect(x: origin.x + pad, y: origin.y + pad, width: textWidth(t), height: .greatestFiniteMagnitude)
        attributed(t).draw(with: rect, options: [.usesLineFragmentOrigin], context: nil)
    }
}

/// Dekodierte Heftbilder (`heftImageData`), verkleinert auf die benötigte Größe und zwischengespeichert.
@MainActor
enum HeftImages {
    private static let cache: NSCache<NSString, UIImage> = {
        let c = NSCache<NSString, UIImage>()
        c.totalCostLimit = 96 * 1024 * 1024
        return c
    }()

    private static func key(_ id: String, _ maxPixels: Int) -> NSString { "\(id)@\(maxPixels)" as NSString }

    /// Schon dekodiertes Bild `im` mit höchstens `maxPixels` an der längeren Seite, sonst `nil`.
    static func cached(_ im: HeftImage, maxPixels: Int) -> UIImage? {
        cache.object(forKey: key(im.id, maxPixels))
    }

    /// Bild `im` im Hintergrund dekodieren (verkleinert) und zwischenspeichern; `nil`, solange die Daten fehlen.
    static func load(core: ImpalaCore, pageId: String, heftPageId: String, image im: HeftImage, maxPixels: Int) async -> UIImage? {
        if let hit = cached(im, maxPixels: maxPixels) { return hit }
        let imageId = im.id
        let cg = await Task.detached(priority: .userInitiated) { () -> CGImage? in
            guard let data = attempt("heftImageData", { try core.heftImageData(pageId: pageId, heftPageId: heftPageId, imageId: imageId) }) ?? nil,
                  let src = CGImageSourceCreateWithData(data.bytes as CFData, nil)
            else { return nil }
            return CGImageSourceCreateThumbnailAtIndex(src, 0, [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceCreateThumbnailWithTransform: true,
                kCGImageSourceThumbnailMaxPixelSize: maxPixels,
            ] as CFDictionary)
        }.value
        guard let cg else { return nil }
        let img = UIImage(cgImage: cg)
        cache.setObject(img, forKey: key(imageId, maxPixels), cost: cg.bytesPerRow * cg.height)
        return img
    }
}
