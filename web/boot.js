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

const render = (...args) => RENDER.render(...args);
const wireEvents = (...args) => APP.wireEvents(...args);

const WELCOME_MD = [
	"# 👋 Willkommen bei Impala67!",
	"",
	"Dein Local-First-Arbeitsraum für Notizen, PDFs, KI und Lernen – deine Daten bleiben auf deinem Gerät und lassen sich bei Bedarf synchronisieren.",
	"",
	"### Loslegen",
	"1. Öffne ⚙️ **Einstellungen**, richte eine KI-Quelle ein und wähle ein Modell.",
	"2. Erstelle eine Notiz oder ein **GoodNotes-Heft** und arbeite mit dem KI-Chat direkt daneben.",
	"",
	"### Das kannst du mit Impala67 machen",
	"- **Notizen, Unterseiten & Datenbanken**: Organisiere Inhalte in Workspaces, Tabellen und Vorlagen.",
	"- **KI-Chat mit Tools**: Frage zu deinen Inhalten, überarbeite Texte oder lasse Seiten und Karteikarten erstellen.",
	"- **PDFs & Bibliothek**: PDFs per KI einsortieren und alle Notizen, Hefte und Ordner durchsuchen.",
	"- **GoodNotes-Hefte**: Schreibe und zeichne mit Stift-Canvas; lokale OCR macht Handschrift durchsuchbar.",
	"- **Karteikarten (FSRS)**: Lerne mit Wiederholungen, Cloze-Karten sowie CSV- und Anki-Import/Export.",
	"- **Markdown & LaTeX**: Nutze Überschriften, Aufgaben, Toggles, Formeln und Code.",
	"- **Sync & Backup**: Sichere per Export oder Google Drive; optionaler Notion-Zwei-Wege-Sync und NotebookLM-Anbindung.",
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

export async function initApp() {
	// FIX (Start-Bug-Paket, 9. Juli): state.js ruft nach jedem dispatch() den Hook
	// STATE.onChange auf — das alte implizite globale render() ist seit dem
	// ES-Module-Refactor kein verlässlicher Auto-Render mehr. Einmalig verdrahten.
	// PERF (10. Juli): selektiver Hook statt blindem Full-Render (Content-Autosave
	// überspringt Sidebar/Tabs/Chat; sonst rAF-coalesced) — siehe RENDER.onStateChange.
	STATE.onChange = (type, ev) => RENDER.onStateChange(type, ev);
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
	await STATE.load();
	// Einmalig: bereits lokal gespeicherte API-/Notion-Zugangsdaten in den
	// synchronisierten Event-Log übernehmen, bevor der Start-Sync nach Drive läuft.
	await STATE.migrateLegacySecretsToSync();
	// Alte lokale Chat-Verläufe einmalig in Event-Log/Drive übernehmen.
	await CHATS.migrateLocal();
	await purgeOldTrash();
	await seedIfEmpty();
	// Der synchronisierte Arbeitsbereich wird geladen, bevor die erste Ansicht
	// erscheint. Ohne gültigen gespeicherten Tab bleibt die Startseite sichtbar.
	await TABS.restoreSession();
	wireEvents();
	SETTINGS.applyBg();
	render();
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
	// Verwaiste Blobs im Hintergrund entsorgen (blockiert den Start nicht).
	purgeOrphanBlobs();
}

function pingAiStatusIfVisible() {
	if (!document.hidden) SETTINGS.checkAI();
}

function showPendingConflictsIfAny() {
	if (RENDER.loadPendingConflicts && RENDER.loadPendingConflicts().length) RENDER.openConflictResolver(0);
}

if (document.readyState === "loading") {
	window.addEventListener("DOMContentLoaded", initApp);
} else {
	initApp();
}

export const BOOT = {
	seedIfEmpty,
	purgeOldTrash,
	purgeOrphanBlobs,
	initApp
};