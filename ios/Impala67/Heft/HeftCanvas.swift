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
    /// Verbindung zur Leiste (Auswahl, Lasso für Text, Einfügen an der sichtbaren Stelle).
    let link: HeftCanvasLink
    /// „Bilder & Texte auswählen & bearbeiten“: Finger und Stift wählen statt zu zeichnen.
    let selecting: Bool
    /// „Handschrift → Text“: der nächste Strich ist ein Lasso und wird nicht gespeichert.
    let lassoText: Bool

    func makeCoordinator() -> Coordinator { Coordinator(core: core, pageId: pageId, heftPageId: heftPageId) }

    func makeUIView(context: Context) -> PKCanvasView {
        let canvas = HeftCanvasView()
        canvas.delegate = context.coordinator
        // Folgt der Einstellung „Mit Finger zeichnen“ im Apple-Werkzeugpicker.
        canvas.drawingPolicy = .default
        // Papier ist in beiden Modi hell; sonst kehrt PencilKit die Farben im Dunkelmodus um.
        canvas.overrideUserInterfaceStyle = .light
        // Durchsichtig, sonst übermalt PencilKit das Papier darunter mit der Hintergrundfarbe (schwarzes
        // Heft im Dunkelmodus). Die Arbeitsfläche um die Seite liefert der Hintergrund von `HeftScreen`.
        canvas.isOpaque = false
        canvas.backgroundColor = .clear
        canvas.minimumZoomScale = 0.25
        canvas.maximumZoomScale = 5
        canvas.bouncesZoom = true
        // Doppeltipp mit dem Finger zoomt (der Stift zeichnet weiter).
        let doubleTap = UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.handleDoubleTap(_:)))
        doubleTap.numberOfTapsRequired = 2
        doubleTap.allowedTouchTypes = [NSNumber(value: UITouch.TouchType.direct.rawValue)]
        canvas.addGestureRecognizer(doubleTap)
        context.coordinator.attach(canvas)
        canvas.onLayout = { [weak coordinator = context.coordinator] in coordinator?.fitWidth() }
        return canvas
    }

    func updateUIView(_ canvas: PKCanvasView, context: Context) {
        context.coordinator.link = link
        link.coordinator = context.coordinator
        context.coordinator.reloadIfNeeded(revision)
        context.coordinator.setModes(selecting: selecting, lassoText: lassoText)
    }

    static func dismantleUIView(_ canvas: PKCanvasView, coordinator: Coordinator) {
        coordinator.flush()
        coordinator.toolPicker.setVisible(false, forFirstResponder: canvas)
        coordinator.toolPicker.removeObserver(canvas)
    }

    @MainActor
    final class Coordinator: NSObject, PKCanvasViewDelegate {
        private let core: ImpalaCore
        private let pageId: String
        private let heftPageId: String
        private weak var canvas: PKCanvasView?
        private let paper = HeftPaperView()
        private let images = HeftObjectsView(.images)
        /// Sichtbare gespeicherte Striche (wie die PWA); PencilKit hält sie fast durchsichtig.
        private let ink = HeftInkView()
        private let texts = HeftObjectsView(.texts)
        private let select = HeftSelectLayer()
        private let hold = HoldWatcher(target: nil, action: nil)
        weak var link: HeftCanvasLink?
        private var selecting = false
        private var lassoText = false
        /// Werkzeug vor dem Lasso für „Handschrift → Text“.
        private var toolBeforeLasso: PKTool?
        private var pageSize = CGSize(width: 794, height: 1123)
        private var loadedRevision = -1
        private var applying = false
        private var fitted = false

        /// Bekannte Striche je PencilKit-Schlüssel (`randomSeed`): Kern-ID, Daten und Lage beim letzten Abgleich.
        /// `drawn`: Lage, in der die Punkte von `data` gelten (geladen: Identität; neu geschrieben: Lage beim
        /// Schreiben). Verschieben ändert nur `transform`, die Daten bleiben – die Ink-Ebene rechnet um.
        private struct Known {
            var id: String
            var data: HeftStroke
            var transform: CGAffineTransform
            var bounds: CGRect
            var drawn: CGAffineTransform
        }
        private var known: [UInt32: Known] = [:]
        /// Gelöschte Striche, damit „Rückgängig“ nach dem Radieren die Originaldaten wiederherstellt.
        private var removed: [UInt32: HeftStroke] = [:]
        /// Neue Stiftstriche, die erst nach dem Loslassen geschrieben werden (Formerkennung braucht das Halten).
        private var pending: [PKStroke] = []
        /// Noch nicht geschriebene Strich-Änderungen. Wie `scheduleSave` in heft.js der PWA: 350 ms nach
        /// der letzten Änderung *ein* Event (`heftCommitStrokes`) statt eines je Strich – weniger Log,
        /// weniger Sync, weniger Änderungsmeldungen. Neue Striche bekommen ihre ID gleich hier.
        private var batchAdd: [HeftStroke] = []
        private var batchRemove: [String] = []
        private var flushTask: Task<Void, Never>?
        private static let flushDelay: Duration = .milliseconds(350)
        /// Geschriebene, aber im Hintergrund noch nicht fertige Aufrufe; Neuladen wartet auf sie.
        private var writesPending = 0
        private var reloadWanted = false
        /// Kern-Schreiben in fester Reihenfolge im Hintergrund: Der Stift wartet nie auf die Kern-Sperre,
        /// die Sync, Checkpoint oder Handschrift-Scan gerade halten können.
        private let writer = DispatchQueue(label: "impala.heft.write", qos: .userInitiated)
        private var resignObserver: NSObjectProtocol?
        /// Dekodieren fehlender Bilder der Seite (abgebrochen beim nächsten Neuladen).
        private var imageLoad: Task<Void, Never>?

        /// Alles Gesammelte schreiben und warten, bis die Warteschlange leer ist – für die seltenen Stellen,
        /// die gleich danach Striche aus dem Kern lesen (Lasso, Handschrift → Text).
        private func flushAndWait() {
            flush()
            writer.sync {}
        }

        /// Apples Werkzeugleiste ist die einzige Werkzeug- und Farbwahl im Heft (Stift, Marker, Radierer,
        /// Lasso, Lineal; Standardfarben wie die PWA). Rückgängig/Wiederholen und „Mit Finger zeichnen“
        /// bringt sie selbst mit.
        /// Eine Leiste für alle Seiten und Hefte (wie die Werkzeugwahl der PWA): Beim Blättern entsteht ein
        /// neuer Canvas, die gewählten Stifte, Farben und Breiten bleiben. Über App-Starts merkt sie sich
        /// PencilKit selbst (`stateAutosaveName`).
        static let sharedToolPicker: PKToolPicker = {
            let picker = PKToolPicker(toolItems: [
                PKToolPickerInkingItem(type: .pen, color: UIColor(css: HeftPalette.colors[0].css), width: HeftPalette.size),
                PKToolPickerInkingItem(type: .marker, color: UIColor(css: HeftPalette.colors[4].css), width: HeftPalette.size * 3),
                PKToolPickerEraserItem(type: .vector),
                PKToolPickerLassoItem(),
                PKToolPickerRulerItem(),
            ])
            picker.stateAutosaveName = "impala.heft.tools"
            return picker
        }()
        var toolPicker: PKToolPicker { Self.sharedToolPicker }

        /// Farbe des aktuellen Stifts bzw. Markers (für neue Textfelder), sonst Schwarz.
        var currentColor: String {
            (canvas?.tool as? PKInkingTool)?.color.cssHex ?? HeftPalette.colors[0].css
        }

        init(core: ImpalaCore, pageId: String, heftPageId: String) {
            self.core = core
            self.pageId = pageId
            self.heftPageId = heftPageId
        }

        func attach(_ canvas: PKCanvasView) {
            self.canvas = canvas
            canvas.insertSubview(paper, at: 0)
            canvas.insertSubview(images, at: 1)
            canvas.insertSubview(ink, at: 2)
            canvas.addSubview(texts)
            canvas.addSubview(select)
            // Ziehen auf der Auswahl verschiebt sie; sonst scrollt die Seite.
            canvas.panGestureRecognizer.require(toFail: select.pan)
            select.onSelect = { [weak self] item in self?.link?.selection = item }
            select.onPreview = { [weak self] item, frame in self?.preview(item, frame) }
            select.onCommit = { [weak self] item, frame in self?.commit(item, frame) }
            select.onEditText = { [weak self] id in self?.editText(id) }
            hold.cancelsTouchesInView = false
            hold.delaysTouchesBegan = false
            hold.delaysTouchesEnded = false
            hold.delegate = hold
            canvas.addGestureRecognizer(hold)
            toolPicker.addObserver(canvas)
            // Der neue Canvas übernimmt das gerade gewählte Werkzeug der gemeinsamen Leiste.
            canvas.tool = toolPicker.selectedTool
            toolPicker.setVisible(true, forFirstResponder: canvas)
            // Wie `visibilitychange`/`pagehide` in heft.js: beim Verlassen der App sofort schreiben.
            resignObserver = NotificationCenter.default.addObserver(
                forName: UIApplication.willResignActiveNotification, object: nil, queue: .main
            ) { [weak self] _ in MainActor.assumeIsolated { self?.flush() } }
            // Die Seite lädt das gleich folgende `updateUIView` (mit der aktuellen Revision).
            DispatchQueue.main.async { [weak self, weak canvas] in
                canvas?.becomeFirstResponder()
                self?.fitWidth()
            }
        }

        /// Seite aus dem Kern neu aufbauen (Öffnen, fremde Änderung).
        func reloadIfNeeded(_ revision: Int) {
            guard revision != loadedRevision else { return }
            loadedRevision = revision
            reload()
        }

        /// Seite aus dem Kern neu aufbauen (auch nach Änderungen an Bildern und Textfeldern).
        func reload() {
            let done = Profiler.shared.begin("heft.reload")
            defer { done() }
            // Erst Gesammeltes schreiben und abwarten, sonst verschwänden diese Striche kurz von der Seite.
            flush()
            if writesPending > 0 {
                reloadWanted = true
                return
            }
            reloadWanted = false
            guard let canvas, let data = attempt("heftPage", { try core.heftPage(pageId: pageId, heftPageId: heftPageId) }) else { return }
            pageSize = CGSize(width: data.width, height: data.height)
            paper.configure(size: pageSize, paper: data.paper)
            ink.configure(size: pageSize)
            showImages(data, scale: canvas.traitCollection.displayScale)
            texts.configure(size: pageSize, data: data) { _ in nil }
            select.configure(size: pageSize, data: data)
            if link?.selection != select.selected {
                let kept = select.selected
                DispatchQueue.main.async { [weak self] in self?.link?.selection = kept }
            }
            pending.removeAll()
            // Unveränderte Striche weiterverwenden und PencilKit nur neu zeichnen lassen, wenn sich die
            // Striche wirklich geändert haben: Fremde Änderungen (OCR-Text, Bilder, andere Seiten des Hefts)
            // bauten sonst jedes Mal alle Striche neu auf und zeichneten die ganze Seite neu (Hänger bis 1 s).
            let current = canvas.drawing.strokes
            var existing: [UInt32: PKStroke] = [:]
            existing.reserveCapacity(current.count)
            for pk in current where pk.transform == .identity { existing[pk.randomSeed] = pk }
            let old = known
            var strokes: [PKStroke] = []
            strokes.reserveCapacity(data.strokes.count)
            var next: [UInt32: Known] = [:]
            var reused = 0
            for s in data.strokes {
                let seed = HeftInk.seed(s.id)
                if let k = old[seed], k.data == s, k.transform == .identity, let pk = existing[seed] {
                    strokes.append(pk)
                    next[seed] = k
                    reused += 1
                    continue
                }
                guard let pk = HeftInk.pkStroke(s, seed: seed, hidden: true) else { continue }
                strokes.append(pk)
                next[seed] = Known(id: s.id, data: s, transform: .identity, bounds: pk.renderBounds, drawn: .identity)
            }
            known = next
            let unchanged = reused == strokes.count && strokes.count == current.count
                && zip(strokes, current).allSatisfy { $0.randomSeed == $1.randomSeed }
            if !unchanged {
                applying = true
                canvas.drawing = PKDrawing(strokes: strokes)
                applying = false
            }
            updateInk()
            canvas.contentSize = CGSize(width: pageSize.width * canvas.zoomScale, height: pageSize.height * canvas.zoomScale)
            fitWidth()
            layoutPage()
            viewportChanged()
        }

        /// Bilder der Seite zeigen. Schon dekodierte sofort; fehlende werden im Hintergrund dekodiert und
        /// danach ergänzt – vorher hielt das Dekodieren großer Scans/PDF-Seiten den Hauptthread an.
        private func showImages(_ data: HeftPageData, scale: CGFloat) {
            imageLoad?.cancel()
            imageLoad = nil
            let size = CGSize(width: data.width, height: data.height)
            let pixels = { (im: HeftImage) in min(4096, Int(max(im.w, im.h) * scale * 2)) }
            images.configure(size: size, data: data) { im in HeftImages.cached(im, maxPixels: pixels(im)) }
            let missing = data.images.filter { HeftImages.cached($0, maxPixels: pixels($0)) == nil }
            guard !missing.isEmpty else { return }
            let (core, pageId, heftPageId) = (core, pageId, heftPageId)
            imageLoad = Task { [weak self] in
                for im in missing {
                    _ = await HeftImages.load(core: core, pageId: pageId, heftPageId: heftPageId, image: im, maxPixels: pixels(im))
                    if Task.isCancelled { return }
                }
                guard let self, !Task.isCancelled else { return }
                self.images.configure(size: size, data: data) { im in HeftImages.cached(im, maxPixels: pixels(im)) }
            }
        }

        /// Ink-Ebene nachziehen: gespeicherte (in PencilKit durchsichtige) Striche in Zeichenreihenfolge,
        /// mit ihren Kerndaten und der Lage seit dem Laden (Lasso-Verschieben).
        private func updateInk() {
            guard let canvas else { return }
            var list: [(data: HeftStroke, transform: CGAffineTransform)] = []
            for stroke in canvas.drawing.strokes where HeftInk.isHidden(stroke) {
                guard let k = known[stroke.randomSeed] else { continue }
                let t: CGAffineTransform = k.drawn == stroke.transform ? .identity : k.drawn.inverted().concatenating(stroke.transform)
                list.append((data: k.data, transform: t))
            }
            ink.update(list)
        }

        /// Sichtbaren Ausschnitt an die Ink-Ebene melden (scharfe Detail-Bitmap beim Zoomen).
        private func viewportChanged() {
            guard let canvas else { return }
            let z = max(canvas.zoomScale, 0.01)
            let visible = CGRect(x: canvas.contentOffset.x / z, y: canvas.contentOffset.y / z,
                                 width: canvas.bounds.width / z, height: canvas.bounds.height / z)
            ink.viewportChanged(visible: visible, displayScale: canvas.traitCollection.displayScale)
        }

        func scrollViewDidScroll(_ scrollView: UIScrollView) { viewportChanged() }

        /// Doppeltipp wie `heft-viewport.js`: ab 1,9× zurück auf Passbreite, sonst auf mindestens 2,2×
        /// (bzw. 1,8× des jetzigen Zooms) um den getippten Punkt. Die Faktoren gelten wie in der PWA
        /// relativ zur Passbreite (dort `view.k = 1`).
        @objc func handleDoubleTap(_ gesture: UITapGestureRecognizer) {
            guard let canvas, pageSize.width > 0, canvas.bounds.width > 0, canvas.bounds.height > 0 else { return }
            let fit = (canvas.bounds.width - 2 * Self.gutter) / pageSize.width
            guard fit > 0 else { return }
            let current = canvas.zoomScale
            let k = current / fit
            let target = k >= 1.9 ? fit : min(canvas.maximumZoomScale, fit * max(2.2, k * 1.8))
            // `zoom(to:)` erwartet Seitenkoordinaten (ungezoomt); der Tipp liegt in gezoomten Inhaltskoordinaten.
            let p = gesture.location(in: canvas)
            let pt = CGPoint(x: p.x / current, y: p.y / current)
            let w = canvas.bounds.width / target, h = canvas.bounds.height / target
            canvas.zoom(to: CGRect(x: pt.x - w / 2, y: pt.y - h / 2, width: w, height: h), animated: true)
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
            ink.follow(zoom: z)
            texts.follow(zoom: z)
            select.follow(zoom: z)
            let w = pageSize.width * z
            let side = max(Self.gutter, (canvas.bounds.width - w) / 2)
            canvas.contentInset = UIEdgeInsets(top: Self.gutter, left: side, bottom: Self.gutter + 80, right: side)
        }

        func scrollViewDidZoom(_ scrollView: UIScrollView) {
            layoutPage()
            viewportChanged()
        }

        func canvasViewDrawingDidChange(_ canvas: PKCanvasView) {
            if !applying { sync(canvas) }
            // Radierer, Lasso, Rückgängig: die sichtbaren Striche folgen der Zeichnung (nach dem Abgleich,
            // damit neu geschriebene Striche schon ihre Kerndaten haben).
            updateInk()
        }

        /// Vergleicht die Zeichnung mit dem letzten Stand und schreibt die Unterschiede in den Kern.
        private func sync(_ canvas: PKCanvasView) {
            let done = Profiler.shared.begin("heft.drawing-diff")
            defer { done() }
            let strokes = canvas.drawing.strokes
            var lasso: PKStroke?
            var seen = Set<UInt32>()
            var moves: [String: (dx: Double, dy: Double, ids: [String])] = [:]
            var toRemove: [String] = []

            for stroke in strokes {
                let seed = stroke.randomSeed
                seen.insert(seed)
                if var k = known[seed] {
                    // Unverändert, verschoben (Lasso) oder anders geändert → neu schreiben. Ohne Maske
                    // (Pixel-Radierer) und mit gleicher Lage ist der Strich unverändert – `renderBounds` für
                    // jeden Strich der Seite nach jedem neuen Strich kostete bei vollen Seiten spürbar Zeit.
                    let t = stroke.transform
                    if t == k.transform && stroke.mask == nil { continue }
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
                } else if lassoText {
                    lasso = stroke
                } else if stroke.ink.inkType == .pen {
                    pending.append(stroke)
                } else {
                    addStroke(stroke, original: nil)
                }
            }

            if let lasso {
                recognizeLasso(lasso, in: canvas)
                return
            }
            for (seed, k) in known where !seen.contains(seed) {
                toRemove.append(k.id)
                removed[seed] = k.data
                known[seed] = nil
            }
            if !toRemove.isEmpty { removeStrokes(toRemove) }
            if !moves.isEmpty {
                // Verschieben braucht die Striche im Kern: erst das Gesammelte, dann die Verschiebung.
                flush()
                for move in moves.values {
                    write { core, pageId, heftPageId in
                        _ = attempt("heftMoveStrokes", { try core.heftMoveStrokes(pageId: pageId, heftPageId: heftPageId, ids: move.ids, dx: move.dx, dy: move.dy) })
                    }
                }
                HeftOcr.schedule(core: core, pageId: pageId, heftPageId: heftPageId)
            }
            // Erst nach dem Loslassen entscheiden, ob der Stift am Ende gehalten wurde (`HoldWatcher`).
            if !pending.isEmpty {
                DispatchQueue.main.async { [weak self] in self?.commitPending() }
            }
        }

        /// Wartende Stiftstriche schreiben; wurde ein einzelner Strich am Ende gehalten und erkennt der Kern
        /// darin eine Form (`heftFitShape`), wird er durch die Form ersetzt (`heftAddShape`, wie PWA/Android).
        private func commitPending() {
            let done = Profiler.shared.begin("heft.commit")
            defer { done() }
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
                  let edit = attempt("heftAddShape", { try core.heftAddShape(pageId: pageId, heftPageId: heftPageId, color: c.color, size: c.size, shape: shape) }),
                  let id = edit.ids.first
            else { return false }
            let data = HeftStroke(id: id, tool: "shape", color: c.color, size: c.size, points: [], shape: shape)
            let seed = HeftInk.seed(id)
            guard let pk = HeftInk.pkStroke(data, seed: seed, hidden: true) else { return false }
            // Erst merken, dann tauschen: so bleibt der Abgleich richtig, egal wann PencilKit die Änderung meldet.
            known[seed] = Known(id: id, data: data, transform: .identity, bounds: pk.renderBounds, drawn: .identity)
            var all = canvas.drawing.strokes
            if let i = all.firstIndex(where: { $0.randomSeed == stroke.randomSeed }) { all[i] = pk } else { all.append(pk) }
            applying = true
            canvas.drawing = PKDrawing(strokes: all)
            applying = false
            updateInk()
            if AppHaptics.isEnabled { UIImpactFeedbackGenerator(style: .light).impactOccurred() }
            return true
        }

        // MARK: Bilder, Textfelder, Handschrift → Text

        /// Auswahlmodus bzw. Lasso für Text ein-/ausschalten (Zeichnen ruht im Auswahlmodus).
        func setModes(selecting: Bool, lassoText: Bool) {
            guard let canvas else { return }
            if selecting != self.selecting {
                self.selecting = selecting
                select.isUserInteractionEnabled = selecting
                canvas.drawingGestureRecognizer.isEnabled = !selecting
                if !selecting {
                    select.select(nil)
                    DispatchQueue.main.async { [weak self] in self?.link?.selection = nil }
                }
            }
            if lassoText != self.lassoText {
                self.lassoText = lassoText
                if lassoText {
                    toolBeforeLasso = canvas.tool
                    canvas.tool = PKInkingTool(.pen, color: UIColor(Impala.accent).withAlphaComponent(0.7), width: 2)
                } else if let before = toolBeforeLasso {
                    canvas.tool = before
                    toolBeforeLasso = nil
                }
            }
        }

        /// Mitte des sichtbaren Ausschnitts in Seitenkoordinaten (dort landen neue Bilder und Texte).
        func visibleCenter() -> CGPoint {
            guard let canvas else { return CGPoint(x: pageSize.width / 2, y: pageSize.height / 2) }
            let z = max(canvas.zoomScale, 0.01)
            let c = CGPoint(x: (canvas.contentOffset.x + canvas.bounds.width / 2) / z,
                            y: (canvas.contentOffset.y + canvas.bounds.height / 2) / z)
            return CGPoint(x: min(max(c.x, 0), pageSize.width), y: min(max(c.y, 0), pageSize.height))
        }

        /// Element nach dem Einfügen auswählen (Auswahlmodus an, wie nach „Bild hinzufügen“ in der PWA).
        func selectAfterReload(_ item: HeftSelectLayer.Item) {
            select.select(item)
            link?.selection = item
        }

        private func preview(_ item: HeftSelectLayer.Item, _ frame: CGRect) {
            switch item {
            case .image(let id): images.preview(id, frame: frame)
            case .text(let id): texts.preview(id, frame: frame)
            }
        }

        private func commit(_ item: HeftSelectLayer.Item, _ frame: CGRect) {
            switch item {
            case .image(let id):
                _ = attempt("heftSetImageFrame", { try core.heftSetImageFrame(pageId: pageId, heftPageId: heftPageId, imageId: id,
                                                x: frame.minX, y: frame.minY, w: frame.width, h: frame.height) })
            case .text(let id):
                guard var t = text(id) else { return }
                t.x = frame.minX
                t.y = frame.minY
                t.w = frame.width
                _ = attempt("heftSetText", { try core.heftSetText(pageId: pageId, heftPageId: heftPageId, text: t) })
            }
            reload()
        }

        /// Ausgewähltes Bild bzw. Textfeld löschen.
        func deleteSelection() {
            guard let item = select.selected else { return }
            switch item {
            case .image(let id): _ = attempt("heftRemoveImages", { try core.heftRemoveImages(pageId: pageId, heftPageId: heftPageId, ids: [id]) })
            case .text(let id): _ = attempt("heftRemoveTexts", { try core.heftRemoveTexts(pageId: pageId, heftPageId: heftPageId, ids: [id]) })
            }
            select.select(nil)
            link?.selection = nil
            reload()
        }

        func text(_ id: String) -> HeftText? {
            (attempt("heftPage", { try core.heftPage(pageId: pageId, heftPageId: heftPageId) }))?.texts.first { $0.id == id }
        }

        private func editText(_ id: String) {
            guard let t = text(id) else { return }
            link?.textEdit = HeftTextEdit(textId: t.id, text: t.text)
        }

        /// Lasso-Strich entfernen, die umkreisten Striche als Bild an Apple Vision geben.
        private func recognizeLasso(_ stroke: PKStroke, in canvas: PKCanvasView) {
            applying = true
            canvas.drawing = PKDrawing(strokes: canvas.drawing.strokes.filter { $0.randomSeed != stroke.randomSeed })
            applying = false
            link?.lassoText = false
            var polygon: [Float] = []
            for p in stroke.path {
                let loc = p.location.applying(stroke.transform)
                polygon += [Float(loc.x), Float(loc.y)]
            }
            flushAndWait()
            let ids = (attempt("heftSelectByLasso", { try core.heftSelectByLasso(pageId: pageId, heftPageId: heftPageId, polygon: polygon) })) ?? []
            let want = Set(ids)
            // Die umkreisten Striche im aktuellen Stand des Kerns (nach `flushAndWait`).
            let picked = (attempt("heftPage", { try core.heftPage(pageId: pageId, heftPageId: heftPageId) }))?
                .strokes.filter { want.contains($0.id) } ?? []
            let raw = HeftInk.bounds(picked)
            guard !picked.isEmpty, !raw.isNull else {
                link?.ocr = HeftOcrResult(text: "", strokeIds: [], bounds: .zero)
                return
            }
            let bounds = raw.insetBy(dx: -16, dy: -16)
            // Vision braucht dunkle Schrift auf hellem Grund, nicht auf Transparenz; gezeichnet wie die PWA.
            let format = UIGraphicsImageRendererFormat()
            format.scale = 2
            format.opaque = true
            let image = UIGraphicsImageRenderer(size: bounds.size, format: format).image { ctx in
                UIColor.white.setFill()
                ctx.fill(CGRect(origin: .zero, size: bounds.size))
                ctx.cgContext.translateBy(x: -bounds.minX, y: -bounds.minY)
                HeftInk.draw(picked, in: ctx.cgContext)
            }
            guard let cg = image.cgImage else { return }
            Task { [weak self] in
                let text = await HeftOcr.recognize(cg)
                self?.link?.ocr = HeftOcrResult(text: text, strokeIds: ids, bounds: bounds)
            }
        }

        /// Striche des Lassos durch ein Textfeld an ihrer Stelle ersetzen.
        func replaceWithText(_ result: HeftOcrResult, text: String, color: String) {
            flushAndWait()
            _ = attempt("heftRemoveStrokes", { try core.heftRemoveStrokes(pageId: pageId, heftPageId: heftPageId, ids: result.strokeIds) })
            let w = max(160, result.bounds.width)
            _ = attempt("heftAddText", { try core.heftAddText(pageId: pageId, heftPageId: heftPageId, text: text,
                                      x: result.bounds.minX, y: result.bounds.minY, w: w, color: color, size: 30) })
            reload()
            HeftOcr.schedule(core: core, pageId: pageId, heftPageId: heftPageId)
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
            guard !c.points.isEmpty else { return }
            // Kern-IDs sind kleingeschriebene UUIDs (wie `uuid::Uuid::new_v4` im Kern).
            let id = UUID().uuidString.lowercased()
            let data = HeftStroke(id: id, tool: c.tool, color: c.color, size: c.size, points: c.points, shape: nil)
            known[stroke.randomSeed] = Known(id: id, data: data, transform: stroke.transform, bounds: stroke.renderBounds,
                                             drawn: stroke.transform)
            batchAdd.append(data)
            scheduleFlush()
        }

        /// Striche entfernen; noch nicht geschriebene fallen einfach aus der Sammlung.
        private func removeStrokes(_ ids: [String]) {
            let unwritten = Set(batchAdd.map(\.id))
            batchAdd.removeAll { ids.contains($0.id) }
            batchRemove += ids.filter { !unwritten.contains($0) }
            scheduleFlush()
        }

        private func scheduleFlush() {
            HeftActivity.noteWrite()
            flushTask?.cancel()
            flushTask = Task { [weak self] in
                try? await Task.sleep(for: Self.flushDelay)
                guard !Task.isCancelled else { return }
                self?.flush()
            }
        }

        /// Gesammelte Strich-Änderungen jetzt als ein Event schreiben (im Hintergrund).
        func flush() {
            flushTask?.cancel()
            flushTask = nil
            guard !batchAdd.isEmpty || !batchRemove.isEmpty else { return }
            let (add, remove) = (batchAdd, batchRemove)
            batchAdd.removeAll()
            batchRemove.removeAll()
            write { core, pageId, heftPageId in
                _ = attempt("heftCommitStrokes", { try core.heftCommitStrokes(pageId: pageId, heftPageId: heftPageId, add: add, remove: remove) })
            }
            HeftOcr.schedule(core: core, pageId: pageId, heftPageId: heftPageId)
        }

        /// Kern-Aufruf in der Schreib-Warteschlange; ein wartendes Neuladen läuft, sobald alles geschrieben ist.
        private func write(_ op: @escaping @Sendable (ImpalaCore, String, String) -> Void) {
            let (core, pageId, heftPageId) = (core, pageId, heftPageId)
            writesPending += 1
            writer.async {
                op(core, pageId, heftPageId)
                DispatchQueue.main.async { [weak self] in
                    guard let self else { return }
                    self.writesPending -= 1
                    if self.writesPending == 0 && self.reloadWanted { self.reload() }
                }
            }
        }
    }
}

/// Wann zuletzt im Heft geschrieben wurde (wie `heft:is-writing` der PWA): Sync und Handschrift-Erkennung
/// warten, solange geschrieben wird, statt mitten im Schreiben die Kern-Sperre zu belegen.
@MainActor
enum HeftActivity {
    private(set) static var lastWrite: Date = .distantPast
    static func noteWrite() { lastWrite = .now }
    /// Ob in den letzten `seconds` Sekunden geschrieben wurde.
    static func isWriting(within seconds: TimeInterval) -> Bool { Date.now.timeIntervalSince(lastWrite) < seconds }
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
