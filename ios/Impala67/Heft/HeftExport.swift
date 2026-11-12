import Foundation
import PencilKit
import SwiftUI
import UIKit

/// Hintergrund für den Heft-Export (wie in Android und PWA).
enum HeftBackground: String, CaseIterable, Identifiable, Sendable {
    case paper = "paper"
    case white = "white"
    case transparent = "transparent"

    var id: String { rawValue }

    var label: String {
        switch self {
        case .paper: return "Papier"
        case .white: return "Weiß"
        case .transparent: return "Transparent"
        }
    }

    var hint: String {
        switch self {
        case .paper: return "Standard (Papierfarbe und Linien)"
        case .white: return "Weißer Hintergrund mit Linien"
        case .transparent: return "Freigestellter Hintergrund"
        }
    }
}

/// Heft-Export wie in der PWA (heft-export.js) und Android (HeftTransfer.kt):
/// Hochauflösende PNG-Bilder einzelner oder aller Seiten (300 dpi, 2480 px Breite),
/// PDF aller Seiten oder SVG einer Einzelseite.
/// Das Rendern erfolgt unabhängig vom Hauptthread im Hintergrund.
enum HeftExport {
    /// Dateiname ohne verbotene Zeichen, maximal 80 Zeichen (wie PWA und Android `cleanName`).
    static func cleanName(_ name: String, fallback: String) -> String {
        let cleaned = name.replacingOccurrences(of: "[\\\\/:*?\"<>|#]", with: "_", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let truncated = String(cleaned.prefix(80))
        return truncated.isEmpty ? fallback : truncated
    }

    /// Basis-Dateiname aus dem Titel der Seite (Kernfunktion `heftExportFileName`).
    static func fileName(_ core: ImpalaCore, _ pageId: String) -> String {
        heftExportFileName(title: core.page(id: pageId)?.summary.title)
    }

    /// Dateiname für eine einzelne Seite (`<Titel>-seite-<n>.png`).
    static func pageFileName(baseName: String, pageNumber: Int) -> String {
        "\(baseName)-seite-\(pageNumber).png"
    }

    /// Eine Heftseite in gegebener Breite rendern: Papier, Striche, Bilder und Textfelder.
    /// Läuft unabhängig vom Hauptthread (Background-Rendering-konform).
    nonisolated static func renderPage(
        core: ImpalaCore,
        pageId: String,
        heftPageId: String,
        width: CGFloat,
        scale: CGFloat = 1,
        background: HeftBackground = .paper,
        imagePixels: Int = 4096
    ) -> UIImage? {
        guard let data = attempt("heftPage", { try core.heftPage(pageId: pageId, heftPageId: heftPageId) }) else { return nil }
        return renderPage(data, core: core, pageId: pageId, width: width, scale: scale, background: background, imagePixels: imagePixels)
    }

    /// Seite aus fertigen Daten zeichnen (auch ein Stand aus dem Heft-Verlauf). Bilder kommen über den Kern;
    /// fehlt eines inzwischen im Heft, bleibt die Stelle leer.
    nonisolated static func renderPage(
        _ data: HeftPageData,
        core: ImpalaCore,
        pageId: String,
        width: CGFloat,
        scale: CGFloat = 1,
        background: HeftBackground = .paper,
        imagePixels: Int = 4096
    ) -> UIImage? {
        guard data.width > 0 else { return nil }
        let heftPageId = data.id
        let size = CGSize(width: data.width, height: data.height)
        let k = width / size.width
        let format = UIGraphicsImageRendererFormat()
        format.scale = scale
        format.opaque = background != .transparent

        return UIGraphicsImageRenderer(size: CGSize(width: width, height: size.height * k), format: format).image { ctx in
            ctx.cgContext.scaleBy(x: k, y: k)
            HeftPaperDraw.draw(in: ctx.cgContext, size: size, paper: data.paper, background: background)
            for im in data.images {
                loadPageImage(core: core, pageId: pageId, heftPageId: heftPageId, image: im, maxPixels: imagePixels)?
                    .draw(in: CGRect(x: im.x, y: im.y, width: im.w, height: im.h))
            }
            // Selbst gezeichnet wie die PWA: PencilKit ließ dicht gespeicherte Striche fast verschwinden.
            HeftInk.draw(data.strokes, in: ctx.cgContext)
            for t in data.texts where !t.text.isEmpty { HeftTextStyle.draw(t, at: CGPoint(x: t.x, y: t.y)) }
        }
    }

    /// Bilddatei für die Seite dekodieren (im Hintergrund, ohne Hauptthread-Cache).
    nonisolated private static func loadPageImage(
        core: ImpalaCore,
        pageId: String,
        heftPageId: String,
        image im: HeftImage,
        maxPixels: Int
    ) -> UIImage? {
        guard let data = attempt("heftImageData", { try core.heftImageData(pageId: pageId, heftPageId: heftPageId, imageId: im.id) }) ?? nil,
              let src = CGImageSourceCreateWithData(data.bytes as CFData, nil),
              let cg = CGImageSourceCreateThumbnailAtIndex(src, 0, [
                  kCGImageSourceCreateThumbnailFromImageAlways: true,
                  kCGImageSourceCreateThumbnailWithTransform: true,
                  kCGImageSourceThumbnailMaxPixelSize: maxPixels,
              ] as CFDictionary)
        else { return nil }
        return UIImage(cgImage: cg)
    }

    /// Einzelne Heftseite als hochauflösendes PNG exportieren (Standard: 300 dpi wie PWA und Android).
    static func pagePng(
        core: ImpalaCore,
        pageId: String,
        heftPageId: String,
        pageNumber: Int? = nil,
        baseName: String? = nil,
        background: HeftBackground = .paper
    ) async -> URL? {
        let fallback = fileName(core, pageId)
        let name = cleanName(baseName ?? fallback, fallback: fallback)
        let order = core.heftPageIds(pageId: pageId)
        let n = pageNumber ?? ((order.firstIndex(of: heftPageId) ?? 0) + 1)
        let fileName = pageFileName(baseName: name, pageNumber: n)

        return await Task.detached(priority: .userInitiated) { () -> URL? in
            guard !Task.isCancelled else { return nil }
            let size = heftExportSize(width: nil)
            guard let img = renderPage(core: core, pageId: pageId, heftPageId: heftPageId,
                                       width: CGFloat(size.width), scale: 1, background: background, imagePixels: 4096),
                  let png = img.pngData()
            else { return nil }
            guard !Task.isCancelled else { return nil }
            return write(png, name: fileName)
        }.value
    }

    /// Mehrere oder alle Seiten als hochauflösende PNG-Dateien exportieren (`<Titel>-seite-<n>.png`).
    static func pagesPng(
        core: ImpalaCore,
        pageId: String,
        heftPageIds: [String]? = nil,
        baseName: String? = nil,
        background: HeftBackground = .paper,
        onProgress: (@Sendable (String) -> Void)? = nil
    ) async -> [URL]? {
        let fallback = fileName(core, pageId)
        let name = cleanName(baseName ?? fallback, fallback: fallback)
        let order = core.heftPageIds(pageId: pageId)
        let targetIds = heftPageIds ?? order
        guard !targetIds.isEmpty else { return nil }

        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("export-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)

        var urls: [URL] = []
        let size = heftExportSize(width: nil)

        for (i, id) in targetIds.enumerated() {
            guard !Task.isCancelled else { return nil }
            onProgress?("Erzeuge Bild \(i + 1) von \(targetIds.count) …")
            await Task.yield()

            let n = (order.firstIndex(of: id) ?? i) + 1
            let fileName = pageFileName(baseName: name, pageNumber: n)

            let fileUrl = await Task.detached(priority: .userInitiated) { () -> URL? in
                guard !Task.isCancelled else { return nil }
                guard let img = renderPage(core: core, pageId: pageId, heftPageId: id,
                                           width: CGFloat(size.width), scale: 1, background: background, imagePixels: 4096),
                      let png = img.pngData()
                else { return nil }
                return write(png, name: fileName, in: dir)
            }.value

            guard let fileUrl, !Task.isCancelled else { return nil }
            urls.append(fileUrl)
        }

        return urls.isEmpty ? nil : urls
    }

    /// PDF aller ausgewählten Seiten (im Hintergrund mit 300 dpi gerendert und per Rust-Kern gebaut).
    static func pdf(
        core: ImpalaCore,
        pageId: String,
        heftPageIds: [String]? = nil,
        baseName: String? = nil,
        onProgress: (@Sendable (String) -> Void)? = nil
    ) async -> URL? {
        let fallback = fileName(core, pageId)
        let name = cleanName(baseName ?? fallback, fallback: fallback)
        let order = core.heftPageIds(pageId: pageId)
        let targetIds = heftPageIds ?? order
        guard !targetIds.isEmpty else { return nil }

        let size = heftExportSize(width: nil)
        var pages: [HeftPdfPage] = []

        for (i, id) in targetIds.enumerated() {
            guard !Task.isCancelled else { return nil }
            onProgress?("Erzeuge Seite \(i + 1) von \(targetIds.count) …")
            await Task.yield()

            let pdfPage = await Task.detached(priority: .userInitiated) { () -> HeftPdfPage? in
                guard !Task.isCancelled else { return nil }
                guard let img = renderPage(core: core, pageId: pageId, heftPageId: id,
                                           width: CGFloat(size.width), scale: 1, background: .paper, imagePixels: 4096),
                      let cg = img.cgImage,
                      let jpeg = img.jpegData(compressionQuality: 0.95)
                else { return nil }
                return HeftPdfPage(jpeg: jpeg, width: UInt32(cg.width), height: UInt32(cg.height))
            }.value

            guard let pdfPage, !Task.isCancelled else { return nil }
            pages.append(pdfPage)
        }

        guard !pages.isEmpty, !Task.isCancelled else { return nil }
        onProgress?("Erstelle PDF-Dokument …")
        await Task.yield()

        return await Task.detached(priority: .userInitiated) { () -> URL? in
            guard let data = try? heftBuildPdf(pages: pages) else { return nil }
            return write(data, name: "\(name).pdf")
        }.value
    }

    /// Synchrone PDF-Generierung für bestehenden Code.
    static func pdf(core: ImpalaCore, pageId: String) -> URL? {
        let size = heftExportSize(width: nil)
        var pages: [HeftPdfPage] = []
        for id in core.heftPageIds(pageId: pageId) {
            autoreleasepool {
                guard let img = renderPage(core: core, pageId: pageId, heftPageId: id,
                                           width: CGFloat(size.width), scale: 1, background: .paper, imagePixels: 4096),
                      let cg = img.cgImage, let jpeg = img.jpegData(compressionQuality: 0.95) else { return }
                pages.append(HeftPdfPage(jpeg: jpeg, width: UInt32(cg.width), height: UInt32(cg.height)))
            }
        }
        guard !pages.isEmpty, let data = try? heftBuildPdf(pages: pages) else { return nil }
        return write(data, name: fileName(core, pageId) + ".pdf")
    }

    /// SVG der Seite `heftPageId` (Papiermuster in der Linienfarbe der PWA).
    static func svg(core: ImpalaCore, pageId: String, heftPageId: String, baseName: String? = nil) -> URL? {
        guard let svg = attempt("heftPageSvg", { try core.heftPageSvg(pageId: pageId, heftPageId: heftPageId, paperInk: "#2478c7") }) else { return nil }
        let fallback = fileName(core, pageId)
        let name = cleanName(baseName ?? fallback, fallback: fallback)
        let n = (core.heftPageIds(pageId: pageId).firstIndex(of: heftPageId) ?? 0) + 1
        return write(Data(svg.utf8), name: "\(name)-seite-\(n).svg")
    }

    /// Datei in einen Ordner schreiben (der Name bleibt wie gewünscht).
    static func write(_ data: Data, name: String, in dir: URL? = nil) -> URL? {
        let targetDir = dir ?? FileManager.default.temporaryDirectory.appendingPathComponent("export-\(UUID().uuidString)", isDirectory: true)
        let url = targetDir.appendingPathComponent(name)
        do {
            try FileManager.default.createDirectory(at: targetDir, withIntermediateDirectories: true)
            try data.write(to: url, options: .atomic)
            return url
        } catch {
            return nil
        }
    }
}

/// Datei(en) zum Teilen (System-Teilen-Blatt als Sheet).
struct SharedFile: Identifiable, Sendable {
    let urls: [URL]
    var id: String { urls.map(\.path).joined(separator: ":") }
    var url: URL { urls.first ?? URL(fileURLWithPath: "") }

    init(url: URL) {
        self.urls = [url]
    }

    init(urls: [URL]) {
        self.urls = urls
    }
}

/// System-Teilen-Blatt für eine oder mehrere Dateien.
struct ShareSheet: UIViewControllerRepresentable {
    let items: [Any]

    init(items: [Any]) {
        self.items = items
    }

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }

    func updateUIViewController(_ vc: UIActivityViewController, context: Context) {}
}

/// Dialog „Heft exportieren“ (wie in Android HeftTransfer.kt:157 und PWA heft-export.js:109):
/// Auswahl des Dateinamens, des Formats (PDF oder einzelne PNG-Bilder), des Seitenumfangs
/// und des Hintergrunds (Papier, Weiß oder Transparent).
struct HeftExportSheet: View {
    @Environment(ImpalaStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let pageId: String
    let pageIds: [String]
    let currentId: String?
    /// In der Seitenübersicht ausgewählte Seiten (`exportSel` der PWA); nil = aktuelle oder alle wählbar.
    let only: [String]?
    let onShare: (SharedFile) -> Void

    @State private var name: String = ""
    @State private var format: ExportFormat = .pdf
    @State private var scope: ExportScope = .all
    @State private var background: HeftBackground = .paper
    @State private var status: String?
    @State private var errorMessage: String?
    @State private var exportTask: Task<Void, Never>?

    enum ExportFormat: String, CaseIterable, Identifiable {
        case pdf = "pdf"
        case png = "png"
        var id: String { rawValue }
        var title: String { self == .pdf ? "PDF-Dokument" : "Einzelne Bilder (PNG)" }
        var hint: String { self == .pdf ? "Alle ausgewählten Seiten in einer Datei" : "Eine PNG-Datei pro Seite" }
    }

    enum ExportScope: String, CaseIterable, Identifiable {
        case current = "current"
        case all = "all"
        var id: String { rawValue }
    }

    init(pageId: String, pageIds: [String], currentId: String?, only: [String]? = nil, onShare: @escaping (SharedFile) -> Void) {
        self.pageId = pageId
        self.pageIds = pageIds
        self.currentId = currentId
        self.only = only
        self.onShare = onShare
    }

    private var currentIndex: Int {
        currentId.flatMap { pageIds.firstIndex(of: $0) } ?? 0
    }

    private var targetIds: [String] {
        if let only { return only }
        if scope == .current, let id = currentId {
            return [id]
        }
        return pageIds
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    VStack(alignment: .leading, spacing: Space.s1) {
                        Text(summaryText)
                            .font(.system(size: TextSize.sm))
                            .foregroundStyle(Impala.text2)
                        TextField("Dateiname", text: $name)
                            .textFieldStyle(.roundedBorder)
                            .autocorrectionDisabled()
                            .textInputAutocapitalization(.never)
                    }
                } header: {
                    Text("Dateiname")
                }

                if only == nil, pageIds.count > 1 {
                    Section("Seitenumfang") {
                        Picker("Umfang", selection: $scope) {
                            Text("Aktuelle Seite (Seite \(currentIndex + 1))").tag(ExportScope.current)
                            Text("Alle Seiten (\(pageIds.count) Seiten)").tag(ExportScope.all)
                        }
                        .pickerStyle(.segmented)
                    }
                }

                Section("Format") {
                    ForEach(ExportFormat.allCases) { f in
                        HStack(alignment: .top, spacing: Space.s2) {
                            Image(systemName: format == f ? "largecircle.fill.circle" : "circle")
                                .foregroundStyle(format == f ? Impala.accent : Impala.text2)
                                .font(.system(size: 18))
                                .padding(.top, 2)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(f.title)
                                    .font(.system(size: TextSize.sm, weight: .medium))
                                    .foregroundStyle(Impala.text)
                                Text(f.hint)
                                    .font(.system(size: TextSize.xs))
                                    .foregroundStyle(Impala.text2)
                            }
                            Spacer()
                        }
                        .contentShape(Rectangle())
                        .onTapGesture { format = f }
                    }
                }

