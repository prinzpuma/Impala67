import PencilKit
import SwiftUI

/// Eine Heftseite mit PencilKit. Der Kern ist die einzige Quelle: Beim Öffnen und bei fremden Änderungen
/// wird die Zeichnung aus `heftPage` gebaut; jede Änderung am Canvas (Stift, Radierer, Lasso, Rückgängig)
/// wird mit dem letzten Stand verglichen und als Kern-Aufruf geschrieben – dieselben Events wie in der
/// PWA, damit der Sync unverändert bleibt.
struct HeftCanvas: UIViewRepresentable {
    let core: ImpalaCore
    let pageId: String
    let heftPageId: String
    /// Zählt hoch, wenn ein anderes Gerät dieses Heft geändert hat.
    let remoteRevision: Int

    func makeCoordinator() -> Coordinator { Coordinator(core: core, pageId: pageId, heftPageId: heftPageId) }

    func makeUIView(context: Context) -> PKCanvasView {
        let canvas = HeftCanvasView()
        canvas.delegate = context.coordinator
        canvas.drawingPolicy = .default
        // Papier ist in beiden Modi hell; sonst kehrt PencilKit die Farben im Dunkelmodus um.
        canvas.overrideUserInterfaceStyle = .light
        canvas.backgroundColor = UIColor(hex: 0xFBF9F4)
        canvas.isOpaque = true
        canvas.minimumZoomScale = 0.25
        canvas.maximumZoomScale = 5
        canvas.bouncesZoom = true
        context.coordinator.attach(canvas)
        canvas.onLayout = { [weak coordinator = context.coordinator] in coordinator?.fitWidth() }
        return canvas
    }

    func updateUIView(_ canvas: PKCanvasView, context: Context) {
        context.coordinator.reloadIfNeeded(remoteRevision)
    }

    static func dismantleUIView(_ canvas: PKCanvasView, coordinator: Coordinator) {
        coordinator.toolPicker.setVisible(false, forFirstResponder: canvas)
        coordinator.toolPicker.removeObserver(canvas)
    }

    @MainActor
    final class Coordinator: NSObject, PKCanvasViewDelegate {
        private let core: ImpalaCore
        private let pageId: String
        private let heftPageId: String
        private weak var canvas: PKCanvasView?
        private var pageSize = CGSize(width: 794, height: 1123)
        private var loadedRevision = -1
        private var applying = false
        private var fitted = false

        /// Bekannte Striche je PencilKit-Schlüssel (`randomSeed`): Kern-ID, Daten und Lage beim letzten Abgleich.
        private struct Known { var id: String; var data: HeftStroke; var transform: CGAffineTransform; var bounds: CGRect }
        private var known: [UInt32: Known] = [:]
        /// Gelöschte Striche, damit „Rückgängig“ nach dem Radieren die Originaldaten wiederherstellt.
        private var removed: [UInt32: HeftStroke] = [:]

        /// Werkzeuge wie in der PWA: Stift, Marker, Radierer (ganze Striche), Lasso, Lineal.
        let toolPicker = PKToolPicker(toolItems: [
            PKToolPickerInkingItem(type: .pen, color: UIColor(hex: 0x1F2937), width: 2.5),
            PKToolPickerInkingItem(type: .marker, color: UIColor(hex: 0xFACC15), width: 12),
            PKToolPickerEraserItem(type: .vector),
            PKToolPickerLassoItem(),
            PKToolPickerRulerItem(),
        ])

        init(core: ImpalaCore, pageId: String, heftPageId: String) {
            self.core = core
            self.pageId = pageId
            self.heftPageId = heftPageId
        }

        func attach(_ canvas: PKCanvasView) {
            self.canvas = canvas
            toolPicker.addObserver(canvas)
            toolPicker.setVisible(true, forFirstResponder: canvas)
            reloadIfNeeded(0)
            DispatchQueue.main.async { [weak self, weak canvas] in
                canvas?.becomeFirstResponder()
                self?.fitWidth()
            }
        }

        /// Seite aus dem Kern neu aufbauen (Öffnen, fremde Änderung).
        func reloadIfNeeded(_ revision: Int) {
            guard revision != loadedRevision, let canvas else { return }
            loadedRevision = revision
            guard let data = try? core.heftPage(pageId: pageId, heftPageId: heftPageId) else { return }
            pageSize = CGSize(width: data.width, height: data.height)
            var strokes: [PKStroke] = []
            known.removeAll()
            for s in data.strokes {
                let seed = HeftInk.seed(s.id)
                guard let pk = HeftInk.pkStroke(s, seed: seed) else { continue }
                strokes.append(pk)
                known[seed] = Known(id: s.id, data: s, transform: .identity, bounds: pk.renderBounds)
            }
            applying = true
            canvas.drawing = PKDrawing(strokes: strokes)
            applying = false
            canvas.contentSize = pageSize
            fitWidth()
        }

