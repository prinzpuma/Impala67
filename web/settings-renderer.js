"use strict";

import { S } from "./state.js";
import { U } from "./util.js";
import { DRIVE } from "./drive.js";
import { BACKUP } from "./backup-status.js";
import { CHATS } from "./chats.js";
import { SETTINGS_SYNC } from "./settings-sync.js";
import { DRIVE_SYNC_INTERVAL_OPTIONS, driveSyncAfterChange, normalizeDriveSyncMinutes } from "./drive-sync-policy.js";
import { SETTINGS_SECTIONS, searchSettings } from "./settings-schema.js";
import { PERF_PROFILER } from "./performance-profiler.js";
import { isLocalDev, mcpBridgeEnabled } from "./mcp-bridge-flag.js";
import { PLATFORM_NATIVE } from "./platform-native.js";
import { HANDSCHRIFT } from "./handschrift.js";
import { HEFT_INDEX_PROGRESS } from "./heft-index-progress.js";
import { backupActionState, cloudflareActionState, driveActionState, updateActionState } from "./settings-action-state.js";
import * as UI from "./settings-ui.js";
import { LOCAL_EMBED_MODEL_ID } from "./embedding.js";
import { lead } from "./icons.js";

const e = (value) => U.esc(String(value ?? ""));
const button = (label, id, className = "", disabled = false, ic = "") => '<button type="button"' + (id ? ' id="' + e(id) + '"' : "") + ' class="' + e(className) + '"' + (disabled ? " disabled" : "") + '>' + (ic ? lead(ic) : "") + e(label) + "</button>";
const linkButton = (label, section, anchor) => '<button type="button" class="settings-link" data-settings-go="' + e(section) + '"' + (anchor ? ' data-settings-anchor-target="' + e(anchor) + '"' : "") + '>' + e(label) + UI.icon("chevron") + "</button>";
const switchControl = (id, label, checked) => '<label class="settings-switch"><input id="' + e(id) + '" type="checkbox"' + (checked ? " checked" : "") + ' aria-label="' + e(label) + '"><span aria-hidden="true"></span></label>';
const statusDot = (tone) => '<span class="settings-status-dot is-' + tone + '"></span>';
const plainVersion = (version) => String(version).replace(/^v/i, "");
const updateButton = () => {
	const state = updateActionState();
	return '<button type="button" id="btnPwaUpdateAction" data-update-action="' + e(state.mode) + '" aria-live="polite">' + e(state.label) + "</button>";
};

const hasDriveClient = () => !!((window.APP_CONFIG && window.APP_CONFIG.GOOGLE_WEB_CLIENT_ID) || S.settings.driveClientId);
const driveSession = () => DRIVE.status?.() || { connected: !!DRIVE.isConnected?.(), needsLogin: false, email: null };
const cloudflareSession = () => typeof window !== "undefined" && window.CLOUDFLARE_SYNC
	? window.CLOUDFLARE_SYNC.status()
	: { status: "disconnected", url: S.settings.cfUrl || "", syncKey: S.settings.cfSyncKey || "" };
const hasCloudflareConfig = (cf = cloudflareSession()) => !!((cf.url || S.settings.cfUrl) && (cf.syncKey || S.settings.cfSyncKey));

// Abgelaufene Google-Anmeldung ist der Normalfall (Web-Token hält eine Stunde). Gewarnt wird erst,
// wenn backup-status.js wirklich Ungesichertes meldet, das älter als einen Tag ist.
const backupTone = () => (BACKUP.view().level === "stale" ? "warn" : "idle");
const driveLastOk = (session) => (session.lastOkAt ? "Zuletzt gesichert " + U.fmtDate(session.lastOkAt) : "Pausiert");

// Ein lokaler Export ist nur dringend, wenn kein Sync die Daten schon vom Gerät holt.
const localBackupTone = () => (BACKUP.view().cloudflare || BACKUP.view().drive ? "idle" : "warn");

// ---------- Übersicht: eine Kachel je Bereich, jede mit genau einer Aktion ----------
// Cloudflare hat Vorrang vor Drive, weil es live synchronisiert.
function syncOverviewRow() {
	const cf = cloudflareSession();
	const drive = driveSession();
	const [tone, description] = ["connected", "syncing", "connecting"].includes(cf.status) ? ["ok", "Cloudflare Live-Sync aktiv"]
		: drive.connected ? ["ok", drive.email ? "Google Drive · " + drive.email : "Google Drive verbunden"]
			: drive.needsLogin ? [backupTone(), "Google Drive · " + driveLastOk(drive)]
				: ["idle", "Noch nicht eingerichtet"];
	return UI.row({ id: "sync-overview-status", title: "Sync", description, leading: statusDot(tone), trailing: linkButton(description.startsWith("Noch") ? "Einrichten" : "Verwalten", "sync") });
}

