import PDFKit
import SwiftUI
import UIKit
import VisionKit

/// Bilder, Fotos, Scans und PDFs ins Heft holen, wie heft-import.js der PWA:
/// - „Bild hinzufügen“/„Bild aufnehmen“: auf die aktuelle Seite, höchstens 70 % der Seite, mittig
///   (`insertImageFile`, längere Seite 1400 px).
/// - „Bild als Seite“, „PDF oder Bild importieren“, „Dokument scannen“: je Bild bzw. PDF-Seite eine neue
///   Seite (`imagePage`; Bilder mit 40 Rand, PDF-Seiten und Scans randlos, 1800 px, JPEG 0,78). Eingebetteter
///   PDF-Text wird als Texterkennung der Seite übernommen (ab 20 Zeichen), damit die Suche ihn findet.
@MainActor
enum HeftImport {
    static let insertMaxEdge: CGFloat = 1400
    static let pageMaxEdge: CGFloat = 1800
    nonisolated static let jpegQuality: CGFloat = 0.78

    /// Bild auf die Seite `heftPageId` legen; liefert die Bild-ID.
    @discardableResult
    static func insertImage(core: ImpalaCore, pageId: String, heftPageId: String, image: UIImage) -> String? {
        guard let page = try? core.heftPage(pageId: pageId, heftPageId: heftPageId),
              let (data, size) = jpeg(image, maxEdge: insertMaxEdge) else { return nil }
        let sw = Double(size.width), sh = Double(size.height)
        let k = min(page.width * 0.7 / sw, page.height * 0.7 / sh, 1)
        let w = sw * k, h = sh * k
        return try? core.heftAddImage(
            pageId: pageId, heftPageId: heftPageId, bytes: data, mime: "image/jpeg",
            x: (page.width - w) / 2, y: (page.height - h) / 2, w: w, h: h
        ).ids.first
    }

    /// Neue Seite mit `image` an Stelle `at` (nil = am Ende); `bleed` = randlos (PDF, Scan). Liefert die Seiten-ID.
    @discardableResult
    static func addImagePage(core: ImpalaCore, pageId: String, image: UIImage, at: Int?, bleed: Bool,
                             paper: String = "blank", text: String? = nil) -> String? {
        guard let (data, size) = jpeg(image, maxEdge: pageMaxEdge),
              let id = try? core.heftAddPage(pageId: pageId, at: at.map { UInt32($0) }, paper: paper),
              let page = try? core.heftPage(pageId: pageId, heftPageId: id) else { return nil }
        let pad: Double = bleed ? 0 : 40
        let sw = Double(size.width), sh = Double(size.height)
        let k = min((page.width - pad * 2) / sw, (page.height - pad * 2) / sh)
        let w = sw * k, h = sh * k
        guard let imageId = try? core.heftAddImage(
            pageId: pageId, heftPageId: id, bytes: data, mime: "image/jpeg",
            x: (page.width - w) / 2, y: (page.height - h) / 2, w: w, h: h
        ).ids.first else { return id }
        if let text, text.count >= 20 {
            _ = try? core.heftSetImageText(pageId: pageId, heftPageId: id, imageId: imageId, text: text)
            _ = try? core.heftSetPageText(pageId: pageId, heftPageId: id, text: text)
        }
        return id
    }

    /// Dateien aus dem Dateiimporter: PDFs seitenweise, Bilder je als Seite, ab Stelle `at`.
    /// Liefert die ID der letzten neuen Seite.
    static func importFiles(core: ImpalaCore, pageId: String, urls: [URL], at: Int?) -> String? {
        var next = at
        var last: String?
        for url in urls {
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            if url.pathExtension.lowercased() == "pdf" {
                guard let doc = PDFDocument(url: url) else { continue }
                for i in 0..<doc.pageCount {
                    guard let p = doc.page(at: i), let img = render(p) else { continue }
                    let text = p.string.map(cleanText)
                    if let id = addImagePage(core: core, pageId: pageId, image: img, at: next, bleed: true, text: text) {
                        last = id
                        next = next.map { $0 + 1 }
                    }
                }
            } else if let data = try? Data(contentsOf: url), let img = UIImage(data: data) {
                if let id = addImagePage(core: core, pageId: pageId, image: img, at: next, bleed: false) {
                    last = id
                    next = next.map { $0 + 1 }
                }
            }
        }
        return last
    }

