"use strict";

import { S, STATE } from "./state.js";
import { U } from "./util.js";

// chats.js — Chat-Sitzungen: localStorage ist Cache, das Event-Log ist die Wahrheit.
//
// Aufräumrunde (31. Juli 2026):
//  • EINE Zeitquelle (U.now()). Vorher mischten U.now() und new Date().toISOString(),
//    verglichen wurde aber rein textlich — "neuer/älter" konnte dadurch kippen.
//  • save() LÖSCHT NICHTS MEHR. Vorher wurde die Liste erst auf 100 gekürzt und danach
//    alles Fehlende als chatDelete ins Log geschrieben → Chat 101 verschwand geräteweit
//    und unwiderruflich. Löschen läuft ausschließlich über remove(id).
//  • migrateLocal() belebte beim Start gelöschte Chats wieder (cur.deleted → upsert).
//  • Änderungserkennung ohne Serialisierung aller Verläufe bei jedem Speichern.
//  • normalize() behält unbekannte Felder (Anhänge, Karten, Flags) statt sie wegzuwerfen.
//  • Fehlgeschlagener Log-Schreibvorgang ist jetzt sichtbar statt nur Konsolen-Rauschen.

const KEY = "impala67.chats";
const LEGACY_KEY = "notion.chats";
const CACHE_LIMIT = 200; // kürzt NUR den lokalen Cache — niemals das Event-Log

const stamp = (...vals) => String(vals.find(Boolean) || U.now());
const atLeast = (a, b) => String(a || "") >= String(b || "");
const sorted = (list) => [...list].sort((a, b) => String(b.updated).localeCompare(String(a.updated)));

// Fingerabdruck einer Sitzung. Zeitstempel + Titel + Anzahl genügen, weil persist()
// "updated" bei jeder echten Inhaltsänderung hochzieht — vorher wurde für JEDEN Chat
// bei JEDEM Speichern der komplette Verlauf zweimal nach JSON serialisiert.
const sig = (s) => [s.updated, s.title, s.messages.length].join("|");

function readLocal() {
	try {
		const parsed = JSON.parse(localStorage.getItem(KEY) || localStorage.getItem(LEGACY_KEY) || "[]");
		return Array.isArray(parsed) ? parsed : [];
	} catch { return []; }
}

// Ein einziger Render ruft load() mehrfach (Sidebar, Tab-Leiste, Home, Verlauf-Menü).
// Ohne diesen Kurzzeit-Puffer wurde dabei jedes Mal der komplette Verlauf gemischt UND
// nach localStorage zurückgeschrieben.
let listCache = null;
const dropCache = () => { listCache = null; };
// Fingerabdruck der zuletzt gespeicherten Nachrichtenliste je Chat (siehe persist()).
// PERF-WURZEL: kein JSON.stringify des Verlaufs mehr. Der lief bei JEDEM Speichern über alle
// Nachrichten inklusive eingebetteter Bilder (Data-URLs, schnell mehrere MB) — nur um
// festzustellen, OB sich etwas geändert hat. Eine kurze Kennung je Nachricht reicht dafür und
// erkennt weiterhin Anhängen, Bearbeiten, Rückgängig und beantwortete Rückfragen.
const prints = new Map();
const printOf = (list) => (list || []).length + ":" + (list || [])
	.map((m) => [m.mid || "", m.role || "", (m.content || "").length, m.undone ? 1 : 0, m.answered ? 1 : 0, m.reasoning ? 1 : 0].join("~"))
	.join(",");

// Fingerabdruck der zuletzt WEGGESCHRIEBENEN Liste.
let writtenPrint = null;
const listPrint = (list) => list.map(sig).join(";");

function writeLocal(list) {
	dropCache();
	// PERF-WURZEL: load() rief writeLocal bei JEDEM Cache-Miss, also mehrfach pro Render
	// (Sidebar, Tab-Leiste, Home, Verlauf-Menü). Dabei wurden ALLE Chats mit allen Nachrichten
	// und Bild-Data-URLs synchron nach localStorage serialisiert, obwohl sich beim reinen Lesen
	// nie etwas geändert hat. Jetzt nur noch schreiben, wenn der Inhalt wirklich abweicht.
	const print = listPrint(list);
	if (print === writtenPrint) return;
	try {
		localStorage.setItem(KEY, JSON.stringify(list.slice(0, CACHE_LIMIT)));
		writtenPrint = print;
	} catch (e) { console.warn("Chat-Verlauf konnte nicht lokal gespeichert werden:", e); }
}

function normalize(session) {
	if (!session?.id) return null;
	return {
		...session,
		id: String(session.id),
		title: String(session.title || ""),
		messages: Array.isArray(session.messages) ? session.messages : [],
		created: stamp(session.created, session.updated),
		updated: stamp(session.updated, session.created),
	};
}

