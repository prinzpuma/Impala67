import SwiftUI
import UniformTypeIdentifiers

/// Backup, Wiederherstellung, Exporte und Gefahrenzone (settings-renderer.js `renderSync`, `renderApp`, `SettingsData.kt`).
struct BackupSettingsSections: View {
    @Environment(ImpalaStore.self) private var store
    @AppStorage("impala67LastBackup") private var lastBackup: String = ""
    @State private var shareFile: SharedFile?
    @State private var showImport = false
    @State private var message: String?
    @State private var busy = false

    var body: some View {
        SettingsCardGroup(title: "Backup & Wiederherstellung") {
            SettingsRow(
                title: "Vollständiges Backup",
                description: backupDescription
            ) {
                HStack(spacing: Space.s2) {
                    Button("Importieren") {
                        showImport = true
                    }
                    .buttonStyle(.glass)
                    .disabled(busy)

                    Button(lastBackup.isEmpty ? "Backup erstellen" : "Backup erneut erstellen") {
                        exportBackup()
                    }
                    .buttonStyle(.glassProminent)
                    .disabled(busy)
                }
            }
            if let message {
                SettingsDivider()
                SettingsRow(title: "Status", description: message)
            }
        }
        .fileImporter(
            isPresented: $showImport,
            allowedContentTypes: [.json, .plainText],
            allowsMultipleSelection: false
        ) { result in
            importBackup(result: result)
        }
        .sheet(item: $shareFile) { file in
            ShareSheet(items: [file.url])
        }

        SettingsCardGroup(title: "Weitere Exporte") {
            SettingsRow(
                title: "Lerndaten",
                description: "Lernanalyse- und Telemetriedaten als JSON"
            ) {
                Button("Exportieren") {
                    exportTelemetry()
                }
                .buttonStyle(.glass)
            }
            SettingsDivider()
            SettingsRow(
                title: "Workspace als Markdown",
                description: "Alle Notizen des Arbeitsbereichs als Markdown (.md)"
            ) {
                let workspaces = store.core.workspaces()
                Menu("Exportieren") {
                    ForEach(workspaces, id: \.id) { ws in
                        Button(ws.name) {
                            exportWorkspace(ws.id, name: ws.name)
                        }
                    }
                }
                .buttonStyle(.glass)
            }
        }
    }

    private var backupDescription: String {
        let prefix = !lastBackup.isEmpty ? "Zuletzt \(lastBackup) · " : ""
        return "\(prefix)Event-Log und Dateien als JSON; Importe werden konfliktfrei zusammengeführt"
    }

    private func exportBackup() {
        busy = true
        message = nil
        Task {
            do {
                let json = try store.core.exportJson(includeBlobs: true)
                let dateStr = Date().formatted(Date.FormatStyle().year().month().day())
                let tempDir = FileManager.default.temporaryDirectory
                let fileUrl = tempDir.appendingPathComponent("impala67-export-\(dateStr).json")
                try json.write(to: fileUrl, atomically: true, encoding: .utf8)
                let formattedNow = Date().formatted(
                    Date.FormatStyle()
                        .day(.twoDigits).month(.twoDigits).year(.defaultDigits)
                        .hour(.twoDigits(amPM: .omitted)).minute(.twoDigits)
                        .locale(Locale(identifier: "de_DE"))
                )
                lastBackup = formattedNow
                shareFile = SharedFile(url: fileUrl)
                message = "Backup erfolgreich erstellt."
            } catch {
                message = "Export-Fehler: \(error.localizedDescription)"
            }
            busy = false
        }
    }

    private func importBackup(result: Result<[URL], Error>) {
        busy = true
        message = nil
        Task {
            do {
                guard let url = try result.get().first else { return }
                let accessing = url.startAccessingSecurityScopedResource()
                defer { if accessing { url.stopAccessingSecurityScopedResource() } }
                let json = try String(contentsOf: url, encoding: .utf8)
                let summary = try store.core.importJson(json: json)
                message = "Import erfolgreich: \(summary.added) Ereignisse übernommen."
            } catch {
                message = "Import-Fehler: \(error.localizedDescription)"
            }
            busy = false
        }
    }

    private func exportTelemetry() {
        Task {
            let sessions = store.core.learningSessions()
            let list = sessions.map { [
                "id": $0.id,
                "startedAt": $0.startedAt,
                "endedAt": $0.endedAt,
                "durationSeconds": $0.durationSeconds,
                "category": $0.category,
                "sourceId": $0.sourceId ?? ""
            ] }
            guard let data = try? JSONSerialization.data(withJSONObject: list, options: [.prettyPrinted]) else { return }
            let tempUrl = FileManager.default.temporaryDirectory.appendingPathComponent("impala67-lerndaten.json")
            try? data.write(to: tempUrl)
            shareFile = SharedFile(url: tempUrl)
        }
    }

