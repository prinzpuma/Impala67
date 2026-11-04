import Foundation
import Observation

/// Cloudflare Live-Sync (web/sync-cloudflare.js, `CloudSyncController.kt`): Der ganze Ablauf –
/// Abrufen, Verschlüsseln, Konflikte, Dateien – läuft im Rust-Kern (`CloudSync`); hier liegen nur
/// WebSocket (URLSession), Ping, Neuaufbau und Wiederholversuche. Läuft, solange die App sichtbar ist;
/// beim Zurückkehren holt ein Durchgang alles nach.
@MainActor @Observable
final class SyncController {
    enum State { case disconnected, connecting, connected, syncing, error }

    private(set) var state: State = .disconnected
    private(set) var label = "Nicht verbunden"
    private(set) var detail = "Echtzeit-Synchronisierung über WebSockets mit Ende-zu-Ende-Verschlüsselung"
    /// Fortschritt des laufenden Durchgangs (Etappe, Anteil 0…1).
    private(set) var progress: (label: String, fraction: Double)?
    private(set) var usage = ""

    /// Gekoppelt, wenn dieses Gerät einen Schlüssel hat (wie `DevicePrefs.cfSyncKey`).
    var isPaired: Bool { !deviceKey.isEmpty }
    var isActive: Bool { state != .disconnected && state != .error }

    @ObservationIgnored private let store: ImpalaStore
    @ObservationIgnored private var sync: CloudSync?
    @ObservationIgnored private var socket: URLSessionWebSocketTask?
    @ObservationIgnored private var pingTask: Task<Void, Never>?
    @ObservationIgnored private var reconnectTask: Task<Void, Never>?
    @ObservationIgnored private var debounceTask: Task<Void, Never>?
    @ObservationIgnored private var reconnectAttempt: UInt32 = 0
    @ObservationIgnored private var foreground = false
    @ObservationIgnored private var running = false
    @ObservationIgnored private var pending = false
    @ObservationIgnored private var forceAll = false
    @ObservationIgnored private var listener: Listener?
    /// Zählt beendete Durchgänge (für `backgroundPass`).
    @ObservationIgnored private var passes = 0
    /// Laufender Verbindungsaufbau; gleichzeitige Aufrufe warten darauf statt einen zweiten zu starten.
    @ObservationIgnored private var connecting: Task<String?, Never>?

    private static let keyDefaults = "cfSyncKey"
    /// Zuletzt gesehener Schlüssel aus den Einstellungen (wie `DevicePrefs.cfSeenKey`).
    private static let seenKeyDefaults = "cfSeenKey"
    private static let backgroundTimeout: Duration = .seconds(25)
    private static let debounce: Duration = .milliseconds(1500)
    private static let maxRetries: UInt32 = 5

    private var deviceKey: String {
        get { UserDefaults.standard.string(forKey: Self.keyDefaults) ?? "" }
        set { UserDefaults.standard.set(newValue, forKey: Self.keyDefaults) }
    }

    /// Worker-URL und Schlüssel aus den Kern-Einstellungen (`cfUrl`, `cfSyncKey`, wie die PWA).
    var settings: (url: String, key: String) {
        let json = (try? JSONSerialization.jsonObject(with: Data(store.core.settingsJson().utf8))) as? [String: Any] ?? [:]
        return (json["cfUrl"] as? String ?? "", json["cfSyncKey"] as? String ?? "")
    }

    init(store: ImpalaStore) {
        self.store = store
        usage = formatSyncUsage(bytes: 0)
        listener = Listener(owner: self)
        settingsChanged()
        watchSettings()
    }

    // MARK: - Lebenszyklus

    /// App sichtbar: verbinden, falls dieses Gerät gekoppelt ist.
    func onForeground() {
        foreground = true
        if isPaired { Task { await connect(key: deviceKey, url: settings.url) } }
    }

    /// App im Hintergrund: WebSocket schließen (Akku); der Kern bleibt verbunden.
    func onBackground() {
        foreground = false
        closeSocket()
    }

    // MARK: - Einstellungen

    /// „Verbinden“: prüft den Schlüssel, speichert URL und Schlüssel wie die PWA in den Einstellungen
    /// und auf dem Gerät, dann erster Durchgang. Liefert eine Fehlermeldung oder `nil`.
    func configure(url: String, key: String) async -> String? {
        let key = key.trimmingCharacters(in: .whitespacesAndNewlines)
        let url = url.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !key.isEmpty else { return "Bitte gib einen Sync-Schlüssel ein oder generiere einen neuen." }
        disconnectInternal()
        if let error = await connect(key: key, url: url) { return error }
        deviceKey = key
        if let data = try? JSONSerialization.data(withJSONObject: ["cfUrl": url, "cfSyncKey": key]),
           let patch = String(data: data, encoding: .utf8) {
            attempt(try store.core.updateSettings(patchJson: patch), "updateSettings")
        }
        return nil
    }

