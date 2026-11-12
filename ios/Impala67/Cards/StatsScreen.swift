import Charts
import SwiftUI

/// Rohdaten für die Statistik (`learningStatsJson` des Kerns), Auswertung wie anki-stats.js bzw.
/// `StatsData.kt`. Kandidat für den Rust-Kern, sobald die PWA die Auswertung dorthin verlagert.
struct LearnStats {
    struct Card { let id, front, deck, state: String; let stability: Double; let lapses: Int; let due: Date?; let suspended: Bool }
    struct Review { let id, cardId, deck: String; let t: Date; let grade: Int; let first, learning: Bool; let intervalDays: Double? }
    struct DeckRow: Identifiable { let name: String; let n, due, reif: Int; let rate: Double?; var id: String { name } }
    struct Day: Identifiable { let day: Date; let n: Int; var id: Date { day } }
    struct Forecast: Identifiable { let label: String; let n: Int; var id: String { label } }
    struct Bucket: Identifiable { let label: String; let n: Int; let rate: Double?; var id: String { label } }
    struct Stock: Identifiable { let label: String; let n: Int; var id: String { label } }

    static let reifTage = 21.0
    static let minN = 10
    static let window = 30

    let reviewsAll: Int
    let last: Int
    let rate: Double?
    let trend: Int?
    let avg: Double
    let bestand: [Stock]
    let n: Int
    let reif: Int
    let decks: [DeckRow]
    let series: [Day]
    let forecast: [Forecast]
    let streakCurrent: Int
    let streakLongest: Int
    /// Wiederholungen je Tag (Tagesbeginn) für die Aktivitäts-Heatmap.
    let perDay: [Date: Int]
    let hard: [Card]
    let retention: [Bucket]
    /// Median der eigenen Denkzeit (letzte 300 Reviews, ab 12 Werten), sonst 0 (`TELE.thinkMedian`).
    let thinkMs: Int64

    var lead: String {
        if reviewsAll == 0 { return "Noch keine Wiederholungen — sobald du lernst, füllt sich diese Seite." }
        if last == 0 { return "In den letzten 30 Tagen hast du nichts wiederholt." }
        var text = "In den letzten 30 Tagen \(last) " + (last == 1 ? "Wiederholung" : "Wiederholungen")
            + (rate.map { ", " + Self.pct($0) + " davon richtig" } ?? "") + "."
        if let trend, abs(trend) >= 3 { text += " Das sind \(abs(trend)) Punkte " + (trend > 0 ? "mehr" : "weniger") + " als in den 30 Tagen davor." }
        return text
    }

    var trendNote: String {
        guard rate != nil else { return "ab \(Self.minN) Abfragen" }
        guard let trend else { return "vorher zu wenig Daten" }
        if trend == 0 { return "wie in den 30 Tagen davor" }
        return (trend > 0 ? "↑ " : "↓ ") + "\(abs(trend)) Punkte ggü. davor"
    }

    static func pct(_ x: Double) -> String { "\(Int((x * 100).rounded())) %" }

    /// Behalten zählt nur echte Abfragen: Erstkontakt und Lernschritte sagen noch nichts über das Gedächtnis.
    private static func hitRate(_ list: [Review]) -> Double? {
        let g = list.filter { $0.grade > 0 && !$0.first && !$0.learning }
        return g.count >= minN ? Double(g.filter { $0.grade > 1 }.count) / Double(g.count) : nil
    }

    private static func date(_ s: Any?) -> Date? {
        guard let s = s as? String, !s.isEmpty else { return nil }
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = f.date(from: s) { return d }
        f.formatOptions = [.withInternetDateTime]
        return f.date(from: s)
    }