    private func exportWorkspace(_ wsId: String, name: String) {
        Task {
            var pages: [PageSummary] = []
            func collectPages(_ parentId: String?) {
                for p in store.core.childrenOf(parentId: parentId, workspaceId: wsId) {
                    pages.append(p)
                    collectPages(p.id)
                }
            }
            collectPages(nil)

            var exportText = "# Workspace: \(name)\n\n"
            for p in pages {
                if let full = store.core.page(id: p.id) {
                    exportText += "## \(full.summary.title)\n\n\(full.content)\n\n---\n\n"
                }
            }
            let safeName = name.replacingOccurrences(of: " ", with: "-").lowercased()
            let tempUrl = FileManager.default.temporaryDirectory.appendingPathComponent("impala67-\(safeName).md")
            try? exportText.write(to: tempUrl, atomically: true, encoding: .utf8)
            shareFile = SharedFile(url: tempUrl)
        }
    }
}

/// Gefahrenzone wie `danger-zone` der PWA: Seiten, Chats oder Karten löschen mit Bestätigung.
struct DangerZoneGroup: View {
    @Environment(ImpalaStore.self) private var store
    @State private var confirmDanger: DangerAction?

    private enum DangerAction: Identifiable {
        case pages, chats, cards
        var id: Self { self }

        var title: String {
            switch self {
            case .pages: "Alle lokalen Seiten löschen"
            case .chats: "Alle Chats löschen"
            case .cards: "Alle Karteikarten löschen"
            }
        }

        var confirmTitle: String {
            switch self {
            case .pages: "Seiten löschen"
            case .chats: "Chats löschen"
            case .cards: "Karten löschen"
            }
        }
    }

    var body: some View {
        let _ = (store.pagesRevision, store.chatsRevision, store.cardsRevision)
        let chatCount = store.core.chats().count
        let cardTotals = store.core.cardTotals()
        let hasCards = cardTotals.cards > 0 || cardTotals.decks > 0

        SettingsCardGroup(title: "Gefahrenzone", isDanger: true) {
            SettingsRow(
                title: "Alle lokalen Seiten löschen",
                description: "Einstellungen, API-Keys, Chats und Karteikarten bleiben erhalten"
            ) {
                Button("Seiten löschen", role: .destructive) {
                    confirmDanger = .pages
                }
                .buttonStyle(.glass)
            }

            SettingsDivider()

            SettingsRow(
                title: "Alle Chats löschen",
                description: chatCount > 0
                    ? "\(chatCount) \(chatCount == 1 ? "Chat" : "Chats") · wird per Sync auch auf deinen anderen Geräten gelöscht"
                    : "Keine gespeicherten Chats vorhanden"
            ) {
                Button("Chats löschen", role: .destructive) {
                    confirmDanger = .chats
                }
                .buttonStyle(.glass)
                .disabled(chatCount == 0)
            }

            SettingsDivider()

            SettingsRow(
                title: "Alle Karteikarten löschen",
                description: hasCards
                    ? "\(cardTotals.cards) \(cardTotals.cards == 1 ? "Karte" : "Karten") in \(cardTotals.decks) \(cardTotals.decks == 1 ? "Stapel" : "Stapeln") · samt Lernfortschritt"
                    : "Keine Karteikarten vorhanden"
            ) {
                Button("Karten löschen", role: .destructive) {
                    confirmDanger = .cards
                }
                .buttonStyle(.glass)
                .disabled(!hasCards)
            }
        }
        .confirmationDialog(
            confirmDanger?.title ?? "Aktion bestätigen",
            isPresented: Binding(get: { confirmDanger != nil }, set: { if !$0 { confirmDanger = nil } }),
            titleVisibility: .visible
        ) {
            if let action = confirmDanger {
                Button(action.confirmTitle, role: .destructive) {
                    executeDanger(action)
                }
                Button("Abbrechen", role: .cancel) {
                    confirmDanger = nil
                }
            }
        } message: {
            if let action = confirmDanger {
                Text(dangerMessage(for: action))
            }
        }
    }

    private func dangerMessage(for action: DangerAction) -> String {
        switch action {
        case .pages:
            return "Möchtest du wirklich alle lokalen Seiten unwiderruflich löschen? Deine Einstellungen, API-Keys, Karteikarten und Chats bleiben erhalten."
        case .chats:
            return "Möchtest du wirklich alle Chats löschen? Die Löschung wird auch mit deinen anderen Geräten synchronisiert und kann nicht rückgängig gemacht werden."
        case .cards:
            return "Möchtest du wirklich alle Karteikarten und Stapel unwiderruflich löschen? Alle Lernfortschritte werden gelöscht und mit deinen anderen Geräten synchronisiert."
        }
    }

    private func executeDanger(_ action: DangerAction) {
        switch action {
        case .pages:
            try? store.core.clearPages()
        case .chats:
            for c in store.core.chats() {
                try? store.core.deleteChat(id: c.id)
            }
        case .cards:
            try? store.core.deleteAllCards()
        }
        confirmDanger = nil
    }
}
