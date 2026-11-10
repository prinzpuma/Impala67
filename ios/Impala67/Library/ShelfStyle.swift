import SwiftUI
import UIKit

/// Farben und Maße der Bibliothek wie `web/css/shelf.css`: warmes Papier-Panel, Holzbretter,
/// Schulheft-Cover und Mappen. Die Werte sind die von der PWA gemischten Töne (`color-mix`).
enum Shelf {
    static let paper = dynamic(light: 0xF9F3EA, dark: 0x322D27)
    static let sheet = dynamic(light: 0xFCFAF6, dark: 0x46423D)
    static let woodTop = dynamic(light: 0xEAD9BD, dark: 0x7C6449)
    static let wood = dynamic(light: 0xCFB38B, dark: 0x54402D)
    static let ink = dynamic(light: 0x3C352B, dark: 0xE5DFD7)
    static let edge = Color(uiColor: UIColor { t in
        t.userInterfaceStyle == .dark ? UIColor(hex: 0xC9A77C, alpha: 0.16) : UIColor(hex: 0x967046, alpha: 0.14)
    })
    static let button = Color(uiColor: UIColor(hex: 0xA8754C))
    static let cream = Color(uiColor: UIColor(hex: 0xFBF7EE))
    static let labelInk = Color(uiColor: UIColor(hex: 0x2C2823))
    /// `--b-tint`, `--b-tint-2`: warme Tönung statt Akzentfarbe innerhalb des Panels.
    static var tint: Color { wood.opacity(0.16) }
    static var tint2: Color { wood.opacity(0.26) }

    static let ledge: CGFloat = 12

    private static func dynamic(light: UInt32, dark: UInt32) -> Color {
        Color(uiColor: UIColor { $0.userInterfaceStyle == .dark ? UIColor(hex: dark) : UIColor(hex: light) })
    }

    /// `color-mix(in srgb, a t, b)`.
    static func mix(_ a: UInt32, _ b: UInt32, _ t: Double) -> Color {
        func ch(_ v: UInt32, _ s: UInt32) -> Double { Double((v >> s) & 0xFF) / 255 }
        return Color(red: ch(a, 16) * t + ch(b, 16) * (1 - t),
                     green: ch(a, 8) * t + ch(b, 8) * (1 - t),
                     blue: ch(a, 0) * t + ch(b, 0) * (1 - t))
    }

    /// CSS `hsl()` (Farbton in Grad, Sättigung und Helligkeit 0…1).
    static func hsl(_ h: Double, _ s: Double, _ l: Double) -> Color {
        let c = (1 - abs(2 * l - 1)) * s
        let hp = (h.truncatingRemainder(dividingBy: 360) + 360).truncatingRemainder(dividingBy: 360) / 60
        let x = c * (1 - abs(hp.truncatingRemainder(dividingBy: 2) - 1))
        let (r, g, b): (Double, Double, Double) = switch Int(hp) {
        case 0: (c, x, 0)
        case 1: (x, c, 0)
        case 2: (0, c, x)
        case 3: (0, x, c)
        case 4: (x, 0, c)
        default: (c, 0, x)
        }
        let m = l - c / 2
        return Color(red: r + m, green: g + m, blue: b + m)
    }
}

/// Maße des Regals je Breite (`--gn-book-h`, `--gn-row-h`, Spalten `minmax(128px, 1fr)`; schmal wie `max-width: 600px`).
struct ShelfMetrics: Equatable {
    var book: CGFloat = 196
    var folder: CGFloat = 118
    var row: CGFloat = 266
    var rowGap: CGFloat = 24
    var gap: CGFloat = 26
    var columns = 1
    var cell: CGFloat = 128
    var narrow = false

    init(width: CGFloat = 0) {
        narrow = width > 0 && width < 600
        if narrow { book = 168; folder = 100; row = 236; rowGap = 20; gap = 16 }
        let minCell: CGFloat = narrow ? 104 : 128
        let avail = max(width, minCell)
        columns = max(1, Int((avail + gap) / (minCell + gap)))
        cell = (avail - gap * CGFloat(columns - 1)) / CGFloat(columns)
    }
}

