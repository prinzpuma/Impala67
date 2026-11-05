import SwiftUI

/// Bereiche der Einstellungen wie `SETTINGS_SECTIONS` in settings-schema.js (gleiche Reihenfolge,
/// Namen, Beschreibungen und Icons).
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
        case .appearance: "palette"
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

/// Einstellungen wie in der PWA: links die Bereiche samt Live-Suche, rechts ihr Inhalt im warmen Impala-Card-Design.
/// Der zuletzt offene Bereich bleibt gemerkt (`impala67SettingsLastSection`).
struct SettingsSheet: View {
    @AppStorage("impala67SettingsLastSection") private var last = SettingsSection.overview.rawValue
    @State private var selection: SettingsSection?
    @State private var searchQuery = ""

    var body: some View {
        NavigationSplitView {
            VStack(spacing: 0) {
                // Suchfeld wie in der PWA-Sidebar
                HStack(spacing: Space.s2) {
                    Icon("search", size: 15)
                        .foregroundStyle(Impala.text2)
                    TextField("Einstellungen suchen …", text: $searchQuery)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    if !searchQuery.isEmpty {
                        Button {
                            searchQuery = ""
                        } label: {
                            Icon("x", size: 12)
                                .foregroundStyle(Impala.text2)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 7)
                .background(Impala.surface, in: RoundedRectangle(cornerRadius: Radius.sm))
                .overlay {
                    RoundedRectangle(cornerRadius: Radius.sm)
                        .strokeBorder(Impala.edgeSoft, lineWidth: 1)
                }
                .padding(.horizontal, Space.s3)
                .padding(.vertical, Space.s2)

                Divider().overlay(Impala.edgeSoft)

                // Liste oder Suchergebnisse
                if searchQuery.trimmingCharacters(in: .whitespaces).isEmpty {
                    List(SettingsSection.allCases, selection: $selection) { s in
                        NavigationLink(value: s) {
                            HStack(spacing: Space.s3) {
                                Icon(s.icon, size: 18)
                                    .foregroundStyle(Impala.accent)
                                    .frame(width: 24, height: 24)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(s.label)
                                        .font(.system(size: TextSize.md, weight: .medium))
                                        .foregroundStyle(Impala.text)
                                    Text(s.description)
                                        .font(.system(size: TextSize.xs))
                                        .foregroundStyle(Impala.text2)
                                        .lineLimit(2)
                                }
                            }
                            .padding(.vertical, 2)
                        }
                    }
                    .listStyle(.sidebar)
                    .scrollContentBackground(.hidden)
                    .background(Impala.sidebar)
                } else {
                    let results = SettingsSearchIndex.search(searchQuery)
                    if results.isEmpty {
                        VStack(spacing: Space.s2) {
                            Spacer()
                            Text("Keine Einstellungen gefunden")
                                .font(.system(size: TextSize.sm))
                                .foregroundStyle(Impala.text2)
                            Spacer()
                        }
                    } else {
                        List(results) { item in
                            Button {
                                selection = item.section
                                searchQuery = ""
                            } label: {
                                VStack(alignment: .leading, spacing: 3) {
                                    HStack {
                                        Text(item.label)
                                            .font(.system(size: TextSize.sm, weight: .semibold))
                                            .foregroundStyle(Impala.text)
                                        Spacer()
                                        Text(item.section.label)
                                            .font(.system(size: TextSize.xs))
                                            .foregroundStyle(Impala.accent)
                                            .padding(.horizontal, 6)
                                            .padding(.vertical, 2)
                                            .background(Impala.activeTint, in: Capsule())
                                    }
                                    Text(item.description)
                                        .font(.system(size: TextSize.xs))
                                        .foregroundStyle(Impala.text2)
                                        .lineLimit(2)
                                }
                                .padding(.vertical, 3)
                            }
                            .buttonStyle(.plain)
                        }
                        .listStyle(.sidebar)
                        .scrollContentBackground(.hidden)
                        .background(Impala.sidebar)
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

/// Inhalt eines Bereichs im warmen Impala-Card-Look wie die PWA.
private struct SettingsDetail: View {
    let section: SettingsSection
    let open: (SettingsSection) -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                switch section {
                case .overview:
                    OverviewSection(open: open)
                case .appearance:
                    AppearanceSettingsSections()
                case .ai:
                    AiSettingsSections()
                case .learning:
                    LearningSettingsSections()
                case .sync:
                    VStack(alignment: .leading, spacing: 0) {
                        SettingsPageHead(
                            title: "Sync & Backup",
                            description: "Halte deine Geräte synchron und sichere deine Daten."
                        )
                        CloudflareSection()
                        DriveSections()
                        BackupSettingsSections()
                    }
                case .app:
                    AppSection()
                }
            }
            .padding(.horizontal, Space.s6)
            .padding(.vertical, Space.s4)
        }
        .background(Impala.panel)
        .navigationTitle(section.label)
        .navigationBarTitleDisplayMode(.inline)
        .id(section)
    }
}

/// „Übersicht“: Status-Kacheln für KI, Sync, Backup, Speicher und Version mit direkten Aktionen wie in der PWA.
private struct OverviewSection: View {
    @Environment(ImpalaStore.self) private var store
    @Environment(SyncController.self) private var sync
    @Environment(DriveController.self) private var drive
    @AppStorage("impala67LastBackup") private var lastBackup: String = ""
    let open: (SettingsSection) -> Void
    /// KI-Einstellungen: JSON-Lesen und Schlüsselbund im Hintergrund (`.task` unten), nicht im Body.
    @State private var ai: AiSettings?

    var body: some View {
        let _ = (store.settingsRevision, store.pageMetaRevision)
        let aiReady = ai.map { !$0.model.isEmpty } ?? false

        VStack(alignment: .leading, spacing: 0) {
            SettingsPageHead(
                title: "Übersicht",
                description: "Alles Wichtige auf einen Blick – ohne technische Details."
            )

            SettingsCardGroup(title: "Status") {
                // 1. KI
                SettingsLinkRow(
                    title: "KI",
                    description: aiReady ? (ai?.label ?? "") : (ai == nil ? "" : "Noch kein Modell gewählt"),
                    statusDot: aiReady ? .ok : .idle,
                    actionTitle: aiReady ? "Konfigurieren" : "Einrichten",
                    action: { open(.ai) }
                )

                SettingsDivider()

                // 2. Sync
                SettingsLinkRow(
                    title: "Sync",
                    description: syncDescription,
                    statusDot: syncTone,
                    actionTitle: sync.isPaired || drive.connected ? "Verwalten" : "Einrichten",
                    action: { open(.sync) }
                )

                SettingsDivider()

                // 3. Backup
                SettingsLinkRow(
                    title: "Backup",
                    description: !lastBackup.isEmpty ? "Zuletzt \(lastBackup)" : "Noch kein lokales Backup",
                    statusDot: !lastBackup.isEmpty ? .ok : (sync.isPaired || drive.connected ? .idle : .warn),
                    actionTitle: !lastBackup.isEmpty ? "Verwalten" : "Einrichten",
                    action: { open(.sync) }
                )

                SettingsDivider()

                // 4. Speicher
                SettingsLinkRow(
                    title: "Lokaler Speicher",
                    description: AppInfo.storage,
                    statusDot: .idle,
                    actionTitle: "Verwalten",
                    action: { open(.app) }
                )

                SettingsDivider()

                // 5. Version
                SettingsRow(
                    title: "App-Version",
                    description: "\(AppInfo.version) · Offline-App",
                    leading: { StatusIndicator(tone: .ok) }
                )
            }
        }
        .task(id: store.settingsRevision) {
            let core = store.core
            let next = await Task.detached(priority: .userInitiated) { AiSettings.read(core) }.value
            if !Task.isCancelled { ai = next }
        }
    }

    private var syncDescription: String {
        if sync.state == .connected || sync.state == .syncing {
            return "Cloudflare Live-Sync aktiv"
        }
        if drive.connected && !drive.needsLogin {
            return drive.email.isEmpty ? "Google Drive verbunden" : "Google Drive · \(drive.email)"
        }
        if drive.needsLogin {
            return "Google Drive · Anmeldung nötig"
        }
        return "Noch nicht eingerichtet"
    }

    private var syncTone: StatusTone {
        if sync.state == .syncing || sync.state == .connecting { return .syncing }
        if sync.state == .connected { return .ok }
        if drive.connected && !drive.needsLogin { return .ok }
        if drive.needsLogin { return .warn }
        return .idle
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

/// Darstellung wie die PWA (settings-renderer.js `renderAppearance`):
/// Design (Theme, Akzent, Dichte), Lesbarkeit (Schriftgröße, Performance-Modus, Haptik),
/// Oberfläche (Tab-Anordnung, Begrüßungsname, Tagesartikel, Verwandte Seiten, Themen).
private struct AppearanceSettingsSections: View {
    @Environment(ImpalaStore.self) private var store
    @AppStorage(AppTheme.key) private var theme = AppTheme.system.rawValue
    @AppStorage(AppAccent.key) private var accent = AppAccent.blue.rawValue
    @AppStorage(AppDensity.key) private var density = AppDensity.compact.rawValue
    @AppStorage(AppFontSize.key) private var fontSize = AppFontSize.medium.rawValue
    @AppStorage(AppMotion.key) private var motion = AppMotion.full.rawValue
    @AppStorage(AppHaptics.key) private var haptics = true
    @AppStorage(AppTabsPosition.key) private var tabsPosition = AppTabsPosition.top.rawValue

    @State private var homeName = ""
    @State private var homeArticle = true
    @State private var homeTopics = ""
    @State private var relatedPages = true
    @State private var loaded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            SettingsPageHead(
                title: "Darstellung",
                description: "Ein ruhiges Erscheinungsbild, das zu deinem Gerät und deinem Lernstil passt."
            )

            // MARK: - Design
            SettingsCardGroup(
                title: "Design",
                footnote: "Bestimmt Farben, Kontraste und Informationsdichte"
            ) {
                SettingsRow(title: "Erscheinungsbild", description: theme == "system" ? "Folgt automatisch deinem Gerät" : "Manuell festgelegt") {
                    Picker("Theme", selection: $theme) {
                        ForEach(AppTheme.allCases, id: \.self) { Text($0.label).tag($0.rawValue) }
                    }
                    .labelsHidden()
                    .pickerStyle(.segmented)
                    .frame(maxWidth: 220)
                }

                SettingsDivider()

                AccentPickerRow(selected: $accent)

                SettingsDivider()

                SettingsRow(title: "Darstellungsdichte", description: "Bestimmt Abstände und Zeilenhöhe") {
                    Picker("Dichte", selection: $density) {
                        ForEach(AppDensity.allCases) { Text($0.label).tag($0.rawValue) }
                    }
                    .labelsHidden()
                    .pickerStyle(.segmented)
                    .frame(maxWidth: 220)
                }
            }

            // MARK: - Lesbarkeit
            SettingsCardGroup(
                title: "Lesbarkeit",
                footnote: "Performance-Modus: für ältere Geräte ohne Animationen, Milchglas-Effekte und Hintergrund-Handschrifterkennung."
            ) {
                SettingsRow(title: "Schriftgröße", description: "Gilt appweit für Notizen und Menüs") {
                    Picker("Schriftgröße", selection: $fontSize) {
                        ForEach(AppFontSize.allCases) { Text($0.label).tag($0.rawValue) }
                    }
                    .labelsHidden()
                    .pickerStyle(.segmented)
                    .frame(maxWidth: 220)
                }

                SettingsDivider()

                SettingsSwitchRow(
                    title: "Performance-Modus",
                    description: "Ohne Animationen, Milchglas und Hintergrund-OCR",
                    isOn: Binding(
                        get: { motion == AppMotion.reduced.rawValue },
                        set: { motion = $0 ? AppMotion.reduced.rawValue : AppMotion.full.rawValue }
                    )
                )

                SettingsDivider()

                SettingsSwitchRow(
                    title: "Haptisches Feedback",
                    description: "Taktile Vibrationen bei Aktionen, Werkzeugwechsel und Bewertungen",
                    isOn: $haptics
                )
            }

            // MARK: - Oberfläche
            SettingsCardGroup(
                title: "Oberfläche",
                footnote: "Die KI fasst Notizen einmal täglich als kurzen Startseiten-Artikel zusammen."
            ) {
                SettingsRow(title: "Tab-Anordnung", description: tabsPosition == AppTabsPosition.sidebar.rawValue ? "Vertikale Tabs in der linken Seitenleiste" : "Horizontale Leiste oben (Standard)") {
                    Picker("Tabs", selection: $tabsPosition) {
                        ForEach(AppTabsPosition.allCases) { Text($0.label).tag($0.rawValue) }
                    }
                    .labelsHidden()
                    .pickerStyle(.segmented)
                    .frame(maxWidth: 220)
                }

                SettingsDivider()

                SettingsRow(title: "Begrüßungsname", description: "Erscheint in der Begrüßung auf der Startseite") {
                    TextField("Optional", text: $homeName)
                        .textFieldStyle(.roundedBorder)
                        .frame(maxWidth: 180)
                        .onSubmit(saveHome)
                }

                SettingsDivider()

                SettingsSwitchRow(
                    title: "Tagesartikel",
                    description: "Tägliche Zusammenfassung deiner Notizen auf der Startseite",
                    isOn: Binding(
                        get: { homeArticle },
                        set: {
                            homeArticle = $0
                            AiSettings.patch(store.core, ["homeArticle": $0])
                        }
                    )
                )

                if homeArticle {
                    SettingsDivider()
                    VStack(alignment: .leading, spacing: Space.s2) {
                        Text("Themen für den Tagesartikel")
                            .font(.system(size: TextSize.base, weight: .medium))
                            .foregroundStyle(Impala.text)
                        Text("Kommagetrennt. Leer = automatisch aus deinen aktiven Fächern")
                            .font(.system(size: TextSize.sm))
                            .foregroundStyle(Impala.text2)
                        TextField("Automatisch", text: $homeTopics)
                            .textFieldStyle(.roundedBorder)
                            .onSubmit(saveHome)

                        if !topicSuggestions.isEmpty {
                            ScrollView(.horizontal, showsIndicators: false) {
                                HStack(spacing: 6) {
                                    ForEach(topicSuggestions.prefix(6), id: \.self) { s in
                                        Button {
                                            let trimmed = homeTopics.trimmingCharacters(in: .whitespaces)
                                            homeTopics = trimmed.isEmpty ? s : "\(trimmed), \(s)"
                                            saveHome()
                                        } label: {
                                            Text("+ \(s)")
                                                .font(.system(size: TextSize.xs, weight: .medium))
                                                .foregroundStyle(Impala.accent)
                                                .padding(.horizontal, 8)
                                                .padding(.vertical, 4)
                                                .background(Impala.activeTint, in: Capsule())
                                        }
                                        .buttonStyle(.plain)
                                    }
                                }
                                .padding(.vertical, 2)
                            }
                        }
                    }
                    .padding(.horizontal, Space.s4)
                    .padding(.vertical, Space.s3)
                }

                SettingsDivider()

                SettingsSwitchRow(
                    title: "Verwandte Seiten",
                    description: "Zeigt unter jeder Notiz bis zu drei inhaltlich ähnliche Seiten",
                    isOn: Binding(
                        get: { relatedPages },
                        set: {
                            relatedPages = $0
                            AiSettings.patch(store.core, ["relatedPages": $0])
                        }
                    )
                )
            }
        }
        .onAppear {
            let s = HomeSettings.read(store.core)
            homeName = s.name
            homeArticle = s.article
            homeTopics = s.topics
            relatedPages = s.relatedPages
            loaded = true
        }
        .onDisappear {
            saveHome()
        }
    }

    private func saveHome() {
        guard loaded else { return }
        AiSettings.patch(store.core, [
            "homeUserName": homeName.trimmingCharacters(in: .whitespaces),
            "homeArticleTopics": homeTopics.trimmingCharacters(in: .whitespaces)
        ])
    }

    private var topicSuggestions: [String] {
        let own = Set(homeTopics.components(separatedBy: CharacterSet(charactersIn: ",;\n")).map { $0.trimmingCharacters(in: .whitespaces).lowercased() })
        let ws = store.core.workspaces().map(\.name)
        return ws.filter { !own.contains($0.lowercased()) && !$0.isEmpty }
    }
}

/// Farbwahl der Akzente mit runden Farbtupfern wie in der PWA.
private struct AccentPickerRow: View {
    @Binding var selected: String

    var body: some View {
        HStack(spacing: Space.s3) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Akzentfarbe")
                    .font(.system(size: TextSize.base, weight: .medium))
                    .foregroundStyle(Impala.text)
                Text("Für Auswahl, Fokus und wichtige Aktionen")
                    .font(.system(size: TextSize.sm))
                    .foregroundStyle(Impala.text2)
            }
            Spacer(minLength: Space.s2)
            HStack(spacing: 12) {
                ForEach(AppAccent.allCases) { a in
                    Button {
                        selected = a.rawValue
                    } label: {
                        Circle()
                            .fill(a.color)
                            .frame(width: 28, height: 28)
                            .overlay {
                                if selected == a.rawValue {
                                    Image(systemName: "checkmark")
                                        .font(.system(size: 12, weight: .bold))
                                        .foregroundStyle(Impala.onAccent)
                                }
                            }
                            .overlay {
                                if selected == a.rawValue {
                                    Circle()
                                        .strokeBorder(Impala.text, lineWidth: 2)
                                        .padding(-3)
                                }
                            }
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(a.label)
                }
            }
        }
        .padding(.horizontal, Space.s4)
        .padding(.vertical, Space.rowPadding + 3)
    }
}

/// „App & Speicher“: Speicheranzeige, App-Version, Beta-Design, Gefahrenzone und Profiler.
private struct AppSection: View {
    @AppStorage("impala67BetaUi") private var betaUi = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            SettingsPageHead(
                title: "App & Speicher",
                description: "Speicher im Blick behalten, die App aktuell halten und Neues ausprobieren."
            )

            // MARK: - Speicher
            SettingsCardGroup(
                title: "Speicher",
                footnote: "Verwendeter Speicher der Datenbank und Notizdateien auf diesem iPad."
            ) {
                SettingsRow(
                    title: "Verwendeter Speicher",
                    description: "IndexedDB-Äquivalent, Handschrift-Striche und Medien",
                    trailing: {
                        Text(AppInfo.storage)
                            .font(.system(size: TextSize.sm, weight: .semibold))
                            .foregroundStyle(Impala.text)
                    }
                )
            }

            // MARK: - App
            SettingsCardGroup(title: "App") {
                SettingsRow(
                    title: "App-Version",
                    description: "\(AppInfo.version) · Native iPad-App",
                    leading: { StatusIndicator(tone: .ok) }
                )
            }

            // MARK: - Experimente
            SettingsCardGroup(
                title: "Experimente",
                footnote: "Experimentelle Funktionen gelten nur auf diesem iPad und können sich noch ändern."
            ) {
                SettingsSwitchRow(
                    title: "Beta-Design",
                    description: "Platz zum Testen neuer Design-Ideen",
                    isOn: $betaUi
                )
            }

            // MARK: - Gefahrenzone
            DangerZoneGroup()

            // MARK: - Profiler
            ProfilerSection()
        }
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
        SettingsCardGroup(
            title: "Für Entwickler",
            footnote: "Nur Auffälligkeiten: Hänger über 100 ms, Fehler des Kerns, Sync- und KI-Fehler, langsamer Start. Alles bleibt auf diesem iPad."
        ) {
            SettingsSwitchRow(
                title: "Performance-Profiler",
                description: "Hänger, App- und KI-Fehler lokal protokollieren",
                isOn: Binding(
                    get: { enabled },
                    set: {
                        enabled = $0
                        Profiler.shared.setEnabled($0)
                    }
                )
            )

            if enabled || !records.isEmpty {
                SettingsDivider()
                if records.isEmpty {
                    SettingsRow(title: "Keine Auffälligkeiten", description: "Bisher traten keine Hänger oder Fehler auf.")
                } else {
                    ForEach(records.prefix(40)) { r in
                        ProfilerRow(record: r)
                        SettingsDivider()
                    }
                }

                HStack {
                    Button(copied ? "Kopiert" : "Kopieren") {
                        UIPasteboard.general.string = Profiler.shared.report()
                        copied = true
                    }
                    .buttonStyle(.glass)

                    Button("Teilen") {
                        share = SharedFile(url: Profiler.shared.reportFile())
                    }
                    .buttonStyle(.glass)

                    Button("Aktualisieren") {
                        reload()
                    }
                    .buttonStyle(.glass)

                    Spacer()

                    Button("Löschen", role: .destructive) {
                        Profiler.shared.clear()
                        reload()
                    }
                    .buttonStyle(.glass)
                    .disabled(records.isEmpty)
                }
                .padding(.horizontal, Space.s4)
                .padding(.vertical, Space.s3)
            }
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
        .padding(.horizontal, Space.s4)
        .padding(.vertical, 4)
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
        return "v\(v) (\(b))"
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
    /// Offene Sync-Konflikte; im Hintergrund gezählt (`.task` unten).
    @State private var conflicts = 0

    var body: some View {
        SettingsCardGroup(
            title: "Cloudflare Live-Sync",
            footnote: "Echtzeit-Synchronisierung über WebSockets mit Ende-zu-Ende-Verschlüsselung (AES-GCM 256-Bit). Den Schlüssel findest du in der PWA unter Einstellungen → Sync."
        ) {
            // Status-Zeile
            SettingsRow(
                title: sync.label,
                description: sync.detail,
                leading: { StatusIndicator(tone: syncTone) },
                trailing: {
                    if sync.isPaired {
                        HStack(spacing: Space.s2) {
                            Button("Synchronisieren") { sync.syncNow() }
                                .buttonStyle(.glassProminent)
                            Button("Trennen", role: .destructive) { sync.disconnect() }
                                .buttonStyle(.glass)
                        }
                    }
                }
            )

            if let p = sync.progress {
                SettingsDivider()
                VStack(alignment: .leading, spacing: Space.s1) {
                    ProgressView(value: p.fraction) {
                        Text(p.label).font(.system(size: TextSize.sm))
                    }
                }
                .padding(.horizontal, Space.s4)
                .padding(.vertical, Space.s2)
            }

            SettingsDivider()

            VStack(alignment: .leading, spacing: Space.s2) {
                TextField("Cloudflare Worker URL", text: $url)
                    .textFieldStyle(.roundedBorder)
                    .textContentType(.URL)
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()

                SecureField("Sync-Schlüssel (E2EE)", text: $key)
                    .textFieldStyle(.roundedBorder)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()

                HStack {
                    if !sync.isPaired {
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
                        .buttonStyle(.glass)
                    }
                }

                HStack(spacing: Space.s2) {
                    Button {
                        scanning = true
                    } label: {
                        Label("QR-Code scannen", image: "i-camera")
                    }
                    .buttonStyle(.glass)
                    .disabled(busy || sync.state == .connecting || sync.state == .syncing)

                    if !url.trimmingCharacters(in: .whitespaces).isEmpty && !key.trimmingCharacters(in: .whitespaces).isEmpty {
                        Button {
                            showPairing = true
                        } label: {
                            Label("Gerät koppeln (QR-Code)", image: "i-phone")
                        }
                        .buttonStyle(.glass)
                    }
                }
            }
            .padding(.horizontal, Space.s4)
            .padding(.vertical, Space.s3)

            if conflicts > 0 {
                SettingsDivider()
                Button {
                    shell.sheet = .conflicts
                } label: {
                    Label(ConflictText.homeAlert(conflicts), image: "i-alert")
                        .foregroundStyle(Impala.warn)
                }
                .padding(.horizontal, Space.s4)
                .padding(.vertical, Space.s2)
            }

            if let message {
                SettingsDivider()
                SettingsRow(title: "Hinweis", description: message)
            }
        }
        .task(id: [store.remoteRevision, store.pageMetaRevision]) {
            let core = store.core
            let next = await Task.detached(priority: .utility) { Int(core.conflictCount()) }.value
            if !Task.isCancelled { conflicts = next }
        }
        .onAppear {
            let s = sync.settings
            url = s.url
            key = s.key
        }
        .onChange(of: store.settingsRevision) {
            let s = sync.settings
            if !s.key.isEmpty { url = s.url; key = s.key }
        }
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

        // Cloud-Speicher
        SettingsCardGroup(
            title: "Cloud-Speicher",
            footnote: "Löscht den synchronisierten Datenstand auf dem Cloudflare-Server. Deine lokalen Daten auf diesem iPad bleiben vollständig erhalten."
        ) {
            SettingsRow(
                title: "Alles neu vom Server abrufen",
                description: "Holt Änderungen nach, die diesem iPad fehlen (z. B. Heft-Schrift, die nur die PWA zeigt). Löscht nichts."
            ) {
                Button {
                    Task {
                        busy = true
                        message = await sync.refetchAll()
                        busy = false
                    }
                } label: {
                    if busy { ProgressView() } else { Text("Abrufen") }
                }
                .buttonStyle(.glass)
                .disabled(!sync.isPaired || busy)
            }
            SettingsDivider()
            SettingsRow(
                title: "Verwendeter Speicherplatz",
                description: sync.usage
            ) {
                Button("Cloud-Stand leeren", role: .destructive) {
                    confirmReset = true
                }
                .buttonStyle(.glass)
                .disabled(!sync.isPaired)
            }
        }
        .confirmationDialog("Cloud-Daten löschen", isPresented: $confirmReset, titleVisibility: .visible) {
            Button("Cloud leeren", role: .destructive) {
                Task { message = await sync.resetCloud() }
            }
            Button("Abbrechen", role: .cancel) {}
        } message: {
            Text("Deine lokalen Daten auf diesem Gerät bleiben vollständig erhalten.")
        }
    }

    private var syncTone: StatusTone {
        switch sync.state {
        case .connected: .ok
        case .syncing, .connecting: .syncing
        case .error: .danger
        case .disconnected: .idle
        }
    }
}
