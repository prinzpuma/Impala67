import SwiftUI
import UIKit

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
    @FocusState private var searchFocused: Bool
    @Environment(\.dismiss) private var dismiss

    private var activeSection: SettingsSection {
        selection ?? SettingsSection(rawValue: last) ?? .overview
    }

    var body: some View {
        GeometryReader { geo in
            let isCompact = geo.size.width < 680
            if isCompact {
                compactLayout
            } else {
                standardLayout
            }
        }
        .background(Impala.panel)
        .background {
            Button("") {
                searchFocused = true
            }
            .keyboardShortcut("k", modifiers: .command)
            .opacity(0)
        }
        .onAppear {
            selection = SettingsSection(rawValue: last) ?? .overview
        }
        .onChange(of: selection) {
            if let selection { last = selection.rawValue }
        }
    }

    // MARK: - Standard (2-Spalten wie .settings-modal-v2)
    private var standardLayout: some View {
        ZStack(alignment: .topTrailing) {
            HStack(spacing: 0) {
                // Linke Sidebar (width: 252)
                sidebarContent
                    .padding(.horizontal, 12)
                    .padding(.vertical, 20)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                    .frame(width: 252)
                    .background(Impala.sidebar)
                    .overlay(alignment: .trailing) {
                        Rectangle().fill(Impala.edgeSoft).frame(width: 1)
                    }

                // Rechter Inhaltsbereich (.settings-main)
                ScrollView {
                    SettingsDetail(section: activeSection) { s in
                        selection = s
                        last = s.rawValue
                    }
                    .frame(maxWidth: 680, alignment: .leading)
                    .padding(.horizontal, 36)
                    .padding(.top, 38)
                    .padding(.bottom, 48)
                    .frame(maxWidth: .infinity)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Impala.panel)
            }

            // Schließen-Button oben rechts (.modal-x)
            Button {
                dismiss()
            } label: {
                Icon("x", size: 16)
                    .foregroundStyle(Impala.text2)
                    .frame(width: 32, height: 32)
                    .background(Impala.surface.opacity(0.01), in: RoundedRectangle(cornerRadius: Radius.sm))
            }
            .buttonStyle(.plain)
            .padding(.top, 12)
            .padding(.trailing, 14)
        }
    }

    // MARK: - Sidebar-Inhalt (Standard-Layout)
    private var sidebarContent: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Sidebar-Titel (.settings-sidebar-title)
            Text("Einstellungen")
                .font(.system(size: TextSize.md, weight: .bold))
                .foregroundStyle(Impala.text)
                .padding(.horizontal, 10)
                .padding(.bottom, 14)

            // Suchfeld (.settings-search)
            HStack(spacing: 8) {
                Icon("search", size: 15)
                    .foregroundStyle(Impala.text2)
                TextField("Einstellungen suchen …", text: $searchQuery)
                    .textFieldStyle(.plain)
                    .font(.system(size: TextSize.sm))
                    .foregroundStyle(Impala.text)
                    .focused($searchFocused)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()

                if searchQuery.isEmpty {
                    Text("⌘ K")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(Impala.text2)
                        .padding(.horizontal, 5)
                        .padding(.vertical, 2)
                        .background(Impala.panel, in: RoundedRectangle(cornerRadius: 5))
                        .overlay(
                            RoundedRectangle(cornerRadius: 5)
                                .strokeBorder(Impala.edgeSoft, lineWidth: 1)
                        )
                } else {
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
            .frame(height: 34)
            .background(Impala.panel, in: RoundedRectangle(cornerRadius: Radius.sm))
            .overlay(
                RoundedRectangle(cornerRadius: Radius.sm)
                    .strokeBorder(searchFocused ? Impala.accentBorder : Impala.edgeSoft, lineWidth: 1)
            )

            // Navigation / Suchergebnisse
            if searchQuery.trimmingCharacters(in: .whitespaces).isEmpty {
                VStack(spacing: 3) {
                    ForEach(SettingsSection.allCases) { s in
                        Button {
                            selection = s
                            last = s.rawValue
                        } label: {
                            HStack(spacing: 10) {
                                Icon(s.icon, size: 17)
                                    .foregroundStyle(activeSection == s ? Impala.accent : Impala.text2)
                                    .frame(width: 25, height: 25)
                                Text(s.label)
                                    .font(.system(size: 14, weight: .semibold))
                                    .foregroundStyle(activeSection == s ? Impala.text : Impala.text2)
                                Spacer(minLength: 0)
                            }
                            .padding(.horizontal, 9)
                            .padding(.vertical, 6)
                            .frame(minHeight: 40)
                            .background(activeSection == s ? Impala.activeTint : Color.clear, in: RoundedRectangle(cornerRadius: Radius.md))
                            .contentShape(RoundedRectangle(cornerRadius: Radius.md))
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.top, 12)
            } else {
                let results = SettingsSearchIndex.search(searchQuery)
                ScrollView {
                    if results.isEmpty {
                        Text("Keine Einstellungen gefunden")
                            .font(.system(size: TextSize.sm))
                            .foregroundStyle(Impala.text2)
                            .padding(14)
                    } else {
                        VStack(spacing: 0) {
                            ForEach(Array(results.enumerated()), id: \.element.id) { index, item in
                                if index > 0 {
                                    SettingsDivider()
                                }
                                Button {
                                    selection = item.section
                                    last = item.section.rawValue
                                    searchQuery = ""
                                    searchFocused = false
                                } label: {
                                    HStack(spacing: 8) {
                                        VStack(alignment: .leading, spacing: 2) {
                                            Text(item.label)
                                                .font(.system(size: TextSize.sm, weight: .semibold))
                                                .foregroundStyle(Impala.text)
                                            Text("\(item.section.label) · \(item.description)")
                                                .font(.system(size: TextSize.xs))
                                                .foregroundStyle(Impala.text2)
                                                .lineLimit(1)
                                        }
                                        Spacer(minLength: 4)
                                        Icon("chevron-right", size: 13)
                                            .foregroundStyle(Impala.text2)
                                    }
                                    .padding(.horizontal, 10)
                                    .padding(.vertical, 8)
                                    .contentShape(Rectangle())
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        .background(Impala.panel, in: RoundedRectangle(cornerRadius: Radius.md))
                        .overlay(
                            RoundedRectangle(cornerRadius: Radius.md)
                                .strokeBorder(Impala.edgeSoft, lineWidth: 1)
                        )
                    }
                }
                .padding(.top, 8)
            }
        }
    }

    // MARK: - Kompakt (wie @media (max-width: 760px) in der PWA)
    private var compactLayout: some View {
        VStack(spacing: 0) {
            // Oben Suchleiste + Schließen-Button
            HStack(spacing: 10) {
                HStack(spacing: 8) {
                    Icon("search", size: 15)
                        .foregroundStyle(Impala.text2)
                    TextField("Einstellungen suchen …", text: $searchQuery)
                        .textFieldStyle(.plain)
                        .font(.system(size: TextSize.sm))
                        .foregroundStyle(Impala.text)
                        .focused($searchFocused)
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
                .frame(height: 34)
                .background(Impala.panel, in: RoundedRectangle(cornerRadius: Radius.sm))
                .overlay(
                    RoundedRectangle(cornerRadius: Radius.sm)
                        .strokeBorder(searchFocused ? Impala.accentBorder : Impala.edgeSoft, lineWidth: 1)
                )

                Button {
                    dismiss()
                } label: {
                    Icon("x", size: 16)
                        .foregroundStyle(Impala.text2)
                        .frame(width: 32, height: 32)
                        .background(Impala.surface.opacity(0.01), in: RoundedRectangle(cornerRadius: Radius.sm))
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 14)
            .padding(.top, 14)
            .padding(.bottom, 8)
            .background(Impala.sidebar)

            // Horizontale Reiter-Leiste
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(SettingsSection.allCases) { s in
                        let isSelected = activeSection == s
                        Button {
                            selection = s
                            last = s.rawValue
                        } label: {
                            HStack(spacing: 6) {
                                Icon(s.icon, size: 15)
                                    .foregroundStyle(isSelected ? Impala.accent : Impala.text2)
                                Text(s.label)
                                    .font(.system(size: TextSize.sm, weight: .semibold))
                                    .foregroundStyle(isSelected ? Impala.text : Impala.text2)
                            }
                            .padding(.horizontal, 12)
                            .padding(.vertical, 7)
                            .background(isSelected ? Impala.activeTint : Impala.panel, in: Capsule())
                            .overlay(
                                Capsule().strokeBorder(isSelected ? Impala.accentBorder : Impala.edgeSoft, lineWidth: 1)
                            )
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
            }
            .background(Impala.sidebar)
            .overlay(alignment: .bottom) {
                Rectangle().fill(Impala.edgeSoft).frame(height: 1)
            }

            // Darunter Suchergebnisse oder ScrollView mit SettingsDetail
            if !searchQuery.trimmingCharacters(in: .whitespaces).isEmpty {
                let results = SettingsSearchIndex.search(searchQuery)
                ScrollView {
                    if results.isEmpty {
                        Text("Keine Einstellungen gefunden")
                            .font(.system(size: TextSize.sm))
                            .foregroundStyle(Impala.text2)
                            .padding(24)
                    } else {
                        VStack(spacing: 0) {
                            ForEach(Array(results.enumerated()), id: \.element.id) { index, item in
                                if index > 0 {
                                    SettingsDivider()
                                }
                                Button {
                                    selection = item.section
                                    last = item.section.rawValue
                                    searchQuery = ""
                                    searchFocused = false
                                } label: {
                                    HStack(spacing: 12) {
                                        VStack(alignment: .leading, spacing: 2) {
                                            Text(item.label)
                                                .font(.system(size: TextSize.sm, weight: .semibold))
                                                .foregroundStyle(Impala.text)
                                            Text("\(item.section.label) · \(item.description)")
                                                .font(.system(size: TextSize.xs))
                                                .foregroundStyle(Impala.text2)
                                                .lineLimit(1)
                                        }
                                        Spacer(minLength: 8)
                                        Icon("chevron-right", size: 13)
                                            .foregroundStyle(Impala.text2)
                                    }
                                    .padding(.horizontal, 14)
                                    .padding(.vertical, 10)
                                    .contentShape(Rectangle())
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        .background(Impala.panel, in: RoundedRectangle(cornerRadius: Radius.md))
                        .overlay(
                            RoundedRectangle(cornerRadius: Radius.md)
                                .strokeBorder(Impala.edgeSoft, lineWidth: 1)
                        )
                        .padding(14)
                    }
                }
                .background(Impala.panel)
            } else {
                ScrollView {
                    SettingsDetail(section: activeSection) { s in
                        selection = s
                        last = s.rawValue
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 20)
                }
                .background(Impala.panel)
            }
        }
    }
}

/// Inhalt eines Bereichs im warmen Impala-Card-Look wie die PWA.
private struct SettingsDetail: View {
    let section: SettingsSection
    let open: (SettingsSection) -> Void

    var body: some View {
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
    /// Backup-Kachel erstellt das Backup direkt wie `btnExport` in der PWA-Übersicht.
    @State private var backupFile: SharedFile?

    var body: some View {
        let _ = (store.settingsRevision, store.pageMetaRevision)
        let aiReady = ai.map { !$0.model.isEmpty } ?? false

        VStack(alignment: .leading, spacing: 0) {
            SettingsPageHead(
                title: "Übersicht",
                description: "Alles Wichtige auf einen Blick – ohne technische Details."
            )

            Text("Status")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Impala.text2)
                .padding(.horizontal, 4)
                .padding(.bottom, 6)

            LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
                // 1. KI
                SettingsOverviewTile(
                    title: "KI",
                    description: aiReady ? (ai?.label ?? "") : (ai == nil ? "…" : "Noch kein Modell gewählt"),
                    statusTone: aiReady ? .ok : .idle,
                    actionTitle: aiReady ? "Konfigurieren" : "Einrichten",
                    action: { open(.ai) }
                )

                // 2. Sync
                SettingsOverviewTile(
                    title: "Sync",
                    description: syncDescription,
                    statusTone: syncTone,
                    actionTitle: sync.isPaired || drive.connected ? "Verwalten" : "Einrichten",
                    action: { open(.sync) }
                )

                // 3. Backup
                SettingsOverviewTile(
                    title: "Backup",
                    description: !lastBackup.isEmpty ? "Zuletzt \(lastBackup)" : "Noch kein lokales Backup",
                    statusTone: !lastBackup.isEmpty ? .ok : (sync.isPaired || drive.connected ? .idle : .warn),
                    actionTitle: !lastBackup.isEmpty ? "Backup erneut erstellen" : "Backup erstellen",
                    action: { backupFile = (try? BackupExport.write(store)).map { SharedFile(url: $0) } }
                )

                // 4. Speicher
                SettingsOverviewTile(
                    title: "Speicher",
                    description: "\(AppInfo.storage) verwendet",
                    statusTone: .idle,
                    meterFraction: AppInfo.storageFraction,
                    actionTitle: "Verwalten",
                    action: { open(.app) }
                )
            }

            // 5. App-Version über die volle Breite
            SettingsOverviewTile(
                title: "App-Version",
                description: "\(AppInfo.version) · Offline-App",
                statusTone: .ok,
                actionTitle: "App & Speicher",
                action: { open(.app) }
            )
            .padding(.top, 10)
        }
        .sheet(item: $backupFile) { ShareSheet(items: [$0.url]) }
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
    @AppStorage(AppStatusBar.hiddenKey) private var statusBarHidden = false

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
                    SettingsSegmented(options: AppTheme.allCases.map { ($0.rawValue, $0.label) }, selection: $theme)
                }

                SettingsDivider()

                AccentPickerRow(selected: $accent)

                SettingsDivider()

                DensityPickerRow(selected: $density)
            }

            // MARK: - Lesbarkeit
            SettingsCardGroup(
                title: "Lesbarkeit",
                footnote: "Performance-Modus: für ältere Geräte ohne Animationen, Milchglas-Effekte und Hintergrund-Handschrifterkennung."
            ) {
                SettingsRow(title: "Schriftgröße", description: "Gilt appweit für Notizen und Menüs") {
                    SettingsSegmented(options: AppFontSize.allCases.map { ($0.rawValue, $0.label) }, selection: $fontSize)
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
                    SettingsSegmented(options: AppTabsPosition.allCases.map { ($0.rawValue, $0.label) }, selection: $tabsPosition)
                }

                SettingsDivider()

                SettingsSwitchRow(
                    title: "Statusleiste ausblenden",
                    description: "Uhrzeit, WLAN und Akku oben verstecken – mehr Platz für Notizen",
                    isOn: $statusBarHidden
                )

                SettingsDivider()

                SettingsInputRow(title: "Begrüßungsname", description: "Erscheint in der Begrüßung auf der Startseite") {
                    TextField("Optional", text: $homeName)
                        .settingsInputStyle()
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
                            .font(.system(size: TextSize.base, weight: .semibold))
                            .foregroundStyle(Impala.text)
                        Text("Kommagetrennt. Leer = automatisch aus deinen aktiven Fächern")
                            .font(.system(size: TextSize.sm))
                            .foregroundStyle(Impala.text2)
                        TextField("Automatisch", text: $homeTopics)
                            .settingsInputStyle()
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
        HStack(alignment: .center, spacing: Space.s3) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Akzentfarbe")
                    .font(.system(size: TextSize.base, weight: .semibold))
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
                            .fill(swatchColor(for: a))
                            .frame(width: 30, height: 30)
                            .overlay {
                                if selected == a.rawValue {
                                    Circle()
                                        .strokeBorder(Impala.text, lineWidth: 2)
                                        .padding(-4)
                                }
                            }
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(a.label)
                }
            }
            .padding(.trailing, 2)
        }
        .frame(minHeight: 58)
        .padding(.horizontal, Space.s4)
        .padding(.vertical, 12)
    }

    private func swatchColor(for accent: AppAccent) -> Color {
        switch accent {
        case .blue: Color(uiColor: UIColor(hex: 0x5E9FE8))
        case .violet: Color(uiColor: UIColor(hex: 0xA78BFA))
        case .green: Color(uiColor: UIColor(hex: 0x72BC8F))
        case .orange: Color(uiColor: UIColor(hex: 0xDE9255))
        }
    }
}

/// Darstellungsdichte mit interaktiven Layout-Vorschaukarten wie in der PWA.
private struct DensityPickerRow: View {
    @Binding var selected: String

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Darstellungsdichte")
                    .font(.system(size: TextSize.base, weight: .semibold))
                    .foregroundStyle(Impala.text)
                Text("Bestimmt Abstände und Zeilenhöhe")
                    .font(.system(size: TextSize.sm))
                    .foregroundStyle(Impala.text2)
            }

            HStack(spacing: 10) {
                ForEach(AppDensity.allCases) { d in
                    let isSelected = selected == d.rawValue
                    Button {
                        selected = d.rawValue
                    } label: {
                        VStack(alignment: .leading, spacing: 8) {
                            // Mini-Layout-Vorschau (54pt hoch)
                            GeometryReader { geo in
                                ZStack(alignment: .leading) {
                                    if d == .compact {
                                        HStack(spacing: 0) {
                                            Rectangle()
                                                .fill(Impala.edge)
                                                .frame(width: geo.size.width * 0.22)
                                            Rectangle()
                                                .fill(Impala.surface.opacity(0.4))
                                        }
                                    } else {
                                        HStack(spacing: 4) {
                                            RoundedRectangle(cornerRadius: 4)
                                                .fill(Impala.edge)
                                                .frame(width: max(10, (geo.size.width - 12) * 0.20))
                                            RoundedRectangle(cornerRadius: 4)
                                                .fill(Impala.surface)
                                        }
                                        .padding(4)
                                    }
                                }
                            }
                            .frame(height: 54)
                            .background(Impala.surface.opacity(0.5), in: RoundedRectangle(cornerRadius: Radius.sm))
                            .overlay(
                                RoundedRectangle(cornerRadius: Radius.sm)
                                    .strokeBorder(Impala.edgeSoft, lineWidth: 1)
                            )
                            .clipShape(RoundedRectangle(cornerRadius: Radius.sm))

                            Text(d.label)
                                .font(.system(size: TextSize.sm, weight: .semibold))
                                .foregroundStyle(Impala.text)
                        }
                        .padding(10)
                        .frame(maxWidth: .infinity)
                        .background(
                            isSelected ? Impala.accent.opacity(0.08) : Impala.panel,
                            in: RoundedRectangle(cornerRadius: Radius.md)
                        )
                        .overlay(
                            RoundedRectangle(cornerRadius: Radius.md)
                                .strokeBorder(isSelected ? Impala.accent : Impala.edgeSoft, lineWidth: 1)
                        )
                        .contentShape(RoundedRectangle(cornerRadius: Radius.md))
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .padding(.horizontal, Space.s4)
        .padding(.vertical, 12)
    }
}

/// „App & Speicher“: Speicheranzeige, Aufschlüsselung, App-Version, Beta-Design, Gefahrenzone und Profiler.
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
                title: "Lokaler Speicher",
                footnote: "Verwendeter Speicher der Datenbank und Notizdateien auf diesem iPad."
            ) {
                VStack(alignment: .leading, spacing: 8) {
                    HStack(alignment: .center) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Verwendeter Speicher")
                                .font(.system(size: TextSize.base, weight: .semibold))
                                .foregroundStyle(Impala.text)
                            Text("SQLite-Datenbank, Handschrift-Striche und Medien")
                                .font(.system(size: TextSize.sm))
                                .foregroundStyle(Impala.text2)
                        }
                        Spacer(minLength: Space.s2)
                        Text(AppInfo.storage)
                            .font(.system(size: TextSize.sm, weight: .semibold))
                            .foregroundStyle(Impala.text)
                    }
                    SettingsMeter(fraction: AppInfo.storageFraction)
                }
                .padding(.horizontal, Space.s4)
                .padding(.vertical, 14)

                SettingsDivider()

                HStack(spacing: 10) {
                    // Karte 1: Datenbank & Hefte
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Text("Datenbank")
                                .font(.system(size: TextSize.sm, weight: .semibold))
                                .foregroundStyle(Impala.text)
                            Spacer(minLength: 4)
                            Text(AppInfo.dbBreakdown.db)
                                .font(.system(size: 11, weight: .semibold))
                                .foregroundStyle(Impala.text2)
                                .padding(.horizontal, 7)
                                .padding(.vertical, 2)
                                .background(Impala.activeTint, in: Capsule())
                        }
                        Text("Seiten, Ordner, Karteikarten und Zeichnungen")
                            .font(.system(size: TextSize.xs))
                            .foregroundStyle(Impala.text2)
                            .lineLimit(2)
                    }
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Impala.panel.opacity(0.6), in: RoundedRectangle(cornerRadius: Radius.md))
                    .overlay(
                        RoundedRectangle(cornerRadius: Radius.md)
                            .strokeBorder(Impala.edgeSoft, lineWidth: 1)
                    )

                    // Karte 2: Synchronisation & WAL
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Text("Schreib-Log (WAL)")
                                .font(.system(size: TextSize.sm, weight: .semibold))
                                .foregroundStyle(Impala.text)
                            Spacer(minLength: 4)
                            Text(AppInfo.dbBreakdown.wal)
                                .font(.system(size: 11, weight: .semibold))
                                .foregroundStyle(Impala.text2)
                                .padding(.horizontal, 7)
                                .padding(.vertical, 2)
                                .background(Impala.activeTint, in: Capsule())
                        }
                        Text("Letzte Änderungen, noch nicht in die Datenbank übernommen")
                            .font(.system(size: TextSize.xs))
                            .foregroundStyle(Impala.text2)
                            .lineLimit(2)
                    }
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Impala.panel.opacity(0.6), in: RoundedRectangle(cornerRadius: Radius.md))
                    .overlay(
                        RoundedRectangle(cornerRadius: Radius.md)
                            .strokeBorder(Impala.edgeSoft, lineWidth: 1)
                    )
                }
                .padding(.horizontal, Space.s4)
                .padding(.vertical, 12)
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
/// Teilen, Löschen in aufklappbarer SettingsDisclosure.
private struct ProfilerSection: View {
    @State private var isExpanded = false
    @State private var enabled = Profiler.shared.isEnabled
    @State private var records: [Profiler.Record] = []
    @State private var share: SharedFile?
    @State private var copied = false

