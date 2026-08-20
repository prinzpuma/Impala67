import test from "node:test";
import assert from "node:assert/strict";

import { CLOUDFLARE_SYNC, resetSyncCursorStorage, syncCursorStorageKeys } from "../web/sync-cloudflare.js";
import { generateSyncKey, formatStorageUsage, MAX_USER_STORAGE_BYTES, deriveSyncCredentials, decryptPayload, encryptPayload } from "../web/sync-crypto.js";
import { CLOUD_SYNC_PROTOCOL, prepareIncomingCloudEvents, cloudEventsEnvelope } from "../web/sync-core.js";
import { DB } from "../web/db.js";

test("CLOUDFLARE_SYNC hat initialen Status und Methoden", () => {
	const status = CLOUDFLARE_SYNC.status();
	assert.ok(status);
	assert.ok(["disconnected", "connecting", "connected", "syncing", "error"].includes(status.status));
	assert.equal(typeof CLOUDFLARE_SYNC.configure, "function");
	assert.equal(typeof CLOUDFLARE_SYNC.syncNow, "function");
	assert.equal(typeof CLOUDFLARE_SYNC.disconnect, "function");
	assert.equal(typeof CLOUDFLARE_SYNC.purgeCloudData, "function");
});

test("CLOUDFLARE_SYNC generiert sicheren Sync-Schlüssel", () => {
	const key = CLOUDFLARE_SYNC.generateSyncKey();
	assert.match(key, /^impala-(?:[0-9a-f]{4}-){7}[0-9a-f]{4}$/);
});

test("Cloud-Purge setzt genau die benutzerspezifischen Sync-Cursor zurück", () => {
	const values = new Map([
		["impala67_cf_last_seq", "11"],
		["impala67_cf_last_uploaded_local_seq", "12"],
		["impala67_cf_last_seq_user-a", "91"],
		["impala67_cf_last_uploaded_local_seq_user-a", "92"],
		["impala67_cf_last_seq_user-b", "71"],
		["impala67_cf_last_uploaded_local_seq_user-b", "72"],
	]);
	const storage = {
		setItem: (key, value) => values.set(key, value),
	};
	resetSyncCursorStorage(storage, "user-a");
	const keys = syncCursorStorageKeys("user-a");
	assert.equal(values.get(keys.lastSynced), "0");
	assert.equal(values.get(keys.lastUploaded), "0");
	assert.equal(values.get("impala67_cf_last_seq_user-b"), "71");
	assert.equal(values.get("impala67_cf_last_seq"), "11");
	assert.throws(() => syncCursorStorageKeys(), /User-ID/);
});

test("CLOUDFLARE_SYNC Trennen setzt Zustand zurück", () => {
	CLOUDFLARE_SYNC.disconnect();
	const status = CLOUDFLARE_SYNC.status();
	assert.equal(status.status, "disconnected");
});

test("formatStorageUsage schützt vor Überlauf", () => {
	const usage = formatStorageUsage(1_000_000_000, MAX_USER_STORAGE_BYTES);
	assert.equal(usage.percent, 100);
	assert.equal(usage.mbUsed, 1000);

	const overUsage = formatStorageUsage(1_100_000_000, MAX_USER_STORAGE_BYTES);
	assert.equal(overUsage.percent, 100);
	assert.equal(overUsage.mbUsed, 1100);
});

test("Browser- oder Serverfehler werden nicht als erfolgreicher Sync verschluckt", async () => {
	const originalFetch = globalThis.fetch;
	const originalWebSocket = globalThis.WebSocket;
	const originalEventIds = DB.eventIds;
	globalThis.WebSocket = undefined;
	DB.eventIds = async () => [];
	globalThis.fetch = async () => new Response(JSON.stringify({ error: "CORS-Konfiguration fehlt" }), {
		status: 403,
		headers: { "Content-Type": "application/json" },
	});
	try {
		const success = await CLOUDFLARE_SYNC.configure("https://sync.example", generateSyncKey());
		assert.equal(success, false);
		assert.match(CLOUDFLARE_SYNC.status().detail, /CORS-Konfiguration fehlt/);
		await assert.rejects(() => CLOUDFLARE_SYNC.syncNow(), /CORS-Konfiguration fehlt/);
	} finally {
		CLOUDFLARE_SYNC.disconnect();
		globalThis.fetch = originalFetch;
		globalThis.WebSocket = originalWebSocket;
		DB.eventIds = originalEventIds;
	}
});

