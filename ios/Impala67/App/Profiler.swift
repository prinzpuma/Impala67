import Foundation
import UIKit

/// Performance-Profiler wie web/performance-profiler.js (Einstellungen â†’ App & Speicher â†’ FÃ¼r Entwickler):
/// protokolliert nur AuffÃ¤lligkeiten â€“ HÃ¤nger des Hauptthreads, Fehler des Rust-Kerns, Sync- und KI-Fehler,
/// langsamer Start. Gleiche AuffÃ¤lligkeiten werden zusammengefasst (Anzahl, lÃ¤ngste/mittlere Dauer), hÃ¶chstens
/// 180 EintrÃ¤ge, gespeichert nur auf diesem GerÃ¤t. Aus jedem Thread aufrufbar.
final class Profiler: @unchecked Sendable {
    static let shared = Profiler()

    struct Record: Codable, Identifiable {
        var sig: String
        var kind: String
        var name: String
        var message: String
        var count: Int
        var firstAt: Date
        var lastAt: Date
        var maxDurationMs: Double
        var totalDurationMs: Double
        var version: String
        /// Angezeigte Ansicht beim (lÃ¤ngsten) Auftreten, z. B. â€žheftâ€œ, â€žlibraryâ€œ.
        var screen: String
        /// Stelle im Code (`Datei:Zeile`) bei Kern-Fehlern.
        var source: String

        var id: String { sig + "|" + version }
        var avgDurationMs: Double { count > 0 ? totalDurationMs / Double(count) : 0 }
    }

    static let enabledKey = "impala67PerformanceProfiler"
    private static let maxRecords = 180

    private let lock = NSLock()
    private var records: [Record] = []
    private var saveScheduled = false
    private var loaded = false
    private let queue = DispatchQueue(label: "org.impala67.profiler", qos: .utility)
    private var watchdog: HangWatchdog?
    /// Ansicht fÃ¼r den Kontext (setzt die Shell).
    private var currentScreen = "home"
    /// Kern-Aufruf, der gerade auf dem Hauptthread lÃ¤uft (`attempt`), fÃ¼r die Zuordnung von HÃ¤ngern.
    private var mainOp: String?
    /// Zusatzangaben fÃ¼r den Bericht (Sync-Stand, Kern, offenes Heft); setzt die App.
    var context: (@MainActor () -> [String: Any])?

    var isEnabled: Bool { UserDefaults.standard.bool(forKey: Self.enabledKey) }

    /// Beim Start: gespeicherte EintrÃ¤ge laden und bei aktivem Profiler die HÃ¤nger-Erkennung starten.
    func start() {
        lock.withLock { loadIfNeeded() }
        updateWatchdog()
    }

    func setEnabled(_ on: Bool) {
        UserDefaults.standard.set(on, forKey: Self.enabledKey)
        updateWatchdog()
    }

    func setScreen(_ screen: String) {
        lock.withLock { currentScreen = screen }
    }

    // MARK: Aufzeichnen

    /// Fehler des Rust-Kerns (Ã¼ber `attempt`).
    func coreError(_ error: Error, op: String, file: String, line: Int) {
        record(kind: "core-error", name: op, message: String(describing: error), durationMs: 0,
               source: "\((file as NSString).lastPathComponent):\(line)")
    }

    /// Allgemeiner Fehler (Sync, KI, Start).
    func error(_ kind: String, _ message: String, name: String = "") {
        record(kind: kind, name: name, message: message, durationMs: 0, source: "")
    }

    /// Dauer einer Operation; protokolliert nur ab `thresholdMs` (wie `isAnomaly`).
    func operation(_ name: String, durationMs: Double, thresholdMs: Double) {
        guard durationMs >= thresholdMs else { return }
        record(kind: "operation", name: name, message: "", durationMs: durationMs, source: "")
    }

    /// Kern-Aufruf auf dem Hauptthread beginnt bzw. endet (`attempt`).
    fileprivate func enterMain(_ op: String?) -> String? {
        lock.withLock {
            let previous = mainOp
            mainOp = op
            return previous
        }
    }

    fileprivate var currentMainOp: String? { lock.withLock { mainOp } }

    /// HÃ¤nger mit Zuordnung: `op` lief auf dem Hauptthread (nil: kein Kern-Aufruf Ã¼ber `attempt`, also
    /// OberflÃ¤che oder ein direkter Kern-Aufruf); `holder` hielt dabei die Kern-Sperre.
    fileprivate func stall(_ durationMs: Double, op: String?, holder: CoreLockHold?) {
        var parts: [String] = []
        if let holder {
            let thread = holder.thread.isEmpty ? "" : " auf \(holder.thread)"
            parts.append("Kern-Sperre gehalten von \(Self.shortSite(holder.site))\(thread) (seit \(Int(holder.ms)) ms)")
        } else {
            parts.append("Kern-Sperre frei")
        }
        record(kind: "main-thread-stall", name: op ?? "ohne attempt-Aufruf",
               message: parts.joined(separator: "; "), durationMs: durationMs,
               source: holder.map { Self.shortSite($0.site) } ?? "")
    }