// MARK: Heft-Cover

/// Je Heft eigenes Cover wie `coverLook` in web/library.js: die gewählte Farbe gibt die Farbfamilie vor,
/// die Heft-ID entscheidet über Farbton, Muster, Platz des Namensschilds und Gummiband.
struct CoverLook {
    let top: Color
    let bottom: Color
    let pattern: Int
    let label: Int
    let band: Bool

    private static let hues = ["sunset": 18, "ocean": 214, "forest": 128, "grape": 312]

    init(_ p: PageSummary) {
        let s = p.id.isEmpty ? p.title : p.id
        var h: UInt32 = 2166136261
        for c in s.utf16 { h = (h ^ UInt32(c)) &* 16777619 }
        let hue: Int, sat: Int, light: Int
        if p.cover == "mono" {
            hue = 30; sat = 5; light = 20 + Int((h >> 10) % 10)
        } else {
            hue = Self.hues[p.cover].map { $0 + Int(h % 37) - 18 } ?? Int(h % 360)
            sat = 30 + Int((h >> 6) % 16)
            light = 40 + Int((h >> 10) % 13)
        }
        top = Shelf.hsl(Double(hue), Double(sat) / 100, Double(light + 7) / 100)
        bottom = Shelf.hsl(Double(hue), Double(sat) / 100, Double(light - 7) / 100)
        pattern = Int((h >> 14) % 8)
        label = Int((h >> 18) % 3)
        band = (h >> 21) % 3 == 0
    }
}

/// Notizbuch im Schulheft-Stil wie `libCoverHtml`: Rücken, Cover mit Muster und Namensschild.
/// Ein eigenes Bild füllt das ganze Cover ohne Schild – das Bild ist dann das Gesicht des Hefts.
struct NotebookCover: View {
    let page: PageSummary
    var height: CGFloat = 196

    var body: some View {
        HStack(spacing: 0) {
            UnevenRoundedRectangle(topLeadingRadius: 5, bottomLeadingRadius: 5, bottomTrailingRadius: 0, topTrailingRadius: 0, style: .continuous)
                .fill(LinearGradient(stops: [
                    .init(color: Color(uiColor: UIColor(hex: 0x181614)), location: 0),
                    .init(color: Color(uiColor: UIColor(hex: 0x211E1A)), location: 0.7),
                    .init(color: Color(uiColor: UIColor(hex: 0x37332F)), location: 1),
                ], startPoint: .leading, endPoint: .trailing))
                .frame(width: 11)
            cover
        }
        .frame(height: height)
        .compositingGroup()
        .shadow(color: .black.opacity(0.22), radius: 6, y: 4)
    }

    private var shape: UnevenRoundedRectangle {
        UnevenRoundedRectangle(topLeadingRadius: 2, bottomLeadingRadius: 2, bottomTrailingRadius: 12, topTrailingRadius: 12, style: .continuous)
    }

    private var cover: some View {
        let look = CoverLook(page)
        return GeometryReader { g in
            let w = g.size.width
            ZStack(alignment: .topLeading) {
                LinearGradient(colors: [look.top, look.bottom], startPoint: UnitPoint(x: 0.68, y: 0), endPoint: UnitPoint(x: 0.32, y: 1))
                if let img = page.coverImg {
                    CoverImage(id: img)
                        .frame(width: w, height: g.size.height)
                        .clipped()
                    // Leichter Glanz, damit das Bild wie ein bedrucktes Cover wirkt.
                    LinearGradient(colors: [.white.opacity(0.18), .clear, .black.opacity(0.12)], startPoint: .topLeading, endPoint: .bottomTrailing)
                } else {
                    CoverPattern(kind: look.pattern)
                    if look.band {
                        LinearGradient(colors: [.black.opacity(0.34), .black.opacity(0.22)], startPoint: .leading, endPoint: .trailing)
                            .frame(width: 7)
                            .offset(x: w * 0.87 - 7)
                    }
                    let side = look.label == 2 ? 0.18 : 0.12
                    let top = [0.22, 0.62, 0.34][look.label]
                    CoverLabel(title: Self.short(page.title), corner: look.label == 2 ? 3 : 6)
                        .frame(width: w * (1 - 2 * side))
                        .offset(x: w * side, y: w * top)
                }
                // Steppnaht am Rücken
                Path { p in
                    p.move(to: CGPoint(x: 5.5, y: 0))
                    p.addLine(to: CGPoint(x: 5.5, y: g.size.height))
                }
                .stroke(.white.opacity(0.22), style: StrokeStyle(lineWidth: 1, dash: [3, 3]))
            }
        }
        .clipShape(shape)
        .overlay(shape.stroke(.black.opacity(0.14), lineWidth: 1))
    }

