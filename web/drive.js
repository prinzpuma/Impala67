"use strict";
import { S, STATE } from "./state.js";
import { DB } from "./db.js";
import { U } from "./util.js";
import { shouldUploadDelta, unseenRemoteFiles, newestFile, encodeJson, decodeJson, sha256Hex, boundedKnownIds } from "./sync-core.js";
// drive.js — Google-Drive-Sync über den unsichtbaren App-Speicher (appDataFolder).
// Technischer Hintergrund: Google verlangt für JEDE App eine registrierte OAuth
// Client-ID (das ist eine Plattform-Vorgabe von Google, keine Impala67-Beschränkung).
//
// Browser/PWA: Popup-Login über Googles Identity-Bibliothek, Client-ID kommt aus
// den Einstellungen → Sync.
//
// Desktop-App (Tauri): Popups funktionieren dort nicht — Google blockiert OAuth
// grundsätzlich in eingebetteten Webviews. Stattdessen läuft der offizielle
// Loopback-Flow für installierte Apps (RFC 8252): System-Browser öffnen, Antwort
// über einen kurzen lokalen Server auffangen (siehe getTokenDesktop). Dafür ist
// ein SEPARATER Google-OAuth-Client vom Typ "Desktop-App" nötig (Zugangsdaten
// kommen aus web/config.local.js, nicht der Web-Client aus den Einstellungen).
export const DRIVE = (() => {
	const SCOPE = "https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/userinfo.email";
	const FILE_NAME = "impala67-sync.json";
	const LEGACY_FILE_NAME = "notion-sync.json"; // Altformat bleibt lesbar
	const SNAPSHOT_NAME = "impala67-snapshot-v2.json.gz";
	const DELTA_PREFIX = "impala67-delta-v2-";
	const BLOB_PREFIX = "impala67-blob-v2-";
	const DEVICE_ID = (() => {
		let id = localStorage.getItem("impala67_drive_device_id");
		if (!id) { id = crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2); localStorage.setItem("impala67_drive_device_id", id); }
		return id;
	})();
	// Desktop-OAuth-Client (Typ "Desktop-App", Google Cloud Console). Das Secret
	// ist bei diesem App-Typ laut Google kein echtes Geheimnis (installierte Apps
	// können ohnehin keine Geheimnisse wahren) — normaler, vorgesehener Fall.
	// Werte kommen aus web/config.local.js (lokal, NICHT im Git-Repo — siehe .gitignore).
	// Bei GitHub-Actions-Builds wird diese Datei automatisch aus Repo-Secrets erzeugt.
	// FIX: lazy lesen statt beim Modul-Import — config.local.js wird seit dem
	// Start-Bug-Fix asynchron/optional geladen; zum Import-Zeitpunkt wäre
	// window.APP_CONFIG evtl. noch nicht gesetzt (Race Condition).
	// FIX: Fallback auf die in den Einstellungen (⚙️ → Sync) hinterlegte ID — für
	// Builds, in denen config.local.js fehlt oder leer ist (kein Neu-Build nötig).
	const desktopClientId = () => (window.APP_CONFIG && window.APP_CONFIG.GOOGLE_DESKTOP_CLIENT_ID) || (S.settings && S.settings.driveDesktopClientId) || "";
	// FIX (Login-Bug „client_secret is missing“): Google verlangt bei „Desktop-App“-Clients
	// das client_secret beim Token-Tausch AUCH mit PKCE — das weicht vom OAuth-Standard ab,
	// ist aber Googles dokumentiertes Verhalten. Bei installierten Apps gilt das Secret laut
	// Google ausdrücklich NICHT als geheim, es darf also in der App/Config liegen.
	const desktopClientSecret = () => (window.APP_CONFIG && window.APP_CONFIG.GOOGLE_DESKTOP_CLIENT_SECRET) || (S.settings && S.settings.driveDesktopClientSecret) || "";
	// FIX (Diagnose invalid_client): zeigt bei einem fehlgeschlagenen Token-Tausch, AUS WELCHER
	// QUELLE ID/Secret tatsächlich stammen (config.local.js vs. alter Einstellungen-Fallback) —
	// sonst ist bei einem falschen/veralteten Secret nicht sichtbar, ob der Build config.local.js
	// überhaupt einliest oder unbemerkt auf einen alten, manuell eingetragenen Wert zurückfällt.
	const desktopClientIdSource = () => (window.APP_CONFIG && window.APP_CONFIG.GOOGLE_DESKTOP_CLIENT_ID) ? "config.local.js" : (S.settings && S.settings.driveDesktopClientId) ? "Einstellungen (alter Fallback!)" : "keine Quelle";
	const desktopClientSecretSource = () => (window.APP_CONFIG && window.APP_CONFIG.GOOGLE_DESKTOP_CLIENT_SECRET) ? "config.local.js" : (S.settings && S.settings.driveDesktopClientSecret) ? "Einstellungen (alter Fallback!)" : "keine Quelle";
	let token = null;
	// Ein Sync darf pro App-Instanz nur einmal gleichzeitig laufen. Ohne diese
	// Sperre können der Sidebar-Button und der Einstellungen-Button parallel
	// denselben Remote-Stand lesen und anschließend gegeneinander hochladen.
	let syncInFlight = null;

	// Einmalige Übernahme der alten LocalStorage-Schlüssel (Projekt hieß früher "notion") —
	// so bleibt die bestehende Google-Sitzung nach der Umbenennung erhalten.
	["drive_token", "drive_token_expiry", "drive_refresh_token"].forEach((k) => {
		const old = localStorage.getItem("notion_" + k);
		if (old !== null && localStorage.getItem("impala67_" + k) === null) localStorage.setItem("impala67_" + k, old);
		localStorage.removeItem("notion_" + k);
	});

	function base64url(buffer) {
		return btoa(String.fromCharCode(...new Uint8Array(buffer)))
			.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
	}

	async function pkcePair() {
		const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)).buffer);
		const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
		return { verifier, challenge: base64url(digest) };
	}

	async function exchangeCode(code, verifier, redirectUri) {
		const res = await fetch("https://oauth2.googleapis.com/token", {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				code, client_id: desktopClientId(),
				// Google-Eigenheit: client_secret ist beim Desktop-Client auch mit PKCE Pflicht.
				...(desktopClientSecret() ? { client_secret: desktopClientSecret() } : {}),
				redirect_uri: redirectUri, grant_type: "authorization_code", code_verifier: verifier,
			}),
		});
			// FIX (Audit): Fehlertext nicht ungefiltert weiterreichen (könnte Token-Fragmente enthalten)
		if (!res.ok) {
			const raw = (await res.text()).slice(0, 200);
			const safe = raw.replace(/[A-Za-z0-9_\-]{20,}/g, "[…]").replace(/GOCSPX-[A-Za-z0-9_\-]+/g, "[secret]");
			// FIX (Diagnose invalid_client): zusätzlich sichtbar machen, aus welcher Quelle ID/Secret
			// kamen und wie lang das Secret ist (ohne den Wert selbst offenzulegen) — beim nächsten
			// Fehlschlag sieht man dadurch sofort, ob z.B. config.local.js im Build fehlt und die App
			// unbemerkt auf den alten Einstellungen-Fallback zurückfällt.
			const diag = "Client-ID-Quelle: " + desktopClientIdSource() + ", Secret-Quelle: " + desktopClientSecretSource() + ", Secret-Länge: " + desktopClientSecret().length;
			throw new Error("Token-Tausch fehlgeschlagen: " + safe + " — [" + diag + "]");
		}
		return res.json();
	}

	async function refreshDesktopToken(refreshToken) {
		const res = await fetch("https://oauth2.googleapis.com/token", {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				client_id: desktopClientId(),
				...(desktopClientSecret() ? { client_secret: desktopClientSecret() } : {}),
				refresh_token: refreshToken, grant_type: "refresh_token",
			}),
		});
		if (!res.ok) return null;
		return res.json();
	}

	function saveToken(data) {
		// Access-/Refresh-Token bewusst nur in localStorage (pro Gerät), nie ins Event-Log/Export.
		// Klartext ist bei installierten Apps/Browser-Storage üblich; Logout entfernt alle drei Keys.
		token = data.access_token;
		const expiresIn = data.expires_in ? Number(data.expires_in) : 3600;
		localStorage.setItem("impala67_drive_token", token);
		localStorage.setItem("impala67_drive_token_expiry", String(Date.now() + expiresIn * 1000 - 60000));
		if (data.refresh_token) localStorage.setItem("impala67_drive_refresh_token", data.refresh_token);
	}

	// Desktop-App (Tauri): System-Browser + lokaler Redirect-Server statt Popup.
	async function getTokenDesktop(interactive) {
		const refreshToken = localStorage.getItem("impala67_drive_refresh_token");
		if (refreshToken) {
			const data = await refreshDesktopToken(refreshToken);
			if (data && data.access_token) {
				saveToken(data);
				return token;
			}
		}
		if (!interactive) throw new Error("Keine gültige Sitzung — bitte einmal manuell mit Google anmelden.");
		// Ohne Desktop-Client-ID würde Google nur kryptisch mit „Fehler 400: invalid_request —
		// Missing required parameter: client_id" antworten — hier klar abfangen und erklären.
		if (!desktopClientId()) {
			throw new Error("Google-Login nicht möglich: Die Desktop-Client-ID fehlt. Trage sie einmalig unter ⚙️ Einstellungen → Sync ein (OAuth-Client Typ „Desktop-App“ aus der Google Cloud Console) — oder befülle web/config.local.js und baue die App neu.");
		}
		// Frühzeitig klar melden statt Googles kryptischem „client_secret is missing“ nach dem Redirect.
		if (!desktopClientSecret()) {
			throw new Error("Google-Login nicht möglich: Das Desktop-Client-Secret fehlt (Google verlangt es für Desktop-Clients auch mit PKCE). Trage es einmalig unter ⚙️ Einstellungen → Sync ein — es steht in der Google Cloud Console direkt beim Desktop-OAuth-Client (GOCSPX-…).");
		}

		const { verifier, challenge } = await pkcePair();
		const port = await window.__TAURI__.core.invoke("start_oauth_server");
		const redirectUri = "http://localhost:" + port;
		const authUrl = "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({
			client_id: desktopClientId(),
			redirect_uri: redirectUri,
			response_type: "code",
			scope: SCOPE,
			access_type: "offline",
			prompt: "consent",
			code_challenge: challenge,
			code_challenge_method: "S256",
		});

		const codePromise = new Promise((resolve, reject) => {
			// FIX (Verbesserung): brach der Nutzer den Login im Browser ab, wartete dieses
			// Promise für immer und der lokale Redirect-Server lief weiter — nach 2 Minuten
			// aufgeben und den Server aufräumen.
			const timer = setTimeout(() => {
				window.__TAURI__.core.invoke("cancel_oauth_server", { port }).catch(() => {});
				reject(new Error("Google-Login abgebrochen: keine Antwort innerhalb von 2 Minuten. Bitte erneut versuchen."));
			}, 120000);
			window.__TAURI__.event.once("redirect_uri", (event) => {
				clearTimeout(timer);
				try {
					const url = new URL(event.payload);
					const err = url.searchParams.get("error");
					const code = url.searchParams.get("code");
					if (err) return reject(new Error("Google-Login abgebrochen: " + err));
					if (!code) return reject(new Error("Kein Code in der Antwort erhalten."));
					resolve(code);
				} catch (e) { reject(e); }
			});
		});

		await window.__TAURI__.shell.open(authUrl);
		const code = await codePromise;
		window.__TAURI__.core.invoke("cancel_oauth_server", { port }).catch(() => {});
		saveToken(await exchangeCode(code, verifier, redirectUri));
		return token;
	}

	// Browser/PWA: der bisherige Popup-Flow über Googles Identity-Bibliothek.
	function getTokenBrowser(interactive) {
		return new Promise((resolve, reject) => {
			if (!window.google || !google.accounts) {
				return reject(new Error("Google-Script nicht geladen (Internet nötig)."));
			}
			const clientId = S.settings.driveClientId;
			if (!clientId) return reject(new Error("Keine Google Client-ID hinterlegt (einmalig in Einstellungen → Sync eintragen)."));
			const tc = google.accounts.oauth2.initTokenClient({
				client_id: clientId,
				scope: SCOPE,
				callback: (resp) => {
					if (resp.access_token) {
						saveToken(resp);
						resolve(token);
					}
					else reject(new Error("Kein Zugriffstoken erhalten."));
				},
			});
			// prompt: "" versucht einen stillen Login im Hintergrund, falls die Zustimmung bereits erteilt wurde
			tc.requestAccessToken({ prompt: interactive ? "consent" : "" });
		});
	}

	function getToken(interactive) {
		// Bereits gültiges Token im LocalStorage? Gilt für beide Wege gleich.
		const savedToken = localStorage.getItem("impala67_drive_token");
		const savedExpiry = localStorage.getItem("impala67_drive_token_expiry");
		if (savedToken && savedExpiry && Date.now() < Number(savedExpiry)) {
			token = savedToken;
			return Promise.resolve(token);
		}
		return window.__TAURI__ ? getTokenDesktop(interactive) : getTokenBrowser(interactive);
	}

	async function fetchUserInfo() {
		try {
			const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
				headers: { Authorization: "Bearer " + token },
			});
			if (!res.ok) return null;
			return res.json();
		} catch {
			return null;
		}
	}

	// Ein-Klick-Login: holt Token + Nutzerinfos (E-Mail) in einem Rutsch.
	async function login() {
		// Bei manuellem Klick auf "Anmelden" erzwingen wir die Prüfung (interactive = true)
		await getToken(true);
		return fetchUserInfo();
	}

	function logout() {
		token = null;
		localStorage.removeItem("impala67_drive_token");
		localStorage.removeItem("impala67_drive_token_expiry");
		localStorage.removeItem("impala67_drive_refresh_token");
	}

	async function api(path, opts = {}) {
		const res = await fetch("https://www.googleapis.com" + path, {
			...opts,
			headers: { Authorization: "Bearer " + token, ...(opts.headers || {}) },
		});
		if (!res.ok) {
			throw new Error("Drive-Fehler " + res.status + ": " + (await res.text()).slice(0, 200));
		}
		return res;
	}

	async function findFile() {
		// Auch die Alt-Datei (vor der Umbenennung) finden — der nächste Upload benennt sie
		// über die PATCH-Metadaten automatisch auf den neuen Namen um.
		const q = encodeURIComponent("name='" + FILE_NAME + "' or name='" + LEGACY_FILE_NAME + "'");
		const res = await api("/drive/v3/files?spaces=appDataFolder&q=" + q + "&fields=files(id,modifiedTime)");
		const { files } = await res.json();
		if (!files || !files.length) return null;
		// FIX (Verbesserung): existieren Alt- UND Neu-Datei gleichzeitig, gewann bisher
		// willkürlich files[0] — jetzt gewinnt die zuletzt geänderte Datei; die übrigen
		// werden nach dem erfolgreichen Upload als Duplikate entsorgt (Stand ist gemerged).
		files.sort((a, b) => String(b.modifiedTime || "").localeCompare(String(a.modifiedTime || "")));
		const file = files[0];
		file.duplicateIds = files.slice(1).map((f) => f.id);
		return file;
	}

	async function upload(fileId, content) {
		const bytes = new TextEncoder().encode(content);
		return uploadNamed(FILE_NAME, bytes, "identity", fileId);
	}

	function emitSyncStatus(state, label, detail) {
		window.dispatchEvent(new CustomEvent("impala67:sync-status", { detail: { state, label, detail: detail || label } }));
	}

	async function listSyncFiles() {
		const q = encodeURIComponent("trashed=false");
		const res = await api("/drive/v3/files?spaces=appDataFolder&q=" + q + "&pageSize=1000&fields=files(id,name,modifiedTime,size,appProperties)");
		const data = await res.json();
		return data.files || [];
	}

	async function uploadNamed(name, bytes, encoding, fileId, appProperties) {
		const meta = {
			name,
			...(fileId ? {} : { parents: ["appDataFolder"] }),
			appProperties: { encoding: encoding || "identity", ...(appProperties || {}) },
		};
		const boundary = "impala67" + Date.now() + Math.random().toString(16).slice(2);
		const head = "--" + boundary + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" + JSON.stringify(meta) +
			"\r\n--" + boundary + "\r\nContent-Type: application/octet-stream\r\n\r\n";
		const tail = "\r\n--" + boundary + "--";
		const body = new Blob([head, bytes, tail]);
		const res = await api("/upload/drive/v3/files" + (fileId ? "/" + fileId : "") + "?uploadType=multipart&fields=id,name,modifiedTime,appProperties", {
			method: fileId ? "PATCH" : "POST",
			headers: { "Content-Type": "multipart/related; boundary=" + boundary }, body,
		});
		return res.json();
	}

	async function downloadPayload(file) {
		const res = await api("/drive/v3/files/" + file.id + "?alt=media");
		const bytes = new Uint8Array(await res.arrayBuffer());
		const encoding = (file.appProperties && file.appProperties.encoding) || (file.name.endsWith(".gz") ? "gzip" : "identity");
		return decodeJson(bytes, encoding);
	}

	function replayImported(events) {
		const list = (events || []).slice().sort((a, b) => String(a.t || "").localeCompare(String(b.t || "")));
		for (const ev of list) STATE.reduce(ev);
		if (list.length && typeof STATE.onChange === "function") STATE.onChange("syncImport", { payload: { count: list.length } });
	}

	function loadKnownIds(key) {
		try { return new Set(JSON.parse(localStorage.getItem(key) || "[]")); } catch { return new Set(); }
	}
	function saveKnownIds(key, set) {
		localStorage.setItem(key, JSON.stringify(boundedKnownIds([...set])));
	}

	// Sync v2: kleine gzip-Deltas + deduplizierte Blob-Dateien. Unveränderte
	// Remote-Dateien werden anhand ihrer ID/modifiedTime gar nicht mehr geladen.
	async function syncRaw(onStatus) {
		const setStatus = (state, text) => { emitSyncStatus(state, text); if (onStatus) onStatus(text); };
		setStatus("syncing", "Synchronisiere…");
		await getToken(false);
		const files = await listSyncFiles();
		const uploadedSeq = Number(localStorage.getItem("impala67_drive_uploaded_seq") || 0);
		const importOpts = { unsyncedAfterSeq: uploadedSeq, pageInfo: (id) => S.pages[id], remote: true };
		let imported = 0, conflicts = 0;
		let conflictDetails = [], importedEvents = [];

		// Snapshot nur laden, wenn sich modifiedTime geändert hat. Altformat bleibt
		// vollständig kompatibel und wird beim ersten v2-Sync übernommen.
		const snapshot = newestFile(files, [SNAPSHOT_NAME, FILE_NAME, LEGACY_FILE_NAME]);
		const snapStamp = snapshot ? snapshot.id + ":" + snapshot.modifiedTime : "";
		if (snapshot && localStorage.getItem("impala67_drive_snapshot_stamp") !== snapStamp) {
			setStatus("syncing", "Remote-Stand übernehmen…");
			const payload = await downloadPayload(snapshot);
			const r = await DB.importAll(JSON.stringify(payload), importOpts);
			imported += r.added; conflicts += r.conflicts || 0;
			conflictDetails.push(...(r.conflictDetails || []));
			importedEvents.push(...(r.importedEvents || []));
			localStorage.setItem("impala67_drive_snapshot_stamp", snapStamp);
		}

		// Nur bislang unbekannte Delta-Shards laden.
		const knownDeltaIds = loadKnownIds("impala67_drive_known_deltas");
		const remoteDeltas = unseenRemoteFiles(files.filter((f) => f.name.startsWith(DELTA_PREFIX)), knownDeltaIds);
		for (const file of remoteDeltas) {
			const payload = await downloadPayload(file);
			const r = await DB.importAll(JSON.stringify(payload), importOpts);
			imported += r.added; conflicts += r.conflicts || 0;
			conflictDetails.push(...(r.conflictDetails || []));
			importedEvents.push(...(r.importedEvents || []));
			knownDeltaIds.add(file.id);
		}
		saveKnownIds("impala67_drive_known_deltas", knownDeltaIds);

		// Große Binärdaten separat: SHA-256 im Dateinamen verhindert erneute Uploads.
		// Neue Geräte laden nur Blob-Dateien, deren Drive-ID lokal noch unbekannt ist.
		const remoteBlobs = files.filter((f) => f.name.startsWith(BLOB_PREFIX));
		const remoteBlobHashes = new Set(remoteBlobs.map((f) => f.name.slice(BLOB_PREFIX.length).replace(/\.json\.gz$/, "")));
		const knownBlobIds = loadKnownIds("impala67_drive_known_blobs");
		for (const file of unseenRemoteFiles(remoteBlobs, knownBlobIds)) {
			const payload = await downloadPayload(file);
			if (payload && payload.id && !(await DB.getBlob(payload.id))) await DB.putBlob(payload.id, U.b64ToBuf(payload.b64), payload.meta || {});
			knownBlobIds.add(file.id);
		}
		for (const id of await DB.allBlobKeys()) {
			const rec = await DB.getBlob(id);
			if (!rec || !rec.buf) continue;
			const raw = new TextEncoder().encode(JSON.stringify({ id, meta: rec.meta || {}, b64: U.bufToB64(rec.buf) }));
			const hash = await sha256Hex(raw);
			if (remoteBlobHashes.has(hash)) continue;
			const packed = await encodeJson(JSON.parse(new TextDecoder().decode(raw)));
			const created = await uploadNamed(BLOB_PREFIX + hash + ".json.gz", packed.bytes, packed.encoding, null, { hash });
			remoteBlobHashes.add(hash); knownBlobIds.add(created.id);
		}
		saveKnownIds("impala67_drive_known_blobs", knownBlobIds);

		// Nur Events seit dem letzten erfolgreichen Upload als Delta senden.
		const localMaxSeq = await DB.maxSeq();
		let uploaded = 0;
		if (shouldUploadDelta(localMaxSeq, uploadedSeq)) {
			const events = await DB.eventsAfterSeq(uploadedSeq);
			if (events.length) {
				setStatus("syncing", "Änderungen hochladen…");
				const payload = { app: "impala67", version: 2, exportedAt: U.now(), events, blobs: {} };
				const packed = await encodeJson(payload);
				const name = DELTA_PREFIX + DEVICE_ID + "-" + (uploadedSeq + 1) + "-" + localMaxSeq + ".json.gz";
				const created = await uploadNamed(name, packed.bytes, packed.encoding, null, { device: DEVICE_ID, from: String(uploadedSeq + 1), to: String(localMaxSeq) });
				knownDeltaIds.add(created.id);
				uploaded = events.length;
			}
			// Auch wenn seit dem letzten Upload ausschließlich bereits vorhandene
			// Remote-Events lokale Sequenzen erhielten, den Wasserstand vorrücken.
			localStorage.setItem("impala67_drive_uploaded_seq", String(localMaxSeq));
		}

		// Viele Deltas gelegentlich zu einem kompakten Snapshot zusammenfassen.
		// Vor dem Löschen wird nur die zuvor gelistete, bereits gemergte Menge entfernt;
		// parallel neu angelegte Shards anderer Geräte bleiben unangetastet.
		const listedDeltas = files.filter((f) => f.name.startsWith(DELTA_PREFIX));
		if (listedDeltas.length >= 50) {
			setStatus("syncing", "Sync-Stand optimieren…");
			const payload = JSON.parse(await DB.exportAll());
			payload.blobs = {}; // Blobs liegen v2 separat und werden nicht doppelt hochgeladen.
			const packed = await encodeJson(payload);
			const oldSnapshot = files.find((f) => f.name === SNAPSHOT_NAME);
			await uploadNamed(SNAPSHOT_NAME, packed.bytes, packed.encoding, oldSnapshot && oldSnapshot.id, { protocol: "2" });
			for (const f of listedDeltas) await api("/drive/v3/files/" + f.id, { method: "DELETE" }).catch(() => {});
			localStorage.removeItem("impala67_drive_snapshot_stamp");
			localStorage.removeItem("impala67_drive_known_deltas");
		}

		replayImported(importedEvents);
		localStorage.setItem("impala67_drive_synced_seq", String(await DB.maxSeq()));
		setStatus("ok", imported || uploaded ? "Synchronisiert" : "Aktuell");
		return { imported, uploaded, conflicts, conflictDetails, importedEvents };
	}

	function sync(onStatus) {
		if (syncInFlight) {
			throw new Error("Eine Drive-Synchronisierung läuft bereits. Bitte warte, bis sie abgeschlossen ist.");
		}
		syncInFlight = syncRaw(onStatus).finally(() => { syncInFlight = null; });
		return syncInFlight;
	}

	// FIX: isConnected() kannte nur das In-Memory-Token — nach einem Reload zeigte die UI
	// deshalb "nicht verbunden", obwohl in localStorage noch eine gültige Sitzung lag.
	function isConnected() {
		if (token) return true;
		const savedToken = localStorage.getItem("impala67_drive_token");
		const savedExpiry = localStorage.getItem("impala67_drive_token_expiry");
		if (savedToken && savedExpiry && Date.now() < Number(savedExpiry)) return true;
		return !!localStorage.getItem("impala67_drive_refresh_token");
	}

	// ---------- Automatischer Drive-Sync --------------------------------------
	// Nur nach einer bereits erfolgten Anmeldung: niemals ein Login-Popup aus
	// einem Timer heraus öffnen. Änderungen werden gebündelt; zusätzlich ziehen
	// wir beim Start, beim Zurückkehren und in sichtbaren Sitzungen regelmäßig.
	const AUTO_DELAY_MS = 3000;
	const AUTO_INTERVAL_MS = 180000;
	let autoTimer = 0;
	let autoInterval = 0;
	let autoStarted = false;
	let autoResultHandler = null;
	const autoEnabled = () => localStorage.getItem("impala67.driveAutoSync") !== "0";

	async function autoSync(reason) {
		if (!autoEnabled() || !isConnected()) return null;
		if (navigator.onLine === false) { emitSyncStatus("waiting", "Offline · wartet"); return null; }
		try {
			// Manuelle und automatische Läufe nie parallel mergen. Ein bereits
			// laufender manueller Sync bleibt dessen eigener UI-Flow.
			if (syncInFlight) return null;
			const result = await sync();
			if (autoResultHandler) autoResultHandler(result, reason);
			return result;
		} catch (e) {
			// Automatik bleibt ruhig; der manuelle Button zeigt Fehler weiterhin an.
			emitSyncStatus(navigator.onLine === false ? "waiting" : "error", navigator.onLine === false ? "Offline · wartet" : "Sync pausiert", e && e.message);
			console.warn("Automatischer Drive-Sync (" + reason + ") fehlgeschlagen:", e);
			return null;
		}
	}
	function scheduleAutoSync(reason) {
		if (!autoEnabled() || !isConnected()) return;
		clearTimeout(autoTimer);
		emitSyncStatus(navigator.onLine === false ? "waiting" : "waiting", navigator.onLine === false ? "Offline · wartet" : "Speichert…");
		autoTimer = setTimeout(() => {
			// Nie mitten in einer Texteingabe Remote-Änderungen einspielen. Solange
			// aktiv geschrieben wird, ruhig weiter bündeln und fünf Sekunden später prüfen.
			const ae = document.activeElement;
			const editing = !!(ae && (ae.id === "pageTitle" || ae.classList.contains("blk-input") || ae.classList.contains("db-cell")));
			if (editing) { autoTimer = setTimeout(() => scheduleAutoSync(reason), 5000); return; }
			autoSync(reason);
		}, AUTO_DELAY_MS);
	}
	function startAutoSync(onResult) {
		if (typeof onResult === "function") autoResultHandler = onResult;
		if (autoStarted) return autoSync("start");
		autoStarted = true;
		// Jede persistierte Änderung — auch Tabs und eingeklappte Äste — wird
		// mit kurzer Verzögerung gesichert.
		STATE.onAfterDispatch(() => scheduleAutoSync("change"));
		document.addEventListener("visibilitychange", () => {
			if (document.hidden) autoSync("background");
			else autoSync("foreground");
		});
		// pagehide ist ein Best-Effort-Flush beim Schließen. Zusätzlich startet der
		// visibilitychange-Handler meist schon vorher, was im Browser zuverlässiger ist.
		window.addEventListener("pagehide", () => { autoSync("close"); });
		autoInterval = window.setInterval(() => {
			if (!document.hidden) autoSync("interval");
		}, AUTO_INTERVAL_MS);
		return autoSync("start");
	}

	return { login, logout, sync, isConnected, startAutoSync };
})();