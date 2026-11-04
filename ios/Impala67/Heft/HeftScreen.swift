import SwiftUI

/// Heft: eine Seite zum Zeichnen, Wechsel über die Leiste oben, neue Seite hinten anfügen.
/// Werkzeuge kommen aus dem System-Werkzeugpicker von PencilKit.
struct HeftScreen: View {
    @Environment(ImpalaStore.self) private var store
    let pageId: String
    let title: String
    @State private var pageIds: [String] = []
    @State private var index = 0
    @State private var remoteRevision = 0

    var body: some View {
        Group {
            if pageIds.indices.contains(index) {
                HeftCanvas(core: store.core, pageId: pageId, heftPageId: pageIds[index], remoteRevision: remoteRevision)
                    .id(pageIds[index])
                    .ignoresSafeArea(edges: .bottom)
            } else {
                ProgressView()
            }
        }
        .background(Impala.bg0)
        .navigationTitle(title.isEmpty ? "Unbenannt" : title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                Button("Vorige Seite", systemImage: "chevron.left") { index -= 1 }
                    .disabled(index == 0)
                Text(pageIds.isEmpty ? "" : "\(index + 1) / \(pageIds.count)")
                    .monospacedDigit()
                    .foregroundStyle(Impala.text2)
                Button("Nächste Seite", systemImage: "chevron.right") { index += 1 }
                    .disabled(index >= pageIds.count - 1)
                Button("Seite hinzufügen", systemImage: "plus.rectangle.portrait") { addPage() }
            }
        }
        .onAppear(perform: loadPages)
        .onChange(of: store.lastRemote) {
            guard store.remoteTouches(pageId) else { return }
            loadPages()
            remoteRevision += 1
        }
    }

    private func loadPages() {
        pageIds = store.core.heftPageIds(pageId: pageId)
        index = min(index, max(0, pageIds.count - 1))
    }

    private func addPage() {
        guard let id = try? store.core.heftAddPage(pageId: pageId, at: nil, paper: nil) else { return }
        loadPages()
        index = pageIds.firstIndex(of: id) ?? index
    }
}
