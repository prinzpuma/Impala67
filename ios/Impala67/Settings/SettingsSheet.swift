import SwiftUI

/// Bereiche der Einstellungen wie `SETTINGS_SECTIONS` in settings-schema.js (gleiche Reihenfolge,
/// Namen und Beschreibungen). Es erscheint nur, was es am iPad wirklich gibt.
enum SettingsSection: String, CaseIterable, Identifiable, Hashable {
    case overview, appearance, ai, learning, sync, app

    var id: String { rawValue }

    var label: String {
        switch self {
        case .overview: "Übersicht"
        case .appearance: "Darstellung"
        case .ai: "KI"
        case .learning: "Lernen"
        case .sync: "Sync & Backup"
        case .app: "App & Speicher"
        }
    }

    var icon: String {
        switch self {
        case .overview: "home"
        case .appearance: "sun"
        case .ai: "sparkles"
        case .learning: "graduation"
        case .sync: "sync"
        case .app: "gear"
        }
    }

    var description: String {
        switch self {
        case .overview: "KI, Sync, Backup, Speicher und Version auf einen Blick"
        case .appearance: "Design, Lesbarkeit und Oberfläche"
        case .ai: "Modelle, Quellen und lokale KI"
        case .learning: "Lernverhalten, Pausen und Controller"
        case .sync: "Live-Sync, Google Drive und Backups"
        case .app: "Speicher, Updates und Experimente"
        }
    }
}

/// Einstellungen wie in der PWA: links die Bereiche, rechts ihr Inhalt – als geteilte Ansicht wie die
/// Einstellungen-App von iPadOS. Der zuletzt offene Bereich bleibt gemerkt (`impala67SettingsLastSection`).
struct SettingsSheet: View {
    @AppStorage("impala67SettingsLastSection") private var last = SettingsSection.overview.rawValue
    @State private var selection: SettingsSection?

    var body: some View {
        NavigationSplitView {
            List(SettingsSection.allCases, selection: $selection) { s in
                NavigationLink(value: s) {
                    Label {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(s.label).font(.system(size: TextSize.md, weight: .medium))
                            Text(s.description).font(.system(size: TextSize.sm)).foregroundStyle(Impala.text2)
                        }
                    } icon: {
                        Icon(s.icon, size: 18).foregroundStyle(Impala.accent)
                    }
                }
            }
            .navigationTitle("Einstellungen")
            .toolbar { ToolbarItem(placement: .cancellationAction) { CloseButton() } }
        } detail: {
            NavigationStack {
                SettingsDetail(section: selection ?? .overview) { selection = $0 }
            }
        }
        .navigationSplitViewStyle(.balanced)
        .onAppear { selection = SettingsSection(rawValue: last) ?? .overview }
        .onChange(of: selection) { if let selection { last = selection.rawValue } }
    }
}

/// Inhalt eines Bereichs; Gruppen wie `SETTINGS_ITEMS` (`group`).
private struct SettingsDetail: View {
    let section: SettingsSection
    let open: (SettingsSection) -> Void

    var body: some View {
        Form {
            switch section {
            case .overview: OverviewSection(open: open)
            case .appearance:
                ThemeSection()
                HomeSettingsSections()
            case .ai: AiSettingsSections()
            case .learning: WeekGoalSection()
            case .sync:
                CloudflareSection()
                DriveSections()
            case .app: AppSection()
            }
        }
        .formStyle(.grouped)
        .navigationTitle(section.label)
        .navigationBarTitleDisplayMode(.inline)
        .id(section)
    }
}

/// „App-Status“: KI, Sync, Backup, Speicher und Version; Antippen öffnet den Bereich.
private struct OverviewSection: View {
    @Environment(ImpalaStore.self) private var store
    @Environment(SyncController.self) private var sync
    @Environment(DriveController.self) private var drive
    let open: (SettingsSection) -> Void

    var body: some View {
        let _ = store.settingsRevision
        Section("Status") {
            row("KI", AiSettings.read(store.core).label, .ai)
            row("Cloudflare Live-Sync", sync.label, .sync)
            row("Google Drive", drive.connected ? (drive.needsLogin ? "Anmeldung nötig" : "Verbunden") : "Nicht verbunden", .sync)
            row("Lokaler Speicher", AppInfo.storage, .app)
            row("Version", AppInfo.version, .app)
        }
    }

