"use strict";

export const SETTINGS_LAST_SECTION_KEY = "impala67SettingsLastSection";

export const SETTINGS_SECTIONS = [
	{ id: "overview", label: "Übersicht", icon: "home", description: "KI, Sync, Backup, Speicher und Version auf einen Blick" },
	{ id: "appearance", label: "Darstellung", icon: "appearance", description: "Design, Lesbarkeit und Oberfläche" },
	{ id: "ai", label: "KI", icon: "sparkles", description: "Modelle, Quellen und lokale KI" },
	{ id: "learning", label: "Lernen", icon: "graduation", description: "Lernverhalten, Pausen und Controller" },
	{ id: "sync", label: "Sync & Backup", icon: "sync", description: "Live-Sync, Google Drive und Backups" },
	{ id: "app", label: "App & Speicher", icon: "gear", description: "Speicher, Updates und Experimente" },
];

// Frühere Bereichs-IDs und Kurzformen führen weiter an die passende Stelle.
export const SETTINGS_ALIASES = Object.freeze({
	ki: "ai", look: "appearance", home: "appearance", general: "appearance",
	notion: "sync", cloudflare: "sync", drive: "sync", backup: "sync",
	data: "app", update: "app", storage: "app",
	devices: "learning", controller: "learning", experimente: "learning", pause: "learning", lernzeit: "learning",
});

export const BREAK_REMINDER_KEY = "impala67BreakReminder";

