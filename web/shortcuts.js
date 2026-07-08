"use strict";

import { S } from "./state.js";
import { U } from "./util.js";
import { RENDER } from "./render.js";
import { APP } from "./app.js";

const renderSidebar = (...args) => RENDER.renderSidebar(...args);
const renderMain = (...args) => RENDER.renderMain(...args);
const closeOverlay = (...args) => APP.closeOverlay(...args);

export function wireShortcuts() {
	document.addEventListener("keydown", (e) => {
		// Escape schließt Overlays (Einstellungen, Dialoge), das ⋯-Seitenmenü und die Schnellsuche
		if (e.key === "Escape") {
			if (e.target.dataset && (e.target.dataset.renamename || e.target.dataset.deckrenamename)) return;
			const o = U.el("overlay");
			if (o && !o.hidden) { closeOverlay(); return; }
			if (S.pageMenuOpenId) { S.pageMenuOpenId = null; renderSidebar(); if (S.view === "library") renderMain(); return; }
			const s = U.el("search");
			if (s && !s.hidden) { s.value = ""; s.hidden = true; s.blur(); renderSidebar(); }
		}

		// Strg/Cmd+K öffnet wie in Notion die Schnellsuche
		if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
			e.preventDefault();
			const s = U.el("search");
			if (s) {
				s.hidden = false;
				renderSidebar();
				s.focus();
				s.select();
			}
		}
	});
}

export const SHORTCUTS = {
	wireShortcuts
};