    private func row(_ title: String, _ value: String, _ target: SettingsSection) -> some View {
        Button { open(target) } label: {
            LabeledContent(title, value: value)
                .foregroundStyle(Impala.text)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

/// Erscheinungsbild wie die PWA: System, Hell oder Dunkel (nur dieses Gerät).
enum AppTheme: String, CaseIterable {
    case system, light, dark

    static let key = "impala67Theme"

    var label: String {
        switch self {
        case .system: "System"
        case .light: "Hell"
        case .dark: "Dunkel"
        }
    }

    var scheme: ColorScheme? {
        switch self {
        case .system: nil
        case .light: .light
        case .dark: .dark
        }
    }
}

private struct ThemeSection: View {
    @AppStorage(AppTheme.key) private var theme = AppTheme.system.rawValue

    var body: some View {
        Section {
            Picker("Erscheinungsbild", selection: $theme) {
                ForEach(AppTheme.allCases, id: \.self) { Text($0.label).tag($0.rawValue) }
            }
        } header: {
            Text("Design")
        } footer: {
            Text("System, Hell oder Dunkel")
        }
    }
}

/// „App & Speicher“: lokaler Speicher und Version.
private struct AppSection: View {
    var body: some View {
        Section {
            LabeledContent("Lokaler Speicher", value: AppInfo.storage)
        } header: {
            Text("Speicher")
        } footer: {
            Text("Verwendeter Gerätespeicher der Datenbank dieses iPads.")
        }
        Section("App") {
            LabeledContent("Version", value: AppInfo.version)
        }
        ProfilerSection()
    }
}

/// „Für Entwickler → Performance-Profiler“ wie die PWA: Schalter, Einträge (neueste zuerst), Kopieren,
/// Teilen, Löschen.
private struct ProfilerSection: View {
    @State private var enabled = Profiler.shared.isEnabled
    @State private var records: [Profiler.Record] = []
    @State private var share: SharedFile?
    @State private var copied = false

    var body: some View {
        Section {
            Toggle(isOn: $enabled) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Performance-Profiler")
                    Text("Hänger, App- und KI-Fehler lokal protokollieren").font(.system(size: TextSize.sm)).foregroundStyle(Impala.text2)
                }
            }
            .tint(Impala.accent)
            .onChange(of: enabled) { _, on in Profiler.shared.setEnabled(on) }
            if enabled || !records.isEmpty {
                if records.isEmpty {
                    Text("Noch keine Auffälligkeiten.").font(.system(size: TextSize.sm)).foregroundStyle(Impala.text2)
                } else {
                    ForEach(records.prefix(60)) { r in ProfilerRow(record: r) }
                }
                HStack {
                    Button(copied ? "Kopiert" : "Kopieren") {
                        UIPasteboard.general.string = Profiler.shared.report()
                        copied = true
                    }
                    .buttonStyle(.glass)
                    Button("Teilen") { share = SharedFile(url: Profiler.shared.reportFile()) }
                        .buttonStyle(.glass)
                    Button("Aktualisieren") { reload() }
                        .buttonStyle(.glass)
                    Spacer()
                    Button("Löschen", role: .destructive) {
                        Profiler.shared.clear()
                        reload()
                    }
                    .buttonStyle(.glass)
                    .disabled(records.isEmpty)
                }
            }
        } header: {
            Text("Für Entwickler")
        } footer: {
            Text("Nur Auffälligkeiten: Hänger über 100 ms, Fehler des Kerns, Sync- und KI-Fehler, langsamer Start. Gleiche Einträge werden zusammengefasst; alles bleibt auf diesem iPad.")
        }
        .onAppear(perform: reload)
        .sheet(item: $share) { ShareSheet(items: [$0.url]) }
    }

    private func reload() {
        records = Profiler.shared.snapshot()
        copied = false
    }
}

/// Eintrag: Art und Name, Meldung, Anzahl, längste Dauer, Ansicht, Stelle, zuletzt.
private struct ProfilerRow: View {
    let record: Profiler.Record

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: Space.s2) {
                Circle().fill(isError ? Impala.danger : Impala.warn).frame(width: 8, height: 8)
                Text(title).font(.system(size: TextSize.sm, weight: .semibold)).foregroundStyle(Impala.text).lineLimit(1)
                Spacer(minLength: Space.s2)
                Text("\(record.count)×").font(.system(size: TextSize.sm).monospacedDigit()).foregroundStyle(Impala.text2)
            }
            if !record.message.isEmpty {
                Text(record.message).font(.system(size: TextSize.xs, design: .monospaced)).foregroundStyle(Impala.text2).lineLimit(3)
            }
            Text(details).font(.system(size: TextSize.xs)).foregroundStyle(Impala.text2).lineLimit(1)
        }
        .padding(.vertical, 2)
        .textSelection(.enabled)
    }

    private var isError: Bool { record.kind.contains("error") }

    private var title: String {
        switch record.kind {
        case "main-thread-stall": "Hänger"
        case "core-error": "Kern-Fehler · \(record.name)"
        case "sync-error": "Sync-Fehler"
        case "ai-error": "KI-Fehler"
        case "boot-error": "Startfehler"
        case "operation": "Langsam · \(record.name)"
        default: record.kind
        }
    }

    private var details: String {
        var parts: [String] = []
        if record.maxDurationMs > 0 {
            parts.append("max. \(Int(record.maxDurationMs.rounded())) ms · Ø \(Int(record.avgDurationMs.rounded())) ms")
        }
        parts.append(record.screen)
        if !record.source.isEmpty { parts.append(record.source) }
        parts.append(ChatList.when(ISO8601DateFormatter().string(from: record.lastAt)))
        return parts.joined(separator: " · ")
    }
}

