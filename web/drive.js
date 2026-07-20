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
export const DRIVE = (() => {
	const SCOPE = "https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/userinfo.email";
	const FILE_NAME = "impala67-sync.json", LEGACY_FILE_NAME = "notion-sync.json"; // Altformat bleibt lesbar
	const SNAPSHOT_NAME = "impala67-snapshot-v2.json.gz";
	const DELTA_PREFIX = "impala67-delta-v2-", BLOB_PREFIX = "impala67-blob-v2-";
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

	async function api(path, opts = {}) {
		const res = await fetch("https://www.googleapis.com" + path, { ...opts, headers: { Authorization: "Bearer " + token, ...(opts.headers || {}) } });
		if (!res.ok) throw new Error("Drive-Fehler " + res.status + ": " + (await res.text()).slice(0, 200));
		return res;
	}
	const del = (fileId) => api("/drive/v3/files/" + fileId, { method: "DELETE" }).catch(() => {});

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

	async function listSyncFiles() {
		const res = await api("/drive/v3/files?spaces=appDataFolder&q=" + encodeURIComponent("trashed=false") + "&pageSize=1000&fields=files(id,name,modifiedTime,size,appProperties)");
		return (await res.json()).files || [];
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
		});
		return res.json();
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
				console.warn("[reconcileHeftBlobs] Heft-Blob " + wanted.slice(0, 12) + " noch nicht in Drive — nächster Sync-Zyklus.");
				continue;
			}
			const payload = await downloadPayload(file);
			// [F1] Nur der Hash zählt. Konflikt-Kopien liegen remote unter der ORIGINAL-
			// Seiten-id — der frühere id-Vergleich ließ sie auf Drittgeräten leer.
			if (!payload?.b64 || payload.meta?.hash !== wanted) {
				console.warn("[reconcileHeftBlobs] Heft-Datei für " + pageId + " ungültig (Hash stimmt nicht) — übersprungen.");
				continue;
			}
			await DB.putBlob(key, U.b64ToBuf(payload.b64), payload.meta);
			localBlobKeys.add(key);
		}
		// [F2] Fürs Konflikt-Popup: wurde die Kopie gefüllt, und wie groß ist sie?
		for (const c of heftConflicts) {
			const head = heads[c.conflictPageId];
			if (head) { c.loserPages = head.payload.pages || 1; c.loserBytes = head.payload.bytes || 0; }
			c.loserSaved = c.loserSaved || localBlobKeys.has("heft:" + c.conflictPageId);
		}
		return new Set(Object.values(heads).map((ev) => ev.payload.blobHash));
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
		// [F4] Wasserstand klemmen: ein Wert über maxSeq (Kompaktierung/Restore) würde die
		// Konflikt-Erkennung deaktivieren — Remote überschriebe lokale Änderungen still.
		const uploadedSeq = Math.min(Number(LS.getItem("impala67_drive_uploaded_seq") || 0), await DB.maxSeq());
		const importOpts = { unsyncedAfterSeq: uploadedSeq, pageInfo: (id) => S.pages[id], remote: true };
		let imported = 0, uploaded = 0, conflicts = 0;
		const conflictDetails = [], importedEvents = [];
		const importJson = async (json) => {
			const r = await DB.importAll(json, importOpts);
			imported += r.added; conflicts += r.conflicts || 0;
			conflictDetails.push(...(r.conflictDetails || []));
			importedEvents.push(...(r.importedEvents || []));
		};

		// Snapshot nur bei geänderter modifiedTime laden; Altformat bleibt kompatibel.
		const snapshot = newestFile(files, [SNAPSHOT_NAME, FILE_NAME, LEGACY_FILE_NAME]);
		const snapStamp = snapshot ? snapshot.id + ":" + snapshot.modifiedTime : "";
		if (snapshot && LS.getItem("impala67_drive_snapshot_stamp") !== snapStamp) {
			setStatus("syncing", "Remote-Stand übernehmen…");
			await importJson(JSON.stringify(await downloadPayload(snapshot)));
			LS.setItem("impala67_drive_snapshot_stamp", snapStamp);
		}

		// Unbekannte Delta-Shards parallel laden und in EINEM importAll mergen (dedupliziert
		// per Event-id; die Konflikt-Erkennung sieht den jüngsten Head über alle Shards).
		const knownDeltaIds = loadKnownIds("impala67_drive_known_deltas");
		const remoteDeltas = unseenRemoteFiles(files.filter((f) => f.name.startsWith(DELTA_PREFIX)), knownDeltaIds);
		if (remoteDeltas.length) setStatus("syncing", remoteDeltas.length + " Änderungspaket(e) laden…");
		const deltaEvents = (await mapLimit(remoteDeltas, 6, downloadPayload)).flatMap((p) => Array.isArray(p?.events) ? p.events : []);
		if (deltaEvents.length) await importJson(JSON.stringify({ app: "impala67", version: 2, exportedAt: U.now(), events: deltaEvents, blobs: {} }));
		remoteDeltas.forEach((f) => knownDeltaIds.add(f.id));
		saveKnownIds("impala67_drive_known_deltas", knownDeltaIds);

		// Binärdaten: Hefte versioniert (Event-Hash bestimmt exakt die Datei), Rest immutable.
		const remoteBlobs = files.filter((f) => f.name.startsWith(BLOB_PREFIX))
			.sort((a, b) => String(b.modifiedTime || "").localeCompare(String(a.modifiedTime || "")));
		const remoteBlobHashes = new Set(remoteBlobs.map((f) => f.name.slice(BLOB_PREFIX.length).replace(/\.json\.gz$/, "")));
		const knownBlobIds = loadKnownIds("impala67_drive_known_blobs");
		const uploadHashCache = lsJson("impala67_drive_upload_hashes", {});
		let cacheDirty = false;
		const allEvs = await DB.allEvents(); // EIN Read für Heads + Legacy-Check
		const localBlobKeys = new Set(await DB.allBlobKeys()); // EIN Read; wird unten mitgepflegt
		const liveHeftHashes = await reconcileHeftBlobs(remoteBlobs, conflictDetails, allEvs, uploadHashCache, localBlobKeys);
		const legacyHefts = legacyHeftIds(allEvs);
		await mapLimit(unseenRemoteFiles(remoteBlobs, knownBlobIds), 6, async (file) => {
			const payload = await downloadPayload(file);
			if (payload?.id) {
				const isHeft = String(payload.id).startsWith("heft:");
				// Nicht-Hefte sind immutable; Alt-Hefte ohne Versionierung einmalig neuester Blob
				// (der nächste Speichervorgang hasht sie und wechselt auf den strengen Pfad).
				if (!(await DB.getBlob(payload.id)) && (!isHeft || legacyHefts.has(String(payload.id).slice(5)))) {
					await DB.putBlob(payload.id, U.b64ToBuf(payload.b64), payload.meta || {});
					localBlobKeys.add(payload.id);
				}
			}
			knownBlobIds.add(file.id);
		});
		// Upload nur für Blobs, die laut Hash-Cache noch nicht remote liegen — kein
		// Vollscan über Blob-INHALTE mehr; bei Heften bestätigt der Head-Hash den Cache.
		const serializeBlob = (id, rec) => new TextEncoder().encode(JSON.stringify({ id, meta: rec.meta || {}, b64: U.bufToB64(rec.buf) }));
		const toUpload = [];
		for (const id of localBlobKeys) {
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
			const created = await uploadNamed(BLOB_PREFIX + u.hash + ".json.gz", packed.bytes, packed.encoding, null, { hash: u.hash, blobId: u.id, contentHash: u.contentHash });
			knownBlobIds.add(created.id);
		});
		if (cacheDirty) LS.setItem("impala67_drive_upload_hashes", JSON.stringify(uploadHashCache));
		saveKnownIds("impala67_drive_known_blobs", knownBlobIds);
		// Nicht mehr referenzierte Heft-Versionen löschen. Datei-Liste stammt vom Sync-Start
		// ⇒ parallel neu hochgeladene Dateien anderer Geräte sind nie betroffen.
		await mapLimit(remoteBlobs.filter((f) => {
			const ap = f.appProperties || {};
			return ap.blobId?.startsWith("heft:") && ap.contentHash && !liveHeftHashes.has(ap.contentHash);
		}), 6, (f) => del(f.id));

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

		// Viele Deltas gelegentlich zu einem Snapshot kompaktieren. Gelöscht wird nur die
		// zu Sync-Beginn gelistete (bereits gemergte) Menge — parallele Shards bleiben.
		const listedDeltas = files.filter((f) => f.name.startsWith(DELTA_PREFIX));
		if (listedDeltas.length >= 50) {
			setStatus("syncing", "Sync-Stand optimieren…");
			const packed = await encodeJson(JSON.parse(await DB.exportAll({ includeBlobs: false })));
			const oldSnapshot = files.find((f) => f.name === SNAPSHOT_NAME);
			await uploadNamed(SNAPSHOT_NAME, packed.bytes, packed.encoding, oldSnapshot?.id, { protocol: "2" });
			await mapLimit(listedDeltas, 6, (f) => del(f.id));
			LS.removeItem("impala67_drive_snapshot_stamp");
			LS.removeItem("impala67_drive_known_deltas");
		}

		replayImported(importedEvents);
		LS.setItem("impala67_drive_synced_seq", String(await DB.maxSeq()));
		setStatus("ok", imported || uploaded ? "Synchronisiert" : "Aktuell");
		return { imported, uploaded, conflicts, conflictDetails, importedEvents };
	}

	function sync(onStatus) {
		if (syncInFlight) throw new Error("Eine Drive-Synchronisierung läuft bereits. Bitte warte, bis sie abgeschlossen ist.");
		syncInFlight = syncRaw(onStatus).finally(() => { syncInFlight = null; });
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
		return !!(ae && (ae.id === "pageTitle" || ae.classList.contains("blk-input") || ae.classList.contains("db-cell")));
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

	function startAutoSync(onResult) {
		if (typeof onResult === "function") autoResultHandler = onResult;
		if (autoStarted) return autoSync("start");
		autoStarted = true;
		// Reine UI-Events (Tab-Wechsel) stoßen keinen Sync an — sie wandern mit dem
		// nächsten inhaltlichen/manuellen/Intervall-Sync mit.
		const UI_ONLY_EVENTS = new Set(["uiTabsSet"]);
		STATE.onAfterDispatch((ev) => { if (!ev || !UI_ONLY_EVENTS.has(ev.type)) scheduleAutoSync("change"); });
		document.addEventListener("visibilitychange", () => document.hidden ? autoSync("background", true) : autoSync("foreground"));
		window.addEventListener("pagehide", () => autoSync("close", true)); // Best-Effort-Flush beim Schließen
		window.setInterval(() => { if (!document.hidden) autoSync("interval"); }, AUTO_INTERVAL_MS);
		return autoSync("start");
	}

	return { login, logout, sync, isConnected, startAutoSync };
})();