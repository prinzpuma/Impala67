import PencilKit
import UIKit

/// Vorschaubild einer Heftseite für die Seitenübersicht (wie `renderPageTo` in heft.js bzw.
/// `HeftThumbnail.kt`): Papier, Bilder, Striche, Textfelder – alles aus dem Kernformat.
@MainActor
enum HeftThumbnail {
    /// Bild mit `width` Punkten Breite; `nil`, wenn die Seite nicht lesbar ist. `imagePixels`: Auflösung der
    /// eingefügten Bilder (Vorschau klein, Export groß).
    static func render(core: ImpalaCore, pageId: String, heftPageId: String, width: CGFloat, scale: CGFloat,
                       imagePixels: Int = 512, background: HeftBackground = .paper) -> UIImage? {
        HeftExport.renderPage(core: core, pageId: pageId, heftPageId: heftPageId,
                              width: width, scale: scale, background: background, imagePixels: imagePixels)
    }
}
