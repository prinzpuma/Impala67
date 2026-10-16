"use strict";

import { S, STATE } from "./state.js";
import { PERF_PROFILER } from "./performance-profiler.js";
import { CHATS } from "./chats.js";
import { BUS } from "./event-bus.js";
import { POPOVERS } from "./popovers.js";
import { U } from "./util.js";
import { HOME, navState, navIndexOf, entryAt, currentEntry, displayedEntry, isValidEntry, prevValidIndex, nextValidIndex, canGoBack, canGoForward } from "./nav-history.js";

const render = (...args) => BUS.emit("ui:render", args[0]);
const renderTabs = () => BUS.emit("ui:render-tabs");

// Der Tab-Arbeitsbereich wird als kleiner Snapshot gespeichert: Reihenfolge
// und aktiver Tab gehören zusammen. Chats sind jetzt Event-Log-/Drive-synchronisiert
// und dürfen deshalb genauso wie Seiten als Tab gespeichert und wiederhergestellt werden.
const syncableTabs = () => S.tabs.filter((id) => {
	if (typeof id !== "string") return false;
	// Der offene, noch leere „Neuer Chat“ zählt mit (Sitzung entsteht erst mit der ersten Nachricht)
	if (id.startsWith("chat:")) return Boolean(CHATS.get(id.slice(5))) || id === "chat:" + S.currentChatId;
	return (S.pages[id] && !S.pages[id].trashed) || id === "nlm:main" || id === "anki:main";
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

function activateTab(pageId, { newTab = false } = {}) {
	const existingIdx = S.tabs.indexOf(pageId);
	const activeIdx = S.activeTabId != null ? S.tabs.indexOf(S.activeTabId) : -1;

	if (existingIdx !== -1 && !newTab) {
		// Bereits offen → dorthin wechseln (nicht nochmal anlegen)
		S.activeTabId = pageId;
	} else if (newTab || activeIdx === -1 || !S.tabs.length) {
		// Explizit neuer Tab, oder noch gar keiner
		if (existingIdx === -1) {
			S.tabs.push(pageId);
			if (S.tabs.length > 12) S.tabs.shift();
		}
		S.activeTabId = pageId;
	} else {
		// Notion-Default: Inhalt des aktiven Tabs ersetzen
		S.tabs[activeIdx] = pageId;
		// Dubletten entfernen, die durch Ersetzen entstanden sein könnten
		S.tabs = S.tabs.filter((id, i) => id !== pageId || i === activeIdx);
		S.activeTabId = pageId;
	}
}

// ---------- Verlauf: App-Verlauf und Browser-Verlauf laufen im Gleichschritt ----------
const hasHistory = () => typeof window !== "undefined" && Boolean(window.history);

// Browser-Eintrag für den aktuellen Index. Liegt oben noch ein Ebenen-Eintrag der
// Handy-UI (Notizen-Navigator, KI-Panel …), wird er ersetzt statt überbaut — sonst
// bliebe er als toter Eintrag unter der Seite liegen.
function writeEntry() {
	if (!hasHistory()) return;
	try {
		if (window.history.state?.mLayer) window.history.replaceState(navState(), "");
		else window.history.pushState(navState(), "");
	} catch { /* ignore */ }
}

function pushNav(id) {
	if (currentEntry() === id) return; // dieselbe Seite nochmal öffnen = kein neuer Schritt
	S.navHistory = S.navHistory.slice(0, S.navIndex + 1);
	S.navHistory.push(id);
	S.navIndex = S.navHistory.length - 1;
	writeEntry();
}

// Tab-Wechsel und Tab-Schließen sind kein eigener Zurück-Schritt: Sie ersetzen den
// aktuellen Eintrag. Nur von der Übersicht aus zählt der Wechsel als Navigation.
function replaceNav(id) {
	if (currentEntry() === HOME) pushNav(id);
	else S.navHistory[S.navIndex] = id;
}

function showEntry(id) {
	if (id === HOME) showHome();
	else openPage(id, { skipHistory: true });
}

// Ohne passenden Browser-Eintrag (Tests, verlorener Zustand) direkt umschalten.
const ownsHistory = () => hasHistory() && navIndexOf(window.history.state) === S.navIndex;

function jumpTo(i) {
	S.navIndex = i;
	showEntry(entryAt(i));
}

function onPopState(e) {
	const target = navIndexOf(e.state);
	// Handy-UI: offene Ebenen (Panel, Blatt, Dialog) schließen zuerst. Ist der
	// Browser dabei über einen Seiteneintrag gesprungen, wird er wiederhergestellt.
	if (layerHandler && layerHandler()) {
		if (target !== S.navIndex) writeEntry();
		return;
	}
	if (target === S.navIndex) return;
	// Aus einer Ansicht ohne eigenen Eintrag (Bibliothek, Papierkorb …) führt Zurück
	// erst zur Seite, von der man kam — genau wie der Zurück-Pfeil.
	const cur = currentEntry();
	if (target < S.navIndex && displayedEntry() !== cur && isValidEntry(cur)) {
		writeEntry();
		showEntry(cur);
		return;
	}
	const dir = target > S.navIndex ? 1 : -1;
	S.navIndex = target;
	const id = entryAt(target);
	if (!isValidEntry(id)) {
		// Gelöschte Seite: in derselben Richtung weiter; vorwärts ohne gültiges Ziel → zurück.
		window.history.go(dir > 0 && nextValidIndex() !== -1 ? 1 : -1);
		return;
	}
	showEntry(id);
}

let layerHandler = null;
// Die Handy-UI meldet hier, ob ein Zurück eine ihrer Ebenen geschlossen hat.
export function setLayerHandler(fn) { layerHandler = fn; }

if (typeof window !== "undefined") window.addEventListener("popstate", onPopState);

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
		const s = CHATS.get(chatId);
		S.chat = s ? s.messages || [] : [];
		S.view = "chat";
		S.sidebarMode = "chats"; // eine Topbar-Pille: Chat
		// FIX: Ein Chat lebt nur an EINER Stelle. Hing dieselbe Sitzung noch am
		// Seitenpanel, überschrieben sich Panel und Tab beim Speichern gegenseitig.
		if (S.sideChatId === chatId) { S.sideChat = []; S.sideChatId = null; }
	} else if (isNlm) {
		S.view = "notebooklm";
	} else if (pageId === "anki:main") {
		// 🃏 Karteikarten als eigener Tab (23. Juli) — exakt dieselbe Mechanik wie nlm:main.
		S.view = "anki";
		S.sidebarMode = "files"; // Stapel-Baum in der Sidebar
	} else {
		const pg = S.pages[pageId];
		if (!pg) return;
		S.currentPageId = pageId;
		// Abgewählter Seitenkontext im KI-Panel gilt nur für die aktuelle Sitzung auf der
		// Seite — wer sie neu öffnet, bekommt den Kontext wieder (nichts wird gemerkt).
		S.sideContextOff = null;
		S.currentWorkspaceId = pg.workspaceId || "default";
		S.view = "page";
		S.sidebarMode = "files"; // eine Topbar-Pille: Home
	}

	activateTab(pageId, opts);

	if (opts.replaceHistory) replaceNav(pageId);
	else if (!opts.skipHistory) pushNav(pageId);
	if (!opts.restoreSession) saveSessionSoon();
	POPOVERS.blurActive();
	render();
}

