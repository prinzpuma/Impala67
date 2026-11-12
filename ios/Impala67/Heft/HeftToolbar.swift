import PencilKit
import SwiftUI

/// Werkzeug des Hefts (wie `tool` in web/heft.js). Lasso und Laser zeichnen nicht (HeftLasso.swift).
enum HeftTool: String, Codable {
    case pen, marker, eraser, lasso, laser
}

/// Stift-Favorit der PWA (`DEFAULT_PENS` in heft-tools.js): eigene Farbe und Dicke.
struct HeftPen: Codable, Equatable {
    var color: String
    var size: CGFloat
}

/// Was die Leinwand vom Werkzeug wissen muss (Vergleich, damit sie nur bei Änderungen umstellt).
struct HeftToolSetting: Equatable {
    var tool: HeftTool
    var color: String
    var size: CGFloat
    var eraserSize: CGFloat
    var onlyPen: Bool
    var ruler: Bool

    /// PencilKit-Werkzeug: Marker mit dreifacher Breite (wie `drawStroke` der PWA), Radierer mit
    /// Radius `eraserSize` in Seiteneinheiten (heft-input.js: Ringdurchmesser = 2 × eraserSize).
    var pkTool: any PKTool {
        switch tool {
        case .pen: return PKInkingTool(.pen, color: UIColor(css: color), width: size)
        case .marker: return PKInkingTool(.marker, color: UIColor(css: color), width: size * 3)
        case .eraser: return PKEraserTool(.vector, width: eraserSize * 2)
        case .lasso, .laser: return PKLassoTool()
        }
    }
}

/// Werkzeugwahl wie `heft-tools.js` und der Klick-Handler in heft.js: drei Stift-Favoriten, Marker,
/// Radierer, Lasso; erneutes Tippen auf das aktive Werkzeug öffnet Farbe und Dicke. Eine Wahl für alle
/// Hefte, gemerkt in den UserDefaults (wie `impala67HeftTools` im localStorage der PWA).
@MainActor @Observable
final class HeftTools {
    static let shared = HeftTools()

    static let sizes: [(label: String, value: CGFloat)] = [("Fein", 1.6), ("Mittel", 3), ("Breit", 5.5)]
    static let eraserSizes: [(label: String, value: CGFloat)] = [("Klein", 10), ("Mittel", 16), ("Groß", 30)]
    static let defaultPens = [
        HeftPen(color: HeftPalette.colors[0].css, size: 3),
        HeftPen(color: HeftPalette.colors[1].css, size: 3),
        HeftPen(color: HeftPalette.colors[2].css, size: 1.6),
    ]

    private(set) var tool: HeftTool = .pen
    private(set) var color = HeftPalette.colors[0].css
    private(set) var size: CGFloat = HeftPalette.size
    private(set) var eraserSize: CGFloat = 16
    private(set) var onlyPen = true
    private(set) var pens = HeftTools.defaultPens
    private(set) var penSlot = 0
    var ruler = false
    /// Optionen unter der Leiste offen (Farbe und Dicke bzw. Radierergröße).
    var expanded = false
    /// Leiste eingeklappt (`chromeMin` der PWA): nur aktuelles Werkzeug.
    var collapsed = false
    /// Werkzeug vor dem letzten Wechsel (Pencil: „Zum vorherigen Werkzeug“, Radierer umschalten).
    @ObservationIgnored private var previous: HeftTool = .pen

    private static let key = "impala.heft.tools.v2"

    private struct Saved: Codable {
        var color: String
        var size: CGFloat
        var onlyPen: Bool
        var eraserSize: CGFloat
        var pens: [HeftPen]
        var penSlot: Int
    }

    private init() {
        guard let data = UserDefaults.standard.data(forKey: Self.key),
              let s = try? JSONDecoder().decode(Saved.self, from: data) else { return }
        color = s.color
        size = s.size
        onlyPen = s.onlyPen
        eraserSize = s.eraserSize
        if s.pens.count == Self.defaultPens.count { pens = s.pens }
        penSlot = pens.indices.contains(s.penSlot) ? s.penSlot : 0
    }

    var setting: HeftToolSetting {
        HeftToolSetting(tool: tool, color: color, size: size, eraserSize: eraserSize, onlyPen: onlyPen, ruler: ruler)
    }

    /// Stift-Favorit wählen; erneuter Tipp auf den aktiven öffnet Farbe und Dicke.
    func pickPen(_ i: Int) {
        if tool == .pen && penSlot == i {
            expanded.toggle()
        } else {
            select(.pen)
            penSlot = i
            color = pens[i].color
            size = pens[i].size
            expanded = false
        }
        save()
    }