class MockWebSocket {
	static instances = [];
	constructor(url) {
		this.url = url;
		this.readyState = 1; // OPEN
		this.listeners = {};
		MockWebSocket.instances.push(this);
		this.sent = [];
		queueMicrotask(() => {
			this.emit("open");
		});
	}
	addEventListener(type, cb) {
		this.listeners[type] = this.listeners[type] || [];
		this.listeners[type].push(cb);
	}
	removeEventListener(type, cb) {
		if (this.listeners[type]) {
			this.listeners[type] = this.listeners[type].filter((fn) => fn !== cb);
		}
	}
	send(data) {
		this.sent.push(data);
	}
	close() {
		this.readyState = 3; // CLOSED
		this.emit("close");
	}
	emit(type, event = {}) {
		const list = (this.listeners[type] || []).slice();
		for (const fn of list) fn(event);
	}
	receiveMessage(obj) {
		this.emit("message", { data: JSON.stringify(obj) });
	}
}

test("Regression: configure führt zuerst vollständigen HTTP-Sync durch und baut WebSocket erst danach auf", async () => {
	const originalFetch = globalThis.fetch;
	const originalWebSocket = globalThis.WebSocket;
	const originalEventIds = DB.eventIds;
	const originalAllEvents = DB.allEvents;

	const callLog = [];
	MockWebSocket.instances = [];
	globalThis.WebSocket = MockWebSocket;

	// Simuliere asynchrones DB-Lesen während catchUp
	DB.eventIds = async () => {
		callLog.push({ step: "db_eventIds_start" });
		await new Promise((r) => setTimeout(r, 10));
		callLog.push({ step: "db_eventIds_end" });
		return [];
	};
	DB.allEvents = async () => [];

	globalThis.fetch = async (url, init = {}) => {
		callLog.push({
			step: "http_fetch",
			url: String(url),
			headers: { ...init.headers },
			wsCreatedSoFar: MockWebSocket.instances.length,
		});
		return new Response(JSON.stringify({ events: [], maxSeq: 0, hasMore: false }), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
	};

	try {
		const key = generateSyncKey();
		const success = await CLOUDFLARE_SYNC.configure("https://sync.example.com", key);
		assert.equal(success, true);

		// 1. Initialer HTTP-Sync muss VOR WebSocket-Instanziierung stattfinden
		const fetchCall = callLog.find((c) => c.step === "http_fetch");
		assert.ok(fetchCall, "HTTP-Sync-Aufruf muss stattgefunden haben");
		assert.equal(fetchCall.wsCreatedSoFar, 0, "WebSocket darf während des initialen HTTP-Syncs noch NICHT aufgebaut sein");

		// 2. HTTP-Sync erhält immer userId + Auth-Header + Protocol v3
		assert.match(fetchCall.url, /\/api\/sync\?since=0&limit=100&user=[a-f0-9]{16,}/);
		assert.ok(fetchCall.headers["X-User-Id"], "X-User-Id muss vorhanden sein");
		assert.ok(fetchCall.headers["X-User-Id"].length >= 16, "X-User-Id muss mindestens 16 Zeichen lang sein");
		assert.match(fetchCall.headers["Authorization"], /^Bearer [a-f0-9]{16,}$/);
		assert.equal(fetchCall.headers["X-Impala-Sync-Protocol"], "3", "Protokoll v3 muss mitgesendet werden");

		// 3. WebSocket wird erst nach erfolgreichem HTTP-Sync aufgebaut
		assert.equal(MockWebSocket.instances.length, 1);
		assert.match(MockWebSocket.instances[0].url, /^wss:\/\/sync\.example\.com\/ws\?user=[a-f0-9]{16,}$/);
	} finally {
		CLOUDFLARE_SYNC.disconnect();
		globalThis.fetch = originalFetch;
		globalThis.WebSocket = originalWebSocket;
		DB.eventIds = originalEventIds;
		DB.allEvents = originalAllEvents;
	}
});

test("Regression: bei HTTP-Sync-Fehler (z. B. Auth/Protokoll) wird WebSocket gar nicht aufgebaut und Fehler bleibt aussagekräftig", async () => {
	const originalFetch = globalThis.fetch;
	const originalWebSocket = globalThis.WebSocket;
	const originalEventIds = DB.eventIds;

	MockWebSocket.instances = [];
	globalThis.WebSocket = MockWebSocket;
	DB.eventIds = async () => [];

	globalThis.fetch = async () => new Response(JSON.stringify({ error: "Sync-Schlüssel stimmt nicht mit dem Server überein." }), {
		status: 403,
		headers: { "Content-Type": "application/json" },
	});

	try {
		const success = await CLOUDFLARE_SYNC.configure("https://sync.example.com", generateSyncKey());
		assert.equal(success, false);
		assert.equal(MockWebSocket.instances.length, 0, "Bei fehlgeschlagenem HTTP-Catch-up darf kein WebSocket verbunden werden");
		assert.equal(CLOUDFLARE_SYNC.status().status, "error");
		assert.match(CLOUDFLARE_SYNC.status().detail, /Sync-Schlüssel stimmt nicht mit dem Server überein/);
		assert.doesNotMatch(CLOUDFLARE_SYNC.status().detail, /Fehlende oder ungültige User-ID/);
	} finally {
		CLOUDFLARE_SYNC.disconnect();
		globalThis.fetch = originalFetch;
		globalThis.WebSocket = originalWebSocket;
		DB.eventIds = originalEventIds;
	}
});

test("Regression: WebSocket-Fehler entzieht nicht global die Credentials und erzeugt keinen sekundären 'Fehlende User-ID'-Fehler", async () => {
	const originalFetch = globalThis.fetch;
	const originalWebSocket = globalThis.WebSocket;
	const originalEventIds = DB.eventIds;
	const originalAllEvents = DB.allEvents;

	MockWebSocket.instances = [];
	globalThis.WebSocket = MockWebSocket;
	DB.eventIds = async () => [];
	DB.allEvents = async () => [];

	globalThis.fetch = async () => new Response(JSON.stringify({ events: [], maxSeq: 0, hasMore: false }), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});

	try {
		const success = await CLOUDFLARE_SYNC.configure("https://sync.example.com", generateSyncKey());
		assert.equal(success, true);
		assert.equal(MockWebSocket.instances.length, 1);

		const ws = MockWebSocket.instances[0];

		// WebSocket empfängt unauthorized-Nachricht
		ws.receiveMessage({ type: "unauthorized", error: "Sync-Schlüssel stimmt nicht mit dem Server überein." });

		assert.equal(CLOUDFLARE_SYNC.status().status, "error");
		assert.equal(CLOUDFLARE_SYNC.status().label, "Nicht autorisiert");
		assert.match(CLOUDFLARE_SYNC.status().detail, /Sync-Schlüssel stimmt nicht/);
		assert.equal(ws.readyState, 3, "Socket muss geschlossen worden sein");

		// Credentials sind weiterhin lokal vorhanden und werden bei erneutem Syncversuch verwendet
		let capturedSyncRequest = null;
		globalThis.fetch = async (url, init = {}) => {
			capturedSyncRequest = { url: String(url), headers: { ...init.headers } };
			return new Response(JSON.stringify({ error: "Sync-Schlüssel stimmt nicht mit dem Server überein." }), {
				status: 403,
				headers: { "Content-Type": "application/json" },
			});
		};

		await assert.rejects(() => CLOUDFLARE_SYNC.syncNow(), /Sync-Schlüssel stimmt nicht/);

		// Sicherstellen, dass die User-ID und Auth-Header weiterhin korrekt gesendet wurden und KEIN "Fehlende User-ID"-Fehler erzeugt wird
		assert.ok(capturedSyncRequest);
		assert.match(capturedSyncRequest.url, /user=[a-f0-9]{16,}/);
		assert.ok(capturedSyncRequest.headers["X-User-Id"]);
		assert.ok(capturedSyncRequest.headers["Authorization"]);
		assert.equal(capturedSyncRequest.headers["X-Impala-Sync-Protocol"], "3");
		assert.doesNotMatch(CLOUDFLARE_SYNC.status().detail, /Fehlende oder ungültige User-ID/);
	} finally {
		CLOUDFLARE_SYNC.disconnect();
		globalThis.fetch = originalFetch;
		globalThis.WebSocket = originalWebSocket;
		DB.eventIds = originalEventIds;
		DB.allEvents = originalAllEvents;
	}
});

