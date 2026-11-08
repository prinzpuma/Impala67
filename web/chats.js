"use strict";

import { S, STATE } from "./state.js";
import { U } from "./util.js";
import { CORE } from "./rust-core.js";

// chats.js — Chat-Sitzungen: localStorage ist Cache, das Event-Log ist die Wahrheit.
const KEY = "impala67.chats";
const LEGACY_KEY = "notion.chats";
const CACHE_LIMIT = 200; // kürzt NUR den lokalen Cache — niemals das Event-Log

const atLeast = (a, b) => String(a || "") >= String(b || "");
const isTombstoneActive = (cur, updated) => Boolean(cur?.deleted && atLeast(cur.deletedAt, updated));
const sorted = (list) => JSON.parse(CORE.sortChatSessions(JSON.stringify(list || [])));

const sig = (s) => [s.updated, s.title, s.messages.length].join("|");

let _localParsed = null;
function readLocal() {
	if (_localParsed) return _localParsed;
	try {
		const parsed = JSON.parse(localStorage.getItem(KEY) || localStorage.getItem(LEGACY_KEY) || "[]");
		_localParsed = Array.isArray(parsed) ? parsed : [];
		return _localParsed;
	} catch { _localParsed = []; return _localParsed; }
}

let listCache = null;
const dropCache = () => { listCache = null; };
const prints = new Map();
const textHash = (value) => {
	const text = String(value || "");
	let hash = 2166136261;
	for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
	return (hash >>> 0).toString(36);
};
const printOf = (list) => (list || []).length + ":" + (list || [])
	.map((m) => [m.mid || "", m.role || "", textHash(m.content || m.reasoning), m.undone ? 1 : 0, m.answered ? 1 : 0, m.reasoning ? 1 : 0].join("~"))
	.join(",");

let writtenPrint = null;
const listPrint = (list) => list.map(sig).join(";");

function writeLocal(list) {
	dropCache();
	const print = listPrint(list);
	if (print === writtenPrint) return;
	try {
		const slice = list.slice(0, CACHE_LIMIT);
		localStorage.setItem(KEY, JSON.stringify(slice));
		_localParsed = slice;
		writtenPrint = print;
	} catch (e) { console.warn("Chat-Verlauf konnte nicht lokal gespeichert werden:", e); }
}

function normalize(session) {
	if (!session?.id) return null;
	const json = CORE.normalizeChatSession(JSON.stringify(session), U.now());
	return json ? JSON.parse(json) : null;
}

function mergedSessions() {
	return STATE.mergedChatSessions(readLocal(), U.now());
}

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
		queueMicrotask(dropCache);
		return list;
	},

	get(id) {
		const key = String(id);
		return this.load().find((s) => s.id === key) || null;
	},

	save(list, { localOnly = false } = {}) {
		const sessions = sorted((Array.isArray(list) ? list : []).map(normalize).filter(Boolean));
		writeLocal(sessions);
		if (localOnly) return sessions;
		for (const s of sessions) {
			const cur = S.chatSessions?.[s.id];
			if (isTombstoneActive(cur, s.updated)) continue;
			if (!cur || cur.deleted || sig(normalize(cur)) !== sig(s)) queueSync("chatUpsert", s);
		}
		return sessions;
	},

	remove(id) {
		return this.removeMany([id]);
	},

	removeMany(ids) {
		const keys = new Set((Array.isArray(ids) ? ids : [ids]).filter(Boolean).map(String));
		if (!keys.size) return 0;
		const deletedAt = U.now();
		writeLocal(this.load().filter((s) => !keys.has(s.id)));
		for (const key of keys) queueSync("chatDelete", { id: key, deletedAt });
		return keys.size;
	},

	async migrateLocal() {
		for (const s of readLocal().map(normalize).filter(Boolean)) {
			const cur = S.chatSessions?.[s.id];
			if (isTombstoneActive(cur, s.updated)) continue;
			if (!cur || String(s.updated) > String(cur.updated || "")) await STATE.dispatch("chatUpsert", s);
		}
	},

	persist(messages, idKey, fixedId, options) {
		if (!Array.isArray(messages) || !messages.length) return null;
		const list = this.load();
		const wantedId = fixedId || S[idKey];
		let s = wantedId ? list.find((x) => x.id === wantedId) : null;
		if (!s) {
			s = { id: wantedId || U.uid(), title: "", created: U.now(), updated: U.now(), messages: [] };
			if (!fixedId || !S[idKey]) S[idKey] = s.id;
			list.unshift(s);
		}
		const print = printOf(messages);
		if ((prints.has(s.id) ? prints.get(s.id) : printOf(s.messages)) !== print) s.updated = U.now();
		prints.set(s.id, print);
		s.messages = messages;
		if (!s.title) {
			const first = messages.find((m) => m.role === "user");
			s.title = String(first?.content || "").slice(0, 60) || "Neuer Chat";
		}
		this.save(list, options);
		return s;
	},
};
