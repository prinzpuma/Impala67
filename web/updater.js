// updater.js — PWA-Version und kontrolliertes Neuladen.
// BUILD_VERSION beschreibt immer das aktuell geladene Bundle; version.json den
// veröffentlichten Stand. Der Release-Workflow setzt beide Werte gemeinsam.
const BUILD_VERSION = "0.3.0";
window.APP_VERSION = BUILD_VERSION;

function cmpSemver(a, b) {
	const parse = (v) => {
		const s = String(v || "").replace(/^v/i, "").split("+")[0].trim();
		const dash = s.indexOf("-");
		const core = (dash < 0 ? s : s.slice(0, dash)).split(".").map((p) => {
			const n = parseInt(p, 10);
			return Number.isFinite(n) ? n : 0;
		});
		return { core, pre: dash < 0 ? [] : s.slice(dash + 1).split(".") };
	};
	const pa = parse(a), pb = parse(b);
	for (let i = 0; i < Math.max(pa.core.length, pb.core.length); i++) {
		const d = (pa.core[i] || 0) - (pb.core[i] || 0);
		if (d) return d > 0 ? 1 : -1;
	}
	if (pa.pre.length && !pb.pre.length) return -1;
	if (!pa.pre.length && pb.pre.length) return 1;
	for (let i = 0; i < Math.max(pa.pre.length, pb.pre.length); i++) {
		const x = pa.pre[i], y = pb.pre[i];
		if (x === undefined) return -1;
		if (y === undefined) return 1;
		const nx = /^\d+$/.test(x), ny = /^\d+$/.test(y);
		if (nx && ny) { const d = Number(x) - Number(y); if (d) return d > 0 ? 1 : -1; }
		else if (nx !== ny) return nx ? -1 : 1;
		else if (x !== y) return x < y ? -1 : 1;
	}
	return 0;
}

const normVer = (v) => String(v || "").replace(/^v/i, "").trim();
let pendingUpdate = null;
let preparingUpdate = null;

function waitForActivation(reg) {
	return new Promise((resolve) => {
		const worker = reg.installing || reg.waiting;
		if (!worker || worker.state === "activated" || worker.state === "redundant") return resolve();
		worker.addEventListener("statechange", () => {
			if (worker.state === "activated" || worker.state === "redundant") resolve();
		});
	});
}

async function refreshServiceWorker() {
	if (!("serviceWorker" in navigator)) return;
	try {
		// Nur der Worker dieser App ist relevant. Fremde Registrierungen desselben
		// Origins duerfen den Reload nicht bis zum Timeout verzoegern.
		const reg = await navigator.serviceWorker.getRegistration(new URL("./", import.meta.url));
		if (!reg) return;
		await reg.update();
		await Promise.race([
			waitForActivation(reg),
			new Promise((resolve) => setTimeout(resolve, 4000)),
		]);
	} catch (error) {
		console.warn("PWA-Update vorbereiten:", error);
	}
}

function reloadWithCacheBust() {
	const url = new URL(location.href);
	url.searchParams.set("_v", String(Date.now()));
	location.replace(url.toString());
}

async function fetchJson(url) {
	const requestUrl = new URL(url, location.href);
	requestUrl.searchParams.set("t", String(Date.now()));
	const response = await fetch(requestUrl, { cache: "no-store", credentials: "same-origin" });
	if (!response.ok) throw new Error("HTTP " + response.status + " @ " + requestUrl.pathname);
	if ((response.headers.get("content-type") || "").toLowerCase().includes("text/html")) {
		throw new Error("HTML statt JSON @ " + requestUrl.pathname);
	}
	return response.json();
}

async function fetchWorkerVersion() {
	const requestUrl = new URL("./service-worker.js", import.meta.url);
	requestUrl.searchParams.set("t", String(Date.now()));
	const response = await fetch(requestUrl, { cache: "no-store", credentials: "same-origin" });
	if (!response.ok) throw new Error("HTTP " + response.status + " @ " + requestUrl.pathname);
	const text = await response.text();
	if (/^\s*</.test(text)) throw new Error("HTML statt Service Worker @ " + requestUrl.pathname);
	const match = text.match(/const\s+CACHE\s*=\s*["']impala67-v([^"']+)["']/);
	const latest = normVer(match && match[1]);
	// Im lokalen Quellstand kann der Cache eine interne Nummer wie v171 tragen.
	// Veröffentlichte Builds werden vom Release-Workflow auf vMAJOR.MINOR.PATCH gesetzt.
	if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(latest)) {
		throw new Error("keine Release-Version in service-worker.js");
	}
	return latest;
}

async function fetchDeployedVersion() {
	const errors = [];
	for (const [source, url] of [["version.json", "./version.json"], ["version.json(module)", new URL("./version.json", import.meta.url)]]) {
		try {
			const data = await fetchJson(url);
			const latest = normVer(data.version);
			if (latest) return { latest, source };
			throw new Error("leere Version");
		} catch (error) {
			errors.push(source + ": " + (error?.message || error));
		}
	}
	try {
		return { latest: await fetchWorkerVersion(), source: "service-worker.js" };
	} catch (error) {
		errors.push("service-worker.js: " + (error?.message || error));
	}
	throw new Error(errors.join(" · ") || "version.json nicht erreichbar");
}

window.getAppVersion = () => normVer(window.APP_VERSION || BUILD_VERSION);

window.checkAppUpdate = async function checkAppUpdate() {
	const current = window.getAppVersion();
	if (!current) throw new Error("BUILD_VERSION fehlt in updater.js");
	const { latest, source } = await fetchDeployedVersion();
	const hasUpdate = cmpSemver(latest, current) > 0;
	pendingUpdate = hasUpdate ? { version: latest } : null;
	// Den neuen Worker bereits waehrend der Anzeige vorbereiten. Der bewusste
	// Klick bleibt erhalten, muss aber meist nur noch neu laden.
	preparingUpdate = hasUpdate ? refreshServiceWorker() : null;
	return {
		ok: true,
		latest,
		current,
		hasUpdate,
		source,
		remoteOlder: cmpSemver(latest, current) < 0,
	};
};

window.installAppUpdate = async function installAppUpdate(onStatus) {
	const say = (text) => { try { if (typeof onStatus === "function") onStatus(text); } catch { /* UI geschlossen */ } };
	say(pendingUpdate ? "⬇️ Update wird geladen…" : "🔄 App wird neu geladen…");
	await (preparingUpdate || refreshServiceWorker());
	pendingUpdate = null;
	preparingUpdate = null;
	say("🔄 App wird neu geladen…");
	reloadWithCacheBust();
	return { reloaded: true };
};

window.applyPwaUpdate = () => window.installAppUpdate();

export { cmpSemver, fetchDeployedVersion };