// Plus in der Tab-Leiste: neuen Tab mit der aktuellen Seite (oder Home-Seite) öffnen.
export function openNewTab(pageId) {
	const id = pageId || S.currentPageId || S.activeTabId;
	if (!id || String(id).startsWith("chat:") || id === "nlm:main" || id === "anki:main") {
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
		const messages = isActiveChat ? S.chat : (CHATS.get(chatId)?.messages || []);
		const busy = S.aiBusy && S.aiActiveChatId === chatId;
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
			openPage(next, { replaceHistory: true });
		} else {
			replaceNav(HOME);
			showHome();
		}
	} else {
		renderTabs();
	}
}

// Die Home-Übersicht ist der feste Anfang der Navigation (Index -1). Sie ist bewusst
// kein künstlicher Seitentab: offene Dokument-/Chat-Tabs bleiben erhalten. Wird sie
// mitten im Verlauf geöffnet, ist sie ein normaler Schritt — Zurück führt zur Seite davor.
function showHome() {
	S.view = "home";
	S.sidebarMode = "files";
	S.currentPageId = null;
	S.activeTabId = null;
	POPOVERS.blurActive();
	render();
}

export function openHomeOverview() {
	pushNav(HOME);
	showHome();
}

export function navBack() {
	// Aus einer Ansicht ohne eigenen Eintrag zurück zum aktuellen Eintrag.
	const cur = currentEntry();
	if (displayedEntry() !== cur && isValidEntry(cur)) { showEntry(cur); return; }
	if (S.navIndex < 0) return;
	if (ownsHistory()) { window.history.back(); return; } // Rest erledigt onPopState
	jumpTo(prevValidIndex());
}