    /// „Trennen“: Der Schlüssel bleibt in den Einstellungen, das Gerät verbindet aber nicht mehr von selbst.
    func disconnect() {
        disconnectInternal()
        deviceKey = ""
        state = .disconnected
        label = "Getrennt"
        progress = nil
    }

    /// Durchgang jetzt („Jetzt synchronisieren“, Server-Nachricht, lokale Änderung).
    func syncNow(all: Bool = false) {
        if all { forceAll = true }
        pending = true
        if !running { Task { await runPasses() } }
    }

    /// „Cloud-Stand leeren“: alle Pakete und Dateien auf dem Server löschen, dann alles neu senden.
    func resetCloud() async -> String? {
        guard let sync else { return "Bitte zuerst verbinden." }
        do {
            try await Task.detached { try sync.resetCloud() }.value
            syncNow(all: true)
            return nil
        } catch {
            return Self.message(error)
        }
    }

    func newKey() -> String { (try? generateSyncKey()) ?? "" }

    /// Ein Durchgang aus dem Hintergrund (`BGTaskScheduler`), ohne WebSocket: nur wenn dieses Gerät
    /// gekoppelt ist. Wartet, bis der Durchgang fertig ist; `false` bei Fehler oder Zeitablauf.
    func backgroundPass() async -> Bool {
        guard isPaired else { return true }
        let before = passes
        if await connect(key: deviceKey, url: settings.url) != nil { return false }
        syncNow()
        let deadline = ContinuousClock.now + Self.backgroundTimeout
        while passes == before && ContinuousClock.now < deadline && !Task.isCancelled {
            try? await Task.sleep(for: .milliseconds(250))
        }
        return passes > before && state != .error
    }

    /// Hintergrundzeit abgelaufen: laufenden Durchgang abbrechen; im Vordergrund verbindet die App neu.
    func cancelBackgroundPass() {
        guard !foreground else { return }
        disconnectInternal()
    }

    // MARK: - Automatisch koppeln

    private func watchSettings() {
        withObservationTracking { _ = store.settingsRevision } onChange: { [weak self] in
            Task { @MainActor in
                self?.settingsChanged()
                self?.watchSettings()
            }
        }
    }

    /// Wie `autoConnect` in Android: Neuer Schlüssel in den Einstellungen (z. B. über Drive von einem
    /// anderen Gerät), dieses Gerät ist aber nicht gekoppelt → gleich verbinden. Ein schon bekannter
    /// Schlüssel (nach „Trennen“ oder beim ersten Start) verbindet nicht von selbst.
    private func settingsChanged() {
        let s = settings
        let defaults = UserDefaults.standard
        let seen = defaults.string(forKey: Self.seenKeyDefaults)
        guard seen != s.key else { return }
        defaults.set(s.key, forKey: Self.seenKeyDefaults)
        guard seen != nil, !s.key.isEmpty, !isPaired else { return }
        Task { _ = await configure(url: s.url, key: s.key) }
    }

    // MARK: - Intern

    /// Leitet den Schlüssel ab (PBKDF2, bis ~1 s, im Hintergrund), erster Durchgang, dann WebSocket.
    @discardableResult
    private func connect(key: String, url: String) async -> String? {
        if sync != nil {
            if foreground && socket == nil { openSocket() }
            return nil
        }
        if let connecting { return await connecting.value }
        let task = Task { await createSync(key: key, url: url) }
        connecting = task
        defer { connecting = nil }
        return await task.value
    }

    private func createSync(key: String, url: String) async -> String? {
        state = .connecting
        label = "Verbinde …"
        progress = nil
        let core = store.core
        let listener = self.listener
        do {
            let created = try await Task.detached(priority: .userInitiated) {
                try CloudSync(core: core, syncKey: key, workerUrl: url.isEmpty ? nil : url, listener: listener)
            }.value
            sync = created
            usage = created.status().usageText
            syncNow()
            if foreground { openSocket() }
            return nil
        } catch {
            let message = Self.message(error)
            Profiler.shared.error("sync-error", message, name: "cloudflare.configure")
            state = .error
            label = "Fehler"
            detail = message
            return message
        }
    }

    private func disconnectInternal() {
        closeSocket()
        reconnectTask?.cancel()
        debounceTask?.cancel()
        sync?.stop()
        sync = nil
    }