    /// Die Kern-Sperre wurde lange gehalten (egal auf welchem Thread).
    fileprivate func longLock(_ h: CoreLockHold) {
        record(kind: "core-lock", name: Self.shortSite(h.site), message: h.thread.isEmpty ? "Plattform-Thread" : h.thread,
               durationMs: h.ms, source: Self.shortSite(h.site))
    }

    /// `â€¦/impala-ffi/src/heft.rs:274` â†’ `heft.rs:274`.
    private static func shortSite(_ site: String) -> String {
        site.split(separator: "/").last.map(String.init) ?? site
    }

    private func record(kind: String, name: String, message: String, durationMs: Double, source: String) {
        guard isEnabled else { return }
        let now = Date()
        let version = Self.version
        let clean = message.replacingOccurrences(of: "\n", with: " ").trimmingCharacters(in: .whitespaces)
        lock.withLock {
            loadIfNeeded()
            let screen = currentScreen
            // Wie `anomalySignature`: Fehler nach Art, Name und Meldungsanfang; HÃ¤nger nach Ansicht,
            // Hauptthread-Aufruf und Sperren-Halter (verschiedene Ursachen bleiben getrennt).
            let sig: String = switch kind {
            case "main-thread-stall": "stall:" + screen + ":" + name + ":" + source
            case "core-lock": "lock:" + name + ":" + clean
            default: kind + ":" + name + ":" + String(clean.prefix(45))
            }
            if let i = records.firstIndex(where: { $0.sig == sig && $0.version == version }) {
                var r = records.remove(at: i)
                r.count += 1
                r.lastAt = now
                r.totalDurationMs += durationMs
                if durationMs >= r.maxDurationMs {
                    r.maxDurationMs = durationMs
                    r.screen = screen
                }
                records.append(r)
            } else {
                records.append(Record(sig: sig, kind: kind, name: name, message: String(clean.prefix(400)), count: 1,
                                      firstAt: now, lastAt: now, maxDurationMs: durationMs, totalDurationMs: durationMs,
                                      version: version, screen: screen, source: source))
                if records.count > Self.maxRecords { records.removeFirst(records.count - Self.maxRecords) }
            }
            scheduleSave()
        }
    }

    // MARK: Lesen, Bericht, LÃ¶schen

    /// Neueste zuerst.
    func snapshot() -> [Record] {
        lock.withLock {
            loadIfNeeded()
            return records.reversed()
        }
    }

    func clear() {
        lock.withLock {
            records.removeAll()
            scheduleSave()
        }
    }

    /// Bericht als JSON zum Kopieren/Teilen (Ã¤hnlich `PERF_PROFILER.report()`).
    func report() -> String {
        let device = UIDevice.current
        var extra: [String: Any] = [:]
        if Thread.isMainThread, let context { extra = MainActor.assumeIsolated { context() } }
        let body: [String: Any] = [
            "context": extra,
            "app": "ipad",
            "version": Self.version,
            "device": device.model + " Â· " + device.systemName + " " + device.systemVersion,
            "createdAt": ISO8601DateFormatter().string(from: Date()),
            "records": snapshot().map { r -> [String: Any] in
                [
                    "kind": r.kind, "name": r.name, "message": r.message, "count": r.count,
                    "firstAt": ISO8601DateFormatter().string(from: r.firstAt),
                    "lastAt": ISO8601DateFormatter().string(from: r.lastAt),
                    "maxDurationMs": (r.maxDurationMs * 10).rounded() / 10,
                    "avgDurationMs": (r.avgDurationMs * 10).rounded() / 10,
                    "version": r.version, "screen": r.screen, "source": r.source,
                ]
            },
        ]
        let data = (try? JSONSerialization.data(withJSONObject: body, options: [.prettyPrinted, .sortedKeys])) ?? Data()
        return String(decoding: data, as: UTF8.self)
    }

    /// Bericht als Datei fÃ¼r das Teilen-Blatt.
    func reportFile() -> URL {
        let day = ISO8601DateFormatter().string(from: Date()).prefix(10)
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("impala67-performance-ipad-\(day).json")
        try? Data(report().utf8).write(to: url)
        return url
    }

    // MARK: Speicher

    private static var version: String {
        let info = Bundle.main.infoDictionary
        return (info?["CFBundleShortVersionString"] as? String ?? "") + "+" + (info?["CFBundleVersion"] as? String ?? "")
    }

    private static var fileURL: URL? {
        try? FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            .appendingPathComponent("impala67-performance.json")
    }

