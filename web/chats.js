"use strict";

// ---------- Chat-Verlauf (lokal in localStorage, wie Notions Chat-Liste) ----------
export const CHATS = {
	load() {
		// Fallback auf den alten Schlüssel — gespeicherte Chats überleben die Umbenennung.
		try { return JSON.parse(localStorage.getItem("impala67.chats") || localStorage.getItem("notion.chats") || "[]"); }
		catch { return []; }
	},
	save(list) {
		try { localStorage.setItem("impala67.chats", JSON.stringify(list.slice(0, 100))); }
		catch (e) { console.warn("Chat-Verlauf konnte nicht gespeichert werden:", e); }
	},
};