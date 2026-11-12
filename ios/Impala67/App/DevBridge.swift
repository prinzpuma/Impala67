import Foundation
import Observation
import UIKit

/// Live-Verbindung zum MCP-Server im WLAN wie `web/mcp-bridge.js` der PWA: Die App verbindet sich mit
/// `ws://<PC>:8766/?token=…` (Adresse aus `node mcp/lan-setup.mjs`, eingetragen unter Einstellungen →
/// App & Speicher → Für Entwickler), nimmt `{ callId, tool, args }` entgegen und antwortet mit
/// `{ callId, result }`. Leer = aus. Nur im Vordergrund verbunden.
@MainActor @Observable
final class DevBridge {
    static let shared = DevBridge()
    static let urlKey = "impala67DevBridgeURL"

    enum State: String { case off, connecting, connected }
    private(set) var state = State.off

    /// Shell der offenen Oberfläche für UI-Aktionen (setzt `ShellModel`).
    @ObservationIgnored weak var shell: ShellModel?
    @ObservationIgnored private var task: URLSessionWebSocketTask?
    @ObservationIgnored private var retry: Task<Void, Never>?
    @ObservationIgnored private var attempts = 0
    @ObservationIgnored private var connectedAt: Date?
    @ObservationIgnored private var calls = 0
    @ObservationIgnored private var foreground = false

    var url: String {
        get { UserDefaults.standard.string(forKey: Self.urlKey) ?? "" }
        set {
            UserDefaults.standard.set(newValue.trimmingCharacters(in: .whitespacesAndNewlines), forKey: Self.urlKey)
            disconnect()
            if foreground { connect() }
        }
    }

    func onForeground() {
        foreground = true
        if task == nil { connect() }
    }

    func onBackground() {
        foreground = false
        disconnect()
    }

    // MARK: Verbindung

    private func connect() {
        guard let u = URL(string: url), u.scheme == "ws" || u.scheme == "wss" else { state = .off; return }
        let t = URLSession.shared.webSocketTask(with: u)
        task = t
        state = .connecting
        t.resume()
        // Wie `claim()` der PWA: Das sichtbare Gerät übernimmt die Aufrufe.
        send(["claim": true], on: t)
        t.sendPing { [weak self] error in
            guard error == nil else { return }
            Task { @MainActor in self?.markConnected(t) }
        }
        Task { await receiveLoop(t) }
    }

    private func markConnected(_ t: URLSessionWebSocketTask) {
        guard t === task, state != .connected else { return }
        state = .connected
        connectedAt = Date()
        attempts = 0
    }

    private func disconnect() {
        retry?.cancel()
        retry = nil
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
        connectedAt = nil
        state = .off
    }

    private func receiveLoop(_ t: URLSessionWebSocketTask) async {
        while true {
            let message: URLSessionWebSocketTask.Message
            do {
                message = try await t.receive()
            } catch {
                guard t === task else { return }
                task = nil
                connectedAt = nil
                scheduleReconnect()
                return
            }
            markConnected(t)
            let data: Data? = switch message {
            case .string(let s): Data(s.utf8)
            case .data(let d): d
            @unknown default: nil
            }
            guard let data, let msg = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
                  let callId = msg["callId"], let tool = msg["tool"] as? String else { continue }
            let args = msg["args"] as? [String: Any] ?? [:]
            Task {
                let started = Date()
                let result = await handle(tool, args)
                calls += 1
                Profiler.shared.operation("bridge." + tool, durationMs: Date().timeIntervalSince(started) * 1000, thresholdMs: 1000)
                send(["callId": callId, "result": result], on: t)
            }
        }
    }

    /// Wie die PWA: 1 s · 1,5ⁿ, höchstens 15 s; nur im Vordergrund.
    private func scheduleReconnect() {
        guard foreground else { state = .off; return }
        state = .connecting
        attempts += 1
        let delay = min(1.0 * pow(1.5, Double(min(attempts, 8))), 15)
        retry?.cancel()
        retry = Task { [weak self] in
            try? await Task.sleep(for: .seconds(delay))
            guard !Task.isCancelled, let self, self.task == nil, self.foreground else { return }
            self.connect()
        }
    }

