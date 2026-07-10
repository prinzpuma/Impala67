// updater.js — Version + Update-Check (Tauri-Banner beim Start, PWA/Settings manuell).
// APP_VERSION bei Release/auto-version mitbumpen (gleicher Stand wie package.json).
window.APP_VERSION = "0.2.18";

// Manueller Check aus Einstellungen → Update (Desktop + PWA).
window.checkAppUpdate = async function checkAppUpdate() {
	const cur = String(window.APP_VERSION || "").replace(/^v/, "");
	if (window.__TAURI__ && window.__TAURI__.updater) {
		const update = await window.__TAURI__.updater.check();
		if (!update) return { ok: true, latest: cur, current: cur, hasUpdate: false };
		return { ok: true, latest: String(update.version || "").replace(/^v/, ""), current: cur, hasUpdate: true, update: update };
	}
	const res = await fetch("https://github.com/prinzpuma/Impala67/releases/latest/download/latest.json", { cache: "no-store" });
	if (!res.ok) throw new Error("HTTP " + res.status);
	const data = await res.json();
	const latest = String(data.version || "").replace(/^v/, "");
	return { ok: true, latest: latest || cur, current: cur, hasUpdate: !!(latest && latest !== cur) };
};

// Beim Start nur in der Tauri-App: Banner mit Installieren/Später.
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