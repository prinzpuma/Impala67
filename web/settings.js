"use strict";

import { S, STATE, favModels } from "./state.js";
import { U } from "./util.js";
import { DB } from "./db.js";
import { AI } from "./ai.js";
import { RAG } from "./rag.js";
import { BUS } from "./event-bus.js";
import { DRIVE } from "./drive.js";
import { HANDSCHRIFT } from "./handschrift.js";
import { TABS } from "./tabs.js";
import { SETTINGS_SYNC } from "./settings-sync.js";
import { normalizeDriveSyncMinutes } from "./drive-sync-policy.js";
import { SETTINGS_LAST_SECTION_KEY, SETTINGS_SECTIONS, resolveSettingsSection, valuesSnapshot, valuesAreDirty, BREAK_REMINDER_KEY } from "./settings-schema.js";
import { renderSettingsPage, renderSettingsShell, renderSearchResults, hydrateStorageUsage, hydrateDriveStorage, refreshDriveStatusUi, refreshCloudflareStatusUi, renderSettingsModelList, localEmbeddingStatusView } from "./settings-renderer.js";
import { backupActionState, updateActionState } from "./settings-action-state.js";
import { CLOUDFLARE_SYNC } from "./sync-cloudflare.js";
import { PLATFORM_NATIVE } from "./platform-native.js";
import * as UI from "./settings-ui.js";
import { EMBEDDINGS, LOCAL_EMBED_MODEL_ID } from "./embedding.js";
import { HEFT_INDEX_PROGRESS } from "./heft-index-progress.js";
import { lead } from "./icons.js";

const renderStatusDot = () => BUS.emit("ui:render-status-dot");
const render = (opts) => BUS.emit("ui:render", opts);
const closeOverlay = (el) => BUS.emit("ui:close-overlay", el);
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
// Akzent als RGB-Tripel je Theme. Hell ist kräftiger, damit Weiß darauf mind. 4,5:1 Kontrast hat.
const ACCENT_THEMES = {
	blue:   { dark: "107 140 174", light: "36 120 199" },
	violet: { dark: "143 130 169", light: "124 113 147" },
	green:  { dark: "110 140 117", light: "98 125 105" },
	orange: { dark: "176 127 89", light: "151 109 77" },
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
	const isLight = theme === "light";
	document.body.classList.toggle("light", theme === "light");
	document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
		m.content = theme === "light" ? "#f2efe9" : "#05070d";
	});
	document.body.classList.toggle("density-compact", density === "compact");
	document.body.classList.toggle("perf-mode", motion === "reduced");
	const tabsPos = localStorage.getItem("impala67TabsPosition") || "top";
	document.body.classList.toggle("tabs-in-sidebar", tabsPos === "sidebar");
	const fontSize = localStorage.getItem("impala67FontSize") || "m";
	document.body.classList.toggle("font-s", fontSize === "s");
	document.body.classList.toggle("font-l", fontSize === "l");
	document.body.classList.toggle("beta-ui", localStorage.getItem("impala67BetaUi") !== "0");
	// Alle vier Werte inline am body: --accent aus :root wäre sonst mit dem Dunkel-Akzent festgelegt.
	const rgb = isLight ? accent.light : accent.dark;
	document.body.style.setProperty("--accent-rgb", rgb);
	document.body.style.setProperty("--accent", `rgb(${rgb})`);
	document.body.style.setProperty("--accent-soft", isLight ? `color-mix(in srgb, rgb(${rgb}) 15%, #fff)` : `rgb(${rgb} / .14)`);
	document.body.style.setProperty("--accent-border", `rgb(${rgb} / ${isLight ? ".36" : ".25"})`);
}

export function applyTheme() { applyAppearance(); }

export { BREAK_REMINDER_KEY };

export function getBreakReminder() {
	const val = localStorage.getItem(BREAK_REMINDER_KEY);
	if (val === null || val === undefined || val === "") return true;
	return val !== "off" && val !== "false" && val !== "0";
}

export function setBreakReminder(enabled) {
	const on = typeof enabled === "boolean" ? enabled : enabled !== "off" && enabled !== "false" && enabled !== "0";
	localStorage.setItem(BREAK_REMINDER_KEY, on ? "on" : "off");
	return on;
}