function overviewTiles(vm) {
	const providers = S.settings.aiProviders || [];
	const activeProvider = providers.find((provider) => provider.id === S.settings.aiProviderId) || providers[0];
	const aiReady = !!(S.settings.aiModel && activeProvider);
	const lastBackup = localStorage.getItem("impala67LastBackup");
	const backupAction = backupActionState({ hasBackup: !!lastBackup });
	const storageMeter = '<span class="settings-meter" aria-hidden="true"><span id="settingsStorageBar"></span></span>';
	return [
		UI.row({ title: "KI", description: aiReady ? activeProvider.name || activeProvider.id : "Noch kein Modell gewählt", leading: statusDot(aiReady ? "ok" : "idle"), trailing: linkButton(aiReady ? "Konfigurieren" : "Einrichten", "ai", "ai-models") }),
		syncOverviewRow(),
		UI.row({ title: "Backup", description: lastBackup ? "Zuletzt " + U.fmtDate(lastBackup) : "Noch kein lokales Backup", leading: statusDot(lastBackup ? "ok" : localBackupTone()), trailing: button(backupAction.label, "btnExport") }),
		UI.row({ title: "Speicher", description: "Wird berechnet …", descriptionId: "settingsStorageOverview", extra: storageMeter, leading: statusDot("idle"), trailing: linkButton("Verwalten", "app", "storage") }),
		UI.row({ title: "App-Version", description: "v" + plainVersion(vm.version) + " · Offline-App", leading: statusDot("ok"), trailing: updateButton() }),
	].join("");
}

function renderOverview(vm) {
	return UI.page("Übersicht", "Alles Wichtige auf einen Blick – ohne technische Details.", UI.group("Status", overviewTiles(vm), { id: "overview-status" }));
}

// Mobile: Bereichsliste als Einstieg, darunter dieselben Status-Kacheln wie am Desktop.
function renderMobileOverview(vm) {
	const rows = SETTINGS_SECTIONS.filter((sec) => sec.id !== "overview").map((sec) =>
		'<button type="button" class="settings-mobile-row" data-settings-go="' + e(sec.id) + '">' +
			'<span class="settings-nav-icon">' + UI.icon(sec.icon) + '</span>' +
			'<span class="settings-row-copy"><b>' + e(sec.label) + '</b><small>' + e(sec.description) + '</small></span>' +
			UI.icon("chevron") +
		'</button>').join("");
	return '<div class="settings-mobile-hub"><div class="settings-group-card">' + rows + '</div>' + UI.group("Status", overviewTiles(vm), { id: "overview-status" }) + '</div>';
}

// ---------- Darstellung ----------
function renderAppearance(vm) {
	const theme = vm.followSystemTheme ? "system" : vm.theme;
	const accents = [["blue", "Blau"], ["violet", "Violett"], ["green", "Grün"], ["orange", "Orange"]];
	const accentButtons = '<div class="settings-accents" role="group" aria-label="Akzentfarbe">' + accents.map(([value, label]) =>
		'<button type="button" data-accent="' + value + '" class="accent-' + value + (vm.accent === value ? " active" : "") + '" aria-pressed="' + (vm.accent === value) + '" aria-label="' + label + '" title="' + label + '"></button>').join("") + "</div>";
	const design = UI.row({ id: "theme", title: "Erscheinungsbild", description: theme === "system" ? "Folgt automatisch deinem Gerät" : "Manuell festgelegt", trailing: UI.segmented("themeSegments", [
		{ value: "system", label: "System", id: "btnThemeSystem" }, { value: "light", label: "Hell", id: "btnThemeLight" }, { value: "dark", label: "Dunkel", id: "btnThemeDark" },
	], theme, "Erscheinungsbild") }) +
		UI.row({ id: "accent", title: "Akzentfarbe", description: "Für Auswahl, Fokus und wichtige Aktionen", trailing: accentButtons }) +
		UI.row({ id: "density", title: "Darstellungsdichte", description: "Bestimmt Abstände und Informationsdichte", trailing: UI.segmented("densitySegments", [
			{ value: "compact", label: "Kompakt", id: "btnDensityCompact" }, { value: "comfortable", label: "Komfortabel", id: "btnDensityComfortable" },
		], vm.density, "Darstellungsdichte") });
	const readable = UI.row({ id: "font-size", title: "Schriftgröße", description: "Gilt appweit", trailing: UI.segmented("fontSegments", [
		{ value: "s", label: "Klein", id: "btnFontS" }, { value: "m", label: "Normal", id: "btnFontM" }, { value: "l", label: "Groß", id: "btnFontL" },
	], vm.fontSize, "Schriftgröße") }) +
		UI.row({ id: "motion", title: "Performance-Modus", description: "Für ältere Geräte: ohne Animationen und Milchglas-Effekte", trailing: switchControl("inpReduceMotion", "Performance-Modus", vm.motion === "reduced") }) +
		(vm.isNative ? UI.row({ id: "native-haptics", title: "Haptisches Feedback", description: "Taktile Vibrationen bei Aktionen, Werkzeugwechsel und Bewertungen", trailing: switchControl("inpNativeHaptics", "Haptisches Feedback", vm.nativeHapticsEnabled) }) : "");
	const surface = UI.row({ id: "tabs-position", title: "Tab-Anordnung", description: vm.tabsPosition === "sidebar" ? "Vertikale Tabs in der linken Seitenleiste" : "Horizontale Leiste oben (Standard)", trailing: UI.segmented("tabsSegments", [
		{ value: "top", label: "Oben", id: "btnTabsTop" }, { value: "sidebar", label: "Seitenleiste", id: "btnTabsSidebar" },
	], vm.tabsPosition || "top", "Tab-Anordnung") }) +
		UI.field("Begrüßungsname", "inpHomeName", S.settings.homeUserName || "", { anchor: "home-name", description: "Erscheint in der Begrüßung auf der Startseite", placeholder: "Optional" });
	return UI.page("Darstellung", "Ein ruhiges Erscheinungsbild, das zu deinem Gerät und deinem Lernstil passt.",
		UI.group("Design", design) + UI.group("Lesbarkeit", readable) + UI.group("Oberfläche", surface));
}

