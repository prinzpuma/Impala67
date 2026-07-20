"use strict";

import { S, STATE } from "./state.js";

// chats.js — Chat-Sitzungen: localStorage als schneller Cache, Event-Log (chatUpsert/chatDelete
// via STATE.dispatch) als synchende Wahrheit. Rewrite (20. Juli 2026): KISS/DRY, API unverändert.
// Fixes: readLocal parste dasselbe JSON doppelt; normalize() erzeugte für created/updated zwei
// VERSCHIEDENE Zeitstempel (zweimal new Date()); Sortieren+Kürzen war dreifach dupliziert.

const KEY = "impala67.chats";
const LEGACY_KEY = "notion.chats";
const MAX_CHATS = 100;

const byUpdatedDesc = (a, b) => String(b.updated).localeCompare(String(a.updated));
const sortTrim = (list) => list.sort(byUpdatedDesc).slice(0, MAX_CHATS);

function readLocal() {
	try {
		const parsed = JSON.parse(localStorage.getItem(KEY) || localStorage.getItem(LEGACY_KEY) || "[]");
		return Array.isArray(parsed) ? parsed : [];
	} catch { return []; }
}

function normalize(session) {
	if (!session?.id) return null;
	const now = new Date().toISOString();
	return {
		id: String(session.id),
		title: String(session.title || ""),
		messages: Array.isArray(session.messages) ? session.messages : [],
		created: session.created || session.updated || now,
		updated: session.updated || session.created || now,
	};
}

function writeLocal(list) {
	try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX_CHATS))); }
	catch (e) { console.warn("Chat-Verlauf konnte nicht lokal gespeichert werden:", e); }
}

function mergedSessions() {
	const byId = new Map();
	for (const item of readLocal()) {
		const s = normalize(item);
		if (s) byId.set(s.id, s);
	}
	for (const item of Object.values(S.chatSessions || {})) {
		if (!item?.id) continue;
		// Lösch-Tombstones überstimmen den localStorage-Cache — sonst belebt der nächste save()
		// gelöschte Chats per chatUpsert wieder (tauchten nach Sync/auf anderen Geräten wieder auf).
		if (item.deleted) {
			const cached = byId.get(String(item.id));
			if (!cached || String(item.deletedAt || "") >= String(cached.updated || "")) byId.delete(String(item.id));
			continue;
		}
		const s = normalize(item);
		const old = s && byId.get(s.id);
		if (s && (!old || String(s.updated) >= String(old.updated))) byId.set(s.id, s);
	}
	return sortTrim([...byId.values()]);
}

// Nicht awaiten: alle Aufrufstellen von save() sind synchron; STATE.dispatch serialisiert selbst
// und der lokale Cache ist sofort aktuell.
const queueSync = (type, payload) =>
	STATE.dispatch(type, payload).catch((e) => console.warn("Chat-Sync konnte nicht gespeichert werden:", e));

export const CHATS = {
	load() {
		const list = mergedSessions();
		writeLocal(list);
		return list;
	},

	save(list) {
		const sessions = sortTrim((Array.isArray(list) ? list : []).map(normalize).filter(Boolean));
		writeLocal(sessions);
		const active = new Set(sessions.map((s) => s.id));
		for (const s of sessions) {
			const cur = S.chatSessions?.[s.id];
			// Gelöschte Sitzung nur wiederbeleben, wenn die Kopie NEUER als der Lösch-Zeitpunkt ist
			// (bewusst fortgesetzter Chat) — sonst macht alter localStorage das Löschen still rückgängig.
			if (cur?.deleted && String(cur.deletedAt || "") >= String(s.updated || "")) continue;
			// Nur echte Änderungen erzeugen ein Event (verhindert Drive-Upload-Schleifen);
			// billige Vergleiche zuerst, JSON.stringify der Nachrichten als letztes.
			if (!cur || cur.deleted || String(cur.updated) !== String(s.updated) || cur.title !== s.title || JSON.stringify(cur.messages) !== JSON.stringify(s.messages)) {
				queueSync("chatUpsert", s);
			}
		}
		for (const s of Object.values(S.chatSessions || {})) {
			if (s && !s.deleted && !active.has(s.id)) queueSync("chatDelete", { id: s.id, deletedAt: new Date().toISOString() });
		}
	},

	// Einmal beim Start: lokale Chats als reguläre Event-Log-Einträge veröffentlichen —
	// danach übernimmt der normale save()-Pfad.
	async migrateLocal() {
		for (const s of readLocal().map(normalize).filter(Boolean)) {
			const cur = S.chatSessions?.[s.id];
			if (!cur || cur.deleted || String(s.updated) > String(cur.updated || "")) await STATE.dispatch("chatUpsert", s);
		}
	},
};