function mergedSessions() {
	const byId = new Map();
	for (const item of readLocal()) {
		const s = normalize(item);
		if (s) byId.set(s.id, s);
	}
	for (const item of Object.values(S.chatSessions || {})) {
		if (!item?.id) continue;
		const id = String(item.id);
		// Tombstone schlägt den Cache — sonst belebt der nächste save() gelöschte Chats.
		if (item.deleted) {
			const cached = byId.get(id);
			if (!cached || atLeast(item.deletedAt, cached.updated)) byId.delete(id);
			continue;
		}
		const s = normalize(item);
		const old = byId.get(id);
		if (s && (!old || atLeast(s.updated, old.updated))) byId.set(id, s);
	}
	return sorted([...byId.values()]);
}

// Nicht awaiten: alle Aufrufer sind synchron, STATE.dispatch serialisiert selbst.
// Scheitert das Schreiben, sagt die App es — sonst behauptet der lokale Cache einen
// Stand, der nie im Log angekommen ist.
const queueSync = (type, payload) =>
	STATE.dispatch(type, payload).catch((e) => {
		console.warn("Chat-Sync fehlgeschlagen:", e);
		U.toast?.("Chat konnte nicht gesichert werden: " + (e?.message || e), "error");
	});

export const CHATS = {
	load() {
		if (listCache) return listCache;
		const list = mergedSessions();
		writeLocal(list);
		listCache = list;
		queueMicrotask(dropCache); // gilt nur für den laufenden Render-Durchlauf
		return list;
	},

	get(id) {
		const key = String(id);
		return this.load().find((s) => s.id === key) || null;
	},

	// Reines Upsert: fehlende Einträge bedeuten NICHT "gelöscht".
	save(list) {
		const sessions = sorted((Array.isArray(list) ? list : []).map(normalize).filter(Boolean));
		writeLocal(sessions);
		for (const s of sessions) {
			const cur = S.chatSessions?.[s.id];
			// Gelöschte Sitzung nur wiederbeleben, wenn die Kopie NEUER als der Löschzeitpunkt ist.
			if (cur?.deleted && atLeast(cur.deletedAt, s.updated)) continue;
			if (!cur || cur.deleted || sig(normalize(cur)) !== sig(s)) queueSync("chatUpsert", s);
		}
		return sessions;
	},

	// Einziger Löschweg: ausdrücklich, mit Tombstone, ohne Kollateralschaden.
	remove(id) {
		return this.removeMany([id]);
	},

	// Mehrfachauswahl: EIN Zeitstempel, EIN lokaler Schreibvorgang, ein Tombstone je Chat.
	removeMany(ids) {
		const keys = new Set((Array.isArray(ids) ? ids : [ids]).filter(Boolean).map(String));
		if (!keys.size) return 0;
		const deletedAt = U.now();
		writeLocal(this.load().filter((s) => !keys.has(s.id)));
		for (const key of keys) queueSync("chatDelete", { id: key, deletedAt });
		return keys.size;
	},

	// Einmal beim Start: lokale Chats ins Event-Log heben.
	async migrateLocal() {
		for (const s of readLocal().map(normalize).filter(Boolean)) {
			const cur = S.chatSessions?.[s.id];
			// FIX: ein Tombstone hat Vorrang — vorher hob der Start gelöschte Chats zurück ins Log.
			if (cur?.deleted && atLeast(cur.deletedAt, s.updated)) continue;
			if (!cur || String(s.updated) > String(cur.updated || "")) await STATE.dispatch("chatUpsert", s);
		}
	},

	// Gemeinsame Speicherlogik für Seitenpanel-Chat (ai.js) und Chat-Tab.
	persist(messages, idKey) {
		if (!Array.isArray(messages) || !messages.length) return null;
		const list = this.load();
		let s = S[idKey] ? list.find((x) => x.id === S[idKey]) : null;
		if (!s) {
			// Vorgemerkte ID behalten: „+ Neuer Chat“ legt bewusst KEINE leere Sitzung mehr an
			// (das hinterließ Geister-Chats), der offene Tab heißt aber schon so.
			s = { id: S[idKey] || U.uid(), title: "", created: U.now(), updated: U.now(), messages: [] };
			S[idKey] = s.id;
			list.unshift(s);
		}
		// FIX: s.messages IST ab dem zweiten Speichern dieselbe Liste wie messages — der Vergleich
		// verglich sie mit sich selbst und meldete IMMER "unverändert". "updated" blieb dadurch auf
		// dem ersten Zeitstempel stehen: falsche Sortierung, und beim Zusammenführen mit Event-Log
		// bzw. Drive galt der Chat als älter, als er ist (jüngere Nachrichten konnten verlieren).
		// Jetzt gegen einen gemerkten Fingerabdruck prüfen — eine Serialisierung statt zwei.
		const print = printOf(messages);
		if ((prints.has(s.id) ? prints.get(s.id) : printOf(s.messages)) !== print) s.updated = U.now();
		prints.set(s.id, print);
		s.messages = messages;
		if (!s.title) {
			const first = messages.find((m) => m.role === "user");
			s.title = String(first?.content || "").slice(0, 60) || "Neuer Chat";
		}
		this.save(list);
		return s;
	},
};