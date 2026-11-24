import Charts
import SwiftUI

/// „Diese Woche gelernt“ (`.hv-week`): Summe, Zielbalken, Tagesbalken Mo–So, Streak-Satz und „Ziel ändern“.
/// Die Balken wachsen beim ersten Zeigen gestaffelt mit einer Feder (`hv-grow-*`), danach folgen sie dem Wert.
struct WeekStat: View {
    /// Sekunden Mo–So.
    let week: [Int]
    let goalMin: Int
    let streak: Int
    var onOpenDetail: (() -> Void)? = nil
    let onCycleGoal: () -> Void
    @State private var grown = false
    @Environment(\.accessibilityReduceMotion) private var systemReduceMotion
    private var reduceMotion: Bool { systemReduceMotion || AppMotion.isReduced }

    private var weekMin: Double { Double(week.reduce(0, +)) / 60 }
    private var pct: Int { min(100, Int((weekMin / Double(goalMin) * 100).rounded())) }

    var body: some View {
        let reached = pct >= 100
        VStack(alignment: .leading, spacing: Space.s1) {
            Button {
                onOpenDetail?()
            } label: {
                VStack(alignment: .leading, spacing: Space.s1) {
                    HStack {
                        Text("Diese Woche gelernt").font(.system(size: TextSize.xs)).foregroundStyle(Impala.text2)
                        if onOpenDetail != nil {
                            Spacer(minLength: 0)
                            Icon("chevron-right", size: 12).foregroundStyle(Impala.text2.opacity(0.6))
                        }
                    }
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Text(HomeFormat.dur(weekMin))
                            .font(.system(size: 30, weight: .semibold, design: .rounded))
                            .kerning(-0.6)
                            .monospacedDigit()
                            .contentTransition(.numericText())
                            .foregroundStyle(Impala.text)
                        Text(reached ? "· Ziel geschafft" : "von " + HomeFormat.dur(Double(goalMin)))
                            .font(.system(size: TextSize.md))
                            .foregroundStyle(reached ? Impala.success : Impala.text2)
                            .contentTransition(.numericText())
                    }
                    goalBar(reached: reached)
                    bars
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(onOpenDetail == nil)
            .accessibilityLabel("Diese Woche gelernt")
            HStack {
                Text(streak > 0 ? HomeFormat.days(streak, "Tag", "Tage") + " am Stück" : "Heute lernen startet einen Streak")
                    .font(.system(size: TextSize.xs))
                    .foregroundStyle(Impala.text2)
                Spacer(minLength: Space.s2)
                Button("Ziel ändern", action: onCycleGoal)
                    .font(.system(size: TextSize.xs))
                    .foregroundStyle(Impala.text2)
                    .underline()
                    .buttonStyle(.plain)
                    .padding(.vertical, Space.s2)
                    .contentShape(Rectangle())
                    .sensoryFeedback(.selection, trigger: goalMin)
            }
            .padding(.top, Space.s1)
        }
        .padding(.horizontal, 22)
        .padding(.vertical, 20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Impala.panel, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).stroke(Impala.edgeSoft, lineWidth: 1))
        .animation(.spring(duration: 0.6, bounce: 0.15), value: goalMin)
        .animation(.spring(duration: 0.6, bounce: 0.15), value: week)
        .onAppear {
            if reduceMotion { grown = true } else { withAnimation(.spring(duration: 0.8, bounce: 0.2).delay(0.15)) { grown = true } }
        }
    }