    var body: some View {
        SettingsCardGroup(
            footnote: "Nur Auffälligkeiten: Hänger über 100 ms, Fehler des Kerns, Sync- und KI-Fehler, langsamer Start. Alles bleibt auf diesem iPad."
        ) {
            SettingsDisclosure(
                title: "Für Entwickler",
                subtitle: "Performance-Profiler",
                badge: enabled ? "Aktiv" : nil,
                isExpanded: $isExpanded
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

                SettingsDivider()
                DevBridgeRow()

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
                        .settingsButton(.secondary)

                        Button("Teilen") {
                            share = SharedFile(url: Profiler.shared.reportFile())
                        }
                        .settingsButton(.secondary)

                        Button("Aktualisieren") {
                            reload()
                        }
                        .settingsButton(.secondary)

                        Spacer()

                        Button("Löschen", role: .destructive) {
                            Profiler.shared.clear()
                            reload()
                        }
                        .settingsButton(.danger)
                        .disabled(records.isEmpty)
                    }
                    .padding(.horizontal, Space.s4)
                    .padding(.vertical, Space.s3)
                }
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

/// Adresse des MCP-Servers im WLAN (`node mcp/lan-setup.mjs`) mit Verbindungsstand; leer = aus.
private struct DevBridgeRow: View {
    @State private var url = DevBridge.shared.url

    var body: some View {
        let bridge = DevBridge.shared
        SettingsInputRow(title: "MCP-Bridge (WLAN)", description: status(bridge.state)) {
            TextField("ws://192.168.…:8766/?token=…", text: $url)
                .settingsInputStyle()
                .keyboardType(.URL)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .onSubmit { bridge.url = url }
                .onDisappear { if url != bridge.url { bridge.url = url } }
        }
    }

    private func status(_ s: DevBridge.State) -> String {
        switch s {
        case .off: "Aus – Adresse vom PC eintragen"
        case .connecting: "Verbinde …"
        case .connected: "Verbunden"
        }
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

    /// Größe der SQLite-Dateien in Bytes.
    static var storageBytes: Int64 {
        guard let dir = try? FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: false)
        else { return 0 }
        return ["impala67.db", "impala67.db-wal"].reduce(Int64(0)) { sum, name in
            let size = (try? FileManager.default.attributesOfItem(atPath: dir.appendingPathComponent(name).path)[.size]) as? NSNumber
            return sum + (size?.int64Value ?? 0)
        }
    }

    /// Anteil am verfügbaren Gerätespeicher (wie `usage / quota` von `navigator.storage.estimate` in der PWA).
    static var storageFraction: Double {
        let bytes = Double(storageBytes)
        let free = (try? URL(fileURLWithPath: NSHomeDirectory())
            .resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey])
            .volumeAvailableCapacityForImportantUsage).map { Double($0) } ?? 0
        guard bytes > 0, bytes + free > 0 else { return 0 }
        return min(bytes / (bytes + free), 1)
    }

