import test from "node:test";
import assert from "node:assert/strict";

import worker, { SyncRoom } from "../server/worker.js";
import { CLOUD_SYNC_PROTOCOL, CLOUD_SYNC_PROTOCOL_HEADER, cloudEventsEnvelope, prepareIncomingCloudEvents } from "../web/sync-core.js";
import {
	deriveSyncCredentials,
	encryptPayload,
	decryptPayload,
	generateSyncKey,
	MAX_USER_STORAGE_BYTES,
} from "../web/sync-crypto.js";

const KEY_A = "impala-0001-0002-0003-0004-0005-0006-0007-0008";
const KEY_B = "impala-1001-1002-1003-1004-1005-1006-1007-1008";
const syncHeaders = (authToken) => ({
	Authorization: `Bearer ${authToken}`,
	[CLOUD_SYNC_PROTOCOL_HEADER]: String(CLOUD_SYNC_PROTOCOL),
});

// Mock-Umgebung für Cloudflare D1 & R2 & WebSockets im Node-Test
function createMockEnv() {
	const dbStore = {
		events: [],
		storage: new Map(),
		queries: [],
	};
	const bucketStore = new Map();

	const mockBucket = {
		async put(key, data, options = {}) {
			bucketStore.set(key, { data, customMetadata: options.customMetadata || {} });
			return { key };
		},
		async get(key) {
			const item = bucketStore.get(key);
			if (!item) return null;
			return {
				key,
				async text() {
					if (typeof item.data === "string") return item.data;
					return new TextDecoder().decode(item.data);
				},
				async arrayBuffer() {
					if (item.data instanceof Uint8Array) {
						return item.data.buffer.slice(item.data.byteOffset, item.data.byteOffset + item.data.byteLength);
					}
					if (typeof item.data === "string") {
						return new TextEncoder().encode(item.data).buffer;
					}
					return item.data;
				},
				customMetadata: item.customMetadata,
			};
		},
		async delete(keys) {
			const arr = Array.isArray(keys) ? keys : [keys];
			for (const k of arr) bucketStore.delete(k);
		},
		async list(options = {}) {
			const prefix = options.prefix || "";
			const objects = [];
			for (const [k] of bucketStore.entries()) {
				if (k.startsWith(prefix)) {
					objects.push({ key: k });
				}
			}
			return { objects, truncated: false };
		},
	};

	const mockDb = {
		prepare(query) {
			dbStore.queries.push(query);
			const createOp = (params = []) => ({
				_query: query,
				_params: params,
				bind(...newParams) {
					return createOp(newParams);
				},
				async first() {
					if (query.includes("COUNT(*)")) {
						return { cnt: dbStore.storage.size };
					}
					if (query.includes("SUM(total_bytes)") || query.includes("server_bytes")) {
						let sum = 0;
						for (const val of dbStore.storage.values()) sum += (val.bytes || 0);
						return { server_bytes: sum };
					}
					if (query.includes("MAX(seq)")) {
						const [userId] = params;
						const userEvents = dbStore.events.filter((e) => e.user_id === userId);
						const max = userEvents.reduce((m, e) => Math.max(m, e.seq), 0);
						const totalBytes = userEvents.reduce((sum, e) => sum + (Number(e.size) || 0), 0);
						return { max_seq: max, total_bytes: totalBytes };
					}
					if (query.includes("user_storage")) {
						const [userId] = params;
						const record = dbStore.storage.get(userId);
						return record ? { total_bytes: record.bytes, auth_token_hash: record.token } : null;
					}
					return null;
				},
				async all() {
					if (query.includes("sync_events WHERE user_id = ? AND seq > ?")) {
						const [userId, since, limit] = params;
						const userEvents = dbStore.events
							.filter((e) => e.user_id === userId && e.seq > since)
							.sort((a, b) => a.seq - b.seq)
							.slice(0, limit);
						return { results: userEvents };
					}
					if (query.includes("SELECT event_id FROM sync_events")) {
						const [userId] = params;
						return { results: dbStore.events.filter((e) => e.user_id === userId).map((e) => ({ event_id: e.id })) };
					}
					return { results: [] };
				},
				async run() {
					if (query.includes("DELETE FROM sync_events")) {
						const [userId] = params;
						dbStore.events = dbStore.events.filter((e) => e.user_id !== userId);
					}
					if (query.includes("DELETE FROM user_storage")) {
						const [userId] = params;
						dbStore.storage.delete(userId);
					}
					if (query.includes("INSERT INTO user_storage")) {
						const [userId, token, bytes] = params;
						dbStore.storage.set(userId, { bytes, token });
					}
					return { success: true };
				},
			});
			return createOp([]);
		},
		async batch(stmts) {
			for (const stmt of stmts) {
				const q = stmt._query || "";
				const p = stmt._params || [];
				if (q.includes("DELETE FROM sync_events")) {
					const [userId] = p;
					dbStore.events = dbStore.events.filter((event) => event.user_id !== userId);
				} else if (q.includes("DELETE FROM user_storage")) {
					const [userId] = p;
					dbStore.storage.delete(userId);
				} else if (q.includes("INSERT OR IGNORE INTO sync_events") || q.includes("INSERT INTO sync_events")) {
					const [userId, seq, event_id, iv, r2_key, size, created_at] = p;
					dbStore.events.push({ user_id: userId, seq, event_id, id: event_id, iv, r2_key, size, created_at });
				} else if (q.includes("user_storage")) {
					const [userId, token, bytes] = p;
					dbStore.storage.set(userId, { bytes, token });
				}
			}
			return [];
		},
	};

	const ctx = {
		sockets: new Set(),
		storageData: new Map(),
		storage: {
			async get(key) {
				return ctx.storageData.get(key);
			},
			async put(key, val) {
				ctx.storageData.set(key, val);
			},
		},
		getWebSockets() {
			return Array.from(this.sockets);
		},
		acceptWebSocket(ws) {
			this.sockets.add(ws);
		},
	};

	return { env: { DB: mockDb, BUCKET: mockBucket }, ctx, dbStore, bucketStore };
}

