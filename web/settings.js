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
import { SETTINGS_SYNC } from "./settings-sync.js";
import { normalizeDriveSyncMinutes } from "./drive-sync-policy.js";
import { SETTINGS_LAST_SECTION_KEY, SETTINGS_SECTIONS, resolveSettingsSection, valuesSnapshot, valuesAreDirty } from "./settings-schema.js";
import { renderSettingsPage, renderSettingsShell, renderSearchResults, hydrateStorageUsage, refreshDriveStatusUi, refreshCloudflareStatusUi } from "./settings-renderer.js";
import { CLOUDFLARE_SYNC } from "./sync-cloudflare.js";

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
		// DB.blobUrl cacht: vorher entstand bei JEDEM Aufruf (Theme-Wechsel, Akzentfarbe,
		// Start) ein neuer Object-URL fürs selbe Bild, der nie freigegeben wurde.
		const url = await DB.blobUrl("bgImage", "image/jpeg");
		if (url) {
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

// ---------- Settings-System: Schema, Shell und einheitlicher Entwurfszustand ----------
let settingsDraftInitial = "[]";
let settingsSearchQuery = "";

function explicitSettingsValues() {
	return Array.from(document.querySelectorAll("[data-settings-explicit]")).map((element, index) => ({
		key: element.id || element.dataset.provname || element.dataset.provbase || element.dataset.provkey || String(index),
		value: element.type === "checkbox" ? element.checked : element.value,
	}));
}

export function hasUnsavedSettings() {
	return valuesAreDirty(settingsDraftInitial, explicitSettingsValues());
}

export function refreshSettingsDirtyState() {
	const dirty = hasUnsavedSettings();
	const bar = document.querySelector("[data-settings-savebar]");
	if (bar) bar.hidden = !dirty;
	const modal = document.querySelector(".settings-modal-v2");
	if (modal) modal.classList.toggle("is-dirty", dirty);
	return dirty;
}

async function allowDiscardSettings() {
	if (!hasUnsavedSettings()) return true;
	const modal = document.querySelector(".settings-modal-v2");
	if (!modal) return false;
	return new Promise((resolve) => {
		const cancel = U.h("button", { type: "button" }, "Weiter bearbeiten");
		const discard = U.h("button", { type: "button", class: "danger" }, "Verwerfen");
		const guard = U.h("div", { class: "settings-guard", role: "presentation" },
			U.h("div", { class: "settings-guard-dialog", role: "alertdialog", "aria-modal": "true", "aria-labelledby": "settingsGuardTitle" },
				U.h("h3", { id: "settingsGuardTitle" }, "Änderungen verwerfen?"),
				U.h("p", null, "Du hast Änderungen noch nicht gespeichert."),
				U.h("div", { class: "settings-actions" }, cancel, discard)));
		const finish = (result) => { guard.remove(); resolve(result); };
		cancel.addEventListener("click", () => finish(false));
		discard.addEventListener("click", () => finish(true));
		guard.addEventListener("click", (e) => { if (e.target === guard) finish(false); });
		modal.appendChild(guard);
		cancel.focus();
	});
}

function settingsViewModel() {
	return {
		version: (typeof window.getAppVersion === "function" ? window.getAppVersion() : null) || window.APP_VERSION || "unbekannt",
		followSystemTheme: followsSystemTheme(),
		theme: resolvedTheme(),
		accent: localStorage.getItem("impala67Accent") || "blue",
		density: localStorage.getItem("impala67Density") || "compact",
		motion: localStorage.getItem("impala67Motion") || "full",
		fontSize: localStorage.getItem("impala67FontSize") || "m",
		homeLayout,
		homeSections: HOME_SECTIONS,
	};
}

function focusSettingsAnchor(anchor) {
	if (!anchor) return;
	queueMicrotask(() => {
		const target = document.getElementById(anchor);
		if (!target) return;
		target.scrollIntoView({ block: "center", behavior: "smooth" });
		target.classList.add("settings-highlight");
		setTimeout(() => target.classList.remove("settings-highlight"), 1800);
	});
}

export function openSettings(section, anchor) {
	const stored = localStorage.getItem(SETTINGS_LAST_SECTION_KEY);
	const resolved = resolveSettingsSection(section || stored || "overview");
	const legacyAnchor = { ki: "ai-models", home: "home-layout", look: "theme", notion: "notion", backup: "backup", update: "updates", controller: "controller-status", experimente: "learning-beta" }[section];
	S.settingsSection = resolved;
	localStorage.setItem(SETTINGS_LAST_SECTION_KEY, resolved);
	const overlay = U.el("overlay");
	if (!overlay) return;
	const previous = overlay.querySelector('.settings-modal-v2[data-sec="' + resolved + '"] .settings-main');
	const keepScroll = previous ? previous.scrollTop : 0;
	overlay.hidden = false;
	overlay.innerHTML = renderSettingsShell(resolved, renderSettingsPage(resolved, settingsViewModel()), settingsSearchQuery);
	const main = overlay.querySelector(".settings-main");
	if (keepScroll && main) main.scrollTop = keepScroll;
	settingsDraftInitial = valuesSnapshot(explicitSettingsValues());
	refreshSettingsDirtyState();
	focusSettingsAnchor(anchor || legacyAnchor);
	hydrateStorageUsage();
	if (resolved === "sync") renderNotionJob();
	if (resolved === "ai") {
		renderStatusDot();
		queueMicrotask(() => {
			loadKiTabContent(S.settingsKiTab || "models");
			if (U.el("inpEmbed")) refreshEmbeddingModels();
		});
	}
}

export async function navigateSettings(section, anchor) {
	if (!(await allowDiscardSettings())) return false;
	openSettings(section, anchor);
	return true;
}

export async function requestCloseSettings() {
	if (!(await allowDiscardSettings())) return false;
	closeOverlay();
	return true;
}

export function discardSettingsDraft() {
	openSettings(S.settingsSection || "overview");
}

export function updateSettingsSearch(value) {
	settingsSearchQuery = String(value || "");
	const host = U.el("settingsSearchResults");
	if (!host) return;
	host.innerHTML = renderSearchResults(settingsSearchQuery);
	host.hidden = !settingsSearchQuery.trim();
}

export async function handleSyncSecretsToggle(enabled) {
	const wasEnabled = SETTINGS_SYNC.allowsSecrets(S.settings);
	if (wasEnabled === enabled) return;
	await STATE.dispatch("settingsSet", { syncSecrets: enabled });
	if (enabled) {
		// Durch den neuen Event-Zeitpunkt wird ein zuvor bewusst zurückgehaltener
		// lokaler Token-Stand beim nächsten Sync zuverlässig angeboten.
		await STATE.dispatch("settingsSet", SETTINGS_SYNC.secretSnapshot(S.settings));
	} else {
		// Drive bereinigt alte Delta-/Snapshot-Kopien beim nächsten erfolgreichen
		// manuellen Sync; offline bleibt die lokale Einstellung sofort wirksam.
		localStorage.setItem("impala67_drive_secret_scrub", "1");
	}
	U.toast(enabled ? "Token-Sync aktiviert." : "Token-Sync deaktiviert: Tokens bleiben lokal.", "success");
	openSettings("sync");
}

export async function handleDriveAutoSyncMinutes(value) {
	const minutes = normalizeDriveSyncMinutes({ driveAutoSyncMinutes: value });
	await STATE.dispatch("settingsSet", { driveAutoSyncMinutes: minutes });
	U.toast("Automatischer Sync: alle " + (minutes === 60 ? "60 Minuten" : minutes + " Minuten") + ".", "success");
}

export async function handleDriveSyncAfterChange(enabled) {
	await STATE.dispatch("settingsSet", { driveSyncAfterChange: enabled === true });
	U.toast(enabled ? "Sync nach jeder Änderung aktiviert." : "Sync nach jeder Änderung deaktiviert.", "success");
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
	settingsDraftInitial = valuesSnapshot(explicitSettingsValues());
	refreshSettingsDirtyState();
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
			S.notionJob.status = "✅ Sync fertig — " + r.pulled + " übernommen, " + (r.skipped || 0) + " unverändert übersprungen, " + r.pushed + " nach Notion übertragen, " + r.created + " in Notion angelegt" + (r.merged ? ", " + r.merged + " Duplikat(e) zusammengeführt" : "") + ".";
		} else {
			const newId = await NOTION_MIGRATOR.migrate(tok, pid || null, onStatus);
			// Die Abschlusszeile („… übernommen · … unverändert übersprungen“) kommt jetzt
			// aus migrate() selbst — hier nicht mehr mit „Import fertig!“ überschreiben.
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

export async function handleCfConnect(t) {
	const urlEl = document.getElementById("inpCfUrl");
	const keyEl = document.getElementById("inpCfKey");
	const url = urlEl ? urlEl.value.trim() : "";
	const syncKey = keyEl ? keyEl.value.trim() : "";

	if (!url) {
		U.toast("Bitte gib eine Cloudflare Worker URL ein.", "warn");
		return;
	}
	if (!syncKey) {
		U.toast("Bitte gib einen Sync-Schlüssel ein oder generiere einen neuen.", "warn");
		return;
	}

	if (t) {
		t.disabled = true;
		t.textContent = "Verbinde…";
	}

	const success = await CLOUDFLARE_SYNC.configure(url, syncKey);
	if (t) {
		t.disabled = false;
		t.textContent = "Verbinden & Synchronisieren";
	}

	if (success) {
		U.toast("Cloudflare Echtzeit-Sync erfolgreich verbunden!", "success");
	} else {
		U.toast("Verbindung fehlgeschlagen. Prüfe URL und Konfiguration.", "error");
	}
	refreshCloudflareStatusUi();
}

export function handleCfDisconnect() {
	CLOUDFLARE_SYNC.disconnect();
	U.toast("Cloudflare-Sync getrennt.", "neutral");
	refreshCloudflareStatusUi();
}

export async function handleCfSyncNow(t) {
	if (t) {
		t.disabled = true;
		t.textContent = "Synchronisiere…";
	}
	try {
		await CLOUDFLARE_SYNC.syncNow();
		U.toast("Cloudflare-Sync abgeschlossen.", "success");
	} catch (e) {
		U.toast("Sync-Fehler: " + (e.message || e), "error");
	} finally {
		if (t) {
			t.disabled = false;
			t.textContent = "Jetzt synchronisieren";
		}
		refreshCloudflareStatusUi();
	}
}

export function handleCfGenKey() {
	const keyEl = document.getElementById("inpCfKey");
	const newKey = CLOUDFLARE_SYNC.generateSyncKey();
	if (keyEl) {
		keyEl.value = newKey;
		keyEl.type = "text";
		setTimeout(() => { if (keyEl) keyEl.type = "password"; }, 5000);
	}
	U.toast("Neuer Sync-Schlüssel generiert. Kopiere ihn auf deine anderen Geräte!", "success");
}

export async function handleCfCopyKey() {
	const keyEl = document.getElementById("inpCfKey");
	const key = keyEl ? keyEl.value.trim() : (CLOUDFLARE_SYNC.status().syncKey || "");
	if (!key) {
		U.toast("Kein Schlüssel zum Kopieren vorhanden.", "warn");
		return;
	}
	try {
		await navigator.clipboard.writeText(key);
		U.toast("Sync-Schlüssel in die Zwischenablage kopiert.", "success");
	} catch {
		U.toast("Kopieren nicht möglich. Bitte manuell markieren.", "warn");
	}
}

export async function handleCfPurge() {
	const ok = await U.confirm(
		"Möchtest du wirklich alle synchronisierten Daten auf dem Cloudflare-Server löschen?\n\nDeine lokalen Daten auf diesem Gerät bleiben vollständig erhalten.",
		{ title: "Cloud-Daten löschen", ok: "Cloud leeren", danger: true }
	);
	if (!ok) return;

	const success = await CLOUDFLARE_SYNC.purgeCloudData();
	if (success) {
		U.toast("Cloud-Daten wurden erfolgreich gelöscht.", "success");
	} else {
		U.toast("Löschen fehlgeschlagen.", "error");
	}
	refreshCloudflareStatusUi();
}

export async function handleDriveLogin(t) {
	t.disabled = true;
	const old = t.textContent;
	t.textContent = "Verbinde…";
	try {
		await DRIVE.login();
		openSettings("sync");
	} catch (err) {
		U.toast("Anmeldung fehlgeschlagen: " + err.message, "error");
		t.disabled = false;
		t.textContent = old;
	}
}

export function handleDriveLogout() {
	DRIVE.logout();
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

// Der Seitenleisten-Knopf enthält ein SVG-Icon, der Einstellungen-Knopf nur Text —
// innerHTML sichert die Beschriftung in beiden Fällen verlustfrei.
async function runDriveSync(t, prefix) {
	t.disabled = true;
	const old = t.innerHTML;
	try {
		if (!DRIVE.isConnected()) {
			t.textContent = prefix + "Google-Verbindung…";
			await DRIVE.renewFromUserGesture();
		}
		finishDriveSync(await DRIVE.sync((st) => { t.textContent = prefix + st; }));
	} catch (err) {
		U.toast("Sync fehlgeschlagen: " + err.message, "error");
	}
	t.disabled = false;
	t.innerHTML = old;
}

export async function handleDriveSyncSettings(t) {
	await runDriveSync(t, "");
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
// Drive-Stand; danach sichern das gewählte Intervall, Sichtbarkeitswechsel und
// pagehide automatisch. Der Änderungs-Debounce ist eine eigene Einstellung.
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
	if (btn) { btn.disabled = true; btn.textContent = "Prüfe…"; }
	// Einheitlich: Suchen zeigt nur an. Der Installieren-Knopf erscheint erst, wenn
	// wirklich ein Update gefunden wurde (PWA: zusätzlich als Reload-Fallback).
	if (applyBtn) {
		applyBtn.hidden = true;
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
			if (status) status.textContent = "⬇️ Update v" + r.latest + " verfügbar (du: v" + r.current + "). Tippe „Update laden“.";
			if (applyBtn) { applyBtn.hidden = false; applyBtn.textContent = "Update laden"; }
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
			" — du kannst die App trotzdem neu laden.";
		if (remoteEl) remoteEl.textContent = "nicht erreichbar";
		if (applyBtn) {
			applyBtn.hidden = false;
			applyBtn.textContent = "App neu laden";
		}
		U.toast("Update-Check fehlgeschlagen.", "error");
	}
	if (btn) { btn.disabled = false; btn.textContent = "Nach Updates suchen"; }
}

export async function handleApplyPwaUpdate() {
	const status = U.el("updateStatus");
	const applyBtn = U.el("btnApplyPwaUpdate");
	if (applyBtn) { applyBtn.disabled = true; applyBtn.textContent = "Lädt…"; }
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
		if (applyBtn) { applyBtn.disabled = false; applyBtn.textContent = "Jetzt neu laden"; }
	}
}

// Horizontaler KI-Unter-Tab wechseln — ohne Full-Rerender, damit ungespeicherte
// Eingaben in den anderen Panes erhalten bleiben.
export async function switchKiTab(tab) {
	if (!(await allowDiscardSettings())) return;
	S.settingsKiTab = tab === "sources" || tab === "learning" ? tab : "models";
	openSettings("ai");
}

// Inhalte lazy nachladen, sobald der jeweilige Unter-Tab sichtbar wird.
function loadKiTabContent(tab) {
	if (tab === "models") refreshChatModels();
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
	// Suche: filtert NUR die Anzeige. Favoriten, aktives Modell und die Gruppierung nach
	// Quelle bleiben unverändert — ein Filter über der bestehenden Liste, keine zweite Liste.
	const q = String(S.modelQuery || "").trim().toLowerCase();
	const hit = (m) => !q || (String(m.id) + " " + nameOf(m.providerId)).toLowerCase().includes(q);
	const count = U.el("aiModelCount");
	if (count) count.textContent = q ? live.filter(hit).length + " von " + live.length : live.length + " Modelle";
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
	const favLive = live.filter((m) => favSet.has(m.providerId + "::" + m.id) && hit(m));
	if (favLive.length) body += '<div class="menu-label">★ Favoriten</div>' + favLive.map(row).join("");
	for (const pr of providers) {
		const rest = live.filter((m) => m.providerId === pr.id && !favSet.has(pr.id + "::" + m.id) && hit(m));
		if (rest.length) body += '<div class="menu-label">' + U.esc(pr.name || pr.id) + "</div>" + rest.map(row).join("");
	}
	// Offline-Favoriten / aktuelles Modell ohne Live-Treffer trotzdem anbieten
	const seen = new Set(live.map((m) => m.providerId + "::" + m.id));
	const orphans = [];
	favSet.forEach((k) => { if (!seen.has(k)) orphans.push(k); });
	if (curModel && !seen.has(curPr + "::" + curModel) && !favSet.has(curPr + "::" + curModel)) orphans.push(curPr + "::" + curModel);
	const orphanRows = orphans.map((k) => {
		const sep = k.indexOf("::");
		return { providerId: sep === -1 ? curPr : k.slice(0, sep), id: sep === -1 ? k : k.slice(sep + 2) };
	}).filter(hit);
	if (orphanRows.length) body += '<div class="menu-label">Gespeichert</div>' + orphanRows.map(row).join("");
	// Offline / keine Live-Liste: feste Vorschläge (Gemini/OpenAI/lokal) anbieten
	if (!body && !q && (AI.MODEL_PRESETS || []).length) {
		body = '<div class="menu-label">Vorschläge</div>' + (AI.MODEL_PRESETS || []).map((p) =>
			row({ id: p.value, providerId: p.provider })).join("");
	}
	host.innerHTML = body || (q
		? '<div class="menu-note">Kein Modell passt zu „' + U.esc(q) + '“.</div>'
		: '<div class="menu-note">Keine Modelle erreichbar. Quelle prüfen oder unten manuell eintragen.</div>');
}

// Lädt Chat-Modelle ALLER Quellen und zeichnet die Liste (inkl. Favoriten).
export async function refreshChatModels(force = false) {
	const host = U.el("settingsModelList");
	const hint = U.el("settingsModelHint");
	const btn = U.el("btnRefreshModels");
	if (!host) return;
	if (btn) btn.disabled = true;
	// GLITCH-WURZEL: Die bereits bekannte Liste wurde bei jedem Öffnen durch
	// „Modelle werden geladen…“ ersetzt und blinkte so jedes Mal leer, obwohl der Cache steht.
	// Jetzt sofort aus dem Cache zeichnen; der Ladezustand erscheint nur, wenn nichts da ist.
	const cached = Array.isArray(S.availableModels) && S.availableModels.length;
	if (cached) paintSettingsModels();
	else host.innerHTML = '<div class="menu-note">Modelle werden geladen…</div>';
	try {
		const found = await AI.listModels({ force });
		S.availableModels = found;
		paintSettingsModels();
		if (hint) {
			// Meta-Zeile nur bei Fehlern zeigen — Erfolg braucht keinen Fließtext.
			if (found.length) { hint.hidden = true; hint.textContent = ""; }
			else { hint.hidden = false; hint.textContent = "Keine Modelle erreichbar — Quelle prüfen."; }
		}
	} catch (err) {
		paintSettingsModels();
		// FIX: Der Hinweis startet versteckt — ohne hidden=false war diese Fehlermeldung
		// unsichtbar, ein Ladefehler sah aus wie „einfach keine Modelle da“.
		if (hint) { hint.hidden = false; hint.textContent = "Modelle konnten nicht geladen werden; die letzte Liste bleibt verfügbar."; }
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

// Das Produkt bietet bewusst nur das geprüfte lokale Bekko-Modell an.
// Lokales Embedding-Modell (Bekko a8m): Status aktualisieren und UI synchronisieren.
export async function refreshEmbeddingModels() {
	await updateLocalEmbeddingManagerUi();
}

export async function updateLocalEmbeddingManagerUi() {
	const statusEl = U.el("localEmbeddingStatus");
	if (!statusEl) return;
	const msgEl = U.el("localEmbeddingMsg");
	const actionsEl = U.el("localEmbeddingActions");
	const progress = U.el("localEmbeddingProgress");
	const inpEmbed = U.el("inpEmbed");
	const modelId = "local:bekko-a8m";
	const configured = inpEmbed?.value === "local::" + modelId;

	try {
		const status = await AI.getLocalEmbeddingStatus(modelId);
		if (status.cached) {
			statusEl.className = "settings-status " + (configured ? "is-ok" : "is-idle");
			if (msgEl) msgEl.textContent = configured
				? "Bereit für Offline-Suche · 124 MB im Browser-Cache (kann entfernt werden) · wird im Leerlauf aus dem RAM entladen"
				: "Im Browser-Cache vorhanden, aber noch nicht aktiviert · der Cache kann entfernt werden";
			if (actionsEl) actionsEl.innerHTML = configured
				? '<button type="button" id="btnDeleteLocalEmbedding" class="secondary danger-text">Modell löschen</button>'
				: '<button type="button" id="btnEnableLocalEmbedding" class="primary">Für Suche aktivieren</button>';
			if (progress) progress.hidden = true;
		} else {
			statusEl.className = "settings-status " + (configured ? "is-warn" : "is-idle");
			if (msgEl) msgEl.textContent = configured
				? `Download erforderlich (~${status.sizeMb || 124} MB); danach offline im Browser nutzbar · der Cache kann entfernt werden`
				: `Einmaliger Download (~${status.sizeMb || 124} MB); danach offline im Browser nutzbar · der Cache kann entfernt werden`;
			if (actionsEl) actionsEl.innerHTML = `<button type="button" id="btnDownloadLocalEmbedding" class="primary">📥 Herunterladen (~${status.sizeMb || 124} MB)</button>`;
			if (progress) progress.hidden = true;
		}
	} catch (err) {
		statusEl.className = "settings-status is-warn";
		if (msgEl) msgEl.textContent = "Status konnte nicht ermittelt werden: " + (err.message || err);
	}
}

export async function handleEnableLocalEmbedding() {
	const inpEmbed = U.el("inpEmbed");
	try {
		await STATE.dispatch("settingsSet", { embedProviderId: "local", embedModel: "local:bekko-a8m" });
		if (inpEmbed) inpEmbed.value = "local::local:bekko-a8m";
		U.toast("Semantische Suche aktiviert.", "success");
		await updateLocalEmbeddingManagerUi();
		RAG.reindexStale();
	} catch (err) {
		U.toast("Aktivieren fehlgeschlagen: " + (err.message || err), "error");
	}
}

let isDownloadingLocalEmbedding = false;
export async function handleDownloadLocalEmbedding() {
	if (isDownloadingLocalEmbedding) return;
	const statusEl = U.el("localEmbeddingStatus");
	const actionsEl = U.el("localEmbeddingActions");
	const progress = U.el("localEmbeddingProgress");
	const fill = progress?.querySelector(".progress-fill");
	const msgEl = U.el("localEmbeddingMsg");
	const inpEmbed = U.el("inpEmbed");
	const modelId = "local:bekko-a8m";

	isDownloadingLocalEmbedding = true;
	if (statusEl) statusEl.className = "settings-status is-warn";
	if (actionsEl) actionsEl.innerHTML = '<button type="button" id="btnDownloadLocalEmbedding" class="secondary" disabled>Lädt…</button>';
	if (progress) progress.hidden = false;
	if (fill) fill.style.width = "0%";
	if (msgEl) msgEl.textContent = "Lade Modell-Dateien herunter… Bitte warten.";

	const unsub = AI.onEmbeddingProgress((p) => {
		if (p.progress !== undefined) {
			const pct = Math.min(100, Math.max(0, Math.round(p.progress)));
			if (fill) fill.style.width = pct + "%";
			const btn = actionsEl?.querySelector("button");
			if (btn) btn.textContent = `Lädt… ${pct}%`;
			if (msgEl) {
				const fileInfo = p.file ? ` (${p.file})` : "";
				msgEl.textContent = `Lade Modell: ${pct}%${fileInfo}`;
			}
		}
	});

	try {
		await AI.downloadLocalEmbedding(modelId);
		unsub();
		if (fill) fill.style.width = "100%";
		U.toast("Lokales Modell erfolgreich heruntergeladen!", "success");
		await STATE.dispatch("settingsSet", { embedProviderId: "local", embedModel: modelId });
		if (inpEmbed) inpEmbed.value = "local::" + modelId;
		await updateLocalEmbeddingManagerUi();
		RAG.reindexStale();
	} catch (err) {
		unsub();
		U.toast("Fehler beim Herunterladen: " + (err.message || err), "error");
		if (msgEl) msgEl.textContent = "Fehler: " + (err.message || err);
		if (statusEl) statusEl.className = "settings-status is-warn";
		if (actionsEl) actionsEl.innerHTML = '<button type="button" id="btnDownloadLocalEmbedding" class="primary">Erneut versuchen</button>';
	} finally {
		isDownloadingLocalEmbedding = false;
		if (progress) progress.hidden = true;
	}
}

export async function handleDeleteLocalEmbedding() {
	const modelId = "local:bekko-a8m";
	const inpEmbed = U.el("inpEmbed");
	try {
		await AI.deleteLocalEmbedding(modelId);
		await STATE.dispatch("settingsSet", { embedProviderId: "", embedModel: "" });
		if (inpEmbed) inpEmbed.value = "";
		U.toast("Lokales Modell aus dem Cache gelöscht.", "success");
		await updateLocalEmbeddingManagerUi();
	} catch (err) {
		U.toast("Fehler beim Löschen: " + (err.message || err), "error");
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
	if (g("inpNotionToken")) patch.notionToken = g("inpNotionToken").value.trim();
	if (g("inpNotionPage")) patch.notionPageId = g("inpNotionPage").value.trim();
	if (g("inpCorsProxy")) patch.corsProxy = g("inpCorsProxy").value.trim();
	if (g("inpCustomInstructions")) patch.customInstructions = g("inpCustomInstructions").value;
	if (g("inpAlwaysTools")) patch.alwaysSendTools = g("inpAlwaysTools").checked; // Tool-Angebot v3
	await STATE.dispatch("settingsSet", patch);
	S.notionToken = patch.notionToken ?? S.notionToken;
	S.notionPageId = patch.notionPageId ?? S.notionPageId;
	settingsDraftInitial = valuesSnapshot(explicitSettingsValues());
	refreshSettingsDirtyState();
	U.toast("Einstellungen gespeichert.", "success");
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
	const hasId = (window.APP_CONFIG && window.APP_CONFIG.GOOGLE_WEB_CLIENT_ID) || S.settings.driveClientId;
	if (!hasId) {
		U.toast("Für den Drive-Sync fehlt noch die Google Client-ID — einmalig unter ⚙️ Einstellungen → Sync einrichten.", "error");
		openSettings("sync");
		return;
	}
	// Dieser Klick ist die von Google geforderte Nutzeraktion: Ist das Token abgelaufen,
	// wird es hier erneuert und derselbe Ablauf synchronisiert direkt weiter.
	await runDriveSync(t, "☁️ ");
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
	{ id: "insights", label: "Lernanalyse", hint: "Lernzeit · Wochenverlauf · Kartenqualität · Empfehlungen" },
	{ id: "foryou", label: "Für dich heute", hint: "persönliche Hinweise aus deinen Lerndaten" },
	{ id: "continue", label: "Weitermachen", hint: "zuletzt bearbeitete Seite" },
	{ id: "today", label: "Heute-Leiste", hint: "Daily · Karten · Noten" },
	{ id: "decks", label: "Stapel-Überblick", hint: "fällige Karten pro Stapel, Klick lernt" },
	{ id: "favorites", label: "Favoriten", hint: "deine ★-Seiten" },
	{ id: "recent", label: "Zuletzt", hint: "zuletzt bearbeitete Seiten" },
	{ id: "chats", label: "Chats", hint: "letzte KI-Unterhaltungen" },
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

export function handleDashboardReorder(fromId, toId) {
	const list = homeLayout();
	const from = list.findIndex((entry) => entry.id === fromId);
	const to = list.findIndex((entry) => entry.id === toId);
	if (from < 0 || to < 0 || from === to) return;
	const [moved] = list.splice(from, 1);
	list.splice(to, 0, moved);
	saveHomeLayout(list);
	openSettings("general", "home-layout");
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

document.addEventListener("keydown", (e) => {
	if (!document.querySelector(".settings-modal-v2")) return;
	const guard = document.querySelector(".settings-guard");
	if (guard && e.key === "Escape") {
		e.preventDefault();
		guard.querySelector("button")?.click();
		return;
	}
	if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
		e.preventDefault();
		U.el("settingsSearch")?.focus();
	} else if (e.key === "Escape" && !document.querySelector(".exp-modal-backdrop")) {
		e.preventDefault();
		requestCloseSettings();
	}
}, true);

document.addEventListener("click", (e) => {
	const target = e.target?.closest?.("[data-settings-go]");
	if (!target) return;
	e.preventDefault();
	e.stopPropagation();
	settingsSearchQuery = "";
	navigateSettings(target.dataset.settingsGo, target.dataset.settingsAnchorTarget || "");
}, true);

let draggedHomeSection = "";
document.addEventListener("dragstart", (e) => {
	const row = e.target?.closest?.("[data-dashboard-row]");
	if (!row) return;
	draggedHomeSection = row.dataset.dashboardRow;
	row.classList.add("is-dragging");
	e.dataTransfer.effectAllowed = "move";
}, true);
document.addEventListener("dragover", (e) => {
	if (draggedHomeSection && e.target?.closest?.("[data-dashboard-row]")) e.preventDefault();
}, true);
document.addEventListener("drop", (e) => {
	const row = e.target?.closest?.("[data-dashboard-row]");
	if (!row || !draggedHomeSection) return;
	e.preventDefault();
	handleDashboardReorder(draggedHomeSection, row.dataset.dashboardRow);
	draggedHomeSection = "";
}, true);
document.addEventListener("dragend", () => {
	document.querySelector(".settings-sort-row.is-dragging")?.classList.remove("is-dragging");
	draggedHomeSection = "";
}, true);

export function handleAppearanceSelect(kind, value) {
	const keys = { accent: "impala67Accent", density: "impala67Density", motion: "impala67Motion", fontsize: "impala67FontSize", overlearn: "impala67Overlearn", confidence: "impala67Confidence", telemetry: "impala67Telemetry" };
	if (!keys[kind]) return;
	localStorage.setItem(keys[kind], value);
	applyAppearance();
	openSettings(S.settingsSection === "ai" ? "ai" : "appearance");
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
	navigateSettings,
	requestCloseSettings,
	discardSettingsDraft,
	updateSettingsSearch,
	refreshSettingsDirtyState,
	refreshDriveStatusUi,
	refreshCloudflareStatusUi,
	hasUnsavedSettings,
	SETTINGS_SECTIONS,
	handleNotionSync,
	handleNotionCancel,
	handleDriveLogin,
	handleDriveLogout,
	handleDriveSyncSettings,
	startAutoDriveSync,
	handleCfConnect,
	handleCfDisconnect,
	handleCfSyncNow,
	handleCfGenKey,
	handleCfCopyKey,
	handleCfPurge,
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
	handleSyncSecretsToggle,
	handleDriveAutoSyncMinutes,
	handleDriveSyncAfterChange,
	handleClearBg,
	handleResetAll,
	handleDriveSync,
	handleBackupNow,
	handleThemeSelect,
	handleSystemThemeToggle,
	handleAppearanceSelect,
	handleDashboardToggle,
	handleDashboardMove,
	handleDashboardReorder,
	handleDashboardAdd,
	homeLayout,
	HOME_SECTIONS,
	handleFileBgChange,
	handleImportChange,
	updateLocalEmbeddingManagerUi,
	handleEnableLocalEmbedding,
	handleDownloadLocalEmbedding,
	handleDeleteLocalEmbedding
};

document.addEventListener("change", (e) => {
	if (e.target && e.target.id === "inpEmbed") {
		updateLocalEmbeddingManagerUi();
	}
});