    /// Gescannte Seiten (VisionKit, schon entzerrt) als randlose Seiten ab `at`.
    static func addScans(core: ImpalaCore, pageId: String, images: [UIImage], at: Int?) -> String? {
        var next = at
        var last: String?
        for img in images {
            if let id = addImagePage(core: core, pageId: pageId, image: img, at: next, bleed: true) {
                last = id
                next = next.map { $0 + 1 }
            }
        }
        return last
    }

    /// PDF-Seite weiß hinterlegt rendern, längere Seite höchstens 1800 px (höchstens dreifach vergrößert).
    private static func render(_ page: PDFPage) -> UIImage? {
        let box = page.bounds(for: .mediaBox)
        guard box.width > 0, box.height > 0 else { return nil }
        let k = min(3, pageMaxEdge / max(box.width, box.height))
        let size = CGSize(width: (box.width * k).rounded(), height: (box.height * k).rounded())
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        return UIGraphicsImageRenderer(size: size, format: format).image { ctx in
            UIColor.white.setFill()
            ctx.fill(CGRect(origin: .zero, size: size))
            ctx.cgContext.translateBy(x: 0, y: size.height)
            ctx.cgContext.scaleBy(x: k, y: -k)
            page.draw(with: .mediaBox, to: ctx.cgContext)
        }
    }

    /// Text wie `cleanOcrText`: Leerraum je Zeile zusammenfassen, leere Zeilen weg.
    private static func cleanText(_ s: String) -> String {
        s.components(separatedBy: .newlines)
            .map { $0.split(whereSeparator: \.isWhitespace).joined(separator: " ") }
            .filter { !$0.isEmpty }
            .joined(separator: "\n")
    }

    /// Weiß hinterlegtes JPEG mit höchstens `maxEdge` Pixeln an der längeren Seite und dessen Größe.
    nonisolated static func jpeg(_ image: UIImage, maxEdge: CGFloat) -> (Data, CGSize)? {
        let px = CGSize(width: image.size.width * image.scale, height: image.size.height * image.scale)
        guard px.width > 0, px.height > 0 else { return nil }
        let k = min(1, maxEdge / max(px.width, px.height))
        let size = CGSize(width: max(1, (px.width * k).rounded()), height: max(1, (px.height * k).rounded()))
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        let out = UIGraphicsImageRenderer(size: size, format: format).image { ctx in
            UIColor.white.setFill()
            ctx.fill(CGRect(origin: .zero, size: size))
            image.draw(in: CGRect(origin: .zero, size: size))
        }
        guard let data = out.jpegData(compressionQuality: jpegQuality) else { return nil }
        return (data, size)
    }
}

/// „Dokument scannen“: Dokumentenkamera von VisionKit (Kanten finden, entzerren, mehrere Seiten).
struct DocumentScanner: UIViewControllerRepresentable {
    let onDone: ([UIImage]) -> Void

    static var isAvailable: Bool { VNDocumentCameraViewController.isSupported }

    func makeCoordinator() -> Coordinator { Coordinator(onDone) }

    func makeUIViewController(context: Context) -> VNDocumentCameraViewController {
        let vc = VNDocumentCameraViewController()
        vc.delegate = context.coordinator
        return vc
    }

    func updateUIViewController(_ vc: VNDocumentCameraViewController, context: Context) {}

    final class Coordinator: NSObject, VNDocumentCameraViewControllerDelegate {
        let onDone: ([UIImage]) -> Void
        init(_ onDone: @escaping ([UIImage]) -> Void) { self.onDone = onDone }

        func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFinishWith scan: VNDocumentCameraScan) {
            onDone((0..<scan.pageCount).map { scan.imageOfPage(at: $0) })
        }

        func documentCameraViewControllerDidCancel(_ controller: VNDocumentCameraViewController) { onDone([]) }

        func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFailWithError error: Error) { onDone([]) }
    }
}

/// „Bild aufnehmen“: Kamera (`UIImagePickerController`, ein Foto).
struct CameraPicker: UIViewControllerRepresentable {
    let onDone: (UIImage?) -> Void

    static var isAvailable: Bool { UIImagePickerController.isSourceTypeAvailable(.camera) }

    func makeCoordinator() -> Coordinator { Coordinator(onDone) }

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let vc = UIImagePickerController()
        vc.sourceType = .camera
        vc.delegate = context.coordinator
        return vc
    }

    func updateUIViewController(_ vc: UIImagePickerController, context: Context) {}

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let onDone: (UIImage?) -> Void
        init(_ onDone: @escaping (UIImage?) -> Void) { self.onDone = onDone }

        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            onDone(info[.originalImage] as? UIImage)
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { onDone(nil) }
    }
}
