// updater.js — Version + Update-Check (Tauri-Banner beim Start, PWA/Settings manuell).
// Kanonische Version: version.json (neben dieser Datei). Fallback unten nur wenn Fetch fehlschlägt.
// Bei Release: version.json + latest.json + ggf. Tauri package version gemeinsam anheben.
window.APP_VERSION = "0.2.18";

// Laufende Version aus version.json nachladen (same-origin / Modul-URL) — verhindert
// „falsche Version“, wenn nur version.json deployed wurde oder der Fallback veraltet ist.
try {
	const verUrl = new URL("./version.json", import.meta.url);
	verUrl.searchParams.set("t", String(Date.now()));
	const verRes = await fetch(verUrl, { cache: "no-store" });
	if (verRes.ok) {
		const verData = await verRes.json();
		const v = String((verData && verData.version) || "").replace(/^v/i, "").trim();
		if (v) window.APP_VERSION = v;
	}
} catch (e) {
	/* Fallback window.APP_VERSION bleibt */
}

// Semver-Vergleich: 1 wenn a>b, -1 wenn a<b, 0 wenn gleich.
function cmpSemver(a, b) {
	const parse = (v) => String(v || "").replace(/^v/i, "").split(/[.+\-]/).map((p) => {
		const n = parseInt(p, 10);
		return Number.isFinite(n) ? n : 0;
	});
	const pa = parse(a), pb = parse(b);
	const len = Math.max(pa.length, pb.length);
	for (let i = 0; i < len; i++) {
		const d = (pa[i] || 0) - (pb[i] || 0);
		if (d) return d > 0 ? 1 : -1;
	}
	return 0;
}

function normVer(v) {
	return String(v || "").replace(/^v/i, "").trim();
}

// PWA: SW anstupsen + hard-ish Reload (network-first holt den Stand).
window.applyPwaUpdate = async function applyPwaUpdate() {
	try {
		if ("serviceWorker" in navigator) {
			const regs = await navigator.serviceWorker.getRegistrations();
			await Promise.all(regs.map((r) => r.update().catch(() => {})));
		}
	} catch (e) {
		console.warn("PWA-Update vorbereiten:", e);
	}
	// Cache-Bust: voller Reload der App
	const u = new URL(location.href);
	u.searchParams.set("_v", String(Date.now()));
	location.replace(u.pathname + u.search + u.hash);
};

// JSON von URL lesen; optional Cache-Bust-Query.
async function fetchJson(url, bust) {
	const u = new URL(url, location.href);
	if (bust) u.searchParams.set("t", String(Date.now()));
	const res = await fetch(u.toString(), { cache: "no-store" });
	if (!res.ok) throw new Error("HTTP " + res.status + " @ " + u.pathname);
	const ct = (res.headers.get("content-type") || "").toLowerCase();
	// HTML-Fallback (SPA/404) nie als Version werten
	if (ct.includes("text/html")) throw new Error("HTML statt JSON @ " + u.pathname);
	return res.json();
}

// Neueste Version für PWA — Reihenfolge:
// 1) same-origin version.json / latest.json (zuverlässig, kein CORS)
// 2) GitHub Releases API
// 3) raw.githubusercontent.com
async function fetchLatestVersionPwa() {
	const errors = [];
	const tryOne = async (label, fn) => {
		try {
			const r = await fn();
			if (r && r.latest) return r;
			throw new Error(label + ": leer");
		} catch (e) {
			errors.push(label + ": " + (e && e.message ? e.message : e));
			return null;
		}
	};

	// 1) Deployed App (gleiche Origin) — das ist die Wahrheit für die PWA
	let hit = await tryOne("version.json", async () => {
		const data = await fetchJson("./version.json", true);
		return { latest: normVer(data.version), source: "version.json" };
	});
	if (hit) return hit;

	hit = await tryOne("latest.json", async () => {
		const data = await fetchJson("./latest.json", true);
		return { latest: normVer(data.version), source: "latest.json" };
	});
	if (hit) return hit;

	// 2) GitHub API (kann bei privatem Repo / Rate-Limit scheitern)
	hit = await tryOne("GitHub API", async () => {
		const res = await fetch("https://api.github.com/repos/prinzpuma/Impala67/releases/latest", {
			cache: "no-store",
			headers: { Accept: "application/vnd.github+json" },
		});
		if (!res.ok) throw new Error("HTTP " + res.status);
		const data = await res.json();
		const latest = normVer(data.tag_name || data.name || "");
		if (!latest) throw new Error("keine tag_name");
		return { latest, source: "github-api" };
	});
	if (hit) return hit;

	// 3) raw.githubusercontent.com
	for (const path of [
		"https://raw.githubusercontent.com/prinzpuma/Impala67/main/web/version.json",
		"https://raw.githubusercontent.com/prinzpuma/Impala67/main/web/latest.json",
		"https://raw.githubusercontent.com/prinzpuma/Impala67/refactor/cleanup/web/version.json",
		"https://raw.githubusercontent.com/prinzpuma/Impala67/refactor/cleanup/web/latest.json",
	]) {
		hit = await tryOne(path, async () => {
			const data = await fetchJson(path, true);
			return { latest: normVer(data.version), source: "raw" };
		});
		if (hit) return hit;
	}

	throw new Error(errors.slice(0, 3).join(" · ") || "Keine Versionsquelle erreichbar");
}

// Aktuelle laufende Version (nach version.json-Load / Fallback).
window.getAppVersion = function getAppVersion() {
	return normVer(window.APP_VERSION || "");
};

// Manueller Check aus Einstellungen → Update (Desktop + PWA).
window.checkAppUpdate = async function checkAppUpdate() {
	// Nochmal version.json lesen — falls Settings vor dem ersten Load geöffnet wurden
	// oder APP_VERSION zwischenzeitlich veraltet war.
	try {
		const data = await fetchJson("./version.json", true);
		const v = normVer(data.version);
		if (v) window.APP_VERSION = v;
	} catch { /* Fallback behalten */ }

	const cur = normVer(window.APP_VERSION || "");
	if (!cur) throw new Error("APP_VERSION fehlt (updater.js / version.json)");

	if (window.__TAURI__ && window.__TAURI__.updater) {
		const update = await window.__TAURI__.updater.check();
		if (!update) return { ok: true, latest: cur, current: cur, hasUpdate: false, source: "tauri" };
		const latest = normVer(update.version || "");
		return {
			ok: true,
			latest: latest || cur,
			current: cur,
			hasUpdate: cmpSemver(latest, cur) > 0,
			update: update,
			source: "tauri",
		};
	}

	// PWA / Browser — Remote = deployed version.json (same-origin), nicht altes GitHub-Release
	const { latest, source } = await fetchLatestVersionPwa();
	const remote = latest || cur;
	return {
		ok: true,
		latest: remote,
		current: cur,
		hasUpdate: cmpSemver(remote, cur) > 0,
		source: source || "unknown",
		remoteOlder: cmpSemver(remote, cur) < 0,
	};
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