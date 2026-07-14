"use strict";

import { S, STATE } from "./state.js";

const KEY = "impala67.chats";
const LEGACY_KEY = "notion.chats";
const MAX_CHATS = 100;

function readLocal() {
	try {
		const raw = localStorage.getItem(KEY) || localStorage.getItem(LEGACY_KEY) || "[]";
		return Array.isArray(JSON.parse(raw)) ? JSON.parse(raw) : [];
	} catch {
		return [];
	}
}

function normalize(session) {
	if (!session || !session.id) return null;
	return {
		id: String(session.id),
		title: String(session.title || ""),
		messages: Array.isArray(session.messages) ? session.messages : [],
		created: session.created || session.updated || new Date().toISOString(),
		updated: session.updated || session.created || new Date().toISOString(),
	};
}

function writeLocal(list) {
	try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX_CHATS))); }
	catch (error) { console.warn("Chat-Verlauf konnte nicht lokal gespeichert werden:", error); }
}

function mergedSessions() {
	const byId = new Map();
	for (const item of readLocal()) {
		const session = normalize(item);
		if (session) byId.set(session.id, session);
	}
	for (const item of Object.values(S.chatSessions || {})) {
		if (!item || item.deleted) continue;
		const session = normalize(item);
		if (!session) continue;
		const old = byId.get(session.id);
		if (!old || String(session.updated) >= String(old.updated)) byId.set(session.id, session);
	}
	return [...byId.values()].sort((a, b) => String(b.updated).localeCompare(String(a.updated))).slice(0, MAX_CHATS);
}

function queueSync(type, payload) {
	// Nicht awaiten: alle bisherigen Aufrufstellen von CHATS.save() sind synchron.
	// STATE.dispatch serialisiert die Events selbst und der lokale Cache bleibt sofort aktuell.
	STATE.dispatch(type, payload).catch((error) => console.warn("Chat-Sync konnte nicht gespeichert werden:", error));
}

export const CHATS = {
	load() {
		const list = mergedSessions();
		writeLocal(list);
		return list;
	},

	save(list) {
		const sessions = (Array.isArray(list) ? list : []).map(normalize).filter(Boolean)
			.sort((a, b) => String(b.updated).localeCompare(String(a.updated))).slice(0, MAX_CHATS);
		writeLocal(sessions);

		const active = new Set(sessions.map((session) => session.id));
		for (const session of sessions) {
			const current = S.chatSessions && S.chatSessions[session.id];
			// Nur echte Änderungen erzeugen ein Event; verhindert Drive-Upload-Schleifen.
			if (!current || current.deleted || String(current.updated) !== String(session.updated) || JSON.stringify(current.messages) !== JSON.stringify(session.messages) || current.title !== session.title) {
				queueSync("chatUpsert", session);
			}
		}
		for (const session of Object.values(S.chatSessions || {})) {
			if (session && !session.deleted && !active.has(session.id)) {
				queueSync("chatDelete", { id: session.id, deletedAt: new Date().toISOString() });
			}
		}
	},

	// Einmal beim Start: vorhandene lokale Chats als reguläre Event-Log-Einträge
	// veröffentlichen. Danach übernimmt der normale save()-Pfad alle Änderungen.
	async migrateLocal() {
		const local = readLocal().map(normalize).filter(Boolean);
		if (!local.length) return;
		for (const session of local) {
			const current = S.chatSessions && S.chatSessions[session.id];
			if (!current || current.deleted || String(session.updated) > String(current.updated || "")) {
				await STATE.dispatch("chatUpsert", session);
			}
		}
	},
};