"use strict";

export const SETTINGS_LAST_SECTION_KEY = "impala67SettingsLastSection";

export const SETTINGS_SECTIONS = [
	{ id: "overview", label: "Übersicht", icon: "home", description: "Status und schnelle Wege zu den wichtigsten Einstellungen" },
	{ id: "general", label: "Allgemein", icon: "sliders", description: "Startseite und grundlegendes Verhalten" },
	{ id: "appearance", label: "Darstellung", icon: "appearance", description: "Theme, Akzent, Dichte und Hintergrund" },
	{ id: "ai", label: "KI & Lernen", icon: "sparkles", description: "Modelle, Quellen und Lernfunktionen" },
	{ id: "sync", label: "Sync & Dienste", icon: "sync", description: "Cloudflare, Google Drive, Notion und lokale Tokens" },
	{ id: "data", label: "Daten & App", icon: "archive", description: "Backups, Exporte, Speicher und Updates" },
	{ id: "devices", label: "Geräte & Bedienung", icon: "gamepad", description: "Controller, Tastenbelegung und Eingabegeräte" },
];

export const SETTINGS_ALIASES = Object.freeze({
	ki: "ai", home: "general", look: "appearance", notion: "sync",
	backup: "data", update: "data", controller: "devices", experimente: "ai",
	cloudflare: "sync",
});

