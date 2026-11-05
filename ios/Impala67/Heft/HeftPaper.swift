import UIKit

/// Zeichnen des Papiermusters unabhängig von UIKit-Views (für Background-Export und Vorschau).
enum HeftPaperDraw {
    static let ink = UIColor(hex: 0x2478C7)
    static let paper = UIColor(hex: 0xFBF9F4)

    /// Linien, Randlinie und Punkte des Musters in Seitenkoordinaten (`drawPaper` in heft.js).
    static func patterns(size: CGSize, paper: String) -> (lines: CGPath, margin: CGPath, dots: CGPath) {
        let (w, h) = (size.width, size.height)
        let gap: CGFloat = 28
        let l = CGMutablePath(), m = CGMutablePath(), d = CGMutablePath()
        switch paper {
        case "dots":
            var y: CGFloat = 40
            while y < h {
                var x: CGFloat = 40
                while x < w { d.addEllipse(in: CGRect(x: x - 1.2, y: y - 1.2, width: 2.4, height: 2.4)); x += gap }
                y += gap
            }
        case "lined", "grid":
            let lined = paper == "lined"
            let (x0, x1) = lined ? (CGFloat(90), w - 50) : (0, w)
            var y: CGFloat = lined ? 96 : gap
            while y < h - (lined ? 40 : 0) { l.move(to: CGPoint(x: x0, y: y)); l.addLine(to: CGPoint(x: x1, y: y)); y += gap }
            if !lined {
                var x = gap
                while x < w { l.move(to: CGPoint(x: x, y: 0)); l.addLine(to: CGPoint(x: x, y: h)); x += gap }
            } else {
                m.move(to: CGPoint(x: 90, y: 40)); m.addLine(to: CGPoint(x: 90, y: h - 40))
            }
        default: break
        }
        return (l, m, d)
    }

    /// Papier in einen Grafikkontext zeichnen (Vorschaubilder, Export), Seitenkoordinaten.
    static func draw(in ctx: CGContext, size: CGSize, paper: String, background: HeftBackground = .paper) {
        switch background {
        case .paper:
            ctx.setFillColor(Self.paper.cgColor)
            ctx.fill(CGRect(origin: .zero, size: size))
        case .white:
            ctx.setFillColor(UIColor.white.cgColor)
            ctx.fill(CGRect(origin: .zero, size: size))
        case .transparent:
            // Keine Hintergrundfüllung für transparenten Export
            break
        }
        let (l, m, d) = patterns(size: size, paper: paper)
        ctx.setLineWidth(1)
        ctx.setStrokeColor(ink.withAlphaComponent(0.22).cgColor)
        ctx.addPath(l); ctx.strokePath()
        ctx.setStrokeColor(ink.withAlphaComponent(0.4 * 0.22).cgColor)
        ctx.addPath(m); ctx.strokePath()
        ctx.setFillColor(ink.withAlphaComponent(0.35).cgColor)
        ctx.addPath(d); ctx.fillPath()
    }
}

/// Heftseite hinter den Strichen: Papierfläche mit Schatten und Muster wie `drawPaper` in web/heft.js
/// (Abstand 28; liniert ab y 96 mit Rand bei x 90, kariert, Punkte, leer). Linien in Akzentfarbe.
/// Vektor-Ebenen in Seitenkoordinaten, per Transform mit dem Zoom skaliert – bleibt scharf und braucht
/// keinen großen Bildspeicher.
final class HeftPaperView: UIView {
    private let sheet = CALayer()
    private let lines = CAShapeLayer()
    private let margin = CAShapeLayer()
    private let dots = CAShapeLayer()
    private var size = CGSize.zero
    private var kind = ""

    override init(frame: CGRect) {
        super.init(frame: frame)
        isUserInteractionEnabled = false
        backgroundColor = .clear
        layer.anchorPoint = .zero
        sheet.backgroundColor = HeftPaperDraw.paper.cgColor
        sheet.cornerRadius = 4
        sheet.shadowColor = UIColor.black.cgColor
        sheet.shadowOpacity = 0.12
        sheet.shadowRadius = 10
        sheet.shadowOffset = CGSize(width: 0, height: 3)
        lines.strokeColor = HeftPaperDraw.ink.withAlphaComponent(0.22).cgColor
        lines.fillColor = nil
        lines.lineWidth = 1
        margin.strokeColor = HeftPaperDraw.ink.withAlphaComponent(0.4 * 0.22).cgColor
        margin.fillColor = nil
        margin.lineWidth = 1
        dots.fillColor = HeftPaperDraw.ink.withAlphaComponent(0.35).cgColor
        for l in [sheet, lines, margin, dots] { layer.addSublayer(l) }
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError() }

    /// Muster für Seitengröße und Papierart setzen (`lined`, `grid`, `dots`, `blank`).
    func configure(size: CGSize, paper: String) {
        guard size != self.size || paper != kind else { return }
        self.size = size
        kind = paper
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        for l in [sheet, lines, margin, dots] { l.frame = CGRect(origin: .zero, size: size) }
        sheet.shadowPath = UIBezierPath(roundedRect: sheet.bounds, cornerRadius: 4).cgPath
        let (l, m, d) = HeftPaperDraw.patterns(size: size, paper: paper)
        lines.path = l
        margin.path = m
        dots.path = d
        CATransaction.commit()
        bounds = CGRect(origin: .zero, size: size)
    }

    /// Linien, Randlinie und Punkte des Musters in Seitenkoordinaten (`drawPaper` in heft.js).
    static func patterns(size: CGSize, paper: String) -> (lines: CGPath, margin: CGPath, dots: CGPath) {
        HeftPaperDraw.patterns(size: size, paper: paper)
    }

    /// Papier in einen Grafikkontext zeichnen (Vorschaubilder der Seitenübersicht), Seitenkoordinaten.
    static func draw(in ctx: CGContext, size: CGSize, paper: String, background: HeftBackground = .paper) {
        HeftPaperDraw.draw(in: ctx, size: size, paper: paper, background: background)
    }

    /// Dem Zoom des Canvas folgen (Ursprung oben links = Seitenursprung).
    func follow(zoom: CGFloat) {
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        transform = CGAffineTransform(scaleX: zoom, y: zoom)
        layer.position = .zero
        for l in [lines, margin, dots] { l.contentsScale = traitCollection.displayScale * zoom }
        CATransaction.commit()
    }
}

/// Papierarten des Kerns mit den Namen aus heft-tools.js (`PAPERS`).
enum HeftPaperKind: String, CaseIterable, Identifiable {
    case lined, grid, dots, blank

    var id: String { rawValue }

    var label: String {
        switch self {
        case .lined: "Liniert"
        case .grid: "Kariert"
        case .dots: "Punkte"
        case .blank: "Blanko"
        }
    }

    var symbol: String {
        switch self {
        case .lined: "line.3.horizontal"
        case .grid: "squareshape.split.3x3"
        case .dots: "circle.grid.3x3"
        case .blank: "square"
        }
    }
}

/// Farben und Standard-Dicke der PWA (heft-tools.js `COLORS`, `SIZES`; wie `HeftPalette` in Android).
enum HeftPalette {
    static let colors: [(css: String, name: String)] = [
        ("#1c1c1e", "Schwarz"), ("#2f6fed", "Blau"), ("#e0483e", "Rot"),
        ("#1f9d55", "Grün"), ("#f5b800", "Gelb"), ("#8b7cc8", "Lila"),
    ]
    /// „Mittel“; Marker zeichnen mit dreifacher Breite.
    static let size: CGFloat = 3
}
