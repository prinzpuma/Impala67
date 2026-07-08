"use strict";

import { S, STATE } from "./state.js";
import { U } from "./util.js";
import { DB } from "./db.js";
import { AI } from "./ai.js";
import { RAG } from "./rag.js";
import { RENDER } from "./render.js";

const renderStatusDot = (...args) => RENDER.renderStatusDot(...args);

// Verbindungsstatus automatisch prüfen (beim Start, nach Einstellungen, alle 60s)
export async function checkAI() {
	S.aiOnline = null;
	renderStatusDot();
	S.aiOnline = await AI.ping();
	renderStatusDot();
}

// Theme (dunkel/hell) — Gerätewahl in localStorage, Standard: dunkel.
export function applyTheme() {
	document.body.classList.toggle("light", (localStorage.getItem("impala67Theme") || localStorage.getItem("notionTheme")) === "light");
}

// Eigenes Hintergrundbild anwenden (Blob aus IndexedDB, dunkel überblendet)
export async function applyBg() {
	const bg = U.el("bg");
	if (!bg) return;
	try {
		const rec = await DB.getBlob("bgImage");
		if (rec && rec.buf && rec.buf.byteLength) {
			const url = URL.createObjectURL(new Blob([rec.buf], { type: (rec.meta && rec.meta.type) || "image/jpeg" }));
			bg.style.backgroundImage = "linear-gradient(rgba(6,8,12,0.84), rgba(6,8,12,0.93)), url('" + url + "')";
			bg.style.backgroundSize = "cover";
			bg.style.backgroundPosition = "center";
		} else {
			bg.style.backgroundImage = "";
			bg.style.backgroundSize = "";
			bg.style.backgroundPosition = "";
		}
	} catch (e) {
		console.warn("Hintergrund konnte nicht geladen werden:", e);
	}
}

// Zeichnet den Notion-Fortschritt in die Einstellungen — falls sie offen sind.
// Der Zustand lebt in S.notionJob und überlebt so das Schließen des Dialogs:
// beim Wiederöffnen (render.js → openSettings) wird er einfach neu gezeichnet.
export function renderNotionJob() {
	const bar = U.el("notionProgress");
	if (!bar) return; // Einstellungen (Notion-Tab) sind gerade nicht offen
	const job = S.notionJob;
	const fill = bar.querySelector(".progress-fill");
	const status = U.el("notionStatus");
	const cancelBtn = U.el("btnNotionCancel");
	const btnImp = U.el("btnMigrateNotion");
	const btnSync = U.el("btnNotionSync");
	const running = !!(job && job.running);
	bar.hidden = !job || (!running && job.fraction == null);
	if (fill) {
		if (job && job.fraction != null) { bar.classList.remove("indeterminate"); fill.style.width = Math.round(job.fraction * 100) + "%"; }
		else { bar.classList.toggle("indeterminate", running); fill.style.width = ""; }
	}
	if (status) status.textContent = job ? job.status || "" : "";
	if (cancelBtn) {
		cancelBtn.hidden = !running;
		cancelBtn.disabled = !!(job && job.cancelling);
		cancelBtn.textContent = job && job.cancelling ? "Wird abgebrochen…" : "⏹ Abbrechen";
	}
	if (btnImp) { btnImp.disabled = running; btnImp.textContent = running && job.kind === "import" ? "Importiere…" : "⬇ Import"; }
	if (btnSync) { btnSync.disabled = running; btnSync.textContent = running && job.kind === "sync" ? "Synchronisiere…" : "⇅ Zwei-Wege-Sync"; }
}

export const SETTINGS = {
	checkAI,
	applyTheme,
	applyBg,
	renderNotionJob
};
