import AuthenticationServices
import SwiftUI

/// Google-Drive-Backup (settings-renderer.js `driveContent`, Texte wie `SettingsDrive.kt`). Ablauf im
/// Kern; hier nur Anzeige, Anmeldung und das Intervall.
struct DriveSections: View {
    @Environment(DriveController.self) private var drive
    @Environment(\.webAuthenticationSession) private var webAuth
    @State private var message: String?
    @State private var busy = false
    @State private var interval: UInt32 = 0

    var body: some View {
        Section {
            HStack(spacing: Space.s3) {
                Circle().fill(dotColor).frame(width: 10, height: 10).accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.system(size: TextSize.md, weight: .semibold)).contentTransition(.interpolate)
                    Text(detail).font(.system(size: TextSize.sm)).foregroundStyle(Impala.text2)
                }
            }
            .animation(.smooth, value: title)
            if drive.running {
                VStack(alignment: .leading, spacing: Space.s1) {
                    let loaded = drive.loadedBytes > 0 ? String(format: "%.1f MB geladen", Double(drive.loadedBytes) / 1_000_000) : ""
                    let line = [drive.progress, loaded].filter { !$0.isEmpty }.joined(separator: " · ")
                    if let f = drive.fraction {
                        ProgressView(value: f) { Text(line).font(.system(size: TextSize.sm)) }
                    } else {
                        ProgressView { Text(line.isEmpty ? "Synchronisiere …" : line).font(.system(size: TextSize.sm)) }
                    }
                }
                .transition(.opacity)
            } else if !drive.message.isEmpty {
                Text(drive.message).font(.system(size: TextSize.sm)).foregroundStyle(Impala.text2).transition(.opacity)
            }
            HStack {
                Button { action() } label: {
                    if busy { ProgressView() } else { Text(buttonLabel).contentTransition(.interpolate) }
                }
                .buttonStyle(.glassProminent)
                .disabled(busy || drive.running || (!drive.hasClient && !(drive.connected && !drive.needsLogin)))
                if drive.connected {
                    Button("Abmelden", role: .destructive) { Task { await drive.logout() } }
                        .buttonStyle(.glass)
                        .transition(.opacity.combined(with: .scale(scale: 0.9)))
                }
            }
            if !drive.hasClient {
                Text("Für die Google-Anmeldung fehlt in dieser App-Version die iOS-Client-ID (GOOGLE_IOS_CLIENT_ID in ios/project.yml).")
                    .font(.system(size: TextSize.sm)).foregroundStyle(Impala.danger)
            }
            if let message {
                Text(message).font(.system(size: TextSize.sm)).foregroundStyle(Impala.text2).transition(.opacity)
            }
            if let s = drive.storage, drive.connected {
                Text("Speicher: \(bytes(s.appBytes)) im App-Ordner · \(bytes(s.usedBytes)) von \(s.limitBytes > 0 ? bytes(s.limitBytes) : "unbegrenzt") belegt")
                    .font(.system(size: TextSize.sm)).foregroundStyle(Impala.text2)
            }
        } header: {
            Text("Google Drive")
        } footer: {
            Text("Drive verwendet den privaten App-Speicher. OAuth-Zugriffstokens bleiben immer gerätelokal.")
        }
        .animation(.smooth, value: drive.running)
        .animation(.smooth, value: drive.connected)
        .animation(.smooth, value: message)
        .sensoryFeedback(.success, trigger: drive.lastOk)

        Section {
            Picker(selection: $interval) {
                ForEach(drive.intervalOptions, id: \.minutes) { Text($0.label).tag($0.minutes) }
            } label: {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Sync-Intervall")
                    Text("Holt und sichert Daten regelmäßig, solange die App geöffnet ist")
                        .font(.system(size: TextSize.sm)).foregroundStyle(Impala.text2)
                }
            }
            .onChange(of: interval) { _, minutes in
                if minutes != drive.intervalMinutes { drive.intervalMinutes = minutes }
            }
        } header: {
            Text("Automatische Synchronisierung")
        } footer: {
            Text("Tipp: Bei aktivem Cloudflare-Sync reicht das tägliche Backup-Intervall völlig aus.")
        }
        .onAppear { interval = drive.intervalMinutes }
    }

    private var title: String {
        if drive.connected && !drive.needsLogin { return "Verbunden" }
        return drive.needsLogin ? "Pausiert" : "Nicht verbunden"
    }

    private var detail: String {
        let saved = Self.saved(drive.lastOk).map { "Zuletzt gesichert \($0)" }
        if drive.connected && !drive.needsLogin {
            return [drive.email.isEmpty ? "Google Drive" : drive.email, saved].compactMap { $0 }.joined(separator: " · ")
        }
        if drive.needsLogin { return [saved, "Zum Weitersichern neu anmelden"].compactMap { $0 }.joined(separator: " · ") }
        return "Google öffnet erst nach deinem Klick ein Anmeldefenster"
    }

    private var buttonLabel: String {
        if drive.needsLogin { return "Neu anmelden" }
        return drive.connected ? "Jetzt synchronisieren" : "Mit Google verbinden"
    }

    private var dotColor: Color {
        if drive.running { return Impala.accent }
        if drive.needsLogin { return Impala.warn }
        return drive.connected ? Impala.success : Impala.text2.opacity(0.4)
    }

    private func action() {
        if drive.connected && !drive.needsLogin {
            Task { await drive.sync() }
            return
        }
        guard let attempt = drive.loginAttempt() else {
            message = "Keine Google Client-ID hinterlegt."
            return
        }
        Task {
            busy = true
            defer { busy = false }
            do {
                let callback = try await webAuth.authenticate(
                    using: attempt.url,
                    callback: .customScheme(GoogleOAuth.callbackScheme),
                    preferredBrowserSession: .shared,
                    additionalHeaderFields: [:]
                )
                let error = await drive.finishLogin(callback: callback, attempt: attempt)
                message = error ?? "Google Drive verbunden."
            } catch let error as ASWebAuthenticationSessionError where error.code == .canceledLogin {
                message = "Anmeldung abgebrochen."
            } catch {
                message = error.localizedDescription
            }
        }
    }

    private func bytes(_ value: Double) -> String {
        ByteCountFormatter.string(fromByteCount: Int64(value), countStyle: .file)
    }

    /// „dd.MM.yyyy, HH:mm“ wie `formatSaved`.
    private static func saved(_ iso: String?) -> String? {
        guard let iso, !iso.isEmpty else { return nil }
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let date = f.date(from: iso) ?? { f.formatOptions = [.withInternetDateTime]; return f.date(from: iso) }()
        guard let date else { return nil }
        return date.formatted(Date.FormatStyle()
            .day(.twoDigits).month(.twoDigits).year(.defaultDigits).hour(.twoDigits(amPM: .omitted)).minute(.twoDigits)
            .locale(Locale(identifier: "de_DE")))
    }
}