    func pick(_ t: HeftTool) {
        switch t {
        case .eraser:
            if tool == .eraser { expanded.toggle() } else { select(.eraser); expanded = true }
        case .pen, .marker:
            expanded = tool == t && !expanded
            select(t)
        case .lasso, .laser:
            select(t)
            expanded = false
        }
    }

    func setColor(_ c: String) {
        color = c
        if tool == .eraser { select(.pen); expanded = true }
        if tool == .pen { pens[penSlot] = HeftPen(color: color, size: size) }
        save()
    }

    func setSize(_ s: CGFloat) {
        size = s
        if tool == .pen { pens[penSlot] = HeftPen(color: color, size: size) }
        save()
    }

    func setEraserSize(_ s: CGFloat) {
        eraserSize = s
        save()
    }

    func toggleOnlyPen() {
        onlyPen.toggle()
        save()
    }

    /// Doppeltippen bzw. Drücken am Apple Pencil, so wie in den Pencil-Einstellungen gewählt.
    func pencil(_ action: UIPencilPreferredAction) {
        switch action {
        case .switchEraser:
            select(tool == .eraser ? previous : .eraser)
            expanded = false
        case .switchPrevious:
            select(previous)
            expanded = false
        case .showColorPalette, .showInkAttributes, .showContextualPalette:
            collapsed = false
            if tool == .lasso || tool == .laser { select(.pen) }
            expanded.toggle()
        default:
            break
        }
    }

    private func select(_ t: HeftTool) {
        guard t != tool else { return }
        previous = tool
        tool = t
    }

    private func save() {
        let s = Saved(color: color, size: size, onlyPen: onlyPen, eraserSize: eraserSize, pens: pens, penSlot: penSlot)
        if let data = try? JSONEncoder().encode(s) { UserDefaults.standard.set(data, forKey: Self.key) }
    }
}

/// Werkzeug-Pille der Heft-Ansicht (`heft-float`/`heft-pill` der PWA) in Liquid Glass, so hoch wie die
/// Leisten daneben (48 pt). Darunter bei Bedarf die Optionen (`heft-tray`).
struct HeftToolPill: View {
    let tools: HeftTools
    let link: HeftCanvasLink