    private func send(_ body: [String: Any], on t: URLSessionWebSocketTask) {
        let fallback: [String: Any] = ["callId": body["callId"] ?? 0, "result": ["error": "Antwort nicht als JSON darstellbar"]]
        let clean = JSONSerialization.isValidJSONObject(body) ? body : fallback
        guard let data = try? JSONSerialization.data(withJSONObject: clean) else { return }
        t.send(.string(String(decoding: data, as: UTF8.self))) { _ in }
    }

    // MARK: Werkzeuge

    private func handle(_ tool: String, _ args: [String: Any]) async -> Any {
        guard let store = AppModel.shared.store else { return ["error": "Kern noch nicht geöffnet."] }
        let core = store.core
        switch tool {
        case "ping":
            return ["pong": true, "time": Int(Date().timeIntervalSince1970 * 1000)]
        case "impala_get_diagnostics":
            return diagnostics(core)
        case "impala_get_performance_trace":
            if let on = args["enable"] as? Bool { Profiler.shared.setEnabled(on) }
            let report = Profiler.shared.report()
            if args["clear"] as? Bool == true { Profiler.shared.clear() }
            var out = (try? JSONSerialization.jsonObject(with: Data(report.utf8))) as? [String: Any] ?? ["raw": report]
            out["enabled"] = Profiler.shared.isEnabled
            if args["mode"] != nil { out["note"] = "Modus „Alle Messpunkte“ gibt es auf dem iPad noch nicht – nur Auffälligkeiten." }
            return out
        case "impala_list_pages":
            let kind = args["kind"] as? String
            let query = (args["query"] as? String)?.lowercased() ?? ""
            let limit = (args["limit"] as? Int) ?? 50
            return await offMain { Self.listPages(core, kind: kind, query: query, limit: limit) }
        case "impala_get_page":
            let id = args["id"] as? String
            let title = args["title"] as? String
            return await offMain { Self.getPage(core, id: id, title: title) }
        case "impala_search":
            let query = args["query"] as? String ?? ""
            let limit = (args["limit"] as? Int) ?? 20
            let archived = args["archived"] as? Bool
            return await offMain {
                let hits = core.search(query: query, includeArchived: archived != false).prefix(limit)
                return ["query": query, "count": hits.count,
                        "results": hits.map { ["id": $0.pageId, "title": $0.title, "snippet": $0.snippet, "score": $0.score] }]
            }
        case "impala_create_page":
            let out = await offMain { Self.createPage(core, args: Self.strings(args)) }
            if let id = (out as? [String: Any])?["id"] as? String { shell?.open(id) }
            return out
        case "impala_update_page":
            let archived = args["archived"] as? Bool
            return await offMain { Self.updatePage(core, args: Self.strings(args), archived: archived) }
        case "impala_create_flashcard":
            return await offMain { Self.createFlashcard(core, args: Self.strings(args)) }
        case "impala_list_flashcards":
            let limit = (args["limit"] as? Int) ?? 50
            return await offMain { Self.listFlashcards(core, args: Self.strings(args), limit: limit) }
        case "impala_screenshot":
            return screenshot(scale: (args["scale"] as? Double) ?? 0.5)
        case "impala_run_ui_action":
            return uiAction(args, core: core)
        case "impala_ui_tree":
            await Self.enableAccessibilityTree()
            return uiTree(query: (args["query"] as? String) ?? "", interactive: args["interactive"] as? Bool ?? false,
                          limit: (args["limit"] as? Int) ?? 300)
        case "impala_tap":
            return await tap(args)
        case "impala_type":
            return typeText(args["text"] as? String ?? "", submit: args["submit"] as? Bool ?? false)
        default:
            return ["error": "Auf dem iPad nicht verfügbar: \(tool)"]
        }
    }

