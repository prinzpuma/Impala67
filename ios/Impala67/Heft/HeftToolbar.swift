import PencilKit
import SwiftUI

/// Werkzeuge der PWA-Heftleiste (heft-toolbar-ui.js): drei Stift-Favoriten, Marker, Radierer, Lasso.
enum HeftToolKind: String, Codable { case pen, marker, eraser, lasso }

struct HeftPen: Codable, Equatable {
    var color: String
    var size: Double
}

/// Werkzeugwahl der Heftleiste, gespeichert wie `impala67HeftTools` der PWA (heft-tools.js).
struct HeftToolPrefs: Codable, Equatable {
    var tool: HeftToolKind = .pen
    var pens: [HeftPen] = Self.defaultPens
    var penSlot = 0
    var markerColor = HeftPalette.colors[4].css
    var markerSize: Double = 3
    var eraserSize: Double = 16
    /// „Nur Stift zeichnet“ – Finger scrollen und zoomen nur.
    var onlyPen = true

    static let defaultPens = [HeftPen(color: "#1c1c1e", size: 3), HeftPen(color: "#2f6fed", size: 3), HeftPen(color: "#e0483e", size: 1.6)]
    /// `SIZES` und Radierer-Größen der PWA.
    static let sizes: [(label: String, value: Double)] = [("Fein", 1.6), ("Mittel", 3), ("Breit", 5.5)]
    static let eraserSizes: [(label: String, value: Double)] = [("Klein", 10), ("Mittel", 16), ("Groß", 30)]

    /// Farbe und Dicke des aktiven Schreibwerkzeugs (bei Radierer/Lasso: des gewählten Stifts).
    var color: String { tool == .marker ? markerColor : pens[penSlot].color }
    var size: Double { tool == .marker ? markerSize : pens[penSlot].size }

    mutating func setColor(_ css: String) {
        if tool == .marker { markerColor = css } else { pens[penSlot].color = css }
    }

    mutating func setSize(_ value: Double) {
        if tool == .marker { markerSize = value } else { pens[penSlot].size = value }
    }

    /// PencilKit-Werkzeug zur Wahl (Marker mit dreifacher Breite wie heft.js `drawStroke`).
    var pkTool: PKTool {
        switch tool {
        case .pen: return PKInkingTool(.pen, color: UIColor(css: pens[penSlot].color), width: CGFloat(pens[penSlot].size))
        case .marker: return PKInkingTool(.marker, color: UIColor(css: markerColor), width: CGFloat(markerSize * 3))
        case .eraser: return PKEraserTool(.vector, width: CGFloat(eraserSize))
        case .lasso: return PKLassoTool()
        }
    }

    private static let key = "impala67HeftTools"

    static func load() -> HeftToolPrefs {
        guard let data = UserDefaults.standard.data(forKey: key),
              var p = try? JSONDecoder().decode(HeftToolPrefs.self, from: data) else { return HeftToolPrefs() }
        if p.pens.count != defaultPens.count { p.pens = defaultPens }
        if !p.pens.indices.contains(p.penSlot) { p.penSlot = 0 }
        return p
    }

    func save() {
        if let data = try? JSONEncoder().encode(self) { UserDefaults.standard.set(data, forKey: Self.key) }
    }
}

/// Schwebende Werkzeugleiste wie `toolbarHtml` der PWA: erster Tipp wählt ein Werkzeug, ein zweiter Tipp
/// auf das aktive öffnet die Optionen (Dicke, Farbe, „Nur Stift“ bzw. Radierergröße). Eingeklappt bleibt
/// nur das aktive Schreibwerkzeug mit seiner Farbe.
struct HeftToolbar<ImageMenu: View>: View {
    @Binding var prefs: HeftToolPrefs
    @Binding var trayOpen: Bool
    @Binding var collapsed: Bool
    let imageActive: Bool
    let canUndo: Bool
    let canRedo: Bool
    let onUndo: () -> Void
    let onRedo: () -> Void
    @ViewBuilder let imageMenu: () -> ImageMenu

