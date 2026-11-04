import SwiftUI

/// Heft: eine Seite zum Zeichnen auf dem Arbeitsflächen-Hintergrund der PWA, oben rechts eine schwebende
/// Leiste (Liquid Glass) zum Blättern und Anfügen. Werkzeuge kommen aus dem Werkzeugpicker von PencilKit.
struct HeftScreen: View {
    @Environment(ImpalaStore.self) private var store
    let pageId: String
    @State private var pageIds: [String] = []
    @State private var index = 0
    @State private var remoteRevision = 0
    /// Blätterrichtung für den Übergang (vor: von rechts, zurück: von links).
    @State private var forward = true

    var body: some View {
        ZStack(alignment: .topTrailing) {
            if pageIds.indices.contains(index) {
                HeftCanvas(core: store.core, pageId: pageId, heftPageId: pageIds[index], remoteRevision: remoteRevision)
                    .id(pageIds[index])
                    .ignoresSafeArea(edges: .bottom)
                    .transition(.push(from: forward ? .trailing : .leading))
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            PageControls(index: index, count: pageIds.count, onMove: move, onAdd: addPage)
                .padding(Space.s3)
        }
        .clipped()
        .sensoryFeedback(.selection, trigger: index)
        .background(Impala.bg0)
        .onAppear(perform: loadPages)
        .onChange(of: store.lastRemote) {
            guard store.remoteTouches(pageId) else { return }
            loadPages()
            remoteRevision += 1
        }
    }

    private func loadPages() {
        pageIds = store.core.heftPageIds(pageId: pageId)
        index = min(index, max(0, pageIds.count - 1))
    }

    private func addPage() {
        guard let id = try? store.core.heftAddPage(pageId: pageId, at: nil, paper: nil) else { return }
        loadPages()
        forward = true
        withAnimation(.smooth(duration: 0.35)) { index = pageIds.firstIndex(of: id) ?? index }
    }

    private func move(_ by: Int) {
        forward = by > 0
        withAnimation(.smooth(duration: 0.35)) { index = min(max(0, index + by), pageIds.count - 1) }
    }
}

/// Blättern wie die Seitenanzeige der PWA-Heftleiste: ‹ n / m › und „Seite hinzufügen“.
private struct PageControls: View {
    let index: Int
    let count: Int
    let onMove: (Int) -> Void
    let onAdd: () -> Void

    var body: some View {
        GlassEffectContainer {
            HStack(spacing: 2) {
                button("chevron-left", "Vorige Seite", enabled: index > 0) { onMove(-1) }
                Text(count == 0 ? "–" : "\(index + 1) / \(count)")
                    .font(.system(size: TextSize.sm, weight: .medium).monospacedDigit())
                    .foregroundStyle(Impala.text)
                    .contentTransition(.numericText(value: Double(index)))
                    .animation(.snappy, value: index)
                    .frame(minWidth: 52)
                button("chevron-right", "Nächste Seite", enabled: index < count - 1) { onMove(1) }
                button("plus", "Seite hinzufügen", enabled: true, action: onAdd)
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
