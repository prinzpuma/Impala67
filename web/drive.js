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
// v8 (25.7.2026) — Hefte sind keine Binärdateien mehr, sondern Events (heftOps/heftSnap).
// Damit fällt in dieser Datei der komplette zweite Transportweg weg: kein heftHeads, kein
// reconcileHeftBlobs, keine Heft-GC, kein Hash-Abgleich, kein Nachlauf-Timer. Hefte reisen
// jetzt exakt denselben Weg wie Notizen — Delta hoch, Delta runter, fertig. Die gesamte
// Fehlerklasse „Event ist da, Inhalt fehlt“ kann strukturell nicht mehr auftreten, weil es
// kein Event mehr gibt, das auf etwas AUßERHALB des Logs zeigt.
// Neu: nach dem Replay importierter Events feuert STATE.emitRemoteApplied — ein offenes Heft
// zeichnet fremde Striche sofort nach, ohne Neustart und ohne Seitenwechsel.
// Historie (v7/v7.1) entfernt: sie beschrieb ausschließlich Reparaturen an genau der Blob-
// Mechanik, die es nicht mehr gibt.
// v9 (25.7.2026), Audit über db.js × drive.js × sync-core.js — alles Befunde, die beim Lesen
// EINER Datei unsichtbar sind:
// [A2] Der Post-Upload-Sweep ist ein ZWEITER importAll-Aufruf und lief mit dem alten Wasserstand.
//      [G4] hat die Geister-Konflikte damit nur für die Pull-Phase geschlossen: die im ersten
//      Durchgang erzeugten merge3-/Konflikt-Events sind bewusst nicht _remote und lagen über
//      uploadedSeq — der Sweep hielt sie für eigene Bearbeitungen und legte Konfliktkopien gegen
//      den eigenen Merge an. Jetzt wird der Wasserstand vorher nachgezogen (+ _derived in db.js).
// [A5] Auto-Sync hatte keine Obergrenze fürs Aufschieben: isEditing() prüfte nur den FOKUS, ein
//      geparkter Cursor stoppte den Sync unbegrenzt. Jetzt Tipp-Erkennung + MAX_DEFER_MS.
// [A6] Der pagehide-Flush lief über den vollen syncRaw (Lock, Listing, Downloads) und erreichte
//      den keepalive-Upload praktisch nie. Jetzt eigener Kurzweg flushUpload() ohne Pull.
// [A7] Nach jeder Snapshot-Runde wurde der Stempel gelöscht — das Gerät lud den Snapshot, den es
//      gerade selbst hochgeladen hat, im Folgelauf komplett wieder herunter.
// [A8] Der Uhren-Schätzer kannte kein Alter: ein einzelnes schnelles Sample von vor Stunden konnte
//      den Offset festnageln, der über U.setClockOffset in JEDEN Zeitstempel fließt.
// [A9] del() verschluckte Fehlschläge, während knownDeltaIds pauschal geleert wurde.
// -- Archiv der Blob-Ära (v7, 25.7.2026), nur noch zur Einordnung:
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
// v7.1 (25.7.2026), Nachwehen von [H2]:
// [H5] Die v6-GC hat über Tage FREMDE Heft-Stände gelöscht. Die Köpfe im Event-Log zeigen
//      seitdem auf Hashes, die es in Drive nicht mehr gibt — Dutzende gleichzeitig. [H3] hat
//      das korrekt erkannt, aber falsch behandelt: alles hieß „wird noch geholt“, der Nachlauf
//      lief endlos im Kreis („49 Heft-Stände werden nachgeholt“, minutenlang), und der Status
//      blieb hängen. Ein Zeiger ins Leere löst sich aber NIE durch Warten auf.
//      Jetzt drei getrennte Fälle: frisch (warten hilft) · verwaist mit lokaler Kopie (dieses
//      Gerät hat die einzigen überlebenden Striche → es erklärt sie zum neuen Kopf und lädt sie
//      hoch, der Zeiger heilt aus) · verwaist ohne Kopie (ehrlich melden, nicht im Kreis laufen).
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
	let skewSamples = []; // [G1] Ringpuffer { offset, rtt, at } für den Minimum-RTT-Schätzer
	const CLOCK_SKEW_WARN_MS = 120000;
	// [A8] Samples altern. Ohne Alter konnte ein einzelnes sehr schnelles Sample von vor Stunden den
	// Offset festnageln — auch nachdem die Geräteuhr längst per NTP korrigiert war. Der Offset fließt
	// über U.setClockOffset in jeden neuen Zeitstempel und damit in jede LWW-Entscheidung.
	const SKEW_MAX_AGE_MS = 600000; // 10 min
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
			skewSamples.push({ offset: (t0 + t1) / 2 - (serverDate + 500), rtt: t1 - t0, at: t1 });
			skewSamples = skewSamples.filter((s) => t1 - s.at < SKEW_MAX_AGE_MS).slice(-16); // [A8]
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
	// [A9] Ergebnis melden statt verschlucken: beim Snapshot-Lauf wurden knownDeltaIds und der
	// Snapshot-Stempel bisher unabhängig vom Erfolg geleert — ein einziges fehlgeschlagenes Delete
	// zwang den nächsten Sync, Snapshot UND alle überlebenden Deltas erneut zu laden.
	const del = (fileId) => api("/drive/v3/files/" + fileId, { method: "DELETE" })
		.then(() => { indexRemove(fileId); return true; })
		.catch(() => false);

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
		// v8: Hefte kommen als heftOps/heftSnap herein. Ein offenes Heft hält seine Seiten im
		// Speicher — ohne dieses Signal sähe man fremde Striche erst nach einem Neustart.
		if (list.length) STATE.emitRemoteApplied(new Set(list.map((ev) => ev.type)));
	}

	// v8: heftHeads/legacyHeftIds/reconcileHeftBlobs sind ersatzlos entfallen — rund 100 Zeilen
	// Sonderbehandlung für einen Transportweg, den es nicht mehr gibt. Hefte sind Events.
	const loadKnownIds = (k) => new Set(lsJson(k, []));
	const saveKnownIds = (k, set) => LS.setItem(k, JSON.stringify(boundedKnownIds([...set])));

	// -- v8.1: Ballast gar nicht erst hochladen ------------------------------
	// Drei Sorten Muell sind bisher durch die Leitung gewandert:
	//  (a) reine Ansichts-Events (offene Tabs, aufgeklappte Baumzweige) - die
	//      sind geraetespezifisch und auf dem anderen Geraet schlicht falsch.
	//  (b) Telemetrie, die db.js lokal nach 90 Tagen sowieso wegwirft - sie
	//      wurde hochgeladen, verteilt und sofort wieder verworfen.
	//  (c) Heft-Striche, die im selben Paket schon von einem heftSnap
	//      ueberholt wurden - der Snapshot enthaelt sie bereits.
	const UPLOAD_SKIP_TYPES = new Set(["uiTabsSet", "uiTreeSet"]);
	const TELE_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
	const evTime = (ev) => (typeof ev.t === "number" ? ev.t : Date.parse(ev.t) || 0);
	function pruneForUpload(events) {
		const now = Date.now();
		const snapSeq = new Map();
		for (const ev of events) {
			if (ev.type === "heftSnap" && ev.payload?.pageId) snapSeq.set(ev.payload.pageId, Math.max(snapSeq.get(ev.payload.pageId) || 0, ev.seq || 0));
		}
		return events.filter((ev) => {
			if (UPLOAD_SKIP_TYPES.has(ev.type)) return false;
			if (ev.type === "teleEvent" && now - evTime(ev) > TELE_MAX_AGE_MS) return false;
			if (ev.type === "heftOps" && (snapSeq.get(ev.payload?.pageId) || 0) > (ev.seq || 0)) return false;
			return true;
		});
	}

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

		// Binärdaten: seit v8 ausschließlich unveränderliche Dateien (PDFs, Bilder) — keine Hefte mehr.
		const remoteBlobs = files.filter((f) => f.name.startsWith(BLOB_PREFIX))
			.sort((a, b) => String(b.modifiedTime || "").localeCompare(String(a.modifiedTime || "")));
		const remoteBlobHashes = new Set(remoteBlobs.map((f) => f.name.slice(BLOB_PREFIX.length).replace(/\.json\.gz$/, "")));
		const uploadHashCache = lsJson("impala67_drive_upload_hashes", {}); // [G2] known_blobs entfiel
		let cacheDirty = false;
		const localBlobKeys = new Set(await DB.allBlobKeys()); // EIN Read; wird unten mitgepflegt
		// v8: alle verbleibenden Blobs sind UNVERÄNDERLICH (PDFs, Bilder, Hintergrundbild). Damit
		// gilt genau eine Regel: was ich schon habe, hole ich nicht — und das entscheidet sich ohne
		// Download über appProperties.blobId aus der ohnehin geladenen Dateiliste [G2].
		const wantsBlob = (blobId) => !LOCAL_ONLY_BLOB(blobId) && !localBlobKeys.has(blobId);
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
			if (cached && remoteBlobHashes.has(cached.hash)) continue;
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
			await uploadNamed(BLOB_PREFIX + u.hash + ".json.gz", packed.bytes, packed.encoding, null, { hash: u.hash, blobId: u.id });
		});
		if (cacheDirty) LS.setItem("impala67_drive_upload_hashes", JSON.stringify(uploadHashCache));
		LS.removeItem("impala67_drive_known_blobs"); // [G2] Altlast, wird nicht mehr geführt
		// v8: Es gibt keine Heft-Müllabfuhr mehr. Die alte GC war die gefährlichste Stelle im ganzen
		// Sync — sie hat in einem Rennfenster fremde, noch referenzierte Zeichnungen gelöscht. Was
		// gar nicht existiert, kann auch nichts kaputt machen; Hefte werden stattdessen im Log selbst
		// verdichtet (heftSnap ersetzt ältere heftOps, db.js/compactEvents).

		// Nur Events seit dem letzten Upload als Delta senden. Bewusst KEINE Redaction:
		// state.js repliziert API-Keys übers Event-Log (appDataFolder = privater App-
		// Speicher im eigenen Konto); Redaction überschrieb Keys auf Zielgeräten mit "".
		const localMaxSeq = await DB.maxSeq();
		if (shouldUploadDelta(localMaxSeq, uploadedSeq)) {
			// uploaded_seq wandert trotzdem bis localMaxSeq weiter, damit
			// aussortierte Events nicht beim naechsten Lauf wieder auftauchen.
			const events = pruneForUpload(await DB.eventsAfterSeq(uploadedSeq));
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
			// redactSecrets:false — BEWUSST: API-Keys replizieren über den privaten
			// appDataFolder aufs eigene Konto (exportAll redigiert sonst standardmäßig, db.js).
			const packed = await encodeJson(JSON.parse(await DB.exportAll({ includeBlobs: false, redactSecrets: false })));
			const oldSnapshot = files.find((f) => f.name === SNAPSHOT_NAME);
			const createdSnap = await uploadNamed(SNAPSHOT_NAME, packed.bytes, packed.encoding, oldSnapshot?.id, { protocol: "2" });
			const deleted = await mapLimit(listedDeltas, 6, (f) => del(f.id));
			// [G3] In-Memory UND persistiert gemeinsam leeren: ein bloßes removeItem ließ
			// knownDeltaIds gefüllt zurück, und der Late-Sweep unten schrieb sie nur dann
			// wieder weg, wenn zufällig ein spätes Delta existierte — der persistierte Zustand
			// hängte also vom Zufall ab.
			// [A9] Nur die TATSÄCHLICH gelöschten Dateien vergessen. Ein pauschales clear() ließ überlebende
			// Deltas als unbekannt zurück — der nächste Sync lud sie ein zweites Mal.
			listedDeltas.forEach((f, i) => { if (deleted[i]) knownDeltaIds.delete(f.id); });
			saveKnownIds("impala67_drive_known_deltas", knownDeltaIds);
			// [A7] Den eigenen Snapshot nicht wieder herunterladen. Bisher stand hier removeItem, wodurch
			// needSnapshot im Folgelauf garantiert true war: das Gerät holte den Snapshot, den es gerade
			// selbst hochgeladen hat, und importierte ihn vollständig (ein kompletter Log-Durchlauf).
			// uploadNamed fordert modifiedTime bereits mit an — die Information liegt also schon vor.
			LS.setItem("impala67_drive_snapshot_stamp", createdSnap.id + ":" + createdSnap.modifiedTime);
		}

		// Bug-4-Fix Post-Upload-Sweep: Deltas anderer Clients einlesen, die WÄHREND unseres Syncs
		// hochgeladen wurden. Der initiale listSyncFiles()-Aufruf lag vor unserem Upload — ein
		// gleichzeitig synchender Tab fehlt sonst und beide Clients divergieren nach dem Sync.
		// [A2] Wasserstand VOR dem zweiten Import nachziehen. [G4] hat die Geister-Konflikt-Fehlerklasse
		// nur für die Pull-Phase strukturell geschlossen — dieser Sweep ist ein ZWEITER importAll-Aufruf.
		// Mit dem alten uploadedSeq galten die soeben erzeugten merge3-/Konflikt-Events (bewusst nicht
		// _remote, damit sie normal syncen) als "meine ungesyncten Änderungen" und wurden gegen späte
		// Fremd-Deltas erneut in Konflikt gesetzt: Konfliktkopien ohne jede Nutzeraktion, bei jedem Lauf.
		// Zweite Hälfte des Fixes: db.js kennt jetzt _derived (isLocalOnly).
		importOpts.unsyncedAfterSeq = Math.min(Number(LS.getItem("impala67_drive_uploaded_seq") || uploadedSeq), await DB.maxSeq());
		const filesAfter = await listSyncFiles();
		const lateDeltas = unseenRemoteFiles(filesAfter.filter((f) => f.name.startsWith(DELTA_PREFIX)), knownDeltaIds);
		if (lateDeltas.length) {
			setStatus("syncing", lateDeltas.length + " nachträgliche(s) Änderungspaket(e) einlesen…");
			const lateEvents = (await mapLimit(lateDeltas, 6, downloadPayload)).flatMap((p) => Array.isArray(p?.events) ? p.events : []);
			if (lateEvents.length) {
				// v8: Nachzügler-Deltas bringen Heft-Striche jetzt SELBST mit — der frühere zweite
				// Blob-Durchgang [H1] ist damit gegenstandslos geworden.
				await importJson(JSON.stringify({ app: "impala67", version: 2, exportedAt: U.now(), events: lateEvents, blobs: {} }));
			}
			lateDeltas.forEach((f) => knownDeltaIds.add(f.id));
			saveKnownIds("impala67_drive_known_deltas", knownDeltaIds);
		}
		replayImported(importedEvents);
		LS.setItem("impala67_drive_synced_seq", String(await DB.maxSeq()));
		// v8: Ein Sync ist fertig, wenn die Events übertragen sind — es gibt keinen zweiten Kanal
		// mehr, auf den man noch warten müsste. Kein „n Heft-Stände werden nachgeholt“, kein Nachlauf.
		setStatus("ok", imported || uploaded ? "Synchronisiert" : "Aktuell");
		return { imported, uploaded, conflicts, conflictDetails, merged, mergedDetails, importedEvents };
	}

	// [A6] Kurzweg für pagehide: NUR hochladen — kein Pull, kein Lock-Warten, keine Blob-Runde.
	// Alles, was vor dem Upload eine Netz-Rundreise braucht, ist beim Schließen verlorene Zeit; ohne
	// gültiges Token im Speicher ist ohnehin nichts mehr zu retten. Scheitert der Upload (Paket über
	// der keepalive-Schranke von ~64 KB), bleibt der Wasserstand stehen und der nächste Start holt es
	// nach — ein ehrlicher Fehlschlag statt eines Flushs, der nur auf dem Papier stattfindet.
	async function flushUpload() {
		if (!autoEnabled() || !isConnected()) return;
		const saved = validSavedToken();
		if (!saved) return;
		token = saved;
		const localMaxSeq = await DB.maxSeq();
		const uploadedSeq = Math.min(Number(LS.getItem("impala67_drive_uploaded_seq") || 0), localMaxSeq);
		if (!shouldUploadDelta(localMaxSeq, uploadedSeq)) return;
		const events = pruneForUpload(await DB.eventsAfterSeq(uploadedSeq));
		if (!events.length) return;
		flushMode = true;
		try {
			const packed = await encodeJson({ app: "impala67", version: 2, exportedAt: U.now(), events, blobs: {} });
			const created = await uploadNamed(DELTA_PREFIX + DEVICE_ID + "-" + (uploadedSeq + 1) + "-" + localMaxSeq + ".json.gz",
				packed.bytes, packed.encoding, null, { device: DEVICE_ID, from: String(uploadedSeq + 1), to: String(localMaxSeq) });
			const known = loadKnownIds("impala67_drive_known_deltas");
			known.add(created.id);
			saveKnownIds("impala67_drive_known_deltas", known);
			LS.setItem("impala67_drive_uploaded_seq", String(localMaxSeq));
		} finally {
			flushMode = false;
		}
	}

	// Web Lock gegen Multi-Tab-Races: Datei-Index, known_deltas und uploaded_seq liegen in
	// localStorage — zwei gleichzeitig syncende Tabs überschrieben sich sonst gegenseitig
	// (syncInFlight wirkt nur im eigenen Tab). ifAvailable: der zweite Tab wartet nicht,
	// sein nächster Auto-Sync holt alles nach. Ohne Locks-API: bisheriges Verhalten.
	const IDLE_RESULT = { imported: 0, uploaded: 0, conflicts: 0, conflictDetails: [], merged: 0, mergedDetails: [], importedEvents: [], skipped: "lock" };
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
	const AUTO_DELAY_MS = 3000, AUTO_INTERVAL_MS = 180000, LIVE_INTERVAL_MS = 20000;
	// [A5] Obergrenze fürs Aufschieben. isEditing() sah bisher nur den FOKUS, nicht das Tippen — ein im
	// Block geparkter Cursor (der Normalfall beim Lesen der eigenen Notizen) hielt die 5-s-Warteschleife
	// beliebig lange am Laufen. Der Status stand dauerhaft auf "Speichert…", die Änderungen lagen
	// unsynchronisiert herum, bis zufällig ein visibilitychange kam.
	const MAX_DEFER_MS = 60000;
	let deferSince = 0, lastKeyAt = 0;
	document.addEventListener("keydown", () => { lastKeyAt = Date.now(); }, true);
	let autoTimer = 0, autoIntervalTimer = 0, autoStarted = false, autoResultHandler = null;
	const autoEnabled = () => LS.getItem("impala67.driveAutoSync") !== "0";
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
		if (!deferSince) deferSince = Date.now(); // [A5] Beginn des Aufschiebens merken
		clearTimeout(autoTimer);
		emitSyncStatus("waiting", navigator.onLine === false ? "Offline · wartet" : "Speichert…");
		autoTimer = setTimeout(() => {
			// Während getippt wird: weiter bündeln, in 5 s erneut prüfen — aber [A5] höchstens
			// MAX_DEFER_MS lang. Danach wird gesynct, egal wo der Cursor gerade steht. Nach v8 ist
			// ein Replay ohnehin additiv, das ursprüngliche Ziel von [F3] bleibt gewahrt.
			if (isEditing() && Date.now() - deferSince < MAX_DEFER_MS) { autoTimer = setTimeout(() => scheduleAutoSync(reason), 5000); return; }
			deferSince = 0;
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
		// [A6] Best-Effort-Flush beim Schließen — jetzt über den Kurzweg. Vorher lief hier der VOLLE
		// syncRaw: Web Lock (ohne ifAvailable, kann also warten), getToken, listSyncFiles, Snapshot-
		// und Delta-Downloads, Blob-Runde. Der Browser friert das Dokument nach pagehide binnen
		// Millisekunden ein — der keepalive-Upload in uploadNamed wurde praktisch nie erreicht.
		// Der versprochene Flush fand faktisch nicht statt. visibilitychange→hidden deckt den
		// Regelfall ohnehin schon vollständig ab; das hier ist die letzte Rettung.
		window.addEventListener("pagehide", () => { flushUpload().catch(() => {}); });
		// Adaptiv: Ist gerade ein Heft offen, wird alle 20 s geschaut, sonst alle 3 min.
		// So erscheinen fremde Striche fast live, ohne im Ruhezustand Traffic zu erzeugen.
		const heftOpen = () => !!document.querySelector(".heft-chrome");
		const tick = () => {
			if (!document.hidden) autoSync("interval");
			const next = !document.hidden && heftOpen() ? LIVE_INTERVAL_MS : AUTO_INTERVAL_MS;
			autoIntervalTimer = window.setTimeout(tick, next);
		};
		autoIntervalTimer = window.setTimeout(tick, LIVE_INTERVAL_MS);
		return autoSync("start");
	}

	return { login, logout, sync, isConnected, startAutoSync };
})();