    var body: some View {
        if collapsed {
            Button {
                withAnimation(.snappy) { collapsed = false }
            } label: {
                HStack(spacing: 6) {
                    Icon(prefs.tool == .marker ? "marker" : "pen-tool", size: 18)
                    Circle().fill(Color(uiColor: UIColor(css: prefs.color))).frame(width: 10, height: 10)
                    Icon("chevron-down", size: 12)
                }
                .foregroundStyle(Impala.text)
                .padding(.horizontal, Space.s3)
                .frame(height: 44)
                .contentShape(Capsule())
            }
            .buttonStyle(.plain)
            .impalaGlass(interactive: true)
            .accessibilityLabel("Werkzeugleiste ausklappen")
        } else {
            GlassEffectContainer {
                HStack(spacing: 2) {
                    ForEach(prefs.pens.indices, id: \.self) { i in
                        let on = prefs.tool == .pen && prefs.penSlot == i
                        toolButton(on: on, label: "Stift \(i + 1)") { tap(.pen, slot: i) } content: {
                            VStack(spacing: 2) {
                                Icon("pen-tool", size: 18).foregroundStyle(Color(uiColor: UIColor(css: prefs.pens[i].color)))
                                Circle().fill(Color(uiColor: UIColor(css: prefs.pens[i].color)))
                                    .frame(width: dot(prefs.pens[i].size) * 0.6, height: dot(prefs.pens[i].size) * 0.6)
                            }
                        }
                    }
                    toolButton(on: prefs.tool == .marker, label: "Marker") { tap(.marker) } content: {
                        Icon("marker", size: 18).foregroundStyle(Color(uiColor: UIColor(css: prefs.markerColor)))
                    }
                    separator
                    toolButton(on: prefs.tool == .eraser, label: "Radierer") { tap(.eraser) } content: { Icon("eraser", size: 18) }
                    toolButton(on: prefs.tool == .lasso, label: "Lasso – Striche auswählen") { tap(.lasso) } content: { Icon("lasso", size: 18) }
                    separator
                    Menu { imageMenu() } label: {
                        Icon("image", size: 18)
                            .foregroundStyle(imageActive ? Impala.accent : Impala.text)
                            .frame(width: 40, height: 40)
                            .background(imageActive ? Impala.activeTint : .clear, in: Capsule())
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Bilder einfügen oder bearbeiten")
                    separator
                    plain("undo", "Rückgängig", enabled: canUndo, action: onUndo)
                    plain("redo", "Wiederholen", enabled: canRedo, action: onRedo)
                    separator
                    plain("chevron-down", "Leiste einklappen", enabled: true) {
                        withAnimation(.snappy) {
                            trayOpen = false
                            collapsed = true
                        }
                    }
                }
                .padding(.horizontal, Space.s1)
                .frame(height: 48)
                .impalaGlass(interactive: true)
            }
            .sensoryFeedback(.selection, trigger: prefs.tool)
        }
    }

    /// Erster Tipp wählt, zweiter Tipp auf das aktive Werkzeug öffnet bzw. schließt die Optionen.
    private func tap(_ tool: HeftToolKind, slot: Int? = nil) {
        withAnimation(.snappy) {
            if prefs.tool == tool && (slot == nil || prefs.penSlot == slot) {
                if tool != .lasso { trayOpen.toggle() }
            } else {
                prefs.tool = tool
                if let slot { prefs.penSlot = slot }
                trayOpen = false
            }
        }
    }

    private func toolButton(on: Bool, label: String, action: @escaping () -> Void,
                            @ViewBuilder content: () -> some View) -> some View {
        Button(action: action) {
            content()
                .foregroundStyle(on ? Impala.accent : Impala.text)
                .frame(width: 40, height: 40)
                .background(on ? Impala.activeTint : .clear, in: Capsule())
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    private func plain(_ icon: String, _ label: String, enabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Icon(icon, size: 18)
                .foregroundStyle(enabled ? Impala.text : Impala.text2.opacity(0.4))
                .frame(width: 40, height: 40)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .accessibilityLabel(label)
    }

    private var separator: some View {
        Rectangle().fill(Impala.edge).frame(width: 1, height: 22).padding(.horizontal, 2)
    }
}

/// Punktgröße einer Strichstärke wie `dotPx` in heft-toolbar-ui.js.
private func dot(_ size: Double) -> CGFloat { CGFloat(max(4, min(12, (2 + size * 1.6).rounded()))) }

/// Optionen unter der Leiste (`heft-tray` der PWA): Dicke, Farben und „Nur Stift“ bzw. Radierergröße.
struct HeftToolTray: View {
    @Binding var prefs: HeftToolPrefs
    @Namespace private var ring

    var body: some View {
        HStack(spacing: 2) {
            if prefs.tool == .eraser {
                ForEach(HeftToolPrefs.eraserSizes, id: \.value) { z in
                    option(on: prefs.eraserSize == z.value, label: "Radierer: \(z.label)") { prefs.eraserSize = z.value } content: {
                        Capsule().fill(Impala.text).frame(width: 18, height: CGFloat(max(2, (z.value / 5).rounded())))
                    }
                }
            } else {
                ForEach(HeftToolPrefs.sizes, id: \.value) { s in
                    option(on: prefs.size == s.value, label: "Strich: \(s.label)") { prefs.setSize(s.value) } content: {
                        Circle().fill(Color(uiColor: UIColor(css: prefs.color))).frame(width: dot(s.value), height: dot(s.value))
                    }
                }
                Rectangle().fill(Impala.edge).frame(width: 1, height: 22).padding(.horizontal, 4)
                ForEach(HeftPalette.colors, id: \.css) { c in
                    Button {
                        withAnimation(.snappy) { prefs.setColor(c.css) }
                    } label: {
                        ZStack {
                            if prefs.color == c.css {
                                Circle().strokeBorder(Impala.text.opacity(0.55), lineWidth: 2)
                                    .frame(width: 30, height: 30)
                                    .matchedGeometryEffect(id: "ring", in: ring)
                            }
                            Circle().fill(Color(uiColor: UIColor(css: c.css))).frame(width: 22, height: 22)
                        }
                        .frame(width: 34, height: 40)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(c.name)
                    .accessibilityAddTraits(prefs.color == c.css ? .isSelected : [])
                }
                Rectangle().fill(Impala.edge).frame(width: 1, height: 22).padding(.horizontal, 4)
                option(on: prefs.onlyPen, label: prefs.onlyPen ? "Nur Stift zeichnet" : "Finger dürfen zeichnen") {
                    prefs.onlyPen.toggle()
                } content: {
                    Icon(prefs.onlyPen ? "pen-tool" : "hand", size: 18)
                }
            }
        }
        .padding(.horizontal, Space.s1)
        .frame(height: 44)
        .impalaGlass(interactive: true)
        .sensoryFeedback(.selection, trigger: prefs)
        .transition(.move(edge: .top).combined(with: .opacity))
    }

    private func option(on: Bool, label: String, action: @escaping () -> Void, @ViewBuilder content: () -> some View) -> some View {
        Button(action: action) {
            content()
                .foregroundStyle(on ? Impala.accent : Impala.text)
                .frame(width: 36, height: 36)
                .background(on ? Impala.activeTint : .clear, in: Capsule())
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}
