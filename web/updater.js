// updater.js — Version + Update-Check (Tauri-Banner beim Start, PWA/Settings manuell).
//
// WICHTIG — zwei verschiedene „Versionen“:
//   BUILD_VERSION / APP_VERSION = die Version DIESES geladenen JS-Bundles (lokal/läuft).
//   version.json auf dem Server     = deployed Stand (remote), frisch per no-store geladen.
// Niemals APP_VERSION mit der Remote-Antwort überschreiben — sonst ist „Lokal“ immer
// gleich „Remote“ und die Anzeige/Update-Erkennung ist falsch.
//
// Bei Release: wird von .github/workflows/auto-version.yml gesetzt
// (zusammen mit package.json, tauri.conf.json, web/version.json, web/latest.json).
// Nicht von Hand pflegen — Git bump't die Patch-Nummer auf main.
//
// NIE Merge-Konfliktmarker (<<<<<<< ======= >>>>>>>) committen — bricht die PWA.
const BUILD_VERSION = "0.2.27";
window.APP_VERSION = BUILD_VERSION;

// Semver-Vergleich: 1 wenn a>b, -1 wenn a<b, 0 wenn gleich.
// FIX (Verbesserung): Prerelease-Tags nach Semver-Spezifikation vergleichen — vorher
// zählten sie als 0 und "0.2.27-rc1" galt als gleich "0.2.27" (RC würde nie durch das
// finale Release ersetzt bzw. umgekehrt fälschlich als Update angeboten).
function cmpSemver(a, b) {
	const parse = (v) => {
		const s = String(v || "").replace(/^v/i, "").split("+")[0].trim(); // Build-Metadaten zählen nicht
		const dash = s.indexOf("-");
		const core = (dash < 0 ? s : s.slice(0, dash)).split(".").map((p) => {
			const n = parseInt(p, 10);
			return Number.isFinite(n) ? n : 0;
		});
		return { core, pre: dash < 0 ? [] : s.slice(dash + 1).split(".") };
	};
	const pa = parse(a), pb = parse(b);
	const len = Math.max(pa.core.length, pb.core.length);
	for (let i = 0; i < len; i++) {
		const d = (pa.core[i] || 0) - (pb.core[i] || 0);
		if (d) return d > 0 ? 1 : -1;
	}
	// Gleicher Kern: Version OHNE Prerelease ist die höhere ("1.0.0-rc1" < "1.0.0").
	if (pa.pre.length && !pb.pre.length) return -1;
	if (!pa.pre.length && pb.pre.length) return 1;
	for (let i = 0; i < Math.max(pa.pre.length, pb.pre.length); i++) {
		const x = pa.pre[i], y = pb.pre[i];
		if (x === undefined) return -1; // kürzere Prerelease-Liste ist die kleinere
		if (y === undefined) return 1;
		const nx = /^\d+$/.test(x), ny = /^\d+$/.test(y);
		if (nx && ny) { const d = Number(x) - Number(y); if (d) return d > 0 ? 1 : -1; }
		else if (nx !== ny) { return nx ? -1 : 1; } // numerisch < alphanumerisch
		else if (x !== y) { return x < y ? -1 : 1; }
	}
	return 0;
}

function normVer(v) {
	return String(v || "").replace(/^v/i, "").trim();
}

// PWA: SW anstupsen + Reload (network-first holt den Stand). Kein externes Browser-Fenster.
window.applyPwaUpdate = async function applyPwaUpdate() {
	try {
		if ("serviceWorker" in navigator) {
			const regs = await navigator.serviceWorker.getRegistrations();
			await Promise.all(regs.map((r) => r.update().catch(() => {})));
			// Warte kurz, damit der neue SW aktiv werden kann
			await new Promise((r) => setTimeout(r, 200));
		}
	} catch (e) {
		console.warn("PWA-Update vorbereiten:", e);
	}
	const u = new URL(location.href);
	u.searchParams.set("_v", String(Date.now()));
	location.replace(u.pathname + u.search + (u.hash || ""));
};

async function fetchJson(url, bust) {
	const u = new URL(url, location.href);
	if (bust) u.searchParams.set("t", String(Date.now()));
	const res = await fetch(u.toString(), {
		cache: "no-store",
		credentials: "same-origin",
	});
	if (!res.ok) throw new Error("HTTP " + res.status + " @ " + u.pathname);
	const ct = (res.headers.get("content-type") || "").toLowerCase();
	if (ct.includes("text/html")) throw new Error("HTML statt JSON @ " + u.pathname);
	return res.json();
}

// Deployed Version für PWA: NUR same-origin (kein GitHub — das liefert oft die
// Desktop-Release-Nummer 0.1.x und öffnet auf iPad im Fehlerfall den Safari-Tab).
async function fetchDeployedVersionPwa() {
	const errors = [];
	for (const file of ["./version.json", "./latest.json"]) {
		try {
			const data = await fetchJson(file, true);
			const latest = normVer(data.version);
			if (latest) return { latest, source: file.replace(/^\.\//, "") };
			throw new Error("leere version");
		} catch (e) {
			errors.push(file + ": " + (e && e.message ? e.message : e));
		}
	}
	// Modul-relative URL als Extra-Versuch (falls App unter Unterpfad liegt)
	try {
		const u = new URL("./version.json", import.meta.url);
		u.searchParams.set("t", String(Date.now()));
		const res = await fetch(u, { cache: "no-store" });
		if (!res.ok) throw new Error("HTTP " + res.status);
		const data = await res.json();
		const latest = normVer(data.version);
		if (latest) return { latest, source: "version.json(module)" };
	} catch (e) {
		errors.push("module: " + (e && e.message ? e.message : e));
	}
	throw new Error(errors.join(" · ") || "version.json nicht erreichbar");
}

window.getAppVersion = function getAppVersion() {
	// Immer die gebaute Bundle-Version — nie Remote.
	return normVer(window.APP_VERSION || BUILD_VERSION || "");
};

// Manueller Check (Desktop + PWA). Öffnet NIEMALS ein externes Browser-Fenster.
window.checkAppUpdate = async function checkAppUpdate() {
	const cur = normVer(window.APP_VERSION || BUILD_VERSION || "");
	if (!cur) throw new Error("BUILD_VERSION fehlt in updater.js");

	// Desktop (Tauri)
	if (window.__TAURI__ && window.__TAURI__.updater) {
		try {
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
		} catch (e) {
			// Kein window.open — Fehler an die UI durchreichen
			throw new Error("Tauri-Update: " + (e && e.message ? e.message : e));
		}
	}

	// PWA / Browser: deployed version.json vs. laufendes Bundle
	const { latest, source } = await fetchDeployedVersionPwa();
	const remote = latest || cur;
	return {
		ok: true,
		latest: remote,
		current: cur,
		hasUpdate: cmpSemver(remote, cur) > 0,
		source: source || "version.json",
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