// Das Schema ist zugleich Informationsarchitektur und Suchindex. Renderer lesen
// dieselben IDs, Titel und Beschreibungen; dadurch driften Navigation und Inhalt nicht auseinander.
// platform: "native" = nur in der Android-App, "web" = nur im Browser.
export const SETTINGS_ITEMS = [
	{ id: "overview-status", section: "overview", group: "Status", label: "App-Status", description: "KI, Sync, Backup, Speicher und Version auf einen Blick", keywords: "zustand start dashboard diagnose" },
	{ id: "theme", section: "appearance", group: "Design", label: "Erscheinungsbild", description: "System, Hell oder Dunkel", keywords: "theme modus mode dark light gerätemodus" },
	{ id: "accent", section: "appearance", group: "Design", label: "Akzentfarbe", description: "Farbe für aktive Elemente", keywords: "blau violett grün orange farbe" },
	{ id: "density", section: "appearance", group: "Design", label: "Darstellungsdichte", description: "Kompakt oder komfortabel", keywords: "abstand platz layout" },
	{ id: "font-size", section: "appearance", group: "Lesbarkeit", label: "Schriftgröße", description: "Klein, normal oder groß", keywords: "text schrift lesbar zoom" },
	{ id: "motion", section: "appearance", group: "Lesbarkeit", label: "Bewegung reduzieren", description: "Weniger Übergänge und Animationen", keywords: "animation motion barrierefreiheit" },
	{ id: "native-haptics", section: "appearance", group: "Lesbarkeit", label: "Haptisches Feedback", description: "Taktile Vibrationen bei Aktionen, Werkzeugwechsel und Bewertungen", keywords: "vibration haptik feedback touch motor", platform: "native" },
	{ id: "tabs-position", section: "appearance", group: "Oberfläche", label: "Tab-Anordnung", description: "Horizontale Leiste oben oder vertikale Tabs in der Seitenleiste", keywords: "tabs leiste vertikal horizontal seitenleiste navigation anordnung" },
	{ id: "home-name", section: "appearance", group: "Oberfläche", label: "Begrüßungsname", description: "Name in der Begrüßung auf der Startseite", keywords: "anzeigename profil startseite home" },
	{ id: "ai-models", section: "ai", group: "Aktives Modell", label: "Chat-Modell", description: "Aktives Modell suchen und auswählen", keywords: "llm modell provider quelle" },
	{ id: "ai-sources", section: "ai", group: "Quellen", label: "KI-Quellen", description: "OpenAI, Gemini, LM Studio und eigene Endpunkte", keywords: "api key schlüssel token url endpoint anbieter" },
	{ id: "ai-embedding", section: "ai", group: "Lokale KI", label: "Embedding-Modell", description: "Modell für semantische Suche", keywords: "rag vektor suche bekko" },
	{ id: "ai-handwriting", section: "ai", group: "Lokale KI", label: "Handschrifterkennung", description: "Lokales Modell, Trainingsbeispiele und Handschrift-Export", keywords: "handschrift ink stift heft training abschreiben onnx" },
	{ id: "ai-tools", section: "ai", group: "Verhalten", label: "Tools mitsenden", description: "Der KI die App-Werkzeuge zur Verfügung stellen", keywords: "werkzeuge tools funktionen" },
	{ id: "ai-instructions", section: "ai", group: "Verhalten", label: "Eigene Anweisungen", description: "Tonfall und dauerhafte Vorgaben", keywords: "prompt system text" },
	{ id: "learning-options", section: "learning", group: "Lernverhalten", label: "Lernverhalten", description: "Overlearning, Selbsteinschätzung und Lernanalyse", keywords: "karten telemetrie sicherheit confidence statistik" },
	{ id: "break-reminder", section: "learning", group: "Lernverhalten", label: "Pausen-Erinnerung", description: "Erinnert nach 40 Minuten Lernen an eine kurze Pause", keywords: "pause karten lernzeit timer 40 min break reminder" },
	{ id: "learning-beta", section: "learning", group: "Beta-Lernfunktionen", label: "Beta-Lernfunktionen", description: "Optionale KI-gestützte Lernmodi", keywords: "experimente feynman fehler hinweise multiple choice" },
	{ id: "controller-status", section: "learning", group: "Controller", label: "Mit Controller lernen", description: "Gamepad verbinden, Tastenhinweise und Vibration", keywords: "gamepad pad xbox playstation stadia controller" },
	{ id: "controller-map", section: "learning", group: "Controller", label: "Tastenbelegung", description: "Aktionen an Controller-Tasten binden", keywords: "mapping anlernen taste button gamepad" },
	{ id: "controller-advanced", section: "learning", group: "Controller", label: "Deadzone & HID", description: "Rohe Achsen und nicht standardisierte Controller", keywords: "hid achse trigger deadzone technisch gamepad" },
	{ id: "cf-sync", section: "sync", group: "Cloudflare Live-Sync", label: "Cloudflare Live-Sync", description: "Echtzeit-Synchronisierung mit Ende-zu-Ende-Verschlüsselung", keywords: "cloudflare echtzeit sync websocket live server speicher quota e2ee koppeln qr" },
	{ id: "drive", section: "sync", group: "Google Drive", label: "Google Drive", description: "Backup und Sync über den privaten App-Speicher", keywords: "google login konto cloud verbinden" },
	{ id: "drive-automation", section: "sync", group: "Google Drive", label: "Automatische Synchronisierung", description: "Intervall und Sync nach Änderungen festlegen", keywords: "automatisch intervall minuten häufigkeit jede änderung" },
	{ id: "token-sync", section: "sync", group: "Google Drive", label: "Tokens über Drive synchronisieren", description: "KI-Keys lokal behalten oder auf eigene Geräte übertragen", keywords: "secrets api schlüssel privat sicherheit datenschutz" },
	{ id: "sync-advanced", section: "sync", group: "Erweitert", label: "Google Client-ID", description: "OAuth-Webclient für Google Drive", keywords: "oauth client id technisch verbindungsdetails" },
	{ id: "backup", section: "sync", group: "Backup", label: "Backup & Wiederherstellung", description: "Event-Log und Dateien exportieren oder importieren", keywords: "json sichern wiederherstellen import export" },
	{ id: "native-fs-backup", section: "sync", group: "Backup", label: "In Gerätespeicher sichern", description: "Backups direkt in Android Dokumente (Documents/Impala67) ablegen", keywords: "backup dateisystem speicher ordner android documents", platform: "native" },
	{ id: "data-export", section: "sync", group: "Backup", label: "Weitere Exporte", description: "Lerndaten und Markdown-Workspace exportieren", keywords: "telemetrie zip markdown rohdatei" },
	{ id: "storage", section: "app", group: "Speicher", label: "Lokaler Speicher", description: "Verwendeten Gerätespeicher anzeigen", keywords: "indexeddb quota größe" },
	{ id: "updates", section: "app", group: "App", label: "App-Updates", description: "Version prüfen und Update installieren", keywords: "pwa version neu laden cache" },
	{ id: "native-scanner", section: "app", group: "Gerät", label: "Dokumenten-Scanner", description: "Google-Scanner oder Impala-Scanner verwenden", keywords: "scanner scannen kamera dokument google ml kit impala foto", platform: "native" },
	{ id: "beta-ui", section: "app", group: "Experimente", label: "Beta-Design", description: "Vorerst ohne Wirkung – das Design ist jetzt Standard", keywords: "beta ui design modern experimentell oberfläche layout" },
	{ id: "danger-zone", section: "app", group: "Gefahrenzone", label: "Lokale Seiten löschen", description: "Alle lokalen Seiten unwiderruflich entfernen", keywords: "reset löschen zurücksetzen" },
	{ id: "danger-chats", section: "app", group: "Gefahrenzone", label: "Alle Chats löschen", description: "Gespeicherte Chats auf diesem und synchronisierten Geräten entfernen", keywords: "chat verlauf unterhaltung löschen zurücksetzen" },
	{ id: "danger-cards", section: "app", group: "Gefahrenzone", label: "Alle Karteikarten löschen", description: "Alle Karteikarten, Stapel und Lernfortschritte entfernen", keywords: "karteikarten anki karten stapel deck löschen zurücksetzen" },
	{ id: "performance-profiler", section: "app", group: "Für Entwickler", label: "Performance-Profiler", description: "Hänger, App- und KI-Fehler lokal protokollieren", keywords: "langsam hänger profiler long task diagnose ruckeln fehler ki debug protokoll entwickler" },
	{ id: "mcp-bridge", section: "app", group: "Für Entwickler", label: "MCP-Live-Bridge", description: "App mit einem KI-Assistenten auf diesem Rechner verbinden", keywords: "mcp claude agent bridge websocket entwickler live", platform: "web" },
];

