"use strict";
import { S } from "./state.js";
import { DB } from "./db.js";
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
	const LEGACY_FILE_NAME = "notion-sync.json"; // vor der Umbenennung — wird beim nächsten Upload automatisch auf den neuen Namen umgestellt
	// Desktop-OAuth-Client (Typ "Desktop-App", Google Cloud Console). Das Secret
	// ist bei diesem App-Typ laut Google kein echtes Geheimnis (installierte Apps
	// können ohnehin keine Geheimnisse wahren) — normaler, vorgesehener Fall.
	// Werte kommen aus web/config.local.js (lokal, NICHT im Git-Repo — siehe .gitignore).
	// Bei GitHub-Actions-Builds wird diese Datei automatisch aus Repo-Secrets erzeugt.
	// FIX: lazy lesen statt beim Modul-Import — config.local.js wird seit dem
	// Start-Bug-Fix asynchron/optional geladen; zum Import-Zeitpunkt wäre
	// window.APP_CONFIG evtl. noch nicht gesetzt (Race Condition).
	const desktopClientId = () => (window.APP_CONFIG && window.APP_CONFIG.GOOGLE_DESKTOP_CLIENT_ID) || "";
	let token = null;

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
				redirect_uri: redirectUri, grant_type: "authorization_code", code_verifier: verifier,
			}),
		});
		if (!res.ok) throw new Error("Token-Tausch fehlgeschlagen: " + (await res.text()).slice(0, 200));
		return res.json();
	}

	async function refreshDesktopToken(refreshToken) {
		const res = await fetch("https://oauth2.googleapis.com/token", {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				client_id: desktopClientId(),
				refresh_token: refreshToken, grant_type: "refresh_token",
			}),
		});
		if (!res.ok) return null;
		return res.json();
	}

	function saveToken(data) {
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
			throw new Error("Google-Login nicht möglich: Die Desktop-Client-ID fehlt (web/config.local.js nicht vorhanden oder leer). Einrichtung: siehe Doku-Seite „Google-Login Desktop-Fix (Loopback-OAuth)“ — dort steht, wie du den Desktop-OAuth-Client anlegst und die config.local.js befüllst.");
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
			window.__TAURI__.event.once("redirect_uri", (event) => {
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
		return files[0] || null;
	}

	async function upload(fileId, content) {
		const meta = { name: FILE_NAME, ...(fileId ? {} : { parents: ["appDataFolder"] }) };
		const boundary = "impala67" + Date.now();
		const body =
			"--" + boundary + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" + JSON.stringify(meta) +
			"\r\n--" + boundary + "\r\nContent-Type: application/json\r\n\r\n" + content +
			"\r\n--" + boundary + "--";
		await api("/upload/drive/v3/files" + (fileId ? "/" + fileId : "") + "?uploadType=multipart", {
			method: fileId ? "PATCH" : "POST",
			headers: { "Content-Type": "multipart/related; boundary=" + boundary },
			body,
		});
	}

	// Voller Sync: Remote-Stand laden → mergen → Gesamtstand hochladen.
	async function sync(onStatus) {
		// Token immer über getToken() beziehen — das im Speicher gehaltene Token
		// kann abgelaufen sein (führte zu 401-Fehlern mitten in der Sitzung).
		if (onStatus) onStatus("Mit Google verbinden…");
		await getToken(false);
		if (onStatus) onStatus("Remote-Stand laden…");
		const file = await findFile();
		let imported = 0;
		if (file) {
			const res = await api("/drive/v3/files/" + file.id + "?alt=media");
			imported = await DB.importAll(await res.text());
		}
		if (onStatus) onStatus("Hochladen…");
		await upload(file ? file.id : null, await DB.exportAll());
		return imported;
	}

	return { login, logout, sync, isConnected: () => !!token };
})();