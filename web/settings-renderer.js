"use strict";

import { S } from "./state.js";
import { U } from "./util.js";
import { DRIVE } from "./drive.js";
import { SETTINGS_SYNC } from "./settings-sync.js";
import { DRIVE_SYNC_INTERVAL_OPTIONS, driveSyncAfterChange, normalizeDriveSyncMinutes } from "./drive-sync-policy.js";
import { SETTINGS_SECTIONS, searchSettings } from "./settings-schema.js";
import { PERF_PROFILER } from "./performance-profiler.js";
import { backupActionState, cloudflareActionState, driveActionState, updateActionState } from "./settings-action-state.js";
import * as UI from "./settings-ui.js";

const e = (value) => U.esc(String(value ?? ""));
const button = (label, id, className = "") => '<button type="button"' + (id ? ' id="' + e(id) + '"' : "") + ' class="' + e(className) + '">' + e(label) + "</button>";
const linkButton = (label, section, anchor) => '<button type="button" class="settings-link" data-settings-go="' + e(section) + '"' + (anchor ? ' data-settings-anchor-target="' + e(anchor) + '"' : "") + '>' + e(label) + UI.icon("chevron") + "</button>";
const switchControl = (id, label, checked) => '<label class="settings-switch"><input id="' + e(id) + '" type="checkbox"' + (checked ? " checked" : "") + ' aria-label="' + e(label) + '"><span aria-hidden="true"></span></label>';

const hasDriveClient = () => !!((window.APP_CONFIG && window.APP_CONFIG.GOOGLE_WEB_CLIENT_ID) || S.settings.driveClientId);
const driveSession = () => DRIVE.status?.() || { connected: !!DRIVE.isConnected?.(), needsLogin: false, email: null };
const cloudflareSession = () => typeof window !== "undefined" && window.CLOUDFLARE_SYNC
	? window.CLOUDFLARE_SYNC.status()
	: { status: "disconnected", url: S.settings.cfUrl || "", syncKey: S.settings.cfSyncKey || "" };
const hasCloudflareConfig = (cf = cloudflareSession()) => !!((cf.url || S.settings.cfUrl) && (cf.syncKey || S.settings.cfSyncKey));

function overviewSyncActions() {
	const drive = driveActionState({ hasClient: hasDriveClient(), ...driveSession() });
	const cfSession = cloudflareSession();
	const cf = cloudflareActionState({ status: cfSession.status, configured: hasCloudflareConfig(cfSession) });
	return [
		{ label: drive.label, id: "btnDrivePrimaryAction", disabled: drive.disabled, data: 'data-settings-sync-action="' + drive.action + '"' },
		{ label: cf.label, id: "btnCfPrimaryAction", disabled: cf.disabled, data: 'data-settings-sync-action="' + cf.action + '"' },
	];
}

function refreshActionButton(id, state) {
	const target = document.getElementById(id);
	if (!target) return;
	target.textContent = state.label;
	target.disabled = !!state.disabled;
	target.dataset.settingsSyncAction = state.action;
}

function driveOverviewRow() {
	const session = driveSession();
	const description = session.connected
		? (session.email ? "Verbunden als " + session.email : "Verbunden")
		: session.needsLogin ? "Anmeldung abgelaufen" : "Nicht verbunden";
	const tone = session.connected ? "ok" : session.needsLogin ? "warn" : "idle";
	return UI.row({ id: "drive-overview-status", title: "Google Drive", description, leading: '<span class="settings-status-dot is-' + tone + '"></span>', trailing: linkButton("Öffnen", "sync", "drive") });
}

function renderOverview(vm) {
	const aiReady = !!(S.settings.aiModel && (S.settings.aiProviders || []).length);
	const notionReady = !!(S.settings.notionToken || S.notionToken);
	const lastBackup = localStorage.getItem("impala67LastBackup");
	const version = vm.version;
	const statusRows = [
		UI.row({ title: "Künstliche Intelligenz", description: aiReady ? S.settings.aiModel : "Noch kein Modell gewählt", leading: '<span class="settings-status-dot is-' + (aiReady ? "ok" : "idle") + '"></span>', trailing: linkButton(aiReady ? "Konfigurieren" : "Einrichten", "ai", "ai-models") }),
		driveOverviewRow(),
		UI.row({ title: "Notion", description: notionReady ? (S.settings.notionLastSync ? "Letzter Sync: " + U.fmtDate(S.settings.notionLastSync) : "Bereit") : "Nicht eingerichtet", leading: '<span class="settings-status-dot is-' + (notionReady ? "ok" : "idle") + '"></span>', trailing: linkButton("Öffnen", "sync", "notion") }),
		UI.row({ title: "Backup", description: lastBackup ? "Zuletzt: " + U.fmtDate(lastBackup) : "Noch kein lokales Backup", leading: '<span class="settings-status-dot is-' + (lastBackup ? "ok" : "warn") + '"></span>', trailing: linkButton("Sichern", "data", "backup") }),
		UI.row({ title: "Lokaler Speicher", description: "Wird berechnet …", leading: '<span class="settings-status-dot is-idle"></span>', trailing: '<span id="settingsStorageOverview" class="settings-value">—</span>' }),
		UI.row({ title: "Impala67", description: "Installierbare Offline-App", leading: '<span class="settings-status-dot is-ok"></span>', trailing: '<span class="settings-value">v' + e(String(version).replace(/^v/i, "")) + "</span>" }),
	].join("");
	const backupAction = backupActionState({ hasBackup: !!lastBackup });
	const updateAction = updateActionState();
	const quick = UI.actions([
		...overviewSyncActions(),
		{ label: backupAction.label, id: "btnExport", live: true },
		{ label: updateAction.label, id: "btnPwaUpdateAction", data: 'data-update-action="' + updateAction.mode + '"', live: true },
	], "settings-quick-actions");
	return UI.page("Übersicht", "Alles Wichtige auf einen Blick – ohne technische Details.",
		UI.group("Status", statusRows, { id: "overview-status" }) + UI.group("Schnellaktionen", quick));
}