export function navForward() {
	const next = nextValidIndex();
	if (next === -1) return;
	if (ownsHistory()) { window.history.forward(); return; }
	jumpTo(next);
}

// Wird nach STATE.load() aufgerufen. Ungültige/gelöschte Seiten und Chats werden
// ignoriert; die letzte gültige aktive Ansicht ist anschließend direkt geöffnet.
// Start-Performance: Heft-Bilder (12 MB+) werden NICHT mehr vor dem ersten Frame
// geladen. HEFT.mount zeigt „Heft laden…" und lädt per hydrateHeftBlobs() nach,
// sobald der Splash weg ist — sonst hängt der Ladekreis im Boot.
export async function restoreSession() {
	const tabs = syncableTabs();
	const active = tabs.includes(S.activeTabId) ? S.activeTabId : (tabs[tabs.length - 1] || null);
	if (tabs.length !== S.tabs.length || active !== S.activeTabId) {
		S.tabs = tabs;
		S.activeTabId = active;
		await saveSessionNow();
	}
	// Der aktuelle Browser-Eintrag wird zum Anfang (Home); Einträge eines früheren
	// Ladens gelten als fremd. Die wiederhergestellte Seite ist der erste Schritt.
	S.navHistory = [];
	S.navIndex = -1;
	if (hasHistory()) { try { window.history.replaceState(navState(), ""); } catch { /* ignore */ } }
	if (active) {
		openPage(active, { restoreSession: true });
	}
}

// Beim Hintergrundwechsel/Minimieren/Schließen sofort synchron speichern (Best Practice für PWA)
if (typeof document !== "undefined") {
	document.addEventListener("visibilitychange", () => {
		if (document.hidden) saveSessionNow().catch((e) => PERF_PROFILER.error("tabs-session-save-error", e));
	});
}
if (typeof window !== "undefined") {
	window.addEventListener("pagehide", () => { saveSessionNow().catch((e) => PERF_PROFILER.error("tabs-session-save-error", e)); });
	window.addEventListener("freeze", () => { saveSessionNow().catch((e) => PERF_PROFILER.error("tabs-session-save-error", e)); });
}

export const TABS = {
	openPage,
	openNewTab,
	closeTab,
	navBack,
	navForward,
	canGoBack,
	canGoForward,
	setLayerHandler,
	openHomeOverview,
	restoreSession
};

BUS.on("tabs:open-page", (arg) => typeof arg === "string" ? openPage(arg) : openPage(arg?.id, arg?.opts));
BUS.on("tabs:nav-back", () => navBack());
BUS.on("tabs:nav-forward", () => navForward());

