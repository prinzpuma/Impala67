"use strict";

import { S } from "./state.js";
import { CHATS } from "./chats.js";
import { RENDER } from "./render.js";

const render = (...args) => RENDER.render(...args);
const renderTabs = (...args) => RENDER.renderTabs(...args);

// ---------- Zentrale Navigation: hält Tabs + Zurück/Vor-Verlauf synchron (Seiten UND Chats) ----------
export function openPage(pageId, opts) {
	opts = opts || {};
	document.body.classList.remove("sidebar-open"); // Mobile: Off-Canvas-Sidebar schließen
	if (S.highlightedPageId && S.highlightedPageId !== pageId) {
		S.highlightedPageId = null;
		S.highlightedDiff = null;
	}
	const isChat = String(pageId).startsWith("chat:");
	const isNlm = pageId === "nlm:main";
	if (isChat) {
		const chatId = pageId.slice(5);
		S.currentChatId = chatId;
		const s = CHATS.load().find((x) => x.id === chatId);
		S.chat = s ? s.messages || [] : [];
		S.view = "chat";
	} else if (isNlm) {
		S.view = "notebooklm";
	} else {
		const pg = S.pages[pageId];
		if (!pg) return;
		S.currentPageId = pageId;
		S.currentWorkspaceId = pg.workspaceId || "default";
		S.view = "page";
	}
	if (!S.tabs.includes(pageId)) {
		S.tabs.push(pageId);
		if (S.tabs.length > 10) S.tabs.shift();
	}
	S.activeTabId = pageId;
	if (!opts.skipHistory) {
		S.navHistory = S.navHistory.slice(0, S.navIndex + 1);
		S.navHistory.push(pageId);
		S.navIndex = S.navHistory.length - 1;
	}
	if (document.activeElement) document.activeElement.blur();
	render();
}

export function closeTab(pageId) {
	const idx = S.tabs.indexOf(pageId);
	if (idx === -1) return;
	if (pageId.startsWith("chat:")) {
		const chatId = pageId.slice(5);
		const isActiveChat = S.currentChatId === chatId;
		const messages = isActiveChat ? S.chat : ((CHATS.load().find((x) => x.id === chatId) || {}).messages || []);
		const busy = isActiveChat && S.aiBusy;
		const lastIsUser = messages.length && messages[messages.length - 1].role === "user";
		if (busy || lastIsUser) {
			const msg = busy ? "Die KI antwortet gerade noch — Chat trotzdem schließen?" : "Diese Frage wurde noch nicht beantwortet — Chat trotzdem schließen?";
			if (!confirm(msg)) return;
		}
	}
	// Das eingebettete NotebookLM-Webview liegt über der App-Oberfläche und muss
	// verschwinden, bevor der Tab entfernt und die nächste Ansicht gerendert wird.
	if (pageId === "nlm:main") window.dispatchEvent(new Event("impala67:nlm-hide"));
	S.tabs.splice(idx, 1);
	if (S.activeTabId === pageId) {
		const next = S.tabs[idx] || S.tabs[idx - 1] || null;
		if (next) {
			openPage(next, { skipHistory: true });
		} else {
			S.view = "home";
			S.currentPageId = null;
			S.activeTabId = null;
			render();
		}
	} else {
		renderTabs();
	}
}

export function navBack() {
	if (S.navIndex <= 0) return;
	S.navIndex--;
	const id = S.navHistory[S.navIndex];
	if (id) openPage(id, { skipHistory: true });
}

export function navForward() {
	if (S.navIndex >= S.navHistory.length - 1) return;
	S.navIndex++;
	const id = S.navHistory[S.navIndex];
	if (id) openPage(id, { skipHistory: true });
}

export const TABS = {
	openPage,
	closeTab,
	navBack,
	navForward
};