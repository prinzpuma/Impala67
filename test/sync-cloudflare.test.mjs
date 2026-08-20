import test from "node:test";
import assert from "node:assert/strict";

const storageMap = new Map();
globalThis.localStorage = {
	getItem: (k) => (storageMap.has(k) ? storageMap.get(k) : null),
	setItem: (k, v) => { storageMap.set(k, String(v)); },
	removeItem: (k) => { storageMap.delete(k); },
	clear: () => { storageMap.clear(); },
};

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
		["impala67_cf_generation_user-a", "1"],
		["impala67_cf_last_seq_user-b", "71"],
		["impala67_cf_last_uploaded_local_seq_user-b", "72"],
	]);
	const storage = {
		setItem: (key, value) => values.set(key, value),
	};
	resetSyncCursorStorage(storage, "user-a", 2);
	const keys = syncCursorStorageKeys("user-a");
	assert.equal(values.get(keys.lastSynced), "0");
	assert.equal(values.get(keys.lastUploaded), "0");
	assert.equal(values.get(keys.generation), "2");
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
	const originalAllBlobKeys = DB.allBlobKeys;
	const originalAllEvents = DB.allEvents;

	globalThis.WebSocket = undefined;
	DB.allBlobKeys = async () => [];
	DB.allEvents = async () => [];
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
		DB.allBlobKeys = originalAllBlobKeys;
		DB.allEvents = originalAllEvents;
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
	const originalAllBlobKeys = DB.allBlobKeys;
	const originalAllEvents = DB.allEvents;

	const callLog = [];
	MockWebSocket.instances = [];
	globalThis.WebSocket = MockWebSocket;

	DB.allBlobKeys = async () => [];
	DB.allEvents = async () => [];

	globalThis.fetch = async (url, init = {}) => {
		callLog.push({
			step: "http_fetch",
			url: String(url),
			headers: { ...init.headers },
			wsCreatedSoFar: MockWebSocket.instances.length,
		});
		return new Response(JSON.stringify({ events: [], maxSeq: 0, hasMore: false, generation: 1 }), {
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

		// 2. HTTP-Sync erhält immer userId + Auth-Header + Protocol v4
		assert.match(fetchCall.url, /\/api\/sync\?since=0&limit=100&user=[a-f0-9]{16,}/);
		assert.ok(fetchCall.headers["X-User-Id"], "X-User-Id muss vorhanden sein");
		assert.ok(fetchCall.headers["X-User-Id"].length >= 16, "X-User-Id muss mindestens 16 Zeichen lang sein");
		assert.match(fetchCall.headers["Authorization"], /^Bearer [a-f0-9]{16,}$/);
		assert.equal(fetchCall.headers["X-Impala-Sync-Protocol"], "4", "Protokoll v4 muss mitgesendet werden");

		// 3. WebSocket wird erst nach erfolgreichem HTTP-Sync aufgebaut
		assert.equal(MockWebSocket.instances.length, 1);
		assert.match(MockWebSocket.instances[0].url, /^wss:\/\/sync\.example\.com\/ws\?user=[a-f0-9]{16,}$/);
	} finally {
		CLOUDFLARE_SYNC.disconnect();
		globalThis.fetch = originalFetch;
		globalThis.WebSocket = originalWebSocket;
		DB.allBlobKeys = originalAllBlobKeys;
		DB.allEvents = originalAllEvents;
	}
});

test("Regression: bei HTTP-Sync-Fehler (z. B. Auth/Protokoll) wird WebSocket gar nicht aufgebaut und Fehler bleibt aussagekräftig", async () => {
	const originalFetch = globalThis.fetch;
	const originalWebSocket = globalThis.WebSocket;
	const originalAllBlobKeys = DB.allBlobKeys;
	const originalAllEvents = DB.allEvents;

	MockWebSocket.instances = [];
	globalThis.WebSocket = MockWebSocket;
	DB.allBlobKeys = async () => [];
	DB.allEvents = async () => [];

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
		DB.allBlobKeys = originalAllBlobKeys;
		DB.allEvents = originalAllEvents;
	}
});

