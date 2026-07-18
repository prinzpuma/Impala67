"use strict";

import { S, STATE } from "./state.js";
import { U } from "./util.js";
import { DB } from "./db.js";
import { AI } from "./ai.js";
import { RAG } from "./rag.js";
import { RENDER } from "./render.js";
import { DRIVE } from "./drive.js";
import { NOTION_MIGRATOR } from "./import-notion.js";
import { APP } from "./app.js";
import { TABS } from "./tabs.js";

const renderStatusDot = (...args) => RENDER.renderStatusDot(...args);
const render = (...args) => RENDER.render(...args);
const closeOverlay = (...args) => APP.closeOverlay(...args);
const openPage = (...args) => TABS.openPage(...args);

// Verbindungsstatus automatisch prüfen (beim Start, nach Einstellungen, alle 60s).
// FIX (Verbesserung): Intervall, visibilitychange und „Einstellungen speichern“ konnten
// sich überlappen — ein später eintreffendes, veraltetes Ping-Ergebnis überschrieb dann
// ein neueres. Ein Lauf-Token lässt nur das Ergebnis des jüngsten Aufrufs zählen.
let _checkAiRun = 0;
export async function checkAI() {
	const run = ++_checkAiRun;
	S.aiOnline = null;
	renderStatusDot();
	const online = await AI.ping();
	if (run !== _checkAiRun) return; // inzwischen läuft ein neuerer Check
	S.aiOnline = online;
	renderStatusDot();
}

// Zentrale Darstellungsoptionen. Alles wird als Gerätewahl in localStorage gespeichert,
// damit Theme, Akzent, Dichte und Bewegung nicht durch den Drive-Sync überschrieben werden.
const ACCENT_THEMES = {
	blue:   { solid: "#5e9fe8", soft: "rgba(94,159,232,.12)", border: "rgba(94,159,232,.36)" },
	violet: { solid: "#a78bfa", soft: "rgba(167,139,250,.12)", border: "rgba(167,139,250,.36)" },
	green:  { solid: "#72bc8f", soft: "rgba(114,188,143,.12)", border: "rgba(114,188,143,.36)" },
	orange: { solid: "#de9255", soft: "rgba(222,146,85,.12)", border: "rgba(222,146,85,.36)" },
};

// Standard: Theme automatisch vom Betriebssystem übernehmen. Nur ein explizites
// "0" deaktiviert die Erkennung; so erhalten auch bestehende Installationen ohne
// gespeicherten Schlüssel direkt die sinnvolle Standard-Einstellung.
const SYSTEM_THEME_KEY = "impala67FollowSystemTheme";
let systemThemeQuery = null;
let systemThemeListenerInstalled = false;

function followsSystemTheme() {
	return localStorage.getItem(SYSTEM_THEME_KEY) !== "0";
}

function resolvedTheme() {
	if (followsSystemTheme() && window.matchMedia) {
		return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
	}
	return localStorage.getItem("impala67Theme") || localStorage.getItem("notionTheme") || "dark";
}

function installSystemThemeListener() {
	if (systemThemeListenerInstalled || !window.matchMedia) return;
	systemThemeQuery = window.matchMedia("(prefers-color-scheme: light)");
	const onThemeChange = () => {
		if (followsSystemTheme()) applyAppearance();
	};
	if (systemThemeQuery.addEventListener) systemThemeQuery.addEventListener("change", onThemeChange);
	else if (systemThemeQuery.addListener) systemThemeQuery.addListener(onThemeChange);
	systemThemeListenerInstalled = true;
}

export function applyAppearance() {
	installSystemThemeListener();
	const theme = resolvedTheme();
	const density = localStorage.getItem("impala67Density") || "compact";
	const motion = localStorage.getItem("impala67Motion") || "full";
	const accentName = localStorage.getItem("impala67Accent") || "blue";
	const accent = ACCENT_THEMES[accentName] || ACCENT_THEMES.blue;
	document.body.classList.toggle("light", theme === "light");
	// Browser-Chrome und iPadOS-PWA-Safe-Area erhalten dieselbe Grundfläche wie
	// die App. Der Meta-Tag wird bei jedem Theme-Wechsel aktualisiert.
	const themeColor = document.querySelector('meta[name="theme-color"]');
	if (themeColor) themeColor.content = theme === "light" ? "#f2efe9" : "#05070d";
	document.body.classList.toggle("density-compact", density === "compact");
	document.body.classList.toggle("reduce-motion", motion === "reduced");
	const fontSize = localStorage.getItem("impala67FontSize") || "m";
	document.body.classList.toggle("font-s", fontSize === "s");
	document.body.classList.toggle("font-l", fontSize === "l");
	document.body.style.setProperty("--accent", accent.solid);
	document.body.style.setProperty("--accent-soft", accent.soft);
	document.body.style.setProperty("--accent-border", accent.border);
}

export function applyTheme() { applyAppearance(); }

// Eigenes Hintergrundbild anwenden (Blob aus IndexedDB, dunkel überblendet)
export async function applyBg() {
	const bg = U.el("bg");
	if (!bg) return;
	try {
		const rec = await DB.getBlob("bgImage");
		if (rec && rec.buf && rec.buf.byteLength) {
			const url = URL.createObjectURL(new Blob([rec.buf], { type: (rec.meta && rec.meta.type) || "image/jpeg" }));
			bg.style.backgroundImage = "linear-gradient(rgba(6,8,12,0.84), rgba(6,8,12,0.93)), url('" + url + "')";
			bg.style.backgroundSize = "cover";
			bg.style.backgroundPosition = "center";
		} else {
			bg.style.backgroundImage = "";
			bg.style.backgroundSize = "";
			bg.style.backgroundPosition = "";
		}
	} catch (e) {
		console.warn("Hintergrund konnte nicht geladen werden:", e);
	}
}

// Zeichnet den Notion-Fortschritt in die Einstellungen — falls sie offen sind.
// Der Zustand lebt in S.notionJob und überlebt so das Schließen des Dialogs:
// beim Wiederöffnen (render.js → openSettings) wird er einfach neu gezeichnet.
export function renderNotionJob() {
	const bar = U.el("notionProgress");
	if (!bar) return; // Einstellungen (Notion-Tab) sind gerade nicht offen
	const job = S.notionJob;
	const fill = bar.querySelector(".progress-fill");
	const status = U.el("notionStatus");
	const cancelBtn = U.el("btnNotionCancel");
	const btnImp = U.el("btnMigrateNotion");
	const btnSync = U.el("btnNotionSync");
	const running = !!(job && job.running);
	bar.hidden = !job || (!running && job.fraction == null);
	if (fill) {
		if (job && job.fraction != null) { bar.classList.remove("indeterminate"); fill.style.width = Math.round(job.fraction * 100) + "%"; }
		else { bar.classList.toggle("indeterminate", running); fill.style.width = ""; }
	}
	if (status) status.textContent = job ? job.status || "" : "";
	if (cancelBtn) {
		cancelBtn.hidden = !running;
		cancelBtn.disabled = !!(job && job.cancelling);
		cancelBtn.textContent = job && job.cancelling ? "Wird abgebrochen…" : "⏹ Abbrechen";
	}
	if (btnImp) { btnImp.disabled = running; btnImp.textContent = running && job.kind === "import" ? "Importiere…" : "⬇ Import"; }
	if (btnSync) { btnSync.disabled = running; btnSync.textContent = running && job.kind === "sync" ? "Synchronisiere…" : "⇅ Zwei-Wege-Sync"; }
}

