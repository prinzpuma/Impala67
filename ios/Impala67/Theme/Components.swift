import SwiftUI

/// Icon aus dem PWA-Sprite (`web/icons.svg`, erzeugt mit `npm run ios:icons`); färbt sich mit `foregroundStyle`.
struct Icon: View {
    let name: String
    var size: CGFloat = 16

    init(_ name: String, size: CGFloat = 16) {
        self.name = name
        self.size = size
    }

    var body: some View {
        Image("i-\(name)")
            .renderingMode(.template)
            .resizable()
            .scaledToFit()
            .frame(width: size, height: size)
            .accessibilityHidden(true)
    }
}

extension View {
    /// Liquid Glass für schwebende Bedienelemente (Leisten und Knöpfe über dem Inhalt) – die bewusste
    /// Abweichung vom flachen PWA-Look. Flächen wie Seitenleiste und Seiten bleiben wie in der PWA.
    func impalaGlass(interactive: Bool = false) -> some View { impalaGlass(in: Capsule(), tint: nil, interactive: interactive) }

    func impalaGlass(in shape: some Shape, interactive: Bool = false) -> some View { impalaGlass(in: shape, tint: nil, interactive: interactive) }

    @ViewBuilder
    func impalaGlass(in shape: some Shape, tint: Color? = nil, interactive: Bool = false) -> some View {
        if AppMotion.isReduced {
            background(tint?.opacity(0.18) ?? Impala.panel, in: shape)
                .overlay(shape.stroke(tint?.opacity(0.35) ?? Impala.edgeSoft, lineWidth: 1))
        } else {
            let base: Glass = interactive ? .regular.interactive() : .regular
            glassEffect(tint.map { base.tint($0) } ?? base, in: shape)
        }
    }

    /// Druck-Rückmeldung wie `scale(.97)` der PWA, mit Feder statt CSS-Kurve.
    func pressable() -> some View { buttonStyle(PressStyle()) }

    /// Auftritt wie `hv-in` der PWA (leicht von unten, gestaffelt nach `index`).
    func riseIn(_ index: Int = 0) -> some View { modifier(RiseIn(index: index)) }
}

private struct PressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .contentShape(Rectangle())
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(.snappy(duration: 0.18), value: configuration.isPressed)
    }
}

private struct RiseIn: ViewModifier {
    let index: Int
    @State private var shown = false
    @Environment(\.accessibilityReduceMotion) private var systemReduceMotion

    private var reduceMotion: Bool { systemReduceMotion || AppMotion.isReduced }

    func body(content: Content) -> some View {
        content
            .opacity(shown ? 1 : 0)
            .offset(y: shown || reduceMotion ? 0 : 10)
            .blur(radius: shown || reduceMotion ? 0 : 3)
            .onAppear {
                if reduceMotion {
                    shown = true
                } else {
                    withAnimation(.smooth(duration: 0.45).delay(Double(index) * 0.05)) { shown = true }
                }
            }
    }
}
