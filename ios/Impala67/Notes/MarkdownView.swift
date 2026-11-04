import SwiftUI

/// Markdown nur anzeigen, mit denselben Blöcken wie der Notiz-Editor (Formeln, Code, Tabellen, Bilder,
/// Callouts …). Für Lernkarten; Parsen macht der Kern (`markdownToBlocks`). Seitenlinks öffnen den Tab.
struct MarkdownView: View {
    let markdown: String
    @Environment(ImpalaStore.self) private var store
    @Environment(ShellModel.self) private var shell
    @State private var model: NoteModel

    /// Sofort geparst, damit die Karte beim Umdrehen nicht nachspringt.
    init(_ markdown: String, core: ImpalaCore) {
        self.markdown = markdown
        _model = State(initialValue: NoteModel(core: core, markdown: markdown))
    }

    var body: some View {
        let numbers = listNumbers(model.blocks)
        VStack(alignment: .leading, spacing: 2) {
            ForEach(Array(model.blocks.enumerated()), id: \.element.id) { i, b in
                BlockRow(block: b, number: numbers[b.id], first: i == 0, model: model, nested: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onChange(of: markdown) { model = NoteModel(core: store.core, markdown: markdown) }
        .environment(\.openURL, OpenURLAction { url in open(url) })
    }

    /// Wie im Editor: `impala://page/<id>` und `impala://wiki/<Titel>` öffnen die Seite.
    private func open(_ url: URL) -> OpenURLAction.Result {
        guard url.scheme == "impala" else { return .systemAction }
        let rest = String(url.path(percentEncoded: false).dropFirst())
        switch url.host() {
        case "page": shell.open(rest)
        case "wiki": if let p = store.core.findPageByTitle(title: rest) { shell.open(p.id) }
        default: break
        }
        return .handled
    }
}