// ---------- KI: alles auf einer Seite ----------
function aiModelsGroup() {
	const providers = S.settings.aiProviders || [];
	const activeId = S.settings.aiProviderId || providers[0]?.id || "";
	const activeModel = S.settings.aiModel || "";
	const activeName = providers.find((provider) => provider.id === activeId)?.name || activeId || "—";
	return UI.group("Aktives Modell", UI.row({ title: activeModel || "Kein Modell gewählt", description: activeModel ? activeName : "Wähle ein verfügbares Chat-Modell", leading: statusDot(activeModel ? "ok" : "warn"), trailing: button("Neu laden", "btnRefreshModels", "secondary") }) +
		'<div class="settings-model-search"><input id="inpModelSearch" type="search" placeholder="Modelle durchsuchen …" autocomplete="off" value="' + e(S.modelQuery || "") + '"><span id="aiModelCount"></span></div><div id="settingsModelList" class="settings-model-list"><div class="menu-note">Lädt …</div></div><p id="settingsModelHint" class="settings-footnote" hidden></p>', { id: "ai-models" }) +
		UI.disclosure("Manuelle Modell-ID", "Nur wenn die Quelle das Modell nicht auflistet", '<div class="settings-inline-fields"><input id="inpCustomModel" type="text" placeholder="Modell-ID" value="' + e(activeModel) + '"><select id="inpCustomModelProv" aria-label="Quelle">' + providers.map((provider) => '<option value="' + e(provider.id) + '"' + (provider.id === activeId ? " selected" : "") + '>' + e(provider.name || provider.id) + "</option>").join("") + '</select>' + button("Übernehmen", "btnApplyCustomModel") + "</div>");
}

