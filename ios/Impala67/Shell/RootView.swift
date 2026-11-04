import SwiftUI

/// Layout der PWA am iPad: links die Seitenleiste mit dem Seitenbaum, rechts die offene Seite.
/// Auf dem iPhone klappt `NavigationSplitView` zu einem Stapel zusammen.
struct RootView: View {
    @Environment(ImpalaStore.self) private var store
    @State private var selection: String?
    @State private var columns: NavigationSplitViewVisibility = .all

    var body: some View {
        NavigationSplitView(columnVisibility: $columns) {
            Sidebar(selection: $selection)
                .navigationSplitViewColumnWidth(min: 240, ideal: 280, max: 360)
        } detail: {
            // pagesRevision lesen, damit ein gelöschter oder umbenannter Eintrag die Ansicht neu baut.
            let _ = store.pagesRevision
            if let id = selection, let page = store.core.page(id: id), !page.trashed {
                PageScreen(summary: page.summary)
                    .id(id)
            } else {
                ContentUnavailableView("Keine Seite geöffnet", systemImage: "doc.text", description: Text("Wähle links eine Seite oder lege eine neue an."))
            }
        }
        .navigationSplitViewStyle(.balanced)
    }
}

/// Notiz oder Heft, je nach Seitenart.
struct PageScreen: View {
    let summary: PageSummary

    var body: some View {
        switch summary.kind {
        case .note: NoteEditor(pageId: summary.id)
        case .heft: HeftScreen(pageId: summary.id, title: summary.title)
        }
    }
}
