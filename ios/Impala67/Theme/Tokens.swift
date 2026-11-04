import SwiftUI
import UIKit

/// Farben der PWA (web/css/variables.css, `body.light`), gleiche Werte wie `Tokens.kt` der Android-App.
/// Hell/Dunkel folgt dem System.
enum Impala {
    static let panel = dynamic(light: 0xFFFDFA, dark: 0x191919)
    static let bg0 = dynamic(light: 0xF2EFE9, dark: 0x05070D)
    static let text = dynamic(light: 0x292926, dark: 0xFFFFFF, darkAlpha: 0.92)
    static let text2 = dynamic(light: 0x5C5A54, dark: 0xFFFFFF, darkAlpha: 0.68)
    static let accent = dynamic(light: 0x2478C7, dark: 0x6B8CAE)
    static let danger = dynamic(light: 0xD84D43, dark: 0xE97366)
    static let edge = dynamic(light: 0xC9C1B2, dark: 0xFFFFFF, darkAlpha: 0.14)
    /// Heftpapier (in beiden Modi hell, wie in der PWA).
    static let paper = Color(uiColor: UIColor(hex: 0xFBF9F4))

    private static func dynamic(light: UInt32, dark: UInt32, darkAlpha: CGFloat = 1) -> Color {
        Color(uiColor: UIColor { traits in
            traits.userInterfaceStyle == .dark ? UIColor(hex: dark, alpha: darkAlpha) : UIColor(hex: light)
        })
    }
}

/// --space-*: 8-px-Raster mit Halbschritten.
enum Space {
    static let s1: CGFloat = 4
    static let s2: CGFloat = 8
    static let s3: CGFloat = 12
    static let s4: CGFloat = 16
    static let s6: CGFloat = 24
}

extension UIColor {
    convenience init(hex: UInt32, alpha: CGFloat = 1) {
        self.init(
            red: CGFloat((hex >> 16) & 0xFF) / 255,
            green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255,
            alpha: alpha
        )
    }

    /// CSS-Farbe aus dem Heft (`#rgb`, `#rrggbb`, `#rrggbbaa`); unbekannt → Schwarz.
    convenience init(css: String) {
        var s = css.trimmingCharacters(in: .whitespaces)
        if s.hasPrefix("#") { s.removeFirst() }
        if s.count == 3 { s = s.map { "\($0)\($0)" }.joined() }
        var alpha: CGFloat = 1
        if s.count == 8, let a = UInt32(s.suffix(2), radix: 16) {
            alpha = CGFloat(a) / 255
            s = String(s.prefix(6))
        }
        self.init(hex: UInt32(s, radix: 16) ?? 0, alpha: alpha)
    }

    /// `#rrggbb` für das Heft (Deckkraft regelt der Kern über das Werkzeug).
    var cssHex: String {
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        // Dynamische Farben (aus dem Werkzeug-Picker) im hellen Modus auflösen: das Papier ist hell.
        resolvedColor(with: UITraitCollection(userInterfaceStyle: .light)).getRed(&r, green: &g, blue: &b, alpha: &a)
        let v = (Int(round(r * 255)) << 16) | (Int(round(g * 255)) << 8) | Int(round(b * 255))
        return String(format: "#%06x", v)
    }
}