function aiSourcesGroup() {
	const providers = S.settings.aiProviders || [];
	const activeId = S.settings.aiProviderId || providers[0]?.id || "";
	const cards = providers.map((provider) => UI.disclosure(provider.name || provider.id, provider.id === activeId ? "Aktive Quelle" : String(provider.base || "").replace(/^https?:\/\//, ""),
		'<div class="provider-card-body" data-provrow="' + e(provider.id) + '">' +
		UI.field("Name", "prov-name-" + provider.id, provider.name, { explicit: true }).replace('id="prov-name-' + e(provider.id) + '"', 'id="prov-name-' + e(provider.id) + '" data-provname="' + e(provider.id) + '"') +
		UI.field("Server-URL", "prov-base-" + provider.id, provider.base, { explicit: true, placeholder: "https://…/v1" }).replace('id="prov-base-' + e(provider.id) + '"', 'id="prov-base-' + e(provider.id) + '" data-provbase="' + e(provider.id) + '"') +
		UI.field("API-Key", "prov-key-" + provider.id, provider.key, { explicit: true, type: "password", autocomplete: "off", placeholder: "Bleibt je nach Token-Sync lokal" }).replace('id="prov-key-' + e(provider.id) + '"', 'id="prov-key-' + e(provider.id) + '" data-provkey="' + e(provider.id) + '"') +
		UI.actions([{ label: "Verbindung testen", data: 'data-provtest="' + e(provider.id) + '"' }, { label: "Entfernen", data: 'data-provdel="' + e(provider.id) + '"', className: "danger-text" }]) + '<p class="provider-status" data-provstatus="' + e(provider.id) + '"></p></div>', provider.id === activeId)).join("");
	return UI.group("Quellen", cards + UI.actions([{ label: "Quelle hinzufügen", id: "btnAddProvider" }, { label: "Impala AI", data: 'data-provpreset="cloudflare"', className: "secondary" }, { label: "LM Studio", data: 'data-provpreset="local"', className: "secondary" }, { label: "Gemini", data: 'data-provpreset="google"', className: "secondary" }, { label: "OpenAI", data: 'data-provpreset="openai"', className: "secondary" }]), { id: "ai-sources", footnote: "Zugangsdaten werden erst mit Speichern übernommen." });
}

function localAiGroup() {
	const isConfigured = S.settings.embedProviderId === "local" && S.settings.embedModel === LOCAL_EMBED_MODEL_ID;
	const embedStatus = '<div id="ai-embedding" data-settings-anchor>' +
		'<input type="hidden" id="inpEmbed" value="' + (isConfigured ? "local::" + LOCAL_EMBED_MODEL_ID : "") + '">' +
		'<div id="localEmbeddingStatus" class="settings-status ' + (isConfigured ? "is-ok" : "is-idle") + '">' +
			'<span class="settings-status-dot"></span>' +
			'<span class="settings-row-copy">' +
				'<b>Semantische Suche (Bekko a8m)</b>' +
				'<small id="localEmbeddingMsg">' +
					(isConfigured ? "Aktiviert · prüfe den lokalen Modell-Cache…" : "Einmaliger Download (ca. 165 MB); danach offline im Browser nutzbar") +
				'</small>' +
				'<div class="progress-bar" id="localEmbeddingProgress" hidden style="margin-top: 6px; height: 5px; background: rgba(255,255,255,0.1); border-radius: 3px; overflow: hidden;"><div class="progress-fill" style="width: 0%; height: 100%; background: var(--accent, #6366f1); transition: width 0.15s ease;"></div></div>' +
			'</span>' +
			'<span id="localEmbeddingActions">' +
				(isConfigured
					? button("Modell löschen", "btnDeleteLocalEmbedding", "secondary danger-text")
					: button("Herunterladen (ca. 165 MB)", "btnDownloadLocalEmbedding", "primary", false, "download")) +
			'</span>' +
		'</div>' +
	'</div>';

	const samplesCount = (HANDSCHRIFT.getTrainingSamples ? HANDSCHRIFT.getTrainingSamples().length : 0);
	const handwritingStatus = '<div id="ai-handwriting" data-settings-anchor>' +
		'<div class="settings-status is-ok">' +
			'<span class="settings-status-dot"></span>' +
			'<span class="settings-row-copy">' +
				'<b>Handschrifterkennung (Digital Ink)</b>' +
				'<small>' +
					'100 % lokal (ONNX Runtime Web, ca. 10 MB) · ' + (samplesCount > 0 ? samplesCount + ' Trainingsbeispiele gesammelt' : 'Noch keine eigenen Trainingsbeispiele') +
				'</small>' +
				'<small id="handwritingProgress">' + U.esc(HEFT_INDEX_PROGRESS.label()) + '</small>' +
				'<small>Modell auf Basis von de-htr-web-v2 (naeyn, Apache-2.0); Trainingsdaten: ScaDS.AI German Handwriting (CC BY 4.0), fhswf/german_handwriting (AFL-3.0), Google MathWriting (CC BY 4.0)</small>' +
			'</span>' +
			'<span id="handwritingActions">' +
				button("Abschreiben", "btnOpenAbschreiben", "secondary", false, "pen") + ' ' +
				button("Alle Handschrift exportieren", "btnExportAllInk", "secondary", false, "upload") + ' ' +
				(samplesCount > 0
					? button("Exportieren", "btnExportHandwritingSamples", "secondary", false, "upload") + ' ' + button("Leeren", "btnClearHandwritingSamples", "secondary danger-text", false, "trash")
					: '') +
			'</span>' +
		'</div>' +
	'</div>';
	return UI.group("Lokale KI", embedStatus + handwritingStatus, { footnote: "Beide Modelle laufen direkt im Browser; deine Inhalte verlassen dafür das Gerät nicht." });
}

function renderAi() {
	const behavior = UI.row({ id: "ai-tools", title: "Tools mitsenden", description: "Stellt der KI die App-Werkzeuge zur Verfügung", trailing: switchControl("inpAlwaysTools", "Tools mitsenden", S.settings.alwaysSendTools !== false) }) +
		UI.field("Eigene Anweisungen", "inpCustomInstructions", S.settings.customInstructions || "", { anchor: "ai-instructions", explicit: true, multiline: true, rows: 5, description: "Tonfall, Fach und dauerhafte Vorlieben", placeholder: "Optional" });
	return UI.page("KI", "Modelle, Zugänge und lokale KI – alles auf einer Seite.",
		'<div id="aiStatusSettings" class="ai-status-banner"></div>' + aiModelsGroup() + aiSourcesGroup() + localAiGroup() + UI.group("Verhalten", behavior) + UI.saveBar());
}

// ---------- Lernen ----------
function renderLearning(vm) {
	const overlearn = localStorage.getItem("impala67Overlearn") !== "off";
	const conf = localStorage.getItem("impala67Confidence");
	const confidence = !!conf && conf !== "off";
	const telemetry = localStorage.getItem("impala67Telemetry") !== "off";
	const options = UI.row({ title: "Overlearning-Sperre", description: "Verhindert sofortiges Wiederholen frisch bewerteter Karten", trailing: switchControl("inpOverlearn", "Overlearning-Sperre", overlearn) }) +
		UI.row({ title: "Selbsteinschätzung abfragen", description: confidence ? "Du bewertest deine Sicherheit bewusst" : "Die App schätzt Sicherheit aus der Antwortzeit", trailing: switchControl("inpConfidence", "Selbsteinschätzung abfragen", confidence) }) +
		UI.row({ title: "Lernanalyse aufzeichnen", description: "Speichert Lernzeiten und Bewertungen für Statistik und Lernanalyse – nur auf deinen eigenen Geräten", trailing: switchControl("inpTelemetry", "Lernanalyse aufzeichnen", telemetry) }) +
		UI.row({ id: "break-reminder", title: "Pausen-Erinnerung", description: "Erinnert nach 40 Minuten Lernen an eine kurze Pause", trailing: switchControl("inpBreakReminder", "Pausen-Erinnerung", vm.breakReminder) });
	const beta = window.EXP?.settingsHtml ? window.EXP.settingsHtml() : '<div class="settings-empty">Lernmodul nicht geladen.</div>';
	const controller = window.CONTROLLER?.settingsHtml ? window.CONTROLLER.settingsHtml() : '<div class="settings-empty">Controller-Modul nicht geladen.</div>';
	return UI.page("Lernen", "Wie Karteikarten abgefragt werden und welche Lernhilfen dich unterstützen.",
		UI.group("Lernverhalten", options, { id: "learning-options" }) +
		UI.group("Beta-Lernfunktionen", beta, { id: "learning-beta", footnote: "Beta-Funktionen sind standardmäßig aus und lassen sich einzeln aktivieren." }) +
		UI.disclosure("Mit Controller lernen", "Gamepad, Tastenhinweise, Vibration und Tastenbelegung", controller));
}

// ---------- Sync & Backup ----------
function driveContent() {
	const session = driveSession();
	const action = driveActionState({ hasClient: hasDriveClient(), ...session });
	const tone = session.connected ? "ok" : session.needsLogin ? backupTone() : !hasDriveClient() ? "warn" : "idle";
	const title = session.connected ? "Verbunden" : session.needsLogin ? "Pausiert" : hasDriveClient() ? "Nicht verbunden" : "Einrichtung erforderlich";
	const lastOk = session.lastOkAt ? "Zuletzt gesichert " + U.fmtDate(session.lastOkAt) : "";
	const description = session.connected ? [session.email || "Google Drive", lastOk].filter(Boolean).join(" · ")
		: session.needsLogin ? [lastOk, "Google meldet dich nach einer Stunde ab – ein Tipp sichert weiter"].filter(Boolean).join(" · ")
			: hasDriveClient() ? "Google öffnet erst nach deinem Klick ein Anmeldefenster" : "Hinterlege unter Erweitert eine Google Client-ID";
	const storage = session.connected ? '<p id="driveStorageInfo" class="settings-footnote">Speicher wird ermittelt …</p>' : "";
	return UI.status(tone, title, description,
		button(action.label, "btnDrivePrimaryAction") + (session.connected || session.needsLogin ? button("Abmelden", "btnDriveLogout", "secondary") : "")) + storage;
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
		{ label: "QR-Code scannen", icon: "camera", id: "btnCfScanPairing", className: "secondary" },
		{ label: "Gerät koppeln (QR-Code)", icon: "phone", id: "btnCfPairing", className: "secondary", hidden: !hasCloudflareConfig(cf) },
		{ label: "Schlüssel generieren", id: "btnCfGenKey", className: "secondary", hidden: !!(cf.syncKey || S.settings.cfSyncKey) },
		{ label: "Schlüssel kopieren", id: "btnCfCopyKey", className: "secondary", hidden: !(cf.syncKey || S.settings.cfSyncKey) },
	]) +
	UI.row({ title: "Cloud-Speicher (" + (cf.usage?.mbLimit || 1000) + " MB Limit)", description: "Verwendeter Speicherplatz auf deinem Cloudflare Sync-Server", trailing: '<span id="cfStorageValue" class="settings-value">' + e(cf.usage?.formatted || ("0.0 MB / " + (cf.usage?.mbLimit || 1000) + " MB (0 %)")) + '</span>' }) +
	(hasCloudflareConfig(cf) ? UI.row({ title: "Cloud-Daten löschen", description: "Löscht den synchronisierten Datenstand auf dem Cloudflare-Server", trailing: button("Cloud-Stand leeren", "btnCfPurge", "danger") }) : "");
}

