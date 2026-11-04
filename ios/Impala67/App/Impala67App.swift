import SwiftUI

/// Einstieg: öffnet den Rust-Kern im Hintergrund (Checkpoint + Log abspielen) und zeigt bis dahin
/// einen leeren Bildschirm, bei einem Fehler die Meldung.
@main
struct Impala67App: App {
    @State private var store: ImpalaStore?
    @State private var startError: String?
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            Group {
                if let store {
                    RootView().environment(store)
                } else if let startError {
                    ContentUnavailableView("Start fehlgeschlagen", systemImage: "exclamationmark.triangle", description: Text(startError))
                } else {
                    ProgressView()
                }
            }
            .tint(Impala.accent)
            .task { await openCore() }
        }
        .onChange(of: scenePhase) { _, phase in
            // Wie die Android-App in onStop: Checkpoint schreiben, damit der nächste Start schnell ist.
            if phase == .background, let core = store?.core {
                Task.detached(priority: .utility) { _ = try? core.saveCheckpoint() }
            }
        }
    }

    private func openCore() async {
        guard store == nil else { return }
        do {
            let core = try await Task.detached(priority: .userInitiated) {
                try ImpalaCore.open(dbPath: Self.databaseURL().path)
            }.value
            store = ImpalaStore(core: core)
        } catch {
            startError = String(describing: error)
        }
    }

    /// Derselbe Dateiname wie in der Android-App.
    nonisolated private static func databaseURL() throws -> URL {
        let dir = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        return dir.appendingPathComponent("impala67.db")
    }
}
