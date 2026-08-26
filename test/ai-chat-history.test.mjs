import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><body></body>", { url: "http://localhost/" });
Object.defineProperty(globalThis, "window", { value: dom.window, configurable: true });
Object.defineProperty(globalThis, "document", { value: dom.window.document, configurable: true });
Object.defineProperty(globalThis, "localStorage", { value: dom.window.localStorage, configurable: true });

const { S, STATE } = await import("../web/state.js");
const { CHATS } = await import("../web/chats.js");

test("eine gleich lange Umformulierung wird als neue Chatfassung gesichert", async () => {
	const writes = [];
	S.chatSessions = {};
	S.currentChatId = "chat-same-length";
	STATE.dispatch = async (type, payload) => {
		if (type === "chatUpsert") {
			writes.push(structuredClone(payload));
			S.chatSessions[payload.id] = structuredClone(payload);
		}
	};

	const messages = [{ mid: "answer-1", role: "assistant", content: "AAAA" }];
	CHATS.persist(messages, "currentChatId");
	await new Promise((resolve) => setTimeout(resolve, 2));
	messages[0].content = "BBBB";
	CHATS.persist(messages, "currentChatId");
	await Promise.resolve();

	assert.equal(writes.length, 2);
	assert.equal(writes[1].messages[0].content, "BBBB");
	assert.notEqual(writes[1].updated, writes[0].updated);
});

test("mehrere Chats werden vollständig über einzelne synchronisierte Tombstones gelöscht", async () => {
	CHATS.save([]);
	await Promise.resolve();
	const deleted = [];
	const now = new Date().toISOString();
	S.chatSessions = {
		"bulk-1": { id: "bulk-1", title: "Eins", messages: [], created: now, updated: now },
		"bulk-2": { id: "bulk-2", title: "Zwei", messages: [], created: now, updated: now },
	};
	STATE.dispatch = async (type, payload) => {
		if (type !== "chatDelete") return;
		deleted.push(structuredClone(payload));
		S.chatSessions[payload.id] = { ...S.chatSessions[payload.id], deleted: true, deletedAt: payload.deletedAt };
	};

	assert.deepEqual(CHATS.load().map((chat) => chat.id).sort(), ["bulk-1", "bulk-2"]);
	assert.equal(CHATS.removeMany(["bulk-1", "bulk-2"]), 2);
	await Promise.resolve();

	assert.deepEqual(deleted.map((entry) => entry.id).sort(), ["bulk-1", "bulk-2"]);
	assert.equal(new Set(deleted.map((entry) => entry.deletedAt)).size, 1, "ein gemeinsamer Löschzeitpunkt");
	assert.deepEqual(CHATS.load(), []);
});