    var body: some View {
        VStack(spacing: Space.s2) {
            GlassEffectContainer {
                HStack(spacing: 2) {
                    if tools.collapsed { mini } else { full }
                }
                .padding(.horizontal, Space.s1)
                .frame(height: 48)
                .impalaGlass(interactive: true)
            }
            if !tools.collapsed && tools.expanded && tools.tool != .lasso && tools.tool != .laser {
                tray.transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .animation(.snappy, value: tools.expanded)
        .animation(.snappy, value: tools.collapsed)
    }

    // MARK: Leiste

    @ViewBuilder private var full: some View {
        ForEach(tools.pens.indices, id: \.self) { i in
            let pen = tools.pens[i]
            let on = tools.tool == .pen && tools.penSlot == i
            ToolButton(active: on, label: "Stift \(i + 1)", action: { tools.pickPen(i) }) {
                PenGlyph(icon: "pen-tool", color: pen.color, size: pen.size)
            }
        }
        ToolButton(active: tools.tool == .marker, label: "Marker", action: { tools.pick(.marker) }) {
            Icon("marker", size: 18)
        }
        sep
        ToolButton(active: tools.tool == .eraser, label: "Radierer", action: { tools.pick(.eraser) }) {
            Icon("eraser", size: 18)
        }
        ToolButton(active: tools.tool == .lasso, label: "Lasso – Striche auswählen", action: { tools.pick(.lasso) }) {
            Icon("lasso", size: 18)
        }
        ToolButton(active: tools.tool == .laser, label: "Laserpointer – zeigen, ohne zu schreiben", action: { tools.pick(.laser) }) {
            Icon("laser", size: 18)
        }
        ToolButton(active: tools.ruler, label: "Lineal", action: { tools.ruler.toggle() }) {
            Image(systemName: "ruler").font(.system(size: 16))
        }
        sep
        ToolButton(active: false, label: "Rückgängig", action: { link.coordinator?.undo() }) {
            Icon("undo", size: 17)
        }
        .disabled(!link.canUndo)
        ToolButton(active: false, label: "Wiederholen", action: { link.coordinator?.redo() }) {
            Icon("redo", size: 17)
        }
        .disabled(!link.canRedo)
        sep
        ToolButton(active: false, label: "Leiste einklappen", action: { tools.collapsed = true }) {
            Icon("chevron-down", size: 15)
        }
    }

    /// Eingeklappt: aktuelles Werkzeug mit Farbe, Antippen klappt wieder aus.
    private var mini: some View {
        ToolButton(active: false, label: "Werkzeugleiste ausklappen", action: { tools.collapsed = false }) {
            HStack(spacing: 4) {
                switch tools.tool {
                case .pen, .marker:
                    PenGlyph(icon: tools.tool == .marker ? "marker" : "pen-tool", color: tools.color, size: tools.size)
                case .eraser: Icon("eraser", size: 18)
                case .lasso: Icon("lasso", size: 18)
                case .laser: Icon("laser", size: 18)
                }
                Icon("chevron-down", size: 11).foregroundStyle(Impala.text2)
            }
        }
    }

    private var sep: some View {
        Rectangle().fill(Impala.edgeSoft).frame(width: 1, height: 22).padding(.horizontal, 2)
    }

    // MARK: Optionen

    @ViewBuilder private var tray: some View {
        HStack(spacing: 2) {
            if tools.tool == .eraser {
                ForEach(HeftTools.eraserSizes, id: \.value) { z in
                    ToolButton(active: tools.eraserSize == z.value, label: "Radierer: \(z.label)",
                               action: { tools.setEraserSize(z.value) }) {
                        Capsule().fill(Impala.text).frame(width: 18, height: max(2, (z.value / 5).rounded()))
                    }
                }
            } else {
                ForEach(HeftTools.sizes, id: \.value) { s in
                    ToolButton(active: tools.size == s.value, label: "Strich: \(s.label)", action: { tools.setSize(s.value) }) {
                        Circle().fill(Color(uiColor: UIColor(css: tools.color))).frame(width: dot(s.value), height: dot(s.value))
                    }
                }
                sep
                ForEach(HeftPalette.colors, id: \.css) { c in
                    let on = tools.color == c.css
                    Button { tools.setColor(c.css) } label: {
                        Circle()
                            .fill(Color(uiColor: UIColor(css: c.css)))
                            .frame(width: 24, height: 24)
                            .padding(3)
                            .overlay(Circle().stroke(on ? Impala.accent : .clear, lineWidth: 2))
                            .frame(width: 36, height: 40)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(c.name)
                    .accessibilityAddTraits(on ? .isSelected : [])
                }
                sep
                ToolButton(active: tools.onlyPen, label: tools.onlyPen ? "Nur Stift zeichnet" : "Finger dürfen zeichnen",
                           action: { tools.toggleOnlyPen() }) {
                    Icon(tools.onlyPen ? "pen-tool" : "hand", size: 17)
                }
            }
        }
        .padding(.horizontal, Space.s1)
        .frame(height: 48)
        .impalaGlass(interactive: true)
    }

    /// Punktgröße für eine Strichbreite (wie `dotPx` der PWA, gut sichtbar).
    private func dot(_ size: CGFloat) -> CGFloat { min(18, 5 + size * 2) }
}

/// Knopf der Pille: 40 × 40, aktiv mit Akzent-Hintergrund wie `.heft-main.active`.
private struct ToolButton<Label: View>: View {
    let active: Bool
    let label: String
    let action: () -> Void
    @ViewBuilder let content: () -> Label
    @Environment(\.isEnabled) private var enabled

    var body: some View {
        Button(action: action) {
            content()
                .foregroundStyle(active ? Impala.accent : (enabled ? Impala.text : Impala.text2.opacity(0.35)))
                .frame(minWidth: 40, minHeight: 40)
                .background(active ? Impala.activeTint : .clear, in: Capsule())
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
        .accessibilityAddTraits(active ? .isSelected : [])
    }
}

/// Stift-Icon mit Farbpunkt in Strichdicke (`heft-penfav-dot`).
private struct PenGlyph: View {
    let icon: String
    let color: String
    let size: CGFloat

    var body: some View {
        Icon(icon, size: 18)
            .overlay(alignment: .bottomTrailing) {
                Circle()
                    .fill(Color(uiColor: UIColor(css: color)))
                    .frame(width: 4 + size * 1.2, height: 4 + size * 1.2)
                    .overlay(Circle().stroke(Impala.bg0, lineWidth: 1))
                    .offset(x: 4, y: 3)
            }
    }
}
