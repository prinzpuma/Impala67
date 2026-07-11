"use strict";

import { S, STATE } from "./state.js";
import { U } from "./util.js";
import { DB } from "./db.js";
import { SETTINGS } from "./settings.js";
import { RAG } from "./rag.js";
import { RENDER } from "./render.js";
import { APP } from "./app.js";

const render = (...args) => RENDER.render(...args);
const wireEvents = (...args) => APP.wireEvents(...args);

const WELCOME_MD = [
	"# 👋 Willkommen bei Empaer!",
	"",
	"Dein Local-First-Arbeitsraum für Notizen, PDFs, KI und Lernen – deine Daten bleiben auf deinem Gerät und lassen sich bei Bedarf synchronisieren.",
	"",
	"### Loslegen",
	"1. Öffne ⚙️ **Einstellungen**, richte eine KI-Quelle ein und wähle ein Modell.",
	"2. Erstelle eine Notiz oder ein **GoodNotes-Heft** und arbeite mit dem KI-Chat direkt daneben.",
	"",
	"### Das kannst du mit Empaer machen",
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

// Papierkorb automatisch leeren: Seiten, die länger als 30 Tage im Papierkorb
// liegen, werden beim Start endgültig gelöscht (wie in Notion).
export async function purgeOldTrash() {
	const cutoff = Date.now() - 30 * 864e5;
	for (const pg of STATE.trashedPages()) {
		if (pg.trashedAt && new Date(pg.trashedAt).getTime() < cutoff) {
			await STATE.dispatch("pageDelete", { id: pg.id });
		}
	}
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
	await purgeOldTrash();
	await seedIfEmpty();
	wireEvents();
	SETTINGS.applyBg();
	render();
	SETTINGS.checkAI();
	// Offene Sync-Konflikte (nach Drive-Sync / Reload) als Lösungs-Popup zeigen.
	setTimeout(showPendingConflictsIfAny, 450);
	// Ping nur bei sichtbarem Tab (spart Akku); beim Zurückkehren sofort prüfen.
	setInterval(pingAiStatusIfVisible, 60000);
	document.addEventListener("visibilitychange", pingAiStatusIfVisible);
	RAG.reindexStale();
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
	initApp
};