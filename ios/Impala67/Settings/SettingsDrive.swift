import AuthenticationServices
import SwiftUI

/// Google-Drive-Backup (settings-renderer.js `driveContent`, Texte wie `SettingsDrive.kt`).
/// Ablauf im Kern; hier Anzeige, Anmeldung, Intervall und erweiterte Optionen.
struct DriveSections: View {
    @Environment(DriveController.self) private var drive
    @Environment(ImpalaStore.self) private var store
    @Environment(\.webAuthenticationSession) private var webAuth
    @State private var message: String?
    @State private var busy = false
    @State private var interval: UInt32 = 0
    @State private var syncAfterChange = false
    @State private var syncSecrets = false
    @State private var clientId = ""
    @State private var showAdvanced = false

    var body: some View {
        let _ = store.settingsRevision

        // MARK: - Google Drive Status
        SettingsCardGroup(
            title: "Google Drive",
            footnote: "Drive verwendet den privaten App-Speicher. OAuth-Zugriffstokens bleiben immer gerätelokal."
        ) {
            SettingsRow(
                title: title,
                description: detail,
                leading: { StatusIndicator(tone: statusTone) },
                trailing: {
                    HStack(spacing: Space.s2) {
                        Button {
                            action()
                        } label: {
                            if busy {
                                ProgressView()
                            } else {
                                Text(buttonLabel).contentTransition(.interpolate)
                            }
                        }
                        .buttonStyle(.glassProminent)
                        .disabled(busy || drive.running || (!drive.hasClient && !(drive.connected && !drive.needsLogin)))

                        if drive.connected {
                            Button("Abmelden", role: .destructive) {
                                Task { await drive.logout() }
                            }
                            .buttonStyle(.glass)
                        }
                    }
                }
            )

            if drive.running {
                SettingsDivider()
                VStack(alignment: .leading, spacing: Space.s1) {
                    let loaded = drive.loadedBytes > 0 ? String(format: "%.1f MB geladen", Double(drive.loadedBytes) / 1_000_000) : ""
                    let line = [drive.progress, loaded].filter { !$0.isEmpty }.joined(separator: " · ")
                    if let f = drive.fraction {
                        ProgressView(value: f) { Text(line).font(.system(size: TextSize.sm)) }
                    } else {
                        ProgressView { Text(line.isEmpty ? "Synchronisiere …" : line).font(.system(size: TextSize.sm)) }
                    }
                }
                .padding(.horizontal, Space.s4)
                .padding(.vertical, Space.s2)
            } else if !drive.message.isEmpty {
                SettingsDivider()
                SettingsRow(title: "Status", description: drive.message)
            }

            if !drive.hasClient {
                SettingsDivider()
                SettingsRow(
                    title: "Google Client-ID fehlt",
                    description: "Für die Google-Anmeldung fehlt in dieser App-Version die iOS-Client-ID (GOOGLE_IOS_CLIENT_ID in project.yml)."
                )
            }

            if let s = drive.storage, drive.connected {
                SettingsDivider()
                SettingsRow(
                    title: "Verwendeter Drive-Speicher",
                    description: "\(bytes(s.appBytes)) im App-Ordner · \(bytes(s.usedBytes)) von \(s.limitBytes > 0 ? bytes(s.limitBytes) : "unbegrenzt") belegt"
                )
            }

            if drive.connected && !drive.needsLogin {
                SettingsDivider()
                SettingsRow(
                    title: "Aus Drive wiederherstellen",
                    description: "Holt alles aus dem Drive-Backup, was diesem iPad fehlt. Löscht nichts."
                ) {
                    Button("Wiederherstellen") { Task { await drive.sync(restore: true) } }
                        .buttonStyle(.glass)
                        .disabled(drive.running)
                }
            }

            if let message {
                SettingsDivider()
                SettingsRow(title: "Hinweis", description: message)
            }
        }
        .sensoryFeedback(.success, trigger: drive.lastOk)

        // MARK: - Automatische Synchronisierung
        SettingsCardGroup(
            title: "Automatische Synchronisierung",
            footnote: "Tipp: Bei aktivem Cloudflare-Sync reicht das tägliche Backup-Intervall völlig aus."
        ) {
            if let info = drive.modeInfo {
                SettingsRow(
                    title: "Drive-Modus",
                    description: !info.selectable
                        ? "Cloudflare synchronisiert deine Geräte; Drive lädt nur hoch und holt nichts ab"
                        : info.mode == "sync" ? "Drive holt auch Änderungen anderer Geräte" : "Drive lädt nur hoch; Wiederherstellen oben unter Google Drive"
                ) {
                    Picker("Drive-Modus", selection: Binding(get: { info.mode }, set: { drive.setMode($0) })) {
                        Text("Nur sichern (Backup)").tag("backup")
                        Text("Synchronisieren").tag("sync")
                    }
                    .labelsHidden()
                    .pickerStyle(.menu)
                    .disabled(!info.selectable)
                }
                SettingsDivider()
            }
            SettingsRow(
                title: "Sync-Intervall",
                description: "Holt und sichert Daten regelmäßig, solange die App geöffnet ist"
            ) {
                Picker("Intervall", selection: $interval) {
                    ForEach(drive.intervalOptions, id: \.minutes) { Text($0.label).tag($0.minutes) }
                }
                .labelsHidden()
                .pickerStyle(.menu)
            }
            .onChange(of: interval) { _, minutes in
                if minutes != drive.intervalMinutes { drive.intervalMinutes = minutes }
            }

            SettingsDivider()

            SettingsSwitchRow(
                title: "Nach jeder Änderung synchronisieren",
                description: "Sichert Änderungen nach kurzer Bündelung zusätzlich zum Intervall",
                isOn: Binding(
                    get: { syncAfterChange },
                    set: { val in
                        syncAfterChange = val
                        AiSettings.patch(store.core, ["driveSyncAfterChange": val])
                    }
                )
            )

            SettingsDivider()

            SettingsSwitchRow(
                title: "Tokens über Drive synchronisieren",
                description: syncSecrets
                    ? "KI-Keys werden an deine eigenen Geräte übertragen"
                    : "Tokens bleiben ausschließlich auf diesem Gerät",
                isOn: Binding(
                    get: { syncSecrets },
                    set: { val in
                        syncSecrets = val
                        AiSettings.patch(store.core, ["syncSecrets": val])
                    }
                )
            )
        }

        // MARK: - Erweitert
        SettingsCardGroup(title: "Erweitert") {
            DisclosureGroup("Google Client-ID", isExpanded: $showAdvanced) {
                VStack(alignment: .leading, spacing: Space.s2) {
                    Text("OAuth-Webclient-ID für benutzerdefinierte Google-Integrationen")
                        .font(.system(size: TextSize.sm))
                        .foregroundStyle(Impala.text2)
                    TextField("OAuth-Webclient-ID", text: $clientId)
                        .textFieldStyle(.roundedBorder)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    HStack {
                        Spacer()
                        Button("Speichern") {
                            AiSettings.patch(store.core, ["driveClientId": clientId.trimmingCharacters(in: .whitespacesAndNewlines)])
                        }
                        .buttonStyle(.glassProminent)
                    }
                }
                .padding(.vertical, 4)
            }
            .padding(.horizontal, Space.s4)
            .padding(.vertical, Space.s2 + 2)
        }
        // Beim Erscheinen und bei jeder Einstellungsänderung genau einmal (Lesen + Parsen im Hintergrund).
        .task(id: store.settingsRevision) { await loadSettings() }
    }

    private func loadSettings() async {
        interval = drive.intervalMinutes
        let core = store.core
        let loaded = await Task.detached(priority: .userInitiated) { () -> (after: Bool, secrets: Bool, client: String) in
            let s = (try? JSONSerialization.jsonObject(with: Data(core.settingsJson().utf8))) as? [String: Any] ?? [:]
            return (s["driveSyncAfterChange"] as? Bool ?? false, s["syncSecrets"] as? Bool ?? false, s["driveClientId"] as? String ?? "")
        }.value
        if Task.isCancelled { return }
        syncAfterChange = loaded.after
        syncSecrets = loaded.secrets
        clientId = loaded.client
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

    private var statusTone: StatusTone {
        if drive.running { return .syncing }
        if drive.needsLogin { return .warn }
        return drive.connected ? .ok : .idle
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