    /// Formatierte Gesamtgröße der Datenbank samt Schreib-Log (`impala67.db`, `-wal`).
    static var storage: String {
        ByteCountFormatter.string(fromByteCount: storageBytes, countStyle: .file)
    }

    /// Aufschlüsselung der Dateigrößen von Datenbank und WAL-Log.
    static var dbBreakdown: (db: String, wal: String) {
        guard let dir = try? FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: false)
        else { return ("–", "–") }
        let dbSize = ((try? FileManager.default.attributesOfItem(atPath: dir.appendingPathComponent("impala67.db").path)[.size]) as? NSNumber)?.int64Value ?? 0
        let walSize = ((try? FileManager.default.attributesOfItem(atPath: dir.appendingPathComponent("impala67.db-wal").path)[.size]) as? NSNumber)?.int64Value ?? 0
        return (
            ByteCountFormatter.string(fromByteCount: dbSize, countStyle: .file),
            ByteCountFormatter.string(fromByteCount: walSize, countStyle: .file)
        )
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
                                .settingsButton(.primary)
                            Button("Trennen", role: .destructive) { sync.disconnect() }
                                .settingsButton(.danger)
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

            SettingsInputRow(title: "Worker-URL", description: "URL des Cloudflare Workers") {
                TextField("https://…workers.dev", text: $url)
                    .settingsInputStyle()
                    .textContentType(.URL)
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
            }