function renderGeneral(vm) {
	const rows = vm.homeLayout().map((entry, index, all) => {
		const meta = vm.homeSections.find((item) => item.id === entry.id) || { label: entry.id, hint: "" };
		return '<div class="settings-sort-row' + (entry.on ? "" : " is-disabled") + '" draggable="true" data-dashboard-row="' + e(entry.id) + '">' +
			'<span class="settings-drag" aria-hidden="true">⠿</span><span class="settings-row-copy"><b>' + e(meta.label) + "</b><small>" + e(meta.hint) + "</small></span>" +
			switchControl("dash-" + entry.id, meta.label, entry.on).replace("<input", '<input data-dashtoggle="' + e(entry.id) + '"') +
			'<span class="settings-sort-actions"><button type="button" data-dashmove="' + e(entry.id) + ':-1"' + (index === 0 ? " disabled" : "") + ' aria-label="' + e(meta.label) + ' nach oben">↑</button><button type="button" data-dashmove="' + e(entry.id) + ':1"' + (index === all.length - 1 ? " disabled" : "") + ' aria-label="' + e(meta.label) + ' nach unten">↓</button></span></div>';
	}).join("");
	return UI.page("Allgemein", "Passe Startseite und grundlegendes App-Verhalten an.",
		UI.group("Start", UI.field("Begrüßungsname", "inpHomeName", S.settings.homeUserName || "", { description: "Erscheint nur auf deiner Home-Seite", placeholder: "Optional" }), { id: "home-name" }) +
		UI.group("Home-Bereiche", rows + UI.actions([{ label: "Standard wiederherstellen", data: 'data-dashadd="1"' }]), { id: "home-layout", footnote: "Änderungen gelten sofort auf diesem Gerät. Mit Ziehen oder den Pfeiltasten änderst du die Reihenfolge." }));
}

function renderAppearance(vm) {
	const theme = vm.followSystemTheme ? "system" : vm.theme;
	const accents = [["blue", "Blau"], ["violet", "Violett"], ["green", "Grün"], ["orange", "Orange"]];
	const accentButtons = '<div class="settings-accents" role="group" aria-label="Akzentfarbe">' + accents.map(([value, label]) =>
		'<button type="button" data-accent="' + value + '" class="accent-' + value + (vm.accent === value ? " active" : "") + '" aria-pressed="' + (vm.accent === value) + '"><span></span>' + label + "</button>").join("") + "</div>";
	const design = UI.row({ id: "theme", title: "Erscheinungsbild", description: theme === "system" ? "Folgt automatisch deinem Gerät" : "Manuell festgelegt", trailing: UI.segmented("themeSegments", [
		{ value: "system", label: "System", id: "btnThemeSystem" }, { value: "light", label: "Hell", id: "btnThemeLight" }, { value: "dark", label: "Dunkel", id: "btnThemeDark" },
	], theme, "Erscheinungsbild") }) + UI.row({ id: "accent", title: "Akzentfarbe", description: "Für Auswahl, Fokus und wichtige Aktionen", trailing: accentButtons, className: "is-stacked" });
	const readable = UI.row({ id: "density", title: "Darstellungsdichte", description: "Bestimmt Abstände und Informationsdichte", trailing: UI.segmented("densitySegments", [
		{ value: "compact", label: "Kompakt", id: "btnDensityCompact" }, { value: "comfortable", label: "Komfortabel", id: "btnDensityComfortable" },
	], vm.density, "Darstellungsdichte") }) + UI.row({ id: "font-size", title: "Schriftgröße", description: "Gilt appweit", trailing: UI.segmented("fontSegments", [
		{ value: "s", label: "Klein", id: "btnFontS" }, { value: "m", label: "Normal", id: "btnFontM" }, { value: "l", label: "Groß", id: "btnFontL" },
	], vm.fontSize, "Schriftgröße") }) + UI.row({ id: "motion", title: "Bewegung reduzieren", description: "Weniger Übergänge und Animationen", trailing: switchControl("inpReduceMotion", "Bewegung reduzieren", vm.motion === "reduced") });
	const hasBackground = document.body.classList.contains("has-custom-background");
	const background = UI.row({ id: "background", title: "Eigenes Hintergrundbild", description: hasBackground ? "Eigenes Bild aktiv · bleibt lokal auf diesem Gerät" : "Bleibt lokal auf diesem Gerät", trailing: UI.actions([{ label: hasBackground ? "Bild ändern" : "Bild auswählen", id: "btnPickBg" }, { label: "Entfernen", id: "btnClearBg", className: "secondary", hidden: !hasBackground }]) });
	return UI.page("Darstellung", "Ein ruhiges Erscheinungsbild, das zu deinem Gerät und deinem Lernstil passt.", UI.group("Design", design) + UI.group("Lesbarkeit", readable) + UI.group("Hintergrund", background));
}

