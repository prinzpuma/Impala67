import Foundation
import Observation
import UIKit

/// Google-Drive-Backup (web/drive.js, `DriveController.kt`): Ablauf, Formate und Konflikte im Rust-Kern
/// (`DriveSync`); hier nur Anmeldung (`GoogleOAuth`), Token-Erneuerung und Timer. Wie Android erneuert
/// das iPad das Token still über das Refresh-Token im Schlüsselbund, solange die Zustimmung besteht.
@MainActor @Observable
final class DriveController {
    private(set) var connected = false
    /// Angemeldet gewesen, Google verlangt aber eine neue Zustimmung.
    private(set) var needsLogin = false
    private(set) var running = false
    private(set) var progress = ""
    /// Anteil 0…1 der laufenden Etappe; `nil`: unbestimmter Balken.
    private(set) var fraction: Double?
    /// Im laufenden Durchgang empfangene Bytes.
    private(set) var loadedBytes: UInt64 = 0
    private(set) var email = ""
    /// ISO-Zeit des letzten erfolgreichen Syncs.
    private(set) var lastOk: String?
    /// Letzte Meldung (Fehler oder Ergebnis), sonst leer.
    private(set) var message = ""
    private(set) var storage: DriveStorage?

    /// Ohne iOS-Client-ID in `project.yml` lässt sich nicht anmelden.
    var hasClient: Bool { !GoogleOAuth.clientId.isEmpty }

    @ObservationIgnored private let store: ImpalaStore
    @ObservationIgnored private var drive: DriveSync?
    @ObservationIgnored private var intervalTask: Task<Void, Never>?
    @ObservationIgnored private var foreground = false
    @ObservationIgnored private var tokens: DriveTokenStore!
    @ObservationIgnored private var listener: Progress?

    private static let connectedDefaults = "driveConnected"
    private static let emailDefaults = "driveEmail"

    init(store: ImpalaStore) {
        self.store = store
        tokens = DriveTokenStore { [weak self] in
            Task { @MainActor in self?.needsLogin = true }
        }
        listener = Progress(owner: self)
        email = UserDefaults.standard.string(forKey: Self.emailDefaults) ?? ""
        if UserDefaults.standard.bool(forKey: Self.connectedDefaults) {
            ensureDrive()
            refreshStatus()
        }
    }

    // MARK: - Lebenszyklus

    /// App sichtbar: einmal syncen und den Intervall-Timer starten.
    func onForeground() {
        foreground = true
        guard connected else { return }
        Task { await sync() }
        startInterval()
    }

    /// Hintergrund: Timer anhalten, eigenes Änderungspaket noch hochladen (mit etwas Hintergrundzeit).
    func onBackground() {
        foreground = false
        intervalTask?.cancel()
        guard let current = drive else { return }
        let app = UIApplication.shared
        // Läuft die Zeit ab, bricht `stop` das Hochladen ab; danach endet die Aufgabe unten.
        let id = app.beginBackgroundTask(withName: "drive-flush") { current.stop() }
        Task.detached(priority: .utility) {
            _ = try? current.flushUpload()
            await MainActor.run { app.endBackgroundTask(id) }
        }
    }

    // MARK: - Anmeldung

    /// Startet einen Anmeldeversuch; `nil`, wenn keine Client-ID hinterlegt ist.
    func loginAttempt() -> GoogleOAuth.Attempt? { GoogleOAuth.attempt() }

    /// Rücksprung von Google: Code tauschen, Konto lesen, erster Durchgang. Liefert eine Meldung bei Fehler.
    func finishLogin(callback: URL, attempt: GoogleOAuth.Attempt) async -> String? {
        do {
            let t = try await GoogleOAuth.exchange(callback: callback, attempt: attempt)
            tokens.remember(t)
        } catch GoogleOAuth.Failure.cancelled {
            return "Anmeldung abgebrochen."
        } catch GoogleOAuth.Failure.invalid(let reason) {
            return reason
        } catch {
            return error.localizedDescription
        }
        guard let current = ensureDrive(force: true) else { return "Google-Anmeldung fehlgeschlagen." }
        let fetched = (try? await Task.detached { try current.accountEmail() }.value) ?? nil
        let newEmail = fetched ?? ""
        // Anderes Konto: sonst gälte alles als schon hochgeladen (siehe `reset_state`).
        if !newEmail.isEmpty && !email.isEmpty && newEmail != email {
            _ = try? await Task.detached { try current.resetState() }.value
        }
        email = newEmail
        UserDefaults.standard.set(newEmail, forKey: Self.emailDefaults)
        UserDefaults.standard.set(true, forKey: Self.connectedDefaults)
        needsLogin = false
        Task { await sync() }
        if foreground { startInterval() }
        return nil
    }

