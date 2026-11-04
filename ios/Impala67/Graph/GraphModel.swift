import SwiftUI

/// Wissensgraph der Seiten: Knoten sind aktive Seiten, Kanten kommen aus dem Kern (`pageLinks`: Seite
/// erwähnt den Titel einer anderen – die Regel der Rückverweise – bzw. Eltern → Unterseite). Die App
/// legt nur das Bild an: ein Kraftmodell wie d3-force (Abstoßung, Federn, Zug zur Mitte, Abkühlung),
/// das auf der Haupt-Queue Schritt für Schritt läuft, damit der Graph sichtbar „aufblüht“.
@MainActor @Observable
final class GraphModel {
    struct Node {
        let id: String
        let title: String
        let heft: Bool
        var p: CGPoint
        var v = CGVector.zero
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

    @ObservationIgnored private var alpha = 1.0
    @ObservationIgnored private var run: Task<Void, Never>?
    @ObservationIgnored private var linkCount: [Int] = []

    private static let charge = -70.0, distanceMax2 = 400.0 * 400.0
    private static let linkDistance = 46.0, childDistance = 34.0
    private static let gravity = 0.06, velocityKeep = 0.6, alphaDecay = 0.0228, alphaMin = 0.002

    /// Seiten und Verweise im Hintergrund lesen, dann das Layout starten.
    func load(core: ImpalaCore) {
        run?.cancel()
        loading = true
        settled = false
        let children = showChildren, isolated = showIsolated
        run = Task {
            let (pages, links) = await Task.detached { (core.recentPages(limit: 5000), core.pageLinks()) }.value
            guard !Task.isCancelled else { return }
            build(pages: pages, links: links, children: children, isolated: isolated)
            loading = false
            await simulate()
        }
    }

    func stop() { run?.cancel() }

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
        linkCount = nodes.map(\.degree)
        neighbors = Array(repeating: [], count: nodes.count)
        for e in edges { neighbors[e.a].insert(e.b); neighbors[e.b].insert(e.a) }
        alpha = 1
    }

    /// Ein Knoten wird gezogen: festhalten und das Modell wieder etwas anwärmen.
    func drag(_ i: Int, to p: CGPoint) {
        guard nodes.indices.contains(i) else { return }
        nodes[i].p = p
        nodes[i].v = .zero
        nodes[i].fixed = true
        reheat(0.3)
    }

    func release(_ i: Int) {
        guard nodes.indices.contains(i) else { return }
        nodes[i].fixed = false
    }

    private func reheat(_ to: Double) {
        let wasCold = alpha < Self.alphaMin
        alpha = max(alpha, to)
        if wasCold, run == nil || run?.isCancelled == true || settled {
            run = Task { await simulate() }
        }
    }

    private func simulate() async {
        settled = false
        while alpha >= Self.alphaMin, !Task.isCancelled {
            step()
            try? await Task.sleep(for: .milliseconds(16))
        }
        settled = true
    }

    /// Ein Schritt wie d3-force: manyBody (Abstoßung), link (Federn), x/y (Zug zur Mitte).
    private func step() {
        var n = nodes
        let count = n.count
        guard count > 0 else { alpha = 0; return }
        var px = n.map { Double($0.p.x) }, py = n.map { Double($0.p.y) }
        var vx = n.map { Double($0.v.dx) }, vy = n.map { Double($0.v.dy) }
        for i in 0..<count {
            for j in (i + 1)..<count {
                var dx = px[j] - px[i], dy = py[j] - py[i]
                var d2 = dx * dx + dy * dy
                if d2 > Self.distanceMax2 { continue }
                if d2 < 1 { dx = Double(i - j) * 0.01 + 0.5; dy = 0.5; d2 = 1 }
                let k = Self.charge * alpha / d2
                vx[i] += dx * k; vy[i] += dy * k
                vx[j] -= dx * k; vy[j] -= dy * k
            }
        }
        for e in edges {
            var dx = px[e.b] + vx[e.b] - px[e.a] - vx[e.a]
            var dy = py[e.b] + vy[e.b] - py[e.a] - vy[e.a]
            let l = max((dx * dx + dy * dy).squareRoot(), 0.01)
            let strength = 1 / Double(max(1, min(linkCount[e.a], linkCount[e.b])))
            let f = (l - (e.child ? Self.childDistance : Self.linkDistance)) / l * alpha * strength * 0.5
            dx *= f; dy *= f
            vx[e.b] -= dx; vy[e.b] -= dy
            vx[e.a] += dx; vy[e.a] += dy
        }
        for i in 0..<count {
            if n[i].fixed { n[i].v = .zero; continue }
            vx[i] = (vx[i] - px[i] * Self.gravity * alpha) * Self.velocityKeep
            vy[i] = (vy[i] - py[i] * Self.gravity * alpha) * Self.velocityKeep
            px[i] += vx[i]; py[i] += vy[i]
            n[i].p = CGPoint(x: px[i], y: py[i])
            n[i].v = CGVector(dx: vx[i], dy: vy[i])
        }
        nodes = n
        alpha += (0 - alpha) * Self.alphaDecay
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
