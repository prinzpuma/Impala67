import PhotosUI
import SwiftUI

/// Cover einer Notiz wie `.page-cover` der PWA (render.js, styles.css): Kopfbild über dem Titel – eines
/// der Muster (`cover`) oder ein eigenes Bild (`coverImg`, Blob `cover:…`). Das Icon ragt unten hinein.
struct NoteCover: View {
    let cover: String
    let coverImg: String?
    let onChange: () -> Void
    @State private var hovering = false

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            Group {
                if let coverImg {
                    CoverImage(id: coverImg)
                } else {
                    NoteCoverArt(name: cover)
                }
            }
            .frame(maxWidth: .infinity)
            .frame(height: 200)
            .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .strokeBorder(.white.opacity(0.08), lineWidth: 1)
            }
            .shadow(color: .black.opacity(0.18), radius: 14, y: 6)
            Button(action: onChange) {
                HStack(spacing: 6) {
                    Icon("image", size: 13)
                    Text("Cover ändern").font(.system(size: TextSize.xs, weight: .semibold))
                }
                .foregroundStyle(.white)
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(.black.opacity(0.45), in: Capsule())
            }
            .buttonStyle(.plain)
            .padding(10)
            .opacity(hovering ? 1 : 0.75)
        }
        .onHover { hovering = $0 }
        .contentShape(Rectangle())
        .onTapGesture(perform: onChange)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Cover")
        .accessibilityHint("Antippen, um das Cover zu ändern")
        .riseIn(0)
    }
}

/// Die Cover-Muster der PWA (`.cover-*` in styles.css), mit denselben Namen, damit alle Geräte dasselbe zeigen.
struct NoteCoverArt: View {
    let name: String

    static let presets = ["sunset", "ocean", "forest", "grape", "mono", "aurora", "karo", "linien", "punkte"]

    var body: some View {
        switch name {
        case "sunset", "ocean", "forest", "grape":
            let (c1, c2) = Self.pair(name)
            ZStack {
                LinearGradient(colors: [c1, c2], startPoint: UnitPoint(x: 0.2, y: 0), endPoint: UnitPoint(x: 0.8, y: 1))
                // Feine Stoffstreifen (repeating-linear-gradient 45°).
                Canvas { ctx, size in
                    var p = Path()
                    let step: CGFloat = 5
                    var x: CGFloat = -size.height
                    while x < size.width {
                        p.move(to: CGPoint(x: x, y: size.height))
                        p.addLine(to: CGPoint(x: x + size.height, y: 0))
                        x += step
                    }
                    ctx.stroke(p, with: .color(.white.opacity(0.035)), lineWidth: 2)
                }
            }
        case "aurora":
            ZStack {
                Color(red: 0.07, green: 0.08, blue: 0.11)
                Impala.accent.opacity(0.22)
                EllipticalGradient(colors: [Impala.accent, .clear], center: UnitPoint(x: 0.15, y: 0.2), endRadiusFraction: 0.62)
                EllipticalGradient(colors: [Color(red: 1, green: 0.56, blue: 0.69).opacity(0.8), .clear], center: UnitPoint(x: 0.82, y: 0.25), endRadiusFraction: 0.55)
                EllipticalGradient(colors: [Color(red: 0.37, green: 0.92, blue: 0.83).opacity(0.7), .clear], center: UnitPoint(x: 0.55, y: 1.1), endRadiusFraction: 0.65)
            }
            .blur(radius: 6)
        case "karo", "linien", "punkte":
            ZStack(alignment: .leading) {
                Color(red: 0.07, green: 0.09, blue: 0.13)
                Impala.accent.opacity(0.28)
                Canvas { ctx, size in
                    let ink = Color.white.opacity(name == "punkte" ? 0.16 : 0.09)
                    var p = Path()
                    switch name {
                    case "karo":
                        stride(from: CGFloat(0), through: size.width, by: 14).forEach { x in
                            p.move(to: CGPoint(x: x, y: 0)); p.addLine(to: CGPoint(x: x, y: size.height))
                        }
                        stride(from: CGFloat(0), through: size.height, by: 14).forEach { y in
                            p.move(to: CGPoint(x: 0, y: y)); p.addLine(to: CGPoint(x: size.width, y: y))
                        }
                        ctx.stroke(p, with: .color(ink), lineWidth: 1)
                    case "linien":
                        stride(from: CGFloat(17), through: size.height, by: 18).forEach { y in
                            p.move(to: CGPoint(x: 0, y: y)); p.addLine(to: CGPoint(x: size.width, y: y))
                        }
                        ctx.stroke(p, with: .color(ink), lineWidth: 1)
                    default:
                        for x in stride(from: CGFloat(7), through: size.width, by: 14) {
                            for y in stride(from: CGFloat(7), through: size.height, by: 14) {
                                p.addEllipse(in: CGRect(x: x - 1.2, y: y - 1.2, width: 2.4, height: 2.4))
                            }
                        }
                        ctx.fill(p, with: .color(ink))
                    }
                }
                // Heftrand links in der Akzentfarbe.
                Impala.accent.frame(width: 6)
            }
        default:
            // „mono“: dunkler Marmor-Karton mit feinen Sprenkeln.
            ZStack {
                Color(red: 0.12, green: 0.114, blue: 0.106)
                Canvas { ctx, size in
                    var rng = SplitMix(seed: 67)
                    for _ in 0..<Int(size.width * size.height / 90) {
                        let x = CGFloat(rng.next() % 10_000) / 10_000 * size.width
                        let y = CGFloat(rng.next() % 10_000) / 10_000 * size.height
                        let r = CGFloat(rng.next() % 100) / 100 * 0.9 + 0.4
                        ctx.fill(Path(ellipseIn: CGRect(x: x, y: y, width: r, height: r)), with: .color(.white.opacity(0.09)))
                    }
                }
                EllipticalGradient(colors: [.white.opacity(0.05), .clear], center: UnitPoint(x: 0.3, y: 0.7), endRadiusFraction: 0.4)
                EllipticalGradient(colors: [.white.opacity(0.045), .clear], center: UnitPoint(x: 0.75, y: 0.25), endRadiusFraction: 0.34)
            }
        }
    }

