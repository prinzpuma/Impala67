import PencilKit
import SwiftUI
import UIKit.UIGestureRecognizerSubclass

/// Eine Heftseite mit PencilKit. Der Kern ist die einzige Quelle: Beim Öffnen und bei fremden Änderungen
/// wird die Zeichnung aus `heftPage` gebaut; jede Änderung am Canvas (Stift, Radierer, Lasso, Rückgängig)
/// wird mit dem letzten Stand verglichen und als Kern-Aufruf geschrieben – dieselben Events wie in der
/// PWA, damit der Sync unverändert bleibt. Bilder und Textfelder zeigt `HeftObjectsView` unter bzw. über
/// den Strichen; gerade Linien, Rechtecke, Kreise usw. erkennt der Kern nach kurzem Halten am Strichende.
struct HeftCanvas: UIViewRepresentable {
    let core: ImpalaCore
    let pageId: String
    let heftPageId: String
    /// Zählt hoch, wenn das Heft außerhalb des Canvas geändert wurde (anderes Gerät, Seitenübersicht).
    let revision: Int
    /// Farbe aus der Palette (`#rrggbb`); [onColor] meldet Farbwechsel im Werkzeugpicker zurück.
    let color: String
    let onColor: (String) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(core: core, pageId: pageId, heftPageId: heftPageId) }

    func makeUIView(context: Context) -> PKCanvasView {
        let canvas = HeftCanvasView()
        canvas.delegate = context.coordinator
        canvas.drawingPolicy = .default
        // Papier ist in beiden Modi hell; sonst kehrt PencilKit die Farben im Dunkelmodus um.
        canvas.overrideUserInterfaceStyle = .light
        canvas.isOpaque = true
        canvas.minimumZoomScale = 0.25
        canvas.maximumZoomScale = 5
        canvas.bouncesZoom = true
        context.coordinator.attach(canvas)
        canvas.onLayout = { [weak coordinator = context.coordinator] in coordinator?.fitWidth() }
        return canvas
    }

    func updateUIView(_ canvas: PKCanvasView, context: Context) {
        // Arbeitsfläche um die Seite wie `--bg0` der PWA (der Canvas selbst steht fest auf hell).
        canvas.backgroundColor = context.environment.colorScheme == .dark ? UIColor(hex: 0x05070D) : UIColor(hex: 0xF2EFE9)
        context.coordinator.onColor = onColor
        context.coordinator.setColor(color)
        context.coordinator.reloadIfNeeded(revision)
    }

    static func dismantleUIView(_ canvas: PKCanvasView, coordinator: Coordinator) {
        coordinator.toolPicker.setVisible(false, forFirstResponder: canvas)
        coordinator.toolPicker.removeObserver(canvas)
        coordinator.toolPicker.removeObserver(coordinator)
    }

    @MainActor
    final class Coordinator: NSObject, PKCanvasViewDelegate, PKToolPickerObserver {
        private let core: ImpalaCore
        private let pageId: String
        private let heftPageId: String
        private weak var canvas: PKCanvasView?
        private let paper = HeftPaperView()
        private let images = HeftObjectsView(.images)
        private let texts = HeftObjectsView(.texts)
        private let hold = HoldWatcher(target: nil, action: nil)
        var onColor: ((String) -> Void)?
        private var color = ""
        private var pageSize = CGSize(width: 794, height: 1123)
        private var loadedRevision = -1
        private var applying = false
        private var fitted = false

        /// Bekannte Striche je PencilKit-Schlüssel (`randomSeed`): Kern-ID, Daten und Lage beim letzten Abgleich.
        private struct Known { var id: String; var data: HeftStroke; var transform: CGAffineTransform; var bounds: CGRect }
        private var known: [UInt32: Known] = [:]
        /// Gelöschte Striche, damit „Rückgängig“ nach dem Radieren die Originaldaten wiederherstellt.
        private var removed: [UInt32: HeftStroke] = [:]
        /// Neue Stiftstriche, die erst nach dem Loslassen geschrieben werden (Formerkennung braucht das Halten).
        private var pending: [PKStroke] = []

        /// Werkzeuge wie in der PWA: Stift, Marker, Radierer (ganze Striche), Lasso, Lineal.
        let toolPicker = PKToolPicker(toolItems: [
            PKToolPickerInkingItem(type: .pen, color: UIColor(css: HeftPalette.colors[0].css), width: HeftPalette.size),
            PKToolPickerInkingItem(type: .marker, color: UIColor(css: HeftPalette.colors[4].css), width: HeftPalette.size * 3),
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
            canvas.insertSubview(paper, at: 0)
            canvas.insertSubview(images, at: 1)
            canvas.addSubview(texts)
            hold.cancelsTouchesInView = false
            hold.delaysTouchesBegan = false
            hold.delaysTouchesEnded = false
            hold.delegate = hold
            canvas.addGestureRecognizer(hold)
            toolPicker.addObserver(canvas)
            toolPicker.addObserver(self)
            toolPicker.setVisible(true, forFirstResponder: canvas)
            // Die Seite lädt das gleich folgende `updateUIView` (mit der aktuellen Revision).
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
            paper.configure(size: pageSize, paper: data.paper)
            let maxSide = canvas.traitCollection.displayScale * 2
            images.configure(size: pageSize, data: data) { im in
                HeftImages.image(core: core, pageId: pageId, heftPageId: heftPageId, image: im,
                                 maxPixels: min(4096, Int(max(im.w, im.h) * maxSide)))
            }
            texts.configure(size: pageSize, data: data) { _ in nil }
            pending.removeAll()
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
            canvas.contentSize = CGSize(width: pageSize.width * canvas.zoomScale, height: pageSize.height * canvas.zoomScale)
            fitWidth()
            layoutPage()
        }

        /// Beim ersten Anzeigen die Seitenbreite einpassen (mit Rand wie die Arbeitsfläche der PWA).
        func fitWidth() {
            guard !fitted, let canvas, canvas.bounds.width > 0 else { return }
            fitted = true
            let scale = (canvas.bounds.width - 2 * Self.gutter) / pageSize.width
            canvas.minimumZoomScale = min(scale, 1) * 0.5
            canvas.setZoomScale(scale, animated: false)
            layoutPage()
            canvas.contentOffset = CGPoint(x: -canvas.contentInset.left, y: -canvas.contentInset.top)
        }

        private static let gutter: CGFloat = 24

        /// Papier mitzoomen und die Seite mittig halten, solange sie schmaler als der Canvas ist.
        private func layoutPage() {
            guard let canvas else { return }
            let z = canvas.zoomScale
            paper.follow(zoom: z)
            images.follow(zoom: z)
            texts.follow(zoom: z)
            let w = pageSize.width * z
            let side = max(Self.gutter, (canvas.bounds.width - w) / 2)
            canvas.contentInset = UIEdgeInsets(top: Self.gutter, left: side, bottom: Self.gutter + 80, right: side)
        }

        func scrollViewDidZoom(_ scrollView: UIScrollView) { layoutPage() }

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
                } else if pending.contains(where: { $0.randomSeed == seed }) {
                    continue
                } else if stroke.ink.inkType == .pen {
                    pending.append(stroke)
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
            // Erst nach dem Loslassen entscheiden, ob der Stift am Ende gehalten wurde (`HoldWatcher`).
            if !pending.isEmpty {
                DispatchQueue.main.async { [weak self] in self?.commitPending() }
            }
        }

        /// Wartende Stiftstriche schreiben; wurde ein einzelner Strich am Ende gehalten und erkennt der Kern
        /// darin eine Form (`heftFitShape`), wird er durch die Form ersetzt (`heftAddShape`, wie PWA/Android).
        private func commitPending() {
            let strokes = pending
            pending.removeAll()
            guard let canvas, !strokes.isEmpty else { return }
            let held = hold.takeHold()
            let present = Set(canvas.drawing.strokes.map(\.randomSeed))
            for stroke in strokes where present.contains(stroke.randomSeed) {
                if held, strokes.count == 1, replaceWithShape(stroke, in: canvas) { continue }
                addStroke(stroke, original: nil)
            }
        }

        private func replaceWithShape(_ stroke: PKStroke, in canvas: PKCanvasView) -> Bool {
            let c = HeftInk.coreStroke(stroke, toolWidth: (canvas.tool as? PKInkingTool)?.width ?? HeftPalette.size)
            guard let shape = heftFitShape(points: c.points),
                  let edit = try? core.heftAddShape(pageId: pageId, heftPageId: heftPageId, color: c.color, size: c.size, shape: shape),
                  let id = edit.ids.first
            else { return false }
            let data = HeftStroke(id: id, tool: "shape", color: c.color, size: c.size, points: [], shape: shape)
            let seed = HeftInk.seed(id)
            guard let pk = HeftInk.pkStroke(data, seed: seed) else { return false }
            // Erst merken, dann tauschen: so bleibt der Abgleich richtig, egal wann PencilKit die Änderung meldet.
            known[seed] = Known(id: id, data: data, transform: .identity, bounds: pk.renderBounds)
            var all = canvas.drawing.strokes
            if let i = all.firstIndex(where: { $0.randomSeed == stroke.randomSeed }) { all[i] = pk } else { all.append(pk) }
            applying = true
            canvas.drawing = PKDrawing(strokes: all)
            applying = false
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
            return true
        }

        // MARK: Farbe (Palette ↔ Werkzeugpicker)

        /// Palettenfarbe auf Stift bzw. Marker legen; bei Radierer oder Lasso wechselt es zum Stift.
        func setColor(_ css: String) {
            guard css != color, let canvas else { return }
            color = css
            let current = canvas.tool as? PKInkingTool
            let type: PKInkingTool.InkType = current?.inkType == .marker ? .marker : .pen
            let width = current?.width ?? (type == .marker ? HeftPalette.size * 3 : HeftPalette.size)
            let tool = PKInkingTool(type, color: UIColor(css: css), width: width)
            toolPicker.selectedTool = tool
            canvas.tool = tool
        }

        func toolPickerSelectedToolDidChange(_ toolPicker: PKToolPicker) { reportColor() }
        func toolPickerSelectedToolItemDidChange(_ toolPicker: PKToolPicker) { reportColor() }

        /// Im Picker gewählte Farbe an die Palette melden (nach dem Canvas, der das Werkzeug übernimmt).
        private func reportColor() {
            DispatchQueue.main.async { [weak self] in
                guard let self, let ink = self.canvas?.tool as? PKInkingTool else { return }
                let css = ink.color.cssHex
                guard css != self.color else { return }
                self.color = css
                self.onColor?(css)
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

/// Merkt sich, ob der Stift am Strichende kurz stillgehalten wurde (wie das Halten für die Formerkennung
/// in heft.js). Beobachtet nur: erkennt nie selbst und lässt alle Berührungen an PencilKit durch.
final class HoldWatcher: UIGestureRecognizer, UIGestureRecognizerDelegate {
    /// Mindestdauer des Stillhaltens und erlaubtes Zittern (Bildschirmpunkte).
    private static let holdTime: TimeInterval = 0.45
    private static let slop: CGFloat = 4

    private var anchor = CGPoint.zero
    private var anchorTime: TimeInterval = 0
    private var travelled: CGFloat = 0
    private var held = false
    private var endedAt: TimeInterval = 0

    /// Ob der zuletzt beendete Strich gehalten wurde; danach zurückgesetzt.
    func takeHold() -> Bool {
        defer { held = false }
        return held && ProcessInfo.processInfo.systemUptime - endedAt < 1.5
    }

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
        guard let t = touches.first, let view else { return }
        anchor = t.location(in: view)
        anchorTime = t.timestamp
        travelled = 0
        held = false
    }

    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent) {
        guard let t = touches.first, let view else { return }
        let p = t.location(in: view)
        let d = hypot(p.x - anchor.x, p.y - anchor.y)
        guard d > Self.slop else { return }
        travelled += d
        anchor = p
        anchorTime = t.timestamp
    }

    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent) {
        guard let t = touches.first else { return }
        held = travelled > 20 && t.timestamp - anchorTime >= Self.holdTime
        endedAt = t.timestamp
        state = .failed
    }

    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent) {
        held = false
        state = .failed
    }

    func gestureRecognizer(_ g: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { true }
}