// Formularfeld-Helper für Einstellungen.
export function field(label, id, value, type) {
	return "<div><label for=\"" + id + "\">" + U.esc(label) + "</label>" +
		'<input id="' + id + '" type="' + (type || "text") + '" value="' + U.esc(value || "") + '"></div>';
}

// Gemeinsames "Speichern"-Aktionsleiste-Markup — stand vorher dreimal wortgleich
// im Code (KI-Bereich sowie zwei Sync-Bereich-Zweige).
const saveActionsHtml = '<div class="modal-actions"><button id="btnSaveSettings">Speichern</button></div>';

// Einstellungen mit Unterpunkten (wie in Notion), feste Größe, Inhalt scrollt
export const SETTINGS_SECTIONS = [
	{ id: "ki", label: "KI" },
	{ id: "look", label: "Darstellung" },
	{ id: "notion", label: "Notion Sync" },
	{ id: "backup", label: "Backup" },
	{ id: "experimente", label: "🧪 Experimente" },
	{ id: "sync", label: "Sync" },
	{ id: "update", label: "Update" },
];

export function openSettings(section) {
	S.settingsSection = section || S.settingsSection || "ki";
	const sec = S.settingsSection;
	const o = U.el("overlay");
	if (!o) return;
	o.hidden = false;
	const nav = SETTINGS_SECTIONS.map((s) =>
		'<div class="set-item' + (s.id === sec ? " active" : "") + '" data-set="' + s.id + '">' + s.label + "</div>"
	).join("");
	let body = "";
	if (sec === "ki") {
		const providers = S.settings.aiProviders || [];
		const embedValue = S.settings.embedModel || "";
		body = '<section class="ai-settings">' +
			'<header class="ai-settings-hero"><span class="ai-settings-hero-icon" aria-hidden="true">✦</span><span><b>Deine KI-Verbindungen</b><small>Wähle eine Quelle im Chat. API-Keys bleiben nur auf diesem Gerät.</small></span></header>' +
			'<section class="ai-connection-card">' +
			'<div class="ai-connection-head"><div><h4>Verbindungen</h4><p>Lokale Modelle und Cloud-APIs an einem Ort.</p></div><span class="ai-provider-count">' + providers.length + ' Quelle' + (providers.length === 1 ? '' : 'n') + '</span></div>' +
			'<div id="aiStatusSettings" class="ai-status-banner"></div>' +
			'<div class="provider-list">' + providers.map((pr) =>
				'<div class="provider-card" data-provrow="' + pr.id + '">' +
					'<div class="provider-card-head">' +
						'<input data-provname="' + pr.id + '" placeholder="Name der Quelle" value="' + U.esc(pr.name) + '">' +
						'<button data-provdel="' + pr.id + '" class="icon-danger" title="Quelle entfernen">🗑</button>' +
					"</div>" +
					'<input data-provbase="' + pr.id + '" placeholder="Server-URL (OpenAI-kompatibel)" value="' + U.esc(pr.base) + '">' +
					'<input data-provkey="' + pr.id + '" type="password" placeholder="API-Key (optional)" value="' + U.esc(pr.key) + '">' +
				"</div>"
			).join("") + "</div>" +
			'<div class="ai-provider-add"><button id="btnAddProvider">+ Eigene Quelle</button><span>Für jeden OpenAI-kompatiblen Server.</span></div>' +
			'</section>' +
			// Schnell-Buttons für die drei häufigsten Quellen.
			'<section class="ai-presets"><div><h4>Schnellstart</h4><p>Fügt die Konfiguration ein – du kannst sie danach anpassen.</p></div>' +
			'<div class="ai-preset-grid"><button data-provpreset="local"><span>🖥</span><b>LM Studio</b><small>Lokal auf diesem Gerät</small></button>' +
			'<button data-provpreset="google"><span>✨</span><b>Google Gemini</b><small>Gemini API</small></button>' +
			'<button data-provpreset="openai"><span>◉</span><b>OpenAI</b><small>OpenAI API</small></button></div></section>' +
			// Tool-Angebot v3: Werkzeug-Zugriff der KI (Standard AN — alle Tools bei jeder Anfrage)
			'<section class="ai-tools-toggle"><label><input type="checkbox" id="inpAlwaysTools"' + (S.settings.alwaysSendTools !== false ? " checked" : "") + '><span><b>Tools immer mitsenden</b><small>Empfohlen. Ausgeschaltet erhält die KI nur ein Meta-Werkzeug („request_tools“) und fordert die volle Liste selbst an, wenn sie sie braucht — spart Tokens bei kleinen lokalen Modellen.</small></span></label></section>' +
			'<details class="ai-settings-advanced"><summary><span>Erweitert</span><small>Embeddings & persönliche Anweisungen</small></summary><div class="ai-settings-advanced-body">' +
			'<div class="embedding-picker"><label for="inpEmbed">Embedding-Modell</label><div class="embedding-picker-row">' +
			'<select id="inpEmbed" data-currentembed="' + U.esc(embedValue) + '" disabled><option value="' + U.esc(embedValue) + '">' + U.esc(embedValue || "Modelle werden geladen…") + '</option></select>' +
			'<button type="button" id="btnRefreshEmbedding" title="Embedding-Modelle neu laden">↻</button></div>' +
			'<p id="embeddingModelHint" class="hint">Nur Modelle der aktuell im Chat gewählten Quelle.</p></div>' +
			"<div><label for=\"inpCustomInstructions\">Eigene Anweisungen an die KI</label>" +
			'<textarea id="inpCustomInstructions" rows="4" placeholder="z. B. Studienfach, bevorzugte Sprache oder Tonfall…">' + U.esc(S.settings.customInstructions) + "</textarea></div></div></details>" +
			'<p class="ai-settings-note">Die aktive KI und das Modell wählst du direkt im Chat. Gespeicherte Schlüssel werden nicht synchronisiert.</p>' +
			saveActionsHtml + "</section>";
	} else if (sec === "notion") {
		const last = S.settings.notionLastSync;
		body = field("Notion Integration Token (secret_…)", "inpNotionToken", S.settings.notionToken || S.notionToken, "password") +
			field("Notion Seiten-ID (Wurzelseite für den Sync; leer = alle freigegebenen Seiten)", "inpNotionPage", S.settings.notionPageId || S.notionPageId) +
			field("Eigener CORS-Proxy (optional, z.B. https://dein-worker.workers.dev/?; leer = corsproxy.io)", "inpCorsProxy", S.settings.corsProxy || "") +
			'<p class="hint">1) Auf notion.so/my-integrations eine interne Integration erstellen, Token kopieren.<br>' +
			'2) In Notion die gewünschten Seiten über „Teilen“ mit der Integration freigeben.<br>' +
			"3) <b>⬇ Import</b> holt alles einmalig. <b>⇅ Zwei-Wege-Sync</b> gleicht danach in beide Richtungen ab: die jeweils neuere Version gewinnt, lokal neue Seiten werden in deinem Notion unter der Wurzelseite angelegt.<br>" +
			"Hinweis: Notions API erlaubt keine direkten Browseranfragen (CORS). Ohne eigenen Proxy laufen die Anfragen über den öffentlichen corsproxy.io — sicherer ist ein eigener Mini-Proxy (Cloudflare Worker), dessen URL du oben einträgst.</p>" +
			(last ? '<p class="hint">Letzter Sync: ' + U.fmtDate(last) + "</p>" : "") +
			'<div class="modal-actions"><button id="btnMigrateNotion">⬇ Import</button><button id="btnNotionSync">⇅ Zwei-Wege-Sync</button><button id="btnNotionCancel" class="danger" hidden>⏹ Abbrechen</button></div>' +
			'<div class="progress-bar" id="notionProgress" hidden><div class="progress-fill"></div></div>' +
			'<p class="hint" id="notionStatus"></p>';
	} else if (sec === "look") {
		const followSystemTheme = followsSystemTheme();
		const theme = resolvedTheme();
		const systemThemeLabel = theme === "light" ? "Hell" : "Dunkel";
		const accent = localStorage.getItem("impala67Accent") || "blue";
		const density = localStorage.getItem("impala67Density") || "compact";
		const motion = localStorage.getItem("impala67Motion") || "full";
		const fontSize = localStorage.getItem("impala67FontSize") || "m";
		const overlearn = localStorage.getItem("impala67Overlearn") !== "off";
		const confidence = localStorage.getItem("impala67Confidence") !== "off";
		const telemetry = localStorage.getItem("impala67Telemetry") !== "off";
		const widgets = dashboardWidgets();
		const widgetLabel = Object.fromEntries(DASHBOARD_WIDGETS.map((w) => [w.id, w.label]));
		body = '<h4>Design</h4>' +
			'<section class="appearance-theme-card' + (followSystemTheme ? " is-auto" : "") + '">' +
				'<div class="appearance-theme-copy"><span class="appearance-theme-icon" aria-hidden="true">◐</span><span>' +
					'<b>Mit Gerätemodus synchronisieren</b><small>' + (followSystemTheme ? "Aktuell „" + systemThemeLabel + "“ · passt sich automatisch an" : "Manuelle Auswahl verwenden") + '</small>' +
				'</span></div>' +
				'<label class="theme-switch" title="Geräte-Theme automatisch übernehmen"><input id="inpThemeFollowSystem" type="checkbox"' + (followSystemTheme ? " checked" : "") + '><span aria-hidden="true"></span></label>' +
			'</section>' +
			'<div class="row-btns appearance-choice appearance-manual-theme">' +
			'<button id="btnThemeDark" class="' + (theme === "dark" ? "active" : "") + '"' + (followSystemTheme ? " disabled" : "") + '>◐ Dunkel</button>' +
			'<button id="btnThemeLight" class="' + (theme === "light" ? "active" : "") + '"' + (followSystemTheme ? " disabled" : "") + '>☀ Hell</button></div>' +
			'<h4>Akzentfarbe</h4><div class="accent-picker">' + ["blue", "violet", "green", "orange"].map((name) =>
				'<button data-accent="' + name + '" class="accent-swatch accent-' + name + (accent === name ? " active" : "") + '" title="' + name + '"></button>').join("") + '</div>' +
			'<h4>Darstellungsdichte</h4><div class="row-btns appearance-choice">' +
			'<button id="btnDensityComfortable" class="' + (density === "comfortable" ? "active" : "") + '">Komfortabel</button>' +
			'<button id="btnDensityCompact" class="' + (density === "compact" ? "active" : "") + '">Kompakt</button></div>' +
			'<h4>Bewegung</h4><div class="row-btns appearance-choice">' +
			'<button id="btnMotionFull" class="' + (motion === "full" ? "active" : "") + '">Sanft</button>' +
			'<button id="btnMotionReduced" class="' + (motion === "reduced" ? "active" : "") + '">Reduziert</button></div>' +
			'<h4>Schriftgröße</h4><div class="row-btns appearance-choice">' +
			'<button id="btnFontS" class="' + (fontSize === "s" ? "active" : "") + '">Klein</button>' +
			'<button id="btnFontM" class="' + (fontSize === "m" ? "active" : "") + '">Normal</button>' +
			'<button id="btnFontL" class="' + (fontSize === "l" ? "active" : "") + '">Groß</button></div>' +
			'<h4>Lernen</h4>' +
			'<p class="hint">Overlearning-Sperre: frisch bewertete Karten sind kurz gesperrt statt sofort wieder dran (schützt vor dem Kurzzeitgedächtnis-Effekt).</p>' +
			'<div class="row-btns appearance-choice">' +
			'<button id="btnLockOn" class="' + (overlearn ? "active" : "") + '">Sperre an</button>' +
			'<button id="btnLockOff" class="' + (!overlearn ? "active" : "") + '">Aus</button></div>' +
			'<p class="hint">Selbsteinschätzung („Wie sicher bist du?“) vor dem Aufdecken der Antwort.</p>' +
			'<div class="row-btns appearance-choice">' +
			'<button id="btnConfOn" class="' + (confidence ? "active" : "") + '">Abfrage an</button>' +
			'<button id="btnConfOff" class="' + (!confidence ? "active" : "") + '">Aus</button></div>' +
			'<p class="hint">Lern-Telemetrie (nur lokal): zeichnet Denk-/Antwortzeiten und Sitzungen für die Home-Insights auf.</p>' +
			'<div class="row-btns appearance-choice">' +
			'<button id="btnTeleOn" class="' + (telemetry ? "active" : "") + '">Aufzeichnung an</button>' +
			'<button id="btnTeleOff" class="' + (!telemetry ? "active" : "") + '">Aus</button></div>' +
			'<h4>Home-Dashboard</h4><p class="hint">Widgets ein-/ausblenden und mit den Pfeilen anordnen.</p>' +
			'<div class="dashboard-settings">' + widgets.map((id, i) => '<div class="dashboard-setting-row">' +
				'<button data-dashtoggle="' + id + '" class="dash-visible" title="Widget ausblenden">✓</button>' +
				'<span>' + U.esc(widgetLabel[id] || id) + '</span>' +
				'<button data-dashmove="' + id + ':-1" ' + (i === 0 ? "disabled" : "") + '>↑</button>' +
				'<button data-dashmove="' + id + ':1" ' + (i === widgets.length - 1 ? "disabled" : "") + '>↓</button></div>').join("") +
			'<button data-dashadd="1" class="dashboard-add">+ Ausgeblendetes Widget hinzufügen</button></div>' +
			'<h4>Hintergrund</h4>' +
			'<p class="hint">Eigenes Hintergrundbild für die App. Es wird lokal gespeichert und dezent überblendet, damit Text lesbar bleibt.</p>' +
			'<div class="row-btns"><button id="btnPickBg">Bild wählen</button><button id="btnClearBg">Entfernen</button></div>'; 
	} else if (sec === "experimente") {
		// 🧪 Experimentelle Features (Phase 2 — KI-Lernmodi). Die Sektion wird
		// komplett von experimente.js gerendert; die Schalter verdrahten sich dort
		// selbst per Capture-Listener (gleiches Muster wie telemetrie.js) — hier
		// ist bewusst KEINE Verdrahtung nötig. Standardmäßig ist alles AUS.
		body = (window.EXP && window.EXP.settingsHtml) ? window.EXP.settingsHtml() :
			'<p class="hint">Experimente-Modul (experimente.js) nicht geladen.</p>';
	} else if (sec === "backup") {
		body = '<p class="hint">Manuelles Backup als JSON-Datei (Event-Log + PDFs). Ein Import wird konfliktfrei zusammengeführt (Log-Merge) — ideal auch über einen Google-Drive-Ordner.</p>' +
			'<div class="row-btns"><button id="btnExport">Export</button><button id="btnImport">Import</button></div>' +
			// Lern-Telemetrie: Rohdaten-Export für eigene Auswertungen. Der Klick auf
			// #btnTeleExport wird zentral in telemetrie.js behandelt (Capture-Listener) —
			// hier ist bewusst KEINE Verdrahtung nötig.
			'<h4>Lerndaten (Telemetrie)</h4>' +
			'<p class="hint">Alle Lern-Telemetriedaten (Bewertungen mit Denk- und Antwortzeiten, Sitzungen, Fokus-Ereignisse, Selbsteinschätzung) als JSON — z. B. für eigene Auswertungen.</p>' +
			'<div class="row-btns"><button id="btnTeleExport">📊 Lerndaten exportieren</button></div>' +
			'<h4>Workspace als Markdown-ZIP</h4>' +
			'<p class="hint">Alle Seiten eines Workspace als .md-Dateien (Ordnerstruktur = Seitenbaum) — in jedem Editor nutzbar.</p>' +
			'<div class="row-btns">' + Object.values(S.workspaces).map((ws) =>
				'<button data-zipws="' + U.esc(ws.id) + '">🗜 ' + U.esc(ws.name) + "</button>").join("") + "</div>" +
			'<h4 class="danger-label">⚠️ Gefahrenzone</h4>' +
			'<p class="hint">Löscht alle lokalen Seiten und deren Versionsverlauf unwiderruflich von diesem Gerät. Deine Einstellungen, API-Keys und Karteikarten bleiben erhalten.</p>' +
			'<div class="row-btns"><button id="btnResetAll" class="danger">Alle Seiten löschen</button></div>';
	} else if (sec === "sync") {
		// AUFGERÄUMT: EIN klarer Zweig pro Zustand — Desktop-App (Tauri) und Browser/PWA
		// nutzen ZWEI verschiedene Google-OAuth-Clients, das wird hier sichtbar getrennt:
		// Desktop = Typ „Desktop-App“ (System-Browser-Login), Browser = Typ „Webanwendung“ (Popup).
		const inTauri = !!window.__TAURI__;
		const desktopId = (window.APP_CONFIG && window.APP_CONFIG.GOOGLE_DESKTOP_CLIENT_ID) || S.settings.driveDesktopClientId || "";
		// Google verlangt für Desktop-Clients auch mit PKCE das client_secret (gilt bei
		// installierten Apps laut Google nicht als geheim) — ohne kommt „client_secret is missing“.
		const desktopSecret = (window.APP_CONFIG && window.APP_CONFIG.GOOGLE_DESKTOP_CLIENT_SECRET) || S.settings.driveDesktopClientSecret || "";
		const modeHint = '<p class="hint">' + (inTauri
			? "Desktop-App: Anmeldung über den System-Browser (OAuth-Client Typ „Desktop-App“)."
			: "Browser/PWA: Anmeldung per Google-Popup (OAuth-Client Typ „Webanwendung“).") + "</p>";
		// FIX: Nach einem App-Neustart war S.driveUserEmail leer, obwohl Token/Refresh-Token
		// lokal noch gültig waren — die Sektion zeigte fälschlich „Mit Google anmelden“ und
		// sprang erst nach einem Klick auf „Verbunden als …“. Jetzt wird die beim Login
		// gemerkte E-Mail wiederhergestellt, solange die Drive-Sitzung noch gültig ist.
		if (!S.driveUserEmail && DRIVE.isConnected && DRIVE.isConnected()) {
			S.driveUserEmail = localStorage.getItem("impala67_drive_email") || "Google-Konto";
		}
		if (S.driveUserEmail) {
			// 1) Bereits verbunden — egal auf welchem Weg.
			body = '<div class="drive-connected">✅ Verbunden als <b>' + U.esc(S.driveUserEmail) + "</b></div>" +
				'<p class="hint">Deine Notizen synchronisieren sich mit deinem privaten Google-Drive-App-Speicher (für andere Apps unsichtbar).</p>' +
				'<div class="row-btns"><button id="btnDriveSyncSettings">☁️ Jetzt synchronisieren</button><button id="btnDriveLogout">Abmelden</button></div>';
		} else if (inTauri && (!desktopId || !desktopSecret)) {
			// 2) Desktop-App ohne vollständige Desktop-Zugangsdaten (config.local.js fehlte im Build).
			body = modeHint + field("Google Desktop-Client-ID (OAuth-Client Typ „Desktop-App“)", "inpDriveDesktop", S.settings.driveDesktopClientId || desktopId) +
				field("Google Desktop-Client-Secret (GOCSPX-…)", "inpDriveDesktopSecret", S.settings.driveDesktopClientSecret || "", "password") +
				'<p class="hint">Beides steht in der Google Cloud Console direkt beim OAuth-Client vom Typ „Desktop-App“. Google verlangt das Secret beim Token-Tausch auch mit PKCE — bei Desktop-Apps gilt es laut Google ausdrücklich nicht als geheim. Einmal speichern, danach reicht ein Klick auf „Mit Google anmelden“. Alternativ: <code>web/config.local.js</code> befüllen und die App neu bauen.</p>' +
				saveActionsHtml;
		} else if (!inTauri && !S.settings.driveClientId) {
			// 3) Browser/PWA ohne Web-Client-ID.
			body = modeHint + field("Google Client-ID (einmalig einrichten)", "inpDrive", S.settings.driveClientId) +
				'<p class="hint">Google verlangt für jede App eine registrierte Client-ID — das ist einmalig nötig:<br>' +
				"1) Google Cloud Console → Drive-API aktivieren.<br>" +
				'2) OAuth-Client vom Typ „Webanwendung“ anlegen, <code>' + location.origin + '</code> als autorisierten Ursprung eintragen.<br>' +
				"3) Client-ID hier einfügen und speichern.<br>" +
				"Danach reicht wirklich nur noch ein Klick auf „Mit Google anmelden“.</p>" +
				saveActionsHtml;
		} else {
			// 4) Client-ID vorhanden — nur noch anmelden.
			body = modeHint + '<p class="hint">Client-ID ist hinterlegt — ein Klick genügt.</p>' +
				'<div class="modal-actions"><button id="btnDriveLogin">Mit Google anmelden</button></div>';
		}
	} else if (sec === "update") {
		const ver = (typeof window.getAppVersion === "function" ? window.getAppVersion() : null)
			|| window.APP_VERSION || "unbekannt";
		const platform = window.__TAURI__ ? "Windows (Desktop)" : "PWA / Browser";
		body = '<p class="hint">Lokal (läuft): <b id="updateLocalVer">v' + U.esc(String(ver).replace(/^v/i, "")) + '</b><br>' +
			'Server / Remote: <b id="updateRemoteVer">wird geprüft…</b><br>Plattform: ' + platform + '</p>' +
			// Einheitlich (Desktop + PWA): der Installieren-Knopf existiert auf beiden
			// Plattformen und wird von handleCheckUpdate ein-/ausgeblendet und beschriftet.
			'<div class="row-btns"><button id="btnCheckUpdate">Nach Updates suchen</button>' +
			'<button id="btnApplyPwaUpdate" hidden>Update installieren</button>' +
			"</div>" +
			'<p class="hint" id="updateStatus">Prüfe Version…</p>' +
			'<p class="hint">PWA liest <code>version.json</code> von dieser App-URL (nicht das GitHub-Release-Asset). ' +
			'Dateien im <code>web/</code>-Ordner deployen: <code>version.json</code>, <code>updater.js</code>, <code>latest.json</code>.</p>';
	}
	// Wie in Notion: kein "Schließen"-Button unten, sondern ein ✕ oben rechts.
	o.innerHTML = '<div class="modal settings-modal">' +
		'<button class="modal-x" id="btnCloseOverlay" title="Schließen">✕</button>' +
		'<div class="settings-nav">' + nav + "</div>" +
		'<div class="settings-body"><h3>Einstellungen</h3>' + body + "</div></div>";
	// Läuft gerade ein Notion-Import/-Sync (oder ist einer fertig), den Fortschritt
	if (sec === "notion" && typeof renderNotionJob === "function") renderNotionJob();
	// KI-Tab: Status-Banner mit aktuellem Ping-Ergebnis füllen
	if (sec === "ki") {
		renderStatusDot();
		queueMicrotask(() => { refreshEmbeddingModels(); });
	}
	// Update-Tab: Remote-Version sofort prüfen (Lokal + Server sichtbar)
	if (sec === "update") {
		// next tick: DOM muss erst im Overlay stehen
		setTimeout(() => { handleCheckUpdate().catch(() => {}); }, 0);
	}
}

