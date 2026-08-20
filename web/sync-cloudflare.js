"use strict";

import { S, STATE } from "./state.js";
import { DB } from "./db.js";
import { U } from "./util.js";
import { SETTINGS_SYNC } from "./settings-sync.js";
import {
	CLOUD_SYNC_PROTOCOL,
	CLOUD_SYNC_PROTOCOL_HEADER,
	chunkCloudEvents,
	cloudEventsEnvelope,
	encryptedPacketChars,
	heftBaselineOps,
	isBlobAlive,
	isSyncBlobId,
	prepareCloudEvents,
	prepareIncomingCloudEvents,
	pruneEventsForUpload,
} from "./sync-core.js";
import {
	MAX_USER_STORAGE_BYTES,
	decryptBlobRecord,
	decryptPayload,
	deriveSyncCredentials,
	encryptBlobRecord,
	encryptPayload,
	formatStorageUsage,
	generateSyncKey,
	sha256Hex,
} from "./sync-crypto.js";

export const DEFAULT_WORKER_URL = "https://impala67-sync.joshuagayer1.workers.dev";

const LS_URL = "impala67_cf_server_url";
const LS_KEY = "impala67_cf_sync_key";
const LS_RECV = "impala67_cf_last_seq";
const LS_SEND = "impala67_cf_last_uploaded_local_seq";
const LS_GEN = "impala67_cf_generation";
const PAGE_LIMIT = 100;
const MAX_HTTP_PACKETS = 20;
const MAX_HTTP_CHARS = 6_000_000;
const LOCAL_SYNC_DELAY = 80;
const LS_LOCAL_V4 = "impala67_sync_v4_local_migrated";

const fallbackStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const LS = {
	getItem: (k) => (typeof localStorage !== "undefined" ? localStorage : fallbackStorage).getItem(k),
	setItem: (k, v) => (typeof localStorage !== "undefined" ? localStorage : fallbackStorage).setItem(k, v),
	removeItem: (k) => (typeof localStorage !== "undefined" ? localStorage : fallbackStorage).removeItem(k),
};

export function syncCursorStorageKeys(userId) {
	const id = String(userId || "").trim();
	if (!id) throw new Error("Sync-Cursor benötigen eine User-ID.");
	return { lastSynced: `${LS_RECV}_${id}`, lastUploaded: `${LS_SEND}_${id}`, generation: `${LS_GEN}_${id}` };
}

export function resetSyncCursorStorage(storage, userId, generation = 0) {
	const keys = syncCursorStorageKeys(userId);
	storage.setItem(keys.lastSynced, "0");
	storage.setItem(keys.lastUploaded, "0");
	storage.setItem(keys.generation, String(Number(generation) || 0));
}

async function mapLimit(items, limit, fn) {
	let i = 0;
	const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
		while (i < items.length) {
			const index = i++;
			await fn(items[index], index);
		}
	});
	await Promise.all(workers);
}

