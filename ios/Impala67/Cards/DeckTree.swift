import SwiftUI

/// Stapelbaum der Seitenleiste (Pille „Karten“, `deckTreeHtml` der PWA, `DeskDecks.kt`): Unterstapel
/// eingerückt und einklappbar, Zähler für fällige (Akzent) und neue Karten (Grün). Antippen lernt den
/// Stapel, Halten öffnet das Stapelmenü (`deckMenuHtml`).
struct DeckTree: View {
    @Environment(ImpalaStore.self) private var store
    @Environment(ShellModel.self) private var shell
    @Namespace private var highlight

    var body: some View {
        let _ = store.cardsRevision
        let cards = shell.cards
        let entries = DeckEntry.flatten(store.core.deckOverview(utcOffsetMinutes: Deck.utcOffset, mix: false), collapsed: cards.collapsed)
        let activeDeck = shell.active == ShellModel.cardsTab ? cards.view.deck : nil
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 2) {
                    Text("Stapel")
                        .font(.system(size: TextSize.xs, weight: .semibold))
                        .foregroundStyle(Impala.text2)
                    Spacer(minLength: 0)
                    Button { cards.dialog = .new } label: {
                        Icon("plus", size: 14)
                            .foregroundStyle(Impala.text2)
                            .frame(width: 26, height: 26)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Neuer Stapel")

                    Menu {
                        Button { cards.dialog = .new } label: {
                            Label { Text("Neuer Stapel") } icon: { Icon("plus") }
                        }
                        Divider()
                        Button { shell.openCards(.archive) } label: {
                            Label { Text("Archivierte Karten & Stapel") } icon: { Icon("archive") }
                        }
                    } label: {
                        Icon("dots", size: 14)
                            .foregroundStyle(Impala.text2)
                            .frame(width: 26, height: 26)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Weitere Optionen")
                }
                .padding(.leading, Space.s1)
                .padding(.top, Space.s2 + Space.s1)
                .padding(.bottom, Space.s1)
                AllDecksRow(active: shell.active == ShellModel.cardsTab && cards.view == .decks, ns: highlight) {
                    shell.openCards(.decks)
                }
                if entries.isEmpty {
                    Text("Noch keine Stapel")
                        .font(.system(size: TextSize.sm))
                        .foregroundStyle(Impala.text2)
                        .padding(.leading, Space.s2)
                        .padding(.vertical, Space.s1)
                }
                ForEach(entries) { e in
                    DeckTreeRow(
                        entry: e,
                        active: activeDeck == e.name,
                        ns: highlight,
                        onOpen: { shell.openCards(.review(deck: e.name, mix: false)) },
                        onToggle: { withAnimation(.snappy(duration: 0.28)) { cards.toggle(e.name) } }
                    ) { DeckMenuItems(name: e.name) }
                }
            }
            .animation(.snappy(duration: 0.28), value: store.cardsRevision)
            .animation(.smooth(duration: 0.3), value: activeDeck)
        }
        .scrollIndicators(.hidden)
    }
}

/// „Übersicht“: alle Stapel mit Kennzahlen im Karten-Tab.
private struct AllDecksRow: View {
    let active: Bool
    let ns: Namespace.ID
    let action: () -> Void
    @Environment(ShellModel.self) private var shell

    var body: some View {
        HStack(spacing: Space.s2) {
            Icon("cards", size: 15)
            Text("Übersicht").font(.system(size: TextSize.sm, weight: active ? .medium : .regular))
            Spacer(minLength: 0)
        }
        .foregroundStyle(active ? Impala.text : Impala.text2)
        .padding(.leading, 6)
        .frame(minHeight: 34)
        .background {
            if active {
                RoundedRectangle(cornerRadius: Radius.sm, style: .continuous)
                    .fill(Impala.activeTint)
                    .matchedGeometryEffect(id: "active", in: ns)
            }
        }
        .contentShape(RoundedRectangle(cornerRadius: Radius.sm))
        .onTapGesture(perform: action)
        .contextMenu {
            MenuItem("Archivierte Karten & Stapel", icon: "archive") {
                shell.openCards(.archive)
            }
        }
        .hoverEffect(.highlight)
    }
}

