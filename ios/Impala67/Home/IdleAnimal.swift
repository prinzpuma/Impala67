import SwiftUI

/// Posen des Leerlauf-Tiers (lernzeit.js `POSES`), bei jeder Pause die nächste.
enum IdlePose: CaseIterable {
    case peek, sleep, side, badge
}

/// Leerlauf-Tier (`.lz-tier`, Zeichnung aus tools/lernzeit-tier.mjs): ein kleines Impala unten rechts, je Pause in einer
/// anderen Pose. Fängt keine Berührungen ab – jede Eingabe setzt die Lernzeit fort. Ist der KI-Knopf unten rechts
/// sichtbar (`avoidOrb`), weichen die Posen ihm aus; die Plakette zieht dann in den Knopf ein (`AiOrbButton`).
struct IdleAnimal: View {
    let pose: IdlePose
    let avoidOrb: Bool

    var body: some View {
        Group {
            switch pose {
            case .peek, .sleep:
                Image(pose == .sleep ? "lz-tier-schlaf" : "lz-tier").resizable().scaledToFit()
                    .frame(width: 72)
                    .frame(width: 72, height: 54, alignment: .top)
                    .clipped()
                    .overlay(alignment: .topTrailing) { if pose == .sleep { SleepZ().offset(x: 8, y: -10) } }
                    .padding(.trailing, avoidOrb ? 88 : 28)
                    .transition(.move(edge: .bottom))
            case .side:
                Image("lz-tier").resizable().scaledToFit()
                    .frame(width: 72)
                    .rotationEffect(.degrees(-62))
                    .offset(x: 14)
                    .padding(.bottom, avoidOrb ? 104 : 44)
                    .transition(.move(edge: .trailing))
            case .badge:
                TierBadge(size: 42)
                    .padding([.trailing, .bottom], 22)
                    .transition(.scale(scale: 0.2).combined(with: .opacity))
            }
        }
        .allowsHitTesting(false)
        .accessibilityLabel("Lernzeit pausiert – jede Eingabe setzt sie fort")
    }
}

/// Impala im Kreis mit kleinem Pausezeichen: eigene Plakette in der Ecke oder Inhalt des KI-Knopfs.
struct TierBadge: View {
    let size: CGFloat
    var glass = true

    var body: some View {
        Image("lz-tier").resizable().scaledToFit()
            .frame(width: size * 1.2)
            .offset(y: size * 0.12)
            .frame(width: size, height: size)
            .clipShape(Circle())
            .background { if glass { Color.clear.impalaGlass(in: Circle()) } }
            .overlay(alignment: .topLeading) {
                Icon("pause", size: 9)
                    .foregroundStyle(Impala.text2)
                    .frame(width: 18, height: 18)
                    .impalaGlass(in: Circle())
                    .offset(x: -6, y: -6)
            }
    }
}

/// Zwei aufsteigende „z“ beim dösenden Impala.
private struct SleepZ: View {
    var body: some View {
        TimelineView(.animation) { ctx in
            let t = ctx.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 2.4) / 2.4
            ZStack(alignment: .bottomLeading) {
                z(t, size: 13)
                z((t + 0.5).truncatingRemainder(dividingBy: 1), size: 11).offset(x: 10, y: -10)
            }
        }
    }

    private func z(_ t: Double, size: CGFloat) -> some View {
        Text("z")
            .font(.system(size: size, weight: .semibold))
            .foregroundStyle(Impala.text2)
            .opacity(t < 0.3 ? t / 0.3 : 1 - (t - 0.3) / 0.7)
            .offset(x: t * 10, y: -t * 20)
    }
}