            SettingsDivider()

            SettingsInputRow(title: "Sync-Schlüssel", description: "AES-GCM 256-Bit Verschlüsselung (E2EE)") {
                SecureField("Schlüssel", text: $key)
                    .settingsInputStyle()
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
            }

            SettingsDivider()

            VStack(spacing: 8) {
                HStack(spacing: Space.s2) {
                    if !sync.isPaired {
                        Button {
                            Task {
                                busy = true
                                message = await sync.configure(url: url, key: key)
                                busy = false
                            }
                        } label: {
                            if busy { ProgressView().frame(width: 50) } else { Text("Verbinden") }
                        }
                        .settingsButton(.primary)
                        .disabled(busy)

                        Button("Schlüssel generieren") {
                            key = sync.newKey()
                            message = "Neuer Sync-Schlüssel generiert. Kopiere ihn auf deine anderen Geräte!"
                        }
                        .settingsButton(.secondary)
                    }

                    Spacer()

                    if !key.isEmpty {
                        Button {
                            UIPasteboard.general.string = key
                            message = "Sync-Schlüssel in die Zwischenablage kopiert."
                        } label: {
                            Label("Schlüssel kopieren", image: "i-copy")
                        }
                        .settingsButton(.secondary)
                    }
                }

                HStack(spacing: Space.s2) {
                    Button {
                        scanning = true
                    } label: {
                        Label("QR-Code scannen", image: "i-camera")
                    }
                    .settingsButton(.secondary)
                    .disabled(busy || sync.state == .connecting || sync.state == .syncing)

                    if !url.trimmingCharacters(in: .whitespaces).isEmpty && !key.trimmingCharacters(in: .whitespaces).isEmpty {
                        Button {
                            showPairing = true
                        } label: {
                            Label("Gerät koppeln (QR-Code)", image: "i-phone")
                        }
                        .settingsButton(.secondary)
                    }

                    Spacer()
                }
            }
            .padding(.horizontal, Space.s4)
            .padding(.vertical, 10)

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
                .settingsButton(.secondary)
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
                .settingsButton(.danger)
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
