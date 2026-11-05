import Foundation

/// Suchindex für die Einstellungen nach Vorbild von `settings-schema.js` (`SETTINGS_ITEMS`, `searchSettings`).
struct SettingsSearchItem: Identifiable, Hashable {
    let id: String
    let section: SettingsSection
    let group: String
    let label: String
    let description: String
    let keywords: String

    var haystack: String {
        "\(label) \(description) \(group) \(keywords) \(section.label)".lowercased()
    }
}

enum SettingsSearchIndex {
    static let items: [SettingsSearchItem] = [
        SettingsSearchItem(
            id: "overview-status",
            section: .overview,
            group: "Status",
            label: "App-Status",
            description: "KI, Sync, Backup, Speicher und Version auf einen Blick",
            keywords: "zustand start dashboard diagnose übersicht"
        ),
        SettingsSearchItem(
            id: "theme",
            section: .appearance,
            group: "Design",
            label: "Erscheinungsbild",
            description: "System, Hell oder Dunkel",
            keywords: "theme modus mode dark light gerätemodus look"
        ),
        SettingsSearchItem(
            id: "accent",
            section: .appearance,
            group: "Design",
            label: "Akzentfarbe",
            description: "Farbe für aktive Elemente",
            keywords: "blau violett grün orange farbe tint"
        ),
        SettingsSearchItem(
            id: "density",
            section: .appearance,
            group: "Design",
            label: "Darstellungsdichte",
            description: "Kompakt oder komfortabel",
            keywords: "abstand platz layout"
        ),
        SettingsSearchItem(
            id: "font-size",
            section: .appearance,
            group: "Lesbarkeit",
            label: "Schriftgröße",
            description: "Klein, normal oder groß",
            keywords: "text schrift lesbar zoom"
        ),
        SettingsSearchItem(
            id: "motion",
            section: .appearance,
            group: "Lesbarkeit",
            label: "Performance-Modus",
            description: "Ohne Übergänge, Milchglas-Effekte und Hintergrund-Handschrifterkennung",
            keywords: "animation motion barrierefreiheit performance handschrift erkennung speicher"
        ),
        SettingsSearchItem(
            id: "native-haptics",
            section: .appearance,
            group: "Lesbarkeit",
            label: "Haptisches Feedback",
            description: "Taktile Vibrationen bei Aktionen, Werkzeugwechsel und Bewertungen",
            keywords: "vibration haptik feedback touch motor"
        ),
        SettingsSearchItem(
            id: "tabs-position",
            section: .appearance,
            group: "Oberfläche",
            label: "Tab-Anordnung",
            description: "Horizontale Leiste oben oder vertikale Tabs in der Seitenleiste",
            keywords: "tabs leiste vertikal horizontal seitenleiste navigation anordnung"
        ),
        SettingsSearchItem(
            id: "home-name",
            section: .appearance,
            group: "Oberfläche",
            label: "Begrüßungsname",
            description: "Name in der Begrüßung auf der Startseite",
            keywords: "anzeigename profil startseite home"
        ),
        SettingsSearchItem(
            id: "home-article",
            section: .appearance,
            group: "Oberfläche",
            label: "Tagesartikel",
            description: "KI-Zusammenfassung deiner Notizen auf der Startseite",
            keywords: "artikel zusammenfassung ki startseite home täglich"
        ),
        SettingsSearchItem(
            id: "related-pages",
            section: .appearance,
            group: "Oberfläche",
            label: "Verwandte Seiten",
            description: "Inhaltlich ähnliche Seiten unter jeder Notiz",
            keywords: "ähnlich verwandt vorschläge embedding notiz verknüpfung"
        ),
        SettingsSearchItem(
            id: "home-topics",
            section: .appearance,
            group: "Oberfläche",
            label: "Themen für den Tagesartikel",
            description: "Themen, über die der Tagesartikel schreibt",
            keywords: "artikel themen fächer startseite"
        ),
        SettingsSearchItem(
            id: "ai-models",
            section: .ai,
            group: "Aktives Modell",
            label: "Chat-Modell",
            description: "Aktives Modell suchen und auswählen",
            keywords: "llm modell provider quelle ki chat gpt claude gemini"
        ),
        SettingsSearchItem(
            id: "ai-sources",
            section: .ai,
            group: "Quellen",
            label: "KI-Quellen",
            description: "OpenAI, Gemini, LM Studio und eigene Endpunkte",
            keywords: "api key schlüssel token url endpoint anbieter"
        ),
        SettingsSearchItem(
            id: "ai-handwriting",
            section: .ai,
            group: "Lokale KI",
            label: "Handschrifterkennung",
            description: "Lokale Handschrift-Erkennung mit Apple Vision, Trainingsbeispiele und Status",
            keywords: "handschrift ink stift heft vision apple ocr"
        ),
        SettingsSearchItem(
            id: "ai-embedding",
            section: .ai,
            group: "Lokale KI",
            label: "Semantische Suche",
            description: "Semantische Verknüpfungen und verwandte Notizen",
            keywords: "rag vektor suche embedding"
        ),
        SettingsSearchItem(
            id: "ai-tools",
            section: .ai,
            group: "Verhalten",
            label: "Tools mitsenden",
            description: "Der KI die App-Werkzeuge zur Verfügung stellen",
            keywords: "werkzeuge tools funktionen"
        ),
        SettingsSearchItem(
            id: "ai-instructions",
            section: .ai,
            group: "Verhalten",
            label: "Eigene Anweisungen",
            description: "Tonfall und dauerhafte Vorgaben",
            keywords: "prompt system text anweisungen"
        ),
        SettingsSearchItem(
            id: "learning-options",
            section: .learning,
            group: "Lernverhalten",
            label: "Lernverhalten",
            description: "Overlearning, Selbsteinschätzung und Lernanalyse",
            keywords: "karten telemetrie sicherheit confidence statistik spaced repetition srs"
        ),
        SettingsSearchItem(
            id: "break-reminder",
            section: .learning,
            group: "Lernverhalten",
            label: "Pausen-Erinnerung",
            description: "Erinnert nach 40 Minuten Lernen an eine kurze Pause",
            keywords: "pause karten lernzeit timer 40 min break reminder"
        ),
        SettingsSearchItem(
            id: "week-goal",
            section: .learning,
            group: "Lernzeit",
            label: "Wochenziel",
            description: "Lernzeit pro Woche",
            keywords: "woche ziel zeit dauer stunden lernzeit"
        ),
        SettingsSearchItem(
            id: "learning-beta",
            section: .learning,
            group: "Beta-Lernfunktionen",
            label: "Beta-Lernfunktionen",
            description: "Optionale KI-gestützte Lernmodi",
            keywords: "experimente feynman fehler hinweise multiple choice"
        ),
        SettingsSearchItem(
            id: "controller-status",
            section: .learning,
            group: "Controller",
            label: "Mit Controller lernen",
            description: "Gamepad verbinden, Tastenhinweise und Vibration",
            keywords: "gamepad pad xbox playstation controller"
        ),
        SettingsSearchItem(
            id: "cf-sync",
            section: .sync,
            group: "Cloudflare Live-Sync",
            label: "Cloudflare Live-Sync",
            description: "Echtzeit-Synchronisierung mit Ende-zu-Ende-Verschlüsselung",
            keywords: "cloudflare echtzeit sync websocket live server speicher quota e2ee koppeln qr"
        ),
        SettingsSearchItem(
            id: "drive",
            section: .sync,
            group: "Google Drive",
            label: "Google Drive",
            description: "Backup und Sync über den privaten App-Speicher",
            keywords: "google login konto cloud verbinden drive"
        ),
        SettingsSearchItem(
            id: "drive-automation",
            section: .sync,
            group: "Google Drive",
            label: "Automatische Synchronisierung",
            description: "Intervall und Sync nach Änderungen festlegen",
            keywords: "automatisch intervall minuten häufigkeit jede änderung"
        ),
        SettingsSearchItem(
            id: "token-sync",
            section: .sync,
            group: "Google Drive",
            label: "Tokens synchronisieren",
            description: "KI-Keys lokal behalten oder auf eigene Geräte übertragen",
            keywords: "secrets api schlüssel privat sicherheit datenschutz"
        ),
        SettingsSearchItem(
            id: "sync-advanced",
            section: .sync,
            group: "Erweitert",
            label: "Google Client-ID",
            description: "OAuth-Webclient für Google Drive",
            keywords: "oauth client id technisch verbindungsdetails"
        ),
        SettingsSearchItem(
            id: "backup",
            section: .sync,
            group: "Backup",
            label: "Backup & Wiederherstellung",
            description: "Event-Log und Dateien exportieren oder importieren",
            keywords: "json sichern wiederherstellen import export backup"
        ),
        SettingsSearchItem(
            id: "data-export",
            section: .sync,
            group: "Backup",
            label: "Weitere Exporte",
            description: "Lerndaten und Markdown-Workspace exportieren",
            keywords: "telemetrie zip markdown rohdatei"
        ),
        SettingsSearchItem(
            id: "storage",
            section: .app,
            group: "Speicher",
            label: "Lokaler Speicher",
            description: "Verwendeten Gerätespeicher anzeigen",
            keywords: "quota größe datenbank speicher storage"
        ),
        SettingsSearchItem(
            id: "updates",
            section: .app,
            group: "App",
            label: "App-Version",
            description: "Installierte Version und App-Details",
            keywords: "version update app build"
        ),
        SettingsSearchItem(
            id: "beta-ui",
            section: .app,
            group: "Experimente",
            label: "Beta-Design",
            description: "Platz zum Testen neuer Design-Ideen",
            keywords: "beta ui design modern experimentell oberfläche"
        ),
        SettingsSearchItem(
            id: "danger-zone",
            section: .app,
            group: "Gefahrenzone",
            label: "Lokale Seiten löschen",
            description: "Alle lokalen Seiten unwiderruflich entfernen",
            keywords: "reset löschen zurücksetzen seiten danger"
        ),
        SettingsSearchItem(
            id: "danger-chats",
            section: .app,
            group: "Gefahrenzone",
            label: "Alle Chats löschen",
            description: "Gespeicherte Chats auf diesem und synchronisierten Geräten entfernen",
            keywords: "chat verlauf unterhaltung löschen zurücksetzen"
        ),
        SettingsSearchItem(
            id: "danger-cards",
            section: .app,
            group: "Gefahrenzone",
            label: "Alle Karteikarten löschen",
            description: "Alle Karteikarten, Stapel und Lernfortschritte entfernen",
            keywords: "karteikarten anki karten stapel deck löschen zurücksetzen"
        ),
        SettingsSearchItem(
            id: "performance-profiler",
            section: .app,
            group: "Für Entwickler",
            label: "Performance-Profiler",
            description: "Hänger, App- und KI-Fehler lokal protokollieren",
            keywords: "langsam hänger profiler diagnose fehler ki debug protokoll entwickler"
        )
    ]

