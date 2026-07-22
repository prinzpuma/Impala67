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
	{ id: "home", label: "Home" },
	{ id: "look", label: "Darstellung" },
	{ id: "sync", label: "Sync" },
	{ id: "notion", label: "Notion" },
	{ id: "backup", label: "Backup" },
	{ id: "update", label: "Update" },
	{ id: "experimente", label: "Experimente" },
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
		const embedProv = S.settings.embedProviderId || "";
		const activeId = S.settings.aiProviderId || (providers[0] || {}).id || "";
		const activeModel = S.settings.aiModel || "";
		const activeName = ((providers.find((p) => p.id === activeId) || {}).name) || activeId || "—";
		const currentLabel = activeModel ? (activeName + " · " + activeModel) : "Kein Modell gewählt";
		// Horizontaler Unter-Tab merken (Modelle | Quellen | Mehr) — nur einer sichtbar.
		const kiTab = S.settingsKiTab || "models";
		const tabBtn = (id, label) =>
			'<button type="button" class="ai-tab' + (kiTab === id ? " active" : "") + '" data-aitab="' + id + '">' + label + "</button>";
		const pane = (id, html) =>
			'<div class="ai-tab-pane" data-aitabpane="' + id + '"' + (kiTab === id ? "" : " hidden") + '>' + html + "</div>";

		// UI v6: wenig Text, große Flächen, klare Hierarchie — Erklärungen nur als title/placeholder.
		const modelsPane =
			'<div class="ai-pane-head">' +
				'<div class="ai-active-pill" title="Aktives Chat-Modell"><span class="ai-active-dot" aria-hidden="true"></span><b id="aiCurrentModelLabel">' + U.esc(currentLabel) + '</b></div>' +
				'<button type="button" id="btnRefreshModels" class="ai-icon-btn" title="Neu laden" aria-label="Modelle neu laden">↻</button>' +
			'</div>' +
			'<div id="settingsModelList" class="settings-model-list"><div class="menu-note">Lädt…</div></div>' +
			'<p id="settingsModelHint" class="ai-soft-meta" hidden></p>' +
			'<div class="settings-custom-model" title="Modell manuell setzen">' +
				'<input id="inpCustomModel" type="text" placeholder="Modell-ID…" value="' + U.esc(activeModel) + '" autocomplete="off">' +
				'<select id="inpCustomModelProv" aria-label="Quelle">' + providers.map((pr) =>
					'<option value="' + U.esc(pr.id) + '"' + (pr.id === activeId ? " selected" : "") + '>' + U.esc(pr.name || pr.id) + "</option>"
				).join("") + '</select>' +
				'<button type="button" id="btnApplyCustomModel" class="ai-icon-btn" title="Übernehmen" aria-label="Modell übernehmen">✓</button>' +
			'</div>';

		const sourcesPane =
			'<div class="provider-list">' + providers.map((pr) =>
				'<details class="provider-card" data-provrow="' + pr.id + '"' + (pr.id === activeId ? " open" : "") + '>' +
					'<summary class="provider-card-summary">' +
						'<span class="provider-card-title">' + U.esc(pr.name || pr.id) + '</span>' +
						(pr.id === activeId ? '<span class="provider-active-badge">aktiv</span>' : "") +
						'<span class="provider-summary-url">' + U.esc(String(pr.base || "").replace(/^https?:\/\//, "").slice(0, 28)) + '</span>' +
					'</summary>' +
					'<div class="provider-card-body">' +
						'<input data-provname="' + pr.id + '" placeholder="Name" value="' + U.esc(pr.name) + '">' +
						'<input data-provbase="' + pr.id + '" placeholder="http://localhost:1234/v1" value="' + U.esc(pr.base) + '">' +
						'<input data-provkey="' + pr.id + '" type="password" autocomplete="off" placeholder="API-Key" value="' + U.esc(pr.key) + '">' +
						'<div class="provider-card-foot">' +
							'<button type="button" class="ai-ghost-btn" data-provtest="' + pr.id + '">Testen</button>' +
							'<button type="button" data-provdel="' + pr.id + '" class="ai-icon-btn danger" title="Entfernen" aria-label="Quelle entfernen">🗑</button>' +
						'</div>' +
						'<p class="provider-status" data-provstatus="' + pr.id + '"></p>' +
					'</div>' +
				'</details>'
			).join("") + "</div>" +
			'<div class="ai-provider-add">' +
				'<button type="button" id="btnAddProvider" class="ai-ghost-btn">+ Quelle</button>' +
				'<button type="button" data-provpreset="local" class="ai-chip-btn">LM Studio</button>' +
				'<button type="button" data-provpreset="google" class="ai-chip-btn">Gemini</button>' +
				'<button type="button" data-provpreset="openai" class="ai-chip-btn">OpenAI</button>' +
			'</div>';

		const morePane =
			'<div class="ai-more-stack">' +
				// Tools mitsenden: nutzt die bewährte, fehlerfreie .theme-switch-Klasse
				// der Darstellungseinstellungen — verhindert Klick-Flackern und doppeltes Toggeln.
				'<div class="ai-toggle-card" title="Alle Werkzeuge bei jeder Anfrage mitsenden">' +
					'<span class="ai-toggle-copy"><b>Tools mitsenden</b></span>' +
					'<label class="theme-switch"><input id="inpAlwaysTools" type="checkbox"' + (S.settings.alwaysSendTools !== false ? " checked" : "") + '><span aria-hidden="true"></span></label>' +
				'</div>' +
				'<div class="ai-field-card">' +
					'<div class="ai-field-label-row"><label for="inpEmbed">Embedding</label>' +
					'<button type="button" id="btnRefreshEmbedding" class="ai-icon-btn" title="Neu laden" aria-label="Embeddings neu laden">↻</button></div>' +
					// "quelleId::modell" — unabhängig vom Chat-Modell. [F4]
					'<select id="inpEmbed" class="ai-select-block" data-currentembed="' + U.esc(embedValue) + '" data-currentprov="' + U.esc(embedProv) + '" disabled>' +
						'<option value="' + U.esc(embedValue ? embedProv + "::" + embedValue : "") + '">' + U.esc(embedValue || "Lädt…") + '</option></select>' +
					'<p id="embeddingModelHint" class="ai-soft-meta" hidden></p>' +
				'</div>' +
				'<div class="ai-field-card">' +
					'<label for="inpCustomInstructions">Anweisungen</label>' +
					'<textarea id="inpCustomInstructions" rows="5" placeholder="Tonfall, Fach, Vorlieben…">' + U.esc(S.settings.customInstructions) + '</textarea>' +
				'</div>' +
			'</div>';

		// Speichern bewusst AUSSERHALB der scrollbaren Panes — sonst wird der Knopf
		// unten abgeschnitten (overflow der Body/Pane-Kette).
		body = '<section class="ai-settings">' +
			'<div id="aiStatusSettings" class="ai-status-banner"></div>' +
			'<nav class="ai-tabs" role="tablist" aria-label="KI-Bereiche">' +
				tabBtn("models", "Modelle") +
				tabBtn("sources", "Quellen") +
				tabBtn("more", "Mehr") +
			'</nav>' +
			'<div class="ai-tab-panes">' +
				pane("models", modelsPane) +
				pane("sources", sourcesPane) +
				pane("more", morePane) +
			'</div>' +
			'<div class="modal-actions ai-settings-foot"><button type="button" id="btnSaveSettings">Speichern</button></div>' +
		'</section>';
	} else if (sec === "home") {
		// 🏠 Home-Editor v2 (21. Juli): ersetzt die alte „Home-Dashboard“-Liste, die mit
		// der echten Homeseite nichts zu tun hatte. HOME_SECTIONS (unten) sind exakt die
		// Bereiche, die render.js → renderHome() zeichnet — 👁/🚫 steuert die Sichtbarkeit,
		// ↑↓ die Reihenfolge; alles wirkt sofort, ganz ohne Speichern-Knopf.
		const rows = homeLayout().map((e, i, arr) => {
			const meta = HOME_SECTIONS.find((s) => s.id === e.id) || { label: e.id, hint: "" };
			return '<div class="dashboard-setting-row"' + (e.on ? "" : ' style="opacity:.45"') + '>' +
				'<button data-dashtoggle="' + U.esc(e.id) + '" class="dash-visible" title="' + (e.on ? "Bereich ausblenden" : "Bereich wieder einblenden") + '">' + (e.on ? "👁" : "🚫") + '</button>' +
				'<span><b>' + U.esc(meta.label) + '</b>' + (meta.hint ? ' <small class="hint">· ' + U.esc(meta.hint) + '</small>' : "") + '</span>' +
				'<button data-dashmove="' + U.esc(e.id) + ':-1"' + (i === 0 ? " disabled" : "") + ' title="Nach oben">↑</button>' +
				'<button data-dashmove="' + U.esc(e.id) + ':1"' + (i === arr.length - 1 ? " disabled" : "") + ' title="Nach unten">↓</button></div>';
		}).join("");
		body = '<p class="hint">Deine Homeseite, deine Regeln: Begrüßungsname setzen, Bereiche per 👁/🚫 ein- und ausblenden und per ↑↓ sortieren — jede Änderung wirkt sofort.</p>' +
			field("Anzeigename für die Begrüßung (leer = ohne Name; speichert beim Verlassen des Felds)", "inpHomeName", S.settings.homeUserName || "") +
			'<h4>Bereiche der Homeseite</h4>' +
			'<div class="dashboard-settings">' + rows +
			'<button data-dashadd="1" class="dashboard-add">↺ Standard-Layout wiederherstellen</button></div>' +
			'<p class="hint">Immer sichtbar: Begrüßung mit Kennzahlen-Chips, Sync-Konflikt-Hinweis und „+ Neue Seite“ — alles andere bestimmst du hier.</p>';
	} else if (sec === "notion") {
		const last = S.settings.notionLastSync;
		body = field("Integration Token (secret_…)", "inpNotionToken", S.settings.notionToken || S.notionToken, "password") +
			field("Wurzelseiten-ID (leer = alle freigegebenen Seiten)", "inpNotionPage", S.settings.notionPageId || S.notionPageId) +
			field("CORS-Proxy (optional; leer = corsproxy.io)", "inpCorsProxy", S.settings.corsProxy || "") +
			'<p class="hint">Integration auf notion.so/my-integrations erstellen, Seiten dort per „Teilen“ freigeben. <b>⬇ Import</b> holt alles einmalig, <b>⇅ Zwei-Wege-Sync</b> gleicht danach in beide Richtungen ab.</p>' +
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
			'<p class="hint">Overlearning-Sperre — frisch bewertete Karten bleiben kurz gesperrt.</p>' +
			'<div class="row-btns appearance-choice">' +
			'<button id="btnLockOn" class="' + (overlearn ? "active" : "") + '">Sperre an</button>' +
			'<button id="btnLockOff" class="' + (!overlearn ? "active" : "") + '">Aus</button></div>' +
			'<p class="hint">Selbsteinschätzung vor dem Aufdecken der Antwort.</p>' +
			'<div class="row-btns appearance-choice">' +
			'<button id="btnConfOn" class="' + (confidence ? "active" : "") + '">Abfrage an</button>' +
			'<button id="btnConfOff" class="' + (!confidence ? "active" : "") + '">Aus</button></div>' +
			'<p class="hint">Lern-Telemetrie (nur lokal) für die Home-Insights.</p>' +
			'<div class="row-btns appearance-choice">' +
			'<button id="btnTeleOn" class="' + (telemetry ? "active" : "") + '">Aufzeichnung an</button>' +
			'<button id="btnTeleOff" class="' + (!telemetry ? "active" : "") + '">Aus</button></div>' +
			'<h4>Home-Layout</h4>' +
			'<p class="hint">Der Home-Editor ist umgezogen: Bereiche, Reihenfolge und Begrüßungsname findest du jetzt unter <b>Einstellungen → Home</b>.</p>' +
			'<div class="row-btns"><button data-set="home">🏠 Home-Editor öffnen</button></div>' +
			'<h4>Hintergrund</h4>' +
			'<div class="row-btns"><button id="btnPickBg">Bild wählen</button><button id="btnClearBg">Entfernen</button></div>'; 
	} else if (sec === "experimente") {
		// 🧪 Experimentelle Features (Phase 2 — KI-Lernmodi). Die Sektion wird
		// komplett von experimente.js gerendert; die Schalter verdrahten sich dort
		// selbst per Capture-Listener (gleiches Muster wie telemetrie.js) — hier
		// ist bewusst KEINE Verdrahtung nötig. Standardmäßig ist alles AUS.
		body = (window.EXP && window.EXP.settingsHtml) ? window.EXP.settingsHtml() :
			'<p class="hint">Experimente-Modul (experimente.js) nicht geladen.</p>';
	} else if (sec === "backup") {
		body = '<p class="hint">Backup als JSON-Datei (Event-Log + PDFs) — ein Import wird konfliktfrei zusammengeführt.</p>' +
			'<div class="row-btns"><button id="btnExport">Export</button><button id="btnImport">Import</button></div>' +
			// Lern-Telemetrie: Rohdaten-Export für eigene Auswertungen. Der Klick auf
			// #btnTeleExport wird zentral in telemetrie.js behandelt (Capture-Listener) —
			// hier ist bewusst KEINE Verdrahtung nötig.
			'<h4>Lerndaten (Telemetrie)</h4>' +
			'<p class="hint">Alle Lern-Telemetriedaten als JSON für eigene Auswertungen.</p>' +
			'<div class="row-btns"><button id="btnTeleExport">📊 Lerndaten exportieren</button></div>' +
			'<h4>Workspace als Markdown-ZIP</h4>' +
			'<p class="hint">Alle Seiten als .md-Dateien (Ordnerstruktur = Seitenbaum).</p>' +
			'<div class="row-btns">' + Object.values(S.workspaces).map((ws) =>
				'<button data-zipws="' + U.esc(ws.id) + '">🗜 ' + U.esc(ws.name) + "</button>").join("") + "</div>" +
			'<h4 class="danger-label">⚠️ Gefahrenzone</h4>' +
			'<p class="hint">Löscht alle lokalen Seiten unwiderruflich. Einstellungen, API-Keys und Karteikarten bleiben erhalten.</p>' +
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
				'<p class="hint">Sync läuft über deinen privaten Google-Drive-App-Speicher.</p>' +
				'<div class="row-btns"><button id="btnDriveSyncSettings">☁️ Jetzt synchronisieren</button><button id="btnDriveLogout">Abmelden</button></div>';
		} else if (inTauri && (!desktopId || !desktopSecret)) {
			// 2) Desktop-App ohne vollständige Desktop-Zugangsdaten (config.local.js fehlte im Build).
			body = modeHint + field("Google Desktop-Client-ID (OAuth-Client Typ „Desktop-App“)", "inpDriveDesktop", S.settings.driveDesktopClientId || desktopId) +
				field("Google Desktop-Client-Secret (GOCSPX-…)", "inpDriveDesktopSecret", S.settings.driveDesktopClientSecret || "", "password") +
				'<p class="hint">Beides steht in der Google Cloud Console beim OAuth-Client „Desktop-App“. Einmal speichern — danach reicht „Mit Google anmelden“. Alternativ <code>web/config.local.js</code> befüllen.</p>' +
				saveActionsHtml;
		} else if (!inTauri && !S.settings.driveClientId) {
			// 3) Browser/PWA ohne Web-Client-ID.
			body = modeHint + field("Google Client-ID (einmalig einrichten)", "inpDrive", S.settings.driveClientId) +
				'<p class="hint">Einmalig: Google Cloud Console → Drive-API aktivieren, OAuth-Client „Webanwendung“ mit <code>' + location.origin + '</code> als Ursprung anlegen, Client-ID hier speichern.</p>' +
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
			'<p class="hint" id="updateStatus">Prüfe Version…</p>';
	}
	// Wie in Notion: kein "Schließen"-Button unten, sondern ein ✕ oben rechts.
	// data-sec markiert den aktiven Bereich (CSS-Hooks, z. B. KI-Layout ohne Abschneiden).
	o.innerHTML = '<div class="modal settings-modal" data-sec="' + U.esc(sec) + '">' +
		'<button class="modal-x" id="btnCloseOverlay" title="Schließen">✕</button>' +
		'<div class="settings-nav">' + nav + "</div>" +
		'<div class="settings-body"><h3>' + U.esc(((SETTINGS_SECTIONS.find((s) => s.id === sec) || {}).label) || "Einstellungen") + '</h3>' + body + "</div></div>";
	// Läuft gerade ein Notion-Import/-Sync (oder ist einer fertig), den Fortschritt
	if (sec === "notion" && typeof renderNotionJob === "function") renderNotionJob();
	// KI-Tab: Status + Inhalte des aktiven Unter-Tabs laden (lazy je Tab).
	if (sec === "ki") {
		renderStatusDot();
		queueMicrotask(() => loadKiTabContent(S.settingsKiTab || "models"));
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
	// FIX: aktuelle (ungespeicherte) Feldwerte übernehmen — vorher verwarf das
	// Neu-Rendern beim Hinzufügen einer Quelle alle noch nicht gespeicherten Eingaben.
	const rows = Array.from(document.querySelectorAll("[data-provrow]"));
	const providers = rows.length ? rows.map((row) => {
		const val = (sel) => { const el = row.querySelector(sel); return el ? el.value.trim() : ""; };
		return { id: row.dataset.provrow, name: val("[data-provname]") || row.dataset.provrow, base: val("[data-provbase]"), key: val("[data-provkey]") };
	}) : (S.settings.aiProviders || []).slice();
	providers.push({ id: U.uid(), name: "Neue Quelle", base: "", key: "" });
	await STATE.dispatch("settingsSet", { aiProviders: providers });
	S.settingsKiTab = "sources"; // nach dem Anlegen im Quellen-Tab bleiben
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

// Horizontaler KI-Unter-Tab wechseln — ohne Full-Rerender, damit ungespeicherte
// Eingaben in den anderen Panes erhalten bleiben.
export function switchKiTab(tab) {
	const id = tab === "sources" || tab === "more" ? tab : "models";
	S.settingsKiTab = id;
	document.querySelectorAll(".ai-tabs [data-aitab]").forEach((b) => {
		b.classList.toggle("active", b.dataset.aitab === id);
	});
	document.querySelectorAll("[data-aitabpane]").forEach((p) => {
		p.hidden = p.dataset.aitabpane !== id;
	});
	loadKiTabContent(id);
}

// Inhalte lazy nachladen, sobald der jeweilige Unter-Tab sichtbar wird.
function loadKiTabContent(tab) {
	if (tab === "models") refreshChatModels();
	else if (tab === "more") refreshEmbeddingModels();
	// sources: kein Auto-Ping — Nutzer testet gezielt pro Karte
}

// Zeichnet die Modell-Liste in den offenen KI-Einstellungen (Favoriten oben).
// Nutzt S.availableModels (Cache) — ohne Netz. Nach Laden: refreshChatModels().
export function paintSettingsModels() {
	const host = U.el("settingsModelList");
	const label = U.el("aiCurrentModelLabel");
	if (!host) return;
	const providers = S.settings.aiProviders || [];
	const nameOf = (id) => ((providers.find((p) => p.id === id) || {}).name) || id || "";
	const curPr = S.settings.aiProviderId || "";
	const curModel = S.settings.aiModel || "";
	if (label) label.textContent = curModel ? (nameOf(curPr) + " · " + curModel) : "Kein Modell gewählt";
	const favSet = (typeof RENDER.favModels === "function") ? RENDER.favModels() : new Set();
	const live = Array.isArray(S.availableModels) ? S.availableModels : [];
	const row = (m) => {
		const favKey = m.providerId + "::" + m.id;
		const fav = favSet.has(favKey);
		const active = m.providerId === curPr && m.id === curModel;
		return '<div class="model-row">' +
			'<button type="button" class="menu-item' + (active ? " active" : "") + '" data-modelset="' + U.esc(m.providerId) + "::" + U.esc(m.id) + '">' +
				'<span class="menu-item-label">' + U.esc(m.id) + "</span>" +
				'<small class="settings-model-src">' + U.esc(nameOf(m.providerId)) + "</small>" +
				(active ? '<span class="menu-check">✓</span>' : "") +
			"</button>" +
			'<button type="button" class="model-fav' + (fav ? " on" : "") + '" data-modelfav="' + U.esc(favKey) + '" title="' + (fav ? "Favorit entfernen" : "Als Favorit pinnen") + '">' + (fav ? "★" : "☆") + "</button></div>";
	};
	let body = "";
	const favLive = live.filter((m) => favSet.has(m.providerId + "::" + m.id));
	if (favLive.length) body += '<div class="menu-label">★ Favoriten</div>' + favLive.map(row).join("");
	for (const pr of providers) {
		const rest = live.filter((m) => m.providerId === pr.id && !favSet.has(pr.id + "::" + m.id));
		if (rest.length) body += '<div class="menu-label">' + U.esc(pr.name || pr.id) + "</div>" + rest.map(row).join("");
	}
	// Offline-Favoriten / aktuelles Modell ohne Live-Treffer trotzdem anbieten
	const seen = new Set(live.map((m) => m.providerId + "::" + m.id));
	const orphans = [];
	favSet.forEach((k) => { if (!seen.has(k)) orphans.push(k); });
	if (curModel && !seen.has(curPr + "::" + curModel) && !favSet.has(curPr + "::" + curModel)) orphans.push(curPr + "::" + curModel);
	if (orphans.length) {
		body += '<div class="menu-label">Gespeichert</div>' + orphans.map((k) => {
			const sep = k.indexOf("::");
			const prId = sep === -1 ? curPr : k.slice(0, sep);
			const id = sep === -1 ? k : k.slice(sep + 2);
			return row({ id, providerId: prId });
		}).join("");
	}
	// Offline / keine Live-Liste: feste Vorschläge (Gemini/OpenAI/lokal) anbieten
	if (!body && (AI.MODEL_PRESETS || []).length) {
		body = '<div class="menu-label">Vorschläge</div>' + (AI.MODEL_PRESETS || []).map((p) =>
			row({ id: p.value, providerId: p.provider })).join("");
	}
	host.innerHTML = body || '<div class="menu-note">Keine Modelle erreichbar. Quelle prüfen oder unten manuell eintragen.</div>';
}

// Lädt Chat-Modelle ALLER Quellen und zeichnet die Liste (inkl. Favoriten).
export async function refreshChatModels() {
	const host = U.el("settingsModelList");
	const hint = U.el("settingsModelHint");
	const btn = U.el("btnRefreshModels");
	if (!host) return;
	if (btn) btn.disabled = true;
	if (hint) hint.textContent = "Lade Modelle aller Quellen…";
	host.innerHTML = '<div class="menu-note">Modelle werden geladen…</div>';
	try {
		const found = await AI.listModels();
		S.availableModels = found;
		paintSettingsModels();
		if (hint) {
			// Meta-Zeile nur bei Fehlern zeigen — Erfolg braucht keinen Fließtext.
			if (found.length) { hint.hidden = true; hint.textContent = ""; }
			else { hint.hidden = false; hint.textContent = "Keine Modelle erreichbar — Quelle prüfen."; }
		}
	} catch (err) {
		paintSettingsModels();
		if (hint) hint.textContent = "Modelle konnten nicht geladen werden.";
	} finally {
		if (btn) btn.disabled = false;
	}
}

// Manuelles Modell + Quelle aus den Feldern unter der Liste übernehmen.
export async function handleApplyCustomModel() {
	const model = (U.el("inpCustomModel") || {}).value?.trim() || "";
	const providerId = (U.el("inpCustomModelProv") || {}).value || S.settings.aiProviderId || "";
	if (!model) { U.toast("Bitte eine Modell-ID eintragen.", "error"); return; }
	await STATE.dispatch("settingsSet", { aiProviderId: providerId, aiModel: model });
	paintSettingsModels();
	renderStatusDot();
	if (typeof RENDER.renderModelBar === "function") RENDER.renderModelBar();
	AI.detectThinkingCapabilities().catch(() => {});
	checkAI();
	U.toast("Modell übernommen: " + model, "success");
}

// Verbindungstest für EINE Quellen-Karte mit den aktuellen (auch ungespeicherten)
// Feldwerten — man muss also nicht erst speichern, um eine Änderung zu prüfen.
export async function testProviderRow(id, btn) {
	const row = document.querySelector('[data-provrow="' + id + '"]');
	if (!row) return;
	const val = (sel) => { const el = row.querySelector(sel); return el ? el.value.trim() : ""; };
	const box = row.querySelector("[data-provstatus]");
	if (btn) { btn.disabled = true; btn.textContent = "…"; }
	if (box) { box.classList.remove("ok", "warn", "bad"); box.textContent = "Prüfe…"; }
	const r = await AI.pingProvider({ id, name: val("[data-provname]") || id, base: val("[data-provbase]"), key: val("[data-provkey]") });
	if (btn) { btn.disabled = false; btn.textContent = "Testen"; }
	if (!box) return; // Einstellungen wurden inzwischen geschlossen/gewechselt
	box.classList.remove("ok", "warn", "bad");
	if (r.ok) {
		box.classList.add("ok");
		box.textContent = "Verbunden · " + r.models + " Modelle · " + r.ms + " ms";
	} else if (r.suggestedBase) {
		// Diagnose mit Lösungsvorschlag (z. B. fehlendes /v1) — ein Klick übernimmt die URL.
		box.classList.add("warn");
		box.innerHTML = U.esc(r.error || "URL unvollständig") + ' <button type="button" class="ai-ghost-btn" data-provfixbase="' + U.esc(id) + '" data-base="' + U.esc(r.suggestedBase) + '">/v1 übernehmen</button>';
	} else {
		box.classList.add("bad");
		box.textContent = r.error || "Keine Verbindung";
	}
}
export const handleProviderTest = (t) => testProviderRow(t.dataset.provtest, t);
// Beim Öffnen des KI-Tabs: alle Quellen parallel durchpingen — jede Karte zeigt ihren Status.
export function testAllProviders() {
	return Promise.all(Array.from(document.querySelectorAll("[data-provrow]")).map((row) => testProviderRow(row.dataset.provrow)));
}

// Lädt verfügbare Embedding-Modelle ALLER Quellen (nicht nur der aktiven Chat-Quelle).
// Option-Werte sind als "quelleId::modell" kodiert — beim Speichern wird daraus
// embedProviderId + embedModel, damit Embeddings quellen-unabhängig laufen. [F4]
export async function refreshEmbeddingModels() {
	const select = U.el("inpEmbed");
	const hint = U.el("embeddingModelHint");
	if (!select) return;
	const current = select.dataset.currentembed || "";
	const currentProv = select.dataset.currentprov || "";
	const currentValue = current ? currentProv + "::" + current : "";
	select.disabled = true;
	if (hint) hint.textContent = "Lade Embedding-Modelle aller Quellen…";
	try {
		const found = await AI.listEmbeddingModels();
		// Gespeichertes Modell exakt (Quelle+Modell) oder wenigstens per Modellnamen wiederfinden
		const exact = found.find((m) => m.id === current && (!currentProv || m.providerId === currentProv));
		const options = found.map((m) =>
			'<option value="' + U.esc(m.providerId + "::" + m.id) + '">' + U.esc(m.id) + " — " + U.esc(m.providerName) + "</option>");
		if (current && !exact) options.push('<option value="' + U.esc(currentValue) + '">' + U.esc(current) + " (gespeichert — Quelle gerade nicht erreichbar?)</option>");
		select.innerHTML = '<option value="">Kein Embedding-Modell (semantische Suche aus)</option>' + options.join("");
		select.value = exact ? exact.providerId + "::" + exact.id : currentValue;
		// FIX: kein U.esc() mehr in textContent — das zeigte HTML-Entities als Klartext.
		if (hint) {
			if (found.length) { hint.hidden = true; hint.textContent = ""; }
			else { hint.hidden = false; hint.textContent = "Kein Embedding-Modell gefunden."; }
		}
	} catch (err) {
		select.innerHTML = '<option value="' + U.esc(currentValue) + '">' + U.esc(current || "—") + "</option>";
		select.value = currentValue;
		if (hint) { hint.hidden = false; hint.textContent = "Konnte nicht geladen werden."; }
	} finally {
		select.disabled = false;
	}
}

export async function handleSaveSettings() {
	const patch = {};
	const g = (id) => document.getElementById(id);
	const provRows = document.querySelectorAll("[data-provrow]");
	if (provRows.length) {
		// FIX: Server-URL normalisieren — Nutzer kleben oft komplette Endpunkt-Pfade
		// (…/chat/completions, …/models) oder Slash-Enden ein; beides verhinderte danach
		// jede Verbindung, weil ai.js selbst bewusst nichts anhängt oder abschneidet.
		const cleanBase = (raw) => String(raw || "").trim()
			.replace(/\/+$/, "")
			.replace(/\/(chat\/completions|completions|responses|models|embeddings)$/i, "");
		patch.aiProviders = Array.from(provRows).map((row) => {
			const id = row.dataset.provrow;
			const nameEl = row.querySelector("[data-provname]");
			const baseEl = row.querySelector("[data-provbase]");
			const keyEl = row.querySelector("[data-provkey]");
			return {
				id,
				name: nameEl && nameEl.value.trim() ? nameEl.value.trim() : id,
				base: baseEl ? cleanBase(baseEl.value) : "",
				key: keyEl ? keyEl.value.trim() : "",
			};
		});
	}
	if (g("inpEmbed")) {
		// Option-Wert "quelleId::modell" → Quelle + Modell getrennt speichern; Embeddings
		// laufen damit unabhängig von der im Chat aktiven Quelle. [F4]
		const raw = g("inpEmbed").value;
		const sep = raw.indexOf("::");
		patch.embedProviderId = sep === -1 ? "" : raw.slice(0, sep);
		patch.embedModel = (sep === -1 ? raw : raw.slice(sep + 2)).trim();
	}
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

// ---------- 🏠 Home-Editor: EINE Quelle der Wahrheit für die Homeseiten-Bereiche ----------
// Ersetzt die alte DASHBOARD_WIDGETS-Liste, die renderHome() nie gelesen hat (Einstellungen
// und Homeseite waren entkoppelt — Ausblenden war deshalb wirkungslos). Diese ids sind jetzt
// exakt die Bereiche aus render.js → renderHome(); Sichtbarkeit UND Reihenfolge kommen aus
// homeLayout(). Gespeichert als Gerätewahl (localStorage) wie Theme/Dichte — kein Drive-Sync.
export const HOME_SECTIONS = [
	{ id: "stats", label: "Kennzahlen", hint: "heute gelernt · Streak · fällig · Erfolgsquote" },
	{ id: "foryou", label: "Für dich heute", hint: "persönliche Hinweise aus deinen Lerndaten" },
	{ id: "continue", label: "Weitermachen", hint: "zuletzt bearbeitete Seite" },
	{ id: "today", label: "Heute-Leiste", hint: "Daily · Karten · Noten · Backup" },
	{ id: "insights", label: "Lern-Insights", hint: "Telemetrie-Auswertung" },
	{ id: "decks", label: "Stapel-Überblick", hint: "fällige Karten pro Stapel, Klick lernt" },
	{ id: "favorites", label: "Favoriten", hint: "deine ★-Seiten" },
	{ id: "recent", label: "Zuletzt", hint: "zuletzt bearbeitete Seiten" },
	{ id: "chats", label: "Chats", hint: "letzte KI-Unterhaltungen" },
	{ id: "lernzeit", label: "Lernzeit", hint: "Wochenziel & Verlauf" },
];
const HOME_LAYOUT_KEY = "impala67HomeLayout";

// Liefert IMMER alle Bereiche: gespeicherte zuerst (in gespeicherter Reihenfolge),
// neue/unbekannte Bereiche hängen sichtbar hinten an — robust gegen App-Updates.
export function homeLayout() {
	let saved = [];
	try { saved = JSON.parse(localStorage.getItem(HOME_LAYOUT_KEY)) || []; } catch { /* Standard */ }
	const known = new Map(HOME_SECTIONS.map((s) => [s.id, s]));
	const out = [];
	for (const e of Array.isArray(saved) ? saved : []) {
		if (e && known.has(e.id)) { out.push({ id: e.id, on: e.on !== false }); known.delete(e.id); }
	}
	for (const s of known.values()) out.push({ id: s.id, on: true });
	return out;
}

const saveHomeLayout = (list) => { try { localStorage.setItem(HOME_LAYOUT_KEY, JSON.stringify(list)); } catch { /* egal */ } };

// Handler-Namen bleiben (DRY): app.js verdrahtet data-dashtoggle/-move/-add bereits —
// nur die Bedeutung ist neu (Ausblenden statt Entfernen, ↺ Standard statt „Hinzufügen“).
export function handleDashboardToggle(id) {
	saveHomeLayout(homeLayout().map((e) => (e.id === id ? { id: e.id, on: !e.on } : e)));
	openSettings("home");
}

export function handleDashboardMove(id, direction) {
	const list = homeLayout();
	const from = list.findIndex((e) => e.id === id);
	const to = from + Number(direction);
	if (from < 0 || to < 0 || to >= list.length) return;
	[list[from], list[to]] = [list[to], list[from]];
	saveHomeLayout(list);
	openSettings("home");
}

export function handleDashboardAdd() {
	localStorage.removeItem(HOME_LAYOUT_KEY);
	U.toast("Home-Layout zurückgesetzt.", "success");
	openSettings("home");
}

// Begrüßungsname speichert sich selbst (Capture-Muster wie telemetrie.js): synct als
// normale Einstellung über Drive — und Umsortieren der Bereiche verwirft keine Eingabe.
document.addEventListener("change", (e) => {
	if (!e.target || e.target.id !== "inpHomeName") return;
	STATE.dispatch("settingsSet", { homeUserName: e.target.value.trim() }).then(() => U.toast("Name gespeichert.", "success"));
});

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
	refreshChatModels,
	paintSettingsModels,
	switchKiTab,
	handleApplyCustomModel,
	testProviderRow,
	testAllProviders,
	handleProviderTest,
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
	homeLayout,
	HOME_SECTIONS,
	handleFileBgChange,
	handleImportChange
};