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
