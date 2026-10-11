"use strict";

import { S } from "./state.js";
import { CHATS } from "./chats.js";

// nav-history.js — reiner Zustand der Zurück/Vor-Navigation (ohne Rendern).
// S.navHistory enthält Ziel-IDs (Seiten-ID, "chat:…", "nlm:main", "anki:main" oder "home").
// S.navIndex = -1 ist der feste Anfang: die Home-Übersicht vor dem ersten Eintrag.
// Jeder Eintrag hat genau einen Browser-Verlaufseintrag mit { sid, navIndex }; so führen
// Zurück-Pfeil, Android-Zurücktaste, Wischgeste und Browser-Zurück denselben Weg.

// Kennung dieses Seitenaufrufs: Verlaufseinträge eines früheren Ladens (Reload) gelten als fremd.
export const SID = Math.random().toString(36).slice(2);

export const HOME = "home";

export const navState = (extra) => ({ impalaNav: true, sid: SID, navIndex: S.navIndex, ...extra });

// Verlaufsindex eines Browser-Eintrags; fremde Einträge zählen als Anfang (Home).
export const navIndexOf = (state) =>
	state && state.sid === SID && Number.isInteger(state.navIndex) ? state.navIndex : -1;

export const entryAt = (i) => (i < 0 ? HOME : S.navHistory[i]);
export const currentEntry = () => entryAt(S.navIndex);

// Das, was gerade angezeigt wird, als Verlaufs-ID. null = Ansicht ohne eigenen Eintrag
// (Bibliothek, Papierkorb, Tagesnotiz …).
export function displayedEntry() {
	switch (S.view) {
		case "home": return HOME;
		case "page": return S.currentPageId;
		case "chat": return S.currentChatId ? "chat:" + S.currentChatId : null;
		case "notebooklm": return "nlm:main";
		case "anki": return "anki:main";
		default: return null;
	}
}

// Gelöschte Seiten, Seiten im Papierkorb und gelöschte Chats werden übersprungen.
export function isValidEntry(id) {
	if (!id) return false;
	if (id === HOME || id === "nlm:main" || id === "anki:main") return true;
	if (id.startsWith("chat:")) return Boolean(CHATS.get(id.slice(5)));
	const pg = S.pages[id];
	return Boolean(pg && !pg.trashed);
}

export function prevValidIndex() {
	let i = S.navIndex - 1;
	while (i >= 0 && !isValidEntry(S.navHistory[i])) i--;
	return Math.max(i, -1);
}

export function nextValidIndex() {
	for (let i = S.navIndex + 1; i < S.navHistory.length; i++) {
		if (isValidEntry(S.navHistory[i])) return i;
	}
	return -1;
}

export const canGoBack = () => S.navIndex >= 0 || displayedEntry() !== HOME;
export const canGoForward = () => nextValidIndex() !== -1;