/// Stapelzeile (`.deck-tree-row`) wie die Seitenzeilen: 16 pt Einrückung je Ebene, aktiv getönt.
private struct DeckTreeRow<MenuContent: View>: View {
    let entry: DeckEntry
    let active: Bool
    let ns: Namespace.ID
    let onOpen: () -> Void
    let onToggle: () -> Void
    @ViewBuilder let menu: () -> MenuContent

    @AppStorage(AppDensity.key) private var density = AppDensity.compact.rawValue

    var body: some View {
        HStack(spacing: Space.s1) {
            Group {
                if entry.hasKids { Chevron(open: !entry.collapsed, action: onToggle) } else { Color.clear }
            }
            .frame(width: 22, height: 22)
            Text(entry.label)
                .font(.system(size: TextSize.sm, weight: active ? .medium : .regular))
                .foregroundStyle(active ? Impala.text : Impala.text2)
                .lineLimit(1)
            Spacer(minLength: 0)
            if entry.due > 0 { CountBadge(value: entry.due, color: Impala.accent) }
            if entry.deck.new > 0 { CountBadge(value: entry.deck.new, color: Impala.success) }
        }
        .padding(.leading, CGFloat(entry.depth) * 16)
        .padding(.trailing, 4)
        .frame(minHeight: density == AppDensity.compact.rawValue ? 32 : 40)
        .background {
            if active {
                RoundedRectangle(cornerRadius: Radius.sm, style: .continuous)
                    .fill(Impala.activeTint)
                    .matchedGeometryEffect(id: "active", in: ns)
            }
        }
        .contentShape(RoundedRectangle(cornerRadius: Radius.sm))
        .onTapGesture(perform: onOpen)
        .contextMenu { menu() }
        .transition(.opacity.combined(with: .move(edge: .top)))
        .hoverEffect(.highlight)
    }
}

/// Zähler-Pille (`.deck-badge`): leichte Tönung, Zahl zählt weich (`numericText`).
struct CountBadge: View {
    let value: UInt64
    let color: Color

    var body: some View {
        Text("\(value)")
            .font(.system(size: 11, weight: .semibold))
            .monospacedDigit()
            .contentTransition(.numericText(value: Double(value)))
            .foregroundStyle(color)
            .padding(.horizontal, 5)
            .padding(.vertical, 1)
            .frame(minWidth: 18)
            .background(color.opacity(0.14), in: Capsule())
            .animation(.snappy, value: value)
    }
}

/// Stapelmenü (`deckMenuHtml` in render-anki.js); „Standard“ lässt sich weder umbenennen noch löschen.
struct DeckMenuItems: View {
    let name: String
    @Environment(ImpalaStore.self) private var store
    @Environment(ShellModel.self) private var shell

    var body: some View {
        let cards = shell.cards
        let standard = name == Deck.standard
        MenuItem("Lernen", icon: "cards") { shell.openCards(.review(deck: name, mix: false)) }
        MenuItem("Feynman-Modus", icon: "explain") { shell.openCards(.review(deck: name, mix: false), feynman: true) }
        MenuItem("Neue Karte", icon: "plus") { cards.editor = CardEditorTarget(cardId: nil, deck: name) }
        MenuItem("Karten ansehen", icon: "search") { shell.openCards(.browse(deck: name)) }
        Divider()
        MenuItem("Unterstapel anlegen", icon: "plus") { cards.dialog = .sub(parent: name) }
        if !standard { MenuItem("Umbenennen", icon: "pen") { cards.dialog = .rename(name) } }
        MenuItem("Optionen", icon: "gear") { cards.options = DeckOptionsTarget(deck: name) }
        MenuItem("Duplizieren", icon: "copy") { cards.run { _ = try store.core.duplicateDeck(name: name) } }
        MenuItem("Archivieren", icon: "archive") {
            cards.run { try store.core.archiveDeck(name: name) }
            leave(name)
        }
        MenuItem("Archivierte Karten & Stapel", icon: "archive") {
            shell.openCards(.archive)
        }
        if !standard {
            Divider()
            MenuItem("In Papierkorb", icon: "trash", role: .destructive) { cards.dialog = .trash(name) }
        }
    }

