"use strict";
import { APP } from "./app.js";
import { RENDER } from "./render.js";
import { S, STATE } from "./state.js";
import { TABS } from "./tabs.js";

// Mobile UI v4 — eigenständige Smartphone-Navigation. Die Fachlogik bleibt in
// den vorhandenen Modulen; mobile.js besitzt ausschließlich Navigation/Zustand.
export const MOBILE = (() => {
	const mq = matchMedia("(max-width: 820px)");
	const body = document.body;
	let started = false;
	const icon = (path) => `<svg viewBox="0 0 24 24" aria-hidden="true">${path}</svg>`;
	const icons = {
		learn: icon('<rect x="3" y="7" width="14" height="14" rx="2"/><path d="m8 4 11-2 2 11"/>'),
		notes: icon('<path d="M5 3h14v18H5zM8 7h8M8 11h8M8 15h5"/>'),
		ai: icon('<path d="m12 3 1.6 5.4L19 10l-5.4 1.6L12 17l-1.6-5.4L5 10l5.4-1.6L12 3Z"/>'),
		more: icon('<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>'),
		search: icon('<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>'),
		plus: icon('<path d="M12 5v14M5 12h14"/>'),
		close: icon('<path d="m6 6 12 12M18 6 6 18"/>'),
	};

	const dueCount = () => {
		try {
			const c = STATE.studySnapshot(null).counts;
			return (c.neu || 0) + (c.learn || 0) + (c.review || 0);
		} catch { return 0; }
	};
	const typingTarget = (el) => !!el && (el.isContentEditable || /^(input|textarea|select)$/i.test(el.tagName || ""));
	const closeDrawer = () => body.classList.remove("mnav-open");

	function mount() {
		if (document.getElementById("mobileNav")) return;
		const header = document.createElement("header");
		header.id = "mobileHeader";
		header.innerHTML = '<strong id="mobileTitle">Notizen</strong><div><button data-mobile-action="search" aria-label="Suchen">' + icons.search + '</button><button class="primary" data-mobile-action="new" aria-label="Neu erstellen">' + icons.plus + '</button></div>';

		const nav = document.createElement("nav");
		nav.id = "mobileNav";
		nav.setAttribute("aria-label", "Hauptnavigation");
		nav.innerHTML = [
			["learn", icons.learn, "Lernen"],
			["notes", icons.notes, "Notizen"],
			["ai", icons.ai, "KI"],
			["more", icons.more, "Mehr"],
		].map(([key, svg, label]) => `<button data-mobile="${key}">${svg}<span>${label}</span>${key === "learn" ? '<i id="mobileDue" hidden></i>' : ""}</button>`).join("");

		const drawerHead = document.createElement("div");
		drawerHead.id = "mobileDrawerHead";
		drawerHead.innerHTML = '<div><b>Impala67</b><small>Alle Bereiche</small></div><button data-mobile-action="close" aria-label="Menü schließen">' + icons.close + "</button>";
		const searchTab = document.getElementById("btnSearchToggle");
		if (searchTab && !searchTab.querySelector(".tab-label")) searchTab.insertAdjacentHTML("beforeend", '<span class="tab-label">Suche</span>');
		document.getElementById("sidebar")?.prepend(drawerHead);
		body.append(header, nav);
		body.addEventListener("click", onClick);
	}

	async function onClick(e) {
		const tab = e.target.closest?.("[data-mobile]")?.dataset.mobile;
		const action = e.target.closest?.("[data-mobile-action]")?.dataset.mobileAction;
		if (tab) {
			// Jeder Tab ist eine eigenständige Ansicht. Besonders wichtig: „Mehr“
			// beendet zuerst die KI-Ansicht, sonst läge der Drawer unsichtbar darunter.
			if (tab === "more") {
				body.classList.add("panel-collapsed");
				body.classList.toggle("mnav-open");
			} else {
				closeDrawer();
				if (tab !== "ai") body.classList.add("panel-collapsed");
				if (tab === "learn") APP.openAnki("study", null);
				else if (tab === "notes") TABS.openHomeOverview();
				else if (tab === "ai") openAI();
			}
			updateUI();
			return;
		}
		if (action === "close") closeDrawer();
		else if (action === "new") await APP.newPageFlow(S.currentWorkspaceId || Object.keys(S.workspaces)[0] || "default", null);
		else if (action === "search") {
			body.classList.add("mnav-open");
			document.getElementById("btnSearchToggle")?.click();
			setTimeout(() => document.getElementById("search")?.focus(), 40);
		}
		if (body.classList.contains("mnav-open") && e.target.closest?.("#tree .row, #btnHome, #btnChatTab, #btnAnki, #btnDaily, #btnNotebookLM, #btnGraph, #btnLibrary, #btnTrash, #btnSettings")) closeDrawer();
		if (e.target.closest?.("#btnTogglePanel")) setTimeout(updateUI);
	}

	function openAI() {
		closeDrawer();
		body.classList.remove("panel-collapsed");
		RENDER.renderTabs();
		setTimeout(() => document.getElementById("chatInput")?.focus(), 30);
	}

	function updateUI() {
		if (!body.classList.contains("mobile-ui")) return;
		const panelOpen = !body.classList.contains("panel-collapsed");
		const active = body.classList.contains("mnav-open") ? "more" : panelOpen ? "ai" : S.view === "anki" ? "learn" : "notes";
		document.querySelectorAll("#mobileNav [data-mobile]").forEach((b) => b.classList.toggle("active", b.dataset.mobile === active));
		const title = document.getElementById("mobileTitle");
		if (title) title.textContent = S.view === "anki" ? "Karteikarten" : S.view === "library" ? "Bibliothek" : S.view === "chat" ? "Chat" : "Notizen";
		const badge = document.getElementById("mobileDue");
		if (badge) {
			const n = dueCount();
			badge.hidden = !n;
			badge.textContent = n > 99 ? "99+" : String(n);
		}
	}

	function setTyping(on) { body.classList.toggle("mobile-typing", on); }
	function apply(on) {
		body.classList.toggle("mobile-ui", on);
		if (on) { mount(); updateUI(); }
		else body.classList.remove("mnav-open", "mobile-typing");
	}

	function init() {
		if (started) return;
		started = true;
		apply(mq.matches);
		mq.addEventListener("change", (e) => apply(e.matches));
		// Nicht allein auf Fokus reagieren: Beim Öffnen der KI wird das Feld bewusst
		// fokussiert. Fokus ≠ sichtbare Tastatur; sonst verschwindet die Navigation
		// sofort und die KI wird zur Sackgasse. Nur die tatsächlich verkleinerte
		// VisualViewport-Höhe zählt als offene Bildschirmtastatur.
		const syncKeyboard = () => {
			const vv = window.visualViewport;
			setTyping(!!vv && mq.matches && window.innerHeight - vv.height > 140);
		};
		window.visualViewport?.addEventListener("resize", syncKeyboard);
		window.addEventListener("resize", syncKeyboard);
		document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeDrawer(); updateUI(); } });
		STATE.onAfterDispatch(() => requestAnimationFrame(updateUI));
		new MutationObserver(updateUI).observe(body, { attributes: true, attributeFilter: ["class"] });
		setInterval(updateUI, 60000);
	}

	return { init };
})();