test("Regression: WebSocket-Fehler entzieht nicht global die Credentials und erzeugt keinen sekundären 'Fehlende User-ID'-Fehler", async () => {
	const originalFetch = globalThis.fetch;
	const originalWebSocket = globalThis.WebSocket;
	const originalAllBlobKeys = DB.allBlobKeys;
	const originalAllEvents = DB.allEvents;

	MockWebSocket.instances = [];
	globalThis.WebSocket = MockWebSocket;
	DB.allBlobKeys = async () => [];
	DB.allEvents = async () => [];

	globalThis.fetch = async () => new Response(JSON.stringify({ events: [], maxSeq: 0, hasMore: false, generation: 1 }), {
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
		assert.equal(capturedSyncRequest.headers["X-Impala-Sync-Protocol"], "4");
		assert.doesNotMatch(CLOUDFLARE_SYNC.status().detail, /Fehlende oder ungültige User-ID/);
	} finally {
		CLOUDFLARE_SYNC.disconnect();
		globalThis.fetch = originalFetch;
		globalThis.WebSocket = originalWebSocket;
		DB.allBlobKeys = originalAllBlobKeys;
		DB.allEvents = originalAllEvents;
	}
});

test("Regression: Neues Gerät mit bestehendem Serverstand und Drive-Historie führt kompakten Initial-Push durch und erhält lokale Extra-Notiz", async () => {
	const originalFetch = globalThis.fetch;
	const originalWebSocket = globalThis.WebSocket;
	const originalAllBlobKeys = DB.allBlobKeys;
	const originalAllEvents = DB.allEvents;
	const originalAddEvents = DB.addEvents;

	MockWebSocket.instances = [];
	globalThis.WebSocket = MockWebSocket;

	const key = generateSyncKey();
	const creds = await deriveSyncCredentials(key);

	// 1. Server hat bereits einen Stand (Seq 1)
	const serverEvent = { id: "server-note-1", t: "2026-08-20T10:00:00Z", type: "pageCreate", payload: { id: "p-server", title: "Server Note" } };
	const encServer = await encryptPayload(creds.cryptoKey, cloudEventsEnvelope([serverEvent]));
	const serverBatchPacket = { seq: 1, id: "p-server-1", iv: encServer.iv, data: encServer.data, size: encServer.size, created_at: new Date().toISOString() };

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

	const originalImportAll = DB.importAll;
	DB.allBlobKeys = async () => [];
	DB.allEvents = async () => [...localEvents];
	DB.addEvents = async () => {};
	DB.importAll = async () => ({ importedEvents: [] });

	const postedBatches = [];
	globalThis.fetch = async (url, init = {}) => {
		const urlStr = String(url);
		if (urlStr.includes("/api/sync")) {
			const since = Number(new URL(urlStr).searchParams.get("since")) || 0;
			const events = since >= 1 ? [] : [serverBatchPacket];
			return new Response(JSON.stringify({ events, maxSeq: 1, hasMore: false, generation: 1 }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		}
		if (urlStr.includes("/api/events") && init.method === "POST") {
			const body = JSON.parse(init.body || "{}");
			postedBatches.push(body);
			return new Response(JSON.stringify({ ok: true, savedCount: (body.events || []).length, maxSeq: 2, usage: 5000, generation: 1 }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		}
		return new Response(JSON.stringify({ ok: true, keys: [], cursor: "" }), {
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

		// Prüfen, dass der Upload deterministische Paket-IDs verwendet
		assert.ok(uploadedEvents.length <= 2, "Kompaktierte Events müssen in wenigen Batches gebündelt sein");
		for (const packet of uploadedEvents) {
			assert.match(packet.id, /^p-/, "Muss p-ID für v4-Push verwenden");
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
		// lastSyncedSeq darf nur Server-Sequenzen widerspiegeln (1 vom Server)
		assert.equal(CLOUDFLARE_SYNC.status().lastSyncedSeq, 1);
	} finally {
		CLOUDFLARE_SYNC.disconnect();
		globalThis.fetch = originalFetch;
		globalThis.WebSocket = originalWebSocket;
		DB.allBlobKeys = originalAllBlobKeys;
		DB.allEvents = originalAllEvents;
		DB.addEvents = originalAddEvents;
		DB.importAll = originalImportAll;
	}
});

test("Regression: DB.compactEvents ist drop-only und verändert keine Sequenznummern", () => {
	// Erstelle 250 redundante Events
	const events = [];
	for (let i = 1; i <= 250; i++) {
		events.push({
			seq: i,
			id: `redundant-${i}`,
			t: `2026-08-20T12:00:${String(i % 60).padStart(2, "0")}.${String(i).padStart(3, "0")}Z`,
			type: "pageUpdate",
			payload: { id: "p1", patch: { title: `Titel ${i}` } },
		});
	}

	const compacted = DB.compactEvents(events);
	assert.ok(compacted.length < 20, "Muss überflüssige Titel-Updates verdichten");
	// Sequenzen der verbleibenden Events müssen exakt ihren ursprünglichen seq entsprechen
	for (const ev of compacted) {
		const original = events.find((e) => e.id === ev.id);
		assert.equal(ev.seq, original.seq, "Sequenznummern dürfen sich nicht ändern");
	}
});

test("Regression: WebSocket changed-Signal stößt erneuten Pull an", async () => {
	const originalFetch = globalThis.fetch;
	const originalWebSocket = globalThis.WebSocket;
	const originalAllBlobKeys = DB.allBlobKeys;
	const originalAllEvents = DB.allEvents;

	MockWebSocket.instances = [];
	globalThis.WebSocket = MockWebSocket;
	DB.allBlobKeys = async () => [];
	DB.allEvents = async () => [];

	let pullCount = 0;
	globalThis.fetch = async (url) => {
		const urlStr = String(url);
		if (urlStr.includes("/api/sync")) {
			pullCount++;
			return new Response(JSON.stringify({ events: [], maxSeq: 0, hasMore: false, generation: 1 }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		}
		return new Response(JSON.stringify({ keys: [], cursor: "" }), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
	};

	try {
		const success = await CLOUDFLARE_SYNC.configure("https://sync.example.com", generateSyncKey());
		assert.equal(success, true);
		const initialPulls = pullCount;
		assert.ok(initialPulls >= 1);

		const ws = MockWebSocket.instances[0];
		ws.receiveMessage({ type: "changed", maxSeq: 10 });
		await new Promise((r) => setTimeout(r, 50));
		assert.ok(pullCount > initialPulls, "WebSocket 'changed' muss weiteren Pull ausgelöst haben");
	} finally {
		CLOUDFLARE_SYNC.disconnect();
		globalThis.fetch = originalFetch;
		globalThis.WebSocket = originalWebSocket;
		DB.allBlobKeys = originalAllBlobKeys;
		DB.allEvents = originalAllEvents;
	}
});

test("Regression (echter CLOUDFLARE_SYNC): Cursor-Race — Server seq 10 bekannt, B erzeugt seq 11, A sendet seq 12; nach POST ist lastSyncedSeq 10, nach Pull 12", async () => {
	const originalFetch = globalThis.fetch;
	const originalWebSocket = globalThis.WebSocket;
	const originalAllBlobKeys = DB.allBlobKeys;
	const originalAllEvents = DB.allEvents;
	const originalAddEvents = DB.addEvents;
	const originalImportAll = DB.importAll;

	MockWebSocket.instances = [];
	globalThis.WebSocket = MockWebSocket;

	const key = generateSyncKey();
	const creds = await deriveSyncCredentials(key);

	// Serverzustand:
	// Event 11 von Gerät B
	const eventB = { id: "p-from-B-11", t: "2026-08-20T02:00:00Z", type: "pageCreate", payload: { id: "pb", title: "Note from B" } };
	const encB = await encryptPayload(creds.cryptoKey, cloudEventsEnvelope([eventB]));
	const packetB = { seq: 11, id: "p-b-11", iv: encB.iv, data: encB.data, size: encB.size, created_at: new Date().toISOString() };

	// Lokaler Zustand von Gerät A:
	// A kennt 10 Events (seq 1..10) und hat 1 neues lokales Event (seq 11 lokal)
	const localEventsA = [];
	for (let i = 1; i <= 10; i++) {
		localEventsA.push({ seq: i, id: `local-init-${i}`, t: `2026-08-20T01:00:${String(i).padStart(2, "0")}Z`, type: "pageCreate", payload: { id: `p-init-${i}`, title: `Init ${i}` } });
	}
	const newLocalEventA = { seq: 11, id: "p-from-A-12", t: "2026-08-20T02:01:00Z", type: "pageCreate", payload: { id: "pa", title: "Note from A" } };
	localEventsA.push(newLocalEventA);

	DB.allBlobKeys = async () => [];
	DB.allEvents = async () => [...localEventsA];
	DB.addEvents = async () => {};
	const importedIntoA = [];
	DB.importAll = async (json) => {
		const parsed = JSON.parse(json);
		importedIntoA.push(...(parsed.events || []));
		return { importedEvents: parsed.events || [] };
	};

	let serverSeqCounter = 10;
	const serverPackets = [];

	// Storage von A: kennt bisher Server seq 10 und hat lokale seq 10 hochgeladen
	const keys = syncCursorStorageKeys(creds.userId);
	localStorage.setItem(keys.lastSynced, "10");
	localStorage.setItem(keys.lastUploaded, "10");
	localStorage.setItem(keys.generation, "1");

	let postDone = false;
	let seqAfterPost = null;

	globalThis.fetch = async (url, init = {}) => {
		const urlStr = String(url);
		if (urlStr.includes("/api/sync")) {
			const since = Number(new URL(urlStr).searchParams.get("since")) || 0;
			const returnPackets = serverPackets.filter((p) => p.seq > since);
			return new Response(JSON.stringify({ events: returnPackets, maxSeq: serverSeqCounter, hasMore: false, generation: 1 }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		}
		if (urlStr.includes("/api/events") && init.method === "POST") {
			// Vor/während A's Upload erzeugt B seq 11 auf dem Server
			if (!serverPackets.some((p) => p.id === "p-b-11")) {
				serverPackets.push(packetB); // seq 11
				serverSeqCounter = 11;
			}
			const body = JSON.parse(init.body || "{}");
			for (const p of body.events || []) {
				serverPackets.push({ ...p, seq: ++serverSeqCounter }); // seq 12
			}
			postDone = true;
			// Prüfe den Cursor direkt nach dem POST: A hat bisher nur bis seq 10 synchronisiert
			seqAfterPost = CLOUDFLARE_SYNC.status().lastSyncedSeq;
			return new Response(JSON.stringify({ ok: true, savedCount: (body.events || []).length, maxSeq: serverSeqCounter, usage: 1000, generation: 1 }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		}
		return new Response(JSON.stringify({ ok: true, keys: [], cursor: "" }), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
	};

	try {
		const success = await CLOUDFLARE_SYNC.configure("https://sync.example.com", key);
		assert.equal(success, true);
		assert.equal(postDone, true, "POST muss ausgeführt worden sein");
		assert.equal(seqAfterPost, 10, "Nach dem POST muss lastSyncedSeq noch 10 sein");
		assert.equal(CLOUDFLARE_SYNC.status().lastSyncedSeq, 12, "Nach dem abschließenden Pull muss lastSyncedSeq 12 sein");
		assert.ok(importedIntoA.some((e) => e.id === "p-from-B-11"), "Event B (seq 11) muss importiert sein");
		assert.ok(importedIntoA.some((e) => e.id === "p-from-A-12"), "Event A (seq 12) muss importiert sein");
	} finally {
		CLOUDFLARE_SYNC.disconnect();
		globalThis.fetch = originalFetch;
		globalThis.WebSocket = originalWebSocket;
		DB.allBlobKeys = originalAllBlobKeys;
		DB.allEvents = originalAllEvents;
		DB.addEvents = originalAddEvents;
		DB.importAll = originalImportAll;
	}
});

test("Regression (echter CLOUDFLARE_SYNC): Retry nach verlorenem HTTP-Response verhindert Duplikate und Quota-Verschwendung (P1)", async () => {
	const originalFetch = globalThis.fetch;
	const originalWebSocket = globalThis.WebSocket;
	const originalAllBlobKeys = DB.allBlobKeys;
	const originalAllEvents = DB.allEvents;
	const originalAddEvents = DB.addEvents;
	const originalImportAll = DB.importAll;

	MockWebSocket.instances = [];
	globalThis.WebSocket = MockWebSocket;

	const key = generateSyncKey();
	const creds = await deriveSyncCredentials(key);

	// Client hat zunächst zwei lokale Events E1, E2
	const localEvents = [
		{ seq: 1, id: "local-e1", t: "2026-08-20T10:00:00Z", type: "pageCreate", payload: { id: "p1", title: "Note 1" } },
		{ seq: 2, id: "local-e2", t: "2026-08-20T10:01:00Z", type: "pageUpdate", payload: { id: "p1", patch: { title: "Note 1 - Rev 2" } } },
	];

	DB.allBlobKeys = async () => [];
	DB.allEvents = async () => [...localEvents];
	DB.addEvents = async () => {};
	DB.importAll = async (json) => {
		const parsed = JSON.parse(json);
		return { importedEvents: parsed.events || [] };
	};

	let serverPackets = [];
	let serverSeqCounter = 0;
	let serverTotalBytes = 0;
	let shouldFailPostResponse = true;

	globalThis.fetch = async (url, init = {}) => {
		const urlStr = String(url);
		if (urlStr.includes("/api/sync")) {
			const since = Number(new URL(urlStr).searchParams.get("since")) || 0;
			const returnPackets = serverPackets.filter((p) => p.seq > since);
			return new Response(JSON.stringify({ events: returnPackets, maxSeq: serverSeqCounter, hasMore: false, generation: 1 }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		}
		if (urlStr.includes("/api/events") && init.method === "POST") {
			const body = JSON.parse(init.body || "{}");
			for (const p of body.events || []) {
				// Prüfe auf Duplikate
				if (!serverPackets.some((sp) => sp.id === p.id)) {
					const size = (p.data || "").length;
					serverPackets.push({ ...p, seq: ++serverSeqCounter, size });
					serverTotalBytes += size;
				}
			}
			if (shouldFailPostResponse) {
				shouldFailPostResponse = false;
				// Antwort geht verloren (Netzwerkabbruch)
				throw new TypeError("Failed to fetch (Netzwerkabbruch nach Speicherung)");
			}
			return new Response(JSON.stringify({ ok: true, savedCount: (body.events || []).length, maxSeq: serverSeqCounter, usage: serverTotalBytes, generation: 1 }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		}
		return new Response(JSON.stringify({ ok: true, keys: [], cursor: "" }), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
	};

	try {
		// 1. Erster Sync-Versuch: schlägt fehl, da HTTP-Antwort verloren geht
		const firstTry = await CLOUDFLARE_SYNC.configure("https://sync.example.com", key);
		assert.equal(firstTry, false);
		assert.equal(serverPackets.length, 1, "Server hat Paket 1 bereits gespeichert");
		const bytesAfterFirstPush = serverTotalBytes;

		// 2. Client erhält vor Retry ein neues lokales Event E3
		const eventE3 = { seq: 3, id: "local-e3", t: "2026-08-20T10:02:00Z", type: "pageCreate", payload: { id: "p2", title: "Note 2" } };
		localEvents.push(eventE3);

		// 3. Retry
		const retrySuccess = await CLOUDFLARE_SYNC.syncNow();
		assert.equal(retrySuccess, true);

		// Prüfe:
		// - Server muss genau 2 Pakete haben (Paket 1 mit E1+E2, Paket 2 mit E3)
		assert.equal(serverPackets.length, 2, "Server darf genau 2 Pakete haben");

		// Paket 2 entschlüsseln und prüfen, dass NUR E3 enthalten ist (kein redundantes Paket mit E1+E2+E3)
		const decryptedP2 = await decryptPayload(creds.cryptoKey, serverPackets[1]);
		const eventsInP2 = prepareIncomingCloudEvents([decryptedP2]);
		assert.equal(eventsInP2.length, 1, "Paket 2 darf nur das neue Event E3 enthalten");
		assert.equal(eventsInP2[0].id, "local-e3");

		// Quota-Prüfung: serverTotalBytes darf nicht doppelt für E1 und E2 belastet werden
		assert.ok(serverTotalBytes < bytesAfterFirstPush * 2, "Quota darf nicht durch doppelte Speicherung verschwendet werden");
		assert.equal(CLOUDFLARE_SYNC.status().lastUploadedLocalSeq, 3);
		assert.equal(CLOUDFLARE_SYNC.status().lastSyncedSeq, 2);
	} finally {
		CLOUDFLARE_SYNC.disconnect();
		globalThis.fetch = originalFetch;
		globalThis.WebSocket = originalWebSocket;
		DB.allBlobKeys = originalAllBlobKeys;
		DB.allEvents = originalAllEvents;
		DB.addEvents = originalAddEvents;
		DB.importAll = originalImportAll;
	}
});

test("Regression (echter CLOUDFLARE_SYNC): Lückenloser Prefix-Schutz — seq1 UNIQUE-A, seq2 EXISTING-B, Server hat EXISTING-B -> UNIQUE-A wird hochgeladen", async () => {
	const originalFetch = globalThis.fetch;
	const originalWebSocket = globalThis.WebSocket;
	const originalAllBlobKeys = DB.allBlobKeys;
	const originalAllEvents = DB.allEvents;
	const originalAddEvents = DB.addEvents;
	const originalImportAll = DB.importAll;

	MockWebSocket.instances = [];
	globalThis.WebSocket = MockWebSocket;

	const key = generateSyncKey();
	const creds = await deriveSyncCredentials(key);

	// Server enthält nur EXISTING-B (seq 1 auf dem Server)
	const eventB = { id: "existing-b", t: "2026-08-20T10:01:00Z", type: "pageCreate", payload: { id: "pb", title: "Note B" } };
	const encB = await encryptPayload(creds.cryptoKey, cloudEventsEnvelope([eventB]));
	const packetB = { seq: 1, id: "p-b", iv: encB.iv, data: encB.data, size: encB.size, created_at: new Date().toISOString() };

	// Lokaler Client hat seq1 = UNIQUE-A, seq2 = EXISTING-B
	const localEvents = [
		{ seq: 1, id: "unique-a", t: "2026-08-20T10:00:00Z", type: "pageCreate", payload: { id: "pa", title: "Note A" } },
		{ seq: 2, id: "existing-b", t: "2026-08-20T10:01:00Z", type: "pageCreate", payload: { id: "pb", title: "Note B" } },
	];

	DB.allBlobKeys = async () => [];
	DB.allEvents = async () => [...localEvents];
	DB.addEvents = async () => {};
	DB.importAll = async () => ({ importedEvents: [] });

	const keys = syncCursorStorageKeys(creds.userId);
	localStorage.setItem(keys.lastSynced, "0");
	localStorage.setItem(keys.lastUploaded, "0");
	localStorage.setItem(keys.generation, "1");

	const serverPackets = [packetB];
	let serverSeqCounter = 1;
	const uploadedPackets = [];

	globalThis.fetch = async (url, init = {}) => {
		const urlStr = String(url);
		if (urlStr.includes("/api/sync")) {
			const since = Number(new URL(urlStr).searchParams.get("since")) || 0;
			const returnPackets = serverPackets.filter((p) => p.seq > since);
			return new Response(JSON.stringify({ events: returnPackets, maxSeq: serverSeqCounter, hasMore: false, generation: 1 }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		}
		if (urlStr.includes("/api/events") && init.method === "POST") {
			const body = JSON.parse(init.body || "{}");
			for (const p of body.events || []) {
				uploadedPackets.push(p);
				if (!serverPackets.some((sp) => sp.id === p.id)) {
					serverPackets.push({ ...p, seq: ++serverSeqCounter });
				}
			}
			return new Response(JSON.stringify({ ok: true, savedCount: (body.events || []).length, maxSeq: serverSeqCounter, usage: 1000, generation: 1 }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		}
		return new Response(JSON.stringify({ ok: true, keys: [], cursor: "" }), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
	};

	try {
		const success = await CLOUDFLARE_SYNC.configure("https://sync.example.com", key);
		assert.equal(success, true);

		// Prüfe, was hochgeladen wurde:
		assert.ok(uploadedPackets.length >= 1, "Client muss ein Upload-Paket gesendet haben");
		let foundUniqueA = false;
		for (const p of uploadedPackets) {
			const decrypted = await decryptPayload(creds.cryptoKey, p);
			const unpacked = prepareIncomingCloudEvents([decrypted]);
			if (unpacked.some((e) => e.id === "unique-a")) foundUniqueA = true;
		}
		assert.equal(foundUniqueA, true, "UNIQUE-A muss hochgeladen worden sein");

		// Upload-Cursor muss nach erfolgreichem Upload auf 2 stehen
		assert.equal(CLOUDFLARE_SYNC.status().lastUploadedLocalSeq, 2);
	} finally {
		CLOUDFLARE_SYNC.disconnect();
		globalThis.fetch = originalFetch;
		globalThis.WebSocket = originalWebSocket;
		DB.allBlobKeys = originalAllBlobKeys;
		DB.allEvents = originalAllEvents;
		DB.addEvents = originalAddEvents;
		DB.importAll = originalImportAll;
	}
});

test("Regression (echter CLOUDFLARE_SYNC): Lückenloser Prefix-Schutz — seq1 EXISTING-A, seq2 UNIQUE-B, seq3 EXISTING-C -> Cursor springt nicht auf 3, UNIQUE-B wird hochgeladen", async () => {
	const originalFetch = globalThis.fetch;
	const originalWebSocket = globalThis.WebSocket;
	const originalAllBlobKeys = DB.allBlobKeys;
	const originalAllEvents = DB.allEvents;
	const originalAddEvents = DB.addEvents;
	const originalImportAll = DB.importAll;

	MockWebSocket.instances = [];
	globalThis.WebSocket = MockWebSocket;

	const key = generateSyncKey();
	const creds = await deriveSyncCredentials(key);

	// Server enthält EXISTING-A (seq 1) und EXISTING-C (seq 2)
	const eventA = { id: "existing-a", t: "2026-08-20T10:00:00Z", type: "pageCreate", payload: { id: "pa", title: "Note A" } };
	const encA = await encryptPayload(creds.cryptoKey, cloudEventsEnvelope([eventA]));
	const packetA = { seq: 1, id: "p-a", iv: encA.iv, data: encA.data, size: encA.size, created_at: new Date().toISOString() };

	const eventC = { id: "existing-c", t: "2026-08-20T10:02:00Z", type: "pageCreate", payload: { id: "pc", title: "Note C" } };
	const encC = await encryptPayload(creds.cryptoKey, cloudEventsEnvelope([eventC]));
	const packetC = { seq: 2, id: "p-c", iv: encC.iv, data: encC.data, size: encC.size, created_at: new Date().toISOString() };

	// Lokaler Client hat seq1 = EXISTING-A, seq2 = UNIQUE-B, seq3 = EXISTING-C
	const localEvents = [
		{ seq: 1, id: "existing-a", t: "2026-08-20T10:00:00Z", type: "pageCreate", payload: { id: "pa", title: "Note A" } },
		{ seq: 2, id: "unique-b", t: "2026-08-20T10:01:00Z", type: "pageCreate", payload: { id: "pb", title: "Note B" } },
		{ seq: 3, id: "existing-c", t: "2026-08-20T10:02:00Z", type: "pageCreate", payload: { id: "pc", title: "Note C" } },
	];

	DB.allBlobKeys = async () => [];
	DB.allEvents = async () => [...localEvents];
	DB.addEvents = async () => {};
	DB.importAll = async () => ({ importedEvents: [] });

	const keys = syncCursorStorageKeys(creds.userId);
	localStorage.setItem(keys.lastSynced, "0");
	localStorage.setItem(keys.lastUploaded, "0");
	localStorage.setItem(keys.generation, "1");

	const serverPackets = [packetA, packetC];
	let serverSeqCounter = 2;
	const uploadedPackets = [];
	let cursorAfterPullBeforePush = null;

	globalThis.fetch = async (url, init = {}) => {
		const urlStr = String(url);
		if (urlStr.includes("/api/sync")) {
			const since = Number(new URL(urlStr).searchParams.get("since")) || 0;
			const returnPackets = serverPackets.filter((p) => p.seq > since);
			return new Response(JSON.stringify({ events: returnPackets, maxSeq: serverSeqCounter, hasMore: false, generation: 1 }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		}
		if (urlStr.includes("/api/events") && init.method === "POST") {
			// Nach dem ersten Pull und vor dem Post: Cursor darf höchstens bis seq1 vorgerückt sein
			cursorAfterPullBeforePush = CLOUDFLARE_SYNC.status().lastUploadedLocalSeq;
			const body = JSON.parse(init.body || "{}");
			for (const p of body.events || []) {
				uploadedPackets.push(p);
				if (!serverPackets.some((sp) => sp.id === p.id)) {
					serverPackets.push({ ...p, seq: ++serverSeqCounter });
				}
			}
			return new Response(JSON.stringify({ ok: true, savedCount: (body.events || []).length, maxSeq: serverSeqCounter, usage: 1000, generation: 1 }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		}
		return new Response(JSON.stringify({ ok: true, keys: [], cursor: "" }), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
	};

	try {
		const success = await CLOUDFLARE_SYNC.configure("https://sync.example.com", key);
		assert.equal(success, true);

		// Vor dem Push darf der Upload-Cursor wegen UNIQUE-B nicht auf seq 3 gesprungen sein
		assert.equal(cursorAfterPullBeforePush, 1, "Cursor durfte vor dem Push nur bis seq 1 vorrücken, nicht bis seq 3");

		// UNIQUE-B muss hochgeladen worden sein
		let foundUniqueB = false;
		for (const p of uploadedPackets) {
			const decrypted = await decryptPayload(creds.cryptoKey, p);
			const unpacked = prepareIncomingCloudEvents([decrypted]);
			if (unpacked.some((e) => e.id === "unique-b")) foundUniqueB = true;
		}
		assert.equal(foundUniqueB, true, "UNIQUE-B muss hochgeladen worden sein");

		// Nach erfolgreichem Push muss der Upload-Cursor auf 3 stehen
		assert.equal(CLOUDFLARE_SYNC.status().lastUploadedLocalSeq, 3);
	} finally {
		CLOUDFLARE_SYNC.disconnect();
		globalThis.fetch = originalFetch;
		globalThis.WebSocket = originalWebSocket;
		DB.allBlobKeys = originalAllBlobKeys;
		DB.allEvents = originalAllEvents;
		DB.addEvents = originalAddEvents;
		DB.importAll = originalImportAll;
	}
});
