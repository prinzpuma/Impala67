import PencilKit
import UIKit

/// Vorschaubild einer Heftseite für die Seitenübersicht (wie `renderPageTo` in heft.js bzw.
/// `HeftThumbnail.kt`): Papier, Bilder, Striche, Textfelder – alles aus dem Kernformat.
@MainActor
enum HeftThumbnail {
    /// Bild mit `width` Punkten Breite; `nil`, wenn die Seite nicht lesbar ist. `imagePixels`: Auflösung der
    /// eingefügten Bilder (Vorschau klein, Export groß).
    static func render(core: ImpalaCore, pageId: String, heftPageId: String, width: CGFloat, scale: CGFloat,
                       imagePixels: Int = 512) -> UIImage? {
        guard let data = attempt("heftPage", { try core.heftPage(pageId: pageId, heftPageId: heftPageId) }), data.width > 0 else { return nil }
        let size = CGSize(width: data.width, height: data.height)
        let k = width / size.width
        let strokes = data.strokes.compactMap { HeftInk.pkStroke($0, seed: HeftInk.seed($0.id)) }
        // Papier ist immer hell: PencilKit sonst im Dunkelmodus mit umgekehrten Farben.
        var ink: UIImage?
        UITraitCollection(userInterfaceStyle: .light).performAsCurrent {
            ink = PKDrawing(strokes: strokes).image(from: CGRect(origin: .zero, size: size), scale: k * scale)
        }
        let format = UIGraphicsImageRendererFormat()
        format.scale = scale
        format.opaque = true
        return UIGraphicsImageRenderer(size: CGSize(width: width, height: size.height * k), format: format).image { ctx in
            ctx.cgContext.scaleBy(x: k, y: k)
            HeftPaperView.draw(in: ctx.cgContext, size: size, paper: data.paper)
            for im in data.images {
                HeftImages.image(core: core, pageId: pageId, heftPageId: heftPageId, image: im, maxPixels: imagePixels)?
                    .draw(in: CGRect(x: im.x, y: im.y, width: im.w, height: im.h))
            }
            ink?.draw(in: CGRect(origin: .zero, size: size))
            for t in data.texts where !t.text.isEmpty { HeftTextStyle.draw(t, at: CGPoint(x: t.x, y: t.y)) }
        }
    }
}
