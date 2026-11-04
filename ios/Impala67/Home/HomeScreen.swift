import SwiftUI

/// Startseite, erster Teil der PWA-Startseite (`homeViewHtml` in home-view.js): Datum, „+ Neue Seite“,
/// Begrüßung mit dem Satz zu den Karten, „Weitermachen“ mit der zuletzt bearbeiteten Seite, angeheftete
/// Seiten und „Heute fällig“. Lernzeit und Tagesartikel folgen (siehe `android/app/…/home/` als Vorlage).
struct HomeScreen: View {
    @Environment(ImpalaStore.self) private var store
    @Environment(ShellModel.self) private var shell
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.shellNamespace) private var zoom

    var body: some View {
        let _ = (store.pagesRevision, store.cardsRevision, store.revision)
        let conflicts = Int(store.core.conflictCount())
        let recent = store.core.recentPages(limit: 40)
        let last = recent.first
        let pins = recent.filter(\.favorite).prefix(6)
        let study = store.core.studyQueue(deck: nil, utcOffsetMinutes: Deck.utcOffset, mix: false)
        let open = Int(study.new + study.learn + study.review)
        let hasCards = store.core.cardTotals().cards > 0
        // Ohne eigene Messwerte 20 s je Karte (`secPerCard` in home-view.js), mindestens 1 Minute.
        let estMin = max(1, Int((Double(open) * 20 / 60).rounded()))
        ScrollView {
            VStack(alignment: .leading, spacing: Space.s6) {
                HStack {
                    Text(Date.now.formatted(.dateTime.weekday(.wide).day().month(.wide).locale(Locale(identifier: "de_DE"))))
                        .font(.system(size: TextSize.sm, weight: .medium))
                        .foregroundStyle(Impala.text2)
                    Spacer()
                    Menu {
                        MenuItem("Notiz", icon: "note") { create(.note) }
                        MenuItem("Heft", icon: "notebook") { create(.heft) }
                        TemplateMenuSection(create: create)
                    } label: {
                        Text("+ Neue Seite")
                            .font(.system(size: TextSize.sm, weight: .semibold))
                            .foregroundStyle(Impala.accent)
                            .padding(.horizontal, 14)
                            .frame(minHeight: 36)
                            .background(Impala.accent.opacity(0.09), in: Capsule())
                            .overlay(Capsule().stroke(Impala.accent.opacity(0.36), lineWidth: 1))
                    }
                }
                .riseIn(0)
                if conflicts > 0 {
                    ConflictAlert(count: conflicts) { shell.sheet = .conflicts }
                        .zoomSource(ShellSheet.conflicts, zoom)
                        .riseIn(1)
                        .transition(.opacity.combined(with: .move(edge: .top)))
                }
                VStack(alignment: .leading, spacing: Space.s2) {
                    Text("\(Self.greeting()).")
                        .font(.system(size: TextSize.xl, weight: .bold, design: .rounded))
                        .foregroundStyle(Impala.text)
                    lead(fresh: last == nil && !hasCards, open: open, hasCards: hasCards, estMin: estMin)
                        .font(.system(size: TextSize.md))
                        .foregroundStyle(Impala.text2)
                }
                .riseIn(1)
                let main = VStack(alignment: .leading, spacing: Space.s6) {
                    if let last {
                        Button { shell.open(last.id) } label: { ContinueCard(page: last) }
                            .pressable()
                            .riseIn(2)
                    }
                    if !pins.isEmpty {
                        FlowRow(pins: Array(pins)) { shell.open($0) }
                            .riseIn(3)
                    }
                }
                let due = dueCard(open: open, hasCards: hasCards, estMin: estMin).riseIn(3)
                // `.hv-grid`: breit zwei Spalten (Kennzahlen rechts), schmal untereinander.
                if sizeClass == .regular {
                    HStack(alignment: .top, spacing: Space.s4) {
                        main.frame(maxWidth: .infinity, alignment: .leading)
                        due.frame(width: 280)
                    }
                } else {
                    main
                    due
                }
            }
            .padding(Space.s6)
            .animation(.smooth, value: conflicts)
            .frame(maxWidth: 860, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .background(Impala.panel)
    }

    /// Satz nach der Begrüßung (`sum` in home-view.js); die Kartenzahl startet das Lernen.
    @ViewBuilder
    private func lead(fresh: Bool, open: Int, hasCards: Bool, estMin: Int) -> some View {
        if fresh {
            Text("Leg deine erste Seite an. Sobald du lernst, füllt sich diese Seite.")
        } else if open > 0 {
            HStack(spacing: 0) {
                Button { shell.openCards(.review(deck: nil, mix: false)) } label: {
                    Text(Deck.cardsText(open)).foregroundStyle(Impala.accent).underline(color: Impala.accent.opacity(0.4))
                }
                .buttonStyle(.plain)
                Text(" \(open == 1 ? "wartet" : "warten"), etwa \(estMin) \(estMin == 1 ? "Minute" : "Minuten").")
            }
        } else {
            Text(hasCards ? "Für heute ist alles gelernt." : "Noch keine Karteikarten angelegt.")
        }
    }

    /// „Heute fällig“ (`.hv-cards`): fällig → Lernen starten, alles gelernt, oder Karten anlegen.
    private func dueCard(open: Int, hasCards: Bool, estMin: Int) -> some View {
        Group {
            if open > 0 {
                StatCard(label: "Heute fällig", value: Deck.cardsText(open), note: "etwa \(estMin) Min · Lernen starten", tone: .due) {
                    shell.openCards(.review(deck: nil, mix: false))
                }
            } else if hasCards {
                StatCard(label: "Heute fällig", value: "Alles gelernt", note: "Morgen geht's weiter", tone: .done) {
                    shell.openCards(.decks)
                }
            } else {
                StatCard(label: "Heute fällig", value: "Keine Karten", note: "Karten anlegen", tone: .plain) {
                    shell.cards.editor = CardEditorTarget(cardId: nil, deck: nil)
                }
            }
        }
    }

    /// Wie render.js: Nacht bis 5, Morgen bis 11, Tag bis 18.
    static func greeting(_ date: Date = .now) -> String {
        let h = Calendar.current.component(.hour, from: date)
        return h < 5 ? "Gute Nacht" : h < 11 ? "Guten Morgen" : h < 18 ? "Guten Tag" : "Guten Abend"
    }

    private func create(_ choice: NewPageChoice) {
        if let id = store.core.createNew(choice, parent: nil, workspace: nil) { shell.openNewTab(id) }
    }
}

/// `.hv-alert`: gelbe Pille „N Sync-Konflikte warten auf deine Entscheidung.“ mit „Lösen“.
private struct ConflictAlert: View {
    let count: Int
    let onSolve: () -> Void
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        HStack(spacing: Space.s4) {
            Text(ConflictText.homeAlert(count)).contentTransition(.numericText())
            Spacer(minLength: 0)
            Button("Lösen", action: onSolve)
                .underline()
                .buttonStyle(.plain)
        }
        .font(.system(size: TextSize.sm))
        .foregroundStyle(scheme == .dark ? Impala.warn : Color(uiColor: UIColor(hex: 0x8A6412)))
        .padding(.horizontal, Space.s4)
        .padding(.vertical, Space.s2)
        .background(scheme == .dark ? Impala.warn.opacity(0.12) : Color(uiColor: UIColor(hex: 0xF8EECF)), in: Capsule())
    }
}