    /// Zeigt der Karten-Tab gerade diesen Stapel (oder einen Unterstapel), zurück zur Übersicht.
    private func leave(_ name: String) {
        if let d = shell.cards.view.deck, d == name || d.hasPrefix(name + Deck.sep) { shell.cards.view = .decks }
    }
}

/// Dialoge rund um Stapel (Name eingeben, Papierkorb) und Fehler des Kerns; einmal an der Shell.
struct DeckDialogsModifier: ViewModifier {
    let cards: CardsModel
    let core: ImpalaCore
    @State private var text = ""

    func body(content: Content) -> some View {
        content
            .alert(nameTitle, isPresented: binding(isName)) {
                TextField("Name", text: $text)
                Button("Abbrechen", role: .cancel) {}
                Button(confirmTitle) { commitName() }
                    .disabled(text.trimmingCharacters(in: .whitespaces).isEmpty)
            } message: {
                if cards.dialog == .new { Text("Unterstapel per „Eltern::Kind“") }
            }
            .alert("Stapel in den Papierkorb?", isPresented: binding(isTrash)) {
                Button("Abbrechen", role: .cancel) {}
                Button("In Papierkorb", role: .destructive) { commitTrash() }
            } message: {
                if case .trash(let n) = cards.dialog { Text("„\(n)“ samt Unterstapeln und allen Karten wandert in den Papierkorb.") }
            }
            .alert("Das hat nicht geklappt", isPresented: Binding(get: { cards.error != nil }, set: { if !$0 { cards.error = nil } })) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(cards.error ?? "")
            }
            .sheet(item: Binding(get: { cards.options }, set: { cards.options = $0 })) { t in
                DeckOptionsSheet(deck: t.deck).presentationSizing(.form)
            }
            .sheet(item: Binding(get: { cards.io }, set: { cards.io = $0 })) { mode in
                CardIoSheet(mode: mode).presentationSizing(.form)
            }
            .onChange(of: cards.dialog) {
                if case .rename(let n) = cards.dialog { text = Deck.label(n) } else { text = "" }
            }
    }

    private var isName: Bool {
        switch cards.dialog {
        case .new, .sub, .rename: true
        default: false
        }
    }

    private var isTrash: Bool {
        if case .trash = cards.dialog { true } else { false }
    }

    private func binding(_ on: Bool) -> Binding<Bool> {
        Binding(get: { on }, set: { if !$0 { cards.dialog = nil } })
    }

    private var nameTitle: String {
        switch cards.dialog {
        case .sub(let p): "Unterstapel von „\(Deck.label(p))“"
        case .rename: "Stapel umbenennen"
        default: "Neuer Stapel"
        }
    }

    private var confirmTitle: String {
        if case .rename = cards.dialog { "Umbenennen" } else { "Anlegen" }
    }

    private func commitName() {
        let name = text.trimmingCharacters(in: .whitespaces)
        guard !name.isEmpty, let dialog = cards.dialog else { return }
        cards.run {
            switch dialog {
            case .new: _ = try core.createDeck(name: name)
            case .sub(let p): _ = try core.createDeck(name: p + Deck.sep + name)
            case .rename(let from):
                let parent = Deck.parent(from)
                let to = try core.renameDeck(from: from, to: parent.isEmpty ? name : parent + Deck.sep + name)
                // Offene Ansicht folgt dem neuen Namen.
                switch cards.view {
                case .review(let d?, let mix) where d == from: cards.view = .review(deck: to, mix: mix)
                case .browse(let d) where d == from: cards.view = .browse(deck: to)
                default: break
                }
            case .trash: break
            }
        }
        cards.dialog = nil
    }

    private func commitTrash() {
        guard case .trash(let name) = cards.dialog else { return }
        cards.run { try core.trashDeck(name: name) }
        if let d = cards.view.deck, d == name || d.hasPrefix(name + Deck.sep) { cards.view = .decks }
        cards.dialog = nil
    }
}
