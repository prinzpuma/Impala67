import SwiftUI

/// Heft: eine Seite zum Zeichnen auf dem Arbeitsflächen-Hintergrund der PWA, oben rechts schwebende
/// Leisten (Liquid Glass): Farben der PWA-Palette sowie Blättern, Seitenübersicht und Anfügen. Weitere
/// Werkzeuge kommen aus dem Werkzeugpicker von PencilKit.
struct HeftScreen: View {
    @Environment(ImpalaStore.self) private var store
    let pageId: String
    @State private var pageIds: [String] = []
    /// Aktuelle Seite über ihre ID, damit sie beim Umsortieren und Löschen erhalten bleibt.
    @State private var currentId: String?
    /// Zählt hoch, wenn das Heft außerhalb des Canvas geändert wurde (anderes Gerät, Seitenübersicht).
    @State private var revision = 0
    /// Blätterrichtung für den Übergang (vor: von rechts, zurück: von links).
    @State private var forward = true
    @State private var color = HeftPalette.colors[0].css
    @State private var showPages = false
    @Namespace private var namespace

    private var index: Int { currentId.flatMap { pageIds.firstIndex(of: $0) } ?? 0 }

    var body: some View {
        ZStack(alignment: .topTrailing) {
            if let id = currentId, pageIds.contains(id) {
                HeftCanvas(core: store.core, pageId: pageId, heftPageId: id, revision: revision, color: color) { color = $0 }
                    .id(id)
                    .ignoresSafeArea(edges: .bottom)
                    .transition(.push(from: forward ? .trailing : .leading))
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            // In schmalen Fenstern (Split View) nur das Blättern; Farben dann über den Werkzeugpicker.
            ViewThatFits(in: .horizontal) {
                HStack(spacing: Space.s2) {
                    ColorBar(color: $color)
                    pageControls
                }
                pageControls
            }
            .padding(Space.s3)
        }
        .clipped()
        .sensoryFeedback(.selection, trigger: currentId)
        // Angezeigte Seite als Kontext für die KI (Seitenbild, `view_heft_page`).
        .onChange(of: currentId, initial: true) { HeftLastPage.index[pageId] = index }
        .background(Impala.bg0)
        .onAppear(perform: loadPages)
        .onChange(of: store.lastRemote) {
            guard store.remoteTouches(pageId) else { return }
            loadPages()
            revision += 1
        }
        .sheet(isPresented: $showPages) {
            HeftPagesSheet(
                pageId: pageId, pageIds: pageIds, currentId: currentId, revision: revision,
                onJump: jump, onAdd: addPage,
                onChanged: { loadPages(); revision += 1 }
            )
            .presentationSizing(.form)
            .navigationTransition(.zoom(sourceID: "heft-pages", in: namespace))
        }
    }

    private var pageControls: some View {
        PageControls(
            index: index, count: pageIds.count, namespace: namespace,
            onMove: move, onAdd: addPage, onPages: { showPages = true }
        )
    }

    private func loadPages() {
        let old = index
        pageIds = store.core.heftPageIds(pageId: pageId)
        if !(currentId.map { pageIds.contains($0) } ?? false) {
            currentId = pageIds.isEmpty ? nil : pageIds[min(old, pageIds.count - 1)]
        }
    }

    /// Neue Seite am Ende; ohne Wahl mit dem Papier der letzten Seite (wie PWA und Android).
    private func addPage(_ paper: HeftPaperKind?) {
        let last = pageIds.last.flatMap { try? store.core.heftPage(pageId: pageId, heftPageId: $0).paper }
        guard let id = try? store.core.heftAddPage(pageId: pageId, at: nil, paper: paper?.rawValue ?? last) else { return }
        loadPages()
        jump(id)
    }

    private func jump(_ id: String) {
        guard let to = pageIds.firstIndex(of: id) else { return }
        forward = to >= index
        withAnimation(.smooth(duration: 0.35)) { currentId = id }
    }

    private func move(_ by: Int) {
        let to = min(max(0, index + by), pageIds.count - 1)
        guard pageIds.indices.contains(to) else { return }
        jump(pageIds[to])
    }
}

/// Blättern wie die Seitenanzeige der PWA-Heftleiste: ‹ n / m ›, Seitenübersicht und „Seite hinzufügen“
/// (Tippen: Papier der letzten Seite, Halten: Papier wählen).
private struct PageControls: View {
    let index: Int
    let count: Int
    let namespace: Namespace.ID
    let onMove: (Int) -> Void
    let onAdd: (HeftPaperKind?) -> Void
    let onPages: () -> Void

    var body: some View {
        GlassEffectContainer {
            HStack(spacing: 2) {
                button("chevron-left", "Vorige Seite", enabled: index > 0) { onMove(-1) }
                Button(action: onPages) {
                    Text(count == 0 ? "–" : "\(index + 1) / \(count)")
                        .font(.system(size: TextSize.sm, weight: .medium).monospacedDigit())
                        .foregroundStyle(Impala.text)
                        .contentTransition(.numericText(value: Double(index)))
                        .animation(.snappy, value: index)
                        .frame(minWidth: 52, minHeight: 40)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .matchedTransitionSource(id: "heft-pages", in: namespace)
                .accessibilityLabel("Seitenübersicht")
                button("chevron-right", "Nächste Seite", enabled: index < count - 1) { onMove(1) }
                Menu {
                    ForEach(HeftPaperKind.allCases) { kind in
                        Button { onAdd(kind) } label: { Label(kind.label, systemImage: kind.symbol) }
                    }
                } label: {
                    Icon("plus", size: 16)
                        .foregroundStyle(Impala.text)
                        .frame(width: 40, height: 40)
                        .contentShape(Rectangle())
                } primaryAction: {
                    onAdd(nil)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Seite hinzufügen")
            }
            .padding(.horizontal, Space.s1)
            .frame(height: 44)
            .impalaGlass(interactive: true)
        }
    }

    private func button(_ icon: String, _ label: String, enabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Icon(icon, size: 16)
                .foregroundStyle(enabled ? Impala.text : Impala.text2.opacity(0.4))
                .frame(width: 40, height: 40)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .accessibilityLabel(label)
    }
}

/// Farben der PWA-Palette (heft-tools.js `COLORS`) als Punkte; die aktive gleitet mit einem Ring.
/// Antippen wählt die Farbe für Stift bzw. Marker (bei Radierer/Lasso: Stift).
private struct ColorBar: View {
    @Binding var color: String
    @Namespace private var ring

    var body: some View {
        HStack(spacing: 2) {
            ForEach(HeftPalette.colors, id: \.css) { c in
                Button {
                    withAnimation(.snappy) { color = c.css }
                } label: {
                    ZStack {
                        if color == c.css {
                            Circle()
                                .strokeBorder(Impala.text.opacity(0.55), lineWidth: 2)
                                .frame(width: 30, height: 30)
                                .matchedGeometryEffect(id: "ring", in: ring)
                        }
                        Circle()
                            .fill(Color(uiColor: UIColor(css: c.css)))
                            .frame(width: 20, height: 20)
                    }
                    .frame(width: 34, height: 40)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(c.name)
                .accessibilityAddTraits(color == c.css ? .isSelected : [])
            }
        }
        .padding(.horizontal, Space.s1)
        .frame(height: 44)
        .impalaGlass(interactive: true)
        .sensoryFeedback(.selection, trigger: color)
    }
}
