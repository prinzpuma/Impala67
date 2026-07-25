"use strict";
import { S, STATE } from "./state.js";
import { DB } from "./db.js";
import { U } from "./util.js";
import { shouldUploadDelta, unseenRemoteFiles, newestFile, encodeJson, decodeJson, sha256Hex, boundedKnownIds } from "./sync-core.js";
// drive.js — Google-Drive-Sync über appDataFolder. v4 (20.7.2026): KISS/DRY-Rewrite.
// Login: Browser/PWA = GIS-Popup (Client-ID aus Einstellungen). Desktop/Tauri =
// Loopback-Flow RFC 8252 (Google blockt OAuth in Webviews) mit separatem
// "Desktop-App"-Client aus web/config.local.js; Google verlangt dessen
// client_secret auch mit PKCE (bei installierten Apps offiziell nicht geheim).
// Fixes v4:
// [F1] Heft-Blob-Validierung nur noch per SHA-256 statt Datei-id: Konflikt-Hefte
//      liegen remote unter der ORIGINAL-Seiten-id — der alte id-Vergleich verwarf
//      sie, deshalb blieben Konflikt-Kopien (v.a. auf Drittgeräten) oft leer.
// [F2] Verlierer-Blob robust sichern: auch ohne meta.hash (Alt-Hefte), sonst
//      Download per Hash aus Drive. conflictDetails melden loserSaved/loserPages/
//      loserBytes — das Konflikt-Popup kann endlich zeigen, was gesichert wurde.
// [F3] Kein Remote-Replay mitten in einer Eingabe: foreground/interval/start-
//      Auto-Syncs warten, solange getippt wird — vorher konnte genau so eine
//      offene Seite überschrieben werden. background/close flushen weiter sofort.
// [F4] Upload-Wasserstand wird an DB.maxSeq() geklemmt: ein zu hoher Altwert
//      (Log-Kompaktierung/Restore/DB-Reset) schaltete die Konflikt-Erkennung
//      still ab — Remote überschrieb lokale Änderungen dann ohne Konfliktkopie.
// [F5] Eigenes Delta wird nach dem Upload auch PERSISTENT als bekannt markiert
//      (vorher nur in-memory → nächster Sync lud das eigene Paket erneut).
// Perf v4: ein allBlobKeys-Read statt zwei; Blob-Upload gzippt die bereits
// serialisierten Bytes direkt (vorher decode→parse→stringify→encode); tote
// findFile()-Logik entfernt; Parallelität moderat erhöht (6 statt 4).
// v5 (21.7.2026): Changes API statt Voll-Listing — listSyncFiles() pflegt einen
// lokalen Datei-Index (localStorage, atomar MIT dem pageToken) und holt per
// changes.list nur noch, was sich seit dem letzten Sync geändert hat. Fallback
// auf Voll-Listing bei Erst-Sync oder ungültigem Token (Drive 404/410); eigene
// Uploads/Deletes aktualisieren den Index sofort. Skaliert damit unabhängig
// von der wachsenden Delta-/Blob-Dateizahl (Kompaktierung greift erst ab 50).
// v6 (25.7.2026), Audit-Fixes:
// [G1] Uhren-Drift per Minimum-RTT-Schätzer statt Einzelmessung — vorher wurde Netz-
//      latenz als Drift gemessen (300 ms Mobilfunk = 300 ms Phantom-Drift) und floss
//      über U.setClockOffset in die Event-Zeitstempel, also in JEDE LWW-Entscheidung.
// [G2] known_blobs entfällt: boundedKnownIds kappte bei 2000 ids, wodurch ab ~2000
//      Blob-Dateien jeder Sync die ältesten erneut VOLLSTÄNDIG herunterlud, nur um sie
//      danach zu verwerfen. Die Entscheidung fällt jetzt über appProperties.blobId aus
//      der ohnehin geladenen Dateiliste — vor dem Download.
// [G3] Snapshot-Runde setzt knownDeltaIds in-memory UND persistiert gemeinsam zurück.
// [G4] Pull-Phase: Snapshot + Delta-Shards laufen jetzt in EINEM importAll (vorher zwei)
//      und werden parallel heruntergeladen. Spart pro Sync einen kompletten Lese-Durchlauf
//      über den lokalen Event-Log — und schließt die Geister-Konflikt-Fehlerklasse
//      strukturell: es gibt keinen zweiten Durchlauf mehr, der die Events des ersten für
//      eigene ungesyncte Änderungen halten könnte.
// v7 (25.7.2026), Heft-Blobs kamen nicht an:
// [H1] Nachzügler-Deltas (Post-Upload-Sweep) brachten die heftUpdated-EVENTS mit, aber nie
//      die zugehörigen Striche — der Blob-Abgleich war zu diesem Zeitpunkt längst gelaufen.
//      Ergebnis: Sync meldet Erfolg, das Heft zeigt den alten Stand. Jetzt zweiter Durchgang.
// [H2] Der Aufräumlauf löschte FREMDE Heft-Stände. syncRaw lädt erst den Blob und danach das
//      Delta hoch; wer in genau diesem Fenster listet, sieht die neue Blob-Datei OHNE das
//      zugehörige Event, hält sie für verwaist und löscht sie. Der vom Event referenzierte
//      Hash war damit dauerhaft weg — die Zeichnung tauchte nirgends mehr auf, auch nach
//      Neustart nicht. Jetzt: nur eigene/bekannte Hefte, Schonfrist, und Aufräumen erst NACH
//      dem Delta-Upload.
// [H3] Fehlende Blobs werden nicht mehr als „Synchronisiert“ verkauft, sondern gemeldet und
//      mit wachsendem Abstand nachgeholt.
// [H4] heftver:-Verlaufs-Snapshots (heft.js) wanderten entgegen ihrer Zusage nach Drive und
//      auf alle anderen Geräte — sie sind ausdrücklich lokal gedacht.
export const DRIVE = (() => {
	const SCOPE = "https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/userinfo.email";
	const FILE_NAME = "impala67-sync.json", LEGACY_FILE_NAME = "notion-sync.json"; // Altformat bleibt lesbar
	const SNAPSHOT_NAME = "impala67-snapshot-v2.json.gz";
	const DELTA_PREFIX = "impala67-delta-v2-", BLOB_PREFIX = "impala67-blob-v2-";
	// [H4] Der Heft-Verlauf (heft.js: "heftver:<pid>:<t>:<rev>", max. 20 Stück je Heft, 24 h)
	// ist ausdrücklich gerätelokal — er erzeugt keine Events, ein anderes Gerät kann mit den
	// Snapshots also gar nichts anfangen. Trotzdem lief er mit: die Upload-Schleife iteriert
	// über ALLE Blob-Schlüssel. Pro Heft und Tag landeten so bis zu 20 Vollkopien in Drive,
	// die jedes andere Gerät auch noch herunterlud und speicherte.
	const LOCAL_ONLY_BLOB = (id) => String(id).startsWith("heftver:");
	const LS = localStorage;
	const lsJson = (k, fb) => { try { return JSON.parse(LS.getItem(k) ?? "null") ?? fb; } catch { return fb; } };
	const DEVICE_ID = (() => {
		let id = LS.getItem("impala67_drive_device_id");
		if (!id) { id = crypto.randomUUID?.() || Date.now() + Math.random().toString(16).slice(2); LS.setItem("impala67_drive_device_id", id); }
		return id;
	})();
	// Desktop-OAuth: config.local.js (lazy — wird asynchron geladen, nie beim Import
	// lesen), Fallback = Einstellungen → Sync. Quelle wird für Diagnosen gemerkt.
	const cfg = (k) => window.APP_CONFIG?.[k] || "";
	const dcId = () => cfg("GOOGLE_DESKTOP_CLIENT_ID") || S.settings?.driveDesktopClientId || "";
	const dcSecret = () => cfg("GOOGLE_DESKTOP_CLIENT_SECRET") || S.settings?.driveDesktopClientSecret || "";
	const srcOf = (k, fallback) => cfg(k) ? "config.local.js" : fallback ? "Einstellungen (alter Fallback!)" : "keine Quelle";
	let token = null;
	let syncInFlight = null; // nie zwei Syncs parallel (Sidebar-Button + Einstellungen + Auto)
	let flushMode = false; // pagehide: Uploads mit keepalive absetzen (überleben das Schließen)

	// Einmalige Key-Migration (Projekt hieß früher "notion") — Sitzung bleibt erhalten.
	for (const k of ["drive_token", "drive_token_expiry", "drive_refresh_token"]) {
		const old = LS.getItem("notion_" + k);
		if (old !== null && LS.getItem("impala67_" + k) === null) LS.setItem("impala67_" + k, old);
		LS.removeItem("notion_" + k);
	}

	const base64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

	async function pkcePair() {
		const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)).buffer);
		const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
		return { verifier, challenge: base64url(digest) };
	}

	const tokenRequest = (params) => fetch("https://oauth2.googleapis.com/token", {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({ client_id: dcId(), ...(dcSecret() ? { client_secret: dcSecret() } : {}), ...params }),
	});

	async function exchangeCode(code, verifier, redirectUri) {
		const res = await tokenRequest({ code, redirect_uri: redirectUri, grant_type: "authorization_code", code_verifier: verifier });
		if (!res.ok) {
			// Fehlertext maskieren (kann Token-Fragmente enthalten) + Quellen-Diagnose für invalid_client.
			const safe = (await res.text()).slice(0, 200).replace(/[A-Za-z0-9_\-]{20,}/g, "[…]").replace(/GOCSPX-[A-Za-z0-9_\-]+/g, "[secret]");
			const diag = "Client-ID-Quelle: " + srcOf("GOOGLE_DESKTOP_CLIENT_ID", S.settings?.driveDesktopClientId) + ", Secret-Quelle: " + srcOf("GOOGLE_DESKTOP_CLIENT_SECRET", S.settings?.driveDesktopClientSecret) + ", Secret-Länge: " + dcSecret().length;
			throw new Error("Token-Tausch fehlgeschlagen: " + safe + " — [" + diag + "]");
		}
		return res.json();
	}

	const refreshDesktopToken = async (rt) => {
		const res = await tokenRequest({ refresh_token: rt, grant_type: "refresh_token" });
		return res.ok ? res.json() : null;
	};

	function saveToken(data) {
		// Tokens bewusst nur in localStorage (pro Gerät), nie ins Event-Log/Export.
		token = data.access_token;
		LS.setItem("impala67_drive_token", token);
		LS.setItem("impala67_drive_token_expiry", String(Date.now() + (Number(data.expires_in) || 3600) * 1000 - 60000));
		if (data.refresh_token) LS.setItem("impala67_drive_refresh_token", data.refresh_token);
	}

	// Desktop (Tauri): System-Browser + lokaler Redirect-Server statt Popup.
	async function getTokenDesktop(interactive) {
		const rt = LS.getItem("impala67_drive_refresh_token");
		if (rt) {
			const data = await refreshDesktopToken(rt);
			if (data?.access_token) { saveToken(data); return token; }
		}
		if (!interactive) throw new Error("Keine gültige Sitzung — bitte einmal manuell mit Google anmelden.");
		// Klare Meldungen statt Googles kryptischer invalid_request/client_secret-Fehler.
		if (!dcId()) throw new Error("Google-Login nicht möglich: Die Desktop-Client-ID fehlt. Trage sie einmalig unter ⚙️ Einstellungen → Sync ein (OAuth-Client Typ „Desktop-App“ aus der Google Cloud Console) — oder befülle web/config.local.js und baue die App neu.");
		if (!dcSecret()) throw new Error("Google-Login nicht möglich: Das Desktop-Client-Secret fehlt (Google verlangt es für Desktop-Clients auch mit PKCE). Trage es einmalig unter ⚙️ Einstellungen → Sync ein — es steht in der Google Cloud Console direkt beim Desktop-OAuth-Client (GOCSPX-…).");
		const { verifier, challenge } = await pkcePair();
		const port = await window.__TAURI__.core.invoke("start_oauth_server");
		const redirectUri = "http://localhost:" + port;
		const authUrl = "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({
			client_id: dcId(), redirect_uri: redirectUri, response_type: "code", scope: SCOPE,
			access_type: "offline", prompt: "consent", code_challenge: challenge, code_challenge_method: "S256",
		});
		const codePromise = new Promise((resolve, reject) => {
			// Login-Abbruch im Browser: nach 2 min aufgeben + Redirect-Server aufräumen.
			const timer = setTimeout(() => {
				window.__TAURI__.core.invoke("cancel_oauth_server", { port }).catch(() => {});
				reject(new Error("Google-Login abgebrochen: keine Antwort innerhalb von 2 Minuten. Bitte erneut versuchen."));
			}, 120000);
			window.__TAURI__.event.once("redirect_uri", (event) => {
				clearTimeout(timer);
				try {
					const url = new URL(event.payload);
					const err = url.searchParams.get("error"), code = url.searchParams.get("code");
					if (err) return reject(new Error("Google-Login abgebrochen: " + err));
					code ? resolve(code) : reject(new Error("Kein Code in der Antwort erhalten."));
				} catch (e) { reject(e); }
			});
		});
		await window.__TAURI__.shell.open(authUrl);
		const code = await codePromise;
		window.__TAURI__.core.invoke("cancel_oauth_server", { port }).catch(() => {});
		saveToken(await exchangeCode(code, verifier, redirectUri));
		return token;
	}

	// Browser/PWA: Popup über Googles Identity-Bibliothek.
	function getTokenBrowser(interactive) {
		return new Promise((resolve, reject) => {
			if (!window.google?.accounts) return reject(new Error("Google-Script nicht geladen (Internet nötig)."));
			const clientId = S.settings.driveClientId;
			if (!clientId) return reject(new Error("Keine Google Client-ID hinterlegt (einmalig in Einstellungen → Sync eintragen)."));
			google.accounts.oauth2.initTokenClient({
				client_id: clientId, scope: SCOPE,
				callback: (resp) => resp.access_token ? (saveToken(resp), resolve(token)) : reject(new Error("Kein Zugriffstoken erhalten.")),
			}).requestAccessToken({ prompt: interactive ? "consent" : "" }); // "" = stiller Login, falls Zustimmung schon erteilt
		});
	}

	const validSavedToken = () => {
		const t = LS.getItem("impala67_drive_token"), exp = Number(LS.getItem("impala67_drive_token_expiry"));
		return t && exp && Date.now() < exp ? t : null;
	};

	function getToken(interactive) {
		const saved = validSavedToken();
		if (saved) return Promise.resolve(token = saved);
		return window.__TAURI__ ? getTokenDesktop(interactive) : getTokenBrowser(interactive);
	}

	async function fetchUserInfo() {
		try {
			const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", { headers: { Authorization: "Bearer " + token } });
			return res.ok ? res.json() : null;
		} catch { return null; }
	}

	const login = async () => { await getToken(true); return fetchUserInfo(); }; // Ein-Klick: Token + E-Mail
	const logout = () => { token = null; ["token", "token_expiry", "refresh_token"].forEach((k) => LS.removeItem("impala67_drive_" + k)); };

	// Uhren-Drift-Erkennung: der Log-Merge entscheidet Konflikte per Zeitstempel (LWW) —
	// eine falsch gehende Geräteuhr „gewinnt“ sonst systematisch und still. Der Date-Header
	// jeder Drive-Antwort dient als kostenlose Referenzzeit; syncRaw warnt oberhalb der Schwelle.
	let clockSkewMs = 0;
	let skewSamples = []; // [G1] Ringpuffer { offset, rtt } für den Minimum-RTT-Schätzer
	const CLOCK_SKEW_WARN_MS = 120000;
	// Ab dieser Schwelle wird der gemessene Versatz aktiv in U.now() hineinkorrigiert:
	// Event-Zeitstempel entstehen dann in (ungefährer) Serverzeit — LWW-Konflikte werden
	// fair entschieden, statt dass die falsch gehende Uhr systematisch „gewinnt“.
	// Unterhalb der Schwelle bleibt alles unangetastet (Netz-Latenz verrauscht kleine Werte).
	const CLOCK_APPLY_MS = 15000;
	async function api(path, opts = {}, attempt = 0) {
		const t0 = Date.now();
		const res = await fetch("https://www.googleapis.com" + path, { ...opts, headers: { Authorization: "Bearer " + token, ...(opts.headers || {}) } });
		const t1 = Date.now();
		const serverDate = Date.parse(res.headers.get("date") || "");
		if (serverDate) {
			// [G1] NTP-Schätzer statt "Date.now() - serverDate": der Date-Header gilt in der MITTE
			// des Round-Trips, sonst zählt jede ms Netzlatenz als Uhren-Drift. +500 ms gleicht die
			// Sekunden-Auflösung des Headers aus (er ist immer abgerundet). Aus den letzten Samples
			// gewinnt das mit der KLEINSTEN RTT — das ist das genaueste, Ausreißer fallen raus.
			skewSamples.push({ offset: (t0 + t1) / 2 - (serverDate + 500), rtt: t1 - t0 });
			if (skewSamples.length > 16) skewSamples.shift();
			clockSkewMs = skewSamples.reduce((a, b) => (b.rtt < a.rtt ? b : a)).offset;
			U.setClockOffset(Math.abs(clockSkewMs) > CLOCK_APPLY_MS ? clockSkewMs : 0);
		}
		// Abgelaufenes/entzogenes Token mitten im Sync: EINMAL still erneuern und wieder-
		// holen statt hart abzubrechen (ein langer Sync kann die Token-Laufzeit überdauern).
		if (res.status === 401 && attempt === 0) {
			token = null;
			LS.removeItem("impala67_drive_token");
			await getToken(false);
			return api(path, opts, 1);
		}
		// Rate-Limit/Serverfehler: kurzer exponentieller Backoff mit Jitter statt sofortigem
		// Fehlschlag — Drive drosselt gelegentlich (429) und 5xx sind fast immer transient.
		if ((res.status === 429 || res.status >= 500) && attempt < 3) {
			await new Promise((r) => setTimeout(r, (500 << attempt) * (1 + Math.random())));
			return api(path, opts, attempt + 1);
		}
		if (!res.ok) throw new Error("Drive-Fehler " + res.status + ": " + (await res.text()).slice(0, 200));
		return res;
	}
	const del = (fileId) => api("/drive/v3/files/" + fileId, { method: "DELETE" }).then(() => indexRemove(fileId)).catch(() => {});

	const emitSyncStatus = (state, label, detail) =>
		window.dispatchEvent(new CustomEvent("impala67:sync-status", { detail: { state, label, detail: detail || label } }));

	// Begrenzte Parallelität — bündelt Netz-Rundreisen für Down-/Uploads/Deletes.
	async function mapLimit(items, limit, fn) {
		const list = items || [];
		const out = new Array(list.length);
		let next = 0;
		await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, list.length)) }, async () => {
			while (next < list.length) { const i = next++; out[i] = await fn(list[i], i); }
		}));
		return out;
	}

	// ---------- Datei-Index + Changes API (v5) ----------
	// Statt bei jedem Sync ALLE Dateien zu listen, pflegt ein lokaler Index den
	// Stand des appDataFolder; changes.list (pageToken) liefert nur die Deltas
	// seit dem letzten Sync. Index + Token liegen atomar in EINEM localStorage-
	// Eintrag — so können sie nie auseinanderlaufen.
	const IDX_KEY = "impala67_drive_file_index";
	const slimFile = (f) => ({ id: f.id, name: f.name, modifiedTime: f.modifiedTime, size: f.size, appProperties: f.appProperties });
	const loadIndex = () => { const idx = lsJson(IDX_KEY, null); return idx && idx.token && idx.files ? idx : null; };
	const saveIndex = (idx) => LS.setItem(IDX_KEY, JSON.stringify(idx));
	const indexPut = (file) => { const idx = loadIndex(); if (idx && file?.id) { idx.files[file.id] = slimFile(file); saveIndex(idx); } };
	const indexRemove = (fileId) => { const idx = loadIndex(); if (idx?.files[fileId]) { delete idx.files[fileId]; saveIndex(idx); } };

	async function fullFileListing() {
		const out = [];
		let pageToken = "";
		do {
			const res = await api("/drive/v3/files?spaces=appDataFolder&q=" + encodeURIComponent("trashed=false") + "&pageSize=1000&fields=nextPageToken,files(id,name,modifiedTime,size,appProperties)" + (pageToken ? "&pageToken=" + encodeURIComponent(pageToken) : ""));
			const json = await res.json();
			out.push(...(json.files || []));
			pageToken = json.nextPageToken || "";
		} while (pageToken);
		return out;
	}

	// Wendet alle Änderungen seit idx.token auf den Index an und rückt das Token
	// auf newStartPageToken vor. Wirft bei ungültigem/abgelaufenem Token (404/410).
	async function applyRemoteChanges(idx) {
		let pageToken = idx.token;
		while (pageToken) {
			const res = await api("/drive/v3/changes?spaces=appDataFolder&pageSize=1000&fields=nextPageToken,newStartPageToken,changes(fileId,removed,file(id,name,modifiedTime,size,appProperties,trashed))&pageToken=" + encodeURIComponent(pageToken));
			const json = await res.json();
			for (const ch of json.changes || []) {
				if (ch.removed || ch.file?.trashed) delete idx.files[ch.fileId];
				else if (ch.file?.id) idx.files[ch.file.id] = slimFile(ch.file);
			}
			if (json.newStartPageToken) { idx.token = json.newStartPageToken; return; }
			pageToken = json.nextPageToken || "";
		}
		throw new Error("changes.list lieferte weder nextPageToken noch newStartPageToken.");
	}

	async function listSyncFiles() {
		const idx = loadIndex();
		if (idx) {
			try {
				await applyRemoteChanges(idx);
				saveIndex(idx);
				return Object.values(idx.files);
			} catch (e) {
				// Token abgelaufen/ungültig (Drive meldet 404 oder 410) → Index verwerfen
				// und unten einmalig voll listen. Andere Fehler (Netz) normal weiterreichen.
				if (!/Drive-Fehler (404|410)/.test(String(e?.message))) throw e;
				console.warn("[listSyncFiles] Changes-Token ungültig — Fallback auf Voll-Listing.");
				LS.removeItem(IDX_KEY);
			}
		}
		// Erst-Sync/Fallback: Token VOR dem Listing holen — Änderungen in der Lücke
		// tauchen dann höchstens doppelt auf (harmlos, alle Import-Pfade sind idempotent).
		const token = (await (await api("/drive/v3/changes/startPageToken")).json()).startPageToken;
		const files = await fullFileListing();
		saveIndex({ token, files: Object.fromEntries(files.map((f) => [f.id, slimFile(f)])) });
		return files;
	}

	async function uploadNamed(name, bytes, encoding, fileId, appProperties) {
		const meta = { name, ...(fileId ? {} : { parents: ["appDataFolder"] }), appProperties: { encoding: encoding || "identity", ...(appProperties || {}) } };
		const boundary = "impala67" + Date.now() + Math.random().toString(16).slice(2);
		const body = new Blob([
			"--" + boundary + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" + JSON.stringify(meta) +
			"\r\n--" + boundary + "\r\nContent-Type: application/octet-stream\r\n\r\n",
			bytes, "\r\n--" + boundary + "--",
		]);
		const res = await api("/upload/drive/v3/files" + (fileId ? "/" + fileId : "") + "?uploadType=multipart&fields=id,name,modifiedTime,appProperties", {
			method: fileId ? "PATCH" : "POST", headers: { "Content-Type": "multipart/related; boundary=" + boundary }, body,
			// pagehide-Flush: kleine Uploads (typisch das gzip-Delta) mit keepalive absetzen —
			// sie überleben das Tab-Schließen (fetch-keepalive-Limit ~64 KB, daher die Schranke).
			...(flushMode && body.size < 60000 ? { keepalive: true } : {}),
		});
		const json = await res.json();
		indexPut(json); // Index sofort aktuell halten — nicht erst über changes.list im nächsten Zyklus
		return json;
	}

	async function downloadPayload(file) {
		const res = await api("/drive/v3/files/" + file.id + "?alt=media");
		const bytes = new Uint8Array(await res.arrayBuffer());
		return decodeJson(bytes, file.appProperties?.encoding || (file.name.endsWith(".gz") ? "gzip" : "identity"));
	}

	// Bytes direkt gzippen — für schon serialisierte Blobs (spart decode→parse→stringify).
	async function gzipRaw(raw) {
		if (typeof CompressionStream !== "function") return { bytes: raw, encoding: "identity" };
		const stream = new Blob([raw]).stream().pipeThrough(new CompressionStream("gzip"));
		return { bytes: new Uint8Array(await new Response(stream).arrayBuffer()), encoding: "gzip" };
	}

	function replayImported(events) {
		const list = (events || []).slice().sort((a, b) => String(a.t || "").localeCompare(String(b.t || "")));
		for (const ev of list) STATE.reduce(ev);
		if (list.length && typeof STATE.onChange === "function") STATE.onChange("syncImport", { payload: { count: list.length } });
	}

	// Jüngstes heftUpdated je Seite; withHash=true = nur versionierte Heads (Blob-Hash Pflicht).
	function heftHeads(events, withHash) {
		const out = {};
		for (const ev of events || []) {
			const p = ev?.payload || {};
			if (ev?.type === "heftUpdated" && p.pageId && (!withHash || p.blobHash) && (!out[p.pageId] || ev.t > out[p.pageId].t)) out[p.pageId] = ev;
		}
		return out;
	}
	// Alt-Hefte vor der Hash-Versionierung: nur wenn das JÜNGSTE Event keinen Hash trägt,
	// darf der klassische Blob-Pfad greifen.
	const legacyHeftIds = (events) => new Set(Object.entries(heftHeads(events, false)).filter(([, ev]) => !ev.payload.blobHash).map(([id]) => id));

	// Heft-Blobs mit den Event-Heads abgleichen: erst den lokalen Konflikt-Verlierer
	// sichern (solange der Original-Blob noch da ist), dann für jede aktuelle
	// Heft-Revision exakt den im Event referenzierten Hash laden.
	async function reconcileHeftBlobs(remoteBlobs, conflictDetails, allEvs, uploadHashCache, localBlobKeys) {
		const byContentHash = new Map(remoteBlobs.filter((f) => f.appProperties?.contentHash).map((f) => [f.appProperties.contentHash, f]));
		const heftConflicts = (conflictDetails || []).filter((c) => (c.conflictType === "heft" || c.conflictType === "delete-change") && c.loserHash);
		for (const c of heftConflicts) {
			if (c.loserSource !== "local") continue;
			const original = await DB.getBlob("heft:" + c.pageId);
			// [F2] Auch Alt-Blobs ohne meta.hash sichern — der Event-Head belegt, dass dieser
			// lokale Stand der Verlierer ist; ein leeres Konflikt-Heft ist immer falscher.
			if (original?.buf && (!original.meta?.hash || original.meta.hash === c.loserHash)) {
				await DB.putBlob("heft:" + c.conflictPageId, original.buf, { ...(original.meta || {}), hash: c.loserHash });
				localBlobKeys.add("heft:" + c.conflictPageId);
				c.loserSaved = true;
			}
		}
		const heads = heftHeads(allEvs, true);
		// Console bewusst gebündelt: bei Dutzenden fehlenden Blobs sonst unlesbar (ein Warn pro Sync).
		let pendingRemote = 0, badHash = 0;
		for (const [pageId, ev] of Object.entries(heads)) {
			const wanted = ev.payload.blobHash, key = "heft:" + pageId;
			// Fastpath: Upload-Cache kennt exakt diesen Stand UND der Schlüssel existiert
			// wirklich in IndexedDB (sonst nach DB-Reset nie wieder ein Re-Download).
			const cached = uploadHashCache?.[key];
			if (cached && cached.contentHash === wanted && localBlobKeys.has(key)) continue;
			const local = await DB.getBlob(key);
			if (local?.meta?.hash === wanted) continue;
			const file = byContentHash.get(wanted);
			if (!file) {
				// Gerät A lädt Event vor Blob hoch — nächster Zyklus hat ihn. Kein harter Abbruch.
				pendingRemote++;
				continue;
			}
			const payload = await downloadPayload(file);
			// [F1] Nur der Hash zählt. Konflikt-Kopien liegen remote unter der ORIGINAL-
			// Seiten-id — der frühere id-Vergleich ließ sie auf Drittgeräten leer.
			if (!payload?.b64 || payload.meta?.hash !== wanted) {
				badHash++;
				continue;
			}
			await DB.putBlob(key, U.b64ToBuf(payload.b64), payload.meta);
			localBlobKeys.add(key);
		}
		if (pendingRemote) console.warn("[reconcileHeftBlobs] " + pendingRemote + " Heft-Blob(s) noch nicht in Drive — Nachlauf wird geplant.");
		if (badHash) console.warn("[reconcileHeftBlobs] " + badHash + " Heft-Datei(en) ungültig (Hash stimmt nicht) — übersprungen.");
		// [F2] Fürs Konflikt-Popup: wurde die Kopie gefüllt, und wie groß ist sie?
		for (const c of heftConflicts) {
			const head = heads[c.conflictPageId];
			if (head) { c.loserPages = head.payload.pages || 1; c.loserBytes = head.payload.bytes || 0; }
			c.loserSaved = c.loserSaved || localBlobKeys.has("heft:" + c.conflictPageId);
		}
		// [H3] Offene Punkte nach oben reichen statt nur in die Konsole zu schreiben: solange ein
		// heftUpdated auf eine Datei zeigt, die (noch) nicht da ist, zeigt das Heft alte Striche.
		return { hashes: new Set(Object.values(heads).map((ev) => ev.payload.blobHash)), pending: pendingRemote + badHash };
	}

	const loadKnownIds = (k) => new Set(lsJson(k, []));
	const saveKnownIds = (k, set) => LS.setItem(k, JSON.stringify(boundedKnownIds([...set])));

	// Sync v4: gzip-Deltas + deduplizierte Blob-Dateien. Unveränderte Remote-Dateien
	// werden anhand id/modifiedTime gar nicht erst geladen.
	async function syncRaw(onStatus) {
		const setStatus = (state, text) => { emitSyncStatus(state, text); onStatus?.(text); };
		setStatus("syncing", "Synchronisiere…");
		await getToken(false);
		const files = await listSyncFiles();
		if (Math.abs(clockSkewMs) > CLOCK_SKEW_WARN_MS) {
			U.toast("⚠ Die Geräteuhr weicht ~" + Math.round(Math.abs(clockSkewMs) / 60000) + " Min von der Serverzeit ab — Sync-Konflikte werden per Zeitstempel entschieden. Bitte Datum/Uhrzeit prüfen.", "error");
			console.warn("[sync] Uhren-Drift gegen Drive:", clockSkewMs, "ms");
		}
		// [F4] Wasserstand klemmen: ein Wert über maxSeq (Kompaktierung/Restore) würde die
		// Konflikt-Erkennung deaktivieren — Remote überschriebe lokale Änderungen still.
		const uploadedSeq = Math.min(Number(LS.getItem("impala67_drive_uploaded_seq") || 0), await DB.maxSeq());
		const importOpts = { unsyncedAfterSeq: uploadedSeq, pageInfo: (id) => S.pages[id], remote: true };
		let imported = 0, uploaded = 0, conflicts = 0, merged = 0;
		const conflictDetails = [], importedEvents = [], mergedDetails = [];
		const importJson = async (json) => {
			const r = await DB.importAll(json, importOpts);
			imported += r.added; conflicts += r.conflicts || 0; merged += r.merged || 0;
			conflictDetails.push(...(r.conflictDetails || []));
			mergedDetails.push(...(r.mergedDetails || [])); // automatisch zusammengeführte Seiten (db.js merge3)
			importedEvents.push(...(r.importedEvents || []));
		};

		// ---- [G4] Pull: Snapshot + alle unbekannten Delta-Shards in EINEM Durchgang ----
		// Vorher waren das ZWEI importAll-Aufrufe. Jeder liest den kompletten lokalen Event-Log
		// in den Speicher — zwei Aufrufe = doppelte Arbeit bei jedem Sync. Schwerer wog aber:
		// der zweite Aufruf sah die frisch importierten Events des ersten als „meine ungesyncten
		// Änderungen“ und meldete Konflikte gegen den eigenen Sync (db.js/isLocalOnly). Mit einem
		// einzigen Durchgang kann diese Fehlerklasse gar nicht mehr entstehen. Snapshot- und
		// Delta-Downloads laufen zusätzlich parallel statt nacheinander.
		const snapshot = newestFile(files, [SNAPSHOT_NAME, FILE_NAME, LEGACY_FILE_NAME]);
		const snapStamp = snapshot ? snapshot.id + ":" + snapshot.modifiedTime : "";
		const needSnapshot = !!snapshot && LS.getItem("impala67_drive_snapshot_stamp") !== snapStamp;
		const knownDeltaIds = loadKnownIds("impala67_drive_known_deltas");
		const remoteDeltas = unseenRemoteFiles(files.filter((f) => f.name.startsWith(DELTA_PREFIX)), knownDeltaIds);
		if (needSnapshot || remoteDeltas.length) {
			setStatus("syncing", needSnapshot ? "Remote-Stand übernehmen…" : remoteDeltas.length + " Änderungspaket(e) laden…");
		}
		const [snapPayload, deltaPayloads] = await Promise.all([
			needSnapshot ? downloadPayload(snapshot) : null,
			mapLimit(remoteDeltas, 6, downloadPayload),
		]);
		const pullEvents = [
			...(Array.isArray(snapPayload?.events) ? snapPayload.events : []),
			...deltaPayloads.flatMap((p) => Array.isArray(p?.events) ? p.events : []),
		];
		// Alt-Snapshots (Format v1, FILE_NAME/LEGACY_FILE_NAME) trugen ihre Blobs noch im selben
		// Dokument — die müssen mit durch importAll, sonst gingen sie beim Zusammenlegen verloren.
		const pullBlobs = snapPayload?.blobs && typeof snapPayload.blobs === "object" ? snapPayload.blobs : {};
		if (pullEvents.length || Object.keys(pullBlobs).length) {
			await importJson(JSON.stringify({ app: "impala67", version: 2, exportedAt: U.now(), events: pullEvents, blobs: pullBlobs }));
		}
		// „Gelesen“-Marken erst NACH erfolgreichem Import setzen: bricht der Import ab, wird das
		// Paket beim nächsten Sync erneut geholt statt still übersprungen.
		if (needSnapshot) LS.setItem("impala67_drive_snapshot_stamp", snapStamp);
		remoteDeltas.forEach((f) => knownDeltaIds.add(f.id));
		saveKnownIds("impala67_drive_known_deltas", knownDeltaIds);

		// Binärdaten: Hefte versioniert (Event-Hash bestimmt exakt die Datei), Rest immutable.
		const remoteBlobs = files.filter((f) => f.name.startsWith(BLOB_PREFIX))
			.sort((a, b) => String(b.modifiedTime || "").localeCompare(String(a.modifiedTime || "")));
		const remoteBlobHashes = new Set(remoteBlobs.map((f) => f.name.slice(BLOB_PREFIX.length).replace(/\.json\.gz$/, "")));
		const uploadHashCache = lsJson("impala67_drive_upload_hashes", {}); // [G2] known_blobs entfiel
		let cacheDirty = false;
		const allEvs = await DB.allEvents(); // EIN Read für Heads + Legacy-Check
		const localBlobKeys = new Set(await DB.allBlobKeys()); // EIN Read; wird unten mitgepflegt
		const heftPass = await reconcileHeftBlobs(remoteBlobs, conflictDetails, allEvs, uploadHashCache, localBlobKeys);
		const liveHeftHashes = heftPass.hashes;
		let heftPending = heftPass.pending;
		const legacyHefts = legacyHeftIds(allEvs);
		// [G2] Vorfilter OHNE Download: appProperties.blobId steht in der Dateiliste. Fehlt er
		// (Alt-Dateien vor v4), bleibt es beim alten Weg — laden und danach entscheiden.
		const wantsBlob = (blobId) => {
			if (LOCAL_ONLY_BLOB(blobId)) return false; // [H4] fremder Heft-Verlauf geht uns nichts an
			if (localBlobKeys.has(blobId)) return false; // schon lokal
			// Nicht-Hefte sind immutable; Alt-Hefte ohne Versionierung einmalig neuester Blob
			// (der nächste Speichervorgang hasht sie und wechselt auf den strengen Pfad).
			return !String(blobId).startsWith("heft:") || legacyHefts.has(String(blobId).slice(5));
		};
		await mapLimit(remoteBlobs, 6, async (file) => {
			const declared = file.appProperties?.blobId;
			if (declared && !wantsBlob(declared)) return; // Download komplett gespart
			const payload = await downloadPayload(file);
			if (!payload?.id || !wantsBlob(payload.id) || await DB.getBlob(payload.id)) return;
			await DB.putBlob(payload.id, U.b64ToBuf(payload.b64), payload.meta || {});
			localBlobKeys.add(payload.id);
		});
		// Upload nur für Blobs, die laut Hash-Cache noch nicht remote liegen — kein
		// Vollscan über Blob-INHALTE mehr; bei Heften bestätigt der Head-Hash den Cache.
		const serializeBlob = (id, rec) => new TextEncoder().encode(JSON.stringify({ id, meta: rec.meta || {}, b64: U.bufToB64(rec.buf) }));
		const toUpload = [];
		for (const id of localBlobKeys) {
			if (LOCAL_ONLY_BLOB(id)) continue; // [H4] Heft-Verlauf bleibt auf diesem Gerät
			const cached = uploadHashCache[id];
			const isHeft = String(id).startsWith("heft:");
			if (cached && remoteBlobHashes.has(cached.hash) && (!isHeft || liveHeftHashes.has(cached.contentHash))) continue;
			const rec = await DB.getBlob(id);
			if (!rec?.buf) continue;
			const contentHash = rec.meta?.hash || "";
			const size = rec.buf.byteLength || 0;
			let raw = null, hash;
			if (cached && cached.contentHash === contentHash && cached.size === size) hash = cached.hash;
			else {
				raw = serializeBlob(id, rec);
				hash = await sha256Hex(raw);
				uploadHashCache[id] = { contentHash, size, hash };
				cacheDirty = true;
			}
			if (remoteBlobHashes.has(hash)) continue;
			toUpload.push({ id, raw: raw || serializeBlob(id, rec), hash, contentHash });
			remoteBlobHashes.add(hash);
		}
		if (toUpload.length) setStatus("syncing", toUpload.length + " Datei(en) hochladen…");
		await mapLimit(toUpload, 3, async (u) => {
			const packed = await gzipRaw(u.raw);
			// blobId in den appProperties ist jetzt Pflicht — [G2] entscheidet damit ohne Download.
			await uploadNamed(BLOB_PREFIX + u.hash + ".json.gz", packed.bytes, packed.encoding, null, { hash: u.hash, blobId: u.id, contentHash: u.contentHash });
		});
		if (cacheDirty) LS.setItem("impala67_drive_upload_hashes", JSON.stringify(uploadHashCache));
		LS.removeItem("impala67_drive_known_blobs"); // [G2] Altlast, wird nicht mehr geführt
		// [H2] Nicht mehr referenzierte Heft-Versionen löschen — aber nur solche, die dieses Gerät
		// überhaupt beurteilen kann. Der alte Filter kannte ausschließlich die Heft-Köpfe im EIGENEN
		// Event-Log. Ein Stand, dessen heftUpdated hier noch nicht angekommen war, sah damit aus wie
		// eine verwaiste Datei — und wurde gelöscht. Das passierte zuverlässig, wenn zwei Geräte
		// kurz nacheinander syncen: syncRaw lädt erst den Blob und erst danach das Delta hoch, wer
		// in diesem Fenster listet, sieht genau eines von beidem. Der referenzierte Hash war danach
		// dauerhaft weg, reconcileHeftBlobs lief für immer in „noch nicht in Drive“, und die frisch
		// gezeichnete Seite tauchte auf keinem Gerät mehr auf — auch nach einem Neustart nicht.
		// Drei Schutzregeln: (a) nur Hefte, zu denen wir einen Kopf kennen, (b) Schonfrist für
		// frische Dateien, (c) gelöscht wird erst NACH dem Delta-Upload (weiter unten), damit unser
		// eigener Kopf zu diesem Zeitpunkt in Drive liegt.
		const GC_GRACE_MS = 3600000; // 1 h — deckt jedes realistische Blob/Delta-Fenster ab
		const knownHeftPages = new Set(Object.keys(heftHeads(allEvs, true)).map((p) => "heft:" + p));
		const staleHeftFiles = remoteBlobs.filter((f) => {
			const ap = f.appProperties || {};
			if (!ap.blobId?.startsWith("heft:") || !ap.contentHash) return false;
			if (!knownHeftPages.has(ap.blobId)) return false;      // (a) Heft ist uns unbekannt
			if (liveHeftHashes.has(ap.contentHash)) return false;  // aktueller Stand irgendeines Geräts
			const age = Date.now() - Date.parse(f.modifiedTime || "");
			return Number.isFinite(age) && age > GC_GRACE_MS;      // (b) Schonfrist
		});

		// Nur Events seit dem letzten Upload als Delta senden. Bewusst KEINE Redaction:
		// state.js repliziert API-Keys übers Event-Log (appDataFolder = privater App-
		// Speicher im eigenen Konto); Redaction überschrieb Keys auf Zielgeräten mit "".
		const localMaxSeq = await DB.maxSeq();
		if (shouldUploadDelta(localMaxSeq, uploadedSeq)) {
			const events = await DB.eventsAfterSeq(uploadedSeq);
			if (events.length) {
				setStatus("syncing", "Änderungen hochladen…");
				const packed = await encodeJson({ app: "impala67", version: 2, exportedAt: U.now(), events, blobs: {} });
				const created = await uploadNamed(DELTA_PREFIX + DEVICE_ID + "-" + (uploadedSeq + 1) + "-" + localMaxSeq + ".json.gz", packed.bytes, packed.encoding, null, { device: DEVICE_ID, from: String(uploadedSeq + 1), to: String(localMaxSeq) });
				knownDeltaIds.add(created.id);
				saveKnownIds("impala67_drive_known_deltas", knownDeltaIds); // [F5] sonst lädt der nächste Sync das eigene Paket erneut
				uploaded = events.length;
			}
			// Wasserstand auch vorrücken, wenn nur Remote-Echos lokale Sequenzen erhielten.
			LS.setItem("impala67_drive_uploaded_seq", String(localMaxSeq));
		}
		// [H2] (c) Erst jetzt aufräumen: unser eigener Heft-Kopf liegt als Delta in Drive, andere
		// Geräte können die verbleibenden Dateien also korrekt zuordnen.
		if (staleHeftFiles.length) await mapLimit(staleHeftFiles, 6, (f) => del(f.id));

		// Viele Deltas gelegentlich zu einem Snapshot kompaktieren. Gelöscht wird nur die
		// zu Sync-Beginn gelistete (bereits gemergte) Menge — parallele Shards bleiben.
		const listedDeltas = files.filter((f) => f.name.startsWith(DELTA_PREFIX));
		if (listedDeltas.length >= 50) {
			setStatus("syncing", "Sync-Stand optimieren…");
			// redactSecrets:false — BEWUSST: API-Keys replizieren über den privaten
			// appDataFolder aufs eigene Konto (exportAll redigiert sonst standardmäßig, db.js).
			const packed = await encodeJson(JSON.parse(await DB.exportAll({ includeBlobs: false, redactSecrets: false })));
			const oldSnapshot = files.find((f) => f.name === SNAPSHOT_NAME);
			await uploadNamed(SNAPSHOT_NAME, packed.bytes, packed.encoding, oldSnapshot?.id, { protocol: "2" });
			await mapLimit(listedDeltas, 6, (f) => del(f.id));
			// [G3] In-Memory UND persistiert gemeinsam leeren: ein bloßes removeItem ließ
			// knownDeltaIds gefüllt zurück, und der Late-Sweep unten schrieb sie nur dann
			// wieder weg, wenn zufällig ein spätes Delta existierte — der persistierte Zustand
			// hängte also vom Zufall ab.
			knownDeltaIds.clear();
			saveKnownIds("impala67_drive_known_deltas", knownDeltaIds);
			LS.removeItem("impala67_drive_snapshot_stamp");
		}

		// Bug-4-Fix Post-Upload-Sweep: Deltas anderer Clients einlesen, die WÄHREND unseres Syncs
		// hochgeladen wurden. Der initiale listSyncFiles()-Aufruf lag vor unserem Upload — ein
		// gleichzeitig synchender Tab fehlt sonst und beide Clients divergieren nach dem Sync.
		const filesAfter = await listSyncFiles();
		const lateDeltas = unseenRemoteFiles(filesAfter.filter((f) => f.name.startsWith(DELTA_PREFIX)), knownDeltaIds);
		if (lateDeltas.length) {
			setStatus("syncing", lateDeltas.length + " nachträgliche(s) Änderungspaket(e) einlesen…");
			const lateEvents = (await mapLimit(lateDeltas, 6, downloadPayload)).flatMap((p) => Array.isArray(p?.events) ? p.events : []);
			if (lateEvents.length) {
				await importJson(JSON.stringify({ app: "impala67", version: 2, exportedAt: U.now(), events: lateEvents, blobs: {} }));
				// [H1] Genau hier fehlte der Heft-Inhalt. Die Nachzügler brachten das heftUpdated mit,
				// der Blob-Abgleich war aber weiter oben schon gelaufen — die Striche wurden in diesem
				// Sync nie geholt, und der Status meldete trotzdem „Synchronisiert“. Zweiter Durchgang
				// mit der frischen Dateiliste; er ist idempotent (Hash-Vergleich) und meist ein No-op.
				const lateBlobFiles = filesAfter.filter((f) => f.name.startsWith(BLOB_PREFIX))
					.sort((a, b) => String(b.modifiedTime || "").localeCompare(String(a.modifiedTime || "")));
				const pass2 = await reconcileHeftBlobs(lateBlobFiles, conflictDetails, await DB.allEvents(), uploadHashCache, localBlobKeys);
				heftPending = pass2.pending;
			}
			lateDeltas.forEach((f) => knownDeltaIds.add(f.id));
			saveKnownIds("impala67_drive_known_deltas", knownDeltaIds);
		}
		replayImported(importedEvents);
		LS.setItem("impala67_drive_synced_seq", String(await DB.maxSeq()));
		// [H3] Ein unvollständiger Heft-Stand ist kein Erfolg. Sichtbar machen + gezielt nachfassen,
		// statt still auf irgendeinen späteren Sync zu hoffen.
		if (heftPending) {
			setStatus("waiting", heftPending + (heftPending === 1 ? " Heft-Stand wird noch geholt" : " Heft-Stände werden noch geholt"));
			scheduleHeftRetry();
		} else {
			heftRetries = 0;
			setStatus("ok", imported || uploaded ? "Synchronisiert" : "Aktuell");
		}
		return { imported, uploaded, conflicts, conflictDetails, merged, mergedDetails, importedEvents, heftPending };
	}

	// Web Lock gegen Multi-Tab-Races: Datei-Index, known_deltas und uploaded_seq liegen in
	// localStorage — zwei gleichzeitig syncende Tabs überschrieben sich sonst gegenseitig
	// (syncInFlight wirkt nur im eigenen Tab). ifAvailable: der zweite Tab wartet nicht,
	// sein nächster Auto-Sync holt alles nach. Ohne Locks-API: bisheriges Verhalten.
	const IDLE_RESULT = { imported: 0, uploaded: 0, conflicts: 0, conflictDetails: [], merged: 0, mergedDetails: [], importedEvents: [], heftPending: 0, skipped: "lock" };
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
		syncInFlight = withSyncLock(() => syncRaw(onStatus)).finally(() => { syncInFlight = null; });
		return syncInFlight;
	}

	// Kennt auch die in localStorage überdauernde Sitzung (nicht nur das In-Memory-Token).
	const isConnected = () => !!(token || validSavedToken() || LS.getItem("impala67_drive_refresh_token"));

	// ---------- Automatischer Drive-Sync ----------
	// Nur nach erfolgter Anmeldung (nie Login-Popups aus Timern). Änderungen werden
	// gebündelt; zusätzlich Start/Rückkehr/Intervall-Pulls in sichtbaren Sitzungen.
	const AUTO_DELAY_MS = 3000, AUTO_INTERVAL_MS = 180000;
	let autoTimer = 0, autoStarted = false, autoResultHandler = null;
	const autoEnabled = () => LS.getItem("impala67.driveAutoSync") !== "0";
	const isEditing = () => {
		const ae = document.activeElement;
		// .heft-writing (heft.js): aktiver Stift-Strich — das Canvas ist nie activeElement,
		// ein Remote-Replay mitten im Strich würde den Heft-Blob unter dem Stift ersetzen.
		return !!(document.querySelector(".heft-writing") ||
			(ae && (ae.id === "pageTitle" || ae.classList.contains("blk-input") || ae.classList.contains("db-cell"))));
	};

	async function autoSync(reason, force) {
		if (!autoEnabled() || !isConnected()) return null;
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
			emitSyncStatus(navigator.onLine === false ? "waiting" : "error", navigator.onLine === false ? "Offline · wartet" : "Sync pausiert", e?.message);
			console.warn("Automatischer Drive-Sync (" + reason + ") fehlgeschlagen:", e);
			return null;
		}
	}

	function scheduleAutoSync(reason) {
		if (!autoEnabled() || !isConnected()) return;
		clearTimeout(autoTimer);
		emitSyncStatus("waiting", navigator.onLine === false ? "Offline · wartet" : "Speichert…");
		autoTimer = setTimeout(() => {
			// Während getippt wird: weiter bündeln, in 5 s erneut prüfen.
			if (isEditing()) { autoTimer = setTimeout(() => scheduleAutoSync(reason), 5000); return; }
			autoSync(reason);
		}, AUTO_DELAY_MS);
	}

	// [H3] Ein heftUpdated kann Drive vor seinem Blob erreichen — das andere Gerät lädt erst den
	// Blob und dann das Delta hoch, wer dazwischen liest, sieht nur eines von beidem. Früher blieb
	// es bei einer Konsolenzeile und der Hoffnung auf den nächsten Sync (bei geschlossener App:
	// nie). Jetzt wird mit wachsendem Abstand nachgefasst, bis die Striche da sind.
	let heftRetryTimer = 0, heftRetries = 0;
	function scheduleHeftRetry() {
		if (heftRetries >= 5) { console.warn("[sync] Heft-Blob bleibt aus — Nachlauf aufgegeben, nächster regulärer Sync versucht es erneut."); return; }
		clearTimeout(heftRetryTimer);
		heftRetryTimer = setTimeout(() => autoSync("heft-nachlauf", true), 5000 * Math.pow(2, heftRetries++)); // 5 s → 80 s
	}

	function startAutoSync(onResult) {
		if (typeof onResult === "function") autoResultHandler = onResult;
		if (autoStarted) return autoSync("start");
		autoStarted = true;
		// Reine UI-Events (Tab-Wechsel) stoßen keinen Sync an — sie wandern mit dem
		// nächsten inhaltlichen/manuellen/Intervall-Sync mit.
		const UI_ONLY_EVENTS = new Set(["uiTabsSet"]);
		STATE.onAfterDispatch((ev) => { if (!ev || !UI_ONLY_EVENTS.has(ev.type)) scheduleAutoSync("change"); });
		document.addEventListener("visibilitychange", () => document.hidden ? autoSync("background", true) : autoSync("foreground"));
		window.addEventListener("pagehide", () => { // Best-Effort-Flush beim Schließen
			flushMode = true;
			autoSync("close", true).finally(() => { flushMode = false; });
		});
		window.setInterval(() => { if (!document.hidden) autoSync("interval"); }, AUTO_INTERVAL_MS);
		return autoSync("start");
	}

	return { login, logout, sync, isConnected, startAutoSync };
})();