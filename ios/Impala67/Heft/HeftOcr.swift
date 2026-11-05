import PencilKit
import SwiftUI
import UIKit
import Vision

/// Handschrift-Erkennung auf dem iPad mit Apple Vision (Deutsch und Englisch, auf dem Gerät):
/// - „In Text“ im Lasso (`recognize`, wie `recognizeLassoText` in `heft-lasso.js`).
/// - Automatische Seiten-Erkennung für Suche & KI (`schedule`, `startBackgroundScan`, Quelle `"apple"`,
///   höchste Stufe über `"android"` und `"pwa"`).
enum HeftOcr {
    private static let src = "apple"
    /// Nach dem letzten Strich warten, bevor die Seite erkannt wird (`PRIORITY_DEBOUNCE_MS` in heft-indexer.js).
    private static let debounceNs: UInt64 = 15_000_000_000
    private static let bgStartNs: UInt64 = 5_000_000_000
    /// Pause zwischen zwei Seiten im Hintergrund (`SCAN_PAUSE_MS`).
    private static let bgPauseNs: UInt64 = 5_000_000_000
    /// Solange so kurz zuvor geschrieben wurde, ruht die Erkennung (wie `heft:is-writing` der PWA).
    private static let writingQuiet: TimeInterval = 5

    @MainActor private static var pageTasks: [String: Task<Void, Never>] = [:]
    @MainActor private static var bgTask: Task<Void, Never>?

    /// Text im Bild, Zeilen von oben nach unten; leer, wenn nichts erkannt wurde.
    static func recognize(_ image: CGImage) async -> String {
        await Task.detached(priority: .utility) {
            let request = VNRecognizeTextRequest()
            request.recognitionLevel = .accurate
            request.usesLanguageCorrection = true
            request.recognitionLanguages = ["de-DE", "en-US"]
            do {
                try VNImageRequestHandler(cgImage: image).perform([request])
            } catch {
                return ""
            }
            let lines = (request.results ?? [])
                .sorted { $0.boundingBox.maxY > $1.boundingBox.maxY }
                .compactMap { $0.topCandidates(1).first?.string }
            return lines.joined(separator: "\n")
        }.value
    }

    /// Seite nach einer Strich-Änderung verzögert mit Apple Vision erkennen und im Kern speichern.
    @MainActor
    static func schedule(core: ImpalaCore, pageId: String, heftPageId: String) {
        let key = "\(pageId):\(heftPageId)"
        pageTasks[key]?.cancel()
        pageTasks[key] = Task { @MainActor in
            try? await Task.sleep(nanoseconds: debounceNs)
            guard !Task.isCancelled else { return }
            await waitWhileWriting()
            guard !Task.isCancelled else { return }
            await indexPage(core: core, pageId: pageId, heftPageId: heftPageId)
        }
    }

    /// Ruht, solange im Heft geschrieben wird oder die App im Hintergrund ist (heft-indexer.js).
    @MainActor
    private static func waitWhileWriting() async {
        while !Task.isCancelled,
              HeftActivity.isWriting(within: writingQuiet) || UIApplication.shared.applicationState != .active {
            try? await Task.sleep(nanoseconds: 2_000_000_000)
        }
    }

    /// Erkennt die Striche einer Heftseite mit Apple Vision und übergibt das Ergebnis an `heftRecordOcr`
    /// (der Kern hängt den Text vorhandener Scan-Bilder an und prüft Fingerabdruck + Rangfolge).
    /// Läuft ganz im Hintergrund: Seite laden und als Bild rendern dauert bei vollen Seiten Sekunden –
    /// auf dem Hauptthread waren das die Hänger, die der Profiler zeigte.
    static func indexPage(core: ImpalaCore, pageId: String, heftPageId: String) async {
        await Task.detached(priority: .utility) {
            await indexPageInBackground(core: core, pageId: pageId, heftPageId: heftPageId)
        }.value
    }

    private static func indexPageInBackground(core: ImpalaCore, pageId: String, heftPageId: String) async {
        guard let page = attempt("heftPage", { try core.heftPage(pageId: pageId, heftPageId: heftPageId) }) else { return }
        if page.strokes.isEmpty {
            _ = attempt("heftRecordOcr", { try core.heftRecordOcr(
                pageId: pageId, heftPageId: heftPageId, strokeText: "", src: src, expectedKey: page.contentKey
            ) })
            return
        }
        guard let cg = renderStrokes(page.strokes) else { return }
        let text = await recognize(cg)
        guard !Task.isCancelled else { return }
        _ = attempt("heftRecordOcr", { try core.heftRecordOcr(
            pageId: pageId, heftPageId: heftPageId, strokeText: text, src: src, expectedKey: page.contentKey
        ) })
    }