/// `.hv-continue`: Karte mit Symbol, „Weitermachen“, Titel und Zeitpunkt.
private struct ContinueCard: View {
    let page: PageSummary

    var body: some View {
        HStack(spacing: Space.s4) {
            PageIcon(page: page, size: 26)
                .foregroundStyle(Impala.accent)
                .frame(width: 64, height: 64)
                .background(Impala.surface, in: RoundedRectangle(cornerRadius: Radius.md, style: .continuous))
            VStack(alignment: .leading, spacing: 2) {
                Text("Weitermachen").font(.system(size: TextSize.xs, weight: .semibold)).foregroundStyle(Impala.text2)
                Text(PageStyle.title(page)).font(.system(size: TextSize.lg, weight: .semibold)).foregroundStyle(Impala.text).lineLimit(1)
                Text(page.kind == .heft ? "Heft" : "Notiz").font(.system(size: TextSize.sm)).foregroundStyle(Impala.text2)
            }
            Spacer(minLength: 0)
        }
        .padding(Space.s3)
        .background(Impala.panel, in: RoundedRectangle(cornerRadius: Radius.lg, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Radius.lg, style: .continuous).stroke(Impala.edgeSoft, lineWidth: 1))
    }
}

/// `.hv-pins`: angeheftete Seiten als Pillen.
private struct FlowRow: View {
    let pins: [PageSummary]
    let open: (String) -> Void

    var body: some View {
        ScrollView(.horizontal) {
            HStack(spacing: Space.s2) {
                ForEach(pins) { p in
                    Button { open(p.id) } label: {
                        Text(PageStyle.title(p))
                            .font(.system(size: TextSize.sm, weight: .medium))
                            .foregroundStyle(Impala.text)
                            .padding(.horizontal, 14)
                            .frame(minHeight: 34)
                            .background(Impala.accent.opacity(0.09), in: Capsule())
                    }
                    .pressable()
                }
            }
        }
        .scrollIndicators(.hidden)
    }
}