function renderAiModels(vm) {
	const providers = S.settings.aiProviders || [];
	const activeId = S.settings.aiProviderId || providers[0]?.id || "";
	const activeModel = S.settings.aiModel || "";
	const activeName = providers.find((provider) => provider.id === activeId)?.name || activeId || "—";
	return UI.group("Aktives Modell", UI.row({ title: activeModel || "Kein Modell gewählt", description: activeModel ? activeName : "Wähle ein verfügbares Chat-Modell", leading: '<span class="settings-status-dot is-' + (activeModel ? "ok" : "warn") + '"></span>', trailing: button("Neu laden", "btnRefreshModels", "secondary") }) +
		'<div class="settings-model-search"><input id="inpModelSearch" type="search" placeholder="Modelle durchsuchen …" autocomplete="off" value="' + e(S.modelQuery || "") + '"><span id="aiModelCount"></span></div><div id="settingsModelList" class="settings-model-list"><div class="menu-note">Lädt …</div></div><p id="settingsModelHint" class="settings-footnote" hidden></p>', { id: "ai-models" }) +
		UI.disclosure("Manuelle Modell-ID", "Nur wenn die Quelle das Modell nicht auflistet", '<div class="settings-inline-fields"><input id="inpCustomModel" type="text" placeholder="Modell-ID" value="' + e(activeModel) + '"><select id="inpCustomModelProv" aria-label="Quelle">' + providers.map((provider) => '<option value="' + e(provider.id) + '"' + (provider.id === activeId ? " selected" : "") + '>' + e(provider.name || provider.id) + "</option>").join("") + '</select>' + button("Übernehmen", "btnApplyCustomModel") + "</div>");
}