test("CORS erlaubt die vom Browser verwendeten Auth-Header explizit", async () => {
	const res = await worker.fetch(new Request("https://example.com/api/sync", {
		method: "OPTIONS",
		headers: {
			Origin: "https://prinzpuma.github.io",
			"Access-Control-Request-Method": "GET",
			"Access-Control-Request-Headers": "authorization,x-user-id",
		},
	}), {}, {});
	assert.equal(res.status, 204);
	const allowed = res.headers.get("Access-Control-Allow-Headers") || "";
	assert.match(allowed, /Authorization/i);
	assert.match(allowed, /X-User-Id/i);
	assert.match(allowed, new RegExp(CLOUD_SYNC_PROTOCOL_HEADER, "i"));
	assert.notEqual(allowed.trim(), "*");
});

test("HTTP-Sync lehnt alte Protokollstände ausdrücklich ab", async () => {
	const { env, ctx } = createMockEnv();
	const { userId, authToken } = await deriveSyncCredentials(generateSyncKey());
	const room = new SyncRoom(ctx, env);
	const response = await room.fetch(new Request(`https://example.com/api/quota?user=${userId}`, {
		headers: { Authorization: `Bearer ${authToken}` },
	}));
	assert.equal(response.status, 426);
	assert.match((await response.json()).error, /Protokoll v2/);
});

test("Worker-Fehler bleiben als lesbare JSON-Antwort mit CORS sichtbar", async () => {
	const env = {
		SYNC_ROOM: {
			idFromName: () => "room-id",
			get: () => ({ fetch: async () => { throw new Error("D1 nicht erreichbar"); } }),
		},
	};
	const res = await worker.fetch(new Request("https://example.com/api/sync?user=1234567890123456"), env, {});
	assert.equal(res.status, 500);
	assert.equal(res.headers.get("Access-Control-Allow-Origin"), "*");
	assert.equal((await res.json()).code, "internal_error");
});

test("AI-Proxy nutzt den bestehenden Sync-Token und gibt den Groq-Key nicht an den Client", async () => {
	const { env, ctx } = createMockEnv();
	const { userId, authToken } = await deriveSyncCredentials(generateSyncKey());
	const room = new SyncRoom(ctx, env);
	room.userId = userId;
	await room.verifyAuthorization(authToken);
	env.GROQ_API_KEY = "test-groq-secret";

	const originalFetch = globalThis.fetch;
	let upstreamRequest;
	globalThis.fetch = async (url, init) => {
		upstreamRequest = { url, init };
		return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "Hallo" } }] }), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
	};

	try {
		const response = await worker.fetch(new Request(`https://example.com/api/ai?user=${userId}`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${authToken}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ messages: [{ role: "user", content: "Sag hallo" }] }),
		}), env, ctx);

		assert.equal(response.status, 200);
		const responseBody = await response.text();
		assert.deepEqual(JSON.parse(responseBody), { choices: [{ message: { role: "assistant", content: "Hallo" } }] });
		assert.equal(upstreamRequest.url, "https://api.groq.com/openai/v1/chat/completions");
		assert.equal(JSON.parse(upstreamRequest.init.body).model, "qwen/qwen3.6-27b");
		assert.match(upstreamRequest.init.headers.Authorization, /^Bearer test-groq-secret$/);
		assert.doesNotMatch(responseBody, /test-groq-secret/);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("AI-Proxy wechselt nur bei 429 zum nächsten Groq-Modell", async () => {
	const { env, ctx } = createMockEnv();
	const { userId, authToken } = await deriveSyncCredentials(generateSyncKey());
	const room = new SyncRoom(ctx, env);
	room.userId = userId;
	await room.verifyAuthorization(authToken);
	env.GROQ_API_KEY = "test-groq-secret";

	const originalFetch = globalThis.fetch;
	const requestedModels = [];
	globalThis.fetch = async (_url, init) => {
		const payload = JSON.parse(init.body);
		requestedModels.push(payload.model);
		if (requestedModels.length < 3) return new Response(JSON.stringify({ error: { code: "rate_limit_exceeded" } }), {
			status: 429,
			headers: { "Content-Type": "application/json" },
		});
		return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "GPT-20B-Antwort" } }] }), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
	};

	try {
		const response = await worker.fetch(new Request(`https://example.com/api/ai?user=${userId}`, {
			method: "POST",
			headers: { Authorization: `Bearer ${authToken}`, "Content-Type": "application/json" },
			body: JSON.stringify({ messages: [{ role: "user", content: "Sag hallo" }] }),
		}), env, ctx);
		assert.equal(response.status, 200);
		assert.deepEqual(requestedModels, ["qwen/qwen3.6-27b", "openai/gpt-oss-120b", "openai/gpt-oss-20b"]);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("AI-Proxy weist fehlende oder falsche Sync-Berechtigung ab", async () => {
	const { env, ctx } = createMockEnv();
	env.GROQ_API_KEY = "test-groq-secret";
	const response = await worker.fetch(new Request("https://example.com/api/ai?user=1234567890123456", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ messages: [{ role: "user", content: "Sag hallo" }] }),
	}), env, ctx);
	assert.equal(response.status, 403);
});