    static func short(_ title: String) -> String {
        let t = title.trimmingCharacters(in: .whitespaces)
        if t.isEmpty { return "Ohne Titel" }
        return t.count > 28 ? String(t.prefix(28)) + "…" : t
    }
}

/// Helles Namensschild mit zwei Linien (`.lib-cover-label`).
struct CoverLabel: View {
    let title: String
    var corner: CGFloat = 6

    var body: some View {
        VStack(spacing: 7) {
            Text(title)
                .font(.system(size: 12, weight: .heavy))
                .foregroundStyle(Shelf.labelInk)
                .multilineTextAlignment(.center)
                .lineLimit(2)
                .frame(maxWidth: .infinity)
            Rectangle().fill(Shelf.labelInk.opacity(0.28)).frame(height: 1)
            Rectangle().fill(Shelf.labelInk.opacity(0.28)).frame(height: 1)
        }
        .padding(.horizontal, 9)
        .padding(.top, 8)
        .padding(.bottom, 10)
        .background {
            ZStack {
                RoundedRectangle(cornerRadius: corner + 3, style: .continuous).fill(Shelf.cream)
                RoundedRectangle(cornerRadius: corner + 3, style: .continuous).strokeBorder(Shelf.labelInk.opacity(0.55), lineWidth: 1)
            }
            .padding(-3)
            .shadow(color: .black.opacity(0.28), radius: 4, y: 3)
        }
    }
}

/// Die acht Cover-Muster (`.lib-cover.pat-0…7` in library.css).
struct CoverPattern: View {
    let kind: Int

    var body: some View {
        Canvas { ctx, size in
            let w = size.width, h = size.height
            switch kind {
            case 1:
                Self.dots(ctx, size, step: CGSize(width: 13, height: 13), at: CGPoint(x: 0.5, y: 0.5), r: 1.8, .white.opacity(0.2))
            case 2:
                var p = Path()
                for x in stride(from: 0, to: w, by: 15) { p.addRect(CGRect(x: x, y: 0, width: 5, height: h)) }
                ctx.fill(p, with: .color(.white.opacity(0.1)))
            case 3:
                Self.stripes(ctx, size, angle: -45, band: 7, period: 16, .black.opacity(0.1))
            case 4:
                var p = Path()
                for x in stride(from: 0, to: w, by: 12) { p.addRect(CGRect(x: x, y: 0, width: 1, height: h)) }
                for y in stride(from: 0, to: h, by: 12) { p.addRect(CGRect(x: 0, y: y, width: w, height: 1)) }
                ctx.fill(p, with: .color(.white.opacity(0.1)))
            case 5:
                Self.dots(ctx, size, step: CGSize(width: 9, height: 11), at: CGPoint(x: 0.2, y: 0.3), r: 1.4, .white.opacity(0.22))
                Self.dots(ctx, size, step: CGSize(width: 13, height: 10), at: CGPoint(x: 0.7, y: 0.6), r: 1.7, .black.opacity(0.2))
            case 6:
                ctx.fill(Path(CGRect(x: 0, y: h * 0.66, width: w, height: h * 0.04)), with: .color(.black.opacity(0.2)))
                ctx.fill(Path(CGRect(x: 0, y: h * 0.70, width: w, height: h * 0.12)), with: .color(.white.opacity(0.16)))
                ctx.fill(Path(CGRect(x: 0, y: h * 0.82, width: w, height: h * 0.04)), with: .color(.black.opacity(0.2)))
            case 7:
                let r1 = hypot(w * 0.82, h * 0.88) * 0.38
                ctx.fill(Path(ellipseIn: CGRect(x: w * 0.82 - r1, y: h * 0.88 - r1, width: 2 * r1, height: 2 * r1)), with: .color(.white.opacity(0.17)))
                let r2 = hypot(w * 0.9, h * 1.04) * 0.30
                ctx.fill(Path(ellipseIn: CGRect(x: w * 0.1 - r2, y: h * 1.04 - r2, width: 2 * r2, height: 2 * r2)), with: .color(.black.opacity(0.14)))
            default:
                Self.stripes(ctx, size, angle: 45, band: 2, period: 5, .white.opacity(0.04))
            }
        }
        .allowsHitTesting(false)
    }

