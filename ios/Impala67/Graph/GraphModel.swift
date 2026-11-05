import SwiftUI

/// Wissensgraph der Seiten: Knoten sind aktive Seiten, Kanten kommen aus dem Kern (`pageLinks`: Seite
/// erwähnt den Titel einer anderen – die Regel der Rückverweise – bzw. Eltern → Unterseite). Die App
/// legt nur das Bild an: ein Kraftmodell wie d3-force (Abstoßung, Federn, Zug zur Mitte, Abkühlung),
/// das in einem Hintergrund-Task (`GraphLayout`) Schritt für Schritt läuft, damit der Graph sichtbar „aufblüht“.
@MainActor @Observable
final class GraphModel {
    struct Node {
        let id: String
        let title: String
        let heft: Bool
        var p: CGPoint
        var degree = 0
        var fixed = false
    }

    struct Edge {
        let a: Int
        let b: Int
        let child: Bool
    }

    private(set) var nodes: [Node] = []
    private(set) var edges: [Edge] = []
    /// Nachbarn je Knoten (Hervorheben beim Zeigen).
    private(set) var neighbors: [Set<Int>] = []
    private(set) var loading = true
    /// Abgekühlt: die Ansicht passt den Ausschnitt dann einmal ein.
    private(set) var settled = false
    var showChildren = true
    var showIsolated = false

    @ObservationIgnored private var layout: GraphLayout?
    @ObservationIgnored private var run: Task<Void, Never>?

    /// Seiten und Verweise im Hintergrund lesen, dann das Layout starten.
    func load(core: ImpalaCore) {
        run?.cancel()
        layout?.cancel()
        layout = nil
        loading = true
        settled = false
        let children = showChildren, isolated = showIsolated
        run = Task {
            let (pages, links) = await Task.detached { (core.recentPages(limit: 5000), core.pageLinks()) }.value
            guard !Task.isCancelled else { return }
            build(pages: pages, links: links, children: children, isolated: isolated)
            loading = false
            if let layout { await simulate(layout) }
        }
    }

    func stop() {
        run?.cancel()
        layout?.cancel()
    }

    private func build(pages: [PageSummary], links: [PageLink], children: Bool, isolated: Bool) {
        var index: [String: Int] = [:]
        for (i, p) in pages.enumerated() { index[p.id] = i }
        // Ungerichtet und je Paar einmal; ein echter Verweis schlägt „Unterseite“.
        var pairs: [Int: [Int: Bool]] = [:]
        for l in links where children || !l.child {
            guard let a = index[l.from], let b = index[l.to], a != b else { continue }
            let (lo, hi) = a < b ? (a, b) : (b, a)
            pairs[lo, default: [:]][hi] = (pairs[lo]?[hi] ?? true) && l.child
        }
        var degree = Array(repeating: 0, count: pages.count)
        for (a, m) in pairs { for b in m.keys { degree[a] += 1; degree[b] += 1 } }
        let keep = pages.indices.filter { isolated || degree[$0] > 0 }
        var remap: [Int: Int] = [:]
        for (k, i) in keep.enumerated() { remap[i] = k }
        // Startpositionen auf einer Sonnenblumen-Spirale (wie d3), gut verteilt und immer gleich.
        let golden = Double.pi * (3 - 5.0.squareRoot())
        nodes = keep.enumerated().map { k, i in
            let r = 10 * Double(k).squareRoot(), t = Double(k) * golden
            let p = pages[i]
            return Node(id: p.id, title: PageStyle.title(p), heft: p.kind == .heft, p: CGPoint(x: r * cos(t), y: r * sin(t)), degree: degree[i])
        }
        edges = pairs.flatMap { a, m in
            m.compactMap { b, child in remap[a].flatMap { ra in remap[b].map { Edge(a: ra, b: $0, child: child) } } }
        }
        neighbors = Array(repeating: [], count: nodes.count)
        for e in edges { neighbors[e.a].insert(e.b); neighbors[e.b].insert(e.a) }
        layout = GraphLayout(
            points: nodes.map(\.p), degree: nodes.map(\.degree),
            edges: edges.map { (a: $0.a, b: $0.b, child: $0.child) }
        )
    }

    /// Ein Knoten wird gezogen: festhalten und das Modell wieder etwas anwärmen.
    func drag(_ i: Int, to p: CGPoint) {
        guard nodes.indices.contains(i) else { return }
        nodes[i].p = p
        nodes[i].fixed = true
        // Der Hintergrund-Takt übernimmt die neue Lage; ist er abgekühlt, startet er hier neu.
        if let layout, layout.drag(i, to: p) {
            run = Task { await simulate(layout) }
        }
    }