function renderSync(vm) {
	const syncMinutes = normalizeDriveSyncMinutes(S.settings);
	const intervalOptions = DRIVE_SYNC_INTERVAL_OPTIONS.map(({ value, label }) => '<option value="' + value + '"' + (value === syncMinutes ? " selected" : "") + '>' + e(label) + "</option>").join("");
	const automation = UI.row({ title: "Sync-Intervall", description: "Holt und sichert Daten regelmäßig, solange die App geöffnet ist", trailing: '<select id="inpDriveAutoSyncMinutes" aria-label="Intervall für automatische Synchronisierung">' + intervalOptions + "</select>" }) +
		UI.row({ title: "Nach jeder Änderung synchronisieren", description: "Sichert Änderungen nach kurzer Bündelung zusätzlich zum Intervall", trailing: switchControl("inpDriveSyncAfterChange", "Nach jeder Änderung synchronisieren", driveSyncAfterChange(S.settings)) }) +
		UI.row({ id: "token-sync", title: "Tokens über Drive synchronisieren", description: SETTINGS_SYNC.allowsSecrets(S.settings) ? "KI-Keys werden an deine eigenen Geräte übertragen" : "Tokens bleiben ausschließlich auf diesem Gerät", trailing: switchControl("inpSyncSecrets", "Tokens über Drive synchronisieren", SETTINGS_SYNC.allowsSecrets(S.settings)) });
	const lastBackup = localStorage.getItem("impala67LastBackup");
	const backupAction = backupActionState({ hasBackup: !!lastBackup });
	const backupDescription = (lastBackup ? "Zuletzt " + U.fmtDate(lastBackup) + " · " : "") + "Event-Log und Dateien als JSON; Importe werden konfliktfrei zusammengeführt";
	const backup = UI.row({ title: "Vollständiges Backup", description: backupDescription, trailing: UI.actions([{ label: backupAction.label, id: "btnExport", live: true }, { label: "Importieren", id: "btnImport", className: "secondary" }]) }) +
		(vm.nativeFilesystemAvailable ? UI.row({ id: "native-fs-backup", title: "In Gerätespeicher sichern", description: "Backups direkt in Android Dokumente (Documents/Impala67) ablegen", trailing: switchControl("inpNativeFsBackup", "In Gerätespeicher sichern", vm.nativeFilesystemEnabled) }) : "");
	const exports = UI.row({ title: "Lerndaten", description: "Lernanalyse-Daten als JSON", trailing: button("Exportieren", "btnTeleExport", "secondary") }) + UI.row({ title: "Workspace als Markdown", description: "Seitenbaum als Markdown-ZIP", trailing: '<span class="settings-workspace-actions">' + Object.values(S.workspaces).map((workspace) => '<button type="button" data-zipws="' + e(workspace.id) + '">' + e(workspace.name) + "</button>").join("") + "</span>" });
	const advanced = UI.field("Google Client-ID", "inpDrive", S.settings.driveClientId || "", { explicit: true, placeholder: "OAuth-Webclient-ID" });
	return UI.page("Sync & Backup", "Halte deine Geräte synchron und sichere deine Daten.",
		UI.group("Cloudflare Live-Sync", '<div id="cf-connection-status">' + cloudflareContent() + "</div>", { id: "cf-sync", footnote: "100 % Ende-zu-Ende verschlüsselt (AES-GCM 256-Bit). Der Server sieht niemals Klartext-Notizen." }) +
		UI.group("Google Drive", '<div id="drive-connection-status">' + driveContent() + "</div>", { id: "drive", footnote: "Drive verwendet den privaten App-Speicher. OAuth-Zugriffstokens bleiben immer gerätelokal." }) +
		UI.group("Automatische Synchronisierung", automation, { id: "drive-automation", footnote: "Tipp: Bei aktivem Cloudflare-Sync reicht das tägliche Backup-Intervall völlig aus." }) +
		UI.group("Backup & Wiederherstellung", backup, { id: "backup" }) +
		UI.group("Weitere Exporte", exports, { id: "data-export" }) +
		UI.disclosure("Erweitert", "Google Client-ID", '<div id="sync-advanced" data-settings-anchor>' + advanced + "</div>") +
		UI.saveBar());
}