// Einstellungen-Aktionen aus wireEvents:

export async function handleNotionSync(t) {
	if (S.notionJob && S.notionJob.running) return;
	const isSync = t.id === "btnNotionSync";
	const tok = U.el("inpNotionToken").value.trim();
	const pid = U.el("inpNotionPage").value.trim();
	const prox = U.el("inpCorsProxy") ? U.el("inpCorsProxy").value.trim() : (S.settings.corsProxy || "");
	// FIX: Validierung VOR dem Speichern — vorher überschrieb ein Klick mit leerem
	// Token-Feld erst den gespeicherten Token mit "" und brach dann erst ab.
	if (!tok) { U.toast("Token ist erforderlich.", "error"); return; }
	S.notionToken = tok;
	S.notionPageId = pid;
	await STATE.dispatch("settingsSet", { notionToken: tok, notionPageId: pid, corsProxy: prox });
	S.notionJob = { running: true, cancelling: false, kind: isSync ? "sync" : "import", status: isSync ? "Starte Sync…" : "Starte Import…", fraction: null };
	renderNotionJob();
	const onStatus = (st, fraction) => {
		S.notionJob.status = st;
		S.notionJob.fraction = fraction == null ? null : fraction;
		renderNotionJob();
	};
	try {
		if (isSync) {
			const r = await NOTION_MIGRATOR.sync(tok, pid || null, onStatus);
			S.notionJob.status = "✅ Sync fertig — " + r.pulled + " übernommen, " + r.pushed + " nach Notion übertragen, " + r.created + " in Notion angelegt" + (r.merged ? ", " + r.merged + " Duplikat(e) zusammengeführt" : "") + ".";
		} else {
			const newId = await NOTION_MIGRATOR.migrate(tok, pid || null, onStatus);
			S.notionJob.status = "✅ Import fertig!";
			if (newId) setTimeout(() => { closeOverlay(); openPage(newId); }, 600);
		}
		S.notionJob.fraction = 1;
	} catch (err) {
		S.notionJob.status = err.cancelled ? "⏹ Abgebrochen." : "⚠️ " + err.message;
		S.notionJob.fraction = null;
	}
	S.notionJob.running = false;
	S.notionJob.cancelling = false;
	renderNotionJob();
	render();
}