    /// `.hv-goalbar`: Fortschritt zum Wochenziel (Akzent, Grün wenn geschafft).
    private func goalBar(reached: Bool) -> some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(Impala.text.opacity(0.08))
                Capsule().fill(reached ? Impala.success : Impala.accent)
                    .frame(width: grown ? geo.size.width * CGFloat(pct) / 100 : 0)
            }
        }
        .frame(height: 8)
        .padding(.top, Space.s2)
        .padding(.bottom, Space.s1)
        .accessibilityLabel("Wochenziel")
        .accessibilityValue("\(pct) Prozent")
    }

    /// `.hv-bars`: heute Akzent, spätere Tage blass, Höhe relativ zu Tagesziel bzw. Maximum.
    private var bars: some View {
        let today = LearningTime.weekdayIndex()
        let scale = max(Double(goalMin) / 7, Double(week.max() ?? 0) / 60, 1)
        return HStack(spacing: Space.s1) {
            ForEach(Array(week.enumerated()), id: \.offset) { i, sec in
                let minutes = Double(sec) / 60
                let h = minutes >= 1 ? max(12, (minutes / scale * 100).rounded()) / 100 : 0
                VStack(spacing: Space.s1) {
                    GeometryReader { geo in
                        ZStack(alignment: .bottom) {
                            Capsule().fill(Impala.text.opacity(0.07))
                            Capsule().fill(i == today ? Impala.accent : Impala.accent.opacity(0.35))
                                .frame(height: grown ? geo.size.height * h : 0)
                                .animation(.spring(duration: 0.7, bounce: 0.2).delay(reduceMotion ? 0 : 0.1 + 0.04 * Double(i)), value: grown)
                        }
                        .frame(width: 10)
                        .frame(maxWidth: .infinity)
                    }
                    Text(HomeFormat.days[i])
                        .font(.system(size: 10, weight: i == today ? .semibold : .regular))
                        .foregroundStyle(i == today ? Impala.text : Impala.text2)
                }
                .opacity(i > today ? 0.45 : 1)
                .frame(maxWidth: .infinity)
            }
        }
        .frame(height: 48)
        .padding(.top, Space.s2)
    }
}

/// Detail-Blatt für „Diese Woche gelernt“: Wochenvergleich, Balkendiagramm, Kategorien, Ziel & Link zur Statistik.
struct LearningTimeSheet: View {
    let sessions: [LearningSessionInfo]
    let time: LearningTime
    let goalMin: Int
    let onSetGoal: (Int) -> Void
    let onOpenStats: () -> Void

    @State private var weekOffset = 0

    private var weekSeconds: [Int] { time.week(offset: weekOffset) }
    private var weekMin: Double { Double(weekSeconds.reduce(0, +)) / 60 }
    private var todayMin: Double { Double(time.seconds(.now)) / 60 }
    private var streak: Int { time.streakDays(.now) }
    private var dailyTargetMin: Double { Double(goalMin) / 7.0 }

    private var weekRange: (start: Date, end: Date) {
        let cal = Calendar.monday
        let startOfToday = cal.startOfDay(for: .now)
        let weekdayIdx = LearningTime.weekdayIndex(.now)
        let currentMonday = cal.date(byAdding: .day, value: -weekdayIdx, to: startOfToday) ?? startOfToday
        let monday = cal.date(byAdding: .day, value: weekOffset * 7, to: currentMonday) ?? currentMonday
        let end = cal.date(byAdding: .day, value: 7, to: monday) ?? monday
        return (monday, end)
    }

    private var weekLabel: String {
        if weekOffset == 0 { return "Diese Woche" }
        if weekOffset == -1 { return "Letzte Woche" }
        let (start, endExcl) = weekRange
        let end = Calendar.monday.date(byAdding: .day, value: -1, to: endExcl) ?? endExcl
        let fmt = DateFormatter()
        fmt.locale = Locale(identifier: "de_DE")
        fmt.dateFormat = "d. MMM"
        return "\(fmt.string(from: start)) – \(fmt.string(from: end))"
    }

    private struct DayBar: Identifiable {
        let index: Int
        let label: String
        let minutes: Double
        var id: Int { index }
    }

    private var dayBars: [DayBar] {
        HomeFormat.days.enumerated().map { i, name in
            DayBar(index: i, label: name, minutes: Double(weekSeconds[safe: i] ?? 0) / 60)
        }
    }

    private struct CategoryRow: Identifiable {
        let key: String
        let label: String
        let icon: String
        let minutes: Double
        var id: String { key }
    }

