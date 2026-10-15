// updater.js — PWA-Version und kontrolliertes Neuladen.
// BUILD_VERSION beschreibt immer das aktuell geladene Bundle; version.json den
// veröffentlichten Stand. Der Release-Workflow setzt beide Werte gemeinsam.
const BUILD_VERSION = "2.2.77";
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
// Merkt sich über das Neuladen hinweg, welche Version der Klick installieren sollte.
// Der nächste Start prüft damit, ob das Update wirklich angekommen ist.
const UPDATE_TARGET_KEY = "impala67:update-target";
let pendingUpdate = null;
let preparing = null; // { version, promise } — ein Ladevorgang je Zielversion
let reportStatus = () => {};

async function getRegistration() {
	if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
	try { return (await navigator.serviceWorker.getRegistration(new URL("./", import.meta.url))) || null; }
	catch { return null; }
}

// true, sobald der Worker einen der Zielzustände erreicht; false bei redundant/Timeout.
function waitForWorkerState(worker, states, timeoutMs) {
	return new Promise((resolve) => {
		if (!worker) return resolve(false);
		const finish = (ok) => {
			clearTimeout(timer);
			worker.removeEventListener("statechange", onState);
			resolve(ok);
		};
		const onState = () => {
			if (states.includes(worker.state)) finish(true);
			else if (worker.state === "redundant") finish(false);
		};
		const timer = setTimeout(() => finish(false), timeoutMs);
		worker.addEventListener("statechange", onState);
		onState();
	});
}