export function handleNotionCancel() {
	NOTION_MIGRATOR.cancel();
	if (S.notionJob) { S.notionJob.cancelling = true; S.notionJob.status = "Wird abgebrochen…"; }
	renderNotionJob();
}

export async function handleDriveLogin(t) {
	t.disabled = true;
	const old = t.textContent;
	t.textContent = "Verbinde…";
	try {
		const info = await DRIVE.login();
		S.driveUserEmail = (info && info.email) ? info.email : "Google-Konto";
		// E-Mail pro Gerät merken, damit die Sync-Sektion nach einem Neustart sofort
		// „✅ Verbunden als …“ zeigt (nur Anzeige — Tokens verwaltet drive.js selbst).
		try { localStorage.setItem("impala67_drive_email", S.driveUserEmail); } catch (err) { /* egal */ }
		openSettings("sync");
	} catch (err) {
		U.toast("Anmeldung fehlgeschlagen: " + err.message, "error");
		t.disabled = false;
		t.textContent = old;
	}
}

export function handleDriveLogout() {
	DRIVE.logout();
	S.driveUserEmail = null;
	try { localStorage.removeItem("impala67_drive_email"); } catch (err) { /* egal */ }
	openSettings("sync");
}

// Nach Drive-Sync: Konfliktdetails merken, Popup öffnen (oder nach Reload via boot.js).
function finishDriveSync({ imported, conflicts, conflictDetails }) {
	const details = conflictDetails || [];
	if (details.length) RENDER.mergePendingConflicts(details);
	const n = details.length || conflicts || 0;
	// drive.js hat importierte Events bereits deterministisch in STATE eingespielt;
	// kein location.reload() mehr — Editor, Tabs und Scrollposition bleiben erhalten.
	if (n > 0) {
		U.toast("Sync fertig — " + imported + " Änderungen, " + n + " Konflikt(e).", "error");
		RENDER.openConflictResolver(0);
		return;
	}
	if (imported > 0) {
		U.toast(imported + " Änderungen von einem anderen Gerät übernommen.", "success");
		render();
		return;
	}
	U.toast("Sync abgeschlossen — alles aktuell.", "success");
}

