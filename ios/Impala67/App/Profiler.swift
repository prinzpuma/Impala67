import Foundation
import UIKit

/// Performance-Profiler wie web/performance-profiler.js (Einstellungen → App & Speicher → Für Entwickler):
/// protokolliert nur Auffälligkeiten – Hänger des Hauptthreads, Fehler des Rust-Kerns, Sync- und KI-Fehler,
/// langsamer Start. Gleiche Auffälligkeiten werden zusammengefasst (Anzahl, längste/mittlere Dauer), höchstens
/// 180 Einträge, gespeichert nur auf diesem Gerät. Aus jedem Thread aufrufbar.
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
        /// Angezeigte Ansicht beim (längsten) Auftreten, z. B. „heft“, „library“.
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
    /// Ansicht für den Kontext (setzt die Shell).
    private var currentScreen = "home"

    var isEnabled: Bool { UserDefaults.standard.bool(forKey: Self.enabledKey) }

    /// Beim Start: gespeicherte Einträge laden und bei aktivem Profiler die Hänger-Erkennung starten.
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

    /// Fehler des Rust-Kerns (über `attempt`).
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

    fileprivate func stall(_ durationMs: Double) {
        record(kind: "main-thread-stall", name: "", message: "", durationMs: durationMs, source: "")
    }

    private func record(kind: String, name: String, message: String, durationMs: Double, source: String) {
        guard isEnabled else { return }
        let now = Date()
        let version = Self.version
        let clean = message.replacingOccurrences(of: "\n", with: " ").trimmingCharacters(in: .whitespaces)
        lock.withLock {
            loadIfNeeded()
            let screen = currentScreen
            // Wie `anomalySignature`: Fehler nach Art, Name und Meldungsanfang; Hänger nach Ansicht.
            let sig = kind == "main-thread-stall"
                ? "stall:" + screen
                : kind + ":" + name + ":" + String(clean.prefix(45))
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

    // MARK: Lesen, Bericht, Löschen

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

    /// Bericht als JSON zum Kopieren/Teilen (ähnlich `PERF_PROFILER.report()`).
    func report() -> String {
        let device = UIDevice.current
        let body: [String: Any] = [
            "app": "ipad",
            "version": Self.version,
            "device": device.model + " · " + device.systemName + " " + device.systemVersion,
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

    /// Bericht als Datei für das Teilen-Blatt.
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

    /// Nur unter `lock` aufrufen; schreibt gebündelt nach einer Sekunde.
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
                let w = HangWatchdog { [weak self] ms in self?.stall(ms) }
                watchdog = w
                w.start()
            } else if !isEnabled, let w = watchdog {
                w.cancel()
                watchdog = nil
            }
        }
    }
}

/// Prüft alle 250 ms, ob der Hauptthread antwortet (wie `LAG_INTERVAL_MS` der PWA); hängt er länger als
/// 100 ms, wird nach seiner Rückkehr die ganze Dauer als `main-thread-stall` gemeldet.
private final class HangWatchdog: Thread, @unchecked Sendable {
    private let report: @Sendable (Double) -> Void

    init(report: @escaping @Sendable (Double) -> Void) {
        self.report = report
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
                pong.wait()
                let ms = Double(DispatchTime.now().uptimeNanoseconds - start.uptimeNanoseconds) / 1_000_000
                report(ms)
            }
            Thread.sleep(forTimeInterval: 0.25)
        }
    }
}

/// Wie `try?`, aber ein Fehler landet im Profiler (Art `core-error`, mit Aufrufstelle), statt still zu
/// verschwinden. Aufruf: `attempt(try core.trashPage(id: id), "trashPage")`.
@discardableResult
func attempt<T>(_ body: @autoclosure () throws -> T, _ op: String = "", file: String = #fileID, line: Int = #line) -> T? {
    do {
        return try body()
    } catch {
        Profiler.shared.coreError(error, op: op, file: file, line: line)
        return nil
    }
}

/// Für Kern-Aufrufe, die selbst schon optional liefern: flach wie `try?` (kein `T??`).
@discardableResult
func attempt<T>(_ body: @autoclosure () throws -> T?, _ op: String = "", file: String = #fileID, line: Int = #line) -> T? {
    do {
        return try body()
    } catch {
        Profiler.shared.coreError(error, op: op, file: file, line: line)
        return nil
    }
}
