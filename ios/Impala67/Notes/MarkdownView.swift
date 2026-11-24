import SwiftUI

/// Markdown nur anzeigen, mit denselben Blöcken wie der Notiz-Editor (Formeln, Code, Tabellen, Bilder,
/// Callouts …). Für Lernkarten; Parsen macht der Kern (`markdownToBlocks`). Seitenlinks öffnen den Tab.
struct MarkdownView: View {
    let markdown: String
    @Environment(ImpalaStore.self) private var store
    @Environment(ShellModel.self) private var shell
    @State private var model: NoteModel

    /// Sofort geparst, damit die Karte beim Umdrehen nicht nachspringt. `State(initialValue:)` läuft bei jedem
    /// Neuzeichnen des Elternteils; ohne Zwischenspeicher parste das jedes Mal (beim Streamen je Token doppelt).
    init(_ markdown: String, core: ImpalaCore) {
        self.markdown = markdown
        _model = State(initialValue: MarkdownCache.model(markdown, core: core))
    }

    var body: some View {
        let numbers = model.listNumbers
        VStack(alignment: .leading, spacing: 2) {
            ForEach(Array(model.blocks.enumerated()), id: \.element.id) { i, b in
                BlockRow(block: b, number: numbers[b.id], first: i == 0, model: model)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onChange(of: markdown) { model = MarkdownCache.model(markdown, core: store.core) }
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

/// Zuletzt geparste Texte (nur Anzeige, schreibgeschützt – gleiche Texte dürfen sich ein Modell teilen).
@MainActor
private enum MarkdownCache {
    private static var models: [String: NoteModel] = [:]

    static func model(_ markdown: String, core: ImpalaCore) -> NoteModel {
        if let m = models[markdown] { return m }
        // Gestreamte Entwürfe erzeugen viele Zwischenstände: klein halten statt aufwendig zu verdrängen.
        if models.count >= 48 { models.removeAll(keepingCapacity: true) }
        let m = NoteModel(core: core, markdown: markdown)
        models[markdown] = m
        return m
    }
}
