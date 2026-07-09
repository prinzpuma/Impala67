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
	"# 👋 Willkommen bei Impala67!",
	"",
	"Dieses Notizbuch verbindet deine Gedanken mit einer **lokalen KI** (oder Cloud-Modellen) und einem **Karteikarten-System** (Anki/SRS) im Stil von Notion.",
	"",
	"### Erste Schritte",
	"1. **Einstellungen öffnen**: Klicke links unten auf ⚙️ **Einstellungen**.",
	"2. **KI-Quelle einrichten**: Trage unter *KI* deinen API-Key ein (z. B. für OpenRouter, Gemini, OpenAI oder eine lokale Ollama-Instanz).",
	"3. **Modell wählen**: Schließe die Einstellungen und wähle unten rechts über den Modell-Chip (z. B. `Gemini 2.5 Flash`) dein Wunschmodell aus.",
	"4. **Chatten & Arbeiten**: Nutze das Chatpanel auf der rechten Seite, um Fragen zu deinen Notizen zu stellen oder Texte direkt in der Seite umschreiben zu lassen.",
	"",
	"### Features ausprobieren",
	"* **Unterseiten**: Klicke in der Sidebar auf das `+` neben einem Workspace, um eine neue Notiz anzulegen.",
	"* **Tastenkombinationen**: Drücke **Strg+K** (oder Klick auf das Lupen-Icon), um die Schnellsuche zu öffnen.",
	"* **Karteikarten lernen**: Schreibe Fragen in deine Notiz und klicke links auf **Karteikarten** (`btnAnki`), um Fragen hinzuzufügen und zu wiederholen.",
	"* **Markdown**: Nutze `#` für Überschriften, `*` für Aufzählungen, `**fett**`, `*kursiv*` oder `- [ ]` für Aufgaben.",
	"",
	"### Tabelle",
	"| Feature | Status |",
	"| --- | --- |",
	"| LaTeX live | ✅ |",
	"| Toggle-Blöcke | ✅ |",
	"| Datenbank-Ansicht | ✅ (einfache Tabellen-Ansicht) |",
	"",
	"---",
	"*(Der Strich darüber ist eine Trennlinie — auch das geht einfach per `---` in eigener Zeile.)*",
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
	// ES-Module-Refactor kein verlässlicher Auto-Render mehr. Einmalig verdrahten:
	STATE.onChange = () => render();
	await DB.open();
	// Speicher als persistent markieren — der Browser darf IndexedDB dann nicht still räumen.
	if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
	SETTINGS.applyTheme();
	await STATE.load();
	await purgeOldTrash();
	await seedIfEmpty();
	wireEvents();
	SETTINGS.applyBg();
	render();
	SETTINGS.checkAI();
	// Ping nur bei sichtbarem Tab (spart Akku); beim Zurückkehren sofort prüfen.
	setInterval(() => { if (!document.hidden) SETTINGS.checkAI(); }, 60000);
	document.addEventListener("visibilitychange", () => { if (!document.hidden) SETTINGS.checkAI(); });
	RAG.reindexStale();
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