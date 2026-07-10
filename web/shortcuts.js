"use strict";

import { S } from "./state.js";
import { U } from "./util.js";
import { RENDER } from "./render.js";
import { APP } from "./app.js";
import { SEARCH } from "./search.js";
import { POPOVERS } from "./popovers.js";

const renderSidebar = (...args) => RENDER.renderSidebar(...args);
const renderMain = (...args) => RENDER.renderMain(...args);
const closeOverlay = (...args) => APP.closeOverlay(...args);

function isTypingTarget(el) {
	if (!el || el === document.body) return false;
	const tag = (el.tagName || "").toLowerCase();
	if (tag === "input" || tag === "textarea" || tag === "select") return true;
	if (el.isContentEditable) return true;
	return !!(el.closest && el.closest("input, textarea, select, [contenteditable=true]"));
}

export function wireShortcuts() {
	document.addEventListener("keydown", (e) => {
		// Escape schließt: Befehls-Menü, Overlays (Einstellungen, Dialoge), das ⋯-Seitenmenü
		if (e.key === "Escape") {
			if (SEARCH.isPaletteOpen()) { SEARCH.closePalette(); return; }
			const closed = POPOVERS.closeAll();
			if (closed.model) RENDER.renderModelMenu();
			if (closed.sidebar) RENDER.renderSidebar();
			if (closed.main) RENDER.renderMain();
			if (closed.model || closed.sidebar || closed.main || closed.attach) return;
			if (e.target.dataset && (e.target.dataset.renamename || e.target.dataset.deckrenamename)) return;
			const o = U.el("overlay");
			if (o && !o.hidden) { closeOverlay(); return; }
			if (S.pageMenuOpenId) { S.pageMenuOpenId = null; renderSidebar(); if (S.view === "library") renderMain(); return; }
		}

		// Strg/Cmd+K öffnet wie in Notion das Befehls-Menü (Suche + Aktionen)
		if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
			e.preventDefault();
			if (!SEARCH.isPaletteOpen()) SEARCH.openPalette();
			return;
		}

		// Anki-Study: ␣/Enter = Antwort, bei Rückseite = Gut; 1–4 = bewerten
		if (!e.ctrlKey && !e.metaKey && !e.altKey && !isTypingTarget(e.target)) {
			if (S.view === "anki" && S.ankiTab === "study") {
				if (e.key === " " || e.key === "Enter") {
					e.preventDefault();
					if (APP.studySpaceOrEnter) APP.studySpaceOrEnter();
					else if (APP.showStudyAnswer) APP.showStudyAnswer();
					return;
				}
				if (e.key >= "1" && e.key <= "4") {
					// Nur bei sichtbarer Antwort (sonst versehentlich bewerten)
					if (!S.reviewShowBack) return;
					e.preventDefault();
					if (APP.gradeStudyCard) APP.gradeStudyCard(Number(e.key));
					return;
				}
			}
		}
	});
}

export const SHORTCUTS = {
	wireShortcuts
};