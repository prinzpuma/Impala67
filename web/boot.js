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

const render = (...args) => RENDER.render(...args);
const wireEvents = (...args) => APP.wireEvents(...args);

const WELCOME_MD = [
	"# 👋 Willkommen bei Impala67!",
	"",
	"Notizen, Unterseiten, Datenbanken, Markdown und GoodNotes-Hefte funktionieren vertraut – aber Impala67 kann mehr:",
	"",
	"### Das Besondere",
	"- **Local First**: Deine Daten bleiben auf deinem Gerät; Export, Backups und Google-Drive-Sync halten sie verfügbar.",
	"- **KI-Arbeitsraum**: Chatte mit deinen Inhalten, finde Wissen per RAG und lass Seiten, Zusammenfassungen oder Karteikarten erstellen.",
	"- **PDF-Workflow**: PDFs teilen oder importieren, per KI einordnen und zusammen mit Notizen durchsuchen.",
	"- **Lernen, das sich anpasst**: FSRS-Karteikarten, Clozes, Anki-/CSV-Import, Lernzeit und Notenübersicht.",
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
	for (const pg of STATE.trashedPages()) {
		if (pg.trashedAt && new Date(pg.trashedAt).getTime() < cutoff) {
			await STATE.dispatch("pageDelete", { id: pg.id });
		}
	}
	// FIX (Verbesserung): bisher wurden nur Seiten entsorgt — Papierkorb-Stapel und
	// -Karten sammelten sich für immer an. Stapel-Teilbäume über ihre Wurzel löschen
	// (deckDelete entfernt Unterstapel + Karten mit), danach übrige Einzelkarten.
	for (const name of STATE.trashedDeckRoots()) {
		const d = S.decks[name];
		if (d && d.trashedAt && new Date(d.trashedAt).getTime() < cutoff) {
			await STATE.dispatch("deckDelete", { name });
		}
	}
	for (const c of STATE.orphanTrashedCards()) {
		if (c.trashedAt && new Date(c.trashedAt).getTime() < cutoff) {
			await STATE.dispatch("cardDelete", { id: c.id });
		}
	}
}

// Blob-Garbage-Collector: PDF- und Heft-Blobs endgültig gelöschter Seiten blieben
// bisher für immer in IndexedDB liegen (pageDelete löscht nur den Zustand — beim
// Event-Replay gibt es keine Blob-Löschung). Läuft nach dem Laden im Hintergrund.
export async function purgeOrphanBlobs() {
	try {
		const pdfIds = new Set();
		Object.values(S.pages).forEach((pg) => { if (pg.pdfId) pdfIds.add(pg.pdfId); });
		const isUuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
		let removed = 0;
		for (const k of await DB.allBlobKeys()) {
			const key = String(k);
			if (key === "bgImage") continue;
			if (key.startsWith("heft:")) {
				// Heft-Striche, deren Seite es nicht mehr gibt
				if (!S.pages[key.slice(5)]) { await DB.delBlob(key); removed++; }
			} else if (isUuid(key) && !pdfIds.has(key)) {
				// UUID-Schlüssel = PDF-Blob; unbekannte andere Schlüssel bleiben unangetastet
				await DB.delBlob(key);
				removed++;
			}
		}
		if (removed) console.info("Blob-GC: " + removed + " verwaiste Blobs entfernt.");
	} catch (e) { console.warn("Blob-GC übersprungen:", e); }
}

// 📱 Boot-Feedback (18. Juli, spät v2): Phasen-Text im Boot-Splash aus index.html —
// statt dunklem Nichts sieht man beim Start, WO er gerade steht (bzw. hängt).
const bootMsg = (t) => { const m = document.getElementById("bootSplashMsg"); if (m) m.textContent = t; };

export async function initApp() {
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
	wireEvents();
	SETTINGS.applyBg();
	render();
	// 📱 Mobile UI v4 nach dem ersten Render aktivieren.
	MOBILE.init();
	// Ab hier ist die UI sichtbar und bedienbar — Boot-Splash entfernen.
	const splash = document.getElementById("bootSplash");
	if (splash) splash.remove();
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
	});
	window.addEventListener("online", () => window.dispatchEvent(new CustomEvent("impala67:sync-status", { detail: { state: "waiting", label: "Online · wartet" } })));
	window.addEventListener("offline", () => window.dispatchEvent(new CustomEvent("impala67:sync-status", { detail: { state: "waiting", label: "Offline · wartet" } })));
	await SETTINGS.startAutoDriveSync();
	// Offene Sync-Konflikte (nach Drive-Sync / Reload) als Lösungs-Popup zeigen.
	setTimeout(showPendingConflictsIfAny, 450);
	// Ping nur bei sichtbarem Tab (spart Akku); beim Zurückkehren sofort prüfen.
	setInterval(pingAiStatusIfVisible, 60000);
	document.addEventListener("visibilitychange", pingAiStatusIfVisible);
	RAG.reindexStale();
	// PERF (Feinschliff v11): purgeOldTrash lief bisher VOR dem ersten Render und
	// blockierte den Start mit awaited IndexedDB-Writes (jede alte Papierkorb-Seite
	// = ein eigener dispatch). Jetzt im Hintergrund nach dem ersten Render.
	purgeOldTrash().catch((e) => console.warn("Papierkorb-GC übersprungen:", e));
	// Verwaiste Blobs im Hintergrund entsorgen (blockiert den Start nicht).
	purgeOrphanBlobs();
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
	initApp
};