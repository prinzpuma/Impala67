"use strict";

import { S, STATE } from "./state.js";
import { U } from "./util.js";
import { DB } from "./db.js";
import { SETTINGS } from "./settings.js";
import { RAG } from "./rag.js";
import { RENDER } from "./render.js";
import { APP } from "./app.js";
import { TABS } from "./tabs.js";
import { CHATS } from "./chats.js";
import { MOBILE } from "./mobile.js";
import { DRIVE } from "./drive.js";
import { LERNZEIT } from "./lernzeit.js";
import { ANALYSE } from "./analyse.js";
import { blobAliveChecker, isBlobAlive } from "./sync-core.js";
import { CLOUDFLARE_SYNC } from "./sync-cloudflare.js";
import { scheduleOptionalModulePrefetch } from "./optional-modules.js";
import { PERF_PROFILER } from "./performance-profiler.js";
import { initMcpBridge } from "./mcp-bridge.js";
import { HEFT_INDEXER } from "./heft-indexer.js";
import { startUpdateWatcher } from "./updater.js";

const render = (...args) => RENDER.render(...args);

const WELCOME_MD = [
	"# 👋 Willkommen bei Impala67",
	"",
	"Impala67 ist dein Ort für Notizen, Handschrift und Lernen. Alles bleibt lokal auf deinem Gerät.",
	"",
	"## Die wichtigsten Features",
	"",
	"- 📝 **Notizen** – Schreibe in Markdown und lege Unterseiten an.",
	"- ✍️ **Hefte** – Schreibe und zeichne mit dem Stift.",
	"- 🤖 **KI-Chat** – Stelle Fragen zu deinen eigenen Inhalten.",
	"- 🃏 **Karteikarten** – Lerne mit Wiederholungen, die sich an dich anpassen.",
	"- 🔄 **Sync** – Optional halten sich deine Geräte synchron.",
	"",
	"## Los geht's",
	"",
	"1. Lege deine erste Seite mit **+ Neue Seite** auf der Startseite an.",
	"2. Richte optional eine KI in den ⚙️ **Einstellungen** ein.",
	"3. Finde alles schnell mit **Strg+K**.",
].join("\n");

export async function seedIfEmpty() {
	if (Object.keys(S.pages).length) return;
	const id = U.uid();
	await STATE.dispatch("pageCreate", { id, title: "👋 Willkommen", content: WELCOME_MD, workspaceId: "default" });
	S.currentPageId = id;
}

// Papierkorb automatisch leeren: Seiten, Stapel und Karten, die länger als 30 Tage
// im Papierkorb liegen, werden beim Start endgültig gelöscht (wie in Notion).
export async function purgeOldTrash() {
	const cutoff = Date.now() - 30 * 864e5;
	// DRY: dieselbe Alters-Prüfung stand 3× wörtlich da (Seiten, Stapel, Karten).
	const isOld = (x) => !!(x && x.trashedAt && new Date(x.trashedAt).getTime() < cutoff);
	for (const pg of STATE.trashedPages()) {
		if (isOld(pg)) await STATE.dispatch("pageDelete", { id: pg.id });
	}
	// FIX (Verbesserung): bisher wurden nur Seiten entsorgt — Papierkorb-Stapel und
	// -Karten sammelten sich für immer an. Stapel-Teilbäume über ihre Wurzel löschen
	// (deckDelete entfernt Unterstapel + Karten mit), danach übrige Einzelkarten.
	for (const name of STATE.trashedDeckRoots()) {
		if (isOld(S.decks[name])) await STATE.dispatch("deckDelete", { name });
	}
	for (const c of STATE.orphanTrashedCards()) {
		if (isOld(c)) await STATE.dispatch("cardDelete", { id: c.id });
	}
}

// Blob-Garbage-Collector: PDF- und Heft-Blobs endgültig gelöschter Seiten blieben
// bisher für immer in IndexedDB liegen (pageDelete löscht nur den Zustand — beim
// Event-Replay gibt es keine Blob-Löschung). Läuft nach dem Laden im Hintergrund.
export async function purgeOrphanBlobs() {
	try {
		let removed = 0;
		const alive = blobAliveChecker(S.pages);
		for (const k of await DB.allBlobKeys()) {
			const key = String(k);
			// Schnellprüfung gegen einen Schnappschuss; vor dem Löschen frisch nachprüfen,
			// falls eine Seite den Blob während der Schleife gerade wieder referenziert.
			if (alive(key) || isBlobAlive(key, S.pages)) continue;
			await DB.delBlob(key);
			removed++;
		}
		if (removed) console.info("Blob-GC: " + removed + " verwaiste Blobs entfernt.");
	} catch (e) { console.warn("Blob-GC übersprungen:", e); }
}