    func release(_ i: Int) {
        guard nodes.indices.contains(i) else { return }
        nodes[i].fixed = false
        layout?.release(i)
    }

    /// Die Schritte rechnen abseits des Hauptthreads (eigener Task); zurück kommen nur Wert-Kopien der
    /// Positionen, höchstens etwa 30-mal pro Sekunde. Abbruch über `layout.cancel()`.
    private func simulate(_ layout: GraphLayout) async {
        settled = false
        await withTaskCancellationHandler {
            await Task.detached(priority: .userInitiated) { [self] in
                var last = ContinuousClock.now
                while layout.step() {
                    let now = ContinuousClock.now
                    if now - last >= .milliseconds(33) {
                        last = now
                        await apply(layout.snapshot(), from: layout)
                    }
                    try? await Task.sleep(for: .milliseconds(16))
                }
                await apply(layout.snapshot(), from: layout)
            }.value
        } onCancel: {
            layout.cancel()
        }
        if layout === self.layout, !layout.isRunning { settled = true }
    }

    /// Neue Positionen aus dem Hintergrund übernehmen; gezogene Knoten behalten ihre Lage unter dem Finger.
    private func apply(_ points: [CGPoint], from source: GraphLayout) {
        guard source === layout, points.count == nodes.count else { return }
        nodes.withUnsafeMutableBufferPointer { buf in
            for i in buf.indices where !buf[i].fixed { buf[i].p = points[i] }
        }
    }

    /// Umriss aller Knoten (Einpassen).
    var bounds: CGRect {
        guard let first = nodes.first else { return .zero }
        var r = CGRect(origin: first.p, size: .zero)
        for node in nodes { r = r.union(CGRect(origin: node.p, size: .zero)) }
        return r
    }

    static func radius(_ node: Node) -> CGFloat { 4 + CGFloat(Double(node.degree).squareRoot()) * 1.8 }
}

/// Das Kraftmodell wie d3-force (manyBody, link, x/y, Abkühlung) – läuft nur im Hintergrund. Die Abstoßung
/// prüft über ein Gitter (Zellen so groß wie die Reichweite) nur Nachbarzellen statt aller Paare; weiter
/// entfernte Knoten stoßen sich nicht mehr ab (Reichweite 200 statt vorher 400). Positionen etc. gehören
/// allein dem rechnenden Task; die Hauptseite meldet Ziehen, Loslassen und Abbruch nur über kurze Sperren.
final class GraphLayout: @unchecked Sendable {
    private static let charge = -70.0, reach = 200.0
    private static let linkDistance = 46.0, childDistance = 34.0
    private static let gravity = 0.06, velocityKeep = 0.6, alphaDecay = 0.0228, alphaMin = 0.002

    private struct Link {
        let a: Int, b: Int, rest: Double, strength: Double
    }

    // Nur vom rechnenden Task benutzt.
    private let count: Int
    private var px: [Double], py: [Double], vx: [Double], vy: [Double]
    private var fixed: [Bool]
    private var alpha = 1.0
    private let links: [Link]

    // Von beiden Seiten benutzt (unter `lock`).
    private let lock = NSLock()
    private var pendingMove: [Int: CGPoint] = [:]
    private var pendingRelease: Set<Int> = []
    private var heat = 0.0
    private var running = true
    private var cancelled = false

    init(points: [CGPoint], degree: [Int], edges: [(a: Int, b: Int, child: Bool)]) {
        count = points.count
        px = points.map { Double($0.x) }
        py = points.map { Double($0.y) }
        vx = Array(repeating: 0, count: count)
        vy = Array(repeating: 0, count: count)
        fixed = Array(repeating: false, count: count)
        links = edges.map { e in
            Link(
                a: e.a, b: e.b, rest: e.child ? Self.childDistance : Self.linkDistance,
                strength: 1 / Double(max(1, min(degree[e.a], degree[e.b])))
            )
        }
    }

    /// Läuft der Takt noch (oder ist er abgekühlt bzw. abgebrochen)?
    var isRunning: Bool {
        lock.lock(); defer { lock.unlock() }
        return running
    }

    func cancel() {
        lock.lock(); cancelled = true; lock.unlock()
    }

    /// Knoten festhalten und anwärmen. `true`, wenn der Takt schon abgekühlt war und neu gestartet werden muss.
    func drag(_ i: Int, to p: CGPoint) -> Bool {
        lock.lock(); defer { lock.unlock() }
        pendingMove[i] = p
        pendingRelease.remove(i)
        heat = max(heat, 0.3)
        if running || cancelled { return false }
        running = true
        return true
    }