test("Notion-Proxy ist Sync-authentifiziert und leitet Tokens nur an api.notion.com weiter", async () => {
	const { env, ctx } = createMockEnv();
	const { userId, authToken } = await deriveSyncCredentials(generateSyncKey());
	const room = new SyncRoom(ctx, env);
	room.userId = userId;
	await room.verifyAuthorization(authToken);
	const originalFetch = globalThis.fetch;
	let upstreamRequest;
	globalThis.fetch = async (url, init) => {
		upstreamRequest = { url, init };
		return new Response(JSON.stringify({ object: "list", results: [] }), { headers: { "Content-Type": "application/json" } });
	};
	try {
		const response = await worker.fetch(new Request(`https://example.com/api/notion?user=${userId}`, {
			method: "POST",
			headers: { Authorization: `Bearer ${authToken}`, "Content-Type": "application/json" },
			body: JSON.stringify({ token: "secret-notion-token", path: "/search", method: "POST", body: { query: "Mathe" } }),
		}), env, ctx);
		assert.equal(response.status, 200);
		assert.equal(upstreamRequest.url, "https://api.notion.com/v1/search");
		assert.equal(upstreamRequest.init.headers.Authorization, "Bearer secret-notion-token");
		assert.doesNotMatch(await response.text(), /secret-notion-token/);
	} finally { globalThis.fetch = originalFetch; }
});

test("Notion-Proxy blockiert fremde Ziele und fehlende Sync-Berechtigung", async () => {
	const { env, ctx } = createMockEnv();
	const unauthorized = await worker.fetch(new Request("https://example.com/api/notion?user=1234567890123456", {
		method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: "x", path: "/search" }),
	}), env, ctx);
	assert.equal(unauthorized.status, 403);
	const { userId, authToken } = await deriveSyncCredentials(generateSyncKey());
	const room = new SyncRoom(ctx, env); room.userId = userId; await room.verifyAuthorization(authToken);
	const blocked = await worker.fetch(new Request(`https://example.com/api/notion?user=${userId}`, {
		method: "POST", headers: { Authorization: `Bearer ${authToken}`, "Content-Type": "application/json" },
		body: JSON.stringify({ token: "secret", path: "//evil.example/steal" }),
	}), env, ctx);
	assert.equal(blocked.status, 400);
});

