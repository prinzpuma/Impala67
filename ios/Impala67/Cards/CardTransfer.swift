import SwiftUI
import UniformTypeIdentifiers

/// Stapel-Optionen (extras.js `openDeckConf`): Tageslimits und Leech-Verhalten. `deck` nil = Standardwerte
/// aller Stapel („*“); Unterstapel erben von ihrem Eltern-Stapel. Vererbung und Speichern macht der Kern.
struct DeckOptionsSheet: View {
    let deck: String?
    @Environment(ImpalaStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var newPerDay = 20
    @State private var revPerDay = 200
    @State private var leech = 8
    @State private var action = LeechAction.suspend
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Stepper(value: $newPerDay, in: 0...9999) { row("Neue Karten pro Tag", newPerDay) }
                    Stepper(value: $revPerDay, in: 0...99999, step: 10) { row("Wiederholungen pro Tag", revPerDay) }
                } header: { Text("Tageslimits") }
                Section {
                    Stepper(value: $leech, in: 1...99) { row("Leech-Schwelle (Fehler bis zur Markierung)", leech) }
                    Picker("Leech-Aktion", selection: $action) {
                        Text("Karte aussetzen").tag(LeechAction.suspend)
                        Text("Nur markieren").tag(LeechAction.mark)
                    }
                } footer: {
                    Text("Unterstapel erben die Einstellungen ihres Eltern-Stapels; „*“ gilt für alle.")
                }
                if deck != nil {
                    Section {
                        Button("Auf geerbte Werte zurücksetzen", role: .destructive) {
                            run { try store.core.resetDeckConfig(deck: deck) }
                        }
                    }
                }
            }
            .navigationTitle("Stapel-Optionen — " + (deck ?? "Standardwerte (alle Stapel)"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Abbrechen") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Speichern") {
                        run {
                            try store.core.setDeckConfig(deck: deck, conf: DeckConfig(
                                newPerDay: UInt32(newPerDay), revPerDay: UInt32(revPerDay),
                                leechThreshold: UInt32(max(1, leech)), leechAction: action))
                        }
                    }
                }
            }
            .alert("Das hat nicht geklappt", isPresented: Binding(get: { error != nil }, set: { if !$0 { error = nil } })) {
                Button("OK", role: .cancel) {}
            } message: { Text(error ?? "") }
        }
        .onAppear {
            let c = store.core.deckConfig(deck: deck)
            newPerDay = Int(c.newPerDay)
            revPerDay = Int(c.revPerDay)
            leech = Int(c.leechThreshold)
            action = c.leechAction
        }
    }

    private func row(_ label: String, _ value: Int) -> some View {
        HStack {
            Text(label)
            Spacer()
            Text("\(value)").monospacedDigit().foregroundStyle(Impala.text2)
        }
    }

    private func run(_ block: () throws -> Void) {
        do {
            try block()
            dismiss()
        } catch {
            self.error = CardsModel.reason(error)
        }
    }
}

