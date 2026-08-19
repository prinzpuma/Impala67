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
import { isBlobAlive } from "./sync-core.js";
import { CLOUDFLARE_SYNC } from "./sync-cloudflare.js";

const render = (...args) => RENDER.render(...args);

const WELCOME_MD = [
	"# 👋 Willkommen bei Impala67!",
	"",
	"Notizen, Unterseiten, Datenbanken, Markdown und GoodNotes-Hefte funktionieren vertraut – aber Impala67 kann mehr:",
	"",
	"### Das Besondere",
	"- **Local First**: Deine Daten bleiben auf deinem Gerät; Export, Backups und Google-Drive-Sync halten sie verfügbar.",
	"- **KI-Arbeitsraum**: Chatte mit deinen Inhalten, finde Wissen per RAG und lass Seiten, Zusammenfassungen oder Karteikarten erstellen.",
	"- **PDF-Workflow**: PDFs teilen oder importieren, per KI einordnen und zusammen mit Notizen durchsuchen.",
	"- **Lernen, das sich anpasst**: FSRS-Karteikarten, Clozes, TXT-/Anki-Import, Lernzeit und Notenübersicht.",
	"- **Handschrift & Scanner**: Schreibe und zeichne in Heften, scanne Blätter ein und mache Handschrift per OCR durchsuchbar.",
	"- **Vernetztes Wissen**: Wissensgraph, NotebookLM-Anbindung und optionale KI-Lernmodi wie Feynman-Training.",
	"- **Synchron arbeiten**: Mehrgeräte-Sync mit Konfliktlösung sowie optionaler Notion-Zwei-Wege-Sync.",
	"",
	"### Loslegen",
	"1. Öffne ⚙️ **Einstellungen**, richte eine KI-Quelle ein und wähle ein Modell.",
	"2. Erstelle eine Notiz oder ein **GoodNotes-Heft** – der KI-Chat begleitet dich direkt daneben.",
	"",
	"**Tipp:** Mit **Strg+K** öffnest du die Schnellsuche.",
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
		for (const k of await DB.allBlobKeys()) {
			const key = String(k);
			if (isBlobAlive(key, S.pages)) continue;
			await DB.delBlob(key);
			removed++;
		}
		if (removed) console.info("Blob-GC: " + removed + " verwaiste Blobs entfernt.");
	} catch (e) { console.warn("Blob-GC übersprungen:", e); }
}


// 📱 Boot-Feedback (18. Juli, spät v2): Phasen-Text im Boot-Splash aus index.html —
// statt dunklem Nichts sieht man beim Start, WO er gerade steht (bzw. hängt).
const bootMsg = (t) => { const m = document.getElementById("bootSplashMsg"); if (m) m.textContent = t; };

