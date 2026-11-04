import SwiftUI

/// „Diese Woche gelernt“ (`.hv-week`): Summe, Zielbalken, Tagesbalken Mo–So, Streak-Satz und „Ziel ändern“.
/// Die Balken wachsen beim ersten Zeigen gestaffelt mit einer Feder (`hv-grow-*`), danach folgen sie dem Wert.
struct WeekStat: View {
    /// Sekunden Mo–So.
    let week: [Int]
    let goalMin: Int
    let streak: Int
    let onCycleGoal: () -> Void
    @State private var grown = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var weekMin: Double { Double(week.reduce(0, +)) / 60 }
    private var pct: Int { min(100, Int((weekMin / Double(goalMin) * 100).rounded())) }

    var body: some View {
        let reached = pct >= 100
        VStack(alignment: .leading, spacing: Space.s1) {
            Text("Diese Woche gelernt").font(.system(size: TextSize.xs)).foregroundStyle(Impala.text2)
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
        .accessibilityElement(children: .combine)
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
