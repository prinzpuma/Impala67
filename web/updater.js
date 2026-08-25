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
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let pendingUpdate = null;
let preparingUpdate = null;

function waitForWaiting(reg) {
	return new Promise((resolve) => {
		if (reg?.waiting) return resolve(reg.waiting);
		const worker = reg?.installing;
		if (!worker) return resolve(null);
		const onState = () => {
			if (worker.state === "installed") { worker.removeEventListener("statechange", onState); resolve(reg.waiting || worker); }
			else if (worker.state === "activated" || worker.state === "redundant") { worker.removeEventListener("statechange", onState); resolve(null); }
		};
		worker.addEventListener("statechange", onState);
		onState();
	});
}

async function refreshServiceWorker() {
	if (!("serviceWorker" in navigator)) return null;
	try {
		// Nur der Worker dieser App ist relevant. Das Update darf bereits geladen
		// werden, bleibt aber "waiting" und übernimmt die laufende App noch nicht.
		const reg = await navigator.serviceWorker.getRegistration(new URL("./", import.meta.url));
		if (!reg) return null;
		await reg.update();
		await Promise.race([waitForWaiting(reg), delay(10000)]);
		return reg;
	} catch (error) {
		console.warn("PWA-Update vorbereiten:", error);
		return null;
	}
}

async function workerVersion(worker, timeoutMs = 2500) {
	if (!worker || typeof MessageChannel === "undefined") return "";
	return new Promise((resolve) => {
		const channel = new MessageChannel();
		const timer = setTimeout(() => { channel.port1.close(); resolve(""); }, timeoutMs);
		channel.port1.onmessage = (event) => {
			clearTimeout(timer);
			channel.port1.close();
			resolve(normVer(event.data?.version));
		};
		try { worker.postMessage({ type: "GET_VERSION" }, [channel.port2]); }
		catch { clearTimeout(timer); channel.port1.close(); resolve(""); }
	});
}

async function waitForActiveVersion(expected, timeoutMs = 15000) {
	const end = Date.now() + timeoutMs;
	do {
		const version = await workerVersion(navigator.serviceWorker?.controller);
		if (version === normVer(expected)) return true;
		await delay(100);
	} while (Date.now() < end);
	return false;
}

async function activateWaitingWorker(reg, expectedVersion) {
	const waiting = reg?.waiting;
	if (!waiting) return false;
	const waitingVersion = await workerVersion(waiting);
	if (expectedVersion && waitingVersion !== normVer(expectedVersion)) {
		throw new Error("Geladener Service Worker hat Version " + (waitingVersion || "unbekannt") + " statt " + expectedVersion + ".");
	}
	waiting.postMessage({ type: "SKIP_WAITING" });
	if (expectedVersion) return waitForActiveVersion(expectedVersion);
	await delay(500);
	return navigator.serviceWorker.controller === reg.active;
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
	// Das neue Bundle bereits laden, aber NICHT aktivieren. Erst der bewusste
	// Klick sendet SKIP_WAITING; so kann keine alte UI neue Lazy-Module erhalten.
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
	const expectedVersion = pendingUpdate?.version || "";
	const say = (text) => { try { if (typeof onStatus === "function") onStatus(text); } catch { /* UI geschlossen */ } };
	say(expectedVersion ? "⬇️ Update wird vollständig geladen…" : "🔄 App wird neu geladen…");
	const reg = await (preparingUpdate || refreshServiceWorker());
	if (expectedVersion && !reg) throw new Error("Das Update konnte nicht vollständig geladen werden.");
	if (reg?.waiting) {
		say("⚙️ Update wird aktiviert…");
		const activated = await activateWaitingWorker(reg, expectedVersion);
		if (expectedVersion && !activated) throw new Error("Die neue App-Version wurde nicht aktiv. Bitte erneut versuchen.");
	} else if (expectedVersion) {
		// Ein anderer Tab kann den Worker zwischen Prüfung und Klick bereits aktiviert
		// haben. Nur wenn der aktuell kontrollierende Worker exakt die erwartete Version
		// bestätigt, darf die Seite neu geladen werden.
		say("🔎 Aktive Version wird bestätigt…");
		if (!(await waitForActiveVersion(expectedVersion, 3000))) {
			throw new Error("Die neue App-Version ist noch nicht aktiv. Bitte erneut versuchen.");
		}
	}
	pendingUpdate = null;
	preparingUpdate = null;
	say(expectedVersion ? "✅ Update aktiv · App wird neu geladen…" : "🔄 App wird neu geladen…");
	reloadWithCacheBust();
	return { reloaded: true };
};

window.applyPwaUpdate = () => window.installAppUpdate();

export { cmpSemver, fetchDeployedVersion, refreshServiceWorker, workerVersion, waitForActiveVersion };