// 📱 Boot-Feedback (18. Juli, spät v2): Phasen-Text im Boot-Splash aus index.html —
// statt dunklem Nichts sieht man beim Start, WO er gerade steht (bzw. hängt).
const bootMsg = (t) => { const m = document.getElementById("bootSplashMsg"); if (m) m.textContent = t; };
// Start-Performance: Nach jedem BootMsg kurz an den Browser abgeben, damit der
// CSS-Ladekreis (bootspin) wirklich ein Frame malen kann. Ohne Yield blockieren
// STATE.load + erster Render den Main-Thread am Stück und der Kreis hängt.
// Im Hintergrund (versteckter Tab/PWA) malt der Browser nichts und drosselt Timer
// auf ~1 s — dort würde jedes Yield den Start nur um eine Sekunde verlängern.
const yieldForPaint = () => document.hidden ? Promise.resolve() : new Promise((res) => {
	let done = false;
	const finish = () => { if (!done) { done = true; res(); } };
	const timer = setTimeout(finish, 50);
	try {
		if (typeof requestAnimationFrame === "function") {
			requestAnimationFrame(() => {
				clearTimeout(timer);
				finish();
			});
		} else {
			finish();
		}
	} catch { finish(); }
});

export async function initApp() {
	if (typeof performance !== "undefined" && performance.mark) {
		performance.mark("impala67:boot-init");
	}
	bootMsg("Datenbank öffnen…");
	await yieldForPaint();
	await DB.open();
	// Speicher als persistent markieren — der Browser darf IndexedDB dann nicht still räumen.
	// Ohne Zusage darf v. a. Safari die Daten nach längerer Nichtnutzung löschen: im Profiler sichtbar machen.
	if (navigator.storage && navigator.storage.persist) navigator.storage.persist()
		.then((granted) => { if (!granted) PERF_PROFILER.error("storage-not-persistent", new Error("Browser hat dauerhaften Speicher abgelehnt")); })
		.catch((e) => PERF_PROFILER.error("storage-persist-error", e));
	SETTINGS.applyTheme();
	// Eingeklappte Sidebar stellt bereits das Inline-Skript in index.html wieder her.
	bootMsg("Arbeitsbereich laden…");
	await yieldForPaint();
	const snapshotInfo = await STATE.load();
	bootMsg("Start vorbereiten…");
	// Einmalige v4-Heft-Migration: muss abgeschlossen sein, bevor der Nutzer das Heft bearbeiten kann bzw. bevor die App interaktiv wird.
	try {
		await CLOUDFLARE_SYNC.migrateLocalV4?.(snapshotInfo);
	} catch (e) {
		console.warn("[boot] v4-Heft-Migration fehlgeschlagen:", e);
	}
	// Einmalig: bereits lokal gespeicherte API-/Notion-Zugangsdaten in den
	// synchronisierten Event-Log übernehmen, bevor der Start-Sync nach Drive läuft.
	await STATE.migrateLegacySecretsToSync();
	// Alte lokale Chat-Verläufe einmalig in Event-Log/Drive übernehmen.
	await CHATS.migrateLocal();
	await seedIfEmpty();
	// Der synchronisierte Arbeitsbereich wird geladen, bevor die erste Ansicht
	// erscheint. Ohne gültigen gespeicherten Tab bleibt die Startseite sichtbar.
	await TABS.restoreSession();
	APP.wireEvents();
	APP.checkIncomingShare?.();
	// FIX (Start-Performance): Hook erst nach Abschluss aller Start-Migrationen
	// aktivieren, damit Dispatches beim Boot keine verfrühten Renders hinter dem Splash auslösen.
	STATE.onChange = (type, ev) => RENDER.onStateChange(type, ev);
	bootMsg("Ansicht aufbauen…");
	await yieldForPaint();
	render();
	// Ab hier ist die UI sichtbar und bedienbar — Boot-Splash SOFORT entfernen,
	// bevor schwere Nacharbeiten (Mobile-Init, Heft-Bilder) den Kreis einfrieren.
	const splash = document.getElementById("bootSplash");
	if (splash) splash.remove();
	window.Capacitor?.Plugins?.SplashScreen?.hide?.();
	// Heft-Bilder (12 MB+) erst nach dem ersten Frame nachladen. HEFT.mount zeigt
	// bis dahin „Heft laden…“. Kein Warten hier — sonst hängt der Start wieder.
	try {
		if (S.pages?.[S.currentPageId]?.kind === "heft") {
			const docHashes = [];
			const docPages = S.heftDocs?.[S.currentPageId]?.pages;
			if (Array.isArray(docPages)) {
				for (const pg of docPages) {
					if (Array.isArray(pg?.images)) {
						for (const im of pg.images) if (im?.ref) docHashes.push(im.ref);
					}
				}
			}
			STATE.hydrateHeftBlobs(docHashes.length ? docHashes : null).then(() => render()).catch((e) => PERF_PROFILER.error("heft-hydrate-error", e));
		}
	} catch { /* Heft-Payload bleibt lazy */ }
	// 📱 Mobile UI v4 nach dem ersten Render aktivieren.
	MOBILE.init();
	// Erst nach sichtbarer, bedienbarer UI einen validierten Start-Checkpoint
	// einplanen. Der Scheduler wartet zusätzlich fünf Sekunden ohne Nutzereingabe.
	STATE.scheduleCheckpoint();
	if (typeof performance !== "undefined" && performance.mark) {
		performance.mark("impala67:boot-ready");
		try {
			const navEntry = (performance.getEntriesByType && performance.getEntriesByType("navigation")[0]) || null;
			const readyMark = performance.getEntriesByName("impala67:boot-ready")[0];
			const initMark = performance.getEntriesByName("impala67:boot-init")[0];
			const now = readyMark ? readyMark.startTime : performance.now();
			
			// Misst die echte Gesamt-Wartezeit ab dem ersten Browser-Navigations-Request (Navigation Timing API)
			const navStart = navEntry ? navEntry.startTime : 0;
			const totalMs = Math.round((now - navStart) * 100) / 100;
			const appMs = initMark ? Math.round((now - initMark.startTime) * 100) / 100 : totalMs;
			
			window.__IMPALA_PERF__ = window.__IMPALA_PERF__ || {};
			window.__IMPALA_PERF__.totalBootMs = totalMs;
			window.__IMPALA_PERF__.appInitMs = appMs;
			PERF_PROFILER.record("boot-ready", totalMs, { appInitMs: appMs });
			console.info(`Impala67 Startzeit (lokal): Gesamt (inkl. Navigation/HTML) = ${totalMs} ms (App-Init = ${appMs} ms)`);
		} catch (e) { /* ignore */ }
	}
	SETTINGS.checkAI();
	// Nach erfolgreicher früherer Google-Anmeldung sofort Drive abgleichen.
	// Ohne gespeicherte Sitzung bleibt der Lauf still und öffnet kein Login-Popup.
	// Drive-Status bleibt intern und in den Einstellungen verfügbar; eine dauerhafte
	// Anzeige in der unteren Navigation ist bewusst entfernt.
	window.addEventListener("impala67:sync-status", (e) => {
		const d = (e && e.detail) || {};
		SETTINGS.refreshDriveStatusUi?.();
		// Wenn über Google Drive neue Cloudflare-Zugangsdaten eintreffen: Automatisch verbinden!
		if (S.settings.cfUrl && S.settings.cfSyncKey && (!CLOUDFLARE_SYNC.status().url || !CLOUDFLARE_SYNC.status().syncKey)) {
			CLOUDFLARE_SYNC.configure(S.settings.cfUrl, S.settings.cfSyncKey).catch(() => {});
		}
	});
	window.addEventListener("impala67:cloudflare-sync-status", () => {
		SETTINGS.refreshCloudflareStatusUi?.();
	});
	window.addEventListener("online", () => DRIVE.refreshStatus());
	window.addEventListener("offline", () => DRIVE.refreshStatus());

	// 📱 Automatisches Koppeln via QR-Code oder Kopplungs-Link (#cf-pair=...)
	async function applyPairingHash(hash) {
		if (!hash || !hash.startsWith("#cf-pair=")) return false;
		try {
			const payload = hash.slice(9);
			const decoded = JSON.parse(decodeURIComponent(escape(atob(payload))));
			if (decoded.url && decoded.key) {
				await STATE.dispatch("settingsSet", { cfUrl: decoded.url, cfSyncKey: decoded.key });
				CLOUDFLARE_SYNC.configure(decoded.url, decoded.key).catch(() => {});
				U.toast("Cloudflare-Sync automatisch verbunden!", "success");
				if (typeof history !== "undefined" && history.replaceState) {
					history.replaceState(null, "", location.pathname + location.search);
				}
				return true;
			}
		} catch (err) {
			console.warn("[boot] Fehler beim Verarbeiten des Kopplungs-Links:", err);
		}
		return false;
	}

	if (typeof location !== "undefined" && location.hash && location.hash.startsWith("#cf-pair=")) {
		applyPairingHash(location.hash);
	} else if (S.settings.cfUrl && S.settings.cfSyncKey && !CLOUDFLARE_SYNC.status().url) {
		CLOUDFLARE_SYNC.configure(S.settings.cfUrl, S.settings.cfSyncKey).catch(() => {});
	}

	if (typeof window !== "undefined") {
		window.addEventListener("hashchange", () => {
			if (location.hash && location.hash.startsWith("#cf-pair=")) {
				applyPairingHash(location.hash);
			}
		});
	}

	// Der optionale Cloudflare-Kanal darf den lokalen App-Start niemals blockieren.
	// Ein kaputtes/unerreichbares Backend bleibt ein Sync-Fehler, kein Boot-Fehler.
	try { CLOUDFLARE_SYNC.init(); }
	catch (e) { console.warn("[boot] Cloudflare-Sync beim Start übersprungen:", e); }
	await SETTINGS.startAutoDriveSync();
	// Offene Sync-Konflikte (nach Drive-Sync / Reload) als Lösungs-Popup zeigen.
	setTimeout(showPendingConflictsIfAny, 450);
	// Ping nur bei sichtbarem Tab (spart Akku); beim Zurückkehren sofort prüfen.
	setInterval(pingAiStatusIfVisible, 60000);
	document.addEventListener("visibilitychange", pingAiStatusIfVisible);
	if (LERNZEIT && LERNZEIT.startInterval) LERNZEIT.startInterval();
	if (ANALYSE && ANALYSE.initDwellTimer) ANALYSE.initDwellTimer();
	initMcpBridge();
	startUpdateWatcher();
	const scheduleIdle = typeof window.requestIdleCallback === "function"
		? (fn) => window.requestIdleCallback(fn, { timeout: 3000 })
		: (fn) => setTimeout(fn, 600);
	scheduleIdle(() => {
		RAG.reindexStale();
		// PERF: purgeOldTrash & purgeOrphanBlobs laufen im Leerlauf nach dem ersten Rendern
		purgeOldTrash().catch((e) => console.warn("Papierkorb-GC übersprungen:", e));
		purgeOrphanBlobs();
		try { HEFT_INDEXER.startBackgroundScan(); } catch (e) { console.warn("Heft-Indexer Start übersprungen:", e); }
		// Google-Login (nur für die Drive-Anmeldung per Klick) erst nach dem Start laden.
		const gsi = document.createElement("script");
		gsi.src = "https://accounts.google.com/gsi/client";
		gsi.async = true;
		document.head.appendChild(gsi);
	});
	// Zusatzbibliotheken nur im Hintergrund in Cache Storage ablegen. Der Start
	// wartet nicht darauf und keine Bibliothek wird dabei ausgefuehrt.
	scheduleOptionalModulePrefetch();
}

