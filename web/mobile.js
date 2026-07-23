"use strict";
import { APP } from "./app.js";
import { RENDER } from "./render.js";
import { S, STATE } from "./state.js";
import { TABS } from "./tabs.js";

// mobile.js — Mobile UI v6: eigene Handy-App.
export const MOBILE = (() => {
	const mq = matchMedia("(max-width: 820px), (pointer: coarse) and (max-width: 1200px)");
	const body = document.body;
	let started = false;

	// Minimalistische SVG-Icons
	const IC = {
		learn: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="3"/><line x1="12" y1="4" x2="12" y2="20"/></svg>`,
		notes: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>`,
		home: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg>`,
		ai: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
		more: `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>`,
	};

	const dueCount = () => {
		try {
			const c = STATE.studySnapshot(null).counts;
			return (c.neu || 0) + (c.learn || 0) + (c.review || 0);
		} catch { return 0; }
	};

	const closeAll = () => {
		body.classList.remove("mnav-open", "mmore-open");
		body.classList.add("panel-collapsed");
	};

	// ---- Android/Browser-Zurück ----
	// Jedes offene Sheet (Notizen/Mehr/KI) oder der Lernmodus bekommt einen
	// History-Eintrag. So schließt die native Zurück-Geste/-Taste das Sheet,
	// statt die App zu verlassen. Eine einzige Quelle der Wahrheit (DOM-Zustand)
	// treibt push/pop — kein manuelles Buchhalten an jeder Aktion (DRY).
	let sheetPushed = false;
	let studyPushed = false;
	let poppingState = false;

	const sheetIsOpen = () =>
		body.classList.contains("mnav-open") || body.classList.contains("mmore-open") || !body.classList.contains("panel-collapsed");

	function syncHistory(studying) {
		if (poppingState) return; // Zustand kam bereits aus popstate — nicht erneut buchen
		const open = sheetIsOpen();
		if (open && !sheetPushed) { sheetPushed = true; history.pushState({ mSheet: 1 }, ""); }
		else if (!open && sheetPushed) { sheetPushed = false; history.back(); }

		if (studying && !studyPushed) { studyPushed = true; history.pushState({ mStudy: 1 }, ""); }
		else if (!studying && studyPushed) { studyPushed = false; history.back(); }
	}

	window.addEventListener("popstate", () => {
		poppingState = true;
		if (sheetPushed) {
			sheetPushed = false;
			body.classList.remove("mnav-open", "mmore-open");
			body.classList.add("panel-collapsed");
		} else if (studyPushed) {
			studyPushed = false;
			document.querySelector('[data-ankitab="decks"]')?.click();
		}
		updateUI();
		poppingState = false;
	});

	function mount() {
		if (document.getElementById("mNav")) return;

		// Top-Bar
		const top = document.createElement("header");
		top.id = "mTop";
		top.innerHTML =
			'<div class="mTop-left"><span id="mTitle">Impala</span><small id="mSub"></small></div>' +
			'<div class="mTop-right">' +
				'<button type="button" data-m="search">Suche</button>' +
				'<button type="button" class="mPrimary" data-m="new">Neu</button>' +
			'</div>';

		// Bottom Nav — 5 Tabs mit Icons
		const nav = document.createElement("nav");
		nav.id = "mNav";
		nav.innerHTML = [
			["learn", "Lernen",  IC.learn, ""],
			["notes", "Notizen", IC.notes, ""],
			["home",  "Home",    IC.home,  "mHome"],
			["ai",    "KI",      IC.ai,    ""],
			["more",  "Mehr",    IC.more,  ""],
		].map(([id, label, icon, cls]) =>
			`<button type="button" data-m="${id}"${cls ? ` class="${cls}"` : ""}>` +
			icon +
			`<span>${label}</span>` +
			(id === "learn" ? '<i id="mDue" hidden></i>' : "") +
			"</button>"
		).join("");

		// Bibliothek-Kopf für Sidebar (Notizen-Browser)
		const libHead = document.createElement("div");
		libHead.id = "mLibHead";
		libHead.innerHTML = '<strong>Notizen</strong><button type="button" data-m="close" aria-label="Schließen">✕</button>';

		// Mehr-Sheet (separates Overlay — keine doppelten Nav-Tabs)
		const moreSheet = document.createElement("div");
		moreSheet.id = "mMoreSheet";
		moreSheet.innerHTML =
			'<div class="mSheet-head"><strong>Mehr</strong><button type="button" data-m="closemore">✕</button></div>' +
			'<div class="mSheet-grid">' +
			[
				["notebooklm", "🤖", "Gemini"],
				["graph",      "🕸️", "Wissensgraph"],
				["library",   "📖", "Bibliothek"],
				["saved",     "🔖", "Gespeichert"],
				["trash",     "🗑️", "Papierkorb"],
				["settings",  "⚙️", "Einstellungen"],
			].map(([a, ic, label]) =>
				`<button type="button" data-maction="${a}"><span class="mBtn-ic">${ic}</span><span>${label}</span></button>`
			).join("") +
			'</div>';

		document.getElementById("sidebar")?.prepend(libHead);
		body.append(top, nav, moreSheet);
		body.addEventListener("click", onClick);
		initSwipe();
	}

	// Wisch-zurück-Geste (zusätzlich zur nativen Android-Geste, hilft z.B. auf iOS):
	// ändert nur Klassen — syncHistory() in updateUI() hält den History-Stack konsistent.
	function initSwipe() {
		let x0 = 0, y0 = 0;
		body.addEventListener("touchstart", (e) => {
			x0 = e.touches[0].clientX;
			y0 = e.touches[0].clientY;
		}, { passive: true });
		body.addEventListener("touchend", (e) => {
			const dx = e.changedTouches[0].clientX - x0;
			const dy = e.changedTouches[0].clientY - y0;
			if (dx < 60 || Math.abs(dy) > Math.abs(dx) * 0.7) return; // zu kurz oder zu diagonal
			if (body.classList.contains("mmore-open"))  { body.classList.remove("mmore-open");  body.classList.add("panel-collapsed"); updateUI(); return; }
			if (body.classList.contains("mnav-open"))   { body.classList.remove("mnav-open");   body.classList.add("panel-collapsed"); updateUI(); return; }
			if (!body.classList.contains("panel-collapsed")) { body.classList.add("panel-collapsed"); updateUI(); return; }
			if (body.classList.contains("m-study")) { document.querySelector('[data-ankitab="decks"]')?.click(); updateUI(); return; }
			if (x0 < 44) window.history.back(); // linker Rand ohne offenes Sheet: App-History
		}, { passive: true });
	}

	async function onClick(e) {
		const act = e.target.closest("[data-m]")?.dataset.m;
		const mact = e.target.closest("[data-maction]")?.dataset.maction;

		// Mehr-Sheet Feature-Buttons
		if (mact) {
			body.classList.remove("mmore-open");
			const map = { notebooklm: "#btnNotebookLM", graph: "#btnGraph", library: "#btnLibrary", saved: "#btnSaved", trash: "#btnTrash", settings: "#btnSettings" };
			document.querySelector(map[mact])?.click();
			updateUI();
			return;
		}

		if (!act) {
			// Overlay beim Tippen auf Tree-Einträge schließen
			if (body.classList.contains("mnav-open") && e.target.closest("#tree .row, [data-ankistudy], [data-deckopen]"))
				body.classList.remove("mnav-open");
			return;
		}

		if (act === "close")     { body.classList.remove("mnav-open");  updateUI(); return; }
		if (act === "closemore") { body.classList.remove("mmore-open"); updateUI(); return; }

		if (act === "search") {
			closeAll();
			document.getElementById("btnSearchToggle")?.click();
			setTimeout(() => document.getElementById("search")?.focus(), 40);
			updateUI(); return;
		}
		if (act === "new") {
			closeAll();
			await APP.newPageFlow(S.currentWorkspaceId || Object.keys(S.workspaces)[0] || "default", null);
			updateUI(); return;
		}
		if (act === "home")  { closeAll(); TABS.openHomeOverview(); updateUI(); return; }
		if (act === "learn") { closeAll(); openLearn();             updateUI(); return; }
		if (act === "ai")    { closeAll(); openAI();                updateUI(); return; }
		if (act === "notes") {
			body.classList.remove("mmore-open");
			body.classList.add("panel-collapsed");
			body.classList.toggle("mnav-open");
			updateUI(); return;
		}
		if (act === "more") {
			body.classList.remove("mnav-open");
			body.classList.add("panel-collapsed");
			body.classList.toggle("mmore-open");
			updateUI(); return;
		}
	}

	// Immer die Stapelübersicht zeigen — der Nutzer startet das Lernen selbst
	// (über "▶ Alle fälligen Karten lernen" oder einen einzelnen Stapel).
	function openLearn() {
		APP.openAnki("decks", null);
	}

	function openAI() {
		body.classList.remove("panel-collapsed");
		RENDER.renderTabs();
		setTimeout(() => document.getElementById("chatInput")?.focus(), 30);
	}

	function updateUI() {
		if (!body.classList.contains("mobile-ui")) return;
		const studying = !!document.querySelector(".anki-study-mode");
		body.classList.toggle("m-study", studying);
		syncHistory(studying);

		const panelOpen = !body.classList.contains("panel-collapsed");
		const moreOpen  = body.classList.contains("mmore-open");
		const notesOpen = body.classList.contains("mnav-open");
		const active = moreOpen ? "more" : notesOpen ? "notes" : panelOpen ? "ai" :
			(S.view === "anki" || studying) ? "learn" : "home";

		document.querySelectorAll("#mNav [data-m]").forEach((b) => b.classList.toggle("on", b.dataset.m === active));

		const title = document.getElementById("mTitle");
		const sub   = document.getElementById("mSub");
		if (title) {
			if (moreOpen)       title.textContent = "Mehr";
			else if (notesOpen) title.textContent = "Notizen";
			else if (panelOpen) title.textContent = "KI";
			else if (studying)  title.textContent = "Lernen";
			else if (S.view === "anki") title.textContent = "Karten";
			else title.textContent = "Impala";
		}
		const n = dueCount();
		if (sub) { sub.textContent = n ? n + " fällig" : ""; sub.hidden = !n || active !== "learn"; }
		const badge = document.getElementById("mDue");
		if (badge) { badge.hidden = !n; badge.textContent = n > 99 ? "99+" : String(n); }
	}

	function apply(on) {
		body.classList.toggle("mobile-ui", on);
		if (on) { mount(); updateUI(); }
		else body.classList.remove("mnav-open", "mmore-open", "m-typing", "m-study");
	}

	function init() {
		if (started) return;
		started = true;
		apply(mq.matches);
		mq.addEventListener("change", (e) => apply(e.matches));

		const syncKeyboard = () => {
			const vv = window.visualViewport;
			body.classList.toggle("m-typing", !!vv && mq.matches && window.innerHeight - vv.height > 140);
		};
		window.visualViewport?.addEventListener("resize", syncKeyboard);
		window.addEventListener("resize", syncKeyboard);

		document.addEventListener("keydown", (e) => {
			if (e.key === "Escape") { body.classList.remove("mnav-open", "mmore-open"); updateUI(); }
		});

		STATE.onAfterDispatch(() => requestAnimationFrame(updateUI));
		new MutationObserver(updateUI).observe(body, { attributes: true, attributeFilter: ["class"] });
		const main = document.getElementById("main");
		if (main) new MutationObserver(updateUI).observe(main, { childList: true, subtree: true });
		setInterval(updateUI, 60000);
	}

	return { init };
})();
