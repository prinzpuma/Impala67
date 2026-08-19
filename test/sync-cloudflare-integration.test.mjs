import test from "node:test";
import assert from "node:assert/strict";

import worker, { SyncRoom } from "../server/worker.js";
import {
	deriveSyncCredentials,
	encryptPayload,
	decryptPayload,
	generateSyncKey,
	MAX_USER_STORAGE_BYTES,
} from "../web/sync-crypto.js";

// Mock-Umgebung für Cloudflare D1 & WebSockets im Node-Test
function createMockEnv() {
	const dbStore = {
		events: [],
		storage: new Map(),
		queries: [],
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
				if (q.includes("INSERT OR IGNORE INTO sync_events") || q.includes("INSERT INTO sync_events")) {
					const [userId, seq, event_id, iv, data, size, created_at] = p;
					dbStore.events.push({ user_id: userId, seq, event_id, id: event_id, iv, data, size, created_at });
				}
				if (q.includes("user_storage")) {
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

	return { env: { DB: mockDb }, ctx, dbStore };
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
	assert.notEqual(allowed.trim(), "*");
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

test("Actor-Start lädt nicht mehr alle Event-IDs eines Kontos in den Arbeitsspeicher", async () => {
	const { env, ctx, dbStore } = createMockEnv();
	const room = new SyncRoom(ctx, env);
	await room.ensureInitialized("1234567890123456");
	assert.equal(dbStore.queries.some((query) => /^SELECT event_id FROM sync_events WHERE user_id = \?$/i.test(query.trim())), false);
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

test("Quota-Enforcement: Pakete über 500 MB werden mit 413 abgewiesen", async () => {
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
	assert.ok(res.error.includes("500 MB"));
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

	const syncKey = "impala-mein-geheimer-sync-schluessel-1234";
	const { userId, authToken } = await deriveSyncCredentials(syncKey);
	const { authToken: wrongToken } = await deriveSyncCredentials("impala-falscher-schluessel-9999");

	// 1. Initialer Request mit echtem Auth-Token -> Erfolgreich
	const validReq = new Request(`https://example.com/api/quota?user=${userId}`, {
		headers: { Authorization: `Bearer ${authToken}` },
	});
	const validRes = await room.fetch(validReq);
	assert.equal(validRes.status, 200);

	// 2. Request mit gefälschtem/falschem Auth-Token -> 403 Forbidden!
	const invalidReq = new Request(`https://example.com/api/quota?user=${userId}`, {
		headers: { Authorization: `Bearer ${wrongToken}` },
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
	const req = new Request(`https://example.com/api/quota?user=${userId}`);

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
	await room.webSocketMessage(mockWs, JSON.stringify({ type: "auth", token: authToken }));
	assert.equal(attachment.authenticated, true);
	assert.equal(mockWs.messages[0].type, "authenticated");

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

test("E2EE Multi-Device Flow: Client A verschlüsselt -> Server speichert -> Client B entschlüsselt", async () => {
	const { env, ctx } = createMockEnv();
	const room = new SyncRoom(ctx, env);

	const syncKey = "impala-mein-geheimer-sync-schluessel-1234";
	const clientA = await deriveSyncCredentials(syncKey);
	const clientB = await deriveSyncCredentials(syncKey);
	const clientWrong = await deriveSyncCredentials("impala-falscher-schluessel-9999");

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
				Authorization: `Bearer ${authToken}`,
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
