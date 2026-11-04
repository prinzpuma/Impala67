import PDFKit
import SwiftUI

/// PDF einer Bibliotheks-Seite, nativ mit PDFKit (Zoomen, Suchen per Markieren, Teilen). Die Bytes kommen
/// aus dem Kern (`file`); fehlt die Datei noch (Sync läuft), steht da „PDF nicht gefunden“ wie in der PWA.
struct PdfScreen: View {
    let page: PageSummary
    @Environment(ImpalaStore.self) private var store
    @Environment(ShellModel.self) private var shell
    @State private var document: PDFDocument?
    @State private var shareURL: URL?
    @State private var missing = false
    @State private var current = 1

    var body: some View {
        ZStack(alignment: .bottom) {
            if let document {
                PdfKitView(document: document, page: $current)
                    .ignoresSafeArea(edges: .bottom)
                    .transition(.opacity)
                if document.pageCount > 1 {
                    // Seitenzahl schwebt wie die Blätter-Leiste im Heft in Liquid Glass.
                    Text("\(current) / \(document.pageCount)")
                        .font(.system(size: TextSize.sm, weight: .medium).monospacedDigit())
                        .foregroundStyle(Impala.text)
                        .contentTransition(.numericText(value: Double(current)))
                        .animation(.snappy(duration: 0.25), value: current)
                        .padding(.horizontal, Space.s3)
                        .padding(.vertical, 7)
                        .impalaGlass()
                        .padding(.bottom, Space.s4)
                }
            } else if missing {
                Placeholder(icon: "file", title: "PDF nicht gefunden", text: "Die Datei ist auf diesem Gerät noch nicht da. Nach dem nächsten Sync erneut öffnen.")
            } else {
                ProgressView("PDF wird geladen…").frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .animation(.smooth(duration: 0.3), value: document == nil)
        .background(Impala.bg0)
        .navigationTitle(PageStyle.title(page))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if let shareURL {
                ToolbarItem(placement: .primaryAction) { ShareLink(item: shareURL) }
            }
            ToolbarItem(placement: .primaryAction) {
                Button {
                    shell.open(page.id)
                    shell.sheet = nil
                } label: { Label("Als Seite öffnen", image: "i-note") }
            }
        }
        .task(id: page.pdfId) { await load() }
    }

    private func load() async {
        guard let id = page.pdfId else { missing = true; return }
        let core = store.core
        let name = Self.fileName(PageStyle.title(page))
        let loaded: (Data, URL?)? = await Task.detached {
            guard let file = attempt(try core.file(id: id), "file") else { return nil }
            // Für „Teilen“ eine Kopie mit lesbarem Namen ablegen.
            let url = FileManager.default.temporaryDirectory.appending(path: name)
            return (file.bytes, (try? file.bytes.write(to: url)) != nil ? url : nil)
        }.value
        guard let loaded, let doc = PDFDocument(data: loaded.0) else { missing = true; return }
        document = doc
        shareURL = loaded.1
    }

    /// Dateiname wie `cachePdf` in LibraryPdf.kt.
    static func fileName(_ title: String) -> String {
        let clean = title.replacingOccurrences(of: #"[\\/:*?"<>|]"#, with: "_", options: .regularExpression)
            .trimmingCharacters(in: .whitespaces)
        return (clean.isEmpty ? "Dokument" : clean) + ".pdf"
    }
}

/// `PDFView` in SwiftUI: fortlaufend senkrecht, an die Breite angepasst; meldet die aktuelle Seite.
private struct PdfKitView: UIViewRepresentable {
    let document: PDFDocument
    @Binding var page: Int

    func makeUIView(context: Context) -> PDFView {
        let view = PDFView()
        view.displayMode = .singlePageContinuous
        view.displayDirection = .vertical
        view.pageShadowsEnabled = true
        view.backgroundColor = UIColor(Impala.bg0)
        view.document = document
        view.autoScales = true
        NotificationCenter.default.addObserver(
            context.coordinator, selector: #selector(Coordinator.pageChanged(_:)), name: .PDFViewPageChanged, object: view
        )
        return view
    }

    func updateUIView(_ view: PDFView, context: Context) {
        context.coordinator.page = $page
        if view.document !== document {
            view.document = document
            view.autoScales = true
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator(page: $page) }

    final class Coordinator: NSObject {
        var page: Binding<Int>
        init(page: Binding<Int>) { self.page = page }

        @objc func pageChanged(_ note: Notification) {
            guard let view = note.object as? PDFView, let current = view.currentPage, let doc = view.document else { return }
            page.wrappedValue = doc.index(for: current) + 1
        }
    }
}
