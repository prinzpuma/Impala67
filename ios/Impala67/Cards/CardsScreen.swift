import SwiftUI

/// Tab `anki:main`: Stapelübersicht, Lernen oder die Karten eines Stapels (`renderAnki` der PWA).
struct CardsScreen: View {
    @Environment(ShellModel.self) private var shell

    var body: some View {
        let view = shell.cards.view
        ZStack {
            switch view {
            case .decks:
                DeckOverviewScreen().transition(.opacity.combined(with: .scale(scale: 0.99)))
            case .review(let deck, let mix):
                ReviewScreen(deck: deck, mix: mix)
                    .id("review:\(deck ?? "*"):\(mix)")
                    .transition(.opacity.combined(with: .move(edge: .trailing)))
            case .browse(let deck):
                CardBrowser(deck: deck)
                    .id("browse:\(deck)")
                    .transition(.opacity.combined(with: .move(edge: .trailing)))
            case .stats:
                StatsScreen().transition(.opacity.combined(with: .move(edge: .trailing)))
            case .archive:
                CardArchiveScreen().transition(.opacity.combined(with: .move(edge: .trailing)))
            }
        }
        .animation(.smooth(duration: 0.32), value: view)
        .background(Impala.panel)
    }
}

/// Stapelübersicht (`ankiDecksHtml` v3): ein Satz vorn – die Kartenzahl ist selbst der Startknopf –,
/// darunter „Gemischt“ und zwei Kennzahlen, dann die Stapel-Liste.
private struct DeckOverviewScreen: View {
    @Environment(ImpalaStore.self) private var store
    @Environment(ShellModel.self) private var shell

