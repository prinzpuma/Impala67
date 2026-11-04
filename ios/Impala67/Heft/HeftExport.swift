import SwiftUI
import UIKit

/// Heft-Export wie heft-export.js: PDF mit allen Seiten (jede Seite mit 2480 px Breite als JPEG 0,95
/// gerendert, das PDF-Gerüst baut der Kern) und SVG einer Seite (`heftPageSvg`). Die Dateien landen im
/// temporären Ordner und gehen über das Teilen-Blatt an „In Dateien sichern“, AirDrop, Drucken …
@MainActor
enum HeftExport {
    /// PDF aller Seiten; `nil`, wenn nichts gerendert werden konnte.
    static func pdf(core: ImpalaCore, pageId: String) -> URL? {
        let size = heftExportSize(width: nil)
        var pages: [HeftPdfPage] = []
        for id in core.heftPageIds(pageId: pageId) {
            autoreleasepool {
                guard let img = HeftThumbnail.render(core: core, pageId: pageId, heftPageId: id,
                                                     width: CGFloat(size.width), scale: 1, imagePixels: 4096),
                      let cg = img.cgImage, let jpeg = img.jpegData(compressionQuality: 0.95) else { return }
                pages.append(HeftPdfPage(jpeg: jpeg, width: UInt32(cg.width), height: UInt32(cg.height)))
            }
        }
        guard !pages.isEmpty, let data = try? heftBuildPdf(pages: pages) else { return nil }
        return write(data, name: fileName(core, pageId) + ".pdf")
    }

    /// SVG der Seite `heftPageId` (Papiermuster in der Linienfarbe der PWA).
    static func svg(core: ImpalaCore, pageId: String, heftPageId: String) -> URL? {
        guard let svg = try? core.heftPageSvg(pageId: pageId, heftPageId: heftPageId, paperInk: "#2478c7") else { return nil }
        let n = (core.heftPageIds(pageId: pageId).firstIndex(of: heftPageId) ?? 0) + 1
        return write(Data(svg.utf8), name: fileName(core, pageId) + "-seite-\(n).svg")
    }

    static func fileName(_ core: ImpalaCore, _ pageId: String) -> String {
        heftExportFileName(title: core.page(id: pageId)?.summary.title)
    }

    /// Datei in einen eigenen temporären Ordner schreiben (der Name bleibt so wie gewünscht).
    static func write(_ data: Data, name: String) -> URL? {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("export-\(UUID().uuidString)", isDirectory: true)
        let url = dir.appendingPathComponent(name)
        do {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            try data.write(to: url, options: .atomic)
            return url
        } catch {
            return nil
        }
    }
}

/// Eine Datei zum Teilen (Teilen-Blatt als Sheet).
struct SharedFile: Identifiable {
    let url: URL
    var id: String { url.path }
}

/// System-Teilen-Blatt für Dateien.
struct ShareSheet: UIViewControllerRepresentable {
    let items: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }

    func updateUIViewController(_ vc: UIActivityViewController, context: Context) {}
}