export async function handleDriveSyncSettings(t) {
	// iPad/Safari: Ein abgelaufener Browser-Token kann beim stillen OAuth-Check
	// kurz ein Google-Popup öffnen und sofort wieder schließen. Vor dem Sync daher
	// ausschließlich den lokal bekannten Sitzungsstatus prüfen; abgelaufene
	// Sitzungen führen gezielt zum sichtbaren „Mit Google anmelden“-Button.
	if (!DRIVE.isConnected()) {
		S.driveUserEmail = null;
		try { localStorage.removeItem("impala67_drive_email"); } catch (err) { /* egal */ }
		U.toast("Google-Sitzung abgelaufen. Bitte einmal erneut anmelden.", "error");
		openSettings("sync");
		return;
	}
	t.disabled = true;
	const old = t.textContent;
	try {
		finishDriveSync(await DRIVE.sync((st) => { t.textContent = st; }));
	} catch (err) {
		U.toast("Sync fehlgeschlagen: " + err.message, "error");
	}
	t.disabled = false;
	t.textContent = old;
}

// Automatische Syncs sollen nicht alle zwei Minuten Toasts erzeugen. Nur wenn
// ein anderes Gerät wirklich neue Änderungen geliefert hat oder ein Konflikt
// vorliegt, informieren wir und laden für einen konsistenten Event-Log-Replay neu.
let autoReloadScheduled = false;
function handleAutomaticDriveSync(result) {
	if (!result) return;
	const details = result.conflictDetails || [];
	if (details.length) RENDER.mergePendingConflicts(details);
	if (details.length || result.conflicts) {
		RENDER.openConflictResolver(0);
		return;
	}
	if (result.imported > 0) {
		// Live-Replay ist bereits erfolgt; nur gezielt neu rendern, ohne den Nutzer
		// aus Editor, Heft oder Tab-Kontext zu werfen.
		render();
	}
}

