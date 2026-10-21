"use strict";

// Wann darf ein verspätetes Event hinter neuere Events rutschen?
//
// Der Replay sortiert das Log nach Zeit. Trifft ein Fremd-Event ein, das älter ist als
// schon angewandte Events (das andere Gerät war offline oder hat gebündelt hochgeladen),
// steht es im Speicher hinter Events, vor die es eigentlich gehört. Das ist nur egal,
// wenn keines dieser neueren Events dieselbe Sache anfasst.
//
// orderKeysOf() nennt die Sachen, die ein Event liest oder schreibt. null heißt „wirkt
// auf vieles“ (Seitenbaum, Stapel, Einstellungen): Solche Events vertragen keine andere
// Reihenfolge. ORDER_ALL merkt sich, wann zuletzt so ein Event lief.
export const ORDER_ALL = "*";

// Ob eine Seite existiert und im Papierkorb liegt, lesen andere Reducer (offene Tabs).
const pageLifeKeys = (id, patch) => ("trashed" in (patch || {}) ? ["page:" + id, "life:" + id] : ["page:" + id]);

export function orderKeysOf(ev) {
	const p = ev?.payload || {};
	switch (ev?.type) {
		case "pageCreate": return p.id ? ["page:" + p.id, "life:" + p.id] : null;
		case "pageUpdate": return p.id ? pageLifeKeys(p.id, p.patch) : null;
		case "heftOps":
		case "heftSnap": return p.pageId ? ["page:" + p.pageId] : null;
		// Inhaltsadressiert: derselbe Hash trägt immer dieselben Bytes.
		case "heftBlob": return [];
		case "learningSessionUpsert":
		case "learningSessionDelete": return p.id ? ["session:" + p.id] : null;
		case "chatUpsert":
		case "chatDelete": return p.id ? ["chat:" + p.id] : null;
		case "homeArticleUpsert": return p.id ? ["article:" + p.id] : null;
		case "teleEvent": return ["telemetry"];
		case "uiTreeSet": return p.key ? ["tree:" + p.key] : null;
		case "uiTabsSet": return ["tabs", ...(Array.isArray(p.tabs) ? p.tabs : [])
			.filter((id) => typeof id === "string")
			.map((id) => (id.startsWith("chat:") ? "chat:" + id.slice(5) : "life:" + id))];
		case "cardCreate": return p.id ? ["card:" + p.id, "deck:" + (p.deck || "")] : null;
		case "cardUpdate": return p.id ? ["card:" + p.id] : null;
		case "cardReview":
		case "cardReviewUndo": return p.id ? ["card:" + p.id, "reviews"] : null;
		default: return null;
	}
}

// Merkt sich je Sache den spätesten Zeitpunkt, zu dem ein Event sie angefasst hat.
export function noteEventOrder(times, ev) {
	const t = String(ev?.t || "");
	for (const key of orderKeysOf(ev) || [ORDER_ALL]) {
		if (t > (times.get(key) || "")) times.set(key, t);
	}
}

// true, wenn das Event dasselbe Ergebnis liefert, egal ob es vor oder nach den in
// `times` erfassten Events läuft. Ohne Zeiten (alter Checkpoint) ist das nie beweisbar.
export function reorderSafe(ev, times) {
	if (!times) return false;
	const keys = orderKeysOf(ev);
	if (!keys) return false;
	const t = String(ev?.t || "");
	return (times.get(ORDER_ALL) || "") <= t && keys.every((key) => (times.get(key) || "") <= t);
}