    var body: some View {
        let _ = store.cardsRevision
        let cards = shell.cards
        let q = store.core.studyQueue(deck: nil, utcOffsetMinutes: Deck.utcOffset, mix: false)
        let entries = DeckEntry.flatten(store.core.deckOverview(utcOffsetMinutes: Deck.utcOffset, mix: false), collapsed: cards.collapsed)
        let total = Int(q.new + q.learn + q.review)
        // Grobe Schätzung wie die PWA: ~2,5 Karten pro Minute, mindestens 1 Minute.
        let minutes = max(1, Int((Double(total) / 2.5).rounded()))
        let minText = minutes == 1 ? "1 Minute" : "\(minutes) Minuten"
        ScrollView {
            VStack(alignment: .leading, spacing: Space.s6) {
                HStack {
                    HStack(spacing: Space.s2) {
                        Icon("cards", size: 24).foregroundStyle(Impala.text2)
                        Text("Karteikarten").font(.system(size: TextSize.xl, weight: .bold, design: .rounded)).foregroundStyle(Impala.text)
                    }
                    Spacer()
                    // Wie die Kopfzeile der PWA: Statistik, Optionen (Tageslimits & Leech), ＋ Neu.
                    HeaderButton(icon: "chart", label: "Statistik") { withAnimation(.smooth) { cards.view = .stats } }
                    HeaderButton(icon: "gear", label: "Optionen") { cards.options = DeckOptionsTarget(deck: nil) }
                    Menu {
                        Button { cards.editor = CardEditorTarget(cardId: nil, deck: nil) } label: {
                            Label { Text("Neue Karte") } icon: { Icon("cards") }
                        }
                        Button { cards.dialog = .new } label: {
                            Label { Text("Neuer Stapel") } icon: { Icon("plus") }
                        }
                        Divider()
                        Button { cards.io = .importing } label: {
                            Label { Text("Import") } icon: { Icon("download") }
                        }
                        Button { cards.io = .exporting } label: {
                            Label { Text("Export") } icon: { Icon("upload") }
                        }
                        Divider()
                        Button { withAnimation(.smooth) { cards.view = .archive } } label: {
                            Label { Text("Archivierte Karten & Stapel") } icon: { Icon("archive") }
                        }
                    } label: {
                        Text("＋ Neu")
                            .font(.system(size: TextSize.sm, weight: .semibold))
                            .foregroundStyle(Impala.accent)
                            .padding(.horizontal, 14)
                            .frame(minHeight: 36)
                            .background(Impala.accent.opacity(0.09), in: Capsule())
                            .overlay(Capsule().stroke(Impala.accent.opacity(0.36), lineWidth: 1))
                    }
                }
                .riseIn(0)
                Group {
                    if entries.isEmpty {
                        Text("Lege deinen ersten Stapel an — über „＋ Neu“.")
                    } else if total > 0 {
                        HStack(spacing: 0) {
                            Button { shell.openCards(.review(deck: nil, mix: false)) } label: {
                                Text(Deck.cardsText(total)).foregroundStyle(Impala.accent).underline(color: Impala.accent.opacity(0.4))
                            }
                            .buttonStyle(.plain)
                            Text(" warten auf dich, etwa \(minText).")
                        }
                    } else {
                        Text("Für heute ist alles gelernt.")
                    }
                }
                .font(.system(size: TextSize.lg))
                .foregroundStyle(Impala.text)
                .riseIn(1)
                if total > 0 {
                    HStack(spacing: Space.s2) {
                        ChipButton(icon: "shuffle", label: "Gemischt") { shell.openCards(.review(deck: nil, mix: true)) }
                        ChipButton(icon: "explain", label: "Feynman-Modus") { shell.openCards(.review(deck: nil, mix: false), feynman: true) }
                    }
                    .riseIn(2)
                }
                HStack(alignment: .top, spacing: Space.s3) {
                    if total > 0 {
                        StatCard(label: "Heute fällig", value: Deck.cardsText(total), note: "etwa \(minText) · Lernen starten", tone: .due) {
                            shell.openCards(.review(deck: nil, mix: false))
                        }
                    } else {
                        StatCard(label: "Heute fällig", value: entries.isEmpty ? "Keine Karten" : "Alles gelernt",
                                 note: entries.isEmpty ? "Stapel anlegen" : "Morgen geht’s weiter",
                                 tone: entries.isEmpty ? .plain : .done) {
                            if entries.isEmpty { cards.dialog = .new }
                        }
                    }
                    StatCard(label: "Neue Karten", value: "\(q.new)", note: "im heutigen Tageslimit", tone: .plain, action: nil)
                }
                .riseIn(3)
                VStack(alignment: .leading, spacing: Space.s1) {
                    Text("Deine Stapel")
                        .font(.system(size: TextSize.xs, weight: .semibold))
                        .foregroundStyle(Impala.text2)
                        .padding(.bottom, Space.s1)
                    if entries.isEmpty {
                        Text("Noch keine Stapel — über „＋ Neu“ einen anlegen")
                            .font(.system(size: TextSize.sm))
                            .foregroundStyle(Impala.text2)
                    }
                    ForEach(entries) { e in
                        DeckRow(entry: e) {
                            shell.openCards(.review(deck: e.name, mix: false))
                        } onToggle: {
                            withAnimation(.snappy(duration: 0.28)) { cards.toggle(e.name) }
                        }
                        if e.id != entries.last?.id { Divider().overlay(Impala.edgeSoft) }
                    }
                }
                .riseIn(4)
                .animation(.snappy(duration: 0.28), value: store.cardsRevision)
            }
            .padding(Space.s6)
            .frame(maxWidth: 860, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
    }
}

/// Runder Knopf der Kopfzeile (Statistik, Optionen).
private struct HeaderButton: View {
    let icon: String
    let label: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Icon(icon, size: 16)
                Text(label).font(.system(size: TextSize.sm, weight: .medium))
            }
            .foregroundStyle(Impala.text2)
            .padding(.horizontal, 12)
            .frame(minHeight: 36)
            .contentShape(Capsule())
        }
        .pressable()
        .accessibilityLabel(label)
    }
}

/// Kapsel unter dem Satz („Gemischt“, „Feynman-Modus“).
private struct ChipButton: View {
    let icon: String
    let label: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Icon(icon, size: 15)
                Text(label).font(.system(size: TextSize.sm, weight: .medium))
            }
            .foregroundStyle(Impala.text)
            .padding(.horizontal, 14)
            .frame(minHeight: 36)
            .background(Impala.surface, in: Capsule())
        }
        .pressable()
    }
}

/// Stapel-Zeile (`.deck-row`): Auf-/Zuklappen, Name mit Kartenzahl, Zähler, „Lernen“, ⋯-Menü.
private struct DeckRow: View {
    let entry: DeckEntry
    let onStudy: () -> Void
    let onToggle: () -> Void

