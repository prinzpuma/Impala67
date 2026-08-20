"use strict";
import { APP } from "./app.js";
import { MOBILE_VIEW } from "./mobile-view.js";
import { RENDER } from "./render.js";
import { S, STATE } from "./state.js";
import { TABS } from "./tabs.js";

// mobile.js — Mobile UI v6: eigene Handy-App.
export const MOBILE = (() => {
	// Bug-Fix („kommt noch“, 24. Juli): iPads bekamen die Handy-UI statt der
	// gewohnten iPad-(Desktop-)Ansicht — "(pointer: coarse) and (max-width: 1200px)"
	// traf JEDES iPad (Touch + ≤1200px, hoch wie quer). Handy-UI jetzt nur noch für
	// echte Phone-Formate: schmale Viewports (≤700px) oder Touch-Geräte im
	// Querformat mit Phone-Höhe (≤500px). iPads (Hochformat ab 744px Breite,
	// Querformat ab 744px Höhe) fallen damit wieder in die Desktop-/iPad-Ansicht.
	// Seit 28. Juli steht diese Abfrage nur noch EINMAL — in app.js (PLATFORM). Damit sind
	// Handy-Schale, ☰-Verhalten und die CSS-Touch-Regeln garantiert derselben Meinung.
	const mq = APP.PLATFORM.phoneQuery;
	const body = document.body;
	let started = false, wired = false;

	const dueCount = () => {
		try {
			const c = STATE.studySnapshot(null).counts;
			return (c.neu || 0) + (c.learn || 0) + (c.review || 0);
		} catch { return 0; }
	};

	const closeModals = () => {
		const o = document.getElementById("overlay");
		if (o && !o.hidden) { o.hidden = true; o.innerHTML = ""; }
		const pal = document.getElementById("palette");
		if (pal && !pal.hidden) { pal.hidden = true; pal.innerHTML = ""; delete pal.dataset.mode; }
	};

	const closeAll = () => {
		body.classList.remove("mnav-open", "mmore-open");
		body.classList.add("panel-collapsed");
		closeModals();
	};

	// ---- Android/Browser-Zurück ----
	const LAYERS = {
		modal: {
			open: () => {
				const o = document.getElementById("overlay");
				const pal = document.getElementById("palette");
				return (!!o && !o.hidden && !!o.children.length) || (!!pal && !pal.hidden);
			},
			close: () => closeModals(),
		},
		sheet: {
			open: () => sheetIsOpen(),
			close: () => { body.classList.remove("mnav-open", "mmore-open"); body.classList.add("panel-collapsed"); },
		},
		study: {
			open: (studying) => studying,
			close: () => document.querySelector('[data-ankitab="decks"], [data-ankiexit]')?.click(),
		},
	};
	const hstack = [];      // Reihenfolge = Reihenfolge der eigenen History-Einträge
	let selfNav = false;    // aufräumende Navigation von uns, nicht vom Nutzer
	let poppingState = false; // Zustand kam gerade aus popstate — nicht erneut buchen

	const sheetIsOpen = () =>
		body.classList.contains("mnav-open") || body.classList.contains("mmore-open") || !body.classList.contains("panel-collapsed");

	function syncHistory(studying) {
		if (poppingState) return;
		const want = Object.keys(LAYERS).filter((k) => LAYERS[k].open(studying));
		let keep = 0;
		while (keep < hstack.length && hstack[keep] === want[keep]) keep++;
		const drop = hstack.length - keep;
		hstack.length = keep;
		if (drop) { selfNav = true; history.go(-drop); }
		for (const layer of want.slice(keep)) { hstack.push(layer); history.pushState({ mLayer: layer }, ""); }
	}

	window.addEventListener("popstate", () => {
		if (selfNav) { selfNav = false; return; }
		const layer = hstack.pop();
		if (!layer) return;
		poppingState = true;
		LAYERS[layer].close();
		updateUI();
		poppingState = false;
	});

	function mount() {
		if (document.getElementById("mNav")) return;

		// Die Struktur kommt aus der ausgelagerten Preview-Ansicht; IDs und data-Attribute
		// bleiben absichtlich dieselben, damit Navigation und App-Aktionen kanonisch bleiben.
		const holder = document.createElement("div");
		holder.innerHTML = MOBILE_VIEW.shellHtml();
		const nodes = [...holder.children];

		// Bibliothek-Kopf für Sidebar (Notizen-Browser)
		const libHead = document.createElement("div");
		libHead.id = "mLibHead";
		libHead.innerHTML = '<strong>Notizen</strong><button type="button" data-m="close" aria-label="Schließen">✕</button>';

		document.getElementById("sidebar")?.prepend(libHead);
		if (nodes.length) body.append(...nodes);
		// Listener genau EINMAL pro Sitzung: mount() läuft bei jedem Wechsel zurück in die
		// Handy-Breite erneut und hängte sonst jedes Mal ein weiteres Klick-/Wisch-Paar an
		// (jeder Tipp wurde danach mehrfach verarbeitet). Beide Handler prüfen selbst, ob
		// die Handy-UI überhaupt aktiv ist.
		if (!wired) { wired = true; body.addEventListener("click", onClick); initSwipe(); }
	}

	// Gegenstück zu mount(): beim Verlassen der Handy-Breite verschwindet die Handy-Schale
	// wirklich, statt unsichtbar im DOM zu bleiben und dort weiter mitgerendert zu werden.
	function unmount() {
		["mTop", "mNav", "mMoreSheet", "mLibHead"].forEach((id) => document.getElementById(id)?.remove());
	}

	// Wisch-zurück-Geste (zusätzlich zur nativen Android-Geste, hilft z.B. auf iOS):
	function initSwipe() {
		let x0 = 0, y0 = 0, t0 = 0, multi = false;
		body.addEventListener("touchstart", (e) => {
			multi = e.touches.length > 1;
			x0 = e.touches[0].clientX;
			y0 = e.touches[0].clientY;
			t0 = e.timeStamp;
		}, { passive: true });
		body.addEventListener("touchend", (e) => {
			if (multi || !body.classList.contains("mobile-ui")) return; // Zoom-/Zweifinger-Geste ist kein Zurück-Wisch
			const dx = e.changedTouches[0].clientX - x0;
			const dy = e.changedTouches[0].clientY - y0;
			const dt = e.timeStamp - t0;
			if (dx < 120 || Math.abs(dy) > 60 || dx < Math.abs(dy) * 2.5 || dt > 600) return; // zu kurz, zu diagonal oder zu langsam
			if (body.classList.contains("mmore-open"))  { body.classList.remove("mmore-open");  body.classList.add("panel-collapsed"); updateUI(); return; }
			if (body.classList.contains("mnav-open"))   { body.classList.remove("mnav-open");   body.classList.add("panel-collapsed"); updateUI(); return; }
			if (!body.classList.contains("panel-collapsed")) { body.classList.add("panel-collapsed"); updateUI(); return; }
			if (body.classList.contains("m-study")) return; // Lernen wird NICHT weggewischt — Ausstieg nur über die Fußleiste/Zurück-Taste
			if (x0 < 44) window.history.back(); // linker Rand ohne offenes Sheet: App-History
		}, { passive: true });
	}

	async function onClick(e) {
		if (!body.classList.contains("mobile-ui")) return;
		const actBtn = e.target.closest("[data-m]");
		const act = actBtn?.dataset.m;
		const mactBtn = e.target.closest("[data-maction]");
		const mact = mactBtn?.dataset.maction;

		// Mehr-Sheet Feature-Buttons
		if (mact) {
			body.classList.remove("mmore-open");
			closeModals();
			const sec = mactBtn.dataset.settingsGo;
			if (mact === "settings" && sec) {
				const { SETTINGS } = await import("./settings.js");
				SETTINGS.openSettings(sec);
				updateUI();
				return;
			}
			const map = {
				drive: "#btnSettings",
				notebooklm: "#btnNotebookLM",
				graph: "#btnGraph",
				library: "#btnLibrary",
				lernzeit: "#btnLernzeit",
				trash: "#btnTrash",
				settings: "#btnSettings"
			};
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

		if (act === "back") {
			body.classList.remove("mmore-open");
			body.classList.add("mnav-open");
			updateUI(); return;
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
			// In der Karteikartenansicht bedeutet „Neu“ auch auf dem Handy „Neue Karte“.
			if (S.view === "anki" && S.ankiTab !== "study") {
				document.querySelector("[data-ankinewcard]")?.click();
				updateUI(); return;
			}
			await APP.newPageFlow(S.currentWorkspaceId || Object.keys(S.workspaces)[0] || "default", null);
			updateUI(); return;
		}
		if (act === "home")  { closeAll(); TABS.openHomeOverview(); updateUI(); return; }
		if (act === "learn") { closeAll(); openLearn();             updateUI(); return; }
		if (act === "ai")    { closeAll(); openAI();                updateUI(); return; }
		if (act === "notes") {
			body.classList.remove("mmore-open");
			body.classList.add("panel-collapsed");
			closeModals();
			body.classList.toggle("mnav-open");
			updateUI(); return;
		}
		if (act === "more") {
			body.classList.remove("mnav-open");
			body.classList.add("panel-collapsed");
			closeModals();
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
			(S.view === "anki" || studying) ? "learn" : (S.view === "page" ? "notes" : "home");

		document.querySelectorAll("#mNav [data-m]").forEach((b) => b.classList.toggle("on", b.dataset.m === active));

		const btnBack = document.getElementById("btnTopBack");
		const isNoteOpen = S.view === "page" && !notesOpen && !moreOpen;
		if (btnBack) btnBack.style.display = isNoteOpen ? "inline-flex" : "none";

		const title = document.getElementById("mTitle");
		const sub   = document.getElementById("mSub");
		if (title) {
			if (isNoteOpen) {
				title.style.display = "none";
			} else {
				title.style.display = "block";
				if (moreOpen)       title.textContent = "Mehr";
				else if (notesOpen) title.textContent = "Notizen";
				else if (panelOpen) title.textContent = "KI";
				else if (studying)  title.textContent = "Lernen";
				else if (S.view === "anki") title.textContent = "Lernen";
				else title.textContent = "Impala";
			}
		}
		const badge = document.getElementById("mDue");
		const n = (badge || (sub && active === "learn")) ? dueCount() : 0;
		if (sub) { sub.textContent = n ? n + " fällig" : ""; sub.hidden = !n || active !== "learn"; }
		if (badge) { badge.hidden = !n; badge.textContent = n > 99 ? "99+" : String(n); }
	}

	// Alle Auslöser laufen über EINEN Taktgeber: der #main-Observer feuert bei jedem
	// Tastendruck im Editor, und updateUI() togglet selbst Body-Klassen — was den
	// Body-Observer erneut auslöste (Rückkopplung, spürbares Ruckeln beim Tippen).
	// Höchstens ein Lauf pro Frame; updateUI bleibt idempotent, die Kette läuft aus.
	let uiRaf = 0;
	function scheduleUI() {
		if (!body.classList.contains("mobile-ui")) return;
		if (uiRaf) return;
		uiRaf = requestAnimationFrame(() => { uiRaf = 0; updateUI(); });
	}

	function apply(on) {
		body.classList.toggle("mobile-ui", on);
		// renderHome entscheidet anhand derselben Klasse, ob die Preview-Struktur oder
		// der Desktop-Aufbau erzeugt wird. Das ist beim Boot und bei einem Resize nötig:
		// der erste allgemeine Render läuft bewusst vor MOBILE.init().
		RENDER.renderMain();
		if (on) { mount(); updateUI(); return; }
		body.classList.remove("mnav-open", "mmore-open", "m-typing", "m-study");
		unmount();
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

		STATE.onAfterDispatch(scheduleUI);
		new MutationObserver(scheduleUI).observe(body, { attributes: true, attributeFilter: ["class"] });
		const main = document.getElementById("main");
		if (main) new MutationObserver(scheduleUI).observe(main, { childList: true });
		setInterval(scheduleUI, 60000);
	}

	return { init };
})();
