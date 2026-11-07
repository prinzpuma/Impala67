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
        case "impala_screenshot":
            return screenshot(scale: (args["scale"] as? Double) ?? 0.5)
        case "impala_run_ui_action":
            return uiAction(args, core: core)
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
        default:
            return ["error": "Unbekannte UI-Aktion: \(action)"]
        }
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
