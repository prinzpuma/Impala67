import BackgroundTasks
import SwiftUI
import UIKit

/// Einstieg: öffnet den Rust-Kern im Hintergrund (Checkpoint + Log abspielen) und zeigt bis dahin
/// einen leeren Bildschirm, bei einem Fehler die Meldung.
@main
struct Impala67App: App {
    @State private var app = AppModel.shared
    @Environment(\.scenePhase) private var scenePhase
    @AppStorage(AppTheme.key) private var theme = AppTheme.system.rawValue
    @AppStorage(AppAccent.key) private var accent = AppAccent.blue.rawValue
    @AppStorage(AppDensity.key) private var density = AppDensity.compact.rawValue
    @AppStorage(AppFontSize.key) private var fontSize = AppFontSize.medium.rawValue
    @AppStorage(AppMotion.key) private var motion = AppMotion.full.rawValue

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
            .tint(AppAccent(rawValue: accent)?.color ?? Impala.accent)
            .preferredColorScheme(AppTheme(rawValue: theme)?.scheme)
            .dynamicTypeSize(AppFontSize(rawValue: fontSize)?.dynamicTypeSize ?? .large)
            .task {
                if scenePhase == .active { app.onForeground() }
                await app.open()
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
    /// Fenster sichtbar (letztes `onForeground` ohne folgendes `onBackground`).
    @ObservationIgnored private var isForeground = false

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
                let sync = SyncController(store: store)
                self.sync = sync
                self.drive = DriveController(store: store)
                Profiler.shared.context = { [weak sync] in Self.reportContext(core: core, sync: sync) }
                // Wurde die App sichtbar, während der Kern noch öffnete, lief `onForeground` ins Leere:
                // jetzt nachholen, damit Sync, Drive und OCR starten.
                if isForeground { onForeground() }
            } catch {
                Profiler.shared.error("boot-error", String(describing: error), name: "boot.core-open")
                startError = String(describing: error)
            }
        }
        opening = task
        await task.value
    }

    func onForeground() {
        isForeground = true
        sync?.onForeground()
        drive?.onForeground()
        if let core = store?.core { HeftOcr.startBackgroundScan(core: core) }
        DevBridge.shared.onForeground()
    }

    /// Wie die Android-App in onStop: Checkpoint schreiben, damit der nächste Start schnell ist;
    /// dann den nächsten Hintergrund-Durchgang anmelden.
    func onBackground() {
        isForeground = false
        HeftOcr.stopBackgroundScan()
        DevBridge.shared.onBackground()
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

    /// Zusatzangaben im Profiler-Bericht: Kern-Start, Sync-Stand und die Strichzahl je Seite des zuletzt
    /// geöffneten Hefts – dieselben Zahlen liefert die PWA (`impala_heft_page_image`), so fällt sofort auf,
    /// wenn diesem Gerät Striche fehlen.
    private static func reportContext(core: ImpalaCore, sync: SyncController?) -> [String: Any] {
        let load = core.loadInfo()
        var out: [String: Any] = [
            "core": ["eventCount": load.eventCount, "maxSeq": load.maxSeq, "replayed": load.replayed,
                     "checkpointUsed": load.checkpointUsed, "checkpointReject": load.checkpointReject ?? ""],
            "sync": sync?.diagnostics() ?? [:],
        ]
        if let id = HeftLastPage.open {
            let pages = core.heftPageIds(pageId: id).map { hid in
                attempt("heftPage", { try core.heftPage(pageId: id, heftPageId: hid) })?.strokes.count ?? -1
            }
            out["openHeft"] = ["pageId": id, "title": core.page(id: id)?.summary.title ?? "", "strokesPerPage": pages]
        }
        return out
    }

    /// Verdichtet bei Bedarf auch den Log (`saveCheckpoint` im Kern). Das kann einige Hundert ms
    /// dauern; iOS gibt der App dafür über `beginBackgroundTask` Zeit, statt sie mitten darin anzuhalten.
    private func saveCheckpoint() {
        guard let core = store?.core else { return }
        let task = BackgroundTime.begin("checkpoint")
        Task.detached(priority: .utility) {
            _ = attempt("saveCheckpoint", { try core.saveCheckpoint() })
            await task.end()
        }
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

/// Zusätzliche Laufzeit nach dem Wechsel in den Hintergrund; endet genau einmal (fertig oder abgelaufen).
@MainActor
final class BackgroundTime {
    private var id = UIBackgroundTaskIdentifier.invalid

    static func begin(_ name: String) -> BackgroundTime {
        let time = BackgroundTime()
        time.id = UIApplication.shared.beginBackgroundTask(withName: name) { [weak time] in time?.end() }
        return time
    }

    func end() {
        guard id != .invalid else { return }
        UIApplication.shared.endBackgroundTask(id)
        id = .invalid
    }
}
