"use strict";

import { S, STATE } from "./state.js";
import { CHATS } from "./chats.js";
import { RENDER } from "./render.js";
import { POPOVERS } from "./popovers.js";
import { U } from "./util.js";

const render = (...args) => RENDER.render(...args);
const renderTabs = (...args) => RENDER.renderTabs(...args);

// Der Tab-Arbeitsbereich wird als kleiner Snapshot gespeichert: Reihenfolge
// und aktiver Tab gehören zusammen. Chats sind jetzt Event-Log-/Drive-synchronisiert
// und dürfen deshalb genauso wie Seiten als Tab gespeichert und wiederhergestellt werden.
const syncableTabs = () => S.tabs.filter((id) => {
	if (typeof id !== "string") return false;
	if (id.startsWith("chat:")) return CHATS.load().some((chat) => chat.id === id.slice(5));
	return (S.pages[id] && !S.pages[id].trashed) || id === "nlm:main";
}).slice(-12);
let saveTimer = 0;
function saveSessionSoon() {
	clearTimeout(saveTimer);
	saveTimer = setTimeout(() => {
		STATE.dispatch("uiTabsSet", { tabs: syncableTabs(), activeTabId: S.activeTabId }).catch((e) => console.warn("Tabs konnten nicht gespeichert werden:", e));
	}, 350);
}
function saveSessionNow() {
	clearTimeout(saveTimer);
	saveTimer = 0;
	return STATE.dispatch("uiTabsSet", { tabs: syncableTabs(), activeTabId: S.activeTabId });
}

// ---------- Zentrale Navigation: Notion-artig ----------
// Standard: Navigation ändert nur den AKTIVEN Tab (ersetzt dessen Inhalt).
// Neuer Tab nur mit opts.newTab (Plus-Button) oder wenn noch kein Tab existiert.
// Ist die Zielseite bereits in einem anderen Tab offen → dorthin wechseln (kein Doppel-Tab).
export function openPage(pageId, opts) {
	opts = opts || {};
	document.body.classList.remove("mnav-open"); // Mobile Shell v2: Navigator-Sheet schließen
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
		// FIX: Ein Chat lebt nur an EINER Stelle. Hing dieselbe Sitzung noch am
		// Seitenpanel, überschrieben sich Panel und Tab beim Speichern gegenseitig.
		if (S.sideChatId === chatId) { S.sideChat = []; S.sideChatId = null; }
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
	if (!opts.restoreSession) saveSessionSoon();
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
	// Index erneut holen: während des Bestätigungsdialogs kann sich die Tab-Liste geändert haben.
	const i = S.tabs.indexOf(pageId);
	if (i === -1) return;
	S.tabs.splice(i, 1);
	saveSessionSoon();
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

// Die Home-Übersicht ist der feste Anfang der Navigation. Sie ist bewusst
// kein künstlicher Seitentab: offene Dokument-/Chat-Tabs bleiben erhalten,
// während die Übersicht jederzeit als neutraler Ausgangspunkt erreichbar ist.
export function openHomeOverview(opts) {
	S.view = "home";
	S.sidebarMode = "files";
	S.currentPageId = null;
	S.activeTabId = null;
	// FIX Zurück-Logik (17. Juli): Kommt man per „Zurück“ zur Übersicht, bleibt
	// der Verlauf erhalten — „Vorwärts“ führt danach wieder zur Seite zurück.
	// Nur ein direkter Sprung zur Übersicht (Logo/Home) beginnt frisch.
	if (!(opts && opts.keepHistory)) {
		S.navHistory = [];
		S.navIndex = -1;
	}
	POPOVERS.blurActive();
	render();
}

export function navBack() {
	// Vom ersten Verlaufseintrag führt Zurück zur Home-Übersicht — der Verlauf
	// bleibt erhalten (Index -1 = „vor dem ersten Eintrag“). Vorher wurde der
	// Verlauf hier gelöscht: „Vorwärts“ war danach immer tot und weiteres
	// „Zurück“ fühlte sich willkürlich an — das war die komische Zurück-Logik.
	if (S.navIndex <= 0) {
		S.navIndex = -1;
		openHomeOverview({ keepHistory: true });
		return;
	}
	S.navIndex--;
	const id = S.navHistory[S.navIndex];
	if (id) openPage(id, { skipHistory: true });
	else openHomeOverview({ keepHistory: true });
}

export function navForward() {
	if (S.navIndex >= S.navHistory.length - 1) return;
	S.navIndex++;
	const id = S.navHistory[S.navIndex];
	if (id) openPage(id, { skipHistory: true });
}

// Wird nach STATE.load() aufgerufen. Ungültige/gelöschte Seiten und Chats werden
// ignoriert; die letzte gültige aktive Ansicht ist anschließend direkt geöffnet.
export async function restoreSession() {
	const tabs = syncableTabs();
	const active = tabs.includes(S.activeTabId) ? S.activeTabId : (tabs[tabs.length - 1] || null);
	if (tabs.length !== S.tabs.length || active !== S.activeTabId) {
		S.tabs = tabs;
		S.activeTabId = active;
		await saveSessionNow();
	}
	if (active) openPage(active, { skipHistory: true, restoreSession: true });
}

// Beim Gerätewechsel/Schließen nicht auf den Debounce warten.
window.addEventListener("pagehide", () => { saveSessionNow().catch(() => {}); });

export const TABS = {
	openPage,
	openNewTab,
	closeTab,
	navBack,
	navForward,
	openHomeOverview,
	restoreSession
};