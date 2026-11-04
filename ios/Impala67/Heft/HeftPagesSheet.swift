import SwiftUI

/// „1 Seite“ / „3 Seiten“ wie `plural` in heft-pages-ui.js.
func seitenZahl(_ n: Int) -> String { "\(n) " + (n == 1 ? "Seite" : "Seiten") }

/// Seitenübersicht des Hefts (heft-pages-ui.js, Android `HeftPagesSheet`/`HeftPagesGrid`): Raster mit
/// Vorschaubildern, die aktive Seite umrandet. Antippen springt zur Seite, Ziehen sortiert um
/// (`heftMovePage`), Halten öffnet Papier und Löschen, „Auswählen“ löscht mehrere Seiten auf einmal.
/// Am Ende „Neue Seite“ (Tippen: Papier der letzten Seite, Halten: Papier wählen).
struct HeftPagesSheet: View {
    @Environment(ImpalaStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let pageId: String
    let pageIds: [String]
    let currentId: String?
    /// Zählt bei jeder Änderung am Heft hoch, damit die Vorschauen neu zeichnen.
    let revision: Int
    let onJump: (String) -> Void
    let onAdd: (HeftPaperKind?) -> Void
    /// Nach Verschieben, Löschen oder Papierwechsel: Seitenliste neu lesen.
    let onChanged: () -> Void

    @State private var thumbs: [String: UIImage] = [:]
    @State private var picking = false
    @State private var selected: Set<String> = []
    @State private var deleting: [String] = []
    @State private var dropTarget: String?
    @Environment(\.displayScale) private var displayScale

    private static let tileWidth: CGFloat = 150

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: Self.tileWidth, maximum: 200), spacing: 18)], spacing: 14) {
                    ForEach(Array(pageIds.enumerated()), id: \.element) { i, id in
                        tile(id, index: i)
                    }
                    if !picking { addTile }
                }
                .padding(.horizontal, 22)
                .padding(.top, Space.s4)
                .padding(.bottom, 30)
                .animation(.smooth(duration: 0.3), value: pageIds)
            }
            .background(Impala.panel)
            .navigationTitle("Seiten")
            .navigationSubtitle(picking ? "\(selected.count) ausgewählt" : seitenZahl(pageIds.count))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    if picking {
                        Button(selected.count == pageIds.count ? "Keine" : "Alle") {
                            selected = selected.count == pageIds.count ? [] : Set(pageIds)
                        }
                    } else {
                        Button("Auswählen") { withAnimation(.snappy) { picking = true } }
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    if picking {
                        Button("Fertig") { endPicking() }
                    } else {
                        Button { dismiss() } label: { Icon("x", size: 15) }
                            .accessibilityLabel("Schließen")
                    }
                }
                if picking {
                    ToolbarItem(placement: .bottomBar) {
                        Button(role: .destructive) {
                            deleting = pageIds.filter { selected.contains($0) }
                        } label: {
                            Label("Löschen (\(selected.count))", systemImage: "trash")
                        }
                        // Mindestens eine Seite bleibt.
                        .disabled(selected.isEmpty || selected.count >= pageIds.count)
                    }
                }
            }
        }
        .sensoryFeedback(.selection, trigger: selected)
        .confirmationDialog(
            "Löschen",
            isPresented: Binding(get: { !deleting.isEmpty }, set: { if !$0 { deleting = [] } }),
            titleVisibility: .visible
        ) {
            Button("Löschen", role: .destructive) { remove(deleting) }
            Button("Abbrechen", role: .cancel) { deleting = [] }
        } message: {
            Text(deleting.count == 1 ? "Diese Seite wirklich löschen?" : "\(deleting.count) ausgewählte Seiten wirklich löschen?")
        }
    }

    // MARK: Kacheln

    private func tile(_ id: String, index: Int) -> some View {
        let highlighted = picking ? selected.contains(id) : id == currentId
        return Button {
            if picking {
                if selected.contains(id) { selected.remove(id) } else { selected.insert(id) }
            } else {
                onJump(id)
                dismiss()
            }
        } label: {
            VStack(spacing: 6) {
                thumbnail(id, highlighted: highlighted)
                // Seitenzahl als Kapsel; aktiv getönt.
                Text("\(index + 1)")
                    .font(.system(size: TextSize.xs, weight: .semibold).monospacedDigit())
                    .foregroundStyle(highlighted && !picking ? Impala.text : Impala.text2)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 1)
                    .background(highlighted && !picking ? Impala.activeTint : .clear, in: Capsule())
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Seite \(index + 1)")
        .task(id: "\(id)|\(revision)") {
            await Task.yield()
            if let img = HeftThumbnail.render(core: store.core, pageId: pageId, heftPageId: id, width: Self.tileWidth, scale: displayScale) {
                thumbs[id] = img
            }
        }
        .draggable(id) {
            thumbnail(id, highlighted: false).frame(width: 110)
        }
        .dropDestination(for: String.self) { items, _ in
            dropTarget = nil
            guard let from = items.first, from != id, pageIds.contains(from) else { return false }
            move(from, to: index)
            return true
        } isTargeted: { on in
            if on { dropTarget = id } else if dropTarget == id { dropTarget = nil }
        }
        .contextMenu { if !picking { menu(id) } }
    }

    private func thumbnail(_ id: String, highlighted: Bool) -> some View {
        let shape = RoundedRectangle(cornerRadius: Radius.xs)
        return Impala.paper
            .aspectRatio(thumbs[id].map { $0.size.width / $0.size.height } ?? 1000.0 / 1414.0, contentMode: .fit)
            .overlay {
                if let img = thumbs[id] {
                    Image(uiImage: img).resizable().transition(.opacity)
                }
            }
            .clipShape(shape)
            .overlay(shape.strokeBorder(.black.opacity(0.14), lineWidth: 1))
            .shadow(color: .black.opacity(0.18), radius: 6, y: 2)
            .padding(4)
            .overlay {
                // Aktive Seite: Akzentrahmen außen; Ziel beim Ziehen: gestrichelt.
                let ring = RoundedRectangle(cornerRadius: Radius.xs + 4)
                if dropTarget == id {
                    ring.strokeBorder(Impala.accent, style: StrokeStyle(lineWidth: 2, dash: [6, 4]))
                } else if highlighted {
                    ring.strokeBorder(Impala.accent, lineWidth: 2)
                }
            }
            .overlay(alignment: .topTrailing) {
                if picking && selected.contains(id) {
                    Icon("check", size: 14)
                        .foregroundStyle(.white)
                        .frame(width: 26, height: 26)
                        .background(Impala.accent, in: Circle())
                        .padding(10)
                        .transition(.scale.combined(with: .opacity))
                }
            }
            .animation(.snappy, value: dropTarget)
            .animation(.snappy, value: highlighted)
    }

    @ViewBuilder
    private func menu(_ id: String) -> some View {
        let paper = (try? store.core.heftPage(pageId: pageId, heftPageId: id).paper) ?? ""
        Menu {
            ForEach(HeftPaperKind.allCases) { kind in
                Button {
                    _ = try? store.core.heftSetPaper(pageId: pageId, heftPageId: id, paper: kind.rawValue)
                    onChanged()
                } label: {
                    Label(kind.label, systemImage: kind.rawValue == paper ? "checkmark" : kind.symbol)
                }
            }
        } label: {
            Label("Papier", systemImage: "doc.richtext")
        }
        Divider()
        Button(role: .destructive) { deleting = [id] } label: { Label("Löschen", systemImage: "trash") }
            .disabled(pageIds.count <= 1)
    }

    /// `.heft-pop-add`: getönte Fläche im Seitenformat, „+“ im Kreis, darunter „Neue Seite“.
    private var addTile: some View {
        Menu {
            ForEach(HeftPaperKind.allCases) { kind in
                Button { add(kind) } label: { Label(kind.label, systemImage: kind.symbol) }
            }
        } label: {
            VStack(spacing: 6) {
                VStack(spacing: Space.s2) {
                    Icon("plus", size: 20)
                        .foregroundStyle(Impala.text2)
                        .frame(width: 40, height: 40)
                        .background(Impala.activeTint, in: Circle())
                    Text("Neue Seite")
                        .font(.system(size: TextSize.xs, weight: .semibold))
                        .foregroundStyle(Impala.text2)
                }
                .frame(maxWidth: .infinity)
                .aspectRatio(1000.0 / 1414.0, contentMode: .fit)
                .background(Impala.surface, in: RoundedRectangle(cornerRadius: Radius.xs))
                .padding(4)
                Text(" ").font(.system(size: TextSize.xs))
            }
        } primaryAction: {
            add(nil)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Neue Seite")
    }

    // MARK: Aktionen

    private func add(_ paper: HeftPaperKind?) {
        onAdd(paper)
    }

    private func move(_ id: String, to index: Int) {
        _ = try? store.core.heftMovePage(pageId: pageId, heftPageId: id, to: UInt32(index))
        onChanged()
    }

    private func remove(_ ids: [String]) {
        // Die Oberfläche lässt mindestens eine Seite übrig; lehnt der Kern ab, bleibt der Rest.
        for id in ids {
            do { try store.core.heftRemovePage(pageId: pageId, heftPageId: id) } catch { break }
            thumbs[id] = nil
        }
        deleting = []
        endPicking()
        onChanged()
    }

    private func endPicking() {
        withAnimation(.snappy) {
            picking = false
            selected = []
        }
    }
}