    /// Durchsucht die Einstellungen wie `searchSettings` der PWA.
    static func search(_ query: String, limit: Int = 8) -> [SettingsSearchItem] {
        let terms = query.lowercased()
            .folding(options: .diacriticInsensitive, locale: .current)
            .split(separator: " ")
            .map { String($0) }
            .filter { !$0.isEmpty }

        guard !terms.isEmpty else { return [] }

        struct Hit {
            let item: SettingsSearchItem
            let score: Int
        }

        var hits: [Hit] = []

        for item in items {
            let haystack = item.haystack.folding(options: .diacriticInsensitive, locale: .current)
            let title = item.label.lowercased().folding(options: .diacriticInsensitive, locale: .current)

            // Alle Suchbegriffe müssen vorkommen
            guard terms.allSatisfy({ haystack.contains($0) }) else { continue }

            var score = 0
            for term in terms {
                if title.hasPrefix(term) {
                    score += 4
                } else if title.contains(term) {
                    score += 2
                } else {
                    score += 1
                }
            }
            hits.append(Hit(item: item, score: score))
        }

        return hits
            .sorted { a, b in
                if a.score != b.score { return a.score > b.score }
                return a.item.label.localizedCompare(b.item.label) == .orderedAscending
            }
            .prefix(limit)
            .map(\.item)
    }
}
