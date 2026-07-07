// updater.js — prüft beim Start auf ein neues Windows-Paket und installiert es.
// Läuft nur innerhalb der Tauri-App (window.__TAURI__ vorhanden); im normalen
// Browser/PWA passiert hier nichts, die Datei ist dann einfach wirkungslos.
(async function () {
	if (!window.__TAURI__ || !window.__TAURI__.updater) return;
	try {
		const update = await window.__TAURI__.updater.check();
		if (!update) return;
		const banner = document.createElement("div");
		banner.style = "position:fixed;bottom:16px;left:16px;z-index:50;padding:10px 14px;border-radius:10px;" +
			"background:#1f2127;color:#fff;font:13px sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.5);";
		banner.textContent = "⬇️ Update " + update.version + " wird geladen…";
		document.body.appendChild(banner);
		await update.downloadAndInstall();
		banner.textContent = "✅ Update installiert — Neustart…";
		await window.__TAURI__.process.relaunch();
	} catch (e) {
		console.warn("Update-Check fehlgeschlagen:", e);
	}
})();