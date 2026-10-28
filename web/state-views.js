"use strict";

// Lese-Ansichten auf den Zustand im Rust-Kern (state.js). Der Kern hält den Zustand; die
// Oberfläche liest Sammlungen wie S.pages oder S.cards über diese Ansichten. Geholt wird erst
// beim Lesen und nur, was sich seit dem letzten Lesen geändert hat (der Kern meldet je Event,
// was es berührt hat). Große Teile bleiben im Kern: Seiteninhalte holt erst der Zugriff auf
// `content`, Hefte und ihre Bilder gibt es nur über eigene Abfragen.
//
// Alles ist schreibgeschützt: Container und Einträge sind eingefroren bzw. nur lesbar, eine
// Zuweisung wirft (ES-Module laufen strikt). Änderungen gehen ausschließlich über Events.
// Einträge von Seiten und Karten behalten ihre Identität und lesen immer den aktuellen Stand –
// wer `pg` festhält und nach einem dispatch() liest, sieht den neuen Titel.

function deepFreeze(value) {
	if (value && typeof value === "object" && !Object.isFrozen(value)) {
		Object.freeze(value);
		for (const key of Object.keys(value)) deepFreeze(value[key]);
	}
	return value;
}

// Sammlung `kind` (Name wie in ModelCore.records). lazy: Feld, das nicht mitkommt, sondern bei
// jedem Lesen einzeln aus dem Kern geholt wird. live: Einträge als Ansichten mit fester Identität.
function collection(M, kind, { lazy = null, live = false } = {}) {
	let recs = new Map(), views = new Map(), container = null;
	let dirtyAll = true;
	const dirtyIds = new Set();

	const lazyValue = (id) => M.recordField(kind, id, lazy);
	function current(id) {
		ensure();
		return recs.get(id);
	}
	function syncView(id, rec) {
		let view = views.get(id);
		if (!view) {
			view = {};
			if (lazy) Object.defineProperty(view, lazy, { get: () => (recs.has(id) ? lazyValue(id) : undefined), enumerable: true, configurable: false });
			views.set(id, view);
		}
		for (const key of Object.keys(view)) {
			if (key !== lazy && !Object.prototype.hasOwnProperty.call(rec, key)) delete view[key];
		}
		for (const key of Object.keys(rec)) {
			if (key === lazy || Object.prototype.hasOwnProperty.call(view, key)) continue;
			Object.defineProperty(view, key, { get: () => current(id)?.[key], enumerable: true, configurable: true });
		}
		return view;
	}
	function put(id, rec) {
		deepFreeze(rec);
		recs.set(id, rec);
		if (live) syncView(id, rec);
	}
	function ensure() {
		if (dirtyAll) {
			dirtyAll = false;
			dirtyIds.clear();
			const all = JSON.parse(M.records(kind, "null"));
			const before = recs;
			recs = new Map();
			for (const [id, rec] of Object.entries(all)) put(id, rec);
			if (live) for (const id of before.keys()) if (!recs.has(id)) views.delete(id);
			container = null;
		} else if (dirtyIds.size) {
			const ids = [...dirtyIds];
			dirtyIds.clear();
			const got = JSON.parse(M.records(kind, JSON.stringify(ids)));
			for (const id of ids) {
				const rec = got[id];
				if (rec) {
					if (!recs.has(id)) container = null;
					put(id, rec);
				} else if (recs.delete(id)) {
					views.delete(id);
					container = null;
				}
			}
		}
	}
	function get() {
		ensure();
		if (!container) {
			const o = {};
			for (const [id, rec] of recs) o[id] = live ? views.get(id) : rec;
			container = Object.freeze(o);
		}
		return container;
	}
	function touch(ids) {
		if (ids === true) dirtyAll = true;
		else if (Array.isArray(ids)) for (const id of ids) dirtyIds.add(id);
	}
	return { get, touch, reset: () => { dirtyAll = true; } };
}

// Einzelwert (Einstellungen, Protokolle): bei Änderung als Ganzes neu geholt.
function single(read) {
	let value = null, dirty = true;
	return {
		get() {
			if (dirty) { value = deepFreeze(JSON.parse(read())); dirty = false; }
			return value;
		},
		touch(on) { if (on) dirty = true; },
		reset() { dirty = true; },
	};
}

// Hängt die Ansichten als nur lesbare Eigenschaften an S. touch(touched) nimmt die Meldung
// des Kerns entgegen (ModelCore.applyLocal/applyRemote), reset() verwirft alles (nach dem Start).
export function installViews(S, M) {
	const parts = {
		pages: collection(M, "pages", { lazy: "content", live: true }),
		cards: collection(M, "cards", { live: true }),
		grades: collection(M, "grades"),
		learningSessions: collection(M, "learningSessions"),
		chatSessions: collection(M, "chatSessions", { live: true }),
		homeArticles: collection(M, "homeArticles"),
		decks: collection(M, "decks"),
		workspaces: collection(M, "workspaces"),
		gnFolders: collection(M, "gnFolders"),
		treeOpen: collection(M, "treeOpen"),
		settings: single(() => M.settings()),
		reviews: single(() => M.reviews()),
		telemetry: single(() => M.telemetry()),
	};
	for (const [key, part] of Object.entries(parts)) {
		Object.defineProperty(S, key, { get: part.get, enumerable: true, configurable: false });
	}
	return {
		touch(t) {
			if (!t) return;
			for (const [key, part] of Object.entries(parts)) if (t[key]) part.touch(t[key]);
		},
		reset() { for (const part of Object.values(parts)) part.reset(); },
	};
}