function refreshSyncOverview() {
	const overview = document.getElementById("sync-overview-status");
	if (overview) overview.outerHTML = syncOverviewRow();
}

export function refreshDriveStatusUi() {
	refreshSyncOverview();
	const connection = document.getElementById("drive-connection-status");
	if (connection) { connection.innerHTML = driveContent(); hydrateDriveStorage(); }
}

export function refreshCloudflareStatusUi() {
	refreshSyncOverview();
	const connection = document.getElementById("cf-connection-status");
	if (connection) connection.innerHTML = cloudflareContent();
}

// ---------- App & Speicher ----------
function renderApp(vm) {
	const storage = UI.row({ title: "Verwendeter Speicher", description: "IndexedDB, PDFs, Bilder und Offline-Daten", trailing: '<span id="settingsStorageValue" class="settings-value">Wird berechnet …</span>' });
	const updateValues = '<span class="settings-version-values"><span>Installiert <b id="updateLocalVer">v' + e(plainVersion(vm.version)) + '</b></span><span>Verfügbar <b id="updateRemoteVer">—</b></span></span>';
	const update = UI.row({ title: "App-Version", description: "Updates werden nur auf Wunsch geprüft", descriptionId: "updateStatus", descriptionLive: true, trailing: updateValues + updateButton(), className: "settings-update-row" });
	const scanner = vm.nativeScannerAvailable ? UI.group("Gerät", UI.row({
		id: "native-scanner",
		title: "Dokumenten-Scanner",
		description: "Google-Scanner (schnell, von Google Play) oder Impala-Scanner (eigene Kamera-Ansicht mit Filtern, auch ohne Google-Dienste)",
		trailing: '<select id="inpNativeScanner" aria-label="Dokumenten-Scanner">' +
			'<option value="google"' + (vm.nativeScannerEnabled ? " selected" : "") + '>Google-Scanner</option>' +
			'<option value="impala"' + (vm.nativeScannerEnabled ? "" : " selected") + '>Impala-Scanner</option></select>',
	})) : "";
	const experiments = UI.row({ id: "beta-ui", title: "Beta-Design", description: "Neue Heft-Werkzeugleiste mit Stift-Favoriten und überarbeitete Seitenmenüs (Standard: an)", trailing: switchControl("inpBetaUi", "Beta-Design", !!vm.betaUi) });
	const chats = CHATS.load();
	const cardCount = Object.keys(S.cards || {}).length;
	const deckCount = Object.keys(S.decks || {}).length;
	const cardsDescription = cardCount
		? cardCount + (cardCount === 1 ? " Karteikarte" : " Karteikarten") + " · wird per Sync auch auf deinen anderen Geräten gelöscht"
		: (deckCount ? deckCount + " Stapel · wird per Sync auch auf deinen anderen Geräten gelöscht" : "Keine Karteikarten vorhanden");
	const danger = UI.row({ title: "Alle lokalen Seiten löschen", description: "Einstellungen, API-Keys, Chats und Karteikarten bleiben erhalten", trailing: button("Seiten löschen", "btnResetAll", "danger") }) +
		UI.row({ id: "danger-chats", title: "Alle Chats löschen", description: chats.length ? chats.length + (chats.length === 1 ? " Chat" : " Chats") + " · wird per Sync auch auf deinen anderen Geräten gelöscht" : "Keine gespeicherten Chats vorhanden", trailing: button("Chats löschen", "btnResetChats", "danger", !chats.length) }) +
		UI.row({ id: "danger-cards", title: "Alle Karteikarten löschen", description: cardsDescription, trailing: button("Karten löschen", "btnResetCards", "danger", !cardCount && !deckCount) });
	const perf = PERF_PROFILER.status();
	const isAnomalies = perf.mode !== "all";
	const countPrefix = perf.enabled
		? (perf.records + (isAnomalies ? (perf.records === 1 ? " Auffälligkeit · " : " Auffälligkeiten · ") : (perf.records === 1 ? " Messpunkt · " : " Messpunkte · ")))
		: "";
	const perfDescription = countPrefix + "Erfasst lokal Hänger in Eingabe, Rendern und Sync sowie App- und KI-Fehler – nie Inhalte oder Zugangsdaten";
	const developer = '<div id="performance-profiler" data-settings-anchor>' + UI.row({ title: "Performance-Profiler", description: perfDescription, trailing: switchControl("inpPerformanceProfiler", "Performance-Profiler aktivieren", perf.enabled) }) +
		(perf.records ? UI.actions([{ label: "Diagnose kopieren", id: "btnPerfCopy" }, { label: "JSON exportieren", id: "btnPerfExport", className: "secondary" }, { label: "Protokoll löschen", id: "btnPerfClear", className: "secondary" }]) : "") + "</div>" +
		(PLATFORM_NATIVE.isNative ? "" : UI.row({ id: "mcp-bridge", title: "MCP-Live-Bridge", description: isLocalDev() ? "Auf dem lokalen Dev-Server immer aktiv" : "Verbindet die App mit einem KI-Assistenten auf diesem Rechner (ws://127.0.0.1:8765). Chrome fragt einmal nach Zugriff aufs lokale Netzwerk.", trailing: switchControl("inpMcpBridge", "MCP-Live-Bridge aktivieren", mcpBridgeEnabled()) }));
	return UI.page("App & Speicher", "Speicher im Blick behalten, die App aktuell halten und Neues ausprobieren.",
		UI.group("Lokaler Speicher", storage, { id: "storage" }) +
		UI.group("App-Updates", update, { id: "updates" }) +
		scanner +
		UI.group("Experimente", experiments, { footnote: "Experimente können sich noch ändern und gelten nur auf diesem Gerät." }) +
		UI.group("Gefahrenzone", danger, { id: "danger-zone", danger: true }) +
		UI.disclosure("Für Entwickler", PLATFORM_NATIVE.isNative ? "Performance-Profiler" : "Performance-Profiler und MCP-Live-Bridge", developer));
}