    /// Lernstand je Karte aus `learningStatsJson` (auch für die Sortierung im Kartenbrowser).
    static func cards(_ o: [String: Any]) -> [Card] {
        ((o["cards"] as? [[String: Any]]) ?? []).map {
            Card(id: $0["id"] as? String ?? "", front: $0["front"] as? String ?? "",
                 deck: ($0["deck"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? Deck.standard,
                 state: $0["state"] as? String ?? "new", stability: ($0["stability"] as? NSNumber)?.doubleValue ?? 0,
                 lapses: ($0["lapses"] as? NSNumber)?.intValue ?? 0, due: Self.date($0["due"]),
                 suspended: $0["suspended"] as? Bool ?? false)
        }
    }

    static func cards(json: String) -> [Card] {
        cards((try? JSONSerialization.jsonObject(with: Data(json.utf8))) as? [String: Any] ?? [:])
    }

    init(json: String, now: Date = Date(), calendar cal: Calendar = .current) {
        let o = (try? JSONSerialization.jsonObject(with: Data(json.utf8))) as? [String: Any] ?? [:]
        let cards = Self.cards(o)
        let reviews: [Review] = ((o["reviews"] as? [[String: Any]]) ?? []).compactMap { r in
            guard let t = Self.date(r["t"]) else { return nil }
            return Review(id: r["id"] as? String ?? "", cardId: r["cardId"] as? String ?? "",
                          deck: (r["deck"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? Deck.standard, t: t,
                          grade: (r["grade"] as? NSNumber)?.intValue ?? 0, first: r["first"] as? Bool ?? false,
                          learning: r["learning"] as? Bool ?? false, intervalDays: (r["intervalDays"] as? NSNumber)?.doubleValue)
        }.sorted { $0.t < $1.t }

        let day = 86_400.0
        let ago = { (r: Review) in now.timeIntervalSince(r.t) / day }
        let w = Double(Self.window)
        let last = reviews.filter { ago($0) >= 0 && ago($0) < w }
        let before = reviews.filter { ago($0) >= w && ago($0) < 2 * w }
        let rate = Self.hitRate(last)
        let rateBefore = Self.hitRate(before)

        var neu = 0, lernen = 0, wieder = 0, aus = 0, reif = 0
        var deckOrder: [String] = []
        var deckCounts: [String: (n: Int, due: Int, reif: Int)] = [:]
        for c in cards {
            if deckCounts[c.deck] == nil { deckOrder.append(c.deck) }
            var row = deckCounts[c.deck] ?? (0, 0, 0)
            row.n += 1
            defer { deckCounts[c.deck] = row }
            if c.suspended { aus += 1; continue }
            switch c.state {
            case "new": neu += 1
            case "review": wieder += 1
            default: lernen += 1
            }
            if c.state == "review", c.stability >= Self.reifTage { reif += 1; row.reif += 1 }
            if let due = c.due, due <= now { row.due += 1 }
        }
        decks = deckOrder.map { name in
            let r = deckCounts[name]!
            return DeckRow(name: name, n: r.n, due: r.due, reif: r.reif, rate: Self.hitRate(last.filter { $0.deck == name }))
        }.sorted { $0.due != $1.due ? $0.due > $1.due : $0.name.localizedCompare($1.name) == .orderedAscending }

        let today = cal.startOfDay(for: now)
        var perDay: [Date: Int] = [:]
        for r in reviews { perDay[cal.startOfDay(for: r.t), default: 0] += 1 }
        series = (0..<Self.window).reversed().map { i in
            let d = cal.date(byAdding: .day, value: -i, to: today)!
            return Day(day: d, n: perDay[d] ?? 0)
        }
        let weekday = DateFormatter()
        weekday.locale = Locale(identifier: "de_DE")
        weekday.dateFormat = "EE"
        forecast = (0..<7).map { i in
            let d0 = cal.date(byAdding: .day, value: i, to: today)!
            let end = cal.date(byAdding: .day, value: 1, to: d0)!
            let start = i == 0 ? Date.distantPast : d0
            let n = cards.filter { c in !c.suspended && c.due.map { $0 >= start && $0 < end } == true }.count
            return Forecast(label: i == 0 ? "Heute" : weekday.string(from: d0), n: n)
        }
        var longest = 0, run = 0
        var prev: Date?
        for k in perDay.keys.sorted() {
            run = prev.map { cal.dateComponents([.day], from: $0, to: k).day == 1 } == true ? run + 1 : 1
            longest = max(longest, run)
            prev = k
        }
        var d = today
        if (perDay[d] ?? 0) == 0 { d = cal.date(byAdding: .day, value: -1, to: d)! }
        var current = 0
        while (perDay[d] ?? 0) > 0 {
            current += 1
            d = cal.date(byAdding: .day, value: -1, to: d)!
        }

        // Behalten nach Wiederholungsabstand (telemetrie.js `retentionStats`).
        let ids = Set(last.map(\.id))
        var prevT: [String: Date] = [:]
        var rows: [(Review, Double?)] = []
        for r in reviews where r.grade > 0 {
            let gap = r.intervalDays.flatMap { $0 >= 0 ? $0 : nil } ?? prevT[r.cardId].map { r.t.timeIntervalSince($0) / day }
            prevT[r.cardId] = r.t
            if ids.contains(r.id) { rows.append((r, gap)) }
        }
        retention = [(1, "1 Tag"), (3, "3 Tage"), (7, "1 Woche"), (14, "2 Wochen")].map { target, label in
            let lo = target == 1 ? 0.5 : Double(target) * 0.6
            let hi = target == 1 ? 2.0 : Double(target) * 1.6
            let ok = rows.filter { r, g in !r.first && !r.learning && g.map { $0 >= lo && $0 <= hi } == true }
            return Bucket(label: label, n: ok.count, rate: ok.isEmpty ? nil : Double(ok.filter { $0.0.grade > 1 }.count) / Double(ok.count))
        }

        // Denkzeit-Median aus der Telemetrie wie `TELE.thinkMedian` / `LearnData.kt`
        let tel = ((o["telemetry"] as? [[String: Any]]) ?? []).filter {
            ($0["kind"] as? String) == "review"
        }
        let timed: [Int64] = tel.suffix(300).compactMap { item in
            guard let data = item["data"] as? [String: Any] else { return nil }
            if (data["typed"] as? Bool) == true || (data["distracted"] as? Bool) == true { return nil }
            guard let ms = (data["thinkMs"] as? NSNumber)?.int64Value, ms >= 400 && ms <= 120_000 else { return nil }
            return ms
        }.sorted()
        thinkMs = timed.count >= 12 ? timed[timed.count / 2] : 0

        reviewsAll = reviews.count
        self.last = last.count
        self.rate = rate
        trend = rate.flatMap { r in rateBefore.map { Int(((r - $0) * 100).rounded()) } }
        avg = Double(last.count) / w
        bestand = [Stock(label: "Neu", n: neu), Stock(label: "Lernen", n: lernen), Stock(label: "Wiederholen", n: wieder),
                   Stock(label: "Ausgesetzt", n: aus)]
        n = cards.count
        self.reif = reif
        streakCurrent = current
        streakLongest = longest
        self.perDay = perDay
        hard = Array(cards.filter { $0.lapses > 0 }.sorted { $0.lapses > $1.lapses }.prefix(5))
    }
}

/// Statistik-Tab der Karteikarten (`ankiStatsHtml`): Satz vorn, Kennzahlen, Verlauf der letzten 30 Tage,
/// Prognose, Lernbestand, Behalten nach Abstand, Stapel und die schwierigsten Karten.
struct StatsScreen: View {
    @Environment(ImpalaStore.self) private var store
    @Environment(ShellModel.self) private var shell
    @State private var stats: LearnStats?

    var body: some View {
        Group {
            if let d = stats {
                content(d)
            } else {
                Impala.panel
            }
        }
        .task(id: store.cardsRevision) {
            let core = store.core
            let loaded = await Task.detached(priority: .userInitiated) {
                LearnStats(json: core.learningStatsJson())
            }.value
            if !Task.isCancelled { stats = loaded }
        }
    }

    private func content(_ d: LearnStats) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Space.s6) {
                HStack(spacing: Space.s2) {
                    Button { withAnimation(.smooth) { shell.cards.view = .decks } } label: {
                        Icon("chevron-left", size: 18).foregroundStyle(Impala.text2).frame(width: 36, height: 36)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Zurück zu den Stapeln")
                    Icon("chart", size: 24).foregroundStyle(Impala.text2)
                    Text("Statistik").font(.system(size: TextSize.xl, weight: .bold, design: .rounded)).foregroundStyle(Impala.text)
                }
                Text(d.lead).font(.system(size: TextSize.lg)).foregroundStyle(Impala.text)
                HStack(alignment: .top, spacing: Space.s3) {
                    StatCard(label: "Trefferquote", value: d.rate.map(LearnStats.pct) ?? "–", note: d.trendNote, tone: .plain, action: nil)
                    if d.thinkMs > 0 {
                        StatCard(label: "Denkzeit", value: String(format: "%.1f s", Double(d.thinkMs) / 1000.0).replacingOccurrences(of: ".", with: ","),
                                 note: "Median pro Karte", tone: .plain, action: nil)
                    }
                    StatCard(label: "Pro Tag", value: String(format: "%.1f", d.avg).replacingOccurrences(of: ".", with: ","),
                             note: "Wiederholungen im Schnitt", tone: .plain, action: nil)
                    StatCard(label: "Serie", value: d.streakCurrent == 1 ? "1 Tag" : "\(d.streakCurrent) Tage",
                             note: "längste: \(d.streakLongest)", tone: .plain, action: nil)
                    StatCard(label: "Reif", value: "\(d.reif)", note: "von \(d.n) Karten (≥ 21 Tage)", tone: .plain, action: nil)
                }
                section("Wiederholungen · letzte 30 Tage") {
                    Chart(d.series) { day in
                        BarMark(x: .value("Tag", day.day, unit: .day), y: .value("Wiederholungen", day.n))
                            .foregroundStyle(Impala.accent)
                    }
                    .chartYAxis {
                        AxisMarks(position: .leading) { _ in
                            AxisGridLine().foregroundStyle(Impala.edgeSoft)
                            AxisTick().foregroundStyle(Impala.edge)
                            AxisValueLabel().foregroundStyle(Impala.text2)
                        }
                    }
                    .chartXAxis {
                        AxisMarks(values: .stride(by: .day, count: 5)) { _ in
                            AxisGridLine().foregroundStyle(Color.clear)
                            AxisValueLabel(format: .dateTime.day().month()).foregroundStyle(Impala.text2)
                        }
                    }
                    .frame(height: 180)
                }
                section("Prognose · nächste 7 Tage") {
                    Chart(d.forecast) { f in
                        BarMark(x: .value("Tag", f.label), y: .value("Fällig", f.n))
                            .foregroundStyle(Impala.accent.opacity(0.85))
                            .cornerRadius(3)
                            .annotation(position: .top) {
                                if f.n > 0 { Text("\(f.n)").font(.system(size: 11)).foregroundStyle(Impala.text2) }
                            }
                    }
                    .frame(height: 140)
                }
                section("Lernbestand") {
                    Chart(d.bestand) { b in
                        BarMark(x: .value("Karten", b.n), y: .value("Bestand", "Karten"), stacking: .normalized)
                            .foregroundStyle(by: .value("Stand", b.label))
                    }
                    .chartYAxis(.hidden)
                    .chartLegend(.hidden)
                    .chartForegroundStyleScale(["Neu": Impala.accent, "Lernen": Impala.warn, "Wiederholen": Impala.success, "Ausgesetzt": Impala.text2.opacity(0.4)])
                    .chartXAxis(.hidden)
                    .frame(height: 56)
                    HStack(spacing: Space.s4) {
                        ForEach(d.bestand) { b in
                            Text("\(b.label) \(b.n)").font(.system(size: TextSize.sm)).foregroundStyle(Impala.text2)
                        }
                    }
                }
                section("Behalten nach Abstand") {
                    HStack(alignment: .top, spacing: Space.s3) {
                        ForEach(d.retention) { b in
                            StatCard(label: b.label, value: b.rate.map(LearnStats.pct) ?? "–",
                                     note: b.n == 1 ? "1 Abfrage" : "\(b.n) Abfragen", tone: .plain, action: nil)
                        }
                    }
                }
                section("Aktivität · letzte 12 Monate") {
                    ActivityHeatmap(perDay: d.perDay)
                    Text("Serie: \(d.streakCurrent == 1 ? "1 Tag" : "\(d.streakCurrent) Tage") aktuell · längste \(d.streakLongest == 1 ? "1 Tag" : "\(d.streakLongest) Tage")")
                        .font(.system(size: TextSize.sm))
                        .foregroundStyle(Impala.text2)
                }
                if !d.decks.isEmpty {
                    section("Stapel") {
                        Grid(alignment: .leading, horizontalSpacing: Space.s4, verticalSpacing: Space.s2) {
                            GridRow {
                                ForEach(["Stapel", "Karten", "Fällig", "Reif", "Quote"], id: \.self) {
                                    Text($0).font(.system(size: TextSize.xs, weight: .semibold)).foregroundStyle(Impala.text2)
                                }
                            }
                            ForEach(d.decks) { r in
                                GridRow {
                                    Text(r.name).lineLimit(1)
                                    Text("\(r.n)").monospacedDigit()
                                    Text("\(r.due)").monospacedDigit()
                                    Text("\(r.reif)").monospacedDigit()
                                    Text(r.rate.map(LearnStats.pct) ?? "–").monospacedDigit()
                                }
                                .font(.system(size: TextSize.sm))
                                .foregroundStyle(Impala.text)
                            }
                        }
                    }
                }
                if !d.hard.isEmpty {
                    section("Schwierigste Karten") {
                        ForEach(d.hard, id: \.id) { c in
                            Button { shell.cards.editor = CardEditorTarget(cardId: c.id, deck: c.deck) } label: {
                                HStack {
                                    Text(markdownPlainText(markdown: c.front)).lineLimit(1).foregroundStyle(Impala.text)
                                    Spacer()
                                    Text("\(c.lapses)× vergessen").foregroundStyle(Impala.danger)
                                }
                                .font(.system(size: TextSize.sm))
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
            .padding(Space.s6)
            .frame(maxWidth: 860, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
    }

    private func section(_ title: String, @ViewBuilder _ content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: Space.s2) {
            Text(title).font(.system(size: TextSize.xs, weight: .semibold)).foregroundStyle(Impala.text2)
            content()
        }
    }
}

/// Aktivitäts-Heatmap wie `heatmapHtml` (anki-stats.js): 53 Wochen × 7 Tage ab Montag, Farbstufe nach
/// Wiederholungen pro Tag (0, < 5, < 15, < 30, ab 30). Startet am rechten Ende (heute).
struct ActivityHeatmap: View {
    let perDay: [Date: Int]
    private let cell: CGFloat = 12
    private let gap: CGFloat = 3

    var body: some View {
        let weeks = Self.weeks(Date())
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(alignment: .top, spacing: gap) {
                ForEach(weeks.indices, id: \.self) { w in
                    VStack(spacing: gap) {
                        ForEach(weeks[w], id: \.self) { day in
                            let n = perDay[day] ?? 0
                            RoundedRectangle(cornerRadius: 2.5, style: .continuous)
                                .fill(Self.color(n))
                                .frame(width: cell, height: cell)
                                .help("\(day.formatted(.dateTime.day().month().year())): \(n) Wiederholungen")
                        }
                    }
                }
            }
            .padding(.vertical, 2)
        }
        .defaultScrollAnchor(.trailing)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Aktivität der letzten 12 Monate: an \(perDay.values.filter { $0 > 0 }.count) Tagen gelernt")
    }

    /// Spalten je Woche (Montag oben); die letzte Woche endet heute.
    static func weeks(_ now: Date, calendar cal: Calendar = .current) -> [[Date]] {
        let end = cal.startOfDay(for: now)
        let weekday = (cal.component(.weekday, from: end) + 5) % 7 // Montag = 0
        guard let start = cal.date(byAdding: .day, value: -364 - weekday, to: end) else { return [] }
        var out: [[Date]] = []
        var d = start
        while d <= end {
            if out.isEmpty || out[out.count - 1].count == 7 { out.append([]) }
            out[out.count - 1].append(d)
            guard let next = cal.date(byAdding: .day, value: 1, to: d) else { break }
            d = next
        }
        return out
    }

    static func color(_ n: Int) -> Color {
        switch n {
        case 0: Impala.edgeSoft
        case ..<5: Impala.accent.opacity(0.3)
        case ..<15: Impala.accent.opacity(0.55)
        case ..<30: Impala.accent.opacity(0.8)
        default: Impala.accent
        }
    }
}