async function workerVersion(worker, timeoutMs = 2000) {
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

// Lädt den Service Worker der Zielversion vollständig, aktiviert ihn aber NICHT.
// Ergebnis: { worker } (wartet auf Aktivierung), { active: true } (läuft schon,
// nur diese Seite ist alt) oder null (Version noch nicht ladbar).
// Früher wurde nach 10 + 8 s Wartezeit trotzdem neu geladen — lief die Installation
// (~150 Dateien) länger oder schlug sie fehl, startete die App wieder im alten Stand.
async function loadUpdateWorker(expected) {
	const reg = await getRegistration();
	if (!reg) return null;
	const want = normVer(expected);
	const matches = async (worker) => !want || (await workerVersion(worker, 1500)) === want;
	const attempts = want ? 3 : 1;
	for (let attempt = 0; attempt < attempts; attempt++) {
		if (attempt) await delay(3000 * attempt);
		if (reg.installing) {
			reportStatus("Update wird geladen…");
			await waitForWorkerState(reg.installing, ["installed", "activating", "activated"], 120000);
		}
		if (reg.waiting && await matches(reg.waiting)) return { worker: reg.waiting };
		if (want && reg.active && await matches(reg.active)) return { active: true };
		try { await reg.update(); }
		catch (error) { console.warn("PWA-Update laden:", error); }
		if (reg.installing) {
			reportStatus("Update wird geladen…");
			await waitForWorkerState(reg.installing, ["installed", "activating", "activated"], 120000);
		}
		if (reg.waiting && await matches(reg.waiting)) return { worker: reg.waiting };
		if (want && reg.active && await matches(reg.active)) return { active: true };
	}
	return null;
}

function prepareUpdate(expected) {
	const version = normVer(expected);
	if (preparing?.version !== version) {
		const promise = loadUpdateWorker(version).catch((error) => {
			console.warn("PWA-Update vorbereiten:", error);
			return null;
		}).then((result) => {
			// Fehlschlag nicht merken — der nächste Versuch lädt neu.
			if (!result && preparing?.promise === promise) preparing = null;
			return result;
		});
		preparing = { version, promise };
	}
	return preparing.promise;
}

// Erst wenn der neue Worker wirklich "activated" ist, wird neu geladen.
// Sonst bediente der alte Worker die neue Navigation noch aus dem alten Cache.
async function activateWorker(worker) {
	if (worker.state === "activated") return true;
	const changed = new Promise((resolve) => {
		navigator.serviceWorker.addEventListener("controllerchange", () => resolve(true), { once: true });
	});
	const activated = waitForWorkerState(worker, ["activated"], 20000);
	worker.postMessage({ type: "SKIP_WAITING" });
	const ok = await activated;
	if (ok) await Promise.race([changed, delay(1500)]);
	return ok;
}

function rememberUpdateTarget(version) {
	try { localStorage.setItem(UPDATE_TARGET_KEY, normVer(version)); } catch { /* privater Modus */ }
}

function takeUpdateTarget() {
	try {
		const target = localStorage.getItem(UPDATE_TARGET_KEY) || "";
		localStorage.removeItem(UPDATE_TARGET_KEY);
		return normVer(target);
	} catch {
		return "";
	}
}

function reloadWithCacheBust() {
	const url = new URL(location.href);
	url.searchParams.set("_v", String(Date.now()));
	location.replace(url.toString());
}

async function fetchFresh(url, base) {
	const requestUrl = new URL(url, base);
	requestUrl.searchParams.set("t", String(Date.now()));
	const response = await fetch(requestUrl, { cache: "no-store", credentials: "same-origin" });
	if (!response.ok) throw new Error("HTTP " + response.status + " @ " + requestUrl.pathname);
	return { response, requestUrl };
}

async function fetchJson(url) {
	const { response, requestUrl } = await fetchFresh(url, location.href);
	if ((response.headers.get("content-type") || "").toLowerCase().includes("text/html")) {
		throw new Error("HTML statt JSON @ " + requestUrl.pathname);
	}
	return response.json();
}

async function fetchWorkerVersion() {
	const { response, requestUrl } = await fetchFresh("./service-worker.js", import.meta.url);
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
	if (window.Capacitor?.isNativePlatform?.()) {
		try {
			const res = await fetch("https://api.github.com/repos/prinzpuma/Impala67/releases/latest", {
				headers: { Accept: "application/vnd.github.v3+json" }
			});
			if (res.ok) {
				const data = await res.json();
				const latest = normVer(data?.tag_name || data?.name);
				if (latest) return { latest, source: "GitHub Release" };
			}
		} catch {
			/* Fallback zur ausgelieferten Datei */
		}
	}
	try {
		const data = await fetchJson("./version.json");
		const latest = normVer(data.version);
		if (latest) return { latest, source: "version.json" };
	} catch (error) {
		try {
			return { latest: await fetchWorkerVersion(), source: "service-worker.js" };
		} catch (workerError) {
			throw new Error("Version nicht erreichbar (" + (error?.message || error) + " / " + (workerError?.message || workerError) + ")");
		}
	}
	throw new Error("leere Version in version.json");
}

window.getAppVersion = () => normVer(window.APP_VERSION || BUILD_VERSION);

window.checkAppUpdate = async function checkAppUpdate() {
	const current = window.getAppVersion();
	if (!current) throw new Error("BUILD_VERSION fehlt in updater.js");
	const { latest, source } = await fetchDeployedVersion();
	const hasUpdate = cmpSemver(latest, current) > 0;
	pendingUpdate = hasUpdate ? { version: latest } : null;
	// Das neue Bundle bereits im Hintergrund laden, aber NICHT aktivieren. Erst der
	// bewusste Klick sendet SKIP_WAITING; so erhält keine alte UI neue Lazy-Module.
	if (hasUpdate && !window.Capacitor?.isNativePlatform?.()) prepareUpdate(latest);
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

	if (window.Capacitor?.isNativePlatform?.()) {
		say("APK-Download wird im Browser geöffnet…");
		const apkUrl = "https://github.com/prinzpuma/Impala67/releases/latest/download/Impala67.apk";
		window.open(apkUrl, "_system");
		pendingUpdate = null;
		return { reloaded: false, nativeDownload: true };
	}

	say(expectedVersion ? "Update wird geladen…" : "App wird neu geladen…");
	reportStatus = say;
	try {
		if (await getRegistration()) {
			const ready = await prepareUpdate(expectedVersion);
			// Lieber ehrlich abbrechen als in die alte Version neu starten.
			if (!ready && expectedVersion) {
				throw new Error("v" + expectedVersion + " ist noch nicht vollständig ladbar (Server verteilt sie evtl. noch). Bitte gleich erneut versuchen.");
			}
			if (ready?.worker) {
				say("Update wird aktiviert…");
				if (!(await activateWorker(ready.worker)) && expectedVersion) {
					throw new Error("Update konnte nicht aktiviert werden. Bitte erneut versuchen.");
				}
			}
		}
	} catch (error) {
		preparing = null;
		throw error;
	} finally {
		reportStatus = () => {};
	}
	if (expectedVersion) rememberUpdateTarget(expectedVersion);
	pendingUpdate = null;
	preparing = null;
	say(expectedVersion ? "Update aktiv · App wird neu geladen…" : "App wird neu geladen…");
	await delay(150);
	reloadWithCacheBust();
	return { reloaded: true };
};

window.applyPwaUpdate = () => window.installAppUpdate();

let watcherStarted = false;
let updateBannerEl = null;

function showUpdateNotification(latest, retry = false) {
	if (updateBannerEl || document.getElementById("updateNotificationBanner")) return;
	const wrap = document.createElement("div");
	wrap.id = "updateNotificationBanner";
	wrap.className = "toast success";
	wrap.style.cssText = "display:flex;align-items:center;gap:10px;cursor:default;";

	const msg = document.createElement("span");
	msg.textContent = retry ? `Update v${latest} wurde nicht übernommen` : `Update v${latest} verfügbar`;

	const btn = document.createElement("button");
	btn.textContent = "Aktualisieren";
	btn.style.cssText = "font:inherit;font-size:12px;padding:3px 10px;border-radius:6px;border:none;background:var(--accent,#4f8cff);color:#fff;cursor:pointer;";
	btn.addEventListener("click", () => {
		btn.disabled = true;
		btn.textContent = "Lade…";
		window.installAppUpdate((st) => { msg.textContent = st; }).catch((error) => {
			msg.textContent = error?.message || "Update fehlgeschlagen";
			btn.disabled = false;
			btn.textContent = "Wiederholen";
		});
	});

	const closeBtn = document.createElement("button");
	closeBtn.textContent = "✕";
	closeBtn.style.cssText = "background:transparent;border:none;color:inherit;opacity:0.7;font-size:12px;cursor:pointer;padding:0 2px;";
	closeBtn.addEventListener("click", () => {
		wrap.classList.add("hide");
		setTimeout(() => wrap.remove(), 350);
		updateBannerEl = null;
	});

	wrap.append(msg, btn, closeBtn);
	let toasts = document.getElementById("toasts");
	if (!toasts) {
		toasts = document.createElement("div");
		toasts.id = "toasts";
		document.body.appendChild(toasts);
	}
	toasts.appendChild(wrap);
	updateBannerEl = wrap;
}

export function startUpdateWatcher() {
	if (watcherStarted || typeof window === "undefined") return;
	watcherStarted = true;

	// Nach einem Update-Klick: bestätigen, dass die neue Version läuft — oder
	// sofort erneut anbieten, statt still im alten Stand weiterzulaufen.
	const target = takeUpdateTarget();
	const missed = !!target && cmpSemver(BUILD_VERSION, target) < 0;
	if (target && !missed) {
		import("./util.js").then(({ U }) => U.toast("Update auf v" + BUILD_VERSION + " installiert.", "success")).catch(() => {});
	} else if (missed) {
		console.warn("Update auf v" + target + " nicht übernommen, laufend: v" + BUILD_VERSION);
	}

	const runCheck = async () => {
		if (typeof navigator !== "undefined" && !navigator.onLine) return;
		try {
			const res = await window.checkAppUpdate();
			if (res?.hasUpdate) {
				window.dispatchEvent(new CustomEvent("impala:update-available", { detail: res }));
				showUpdateNotification(res.latest, missed && cmpSemver(res.latest, target) >= 0);
			}
		} catch (e) {
			// Leise im Hintergrund scheitern
			console.debug("Update-Watcher Hintergrundprüfung:", e);
		}
	};

	// 1. Initialer Check nach wenigen Sekunden Leerlauf
	setTimeout(runCheck, missed ? 1000 : 6000);

	// 2. Bei Rückkehr in den Tab
	document.addEventListener("visibilitychange", () => {
		if (!document.hidden) runCheck();
	});

	// 3. Periodisch alle 30 Minuten — nur im sichtbaren Tab (Rückkehr prüft ohnehin, s. 2.)
	setInterval(() => { if (!document.hidden) runCheck(); }, 30 * 60 * 1000);
}

export { cmpSemver, fetchDeployedVersion, prepareUpdate, workerVersion };