// Das Schema ist zugleich Informationsarchitektur und Suchindex. Renderer lesen
// dieselben IDs, Titel und Beschreibungen; dadurch driften Navigation und Inhalt nicht auseinander.
export const SETTINGS_ITEMS = [
	{ id: "overview-status", section: "overview", group: "Status", label: "App-Status", description: "KI, Drive, Notion, Backup, Speicher und Version auf einen Blick", keywords: "zustand start dashboard diagnose" },
	{ id: "home-name", section: "general", group: "Start", label: "Begrüßungsname", description: "Name auf der Home-Seite", keywords: "anzeigename profil startseite" },
	{ id: "home-layout", section: "general", group: "Home", label: "Home-Bereiche", description: "Bereiche einblenden, ausblenden und sortieren", keywords: "dashboard reihenfolge widgets kacheln" },
	{ id: "theme", section: "appearance", group: "Design", label: "Erscheinungsbild", description: "System, Hell oder Dunkel", keywords: "theme modus mode dark light gerätemodus" },
	{ id: "accent", section: "appearance", group: "Design", label: "Akzentfarbe", description: "Farbe für aktive Elemente", keywords: "blau violett grün orange farbe" },
	{ id: "density", section: "appearance", group: "Lesbarkeit", label: "Darstellungsdichte", description: "Kompakt oder komfortabel", keywords: "abstand platz layout" },
	{ id: "font-size", section: "appearance", group: "Lesbarkeit", label: "Schriftgröße", description: "Klein, normal oder groß", keywords: "text schrift lesbar zoom" },
	{ id: "motion", section: "appearance", group: "Lesbarkeit", label: "Bewegung", description: "Animationen reduzieren", keywords: "animation motion barrierefreiheit" },
	{ id: "background", section: "appearance", group: "Hintergrund", label: "Eigenes Hintergrundbild", description: "Bild auswählen oder entfernen", keywords: "foto wallpaper bild" },
	{ id: "ai-models", section: "ai", group: "Modelle", label: "Chat-Modell", description: "Aktives Modell suchen und auswählen", keywords: "llm modell provider quelle" },
	{ id: "ai-sources", section: "ai", group: "Quellen", label: "KI-Quellen", description: "OpenAI, Gemini, LM Studio und eigene Endpunkte", keywords: "api key schlüssel token url endpoint anbieter" },
	{ id: "ai-embedding", section: "ai", group: "Erweitert", label: "Embedding-Modell", description: "Modell für semantische Suche", keywords: "rag vektor suche" },
	{ id: "ai-instructions", section: "ai", group: "Erweitert", label: "Eigene Anweisungen", description: "Tonfall und dauerhafte Vorgaben", keywords: "prompt system text" },
	{ id: "learning-options", section: "ai", group: "Lernen", label: "Lernverhalten", description: "Overlearning, Selbsteinschätzung und lokale Lernanalyse", keywords: "karten telemetrie sicherheit confidence" },
	{ id: "learning-beta", section: "ai", group: "Lernen", label: "Beta-Lernfunktionen", description: "Optionale KI-gestützte Lernmodi", keywords: "experimente feynman fehler hinweise multiple choice" },
	{ id: "cf-sync", section: "sync", group: "Cloudflare Echtzeit-Sync", label: "Cloudflare Live-Sync", description: "Echtzeit-Synchronisierung über WebSockets mit 500 MB Cloud-Speicher", keywords: "cloudflare echtzeit sync websocket live server speicher quota e2ee" },
	{ id: "drive", section: "sync", group: "Google Drive", label: "Drive-Synchronisierung", description: "Geräte über den privaten App-Speicher synchronisieren", keywords: "google login konto cloud verbinden" },
	{ id: "drive-automation", section: "sync", group: "Google Drive", label: "Automatische Synchronisierung", description: "Intervall und Sync nach Änderungen festlegen", keywords: "automatisch intervall minuten häufigkeit jede änderung" },
	{ id: "token-sync", section: "sync", group: "Datenschutz", label: "Tokens über Drive synchronisieren", description: "KI-Keys und Notion-Token lokal behalten", keywords: "secrets api schlüssel privat sicherheit" },
	{ id: "notion", section: "sync", group: "Notion", label: "Notion", description: "Seiten importieren und in beide Richtungen synchronisieren", keywords: "integration secret page migration" },
	{ id: "sync-advanced", section: "sync", group: "Erweitert", label: "Verbindungsdetails", description: "Google Client-ID und CORS-Proxy", keywords: "oauth client id proxy technisch" },
	{ id: "backup", section: "data", group: "Backup", label: "Backup & Wiederherstellung", description: "Event-Log und Dateien exportieren oder importieren", keywords: "json sichern wiederherstellen" },
	{ id: "data-export", section: "data", group: "Exporte", label: "Weitere Exporte", description: "Lerndaten und Markdown-Workspace exportieren", keywords: "telemetrie zip markdown rohdatei" },
	{ id: "storage", section: "data", group: "App", label: "Lokaler Speicher", description: "Verwendeten Gerätespeicher anzeigen", keywords: "indexeddb quota größe" },
	{ id: "performance-profiler", section: "data", group: "Diagnose", label: "Performance-Profiler", description: "Sporadische Hänger und langsame Sync-, Render- oder Eingabephasen lokal protokollieren", keywords: "langsam hänger profiler long task diagnose ruckeln" },
	{ id: "updates", section: "data", group: "App", label: "App-Updates", description: "Version prüfen und Update installieren", keywords: "pwa version neu laden cache" },
	{ id: "danger-zone", section: "data", group: "Gefahrenzone", label: "Lokale Seiten löschen", description: "Alle lokalen Seiten unwiderruflich entfernen", keywords: "reset löschen zurücksetzen" },
	{ id: "controller-status", section: "devices", group: "Controller", label: "Controller-Steuerung", description: "Gamepad verbinden, Hinweise und Vibration", keywords: "gamepad pad xbox playstation stadia" },
	{ id: "controller-map", section: "devices", group: "Belegung", label: "Tastenbelegung", description: "Aktionen an Controller-Tasten binden", keywords: "mapping anlernen taste button" },
	{ id: "controller-advanced", section: "devices", group: "Erweitert", label: "Deadzone & HID", description: "Rohe Achsen und nicht standardisierte Controller", keywords: "hid achse trigger deadzone technisch" },
];

const normalize = (value) => String(value || "").toLocaleLowerCase("de-DE")
	.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

export function resolveSettingsSection(section) {
	const id = normalize(section).replace(/ /g, "");
	const resolved = SETTINGS_ALIASES[id] || id;
	return SETTINGS_SECTIONS.some((entry) => entry.id === resolved) ? resolved : "overview";
}

export function searchSettings(query, limit = 8) {
	const terms = normalize(query).split(" ").filter(Boolean);
	if (!terms.length) return [];
	return SETTINGS_ITEMS.map((item) => {
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