    private static func stripes(_ ctx: GraphicsContext, _ size: CGSize, angle: Double, band: CGFloat, period: CGFloat, _ color: Color) {
        var c = ctx
        c.translateBy(x: size.width / 2, y: size.height / 2)
        c.rotate(by: .degrees(angle))
        let r = hypot(size.width, size.height)
        var p = Path()
        for x in stride(from: -r, to: r, by: period) { p.addRect(CGRect(x: x, y: -r, width: band, height: 2 * r)) }
        c.fill(p, with: .color(color))
    }

    private static func dots(_ ctx: GraphicsContext, _ size: CGSize, step: CGSize, at: CGPoint, r: CGFloat, _ color: Color) {
        var p = Path()
        for y in stride(from: 0, to: size.height, by: step.height) {
            for x in stride(from: 0, to: size.width, by: step.width) {
                p.addEllipse(in: CGRect(x: x + step.width * at.x - r, y: y + step.height * at.y - r, width: 2 * r, height: 2 * r))
            }
        }
        ctx.fill(p, with: .color(color))
    }
}

// MARK: Eigenes Cover-Bild

/// Lädt ein Cover-Bild (`coverImg`, Blob `cover:…`) aus dem Kern, verkleinert es für die Anzeige und merkt es
/// sich. Blob-IDs ändern sich nie (neues Bild = neue ID), deshalb darf der Zwischenspeicher bleiben.
enum CoverImages {
    static let cache = NSCache<NSString, UIImage>()

    /// Auf höchstens `maxSide` Punkte verkleinern (Seitenverhältnis bleibt, Ausrichtung wird übernommen).
    static func resized(_ img: UIImage, maxSide: CGFloat) -> UIImage {
        let s = min(1, maxSide / max(img.size.width, img.size.height, 1))
        let size = CGSize(width: max(1, (img.size.width * s).rounded()), height: max(1, (img.size.height * s).rounded()))
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        return UIGraphicsImageRenderer(size: size, format: format).image { _ in img.draw(in: CGRect(origin: .zero, size: size)) }
    }

    /// Gewähltes Foto als JPEG für den Kern (höchstens 1600 px, damit der Sync klein bleibt).
    static func jpeg(_ data: Data) -> Data? {
        guard let img = UIImage(data: data) else { return nil }
        return resized(img, maxSide: 1600).jpegData(compressionQuality: 0.85)
    }
}

struct CoverImage: View {
    @Environment(ImpalaStore.self) private var store
    let id: String
    @State private var image: UIImage?

    init(id: String) {
        self.id = id
    }

    var body: some View {
        Group {
            if let shown = image ?? CoverImages.cache.object(forKey: id as NSString) {
                Image(uiImage: shown).resizable().scaledToFill()
            } else {
                Color.clear
            }
        }
        // Fehlt das Bild noch (Sync lädt es nach), bei jeder fremden Änderung erneut versuchen.
        .task(id: "\(id)|\(image == nil ? store.remoteRevision : -1)") {
            if image != nil { return }
            if let hit = CoverImages.cache.object(forKey: id as NSString) {
                image = hit
                return
            }
            let core = store.core, id = id
            let loaded = await Task.detached(priority: .utility) { () -> UIImage? in
                guard let file = attempt("file", { try core.file(id: id) }) ?? nil, let img = UIImage(data: file.bytes) else { return nil }
                return CoverImages.resized(img, maxSide: 640)
            }.value
            if let loaded {
                CoverImages.cache.setObject(loaded, forKey: id as NSString)
                image = loaded
            }
        }
    }
}