    /// Ein Durchgang zur Zeit; Anfragen währenddessen werden zu einem weiteren zusammengefasst.
    private func runPasses() async {
        running = true
        defer { running = false }
        while pending, let current = sync {
            pending = false
            state = .syncing
            label = "Synchronisiere …"
            var attempt: UInt32 = 0
            while true {
                let all = forceAll
                forceAll = false
                do {
                    let report = try await Task.detached { try current.sync(forceAll: all) }.value
                    state = socket != nil ? .connected : .connecting
                    label = socket != nil ? "Verbunden" : "Synchronisiert"
                    detail = report.conflicts > 0 ? "\(report.conflicts) Konflikt(e) – siehe Konflikte" : "Alle Geräte auf demselben Stand"
                    progress = nil
                    usage = current.status().usageText
                    passes += 1
                    break
                } catch SyncFailure.Stopped {
                    break
                } catch let SyncFailure.Failed(reason, _, retryable, quota) {
                    if retryable && attempt < Self.maxRetries && sync === current {
                        attempt += 1
                        try? await Task.sleep(for: .milliseconds(Int(syncRetryDelayMs(attempt: attempt))))
                        continue
                    }
                    fail(quota ? "Cloud-Speicher voll – Cloud-Stand leeren oder verdichten" : reason)
                    passes += 1
                    break
                } catch {
                    fail(Self.message(error))
                    passes += 1
                    break
                }
            }
        }
    }

    private func fail(_ message: String) {
        Profiler.shared.error("sync-error", message, name: "cloudflare.sync")
        state = .error
        label = "Fehler"
        detail = message
        progress = nil
    }

    private func openSocket() {
        guard let current = sync, let url = URL(string: current.wsUrl()) else { return }
        let task = URLSession.shared.webSocketTask(with: url)
        socket = task
        task.resume()
        task.send(.string(current.wsAuthMessage())) { _ in }
        reconnectAttempt = 0
        if state != .syncing { state = .connected; label = "Verbunden" }
        pingTask?.cancel()
        pingTask = Task { [weak self, weak task] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(Int(wsPingIntervalMs())))
                guard let task, self?.socket === task else { return }
                task.send(.string(wsPingMessage())) { _ in }
            }
        }
        receive(task, current)
    }

    private func receive(_ task: URLSessionWebSocketTask, _ current: CloudSync) {
        task.receive { [weak self] result in
            Task { @MainActor in
                guard let self, self.socket === task else { return }
                switch result {
                case .success(.string(let text)):
                    await self.handle(text, current)
                    self.receive(task, current)
                case .success:
                    self.receive(task, current)
                case .failure:
                    self.lost(task)
                }
            }
        }
    }

    private func handle(_ text: String, _ current: CloudSync) async {
        let action = try? await Task.detached { try current.handleServerMessage(text: text) }.value
        switch action {
        case .sync(let all): syncNow(all: all)
        case .rejected(let message):
            state = .error
            label = "Abgewiesen"
            detail = message
            closeSocket()
        case .nothing, nil: break
        }
    }

    /// Verbindung weg (Netz, Server): mit wachsender Pause neu aufbauen, solange die App sichtbar ist.
    private func lost(_ task: URLSessionWebSocketTask) {
        guard socket === task else { return }
        closeSocket()
        guard foreground, sync != nil else { return }
        if state != .error { state = .connecting; label = "Verbinde …" }
        reconnectAttempt += 1
        let delay = syncReconnectDelayMs(attempt: reconnectAttempt)
        reconnectTask?.cancel()
        reconnectTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(Int(delay)))
            guard let self, !Task.isCancelled, self.foreground, self.sync != nil, self.socket == nil else { return }
            self.openSocket()
            self.syncNow()
        }
    }

    private func closeSocket() {
        pingTask?.cancel()
        socket?.cancel(with: .normalClosure, reason: nil)
        socket = nil
    }

    fileprivate func progressed(_ label: String, _ current: UInt64, _ total: UInt64) {
        progress = (label, total > 0 ? min(1, Double(current) / Double(total)) : 0)
    }

    /// Lokale Änderung: kurz bündeln, damit Tippen nicht jeden Buchstaben einzeln sendet.
    fileprivate func changed() {
        debounceTask?.cancel()
        debounceTask = Task { [weak self] in
            try? await Task.sleep(for: Self.debounce)
            if !Task.isCancelled { self?.syncNow() }
        }
    }

    private static func message(_ error: Error) -> String {
        switch error {
        case SyncFailure.InvalidKey(let reason): reason
        case let SyncFailure.Failed(reason, _, _, _): reason
        case SyncFailure.Stopped: "Sync abgebrochen."
        default: String(describing: error)
        }
    }
}

/// Rückrufe des Sync-Threads; reicht sie an den Hauptthread weiter und kehrt sofort zurück.
private final class Listener: SyncListener, @unchecked Sendable {
    private weak var owner: SyncController?
    init(owner: SyncController) { self.owner = owner }

    func onProgress(label: String, current: UInt64, total: UInt64) {
        Task { @MainActor [weak owner] in owner?.progressed(label, current, total) }
    }

    func onSyncNeeded() {
        Task { @MainActor [weak owner] in owner?.changed() }
    }
}