                Section {
                    Picker("Hintergrund", selection: $background) {
                        ForEach(HeftBackground.allCases) { bg in
                            Text(bg.label).tag(bg)
                        }
                    }
                    .pickerStyle(.segmented)
                } header: {
                    Text("Hintergrund")
                } footer: {
                    Text(background.hint)
                        .font(.system(size: TextSize.xs))
                        .foregroundStyle(Impala.text2)
                }

                if let status {
                    Section {
                        HStack(spacing: Space.s2) {
                            ProgressView()
                            Text(status)
                                .font(.system(size: TextSize.sm))
                                .foregroundStyle(Impala.text)
                        }
                    }
                }
            }
            .navigationTitle("Heft exportieren")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Abbrechen") {
                        exportTask?.cancel()
                        dismiss()
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(status == nil ? "Exportieren" : "Wird erstellt …") {
                        startExport()
                    }
                    .disabled(status != nil)
                    .fontWeight(.semibold)
                }
            }
            .alert("Export fehlgeschlagen", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(errorMessage ?? "")
            }
            .onAppear {
                let fallback = HeftExport.fileName(store.core, pageId)
                if name.isEmpty { name = fallback }
            }
        }
    }

    private var summaryText: String {
        let title = store.core.page(id: pageId)?.summary.title ?? "Heft"
        let count = targetIds.count
        let countStr = count == 1 ? "1 Seite" : "\(count) Seiten"
        return "\(countStr) · \(title)"
    }

    private func startExport() {
        let ids = targetIds
        guard !ids.isEmpty else { return }
        let baseName = HeftExport.cleanName(name, fallback: HeftExport.fileName(store.core, pageId))
        let core = store.core
        let bg = background
        let isPdf = format == .pdf

        status = "Wird vorbereitet …"
        exportTask = Task {
            if isPdf {
                let url = await HeftExport.pdf(core: core, pageId: pageId, heftPageIds: ids, baseName: baseName) { s in
                    Task { @MainActor in status = s }
                }
                guard !Task.isCancelled else { return }
                if let url {
                    dismiss()
                    onShare(SharedFile(url: url))
                } else {
                    status = nil
                    errorMessage = "Das PDF-Dokument konnte nicht erzeugt werden."
                }
            } else {
                let urls = await HeftExport.pagesPng(core: core, pageId: pageId, heftPageIds: ids, baseName: baseName, background: bg) { s in
                    Task { @MainActor in status = s }
                }
                guard !Task.isCancelled else { return }
                if let urls, !urls.isEmpty {
                    dismiss()
                    onShare(SharedFile(urls: urls))
                } else {
                    status = nil
                    errorMessage = "Die PNG-Bilder konnten nicht erzeugt werden."
                }
            }
        }
    }
}