        /// Beim ersten Anzeigen die Seitenbreite einpassen.
        func fitWidth() {
            guard !fitted, let canvas, canvas.bounds.width > 0 else { return }
            fitted = true
            let scale = canvas.bounds.width / pageSize.width
            canvas.minimumZoomScale = min(scale, 1) * 0.5
            canvas.zoomScale = scale
        }

        func canvasViewDrawingDidChange(_ canvas: PKCanvasView) {
            guard !applying else { return }
            sync(canvas)
        }

        /// Vergleicht die Zeichnung mit dem letzten Stand und schreibt die Unterschiede in den Kern.
        private func sync(_ canvas: PKCanvasView) {
            let strokes = canvas.drawing.strokes
            var seen = Set<UInt32>()
            var moves: [String: (dx: Double, dy: Double, ids: [String])] = [:]
            var toRemove: [String] = []

            for stroke in strokes {
                let seed = stroke.randomSeed
                seen.insert(seed)
                if var k = known[seed] {
                    // Unverändert, verschoben (Lasso) oder anders geändert → neu schreiben.
                    let t = stroke.transform
                    let bounds = stroke.renderBounds
                    if t == k.transform && bounds == k.bounds { continue }
                    let rel = k.transform.inverted().concatenating(t)
                    let shifted = k.bounds.offsetBy(dx: bounds.minX - k.bounds.minX, dy: bounds.minY - k.bounds.minY)
                    if t != k.transform, rel.a == 1, rel.b == 0, rel.c == 0, rel.d == 1, shifted.size == bounds.size {
                        let key = "\(rel.tx)|\(rel.ty)"
                        moves[key, default: (dx: Double(rel.tx), dy: Double(rel.ty), ids: [])].ids.append(k.id)
                        k.transform = t
                        k.bounds = bounds
                        known[seed] = k
                    } else {
                        toRemove.append(k.id)
                        known[seed] = nil
                        addStroke(stroke, original: k.data)
                    }
                } else if let original = removed.removeValue(forKey: seed) {
                    addStroke(stroke, original: original)
                } else {
                    addStroke(stroke, original: nil)
                }
            }

            for (seed, k) in known where !seen.contains(seed) {
                toRemove.append(k.id)
                removed[seed] = k.data
                known[seed] = nil
            }
            if !toRemove.isEmpty {
                try? core.heftRemoveStrokes(pageId: pageId, heftPageId: heftPageId, ids: toRemove)
            }
            for move in moves.values {
                _ = try? core.heftMoveStrokes(pageId: pageId, heftPageId: heftPageId, ids: move.ids, dx: move.dx, dy: move.dy)
            }
        }

        /// Strich in den Kern schreiben. Mit `original` (Rückgängig, gedrehter/skalierter Strich) bleiben
        /// Werkzeug, Farbe und Breite erhalten; die Punkte kommen aus der aktuellen Lage.
        private func addStroke(_ stroke: PKStroke, original: HeftStroke?) {
            // Mit Original dessen Breite, damit der Druck aus den Punktbreiten richtig zurückgerechnet wird.
            let toolWidth = original.map { CGFloat($0.tool == "marker" ? $0.size * 3 : $0.size) }
                ?? (canvas?.tool as? PKInkingTool)?.width ?? 2.5
            var c = HeftInk.coreStroke(stroke, toolWidth: toolWidth)
            if let original {
                c.tool = original.tool == "shape" ? "pen" : original.tool
                c.color = original.color
                c.size = original.size
            }
            guard !c.points.isEmpty,
                  let id = try? core.heftAddStroke(pageId: pageId, heftPageId: heftPageId, tool: c.tool, color: c.color, size: c.size, points: c.points)
            else { return }
            known[stroke.randomSeed] = Known(
                id: id,
                data: HeftStroke(id: id, tool: c.tool, color: c.color, size: c.size, points: c.points, shape: nil),
                transform: stroke.transform,
                bounds: stroke.renderBounds
            )
        }
    }
}

/// Canvas, der nach jedem Layout die Seitenbreite einpassen lässt (erst dann ist die Breite bekannt).
final class HeftCanvasView: PKCanvasView {
    var onLayout: (() -> Void)?
    override func layoutSubviews() {
        super.layoutSubviews()
        onLayout?()
    }
}