    func release(_ i: Int) {
        lock.lock(); defer { lock.unlock() }
        pendingRelease.insert(i)
        pendingMove[i] = nil
    }

    /// Wert-Kopie der Positionen für die Anzeige.
    func snapshot() -> [CGPoint] {
        (0..<count).map { CGPoint(x: px[$0], y: py[$0]) }
    }

    /// Ein Schritt; `false`, sobald abgekühlt, abgebrochen oder leer (der Takt gilt dann als beendet).
    func step() -> Bool {
        lock.lock()
        if cancelled || count == 0 { running = false; lock.unlock(); return false }
        for (i, p) in pendingMove where i < count {
            px[i] = Double(p.x); py[i] = Double(p.y); vx[i] = 0; vy[i] = 0; fixed[i] = true
        }
        for i in pendingRelease where i < count { fixed[i] = false }
        pendingMove.removeAll()
        pendingRelease.removeAll()
        alpha = max(alpha, heat)
        heat = 0
        if alpha < Self.alphaMin { running = false; lock.unlock(); return false }
        lock.unlock()

        repel()
        for l in links {
            var dx = px[l.b] + vx[l.b] - px[l.a] - vx[l.a]
            var dy = py[l.b] + vy[l.b] - py[l.a] - vy[l.a]
            let d = max((dx * dx + dy * dy).squareRoot(), 0.01)
            let f = (d - l.rest) / d * alpha * l.strength * 0.5
            dx *= f; dy *= f
            vx[l.b] -= dx; vy[l.b] -= dy
            vx[l.a] += dx; vy[l.a] += dy
        }
        for i in 0..<count {
            if fixed[i] { vx[i] = 0; vy[i] = 0; continue }
            vx[i] = (vx[i] - px[i] * Self.gravity * alpha) * Self.velocityKeep
            vy[i] = (vy[i] - py[i] * Self.gravity * alpha) * Self.velocityKeep
            px[i] += vx[i]; py[i] += vy[i]
        }
        alpha += (0 - alpha) * Self.alphaDecay
        return true
    }

    /// Abstoßung (manyBody) über ein Gitter: je Knoten nur die 3×3 Zellen ringsum, jedes Paar einmal.
    private func repel() {
        var minX = px[0], maxX = px[0], minY = py[0], maxY = py[0]
        for i in 1..<max(count, 1) {
            minX = min(minX, px[i]); maxX = max(maxX, px[i])
            minY = min(minY, py[i]); maxY = max(maxY, py[i])
        }
        // Zellen nie kleiner als die Reichweite; bei weit gestreuten Knoten gröber, damit das Gitter klein bleibt.
        let cell = max(Self.reach, max(maxX - minX, maxY - minY) / 400)
        let cols = Int((maxX - minX) / cell) + 1, rows = Int((maxY - minY) / cell) + 1
        var cellOf = [Int](repeating: 0, count: count)
        var start = [Int](repeating: 0, count: cols * rows + 1)
        for i in 0..<count {
            let c = Int((py[i] - minY) / cell) * cols + Int((px[i] - minX) / cell)
            cellOf[i] = c
            start[c + 1] += 1
        }
        for c in 0..<(cols * rows) { start[c + 1] += start[c] }
        var fill = start
        var order = [Int](repeating: 0, count: count)
        for i in 0..<count {
            order[fill[cellOf[i]]] = i
            fill[cellOf[i]] += 1
        }
        let reach2 = Self.reach * Self.reach
        for i in 0..<count {
            let cx = cellOf[i] % cols, cy = cellOf[i] / cols
            for ny in max(cy - 1, 0)...min(cy + 1, rows - 1) {
                for nx in max(cx - 1, 0)...min(cx + 1, cols - 1) {
                    let c = ny * cols + nx
                    for s in start[c]..<start[c + 1] {
                        let j = order[s]
                        if j <= i { continue }
                        var dx = px[j] - px[i], dy = py[j] - py[i]
                        var d2 = dx * dx + dy * dy
                        if d2 > reach2 { continue }
                        if d2 < 1 { dx = Double(i - j) * 0.01 + 0.5; dy = 0.5; d2 = 1 }
                        let k = Self.charge * alpha / d2
                        vx[i] += dx * k; vy[i] += dy * k
                        vx[j] -= dx * k; vy[j] -= dy * k
                    }
                }
            }
        }
    }
}