function pingAiStatusIfVisible() {
	if (!document.hidden) SETTINGS.checkAI();
}

function showPendingConflictsIfAny() {
	if (RENDER.loadPendingConflicts && RENDER.loadPendingConflicts().length) RENDER.openConflictResolver(0);
}

// 🩺 FIX (18. Juli, spät v2): Der Start konnte am iPad ewig „dunkel“ hängen (v.a.
// wenn IndexedDB nach einem Safari-Kill nicht antwortet). Jetzt: sichtbarer
// Boot-Splash mit Phasen-Text (index.html), DB-Open mit Timeout+Retry (db.js)
// und eine klare Fehlermeldung mit „Neu laden“-Knopf statt schwarzem Bildschirm.
function bootFail(e) {
	console.error("Start fehlgeschlagen:", e);
	const s = document.getElementById("bootSplash");
	if (!s) return;
	s.innerHTML = "";
	const wrap = document.createElement("div");
	wrap.style.cssText = "text-align:center;padding:24px;max-width:420px";
	const msg = document.createElement("div");
	msg.textContent = "Start fehlgeschlagen: " + String((e && e.message) || e);
	msg.style.cssText = "margin-bottom:14px;line-height:1.5";
	const btn = document.createElement("button");
	btn.textContent = "Neu laden";
	btn.style.cssText = "font:inherit;padding:8px 18px;border-radius:8px;border:1px solid #555;background:#2a2a2e;color:inherit";
	btn.addEventListener("click", () => location.reload());
	wrap.append(msg, btn);
	s.appendChild(wrap);
}
if (document.readyState === "loading") {
	window.addEventListener("DOMContentLoaded", () => initApp().catch(bootFail));
} else {
	initApp().catch(bootFail);
}

export const BOOT = {
	seedIfEmpty,
	purgeOldTrash,
	purgeOrphanBlobs,
	isBlobAlive,
	initApp
};
