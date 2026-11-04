import SwiftUI

/// Wissensgraph (Fußleiste → Graph): Seiten als Punkte, Verweise als Linien, gezeichnet mit `Canvas`.
/// Zwei Finger zoomen um den Mittelpunkt der Finger, Ziehen verschiebt (auf einem Punkt: zieht den Punkt),
/// Antippen öffnet die Seite. Mit Trackpad hebt das Zeigen eine Seite samt Nachbarn hervor.
struct GraphView: View {
    @Environment(ImpalaStore.self) private var store
    @Environment(ShellModel.self) private var shell
    @Environment(\.dismiss) private var dismiss
    @State private var model = GraphModel()
    @State private var scale: CGFloat = 1
    @State private var offset: CGSize = .zero
    @State private var baseScale: CGFloat = 1
    @State private var baseOffset: CGSize = .zero
    @State private var size: CGSize = .zero
    @State private var hovered: Int?
    @State private var dragged: Int?
    @State private var moved = false
    @State private var panning = false
    @State private var zooming = false
    @State private var opened = 0

    var body: some View {
        ZStack {
            Impala.panel.ignoresSafeArea()
            if model.loading {
                ProgressView()
            } else if model.nodes.isEmpty {
                Placeholder(
                    icon: "graph", title: "Noch keine Verbindungen",
                    text: "Erwähne in einer Notiz den Titel einer anderen Seite (z. B. [[Titel]]) – dann erscheint hier eine Linie."
                )
            } else {
                canvas
                    .transition(.opacity)
            }
        }
        .overlay(alignment: .bottom) { if !model.nodes.isEmpty { footer } }
        .animation(.smooth, value: model.loading)
        .onGeometryChange(for: CGSize.self) { $0.size } action: { size = $0 }
        .onAppear { model.load(core: store.core) }
        .onDisappear { model.stop() }
        .onChange(of: model.settled) { _, done in if done && !moved { fit() } }
        .sensoryFeedback(.selection, trigger: opened)
        .navigationTitle("Wissensgraph")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                Button { moved = false; fit() } label: { Label("Einpassen", systemImage: "arrow.up.left.and.down.right.magnifyingglass") }
                Menu {
                    Toggle("Unterseiten verbinden", isOn: Binding(get: { model.showChildren }, set: { model.showChildren = $0; reload() }))
                    Toggle("Seiten ohne Verbindung", isOn: Binding(get: { model.showIsolated }, set: { model.showIsolated = $0; reload() }))
                } label: {
                    Label("Anzeige", systemImage: "line.3.horizontal.decrease")
                }
            }
        }
    }

    // MARK: Zeichnen

    private var canvas: some View {
        Canvas { ctx, canvasSize in
            let nodes = model.nodes
            let focus = hovered ?? dragged
            let near = focus.map { model.neighbors[$0] } ?? []
            let center = CGPoint(x: canvasSize.width / 2 + offset.width, y: canvasSize.height / 2 + offset.height)
            func screen(_ p: CGPoint) -> CGPoint { CGPoint(x: center.x + p.x * scale, y: center.y + p.y * scale) }

            // Linien: Verweise kräftiger, Unterseiten gestrichelt; beim Zeigen nur die eigenen betont.
            var links = Path(), childLinks = Path(), hot = Path()
            for e in model.edges {
                let a = screen(nodes[e.a].p), b = screen(nodes[e.b].p)
                if let focus, e.a == focus || e.b == focus {
                    hot.move(to: a); hot.addLine(to: b)
                } else if e.child {
                    childLinks.move(to: a); childLinks.addLine(to: b)
                } else {
                    links.move(to: a); links.addLine(to: b)
                }
            }
            let dim = focus == nil ? 1.0 : 0.35
            ctx.stroke(links, with: .color(Impala.text.opacity(0.22 * dim)), lineWidth: 1)
            ctx.stroke(childLinks, with: .color(Impala.text.opacity(0.14 * dim)), style: StrokeStyle(lineWidth: 1, dash: [3, 3]))
            ctx.stroke(hot, with: .color(Impala.accent.opacity(0.8)), lineWidth: 1.6)

            // Punkte: Notizen in Akzentfarbe, Hefte grün; Größe nach Zahl der Verbindungen.
            let r = max(0.6, min(scale, 1.6))
            for (i, n) in nodes.enumerated() {
                let p = screen(n.p)
                guard p.x > -40, p.y > -40, p.x < canvasSize.width + 40, p.y < canvasSize.height + 40 else { continue }
                let rad = GraphModel.radius(n) * r
                let lit = focus == nil || i == focus || near.contains(i)
                let color = n.heft ? Impala.success : Impala.accent
                let dot = Path(ellipseIn: CGRect(x: p.x - rad, y: p.y - rad, width: rad * 2, height: rad * 2))
                ctx.fill(dot, with: .color(color.opacity(lit ? 1 : 0.25)))
                if i == focus {
                    let ring = Path(ellipseIn: CGRect(x: p.x - rad - 3, y: p.y - rad - 3, width: rad * 2 + 6, height: rad * 2 + 6))
                    ctx.stroke(ring, with: .color(color.opacity(0.35)), lineWidth: 3)
                }
            }

            // Beschriftung: beim Zeigen die Seite und ihre Nachbarn, sonst die wichtigsten bzw. ab Zoom 1,3 alle.
            let labelled: [Int]
            if let focus {
                labelled = [focus] + near
            } else {
                let byDegree = nodes.indices.sorted { nodes[$0].degree > nodes[$1].degree }
                labelled = Array(byDegree.prefix(scale >= 1.3 ? 160 : scale >= 0.8 ? 40 : 12))
            }
            for i in labelled {
                let n = nodes[i]
                let p = screen(n.p)
                guard p.x > -80, p.y > -20, p.x < canvasSize.width + 80, p.y < canvasSize.height + 20 else { continue }
                let label = Text(String(n.title.prefix(32)))
                    .font(.system(size: i == focus ? 13 : 11, weight: i == focus ? .semibold : .regular))
                    .foregroundStyle(i == focus ? Impala.text : Impala.text2)
                ctx.draw(label, at: CGPoint(x: p.x, y: p.y + GraphModel.radius(n) * r + 3), anchor: .top)
            }
        }
        .contentShape(Rectangle())
        .gesture(pan.simultaneously(with: zoom))
        .onTapGesture(coordinateSpace: .local) { location in
            guard let i = hit(location) else { return }
            opened += 1
            shell.open(model.nodes[i].id)
            dismiss()
        }
        .onContinuousHover(coordinateSpace: .local) { phase in
            switch phase {
            case .active(let p): hovered = hit(p)
            case .ended: hovered = nil
            }
        }
        .accessibilityElement()
        .accessibilityLabel("Wissensgraph mit \(model.nodes.count) Seiten")
    }

    private var footer: some View {
        let name = (hovered ?? dragged).map { model.nodes[$0].title }
        return HStack(spacing: Space.s2) {
            Icon("graph", size: 14).foregroundStyle(Impala.accent)
            Text(name ?? "\(model.nodes.count) Seiten · \(model.edges.count) Verbindungen")
                .font(.system(size: TextSize.sm, weight: .medium))
                .foregroundStyle(Impala.text)
                .contentTransition(.numericText())
                .lineLimit(1)
        }
        .padding(.horizontal, Space.s4)
        .frame(minHeight: 40)
        .impalaGlass()
        .padding(.bottom, Space.s4)
        .animation(.smooth(duration: 0.2), value: name)
    }

    // MARK: Gesten

    private var pan: some Gesture {
        DragGesture(minimumDistance: 3)
            .onChanged { v in
                // Beim ersten Schritt entscheiden: auf einem Punkt zieht der Punkt, sonst die Fläche.
                if !panning {
                    panning = true
                    dragged = hit(v.startLocation)
                }
                guard !zooming else { return }
                moved = true
                if let i = dragged {
                    model.drag(i, to: world(v.location))
                } else {
                    offset = CGSize(width: baseOffset.width + v.translation.width, height: baseOffset.height + v.translation.height)
                }
            }
            .onEnded { _ in
                if let i = dragged { model.release(i) }
                dragged = nil
                panning = false
                baseOffset = offset
            }
    }

    private var zoom: some Gesture {
        MagnifyGesture()
            .onChanged { v in
                zooming = true
                moved = true
                let next = min(max(baseScale * v.magnification, 0.15), 5)
                // Punkt unter den Fingern bleibt stehen.
                let anchor = CGSize(width: v.startLocation.x - size.width / 2, height: v.startLocation.y - size.height / 2)
                let k = next / baseScale
                offset = CGSize(width: anchor.width - (anchor.width - baseOffset.width) * k,
                                height: anchor.height - (anchor.height - baseOffset.height) * k)
                scale = next
            }
            .onEnded { _ in
                zooming = false
                baseScale = scale
                baseOffset = offset
            }
    }

    private func world(_ p: CGPoint) -> CGPoint {
        CGPoint(x: (p.x - size.width / 2 - offset.width) / scale, y: (p.y - size.height / 2 - offset.height) / scale)
    }

    /// Nächster Punkt im Umkreis von 22 pt (Fingerbreite).
    private func hit(_ location: CGPoint) -> Int? {
        let w = world(location)
        var best: (Int, CGFloat)?
        for (i, n) in model.nodes.enumerated() {
            let d = hypot(n.p.x - w.x, n.p.y - w.y) * scale
            if d <= max(22, GraphModel.radius(n) * scale + 6), d < (best?.1 ?? .infinity) { best = (i, d) }
        }
        return best?.0
    }

    private func reload() {
        moved = false
        model.load(core: store.core)
    }

    /// Ausschnitt so wählen, dass alle Punkte passen; gleitet mit einer Feder dorthin.
    private func fit() {
        let b = model.bounds
        guard size.width > 0, size.height > 0, !model.nodes.isEmpty else { return }
        let target = min(min((size.width - 80) / max(b.width, 1), (size.height - 140) / max(b.height, 1)), 2.2)
        let goalScale = max(0.15, target)
        let goalOffset = CGSize(width: -b.midX * goalScale, height: -b.midY * goalScale)
        let from = (scale, offset)
        Task {
            // Canvas-Werte animieren nicht von selbst: kurze Ausgleichskurve über ~0,45 s.
            let steps = 27
            for s in 1...steps {
                let t = Double(s) / Double(steps)
                let e = CGFloat(1 - pow(1 - t, 3))
                scale = from.0 + (goalScale - from.0) * e
                offset = CGSize(width: from.1.width + (goalOffset.width - from.1.width) * e,
                                height: from.1.height + (goalOffset.height - from.1.height) * e)
                try? await Task.sleep(for: .milliseconds(16))
            }
            baseScale = scale
            baseOffset = offset
        }
    }
}