    private func diagnostics(_ core: ImpalaCore) -> [String: Any] {
        let device = UIDevice.current
        let info = Bundle.main.infoDictionary
        var app: [String: Any] = [
            "platform": "ipad",
            "version": (info?["CFBundleShortVersionString"] as? String ?? "") + "+" + (info?["CFBundleVersion"] as? String ?? ""),
            "device": device.model + " · " + device.systemName + " " + device.systemVersion,
            "screen": Profiler.shared.screen,
            "memoryFootprintMb": Self.memoryFootprintMb() ?? -1,
            "thermalState": ["nominal", "fair", "serious", "critical"][min(ProcessInfo.processInfo.thermalState.rawValue, 3)],
            "lowPowerMode": ProcessInfo.processInfo.isLowPowerModeEnabled,
            "pageCount": core.recentPages(limit: 100_000).count,
            "storage": ["total": AppInfo.storage, "db": AppInfo.dbBreakdown.db, "wal": AppInfo.dbBreakdown.wal],
        ]
        if let shell {
            app["activeTab"] = shell.active ?? "home"
            app["activeTitle"] = shell.active.flatMap { core.page(id: $0)?.summary.title } ?? ""
            app["openTabs"] = shell.tabs
            app["sheet"] = shell.sheet.map { "\($0)" } ?? ""
            app["libraryOpen"] = shell.libraryOpen
        }
        return [
            "bridge": [
                "status": state.rawValue,
                "connectedAt": connectedAt.map { ISO8601DateFormatter().string(from: $0) } ?? "",
                "totalCallsProcessed": calls,
            ],
            "app": app,
            "profiler": ["enabled": Profiler.shared.isEnabled, "records": Profiler.shared.snapshot().count],
            "context": Profiler.shared.context?() ?? [:],
        ]
    }

