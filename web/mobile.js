"use strict";
import { APP } from "./app.js";
import { RENDER } from "./render.js";
import { S, STATE } from "./state.js";
import { TABS } from "./tabs.js";

// mobile.js — 📱 Mobile Shell v3 (23. Juli 2026). Komplett-Neubau; ersetzt die
// Dock-Pille „Mobile Shell v2“ (vorher verteilt über app.js/styles.css/index.html).
//
// Leitidee (KISS/DRY): Die Handy-Oberfläche ist NUR eine Schale um die
// bestehenden Module — kein doppelter Render-Code. Zwei Haupt-Anwendungsfälle
// stehen im Zentrum: 🃏 Karteikarten schnell lernen und ✦ der KI kurz eine
// Frage zu den Notizen stellen. Alles andere bleibt über das Menü-Sheet
// erreichbar (voller Funktionsumfang der Desktop-App).
//
//   🃏 Karten → TABS.openPage("anki:main") — Stapel + Lern-Bühne aus render-anki.js
//   ✦ KI     → bestehendes KI-Panel (#panel) als Vollbild-Sheet, Eingabe fokussiert
//   ＋ Neu   → APP.newPageFlow (derselbe Fluss wie am Desktop)
//   ☰ Menü  → bestehende Sidebar (#sidebar) als Bottom-Sheet (Baum, Suche,
//             Bibliothek, Graph, NotebookLM, Sync, Papierkorb, Einstellungen)
//
// Zustände (bewusst wenige, alle am <body>):
//   m3         Handy-Layout aktiv (matchMedia ≤ 768px — EINE Quelle der Wahrheit,
//              alle Styles hängen an dieser Klasse statt an eigenen Media-Queries)
//   mnav-open  Navigator-Sheet offen (bestehender Klassen-Vertrag: tabs.js
//              schließt das Sheet bei jeder Navigation)
//   m3-typing  Bildschirmtastatur im Inhalt aktiv → Leiste weicht aus (robustes
//              focusin/focusout statt der fragilen :has(:focus)-Heuristiken von v2)

