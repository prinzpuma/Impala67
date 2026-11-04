import SwiftUI
import UniformTypeIdentifiers

/// Bibliothek, Bereich „Dokumente“ (web/library.js, `LibraryScreen.kt`): Seiten mit PDF, neueste zuerst.
/// Antippen öffnet das PDF nativ mit PDFKit (zoomt aus der Zeile), „PDF hinzufügen“ importiert über den
/// Dateiimporter. Datei und Seite legt der Kern an (`addFile`, `pageCreate` mit `pdfId`).
struct LibrarySheet: View {
    @Environment(ImpalaStore.self) private var store
    @Environment(ShellModel.self) private var shell
    @State private var path: [String] = []
    @State private var importing = false
    @State private var failed = false
    @Namespace private var zoom

    var body: some View {
        NavigationStack(path: $path) {
            list
                .navigationTitle("Bibliothek")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { CloseButton() }
                    ToolbarItem(placement: .primaryAction) {
                        Button { importing = true } label: { Label("PDF hinzufügen", image: "i-plus") }
                            .labelStyle(.titleAndIcon)
                    }
                }
                .navigationDestination(for: String.self) { id in
                    if let page = store.core.page(id: id)?.summary {
                        PdfScreen(page: page)
                            .navigationTransition(.zoom(sourceID: id, in: zoom))
                    }
                }
        }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.pdf], allowsMultipleSelection: true) { result in
            guard case .success(let urls) = result else { return }
            importPdfs(urls)
        }
        .alert("PDF-Datei konnte nicht geladen werden.", isPresented: $failed) { Button("OK", role: .cancel) {} }
    }

    private var list: some View {
        let _ = store.pagesRevision
        let pages = store.core.recentPages(limit: UInt32.max).filter { $0.pdfId != nil }
        return List(pages) { page in
            LibraryRow(page: page) { store.core.patchPage(page.id, ["favorite": !page.favorite]) }
            .onTapGesture { path.append(page.id) }
            .hoverEffect(.highlight)
            .matchedTransitionSource(id: page.id, in: zoom)
            .contextMenu {
                MenuItem("PDF öffnen", icon: "book-open") { path.append(page.id) }
                MenuItem("Als Seite öffnen", icon: "note") {
                    shell.open(page.id)
                    shell.sheet = nil
                }
                MenuItem(page.favorite ? "Favorit entfernen" : "Zu Favoriten", icon: "star") {
                    store.core.patchPage(page.id, ["favorite": !page.favorite])
                }
                MenuItem("In Papierkorb", icon: "trash", role: .destructive) {
                    shell.close(page.id)
                    try? store.core.trashPage(id: page.id)
                }
            }
            .swipeActions(edge: .trailing) {
                Button("Löschen", role: .destructive) {
                    shell.close(page.id)
                    try? store.core.trashPage(id: page.id)
                }
            }
        }
        .animation(.snappy(duration: 0.28), value: store.pagesRevision)
        .overlay {
            if pages.isEmpty {
                ContentUnavailableView {
                    Label { Text("Noch keine PDFs") } icon: { Icon("library", size: 40).foregroundStyle(Impala.text2) }
                } description: {
                    Text("PDFs erscheinen hier und lassen sich direkt lesen.")
                } actions: {
                    Button("PDF hinzufügen") { importing = true }.buttonStyle(.glassProminent)
                }
            }
        }
    }

    /// Gewählte PDFs in den Kern; das letzte öffnet sich gleich.
    private func importPdfs(_ urls: [URL]) {
        var last: String?
        for url in urls {
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            guard let data = try? Data(contentsOf: url),
                  let id = try? store.core.importPdf(name: url.lastPathComponent, bytes: data) else {
                failed = true
                continue
            }
            last = id
        }
        if let last { path = [last] }
    }
}

/// Zeile wie `LibraryRow`: Symbol, Titel, Änderung · PDF, Stern.
private struct LibraryRow: View {
    let page: PageSummary
    let onFavorite: () -> Void

    var body: some View {
        HStack(spacing: Space.s3) {
            Group {
                if let emoji = PageStyle.emoji(page) { Text(emoji).font(.system(size: 17)) } else { Icon("file", size: 18) }
            }
            .foregroundStyle(Impala.accent)
            .frame(width: 24)
            VStack(alignment: .leading, spacing: 2) {
                Text(PageStyle.title(page))
                    .font(.system(size: TextSize.md, weight: .semibold))
                    .foregroundStyle(Impala.text)
                    .lineLimit(1)
                Text(ChatList.when(page.updated) + " · PDF")
                    .font(.system(size: TextSize.xs))
                    .foregroundStyle(Impala.text2)
            }
            Spacer(minLength: 0)
            Button(action: onFavorite) {
                Icon("star", size: 16)
                    .foregroundStyle(page.favorite ? Impala.accent : Impala.text2)
                    .frame(width: 32, height: 32)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.borderless)
            .accessibilityLabel(page.favorite ? "Favorit entfernen" : "Zu Favoriten")
        }
        .padding(.vertical, 2)
        .contentShape(Rectangle())
    }
}