    var body: some View {
        let d = entry.deck
        HStack(spacing: Space.s2) {
            Group {
                if entry.hasKids { Chevron(open: !entry.collapsed, action: onToggle) } else { Color.clear }
            }
            .frame(width: 22, height: 22)
            VStack(alignment: .leading, spacing: 2) {
                Text(entry.label).font(.system(size: TextSize.md, weight: .semibold)).foregroundStyle(Impala.text).lineLimit(1)
                Text(Deck.cardsText(Int(d.total)) + (d.suspended > 0 ? " · \(d.suspended) ausgesetzt" : ""))
                    .font(.system(size: TextSize.xs))
                    .foregroundStyle(Impala.text2)
                    .lineLimit(1)
            }
            Spacer(minLength: Space.s2)
            VStack(alignment: .trailing, spacing: 1) {
                if entry.open {
                    if d.review > 0 {
                        Text("\(d.review) fällig").font(.system(size: TextSize.base, weight: .bold)).foregroundStyle(Impala.accent)
                    } else {
                        Text("\(d.learn + d.new) offen").font(.system(size: TextSize.base, weight: .semibold)).foregroundStyle(Impala.text)
                    }
                    Text("\(d.learn) lernen · \(d.new) neu").font(.system(size: 11)).foregroundStyle(Impala.text2)
                } else {
                    HStack(spacing: Space.s1) {
                        Icon("check", size: 12)
                        Text("fertig für heute").font(.system(size: 11))
                    }
                    .foregroundStyle(Impala.success)
                }
            }
            .monospacedDigit()
            .contentTransition(.numericText())
            if entry.open { TintButton(title: "Lernen", action: onStudy) }
            Menu { DeckMenuItems(name: entry.name) } label: {
                Icon("dots", size: 18).foregroundStyle(Impala.text2).frame(width: 40, height: 40).contentShape(Rectangle())
            }
            .accessibilityLabel("Weitere Optionen")
        }
        .padding(.leading, CGFloat(entry.depth) * 22)
        .frame(minHeight: 60)
        .contentShape(Rectangle())
        .onTapGesture { if entry.open { onStudy() } }
        .contextMenu { DeckMenuItems(name: entry.name) }
        .transition(.opacity.combined(with: .move(edge: .top)))
    }
}

/// Kennzahl-Kachel (`.hv-stat`/`.anki-stats`): klein die Bezeichnung, groß der Wert, darunter ein Satz.
/// `.due` mit Akzent-Tönung und -Rand, `.done` leicht grün.
struct StatCard: View {
    enum Tone { case plain, due, done }

    let label: String
    let value: String
    let note: String
    let tone: Tone
    let action: (() -> Void)?

    var body: some View {
        let content = VStack(alignment: .leading, spacing: Space.s1) {
            Text(label).font(.system(size: TextSize.xs)).foregroundStyle(Impala.text2)
            HStack(spacing: 6) {
                if tone == .done { Icon("check", size: 22) }
                Text(value)
                    .font(.system(size: 30, weight: .semibold, design: .rounded))
                    .kerning(-0.6)
                    .monospacedDigit()
                    .contentTransition(.numericText())
            }
            .foregroundStyle(tone == .due ? Impala.accent : tone == .done ? Impala.success : Impala.text)
            Text(note).font(.system(size: TextSize.sm)).foregroundStyle(Impala.text2)
        }
        .padding(.horizontal, 22)
        .padding(.vertical, 20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(background, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).stroke(tone == .due ? Impala.accentBorder : Impala.edgeSoft, lineWidth: 1))
        if let action {
            Button(action: action) { content }.pressable()
        } else {
            content
        }
    }

    private var background: Color {
        switch tone {
        case .plain: Impala.panel
        case .due: Impala.activeTint
        case .done: Impala.success.opacity(0.12)
        }
    }
}

/// Karten eines Stapels samt Unterstapeln (`CardBrowserScreen.kt`, „Karten ansehen“): Antippen
/// bearbeitet, Wischen setzt aus bzw. löscht (Papierkorb).
private struct CardBrowser: View {
    let deck: String
    @Environment(ImpalaStore.self) private var store
    @Environment(ShellModel.self) private var shell
    @State private var query = ""