export const MOBILE = (() => {
	const mq = window.matchMedia("(max-width: 768px)");
	const body = document.body;
	const isTyping = (el) => !!el && (el.isContentEditable || /^(input|textarea|select)$/i.test(el.tagName || ""));
	const closeSheets = () => { body.classList.remove("mnav-open"); body.classList.add("panel-collapsed"); };

	// Fällige Karten über alle Stapel — studySnapshot ist in state.js memoisiert, daher billig.
	function dueCount() {
		try {
			const c = STATE.studySnapshot(null).counts;
			return (c.neu || 0) + (c.learn || 0) + (c.review || 0);
		} catch { return 0; }
	}

	function updateBadge() {
		const b = document.getElementById("m3badge");
		if (!b) return;
		const n = dueCount();
		b.hidden = !n;
		b.textContent = n > 99 ? "99+" : String(n);
	}

	// ---- Leiste + Scrim einmalig einhängen (das Markup gehört vollständig diesem Modul) ----
	function mount() {
		if (document.getElementById("m3nav")) return;
		const scrim = document.createElement("div");
		scrim.id = "m3scrim";
		scrim.addEventListener("click", closeSheets);
		const nav = document.createElement("nav");
		nav.id = "m3nav";
		nav.setAttribute("aria-label", "Mobile Navigation");
		nav.innerHTML =
			'<button type="button" data-m3="cards" title="Karteikarten lernen"><span>🃏</span><small>Karten</small><i id="m3badge" hidden></i></button>' +
			'<button type="button" data-m3="ai" title="KI zu den Notizen fragen"><span>✦</span><small>KI</small></button>' +
			'<button type="button" data-m3="new" title="Neue Seite anlegen"><span>＋</span><small>Neu</small></button>' +
			'<button type="button" data-m3="menu" title="Navigator und alle Funktionen"><span>☰</span><small>Menü</small></button>';
		nav.addEventListener("click", onNav);
		body.append(scrim, nav);
		injectCss();
	}

	async function onNav(e) {
		const btn = e.target.closest("[data-m3]");
		if (!btn) return;
		if (btn.dataset.m3 === "menu") { body.classList.add("panel-collapsed"); body.classList.toggle("mnav-open"); return; }
		closeSheets();
		switch (btn.dataset.m3) {
			case "cards": TABS.openPage("anki:main"); break;
			case "ai": openAiSheet(); break;
			case "new": await APP.newPageFlow(S.currentWorkspaceId || Object.keys(S.workspaces)[0] || "default", null); break;
		}
	}

	// KI-Panel als Vollbild-Sheet öffnen und direkt lostippen lassen — der Kontext zu den
	// Notizen (RAG/aktuelle Seite) kommt aus dem bestehenden Panel-Fluss, nichts dupliziert.
	function openAiSheet() {
		body.classList.remove("panel-collapsed");
		RENDER.renderTabs();
		document.getElementById("chatInput")?.focus();
	}

	function wire() {
		mq.addEventListener("change", (e) => apply(e.matches));
		// Sheet schließt bei Ansicht-wechselnden Aktionen in der Sidebar; Baum-Klicks
		// schließt bereits tabs.js (Klassen-Vertrag mnav-open, siehe Kopfkommentar).
		document.addEventListener("click", (e) => {
			if (!body.classList.contains("mnav-open") || !e.target.closest) return;
			if (e.target.closest("#btnLibrary, #btnTrash, #btnDaily, #btnGraph, #btnNotebookLM, #btnSettings, #btnAnki, #btnChatTab, #btnHome, [data-deckopen], [data-ankistudy]")) body.classList.remove("mnav-open");
		});
		document.addEventListener("keydown", (e) => { if (e.key === "Escape") body.classList.remove("mnav-open"); });
		// Bildschirmtastatur: solange im Inhalt getippt wird, verschwindet die Leiste.
		document.addEventListener("focusin", (e) => {
			if (body.classList.contains("m3") && isTyping(e.target) && e.target.closest("#mainWrap")) body.classList.add("m3-typing");
		});
		document.addEventListener("focusout", () => {
			setTimeout(() => { if (!isTyping(document.activeElement)) body.classList.remove("m3-typing"); }, 60);
		});
		// Badge aktuell halten: nach jedem State-Event + minütlich (Fälligkeit ist zeitabhängig).
		STATE.onAfterDispatch(() => { if (body.classList.contains("m3")) updateBadge(); });
		setInterval(() => { if (body.classList.contains("m3")) updateBadge(); }, 60000);
	}

	function apply(on) {
		body.classList.toggle("m3", on);
		if (on) { mount(); updateBadge(); }
		else { body.classList.remove("mnav-open", "m3-typing"); }
	}

	// Einmalig aus boot.js NACH restoreSession()/render() aufrufen.
	function init() {
		wire();
		apply(mq.matches);
		// Schneller Lern-Einstieg: Am Handy startet die App direkt in den Karteikarten,
		// wenn etwas fällig ist — der Haupt-Anwendungsfall unterwegs.
		if (mq.matches && S.view !== "anki" && dueCount() > 0) TABS.openPage("anki:main");
	}

	// ---- Styles: alles an body.m3 gescopt — außerhalb des Handy-Layouts wirkungslos ----
	function injectCss() {
		if (document.getElementById("m3css")) return;
		const st = document.createElement("style");
		st.id = "m3css";
		st.textContent = `
/* Schale: eine Spalte, unten Platz für die Leiste */
body.m3 #app { grid-template-columns: minmax(0, 1fr) !important; padding: 6px; padding-left: max(6px, env(safe-area-inset-left)); padding-right: max(6px, env(safe-area-inset-right)) }
body.m3 #mainWrap { border-radius: 10px }
body.m3 #main, body.m3 .chat-full-wrap { padding-bottom: calc(64px + env(safe-area-inset-bottom)) }
body.m3 #btnAiFab { display: none }
/* Untere Tab-Leiste: immer da, immer gleich — kein verstecktes Verhalten */
#m3nav, #m3scrim { display: none }
body.m3 #m3nav { position: fixed; z-index: var(--z-dock); left: 0; right: 0; bottom: 0; display: flex; padding: 4px max(8px, env(safe-area-inset-right)) max(4px, env(safe-area-inset-bottom)) max(8px, env(safe-area-inset-left)); background: var(--menu-bg); border-top: 1px solid var(--edge) }
body.m3 #m3nav button { position: relative; flex: 1; min-height: 52px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; border-radius: 10px; background: transparent; color: var(--text2); -webkit-touch-callout: none; -webkit-user-select: none; user-select: none }
body.m3 #m3nav button:active { color: var(--accent); background: var(--accent-soft) }
body.m3 #m3nav span { font-size: 20px; line-height: 1.1 }
body.m3 #m3nav small { font-size: 10px }
body.m3 #m3badge { position: absolute; top: 3px; left: calc(50% + 8px); min-width: 18px; padding: 1px 5px; border-radius: 999px; background: var(--accent); color: #fff; font-size: 10px; font-weight: 700; font-style: normal; line-height: 1.5; text-align: center }
/* Tastatur offen oder Heft-Bühne: Leiste weicht aus */
body.m3.m3-typing #m3nav, body.m3:has(.heft-stage) #m3nav { display: none }
body.m3.m3-typing #main { padding-bottom: 12px }
/* Navigator-Sheet: die bestehende Sidebar fährt von unten hoch; EIN echtes Scrim-Element statt ::after-Tricks */
body.m3 #sidebar { position: fixed; z-index: var(--z-mobile-sheet); left: 0; right: 0; bottom: 0; top: auto; width: auto; height: min(80dvh, 640px); background: var(--menu-bg); border-top: 1px solid var(--edge); border-radius: 18px 18px 0 0; box-shadow: 0 -18px 48px var(--shadow-strong); padding: 20px 14px max(14px, env(safe-area-inset-bottom)); transform: translateY(105%); visibility: hidden; transition: transform 0.22s ease, visibility 0s linear 0.22s }
body.m3.mnav-open #sidebar { transform: none; visibility: visible; transition: transform 0.22s ease }
body.m3 #sidebar::before { content: ""; position: absolute; top: 8px; left: 50%; width: 40px; height: 4px; border-radius: 2px; transform: translateX(-50%); background: var(--edge) }
body.m3.mnav-open #m3scrim { display: block; position: fixed; inset: 0; z-index: var(--z-scrim); background: var(--overlay-bg) }
/* ✦ KI: bestehendes Panel als Vollbild-Sheet — gleiche Logik, andere Präsentation */
body.m3 #panel { display: none }
body.m3:not(.panel-collapsed) #panel { display: flex; position: fixed; inset: 0; z-index: var(--z-ai-sheet); width: 100vw; max-width: none; border: none; border-radius: 0; background: var(--panel-solid); padding-bottom: max(10px, env(safe-area-inset-bottom)) }
`;
		document.head.append(st);
	}

	return { init };
})();