// MARK: Mappe, Brett, Deko

/// Ordner als Mappe mit Reiter, herausschauendem Blatt und kleinem Namensschild (`.gn-folder` in shelf.css).
struct FolderVisual: View {
    let tone: UInt32

    var body: some View {
        GeometryReader { g in
            let w = g.size.width, h = g.size.height
            let back = Shelf.mix(tone, 0x2A2016, 0.72)
            ZStack(alignment: .topLeading) {
                UnevenRoundedRectangle(topLeadingRadius: 6, bottomLeadingRadius: 8, bottomTrailingRadius: 8, topTrailingRadius: 10, style: .continuous)
                    .fill(back)
                    .frame(width: w, height: h - 14)
                    .offset(y: 14)
                UnevenRoundedRectangle(topLeadingRadius: 7, bottomLeadingRadius: 0, bottomTrailingRadius: 0, topTrailingRadius: 9, style: .continuous)
                    .fill(back)
                    .frame(width: w * 0.44, height: 22)
                    .offset(y: 4)
                Canvas { ctx, size in
                    ctx.fill(Path(CGRect(origin: .zero, size: size)), with: .color(Shelf.cream))
                    var lines = Path()
                    for y in stride(from: CGFloat(9), to: size.height, by: 10) { lines.addRect(CGRect(x: 0, y: y, width: size.width, height: 1)) }
                    ctx.fill(lines, with: .color(Shelf.labelInk.opacity(0.14)))
                }
                .clipShape(RoundedRectangle(cornerRadius: 3, style: .continuous))
                .frame(width: w * 0.8, height: max(0, h - 38))
                .rotationEffect(.degrees(-2.5))
                .shadow(color: .black.opacity(0.18), radius: 1.5, y: 1)
                .offset(x: w * 0.09, y: 20)
                ZStack {
                    UnevenRoundedRectangle(topLeadingRadius: 4, bottomLeadingRadius: 9, bottomTrailingRadius: 9, topTrailingRadius: 4, style: .continuous)
                        .fill(LinearGradient(colors: [Shelf.mix(tone, 0xFFFFFF, 0.86), Color(uiColor: UIColor(hex: tone))], startPoint: .top, endPoint: UnitPoint(x: 0.45, y: 1)))
                        .overlay(alignment: .top) { Rectangle().fill(.white.opacity(0.28)).frame(height: 1).padding(.horizontal, 4) }
                        .shadow(color: .black.opacity(0.12), radius: 1.5, y: -1)
                    VStack(spacing: 5) {
                        Rectangle().fill(Shelf.labelInk.opacity(0.25)).frame(height: 1)
                        Rectangle().fill(Shelf.labelInk.opacity(0.25)).frame(height: 1)
                    }
                    .padding(.horizontal, 5)
                    .frame(width: w * 0.42, height: 22)
                    .background {
                        ZStack {
                            RoundedRectangle(cornerRadius: 6, style: .continuous).fill(Shelf.cream)
                            RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(Shelf.labelInk.opacity(0.45), lineWidth: 1)
                        }
                        .padding(-2.5)
                        .shadow(color: .black.opacity(0.2), radius: 2.5, y: 2)
                    }
                }
                .frame(width: w, height: h * 0.64)
                .offset(y: h * 0.36)
            }
        }
        .compositingGroup()
        .shadow(color: .black.opacity(0.2), radius: 5, y: 3)
    }

    /// Farbton je Ordner wie `folderTone` (Hash über die ID, sechs Töne).
    static func tone(_ key: String) -> UInt32 {
        let tones: [UInt32] = [0x7F98B4, 0x8AAB90, 0xA493B3, 0xCFA970, 0xC48E84, 0x7D8186]
        var h: UInt32 = 0
        for c in key.utf16 { h = h &* 31 &+ UInt32(c) }
        return tones[Int(h % UInt32(tones.count))]
    }
}

