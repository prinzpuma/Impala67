import SwiftUI

/// Einstellungen (Cloudflare Live-Sync und KI, Texte wie `SettingsCloudflare.kt` bzw. die PWA).
struct SettingsSheet: View {
    var body: some View {
        Form {
            CloudflareSection()
            AiSettingsSections()
        }
        .formStyle(.grouped)
        .navigationTitle("Einstellungen")
        .navigationBarTitleDisplayMode(.inline)
    }
}

private struct CloudflareSection: View {
    @Environment(SyncController.self) private var sync
    @State private var url = ""
    @State private var key = ""
    @State private var busy = false
    @State private var message: String?
    @State private var confirmReset = false

    var body: some View {
        Section {
            HStack(spacing: Space.s3) {
                StatusDot(state: sync.state)
                VStack(alignment: .leading, spacing: 2) {
                    Text(sync.label)
                        .font(.system(size: TextSize.md, weight: .semibold))
                        .contentTransition(.interpolate)
                    Text(sync.detail).font(.system(size: TextSize.sm)).foregroundStyle(Impala.text2)
                }
                .animation(.smooth, value: sync.label)
            }
            if let p = sync.progress {
                ProgressView(value: p.fraction) { Text(p.label).font(.system(size: TextSize.sm)) }
                    .transition(.opacity)
            }
            TextField("Cloudflare Worker URL", text: $url)
                .textContentType(.URL)
                .keyboardType(.URL)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            SecureField("Sync-Schlüssel (E2EE)", text: $key)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            HStack {
                if sync.isPaired {
                    Button("Jetzt synchronisieren") { sync.syncNow() }
                        .buttonStyle(.glassProminent)
                    Button("Trennen", role: .destructive) { sync.disconnect() }
                        .buttonStyle(.glass)
                } else {
                    Button {
                        Task {
                            busy = true
                            message = await sync.configure(url: url, key: key)
                            busy = false
                        }
                    } label: {
                        if busy { ProgressView() } else { Text("Verbinden") }
                    }
                    .buttonStyle(.glassProminent)
                    .disabled(busy)
                    Button("Schlüssel generieren") {
                        key = sync.newKey()
                        message = "Neuer Sync-Schlüssel generiert. Kopiere ihn auf deine anderen Geräte!"
                    }
                    .buttonStyle(.glass)
                }
                Spacer()
                if !key.isEmpty {
                    Button {
                        UIPasteboard.general.string = key
                        message = "Sync-Schlüssel in die Zwischenablage kopiert."
                    } label: {
                        Label("Schlüssel kopieren", image: "i-copy")
                    }
                    .labelStyle(.iconOnly)
                }
            }
            if let message {
                Text(message).font(.system(size: TextSize.sm)).foregroundStyle(Impala.text2)
            }
        } header: {
            Text("Cloudflare Live-Sync")
        } footer: {
            Text("Echtzeit-Synchronisierung über WebSockets mit Ende-zu-Ende-Verschlüsselung. Den Schlüssel findest du in der PWA unter Einstellungen → Sync.")
        }
        .onAppear {
            let s = sync.settings
            url = s.url
            key = s.key
        }
        .animation(.smooth, value: sync.isPaired)

        Section {
            LabeledContent("Verwendeter Speicherplatz", value: sync.usage)
            Button("Cloud-Stand leeren", role: .destructive) { confirmReset = true }
                .disabled(!sync.isPaired)
        } header: {
            Text("Cloud-Speicher")
        } footer: {
            Text("Löscht den synchronisierten Datenstand auf dem Cloudflare-Server. Deine lokalen Daten auf diesem Gerät bleiben vollständig erhalten.")
        }
        .confirmationDialog("Cloud-Daten löschen", isPresented: $confirmReset, titleVisibility: .visible) {
            Button("Cloud leeren", role: .destructive) { Task { message = await sync.resetCloud() } }
            Button("Abbrechen", role: .cancel) {}
        } message: {
            Text("Deine lokalen Daten auf diesem Gerät bleiben vollständig erhalten.")
        }
    }
}

/// Punkt wie die Sync-Anzeige der PWA: grün verbunden, pulsierend beim Synchronisieren, rot bei Fehler.
struct StatusDot: View {
    let state: SyncController.State

    var body: some View {
        Circle()
            .fill(color)
            .frame(width: 10, height: 10)
            .phaseAnimator([false, true]) { dot, on in
                dot.scaleEffect(pulsing && on ? 1.35 : 1).opacity(pulsing && on ? 0.6 : 1)
            } animation: { _ in .easeInOut(duration: 0.6) }
            .animation(.smooth, value: state)
            .accessibilityHidden(true)
    }

    private var pulsing: Bool { state == .syncing || state == .connecting }

    private var color: Color {
        switch state {
        case .connected: Color(uiColor: UIColor(hex: 0x37845A))
        case .syncing, .connecting: Impala.accent
        case .error: Impala.danger
        case .disconnected: Impala.text2.opacity(0.4)
        }
    }
}
