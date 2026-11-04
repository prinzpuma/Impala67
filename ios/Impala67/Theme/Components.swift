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
    /// Liquid Glass ab iOS 26 (schwebende Leisten und Knöpfe), davor dünnes Material – die einzige
    /// bewusste Abweichung vom flachen PWA-Look.
    func impalaGlass(interactive: Bool = false) -> some View { impalaGlass(in: Capsule(), interactive: interactive) }

    @ViewBuilder
    func impalaGlass(in shape: some Shape, interactive: Bool = false) -> some View {
        #if compiler(>=6.2)
        if #available(iOS 26.0, *) {
            glassEffect(interactive ? .regular.interactive() : .regular, in: shape)
        } else {
            background(.thinMaterial, in: shape)
        }
        #else
        background(.thinMaterial, in: shape)
        #endif
    }

    /// Druck-Rückmeldung wie `scale(.97)` der PWA.
    func pressable() -> some View { buttonStyle(PressStyle()) }
}

private struct PressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .contentShape(Rectangle())
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(.spring(duration: 0.2), value: configuration.isPressed)
    }
}