test("Regression: Neues Gerät mit bestehendem Serverstand und Drive-Historie führt kompakten Initial-Push durch und erhält lokale Extra-Notiz", async () => {
	const originalFetch = globalThis.fetch;
	const originalWebSocket = globalThis.WebSocket;
	const originalEventIds = DB.eventIds;
	const originalAllEvents = DB.allEvents;
	const originalAddEvents = DB.addEvents;

	MockWebSocket.instances = [];
	globalThis.WebSocket = MockWebSocket;

	const key = generateSyncKey();
	const creds = await deriveSyncCredentials(key);

	// 1. Server hat bereits einen Stand (Seq 1)
	const serverEvent = { id: "server-note-1", t: "2026-08-20T10:00:00Z", type: "pageCreate", payload: { id: "p-server", title: "Server Note" } };
	const encServer = await encryptPayload(creds.cryptoKey, cloudEventsEnvelope([serverEvent]));
	const serverBatchPacket = { seq: 1, id: "batch-server-1", iv: encServer.iv, data: encServer.data, size: encServer.size, created_at: new Date().toISOString() };

	// 2. Lokale DB des Handys: 200 Drive-Events + 1 lokale Extra-Notiz
	const localEvents = [];
	for (let i = 1; i <= 200; i++) {
		localEvents.push({
			seq: i,
			id: `drive-event-${i}`,
			t: `2026-08-19T10:00:${String(i % 60).padStart(2, "0")}Z`,
			type: "pageCreate",
			payload: { id: `p-drive-${i}`, title: `Drive Notiz ${i}` },
			_remoteSource: "drive",
		});
	}
	const localUniqueNote = {
		seq: 201,
		id: "local-unique-note-1",
		t: "2026-08-20T18:00:00Z",
		type: "pageCreate",
		payload: { id: "p-local-unique", title: "Nur auf Handy erstellt" },
	};
	localEvents.push(localUniqueNote);

	DB.eventIds = async () => localEvents.map((e) => e.id);
	DB.allEvents = async () => [...localEvents];
	DB.addEvents = async () => {};

	const postedBatches = [];
	globalThis.fetch = async (url, init = {}) => {
		const urlStr = String(url);
		if (urlStr.includes("/api/sync")) {
			return new Response(JSON.stringify({ events: [serverBatchPacket], maxSeq: 1, hasMore: false }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		}
		if (urlStr.includes("/api/events") && init.method === "POST") {
			const body = JSON.parse(init.body || "{}");
			postedBatches.push(body);
			return new Response(JSON.stringify({ ok: true, savedCount: (body.events || []).length, maxSeq: 2, usage: 5000 }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		}
		return new Response(JSON.stringify({ ok: true }), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
	};

	try {
		const success = await CLOUDFLARE_SYNC.configure("https://sync.example.com", key);
		assert.equal(success, true);

		// Prüfen, dass der Upload stattfand
		assert.equal(postedBatches.length, 1, "Muss genau 1 gebündelten Initial-Push-Request senden statt Hunderte Einzel-Requests");
		const uploadedEvents = postedBatches[0].events || [];

		// Prüfen, dass der Upload gebündelte batch-IDs verwendet und KEINE 201 Einzeldateien
		assert.ok(uploadedEvents.length <= 2, "Kompaktierte Events müssen in wenigen Batches gebündelt sein");
		for (const packet of uploadedEvents) {
			assert.match(packet.id, /^batch-/, "Muss batch-ID für gebündelten Initial-Push verwenden");
		}

		// Prüfen, dass die lokale Extra-Notiz im gebündelten Chiffrat enthalten ist
		let foundUniqueNote = false;
		for (const packet of uploadedEvents) {
			const decryptedEnvelope = await decryptPayload(creds.cryptoKey, packet);
			const unpacked = prepareIncomingCloudEvents([decryptedEnvelope]);
			if (unpacked.some((e) => e.id === "local-unique-note-1")) {
				foundUniqueNote = true;
			}
		}
		assert.equal(foundUniqueNote, true, "Lokale Extra-Notiz muss im gebündelten Initial-Push enthalten sein");

		// Upload-Cursor muss auf localMaxSeq (201) gesetzt sein
		assert.equal(CLOUDFLARE_SYNC.status().lastUploadedLocalSeq, 201);
		assert.equal(CLOUDFLARE_SYNC.status().lastSyncedSeq, 2);
	} finally {
		CLOUDFLARE_SYNC.disconnect();
		globalThis.fetch = originalFetch;
		globalThis.WebSocket = originalWebSocket;
		DB.eventIds = originalEventIds;
		DB.allEvents = originalAllEvents;
		DB.addEvents = originalAddEvents;
	}
});

test("Regression: DB.compactLocal setzt Cloudflare-Upload-Cursor auf 0 zurück und signalisiert Event", async () => {
	const originalStorage = globalThis.localStorage;
	const originalIndexedDB = globalThis.indexedDB;
	const originalAllEvents = DB.allEvents;

	const map = new Map();
	globalThis.localStorage = {
		getItem: (k) => (map.has(k) ? map.get(k) : null),
		setItem: (k, v) => map.set(String(k), String(v)),
		removeItem: (k) => map.delete(k),
		clear: () => map.clear(),
		key: (i) => Array.from(map.keys())[i] || null,
		get length() { return map.size; },
	};

	globalThis.indexedDB = {
		open: () => {
			const req = { onsuccess: null, onerror: null };
			setTimeout(() => {
				req.result = {
					objectStoreNames: { contains: () => true },
					createObjectStore: () => ({ createIndex: () => {} }),
					transaction: () => {
						const tx = {
							oncomplete: null,
							objectStore: () => ({
								count: () => {
									const r = { onsuccess: null, onerror: null, result: 1 };
									setTimeout(() => r.onsuccess?.(), 0);
									return r;
								},
								getAll: () => {
									const r = { onsuccess: null, onerror: null, result: events };
									setTimeout(() => r.onsuccess?.(), 0);
									return r;
								},
								clear: () => {},
								add: () => {},
							}),
						};
						setTimeout(() => tx.oncomplete?.(), 0);
						return tx;
					},
					close: () => {},
				};
				req.onsuccess?.();
			}, 0);
			return req;
		},
	};

	const userStorageKey = "impala67_cf_last_uploaded_local_seq_user-test123";
	const globalStorageKey = "impala67_cf_last_uploaded_local_seq";
	globalThis.localStorage.setItem(userStorageKey, "12000");
	globalThis.localStorage.setItem(globalStorageKey, "12000");

	// Events für DB.compactLocal bereitstellen
	const events = [];
	for (let i = 1; i <= 300; i++) {
		events.push({
			id: `ev-${i}`,
			t: `2026-08-20T10:00:${String(i % 60).padStart(2, "0")}Z`,
			type: "pageUpdate",
			payload: { id: "p1", patch: { content: `Stand ${i}` } },
		});
	}
	DB.allEvents = async () => [...events];

	try {
		await DB.open();
		const dropped = await DB.compactLocal(10);
		assert.ok(dropped > 0, "Muss Events verdichtet haben");
		assert.equal(globalThis.localStorage.getItem(userStorageKey), "0", "Benutzerspezifischer Upload-Cursor muss auf 0 gesetzt sein");
		assert.equal(globalThis.localStorage.getItem(globalStorageKey), "0", "Globaler Upload-Cursor muss auf 0 gesetzt sein");
	} finally {
		DB.allEvents = originalAllEvents;
		globalThis.localStorage = originalStorage;
		globalThis.indexedDB = originalIndexedDB;
	}
});

test("Regression: WebSocket-Entschlüsselungsfehler setzt Status auf error und lässt lastSyncedSeq unverändert", async () => {
	const originalFetch = globalThis.fetch;
	const originalWebSocket = globalThis.WebSocket;
	const originalEventIds = DB.eventIds;
	const originalAllEvents = DB.allEvents;

	MockWebSocket.instances = [];
	globalThis.WebSocket = MockWebSocket;
	DB.eventIds = async () => [];
	DB.allEvents = async () => [];

	const key = generateSyncKey();
	const creds = await deriveSyncCredentials(key);
	const validEv = { id: "valid-10", t: "2026-08-20T10:00:00Z", type: "pageCreate", payload: { id: "p1" } };
	const encValid = await encryptPayload(creds.cryptoKey, cloudEventsEnvelope([validEv]));
	const validPacket = { seq: 10, id: "batch-10", iv: encValid.iv, data: encValid.data, size: encValid.size };

	globalThis.fetch = async (url, init = {}) => {
		const urlStr = String(url);
		if (urlStr.includes("/api/sync")) {
			return new Response(JSON.stringify({ events: [validPacket], maxSeq: 10, hasMore: false }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		}
		if (urlStr.includes("/api/events") && init.method === "POST") {
			return new Response(JSON.stringify({ ok: true, maxSeq: 10, savedCount: 1 }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		}
		return new Response(JSON.stringify({ ok: true }), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
	};

	try {
		const success = await CLOUDFLARE_SYNC.configure("https://sync.example.com", key);
		assert.equal(success, true);
		assert.equal(MockWebSocket.instances.length, 1);
		const ws = MockWebSocket.instances[0];

		// Authentifizieren
		ws.receiveMessage({ type: "authenticated", protocol: CLOUD_SYNC_PROTOCOL });
		await new Promise((r) => setTimeout(r, 60)); // Warten bis initialer CatchUp nach Auth abgeschlossen ist
		assert.equal(CLOUDFLARE_SYNC.status().lastSyncedSeq, 10);

		// Fehlerhaftes/nicht entschlüsselbares Event empfangen (z. B. ungültiges Chiffrat)
		ws.receiveMessage({
			type: "event",
			event: {
				seq: 11,
				id: "broken-event",
				iv: "000000000000000000000000",
				data: "AAAA", // Ungültiges Chiffrat
			},
		});

		// Event-Verarbeitung abwarten
		await new Promise((r) => setTimeout(r, 80));

		// Status muss error sein und lastSyncedSeq darf NICHT auf 11 gesprungen sein
		assert.equal(CLOUDFLARE_SYNC.status().status, "error");
		assert.equal(CLOUDFLARE_SYNC.status().lastSyncedSeq, 10, "lastSyncedSeq darf nach Entschlüsselungsfehler nicht vorgeschoben werden");
	} finally {
		CLOUDFLARE_SYNC.disconnect();
		globalThis.fetch = originalFetch;
		globalThis.WebSocket = originalWebSocket;
		DB.eventIds = originalEventIds;
		DB.allEvents = originalAllEvents;
	}
});

test("Regression: WebSocket-ACK mit Sequenzlücke stößt catchUp an", async () => {
	const originalFetch = globalThis.fetch;
	const originalWebSocket = globalThis.WebSocket;
	const originalEventIds = DB.eventIds;
	const originalAllEvents = DB.allEvents;

	MockWebSocket.instances = [];
	globalThis.WebSocket = MockWebSocket;
	DB.eventIds = async () => [];
	DB.allEvents = async () => [];

	let catchUpCalls = 0;
	globalThis.fetch = async (url) => {
		const urlStr = String(url);
		if (urlStr.includes("/api/sync")) {
			catchUpCalls++;
			return new Response(JSON.stringify({ events: [], maxSeq: 15, hasMore: false }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		}
		return new Response(JSON.stringify({ ok: true }), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
	};

	try {
		const success = await CLOUDFLARE_SYNC.configure("https://sync.example.com", generateSyncKey());
		assert.equal(success, true);
		assert.equal(MockWebSocket.instances.length, 1);
		const ws = MockWebSocket.instances[0];

		// Bei Authentifizierung wird initialer Catchup ausgeführt
		ws.receiveMessage({ type: "authenticated", protocol: CLOUD_SYNC_PROTOCOL });
		await new Promise((r) => setTimeout(r, 50));
		const catchUpsAfterAuth = catchUpCalls;

		// ACK empfangen mit seq = 15 (bei aktuellem lastSyncedSeq = 0) -> Sequenzlücke
		ws.receiveMessage({
			type: "ack",
			eventId: "some-event",
			seq: 15,
		});

		await new Promise((r) => setTimeout(r, 60));
		assert.ok(catchUpCalls > catchUpsAfterAuth, "Muss catchUp() aufrufen, wenn ACK eine Sequenzlücke aufweist");
	} finally {
		CLOUDFLARE_SYNC.disconnect();
		globalThis.fetch = originalFetch;
		globalThis.WebSocket = originalWebSocket;
		DB.eventIds = originalEventIds;
		DB.allEvents = originalAllEvents;
	}
});