export const isBreakReminderEnabled = getBreakReminder;


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
		tabsPosition: localStorage.getItem("impala67TabsPosition") || "top",
		betaUi: localStorage.getItem("impala67BetaUi") !== "0",
		isNative: PLATFORM_NATIVE.isNative,
		nativeHapticsEnabled: localStorage.getItem("impala67NativeHaptics") !== "0",
		nativeScannerAvailable: PLATFORM_NATIVE.scanner.isAvailable,
		nativeScannerEnabled: PLATFORM_NATIVE.scanner.isEnabled(),
		nativeFilesystemAvailable: PLATFORM_NATIVE.isNative,
		nativeFilesystemEnabled: localStorage.getItem("impala67NativeFsBackup") !== "0",
		breakReminder: getBreakReminder(),
	};
}

function focusSettingsAnchor(anchor) {
	if (!anchor) return;
	queueMicrotask(() => {
		const target = document.getElementById(anchor);
		if (!target) return;
		target.closest("details")?.setAttribute("open", "");
		target.scrollIntoView({ block: "center", behavior: "smooth" });
		target.classList.add("settings-highlight");
		setTimeout(() => target.classList.remove("settings-highlight"), 1800);
	});
}

export function openSettings(section, anchor) {
	const stored = localStorage.getItem(SETTINGS_LAST_SECTION_KEY);
	const resolved = resolveSettingsSection(section || stored || "overview");
	const legacyAnchor = { ki: "ai-models", home: "home-name", look: "theme", backup: "backup", update: "updates", controller: "controller-status", devices: "controller-status", experimente: "learning-beta", pause: "break-reminder", lernzeit: "break-reminder" }[section];
	const previousSec = S.settingsSection;
	S.settingsSection = resolved;
	localStorage.setItem(SETTINGS_LAST_SECTION_KEY, resolved);
	const overlay = U.el("overlay");
	if (!overlay) return;
	const isMobile = document.body.classList.contains("mobile-ui");
	const existingModal = !overlay.hidden ? overlay.querySelector(".settings-modal-v2") : null;
	const isExistingMobile = existingModal ? existingModal.classList.contains("is-mobile") : false;

	if (existingModal && isExistingMobile === isMobile) {
		const previousMain = existingModal.querySelector(".settings-main");
		const keepScroll = previousMain ? previousMain.scrollTop : 0;
		// Aufgeklappte Abschnitte bleiben beim Neuzeichnen desselben Bereichs offen.
		const openDisclosures = previousSec === resolved && previousMain
			? Array.from(previousMain.querySelectorAll("details[open] > summary b"), (b) => b.textContent) : [];
		const fillMain = (main, html) => {
			main.innerHTML = html;
			main.querySelectorAll("details > summary b").forEach((b) => { if (openDisclosures.includes(b.textContent)) b.closest("details").open = true; });
			if (keepScroll && previousSec === resolved) main.scrollTop = keepScroll;
			else if (!anchor && !legacyAnchor) main.scrollTop = 0;
		};
		existingModal.setAttribute("data-sec", resolved);

		if (isMobile) {
			const isOverview = !resolved || resolved === "overview";
			const secMeta = SETTINGS_SECTIONS.find(s => s.id === resolved) || { label: "Einstellungen" };
			const head = existingModal.querySelector(".settings-mobile-head");
			if (head) {
				head.innerHTML = isOverview
					? '<h1>Einstellungen</h1><button type="button" class="settings-mobile-done" id="btnCloseSettings">Fertig</button>'
					: '<button type="button" class="settings-mobile-back" data-settings-go="overview">‹ Zurück</button><h2>' + U.esc(secMeta.label) + '</h2><button type="button" class="settings-mobile-done" id="btnCloseSettings">Fertig</button>';
			}
			const main = existingModal.querySelector(".settings-main");
			if (main) {
				const searchBar = isOverview
					? '<label class="settings-search">' + UI.icon("search") + '<input id="settingsSearch" type="search" autocomplete="off" placeholder="Einstellungen suchen…" value="' + U.esc(settingsSearchQuery) + '" aria-label="Einstellungen durchsuchen"></label><div id="settingsSearchResults" class="settings-search-results" hidden></div>'
					: '';
				fillMain(main, searchBar + renderSettingsPage(resolved, settingsViewModel()));
			}
		} else {
			existingModal.querySelectorAll(".settings-nav-item").forEach((btn) => {
				const active = btn.dataset.settingsGo === resolved;
				btn.classList.toggle("active", active);
				btn.setAttribute("aria-current", active ? "page" : "false");
			});
			const main = existingModal.querySelector(".settings-main");
			if (main) fillMain(main, renderSettingsPage(resolved, settingsViewModel()));
		}
	} else {
		overlay.hidden = false;
		overlay.innerHTML = renderSettingsShell(resolved, renderSettingsPage(resolved, settingsViewModel()), settingsSearchQuery);
	}

	settingsDraftInitial = valuesSnapshot(explicitSettingsValues());
	refreshSettingsDirtyState();
	focusSettingsAnchor(anchor || legacyAnchor);
	hydrateStorageUsage();
	hydrateDriveStorage();
	if (resolved === "ai") {
		renderStatusDot();
		queueMicrotask(() => {
			refreshChatModels();
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

export async function handleCfConnect(t) {
	const urlEl = document.getElementById("inpCfUrl");
	const keyEl = document.getElementById("inpCfKey");
	const url = urlEl ? urlEl.value.trim() : String(S.settings.cfUrl || "").trim();
	const syncKey = keyEl ? keyEl.value.trim() : String(S.settings.cfSyncKey || "").trim();

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
		await STATE.dispatch("settingsSet", { cfUrl: url, cfSyncKey: syncKey });
		U.toast("Cloudflare Echtzeit-Sync erfolgreich verbunden!", "success");
	} else {
		U.toast("Verbindung fehlgeschlagen. Prüfe URL und Konfiguration.", "error");
	}
	refreshCloudflareStatusUi();
}

export async function handleCfPrimaryAction(t) {
	const cf = CLOUDFLARE_SYNC.status();
	if (cf.status === "connected") {
		await handleCfSyncNow(t);
		return;
	}
	const url = document.getElementById("inpCfUrl")?.value.trim() || cf.url || S.settings.cfUrl;
	const key = document.getElementById("inpCfKey")?.value.trim() || cf.syncKey || S.settings.cfSyncKey;
	if (!url || !key) {
		const missing = document.getElementById(url ? "inpCfKey" : "inpCfUrl");
		if (missing) {
			missing.focus();
			U.toast(url ? "Bitte Sync-Schlüssel eintragen oder generieren." : "Bitte Cloudflare Worker URL eintragen.", "warn");
			return;
		}
		openSettings("sync", "cf-sync");
		return;
	}
	await handleCfConnect(t);
}

export async function handleCfDisconnect() {
	CLOUDFLARE_SYNC.disconnect();
	await STATE.dispatch("settingsSet", { cfUrl: "", cfSyncKey: "" });
	U.toast("Cloudflare-Sync getrennt.", "neutral");
	refreshCloudflareStatusUi();
}

// PERF: QR-Erzeugung/-Scanner (~25 KB) erst beim Koppeln laden, nicht bei jedem Start.
export async function handleCfPairing() {
	const cf = CLOUDFLARE_SYNC.status();
	const url = cf.url || document.getElementById("inpCfUrl")?.value.trim();
	const key = cf.syncKey || document.getElementById("inpCfKey")?.value.trim();

	if (!url || !key) {
		U.toast("Bitte zuerst eine Worker-URL und einen Sync-Schlüssel eintragen.", "warn");
		return;
	}

	const payload = btoa(unescape(encodeURIComponent(JSON.stringify({ url, key }))));
	const baseAppUrl = location.origin + location.pathname;
	const pairingLink = `${baseAppUrl}#cf-pair=${payload}`;
	const { generateQrSvg } = await import("./qrcode.js");
	const qrSvg = generateQrSvg(pairingLink, 220);

	const modalHtml = `
		<div class="exp-modal-backdrop" id="cfPairModal" style="display:flex;align-items:center;justify-content:center;position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:99999;padding:16px;">
			<div class="card" style="max-width:440px;width:100%;background:var(--bg-card, #1e1e2e);color:var(--text, #fff);padding:24px;border-radius:16px;box-shadow:0 12px 36px rgba(0,0,0,0.6);text-align:center;">
				<h3 style="margin-top:0;margin-bottom:8px;">${lead("phone")}Gerät automatisch koppeln</h3>
				<p style="font-size:0.88rem;opacity:0.85;margin-bottom:16px;line-height:1.4;">Scanne diesen QR-Code mit der Impala67-App auf deinem Smartphone/Tablet (unter <em>Einstellungen → Sync → QR-Code scannen</em>).</p>
				<div style="margin:16px auto;display:flex;justify-content:center;">${qrSvg}</div>
				<div style="margin-top:20px;display:flex;flex-direction:column;gap:8px;">
					<button type="button" id="btnCopyPairLink" class="btn" style="width:100%;">${lead("link")}Kopplungs-Link kopieren</button>
					<button type="button" id="btnClosePairModal" class="btn secondary" style="width:100%;">Schließen</button>
				</div>
			</div>
		</div>
	`;

	document.body.insertAdjacentHTML("beforeend", modalHtml);

	document.getElementById("btnCopyPairLink")?.addEventListener("click", async () => {
		try {
			await navigator.clipboard.writeText(pairingLink);
			U.toast("Kopplungs-Link kopiert! Sende ihn an dein Smartphone (z. B. via Notizen/Mail).", "success");
		} catch {
			U.toast("Kopieren nicht möglich. Bitte manuell teilen.", "warn");
		}
	});

	const closeModal = () => document.getElementById("cfPairModal")?.remove();
	document.getElementById("btnClosePairModal")?.addEventListener("click", closeModal);
	document.getElementById("cfPairModal")?.addEventListener("click", (e) => {
		if (e.target.id === "cfPairModal") closeModal();
	});
}

export async function handleCfScanPairing() {
	const { openQrScanner } = await import("./qr-scanner.js");
	await openQrScanner(async (data) => {
		if (!data?.url || !data?.key) {
			U.toast("Ungültige Verbindungsdaten im QR-Code.", "error");
			return;
		}
		const urlEl = document.getElementById("inpCfUrl");
		const keyEl = document.getElementById("inpCfKey");
		if (urlEl) urlEl.value = data.url;
		if (keyEl) keyEl.value = data.key;

		U.toast("Kopplungscode erkannt. Verbinde…", "neutral");
		const success = await CLOUDFLARE_SYNC.configure(data.url, data.key);
		if (success) {
			await STATE.dispatch("settingsSet", { cfUrl: data.url, cfSyncKey: data.key });
			U.toast("Cloudflare-Sync erfolgreich gekoppelt!", "success");
		} else {
			U.toast("Verbindung fehlgeschlagen. Bitte URL und Schlüssel prüfen.", "error");
		}
		refreshCloudflareStatusUi();
	});
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
		U.toast("Sync-Fehler: " + ((e && e.message) ? e.message : String(e || "Unbekannter Fehler")), "error");
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
	const generate = document.getElementById("btnCfGenKey");
	const copy = document.getElementById("btnCfCopyKey");
	const pairing = document.getElementById("btnCfPairing");
	if (generate) generate.hidden = true;
	if (copy) copy.hidden = false;
	if (pairing) pairing.hidden = !document.getElementById("inpCfUrl")?.value.trim();
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
	if (details.length) BUS.emit("ui:merge-pending-conflicts", details);
	const n = details.length || conflicts || 0;
	// drive.js hat importierte Events bereits deterministisch in STATE eingespielt;
	// kein location.reload() mehr — Editor, Tabs und Scrollposition bleiben erhalten.
	if (n > 0) {
		U.toast("Sync fertig — " + imported + " Änderungen, " + n + " Konflikt(e).", "error");
		BUS.emit("ui:open-conflict-resolver", 0);
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
	refreshDriveStatusUi();
}

export async function handleDriveSyncSettings(t) {
	await runDriveSync(t, "");
}

export async function handleDrivePrimaryAction(t) {
	const hasId = (window.APP_CONFIG && window.APP_CONFIG.GOOGLE_WEB_CLIENT_ID) || S.settings.driveClientId;
	if (!hasId) {
		openSettings("sync", "sync-advanced");
		return;
	}
	await runDriveSync(t, "");
}

// Automatische Syncs sollen nicht alle zwei Minuten Toasts erzeugen. Nur wenn
// ein anderes Gerät wirklich neue Änderungen geliefert hat oder ein Konflikt
// vorliegt, informieren wir und laden für einen konsistenten Event-Log-Replay neu.
let autoReloadScheduled = false;
function handleAutomaticDriveSync(result) {
	if (!result) return;
	const details = result.conflictDetails || [];
	if (details.length) BUS.emit("ui:merge-pending-conflicts", details);
	if (details.length || result.conflicts) {
		BUS.emit("ui:open-conflict-resolver", 0);
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
	openSettings("ai", "ai-sources");
}

function paintUpdateAction(button, mode, version = "") {
	if (!button) return;
	const state = updateActionState(mode, version);
	button.dataset.updateAction = state.mode;
	button.textContent = state.label;
	button.disabled = !!state.disabled;
}

export async function handleUpdateAction(button) {
	const mode = button?.dataset.updateAction || "check";
	if (mode === "install" || mode === "reload") return handleApplyPwaUpdate(button);
	return handleCheckUpdate(button);
}

export async function handleCheckUpdate(button = U.el("btnPwaUpdateAction")) {
	const status = U.el("updateStatus");
	const localEl = U.el("updateLocalVer");
	const remoteEl = U.el("updateRemoteVer");
	paintUpdateAction(button, "checking");
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
			if (status) status.textContent = "Update v" + r.latest + " verfügbar (du: v" + r.current + "). Tippe „Update laden“.";
			paintUpdateAction(button, "install", r.latest);
			U.toast("Update v" + r.latest + " verfügbar.", "success");
		} else if (r.remoteOlder) {
			if (status) status.textContent = "Bundle v" + r.current + " · Server v" + r.latest +
				" (Server älter — version.json beim Deploy mitbumpen).";
			U.toast("Lokal neuer als Server-Stand.", "success");
			paintUpdateAction(button, "check");
		} else {
			if (status) status.textContent = "Aktuell: v" + (r.current || "?") +
				(r.latest ? " · Server v" + r.latest : "") + ".";
			U.toast("Kein Update nötig.", "success");
			paintUpdateAction(button, "check");
		}
	} catch (e) {
		// FIX iPad: früher window.open(GitHub) → Safari. Nie mehr extern öffnen.
		const msg = (e && e.message) ? e.message : String(e);
		if (status) status.textContent = "Check fehlgeschlagen: " + msg +
			" — du kannst die App trotzdem neu laden.";
		if (remoteEl) remoteEl.textContent = "nicht erreichbar";
		paintUpdateAction(button, "reload");
		U.toast("Update-Check fehlgeschlagen.", "error");
	}
}

export async function handleApplyPwaUpdate(button = U.el("btnPwaUpdateAction")) {
	const status = U.el("updateStatus");
	paintUpdateAction(button, "installing");
	if (status) status.textContent = "Update wird geladen…";
	try {
		if (typeof window.installAppUpdate === "function") {
			await window.installAppUpdate((st) => { if (status) status.textContent = st; });
		} else if (typeof window.applyPwaUpdate === "function") {
			await window.applyPwaUpdate();
		} else {
			location.reload();
		}
	} catch (e) {
		if (status) status.textContent = "Update fehlgeschlagen: " + (e.message || e);
		U.toast("Update fehlgeschlagen.", "error");
		paintUpdateAction(button, "reload");
	}
}

// Zeichnet die Modell-Liste in den offenen KI-Einstellungen (Favoriten oben).
// Nutzt S.availableModels (Cache) — ohne Netz. Nach Laden: refreshChatModels().
export function paintSettingsModels() {
	renderSettingsModelList({
		favSet: favModels(),
		presets: AI.MODEL_PRESETS || [],
	});
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
	BUS.emit("ui:render-model-bar");
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
export const handleProviderTest = (t) => testProviderTestRow(t);
const testProviderTestRow = (t) => testProviderRow(t.dataset.provtest, t);

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
	const modelId = LOCAL_EMBED_MODEL_ID;
	const configured = inpEmbed?.value === "local::" + modelId;

	try {
		const status = await EMBEDDINGS.getLocalStatus(modelId);
		const view = localEmbeddingStatusView({
			configured,
			cached: !!status.cached,
			partial: !!status.partial,
			sizeMb: status.sizeMb || 165,
		});
		statusEl.className = view.statusClass;
		if (msgEl) msgEl.textContent = view.msg;
		if (actionsEl) actionsEl.innerHTML = view.actionHtml;
		if (progress) progress.hidden = true;
	} catch (err) {
		statusEl.className = "settings-status is-warn";
		if (msgEl) msgEl.textContent = "Status konnte nicht ermittelt werden: " + (err.message || err);
	}
}

export async function handleEnableLocalEmbedding() {
	const inpEmbed = U.el("inpEmbed");
	try {
		await STATE.dispatch("settingsSet", { embedProviderId: "local", embedModel: LOCAL_EMBED_MODEL_ID });
		if (inpEmbed) inpEmbed.value = "local::" + LOCAL_EMBED_MODEL_ID;
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
	const modelId = LOCAL_EMBED_MODEL_ID;

	isDownloadingLocalEmbedding = true;
	if (statusEl) statusEl.className = "settings-status is-warn";
	if (actionsEl) actionsEl.innerHTML = '<button type="button" id="btnDownloadLocalEmbedding" class="secondary" disabled>Lädt…</button>';
	if (progress) progress.hidden = false;
	if (fill) fill.style.width = "0%";
	if (msgEl) msgEl.textContent = "Lade Modell-Dateien herunter… Bitte warten.";

	const unsub = EMBEDDINGS.onProgress((p) => {
		if (p.progress !== undefined) {
			const pct = Math.min(100, Math.max(0, Math.round(p.progress)));
			if (fill) fill.style.width = pct + "%";
			const btn = actionsEl?.querySelector("button");
			if (btn) btn.textContent = `Lädt… ${pct}%`;
			if (msgEl) {
				const fileInfo = p.file ? ` (${p.file})` : "";
				msgEl.textContent = `Gesamtfortschritt: ${pct}%${fileInfo}`;
			}
		}
	});

	try {
		await EMBEDDINGS.downloadLocal(modelId);
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
	const modelId = LOCAL_EMBED_MODEL_ID;
	const inpEmbed = U.el("inpEmbed");
	try {
		await EMBEDDINGS.deleteLocal(modelId);
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
	if (g("inpCustomInstructions")) patch.customInstructions = g("inpCustomInstructions").value;
	if (g("inpAlwaysTools")) patch.alwaysSendTools = g("inpAlwaysTools").checked; // Tool-Angebot v3
	await STATE.dispatch("settingsSet", patch);
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

export async function handleDeleteAllCards(t) {
	const cardIds = Object.keys(S.cards || {});
	const deckNames = Object.keys(S.decks || {});
	const count = cardIds.length;
	if (!count && !deckNames.length) {
		U.toast("Keine Karteikarten vorhanden.", "info");
		return false;
	}
	const msg = count
		? "Möchtest du wirklich alle " + count + (count === 1 ? " Karteikarte" : " Karteikarten") + " unwiderruflich löschen?\n\nAlle Karten, Stapel und Lernfortschritte werden gelöscht. Die Löschung wird auch mit deinen anderen Geräten synchronisiert."
		: "Möchtest du wirklich alle Stapel unwiderruflich löschen? Die Löschung wird auch mit deinen anderen Geräten synchronisiert.";
	const ok = await U.confirm(msg, {
		title: "Alle Karteikarten löschen",
		ok: "Alle löschen",
		danger: true,
	});
	if (!ok) return false;

	if (t) {
		t.disabled = true;
		t.textContent = "Lösche Karten…";
	}
	try {
		const deckRoots = deckNames.filter((name) => !name.includes("::"));
		for (const name of deckRoots) {
			await STATE.dispatch("deckDelete", { name });
		}
		for (const id of cardIds) {
			await STATE.dispatch("cardDelete", { id });
		}
		if (S.ankiDeck) S.ankiDeck = null;
		S.reviewShowBack = false;
		S.reviewCardId = null;

		U.toast(count ? count + (count === 1 ? " Karteikarte gelöscht." : " Karteikarten gelöscht.") : "Stapel gelöscht.", "success");
		render();
		return true;
	} catch (err) {
		U.toast("Fehler beim Löschen der Karteikarten: " + err.message, "error");
		if (t) {
			t.disabled = false;
			t.textContent = "Karten löschen";
		}
		return false;
	}
}


export async function handleBackupNow(button) {
	const old = button?.textContent || "";
	if (button) {
		const busy = backupActionState({ busy: true });
		button.textContent = busy.label;
		button.disabled = true;
	}
	try {
		const filename = "impala67-export-" + new Date().toISOString().slice(0, 10) + ".json";
		const json = await DB.exportAll();
		const useNative = PLATFORM_NATIVE.isNative && localStorage.getItem("impala67NativeFsBackup") !== "0";
		if (useNative) {
			const res = await PLATFORM_NATIVE.filesystem.exportBackup(filename, json);
			if (res.success) {
				U.toast(res.shared ? "Backup bereitgestellt." : ("Backup in Gerätespeicher gesichert (" + res.uri + ")"), "success");
			} else if (!res.aborted) {
				U.download(filename, json);
			}
		} else {
			U.download(filename, json);
		}
		localStorage.setItem("impala67LastBackup", new Date().toISOString());
		if (button) button.textContent = backupActionState({ hasBackup: true }).label;
	} catch (error) {
		if (button) button.textContent = old;
		throw error;
	} finally {
		if (button) button.disabled = false;
	}
	if (S.view === "home") render();
	if (document.querySelector(".settings-modal-v2")) openSettings(S.settingsSection);
}

// Begrüßungsname speichert sich selbst (Capture-Muster wie telemetrie.js) und synct als
// normale Einstellung – unabhängig von der Speichern-Leiste.
document.addEventListener("change", (e) => {
	if (!e.target || e.target.id !== "inpHomeName") return;
	STATE.dispatch("settingsSet", { homeUserName: e.target.value.trim() }).then(() => U.toast("Name gespeichert.", "success"));
});
// Tagesartikel (home-article.js): gleiches Muster wie der Begrüßungsname
document.addEventListener("click", (e) => {
	const b = e.target.closest && e.target.closest("[data-topicadd]");
	const input = b && document.getElementById("inpHomeTopics");
	if (!input) return;
	input.value = [input.value.trim(), b.dataset.topicadd].filter(Boolean).join(", ");
	b.remove();
	STATE.dispatch("settingsSet", { homeArticleTopics: input.value }).then(() => U.toast("Themen gespeichert.", "success"));
});
document.addEventListener("change", (e) => {
	const id = e.target && e.target.id;
	if (id === "inpHomeArticle") STATE.dispatch("settingsSet", { homeArticle: e.target.checked });
	else if (id === "inpRelatedPages") STATE.dispatch("settingsSet", { relatedPages: e.target.checked });
	else if (id === "inpHomeTopics") STATE.dispatch("settingsSet", { homeArticleTopics: e.target.value.trim() }).then(() => U.toast("Themen gespeichert.", "success"));
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
	// Treffer gewählt: Suchfeld leeren und Trefferliste schließen
	const search = U.el("settingsSearch");
	if (search) search.value = "";
	updateSettingsSearch("");
	navigateSettings(target.dataset.settingsGo, target.dataset.settingsAnchorTarget || "");
}, true);

export function handleAppearanceSelect(kind, value) {
	const keys = { accent: "impala67Accent", density: "impala67Density", motion: "impala67Motion", fontsize: "impala67FontSize", tabspos: "impala67TabsPosition", tabsposition: "impala67TabsPosition", overlearn: "impala67Overlearn", confidence: "impala67Confidence", telemetry: "impala67Telemetry", breakReminder: BREAK_REMINDER_KEY, impala67BreakReminder: BREAK_REMINDER_KEY, betaUi: "impala67BetaUi" };
	if (!keys[kind]) return;
	localStorage.setItem(keys[kind], value);
	applyAppearance();
	render();
	openSettings(S.settingsSection || "appearance");
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

export function handleExportHandwritingSamples() {
	const count = HANDSCHRIFT.getTrainingSamples ? HANDSCHRIFT.getTrainingSamples().length : 0;
	if (!count) {
		U.toast("Noch keine Trainingsbeispiele gesammelt.");
		return;
	}
	HANDSCHRIFT.shareTrainingSamples().then((weg) => {
		if (weg !== "abgebrochen") U.toast(`${count} Trainingsbeispiele exportiert!`);
	});
}

// Alle Handschrift der App (Striche aller Hefte + Abschreib-Beispiele) als eine JSON-Datei.
export async function handleExportAllInk() {
	const { allInk, deliverExport } = await import("./heft-export.js");
	const data = allInk(S, HANDSCHRIFT.getTrainingSamples ? HANDSCHRIFT.getTrainingSamples() : []);
	if (!data.strokeCount && !data.trainingSamples.length) {
		U.toast("Noch keine Handschrift vorhanden.");
		return;
	}
	const name = "impala67_handschrift_" + new Date().toISOString().slice(0, 10) + ".json";
	const weg = await deliverExport([new File([JSON.stringify(data)], name, { type: "application/json" })]);
	if (weg !== "cancelled") U.toast(`${data.strokeCount} Striche aus ${data.notebooks.length} Heften exportiert`);
}

export async function handleClearHandwritingSamples() {
	const ok = await U.confirm("Möchtest du alle gesammelten Handschrift-Trainingsbeispiele wirklich löschen?",
		{ title: "Trainingsbeispiele löschen", ok: "Löschen", danger: true });
	if (!ok) return;
	HANDSCHRIFT.clearTrainingSamples();
	U.toast("Trainingsbeispiele gelöscht.");
	openSettings(S.settingsSection || "ai");
}

export const SETTINGS = {
	checkAI,
	applyTheme,
	applyAppearance,
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
	handleDriveLogin,
	handleDriveLogout,
	handleDriveSyncSettings,
	handleDrivePrimaryAction,
	startAutoDriveSync,
	handleCfConnect,
	handleCfPrimaryAction,
	handleCfDisconnect,
	handleCfPairing,
	handleCfScanPairing,
	handleCfSyncNow,
	handleCfGenKey,
	handleCfCopyKey,
	handleCfPurge,
	handleAddProvider,
	refreshEmbeddingModels,
	refreshChatModels,
	paintSettingsModels,
	handleApplyCustomModel,
	testProviderRow,
	handleProviderTest,
	handleCheckUpdate,
	handleApplyPwaUpdate,
	handleUpdateAction,
	handleSaveSettings,
	handleSyncSecretsToggle,
	handleDriveAutoSyncMinutes,
	handleDriveSyncAfterChange,
	handleResetAll,
	handleBackupNow,
	handleThemeSelect,
	handleSystemThemeToggle,
	handleAppearanceSelect,
	handleExportHandwritingSamples,
	handleExportAllInk,
	handleClearHandwritingSamples,
	handleEnableLocalEmbedding,
	handleDownloadLocalEmbedding,
	handleDeleteLocalEmbedding,
	handleDeleteAllCards,
	handleImportChange,
	BREAK_REMINDER_KEY,
	getBreakReminder,
	setBreakReminder,
	isBreakReminderEnabled,
};

document.addEventListener("change", (e) => {
	if (e.target && e.target.id === "inpEmbed") {
		updateLocalEmbeddingManagerUi();
	}
});

// Fortschritt der Handschrift-Analyse live nachführen, solange die Einstellungen offen sind
window.addEventListener("impala67:heft-index-progress", () => {
	const el = document.getElementById("handwritingProgress");
	if (el) el.textContent = HEFT_INDEX_PROGRESS.label();
});

BUS.on("ui:open-settings", (arg) => typeof arg === "string" ? openSettings(arg) : openSettings(arg?.section || arg?.tab, arg?.focusKey));

