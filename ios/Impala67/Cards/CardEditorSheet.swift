import SwiftUI

/// Karten-Editor (`openCardEditor` in render-anki.js, `CardEditorSheet.kt`): Stapel, Vorder- und
/// Rückseite (Markdown) mit Vorschau, Lückentext. Ohne `cardId` entsteht eine neue Karte.
struct CardEditorSheet: View {
    let target: CardEditorTarget
    @Environment(ImpalaStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    @State private var loaded = false
    @State private var card: CardInfo?
    @State private var decks: [String] = []
    @State private var deck = Deck.standard
    @State private var newDeck = ""
    @State private var front = ""
    @State private var back = ""
    @State private var selection: TextSelection?
    @State private var preview = false
    @State private var error: String?
    @State private var confirmDelete = false

    /// Eintrag „+ Neuer Stapel…“ in der Auswahl.
    private static let newDeckTag = "\u{0}new"

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Stapel", selection: $deck) {
                        ForEach(decks, id: \.self) { Text($0).tag($0) }
                        Text("+ Neuer Stapel…").tag(Self.newDeckTag)
                    }
                    if deck == Self.newDeckTag {
                        TextField("Name des neuen Stapels", text: $newDeck)
                            .transition(.opacity.combined(with: .move(edge: .top)))
                    }
                }
                Section {
                    if preview {
                        MarkdownView(clozePreview(front.isEmpty ? "*Frage…*" : front), core: store.core)
                    } else {
                        TextEditor(text: $front, selection: $selection)
                            .frame(minHeight: 96)
                            .overlay(alignment: .topLeading) { placeholder("Frage…", front) }
                    }
                } header: {
                    Text("Vorderseite")
                } footer: {
                    Text("Lückentext: Text markieren → „Lücke einfügen“. „Als Lückentext speichern“ erzeugt pro Lücke eine Karte.")
                }
                Section("Rückseite") {
                    if preview {
                        MarkdownView(back.isEmpty ? "*Antwort…*" : back, core: store.core)
                    } else {
                        TextEditor(text: $back)
                            .frame(minHeight: 96)
                            .overlay(alignment: .topLeading) { placeholder("Antwort…", back) }
                    }
                }
                Section {
                    Button("［…］ Lücke einfügen") { wrapCloze() }
                        .disabled(preview)
                    Button("Als Lückentext speichern") { saveCloze() }
                }
                if let error {
                    Section { Text(error).foregroundStyle(Impala.danger) }
                }
                if card != nil {
                    Section {
                        Button("Löschen", role: .destructive) { confirmDelete = true }
                    }
                }
            }
            .formStyle(.grouped)
            .animation(.smooth(duration: 0.25), value: deck)
            .animation(.smooth(duration: 0.25), value: preview)
            .animation(.smooth(duration: 0.25), value: error)
            .navigationTitle(card == nil ? "Neue Karte" : "Karte bearbeiten")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Abbrechen") { dismiss() } }
                ToolbarItem(placement: .principal) {
                    Picker("Ansicht", selection: $preview) {
                        Text("Bearbeiten").tag(false)
                        Text("Vorschau").tag(true)
                    }
                    .pickerStyle(.segmented)
                    .fixedSize()
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Speichern") { save() }.keyboardShortcut("s", modifiers: .command)
                }
            }
            .confirmationDialog("Karte in den Papierkorb?", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button("In Papierkorb", role: .destructive) {
                    run { if let id = card?.id { try store.core.trashCard(id: id) } }
                }
            }
        }
        .presentationDetents([.large])
        .sensoryFeedback(.error, trigger: error) { _, now in AppHaptics.isEnabled && now != nil }
        .onAppear(perform: load)
    }

    private func placeholder(_ text: String, _ value: String) -> some View {
        Text(text)
            .foregroundStyle(Impala.text2.opacity(0.5))
            .padding(.top, 8)
            .padding(.leading, 5)
            .allowsHitTesting(false)
            .opacity(value.isEmpty ? 1 : 0)
    }

    private func load() {
        guard !loaded else { return }
        loaded = true
        card = target.cardId.flatMap { store.core.card(id: $0) }
        let current = card?.deck ?? target.deck ?? Deck.standard
        decks = Array(Set(store.core.decks().map(\.name) + [Deck.standard, current])).sorted {
            $0.localizedStandardCompare($1) == .orderedAscending
        }
        deck = current
        front = card?.front ?? ""
        back = card?.back ?? ""
    }

    /// Gewählter Stapel; beim neuen Stapel dessen Name (leer → bisheriger Stapel).
    private var targetDeck: String {
        guard deck == Self.newDeckTag else { return deck }
        let n = newDeck.trimmingCharacters(in: .whitespaces)
        return n.isEmpty ? (card?.deck ?? target.deck ?? Deck.standard) : n
    }

    private func save() {
        guard !front.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            || !back.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            error = "Die Karte braucht eine Vorder- oder Rückseite."
            return
        }
        run {
            if let card {
                try store.core.updateCard(id: card.id, front: front, back: back, deck: targetDeck)
            } else {
                _ = try store.core.createCard(front: front, back: back, deck: targetDeck, pageId: nil)
            }
        }
    }

    private func saveCloze() {
        run {
            let n = try store.core.createClozeCards(text: front, deck: targetDeck, pageId: card?.pageId)
            if n == 0 { throw CoreError.Invalid(reason: "Keine Lücke im Text — erst Text markieren und „Lücke einfügen“.") }
            if let card {
                _ = try? store.core.deleteCard(id: card.id)
            }
        }
    }

    private func clozePreview(_ text: String) -> String {
        guard text.contains("{{c") else { return text }
        return text.replacingOccurrences(of: #"\{\{c\d+::(.*?)(?:::([^}]+))?\}\}"#,
                                         with: "[$2...]",
                                         options: .regularExpression)
                   .replacingOccurrences(of: "[]", with: "[...]")
                   .replacingOccurrences(of: "[...]", with: "**[...]**")
    }

    /// Kern-Aufruf; bei Erfolg schließt das Sheet, sonst steht der Fehler darin.
    private func run(_ block: () throws -> Void) {
        do {
            try block()
            dismiss()
        } catch {
            self.error = CardsModel.reason(error)
        }
    }

    /// Markierten Text in `{{cN::…}}` setzen (N = nächste freie Nummer); ohne Markierung eine leere Lücke
    /// an der Schreibmarke.
    private func wrapCloze() {
        let numbers = Self.clozeNumber.matches(in: front, range: NSRange(front.startIndex..., in: front)).compactMap { m in
            Range(m.range(at: 1), in: front).flatMap { Int(front[$0]) }
        }
        let open = "{{c\((numbers.max() ?? 0) + 1)::"
        var range = front.endIndex..<front.endIndex
        if let sel = selection {
            switch sel.indices {
            case .selection(let r): range = r
            case .multiSelection(let set): if let r = set.ranges.first { range = r }
            @unknown default: break
            }
        }
        let picked = String(front[range])
        let start = front.distance(from: front.startIndex, to: range.lowerBound)
        front.replaceSubrange(range, with: open + picked + "}}")
        let caret = start + open.count + (picked.isEmpty ? 0 : picked.count + 2)
        selection = TextSelection(insertionPoint: front.index(front.startIndex, offsetBy: min(caret, front.count)))
    }

    private static let clozeNumber = try! NSRegularExpression(pattern: #"\{\{c(\d+)::"#)
}
