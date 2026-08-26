"use strict";

import { S, STATE } from "./state.js";
import { DB } from "./db.js";
import { U } from "./util.js";
import { SETTINGS_SYNC } from "./settings-sync.js";
import { PERF_PROFILER } from "./performance-profiler.js";
import { cooperativeGate } from "./cooperative.js";
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
import { isRetryableSyncError, requestWithStallTimeout, syncRetryDelayMs, transferBodyBytes } from "./sync-transfer.js";

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
const SYNC_FETCH_TIMEOUT_MS = 45000;
const BLOB_FETCH_TIMEOUT_MS = 120000;
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

// Nur eine lückenlose, zur lokalen Ausgangsposition passende Server-Bestätigung
// darf den Empfangs-Cursor vorsetzen. Alte Server oder konkurrierende Uploads
// liefern null; dann bleibt der bisherige bestätigende Pull aktiv.
export function acknowledgedUploadCursor(data, expectedGeneration, currentSeq) {
	const ack = data?.ack;
	const generation = Number(data?.generation);
	const fromSeq = Number(ack?.fromSeq), toSeq = Number(ack?.toSeq), savedCount = Number(ack?.savedCount);
	if (!ack || !Number.isSafeInteger(generation) || generation !== Number(expectedGeneration)) return null;
	if (![fromSeq, toSeq, savedCount].every(Number.isSafeInteger)) return null;
	if (fromSeq !== Number(currentSeq) || toSeq < fromSeq || savedCount !== toSeq - fromSeq) return null;
	return toSeq;
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
	let socket = null, reconnectTimer = 0, retryTimer = 0, pingTimer = 0, localTimer = 0;
	let reconnectAttempts = 0, retryAttempts = 0, credentials = null, socketAuthenticated = false, initialized = false;
	let configureGeneration = 0, syncPromise = null, syncAgain = false, forceAgain = false;
	const blobHashCache = new Map(), ignoredBlobKeys = new Set();
	const pendingUploadedEventIds = new Set();
	let blobInventoryDirty = true;

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
	const setProgress = (label, current, total) => {
		const previous = state.progress;
		const safeTotal = Math.max(0, Number(total) || 0);
		const safeCurrent = Math.min(safeTotal, Math.max(0, Number(current) || 0));
		state.progress = safeTotal > 0 ? {
			label,
			current: safeCurrent,
			total: safeTotal,
			percent: Math.round((safeCurrent / safeTotal) * 100),
		} : null;
		if (previous?.label !== state.progress?.label || previous?.percent !== state.progress?.percent || previous?.total !== state.progress?.total) emit();
	};
	const keys = () => syncCursorStorageKeys(credentials?.userId);
	const saveRecv = (seq) => { state.lastSyncedSeq = Number(seq) || 0; LS.setItem(keys().lastSynced, String(state.lastSyncedSeq)); };
	const saveSend = (seq) => { state.lastUploadedLocalSeq = Number(seq) || 0; LS.setItem(keys().lastUploaded, String(state.lastUploadedLocalSeq)); };
	const saveGeneration = (generation) => { state.generation = Number(generation) || 0; LS.setItem(keys().generation, String(state.generation)); };

	function clearCursors(generation = state.generation) {
		pendingUploadedEventIds.clear();
		saveRecv(0); saveSend(0); saveGeneration(generation);
	}

	function api(endpoint, baseUrl = state.url) {
		const base = String(baseUrl || "").trim().replace(/\/+$/, "");
		const sep = endpoint.includes("?") ? "&" : "?";
		return credentials ? `${base}${endpoint}${sep}user=${encodeURIComponent(credentials.userId)}` : `${base}${endpoint}`;
	}

	const fetchTimed = (url, init = {}, stallTimeoutMs = SYNC_FETCH_TIMEOUT_MS, onProgress) =>
		requestWithStallTimeout(url, init, { stallTimeoutMs, onProgress });

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
		const error = new Error(message || `${fallback} (Status ${response.status})`);
		error.status = Number(response.status) || 0;
		return error;
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
		// Der bestätigende Pull liefert das gerade hochgeladene Paket als Server-Echo
		// zurück. Diese Events liegen bereits lokal vor. Ohne diesen schnellen Pfad
		// wurde für wenige eigene Events der komplette IndexedDB-Log deserialisiert.
		const candidates = events.filter((event) => !pendingUploadedEventIds.delete(event?.id));
		if (!candidates.length) return;
		const local = await DB.allEvents();
		const sortedLocal = (Array.isArray(local) ? local : []).slice().sort((a, b) => (Number(a?.seq) || 0) - (Number(b?.seq) || 0));
		const serverEventIds = new Set(candidates.map((e) => e?.id).filter(Boolean));
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

		// Nach E2EE liegen die Daten bereits als Objekte vor. Der JSON-Roundtrip hier
		// blockierte den Main Thread bei gebündelten Sync-Paketen unnötig.
		const result = await DB.importAll({ app: "impala67", events: candidates }, {
			localEvents: local,
			unsyncedAfterSeq: state.lastUploadedLocalSeq,
			pageInfo: (id) => S.pages[id],
			remote: true,
			remoteSource: "cloudflare",
			allowSecrets: SETTINGS_SYNC.allowsSecrets(S.settings),
		});
		const imported = result.importedEvents || [];
		if (imported.length) {
			await STATE.applyRemoteEventsCooperative(imported);
			ignoredBlobKeys.clear();
		}
	}

	async function pull() {
		if (typeof navigator !== "undefined" && navigator.onLine === false) throw readable(new Error("Das Gerät ist offline."));
		let received = 0, progressStart = state.lastSyncedSeq;
		while (true) {
			const since = state.lastSyncedSeq;
			const finishRequest = PERF_PROFILER.start("cloudflare.pull-request", { since }, 500);
			let response, data;
			try {
				response = await fetchTimed(api(`/api/sync?since=${since}&limit=${PAGE_LIMIT}`), { headers: authHeaders() });
				if (!response.ok) throw await responseError(response, "Abruf vom Cloudflare-Server fehlgeschlagen");
				data = await response.json();
				const responsePackets = Array.isArray(data.events) ? data.events : [];
				finishRequest({ status: response.status, packets: responsePackets.length, encryptedChars: responsePackets.reduce((sum, packet) => sum + encryptedPacketChars(packet), 0) });
			} catch (error) {
				finishRequest({ failed: true, status: Number(error?.status) || response?.status || 0, errorName: error?.name || "Error", errorMessage: error?.message || String(error) });
				throw error;
			}
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
			const maxSeq = Math.max(since, Number(data.maxSeq) || 0);
			if (maxSeq > progressStart) setProgress("Empfange Notizen…", since - progressStart, maxSeq - progressStart);
			if (!packets.length) {
				if (data.usage !== undefined) state.usage = formatStorageUsage(data.usage, data.limit);
				break;
			}

			let expected = since + 1;
			const incoming = [];
			const finishDecrypt = PERF_PROFILER.start("cloudflare.decrypt", { packets: packets.length }, 15);
			const yieldDecrypt = cooperativeGate();
			try {
				for (const packet of packets) {
					if (packet.seq !== expected) throw new Error(`Server-Sequenzlücke: erwartet ${expected}, erhalten ${packet.seq}.`);
					const envelope = await decryptPayload(credentials.cryptoKey, packet);
					incoming.push(...prepareIncomingCloudEvents([envelope]));
					expected++;
					await yieldDecrypt();
				}
				finishDecrypt({ events: incoming.length });
			} catch (error) {
				finishDecrypt({ events: incoming.length, failed: true, errorName: error?.name || "Error", errorMessage: error?.message || String(error) });
				throw error;
			}
			await PERF_PROFILER.run("cloudflare.import", () => importRemote(incoming), { events: incoming.length }, 15);
			received += incoming.length;
			saveRecv(packets.at(-1).seq);
			if (maxSeq > progressStart) setProgress("Empfange Notizen…", state.lastSyncedSeq - progressStart, maxSeq - progressStart);
			if (data.usage !== undefined) state.usage = formatStorageUsage(data.usage, data.limit);
			if (!data.hasMore) break;
		}
		return received;
	}

	async function postPackets(packets) {
		if (typeof navigator !== "undefined" && navigator.onLine === false) throw readable(new Error("Das Gerät ist offline."));
		const finishProfile = PERF_PROFILER.start("cloudflare.upload", { packets: packets.length }, 20);
		const batches = [];
		for (let i = 0; i < packets.length;) {
			const batch = [];
			let chars = 0;
			while (i < packets.length && batch.length < MAX_HTTP_PACKETS) {
				const packet = packets[i], n = encryptedPacketChars(packet);
				if (batch.length && chars + n > MAX_HTTP_CHARS) break;
				batch.push(packet); chars += n; i++;
			}
			const body = JSON.stringify({ events: batch });
			batches.push({ body, bytes: transferBodyBytes(body) });
		}
		const totalBytes = batches.reduce((sum, batch) => sum + batch.bytes, 0);
		let requests = 0, utf8Bytes = 0, completedBytes = 0, cursorAcknowledged = true;
		setProgress("Übertrage Notizen…", 0, totalBytes);
		try {
			for (const batch of batches) {
				requests++;
				utf8Bytes += batch.bytes;
				const finishRequest = PERF_PROFILER.start("cloudflare.upload-request", { request: requests, utf8Bytes: batch.bytes }, 500);
				let response, data;
				try {
					response = await fetchTimed(api("/api/events"), {
						method: "POST",
						headers: authHeaders({ "Content-Type": "application/json" }),
						body: batch.body,
					}, SYNC_FETCH_TIMEOUT_MS, ({ direction, loaded }) => {
						if (direction === "upload") setProgress("Übertrage Notizen…", completedBytes + Math.min(batch.bytes, loaded), totalBytes);
					});
					if (!response.ok) throw await responseError(response, "Upload zum Cloudflare-Server fehlgeschlagen");
					data = await response.json();
					finishRequest({ status: response.status, savedCount: Number(data.savedCount) || 0 });
				} catch (error) {
					finishRequest({ failed: true, status: Number(error?.status) || response?.status || 0, errorName: error?.name || "Error", errorMessage: error?.message || String(error) });
					throw error;
				}
				const acknowledged = acknowledgedUploadCursor(data, state.generation, state.lastSyncedSeq);
				if (acknowledged === null) cursorAcknowledged = false;
				else if (cursorAcknowledged) saveRecv(acknowledged);
				if (data.usage !== undefined) state.usage = formatStorageUsage(data.usage, data.limit);
				completedBytes += batch.bytes;
				setProgress("Übertrage Notizen…", completedBytes, totalBytes);
			}
			finishProfile({ requests, utf8Bytes, cursorAcknowledged });
			return cursorAcknowledged;
		} catch (error) {
			finishProfile({ requests, utf8Bytes, failed: true, errorName: error?.name || "Error" });
			throw error;
		}
	}

	async function push(forceAll = false) {
		if (typeof navigator !== "undefined" && navigator.onLine === false) throw readable(new Error("Das Gerät ist offline."));
		const maxSeq = await PERF_PROFILER.run("cloudflare.db-max-seq", () => DB.maxSeq(), {}, 10);
		let uploaded = Number(LS.getItem(keys().lastUploaded)) || 0;
		if (forceAll || uploaded > maxSeq) uploaded = 0;
		const local = maxSeq <= uploaded ? [] : await PERF_PROFILER.run(uploaded ? "cloudflare.db-read-delta" : "cloudflare.db-read-full", () => (
			uploaded ? DB.eventsAfterSeq(uploaded, "cloudflare", maxSeq) : DB.allEvents()
		), { afterSeq: uploaded, upToSeq: maxSeq }, 10);
		const prepared = PERF_PROFILER.measure("cloudflare.prepare-upload", () => {
			const source = uploaded ? local : DB.compactEvents(local);
			const wire = prepareCloudEvents(pruneEventsForUpload(DB.filterEventsForSync(
				SETTINGS_SYNC.sanitizeEvents(source, SETTINGS_SYNC.allowsSecrets(S.settings))
			)), { includeRemote: !uploaded });
			return wire;
		}, { localEvents: local.length, forceAll: !!forceAll }, 10);
		const wire = prepared;
		if (!wire.length) { saveSend(maxSeq); return { uploaded: false, confirmed: true }; }

		const chunks = chunkCloudEvents(wire);
		const packets = [];
		const finishEncrypt = PERF_PROFILER.start("cloudflare.encrypt", { events: wire.length, chunks: chunks.length }, 10);
		const yieldEncrypt = cooperativeGate();
		try {
			setProgress("Bereite Notizen vor…", 0, chunks.length);
			for (let i = 0; i < chunks.length; i++) {
				const events = chunks[i];
				const id = `p-${await sha256Hex(events.map((event) => event.id).join("\n"))}`;
				const encrypted = await encryptPayload(credentials.cryptoKey, cloudEventsEnvelope(events));
				packets.push({ id, ...encrypted });
				setProgress("Bereite Notizen vor…", i + 1, chunks.length);
				await yieldEncrypt();
			}
			finishEncrypt({ packets: packets.length });
		} catch (error) {
			finishEncrypt({ packets: packets.length, failed: true, errorName: error?.name || "Error" });
			throw error;
		}
		const confirmed = await postPackets(packets);
		for (const event of wire) if (event?.id) pendingUploadedEventIds.add(event.id);
		saveSend(maxSeq);
		state.progress = null;
		return { uploaded: true, confirmed };
	}

	const blobOpaqueKey = async (id) => {
		let key = blobHashCache.get(id);
		if (!key) { key = await sha256Hex(`impala67_blob:${id}`); blobHashCache.set(id, key); }
		return key;
	};

	async function listRemoteBlobs() {
		if (typeof navigator !== "undefined" && navigator.onLine === false) return new Set();
		const keys = [];
		let cursor = "";
		do {
			const response = await fetchTimed(api(`/api/blobs${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`), { headers: authHeaders() });
			if (!response.ok) throw await responseError(response, "Blob-Liste konnte nicht geladen werden");
			const data = await response.json();
			keys.push(...(data.keys || []));
			cursor = data.cursor || "";
		} while (cursor);
		return new Set(keys);
	}

	async function syncBlobs() {
		if (!DB.allBlobKeys || !DB.getBlob || !DB.putBlob) return false;
		if (typeof navigator !== "undefined" && navigator.onLine === false) return false;
		const localIds = (await DB.allBlobKeys()).filter((id) => isSyncBlobId(id) && isBlobAlive(id, S.pages));
		const localByKey = new Map();
		await mapLimit(localIds, 6, async (id) => localByKey.set(await blobOpaqueKey(id), id));
		const remote = await listRemoteBlobs();

		const upload = [...localByKey].filter(([key]) => !remote.has(key));
		const uploadProgress = new Array(upload.length).fill(0);
		const updateFileProgress = (label, values) => setProgress(label, values.reduce((sum, value) => sum + value, 0), values.length);
		if (upload.length) updateFileProgress("Übertrage Dateien…", uploadProgress);
		await mapLimit(upload, 3, async ([key, id], index) => {
			const record = await DB.getBlob(id);
			if (!record) { uploadProgress[index] = 1; updateFileProgress("Übertrage Dateien…", uploadProgress); return; }
			const encrypted = await encryptBlobRecord(credentials.cryptoKey, id, record);
			const response = await fetchTimed(api(`/api/blob/${key}`), {
				method: "PUT",
				headers: authHeaders({ "Content-Type": "application/octet-stream", "X-Impala-IV": encrypted.iv }),
				body: encrypted.bytes,
			}, BLOB_FETCH_TIMEOUT_MS, ({ direction, loaded, total }) => {
				if (direction !== "upload") return;
				uploadProgress[index] = Math.min(0.99, loaded / Math.max(1, total || encrypted.bytes.byteLength));
				updateFileProgress("Übertrage Dateien…", uploadProgress);
			});
			if (!response.ok) throw await responseError(response, `Blob ${id} konnte nicht hochgeladen werden`);
			const usage = Number(response.headers.get("X-Impala-Usage"));
			if (Number.isFinite(usage)) state.usage = formatStorageUsage(usage);
			uploadProgress[index] = 1;
			updateFileProgress("Übertrage Dateien…", uploadProgress);
		});

		const download = [...remote].filter((key) => !localByKey.has(key) && !ignoredBlobKeys.has(key));
		const downloadProgress = new Array(download.length).fill(0);
		if (download.length) updateFileProgress("Empfange Dateien…", downloadProgress);
		await mapLimit(download, 3, async (key, index) => {
			const response = await fetchTimed(api(`/api/blob/${key}`), { headers: authHeaders() }, BLOB_FETCH_TIMEOUT_MS, ({ direction, loaded, total, lengthComputable }) => {
				if (direction !== "download" || !lengthComputable) return;
				downloadProgress[index] = Math.min(0.99, loaded / Math.max(1, total));
				updateFileProgress("Empfange Dateien…", downloadProgress);
			});
			if (!response.ok) throw await responseError(response, "Blob konnte nicht geladen werden");
			const iv = response.headers.get("X-Impala-IV");
			const record = await decryptBlobRecord(credentials.cryptoKey, iv, new Uint8Array(await response.arrayBuffer()));
			if (await blobOpaqueKey(record.id) !== key) throw new Error("Blob-ID stimmt nach Entschlüsselung nicht mit dem Server-Schlüssel überein.");
			if (!isSyncBlobId(record.id) || !isBlobAlive(record.id, S.pages)) {
				ignoredBlobKeys.add(key);
				downloadProgress[index] = 1;
				updateFileProgress("Empfange Dateien…", downloadProgress);
				return;
			}
			await DB.putBlob(record.id, record.buf, record.meta);
			downloadProgress[index] = 1;
			updateFileProgress("Empfange Dateien…", downloadProgress);
		});
		return upload.length > 0 || download.length > 0;
	}

	async function runPass(forceAll) {
		const finishProfile = PERF_PROFILER.start("cloudflare.sync", { forceAll: !!forceAll }, 40);
		if (typeof navigator !== "undefined" && navigator.onLine === false) {
			finishProfile({ failed: true, offline: true });
			throw readable(new Error("Das Gerät ist offline."));
		}
		try {
			state.progress = null;
			setStatus("syncing", "Synchronisiere…", "Hole Änderungen…");
			const received = await PERF_PROFILER.run("cloudflare.pull", () => pull(), {}, 20);
			if (blobInventoryDirty || received > 0) {
				state.progress = null;
				setStatus("syncing", "Synchronisiere…", "Gleiche Dateien ab…");
				await PERF_PROFILER.run("cloudflare.blobs", () => syncBlobs(), { afterReceive: received > 0 }, 20);
				blobInventoryDirty = false;
			}
			state.progress = null;
			setStatus("syncing", "Synchronisiere…", "Sende lokale Änderungen…");
			const pushed = await PERF_PROFILER.run("cloudflare.push", () => push(forceAll), { forceAll: !!forceAll }, 20);
			const uploaded = !!pushed.uploaded;
			// Nur ein echter Upload braucht den bestaetigenden Pull. Beim warmen No-op
			// spart das eine vollstaendige serielle Netz-Rundreise. Ein beweisbar
			// lückenloses Server-Ack spart sie nun auch nach einem Upload; alte Server
			// und konkurrierende Schreiber bleiben automatisch beim sicheren Pull.
			if (uploaded && !pushed.confirmed) {
				await PERF_PROFILER.run("cloudflare.confirm-pull", () => pull(), {}, 20);
			}
			if (uploaded) pendingUploadedEventIds.clear();
			state.progress = null; state.lastError = null;
			clearTimeout(retryTimer); retryTimer = 0; retryAttempts = 0;
			setStatus("connected", socketAuthenticated ? "Live verbunden" : "Synchronisiert", "Aktueller Stand synchronisiert");
			finishProfile({ received, uploaded, uploadAcknowledged: uploaded && !!pushed.confirmed });
			return true;
		} catch (error) {
			finishProfile({ failed: true, errorName: error?.name || "Error" });
			throw error;
		}
	}

	function scheduleHttpRetry(error) {
		if (!isRetryableSyncError(error) || !state.url || !credentials) return false;
		if (typeof navigator !== "undefined" && navigator.onLine === false) return false;
		clearTimeout(retryTimer);
		const delay = syncRetryDelayMs(retryAttempts++);
		setStatus("syncing", "Verbindung unterbrochen", `Sync wird in ${Math.max(1, Math.ceil(delay / 1000))} s fortgesetzt.`);
		retryTimer = setTimeout(() => {
			retryTimer = 0;
			requestSync().then(() => connectWebSocket()).catch(() => {});
		}, delay);
		return true;
	}

	function requestSync(forceAll = false) {
		if (!state.url || !credentials) return Promise.reject(new Error("Cloudflare-Sync ist nicht eingerichtet."));
		if (typeof navigator !== "undefined" && navigator.onLine === false) {
			return Promise.reject(readable(new Error("Das Gerät ist offline.")));
		}
		clearTimeout(retryTimer); retryTimer = 0;
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
				const e = readable(error); state.lastError = e.message;
				if (!scheduleHttpRetry(e)) setStatus("error", "Sync-Fehler", e.message);
				throw e;
			} finally { syncPromise = null; }
		})();
		return syncPromise;
	}

	function scheduleSync(event = null) {
		if (!credentials) return;
		if (!event || (typeof event.type === "string" && event.type.startsWith("page"))) {
			ignoredBlobKeys.clear();
			blobInventoryDirty = true;
		}
		if (typeof navigator !== "undefined" && navigator.onLine === false) {
			closeSocket();
			return;
		}
		clearTimeout(localTimer);
		localTimer = setTimeout(() => requestSync().catch(() => {}), LOCAL_SYNC_DELAY);
	}

	async function migrateLocalV4(snapshotInfo = null) {
		if (LS.getItem(LS_LOCAL_V4) === "1") return;
		if (typeof DB.replaceHeftHistory !== "function") throw new Error("Lokale v4-Migration fehlt in db.js.");
		const upToSeq = snapshotInfo?.maxSeq ?? snapshotInfo?.seq ?? (typeof STATE.loadedSeq === "function" ? STATE.loadedSeq() : 0);
		const defaultTime = snapshotInfo?.maxTime || snapshotInfo?.time || (typeof STATE.loadedTime === "function" ? STATE.loadedTime() : "") || U.now();
		const baselines = [];
		for (const [pageId, doc] of Object.entries(S.heftDocs || {})) {
			const ops = heftBaselineOps(doc);
			if (!ops.length) continue;
			const hash = await sha256Hex(JSON.stringify(doc?.pages || []));
			const t = S.heftMeta?.[pageId]?.updated || defaultTime;
			baselines.push({ id: `v4-heft-${pageId}-${hash.slice(0, 24)}`, t, type: "heftOps", payload: { pageId, ops } });
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
		if (typeof navigator !== "undefined" && navigator.onLine === false) return;
		const delay = Math.min(30000, 1000 * 1.6 ** ++reconnectAttempts);
		reconnectTimer = setTimeout(connectWebSocket, delay);
	}

	function connectWebSocket() {
		if (typeof WebSocket === "undefined" || !credentials || !state.url) return;
		if (typeof navigator !== "undefined" && navigator.onLine === false) return;
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
				} else if (msg.type === "changed") {
					// Ein unveraenderter Server-Cursor bedeutet: Nur das Blob-Inventar hat
					// sich geaendert. Bei neuen Eventpaketen entscheidet pull() nach dem
					// Entschluesseln, dass der Blob-Abgleich mitlaufen muss.
					if (Number(msg.maxSeq || 0) <= state.lastSyncedSeq) blobInventoryDirty = true;
					requestSync().catch(() => {});
				}
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
		clearTimeout(retryTimer); retryTimer = 0; retryAttempts = 0;
		closeSocket(); credentials = null; pendingUploadedEventIds.clear();
		blobHashCache.clear(); ignoredBlobKeys.clear(); blobInventoryDirty = true;
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
		configureGeneration++; clearTimeout(localTimer); clearTimeout(retryTimer); retryTimer = 0; retryAttempts = 0; closeSocket(); credentials = null;
		blobHashCache.clear(); ignoredBlobKeys.clear(); pendingUploadedEventIds.clear();
		setStatus("disconnected", "Getrennt");
	}

	async function purgeCloudData() {
		if (!credentials) return false;
		const response = await fetchTimed(api("/api/reset"), { method: "POST", headers: authHeaders() });
		if (!response.ok) throw await responseError(response, "Cloud-Daten konnten nicht gelöscht werden");
		const data = await response.json();
		blobHashCache.clear(); ignoredBlobKeys.clear(); blobInventoryDirty = true;
		clearCursors(Number(data.generation) || state.generation + 1);
		return true;
	}

	STATE.onAfterDispatch((ev) => scheduleSync(ev));

	function init() {
		if (initialized) return;
		initialized = true;
		if (typeof window !== "undefined") {
			window.addEventListener("offline", () => { closeSocket(); clearTimeout(localTimer); clearTimeout(reconnectTimer); });
			window.addEventListener("online", () => { clearTimeout(retryTimer); retryTimer = 0; connectWebSocket(); requestSync().catch(() => {}); });
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