    private var categoryRows: [CategoryRow] {
        let (start, end) = weekRange
        var totals: [String: UInt64] = [:]
        for s in sessions {
            guard let d = ISODate.parse(s.startedAt), d >= start, d < end else { continue }
            totals[s.category, default: 0] += s.durationSeconds
        }
        let meta: [(key: String, label: String, icon: String)] = [
            ("cards", "Karten", "cards"),
            ("notebook", "Heft", "notebook"),
            ("notes", "Notizen", "note"),
            ("ai", "KI-Chat", "sparkles"),
            ("other", "Sonstiges", "clock"),
        ]
        return meta.compactMap { item in
            let sec = totals[item.key] ?? 0
            guard sec > 0 else { return nil }
            return CategoryRow(key: item.key, label: item.label, icon: item.icon, minutes: Double(sec) / 60)
        }
        .sorted { $0.minutes > $1.minutes }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Space.s4) {
                    weekHeader
                    summaryRow
                    dailyChartCard
                    categoriesCard
                    goalSection
                    statsButton
                }
                .padding(Space.s4)
            }
            .background(Impala.panel)
            .navigationTitle("Lernzeit")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { CloseButton() } }
        }
        .presentationDetents([.medium, .large])
    }

    private var weekHeader: some View {
        HStack {
            Button { weekOffset -= 1 } label: {
                Icon("chevron-left", size: 15)
                    .foregroundStyle(Impala.text)
                    .frame(width: 34, height: 34)
                    .background(Impala.surface, in: Circle())
                    .contentShape(Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Vorherige Woche")

            Spacer()
            Text(weekLabel)
                .font(.system(size: TextSize.md, weight: .semibold))
                .foregroundStyle(Impala.text)
            Spacer()

            Button { if weekOffset < 0 { weekOffset += 1 } } label: {
                Icon("chevron-right", size: 15)
                    .foregroundStyle(weekOffset < 0 ? Impala.text : Impala.text2.opacity(0.35))
                    .frame(width: 34, height: 34)
                    .background(Impala.surface, in: Circle())
                    .contentShape(Circle())
            }
            .buttonStyle(.plain)
            .disabled(weekOffset >= 0)
            .accessibilityLabel("Nächste Woche")
        }
    }

    private var summaryRow: some View {
        HStack(spacing: Space.s3) {
            summaryCard(label: "Woche", value: HomeFormat.dur(weekMin), note: "Ziel: \(HomeFormat.dur(Double(goalMin)))")
            summaryCard(label: "Heute", value: HomeFormat.dur(todayMin), note: todayMin >= dailyTargetMin ? "Tagesschnitt erreicht" : "Schnitt: \(HomeFormat.dur(dailyTargetMin))")
            summaryCard(label: "Streak", value: streak == 1 ? "1 Tag" : "\(streak) Tage", note: "≥ 5 Min pro Tag")
        }
    }

    private var dailyChartCard: some View {
        VStack(alignment: .leading, spacing: Space.s3) {
            Text("Lernzeit pro Tag")
                .font(.system(size: TextSize.sm, weight: .semibold))
                .foregroundStyle(Impala.text)
            Chart {
                ForEach(dayBars) { bar in
                    BarMark(
                        x: .value("Tag", bar.label),
                        y: .value("Minuten", bar.minutes)
                    )
                    .foregroundStyle(weekOffset == 0 && bar.index == LearningTime.weekdayIndex() ? Impala.accent : Impala.accent.opacity(0.5))
                    .cornerRadius(5)
                }
                RuleMark(y: .value("Tagesschnitt", dailyTargetMin))
                    .lineStyle(StrokeStyle(lineWidth: 1, dash: [4, 4]))
                    .foregroundStyle(Impala.text2.opacity(0.6))
            }
            .chartYAxisLabel("Min")
            .frame(height: 190)
        }
        .padding(Space.s4)
        .background(Impala.surface, in: RoundedRectangle(cornerRadius: Radius.lg, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Radius.lg, style: .continuous).stroke(Impala.edgeSoft, lineWidth: 1))
    }

    private var categoriesCard: some View {
        VStack(alignment: .leading, spacing: Space.s3) {
            Text("Bereiche")
                .font(.system(size: TextSize.sm, weight: .semibold))
                .foregroundStyle(Impala.text)
            if categoryRows.isEmpty {
                Text("In dieser Woche wurde noch keine Lernzeit erfasst.")
                    .font(.system(size: TextSize.sm))
                    .foregroundStyle(Impala.text2)
            } else {
                let totalMin = max(1.0, categoryRows.reduce(0) { $0 + $1.minutes })
                ForEach(categoryRows) { row in
                    categoryRowView(row, totalMin: totalMin)
                }
            }
        }
        .padding(Space.s4)
        .background(Impala.surface, in: RoundedRectangle(cornerRadius: Radius.lg, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Radius.lg, style: .continuous).stroke(Impala.edgeSoft, lineWidth: 1))
    }

    private func categoryRowView(_ row: CategoryRow, totalMin: Double) -> some View {
        VStack(spacing: 5) {
            HStack(spacing: Space.s3) {
                Icon(row.icon, size: 15)
                    .foregroundStyle(Impala.accent)
                    .frame(width: 24)
                Text(row.label)
                    .font(.system(size: TextSize.sm, weight: .medium))
                    .foregroundStyle(Impala.text)
                Spacer()
                Text(HomeFormat.dur(row.minutes))
                    .font(.system(size: TextSize.sm).monospacedDigit())
                    .foregroundStyle(Impala.text2)
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(Impala.text.opacity(0.07))
                    Capsule().fill(Impala.accent.opacity(0.65))
                        .frame(width: geo.size.width * CGFloat(min(1, row.minutes / totalMin)))
                }
            }
            .frame(height: 5)
        }
    }

    private var goalSection: some View {
        VStack(alignment: .leading, spacing: Space.s2) {
            Text("Wochenziel")
                .font(.system(size: TextSize.sm, weight: .semibold))
                .foregroundStyle(Impala.text)
            HStack(spacing: Space.s2) {
                ForEach(WeekGoal.presets, id: \.self) { preset in
                    goalPresetButton(preset)
                }
            }
        }
    }

    private func goalPresetButton(_ preset: Int) -> some View {
        let active = goalMin == preset
        let label = HomeFormat.dur(Double(preset))
        return Button { onSetGoal(preset) } label: {
            Text(label)
                .font(.system(size: TextSize.sm, weight: active ? .semibold : .regular))
                .foregroundStyle(active ? Impala.accent : Impala.text2)
                .frame(maxWidth: .infinity)
                .frame(minHeight: 36)
                .background(active ? Impala.activeTint : Impala.surface, in: Capsule())
                .overlay(Capsule().stroke(active ? Impala.accentBorder : Impala.edgeSoft, lineWidth: 1))
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
    }

    private var statsButton: some View {
        Button(action: onOpenStats) {
            HStack {
                Icon("chart", size: 15)
                Text("Karten-Statistik öffnen")
                    .font(.system(size: TextSize.sm, weight: .semibold))
                Spacer()
                Icon("chevron-right", size: 13)
            }
            .foregroundStyle(Impala.accent)
            .padding(.horizontal, Space.s4)
            .frame(minHeight: 44)
            .background(Impala.activeTint, in: RoundedRectangle(cornerRadius: Radius.md, style: .continuous))
            .contentShape(RoundedRectangle(cornerRadius: Radius.md, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    private func summaryCard(label: String, value: String, note: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.system(size: TextSize.xs)).foregroundStyle(Impala.text2)
            Text(value)
                .font(.system(size: TextSize.lg, weight: .semibold, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(Impala.text)
            Text(note)
                .font(.system(size: 11))
                .foregroundStyle(Impala.text2)
                .lineLimit(1)
        }
        .padding(Space.s3)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Impala.surface, in: RoundedRectangle(cornerRadius: Radius.md, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Radius.md, style: .continuous).stroke(Impala.edgeSoft, lineWidth: 1))
    }
}