// Wird einmal beim App-Start aufgerufen. Der erste Lauf zieht den aktuellen
// Drive-Stand; danach sichern Debounce, Sichtbarkeitswechsel, Intervall und
// pagehide die Änderungen automatisch.
export function startAutoDriveSync() {
	return DRIVE.startAutoSync(handleAutomaticDriveSync);
}

export async function handleAddProvider() {
	const providers = (S.settings.aiProviders || []).slice();
	providers.push({ id: U.uid(), name: "Neue Quelle", base: "", key: "" });
	await STATE.dispatch("settingsSet", { aiProviders: providers });
	openSettings("ki");
}

export async function handleCheckUpdate() {
	const status = U.el("updateStatus");
	const btn = U.el("btnCheckUpdate");
	const applyBtn = U.el("btnApplyPwaUpdate");
	const localEl = U.el("updateLocalVer");
	const remoteEl = U.el("updateRemoteVer");
	const isTauri = !!window.__TAURI__;
	if (btn) { btn.disabled = true; btn.textContent = "Prüfe…"; }
	// Einheitlich: Suchen zeigt nur an. Der Installieren-Knopf erscheint erst, wenn
	// wirklich ein Update gefunden wurde (PWA: zusätzlich als Reload-Fallback).
	if (applyBtn) {
		applyBtn.hidden = isTauri;
		applyBtn.disabled = false;
		applyBtn.textContent = "App neu laden";
	}
	if (status) status.textContent = "Prüfe…";
	// Lokal = laufendes Bundle (nie Remote darüber schreiben)
	const running = (typeof window.getAppVersion === "function" && window.getAppVersion())
		|| window.APP_VERSION || "unbekannt";
	if (localEl) localEl.textContent = "v" + String(running).replace(/^v/i, "");
	try {
		if (typeof window.checkAppUpdate !== "function") {
			throw new Error("Update-Modul nicht geladen (updater.js)");
		}
		const r = await window.checkAppUpdate();
		if (localEl && r.current) localEl.textContent = "v" + r.current;
		if (remoteEl) {
			remoteEl.textContent = r.latest
				? ("v" + r.latest + (r.source ? " · " + r.source : ""))
				: "—";
		}
		if (r.hasUpdate) {
			// FIX: Desktop installierte hier früher sofort selbst. Jetzt auf BEIDEN
			// Plattformen zweistufig — installiert wird erst über den Knopf.
			if (status) status.textContent = "⬇️ Update v" + r.latest + " verfügbar (du: v" + r.current + "). Tippe „" + (isTauri ? "Update installieren" : "Update laden") + "“.";
			if (applyBtn) { applyBtn.hidden = false; applyBtn.textContent = isTauri ? "Update installieren" : "Update laden"; }
			U.toast("Update v" + r.latest + " verfügbar.", "success");
		} else if (r.remoteOlder) {
			if (status) status.textContent = "ℹ️ Bundle v" + r.current + " · Server v" + r.latest +
				" (Server älter — version.json beim Deploy mitbumpen).";
			U.toast("Lokal neuer als Server-Stand.", "success");
		} else {
			if (status) status.textContent = "✅ Aktuell: v" + (r.current || "?") +
				(r.latest ? " · Server v" + r.latest : "") + ".";
			U.toast("Kein Update nötig.", "success");
		}
	} catch (e) {
		// FIX iPad: früher window.open(GitHub) → Safari. Nie mehr extern öffnen.
		const msg = (e && e.message) ? e.message : String(e);
		if (status) status.textContent = "⚠️ Check fehlgeschlagen: " + msg +
			(isTauri ? "" : " — du kannst die App trotzdem neu laden.");
		if (remoteEl) remoteEl.textContent = "nicht erreichbar";
		if (applyBtn && !isTauri) {
			applyBtn.hidden = false;
			applyBtn.textContent = "App neu laden";
		}
		U.toast("Update-Check fehlgeschlagen.", "error");
	}
	if (btn) { btn.disabled = false; btn.textContent = "Nach Updates suchen"; }
}