export const CLOUDFLARE_SYNC = (() => {
	let socket = null, reconnectTimer = 0, pingTimer = 0, localTimer = 0;
	let reconnectAttempts = 0, credentials = null, socketAuthenticated = false, initialized = false;
	let configureGeneration = 0, syncPromise = null, syncAgain = false, forceAgain = false;
	const blobHashCache = new Map(), ignoredBlobKeys = new Set();

	let state = {
		status: "disconnected",
		label: "Nicht eingerichtet",
		detail: "Verbinde einen Cloudflare-Sync-Server",
		url: LS.getItem(LS_URL) || DEFAULT_WORKER_URL,
		syncKey: LS.getItem(LS_KEY) || "",
		lastSyncedSeq: 0,
		lastUploadedLocalSeq: 0,
		generation: 0,
		progress: null,
		usage: formatStorageUsage(0),
		lastError: null,
	};

	const emit = () => {
		if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
			window.dispatchEvent(new CustomEvent("impala67:cloudflare-sync-status", { detail: { ...state } }));
		}
	};
	const setStatus = (status, label, detail = label) => { Object.assign(state, { status, label, detail }); emit(); };
	const keys = () => syncCursorStorageKeys(credentials?.userId);
	const saveRecv = (seq) => { state.lastSyncedSeq = Number(seq) || 0; LS.setItem(keys().lastSynced, String(state.lastSyncedSeq)); };
	const saveSend = (seq) => { state.lastUploadedLocalSeq = Number(seq) || 0; LS.setItem(keys().lastUploaded, String(state.lastUploadedLocalSeq)); };
	const saveGeneration = (generation) => { state.generation = Number(generation) || 0; LS.setItem(keys().generation, String(state.generation)); };

	function clearCursors(generation = state.generation) {
		saveRecv(0); saveSend(0); saveGeneration(generation);
	}

	function api(endpoint, baseUrl = state.url) {
		const base = String(baseUrl || "").trim().replace(/\/+$/, "");
		const sep = endpoint.includes("?") ? "&" : "?";
		return credentials ? `${base}${endpoint}${sep}user=${encodeURIComponent(credentials.userId)}` : `${base}${endpoint}`;
	}

	function authHeaders(extra = {}) {
		return credentials ? {
			Authorization: `Bearer ${credentials.authToken}`,
			"X-User-Id": credentials.userId,
			[CLOUD_SYNC_PROTOCOL_HEADER]: String(CLOUD_SYNC_PROTOCOL),
			...extra,
		} : extra;
	}

	async function responseError(response, fallback) {
		let message = "";
		try { message = String((await response.json())?.error || "").trim(); } catch {}
		return new Error(message || `${fallback} (Status ${response.status})`);
	}

	function readable(error) {
		const message = error?.message || String(error || "Sync-Fehler");
		if (typeof navigator !== "undefined" && navigator.onLine === false) return new Error("Das Gerät ist offline. Lokale Änderungen bleiben erhalten und werden später synchronisiert.");
		if (/failed to fetch|load failed|networkerror|network request failed/i.test(message)) return new Error("Der Cloudflare-Sync-Server ist nicht erreichbar.");
		return error instanceof Error ? error : new Error(message);
	}

	function isUploadableToCloudflare(ev) {
		if (!ev || typeof ev !== "object") return false;
		const wire = prepareCloudEvents(pruneEventsForUpload(DB.filterEventsForSync(
			SETTINGS_SYNC.sanitizeEvents([ev], SETTINGS_SYNC.allowsSecrets(S.settings))
		)), { includeRemote: false });
		return wire.length > 0;
	}

	async function importRemote(events) {
		if (!events.length) return;
		const local = await DB.allEvents();
		const sortedLocal = (Array.isArray(local) ? local : []).slice().sort((a, b) => (Number(a?.seq) || 0) - (Number(b?.seq) || 0));
		const serverEventIds = new Set(events.map((e) => e?.id).filter(Boolean));
		let confirmedCursor = state.lastUploadedLocalSeq;

		for (const ev of sortedLocal) {
			const seq = Number(ev?.seq) || 0;
			if (seq <= confirmedCursor) continue;
			if (!isUploadableToCloudflare(ev)) {
				// Nicht für Cloudflare uploadpflichtig (z. B. Fremd-Event oder lokales UI-Event)
				confirmedCursor = seq;
				continue;
			}
			if (serverEventIds.has(ev.id)) {
				// Uploadpflichtiges lokales Event ist vom Server bestätigt
				confirmedCursor = seq;
			} else {
				// Erstes unbestätigtes uploadpflichtiges Event -> STOP (niemals vorspulen)
				break;
			}
		}

		if (confirmedCursor > state.lastUploadedLocalSeq) {
			saveSend(confirmedCursor);
		}

		const result = await DB.importAll(JSON.stringify({ app: "impala67", events }), {
			unsyncedAfterSeq: state.lastUploadedLocalSeq,
			pageInfo: (id) => S.pages[id],
			remote: true,
			remoteSource: "cloudflare",
			allowSecrets: SETTINGS_SYNC.allowsSecrets(S.settings),
		});
		const imported = result.importedEvents || [];
		if (imported.length) {
			STATE.applyRemoteEvents(imported);
			ignoredBlobKeys.clear();
		}
	}

	async function pull() {
		while (true) {
			const since = state.lastSyncedSeq;
			const response = await fetch(api(`/api/sync?since=${since}&limit=${PAGE_LIMIT}`), { headers: authHeaders() });
			if (!response.ok) throw await responseError(response, "Abruf vom Cloudflare-Server fehlgeschlagen");
			const data = await response.json();
			const serverGeneration = Number(data.generation) || 1;

			if (state.generation !== serverGeneration) {
				clearCursors(serverGeneration);
				continue;
			}
			if (Number(data.maxSeq || 0) < since) {
				clearCursors(serverGeneration);
				continue;
			}

			const packets = data.events || [];
			if (!packets.length) {
				if (data.usage !== undefined) state.usage = formatStorageUsage(data.usage, data.limit);
				break;
			}

			let expected = since + 1;
			const incoming = [];
			for (const packet of packets) {
				if (packet.seq !== expected) throw new Error(`Server-Sequenzlücke: erwartet ${expected}, erhalten ${packet.seq}.`);
				const envelope = await decryptPayload(credentials.cryptoKey, packet);
				incoming.push(...prepareIncomingCloudEvents([envelope]));
				expected++;
			}

			await importRemote(incoming);
			saveRecv(packets.at(-1).seq);
			if (data.usage !== undefined) state.usage = formatStorageUsage(data.usage, data.limit);
			if (!data.hasMore) break;
		}
	}

	async function postPackets(packets) {
		for (let i = 0; i < packets.length;) {
			const batch = [];
			let chars = 0;
			while (i < packets.length && batch.length < MAX_HTTP_PACKETS) {
				const packet = packets[i], n = encryptedPacketChars(packet);
				if (batch.length && chars + n > MAX_HTTP_CHARS) break;
				batch.push(packet); chars += n; i++;
			}
			const response = await fetch(api("/api/events"), {
				method: "POST",
				headers: authHeaders({ "Content-Type": "application/json" }),
				body: JSON.stringify({ events: batch }),
			});
			if (!response.ok) throw await responseError(response, "Upload zum Cloudflare-Server fehlgeschlagen");
			const data = await response.json();
			if (data.usage !== undefined) state.usage = formatStorageUsage(data.usage, data.limit);
		}
	}

	async function push(forceAll = false) {
		const local = await DB.allEvents();
		const maxSeq = local.reduce((max, event) => Math.max(max, Number(event?.seq) || 0), 0);
		let uploaded = Number(LS.getItem(keys().lastUploaded)) || 0;
		if (forceAll || uploaded > maxSeq) uploaded = 0;

		const source = uploaded ? local.filter((event) => Number(event?.seq || 0) > uploaded) : DB.compactEvents(local);
		const wire = prepareCloudEvents(pruneEventsForUpload(DB.filterEventsForSync(
			SETTINGS_SYNC.sanitizeEvents(source, SETTINGS_SYNC.allowsSecrets(S.settings))
		)), { includeRemote: !uploaded });
		if (!wire.length) { saveSend(maxSeq); return; }

		const chunks = chunkCloudEvents(wire);
		const packets = [];
		for (let i = 0; i < chunks.length; i++) {
			const events = chunks[i];
			const id = `p-${await sha256Hex(events.map((event) => event.id).join("\n"))}`;
			const encrypted = await encryptPayload(credentials.cryptoKey, cloudEventsEnvelope(events));
			packets.push({ id, ...encrypted });
			state.progress = { current: i + 1, total: chunks.length, percent: Math.round(((i + 1) / chunks.length) * 100) };
			emit();
		}
		await postPackets(packets);
		saveSend(maxSeq);
		state.progress = null;
	}

	const blobOpaqueKey = async (id) => {
		let key = blobHashCache.get(id);
		if (!key) { key = await sha256Hex(`impala67_blob:${id}`); blobHashCache.set(id, key); }
		return key;
	};

	async function listRemoteBlobs() {
		const keys = [];
		let cursor = "";
		do {
			const response = await fetch(api(`/api/blobs${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`), { headers: authHeaders() });
			if (!response.ok) throw await responseError(response, "Blob-Liste konnte nicht geladen werden");
			const data = await response.json();
			keys.push(...(data.keys || []));
			cursor = data.cursor || "";
		} while (cursor);
		return new Set(keys);
	}

	async function syncBlobs() {
		if (!DB.allBlobKeys || !DB.getBlob || !DB.putBlob) return;
		const localIds = (await DB.allBlobKeys()).filter((id) => isSyncBlobId(id) && isBlobAlive(id, S.pages));
		const localByKey = new Map();
		await mapLimit(localIds, 6, async (id) => localByKey.set(await blobOpaqueKey(id), id));
		const remote = await listRemoteBlobs();

		const upload = [...localByKey].filter(([key]) => !remote.has(key));
		await mapLimit(upload, 3, async ([key, id]) => {
			const record = await DB.getBlob(id);
			if (!record) return;
			const encrypted = await encryptBlobRecord(credentials.cryptoKey, id, record);
			const response = await fetch(api(`/api/blob/${key}`), {
				method: "PUT",
				headers: authHeaders({ "Content-Type": "application/octet-stream", "X-Impala-IV": encrypted.iv }),
				body: encrypted.bytes,
			});
			if (!response.ok) throw await responseError(response, `Blob ${id} konnte nicht hochgeladen werden`);
			const usage = Number(response.headers.get("X-Impala-Usage"));
			if (Number.isFinite(usage)) state.usage = formatStorageUsage(usage);
		});

		const download = [...remote].filter((key) => !localByKey.has(key) && !ignoredBlobKeys.has(key));
		await mapLimit(download, 3, async (key) => {
			const response = await fetch(api(`/api/blob/${key}`), { headers: authHeaders() });
			if (!response.ok) throw await responseError(response, "Blob konnte nicht geladen werden");
			const iv = response.headers.get("X-Impala-IV");
			const record = await decryptBlobRecord(credentials.cryptoKey, iv, new Uint8Array(await response.arrayBuffer()));
			if (await blobOpaqueKey(record.id) !== key) throw new Error("Blob-ID stimmt nach Entschlüsselung nicht mit dem Server-Schlüssel überein.");
			if (!isSyncBlobId(record.id) || !isBlobAlive(record.id, S.pages)) { ignoredBlobKeys.add(key); return; }
			await DB.putBlob(record.id, record.buf, record.meta);
		});
	}

	async function runPass(forceAll) {
		setStatus("syncing", "Synchronisiere…", "Hole Änderungen…");
		await pull();
		setStatus("syncing", "Synchronisiere…", "Gleiche Dateien ab…");
		await syncBlobs();
		setStatus("syncing", "Synchronisiere…", "Sende lokale Änderungen…");
		await push(forceAll);
		await pull();
		state.progress = null; state.lastError = null;
		setStatus("connected", socketAuthenticated ? "Live verbunden" : "Synchronisiert", "Aktueller Stand synchronisiert");
		return true;
	}

	function requestSync(forceAll = false) {
		if (!state.url || !credentials) return Promise.reject(new Error("Cloudflare-Sync ist nicht eingerichtet."));
		syncAgain = true; forceAgain ||= forceAll;
		if (syncPromise) return syncPromise;
		syncPromise = (async () => {
			try {
				while (syncAgain) {
					const force = forceAgain; syncAgain = false; forceAgain = false;
					await runPass(force);
				}
				return true;
			} catch (error) {
				const e = readable(error); state.lastError = e.message; setStatus("error", "Sync-Fehler", e.message); throw e;
			} finally { syncPromise = null; }
		})();
		return syncPromise;
	}

	function scheduleSync() {
		if (!credentials) return;
		ignoredBlobKeys.clear();
		clearTimeout(localTimer);
		localTimer = setTimeout(() => requestSync().catch(() => {}), LOCAL_SYNC_DELAY);
	}

	async function migrateLocalV4() {
		if (LS.getItem(LS_LOCAL_V4) === "1") return;
		if (typeof DB.replaceHeftHistory !== "function") throw new Error("Lokale v4-Migration fehlt in db.js.");
		const upToSeq = await DB.maxSeq();
		const baselines = [];
		for (const [pageId, doc] of Object.entries(S.heftDocs || {})) {
			const ops = heftBaselineOps(doc);
			if (!ops.length) continue;
			const hash = await sha256Hex(JSON.stringify(doc?.pages || []));
			baselines.push({ id: `v4-heft-${pageId}-${hash.slice(0, 24)}`, t: U.now(), type: "heftOps", payload: { pageId, ops } });
		}
		await DB.replaceHeftHistory(baselines, upToSeq);
		LS.removeItem("impala67_compact_floor");
		LS.setItem(LS_LOCAL_V4, "1");
	}

	function closeSocket() {
		clearTimeout(reconnectTimer); clearInterval(pingTimer); socketAuthenticated = false;
		const old = socket; socket = null;
		try { old?.close(); } catch {}
	}

	function scheduleReconnect() {
		clearTimeout(reconnectTimer);
		if (!state.url || !credentials) return;
		const delay = Math.min(30000, 1000 * 1.6 ** ++reconnectAttempts);
		reconnectTimer = setTimeout(connectWebSocket, delay);
	}

	function connectWebSocket() {
		if (typeof WebSocket === "undefined" || !credentials || !state.url) return;
		if (socket && [WebSocket.OPEN, WebSocket.CONNECTING].includes(socket.readyState)) return;
		clearTimeout(reconnectTimer); clearInterval(pingTimer);
		const base = state.url.replace(/\/+$/, "");
		const url = `${base.startsWith("https:") ? "wss:" : "ws:"}//${base.replace(/^https?:\/\//, "")}/ws?user=${encodeURIComponent(credentials.userId)}`;
		const ws = socket = new WebSocket(url);
		socketAuthenticated = false;

		ws.addEventListener("open", () => {
			if (socket !== ws) return;
			reconnectAttempts = 0;
			ws.send(JSON.stringify({ type: "auth", protocol: CLOUD_SYNC_PROTOCOL, token: credentials.authToken }));
		});
		ws.addEventListener("message", (event) => {
			if (socket !== ws) return;
			try {
				const msg = JSON.parse(event.data);
				if (msg.type === "authenticated") {
					if (msg.protocol !== CLOUD_SYNC_PROTOCOL) throw new Error("Server und App verwenden unterschiedliche Sync-Protokolle.");
					socketAuthenticated = true; reconnectAttempts = 0;
					if (Number(msg.generation) && Number(msg.generation) !== state.generation) clearCursors(Number(msg.generation));
					setStatus("connected", "Live verbunden", "Echtzeit-Synchronisierung aktiv");
					pingTimer = setInterval(() => { if (socket === ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "ping" })); }, 30000);
					requestSync().catch(() => {});
				} else if (msg.type === "changed") requestSync().catch(() => {});
				else if (msg.type === "reset") { clearCursors(Number(msg.generation) || 1); requestSync(true).catch(() => {}); }
				else if (msg.type === "unauthorized" || msg.type === "unsupported_protocol") {
					state.lastError = msg.error || "Nicht autorisiert"; setStatus("error", "Nicht autorisiert", state.lastError); closeSocket();
				}
			} catch (error) { console.error("[cf-sync] WebSocket-Nachricht ungültig:", error); }
		});
		ws.addEventListener("close", () => { if (socket !== ws) return; socket = null; socketAuthenticated = false; clearInterval(pingTimer); scheduleReconnect(); });
		ws.addEventListener("error", () => {});
	}

	async function configure(url, syncKey) {
		const cleanUrl = String(url || "").trim().replace(/\/+$/, ""), cleanKey = String(syncKey || "").trim();
		const generation = ++configureGeneration;
		closeSocket(); credentials = null;
		blobHashCache.clear(); ignoredBlobKeys.clear();
		state.url = cleanUrl; state.syncKey = cleanKey;
		cleanUrl ? LS.setItem(LS_URL, cleanUrl) : LS.removeItem(LS_URL);
		cleanKey ? LS.setItem(LS_KEY, cleanKey) : LS.removeItem(LS_KEY);
		if (!cleanUrl || !cleanKey) { setStatus("disconnected", "Nicht eingerichtet", "URL oder Sync-Schlüssel fehlt."); return false; }
		try {
			setStatus("connecting", "Verbindung wird aufgebaut…");
			credentials = await deriveSyncCredentials(cleanKey);
			if (generation !== configureGeneration) return false;
			const k = keys();
			state.lastSyncedSeq = Number(LS.getItem(k.lastSynced)) || 0;
			state.lastUploadedLocalSeq = Number(LS.getItem(k.lastUploaded)) || 0;
			state.generation = Number(LS.getItem(k.generation)) || 0;
			await requestSync();
			if (generation !== configureGeneration) return false;
			connectWebSocket();
			return true;
		} catch (error) {
			if (generation !== configureGeneration) return false;
			const e = readable(error); state.lastError = e.message; setStatus("error", "Einrichtungsfehler", e.message); return false;
		}
	}

	function disconnect() {
		configureGeneration++; clearTimeout(localTimer); closeSocket(); credentials = null;
		blobHashCache.clear(); ignoredBlobKeys.clear();
		setStatus("disconnected", "Getrennt");
	}

	async function purgeCloudData() {
		if (!credentials) return false;
		const response = await fetch(api("/api/reset"), { method: "POST", headers: authHeaders() });
		if (!response.ok) throw await responseError(response, "Cloud-Daten konnten nicht gelöscht werden");
		const data = await response.json();
		blobHashCache.clear(); ignoredBlobKeys.clear();
		clearCursors(Number(data.generation) || state.generation + 1);
		return true;
	}

	function init() {
		if (initialized) return;
		initialized = true;
		STATE.onAfterDispatch(() => scheduleSync());
		if (typeof window !== "undefined") {
			window.addEventListener("online", () => { connectWebSocket(); requestSync().catch(() => {}); });
			window.addEventListener("visibilitychange", () => { if (!document.hidden && credentials) { connectWebSocket(); requestSync().catch(() => {}); } });
		}
		void (async () => {
			try { await migrateLocalV4(); }
			catch (error) { state.lastError = error?.message || String(error); setStatus("error", "Migration fehlgeschlagen", state.lastError); return; }
			if (state.url && state.syncKey) configure(state.url, state.syncKey).catch(() => {});
		})();
	}

	async function aiRequest(payload, options = {}) {
		const target = options.base || state.url || DEFAULT_WORKER_URL;
		if (!credentials && state.syncKey) credentials = await deriveSyncCredentials(state.syncKey);
		if (!target || !credentials) throw new Error("Cloudflare Sync ist nicht eingerichtet.");
		return fetch(api("/api/ai", target), {
			method: "POST", headers: authHeaders({ "Content-Type": "application/json" }),
			body: JSON.stringify(Array.isArray(payload) ? { messages: payload } : payload || {}), signal: options.signal,
		});
	}

	async function notionRequest(token, path, options = {}) {
		const target = options.base || state.url || DEFAULT_WORKER_URL;
		if (!credentials && state.syncKey) credentials = await deriveSyncCredentials(state.syncKey);
		if (!target || !credentials) throw new Error("Der sichere Notion-Proxy benötigt eine eingerichtete Cloudflare-Synchronisierung.");
		return fetch(api("/api/notion", target), {
			method: "POST", headers: authHeaders({ "Content-Type": "application/json" }),
			body: JSON.stringify({ token, path, method: options.method || "GET", body: options.body }), signal: options.signal,
		});
	}

	return {
		init, configure, disconnect, catchUp: requestSync, syncNow: () => requestSync(false), purgeCloudData,
		generateSyncKey, status: () => ({ ...state }), aiRequest, notionRequest,
		isConfigured: () => !!(state.url && (credentials || state.syncKey)),
		migrateLocalV4,
	};
})();