const PAGES = { appearance: renderAppearance, ai: renderAi, learning: renderLearning, sync: renderSync, app: renderApp };

export function renderSettingsPage(section, vm) {
	if (PAGES[section]) return PAGES[section](vm);
	return document.body.classList.contains("mobile-ui") ? renderMobileOverview(vm) : renderOverview(vm);
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
	const results = searchSettings(query, 8, { native: PLATFORM_NATIVE.isNative, web: !PLATFORM_NATIVE.isNative });
	if (!query.trim()) return "";
	if (!results.length) return '<div class="settings-search-empty">Keine Einstellung gefunden</div>';
	return results.map((item) => '<button type="button" data-settings-go="' + e(item.section) + '" data-settings-anchor-target="' + e(item.id) + '"><span><b>' + e(item.label) + "</b><small>" + e(item.sectionLabel) + " · " + e(item.description) + "</small></span>" + UI.icon("chevron") + "</button>").join("");
}

const fmtBytes = (b) => (b >= 1073741824 ? (b / 1073741824).toFixed(1).replace(".", ",") + " GB" : b >= 1048576 ? (b / 1048576).toFixed(b < 10485760 ? 1 : 0).replace(".", ",") + " MB" : Math.max(1, Math.round(b / 1024)) + " KB");
let driveStorageCache = null; // { at, text } — Drive-Abfrage höchstens alle 5 Minuten