// Einheitlicher Installieren-Knopf (Desktop + PWA) — installAppUpdate aus updater.js
// übernimmt die Plattform-Unterschiede (Tauri: Download + Neustart, PWA: SW + Reload).
export async function handleApplyPwaUpdate() {
	const status = U.el("updateStatus");
	const applyBtn = U.el("btnApplyPwaUpdate");
	const isTauri = !!window.__TAURI__;
	if (applyBtn) { applyBtn.disabled = true; applyBtn.textContent = isTauri ? "Installiert…" : "Lädt…"; }
	if (status) status.textContent = "⬇️ Update wird geladen…";
	try {
		if (typeof window.installAppUpdate === "function") {
			await window.installAppUpdate((st) => { if (status) status.textContent = st; });
		} else if (typeof window.applyPwaUpdate === "function") {
			await window.applyPwaUpdate();
		} else {
			location.reload();
		}
	} catch (e) {
		if (status) status.textContent = "⚠️ Update fehlgeschlagen: " + (e.message || e);
		U.toast("Update fehlgeschlagen.", "error");
		if (applyBtn) { applyBtn.disabled = false; applyBtn.textContent = isTauri ? "Update installieren" : "Jetzt neu laden"; }
	}
}

// Lädt nur tatsächlich verfügbare Embedding-Modelle der aktiven Chat-Quelle.
// Das aktuelle Modell bleibt sichtbar, auch wenn die Quelle gerade offline ist.
export async function refreshEmbeddingModels() {
	const select = U.el("inpEmbed");
	const hint = U.el("embeddingModelHint");
	if (!select) return;
	const current = select.dataset.currentembed || select.value || "";
	select.disabled = true;
	if (hint) hint.textContent = "Lade Modelle der aktiven Quelle…";
	try {
		const found = await AI.listEmbeddingModels();
		const models = found.map((m) => m.id);
		if (current && !models.includes(current)) models.push(current);
		select.innerHTML = '<option value="">Kein Embedding-Modell</option>' + models.map((id) =>
			'<option value="' + U.esc(id) + '">' + U.esc(id) + (id === current && !found.some((m) => m.id === id) ? " (gespeichert)" : "") + "</option>"
		).join("");
		select.value = current;
		if (hint) hint.textContent = found.length
			? found.length + " verfügbares Embedding-Modell · aktive Quelle: " + U.esc((found[0] && found[0].providerName) || "")
			: "Keine Embedding-Modelle erkannt. Prüfe Quelle oder lade ein Embedding-Modell.";
	} catch (err) {
		select.innerHTML = '<option value="' + U.esc(current) + '">' + U.esc(current || "Kein Modell verfügbar") + "</option>";
		select.value = current;
		if (hint) hint.textContent = "Modelle konnten nicht geladen werden.";
	} finally {
		select.disabled = false;
	}
}

export async function handleSaveSettings() {
	const patch = {};
	const g = (id) => document.getElementById(id);
	const provRows = document.querySelectorAll("[data-provrow]");
	if (provRows.length) {
		patch.aiProviders = Array.from(provRows).map((row) => {
			const id = row.dataset.provrow;
			const nameEl = row.querySelector("[data-provname]");
			const baseEl = row.querySelector("[data-provbase]");
			const keyEl = row.querySelector("[data-provkey]");
			return {
				id,
				name: nameEl && nameEl.value.trim() ? nameEl.value.trim() : id,
				base: baseEl ? baseEl.value.trim() : "",
				key: keyEl ? keyEl.value.trim() : "",
			};
		});
	}
	if (g("inpEmbed")) patch.embedModel = g("inpEmbed").value.trim();
	if (g("inpDrive")) patch.driveClientId = g("inpDrive").value.trim();
	if (g("inpDriveDesktop")) patch.driveDesktopClientId = g("inpDriveDesktop").value.trim(); // FIX: Desktop-Client-ID-Fallback
	if (g("inpDriveDesktopSecret")) patch.driveDesktopClientSecret = g("inpDriveDesktopSecret").value.trim(); // Google verlangt das Secret auch mit PKCE (Desktop-Client)
	if (g("inpCustomInstructions")) patch.customInstructions = g("inpCustomInstructions").value;
	if (g("inpAlwaysTools")) patch.alwaysSendTools = g("inpAlwaysTools").checked; // Tool-Angebot v3
	await STATE.dispatch("settingsSet", patch);
	closeOverlay();
	checkAI();
	RAG.reindexStale();
	S.availableModels = [];
	// Endpoint, Zugangsdaten oder Modell können sich geändert haben. Alte
	// Capability-Ergebnisse dürfen das Thinking-Menü deshalb nicht überleben.
	S.thinkingCapabilities = Object.create(null);
	AI.detectThinkingCapabilities().catch(() => {});
}

export async function handleClearBg() {
	await DB.putBlob("bgImage", new ArrayBuffer(0), {});
	applyBg();
}

export async function handleResetAll(t) {
	const ok = await U.confirm(
		"Möchtest du wirklich alle lokalen Seiten unwiderruflich löschen?\n\nDeine Einstellungen, API-Keys, Karteikarten und Stapel bleiben erhalten.",
		{ title: "Alle Seiten löschen", ok: "Alles löschen", danger: true }
	);
	if (!ok) return;
	t.disabled = true;
	t.textContent = "Lösche Seiten...";
	try {
		await DB.clearPages();
		U.toast("Alle Seiten wurden gelöscht — die App lädt neu.", "success");
		setTimeout(() => location.reload(), 900);
	} catch (err) {
		U.toast("Fehler beim Löschen der Seiten: " + err.message, "error");
		t.disabled = false;
		t.textContent = "Alle Seiten löschen";
	}
}