enum AppInfo {
    static var version: String {
        let info = Bundle.main.infoDictionary
        let v = info?["CFBundleShortVersionString"] as? String ?? "–"
        let b = info?["CFBundleVersion"] as? String ?? "–"
        return "\(v) (\(b))"
    }

    /// Größe der Kern-Datenbank samt Schreib-Log (`impala67.db`, `-wal`).
    static var storage: String {
        guard let dir = try? FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: false)
        else { return "–" }
        let bytes = ["impala67.db", "impala67.db-wal"].reduce(Int64(0)) { sum, name in
            let size = (try? FileManager.default.attributesOfItem(atPath: dir.appendingPathComponent(name).path)[.size]) as? NSNumber
            return sum + (size?.int64Value ?? 0)
        }
        return ByteCountFormatter.string(fromByteCount: bytes, countStyle: .file)
    }
}

private struct CloudflareSection: View {
    @Environment(SyncController.self) private var sync
    @Environment(ImpalaStore.self) private var store
    @Environment(ShellModel.self) private var shell
    @State private var url = ""
    @State private var key = ""
    @State private var busy = false
    @State private var message: String?
    @State private var confirmReset = false
    @State private var scanning = false
    @State private var showPairing = false

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
            // QR-Kopplung wie settings.js (`handleCfScanPairing`, `handleCfPairing`).
            HStack {
                Button { scanning = true } label: { Label("QR-Code scannen", image: "i-camera") }
                    .buttonStyle(.glass)
                    .disabled(busy || sync.state == .connecting || sync.state == .syncing)
                if !url.trimmingCharacters(in: .whitespaces).isEmpty && !key.trimmingCharacters(in: .whitespaces).isEmpty {
                    Button { showPairing = true } label: { Label("Gerät koppeln (QR-Code)", image: "i-phone") }
                        .buttonStyle(.glass)
                        .transition(.opacity.combined(with: .scale(scale: 0.9)))
                }
            }
            .animation(.smooth, value: key.isEmpty)
            let _ = store.revision
            let conflicts = Int(store.core.conflictCount())
            if conflicts > 0 {
                // Neues Sheet-Ziel: SwiftUI schließt die Einstellungen und öffnet die Konflikte.
                Button { shell.sheet = .conflicts } label: {
                    Label(ConflictText.homeAlert(conflicts), image: "i-alert")
                        .foregroundStyle(Impala.text)
                }
            }
            if let message {
                Text(message).font(.system(size: TextSize.sm)).foregroundStyle(Impala.text2)
                    .transition(.opacity)
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
        .onChange(of: store.settingsRevision) {
            // Automatisch gekoppelt oder von einem anderen Gerät geändert.
            let s = sync.settings
            if !s.key.isEmpty { url = s.url; key = s.key }
        }
        .animation(.smooth, value: sync.isPaired)
        .animation(.smooth, value: message)
        .sheet(isPresented: $scanning) {
            CfScannerSheet { scannedUrl, scannedKey in
                url = scannedUrl
                key = scannedKey
                message = "Kopplungscode erkannt. Verbinde…"
                Task {
                    busy = true
                    let error = await sync.configure(url: scannedUrl, key: scannedKey)
                    busy = false
                    message = error == nil ? "Cloudflare-Sync erfolgreich gekoppelt!" : "Verbindung fehlgeschlagen. Bitte URL und Schlüssel prüfen."
                }
            }
        }
        .sheet(isPresented: $showPairing) {
            CfPairingSheet(url: url.trimmingCharacters(in: .whitespaces), key: key.trimmingCharacters(in: .whitespaces))
        }

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