export async function hydrateDriveStorage() {
	const target = document.getElementById("driveStorageInfo");
	if (!target) return;
	if (driveStorageCache && Date.now() - driveStorageCache.at < 300000) { target.textContent = driveStorageCache.text; return; }
	let text = "";
	try {
		const info = await DRIVE.storageInfo?.();
		if (info) {
			text = "Impala67 belegt " + fmtBytes(info.appBytes) + " in Drive";
			if (info.limitBytes) text += " · Google-Speicher: " + fmtBytes(info.usedBytes) + " von " + fmtBytes(info.limitBytes) + " belegt";
			driveStorageCache = { at: Date.now(), text };
		}
	} catch { /* Anzeige ist optional */ }
	const el = document.getElementById("driveStorageInfo");
	if (!el) return;
	if (text) el.textContent = text; else el.remove();
}

export async function hydrateStorageUsage() {
	const targets = [document.getElementById("settingsStorageValue"), document.getElementById("settingsStorageOverview")].filter(Boolean);
	if (!targets.length) return;
	let text = "Nicht verfügbar";
	let percent = 0;
	try {
		const estimate = await navigator.storage?.estimate?.();
		if (estimate) {
			const mb = (estimate.usage || 0) / 1048576;
			const quota = (estimate.quota || 0) / 1073741824;
			text = mb < 1 ? "< 1 MB" : mb.toFixed(mb < 10 ? 1 : 0) + " MB";
			if (quota) text += " von " + quota.toFixed(1) + " GB";
			if (estimate.quota) percent = Math.min(100, ((estimate.usage || 0) / estimate.quota) * 100);
		}
	} catch { /* Anzeige bleibt neutral */ }
	targets.forEach((target) => { target.textContent = text; });
	const bar = document.getElementById("settingsStorageBar");
	if (bar) bar.style.width = percent.toFixed(1) + "%";
}