export async function initApp() {
	if (typeof performance !== "undefined" && performance.mark) {
		performance.mark("impala67:boot-init");
	}
	// FIX (Start-Bug-Paket, 9. Juli): state.js ruft nach jedem dispatch() den Hook
	// STATE.onChange auf — das alte implizite globale render() ist seit dem
	// ES-Module-Refactor kein verlässlicher Auto-Render mehr. Einmalig verdrahten.
	// PERF (10. Juli): selektiver Hook statt blindem Full-Render (Content-Autosave
	// überspringt Sidebar/Tabs/Chat; sonst rAF-coalesced) — siehe RENDER.onStateChange.
	STATE.onChange = (type, ev) => RENDER.onStateChange(type, ev);
	bootMsg("Datenbank öffnen…");
	await DB.open();
	// Speicher als persistent markieren — der Browser darf IndexedDB dann nicht still räumen.
	if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
	SETTINGS.applyTheme();
	// Linke Sidebar: zuletzt eingeklappt? (Desktop — ☰ in der Tab-Leiste öffnet wieder)
	try {
		if (localStorage.getItem("impala67.sidebarCollapsed") === "1") {
			document.body.classList.add("sidebar-collapsed");
		}
	} catch { /* ignore */ }
	bootMsg("Arbeitsbereich laden…");
	await STATE.load();
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
	SETTINGS.applyBg();
	render();
	// 📱 Mobile UI v4 nach dem ersten Render aktivieren.
	MOBILE.init();
	// Ab hier ist die UI sichtbar und bedienbar — Boot-Splash entfernen.
	const splash = document.getElementById("bootSplash");
	if (splash) splash.remove();
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
			console.info(`⚡ Impala67 Startzeit (lokal): Gesamt (inkl. Navigation/HTML) = ${totalMs} ms (App-Init = ${appMs} ms)`);
		} catch (e) { /* ignore */ }
	}
	SETTINGS.checkAI();
	// Nach erfolgreicher früherer Google-Anmeldung sofort Drive abgleichen.
	// Ohne gespeicherte Sitzung bleibt der Lauf still und öffnet kein Login-Popup.
	// Kleine, unaufdringliche Zustandsanzeige am vorhandenen Sync-Knopf.
	window.addEventListener("impala67:sync-status", (e) => {
		const d = (e && e.detail) || {};
		const btn = U.el("btnDriveSync"), label = U.el("driveSyncLabel");
		if (!btn || !label) return;
		btn.classList.remove("sync-idle", "sync-syncing", "sync-ok", "sync-waiting", "sync-error");
		btn.classList.add("sync-" + (d.state || "idle"));
		label.textContent = d.label || "Sync";
		btn.title = d.detail || d.label || "Drive-Sync";
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
	if (typeof location !== "undefined" && location.hash && location.hash.startsWith("#cf-pair=")) {
		(async () => {
			try {
				const payload = location.hash.slice(9);
				const decoded = JSON.parse(decodeURIComponent(escape(atob(payload))));
				if (decoded.url && decoded.key) {
					await STATE.dispatch("settingsSet", { cfUrl: decoded.url, cfSyncKey: decoded.key });
					CLOUDFLARE_SYNC.configure(decoded.url, decoded.key).catch(() => {});
					U.toast("📱 Cloudflare-Sync automatisch verbunden!", "success");
					if (typeof history !== "undefined" && history.replaceState) {
						history.replaceState(null, "", location.pathname + location.search);
					}
				}
			} catch (err) {
				console.warn("[boot] Fehler beim Verarbeiten des Kopplungs-Links:", err);
			}
		})();
	} else if (S.settings.cfUrl && S.settings.cfSyncKey && !CLOUDFLARE_SYNC.status().url) {
		CLOUDFLARE_SYNC.configure(S.settings.cfUrl, S.settings.cfSyncKey).catch(() => {});
	}

	CLOUDFLARE_SYNC.init();
	await SETTINGS.startAutoDriveSync();
	// Offene Sync-Konflikte (nach Drive-Sync / Reload) als Lösungs-Popup zeigen.
	setTimeout(showPendingConflictsIfAny, 450);
	// Ping nur bei sichtbarem Tab (spart Akku); beim Zurückkehren sofort prüfen.
	setInterval(pingAiStatusIfVisible, 60000);
	document.addEventListener("visibilitychange", pingAiStatusIfVisible);
	if (LERNZEIT && LERNZEIT.startInterval) LERNZEIT.startInterval();
	if (ANALYSE && ANALYSE.initDwellTimer) ANALYSE.initDwellTimer();
	const scheduleIdle = typeof window.requestIdleCallback === "function"
		? (fn) => window.requestIdleCallback(fn, { timeout: 3000 })
		: (fn) => setTimeout(fn, 600);
	scheduleIdle(() => {
		RAG.reindexStale();
		// PERF: purgeOldTrash & purgeOrphanBlobs laufen im Leerlauf nach dem ersten Rendern
		purgeOldTrash().catch((e) => console.warn("Papierkorb-GC übersprungen:", e));
		purgeOrphanBlobs();
	});
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
	msg.textContent = "⚠️ Start fehlgeschlagen: " + String((e && e.message) || e);
	msg.style.cssText = "margin-bottom:14px;line-height:1.5";
	const btn = document.createElement("button");
	btn.textContent = "🔄 Neu laden";
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
