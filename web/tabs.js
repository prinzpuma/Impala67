"use strict";

import { S } from "./state.js";
import { CHATS } from "./chats.js";
import { RENDER } from "./render.js";
import { POPOVERS } from "./popovers.js";
import { U } from "./util.js";

const render = (...args) => RENDER.render(...args);
const renderTabs = (...args) => RENDER.renderTabs(...args);

// ---------- Zentrale Navigation: Notion-artig ----------
// Standard: Navigation ändert nur den AKTIVEN Tab (ersetzt dessen Inhalt).
// Neuer Tab nur mit opts.newTab (Plus-Button) oder wenn noch kein Tab existiert.
// Ist die Zielseite bereits in einem anderen Tab offen → dorthin wechseln (kein Doppel-Tab).
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
		S.sidebarMode = "chats"; // eine Topbar-Pille: Chat
	} else if (isNlm) {
		S.view = "notebooklm";
	} else {
		const pg = S.pages[pageId];
		if (!pg) return;
		S.currentPageId = pageId;
		S.currentWorkspaceId = pg.workspaceId || "default";
		S.view = "page";
		S.sidebarMode = "files"; // eine Topbar-Pille: Home
	}

	const existingIdx = S.tabs.indexOf(pageId);
	const activeIdx = S.activeTabId != null ? S.tabs.indexOf(S.activeTabId) : -1;

	if (existingIdx !== -1 && !opts.newTab) {
		// Bereits offen → dorthin wechseln (nicht nochmal anlegen)
		S.activeTabId = pageId;
	} else if (opts.newTab || activeIdx === -1 || !S.tabs.length) {
		// Explizit neuer Tab, oder noch gar keiner
		if (existingIdx !== -1) {
			S.activeTabId = pageId;
		} else {
			S.tabs.push(pageId);
			if (S.tabs.length > 12) S.tabs.shift();
			S.activeTabId = pageId;
		}
	} else {
		// Notion-Default: Inhalt des aktiven Tabs ersetzen
		S.tabs[activeIdx] = pageId;
		S.activeTabId = pageId;
		// Dubletten entfernen, die durch Ersetzen entstanden sein könnten
		S.tabs = S.tabs.filter((id, i) => id !== pageId || i === activeIdx);
		// activeIdx kann nach filter verrutscht sein
		S.activeTabId = pageId;
	}

	if (!opts.skipHistory) {
		S.navHistory = S.navHistory.slice(0, S.navIndex + 1);
		S.navHistory.push(pageId);
		S.navIndex = S.navHistory.length - 1;
	}
	POPOVERS.blurActive();
	render();
}

// Plus in der Tab-Leiste: neuen Tab mit der aktuellen Seite (oder Home-Seite) öffnen.
export function openNewTab(pageId) {
	const id = pageId || S.currentPageId || S.activeTabId;
	if (!id || String(id).startsWith("chat:") || id === "nlm:main") {
		// Ohne konkrete Seite: leeren Tab-Zustand → Home, ohne Tab zu pushen
		S.view = "home";
		S.currentPageId = null;
		S.sidebarMode = "files";
		// Neuen „Platzhalter“-Tab nur wenn wir eine echte Seite haben — sonst Home
		POPOVERS.blurActive();
		render();
		return;
	}
	openPage(id, { newTab: true });
}

export async function closeTab(pageId) {
	const idx = S.tabs.indexOf(pageId);
	if (idx === -1) return;
	if (pageId.startsWith("chat:")) {
		const chatId = pageId.slice(5);
		const isActiveChat = S.currentChatId === chatId;
		const messages = isActiveChat ? S.chat : ((CHATS.load().find((x) => x.id === chatId) || {}).messages || []);
		const busy = isActiveChat && S.aiBusy;
		const lastIsUser = messages.length && messages[messages.length - 1].role === "user";
		if (busy || lastIsUser) {
			const msg = busy
				? "Die KI antwortet gerade noch — Chat trotzdem schließen?"
				: "Diese Frage wurde noch nicht beantwortet — Chat trotzdem schließen?";
			if (!(await U.confirm(msg, { title: "Chat schließen", ok: "Schließen", danger: true }))) return;
		}
	}
	// Das eingebettete NotebookLM-Webview liegt über der App-Oberfläche und muss
	// verschwinden, bevor der Tab entfernt und die nächste Ansicht gerendert wird.
	if (pageId === "nlm:main") window.dispatchEvent(new Event("impala67:nlm-hide"));
	// Index erneut holen: während des Bestätigungsdialogs kann sich die Tab-Liste geändert haben.
	const i = S.tabs.indexOf(pageId);
	if (i === -1) return;
	S.tabs.splice(i, 1);
	if (S.activeTabId === pageId) {
		const next = S.tabs[i] || S.tabs[i - 1] || null;
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
	openNewTab,
	closeTab,
	navBack,
	navForward
};