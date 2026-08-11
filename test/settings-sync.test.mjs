import test from "node:test";
import assert from "node:assert/strict";
import { SETTINGS_SYNC } from "../web/settings-sync.js";

const provider = (key = "secret") => ({ id: "openai", name: "OpenAI", base: "https://api.openai.com/v1", key });

test("missing syncSecrets keeps the existing compatible default", () => {
	assert.equal(SETTINGS_SYNC.allowsSecrets({}), true);
	assert.equal(SETTINGS_SYNC.allowsSecrets({ syncSecrets: true }), true);
	assert.equal(SETTINGS_SYNC.allowsSecrets({ syncSecrets: false }), false);
});

test("disabled token sync removes secret fields from settings events", () => {
	const event = {
		id: "e1",
		t: "2026-08-11T10:00:00.000Z",
		type: "settingsSet",
		payload: { aiModel: "demo", notionToken: "secret_123", aiProviders: [provider()] },
	};
	const clean = SETTINGS_SYNC.sanitizeEvent(event, false);
	assert.deepEqual(clean.payload, { aiModel: "demo", aiProviders: [{ id: "openai", name: "OpenAI", base: "https://api.openai.com/v1" }] });
});

test("secret-only events are not transported", () => {
	const event = { id: "e1", t: "2026-08-11T10:00:00.000Z", type: "settingsSet", payload: { notionToken: "secret" } };
	assert.equal(SETTINGS_SYNC.sanitizeEvent(event, false), null);
});

test("redacted provider patches preserve local keys on remote import", () => {
	const current = { aiProviders: [provider("local-secret")] };
	const incoming = { aiProviders: [{ id: "openai", name: "OpenAI", base: "https://api.openai.com/v1" }] };
	assert.equal(SETTINGS_SYNC.mergePatch(current, incoming).aiProviders[0].key, "local-secret");
});

test("enabling token sync can create a complete local secret snapshot", () => {
	const snapshot = SETTINGS_SYNC.secretSnapshot({ notionToken: "notion-secret", aiProviders: [provider()] });
	assert.equal(snapshot.notionToken, "notion-secret");
	assert.equal(snapshot.aiProviders[0].key, "secret");
});
