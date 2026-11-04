import BackgroundTasks
import SwiftUI

/// Einstieg: öffnet den Rust-Kern im Hintergrund (Checkpoint + Log abspielen) und zeigt bis dahin
/// einen leeren Bildschirm, bei einem Fehler die Meldung.
@main
struct Impala67App: App {
    @State private var app = AppModel.shared
    @Environment(\.scenePhase) private var scenePhase
    @AppStorage(AppTheme.key) private var theme = AppTheme.system.rawValue

    var body: some Scene {
        WindowGroup {
            Group {
                if let store = app.store {
                    RootView().environment(store).environment(app.sync).environment(app.drive)
                } else if let startError = app.startError {
                    ContentUnavailableView("Start fehlgeschlagen", systemImage: "exclamationmark.triangle", description: Text(startError))
                } else {
                    ProgressView()
                }
            }
            .tint(Impala.accent)
            .preferredColorScheme(AppTheme(rawValue: theme)?.scheme)
            .task {
                await app.open()
                if scenePhase == .active { app.onForeground() }
            }
        }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .active: app.onForeground()
            case .background: app.onBackground()
            default: break
            }
        }
        // Wie `BackgroundSyncWorker` in Android: etwa stündlich ein Cloudflare-Durchgang ohne offene App.
        .backgroundTask(.appRefresh(AppModel.refreshTask)) {
            await AppModel.shared.backgroundRefresh()
        }
    }
}

/// Kern, Sync und Drive für die ganze App – auch für einen Hintergrundstart ohne Fenster.
@MainActor @Observable
final class AppModel {
    static let shared = AppModel()
    /// Muss in `BGTaskSchedulerPermittedIdentifiers` stehen (`ios/project.yml`).
    nonisolated static let refreshTask = "org.impala67.app.sync"

    private(set) var store: ImpalaStore?
    private(set) var sync: SyncController?
    private(set) var drive: DriveController?
    private(set) var startError: String?
    @ObservationIgnored private var opening: Task<Void, Never>?

    /// Öffnet den Kern genau einmal (parallele Aufrufe warten auf denselben Start).
    func open() async {
        if store != nil || startError != nil { return }
        if let opening { return await opening.value }
        Profiler.shared.start()
        let started = Date()
        let task = Task {
            do {
                let core = try await Task.detached(priority: .userInitiated) {
                    try ImpalaCore.open(dbPath: Self.databaseURL().path)
                }.value
                // Wie `boot-ready` der PWA: auffällig ab 1,5 s.
                Profiler.shared.operation("boot.core-open", durationMs: Date().timeIntervalSince(started) * 1000, thresholdMs: 1500)
                let store = ImpalaStore(core: core)
                self.store = store
                self.sync = SyncController(store: store)
                self.drive = DriveController(store: store)
            } catch {
                Profiler.shared.error("boot-error", String(describing: error), name: "boot.core-open")
                startError = String(describing: error)
            }
        }
        opening = task
        await task.value
    }

    func onForeground() {
        sync?.onForeground()
        drive?.onForeground()
        if let core = store?.core { HeftOcr.startBackgroundScan(core: core) }
    }

    /// Wie die Android-App in onStop: Checkpoint schreiben, damit der nächste Start schnell ist;
    /// dann den nächsten Hintergrund-Durchgang anmelden.
    func onBackground() {
        HeftOcr.stopBackgroundScan()
        sync?.onBackground()
        drive?.onBackground()
        saveCheckpoint()
        scheduleRefresh()
    }

    /// Ein Durchgang ohne offene App; danach Start-Schnappschuss und nächster Termin.
    func backgroundRefresh() async {
        scheduleRefresh()
        await open()
        guard let sync else { return }
        await withTaskCancellationHandler {
            _ = await sync.backgroundPass()
        } onCancel: {
            // Zeit abgelaufen: laufenden Durchgang abbrechen.
            Task { @MainActor in sync.cancelBackgroundPass() }
        }
        saveCheckpoint()
    }

    private func saveCheckpoint() {
        guard let core = store?.core else { return }
        Task.detached(priority: .utility) { _ = attempt(try core.saveCheckpoint(), "saveCheckpoint") }
    }

    /// Frühestens in einer Stunde; iOS entscheidet je nach Nutzung, wann wirklich.
    private func scheduleRefresh() {
        guard sync?.isPaired == true || store == nil else { return }
        let request = BGAppRefreshTaskRequest(identifier: Self.refreshTask)
        request.earliestBeginDate = Date(timeIntervalSinceNow: 60 * 60)
        try? BGTaskScheduler.shared.submit(request)
    }

    /// Derselbe Dateiname wie in der Android-App.
    nonisolated private static func databaseURL() throws -> URL {
        let dir = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        return dir.appendingPathComponent("impala67.db")
    }
}
