import SwiftUI

/// Notiz wie die Seitenansicht der PWA: Brotkrumen, Emoji, großer Titel, darunter der Inhalt (vorerst
/// Markdown als Text; Blöcke wie in der Android-App folgen über `markdownToBlocks`). Speichert kurz nach
/// dem Tippen über den Kern; fremde Änderungen laden nach, solange hier nichts ungespeichert ist.
struct NoteEditor: View {
    @Environment(ImpalaStore.self) private var store
    @Environment(ShellModel.self) private var shell
    let pageId: String
    @State private var title = ""
    @State private var content = ""
    @State private var saved = (title: "", content: "")
    @State private var saveTask: Task<Void, Never>?

    private var dirty: Bool { title != saved.title || content != saved.content }

    var body: some View {
        let _ = store.pagesRevision
        let page = store.core.page(id: pageId)
        let ancestors = store.core.ancestorsOf(id: pageId)
        ScrollView {
            VStack(alignment: .leading, spacing: Space.s3) {
                if !ancestors.isEmpty { Breadcrumbs(pages: ancestors) { shell.open($0) } }
                if let summary = page?.summary, let emoji = PageStyle.emoji(summary) {
                    Text(emoji).font(.system(size: 52))
                }
                TextField("Ohne Titel", text: $title, axis: .vertical)
                    .font(.system(size: 34, weight: .bold))
                    .foregroundStyle(Impala.text)
                    .onChange(of: title) { scheduleSave() }
                TextEditor(text: $content)
                    .font(.system(size: 17))
                    .lineSpacing(4)
                    .foregroundStyle(Impala.text)
                    .scrollContentBackground(.hidden)
                    .scrollDisabled(true)
                    .frame(minHeight: 400)
                    .onChange(of: content) { scheduleSave() }
            }
            .padding(.horizontal, 48)
            .padding(.top, 40)
            .padding(.bottom, 120)
            .frame(maxWidth: 820, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(Impala.panel)
        .onAppear(perform: load)
        .onDisappear(perform: saveNow)
        .onChange(of: store.lastRemote) {
            if !dirty, store.remoteTouches(pageId) { load() }
        }
    }

    private func load() {
        guard let page = store.core.page(id: pageId) else { return }
        saved = (page.summary.title, page.content)
        title = page.summary.title
        content = page.content
    }

    private func scheduleSave() {
        guard dirty else { return }
        saveTask?.cancel()
        saveTask = Task {
            try? await Task.sleep(for: .milliseconds(600))
            if !Task.isCancelled { saveNow() }
        }
    }

    private func saveNow() {
        guard dirty else { return }
        let newTitle = title == saved.title ? nil : title
        let newContent = content == saved.content ? nil : content
        saved = (title, content)
        try? store.core.updatePage(id: pageId, title: newTitle, content: newContent)
    }
}

/// Brotkrumen über dem Titel (`.crumbs`): Elternkette, antippen öffnet.
private struct Breadcrumbs: View {
    let pages: [PageSummary]
    let open: (String) -> Void

    var body: some View {
        HStack(spacing: Space.s1) {
            ForEach(Array(pages.enumerated()), id: \.element.id) { i, p in
                if i > 0 { Icon("chevron-right", size: 10).foregroundStyle(Impala.text2) }
                Button { open(p.id) } label: {
                    HStack(spacing: 4) {
                        PageIcon(page: p, size: 12)
                        Text(PageStyle.title(p)).lineLimit(1)
                    }
                    .font(.system(size: TextSize.sm))
                    .foregroundStyle(Impala.text2)
                }
                .buttonStyle(.plain)
            }
        }
    }
}
