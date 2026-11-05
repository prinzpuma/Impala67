import SwiftUI

/// Startseite wie `homeViewHtml` (home-view.js): Datum, „+ Neue Seite“ und „Startseite anpassen“, Begrüßung
/// mit Namen und dem Satz zu Karten und Lernzeit, „Weitermachen“, angeheftete Seiten, rechts „Heute fällig“
/// und „Diese Woche gelernt“, darunter der Tagesartikel. Vorlage auch `android/app/…/home/`.
struct HomeScreen: View {
    @Environment(ImpalaStore.self) private var store
    @Environment(ShellModel.self) private var shell
    @Environment(SyncController.self) private var sync: SyncController?
    @Environment(DriveController.self) private var drive: DriveController?
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.shellNamespace) private var zoom
    @AppStorage(WeekGoal.key) private var storedGoal = 300
    @AppStorage("impala67_backup_snooze_until") private var backupSnoozeUntil: Double = 0
    @State private var backupView: DriveBackupView?
    /// „Weißt du's noch?“: geht alle Karten durch, daher nur bei Kartenänderungen neu (`.task(id:)`).
    @State private var recall: Recall?
    @State private var sheet: HomeSheet?
    private var writer: HomeArticleWriter { .shared }

    private enum HomeSheet: String, Identifiable {
        case customize, history
        var id: String { rawValue }
    }

    /// Kern-Daten der Startseite; im Hintergrund gelesen (`HomeData.load`), damit der Hauptthread nie
    /// auf die Kern-Sperre wartet, solange Sync oder Checkpoint laufen.
    @State private var data: HomeData?

    /// Neu lesen nur bei Änderungen, die die Startseite zeigt (nicht bei jedem Strich im Heft).
    private var dataKey: [Int] {
        [store.pagesRevision, store.cardsRevision, store.homeRevision, store.remoteRevision]
    }

    var body: some View {
        Group {
            if let data { content(data) } else { Impala.panel }
        }
        .background(Impala.panel)
        .task(id: dataKey) {
            // Kurz sammeln: Ein Sync meldet oft mehrere Änderungen hintereinander.
            if data != nil { try? await Task.sleep(for: .milliseconds(150)) }
            guard !Task.isCancelled else { return }
            let core = store.core
            let loaded = await Task.detached(priority: .userInitiated) { HomeData.load(core) }.value
            if !Task.isCancelled { data = loaded }
        }
    }

    private func content(_ data: HomeData) -> some View {
        let settings = data.settings
        let time = data.time
        let week = time.week()
        let streak = time.streakDays()
        let goal = WeekGoal.normalized(storedGoal)
        let nudge = HomeFormat.nudge(streak: streak, todaySeconds: time.seconds(.now), weekMin: Double(week.reduce(0, +)) / 60, goalMin: goal)
        let articles = data.articles
        let conflicts = data.conflicts
        let last = data.recent.first
        let pins = data.recent.filter(\.favorite).prefix(6)
        let open = data.open
        let hasCards = data.hasCards
        // Ohne eigene Messwerte 20 s je Karte (`secPerCard` in home-view.js), mindestens 1 Minute.
        let estMin = max(1, Int((Double(open) * 20 / 60).rounded()))
        return ScrollView {
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
                    Button { sheet = .customize } label: {
                        Icon("gear", size: 17).foregroundStyle(Impala.text2).frame(width: 36, height: 36).contentShape(Circle())
                    }
                    .buttonStyle(.plain)
                    .hoverEffect(.highlight)
                    .accessibilityLabel("Startseite anpassen")
                }
                .riseIn(0)
                if conflicts > 0 {
                    ConflictAlert(count: conflicts) { shell.sheet = .conflicts }
                        .zoomSource(ShellSheet.conflicts, zoom)
                        .riseIn(1)
                        .transition(.opacity.combined(with: .move(edge: .top)))
                }
                if let backupView, backupView.needsHint, Date().timeIntervalSince1970 * 1000 >= backupSnoozeUntil {
                    BackupAlert(
                        view: backupView,
                        onBackup: {
                            if backupView.level == .stale {
                                sync?.syncNow()
                                if drive?.connected == true { Task { await drive?.sync() } }
                            }
                            shell.sheet = .settings
                        },
                        onLater: {
                            let snoozeDuration = backupView.snoozeMs > 0 ? backupView.snoozeMs : 3 * 86_400_000
                            backupSnoozeUntil = Date().timeIntervalSince1970 * 1000 + snoozeDuration
                        }
                    )
                    .riseIn(1)
                    .transition(.opacity.combined(with: .move(edge: .top)))
                }
                VStack(alignment: .leading, spacing: Space.s2) {
                    Text("\(Self.greeting())\(settings.name.isEmpty ? "" : ", " + settings.name).")
                        .font(.system(size: TextSize.xl, weight: .bold, design: .rounded))
                        .foregroundStyle(Impala.text)
                    lead(fresh: last == nil && !hasCards, open: open, hasCards: hasCards, estMin: estMin, nudge: nudge)
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
                    if let recall {
                        RecallCard(recall: recall) {
                            shell.openCards(.review(deck: recall.deck.isEmpty ? nil : recall.deck, mix: false))
                        }
                        .riseIn(3)
                    }
                }
                let stats = VStack(spacing: Space.s4) {
                    dueCard(open: open, hasCards: hasCards, estMin: estMin)
                    WeekStat(week: week, goalMin: goal, streak: streak) { storedGoal = WeekGoal.next(after: goal) }
                }
                .riseIn(3)
                // `.hv-grid`: breit zwei Spalten (Kennzahlen rechts), schmal untereinander.
                if sizeClass == .regular {
                    HStack(alignment: .top, spacing: Space.s4) {
                        main.frame(maxWidth: .infinity, alignment: .leading)
                        stats.frame(width: 280)
                    }
                } else {
                    main
                    stats
                }
                ArticleSection(
                    articles: articles, writer: writer,
                    onRetry: { writer.retry(core: store.core, chat: shell.chat) },
                    onHistory: { sheet = .history }
                )
                .riseIn(4)
            }
            .padding(Space.s6)
            .animation(.smooth, value: conflicts)
            .animation(.smooth, value: backupView?.needsHint)
            .animation(.smooth, value: backupSnoozeUntil)
            .animation(.smooth, value: writer.phase == .busy)
            .frame(maxWidth: 860, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .background(Impala.panel)
        .sheet(item: $sheet) { s in
            switch s {
            case .customize: HomeCustomizeSheet().environment(store)
            case .history: ArticleHistorySheet().environment(store).environment(shell)
            }
        }
        .task {
            // Tagesartikel: ein Versuch je App-Start, automatisch nur bei erreichbarer KI.
            shell.chat.refreshModels()
            writer.ensure(core: store.core, chat: shell.chat)
            while !Task.isCancelled {
                await refreshBackupStatus()
                try? await Task.sleep(for: .seconds(60))
            }
        }
        .task(id: store.cardsRevision) {
            let core = store.core
            let next = await Task.detached(priority: .utility) { HomeRecall.compute(core: core) }.value
            if !Task.isCancelled { recall = next }
        }
        // Nicht bei jeder Änderung (jeder Strich, jeder Buchstabe): Minutentakt und Sync-/Drive-Wechsel reichen.
        .onChange(of: sync?.state) { _, _ in Task { await refreshBackupStatus() } }
        .onChange(of: drive?.connected) { _, _ in Task { await refreshBackupStatus() } }
        .onChange(of: drive?.running) { _, _ in Task { await refreshBackupStatus() } }
    }

    private func refreshBackupStatus() async {
        let core = store.core
        let cfSeq = sync?.uploadedSeq()
        let driveActive = (drive?.connected == true) || (drive?.needsLogin == true)
        let nowMs = Date().timeIntervalSince1970 * 1000
        let v = await Task.detached(priority: .utility) {
            driveBackupView(core: core, cloudflareUploadedSeq: cfSeq, driveActive: driveActive, nowMs: nowMs)
        }.value
        self.backupView = v
    }

    /// Satz nach der Begrüßung (`sum` in home-view.js); die Kartenzahl startet das Lernen.
    @ViewBuilder
    private func lead(fresh: Bool, open: Int, hasCards: Bool, estMin: Int, nudge: String) -> some View {
        if fresh {
            Text("Leg deine erste Seite an. Sobald du lernst, füllt sich diese Seite.")
        } else if open > 0 {
            // Ein Text, damit der Satz samt Lernzeit-Hinweis umbricht; die Kartenzahl ist ein Link.
            let cards: AttributedString = {
                var a = AttributedString(Deck.cardsText(open))
                a.link = URL(string: "impala://home/cards")
                a.swiftUI.foregroundColor = Impala.accent
                a.swiftUI.underlineStyle = .single
                return a
            }()
            Text(cards + AttributedString(" \(open == 1 ? "wartet" : "warten"), etwa \(estMin) \(estMin == 1 ? "Minute" : "Minuten").\(nudge)"))
                .environment(\.openURL, OpenURLAction { _ in
                    shell.openCards(.review(deck: nil, mix: false))
                    return .handled
                })
        } else {
            Text((hasCards ? "Für heute ist alles gelernt." : "Noch keine Karteikarten angelegt.") + nudge)
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

/// Was die Startseite aus dem Kern liest (ein Hintergrund-Aufruf statt sechs im `body`).
struct HomeData {
    let settings: HomeSettings
    let time: LearningTime
    let articles: [HomeArticleInfo]
    let conflicts: Int
    let recent: [PageSummary]
    /// Heute offene Karten (neu + lernen + wiederholen).
    let open: Int
    let hasCards: Bool

    static func load(_ core: ImpalaCore) -> HomeData {
        let settings = HomeSettings.read(core)
        let study = core.studyQueue(deck: nil, utcOffsetMinutes: Deck.utcOffset, mix: false)
        return HomeData(
            settings: settings,
            time: LearningTime(core.learningSessions()),
            articles: settings.article ? core.homeArticles(limit: 30) : [],
            conflicts: Int(core.conflictCount()),
            recent: core.recentPages(limit: 40),
            open: Int(study.new + study.learn + study.review),
            hasCards: core.cardTotals().cards > 0
        )
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
