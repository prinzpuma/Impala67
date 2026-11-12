import PencilKit
import SwiftUI
import UIKit.UIGestureRecognizerSubclass

/// Das ganze Heft als eine durchlaufende Fläche wie in der PWA (`.heft-pages`): alle Seiten untereinander,
/// frei scrollen und zoomen über Seitengrenzen hinweg, ein PencilKit-Canvas für alles (ein Rückgängig-Verlauf,
/// Lasso und Lineal überall). Der Kern ist die einzige Quelle: Seiten in der Nähe des sichtbaren Bereichs
/// werden aus `heftPage` geladen; jede Änderung am Canvas (Stift, Radierer, Lasso, Rückgängig) wird mit dem
/// letzten Stand verglichen und als Kern-Aufruf der jeweiligen Seite geschrieben – dieselben Events wie in
/// der PWA, damit der Sync unverändert bleibt. Ein Strich gehört zu der Seite, auf der er beginnt.
struct HeftCanvas: UIViewRepresentable {
    let core: ImpalaCore
    let pageId: String
    /// Seiten des Hefts in Reihenfolge.
    let pageIds: [String]
    /// Seite, die beim Öffnen gezeigt wird.
    let initialPageId: String?
    /// Zählt hoch, wenn das Heft außerhalb des Canvas geändert wurde (anderes Gerät, Seitenübersicht).
    let revision: Int
    /// Verbindung zur Leiste (Auswahl, Einfügen an der sichtbaren Stelle).
    let link: HeftCanvasLink
    /// Gewähltes Werkzeug aus der eigenen Leiste (`HeftToolPill`).
    let tools: HeftToolSetting
    /// Die Seite in der Mitte der Ansicht hat gewechselt (Seitenanzeige „n / m“).
    let onCurrentPage: (String) -> Void
    /// Über das Ende der letzten Seite hinaus gezogen (Hochziehen für eine neue Seite wie in der PWA).
    let onPullAdd: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator(core: core, pageId: pageId, initialPageId: initialPageId) }

    func makeUIView(context: Context) -> PKCanvasView {
        let canvas = HeftCanvasView()
        canvas.delegate = context.coordinator
        // Wie „Nur Stift zeichnet“ der PWA; umgestellt über die Leiste (`apply`).
        canvas.drawingPolicy = .pencilOnly
        // Papier ist in beiden Modi hell; sonst kehrt PencilKit die Farben im Dunkelmodus um.
        canvas.overrideUserInterfaceStyle = .light
        // Durchsichtig, sonst übermalt PencilKit das Papier darunter mit der Hintergrundfarbe (schwarzes
        // Heft im Dunkelmodus). Die Arbeitsfläche um die Seiten liefert der Hintergrund von `HeftScreen`.
        canvas.isOpaque = false
        canvas.backgroundColor = .clear
        canvas.minimumZoomScale = 0.25
        canvas.maximumZoomScale = 5
        // Harte Zoomgrenze wie `heft-viewport.js` (clamp): kein Zurückfedern über die Grenze hinaus,
        // das beim Zurückspringen zusätzlich die mitlaufenden Seitenränder verschiebt.
        canvas.bouncesZoom = false
        canvas.alwaysBounceVertical = true
        // Doppeltipp mit dem Finger zoomt (der Stift zeichnet weiter).
        let doubleTap = UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.handleDoubleTap(_:)))
        doubleTap.numberOfTapsRequired = 2
        doubleTap.allowedTouchTypes = [NSNumber(value: UITouch.TouchType.direct.rawValue)]
        canvas.addGestureRecognizer(doubleTap)
        // Doppeltippen/Drücken am Apple Pencil (sonst übernimmt das Apples Werkzeugleiste).
        canvas.addInteraction(UIPencilInteraction(delegate: context.coordinator))
        context.coordinator.attach(canvas)
        canvas.onLayout = { [weak coordinator = context.coordinator] in coordinator?.layoutChanged() }
        return canvas
    }

    func updateUIView(_ canvas: PKCanvasView, context: Context) {
        let c = context.coordinator
        c.link = link
        link.coordinator = c
        c.onCurrentPage = onCurrentPage
        c.onPullAdd = onPullAdd
        c.apply(tools)
        c.setPages(pageIds, revision: revision)
    }

    static func dismantleUIView(_ canvas: PKCanvasView, coordinator: Coordinator) {
        coordinator.flush()
    }

    @MainActor
    final class Coordinator: NSObject, PKCanvasViewDelegate, UIPencilInteractionDelegate {
        private let core: ImpalaCore
        private let pageId: String
        private weak var canvas: PKCanvasView?
        weak var link: HeftCanvasLink?
        var onCurrentPage: ((String) -> Void)?
        var onPullAdd: (() -> Void)?

        // MARK: Lage der Seiten

        /// Seitengröße des Kerns (`PAGE_W` × `PAGE_H`, für alle Seiten gleich).
        private static let pageSize = CGSize(width: 1000, height: 1414)
        /// Abstand zwischen den Seiten (Platz für „Seite n“ darunter), in Seitenkoordinaten.
        private static let gap: CGFloat = 44
        private static let gutter: CGFloat = 24
        /// Oben Platz für die schwebende Leiste.
        private static let topInset: CGFloat = 72
        private static var step: CGFloat { pageSize.height + gap }

        private var order: [String] = []
        private var slot: [String: Int] = [:]
        private var initialPageId: String?
        private var currentPage: String?
        /// Sprungziel, das erst nach dem nächsten Seiten-Layout angewendet werden kann.
        private var pendingScroll: (id: String, animated: Bool)?

        private func origin(_ index: Int) -> CGPoint { CGPoint(x: 0, y: CGFloat(index) * Self.step) }
        private func origin(of id: String) -> CGPoint { origin(slot[id] ?? 0) }
        private var contentSize: CGSize {
            CGSize(width: Self.pageSize.width, height: max(1, CGFloat(order.count) * Self.step - Self.gap + 30))
        }

        /// Seite, zu der ein Punkt der Fläche gehört (im Zwischenraum: die nähere).
        private func pageAt(_ p: CGPoint) -> String? {
            guard !order.isEmpty else { return nil }
            let i = Int(floor((p.y + Self.gap / 2) / Self.step))
            return order[min(max(i, 0), order.count - 1)]
        }

        // MARK: Ebenen

        /// Unter den Strichen: Papier (alle Seiten), Bilder, sichtbare Striche (geladene Seiten).
        private let under = UIView()
        private let paperBox = UIView()
        private let inkBox = UIView()
        private let images = HeftObjectsView(.images)
        private let texts = HeftObjectsView(.texts)
        private let select = HeftSelectLayer()
        private let lasso = HeftLassoLayer()
        private let laser = HeftLaserLayer()
        /// Scroll-Geste der Leinwand vor Lasso/Laser (wird danach wiederhergestellt).
        private var panDefaults: (types: [NSNumber], min: Int)?
        /// Mit dem Lasso ausgewählte Striche (PencilKit-Schlüssel).
        private var lassoSeeds: Set<UInt32> = []
        /// Kopierte Striche (alle Hefte dieser Sitzung), mit ihren Kerndaten.
        private static var clipboard: [(stroke: PKStroke, data: HeftStroke)] = []
        private var papers: [String: HeftPaperView] = [:]
        private var inks: [String: HeftInkView] = [:]
        private let hold = HoldWatcher(target: nil, action: nil)

        // MARK: Geladene Seiten

        /// Daten der geladenen Seiten (Bilder, Textfelder, Papier; Striche nur beim Laden).
        private var loaded: [String: HeftPageData] = [:]
        private var loading: Set<String> = []
        /// Seiten, deren Bilder/Textfelder gerade angezeigt werden.
        private var objectPages: [String] = []
        /// Seite je Bild- bzw. Textfeld-ID (für Auswahl, Verschieben, Löschen).
        private var objectPage: [String: String] = [:]
        private var loadedRevision = -1
        private var imageLoad: Task<Void, Never>?

        private var applying = false
        private var fitted = false
        private var lastWidth: CGFloat = 0

        /// Bekannte Striche je PencilKit-Schlüssel (`randomSeed`): Kern-ID, Seite, Daten und Lage beim letzten
        /// Abgleich. Die Punkte in `data` sind Seitenkoordinaten; `drawn` ist die Lage, in der sie gelten
        /// (geladen: Identität; neu geschrieben: Lage beim Schreiben). Verschieben ändert nur `transform`.
        private struct Known {
            var id: String
            var page: String
            var data: HeftStroke
            var transform: CGAffineTransform
            var bounds: CGRect
            var drawn: CGAffineTransform
        }
        private var known: [UInt32: Known] = [:]
        /// Gelöschte Striche, damit „Rückgängig“ nach dem Radieren die Originaldaten wiederherstellt.
        private var removed: [UInt32: (page: String, data: HeftStroke)] = [:]
        /// Neue Stiftstriche, die erst nach dem Loslassen geschrieben werden (Formerkennung braucht das Halten).
        private var pending: [PKStroke] = []
        /// Noch nicht geschriebene Strich-Änderungen je Seite. Wie `scheduleSave` in heft.js der PWA: 350 ms
        /// nach der letzten Änderung *ein* Event je Seite (`heftCommitStrokes`) statt eines je Strich.
        private var batchAdd: [String: [HeftStroke]] = [:]
        private var batchRemove: [String: [String]] = [:]
        private var flushTask: Task<Void, Never>?
        private static let flushDelay: Duration = .milliseconds(350)
        /// Kern-Schreiben und -Lesen in fester Reihenfolge im Hintergrund: Der Stift wartet nie auf die
        /// Kern-Sperre, und eine geladene Seite enthält immer alles vorher Geschriebene.
        private let writer = DispatchQueue(label: "impala.heft.write", qos: .userInitiated)
        private var resignObserver: NSObjectProtocol?

        /// Zuletzt übernommenes Werkzeug der Leiste.
        private var appliedTools: HeftToolSetting?

        /// Werkzeug, Nur-Stift und Lineal aus der Leiste übernehmen (nur bei Änderung).
        func apply(_ s: HeftToolSetting) {
            guard s != appliedTools, let canvas else { return }
            appliedTools = s
            canvas.tool = s.pkTool
            // Eigenes Lasso statt PencilKits: PencilKit zeichnet dann nichts.
            let lassoOn = s.tool == .lasso
            canvas.drawingGestureRecognizer.isEnabled = !lassoOn && s.tool != .laser
            if !lassoOn { clearLasso() }
            lasso.active = lassoOn
            laser.active = s.tool == .laser
            // Lasso/Laser: der Stift (und ein Finger, falls er zeichnen darf) gehört ihnen, Scrollen bleibt
            // beim Finger bzw. bei zwei Fingern – wie beim Schreiben.
            let pan = canvas.panGestureRecognizer
            if lassoOn || s.tool == .laser {
                if panDefaults == nil { panDefaults = (pan.allowedTouchTypes, pan.minimumNumberOfTouches) }
                pan.allowedTouchTypes = [NSNumber(value: UITouch.TouchType.direct.rawValue)]
                pan.minimumNumberOfTouches = s.onlyPen ? 1 : 2
            } else if let d = panDefaults {
                pan.allowedTouchTypes = d.types
                pan.minimumNumberOfTouches = d.min
                panDefaults = nil
            }
            canvas.drawingPolicy = s.onlyPen ? .pencilOnly : .anyInput
            canvas.isRulerActive = s.ruler
        }

        // MARK: Apple Pencil

        func pencilInteraction(_ interaction: UIPencilInteraction, didReceiveTap tap: UIPencilInteraction.Tap) {
            HeftTools.shared.pencil(UIPencilInteraction.preferredTapAction)
        }

        func pencilInteraction(_ interaction: UIPencilInteraction, didReceiveSqueeze squeeze: UIPencilInteraction.Squeeze) {
            guard squeeze.phase == .ended else { return }
            HeftTools.shared.pencil(UIPencilInteraction.preferredSqueezeAction)
        }

        // MARK: Rückgängig

        func undo() {
            canvas?.undoManager?.undo()
            refreshUndo()
        }

        func redo() {
            canvas?.undoManager?.redo()
            refreshUndo()
        }

        /// Knöpfe der Leiste nachführen; nach dem Lauf, weil PencilKit den Schritt erst danach abschließt.
        private func refreshUndo() {
            DispatchQueue.main.async { [weak self] in
                guard let self, let link = self.link else { return }
                let m = self.canvas?.undoManager
                if link.canUndo != (m?.canUndo ?? false) { link.canUndo = m?.canUndo ?? false }
                if link.canRedo != (m?.canRedo ?? false) { link.canRedo = m?.canRedo ?? false }
            }
        }

        /// Farbe des aktuellen Stifts bzw. Markers (für neue Textfelder), sonst Schwarz.
        var currentColor: String {
            (canvas?.tool as? PKInkingTool)?.color.cssHex ?? HeftPalette.colors[0].css
        }

        init(core: ImpalaCore, pageId: String, initialPageId: String?) {
            self.core = core
            self.pageId = pageId
            self.initialPageId = initialPageId
        }

        func attach(_ canvas: PKCanvasView) {
            self.canvas = canvas
            for v in [under, paperBox, inkBox] {
                v.isUserInteractionEnabled = false
                v.backgroundColor = .clear
            }
            under.addSubview(paperBox)
            under.addSubview(images)
            under.addSubview(inkBox)
            canvas.insertSubview(under, at: 0)
            canvas.addSubview(texts)
            canvas.addSubview(select)
            canvas.addSubview(lasso)
            canvas.addSubview(laser)
            canvas.addGestureRecognizer(laser.draw)
            canvas.panGestureRecognizer.require(toFail: lasso.pan)
            canvas.addGestureRecognizer(lasso.draw)
            canvas.addGestureRecognizer(lasso.tap)
            lasso.onLasso = { [weak self] polygon in self?.lassoSelect(polygon) }
            lasso.onBegin = { [weak self] in self?.lassoSnapshot() }
            lasso.onCommit = { [weak self] t in self?.lassoCommit(t) }
            lasso.onClear = { [weak self] in self?.clearLasso() }
            // Ziehen auf der Auswahl verschiebt sie; sonst scrollt die Fläche.
            canvas.panGestureRecognizer.require(toFail: select.pan)
            select.onSelect = { [weak self] item in self?.link?.selection = item }
            select.onPreview = { [weak self] item, frame in self?.preview(item, frame) }
            select.onCommit = { [weak self] item, frame in self?.commit(item, frame) }
            select.onEditText = { [weak self] id in self?.editText(id) }
            // Direkt auswählen: Fingertipp (Finger zeichnet nicht) bzw. Halten; der Stift zeichnet immer.
            select.drawingRecognizer = canvas.drawingGestureRecognizer
            select.fingerDraws = { [weak canvas] in
                guard let canvas else { return false }
                switch canvas.drawingPolicy {
                case .anyInput: return true
                case .pencilOnly: return false
                default: return !UIPencilInteraction.prefersPencilOnlyDrawing
                }
            }
            lasso.fingerDraws = select.fingerDraws
            laser.fingerDraws = select.fingerDraws
            select.onHoldBegan = { [weak canvas] in
                // Ab- und wieder Anschalten bricht den angefangenen Strich bzw. das Scrollen dieses Fingers ab.
                guard let canvas else { return }
                for g in [canvas.drawingGestureRecognizer, canvas.panGestureRecognizer] {
                    g.isEnabled = false
                    g.isEnabled = true
                }
            }
            canvas.addGestureRecognizer(select.canvasTap)
            canvas.addGestureRecognizer(select.canvasHold)
            hold.cancelsTouchesInView = false
            hold.delaysTouchesBegan = false
            hold.delaysTouchesEnded = false
            hold.delegate = hold
            canvas.addGestureRecognizer(hold)
            // Wie `visibilitychange`/`pagehide` in heft.js: beim Verlassen der App sofort schreiben.
            resignObserver = NotificationCenter.default.addObserver(
                forName: UIApplication.willResignActiveNotification, object: nil, queue: .main
            ) { [weak self] _ in MainActor.assumeIsolated { self?.flush() } }
            DispatchQueue.main.async { [weak canvas] in canvas?.becomeFirstResponder() }
        }

        // MARK: Seiten setzen, laden, neu laden

        /// Seitenliste und Revision aus SwiftUI. Neue Reihenfolge: alles neu anordnen; neue Revision
        /// (fremde Änderung, Papier, Import): geladene Seiten neu lesen.
        func setPages(_ ids: [String], revision: Int) {
            if ids != order {
                relayout(ids)
                loadedRevision = revision
                return
            }
            guard revision != loadedRevision else { return }
            loadedRevision = revision
            reloadLoaded()
        }

        /// Seiten neu anordnen: Papier für alle Seiten, Striche und Ebenen der geladenen Seiten neu laden
        /// (ihre Lage hat sich verschoben). Ungeschriebenes geht vorher in die Schreib-Warteschlange; das
        /// Laden läuft dahinter und enthält es deshalb.
        private func relayout(_ ids: [String]) {
            flush()
            order = ids
            slot = Dictionary(ids.enumerated().map { ($0.element, $0.offset) }, uniquingKeysWith: { a, _ in a })
            guard let canvas else { return }
            imageLoad?.cancel()
            loaded.removeAll()
            loading.removeAll()
            known.removeAll()
            removed.removeAll()
            pending.removeAll()
            objectPages = []
            objectPage.removeAll()
            for v in inks.values { v.removeFromSuperview() }
            inks.removeAll()
            applying = true
            canvas.drawing = PKDrawing()
            applying = false
            // Alte Schritte zeigten nach dem Umordnen auf falsche Stellen.
            canvas.undoManager?.removeAllActions()
            refreshUndo()
            for (id, v) in papers where slot[id] == nil {
                v.removeFromSuperview()
                papers[id] = nil
            }
            for (i, id) in ids.enumerated() {
                let v: HeftPaperView
                if let existing = papers[id] {
                    v = existing
                } else {
                    v = HeftPaperView()
                    v.configure(size: Self.pageSize, paper: "blank")
                    paperBox.addSubview(v)
                    papers[id] = v
                }
                v.origin = origin(i)
                v.setNumber(i + 1)
            }
            images.configure(size: contentSize, pages: []) { _ in nil }
            texts.configure(size: contentSize, pages: []) { _ in nil }
            select.configure(size: contentSize, pages: [])
            lasso.configure(size: contentSize)
            laser.configure(size: contentSize)
            clearLasso()
            let z = canvas.zoomScale
            canvas.contentSize = CGSize(width: contentSize.width * z, height: contentSize.height * z)
            layoutPage()
            if let target = pendingScroll, slot[target.id] != nil {
                pendingScroll = nil
                scroll(to: target.id, animated: target.animated)
            }
            windowChanged()
        }

        /// Geladene Seiten neu lesen (fremde Änderung, Bilder/Textfelder, Papier).
        func reload() {
            reloadLoaded()
        }

        /// Seiten in der Nähe sofort neu lesen; weiter entfernte gelten als veraltet und werden neu gelesen,
        /// sobald man wieder hinscrollt (sonst läse jede fremde Änderung alle je besuchten Seiten).
        private func reloadLoaded() {
            let near = visibleRange().map { Set(clamped($0.lowerBound - 2, $0.upperBound + 2)) } ?? []
            for id in loaded.keys where !near.contains(id) { loaded[id] = nil }
            load(order.filter { loaded[$0] != nil }, force: true)
        }

        /// Seiten im Hintergrund aus dem Kern lesen – hinter allem schon Geschriebenen – und anzeigen.
        private func load(_ ids: [String], force: Bool = false) {
            let need = ids.filter { (force || loaded[$0] == nil) && !loading.contains($0) }
            guard !need.isEmpty else { return }
            flush()
            loading.formUnion(need)
            let (core, pageId) = (core, pageId)
            let done = Profiler.shared.begin("heft.load")
            writer.async {
                let datas = need.compactMap { hid in attempt("heftPage", { try core.heftPage(pageId: pageId, heftPageId: hid) }) }
                DispatchQueue.main.async { [weak self] in
                    done()
                    guard let self else { return }
                    self.loading.subtract(need)
                    self.apply(datas)
                }
            }
        }

        /// Gelesene Seiten anzeigen: ihre Striche in der Zeichnung ersetzen (Unverändertes bleibt, damit
        /// PencilKit nicht alles neu zeichnet), Papier, Bilder, Textfelder und sichtbare Striche nachziehen.
        private func apply(_ datas: [HeftPageData]) {
            guard let canvas else { return }
            let fresh = datas.filter { slot[$0.id] != nil }
            guard !fresh.isEmpty else { return }
            let pages = Set(fresh.map(\.id))
            for d in fresh { loaded[d.id] = d }
            let current = canvas.drawing.strokes
            let old = known
            var out: [PKStroke] = []
            out.reserveCapacity(current.count)
            var reusable: [UInt32: PKStroke] = [:]
            var freshInk: [String: [(id: String, pk: PKStroke)]] = [:]
            for pk in current {
                guard let k = old[pk.randomSeed], pages.contains(k.page) else {
                    out.append(pk)
                    continue
                }
                if HeftInk.isHidden(pk) {
                    if pk.transform == .identity { reusable[pk.randomSeed] = pk }
                } else {
                    freshInk[k.page, default: []].append((id: k.id, pk: pk))
                }
                known[pk.randomSeed] = nil
            }
            for d in fresh {
                let o = origin(of: d.id)
                var ids = Set<String>()
                for s in d.strokes {
                    ids.insert(s.id)
                    let seed = HeftInk.seed(s.id)
                    if let k = old[seed], k.page == d.id, k.data == s, k.transform == .identity, let pk = reusable[seed] {
                        out.append(pk)
                        known[seed] = k
                        continue
                    }
                    guard let pk = HeftInk.pkStroke(s, seed: seed, hidden: true, offset: o) else { continue }
                    out.append(pk)
                    known[seed] = Known(id: s.id, page: d.id, data: s, transform: .identity, bounds: pk.renderBounds, drawn: .identity)
                }
                // Frische Striche dieser Sitzung, die der gelesene Stand nicht enthält, bleiben stehen.
                for f in freshInk[d.id] ?? [] where !ids.contains(f.id) {
                    out.append(f.pk)
                    known[f.pk.randomSeed] = old[f.pk.randomSeed]
                }
                papers[d.id]?.configure(size: Self.pageSize, paper: d.paper)
            }
            let unchanged = out.count == current.count && zip(out, current).allSatisfy { $0.randomSeed == $1.randomSeed }
            if !unchanged {
                applying = true
                canvas.drawing = PKDrawing(strokes: out)
                applying = false
            }
            if let r = visibleRange() { _ = syncInkViews(r) }
            refreshObjects(force: true)
            updateInk()
            layoutPage()
            viewportChanged()
        }

        // MARK: Sichtbarer Bereich

        /// Erste und letzte (teilweise) sichtbare Seite.
        private func visibleRange() -> ClosedRange<Int>? {
            guard let canvas, !order.isEmpty, canvas.bounds.height > 0 else { return nil }
            let z = max(canvas.zoomScale, 0.01)
            let top = canvas.contentOffset.y / z
            let bottom = (canvas.contentOffset.y + canvas.bounds.height) / z
            let last = order.count - 1
            let a = min(max(Int(floor(top / Self.step)), 0), last)
            let b = min(max(Int(floor(bottom / Self.step)), 0), last)
            return min(a, b)...max(a, b)
        }

        private func clamped(_ lo: Int, _ hi: Int) -> [String] {
            let a = max(lo, 0), b = min(hi, order.count - 1)
            guard a <= b else { return [] }
            return Array(order[a...b])
        }

        /// Nach Scrollen und Zoomen: Seiten in der Nähe laden, sichtbare Striche nur für die nahen Seiten
        /// halten (Bitmaps kosten Speicher), aktuelle Seite melden.
        private func windowChanged() {
            guard let r = visibleRange() else { return }
            load(clamped(r.lowerBound - 2, r.upperBound + 2))
            if syncInkViews(r) { updateInk() }
            refreshObjects(force: false)
            viewportChanged()
            reportCurrent()
        }

        /// Sichtbare Striche: Ebene anlegen für sichtbar ± 1 (geladene Seiten), entfernen erst außerhalb ± 2.
        /// Gibt zurück, ob eine Ebene hinzugekommen ist.
        private func syncInkViews(_ r: ClosedRange<Int>) -> Bool {
            let keep = Set(clamped(r.lowerBound - 2, r.upperBound + 2))
            var added = false
            for id in clamped(r.lowerBound - 1, r.upperBound + 1) where inks[id] == nil && loaded[id] != nil {
                let v = HeftInkView()
                v.origin = origin(of: id)
                v.configure(size: Self.pageSize)
                v.follow(zoom: canvas?.zoomScale ?? 1)
                inkBox.addSubview(v)
                inks[id] = v
                added = true
            }
            for (id, v) in inks where !keep.contains(id) {
                v.removeFromSuperview()
                inks[id] = nil
            }
            return added
        }

        private func reportCurrent() {
            guard let canvas, !order.isEmpty else { return }
            let z = max(canvas.zoomScale, 0.01)
            let center = CGPoint(x: 0, y: (canvas.contentOffset.y + canvas.bounds.height / 2) / z)
            guard let id = pageAt(center), id != currentPage else { return }
            currentPage = id
            onCurrentPage?(id)
        }

        /// Bilder, Textfelder und Auswahl der geladenen Seiten in der Nähe zeigen.
        private func refreshObjects(force: Bool) {
            guard let r = visibleRange() else { return }
            let ids = clamped(r.lowerBound - 2, r.upperBound + 2).filter { loaded[$0] != nil }
            guard force || ids != objectPages else { return }
            objectPages = ids
            let placed = ids.compactMap { id in loaded[id].map { HeftPlaced(origin: origin(of: id), data: $0) } }
            objectPage.removeAll()
            for p in placed {
                for im in p.data.images { objectPage[im.id] = p.data.id }
                for t in p.data.texts { objectPage[t.id] = p.data.id }
            }
            showImages(placed)
            texts.configure(size: contentSize, pages: placed) { _ in nil }
            select.configure(size: contentSize, pages: placed)
            if link?.selection != select.selected {
                let kept = select.selected
                DispatchQueue.main.async { [weak self] in self?.link?.selection = kept }
            }
            layoutPage()
        }

        /// Bilder zeigen. Schon dekodierte sofort; fehlende werden im Hintergrund dekodiert und danach
        /// ergänzt – vorher hielt das Dekodieren großer Scans/PDF-Seiten den Hauptthread an.
        private func showImages(_ placed: [HeftPlaced]) {
            imageLoad?.cancel()
            imageLoad = nil
            let scale = canvas?.traitCollection.displayScale ?? 2
            let size = contentSize
            let pixels = { (im: HeftImage) in min(4096, Int(max(im.w, im.h) * scale * 2)) }
            images.configure(size: size, pages: placed) { im in HeftImages.cached(im, maxPixels: pixels(im)) }
            var missing: [(page: String, image: HeftImage)] = []
            for p in placed {
                for im in p.data.images where HeftImages.cached(im, maxPixels: pixels(im)) == nil {
                    missing.append((page: p.data.id, image: im))
                }
            }
            guard !missing.isEmpty else { return }
            let (core, pageId) = (core, pageId)
            imageLoad = Task { [weak self] in
                for m in missing {
                    _ = await HeftImages.load(core: core, pageId: pageId, heftPageId: m.page, image: m.image, maxPixels: pixels(m.image))
                    if Task.isCancelled { return }
                }
                guard let self, !Task.isCancelled else { return }
                self.images.configure(size: size, pages: placed) { im in HeftImages.cached(im, maxPixels: pixels(im)) }
                self.layoutPage()
            }
        }

        /// Sichtbare Striche nachziehen: gespeicherte (in PencilKit durchsichtige) Striche je Seite in
        /// Zeichenreihenfolge, mit ihren Kerndaten und der Lage seit dem Laden (Lasso-Verschieben).
        private func updateInk(hiding hidden: Set<UInt32> = []) {
            guard let canvas, !inks.isEmpty else { return }
            var lists: [String: [(data: HeftStroke, transform: CGAffineTransform)]] = [:]
            for stroke in canvas.drawing.strokes where HeftInk.isHidden(stroke) && !hidden.contains(stroke.randomSeed) {
                guard let k = known[stroke.randomSeed], inks[k.page] != nil else { continue }
                let t: CGAffineTransform = k.drawn == stroke.transform ? .identity : k.drawn.inverted().concatenating(stroke.transform)
                lists[k.page, default: []].append((data: k.data, transform: t))
            }
            for (id, v) in inks { v.update(lists[id] ?? []) }
        }

        /// Sichtbaren Ausschnitt an die Seiten melden (scharfe Detail-Bitmap beim Zoomen).
        private func viewportChanged() {
            guard let canvas else { return }
            let z = max(canvas.zoomScale, 0.01)
            let visible = CGRect(x: canvas.contentOffset.x / z, y: canvas.contentOffset.y / z,
                                 width: canvas.bounds.width / z, height: canvas.bounds.height / z)
            let scale = canvas.traitCollection.displayScale
            for (id, v) in inks {
                let o = origin(of: id)
                v.viewportChanged(visible: visible.offsetBy(dx: -o.x, dy: -o.y), displayScale: scale)
            }
        }

        // MARK: Zoom und Scrollen

        /// Nach jedem Layout des Canvas (auch bei jedem Scroll-Bild): einmal einpassen, bei neuer Breite zentrieren.
        func layoutChanged() {
            guard let canvas, canvas.bounds.width > 0 else { return }
            let widthChanged = canvas.bounds.width != lastWidth
            if widthChanged {
                lastWidth = canvas.bounds.width
                // Zoomgrenzen wie `ZOOM_MIN`/`ZOOM_MAX` der PWA: 0,4× bis 6× der Passbreite.
                let fit = (canvas.bounds.width - 2 * Self.gutter) / Self.pageSize.width
                if fit > 0 {
                    canvas.minimumZoomScale = fit * 0.4
                    canvas.maximumZoomScale = fit * 6
                }
            }
            fitWidth()
            if widthChanged {
                layoutPage()
                windowChanged()
            }
        }

        /// Beim ersten Anzeigen die Seitenbreite einpassen (mit Rand wie die Arbeitsfläche der PWA) und die
        /// Startseite zeigen.
        private func fitWidth() {
            guard !fitted, let canvas, canvas.bounds.width > 0, !order.isEmpty else { return }
            fitted = true
            let scale = (canvas.bounds.width - 2 * Self.gutter) / Self.pageSize.width
            canvas.setZoomScale(scale, animated: false)
            canvas.contentSize = CGSize(width: contentSize.width * scale, height: contentSize.height * scale)
            layoutPage()
            if let target = pendingScroll, slot[target.id] != nil {
                pendingScroll = nil
                scroll(to: target.id, animated: false)
            } else if let id = initialPageId, slot[id] != nil, slot[id] != 0 {
                scroll(to: id, animated: false)
            } else {
                canvas.contentOffset = CGPoint(x: -canvas.contentInset.left, y: -canvas.contentInset.top)
            }
            initialPageId = nil
            windowChanged()
        }

        /// Zu einer Seite springen (Blättern ‹ ›, Seitenübersicht, neue Seite): Seite mittig wie `go()` der PWA.
        func scroll(to id: String, animated: Bool) {
            guard let canvas, let i = slot[id], canvas.bounds.height > 0 else {
                pendingScroll = (id: id, animated: animated)
                return
            }
            let z = canvas.zoomScale
            let o = origin(i)
            let y = (o.y + Self.pageSize.height / 2) * z - canvas.bounds.height / 2
            let minY = -canvas.contentInset.top
            let maxY = max(minY, canvas.contentSize.height + canvas.contentInset.bottom - canvas.bounds.height)
            currentPage = id
            canvas.setContentOffset(CGPoint(x: canvas.contentOffset.x, y: min(max(y, minY), maxY)), animated: animated)
        }

        /// Doppeltipp wie `heft-viewport.js`: ab 1,9× zurück auf Passbreite, sonst auf mindestens 2,2×
        /// (bzw. 1,8× des jetzigen Zooms) um den getippten Punkt. Die Faktoren gelten wie in der PWA
        /// relativ zur Passbreite (dort `view.k = 1`).
        @objc func handleDoubleTap(_ gesture: UITapGestureRecognizer) {
            guard let canvas, canvas.bounds.width > 0, canvas.bounds.height > 0 else { return }
            let fit = (canvas.bounds.width - 2 * Self.gutter) / Self.pageSize.width
            guard fit > 0 else { return }
            let current = canvas.zoomScale
            let k = current / fit
            let target = k >= 1.9 ? fit : min(canvas.maximumZoomScale, fit * max(2.2, k * 1.8))
            // `zoom(to:)` erwartet ungezoomte Koordinaten; der Tipp liegt in gezoomten Inhaltskoordinaten.
            let p = gesture.location(in: canvas)
            let pt = CGPoint(x: p.x / current, y: p.y / current)
            let w = canvas.bounds.width / target, h = canvas.bounds.height / target
            canvas.zoom(to: CGRect(x: pt.x - w / 2, y: pt.y - h / 2, width: w, height: h), animated: true)
        }

        /// Ebenen mitzoomen und die Seiten mittig halten, solange sie schmaler als der Canvas sind.
        private func layoutPage() {
            guard let canvas else { return }
            let z = canvas.zoomScale
            for v in papers.values { v.follow(zoom: z) }
            for v in inks.values { v.follow(zoom: z) }
            images.follow(zoom: z)
            texts.follow(zoom: z)
            select.follow(zoom: z)
            lasso.follow(zoom: z)
            laser.follow(zoom: z)
            let w = Self.pageSize.width * z
            let side = max(Self.gutter, (canvas.bounds.width - w) / 2)
            let inset = UIEdgeInsets(top: Self.topInset, left: side, bottom: Self.gutter + 80, right: side)
            if canvas.contentInset != inset { canvas.contentInset = inset }
        }

        func scrollViewDidZoom(_ scrollView: UIScrollView) {
            layoutPage()
            windowChanged()
        }

        func scrollViewDidScroll(_ scrollView: UIScrollView) { windowChanged() }

        /// Hochziehen am Ende: neue Seite (`bindPullToAdd` in heft.js, ab 70 px).
        func scrollViewDidEndDragging(_ scrollView: UIScrollView, willDecelerate decelerate: Bool) {
            let inset = scrollView.contentInset
            let maxY = max(-inset.top, scrollView.contentSize.height + inset.bottom - scrollView.bounds.height)
            if scrollView.contentOffset.y - maxY > 70, !order.isEmpty { onPullAdd?() }
        }

        // MARK: Abgleich Zeichnung → Kern

        /// Ein neuer Strich hebt die Auswahl auf (wie ein Stiftstrich in der PWA).
        func canvasViewDidBeginUsingTool(_ canvas: PKCanvasView) {
            clearSelection()
        }

        func canvasViewDrawingDidChange(_ canvas: PKCanvasView) {
            if !applying { sync(canvas) }
            // Radierer, Lasso, Rückgängig: die sichtbaren Striche folgen der Zeichnung (nach dem Abgleich,
            // damit neu geschriebene Striche schon ihre Kerndaten haben).
            updateInk()
            refreshUndo()
            // Rückgängig, fremde Änderung: Auswahlrahmen folgt den verbliebenen Strichen.
            if !lassoSeeds.isEmpty { refreshLasso() }
        }

        /// Vergleicht die Zeichnung mit dem letzten Stand und schreibt die Unterschiede in den Kern.
        private func sync(_ canvas: PKCanvasView) {
            let done = Profiler.shared.begin("heft.drawing-diff")
            defer { done() }
            let strokes = canvas.drawing.strokes
            var seen = Set<UInt32>()
            var moves: [String: (page: String, dx: Double, dy: Double, ids: [String])] = [:]
            var toRemove: [(page: String, id: String)] = []

            for stroke in strokes {
                let seed = stroke.randomSeed
                seen.insert(seed)
                if var k = known[seed] {
                    // Unverändert, verschoben (Lasso) oder anders geändert → neu schreiben. Ohne Maske
                    // (Pixel-Radierer) und mit gleicher Lage ist der Strich unverändert – `renderBounds` für
                    // jeden Strich nach jedem neuen Strich kostete bei vollen Seiten spürbar Zeit.
                    let t = stroke.transform
                    if t == k.transform && stroke.mask == nil { continue }
                    let bounds = stroke.renderBounds
                    if t == k.transform && bounds == k.bounds { continue }
                    let rel = k.transform.inverted().concatenating(t)
                    let shifted = k.bounds.offsetBy(dx: bounds.minX - k.bounds.minX, dy: bounds.minY - k.bounds.minY)
                    if t != k.transform, rel.a == 1, rel.b == 0, rel.c == 0, rel.d == 1, shifted.size == bounds.size {
                        let key = "\(k.page)|\(rel.tx)|\(rel.ty)"
                        moves[key, default: (page: k.page, dx: Double(rel.tx), dy: Double(rel.ty), ids: [])].ids.append(k.id)
                        k.transform = t
                        k.bounds = bounds
                        known[seed] = k
                    } else {
                        toRemove.append((page: k.page, id: k.id))
                        known[seed] = nil
                        addStroke(stroke, original: (page: k.page, data: k.data))
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
                toRemove.append((page: k.page, id: k.id))
                removed[seed] = (page: k.page, data: k.data)
                known[seed] = nil
            }
            if !toRemove.isEmpty { removeStrokes(toRemove) }
            if !moves.isEmpty {
                // Verschieben braucht die Striche im Kern: erst das Gesammelte, dann die Verschiebung.
                flush()
                for move in moves.values {
                    write { core, pageId in
                        _ = attempt("heftMoveStrokes", { try core.heftMoveStrokes(pageId: pageId, heftPageId: move.page, ids: move.ids, dx: move.dx, dy: move.dy) })
                    }
                }
                for page in Set(moves.values.map { $0.page }) { HeftOcr.schedule(core: core, pageId: pageId, heftPageId: page) }
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

        /// Seite, auf der ein Strich beginnt.
        private func pageOf(_ stroke: PKStroke) -> String? {
            guard let first = stroke.path.first else { return nil }
            return pageAt(first.location.applying(stroke.transform))
        }

        private func replaceWithShape(_ stroke: PKStroke, in canvas: PKCanvasView) -> Bool {
            guard let page = pageOf(stroke) else { return false }
            let o = origin(of: page)
            let c = HeftInk.coreStroke(stroke, toolWidth: (canvas.tool as? PKInkingTool)?.width ?? HeftPalette.size, offset: o)
            guard let shape = heftFitShape(points: c.points),
                  let edit = attempt("heftAddShape", { try core.heftAddShape(pageId: pageId, heftPageId: page, color: c.color, size: c.size, shape: shape) }),
                  let id = edit.ids.first
            else { return false }
            let data = HeftStroke(id: id, tool: "shape", color: c.color, size: c.size, points: [], shape: shape)
            let seed = HeftInk.seed(id)
            guard let pk = HeftInk.pkStroke(data, seed: seed, hidden: true, offset: o) else { return false }
            // Erst merken, dann tauschen: so bleibt der Abgleich richtig, egal wann PencilKit die Änderung meldet.
            known[seed] = Known(id: id, page: page, data: data, transform: .identity, bounds: pk.renderBounds, drawn: .identity)
            var all = canvas.drawing.strokes
            if let i = all.firstIndex(where: { $0.randomSeed == stroke.randomSeed }) { all[i] = pk } else { all.append(pk) }
            applying = true
            canvas.drawing = PKDrawing(strokes: all)
            applying = false
            updateInk()
            HeftOcr.schedule(core: core, pageId: pageId, heftPageId: page)
            if AppHaptics.isEnabled { UIImpactFeedbackGenerator(style: .light).impactOccurred() }
            return true
        }

        // MARK: Lasso (HeftLasso.swift)

        /// Striche, die überwiegend im Lasso liegen, auswählen.
        private func lassoSelect(_ polygon: [CGPoint]) {
            guard let canvas else { return }
            var minX = CGFloat.infinity, minY = CGFloat.infinity, maxX = -CGFloat.infinity, maxY = -CGFloat.infinity
            for p in polygon {
                minX = min(minX, p.x); minY = min(minY, p.y); maxX = max(maxX, p.x); maxY = max(maxY, p.y)
            }
            let bounds = CGRect(x: minX, y: minY, width: maxX - minX, height: maxY - minY)
            lassoSeeds = Set(canvas.drawing.strokes.filter { stroke in
                known[stroke.randomSeed] != nil && stroke.renderBounds.intersects(bounds) && HeftLassoLayer.contains(polygon, stroke: stroke)
            }.map(\.randomSeed))
            refreshLasso()
        }

        private func lassoStrokes() -> [PKStroke] {
            guard let canvas, !lassoSeeds.isEmpty else { return [] }
            return canvas.drawing.strokes.filter { lassoSeeds.contains($0.randomSeed) }
        }

        /// Rahmen um die ausgewählten Striche zeigen und die Leiste nachführen.
        private func refreshLasso() {
            let list = lassoStrokes()
            lassoSeeds = Set(list.map(\.randomSeed))
            lasso.show(list.isEmpty ? nil : list.reduce(CGRect.null) { $0.union($1.renderBounds) })
            if link?.lassoCount != list.count { link?.lassoCount = list.count }
        }

        func clearLasso() {
            guard !lassoSeeds.isEmpty || lasso.box != nil else { return }
            lassoSeeds = []
            lasso.show(nil)
            if link?.lassoCount != 0 { link?.lassoCount = 0 }
        }

        /// Sichtbare Tinte der Auswahl als Bild (Vorschau beim Ziehen); die Originale werden so lange ausgeblendet.
        private func lassoSnapshot() -> UIImage? {
            guard let canvas, let box = lasso.box else { return nil }
            var visible: [PKStroke] = []
            for s in lassoStrokes() {
                guard let k = known[s.randomSeed],
                      var v = HeftInk.pkStroke(k.data, seed: s.randomSeed, offset: origin(of: k.page)) else { continue }
                let t: CGAffineTransform = k.drawn == s.transform ? .identity : k.drawn.inverted().concatenating(s.transform)
                v.transform = v.transform.concatenating(t)
                visible.append(v)
            }
            let scale = min(canvas.traitCollection.displayScale * canvas.zoomScale, 4)
            let image = PKDrawing(strokes: visible).image(from: box, scale: scale)
            updateInk(hiding: lassoSeeds)
            return image
        }

        /// Verschieben/Skalieren übernehmen: über die Zeichnung, damit der Abgleich schreibt und Rückgängig greift.
        private func lassoCommit(_ t: CGAffineTransform) {
            guard let canvas else { return }
            guard !t.isIdentity else {
                updateInk()
                refreshLasso()
                return
            }
            var all = canvas.drawing.strokes
            for i in all.indices where lassoSeeds.contains(all[i].randomSeed) {
                all[i].transform = all[i].transform.concatenating(t)
            }
            setDrawing(PKDrawing(strokes: all))
            refreshLasso()
        }

        /// Zeichnung setzen wie eine Änderung mit dem Stift: Abgleich schreibt in den Kern, Rückgängig stellt her.
        private func setDrawing(_ drawing: PKDrawing) {
            guard let canvas else { return }
            let old = canvas.drawing
            canvas.undoManager?.registerUndo(withTarget: self) { me in me.setDrawing(old) }
            canvas.drawing = drawing
        }

        func lassoDelete() {
            guard let canvas, !lassoSeeds.isEmpty else { return }
            let keep = canvas.drawing.strokes.filter { !lassoSeeds.contains($0.randomSeed) }
            clearLasso()
            setDrawing(PKDrawing(strokes: keep))
        }

        func lassoCopy() {
            Self.clipboard = lassoStrokes().compactMap { s in known[s.randomSeed].map { (stroke: s, data: $0.data) } }
            link?.canPaste = !Self.clipboard.isEmpty
        }

        func lassoCut() {
            lassoCopy()
            lassoDelete()
        }

        /// Auswahl versetzt kopieren; die Kopie ist danach ausgewählt.
        func lassoDuplicate() {
            let items = lassoStrokes().compactMap { s in known[s.randomSeed].map { (stroke: s, data: $0.data) } }
            insert(items, by: CGPoint(x: 30, y: 30))
        }

        /// Kopierte Striche mittig in den sichtbaren Ausschnitt einfügen.
        func lassoPaste() {
            guard let canvas, !Self.clipboard.isEmpty else { return }
            let z = max(canvas.zoomScale, 0.01)
            let c = CGPoint(x: (canvas.contentOffset.x + canvas.bounds.width / 2) / z,
                            y: (canvas.contentOffset.y + canvas.bounds.height / 2) / z)
            let b = Self.clipboard.reduce(CGRect.null) { $0.union($1.stroke.renderBounds) }
            insert(Self.clipboard, by: CGPoint(x: c.x - b.midX, y: c.y - b.midY))
        }

        private func insert(_ items: [(stroke: PKStroke, data: HeftStroke)], by d: CGPoint) {
            guard let canvas, !items.isEmpty else { return }
            let old = canvas.drawing
            var added: [PKStroke] = []
            for item in items {
                var c = item.stroke
                c.randomSeed = UInt32.random(in: 1...UInt32.max)
                c.transform = item.stroke.transform.concatenating(CGAffineTransform(translationX: d.x, y: d.y))
                added.append(c)
            }
            applying = true
            canvas.drawing = PKDrawing(strokes: old.strokes + added)
            applying = false
            for (c, item) in zip(added, items) {
                guard let page = pageOf(c) else { continue }
                addStroke(c, original: (page: page, data: item.data))
            }
            canvas.undoManager?.registerUndo(withTarget: self) { me in me.setDrawing(old) }
            updateInk()
            refreshUndo()
            lassoSeeds = Set(added.map(\.randomSeed))
            refreshLasso()
        }

        /// Farbe der Auswahl ändern (neu schreiben mit gleicher Lage; Rückgängig stellt die alten Farben her).
        func lassoColor(_ css: String) {
            var colors: [UInt32: String] = [:]
            for seed in lassoSeeds { colors[seed] = css }
            recolor(colors)
        }

        private func recolor(_ colors: [UInt32: String]) {
            guard let canvas else { return }
            var before: [UInt32: String] = [:]
            for s in canvas.drawing.strokes {
                guard let css = colors[s.randomSeed], let k = known[s.randomSeed], k.data.color != css else { continue }
                before[s.randomSeed] = k.data.color
                removeStrokes([(page: k.page, id: k.id)])
                known[s.randomSeed] = nil
                var data = k.data
                data.color = css
                addStroke(s, original: (page: k.page, data: data))
            }
            guard !before.isEmpty else { return }
            canvas.undoManager?.registerUndo(withTarget: self) { me in me.recolor(before) }
            updateInk()
            refreshUndo()
            for page in Set(before.keys.compactMap { known[$0]?.page }) { HeftOcr.schedule(core: core, pageId: pageId, heftPageId: page) }
        }

        // MARK: Bilder und Textfelder

        /// Seite in der Mitte des sichtbaren Ausschnitts und der Mittelpunkt dort (Seitenkoordinaten) –
        /// dort landen neue Textfelder.
        func visibleTarget() -> (heftPageId: String, point: CGPoint)? {
            guard let canvas else { return nil }
            let z = max(canvas.zoomScale, 0.01)
            let c = CGPoint(x: (canvas.contentOffset.x + canvas.bounds.width / 2) / z,
                            y: (canvas.contentOffset.y + canvas.bounds.height / 2) / z)
            guard let id = pageAt(c) else { return nil }
            let o = origin(of: id)
            let p = CGPoint(x: min(max(c.x - o.x, 0), Self.pageSize.width), y: min(max(c.y - o.y, 0), Self.pageSize.height))
            return (heftPageId: id, point: p)
        }

        /// Auswahl aufheben (Leiste „Fertig“, neuer Strich).
        func clearSelection() {
            guard select.selected != nil else { return }
            select.select(nil)
            link?.selection = nil
        }

        /// Element nach dem Einfügen auswählen (wie nach „Bild hinzufügen“ in der PWA).
        /// Die Seite wird gerade neu geladen; die Auswahl bleibt bestehen, sobald es das Element gibt.
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

        /// Verschieben/Skalieren beendet: in Seitenkoordinaten der Seite des Elements speichern.
        private func commit(_ item: HeftSelectLayer.Item, _ frame: CGRect) {
            switch item {
            case .image(let id):
                guard let page = objectPage[id] else { return }
                let f = frame.offsetBy(dx: -origin(of: page).x, dy: -origin(of: page).y)
                _ = attempt("heftSetImageFrame", { try core.heftSetImageFrame(pageId: pageId, heftPageId: page, imageId: id,
                                                x: f.minX, y: f.minY, w: f.width, h: f.height) })
                load([page], force: true)
            case .text(let id):
                guard let page = objectPage[id], var t = text(id) else { return }
                let o = origin(of: page)
                t.x = frame.minX - o.x
                t.y = frame.minY - o.y
                t.w = frame.width
                _ = attempt("heftSetText", { try core.heftSetText(pageId: pageId, heftPageId: page, text: t) })
                load([page], force: true)
            }
        }

        /// Ausgewähltes Bild bzw. Textfeld löschen.
        func deleteSelection() {
            guard let item = select.selected else { return }
            switch item {
            case .image(let id):
                guard let page = objectPage[id] else { return }
                _ = attempt("heftRemoveImages", { try core.heftRemoveImages(pageId: pageId, heftPageId: page, ids: [id]) })
                load([page], force: true)
            case .text(let id):
                removeText(id)
            }
            select.select(nil)
            link?.selection = nil
        }

        /// Textfeld nach ID (aus den geladenen Seiten).
        func text(_ id: String) -> HeftText? {
            guard let page = objectPage[id] else { return nil }
            return loaded[page]?.texts.first { $0.id == id }
        }

        /// Text eines Textfelds ändern (leer: löschen).
        func setText(_ id: String, to text: String) {
            guard let page = objectPage[id], var t = self.text(id) else { return }
            if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                removeText(id)
                return
            }
            t.text = text
            _ = attempt("heftSetText", { try core.heftSetText(pageId: pageId, heftPageId: page, text: t) })
            load([page], force: true)
        }

        func removeText(_ id: String) {
            guard let page = objectPage[id] else { return }
            _ = attempt("heftRemoveTexts", { try core.heftRemoveTexts(pageId: pageId, heftPageId: page, ids: [id]) })
            load([page], force: true)
        }

        /// Neues Textfeld mitten im sichtbaren Bereich; danach ausgewählt.
        func addText(_ text: String) {
            guard let target = visibleTarget() else { return }
            let c = target.point
            let new = attempt("heftAddText", { try core.heftAddText(pageId: pageId, heftPageId: target.heftPageId, text: text,
                                                  x: Double(c.x) - 200, y: Double(c.y) - 30, w: 400, color: currentColor, size: 30) })
            load([target.heftPageId], force: true)
            if let tid = new?.ids.first { selectAfterReload(.text(tid)) }
        }

        private func editText(_ id: String) {
            guard let t = text(id) else { return }
            link?.textEdit = HeftTextEdit(textId: t.id, text: t.text)
        }


        // MARK: Schreiben

        /// Strich in den Kern schreiben. Mit `original` (Rückgängig, gedrehter/skalierter Strich) bleiben
        /// Seite, Werkzeug, Farbe und Breite erhalten; die Punkte kommen aus der aktuellen Lage.
        private func addStroke(_ stroke: PKStroke, original: (page: String, data: HeftStroke)?) {
            guard let page = original?.page ?? pageOf(stroke), slot[page] != nil else { return }
            // Mit Original dessen Breite, damit der Druck aus den Punktbreiten richtig zurückgerechnet wird.
            let toolWidth = original.map { CGFloat($0.data.tool == "marker" ? $0.data.size * 3 : $0.data.size) }
                ?? (canvas?.tool as? PKInkingTool)?.width ?? 2.5
            var c = HeftInk.coreStroke(stroke, toolWidth: toolWidth, keepSize: original != nil, offset: origin(of: page))
            if let o = original?.data {
                c.tool = o.tool == "shape" ? "pen" : o.tool
                c.color = o.color
                c.size = o.size
            }
            guard !c.points.isEmpty else { return }
            // Kern-IDs sind kleingeschriebene UUIDs (wie `uuid::Uuid::new_v4` im Kern).
            let id = UUID().uuidString.lowercased()
            let data = HeftStroke(id: id, tool: c.tool, color: c.color, size: c.size, points: c.points, shape: nil)
            known[stroke.randomSeed] = Known(id: id, page: page, data: data, transform: stroke.transform,
                                             bounds: stroke.renderBounds, drawn: stroke.transform)
            batchAdd[page, default: []].append(data)
            scheduleFlush()
        }

        /// Striche entfernen; noch nicht geschriebene fallen einfach aus der Sammlung.
        private func removeStrokes(_ items: [(page: String, id: String)]) {
            for (page, list) in Dictionary(grouping: items, by: { $0.page }) {
                let ids = Set(list.map { $0.id })
                let unwritten = Set((batchAdd[page] ?? []).map(\.id))
                batchAdd[page]?.removeAll { ids.contains($0.id) }
                batchRemove[page, default: []] += ids.filter { !unwritten.contains($0) }
            }
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

        /// Gesammelte Strich-Änderungen jetzt als ein Event je Seite schreiben (im Hintergrund).
        func flush() {
            flushTask?.cancel()
            flushTask = nil
            let pages = Set(batchAdd.keys).union(batchRemove.keys)
            let (adds, removes) = (batchAdd, batchRemove)
            batchAdd.removeAll()
            batchRemove.removeAll()
            for page in pages {
                let add = adds[page] ?? [], remove = removes[page] ?? []
                guard !add.isEmpty || !remove.isEmpty else { continue }
                write { core, pageId in
                    _ = attempt("heftCommitStrokes", { try core.heftCommitStrokes(pageId: pageId, heftPageId: page, add: add, remove: remove) })
                }
                HeftOcr.schedule(core: core, pageId: pageId, heftPageId: page)
            }
            // Heft-Verlauf: höchstens alle 10 Minuten ein Stand, hinter den Schreibvorgängen.
            if !pages.isEmpty { write { core, pageId in HeftHistory.maybeSnapshot(core: core, pageId: pageId) } }
        }

        /// Offene Striche schreiben und `op` dahinter in der Schreib-Warteschlange ausführen, z. B. einen
        /// Stand aus dem Heft-Verlauf übernehmen: Nichts Älteres landet danach noch über dem Ergebnis.
        func afterWrites<T>(_ op: @escaping @Sendable (ImpalaCore, String) -> T) async -> T {
            flush()
            let (core, pageId) = (core, pageId)
            return await withCheckedContinuation { cont in
                writer.async { cont.resume(returning: op(core, pageId)) }
            }
        }

        /// Kern-Aufruf in der Schreib-Warteschlange (feste Reihenfolge, auch vor jedem Laden).
        private func write(_ op: @escaping @Sendable (ImpalaCore, String) -> Void) {
            let (core, pageId) = (core, pageId)
            writer.async { op(core, pageId) }
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

/// Canvas, der nach jedem Layout Bescheid gibt (erst dann ist die Breite bekannt).
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