    /// „Abmelden“: Tokens verwerfen und bei Google zurückziehen; Daten auf dem Gerät und in Drive bleiben.
    func logout() async {
        intervalTask?.cancel()
        drive?.stop()
        drive = nil
        let token = DriveKeychain.refreshToken ?? tokens.forget()
        _ = tokens.forget()
        DriveKeychain.refreshToken = nil
        UserDefaults.standard.set(false, forKey: Self.connectedDefaults)
        connected = false
        needsLogin = false
        message = ""
        lastOk = nil
        storage = nil
        if let token { await GoogleOAuth.revoke(token) }
    }

    // MARK: - Sync

    /// „Jetzt synchronisieren“ bzw. ein Timer-Durchgang. Läuft schon einer, passiert nichts.
    func sync() async {
        guard let current = ensureDrive(), !running else { return }
        running = true
        progress = ""
        fraction = nil
        loadedBytes = 0
        message = ""
        // Geladene Menge laufend zeigen: Ein großer Remote-Stand ist ein einziger langer Download.
        let ticker = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(1))
                let bytes = await Task.detached { current.status().loadedBytes }.value
                self?.loadedBytes = bytes
            }
        }
        let listener = self.listener
        do {
            let report = try await Task.detached(priority: .userInitiated) { try current.sync(progress: listener) }.value
            let clock = report.clockWarningMinutes.map { " · Geräteuhr weicht \($0) Minuten ab" } ?? ""
            let conflicts = report.conflicts > 0 ? " · \(report.conflicts) Konflikt(e)" : ""
            needsLogin = false
            message = report.label + conflicts + clock
        } catch DriveFailure.SessionExpired {
            needsLogin = true
            message = "Pausiert – zum Weitersichern neu anmelden"
        } catch DriveFailure.Stopped {
        } catch let DriveFailure.Failed(reason, _, offline) {
            message = offline ? "Offline · wartet" : reason
        } catch {
            message = String(describing: error)
        }
        ticker.cancel()
        running = false
        progress = ""
        fraction = nil
        loadedBytes = 0
        refreshStatus()
    }

    /// Wählbare Intervalle und der aktuelle Wert (`driveAutoSyncMinutes` in den Kern-Einstellungen).
    var intervalOptions: [DriveIntervalOption] { driveSyncIntervalOptions() }

    var intervalMinutes: UInt32 {
        get { UInt32(driveSyncIntervalMs(settingJson: settingJson("driveAutoSyncMinutes")) / 60_000) }
        set {
            if let data = try? JSONSerialization.data(withJSONObject: ["driveAutoSyncMinutes": newValue]),
               let patch = String(data: data, encoding: .utf8) {
                attempt("updateSettings", { try store.core.updateSettings(patchJson: patch) })
            }
            if foreground && connected { startInterval() }
        }
    }

    // MARK: - Intern

    @discardableResult
    private func ensureDrive(force: Bool = false) -> DriveSync? {
        if let drive { return drive }
        guard force || UserDefaults.standard.bool(forKey: Self.connectedDefaults) else { return nil }
        let created = DriveSync(core: store.core, tokens: tokens)
        drive = created
        connected = true
        return created
    }

    private func startInterval() {
        intervalTask?.cancel()
        intervalTask = Task { [weak self] in
            while !Task.isCancelled {
                guard let ms = self.map({ driveSyncIntervalMs(settingJson: $0.settingJson("driveAutoSyncMinutes")) }) else { return }
                try? await Task.sleep(for: .milliseconds(Int(ms)))
                guard !Task.isCancelled, let self else { return }
                if self.foreground { await self.sync() }
            }
        }
    }

    private func refreshStatus() {
        guard let current = drive else { return }
        Task {
            let (status, info) = await Task.detached { (current.status(), try? current.storageInfo()) }.value
            // `running` nicht übernehmen: der Wert ist beim Lesen schon veraltet.
            lastOk = status.lastOk
            if let info { storage = info }
        }
    }

    /// Ein Wert der Kern-Einstellungen als JSON-Text (für die Timer-Regeln des Kerns).
    private func settingJson(_ key: String) -> String? {
        let json = (try? JSONSerialization.jsonObject(with: Data(store.core.settingsJson().utf8))) as? [String: Any]
        guard let value = json?[key], !(value is NSNull),
              let data = try? JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed])
        else { return nil }
        return String(data: data, encoding: .utf8)
    }

    fileprivate func progressed(_ label: String, _ fraction: Double?) {
        progress = label
        self.fraction = fraction
    }
}

/// Fortschritt vom Drive-Thread; an den Hauptthread weiterreichen.
private final class Progress: DriveProgress, @unchecked Sendable {
    private weak var owner: DriveController?
    init(owner: DriveController) { self.owner = owner }

    func onProgress(label: String, fraction: Double?) {
        Task { @MainActor [weak owner] in owner?.progressed(label, fraction) }
    }
}