/// Import bzw. Export der Karteikarten (extras.js `openAnkiIo`): Textdatei (empfohlen) oder CSV/TSV
/// bzw. Anki-Text. Ein Anki-Paket (.apkg) gibt es auf dem iPad noch nicht.
struct CardIoSheet: View {
    let mode: CardIoMode
    @Environment(ImpalaStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var picking = false
    @State private var parsed: (name: String, result: ParsedCards)?
    @State private var duplicates = false
    @State private var share: SharedFile?
    @State private var message: String?

    var body: some View {
        NavigationStack {
            Form {
                switch mode {
                case .exporting: exportSection
                case .importing: importSection
                }
            }
            .navigationTitle(mode == .exporting ? "Karten exportieren" : "Karten importieren")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Schließen") { dismiss() } } }
            .fileImporter(isPresented: $picking, allowedContentTypes: [.plainText, .commaSeparatedText, .tabSeparatedText, .text]) { result in
                guard case .success(let url) = result else { return }
                read(url)
            }
            .sheet(item: $share) { ShareSheet(items: [$0.url]) }
            .alert("Karten", isPresented: Binding(get: { message != nil }, set: { if !$0 { message = nil } })) {
                Button("OK", role: .cancel) {}
            } message: { Text(message ?? "") }
        }
    }

    // MARK: Export

    @ViewBuilder private var exportSection: some View {
        let cards = Self.activeCards(store.core)
        Section {
            Button("Textdatei") { export(CardText.exportTxt(cards), "impala67-karten.txt") }
            Button("CSV") { export(CardText.exportCsv(cards), "impala67-karten.csv") }
        } footer: {
            Text(Deck.cardsText(cards.count) + " ohne Papierkorb und Archiv. Die Textdatei lässt sich bearbeiten und wieder importieren.")
        }
    }

    private func export(_ text: String, _ name: String) {
        guard let url = HeftExport.write(Data(text.utf8), name: name) else {
            message = "Export fehlgeschlagen."
            return
        }
        share = SharedFile(url: url)
    }

    /// Alle Karten ohne Papierkorb und Archiv.
    static func activeCards(_ core: ImpalaCore) -> [PlainCard] {
        var seen = Set<String>()
        return core.decks().flatMap { core.cardsInDeck(deck: $0.name) }
            .filter { !$0.trashed && !$0.archived && seen.insert($0.id).inserted }
            .map { PlainCard(front: $0.front, back: $0.back, deck: $0.deck) }
    }

    // MARK: Import

    @ViewBuilder private var importSection: some View {
        if let parsed {
            let r = parsed.result
            let decks = Set(r.cards.map(\.deck))
            let dup = duplicateCount(r.cards)
            Section {
                LabeledContent("Datei", value: parsed.name)
                LabeledContent("Format", value: r.format)
                LabeledContent("Karten", value: "\(r.cards.count)")
                LabeledContent("Stapel", value: "\(decks.count)")
                LabeledContent("Duplikate", value: "\(dup)")
                if dup > 0 { Toggle("Duplikate ebenfalls importieren", isOn: $duplicates) }
            } header: { Text("Import prüfen") }
            if !r.errors.isEmpty {
                Section {
                    ForEach(r.errors.prefix(4), id: \.self) { Text($0).font(.system(size: TextSize.sm)) }
                } header: { Text("\(r.errors.count) Problem(e)") }
            }
            if !r.cards.isEmpty {
                Section {
                    ForEach(Array(r.cards.prefix(5).enumerated()), id: \.offset) { _, c in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(c.front).font(.system(size: TextSize.sm, weight: .semibold)).lineLimit(2)
                            Text(c.deck).font(.system(size: TextSize.xs)).foregroundStyle(Impala.text2)
                        }
                    }
                } header: { Text("Vorschau") }
            }
            Section {
                Button("Importieren") { importCards(r.cards) }.disabled(r.cards.isEmpty)
                Button("Andere Datei wählen …") { picking = true }
            }
        } else {
            Section {
                Button("Datei wählen …") { picking = true }
                Button("KI-Anweisung kopieren") {
                    UIPasteboard.general.string = CardText.aiPrompt
                    message = "KI-Anweisung kopiert."
                }
            } footer: {
                Text("Textdatei (empfohlen) oder CSV/TSV bzw. Anki-Text.")
            }
            Section {
                Text(CardText.formatExample).font(.system(size: TextSize.xs, design: .monospaced)).textSelection(.enabled)
            } header: { Text("TXT-Format") }
        }
    }

    private func read(_ url: URL) {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        guard let data = try? Data(contentsOf: url),
              let text = String(data: data, encoding: .utf8) ?? String(data: data, encoding: .isoLatin1) else {
            message = "Datei konnte nicht gelesen werden."
            return
        }
        parsed = (url.lastPathComponent, CardText.parse(text))
        duplicates = false
    }

    private func existingKeys() -> Set<String> {
        Set(store.core.decks().flatMap { store.core.cardsInDeck(deck: $0.name) }
            .filter { !$0.trashed }
            .map { CardText.key(PlainCard(front: $0.front, back: $0.back, deck: $0.deck)) })
    }

    private func duplicateCount(_ cards: [PlainCard]) -> Int {
        var seen = existingKeys()
        var n = 0
        for c in cards where !seen.insert(CardText.key(c)).inserted { n += 1 }
        return n
    }

    private func importCards(_ cards: [PlainCard]) {
        var seen = existingKeys()
        var n = 0
        do {
            for c in cards {
                let key = CardText.key(c)
                if !duplicates, seen.contains(key) { continue }
                _ = try store.core.createCard(front: c.front, back: c.back, deck: c.deck, pageId: nil)
                seen.insert(key)
                n += 1
            }
        } catch {
            message = "Import fehlgeschlagen: " + CardsModel.reason(error)
            return
        }
        let decks = Set(cards.map(\.deck)).count
        parsed = nil
        message = "\(n) Karten in \(decks) Stapel importiert."
    }
}

enum CardIoMode: String, Identifiable {
    case importing, exporting
    var id: String { rawValue }
}
