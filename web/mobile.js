"use strict";
import { APP } from "./app.js";
import { RENDER } from "./render.js";
import { S, STATE } from "./state.js";
import { TABS } from "./tabs.js";

// mobile.js — Mobile UI v5: eigene Handy-App, nicht die Desktop-Schale.
// Lernen = sofortige Study-Ansicht. Notizen/KI/Mehr bleiben erreichbar.
export const MOBILE = (() => {
	const mq = matchMedia("(max-width: 820px), (pointer: coarse) and (max-width: 1200px)");
	const body = document.body;
	let started = false;

	const dueCount = () => {
		try {
			const c = STATE.studySnapshot(null).counts;
			return (c.neu || 0) + (c.learn || 0) + (c.review || 0);
		} catch { return 0; }
	};

	const closeOverlay = () => {
		body.classList.remove("mnav-open");
		body.classList.add("panel-collapsed");
	};

	function mount() {
		if (document.getElementById("mNav")) return;

		const top = document.createElement("header");
		top.id = "mTop";
		top.innerHTML =
			'<div class="mTop-left"><span id="mTitle">Impala</span><small id="mSub"></small></div>' +
			'<div class="mTop-right">' +
				'<button type="button" data-m="search" aria-label="Suchen">Suche</button>' +
				'<button type="button" class="mPrimary" data-m="new" aria-label="Neu">Neu</button>' +
			'</div>';

		const nav = document.createElement("nav");
		nav.id = "mNav";
		nav.setAttribute("aria-label", "Mobile Navigation");
		nav.innerHTML = [
			["learn", "Lernen"],
			["notes", "Notizen"],
			["ai", "KI"],
			["more", "Mehr"],
		].map(([id, label]) =>
			`<button type="button" data-m="${id}"><span>${label}</span>${id === "learn" ? '<i id="mDue" hidden></i>' : ""}</button>`
		).join("");

		const moreHead = document.createElement("div");
		moreHead.id = "mMoreHead";
		moreHead.innerHTML =
			'<div><strong>Mehr</strong><small>Alle Bereiche</small></div>' +
			'<button type="button" data-m="close" aria-label="Schließen">Schließen</button>';

		const searchTab = document.getElementById("btnSearchToggle");
		if (searchTab && !searchTab.querySelector(".tab-label"))
			searchTab.insertAdjacentHTML("beforeend", '<span class="tab-label">Suche</span>');

		document.getElementById("sidebar")?.prepend(moreHead);
		body.append(top, nav);
		body.addEventListener("click", onClick);
	}

	async function onClick(e) {
		const act = e.target.closest?.("[data-m]")?.dataset.m;
		if (!act) {
			if (body.classList.contains("mnav-open") && e.target.closest?.("#tree .row, #btnHome, #btnChatTab, #btnAnki, #btnDaily, #btnNotebookLM, #btnGraph, #btnLibrary, #btnTrash, #btnSettings, [data-ankistudy], [data-deckopen]"))
				body.classList.remove("mnav-open");
			return;
		}

		if (act === "close") {
			body.classList.remove("mnav-open");
			updateUI();
			return;
		}
		if (act === "search") {
			body.classList.add("panel-collapsed", "mnav-open");
			document.getElementById("btnSearchToggle")?.click();
			setTimeout(() => document.getElementById("search")?.focus(), 40);
			updateUI();
			return;
		}
		if (act === "new") {
			closeOverlay();
			await APP.newPageFlow(S.currentWorkspaceId || Object.keys(S.workspaces)[0] || "default", null);
			updateUI();
			return;
		}
		if (act === "more") {
			body.classList.add("panel-collapsed");
			body.classList.toggle("mnav-open");
			updateUI();
			return;
		}

		closeOverlay();
		if (act === "learn") openLearn();
		else if (act === "notes") TABS.openHomeOverview();
		else if (act === "ai") openAI();
		updateUI();
	}

	// Handy: nicht die Desktop-Stapelverwaltung, sondern direkt die Lernbühne.
	function openLearn() {
		const due = dueCount();
		if (due > 0) APP.openAnki("study", null);
		else APP.openAnki("decks", null);
	}

	function openAI() {
		body.classList.remove("panel-collapsed");
		RENDER.renderTabs();
		setTimeout(() => document.getElementById("chatInput")?.focus(), 30);
	}

	function syncStudyClass() {
		const studying = !!document.querySelector(".anki-study-mode");
		body.classList.toggle("m-study", studying);
	}

	function updateUI() {
		if (!body.classList.contains("mobile-ui")) return;
		syncStudyClass();

		const panelOpen = !body.classList.contains("panel-collapsed");
		const moreOpen = body.classList.contains("mnav-open");
		const studying = body.classList.contains("m-study");
		const active = moreOpen ? "more" : panelOpen ? "ai" : (S.view === "anki" || studying) ? "learn" : "notes";

		document.querySelectorAll("#mNav [data-m]").forEach((b) => b.classList.toggle("on", b.dataset.m === active));

		const title = document.getElementById("mTitle");
		const sub = document.getElementById("mSub");
		if (title) {
			if (moreOpen) title.textContent = "Mehr";
			else if (panelOpen) title.textContent = "KI";
			else if (S.view === "anki") title.textContent = studying ? "Lernen" : "Karten";
			else if (S.view === "library") title.textContent = "Bibliothek";
			else if (S.view === "chat") title.textContent = "Chat";
			else title.textContent = "Notizen";
		}
		if (sub) {
			const n = dueCount();
			sub.textContent = n ? (n + " fällig") : "";
			sub.hidden = !n || active !== "learn";
		}

		const badge = document.getElementById("mDue");
		if (badge) {
			const n = dueCount();
			badge.hidden = !n;
			badge.textContent = n > 99 ? "99+" : String(n);
		}
	}

	function setTyping(on) {
		body.classList.toggle("m-typing", on);
	}

	function apply(on) {
		body.classList.toggle("mobile-ui", on);
		if (on) {
			mount();
			updateUI();
		} else {
			body.classList.remove("mnav-open", "m-typing", "m-study");
		}
	}

	function init() {
		if (started) return;
		started = true;
		apply(mq.matches);
		mq.addEventListener("change", (e) => apply(e.matches));

		// Nur echte Tastaturhöhe, nicht Fokus allein (KI-Fokus wäre sonst eine Sackgasse).
		const syncKeyboard = () => {
			const vv = window.visualViewport;
			setTyping(!!vv && mq.matches && window.innerHeight - vv.height > 140);
		};
		window.visualViewport?.addEventListener("resize", syncKeyboard);
		window.addEventListener("resize", syncKeyboard);

		document.addEventListener("keydown", (e) => {
			if (e.key === "Escape") {
				body.classList.remove("mnav-open");
				updateUI();
			}
		});

		STATE.onAfterDispatch(() => requestAnimationFrame(updateUI));
		new MutationObserver(updateUI).observe(body, { attributes: true, attributeFilter: ["class"] });
		// Study-Markup kommt nach renderMain — DOM beobachten.
		const main = document.getElementById("main");
		if (main) new MutationObserver(updateUI).observe(main, { childList: true, subtree: true });
		setInterval(updateUI, 60000);
	}

	return { init };
})();