    var body: some View {
        let _ = store.cardsRevision
        let cards = shell.cards
        let all = store.core.cardsInDeckTree(deck: deck, includeTrashed: false).filter { !$0.archived }
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        let shown = q.isEmpty ? all : all.filter { ($0.front + "\n" + $0.back).lowercased().contains(q) }
        VStack(spacing: 0) {
            HStack {
                Button { withAnimation(.smooth) { cards.view = .decks } } label: {
                    HStack(spacing: 2) {
                        Icon("chevron-left", size: 16)
                        Text("Stapel").font(.system(size: TextSize.base))
                    }
                    .foregroundStyle(Impala.text2)
                    .frame(minHeight: 44)
                }
                .pressable()
                Spacer()
                Text("\(Deck.label(deck)) · \(Deck.cardsText(all.count))")
                    .font(.system(size: TextSize.sm, weight: .semibold))
                    .foregroundStyle(Impala.text)
                    .lineLimit(1)
                Spacer()
                Button { cards.editor = CardEditorTarget(cardId: nil, deck: deck) } label: {
                    Icon("plus", size: 17).foregroundStyle(Impala.text2).frame(width: 44, height: 44)
                }
                .pressable()
                .accessibilityLabel("Neue Karte")
            }
            .padding(.horizontal, Space.s3)
            TextField("Karten durchsuchen", text: $query)
                .textFieldStyle(.plain)
                .padding(.horizontal, Space.s3)
                .frame(minHeight: 38)
                .background(Impala.surface, in: RoundedRectangle(cornerRadius: Radius.sm, style: .continuous))
                .padding(.horizontal, Space.s4)
                .padding(.bottom, Space.s2)
            List {
                ForEach(shown, id: \.id) { c in
                    Button { cards.editor = CardEditorTarget(cardId: c.id, deck: c.deck) } label: { CardListRow(card: c, showDeck: c.deck != deck) }
                        .buttonStyle(.plain)
                        .listRowBackground(Color.clear)
                        .swipeActions(edge: .trailing) {
                            Button(role: .destructive) { cards.run { try store.core.trashCard(id: c.id) } } label: {
                                Label { Text("Löschen") } icon: { Icon("trash") }
                            }
                            Button { cards.run { try store.core.setCardSuspended(id: c.id, suspended: !c.suspended) } } label: {
                                Label { Text(c.suspended ? "Fortsetzen" : "Aussetzen") } icon: { Icon("pause") }
                            }
                            .tint(Impala.warn)
                        }
                        .contextMenu {
                            MenuItem("Bearbeiten", icon: "pen") { cards.editor = CardEditorTarget(cardId: c.id, deck: c.deck) }
                            MenuItem(c.suspended ? "Fortsetzen" : "Aussetzen", icon: "pause") {
                                cards.run { try store.core.setCardSuspended(id: c.id, suspended: !c.suspended) }
                            }
                            MenuItem("Löschen", icon: "trash", role: .destructive) { cards.run { try store.core.trashCard(id: c.id) } }
                        }
                }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .animation(.snappy(duration: 0.28), value: shown.map(\.id))
            .overlay {
                if shown.isEmpty {
                    ContentUnavailableView {
                        Label { Text(q.isEmpty ? "Noch keine Karten" : "Keine Treffer") } icon: { Icon("cards", size: 40).foregroundStyle(Impala.text2) }
                    } description: {
                        Text(q.isEmpty ? "Über „+“ eine Karte anlegen." : "Andere Suche versuchen.")
                    }
                }
            }
        }
        .background(Impala.panel)
    }
}

private struct CardListRow: View {
    let card: CardInfo
    let showDeck: Bool

    var body: some View {
        HStack(alignment: .top, spacing: Space.s3) {
            VStack(alignment: .leading, spacing: 3) {
                Text(plain(card.front, "(leer)"))
                    .font(.system(size: TextSize.md, weight: .medium))
                    .foregroundStyle(Impala.text)
                    .lineLimit(2)
                Text(plain(card.back, "—"))
                    .font(.system(size: TextSize.sm))
                    .foregroundStyle(Impala.text2)
                    .lineLimit(1)
            }
            Spacer(minLength: Space.s2)
            VStack(alignment: .trailing, spacing: 3) {
                if showDeck { Text(Deck.label(card.deck)).font(.system(size: 11)).foregroundStyle(Impala.text2) }
                HStack(spacing: 4) {
                    if card.leech {
                        LeechBadge()
                    }
                    if card.suspended {
                        Text("ausgesetzt").font(.system(size: 11, weight: .semibold)).foregroundStyle(Impala.warn)
                    } else if card.stage == .new {
                        Text("neu").font(.system(size: 11, weight: .semibold)).foregroundStyle(Impala.success)
                    }
                }
            }
        }
        .padding(.vertical, Space.s1)
        .opacity(card.suspended ? 0.6 : 1)
        .contentShape(Rectangle())
    }

    private func plain(_ md: String, _ empty: String) -> String {
        let t = markdownPlainText(markdown: md).trimmingCharacters(in: .whitespacesAndNewlines)
        return t.isEmpty ? empty : t
    }
}