export async function handleDriveSync(t) {
	// FIX: je nach Plattform die RICHTIGE Client-ID prüfen (Desktop-App ≠ Web-Client) —
	// vorher wurde in der Tauri-App fälschlich die Web-Client-ID verlangt.
	const inTauri = !!window.__TAURI__;
	const hasId = inTauri
		? ((window.APP_CONFIG && window.APP_CONFIG.GOOGLE_DESKTOP_CLIENT_ID) || S.settings.driveDesktopClientId)
		: S.settings.driveClientId;
	if (!hasId) {
		U.toast("Für den Drive-Sync fehlt noch die Google Client-ID — einmalig unter ⚙️ Einstellungen → Sync einrichten.", "error");
		openSettings("sync");
		return;
	}
	// Keinen stillen OAuth-Aufruf aus dem Sync-Button starten: iPadOS zeigt ihn
	// oft kurz als Popup. Nur mit einem noch lokal gültigen Token synchronisieren;
	// sonst wird die Anmeldung klar und ausschließlich durch den Login-Button
	// ausgelöst.
	if (!DRIVE.isConnected()) {
		S.driveUserEmail = null;
		try { localStorage.removeItem("impala67_drive_email"); } catch (err) { /* egal */ }
		U.toast("Google-Sitzung abgelaufen. Bitte einmal erneut anmelden.", "error");
		openSettings("sync");
		return;
	}
	t.disabled = true;
	const old = t.innerHTML; // Button enthält jetzt ein SVG-Icon — textContent würde es zerstören
	try {
		finishDriveSync(await DRIVE.sync((st) => { t.textContent = "☁️ " + st; }));
	} catch (err) {
		U.toast("Sync fehlgeschlagen: " + err.message, "error");
	}
	t.disabled = false;
	t.innerHTML = old;
}

export async function handleBackupNow() {
	U.download("impala67-export-" + new Date().toISOString().slice(0, 10) + ".json", await DB.exportAll());
	localStorage.setItem("impala67LastBackup", new Date().toISOString());
	if (S.view === "home") render();
}

export const DASHBOARD_WIDGETS = [
	{ id: "continue", label: "Weitermachen" },
	{ id: "daily", label: "Daily Note" },
	{ id: "cards", label: "Fällige Karten" },
	{ id: "favorites", label: "Favoriten" },
	{ id: "chats", label: "Letzte Chats" },
	{ id: "pdfs", label: "Importierte PDFs" },
	{ id: "backup", label: "Backup" },
];

export function dashboardWidgets() {
	try {
		const saved = JSON.parse(localStorage.getItem("impala67DashboardWidgets") || "null");
		if (Array.isArray(saved)) return saved.filter((id) => DASHBOARD_WIDGETS.some((w) => w.id === id));
	} catch { /* Standard verwenden */ }
	return DASHBOARD_WIDGETS.map((w) => w.id);
}

function saveDashboardWidgets(ids) {
	localStorage.setItem("impala67DashboardWidgets", JSON.stringify(ids));
}

export function handleDashboardToggle(id) {
	const ids = dashboardWidgets().filter((x) => x !== id);
	saveDashboardWidgets(ids);
	openSettings("look");
}

export function handleDashboardMove(id, direction) {
	const ids = dashboardWidgets();
	const from = ids.indexOf(id);
	const to = from + Number(direction);
	if (from < 0 || to < 0 || to >= ids.length) return;
	[ids[from], ids[to]] = [ids[to], ids[from]];
	saveDashboardWidgets(ids);
	openSettings("look");
}

export function handleDashboardAdd() {
	const ids = dashboardWidgets();
	const hidden = DASHBOARD_WIDGETS.find((w) => !ids.includes(w.id));
	if (hidden) ids.push(hidden.id);
	else { U.toast("Alle Dashboard-Widgets sind bereits sichtbar.", "success"); return; }
	saveDashboardWidgets(ids);
	openSettings("look");
}

export function handleAppearanceSelect(kind, value) {
	const keys = { accent: "impala67Accent", density: "impala67Density", motion: "impala67Motion", fontsize: "impala67FontSize", overlearn: "impala67Overlearn", confidence: "impala67Confidence", telemetry: "impala67Telemetry" };
	if (!keys[kind]) return;
	localStorage.setItem(keys[kind], value);
	applyAppearance();
	openSettings("look");
}

export function handleSystemThemeToggle(enabled) {
	// Beim Ausschalten den gerade sichtbaren Modus als manuelle Auswahl behalten.
	if (!enabled) localStorage.setItem("impala67Theme", resolvedTheme());
	localStorage.setItem(SYSTEM_THEME_KEY, enabled ? "1" : "0");
	applyAppearance();
	openSettings("look");
}

export function handleThemeSelect(theme) {
	localStorage.setItem(SYSTEM_THEME_KEY, "0");
	localStorage.setItem("impala67Theme", theme);
	localStorage.removeItem("notionTheme");
	applyAppearance();
	openSettings("look");
}

export async function handleFileBgChange(e) {
	if (e.target.files[0]) {
		const file = e.target.files[0];
		e.target.value = "";
		const buf = await U.readAsBuffer(file);
		await DB.putBlob("bgImage", buf, { name: file.name, type: file.type });
		applyBg();
	}
}

export async function handleImportChange(e) {
	if (e.target.files[0]) {
		const file = e.target.files[0];
		e.target.value = "";
		try {
			const { added } = await DB.importAll(await U.readAsText(file));
			U.toast(added + " Änderungen importiert — die App lädt neu.", "success");
			setTimeout(() => location.reload(), 900);
		} catch (err) {
			U.toast("Import fehlgeschlagen: " + err.message, "error");
		}
	}
}

export const SETTINGS = {
	checkAI,
	applyTheme,
	applyAppearance,
	applyBg,
	renderNotionJob,
	openSettings,
	SETTINGS_SECTIONS,
	field,
	handleNotionSync,
	handleNotionCancel,
	handleDriveLogin,
	handleDriveLogout,
	handleDriveSyncSettings,
	startAutoDriveSync,
	handleAddProvider,
	refreshEmbeddingModels,
	handleCheckUpdate,
	handleApplyPwaUpdate,
	handleSaveSettings,
	handleClearBg,
	handleResetAll,
	handleDriveSync,
	handleBackupNow,
	handleThemeSelect,
	handleSystemThemeToggle,
	handleAppearanceSelect,
	handleDashboardToggle,
	handleDashboardMove,
	handleDashboardAdd,
	dashboardWidgets,
	DASHBOARD_WIDGETS,
	handleFileBgChange,
	handleImportChange
};