test("AI-Proxy unterstützt multimodale Bilder und Tool-Aufrufe für Qwen", async () => {
	const { env, ctx } = createMockEnv();
	const { userId, authToken } = await deriveSyncCredentials(generateSyncKey());
	const room = new SyncRoom(ctx, env);
	room.userId = userId;
	await room.verifyAuthorization(authToken);
	env.GROQ_API_KEY = "test-groq-secret";

	const originalFetch = globalThis.fetch;
	let capturedBody;
	globalThis.fetch = async (_url, init) => {
		capturedBody = JSON.parse(init.body);
		return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "Bild erkannt" } }] }), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
	};

	try {
		// 1. Multimodales Bild an Qwen
		const resImage = await worker.fetch(new Request(`https://example.com/api/ai?user=${userId}`, {
			method: "POST",
			headers: { Authorization: `Bearer ${authToken}`, "Content-Type": "application/json" },
			body: JSON.stringify({
				messages: [
					{ role: "user", content: [{ type: "text", text: "Beschreibe dieses Bild" }, { type: "image_url", image_url: { url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=" } }] },
				],
			}),
		}), env, ctx);
		assert.equal(resImage.status, 200);
		assert.equal(capturedBody.model, "qwen/qwen3.6-27b");
		assert.equal(capturedBody.messages[0].content[1].type, "image_url");

		// 2. Tool-Aufrufe und Tool-Ergebnisse
		const resTools = await worker.fetch(new Request(`https://example.com/api/ai?user=${userId}`, {
			method: "POST",
			headers: { Authorization: `Bearer ${authToken}`, "Content-Type": "application/json" },
			body: JSON.stringify({
				messages: [
					{ role: "user", content: "Suche Notizen" },
					{ role: "assistant", content: null, tool_calls: [{ id: "call_123", type: "function", function: { name: "search_notes", arguments: "{}" } }] },
					{ role: "tool", tool_call_id: "call_123", content: '{"results":[]}' },
				],
				tools: [{ type: "function", function: { name: "search_notes", description: "Notizen durchsuchen" } }],
			}),
		}), env, ctx);
		assert.equal(resTools.status, 200);
		assert.equal(capturedBody.tools[0].function.name, "search_notes");
		assert.equal(capturedBody.messages[1].tool_calls[0].id, "call_123");
		assert.equal(capturedBody.messages[2].role, "tool");
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("AI-Proxy lehnt ungültige Rollen und leere Nachrichten mit 400 ab", async () => {
	const { env, ctx } = createMockEnv();
	const { userId, authToken } = await deriveSyncCredentials(generateSyncKey());
	const room = new SyncRoom(ctx, env);
	room.userId = userId;
	await room.verifyAuthorization(authToken);
	env.GROQ_API_KEY = "test-groq-secret";

	const resRole = await worker.fetch(new Request(`https://example.com/api/ai?user=${userId}`, {
		method: "POST",
		headers: { Authorization: `Bearer ${authToken}`, "Content-Type": "application/json" },
		body: JSON.stringify({ messages: [{ role: "invalid_role", content: "Hello" }] }),
	}), env, ctx);
	assert.equal(resRole.status, 400);
	assert.match((await resRole.json()).error, /Nicht unterstützte Rolle/);
});

test("GET /api/models und /models listen die 3 Groq-AI-Modelle auf", async () => {
	const { env, ctx } = createMockEnv();
	const res = await worker.fetch(new Request("https://example.com/models"), env, ctx);
	assert.equal(res.status, 200);
	const data = await res.json();
	assert.deepEqual(data.data.map((m) => m.id), [
		"qwen/qwen3.6-27b",
		"openai/gpt-oss-120b",
		"openai/gpt-oss-20b",
	]);
});

test("Actor-Start lädt nicht mehr alle Event-IDs eines Kontos in den Arbeitsspeicher", async () => {
	const { env, ctx, dbStore } = createMockEnv();
	const room = new SyncRoom(ctx, env);
	await room.ensureInitialized("1234567890123456");
	assert.equal(dbStore.queries.some((query) => /^SELECT event_id FROM sync_events WHERE user_id = \?$/i.test(query.trim())), false);
});

test("HTTP-Uploads bleiben unter dem D1-Free-Limit von 50 Queries", async () => {
	const { env, ctx } = createMockEnv();
	const room = new SyncRoom(ctx, env);
	const { userId, authToken } = await deriveSyncCredentials(generateSyncKey());
	room.userId = userId;
	await room.verifyAuthorization(authToken);

	const events = Array.from({ length: 41 }, (_, index) => ({
		id: `limit-${index}`,
		iv: "000000000000000000000000",
		data: "AAAA",
	}));
	const response = await room.fetch(new Request(`https://example.com/api/events?user=${userId}`, {
		method: "POST",
		headers: {
			...syncHeaders(authToken),
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ events }),
	}));

	assert.equal(response.status, 413);
	assert.match((await response.json()).error, /Maximal 40 Events/);
});

test("Worker akzeptiert große R2-Pakete und verlangt die aktuelle D1-R2-Architektur", async () => {
	const { env, ctx } = createMockEnv();
	const room = new SyncRoom(ctx, env);
	room.userId = "1234567890123456";

	const compressed = await room.saveEvents([{
		id: "compressed",
		iv: "000000000000000000000000",
		data: "gz:AAAA",
	}]);
	assert.equal(compressed.ok, true);
	assert.equal(compressed.savedEvents.length, 1);

	const largeR2 = await room.saveEvents([{
		id: "large-r2",
		iv: "000000000000000000000000",
		data: "A".repeat(1_900_004),
	}]);
	assert.equal(largeR2.ok, true);

	const noR2 = createMockEnv();
	delete noR2.env.BUCKET;
	const d1Room = new SyncRoom(noR2.ctx, noR2.env);
	d1Room.userId = "1234567890123456";
	const oversized = await d1Room.saveEvents([{ id: "oversized", iv: "000000000000000000000000", data: "A".repeat(1_900_004) }]);
	assert.equal(oversized.ok, false);
	assert.equal(oversized.status, 503);
	assert.match(oversized.error, /D1 und R2/);
});

test("Cloud-Download paginiert große R2-Events zusätzlich nach Bytes", async () => {
	const { env, ctx } = createMockEnv();
	const room = new SyncRoom(ctx, env);
	const { userId, authToken } = await deriveSyncCredentials(generateSyncKey());
	room.userId = userId;
	await room.verifyAuthorization(authToken);
	const data = "A".repeat(4_100_000);
	const saved = await room.saveEvents([
		{ id: "large-page-1", iv: "000000000000000000000000", data },
		{ id: "large-page-2", iv: "111111111111111111111111", data },
	]);
	assert.equal(saved.ok, true);

	const firstResponse = await room.fetch(new Request(`https://example.com/api/sync?user=${userId}&since=0&limit=100`, {
		headers: syncHeaders(authToken),
	}));
	const first = await firstResponse.json();
	assert.equal(first.events.length, 1);
	assert.equal(first.hasMore, true);

	const secondResponse = await room.fetch(new Request(`https://example.com/api/sync?user=${userId}&since=${first.events[0].seq}&limit=100`, {
		headers: syncHeaders(authToken),
	}));
	const second = await secondResponse.json();
	assert.deepEqual(second.events.map((event) => event.id), ["large-page-2"]);
});

test("Deduplizierung: Bereits gespeicherte Events werden auf dem Server ignoriert", async () => {
	const { env, ctx } = createMockEnv();
	const room = new SyncRoom(ctx, env);
	const key = generateSyncKey();
	const { userId, authToken, cryptoKey } = await deriveSyncCredentials(key);

	const ev1 = await encryptPayload(cryptoKey, { id: "ev-1", t: "2026-08-19T10:00:00Z", type: "pageCreate", payload: { id: "p1" } });
	const ev2 = await encryptPayload(cryptoKey, { id: "ev-2", t: "2026-08-19T10:01:00Z", type: "pageUpdate", payload: { id: "p1" } });
	const ev3 = await encryptPayload(cryptoKey, { id: "ev-3", t: "2026-08-19T10:02:00Z", type: "pageUpdate", payload: { id: "p1" } });

	room.userId = userId;
	await room.verifyAuthorization(authToken);

	// 1. Erster Upload von ev1 und ev2
	const res1 = await room.saveEvents([{ id: "ev-1", ...ev1 }, { id: "ev-2", ...ev2 }]);
	assert.equal(res1.ok, true);
	assert.equal(res1.savedEvents.length, 2);
	assert.equal(res1.maxSeq, 2);
	const initialUsage = res1.usage;
	assert.ok(initialUsage > 0);

	// 2. Erneuter Upload von ev1, ev2 UND neuem ev3 (z. B. nach Reconnect)
	const res2 = await room.saveEvents([{ id: "ev-1", ...ev1 }, { id: "ev-2", ...ev2 }, { id: "ev-3", ...ev3 }]);
	assert.equal(res2.ok, true);
	assert.equal(res2.savedEvents.length, 1); // Nur ev3 wurde neu gespeichert!
	assert.equal(res2.savedEvents[0].id, "ev-3");
	assert.equal(res2.maxSeq, 3);
	assert.equal(res2.usage, initialUsage + ev3.size);

	// 3. Erneuter Upload von ausschließlich bereits bekannten Events (reiner No-Op)
	const res3 = await room.saveEvents([{ id: "ev-1", ...ev1 }, { id: "ev-2", ...ev2 }]);
	assert.equal(res3.ok, true);
	assert.equal(res3.savedEvents.length, 0); // 0 neue Events
	assert.equal(res3.maxSeq, 3); // Sequenz bleibt unverändert
	assert.equal(res3.usage, res2.usage); // Speicher wächst nicht!
});

test("Deduplizierung: Doppelte Event-IDs im selben Paket werden nur einmal gespeichert", async () => {
	const { env, ctx } = createMockEnv();
	const room = new SyncRoom(ctx, env);
	const key = generateSyncKey();
	const { userId, authToken, cryptoKey } = await deriveSyncCredentials(key);
	room.userId = userId;
	await room.verifyAuthorization(authToken);

	const encrypted = await encryptPayload(cryptoKey, { id: "same-batch", type: "test" });
	const res = await room.saveEvents([
		{ id: "same-batch", ...encrypted },
		{ id: "same-batch", ...encrypted },
	]);

	assert.equal(res.ok, true);
	assert.equal(res.savedEvents.length, 1);
	assert.equal(res.maxSeq, 1);
});

test("Strikte Sequenzierung: Parallele Uploads erhalten eindeutige aufsteigende Sequenzen", async () => {
	const { env, ctx } = createMockEnv();
	const room = new SyncRoom(ctx, env);
	const key = generateSyncKey();
	const { userId, authToken, cryptoKey } = await deriveSyncCredentials(key);
	room.userId = userId;
	await room.verifyAuthorization(authToken);

	const evA = await encryptPayload(cryptoKey, { id: "ev-A", type: "test" });
	const evB = await encryptPayload(cryptoKey, { id: "ev-B", type: "test" });

	const [resA, resB] = await Promise.all([
		room.saveEvents([{ id: "ev-A", ...evA }]),
		room.saveEvents([{ id: "ev-B", ...evB }]),
	]);

	assert.equal(resA.ok, true);
	assert.equal(resB.ok, true);
	assert.notEqual(resA.maxSeq, resB.maxSeq);
	assert.ok(Math.max(resA.maxSeq, resB.maxSeq) === 2);
});

test("Quota-Enforcement: Pakete über 1.000 MB werden mit 413 abgewiesen", async () => {
	const { env, ctx } = createMockEnv();
	const room = new SyncRoom(ctx, env);
	const key = generateSyncKey();
	const { userId, authToken } = await deriveSyncCredentials(key);
	room.userId = userId;
	await room.verifyAuthorization(authToken);

	await room.ensureInitialized(userId);
	room.totalBytes = MAX_USER_STORAGE_BYTES - 10;
	const oversizedEvent = {
		id: "huge-1",
		iv: "00112233445566778899aabb",
		data: "dGVzdA==",
		size: 1,
	};

	const res = await room.saveEvents([oversizedEvent]);
	assert.equal(res.ok, false);
	assert.equal(res.status, 413);
	assert.ok(res.error.includes("1.000 MB"));
});

test("D1 + R2 Hybrid-Speicherung: Payloads liegen als echte Binärdaten in R2 und D1 enthält nur schlanke Pointer", async () => {
	const { env, ctx, dbStore, bucketStore } = createMockEnv();
	const room = new SyncRoom(ctx, env);
	const key = generateSyncKey();
	const { userId, authToken, cryptoKey } = await deriveSyncCredentials(key);
	room.userId = userId;
	await room.verifyAuthorization(authToken);

	// 1. Normales Event speichern
	const encrypted = await encryptPayload(cryptoKey, { id: "hybrid-1", content: "geheime notiz" });
	const res = await room.saveEvents([{ id: "hybrid-1", ...encrypted }]);

	assert.equal(res.ok, true);
	// R2 enthält echte Binärdaten (Uint8Array), kein aufgeblähtes Base64
	const r2Key = `users/${userId}/events/hybrid-1.bin`;
	assert.ok(bucketStore.has(r2Key));
	const storedItem = bucketStore.get(r2Key);
	assert.ok(storedItem.data instanceof Uint8Array);
	assert.equal(storedItem.data.byteLength, encrypted.size - 12);
	assert.equal(storedItem.customMetadata.gz, "0");

	// D1 speichert ausschließlich Metadaten und den R2-Zeiger.
	const d1Event = dbStore.events.find((e) => e.event_id === "hybrid-1");
	assert.ok(d1Event);
	assert.equal(d1Event.r2_key, r2Key);
	assert.equal(Object.hasOwn(d1Event, "data"), false);

	// 2. Gzip-komprimiertes Event speichern
	const largeDoc = { id: "hybrid-2", content: "x".repeat(70000) };
	const encLarge = await encryptPayload(cryptoKey, largeDoc);
	assert.ok(encLarge.data.startsWith("gz:"));
	const resLarge = await room.saveEvents([{ id: "hybrid-2", ...encLarge }]);
	assert.equal(resLarge.ok, true);
	const r2Key2 = `users/${userId}/events/hybrid-2.bin`;
	assert.equal(bucketStore.get(r2Key2).customMetadata.gz, "1");

	// 3. GET /api/sync lädt beide Payloads transparent aus R2 zurück
	const syncReq = new Request(`https://example.com/api/sync?user=${userId}&since=0`, {
		headers: syncHeaders(authToken),
	});
	const syncRes = await room.fetch(syncReq);
	assert.equal(syncRes.status, 200);
	const syncData = await syncRes.json();
	assert.equal(syncData.events.length, 2);
	assert.equal(syncData.events[0].data, encrypted.data);
	assert.equal(syncData.events[1].data, encLarge.data);

	// 4. Entschlüsselung funktioniert transparent
	const dec1 = await decryptPayload(cryptoKey, syncData.events[0]);
	assert.equal(dec1.content, "geheime notiz");
	const dec2 = await decryptPayload(cryptoKey, syncData.events[1]);
	assert.equal(dec2.content, largeDoc.content);

	// 5. POST /api/reset leert D1 und R2
	const resetReq = new Request(`https://example.com/api/reset?user=${userId}`, {
		method: "POST",
		headers: syncHeaders(authToken),
	});
	const resetRes = await room.fetch(resetReq);
	assert.equal(resetRes.status, 200);
	assert.equal(bucketStore.has(r2Key), false);
	assert.equal(bucketStore.has(r2Key2), false);
	assert.equal(dbStore.events.length, 0);
});

test("R2-Rollback: Bei einem D1-Datenbankfehler werden neu angelegte R2-Objekte bereinigt", async () => {
	const { env, ctx, bucketStore } = createMockEnv();
	// Simuliere DB-Batch-Absturz
	env.DB.batch = async () => {
		throw new Error("D1 Disk IO Error");
	};

	const room = new SyncRoom(ctx, env);
	const key = generateSyncKey();
	const { userId, authToken, cryptoKey } = await deriveSyncCredentials(key);
	room.userId = userId;
	await room.verifyAuthorization(authToken);

	const encrypted = await encryptPayload(cryptoKey, { id: "fail-1", content: "wird gerollbackt" });
	const res = await room.saveEvents([{ id: "fail-1", ...encrypted }]);

	assert.equal(res.ok, false);
	assert.equal(room.maxSeq, 0);
	// R2-Objekt darf nach dem Rollback nicht verwaist existieren
	const r2Key = `users/${userId}/events/fail-1.bin`;
	assert.equal(bucketStore.has(r2Key), false);
});

test("R2-Rollback: Bei einem R2-Schreibfehler wird der Upload abgebrochen und aufgeräumt", async () => {
	const { env, ctx, bucketStore } = createMockEnv();
	let callCount = 0;
	// Simuliere Fehlschlag beim zweiten Event
	const origPut = env.BUCKET.put;
	env.BUCKET.put = async (key, data, options) => {
		callCount++;
		if (callCount === 2) throw new Error("R2 Storage Network Timeout");
		return origPut.call(env.BUCKET, key, data, options);
	};

	const room = new SyncRoom(ctx, env);
	const key = generateSyncKey();
	const { userId, authToken, cryptoKey } = await deriveSyncCredentials(key);
	room.userId = userId;
	await room.verifyAuthorization(authToken);

	const ev1 = await encryptPayload(cryptoKey, { id: "part-1", content: "eins" });
	const ev2 = await encryptPayload(cryptoKey, { id: "part-2", content: "zwei" });
	const res = await room.saveEvents([{ id: "part-1", ...ev1 }, { id: "part-2", ...ev2 }]);

	assert.equal(res.ok, false);
	assert.equal(res.status, 500);
	assert.equal(room.maxSeq, 0);
	// Keine verwaisten R2-Dateien
	assert.equal(bucketStore.size, 0);
});

test("Cloud-Reset meldet einen R2-Löschfehler und behält die D1-Zeiger für einen erneuten Versuch", async () => {
	const { env, ctx, dbStore, bucketStore } = createMockEnv();
	const room = new SyncRoom(ctx, env);
	const { userId, authToken, cryptoKey } = await deriveSyncCredentials(generateSyncKey());
	room.userId = userId;
	await room.verifyAuthorization(authToken);
	const encrypted = await encryptPayload(cryptoKey, { id: "keep-on-reset-error", content: "x" });
	assert.equal((await room.saveEvents([{ id: "keep-on-reset-error", ...encrypted }])).ok, true);

	env.BUCKET.delete = async () => { throw new Error("R2 unavailable"); };
	const response = await room.fetch(new Request(`https://example.com/api/reset?user=${userId}`, {
		method: "POST",
		headers: syncHeaders(authToken),
	}));

	assert.equal(response.status, 500);
	assert.equal(dbStore.events.length, 1);
	assert.equal(bucketStore.size, 1);
	assert.equal(room.maxSeq, 1);
});

test("Persistierte Speichernutzung enthält den gerade gespeicherten Upload", async () => {
	const { env, ctx, dbStore } = createMockEnv();
	const room = new SyncRoom(ctx, env);
	const key = generateSyncKey();
	const { userId, authToken, cryptoKey } = await deriveSyncCredentials(key);
	room.userId = userId;
	await room.verifyAuthorization(authToken);

	const encrypted = await encryptPayload(cryptoKey, { id: "usage-1", type: "test" });
	const res = await room.saveEvents([{ id: "usage-1", ...encrypted }]);
	assert.equal(res.ok, true);
	assert.equal(dbStore.storage.get(userId).bytes, res.usage);
	assert.ok(res.usage > 0);
});

test("Kryptografische Autorisierung: Falscher Auth-Token wird mit 403 abgewiesen", async () => {
	const { env, ctx } = createMockEnv();
	const room = new SyncRoom(ctx, env);

	const { userId, authToken } = await deriveSyncCredentials(KEY_A);
	const { authToken: wrongToken } = await deriveSyncCredentials(KEY_B);

	// 1. Initialer Request mit echtem Auth-Token -> Erfolgreich
	const validReq = new Request(`https://example.com/api/quota?user=${userId}`, {
		headers: syncHeaders(authToken),
	});
	const validRes = await room.fetch(validReq);
	assert.equal(validRes.status, 200);

	// 2. Request mit gefälschtem/falschem Auth-Token -> 403 Forbidden!
	const invalidReq = new Request(`https://example.com/api/quota?user=${userId}`, {
		headers: syncHeaders(wrongToken),
	});
	const invalidRes = await room.fetch(invalidReq);
	assert.equal(invalidRes.status, 403);
	const errData = await invalidRes.json();
	assert.ok(errData.error.includes("Autorisierungs-Token"));
});

test("Kryptografische Autorisierung: Ein neuer Kanal akzeptiert keinen leeren Token", async () => {
	const { env, ctx } = createMockEnv();
	const room = new SyncRoom(ctx, env);
	const { userId } = await deriveSyncCredentials(generateSyncKey());
	const req = new Request(`https://example.com/api/quota?user=${userId}`, { headers: { [CLOUD_SYNC_PROTOCOL_HEADER]: String(CLOUD_SYNC_PROTOCOL) } });

	const res = await room.fetch(req);
	assert.equal(res.status, 403);
});

test("WebSocket Hibernation: State wird nach Aufwecken via Attachment nahtlos wiederhergestellt", async () => {
	const { env, ctx } = createMockEnv();
	let room = new SyncRoom(ctx, env);

	const key = generateSyncKey();
	const { userId, authToken, cryptoKey } = await deriveSyncCredentials(key);

	// Mock WebSocket mit Attachment-Fähigkeit
	let attachment = null;
	const mockWs = {
		serializeAttachment(val) {
			attachment = val;
		},
		deserializeAttachment() {
			return attachment;
		},
		messages: [],
		send(msg) {
			this.messages.push(JSON.parse(msg));
		},
		close() {},
	};

	// 1. WebSocket verbinden (ohne Token in der URL!)
	const wsReq = new Request(`https://example.com/ws?user=${userId}`, {
		headers: { Upgrade: "websocket" },
	});
	wsReq._mockServer = mockWs;
	const wsRes = await room.fetch(wsReq);
	assert.ok(wsRes.status === 101 || wsRes.status === 200);

	// Attachment muss initial unauthentifiziert sein
	assert.equal(attachment.userId, userId);
	assert.equal(attachment.authenticated, false);

	// In-Band Auth Handshake senden
	await room.webSocketMessage(mockWs, JSON.stringify({ type: "auth", protocol: CLOUD_SYNC_PROTOCOL, token: authToken }));
	assert.equal(attachment.authenticated, true);
	assert.equal(attachment.protocol, CLOUD_SYNC_PROTOCOL);
	assert.equal(mockWs.messages[0].type, "authenticated");
	assert.equal(mockWs.messages[0].protocol, CLOUD_SYNC_PROTOCOL);

	// 2. Simulierter Schlafzustand (Hibernation): Room-Instanz wird aus dem RAM entladen!
	room = new SyncRoom(ctx, env); // Komplett neue Instanz ohne RAM-Zustand!
	assert.equal(room.userId, null);
	assert.equal(room.initialized, false);

	// 3. Eingehende WebSocket-Nachricht weckt Room auf
	const testEvent = await encryptPayload(cryptoKey, { id: "hib-1", type: "noteEdit" });
	await room.webSocketMessage(mockWs, JSON.stringify({
		type: "event",
		event: { id: "hib-1", ...testEvent },
	}));

	// 4. Room hat userId & Auth aus dem Attachment wiederhergestellt und ACK gesendet
	assert.equal(room.userId, userId);
	assert.equal(room.initialized, true);
	assert.equal(mockWs.messages.length, 2);
	assert.equal(mockWs.messages[1].type, "ack");
	assert.equal(mockWs.messages[1].eventId, "hib-1");
});

test("WebSocket lehnt einen alten Handshake vor der Autorisierung ab", async () => {
	const { env, ctx } = createMockEnv();
	const room = new SyncRoom(ctx, env);
	const { userId, authToken } = await deriveSyncCredentials(generateSyncKey());
	room.userId = userId;
	const messages = [];
	const ws = { send: (msg) => messages.push(JSON.parse(msg)), close() {}, deserializeAttachment: () => ({ userId, authenticated: false }) };
	await room.webSocketMessage(ws, JSON.stringify({ type: "auth", protocol: 1, token: authToken }));
	assert.equal(messages[0].type, "unsupported_protocol");
	assert.equal(room.authTokenHash, null);
});

test("E2EE Multi-Device Flow: Client A verschlüsselt -> Server speichert -> Client B entschlüsselt", async () => {
	const { env, ctx } = createMockEnv();
	const room = new SyncRoom(ctx, env);

	const clientA = await deriveSyncCredentials(KEY_A);
	const clientB = await deriveSyncCredentials(KEY_A);
	const clientWrong = await deriveSyncCredentials(KEY_B);

	room.userId = clientA.userId;
	await room.verifyAuthorization(clientA.authToken);

	const noteContent = {
		id: "note-42",
		t: "2026-08-19T11:00:00Z",
		type: "pageCreate",
		payload: { title: "Echtzeit Notiz", content: "Sync zwischen Gerät A und Gerät B funktioniert perfekt!" },
	};

	// 1. Client A verschlüsselt und sendet
	const encryptedA = await encryptPayload(clientA.cryptoKey, noteContent);
	const saveRes = await room.saveEvents([{ id: "note-42", ...encryptedA }]);
	assert.equal(saveRes.ok, true);

	// 2. Client B holt verschlüsseltes Event und entschlüsselt mit demselben Schlüssel
	const receivedPayload = saveRes.savedEvents[0];
	const decryptedB = await decryptPayload(clientB.cryptoKey, receivedPayload);
	assert.deepEqual(decryptedB, noteContent);

	// 3. Nicht-autorisierter Client kann die Daten nicht entschlüsseln
	await assert.rejects(async () => {
		await decryptPayload(clientWrong.cryptoKey, receivedPayload);
	});
});

test("E2EE-Batch transportiert 500 fachliche Events als ein R2-Paket", async () => {
	const { env, ctx, bucketStore } = createMockEnv();
	const room = new SyncRoom(ctx, env);
	const client = await deriveSyncCredentials(KEY_A);
	room.userId = client.userId;
	await room.verifyAuthorization(client.authToken);

	const events = Array.from({ length: 500 }, (_, index) => ({
		id: `bundled-${index}`,
		type: "pageUpdate",
		payload: { id: "page-1", text: `Stand ${index}` },
	}));
	const encrypted = await encryptPayload(client.cryptoKey, cloudEventsEnvelope(events));
	const saveRes = await room.saveEvents([{ id: "batch-500", ...encrypted }]);

	assert.equal(saveRes.ok, true);
	assert.equal(saveRes.savedEvents.length, 1);
	assert.equal(bucketStore.size, 1);
	const decrypted = await decryptPayload(client.cryptoKey, saveRes.savedEvents[0]);
	assert.deepEqual(prepareIncomingCloudEvents([decrypted]).map((event) => event.id), events.map((event) => event.id));
});

test("Paginierung: 600 Events werden in 200er-Batches lückenlos und in exakter Reihenfolge abgerufen", async () => {
	const { env, ctx } = createMockEnv();
	const room = new SyncRoom(ctx, env);
	const key = generateSyncKey();
	const { userId, authToken, cryptoKey } = await deriveSyncCredentials(key);
	room.userId = userId;
	await room.verifyAuthorization(authToken);

	// 600 Events erstellen und speichern
	const totalEvents = 600;
	const eventsToSave = [];
	for (let i = 1; i <= totalEvents; i++) {
		const encrypted = await encryptPayload(cryptoKey, { id: `bulk-${i}`, num: i });
		eventsToSave.push({ id: `bulk-${i}`, ...encrypted });
	}

	const saveRes = await room.saveEvents(eventsToSave);
	assert.equal(saveRes.ok, true);
	assert.equal(saveRes.savedEvents.length, 600);
	assert.equal(saveRes.maxSeq, 600);

	// Client simuliert Paginierung (Abruf in 200er-Schritten)
	const PAGE_SIZE = 200;
	let currentSeq = 0;
	let hasMore = true;
	const fetchedEvents = [];

	while (hasMore) {
		const req = new Request(`https://example.com/api/sync?since=${currentSeq}&limit=${PAGE_SIZE}`, {
			headers: {
				"X-User-Id": userId,
				...syncHeaders(authToken),
			},
		});
		const res = await room.fetch(req);
		assert.equal(res.status, 200);
		const data = await res.json();

		for (const ev of data.events) {
			fetchedEvents.push(ev);
		}

		if (data.events.length > 0) {
			currentSeq = data.events[data.events.length - 1].seq;
		}

		hasMore = Boolean(data.hasMore && data.events.length > 0);
	}

	assert.equal(fetchedEvents.length, 600);
	// Prüfen, dass alle Sequenznummern 1..600 strikt lückenlos und aufsteigend sind
	for (let i = 0; i < 600; i++) {
		assert.equal(fetchedEvents[i].seq, i + 1);
		assert.equal(fetchedEvents[i].id, `bulk-${i + 1}`);
	}
});