    /// Kern-Lesen im Hintergrund; das Ergebnis reist als JSON-Daten (`Sendable`) zurück.
    private func offMain(_ body: @escaping @Sendable () -> [String: Any]) async -> Any {
        let data = await Task.detached(priority: .userInitiated) { () -> Data in
            (try? JSONSerialization.data(withJSONObject: body())) ?? Data(#"{"error":"Antwort nicht als JSON darstellbar"}"#.utf8)
        }.value
        return (try? JSONSerialization.jsonObject(with: data)) ?? [:]
    }

    nonisolated private static func listPages(_ core: ImpalaCore, kind: String?, query: String, limit: Int) -> [String: Any] {
        var pages = core.recentPages(limit: 100_000)
        if let kind, kind != "all" {
            pages = pages.filter { ($0.kind == .heft ? "heft" : "notion") == kind }
        }
        if !query.isEmpty {
            pages = pages.filter { $0.title.lowercased().contains(query) }
        }
        return [
            "count": pages.count,
            "pages": pages.prefix(limit).map {
                ["id": $0.id, "title": $0.title, "kind": $0.kind == .heft ? "heft" : "notion",
                 "parentId": $0.parentId ?? "", "updated": $0.updated]
            },
            "note": "Ohne Archiv und Papierkorb.",
        ]
    }

    nonisolated private static func getPage(_ core: ImpalaCore, id: String?, title: String?) -> [String: Any] {
        var detail = id.flatMap { core.page(id: $0) }
        if detail == nil, let t = title?.lowercased() {
            detail = core.recentPages(limit: 100_000).first { $0.title.lowercased() == t }.flatMap { core.page(id: $0.id) }
        }
        guard let d = detail else { return ["error": "Notiz nicht gefunden: \(id ?? title ?? "")"] }
        var out: [String: Any] = [
            "id": d.summary.id, "title": d.summary.title, "kind": d.summary.kind == .heft ? "heft" : "notion",
            "content": d.content, "archived": d.archived, "trashed": d.trashed, "updated": d.summary.updated,
        ]
        if d.summary.kind == .heft {
            let ids = core.heftPageIds(pageId: d.summary.id)
            out["heftPages"] = ids.count
            out["strokesPerPage"] = ids.map { hid in
                attempt("heftPage", { try core.heftPage(pageId: d.summary.id, heftPageId: hid) })?.strokes.count ?? -1
            }
        }
        return out
    }

    // MARK: Schreiben (wie `web/mcp-bridge.js`)

    /// Nur die Text-Argumente, damit sie `Sendable` in den Hintergrund reisen.
    nonisolated private static func strings(_ args: [String: Any]) -> [String: String] {
        args.compactMapValues { $0 as? String }
    }

    /// Seite per ID oder (ohne Papierkorb) per Titel, Groß-/Kleinschreibung egal.
    nonisolated private static func findPage(_ core: ImpalaCore, id: String?, title: String?) -> PageDetail? {
        if let id, !id.isEmpty, let d = core.page(id: id), !d.trashed { return d }
        guard let t = title?.trimmingCharacters(in: .whitespaces).lowercased(), !t.isEmpty else { return nil }
        return core.recentPages(limit: 100_000).first { $0.title.lowercased() == t }.flatMap { core.page(id: $0.id) }
    }

    nonisolated private static func fail(_ error: Error, _ op: String) -> [String: Any] {
        ["error": "\(op) fehlgeschlagen: \(error)"]
    }

    nonisolated private static func createPage(_ core: ImpalaCore, args: [String: String]) -> [String: Any] {
        let title = (args["title"] ?? "").trimmingCharacters(in: .whitespaces)
        let name = title.isEmpty ? "Neue Notiz" : title
        let heft = args["kind"] == "heft"
        var parentId = args["parentId"].flatMap { core.page(id: $0) }?.summary.id
        if parentId == nil, let pt = args["parent_title"] {
            parentId = findPage(core, id: nil, title: pt)?.summary.id
            if parentId == nil { return ["error": "Elternseite nicht gefunden: \(pt)"] }
        }
        do {
            let id = heft
                ? try core.createHeft(title: name, parentId: parentId, workspaceId: nil)
                : try core.createPage(title: name, content: args["content"] ?? "", parentId: parentId, workspaceId: nil)
            var out: [String: Any] = ["ok": true, "id": id, "title": name, "kind": heft ? "heft" : "notion", "parentId": parentId ?? NSNull()]
            if heft, let text = args["content"]?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty,
               let first = core.heftPageIds(pageId: id).first {
                _ = try core.heftAddText(pageId: id, heftPageId: first, text: text, x: 20, y: 50, w: nil, color: nil, size: nil)
            }
            if let subject = args["subject"]?.trimmingCharacters(in: .whitespaces), !subject.isEmpty {
                try core.setPageSubject(id: id, subject: subject)
                out["subject"] = core.pageSubject(id: id)?.name ?? subject
            }
            return out
        } catch { return fail(error, "Anlegen") }
    }

    nonisolated private static func updatePage(_ core: ImpalaCore, args: [String: String], archived: Bool?) -> [String: Any] {
        guard let page = findPage(core, id: args["id"], title: args["title"]) else {
            return ["error": "Notiz nicht gefunden: \(args["id"] ?? args["title"] ?? "")"]
        }
        let id = page.summary.id
        let newTitle = args["new_title"]?.trimmingCharacters(in: .whitespaces)
        let text = args["append_content"] ?? args["content"]
        var changed: [String] = []
        do {
            if page.summary.kind == .heft {
                // Striche nie anfassen: Text kommt als neue Textbox auf die erste Heftseite.
                if let t = text?.trimmingCharacters(in: .whitespacesAndNewlines), !t.isEmpty {
                    guard let first = core.heftPageIds(pageId: id).first else { return ["error": "Heft hat keine Seite für die Textbox."] }
                    _ = try core.heftAddText(pageId: id, heftPageId: first, text: t, x: 20, y: 50, w: nil, color: nil, size: nil)
                    changed.append("textbox")
                }
                if let newTitle, !newTitle.isEmpty { try core.updatePage(id: id, title: newTitle, content: nil); changed.append("title") }
            } else {
                var content: String?
                if let add = args["append_content"] {
                    content = (page.content.isEmpty ? "" : page.content + "\n\n") + add.trimmingCharacters(in: .whitespacesAndNewlines)
                } else if let c = args["content"] {
                    content = c
                }
                let title = newTitle.flatMap { $0.isEmpty ? nil : $0 }
                if title != nil || content != nil {
                    try core.updatePage(id: id, title: title, content: content)
                    if title != nil { changed.append("title") }
                    if content != nil { changed.append("content") }
                }
            }
            if let subject = args["subject"] {
                let value = subject.trimmingCharacters(in: .whitespaces)
                try core.setPageSubject(id: id, subject: value.isEmpty ? nil : value)
                changed.append("subject")
            }
            if let archived, archived != page.archived {
                if archived { try core.archivePage(id: id) } else { try core.unarchivePage(id: id) }
                changed.append(archived ? "archived" : "unarchived")
            }
        } catch { return fail(error, "Ändern") }
        return ["ok": true, "id": id, "changed": changed]
    }

    nonisolated private static func createFlashcard(_ core: ImpalaCore, args: [String: String]) -> [String: Any] {
        let front = (args["front"] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let back = (args["back"] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !front.isEmpty else { return ["error": "Vorderseite (front) fehlt."] }
        let deck = (args["deck"] ?? "").trimmingCharacters(in: .whitespaces)
        let pageId = args["page_title"].flatMap { findPage(core, id: nil, title: $0) }?.summary.id
        do {
            let id = try core.createCard(front: front, back: back, deck: deck.isEmpty ? "Standard" : deck, pageId: pageId)
            return ["ok": true, "id": id, "front": front, "back": back, "deck": deck.isEmpty ? "Standard" : deck, "pageId": pageId ?? NSNull()]
        } catch { return fail(error, "Karte anlegen") }
    }

    /// Wie die PWA: Stapel passt bei gleichem Namen, Unterstapel oder Teilwort; Suche in Vorder- und Rückseite.
    nonisolated private static func listFlashcards(_ core: ImpalaCore, args: [String: String], limit: Int) -> [String: Any] {
        var pool = core.decks().flatMap { core.cardsInDeck(deck: $0.name) }
        if let d = args["deck"]?.trimmingCharacters(in: .whitespaces).lowercased(), !d.isEmpty {
            pool = pool.filter { let n = $0.deck.lowercased(); return n == d || n.hasPrefix(d + "::") || n.contains(d) }
        }
        if let q = args["query"]?.trimmingCharacters(in: .whitespaces).lowercased(), !q.isEmpty {
            pool = pool.filter { $0.front.lowercased().contains(q) || $0.back.lowercased().contains(q) }
        }
        let cards = pool.prefix(max(1, min(200, limit))).map {
            ["id": $0.id, "front": $0.front, "back": $0.back, "deck": $0.deck] as [String: Any]
        }
        return ["total": pool.count, "count": cards.count, "cards": Array(cards)]
    }

    private func screenshot(scale: Double) -> [String: Any] {
        let window = UIApplication.shared.connectedScenes
            .compactMap { ($0 as? UIWindowScene)?.keyWindow }.first
        guard let window else { return ["error": "Kein Fenster sichtbar."] }
        let format = UIGraphicsImageRendererFormat()
        format.scale = max(0.2, min(scale, 1)) * window.traitCollection.displayScale
        let image = UIGraphicsImageRenderer(bounds: window.bounds, format: format).image { _ in
            _ = window.drawHierarchy(in: window.bounds, afterScreenUpdates: false)
        }
        guard let jpeg = image.jpegData(compressionQuality: 0.7) else { return ["error": "Bild nicht erzeugt."] }
        return [
            "width": Int(image.size.width * image.scale), "height": Int(image.size.height * image.scale),
            "screen": Profiler.shared.screen,
            "image": "data:image/jpeg;base64," + jpeg.base64EncodedString(),
        ]
    }

    private func uiAction(_ args: [String: Any], core: ImpalaCore) -> [String: Any] {
        let action = args["action"] as? String ?? ""
        if action == "trigger_sync" {
            guard let sync = AppModel.shared.sync, sync.isPaired else { return ["error": "Sync nicht gekoppelt."] }
            sync.syncNow()
            return ["ok": true, "started": true]
        }
        guard let shell else { return ["error": "Oberfläche noch nicht bereit."] }
        switch action {
        case "open_page":
            guard let target = args["target"] as? String, !target.isEmpty else { return ["error": "target fehlt"] }
            let id = core.page(id: target) != nil ? target
                : core.recentPages(limit: 100_000).first { $0.title.lowercased() == target.lowercased() }?.id
            guard let id else { return ["error": "Seite nicht gefunden"] }
            shell.open(id)
            return ["ok": true, "opened": id, "title": core.page(id: id)?.summary.title ?? ""]
        case "close_active_tab":
            if let active = shell.active { shell.close(active) }
            return ["ok": true]
        case "search_ui":
            shell.sheet = .search
            return ["ok": true, "searchOpened": true]
        case "toggle_sidebar":
            shell.toggleSidebar()
            return ["ok": true]
        case "go_back":
            // Wie ‹ / Escape: offenes Sheet, Bibliothek, Karten-Unteransicht, sonst Verlauf zurück.
            let hadSheet = shell.sheet != nil
            shell.goBack()
            return ["ok": true, "closedSheet": hadSheet]
        case "dismiss":
            // Sheet der Shell schließen, sonst den obersten von UIKit/SwiftUI gezeigten Dialog.
            if shell.sheet != nil {
                shell.handleEscape()
                return ["ok": true, "dismissed": "shell.sheet"]
            }
            let root = Self.windows().last { $0.isKeyWindow }?.rootViewController
            var top = root
            while let next = top?.presentedViewController { top = next }
            guard let top, top !== root else { return ["ok": false, "note": "Nichts offen."] }
            top.dismiss(animated: true)
            return ["ok": true, "dismissed": String(describing: type(of: top))]
        default:
            return ["error": "Unbekannte UI-Aktion: \(action)"]
        }
    }

    // MARK: Bedienelemente (Accessibility-Baum, wie VoiceOver ihn sieht)

    /// Elemente der letzten `impala_ui_tree`-Abfrage; `impala_tap` mit `index` greift darauf zu.
    @ObservationIgnored private var lastTree: [NSObject] = []

    private static var accessibilityEnabled = false

    /// SwiftUI baut seinen Accessibility-Baum nur, wenn eine Bedienungshilfe oder Automatisierung
    /// läuft. Wie XCTest/Accessibility Inspector die Automatisierung einschalten (libAccessibility,
    /// `_AXSSetAutomationEnabled`) – erst beim ersten Baum-/Tipp-Aufruf über die Bridge, danach kurz
    /// warten, bis SwiftUI die Elemente angelegt hat.
    private static func enableAccessibilityTree() async {
        guard !accessibilityEnabled else { return }
        accessibilityEnabled = true
        guard let lib = dlopen("/usr/lib/libAccessibility.dylib", RTLD_NOW),
              let sym = dlsym(lib, "_AXSSetAutomationEnabled") else { return }
        typealias SetEnabled = @convention(c) (Int32) -> Void
        unsafeBitCast(sym, to: SetEnabled.self)(1)
        try? await Task.sleep(for: .milliseconds(600))
    }

    /// Sichtbare Fenster der App von unten nach oben (Hauptfenster, Sheets, Menüs, Alerts).
    private static func windows() -> [UIWindow] {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows)
            .filter { !$0.isHidden && $0.alpha > 0.01 }
            .sorted { $0.windowLevel.rawValue < $1.windowLevel.rawValue }
    }

    private static func collect(_ obj: NSObject, into out: inout [NSObject], depth: Int = 0) {
        guard depth < 80, out.count < 3000 else { return }
        if let v = obj as? UIView, v.isHidden || v.alpha < 0.01 || v.accessibilityElementsHidden { return }
        if obj.isAccessibilityElement { out.append(obj); return }
        if let kids = obj.accessibilityElements as? [NSObject], !kids.isEmpty {
            kids.forEach { collect($0, into: &out, depth: depth + 1) }
            return
        }
        let n = obj.accessibilityElementCount()
        if n > 0, n != NSNotFound {
            for i in 0..<n {
                if let k = obj.accessibilityElement(at: i) as? NSObject { collect(k, into: &out, depth: depth + 1) }
            }
            return
        }
        (obj as? UIView)?.subviews.forEach { collect($0, into: &out, depth: depth + 1) }
    }

    private static func traitNames(_ obj: NSObject) -> [String] {
        let t = obj.accessibilityTraits
        var names: [String] = []
        let map: [(UIAccessibilityTraits, String)] = [
            (.button, "button"), (.link, "link"), (.header, "header"), (.selected, "selected"),
            (.notEnabled, "disabled"), (.staticText, "text"), (.image, "image"), (.searchField, "search"),
            (.adjustable, "adjustable"), (.tabBar, "tabbar"), (.keyboardKey, "key"),
        ]
        for (trait, name) in map where t.contains(trait) { names.append(name) }
        if obj is UITextField || obj is UITextView { names.append("textfield") }
        return names
    }

    private static func isInteractive(_ obj: NSObject) -> Bool {
        let t = obj.accessibilityTraits
        return t.contains(.button) || t.contains(.link) || t.contains(.adjustable) || t.contains(.searchField)
            || obj is UIControl || obj is UITextView
    }

    /// Alle sichtbaren Elemente mit Beschriftung, Zustand und Rahmen (Bildschirmpunkte wie `impala_screenshot` bei scale 1 / displayScale).
    private func uiTree(query: String, interactive: Bool, limit: Int) -> [String: Any] {
        var all: [NSObject] = []
        let wins = Self.windows()
        for w in wins { Self.collect(w, into: &all) }
        let screen = wins.first?.windowScene?.screen.bounds ?? .zero
        lastTree = all.filter { el in
            let f = el.accessibilityFrame
            return f.width > 0 && f.height > 0 && f.intersects(screen)
        }
        let q = query.lowercased()
        var rows: [[String: Any]] = []
        for (i, el) in lastTree.enumerated() {
            if interactive && !Self.isInteractive(el) { continue }
            let label = el.accessibilityLabel ?? ""
            let value = el.accessibilityValue ?? ""
            let ident = (el as? UIAccessibilityIdentification)?.accessibilityIdentifier ?? ""
            if !q.isEmpty && ![label, value, ident, el.accessibilityHint ?? ""].contains(where: { $0.lowercased().contains(q) }) { continue }
            let f = el.accessibilityFrame
            var row: [String: Any] = [
                "index": i, "label": label, "traits": Self.traitNames(el),
                "frame": [Int(f.minX), Int(f.minY), Int(f.width), Int(f.height)],
            ]
            if !value.isEmpty { row["value"] = value }
            if !ident.isEmpty { row["id"] = ident }
            if let hint = el.accessibilityHint, !hint.isEmpty { row["hint"] = hint }
            rows.append(row)
            if rows.count >= limit { break }
        }
        return [
            "screen": Profiler.shared.screen, "windows": wins.count, "total": lastTree.count, "count": rows.count,
            "elements": rows,
            "note": "frame = [x, y, Breite, Höhe] in Punkten. impala_tap mit index, label oder x/y.",
        ]
    }

    /// Element wie mit VoiceOver auslösen (`accessibilityActivate`); UIKit-Steuerelemente notfalls direkt.
    private func tap(_ args: [String: Any]) async -> [String: Any] {
        await Self.enableAccessibilityTree()
        if lastTree.isEmpty || args["index"] == nil { _ = uiTree(query: "", interactive: false, limit: 0) }
        var target: NSObject?
        var point: CGPoint?
        if let i = args["index"] as? Int, lastTree.indices.contains(i) {
            target = lastTree[i]
        } else if let label = (args["label"] as? String)?.lowercased(), !label.isEmpty {
            let named = lastTree.filter { ($0.accessibilityLabel ?? "").lowercased().contains(label) }
            target = named.first { ($0.accessibilityLabel ?? "").lowercased() == label } ?? named.first(where: Self.isInteractive) ?? named.first
        } else if let x = (args["x"] as? NSNumber)?.doubleValue, let y = (args["y"] as? NSNumber)?.doubleValue {
            let p = CGPoint(x: x, y: y)
            point = p
            // Kleinstes Element unter dem Punkt; ohne Baum die UIKit-Ansicht per Hit-Test.
            target = lastTree.filter { $0.accessibilityFrame.contains(p) }
                .min { $0.accessibilityFrame.width * $0.accessibilityFrame.height < $1.accessibilityFrame.width * $1.accessibilityFrame.height }
                ?? Self.hitView(at: p)
        }
        guard let el = target else {
            return ["error": "Kein passendes Element (\(lastTree.count) im Baum). label, index oder x/y angeben."]
        }
        var how = "accessibilityActivate"
        var ok = el.accessibilityActivate()
        // Eingabefelder: Fokus setzen, damit impala_type danach schreiben kann.
        if !ok, let field = Self.textInput(from: el, at: point) {
            ok = field.becomeFirstResponder()
            how = "becomeFirstResponder"
        }
        if !ok, let control = Self.control(from: el), control.isEnabled {
            control.sendActions(for: .touchUpInside)
            ok = true
            how = "UIControl.touchUpInside"
        }
        // Kurz warten, damit Menüs, Sheets und Animationen stehen, bevor der Aufrufer nachsieht.
        try? await Task.sleep(for: .milliseconds(450))
        let f = el.accessibilityFrame
        return [
            "ok": ok, "how": how, "label": el.accessibilityLabel ?? "", "traits": Self.traitNames(el),
            "frame": [Int(f.minX), Int(f.minY), Int(f.width), Int(f.height)], "screen": Profiler.shared.screen,
            "note": ok ? "" : "Element hat das Auslösen abgelehnt (für VoiceOver nicht bedienbar) – das ist selbst ein Hinweis auf einen Fehler.",
        ]
    }

    /// Oberste UIKit-Ansicht unter einem Bildschirmpunkt (Fenster von oben nach unten).
    private static func hitView(at p: CGPoint) -> UIView? {
        for w in windows().reversed() {
            let local = w.convert(p, from: w.screen.coordinateSpace)
            if let v = w.hitTest(local, with: nil) { return v }
        }
        return nil
    }

    private static func ancestors(_ v: UIView?) -> [UIView] {
        var out: [UIView] = []
        var cur = v
        while let c = cur { out.append(c); cur = c.superview }
        return out
    }

    /// Textfeld zum Element: es selbst oder die UIKit-Ansicht unter seiner Mitte (SwiftUI-`TextField`
    /// liegt als `UITextField` darunter).
    private static func textInput(from el: NSObject, at point: CGPoint?) -> UIView? {
        if let v = el as? UIView, v is UITextField || v is UITextView { return v }
        let f = el.accessibilityFrame
        return ancestors(hitView(at: point ?? CGPoint(x: f.midX, y: f.midY)))
            .first { $0 is UITextField || $0 is UITextView }
    }

    private static func control(from el: NSObject) -> UIControl? {
        ancestors(el as? UIView).compactMap { $0 as? UIControl }.first
    }

    /// Text ins gerade fokussierte Eingabefeld (`submit`: danach Zeilenumbruch/Enter).
    private func typeText(_ text: String, submit: Bool) -> [String: Any] {
        guard let input = Self.firstResponder(in: Self.windows()) as? UIKeyInput else {
            return ["error": "Kein Eingabefeld fokussiert (erst Feld per impala_tap antippen)."]
        }
        input.insertText(text)
        if submit { input.insertText("\n") }
        return ["ok": true, "typed": text.count]
    }

    private static func firstResponder(in windows: [UIWindow]) -> UIResponder? {
        // UIKit selbst fragen: Eine an `nil` gesendete Aktion landet beim Ersthelfer – auch wenn er
        // (SwiftUI-`.searchable`, Eingabe-Hosts) nicht im Ansichtsbaum der Fenster hängt.
        CaptureFirstResponder.found = nil
        UIApplication.shared.sendAction(#selector(UIResponder.impalaCaptureFirstResponder), to: nil, from: nil, for: nil)
        if let r = CaptureFirstResponder.found { return r }
        func find(_ v: UIView) -> UIResponder? {
            if v.isFirstResponder { return v }
            for s in v.subviews { if let r = find(s) { return r } }
            return nil
        }
        for w in windows.reversed() { if let r = find(w) { return r } }
        return nil
    }

    /// Wie „Arbeitsspeicher“ im Xcode-Messgerät (`phys_footprint`).
    private static func memoryFootprintMb() -> Double? {
        var info = task_vm_info_data_t()
        var count = mach_msg_type_number_t(MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<natural_t>.size)
        let kr = withUnsafeMutablePointer(to: &info) {
            $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
                task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), $0, &count)
            }
        }
        guard kr == KERN_SUCCESS else { return nil }
        return (Double(info.phys_footprint) / 1_048_576 * 10).rounded() / 10
    }
}

/// Ablage für [`UIResponder.impalaCaptureFirstResponder`] (nur Hauptthread).
@MainActor private enum CaptureFirstResponder {
    static weak var found: UIResponder?
}

extension UIResponder {
    @objc fileprivate func impalaCaptureFirstResponder() {
        MainActor.assumeIsolated { CaptureFirstResponder.found = self }
    }
}
