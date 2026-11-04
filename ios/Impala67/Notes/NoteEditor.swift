import SwiftUI

/// Notiz bearbeiten: Titel und Markdown-Text (erster Schritt; Blöcke wie in der Android-App folgen über
/// `markdownToBlocks`). Speichert kurz nach dem Tippen über den Kern; fremde Änderungen laden nach,
/// solange hier nichts ungespeichert ist.
struct NoteEditor: View {
    @Environment(ImpalaStore.self) private var store
    let pageId: String
    @State private var title = ""
    @State private var content = ""
    @State private var dirty = false
    @State private var saveTask: Task<Void, Never>?

    var body: some View {
        VStack(alignment: .leading, spacing: Space.s3) {
            TextField("Unbenannt", text: $title)
                .font(.largeTitle.bold())
                .foregroundStyle(Impala.text)
                .onChange(of: title) { scheduleSave() }
            TextEditor(text: $content)
                .font(.body)
                .foregroundStyle(Impala.text)
                .scrollContentBackground(.hidden)
                .onChange(of: content) { scheduleSave() }
        }
        .padding(.horizontal, Space.s6)
        .padding(.top, Space.s4)
        .frame(maxWidth: 820, alignment: .leading)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(Impala.panel)
        .navigationBarTitleDisplayMode(.inline)
        .onAppear(perform: load)
        .onDisappear(perform: saveNow)
        .onChange(of: store.lastRemote) {
            if !dirty, store.remoteTouches(pageId) { load() }
        }
    }

    private func load() {
        guard let page = store.core.page(id: pageId) else { return }
        title = page.summary.title
        content = page.content
        // Die onChange-Aufrufe des Ladens sollen nicht speichern.
        DispatchQueue.main.async { dirty = false; saveTask?.cancel() }
    }

    private func scheduleSave() {
        dirty = true
        saveTask?.cancel()
        saveTask = Task {
            try? await Task.sleep(for: .milliseconds(600))
            if !Task.isCancelled { saveNow() }
        }
    }

    private func saveNow() {
        guard dirty, let page = store.core.page(id: pageId) else { return }
        dirty = false
        let newTitle = title == page.summary.title ? nil : title
        let newContent = content == page.content ? nil : content
        try? store.core.updatePage(id: pageId, title: newTitle, content: newContent)
    }
}
