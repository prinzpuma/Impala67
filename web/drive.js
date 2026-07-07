"use strict";
// drive.js — Google-Drive-Sync über den unsichtbaren App-Speicher (appDataFolder).
// Technischer Hintergrund: Google verlangt für JEDE App eine registrierte OAuth
// Client-ID (das ist eine Plattform-Vorgabe von Google, keine Aura-Beschränkung).
// Diese Client-ID muss EINMALIG in der Google Cloud Console erstellt und in den
// Einstellungen → Sync hinterlegt werden. Danach reduziert sich alles Weitere
// wirklich auf einen Klick: "Mit Google anmelden" → Google-Popup → verbunden.
const DRIVE = (() => {
	const SCOPE = "https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/userinfo.email";
	const FILE_NAME = "notion-sync.json";
	let token = null;

	function getToken(interactive) {
		return new Promise((resolve, reject) => {
			// 1. Prüfen, ob wir ein noch gültiges Token im LocalStorage haben
			const savedToken = localStorage.getItem("notion_drive_token");
			const savedExpiry = localStorage.getItem("notion_drive_token_expiry");
			if (savedToken && savedExpiry && Date.now() < Number(savedExpiry)) {
				token = savedToken;
				return resolve(token);
			}

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
						token = resp.access_token;
						// Token im LocalStorage sichern (Google-Tokens gelten i.d.R. 3600 Sekunden = 1 Stunde)
						const expiresIn = resp.expires_in ? Number(resp.expires_in) : 3600;
						localStorage.setItem("notion_drive_token", token);
						localStorage.setItem("notion_drive_token_expiry", String(Date.now() + expiresIn * 1000 - 60000)); // 1 Min Puffer
						resolve(token);
					}
					else reject(new Error("Kein Zugriffstoken erhalten."));
				},
			});
			// prompt: "" versucht einen stillen Login im Hintergrund, falls die Zustimmung bereits erteilt wurde
			tc.requestAccessToken({ prompt: interactive ? "consent" : "" });
		});
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
		localStorage.removeItem("notion_drive_token");
		localStorage.removeItem("notion_drive_token_expiry");
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
		const res = await api("/drive/v3/files?spaces=appDataFolder&q=name='"
			+ FILE_NAME + "'&fields=files(id,modifiedTime)");
		const { files } = await res.json();
		return files[0] || null;
	}

	async function upload(fileId, content) {
		const meta = { name: FILE_NAME, ...(fileId ? {} : { parents: ["appDataFolder"] }) };
		const boundary = "aura" + Date.now();
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
		if (!token) {
			if (onStatus) onStatus("Mit Google verbinden…");
			await getToken(false);
		}
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