    /// Nur unter `lock` aufrufen.
    private func loadIfNeeded() {
        guard !loaded else { return }
        loaded = true
        guard let url = Self.fileURL, let data = try? Data(contentsOf: url),
              let saved = try? JSONDecoder().decode([Record].self, from: data) else { return }
        records = saved
    }

    /// Nur unter `lock` aufrufen; schreibt gebÃ¼ndelt nach einer Sekunde.
    private func scheduleSave() {
        guard !saveScheduled else { return }
        saveScheduled = true
        queue.asyncAfter(deadline: .now() + 1) { [weak self] in
            guard let self else { return }
            let copy: [Record] = self.lock.withLock {
                self.saveScheduled = false
                return self.records
            }
            guard let url = Self.fileURL, let data = try? JSONEncoder().encode(copy) else { return }
            try? data.write(to: url, options: .atomic)
        }
    }

    private func updateWatchdog() {
        lock.withLock {
            if isEnabled, watchdog == nil {
                let w = HangWatchdog(
                    mainOp: { [weak self] in self?.currentMainOp },
                    report: { [weak self] ms, op, holder in self?.stall(ms, op: op, holder: holder) },
                    longLock: { [weak self] h in self?.longLock(h) }
                )
                watchdog = w
                w.start()
            } else if !isEnabled, let w = watchdog {
                w.cancel()
                watchdog = nil
            }
        }
    }
}

/// PrÃ¼ft alle 250 ms, ob der Hauptthread antwortet (wie `LAG_INTERVAL_MS` der PWA); hÃ¤ngt er lÃ¤nger als
/// 100 ms, wird nach seiner RÃ¼ckkehr die ganze Dauer als `main-thread-stall` gemeldet â€“ mit dem Kern-Aufruf,
/// der auf dem Hauptthread lief, und dem Halter der Kern-Sperre (beide wÃ¤hrend des HÃ¤ngers abgefragt, ohne
/// selbst auf die Sperre zu warten). Lange gehaltene Kern-Sperren (â‰¥ 100 ms, jeder Thread) kommen als
/// `core-lock` dazu.
private final class HangWatchdog: Thread, @unchecked Sendable {
    private let mainOp: @Sendable () -> String?
    private let report: @Sendable (Double, String?, CoreLockHold?) -> Void
    private let longLock: @Sendable (CoreLockHold) -> Void

    init(mainOp: @escaping @Sendable () -> String?,
         report: @escaping @Sendable (Double, String?, CoreLockHold?) -> Void,
         longLock: @escaping @Sendable (CoreLockHold) -> Void) {
        self.mainOp = mainOp
        self.report = report
        self.longLock = longLock
        super.init()
        name = "impala67.hang-watchdog"
        qualityOfService = .utility
    }

    override func main() {
        while !isCancelled {
            let start = DispatchTime.now()
            let pong = DispatchSemaphore(value: 0)
            DispatchQueue.main.async { pong.signal() }
            if pong.wait(timeout: start + .milliseconds(100)) == .timedOut {
                // Mitten im HÃ¤nger nachsehen; der Halter zÃ¤hlt, solange der Hauptthread noch hÃ¤ngt.
                var op = mainOp()
                var holder = coreLockHolder()
                while pong.wait(timeout: .now() + .milliseconds(250)) == .timedOut {
                    if op == nil { op = mainOp() }
                    if let now = coreLockHolder(), now.ms > (holder?.ms ?? 0) { holder = now }
                }
                let ms = Double(DispatchTime.now().uptimeNanoseconds - start.uptimeNanoseconds) / 1_000_000
                report(ms, op, holder)
            }
            for h in coreLongLockHolds() { longLock(h) }
            Thread.sleep(forTimeInterval: 0.25)
        }
    }
}


/// Wie `try?`, aber ein Fehler landet im Profiler (Art `core-error`, mit Aufrufstelle), statt still zu
/// verschwinden. Aufruf: `attempt("trashPage", { try core.trashPage(id: id) })`. AusdrÃ¼ckliche Closure statt
/// `@autoclosure`: Ein `try` im Argument wÃ¼rde sonst die umgebende Closure zur werfenden machen. Liefert der
/// Kern selbst schon optional, mit `?? nil` flach machen.
@discardableResult
func attempt<T>(_ op: String, _ body: () throws -> T, file: String = #fileID, line: Int = #line) -> T? {
    // Auf dem Hauptthread merken, welcher Kern-Aufruf lÃ¤uft: HÃ¤ngt er, nennt der Profiler ihn.
    if Thread.isMainThread {
        let previous = Profiler.shared.enterMain(op)
        defer { _ = Profiler.shared.enterMain(previous) }
        return attemptBody(op, body, file: file, line: line)
    }
    return attemptBody(op, body, file: file, line: line)
}

private func attemptBody<T>(_ op: String, _ body: () throws -> T, file: String, line: Int) -> T? {
    do {
        return try body()
    } catch {
        Profiler.shared.coreError(error, op: op, file: file, line: line)
        return nil
    }
}