    /// Rendert die Striche einer Seite dunkel auf weißem Grund (ohne Papierlinien, optimal für Vision).
    /// PencilKit-Zeichnungen und `UIGraphicsImageRenderer` dürfen außerhalb des Hauptthreads rendern.
    private static func renderStrokes(_ strokes: [HeftStroke]) -> CGImage? {
        let raw = HeftInk.bounds(strokes)
        guard !raw.isNull else { return nil }
        let bounds = raw.insetBy(dx: -16, dy: -16)
        guard bounds.width > 1, bounds.height > 1 else { return nil }
        let format = UIGraphicsImageRendererFormat()
        format.scale = 2
        format.opaque = true
        // Selbst gezeichnet wie die PWA: PencilKit-Bilder älterer Striche waren fast leer, Vision las nichts.
        return UIGraphicsImageRenderer(size: bounds.size, format: format).image { ctx in
            UIColor.white.setFill()
            ctx.fill(CGRect(origin: .zero, size: bounds.size))
            ctx.cgContext.translateBy(x: -bounds.minX, y: -bounds.minY)
            HeftInk.draw(strokes, in: ctx.cgContext)
        }.cgImage
    }

    /// Wertet im Leerlauf alle Seiten auf, die noch keinen Text haben oder bisher nur von PWA/Android
    /// erkannt wurden (`heftOcrJobs(src: "apple")`).
    @MainActor
    static func startBackgroundScan(core: ImpalaCore) {
        // Performance-Modus: keine Hintergrund-Erkennung (wie `motion` in der PWA).
        if bgTask != nil || AppMotion.isReduced { return }
        bgTask = Task { @MainActor in
            defer { bgTask = nil }
            try? await Task.sleep(nanoseconds: bgStartNs)
            var tried = Set<String>()
            while !Task.isCancelled {
                // Auftragsliste über alle Hefte einmal je Durchlauf (nicht je Seite), im Hintergrund.
                let jobs = await Task.detached(priority: .utility) { core.heftOcrJobs(src: src) }.value
                let fresh = jobs.filter { tried.insert("\($0.pageId):\($0.heftPageId):\($0.contentKey)").inserted }
                guard !fresh.isEmpty else { break }
                // Eine Seite je 5 s, wie `SCAN_PAUSE_MS` der PWA.
                for job in fresh {
                    await waitWhileWriting()
                    guard !Task.isCancelled else { return }
                    await indexPage(core: core, pageId: job.pageId, heftPageId: job.heftPageId)
                    try? await Task.sleep(nanoseconds: bgPauseNs)
                }
            }
        }
    }

    @MainActor
    static func stopBackgroundScan() {
        bgTask?.cancel()
        bgTask = nil
    }
}

/// Ergebnis der Erkennung: Text, umkreiste Striche und ihr Rahmen (Seitenkoordinaten).
struct HeftOcrResult: Identifiable {
    let id = UUID()
    var text: String
    let strokeIds: [String]
    let bounds: CGRect
}

/// Erkannter Text zum Prüfen: kopieren oder die Striche durch ein Textfeld ersetzen.
struct HeftOcrSheet: View {
    let result: HeftOcrResult
    let onReplace: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: Space.s3) {
                if result.text.isEmpty {
                    Text("Keine Handschrift erkannt. Umkreise die Striche etwas großzügiger.")
                        .font(.system(size: TextSize.sm))
                        .foregroundStyle(Impala.text2)
                }
                TextEditor(text: $text)
                    .font(.system(size: TextSize.lg))
                    .scrollContentBackground(.hidden)
                    .padding(Space.s2)
                    .background(Impala.surface, in: RoundedRectangle(cornerRadius: Radius.sm))
                HStack(spacing: Space.s2) {
                    TintButton(title: "Kopieren") {
                        UIPasteboard.general.string = text
                        dismiss()
                    }
                    TintButton(title: "Als Textfeld ersetzen", strong: true) {
                        onReplace(text)
                        dismiss()
                    }
                    .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
            .padding(Space.s4)
            .navigationTitle("Handschrift → Text")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Schließen") { dismiss() } }
            }
        }
        .onAppear { text = result.text }
    }
}
