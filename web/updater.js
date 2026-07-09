// updater.js — prüft beim Start auf ein neues Windows-Paket.
// FIX (Audit): fragt jetzt per Banner nach, statt mitten in der Sitzung ungefragt
// herunterzuladen, zu installieren und neu zu starten.
// Läuft nur innerhalb der Tauri-App (window.__TAURI__ vorhanden); im normalen
// Browser/PWA passiert hier nichts, die Datei ist dann einfach wirkungslos.
(async function () {
	if (!window.__TAURI__ || !window.__TAURI__.updater) return;
	try {
		const update = await window.__TAURI__.updater.check();
		if (!update) return;
		const banner = document.createElement("div");
		banner.style = "position:fixed;bottom:16px;left:16px;z-index:50;padding:10px 14px;border-radius:10px;" +
			"background:#1f2127;color:#fff;font:13px sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.5);" +
			"display:flex;gap:10px;align-items:center;";
		const label = document.createElement("span");
		label.textContent = "⬇️ Update " + update.version + " verfügbar";
		const btnNow = document.createElement("button");
		btnNow.textContent = "Jetzt installieren";
		btnNow.style = "font:inherit;padding:4px 10px;border-radius:8px;border:none;cursor:pointer;background:#6fc3ff;color:#06090f;";
		const btnLater = document.createElement("button");
		btnLater.textContent = "Später";
		btnLater.style = "font:inherit;padding:4px 10px;border-radius:8px;border:none;cursor:pointer;background:rgba(255,255,255,.12);color:#fff;";
		banner.append(label, btnNow, btnLater);
		document.body.appendChild(banner);
		btnLater.addEventListener("click", () => banner.remove());
		btnNow.addEventListener("click", async () => {
			btnNow.remove();
			btnLater.remove();
			try {
				label.textContent = "⬇️ Update " + update.version + " wird geladen…";
				await update.downloadAndInstall();
				label.textContent = "✅ Update installiert — Neustart…";
				await window.__TAURI__.process.relaunch();
			} catch (e) {
				label.textContent = "⚠️ Update fehlgeschlagen: " + (e.message || e);
				setTimeout(() => banner.remove(), 8000);
			}
		});
	} catch (e) {
		console.warn("Update-Check fehlgeschlagen:", e);
	}
})();