const normalize = (value) => String(value || "").toLocaleLowerCase("de-DE")
	.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

export function resolveSettingsSection(section) {
	const id = normalize(section).replace(/ /g, "");
	const resolved = SETTINGS_ALIASES[id] || id;
	return SETTINGS_SECTIONS.some((entry) => entry.id === resolved) ? resolved : "overview";
}

export function searchSettings(query, limit = 8, context = {}) {
	const terms = normalize(query).split(" ").filter(Boolean);
	if (!terms.length) return [];
	return SETTINGS_ITEMS.filter((item) => !item.platform || context[item.platform]).map((item) => {
		const section = SETTINGS_SECTIONS.find((entry) => entry.id === item.section);
		const title = normalize(item.label);
		const haystack = normalize([item.label, item.description, item.group, item.keywords, section?.label].join(" "));
		if (!terms.every((term) => haystack.includes(term))) return null;
		const score = terms.reduce((sum, term) => sum + (title.startsWith(term) ? 4 : title.includes(term) ? 2 : 1), 0);
		return { ...item, sectionLabel: section?.label || item.section, score };
	}).filter(Boolean).sort((a, b) => b.score - a.score || a.label.localeCompare(b.label, "de")).slice(0, limit);
}

export function valuesSnapshot(entries) {
	return JSON.stringify(entries.map(({ key, value }) => [key, String(value ?? "")]));
}

export function valuesAreDirty(initial, entries) {
	return initial !== valuesSnapshot(entries);
}
