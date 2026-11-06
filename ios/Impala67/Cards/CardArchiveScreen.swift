import SwiftUI

/// Archiv der Karteikarten (`ankiArchiveHtml` in render-anki.js, `CardArchiveScreen.kt`):
/// archivierte Stapel-Wurzeln und daneben nur eigenständig archivierte Karten,
/// jeweils mit „Wiederherstellen“.
struct CardArchiveScreen: View {
    @Environment(ImpalaStore.self) private var store
    @Environment(ShellModel.self) private var shell

    @State private var archivedDecks: [DeckInfo] = []
    @State private var archivedCards: [CardInfo] = []

    var body: some View {
        let cards = shell.cards

        VStack(spacing: 0) {
            // Kopfzeile: Zurück zu den Stapeln
            HStack {
                Button {
                    withAnimation(.smooth) { cards.view = .decks }
                } label: {
                    HStack(spacing: 2) {
                        Icon("chevron-left", size: 16)
                        Text("Stapel").font(.system(size: TextSize.base))
                    }
                    .foregroundStyle(Impala.text2)
                    .frame(minHeight: 44)
                }
                .pressable()
                Spacer()
                Text("Archiv")
                    .font(.system(size: TextSize.sm, weight: .semibold))
                    .foregroundStyle(Impala.text)
                    .lineLimit(1)
                Spacer()
                // Ausgleich für den linken Zurück-Knopf
                Color.clear.frame(width: 60, height: 44)
            }
            .padding(.horizontal, Space.s3)

            ScrollView {
                VStack(alignment: .leading, spacing: Space.s6) {
                    // Titel & Erklärung (wie in PWA & Android)
                    VStack(alignment: .leading, spacing: Space.s1) {
                        HStack(spacing: Space.s2) {
                            Icon("archive", size: 24).foregroundStyle(Impala.text2)
                            Text("Archiv")
                                .font(.system(size: TextSize.xl, weight: .bold, design: .rounded))
                                .foregroundStyle(Impala.text)
                        }
                        Text("Archivierte Karten bleiben erhalten, erscheinen aber nicht beim Lernen, in der aktiven Kartensuche oder im Wissensgraphen.")
                            .font(.system(size: TextSize.sm))
                            .foregroundStyle(Impala.text2)
                            .padding(.top, 2)
                    }

                    // 1. Abschnitt: Stapel
                    VStack(alignment: .leading, spacing: Space.s2) {
                        Text("Stapel")
                            .font(.system(size: TextSize.xs, weight: .semibold))
                            .foregroundStyle(Impala.text2)

                        if archivedDecks.isEmpty {
                            Text("Keine archivierten Stapel")
                                .font(.system(size: TextSize.sm))
                                .foregroundStyle(Impala.text2)
                                .padding(.vertical, Space.s2)
                        } else {
                            VStack(spacing: 0) {
                                ForEach(Array(archivedDecks.enumerated()), id: \.element.name) { index, deck in
                                    let n = Int(deck.cards)
                                    HStack(spacing: 12) {
                                        Icon("archive", size: 18)
                                            .foregroundStyle(Impala.text2)
                                        VStack(alignment: .leading, spacing: 2) {
                                            Text(deck.name)
                                                .font(.system(size: TextSize.md, weight: .medium))
                                                .foregroundStyle(Impala.text)
                                                .lineLimit(2)
                                            Text("\(n) \(n == 1 ? "Karte" : "Karten") inklusive Unterstapel")
                                                .font(.system(size: TextSize.xs))
                                                .foregroundStyle(Impala.text2)
                                        }
                                        Spacer(minLength: Space.s2)
                                        TintButton(title: "Wiederherstellen") {
                                            withAnimation(.snappy(duration: 0.28)) {
                                                cards.run { try store.core.unarchiveDeck(name: deck.name) }
                                            }
                                        }
                                    }
                                    .padding(.vertical, 10)
                                    if index < archivedDecks.count - 1 {
                                        Divider().overlay(Impala.edgeSoft)
                                    }
                                }
                            }
                            .animation(.snappy(duration: 0.28), value: archivedDecks.map(\.name))
                        }
                    }

                    // 2. Abschnitt: Einzelne Karten
                    VStack(alignment: .leading, spacing: Space.s2) {
                        Text("Einzelne Karten")
                            .font(.system(size: TextSize.xs, weight: .semibold))
                            .foregroundStyle(Impala.text2)

                        if archivedCards.isEmpty {
                            Text("Keine einzeln archivierten Karten")
                                .font(.system(size: TextSize.sm))
                                .foregroundStyle(Impala.text2)
                                .padding(.vertical, Space.s2)
                        } else {
                            VStack(spacing: 0) {
                                ForEach(Array(archivedCards.enumerated()), id: \.element.id) { index, card in
                                    let frontText = plain(card.front, "Ohne Vorderseite")
                                    let backText = plain(card.back, "")
                                    let deckName = card.deck.isEmpty ? Deck.standard : card.deck
                                    HStack(spacing: 12) {
                                        Icon("cards", size: 18)
                                            .foregroundStyle(Impala.text2)
                                        VStack(alignment: .leading, spacing: 2) {
                                            Text(frontText)
                                                .font(.system(size: TextSize.md, weight: .medium))
                                                .foregroundStyle(Impala.text)
                                                .lineLimit(2)
                                            HStack(spacing: 4) {
                                                Text(deckName)
                                                    .font(.system(size: TextSize.xs))
                                                    .foregroundStyle(Impala.text2)
                                                if !backText.isEmpty {
                                                    Text("·")
                                                        .font(.system(size: TextSize.xs))
                                                        .foregroundStyle(Impala.text2)
                                                    Text(backText)
                                                        .font(.system(size: TextSize.xs))
                                                        .foregroundStyle(Impala.text2)
                                                        .lineLimit(1)
                                                }
                                                if card.leech {
                                                    LeechBadge()
                                                }
                                            }
                                        }
                                        Spacer(minLength: Space.s2)
                                        TintButton(title: "Wiederherstellen") {
                                            withAnimation(.snappy(duration: 0.28)) {
                                                cards.run { try store.core.unarchiveCard(id: card.id) }
                                            }
                                        }
                                    }
                                    .padding(.vertical, 10)
                                    if index < archivedCards.count - 1 {
                                        Divider().overlay(Impala.edgeSoft)
                                    }
                                }
                            }
                            .animation(.snappy(duration: 0.28), value: archivedCards.map(\.id))
                        }
                    }
                }
                .padding(Space.s6)
                .frame(maxWidth: 800, alignment: .leading)
                .frame(maxWidth: .infinity)
            }
        }
        .background(Impala.panel)
        .task(id: store.cardsRevision) {
            let core = store.core
            let loaded = await Task.detached(priority: .userInitiated) {
                (core.archivedDecks(), core.orphanArchivedCards())
            }.value
            if !Task.isCancelled {
                archivedDecks = loaded.0
                archivedCards = loaded.1
            }
        }
    }

    private func plain(_ md: String, _ empty: String) -> String {
        let t = markdownPlainText(markdown: md).trimmingCharacters(in: .whitespacesAndNewlines)
        return t.isEmpty ? empty : t
    }
}
