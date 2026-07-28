"use strict";

import { S } from "./state.js";
import { U } from "./util.js";
import { RENDER } from "./render.js";
import { APP } from "./app.js";
import { SEARCH } from "./search.js";
import { POPOVERS } from "./popovers.js";
import { VOICE } from "./voice.js";

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

// 🖱️ Mausrad-KLICK = Auto-Scroll (Windows-Geste): Klick setzt den Anker, Maus
// hoch/runter ziehen scrollt stufenlos (Totzone 10px, beschleunigend). Ziehen und
// loslassen beendet; kurzer Klick bleibt aktiv bis Klick/Taste/Rad/Fensterwechsel.
function wireAutoScroll() {
	let a = null; // { el, oy, y }
	const stop = () => { a = null; document.body.style.cursor = ""; };
	const scrollable = (el) => {
		while (el && el !== document.body) {
			if (el.scrollHeight - el.clientHeight > 4 && /(auto|scroll)/.test(getComputedStyle(el).overflowY)) return el;
			el = el.parentElement;
		}
		return document.scrollingElement;
	};
	document.addEventListener("mousedown", (e) => {
		if (a) { stop(); e.preventDefault(); return; } // nächster Klick beendet die Geste
		if (e.button !== 1 || (e.target.closest && e.target.closest("canvas, iframe, video"))) return;
		e.preventDefault(); // kein Mittelklick-Einfügen, kein Link-in-neuem-Tab
		a = { el: scrollable(e.target), oy: e.clientY, y: e.clientY };
		document.body.style.cursor = "all-scroll";
		(function frame() {
			if (!a) return;
			const d = a.y - a.oy, abs = Math.abs(d);
			if (abs > 10) a.el.scrollTop += Math.sign(d) * Math.min(Math.pow((abs - 10) / 14, 1.4), 26);
			requestAnimationFrame(frame);
		})();
	}, true);
	document.addEventListener("mousemove", (e) => { if (a) a.y = e.clientY; });
	document.addEventListener("mouseup", (e) => { if (a && e.button === 1 && Math.abs(e.clientY - a.oy) > 6) stop(); });
	document.addEventListener("auxclick", (e) => { if (e.button === 1) e.preventDefault(); }, true);
	document.addEventListener("keydown", stop);
	document.addEventListener("wheel", stop, { passive: true });
	window.addEventListener("blur", stop);
}

export function wireShortcuts() {
	wireAutoScroll();

	document.addEventListener("keydown", (e) => {
		// Escape schließt: Befehls-Menü, Overlays (Einstellungen, Dialoge), das ⋯-Seitenmenü
		if (e.key === "Escape") {
			if (VOICE.isActive()) { VOICE.stop(); return; }
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

		// Alt+Leertaste startet/stoppt Spracheingabe für den kontextuellen Side-Chat.
		// Kein Dauerhören: ein Durchgang, dann wird die vorhandene Chat-Pipeline genutzt.
		if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === "Space") {
			e.preventDefault();
			VOICE.toggle("side");
			return;
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