/// Holzbrett unter jeder Regalzeile: heller Rand, Vorderkante, Schatten.
struct ShelfBoard: View {
    var body: some View {
        VStack(spacing: 0) {
            Shelf.woodTop.frame(height: 3)
            Shelf.wood.frame(height: Shelf.ledge - 3)
            LinearGradient(colors: [.black.opacity(0.13), .clear], startPoint: .top, endPoint: .bottom).frame(height: 9)
        }
        .allowsHitTesting(false)
    }
}

/// Deko am Ende des letzten Bretts: Topfpflanze oder Bücherstapel (Zeichnungen aus shelf.css, 80 × 100).
struct ShelfDeco: View {
    let books: Bool

    var body: some View {
        Canvas { ctx, size in
            var c = ctx
            let s = size.width / 80
            c.translateBy(x: 0, y: size.height - 100 * s)
            c.scaleBy(x: s, y: s)
            func fill(_ p: Path, _ hex: UInt32) { c.fill(p, with: .color(Color(uiColor: UIColor(hex: hex)))) }
            func rect(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat, _ r: CGFloat = 0) -> Path {
                Path(roundedRect: CGRect(x: x, y: y, width: w, height: h), cornerRadius: r)
            }
            if books {
                fill(rect(8, 84, 64, 16, 2.5), 0x7F98B4); fill(rect(60, 87, 12, 10), 0xFBF7EE)
                fill(rect(14, 69, 54, 15, 2.5), 0xC48E84); fill(rect(14, 72, 11, 9), 0xFBF7EE)
                fill(rect(11, 56, 52, 13, 2.5), 0xCFA970); fill(rect(52, 59, 11, 7), 0xFBF7EE)
                fill(Path(ellipseIn: CGRect(x: 26, y: 32, width: 24, height: 24)), 0xC98562)
                fill(Path { p in
                    p.move(to: CGPoint(x: 38, y: 32))
                    p.addCurve(to: CGPoint(x: 46, y: 16), control1: CGPoint(x: 36, y: 24), control2: CGPoint(x: 40, y: 18))
                    p.addCurve(to: CGPoint(x: 38, y: 32), control1: CGPoint(x: 45, y: 23), control2: CGPoint(x: 43, y: 28))
                }, 0x6F9A6A)
            } else {
                fill(Path { p in
                    p.move(to: CGPoint(x: 12, y: 30))
                    p.addCurve(to: CGPoint(x: 40, y: 66), control1: CGPoint(x: 14, y: 46), control2: CGPoint(x: 24, y: 58))
                    p.addCurve(to: CGPoint(x: 12, y: 30), control1: CGPoint(x: 38, y: 44), control2: CGPoint(x: 26, y: 34))
                }, 0x6F9A6A)
                fill(Path { p in
                    p.move(to: CGPoint(x: 40, y: 66))
                    p.addCurve(to: CGPoint(x: 68, y: 22), control1: CGPoint(x: 42, y: 40), control2: CGPoint(x: 54, y: 26))
                    p.addCurve(to: CGPoint(x: 40, y: 66), control1: CGPoint(x: 68, y: 42), control2: CGPoint(x: 56, y: 58))
                }, 0x85B07C)
                fill(Path { p in
                    p.move(to: CGPoint(x: 40, y: 68))
                    p.addCurve(to: CGPoint(x: 42, y: 12), control1: CGPoint(x: 36, y: 48), control2: CGPoint(x: 38, y: 28))
                    p.addCurve(to: CGPoint(x: 40, y: 68), control1: CGPoint(x: 50, y: 30), control2: CGPoint(x: 48, y: 52))
                }, 0x5D8A5C)
                fill(Path { p in
                    p.move(to: CGPoint(x: 25, y: 66))
                    p.addLine(to: CGPoint(x: 55, y: 66))
                    p.addLine(to: CGPoint(x: 51, y: 100))
                    p.addLine(to: CGPoint(x: 29, y: 100))
                    p.closeSubpath()
                }, 0xC98562)
                fill(rect(21, 60, 38, 9, 3), 0xD99A76)
            }
        }
        .shadow(color: .black.opacity(0.2), radius: 1, y: 2)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}
