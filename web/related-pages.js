"use strict";

// „Verwandt“ unter einer Notiz: inhaltlich ähnliche Seiten aus den lokalen Embeddings.
// Abschaltbar über Einstellungen → Darstellung (S.settings.relatedPages) oder das ×.

import { S, STATE } from "./state.js";
import { RAG } from "./rag.js";
import { U } from "./util.js";
import { icon, pageIcon } from "./icons.js";

const on = () => S.settings.relatedPages !== false && RAG.enabled();

// Platzhalter im Seiten-Markup. data-owned: der Inhalt kommt asynchron, morph lässt ihn
// stehen; data-key wechselt mit der Seite, damit ein Seitenwechsel ihn neu anlegt.
export function relatedSlotHtml(pg) {
	if (!on() || pg.db) return "";
	return `<div class="related-pages" data-owned="1" data-key="related:${U.esc(pg.id)}" data-related="${U.esc(pg.id)}" hidden></div>`;
}

export function hydrateRelated(root) {
	const el = root && root.querySelector(".related-pages[data-related]:not([data-filled])");
	if (!el) return;
	el.dataset.filled = "1";
	const pageId = el.dataset.related;
	RAG.related(pageId, 3).then((hits) => {
		if (!el.isConnected || !hits.length) return;
		el.innerHTML = `<span class="related-label">Verwandt</span>` +
			hits.map(({ id }) => `<button class="related-chip" data-page="${U.esc(id)}">${pageIcon(S.pages[id], "note", "i-lead")}<span>${U.esc(S.pages[id].title || "Ohne Titel")}</span></button>`).join("") +
			`<button class="related-off" data-relatedoff="1" title="Verwandte Seiten ausblenden" aria-label="Verwandte Seiten ausblenden">${icon("x", "", 14)}</button>`;
		el.hidden = false;
	}).catch(() => { /* ohne Vektoren bleibt die Leiste einfach weg */ });
}

document.addEventListener("click", (e) => {
	if (!(e.target instanceof Element) || !e.target.closest("[data-relatedoff]")) return;
	STATE.dispatch("settingsSet", { relatedPages: false })
		.then(() => U.toast("Verwandte Seiten ausgeblendet. Unter Einstellungen → Darstellung wieder einschalten.", "info"));
});
