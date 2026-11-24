import Charts
import SwiftUI

/// Statistik-Kennzahlen aus dem Rust-Kern (`learningStats` des Kerns), aufbereitet für die Oberfläche.
struct LearnStats {
    struct Card: Identifiable {
        let id, front, deck, state: String
        let stability: Double
        let lapses: Int
        let due: Date?
        let suspended: Bool
    }
    struct DeckRow: Identifiable { let name: String; let n, due, reif: Int; let rate: Double?; var id: String { name } }
    struct Day: Identifiable { let day: Date; let n: Int; var id: Date { day } }
    struct Forecast: Identifiable { let label: String; let n: Int; var id: String { label } }
    struct Bucket: Identifiable { let label: String; let n: Int; let rate: Double?; var id: String { label } }
    struct Stock: Identifiable { let label: String; let n: Int; var id: String { label } }

    static let minN = 10

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

    private static func date(_ s: Any?) -> Date? {
        guard let s = s as? String, !s.isEmpty else { return nil }
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = f.date(from: s) { return d }
        f.formatOptions = [.withInternetDateTime]
        return f.date(from: s)
    }

    /// Lernstand je Karte aus `learningStatsJson` (für die Sortierung/Anzeige im Kartenbrowser `CardsScreen`).
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

    init(stats: LearningStats, now: Date = Date(), calendar cal: Calendar = .current) {
        reviewsAll = Int(stats.reviewsAll)
        last = Int(stats.last)
        rate = stats.rate
        trend = stats.trend.map { Int($0) }
        avg = stats.avg
        bestand = [
            Stock(label: "Neu", n: Int(stats.bestand.neu)),
            Stock(label: "Lernen", n: Int(stats.bestand.lernen)),
            Stock(label: "Wiederholen", n: Int(stats.bestand.wiederholen)),
            Stock(label: "Ausgesetzt", n: Int(stats.bestand.ausgesetzt)),
        ]
        n = Int(stats.n)
        reif = Int(stats.reif)
        decks = stats.decks.map {
            DeckRow(name: $0.name, n: Int($0.n), due: Int($0.due), reif: Int($0.reif), rate: $0.rate)
        }

        let dateFmt = DateFormatter()
        dateFmt.dateFormat = "yyyy-MM-dd"
        dateFmt.timeZone = cal.timeZone

        series = stats.series.compactMap { s in
            guard let d = dateFmt.date(from: s.date) else { return nil }
            return Day(day: d, n: Int(s.n))
        }

        let weekday = DateFormatter()
        weekday.locale = Locale(identifier: "de_DE")
        weekday.dateFormat = "EE"
        let today = cal.startOfDay(for: now)

        forecast = stats.forecast.map { f in
            let offset = Int(f.dayOffset)
            let label: String
            if offset == 0 {
                label = "Heute"
            } else if let d = cal.date(byAdding: .day, value: offset, to: today) {
                label = weekday.string(from: d)
            } else {
                label = "+\(offset)T"
            }
            return Forecast(label: label, n: Int(f.n))
        }

        streakCurrent = Int(stats.streakCurrent)
        streakLongest = Int(stats.streakLongest)
        hard = stats.hard.map {
            Card(id: $0.id, front: $0.front, deck: $0.deck, state: "review", stability: $0.stability, lapses: Int($0.lapses), due: nil, suspended: false)
        }

        retention = [
            Bucket(label: "1 Tag", n: Int(stats.retention.day1.n), rate: stats.retention.day1.rate),
            Bucket(label: "3 Tage", n: Int(stats.retention.day3.n), rate: stats.retention.day3.rate),
            Bucket(label: "1 Woche", n: Int(stats.retention.day7.n), rate: stats.retention.day7.rate),
            Bucket(label: "2 Wochen", n: Int(stats.retention.day14.n), rate: stats.retention.day14.rate),
        ]

        var perDayMap: [Date: Int] = [:]
        for cell in stats.heatmap {
            if let d = dateFmt.date(from: cell.date) {
                let day = cal.startOfDay(for: d)
                perDayMap[day, default: 0] += Int(cell.n)
            }
        }
        perDay = perDayMap
        thinkMs = stats.thinkMs
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
                LearnStats(stats: core.learningStats(deck: nil, nowMs: nil, zone: SystemZone.shared))
            }.value
            if !Task.isCancelled { stats = loaded }
        }
    }

    private func content(_ d: LearnStats) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Space.s6) {
                HStack(spacing: Space.s2) {
                    Button { withAnimation(.smooth) { shell.cards.view = .decks } } label: {
                        Icon("chevron-left", size: 18).foregroundStyle(Impala.text2).frame(width: 36, height: 36).contentShape(Rectangle())
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
