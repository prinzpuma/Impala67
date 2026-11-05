import PDFKit
import UIKit
import UniformTypeIdentifiers

/// Anhang der nächsten Chat-Nachricht wie in der PWA (ai.js: `image`, `textFile`, `pdfFile` der
/// Nachricht): ein Bild als Data-URL, eine Textdatei oder der Text eines PDFs. Den Prompt baut der Kern.
struct ChatAttachment: Identifiable {
    enum Kind {
        case image(dataURL: String)
        case text(AiFile)
        case pdf(AiFile)
    }

    let id = UUID()
    let kind: Kind
    /// Anzeige im Chip und in der Nachricht.
    let name: String
    /// Kleines Vorschaubild (nur Bilder und Heftseiten).
    let preview: UIImage?

    /// Höchstens so viele Zeichen aus Text und PDF (große Dateien sprengen sonst das Kontextfenster).
    static let maxChars = 120_000

    /// Foto bzw. Bilddatei: verkleinert auf 1600 px, JPEG.
    static func image(_ image: UIImage, name: String) -> ChatAttachment? {
        guard let (data, _) = HeftImport.jpeg(image, maxEdge: 1600) else { return nil }
        return ChatAttachment(kind: .image(dataURL: "data:image/jpeg;base64," + data.base64EncodedString()),
                              name: name, preview: image)
    }

    /// Datei aus dem Dateiimporter: PDF als Text, Bilder als Bild, sonst als UTF-8-Text.
    static func file(_ url: URL) -> ChatAttachment? {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        let name = url.lastPathComponent
        let type = UTType(filenameExtension: url.pathExtension)
        if type?.conforms(to: .pdf) == true {
            guard let doc = PDFDocument(url: url) else { return nil }
            let text = String((doc.string ?? "").prefix(maxChars))
            guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
            return ChatAttachment(kind: .pdf(AiFile(name: name, content: text)), name: name, preview: nil)
        }
        guard let data = try? Data(contentsOf: url) else { return nil }
        if type?.conforms(to: .image) == true, let img = UIImage(data: data) { return image(img, name: name) }
        guard let text = String(data: data, encoding: .utf8) ?? String(data: data, encoding: .isoLatin1) else { return nil }
        return ChatAttachment(kind: .text(AiFile(name: name, content: String(text.prefix(maxChars)))), name: name, preview: nil)
    }

    /// Eingefügter langer Text als Datei-Anhang („geklebter-text.txt“ wie in der PWA).
    static func pastedText(_ text: String) -> ChatAttachment {
        let content = String(text.prefix(maxChars))
        return ChatAttachment(kind: .text(AiFile(name: "geklebter-text.txt", content: content)),
                              name: "geklebter-text.txt", preview: nil)
    }

    /// Die angezeigte Seite eines Hefts als Bild („Heftseite anhängen“).
    @MainActor
    static func heftPage(core: ImpalaCore, pageId: String) -> ChatAttachment? {
        let ids = core.heftPageIds(pageId: pageId)
        let i = min(HeftLastPage.index[pageId] ?? 0, max(ids.count - 1, 0))
        guard ids.indices.contains(i),
              let img = HeftThumbnail.render(core: core, pageId: pageId, heftPageId: ids[i], width: 1000, scale: 1, imagePixels: 1400)
        else { return nil }
        return image(img, name: "Heftseite \(i + 1)")
    }

    /// Zusatzfelder der eigenen Nachricht (`extra.pdfFile`/`textFile`), damit der Chip den Namen zeigt.
    var extraJson: String {
        let key: String
        switch kind {
        case .image: return "{}"
        case .text: key = "textFile"
        case .pdf: key = "pdfFile"
        }
        let obj: [String: Any] = [key: ["name": name]]
        guard let data = try? JSONSerialization.data(withJSONObject: obj) else { return "{}" }
        return String(decoding: data, as: UTF8.self)
    }
}