function renderAiSources() {
	const providers = S.settings.aiProviders || [];
	const activeId = S.settings.aiProviderId || providers[0]?.id || "";
	const cards = providers.map((provider) => UI.disclosure(provider.name || provider.id, provider.id === activeId ? "Aktive Quelle" : String(provider.base || "").replace(/^https?:\/\//, ""),
		'<div class="provider-card-body" data-provrow="' + e(provider.id) + '">' +
		UI.field("Name", "prov-name-" + provider.id, provider.name, { explicit: true }).replace('id="prov-name-' + e(provider.id) + '"', 'id="prov-name-' + e(provider.id) + '" data-provname="' + e(provider.id) + '"') +
		UI.field("Server-URL", "prov-base-" + provider.id, provider.base, { explicit: true, placeholder: "https://…/v1" }).replace('id="prov-base-' + e(provider.id) + '"', 'id="prov-base-' + e(provider.id) + '" data-provbase="' + e(provider.id) + '"') +
		UI.field("API-Key", "prov-key-" + provider.id, provider.key, { explicit: true, type: "password", autocomplete: "off", placeholder: "Bleibt je nach Token-Sync lokal" }).replace('id="prov-key-' + e(provider.id) + '"', 'id="prov-key-' + e(provider.id) + '" data-provkey="' + e(provider.id) + '"') +
		UI.actions([{ label: "Verbindung testen", data: 'data-provtest="' + e(provider.id) + '"' }, { label: "Entfernen", data: 'data-provdel="' + e(provider.id) + '"', className: "danger-text" }]) + '<p class="provider-status" data-provstatus="' + e(provider.id) + '"></p></div>', provider.id === activeId)).join("");
	return UI.group("KI-Quellen", cards + UI.actions([{ label: "Quelle hinzufügen", id: "btnAddProvider" }, { label: "Cloudflare (Groq)", data: 'data-provpreset="cloudflare"', className: "secondary" }, { label: "LM Studio", data: 'data-provpreset="local"', className: "secondary" }, { label: "Gemini", data: 'data-provpreset="google"', className: "secondary" }, { label: "OpenAI", data: 'data-provpreset="openai"', className: "secondary" }]), { id: "ai-sources", footnote: "Zugangsdaten werden erst mit Speichern übernommen." });
}

function renderLearning(vm) {
	const overlearn = localStorage.getItem("impala67Overlearn") !== "off";
	const conf = localStorage.getItem("impala67Confidence");
	const confidence = !!conf && conf !== "off";
	const telemetry = localStorage.getItem("impala67Telemetry") !== "off";
	const options = UI.row({ title: "Overlearning-Sperre", description: "Verhindert sofortiges Wiederholen frisch bewerteter Karten", trailing: switchControl("inpOverlearn", "Overlearning-Sperre", overlearn) }) +
		UI.row({ title: "Selbsteinschätzung abfragen", description: confidence ? "Du bewertest deine Sicherheit bewusst" : "Die App schätzt Sicherheit aus der Antwortzeit", trailing: switchControl("inpConfidence", "Selbsteinschätzung abfragen", confidence) }) +
		UI.row({ title: "Lokale Lernanalyse", description: "Erzeugt Home-Insights; verlässt dieses Gerät nicht", trailing: switchControl("inpTelemetry", "Lokale Lernanalyse", telemetry) });
	const beta = window.EXP?.settingsHtml ? window.EXP.settingsHtml() : '<div class="settings-empty">Lernmodul nicht geladen.</div>';
	return UI.group("Lernverhalten", options, { id: "learning-options" }) + UI.group("Beta-Lernfunktionen", beta, { id: "learning-beta", footnote: "Beta-Funktionen sind standardmäßig aus und lassen sich einzeln aktivieren." });
}

function renderAi(vm) {
	const tab = S.settingsKiTab === "sources" || S.settingsKiTab === "learning" ? S.settingsKiTab : "models";
	const tabs = '<nav class="settings-subnav" role="tablist" aria-label="KI und Lernen"><button type="button" data-aitab="models" class="' + (tab === "models" ? "active" : "") + '">Modelle</button><button type="button" data-aitab="sources" class="' + (tab === "sources" ? "active" : "") + '">Quellen</button><button type="button" data-aitab="learning" class="' + (tab === "learning" ? "active" : "") + '">Lernen</button></nav>';
	let content = tab === "sources" ? renderAiSources() : tab === "learning" ? renderLearning(vm) : renderAiModels(vm);
	if (tab !== "learning") {
		const isConfigured = S.settings.embedProviderId === "local" && S.settings.embedModel === "local:bekko-a8m";
		const embedStatus = '<div id="ai-embedding" data-settings-anchor>' +
			'<input type="hidden" id="inpEmbed" value="' + (isConfigured ? "local::local:bekko-a8m" : "") + '">' +
			'<div id="localEmbeddingStatus" class="settings-status ' + (isConfigured ? "is-ok" : "is-idle") + '">' +
				'<span class="settings-status-dot"></span>' +
				'<span class="settings-row-copy">' +
					'<b>Semantische Suche (Bekko a8m)</b>' +
					'<small id="localEmbeddingMsg">' +
						(isConfigured ? "Aktiviert · prüfe den lokalen Modell-Cache…" : "Einmaliger Download (~124 MB); danach offline im Browser nutzbar") +
					'</small>' +
					'<div class="progress-bar" id="localEmbeddingProgress" hidden style="margin-top: 6px; height: 5px; background: rgba(255,255,255,0.1); border-radius: 3px; overflow: hidden;"><div class="progress-fill" style="width: 0%; height: 100%; background: var(--accent, #6366f1); transition: width 0.15s ease;"></div></div>' +
				'</span>' +
				'<span id="localEmbeddingActions">' +
					(isConfigured
						? button("Modell löschen", "btnDeleteLocalEmbedding", "secondary danger-text")
						: button("📥 Herunterladen (~124 MB)", "btnDownloadLocalEmbedding", "primary")) +
				'</span>' +
			'</div>' +
		'</div>';

		content += UI.disclosure("Erweitert", "Embedding, Werkzeuge und eigene Anweisungen",
			UI.row({ title: "Tools mitsenden", description: "Stellt der KI die App-Werkzeuge zur Verfügung", trailing: switchControl("inpAlwaysTools", "Tools mitsenden", S.settings.alwaysSendTools !== false) }) +
			embedStatus +
			UI.field("Eigene Anweisungen", "inpCustomInstructions", S.settings.customInstructions || "", { explicit: true, multiline: true, rows: 5, description: "Tonfall, Fach und dauerhafte Vorlieben", placeholder: "Optional" }).replace('class="settings-input-row"', 'class="settings-input-row" id="ai-instructions" data-settings-anchor'));
	}
	return UI.page("KI & Lernen", "Modelle, Zugänge und Lernhilfen – klar getrennt und schnell erreichbar.", tabs + '<div id="aiStatusSettings" class="ai-status-banner"></div>' + content + (tab === "sources" || tab === "models" ? UI.saveBar() : ""));
}

function driveContent() {
	const session = driveSession();
	const action = driveActionState({ hasClient: hasDriveClient(), ...session });
	const tone = session.connected ? "ok" : session.needsLogin || !hasDriveClient() ? "warn" : "idle";
	const title = session.connected ? "Verbunden" : session.needsLogin ? "Anmeldung abgelaufen" : hasDriveClient() ? "Nicht verbunden" : "Einrichtung erforderlich";
	const description = session.connected ? (session.email || "Google Drive") : session.needsLogin ? ((session.email ? session.email + " · " : "") + "Anmeldung beim nächsten Sync erneuern") : hasDriveClient() ? "Google öffnet erst nach deinem Klick ein Anmeldefenster" : "Hinterlege unter Erweitert eine Google Client-ID";
	return UI.status(tone, title, description,
		button(action.label, "btnDrivePrimaryAction") + (session.connected || session.needsLogin ? button("Abmelden", "btnDriveLogout", "secondary") : ""));
}

function cloudflareContent() {
	const cf = cloudflareSession();
	const primary = cloudflareActionState({ status: cf.status, configured: hasCloudflareConfig(cf) });
	const statusType = cf.status === "connected" ? "ok" : cf.status === "syncing" || cf.status === "connecting" ? "warn" : cf.status === "error" ? "error" : "idle";
	const progressHtml = (cf.status === "syncing" && cf.progress && cf.progress.total > 0)
		? '<div style="margin: 8px 0 12px 0; padding: 10px 14px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px;">' +
			'<div style="display:flex; justify-content:space-between; font-size:12px; margin-bottom:6px; color:var(--text-muted, #888); font-weight:500;">' +
				'<span>' + e(cf.progress.label || "Synchronisiere…") + '</span>' +
				'<span>' + cf.progress.percent + ' %</span>' +
			'</div>' +
			'<div style="height: 6px; background: rgba(255,255,255,0.1); border-radius: 3px; overflow: hidden;">' +
				'<div style="width: ' + cf.progress.percent + '%; height: 100%; background: var(--accent, #6366f1); transition: width 0.15s ease;"></div>' +
			'</div>' +
		'</div>'
		: "";
	return UI.status(statusType, cf.label || "Nicht verbunden", cf.detail || "Echtzeit-Synchronisierung über WebSockets mit Ende-zu-Ende-Verschlüsselung",
		'<button type="button" id="btnCfPrimaryAction"' + (primary.disabled ? " disabled" : "") + ' aria-live="polite">' + e(primary.label) + "</button>" +
		(cf.status === "connected" || cf.status === "connecting" ? button("Trennen", "btnCfDisconnect", "secondary") : "")
	) +
	progressHtml +
	UI.field("Cloudflare Worker URL", "inpCfUrl", cf.url || "", { explicit: true, placeholder: "https://impala67-sync.<account>.workers.dev" }) +
	UI.field("Sync-Schlüssel (E2EE)", "inpCfKey", cf.syncKey || "", { explicit: true, type: "password", placeholder: "impala-xxxx-xxxx-xxxx-xxxx" }) +
	UI.actions([
		{ label: "📱 Gerät koppeln (QR-Code)", id: "btnCfPairing", className: "secondary", hidden: !hasCloudflareConfig(cf) },
		{ label: "Schlüssel generieren", id: "btnCfGenKey", className: "secondary", hidden: !!(cf.syncKey || S.settings.cfSyncKey) },
		{ label: "Schlüssel kopieren", id: "btnCfCopyKey", className: "secondary", hidden: !(cf.syncKey || S.settings.cfSyncKey) },
	]) +
	UI.row({ title: "Cloud-Speicher (" + (cf.usage?.mbLimit || 1000) + " MB Limit)", description: "Verwendeter Speicherplatz auf deinem Cloudflare Sync-Server", trailing: '<span id="cfStorageValue" class="settings-value">' + e(cf.usage?.formatted || ("0.0 MB / " + (cf.usage?.mbLimit || 1000) + " MB (0 %)")) + '</span>' }) +
	(hasCloudflareConfig(cf) ? UI.row({ title: "Cloud-Daten löschen", description: "Löscht den synchronisierten Datenstand auf dem Cloudflare-Server", trailing: button("Cloud-Stand leeren", "btnCfPurge", "danger") }) : "");
}

function renderSync() {
	const notionReady = !!(S.settings.notionToken || S.notionToken);
	const notion = UI.status(notionReady ? "ok" : "idle", notionReady ? "Bereit" : "Nicht eingerichtet", S.settings.notionLastSync ? "Letzter Sync: " + U.fmtDate(S.settings.notionLastSync) : "Token und optional eine Wurzelseite hinterlegen") +
		UI.field("Integration-Token", "inpNotionToken", S.settings.notionToken || S.notionToken || "", { explicit: true, type: "password", autocomplete: "off", placeholder: "secret_…" }) +
		UI.field("Wurzelseiten-ID", "inpNotionPage", S.settings.notionPageId || S.notionPageId || "", { explicit: true, placeholder: "Leer = alle freigegebenen Seiten" }) +
		UI.actions([{ label: "Einmalig importieren", id: "btnMigrateNotion" }, { label: "Zwei-Wege-Sync", id: "btnNotionSync" }, { label: "Abbrechen", id: "btnNotionCancel", className: "danger-text", hidden: true }]) + '<div class="progress-bar" id="notionProgress" hidden><div class="progress-fill"></div></div><p class="settings-footnote" id="notionStatus"></p>';
	const privacy = UI.row({ id: "token-sync", title: "Tokens über Drive synchronisieren", description: SETTINGS_SYNC.allowsSecrets(S.settings) ? "KI-Keys und Notion-Token werden an deine eigenen Geräte übertragen" : "Tokens bleiben ausschließlich auf diesem Gerät", leading: '<span class="settings-privacy-icon">⌾</span>', trailing: switchControl("inpSyncSecrets", "Tokens über Drive synchronisieren", SETTINGS_SYNC.allowsSecrets(S.settings)) });
	const syncMinutes = normalizeDriveSyncMinutes(S.settings);
	const intervalOptions = DRIVE_SYNC_INTERVAL_OPTIONS.map(({ value, label }) => '<option value="' + value + '"' + (value === syncMinutes ? " selected" : "") + '>' + e(label) + "</option>").join("");
	const automation = UI.row({ title: "Sync-Intervall", description: "Holt und sichert Daten regelmäßig, solange die App geöffnet ist", trailing: '<select id="inpDriveAutoSyncMinutes" aria-label="Intervall für automatische Synchronisierung">' + intervalOptions + "</select>" }) +
		UI.row({ title: "Nach jeder Änderung synchronisieren", description: "Sichert Änderungen nach kurzer Bündelung zusätzlich zum Intervall", trailing: switchControl("inpDriveSyncAfterChange", "Nach jeder Änderung synchronisieren", driveSyncAfterChange(S.settings)) });
	const advanced = UI.field("Google Client-ID", "inpDrive", S.settings.driveClientId || "", { explicit: true, placeholder: "OAuth-Webclient-ID" }) + UI.field("Eigener Notion-Proxy", "inpCorsProxy", S.settings.corsProxy || "", { explicit: true, placeholder: "Leer = sicherer Impala67-Worker" });
	return UI.page("Sync & Dienste", "Verbinde nur die Dienste, die du wirklich nutzt.",
		UI.group("Cloudflare Echtzeit-Sync", '<div id="cf-connection-status">' + cloudflareContent() + "</div>", { id: "cf-sync", footnote: "100 % Ende-zu-Ende verschlüsselt (AES-GCM 256-Bit). Der Server sieht niemals Klartext-Notizen." }) +
		UI.group("Google Drive (Backup & Langzeitspeicher)", '<div id="drive-connection-status">' + driveContent() + "</div>", { id: "drive", footnote: "Drive verwendet den privaten App-Speicher. OAuth-Zugriffstokens bleiben immer gerätelokal." }) +
		UI.group("Automatische Synchronisierung", automation, { id: "drive-automation", footnote: "Tipp: Bei aktivem Cloudflare-Sync reicht das tägliche Backup-Intervall völlig aus." }) +
		UI.group("Datenschutz", privacy) +
		UI.group("Notion", notion, { id: "notion" }) +
		UI.disclosure("Erweitert", "Client-ID und Verbindungsdetails", '<div id="sync-advanced" data-settings-anchor>' + advanced + "</div>") +
		UI.saveBar());
}

export function refreshDriveStatusUi() {
	const overview = document.getElementById("drive-overview-status");
	if (overview) overview.outerHTML = driveOverviewRow();
	const connection = document.getElementById("drive-connection-status");
	if (connection) connection.innerHTML = driveContent();
	refreshActionButton("btnDrivePrimaryAction", driveActionState({ hasClient: hasDriveClient(), ...driveSession() }));
}

export function refreshCloudflareStatusUi() {
	const connection = document.getElementById("cf-connection-status");
	if (connection) connection.innerHTML = cloudflareContent();
	const cf = cloudflareSession();
	refreshActionButton("btnCfPrimaryAction", cloudflareActionState({ status: cf.status, configured: hasCloudflareConfig(cf) }));
}

function renderData(vm) {
	const backupAction = backupActionState({ hasBackup: !!localStorage.getItem("impala67LastBackup") });
	const backup = UI.row({ title: "Vollständiges Backup", description: "Event-Log und Dateien als JSON", trailing: UI.actions([{ label: backupAction.label, id: "btnExport", live: true }, { label: "Importieren", id: "btnImport", className: "secondary" }]) });
	const exports = UI.row({ title: "Lerndaten", description: "Lokale Telemetrie als JSON", trailing: button("Exportieren", "btnTeleExport", "secondary") }) + UI.row({ title: "Workspace als Markdown", description: "Seitenbaum als Markdown-ZIP", trailing: '<span class="settings-workspace-actions">' + Object.values(S.workspaces).map((workspace) => '<button type="button" data-zipws="' + e(workspace.id) + '">' + e(workspace.name) + "</button>").join("") + "</span>" });
	const storage = UI.row({ title: "Verwendeter Speicher", description: "IndexedDB, PDFs, Bilder und Offline-Daten", trailing: '<span id="settingsStorageValue" class="settings-value">Wird berechnet …</span>' });
	const updateAction = updateActionState();
	const update = UI.row({ title: "Installierte Version", description: "PWA / Browser", trailing: '<span id="updateLocalVer" class="settings-value">v' + e(String(vm.version).replace(/^v/i, "")) + "</span>" }) + UI.row({ title: "Verfügbare Version", description: "Wird nur auf Wunsch geprüft", trailing: '<span id="updateRemoteVer" class="settings-value">—</span>' }) + UI.actions([{ label: updateAction.label, id: "btnPwaUpdateAction", data: 'data-update-action="' + updateAction.mode + '"', live: true }]) + '<p class="settings-footnote" id="updateStatus" aria-live="polite"></p>';
	const perf = PERF_PROFILER.status();
	const diagnostics = UI.row({ title: "Performance-Profiler", description: perf.enabled ? (perf.records + " lokale Messpunkte gesammelt") : "Protokolliert Hänger, langsame Eingaben, Render- und Sync-Phasen", trailing: switchControl("inpPerformanceProfiler", "Performance-Profiler aktivieren", perf.enabled) }) +
		(perf.records ? UI.actions([{ label: "Diagnose kopieren", id: "btnPerfCopy" }, { label: "JSON exportieren", id: "btnPerfExport", className: "secondary" }, { label: "Protokoll löschen", id: "btnPerfClear", className: "secondary" }]) : "") +
		'<p class="settings-footnote">Bleibt vollständig auf diesem Gerät. Erfasst Zeitpunkte, Dauer, Ansichts- und Mengendaten – niemals Notizinhalte, Eingaben oder Zugangsdaten.</p>';
	const danger = UI.row({ title: "Alle lokalen Seiten löschen", description: "Einstellungen, API-Keys und Karteikarten bleiben erhalten", trailing: button("Seiten löschen", "btnResetAll", "danger") });
	return UI.page("Daten & App", "Sichere deine Daten, kontrolliere Speicher und halte die App aktuell.", UI.group("Backup & Wiederherstellung", backup, { id: "backup", footnote: "Importe werden konfliktfrei mit dem vorhandenen Event-Log zusammengeführt." }) + UI.group("Weitere Exporte", exports, { id: "data-export" }) + UI.group("Lokaler Speicher", storage, { id: "storage" }) + UI.group("Performance-Diagnose", diagnostics, { id: "performance-profiler" }) + UI.group("App-Updates", update, { id: "updates" }) + UI.group("Gefahrenzone", danger, { id: "danger-zone", danger: true }));
}

function renderDevices() {
	const content = window.CONTROLLER?.settingsHtml ? window.CONTROLLER.settingsHtml() : '<div class="settings-empty">Controller-Modul nicht geladen.</div>';
	return UI.page("Geräte & Bedienung", "Nutze Controller, ohne eine zweite Lernlogik oder komplizierte Einrichtung.", content);
}

function renderMobileOverview(vm) {
	const aiReady = !!(S.settings.aiModel && (S.settings.aiProviders || []).length);
	const cf = cloudflareSession();
	const cfReady = cf.status === "connected";
	const drive = driveSession();
	const syncText = cfReady ? "Cloudflare Live-Sync aktiv" : (drive.connected ? "Google Drive verbunden" : "Nicht eingerichtet");
	const syncBadge = cfReady ? "Live" : (drive.connected ? "Drive" : "");
	const version = vm.version;

	const sections = [
		{ id: "sync", title: "Synchronisation & Cloud", desc: syncText, icon: "sync", badge: syncBadge },
		{ id: "appearance", title: "Erscheinungsbild", desc: (vm.followSystemTheme ? "System" : vm.theme === "light" ? "Hell" : "Dunkel") + " · " + (vm.accent || "Blau"), icon: "appearance" },
		{ id: "ai", title: "Künstliche Intelligenz", desc: aiReady ? S.settings.aiModel : "Kein Modell gewählt", icon: "sparkles", badge: aiReady ? "Bereit" : "Einrichten" },
		{ id: "general", title: "Startseite & Bereiche", desc: "Home-Bereiche anpassen", icon: "sliders" },
		{ id: "data", title: "Speicher & Backup", desc: "Lokaler Speicher, Export & Updates", icon: "archive" },
	];

	const sectionRows = sections.map((sec) =>
		'<button type="button" class="settings-mobile-row" data-settings-go="' + e(sec.id) + '">' +
			'<span class="settings-nav-icon">' + UI.icon(sec.icon) + '</span>' +
			'<span class="settings-row-copy"><b>' + e(sec.title) + '</b><small>' + e(sec.desc) + '</small></span>' +
			(sec.badge ? '<span class="settings-pill-badge">' + e(sec.badge) + '</span>' : '') +
			UI.icon("chevron") +
		'</button>'
	).join("");

	const backupAction = backupActionState({ hasBackup: !!localStorage.getItem("impala67LastBackup") });
	const updateAction = updateActionState();
	const quick = UI.actions([
		...overviewSyncActions(),
		{ label: backupAction.label, id: "btnExport", live: true },
		{ label: updateAction.label, id: "btnPwaUpdateAction", data: 'data-update-action="' + updateAction.mode + '"', live: true },
	], "settings-quick-actions");

	const appInfo = '<div class="settings-mobile-footer">' +
		'<span>Impala67 v' + e(String(version).replace(/^v/i, "")) + ' · Offline-PWA</span>' +
	'</div>';

	return '<div class="settings-mobile-hub">' +
		'<div class="settings-group-card mobile-nav-card">' + sectionRows + '</div>' +
		UI.group("Schnellaktionen", quick) +
		appInfo +
	'</div>';
}

export function renderSettingsPage(section, vm) {
	const isMobile = document.body.classList.contains("mobile-ui");
	if (isMobile && (!section || section === "overview")) return renderMobileOverview(vm);
	if (section === "general") return renderGeneral(vm);
	if (section === "appearance") return renderAppearance(vm);
	if (section === "ai") return renderAi(vm);
	if (section === "sync") return renderSync();
	if (section === "data") return renderData(vm);
	if (section === "devices") return renderDevices();
	return renderOverview(vm);
}

export function renderSettingsShell(section, body, query = "") {
	const isMobile = document.body.classList.contains("mobile-ui");
	if (isMobile) {
		const isOverview = !section || section === "overview";
		const secMeta = SETTINGS_SECTIONS.find(s => s.id === section) || { label: "Einstellungen" };
		const head = isOverview
			? '<header class="settings-mobile-head"><h1>Einstellungen</h1><button type="button" class="settings-mobile-done" id="btnCloseSettings">Fertig</button></header>'
			: '<header class="settings-mobile-head"><button type="button" class="settings-mobile-back" data-settings-go="overview">‹ Zurück</button><h2>' + e(secMeta.label) + '</h2><button type="button" class="settings-mobile-done" id="btnCloseSettings">Fertig</button></header>';

		const searchBar = isOverview
			? '<label class="settings-search">' + UI.icon("search") + '<input id="settingsSearch" type="search" autocomplete="off" placeholder="Einstellungen suchen…" value="' + e(query) + '" aria-label="Einstellungen durchsuchen"></label><div id="settingsSearchResults" class="settings-search-results" hidden></div>'
			: '';

		return '<div class="modal settings-modal-v2 is-mobile" data-sec="' + e(section) + '">' +
			head +
			'<main class="settings-main" tabindex="-1">' +
			searchBar +
			body +
			'</main></div>';
	}
	const nav = SETTINGS_SECTIONS.map((entry) => '<button type="button" class="settings-nav-item' + (entry.id === section ? " active" : "") + '" data-settings-go="' + entry.id + '" aria-current="' + (entry.id === section ? "page" : "false") + '"><span class="settings-nav-icon">' + UI.icon(entry.icon) + '</span><span>' + e(entry.label) + "</span></button>").join("");
	return '<div class="modal settings-modal-v2" data-sec="' + e(section) + '"><button class="modal-x" id="btnCloseSettings" title="Einstellungen schließen" aria-label="Einstellungen schließen">×</button><aside class="settings-sidebar"><div class="settings-sidebar-title">Einstellungen</div><label class="settings-search">' + UI.icon("search") + '<input id="settingsSearch" type="search" autocomplete="off" placeholder="Suchen" value="' + e(query) + '" aria-label="Einstellungen durchsuchen"><kbd>⌘ K</kbd></label><div id="settingsSearchResults" class="settings-search-results" hidden></div><nav aria-label="Einstellungsbereiche">' + nav + '</nav></aside><main class="settings-main" tabindex="-1">' + body + "</main></div>";
}

export function renderSearchResults(query) {
	const results = searchSettings(query);
	if (!query.trim()) return "";
	if (!results.length) return '<div class="settings-search-empty">Keine Einstellung gefunden</div>';
	return results.map((item) => '<button type="button" data-settings-go="' + e(item.section) + '" data-settings-anchor-target="' + e(item.id) + '"><span><b>' + e(item.label) + "</b><small>" + e(item.sectionLabel) + " · " + e(item.description) + "</small></span>" + UI.icon("chevron") + "</button>").join("");
}

export async function hydrateStorageUsage() {
	const targets = [document.getElementById("settingsStorageValue"), document.getElementById("settingsStorageOverview")].filter(Boolean);
	if (!targets.length) return;
	let text = "Nicht verfügbar";
	try {
		const estimate = await navigator.storage?.estimate?.();
		if (estimate) {
			const mb = (estimate.usage || 0) / 1048576;
			const quota = (estimate.quota || 0) / 1073741824;
			text = mb < 1 ? "< 1 MB" : mb.toFixed(mb < 10 ? 1 : 0) + " MB";
			if (quota) text += " von " + quota.toFixed(1) + " GB";
		}
	} catch { /* Anzeige bleibt neutral */ }
	targets.forEach((target) => { target.textContent = text; });
}