    /// Farben aus styles.css (`--c1`, `--c2`).
    static func pair(_ name: String) -> (Color, Color) {
        let hex: (UInt32, UInt32) = switch name {
        case "sunset": (0xC48467, 0x9D5A41)
        case "ocean": (0x4F6D93, 0x2F4668)
        case "forest": (0x8BA67C, 0x5D7A55)
        default: (0x9A6B8C, 0x6C4461)
        }
        return (Color(uiColor: UIColor(hex: hex.0)), Color(uiColor: UIColor(hex: hex.1)))
    }

    /// Kleiner fester Zufall, damit die Sprenkel bei jedem Zeichnen gleich liegen.
    private struct SplitMix {
        var state: UInt64
        init(seed: UInt64) { state = seed }
        mutating func next() -> UInt64 {
            state &+= 0x9E37_79B9_7F4A_7C15
            var z = state
            z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
            z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
            return z ^ (z >> 31)
        }
    }
}

/// Cover wählen wie `openCoverPicker` der PWA: Muster, eigenes Bild (lokal gespeichert und synchronisiert),
/// Entfernen.
struct NoteCoverSheet: View {
    let pageId: String
    let cover: String
    let coverImg: String?
    @Environment(ImpalaStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var photo: PhotosPickerItem?
    @State private var busy = false
    @State private var failed = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Space.s4) {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: Space.s3)], spacing: Space.s3) {
                        ForEach(NoteCoverArt.presets, id: \.self) { name in
                            let chosen = coverImg == nil && cover == name
                            Button { set(name) } label: {
                                NoteCoverArt(name: name)
                                    .frame(height: 76)
                                    .clipShape(RoundedRectangle(cornerRadius: Radius.md, style: .continuous))
                                    .overlay {
                                        RoundedRectangle(cornerRadius: Radius.md + 3, style: .continuous)
                                            .strokeBorder(chosen ? Impala.accent : .clear, lineWidth: 2.5)
                                            .padding(-4)
                                    }
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel(name)
                            .accessibilityAddTraits(chosen ? .isSelected : [])
                        }
                    }
                    Text("Oder ein eigenes Bild als Cover:")
                        .font(.system(size: TextSize.sm))
                        .foregroundStyle(Impala.text2)
                    HStack(spacing: Space.s3) {
                        PhotosPicker(selection: $photo, matching: .images) {
                            Label(coverImg == nil ? "Eigenes Bild wählen" : "Anderes Bild wählen", systemImage: "photo")
                        }
                        .buttonStyle(.glassProminent)
                        .disabled(busy)
                        if busy { ProgressView() }
                    }
                }
                .padding(Space.s4)
            }
            .navigationTitle("Cover")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Entfernen", role: .destructive) { set("") }
                        .disabled(cover.isEmpty && coverImg == nil)
                }
                ToolbarItem(placement: .confirmationAction) { Button("Fertig") { dismiss() } }
            }
            .onChange(of: photo) { _, item in
                guard let item else { return }
                Task { await useImage(item) }
            }
            .alert("Bild konnte nicht als Cover gesetzt werden.", isPresented: $failed) { Button("OK", role: .cancel) {} }
        }
        .presentationDetents([.medium, .large])
    }

    /// Muster wählen (leer = Cover entfernen); ein eigenes Bild entfällt dabei wie in der PWA.
    private func set(_ name: String) {
        store.core.patchPage(pageId, ["cover": name.isEmpty ? nil : name, "coverImg": nil])
        dismiss()
    }

    private func useImage(_ item: PhotosPickerItem) async {
        busy = true
        defer {
            busy = false
            photo = nil
        }
        guard let raw = try? await item.loadTransferable(type: Data.self),
              let data = await Task.detached(priority: .userInitiated, operation: { CoverImages.jpeg(raw) }).value,
              attempt("setCoverImage", { try store.core.setCoverImage(pageId: pageId, bytes: data, mime: "image/jpeg", name: "Cover.jpg") }) != nil
        else {
            failed = true
            return
        }
        dismiss()
    }
}
