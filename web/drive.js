"use strict";
import { S, STATE } from "./state.js";
import { DB } from "./db.js";
import { U } from "./util.js";
import { SETTINGS_SYNC } from "./settings-sync.js";
import { driveSyncAfterChange, driveSyncIntervalMs } from "./drive-sync-policy.js";
import { PERF_PROFILER } from "./performance-profiler.js";
import { DRIVE_AUTH_STATE, driveAuthState, driveStatusView, isCurrentDriveAuthRequest } from "./drive-status.js";
import { CORE } from "./rust-core.js";
// Google-Drive-Backup im privaten appDataFolder. Der Ablauf (Dateiindex über die Changes-API,
// Snapshot + Änderungspakete, Dateien, Verdichten, Uhren-Drift, Wiederholungen) läuft im
// Rust-Kern (core/impala-drive, über web/core/). Hier bleiben Anmeldung, Ein-/Ausgabe für den
// Kern (fetch, localStorage, IndexedDB), Timer, Web Lock und Statusanzeige.
export const DRIVE = (() => {
	const SCOPE = "https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/userinfo.email";
	const LS = localStorage;
	// Eine öffentliche Client-ID kann optional mit config.local.js ausgeliefert
	// werden; alternativ wird sie in den Einstellungen pro Gerät hinterlegt.
	const cfg = (k) => window.APP_CONFIG?.[k] || "";
	const webId = () => cfg("GOOGLE_WEB_CLIENT_ID") || S.settings?.driveClientId || "";
	let tokenRequestInFlight = null; // Timer + Sync teilen eine OAuth-Anfrage (nie zwei Popups)
	let authGeneration = 0; // Abmelden macht auch spaet eintreffende OAuth-Antworten wirkungslos.
	let expiryNoticeTimer = 0;
	let syncInFlight = null; // nie zwei Syncs parallel (Sidebar-Button + Einstellungen + Auto)
	let flushMode = false; // pagehide: Uploads mit keepalive absetzen (überleben das Schließen)
	let accountEmail = LS.getItem("impala67_drive_email") || "";
	let sessionKnown = !!(LS.getItem("impala67_drive_token") || accountEmail);
	let authState = DRIVE_AUTH_STATE.DISCONNECTED;
	let syncUi = { state: "idle", label: "", detail: "" };

	// Einmalige Key-Migration (Projekt hieß früher "notion") — Sitzung bleibt erhalten.
	for (const k of ["drive_token", "drive_token_expiry"]) {
		const old = LS.getItem("notion_" + k);
		if (old !== null && LS.getItem("impala67_" + k) === null) LS.setItem("impala67_" + k, old);
		LS.removeItem("notion_" + k);
	}
	// Der GIS-Token-Client liefert keinen Refresh-Token. Altwerte aus dem früheren
	// Desktop-OAuth-Weg dürfen deshalb keine scheinbar aktive Sitzung erzeugen.
	LS.removeItem("notion_drive_refresh_token");
	LS.removeItem("impala67_drive_refresh_token");

	const validSavedToken = () => {
		const t = LS.getItem("impala67_drive_token"), exp = Number(LS.getItem("impala67_drive_token_expiry"));
		return t && exp && Date.now() < exp ? t : null;
	};

	function refreshAuthStateFromStorage() {
		if (authState === DRIVE_AUTH_STATE.CONNECTING) return;
		if (validSavedToken()) sessionKnown = true;
		authState = driveAuthState({
			tokenValid: !!validSavedToken(),
			sessionKnown,
		});
	}
	refreshAuthStateFromStorage();

	function status() {
		refreshAuthStateFromStorage();
		const view = driveStatusView({
			authState,
			syncState: syncUi.state,
			online: navigator.onLine !== false,
			email: accountEmail,
			label: syncUi.label,
			detail: syncUi.detail,
		});
		return {
			...view,
			authState,
			email: accountEmail || null,
			connected: authState === DRIVE_AUTH_STATE.CONNECTED,
			needsLogin: authState === DRIVE_AUTH_STATE.RENEWAL_REQUIRED,
			lastOkAt: LS.getItem("impala67_drive_last_ok") || null,
		};
	}

	function emitCurrentStatus() {
		window.dispatchEvent(new CustomEvent("impala67:sync-status", { detail: status() }));
	}

	function emitSyncStatus(state, label, detail) {
		syncUi = { state, label: label || "", detail: detail || label || "" };
		emitCurrentStatus();
	}

	function setAuthState(next, { resetSync = false } = {}) {
		authState = next;
		if (resetSync) syncUi = { state: "idle", label: "", detail: "" };
		emitCurrentStatus();
	}

	function saveAccountEmail(email) {
		accountEmail = String(email || "").trim();
		if (accountEmail) LS.setItem("impala67_drive_email", accountEmail);
		else LS.removeItem("impala67_drive_email");
	}

	function clearAccessToken(needsLogin) {
		LS.removeItem("impala67_drive_token");
		LS.removeItem("impala67_drive_token_expiry");
		sessionKnown = needsLogin;
		setAuthState(needsLogin ? DRIVE_AUTH_STATE.RENEWAL_REQUIRED : DRIVE_AUTH_STATE.DISCONNECTED, { resetSync: true });
	}

	function saveToken(data) {
		// Tokens bewusst nur in localStorage (pro Gerät), nie ins Event-Log/Export.
		sessionKnown = true;
		LS.setItem("impala67_drive_token", data.access_token);
		LS.setItem("impala67_drive_token_expiry", String(Date.now() + (Number(data.expires_in) || 3600) * 1000 - 60000));
		authState = DRIVE_AUTH_STATE.CONNECTED;
		syncUi = { state: "idle", label: "", detail: "" };
		scheduleExpiryNotice();
		emitCurrentStatus();
	}

	function scheduleExpiryNotice() {
		clearTimeout(expiryNoticeTimer);
		const exp = Number(LS.getItem("impala67_drive_token_expiry"));
		if (!exp) return;
		expiryNoticeTimer = setTimeout(() => {
			if (!validSavedToken()) setAuthState(DRIVE_AUTH_STATE.RENEWAL_REQUIRED, { resetSync: true });
		}, Math.max(1000, exp - Date.now()));
	}

	function getTokenBrowserPopup(generation) {
		return new Promise((resolve, reject) => {
			if (!window.google?.accounts) return reject(new Error("Google-Anmeldung lädt noch oder es besteht keine Internetverbindung. Bitte gleich erneut versuchen."));
			// webId(): kennt auch config.local.js — vorher scheiterte der Notnagel-Weg, wenn die
			// Client-ID nur im Build stand und nicht in den Einstellungen.
			const clientId = webId();
			if (!clientId) return reject(new Error("Keine Google Client-ID hinterlegt (einmalig in Einstellungen → Sync eintragen)."));
			google.accounts.oauth2.initTokenClient({
				client_id: clientId, scope: SCOPE,
				callback: (resp) => {
					if (!isCurrentDriveAuthRequest(generation, authGeneration)) return reject(new Error("Diese Anmeldung wurde bereits verworfen."));
					if (resp?.access_token) {
						const hasScopes = google.accounts.oauth2.hasGrantedAllScopes?.(resp,
							"https://www.googleapis.com/auth/drive.appdata",
							"https://www.googleapis.com/auth/userinfo.email") ?? true;
						if (!hasScopes) {
							reject(new Error("Google-Drive-Zugriff wurde nicht vollständig freigegeben."));
							return;
						}
						saveToken(resp); resolve(resp.access_token); return;
					}
					reject(new Error(resp?.error_description || resp?.error || "Kein Zugriffstoken erhalten."));
				},
				// Ohne diesen Callback blieb die Anmeldung bei geschlossenem oder blockiertem
				// Fenster für immer im Zustand „Verbinde…“ hängen.
				error_callback: (err) => {
					const msg = err?.type === "popup_closed" ? "Google-Anmeldung geschlossen."
						: err?.type === "popup_failed_to_open" ? "Google-Anmeldefenster wurde blockiert."
						: "Google-Anmeldung konnte nicht geöffnet werden.";
					reject(new Error(msg));
				},
			}).requestAccessToken({ prompt: "select_account" });
		});
	}

	// Hintergrund-Syncs öffnen nie ein Google-Fenster: Ohne gültiges Token meldet der Kern
	// „Sitzung abgelaufen“, und erst ein bewusster Klick meldet über authorize() neu an.
	function getTokenBrowser() {
		if (tokenRequestInFlight) return tokenRequestInFlight;
		const generation = ++authGeneration;
		const tracked = getTokenBrowserPopup(generation)
			.finally(() => { if (tokenRequestInFlight === tracked) tokenRequestInFlight = null; });
		tokenRequestInFlight = tracked;
		return tracked;
	}

	async function authorize() {
		if (navigator.onLine === false) {
			emitCurrentStatus();
			throw new Error("Offline – die Google-Anmeldung benötigt eine Internetverbindung.");
		}
		const fallback = authState === DRIVE_AUTH_STATE.RENEWAL_REQUIRED ? DRIVE_AUTH_STATE.RENEWAL_REQUIRED : DRIVE_AUTH_STATE.DISCONNECTED;
		setAuthState(DRIVE_AUTH_STATE.CONNECTING, { resetSync: true });
		let generation = authGeneration;
		try {
			// Ein ausdrücklicher Login öffnet immer die Kontowahl; nur die Erneuerung
			// derselben Sitzung verwendet Googles stilleren Wiederholungsweg.
			const request = getTokenBrowser();
			generation = authGeneration;
			await request;
			if (!isCurrentDriveAuthRequest(generation, authGeneration)) throw new Error("Diese Anmeldung wurde bereits verworfen.");
			// Die E-Mail ist nur Anzeige: Fehler außer einem abgelehnten Token zählen nicht.
			const email = await withCore((core) => core.accountEmail()).catch((error) => {
				if (error?.code === "session-expired") throw error;
				return null;
			});
			if (!isCurrentDriveAuthRequest(generation, authGeneration)) throw new Error("Diese Anmeldung wurde bereits verworfen.");
			if (email) saveAccountEmail(email);
			setAuthState(DRIVE_AUTH_STATE.CONNECTED, { resetSync: true });
			return { email: email || accountEmail || null };
		} catch (error) {
			if (isCurrentDriveAuthRequest(generation, authGeneration) && authState === DRIVE_AUTH_STATE.CONNECTING) {
				authState = fallback;
				emitCurrentStatus();
			}
			throw error;
		}
	}

	const login = () => authorize();
	// Auch die Erneuerung kommt von einem bewussten Klick. Wenn Google keine stille
	// Sitzung mehr kennt, darf deshalb direkt wieder eine Kontowahl erscheinen.
	const renewFromUserGesture = () => authorize();
	const logout = () => {
		authGeneration++;
		tokenRequestInFlight = null;
		clearTimeout(expiryNoticeTimer);
		["token", "token_expiry", "refresh_token"].forEach((k) => LS.removeItem("impala67_drive_" + k));
		saveAccountEmail("");
		sessionKnown = false;
		setAuthState(DRIVE_AUTH_STATE.DISCONNECTED, { resetSync: true });
	};

	// ---------- Ein-/Ausgabe für den Rust-Kern ----------
	// fetch für den Kern: { method, url, headers: [[k, v]], body } → { status, headers, body }.
	const http = {
		async send({ method, url, headers, body }) {
			const init = { method, headers: Object.fromEntries(headers), body };
			// pagehide-Flush: kleine Uploads (typisch das gzip-Delta) mit keepalive absetzen —
			// sie überleben das Tab-Schließen (fetch-keepalive-Limit ~64 KB, daher die Schranke).
			if (flushMode && body && body.byteLength < 60000) init.keepalive = true;
			// Die Konto-E-Mail ist nur Anzeige: nach 8 s aufgeben, statt die Anmeldung hängen zu lassen.
			if (url.includes("/oauth2/") && typeof AbortSignal.timeout === "function") init.signal = AbortSignal.timeout(8000);
			const res = await fetch(url, init);
			return { status: res.status, headers: [...res.headers], body: new Uint8Array(await res.arrayBuffer()) };
		},
	};

	// Token, Zustand (dieselben localStorage-Einträge wie bisher), Event-Log und Dateien.
	const io = {
		// Hintergrund-Syncs öffnen nie ein Fenster: ohne gültiges Token meldet der Kern „Sitzung abgelaufen“.
		accessToken: () => validSavedToken(),
		tokenExpired: () => clearAccessToken(true),
		sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
		// Uhren-Drift gegen Drive: der Log-Merge entscheidet Konflikte per Zeitstempel (LWW).
		setClockOffset: (ms) => U.setClockOffset(ms),
		getItem: (key) => LS.getItem(key),
		setItem: (key, value) => (value === null ? LS.removeItem(key) : LS.setItem(key, value)),
		maxSeq: () => DB.maxSeq(),
		eventsBetween: (after, upTo) => DB.eventsAfterSeqAll(after, upTo),
		async importAll(payload, unsyncedAfterSeq, allowSecrets) {
			const r = await DB.importAll(payload, { unsyncedAfterSeq, pageInfo: (id) => S.pages[id], remote: true, allowSecrets });
			// Sofort anwenden: Scheiterte danach ein Datei-Transfer, lägen die Events sonst im Log und
			// gälten als gelesen, die App zeigte sie aber nie. Offene Hefte brauchen keinen Flush (heft.js).
			if (r.importedEvents?.length) await STATE.applyRemoteEventsCooperative(r.importedEvents);
			return { added: r.added, conflicts: r.conflictDetails || [], merged: r.mergedDetails || [] };
		},
		exportSnapshot: (redactSecrets) => DB.exportAll({ includeBlobs: false, redactSecrets }),
		blobIds: () => DB.allBlobKeys(),
		async getBlob(id) {
			const rec = await DB.getBlob(id);
			let data = rec?.buf || rec?.data;
			if (typeof Blob !== "undefined" && data instanceof Blob) data = await data.arrayBuffer();
			return data ? { meta: rec.meta || {}, data: data instanceof Uint8Array ? data : new Uint8Array(data) } : null;
		},
		putBlob: (id, meta, data) => DB.putBlob(id, data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), meta),
	};

	// Der Kern führt immer nur einen Aufruf zur Zeit aus; alles Weitere wartet in dieser Schlange.
	let driveCore = null, coreQueue = Promise.resolve();
	function withCore(task) {
		const run = coreQueue.then(() => task(driveCore ||= new CORE.DriveCore(http, io)));
		coreQueue = run.catch(() => {});
		return run;
	}
	const allowSecrets = () => SETTINGS_SYNC.allowsSecrets(S.settings);

	async function syncRaw(onStatus) {
		const report = await withCore((core) => core.sync(allowSecrets(), (label) => { emitSyncStatus("syncing", label); onStatus?.(label); }));
		if (report.clockWarningMinutes) {
			U.toast("Die Geräteuhr weicht ~" + report.clockWarningMinutes + " Min von der Serverzeit ab — Sync-Konflikte werden per Zeitstempel entschieden. Bitte Datum/Uhrzeit prüfen.", "error");
		}
		// Verdichten löscht Events → gespeicherter Start-Checkpoint passt nicht mehr.
		try { if (await DB.compactLocalIfDue()) STATE.scheduleCheckpoint(); } catch (e) { console.warn("Event-Log-Kompaktierung übersprungen:", e); }
		emitSyncStatus("ok", report.label);
		return report;
	}

	// [A6] Kurzweg für pagehide: NUR hochladen — kein Pull, kein Lock-Warten, keine Blob-Runde.
	// Alles, was vor dem Upload eine Netz-Rundreise braucht, ist beim Schließen verlorene Zeit; ohne
	// gültiges Token im Speicher ist ohnehin nichts mehr zu retten. Scheitert der Upload (Paket über
	// der keepalive-Schranke von ~64 KB), bleibt der Wasserstand stehen und der nächste Start holt es
	// nach — ein ehrlicher Fehlschlag statt eines Flushs, der nur auf dem Papier stattfindet.
	async function flushUpload() {
		// Ein laufender Sync lädt denselben Bereich gerade selbst hoch.
		if (!isConnected() || syncInFlight) return;
		flushMode = true;
		try { await withCore((core) => core.flushUpload(allowSecrets())); } finally { flushMode = false; }
	}

	// Web Lock gegen Multi-Tab-Races: Datei-Index, known_deltas und uploaded_seq liegen in
	// localStorage — zwei gleichzeitig syncende Tabs überschrieben sich sonst gegenseitig
	// (syncInFlight wirkt nur im eigenen Tab). ifAvailable: der zweite Tab wartet nicht,
	// sein nächster Auto-Sync holt alles nach. Ohne Locks-API: bisheriges Verhalten.
	// Bug-4-Fix: kein ifAvailable — zweiter Tab wartet auf ersten, statt still übersprungen zu werden.
	// Erst NACH dem ersten Sync lädt Tab 2 die frisch hochgeladenen Deltas und ist dann wirklich aktuell.
	const withSyncLock = (fn) => navigator.locks?.request
		? navigator.locks.request("impala67-drive-sync", fn)
		: fn();
	function sync(onStatus) {
		// Laufenden Sync zurückgeben statt Fehler werfen: Doppelklick auf den Sync-Knopf
		// oder überlappende Auto-Syncs teilen sich EIN Ergebnis — kein Aufrufer muss den
		// „läuft bereits“-Fehler behandeln (und keiner vergisst es).
		if (syncInFlight) return syncInFlight;
		const finishProfile = PERF_PROFILER.start("drive.sync", {}, 40);
		syncInFlight = withSyncLock(() => syncRaw(onStatus))
			.then((result) => {
				finishProfile({ imported: result?.imported || 0, uploaded: result?.uploaded || 0 });
				return result;
			})
			.catch((error) => {
				finishProfile({ failed: true, errorName: error?.name || "Error", errorMessage: error?.message || String(error) });
				PERF_PROFILER.error("drive.sync-error", error, { phase: "sync" });
				if (error?.code === "session-expired") setAuthState(DRIVE_AUTH_STATE.RENEWAL_REQUIRED, { resetSync: true });
				else if (authState !== DRIVE_AUTH_STATE.RENEWAL_REQUIRED) {
					emitSyncStatus(navigator.onLine === false ? "waiting" : "error",
						navigator.onLine === false ? "Offline" : "Sync fehlgeschlagen", error?.message);
				}
				throw error;
			})
			.finally(() => { syncInFlight = null; });
		return syncInFlight;
	}

	// Nur ein nachweislich gültiger Token bedeutet „verbunden“. Ein abgelaufener
	// In-Memory-Token oder ein unbrauchbarer Refresh-Altwert darf die UI nicht täuschen.
	const isConnected = () => !!validSavedToken();
	function refreshStatus() {
		refreshAuthStateFromStorage();
		if (navigator.onLine !== false && syncUi.state === "waiting" && syncUi.label.startsWith("Offline")) {
			syncUi = { state: "idle", label: "", detail: "" };
		}
		emitCurrentStatus();
		return status();
	}

	// ---------- Automatischer Drive-Sync ----------
	// Nur nach erfolgter Anmeldung. Erneuerungs-Popups werden zentral gebündelt;
	// Änderungen ebenfalls. Zusätzlich Start/Rückkehr/Intervall-Pulls in sichtbaren Sitzungen.
	const AUTO_DELAY_MS = 3000;
	// [A5] Obergrenze fürs Aufschieben. isEditing() sah bisher nur den FOKUS, nicht das Tippen — ein im
	// Block geparkter Cursor (der Normalfall beim Lesen der eigenen Notizen) hielt die 5-s-Warteschleife
	// beliebig lange am Laufen. Der Status stand dauerhaft auf "Speichert…", die Änderungen lagen
	// unsynchronisiert herum, bis zufällig ein visibilitychange kam.
	const MAX_DEFER_MS = 60000;
	let deferSince = 0, lastKeyAt = 0;
	document.addEventListener("keydown", () => { lastKeyAt = Date.now(); }, true);
	let autoTimer = 0, autoIntervalTimer = 0, autoStarted = false, autoResultHandler = null;
	const isEditing = () => {
		const ae = document.activeElement;
		// .heft-writing (heft.js): aktiver Stift-Strich — das Canvas ist nie activeElement.
		// v8 wäre ein Replay mitten im Strich zwar nicht mehr zerstörerisch (fremde Striche kommen
		// additiv dazu), aber ein Neuzeichnen unter dem laufenden Stift bleibt unschön.
		if (document.querySelector(".heft-writing")) return true;
		if (Date.now() - lastKeyAt > 1500) return false; // [A5] Fokus allein ist keine Eingabe
		return !!(ae && (ae.id === "pageTitle" || ae.classList.contains("blk-input") || ae.classList.contains("db-cell")));
	};

	async function autoSync(reason, force) {
		if (!isConnected()) return null;
		if (navigator.onLine === false) { emitSyncStatus("waiting", "Offline · wartet"); return null; }
		// [F3] Nie Remote-Events mitten in eine Eingabe spielen (überschrieb offene Seiten).
		// background/close (force) flushen sofort — der Nutzer schaut dann nicht hin.
		if (!force && isEditing()) { scheduleAutoSync(reason); return null; }
		if (syncInFlight) return null; // laufender manueller Sync behält seinen eigenen UI-Flow
		try {
			const result = await sync();
			autoResultHandler?.(result, reason);
			return result;
		} catch (e) {
			// Automatik bleibt ruhig; der manuelle Button zeigt Fehler weiterhin an.
			console.warn("Automatischer Drive-Sync (" + reason + ") fehlgeschlagen:", e);
			return null;
		}
	}

	function scheduleAutoSync(reason) {
		if (!isConnected()) return;
		if (!deferSince) deferSince = Date.now(); // [A5] Beginn des Aufschiebens merken
		clearTimeout(autoTimer);
		emitSyncStatus("waiting", navigator.onLine === false ? "Offline · wartet" : "Speichert…");
		autoTimer = setTimeout(() => {
			// Während getippt wird: weiter bündeln, in 5 s erneut prüfen — aber [A5] höchstens
			// MAX_DEFER_MS lang. Danach wird gesynct, egal wo der Cursor gerade steht. Nach v8 ist
			// ein Replay ohnehin additiv, das ursprüngliche Ziel von [F3] bleibt gewahrt.
			if (isEditing() && Date.now() - deferSince < MAX_DEFER_MS) { autoTimer = setTimeout(() => scheduleAutoSync(reason), 5000); return; }
			// force: sonst prüfte autoSync das Tippen erneut und schob mit frischem Start wieder auf.
			deferSince = 0;
			autoSync(reason, true);
		}, AUTO_DELAY_MS);
	}

	function startAutoSync(onResult) {
		if (typeof onResult === "function") autoResultHandler = onResult;
		scheduleExpiryNotice();
		refreshStatus();
		if (autoStarted) return autoSync("start");
		autoStarted = true;
		// Reine UI-Events (Tab-Wechsel) stoßen keinen Sync an — sie wandern mit dem
		// nächsten inhaltlichen/manuellen/Intervall-Sync mit.
		const UI_ONLY_EVENTS = new Set(["uiTabsSet"]);
		const scheduleInterval = () => {
			clearTimeout(autoIntervalTimer);
			autoIntervalTimer = window.setTimeout(tick, driveSyncIntervalMs(S.settings));
		};
		STATE.onAfterDispatch((ev) => {
			if (ev?.type === "settingsSet" && Object.hasOwn(ev.payload || {}, "driveAutoSyncMinutes")) scheduleInterval();
			if (!driveSyncAfterChange(S.settings)) {
				clearTimeout(autoTimer);
				deferSince = 0;
				return;
			}
			if (!ev || !UI_ONLY_EVENTS.has(ev.type)) scheduleAutoSync("change");
		});
		document.addEventListener("visibilitychange", () => document.hidden ? autoSync("background", true) : autoSync("foreground"));
		// [A6] Best-Effort-Flush beim Schließen — jetzt über den Kurzweg. Vorher lief hier der VOLLE
		// syncRaw: Web Lock (ohne ifAvailable, kann also warten), getToken, listSyncFiles, Snapshot-
		// und Delta-Downloads, Blob-Runde. Der Browser friert das Dokument nach pagehide binnen
		// Millisekunden ein — der keepalive-Upload in uploadNamed wurde praktisch nie erreicht.
		// Der versprochene Flush fand faktisch nicht statt. visibilitychange→hidden deckt den
		// Regelfall ohnehin schon vollständig ab; das hier ist die letzte Rettung.
		window.addEventListener("pagehide", () => { flushUpload().catch((e) => PERF_PROFILER.error("drive-flush-error", e)); });
		const tick = () => {
			if (!document.hidden) autoSync("interval");
			scheduleInterval();
		};
		scheduleInterval();
		return autoSync("start");
	}

	// Speicheranzeige: Belegung des Google-Kontos plus der Anteil des privaten App-Ordners.
	// Nur mit gültigem Token — eine Anzeige ist nie Grund für ein Anmeldefenster.
	async function storageInfo() {
		if (!validSavedToken()) return null;
		return withCore((core) => core.storageInfo());
	}

	return { login, renewFromUserGesture, logout, sync, isConnected, status, refreshStatus, startAutoSync, storageInfo };
})();
