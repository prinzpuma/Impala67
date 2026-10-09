"use strict";
import { APP } from "./app.js";
import { MOBILE_VIEW } from "./mobile-view.js";
import { MOBILE_NOTES } from "./mobile-notes.js";
import { MOBILE_SHEET } from "./mobile-sheet.js";
import { RENDER } from "./render.js";
import { S, STATE } from "./state.js";
import { TABS } from "./tabs.js";

// mobile.js — Controller der Handy-UI (Mobile UI v7).
// Die Handy-UI ist nur aktiv, wenn body.mobile-ui gesetzt ist (APP.PLATFORM.phoneQuery).
// Zustand lebt in Body-Klassen; updateUI() ist idempotent und setzt Klassen ausschließlich
// über classList.toggle(name, force). toggle mit unverändertem Wert erzeugt keine
// Mutation, daher bleibt die MutationObserver-Rückkopplung (Body-Klassen → updateUI)
// endlich.
export const MOBILE = (() => {
	const mq = APP.PLATFORM.phoneQuery;
	const body = document.body;
	let started = false;
	let wired = false;
	let lastNotesOpen = false;
	let notesDirty = false;   // Notizenliste muss im nächsten Takt neu gezeichnet werden
	let uiRaf = 0;            // rAF-Taktgeber: höchstens ein updateUI-Lauf pro Frame

	// Ebenen-Stapel für Zurück-Taste / History. Reihenfolge = Reihenfolge der eigenen Einträge.
	const hstack = [];
	let selfNav = false;      // history.go() von uns selbst ausgelöst, kein Nutzer-Zurück

	const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
		({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

	const closestOf = (e, sel) => (e.target instanceof Element ? e.target.closest(sel) : null);
	const notesEl = () => document.getElementById("mNotes");

	const dueCount = () => {
		try {
			const c = STATE.studySnapshot(null).counts;
			return (c.neu || 0) + (c.learn || 0) + (c.review || 0);
		} catch { return 0; }
	};

	const modalOpen = () => {
		const o = document.getElementById("overlay");
		const pal = document.getElementById("palette");
		return (!!o && !o.hidden && !!o.children.length) || (!!pal && !pal.hidden);
	};

	const closeModals = () => {
		const o = document.getElementById("overlay");
		if (o && !o.hidden) { o.hidden = true; o.innerHTML = ""; }
		const pal = document.getElementById("palette");
		if (pal && !pal.hidden) { pal.hidden = true; pal.innerHTML = ""; delete pal.dataset.mode; }
	};

	const closeAll = () => {
		MOBILE_SHEET.close();
		body.classList.remove("mnav-open", "mmore-open");
		body.classList.add("panel-collapsed");
		closeModals();
	};

	// Notizen-Ebene eine Stufe nach oben (Unterseite → übergeordnete Ebene).
	const notesGoUp = () => {
		MOBILE_NOTES.goUp();
		notesDirty = true;
	};

	// ---- Ebenen für Zurück-Taste ----
	// Unten → oben: notes, more, ai, modal, sheet, study.
	const LAYERS = {
		notes: {
			open: () => body.classList.contains("mnav-open"),
			close: () => {
				// Bleibt die Ebene offen (Unterseite → Elternebene), syncHistory legt den Eintrag neu an.
				if (MOBILE_NOTES.canGoUp()) notesGoUp();
				else body.classList.remove("mnav-open");
			},
		},
		more: {
			open: () => body.classList.contains("mmore-open"),
			close: () => body.classList.remove("mmore-open"),
		},
		ai: {
			open: () => !body.classList.contains("panel-collapsed"),
			close: () => body.classList.add("panel-collapsed"),
		},
		modal: {
			open: () => modalOpen(),
			close: () => closeModals(),
		},
		sheet: {
			open: () => MOBILE_SHEET.isOpen(),
			close: () => MOBILE_SHEET.close(),
		},
		study: {
			open: (studying) => studying,
			close: () => document.querySelector('[data-ankitab="decks"], [data-ankiexit]')?.click(),
		},
	};

	// Gleicht den Stapel mit dem Zustand ab. Entfernte Ebenen werden per history.go()
	// zurückgenommen; danach kommt popstate mit selfNav und ruft updateUI() erneut auf,
	// das dann die fehlenden Einträge anlegt. So überschneiden sich die Vorgänge nicht.
	function syncHistory(studying) {
		if (selfNav) return;
		const want = Object.keys(LAYERS).filter((k) => LAYERS[k].open(studying));
		let keep = 0;
		while (keep < hstack.length && hstack[keep] === want[keep]) keep++;
		const drop = hstack.length - keep;
		hstack.length = keep;
		if (drop) { selfNav = true; history.go(-drop); return; }
		for (const layer of want.slice(keep)) {
			hstack.push(layer);
			history.pushState({ mLayer: layer }, "");
		}
	}

	window.addEventListener("popstate", () => {
		if (selfNav) { selfNav = false; updateUI(); scheduleUI(); return; }
		const layer = hstack.pop();
		if (layer) {
			LAYERS[layer].close();
			updateUI();
			scheduleUI();
			return;
		}
		// Kein Ebenen-Eintrag mehr: Zurück bedient die Notiz-/Ansichts-Historie.
		if (S.navIndex >= 0 || S.view !== "home") {
			TABS.navBack();
			updateUI();
		}
	});

	// Zentrale Zurück-Logik (Zurück-Pfeil, Wischgeste, Escape, Zurück-Taste).
	function goBack() {
		if (MOBILE_SHEET.isOpen()) { MOBILE_SHEET.close(); return; }
		if (modalOpen()) { closeModals(); return; }
		if (!body.classList.contains("panel-collapsed")) { body.classList.add("panel-collapsed"); return; }
		if (body.classList.contains("mmore-open")) { body.classList.remove("mmore-open"); return; }
		if (body.classList.contains("mnav-open")) {
			if (MOBILE_NOTES.canGoUp()) notesGoUp();
			else body.classList.remove("mnav-open");
			return;
		}
		if (S.view !== "home") TABS.navBack();
	}

	// Aktionsblatt für eine Notiz (Ergebnis von MOBILE_NOTES.handleClick → "menu").
	function openNoteMenu(id) {
		const pg = S.pages[id];
		if (!pg) return;
		const item = (attr, label, cls = "") =>
			`<button type="button" class="menu-item${cls}" data-${attr}="${esc(id)}">${label}</button>`;
		const fav = pg.favorite ? "Favorit entfernen" : "Favorit hinzufügen";
		const html = `<div class="page-menu top-menu">` +
			item("page", "Öffnen") +
			item("addchild", "Unterseite anlegen") +
			item("pagerename", "Umbenennen") +
			item("pagefav", fav) +
			item("pageduplicate", "Duplizieren") +
			item("pagemove", "Verschieben…") +
			item("pagearchive", "Archivieren") +
			`<div class="menu-sep"></div>` +
			item("pagetrash", "In den Papierkorb", " danger") +
			`</div>`;
		MOBILE_SHEET.open({ title: pg.title || "Ohne Titel", html });
	}

	const DESKTOP_BUTTON = {
		library: "#btnLibrary",
		graph: "#btnGraph",
		notebooklm: "#btnNotebookLM",
		lernzeit: "#btnLernzeit",
		trash: "#btnTrash",
		settings: "#btnSettings",
	};

	// Aktionen aus der Mehr-Ebene ([data-maction]).
	async function runMoreAction(action) {
		if (action === "sync") {
			const { SETTINGS } = await import("./settings.js");
			SETTINGS.openSettings("sync");
			return;
		}
		if (action === "archive") {
			S.view = "library";
			S.libMode = "archive";
			RENDER.render();
			return;
		}
		document.querySelector(DESKTOP_BUTTON[action])?.click();
	}

	// Klick-Handler für die Notizen-Ebene. Gibt true zurück, wenn der Klick verarbeitet wurde.
	function handleNotesClick(e) {
		if (!closestOf(e, "#mNotes")) return false;
		const r = MOBILE_NOTES.handleClick(e);
		if (r?.type === "menu") { openNoteMenu(r.id); scheduleUI(); return true; }
		if (r?.type === "drill") { updateUI(); return true; }
		return false;
	}

	async function onClick(e) {
		if (!body.classList.contains("mobile-ui")) return;
		if (handleNotesClick(e)) return;

		const mactBtn = closestOf(e, "[data-maction]");
		if (mactBtn) {
			body.classList.remove("mmore-open");
			await runMoreAction(mactBtn.dataset.maction);
			scheduleUI();
			return;
		}

		const act = closestOf(e, "[data-m]")?.dataset.m;
		if (!act) return;

		switch (act) {
			case "back":
				goBack();
				break;
			case "home":
				closeAll();
				TABS.openHomeOverview();
				break;
			case "notes": {
				if (body.classList.contains("mnav-open")) {
					// Notizen sind schon offen: nur auf die Wurzel zurück, sonst nichts.
					if (MOBILE_NOTES.canGoUp()) { MOBILE_NOTES.reset(); notesDirty = true; }
					break;
				}
				closeAll();
				body.classList.add("mnav-open");
				MOBILE_NOTES.render(notesEl());
				lastNotesOpen = true;
				break;
			}
			case "learn":
				closeAll();
				APP.openAnki("decks", null);
				break;
			case "more":
				if (body.classList.contains("mmore-open")) {
					body.classList.remove("mmore-open");
				} else {
					closeAll();
					body.classList.add("mmore-open");
				}
				break;
			case "new": {
				const ws = S.currentWorkspaceId || Object.keys(S.workspaces)[0] || "default";
				if (S.view === "anki" && S.ankiTab !== "study") {
					closeAll();
					document.querySelector("[data-ankinewcard]")?.click();
				} else if (body.classList.contains("mnav-open") && MOBILE_NOTES.parentId()) {
					APP.newPageFlow(ws, MOBILE_NOTES.parentId());
				} else {
					closeAll();
					APP.newPageFlow(ws, null);
				}
				break;
			}
			case "search":
				closeAll();
				document.getElementById("btnSearchToggle")?.click();
				break;
			case "ai":
				closeAll();
				body.classList.remove("panel-collapsed");
				RENDER.renderTabs();
				break;
			case "pagemenu": {
				const pg = S.pages[S.currentPageId];
				if (pg) MOBILE_SHEET.open({ title: pg.title || "Seite", html: RENDER.moreMenuHtml(pg) });
				break;
			}
			default:
				return;
		}
		scheduleUI();
	}

	// Wisch-Geste zurück: nur vom linken Rand, ein Finger, kurz und fast horizontal.
	function initSwipe() {
		let active = false, x0 = 0, y0 = 0, t0 = 0;
		body.addEventListener("touchstart", (e) => {
			active = e.touches.length === 1 && e.touches[0].clientX < 24;
			x0 = e.touches[0].clientX;
			y0 = e.touches[0].clientY;
			t0 = e.timeStamp;
		}, { passive: true });
		body.addEventListener("touchend", (e) => {
			if (!active) return;
			active = false;
			if (!body.classList.contains("mobile-ui") || body.classList.contains("m-study")) return;
			const t = e.changedTouches[0];
			const dx = t.clientX - x0;
			const dy = t.clientY - y0;
			const dt = e.timeStamp - t0;
			if (dx > 80 && Math.abs(dy) < 50 && dt < 500) { goBack(); scheduleUI(); }
		}, { passive: true });
	}

	// Shell an body anhängen, Mehr-Ebene füllen. Listener nur EINMAL pro Sitzung.
	function mount() {
		if (!document.getElementById("mTabs")) {
			const holder = document.createElement("div");
			holder.innerHTML = MOBILE_VIEW.shellHtml();
			body.append(...holder.children);
		}
		const more = document.getElementById("mMore");
		if (more) more.innerHTML = MOBILE_VIEW.moreHtml();
		body.classList.add("panel-collapsed");
		if (!wired) {
			wired = true;
			body.addEventListener("click", onClick);
			initSwipe();
		}
	}

	function unmount() {
		["mBar", "mTabs", "mNotes", "mMore"].forEach((id) => document.getElementById(id)?.remove());
		MOBILE_SHEET.destroy();
		body.classList.remove("mnav-open", "mmore-open", "m-typing", "m-study", "m-page", "m-sheet-open");
		lastNotesOpen = false;
	}

	function apply(on) {
		body.classList.toggle("mobile-ui", on);
		// renderMain entscheidet anhand von body.mobile-ui, welcher Aufbau entsteht.
		RENDER.renderMain();
		if (on) { mount(); updateUI(); return; }
		unmount();
	}

	// Gleicht alle Anzeigen mit dem Zustand ab. Nur toggle(name, force) verwenden, damit
	// unveränderte Klassen keine Mutation auslösen (sonst Endlosschleife über den Observer).
	// Gibt true zurück, wenn die Notizenliste in diesem Lauf neu gezeichnet wurde.
	function updateUI() {
		if (!body.classList.contains("mobile-ui")) return false;
		const studying = !!document.querySelector(".anki-study-mode");
		body.classList.toggle("m-study", studying);
		syncHistory(studying);

		const notesOpen = body.classList.contains("mnav-open");
		const moreOpen = body.classList.contains("mmore-open");
		let rendered = false;
		if (notesOpen && !lastNotesOpen) {
			MOBILE_NOTES.render(notesEl());
			rendered = true;
		}
		lastNotesOpen = notesOpen;

		const pg = S.pages[S.currentPageId];
		const pageOpen = S.view === "page" && !!pg && !notesOpen && !moreOpen;
		body.classList.toggle("m-page", pageOpen);
		body.classList.toggle("m-sheet-open", MOBILE_SHEET.isOpen());

		const title = document.getElementById("mTitle");
		if (title) {
			let text;
			if (notesOpen) text = MOBILE_NOTES.title();
			else if (moreOpen) text = "Mehr";
			else if (studying || S.view === "anki") text = "Lernen";
			else if (pageOpen) text = pg.title || "Ohne Titel";
			else if (S.view === "library") text = S.libMode === "archive" ? "Archiv" : "Bibliothek";
			else text = ""; // Start: der große Gruß auf der Seite ist der Titel
			if (title.textContent !== text) title.textContent = text;
		}

		const back = document.getElementById("mBack");
		if (back) {
			back.hidden = !(pageOpen
				|| (notesOpen && MOBILE_NOTES.canGoUp())
				|| (!notesOpen && !moreOpen && S.view !== "home" && S.view !== "page" && S.view !== "anki" && !studying));
		}
		const pageMenu = document.getElementById("mPageMenu");
		if (pageMenu) pageMenu.hidden = !pageOpen;

		const active = moreOpen ? "more"
			: notesOpen ? "notes"
			: (S.view === "anki" || studying) ? "learn"
			: pageOpen ? "notes"
			: S.view === "home" ? "home"
			: "";
		document.querySelectorAll("#mTabs .m-tab").forEach((tab) => {
			const on = tab.dataset.m === active;
			tab.classList.toggle("is-active", on);
			if (on) tab.setAttribute("aria-current", "page");
			else tab.removeAttribute("aria-current");
		});

		const n = dueCount();
		const sub = document.getElementById("mSub");
		if (sub) {
			const show = active === "learn" && n > 0;
			const text = show ? `${n} fällig` : "";
			if (sub.textContent !== text) sub.textContent = text;
			sub.hidden = !show;
		}
		const badge = document.getElementById("mDue");
		if (badge) {
			const text = n > 99 ? "99+" : String(n);
			if (badge.textContent !== text) badge.textContent = text;
			badge.hidden = !n;
		}
		return rendered;
	}

	// Alle Auslöser laufen über EINEN rAF-Takt: höchstens ein Lauf pro Frame.
	function scheduleUI() {
		if (!body.classList.contains("mobile-ui")) return;
		if (uiRaf) return;
		uiRaf = requestAnimationFrame(() => {
			uiRaf = 0;
			const rendered = updateUI();
			const refresh = notesDirty;
			notesDirty = false;
			if (refresh && !rendered && body.classList.contains("mnav-open")) MOBILE_NOTES.refresh();
		});
	}

	function init() {
		if (started) return;
		started = true;
		apply(mq.matches);
		mq.addEventListener("change", (e) => apply(e.matches));

		// Bildschirmtastatur: sichtbarer Viewport kleiner als das Fenster → Tab-Leiste aus.
		const syncKeyboard = () => {
			const vv = window.visualViewport;
			body.classList.toggle("m-typing", !!vv && mq.matches && window.innerHeight - vv.height > 140);
		};
		window.visualViewport?.addEventListener("resize", syncKeyboard);
		window.addEventListener("resize", syncKeyboard);

		document.addEventListener("keydown", (e) => {
			if (e.key !== "Escape") return;
			if (!body.classList.contains("mobile-ui") || MOBILE_SHEET.isOpen()) return; // Sheet hört selbst zu
			goBack();
			scheduleUI();
		});

		STATE.onAfterDispatch(() => { notesDirty = true; scheduleUI(); });
		document.addEventListener("popovers:changed", scheduleUI);
		document.addEventListener("msheet:change", scheduleUI);
		new MutationObserver(scheduleUI).observe(body, { attributes: true, attributeFilter: ["class"] });
		const main = document.getElementById("main");
		if (main) new MutationObserver(scheduleUI).observe(main, { childList: true });
		setInterval(scheduleUI, 60000);
	}

	return { init, updateUI: scheduleUI };
})();
