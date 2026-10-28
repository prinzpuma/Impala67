"use strict";

// Cloudflare-Live-Sync. Der Ablauf (Abrufen, Zusammenführen der Cursor, Pakete, E2EE, Dateien,
// Kompaktierung) läuft im Rust-Kern (core/impala-sync, über web/core/). Hier bleiben nur
// Ein-/Ausgabe für den Kern (fetch, IndexedDB, localStorage, App-Zustand), Timer, WebSocket
// und Statusanzeige.

import { S, STATE } from "./state.js";
import { DB } from "./db.js";
import { U } from "./util.js";
import { BUS } from "./event-bus.js";
import { SETTINGS_SYNC } from "./settings-sync.js";
import { PERF_PROFILER } from "./performance-profiler.js";
import { CLOUD_SYNC_PROTOCOL, CLOUD_SYNC_PROTOCOL_HEADER, heftBaselineOps } from "./sync-core.js";
import { sha256Hex } from "./sync-crypto.js";
import { requestWithStallTimeout } from "./sync-transfer.js";
import { CORE } from "./rust-core.js";

export const DEFAULT_WORKER_URL = "https://impala67-sync.joshuagayer1.workers.dev";

const LS_URL = "impala67_cf_server_url";
const LS_KEY = "impala67_cf_sync_key";
const LS_RECV = "impala67_cf_last_seq";
const LS_SEND = "impala67_cf_last_uploaded_local_seq";
const LS_GEN = "impala67_cf_generation";
const LS_IGNORED_BLOBS = "impala67_cf_ignored_blobs";
const LOCAL_SYNC_DELAY = 80;
const SYNC_FETCH_TIMEOUT_MS = 45000;
const BLOB_FETCH_TIMEOUT_MS = 120000;
const LS_LOCAL_V4 = "impala67_sync_v4_local_migrated";
const CLIENT_ID = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
	? crypto.randomUUID()
	: "c-" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

const fallbackStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const LS = {
	getItem: (k) => (typeof localStorage !== "undefined" ? localStorage : fallbackStorage).getItem(k),
	setItem: (k, v) => (typeof localStorage !== "undefined" ? localStorage : fallbackStorage).setItem(k, v),
	removeItem: (k) => (typeof localStorage !== "undefined" ? localStorage : fallbackStorage).removeItem(k),
};

const isOffline = () => typeof navigator !== "undefined" && navigator.onLine === false;

// fetch für den Kern: { method, url, headers: [[k, v]], body } → { status, headers, body }.
const http = {
	async send({ method, url, headers, body }) {
		const stallTimeoutMs = url.includes("/api/blob/") ? BLOB_FETCH_TIMEOUT_MS : SYNC_FETCH_TIMEOUT_MS;
		const response = await requestWithStallTimeout(url, { method, headers: Object.fromEntries(headers), body }, { stallTimeoutMs });
		return { status: response.status, headers: [...response.headers], body: new Uint8Array(await response.arrayBuffer()) };
	},
};

const toBytes = async (raw) => {
	if (raw instanceof Uint8Array) return raw;
	if (typeof Blob !== "undefined" && raw instanceof Blob) return new Uint8Array(await raw.arrayBuffer());
	return raw ? new Uint8Array(raw) : null;
};

export const CLOUDFLARE_SYNC = (() => {
	let socket = null, reconnectTimer = 0, retryTimer = 0, pingTimer = 0, localTimer = 0;
	let reconnectAttempts = 0, retryAttempts = 0, core = null, socketAuthenticated = false, initialized = false;
	let configureGeneration = 0, syncPromise = null, syncAgain = false, forceAgain = false;

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
		usage: { bytes: 0, limit: 1_000_000_000, mbUsed: 0, mbLimit: 1000, percent: 0, formatted: "0.0 MB / 1000 MB (0 %)" },
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
		state.progress = total > 0 ? { label, current, total, percent: Math.round((current / total) * 100) } : null;
		if (previous?.label !== state.progress?.label || previous?.percent !== state.progress?.percent || previous?.total !== state.progress?.total) emit();
	};
	// Stand des Kerns in die Anzeige übernehmen (während eines Durchgangs liefert er null).
	const refreshState = () => {
		const s = core?.state();
		if (!s) return;
		Object.assign(state, { lastSyncedSeq: s.lastSyncedSeq, lastUploadedLocalSeq: s.lastUploadedSeq, generation: s.generation, usage: s.usage });
	};

	// Ein-/Ausgabe des Kerns für ein Konto. Cursor und verworfene Blobs liegen wie bisher je
	// User-ID im localStorage, damit vorhandene Geräte nach dem Update nahtlos weitermachen.
	function storeFor(id) {
		const keys = { recv: `${LS_RECV}_${id}`, send: `${LS_SEND}_${id}`, gen: `${LS_GEN}_${id}`, ignored: `${LS_IGNORED_BLOBS}_${id}` };
		const allowSecrets = () => SETTINGS_SYNC.allowsSecrets(S.settings);
		return {
			loadState() {
				let ignoredBlobs = {};
				try { ignoredBlobs = JSON.parse(LS.getItem(keys.ignored) || "{}") || {}; } catch { /* beschädigt: einmal neu prüfen */ }
				return {
					lastSyncedSeq: Number(LS.getItem(keys.recv)) || 0,
					lastUploadedSeq: Number(LS.getItem(keys.send)) || 0,
					generation: Number(LS.getItem(keys.gen)) || 0,
					ignoredBlobs,
				};
			},
			saveState(s) {
				LS.setItem(keys.recv, String(s.lastSyncedSeq));
				LS.setItem(keys.send, String(s.lastUploadedSeq));
				LS.setItem(keys.gen, String(s.generation));
				if (Object.keys(s.ignoredBlobs).length) LS.setItem(keys.ignored, JSON.stringify(s.ignoredBlobs));
				else LS.removeItem(keys.ignored);
				Object.assign(state, { lastSyncedSeq: s.lastSyncedSeq, lastUploadedLocalSeq: s.lastUploadedSeq, generation: s.generation });
			},
			maxSeq: () => DB.maxSeq(),
			eventsAfter: (after, upTo) => DB.eventsAfterSeqAll(after, upTo),
			filterForUpload: (events) => DB.filterEventsForSync(SETTINGS_SYNC.sanitizeEvents(events, allowSecrets())),
			async importRemote(events, unsyncedAfterSeq) {
				const result = await PERF_PROFILER.run("cloudflare.import", async () => DB.importAll({ app: "impala67", events }, {
					localEvents: await DB.eventsAfterSeqAll(unsyncedAfterSeq),
					unsyncedAfterSeq,
					conflictCheck: STATE.importConflicts,
					remote: true,
					remoteSource: "cloudflare",
					allowSecrets: allowSecrets(),
				}), { eventCount: events.length }, 15);
				const imported = result.importedEvents || [];
				// Offene Hefte brauchen hier keinen Flush: ihr Veröffentlichungs-Schatten folgt dem Log (heft.js).
				if (imported.length) await STATE.applyRemoteEventsCooperative(imported);
			},
			pages: () => S.pages,
			blobIds: () => DB.allBlobKeys(),
			async getBlob(blobId) {
				const record = await DB.getBlob(blobId);
				const data = await toBytes(record?.buf || record?.data);
				return data ? { meta: record.meta || {}, data } : null;
			},
			putBlob: (blobId, meta, data) => DB.putBlob(blobId, data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), meta),
		};
	}

	function readable(error) {
		const message = error?.message || String(error || "Sync-Fehler");
		if (isOffline()) return new Error("Das Gerät ist offline. Lokale Änderungen bleiben erhalten und werden später synchronisiert.");
		if (/failed to fetch|load failed|networkerror|network request failed/i.test(message)) return new Error("Der Cloudflare-Sync-Server ist nicht erreichbar.");
		return error instanceof Error ? error : new Error(message);
	}

	function reportOversized(names) {
		for (const name of names || []) {
			console.warn("[cf-sync] Datei zu groß für den Cloud-Sync, bleibt lokal:", name);
			U.toast(`„${name}“ ist größer als 100 MB und wird nicht synchronisiert — sie bleibt nur auf diesem Gerät.`, "error");
		}
	}

	async function runPass(forceAll) {
		const finishProfile = PERF_PROFILER.start("cloudflare.sync", { forceAll: !!forceAll }, 40);
		try {
			state.progress = null;
			setStatus("syncing", "Synchronisiere…", "Gleiche Änderungen ab…");
			const report = await core.sync(!!forceAll);
			refreshState();
			reportOversized(report.blobs?.oversized);
			if (report.compactionSkipped) console.warn("[cf-sync] Kompaktierung übersprungen, ganzes Log hochgeladen:", report.compactionSkipped);
			state.progress = null; state.lastError = null;
			clearTimeout(retryTimer); retryTimer = 0; retryAttempts = 0;
			setStatus("connected", socketAuthenticated ? "Live verbunden" : "Synchronisiert", "Aktueller Stand synchronisiert");
			finishProfile({ received: report.received, uploaded: report.uploaded, uploadAcknowledged: report.uploaded && report.confirmed });
			// Erst nach dem Upload verdichten: überholte Schnappschüsse sind dann sicher entbehrlich.
			// Verdichten löscht Events → gespeicherter Start-Checkpoint passt nicht mehr (Voll-Replay beim nächsten Start).
			try { if (await PERF_PROFILER.run("db.compact-local", () => DB.compactLocalIfDue(), {}, 50)) STATE.scheduleCheckpoint(); }
			catch (e) { console.warn("Event-Log-Kompaktierung übersprungen:", e); }
			return true;
		} catch (error) {
			refreshState();
			finishProfile({ failed: true, errorName: error?.name || "Error" });
			throw error;
		}
	}

	function scheduleHttpRetry(error) {
		if (!error?.retryable || !state.url || !core || isOffline()) return false;
		clearTimeout(retryTimer);
		const delay = CORE.syncRetryDelayMs(retryAttempts++);
		setStatus("syncing", "Verbindung unterbrochen", `Sync wird in ${Math.max(1, Math.ceil(delay / 1000))} s fortgesetzt.`);
		retryTimer = setTimeout(() => {
			retryTimer = 0;
			requestSync().then(() => connectWebSocket()).catch(() => {});
		}, delay);
		return true;
	}

	const HEFT_SYNC_QUIET_MS = 3500;
	function isWritingActive() {
		return Boolean(BUS.call("heft:is-writing"));
	}

	// Ein Durchgang zur Zeit; Anfragen währenddessen hängen genau einen weiteren an.
	function requestSync(forceAll = false) {
		if (!state.url || !core) return Promise.reject(new Error("Cloudflare-Sync ist nicht eingerichtet."));
		if (isOffline()) return Promise.reject(readable(new Error("Das Gerät ist offline.")));
		if (!forceAll && isWritingActive()) {
			scheduleSync();
			return Promise.resolve(false);
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
				if (error?.code === "stopped") return false;
				const e = readable(error);
				e.retryable = error?.retryable;
				PERF_PROFILER.error("cloudflare.sync-error", e, { phase: "requestSync", retryable: !!e.retryable });
				state.lastError = e.message;
				if (!scheduleHttpRetry(e)) setStatus("error", "Sync-Fehler", e.message);
				throw e;
			} finally { syncPromise = null; }
		})();
		return syncPromise;
	}

	function scheduleSync(event = null) {
		if (!core) return;
		if (isOffline()) {
			closeSocket();
			return;
		}
		clearTimeout(localTimer);
		const writing = isWritingActive();
		const delay = writing || (event?.type && String(event.type).startsWith("heft"))
			? HEFT_SYNC_QUIET_MS
			: LOCAL_SYNC_DELAY;
		localTimer = setTimeout(() => {
			if (isWritingActive()) {
				scheduleSync();
				return;
			}
			if (typeof requestIdleCallback === "function") {
				requestIdleCallback(() => requestSync().catch(() => {}), { timeout: 1000 });
			} else {
				requestSync().catch(() => {});
			}
		}, delay);
	}

	async function migrateLocalV4(snapshotInfo = null) {
		if (LS.getItem(LS_LOCAL_V4) === "1") return;
		if (typeof DB.replaceHeftHistory !== "function") throw new Error("Lokale v4-Migration fehlt in db.js.");
		const upToSeq = snapshotInfo?.maxSeq ?? snapshotInfo?.seq ?? (typeof STATE.loadedSeq === "function" ? STATE.loadedSeq() : 0);
		const defaultTime = snapshotInfo?.maxTime || snapshotInfo?.time || (typeof STATE.loadedTime === "function" ? STATE.loadedTime() : "") || U.now();
		const baselines = [];
		// Heft für Heft aus dem Kern holen – nie alle auf einmal im Speicher.
		for (const pageId of STATE.heftIds()) {
			const doc = STATE.heftDoc(pageId);
			const ops = heftBaselineOps(doc);
			if (!ops.length) continue;
			const hash = await sha256Hex(JSON.stringify(doc?.pages || []));
			const t = STATE.heftMeta(pageId)?.updated || defaultTime;
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
		if (!state.url || !core || isOffline()) return;
		reconnectTimer = setTimeout(connectWebSocket, CORE.reconnectDelayMs(++reconnectAttempts));
	}

	async function onSocketMessage(ws, text) {
		const type = (() => { try { return JSON.parse(text)?.type; } catch { return ""; } })();
		const { action, forceAll, message } = await core.handleServerMessage(text);
		if (socket !== ws) return;
		refreshState();
		if (type === "authenticated") {
			socketAuthenticated = true; reconnectAttempts = 0;
			setStatus("connected", "Live verbunden", "Echtzeit-Synchronisierung aktiv");
			clearInterval(pingTimer);
			pingTimer = setInterval(() => { if (socket === ws && ws.readyState === WebSocket.OPEN) ws.send(CORE.wsPingMessage()); }, CORE.wsPingIntervalMs());
		}
		if (action === "sync") requestSync(forceAll).catch(() => {});
		else if (action === "rejected") {
			state.lastError = message || "Nicht autorisiert"; setStatus("error", "Nicht autorisiert", state.lastError); closeSocket();
		}
	}

	function connectWebSocket() {
		if (typeof WebSocket === "undefined" || !core || !state.url || isOffline()) return;
		if (socket && [WebSocket.OPEN, WebSocket.CONNECTING].includes(socket.readyState)) return;
		clearTimeout(reconnectTimer); clearInterval(pingTimer);
		const ws = socket = new WebSocket(core.wsUrl);
		socketAuthenticated = false;

		ws.addEventListener("open", () => {
			if (socket !== ws) return;
			reconnectAttempts = 0;
			ws.send(core.wsAuthMessage);
		});
		ws.addEventListener("message", (event) => {
			if (socket !== ws) return;
			onSocketMessage(ws, String(event.data)).catch((error) => {
				PERF_PROFILER.error("cloudflare.websocket-error", error, { phase: "message" });
				console.error("[cf-sync] WebSocket-Nachricht ungültig:", error);
			});
		});
		ws.addEventListener("close", () => { if (socket !== ws) return; socket = null; socketAuthenticated = false; clearInterval(pingTimer); scheduleReconnect(); });
		ws.addEventListener("error", () => {});
	}

	// Beendet den laufenden Durchgang des alten Kontos, bevor ein neues übernimmt. Sonst gingen
	// die restlichen, mit dem alten Schlüssel verschlüsselten Pakete an das neue Konto.
	async function stopCurrent() {
		clearTimeout(localTimer); clearTimeout(retryTimer); retryTimer = 0; retryAttempts = 0;
		closeSocket();
		const old = core; core = null;
		old?.stop();
		if (syncPromise) await syncPromise.catch(() => {});
		old?.free();
	}

	async function configure(url, syncKey) {
		const cleanUrl = String(url || "").trim().replace(/\/+$/, ""), cleanKey = String(syncKey || "").trim();
		const generation = ++configureGeneration;
		await stopCurrent();
		if (generation !== configureGeneration) return false;
		state.url = cleanUrl; state.syncKey = cleanKey;
		cleanUrl ? LS.setItem(LS_URL, cleanUrl) : LS.removeItem(LS_URL);
		cleanKey ? LS.setItem(LS_KEY, cleanKey) : LS.removeItem(LS_KEY);
		if (!cleanUrl || !cleanKey) { setStatus("disconnected", "Nicht eingerichtet", "URL oder Sync-Schlüssel fehlt."); return false; }
		try {
			setStatus("connecting", "Verbindung wird aufgebaut…");
			const id = CORE.syncAuth(cleanKey).userId;
			const next = await CORE.SyncCore.open(cleanUrl, cleanKey, CLIENT_ID, http, storeFor(id), (label, current, total) => {
				if (generation === configureGeneration) setProgress(label, current, total);
			});
			if (generation !== configureGeneration) { next.free(); return false; }
			core = next;
			refreshState();
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
		configureGeneration++;
		void stopCurrent();
		// Der Schlüssel muss mit weg: init() verband sich sonst beim nächsten Start still wieder.
		state.syncKey = ""; LS.removeItem(LS_KEY);
		setStatus("disconnected", "Getrennt");
	}

	// Belegt den Platz des Durchgangs: Der Kern führt immer nur einen Ablauf zur Zeit aus.
	// Was währenddessen angefragt wird, läuft danach als normaler Durchgang.
	async function exclusive(task) {
		while (syncPromise) await syncPromise.catch(() => {});
		if (!core) throw new Error("Cloudflare-Sync ist nicht eingerichtet.");
		const run = task(core);
		syncPromise = run.then(() => true, () => false).finally(() => {
			syncPromise = null;
			if (syncAgain) requestSync().catch(() => {});
		});
		try { return await run; } finally { refreshState(); emit(); }
	}

	// Generationsschnitt: löscht alle Pakete und Dateien auf dem Server.
	async function purgeCloudData() {
		if (!core) return false;
		await exclusive((c) => c.resetCloud());
		return true;
	}

	// Cloud-Kompaktierung im Kern (abgleichen, Generationsschnitt, Neuaufbau).
	const compactCloud = (bypassCooldown = false) => exclusive((c) => c.compactCloud(!!bypassCooldown));

	// Nur Events, die tatsächlich hochgeladen werden, brauchen einen Sync-Lauf. Reine UI-Events
	// (Tab-Wechsel, Ordner auf/zu) lösten sonst jedes Mal einen Netz-Abgleich aus.
	STATE.onAfterDispatch((ev) => { if (core?.noteLocalEvent(ev)) scheduleSync(ev); });

	function init() {
		if (initialized) return;
		initialized = true;
		if (typeof window !== "undefined") {
			window.addEventListener("offline", () => { closeSocket(); clearTimeout(localTimer); clearTimeout(reconnectTimer); });
			window.addEventListener("online", () => { clearTimeout(retryTimer); retryTimer = 0; connectWebSocket(); requestSync().catch(() => {}); });
			window.addEventListener("visibilitychange", () => {
				if (document.hidden) {
					closeSocket();
				} else if (core) {
					clearTimeout(reconnectTimer);
					clearTimeout(retryTimer);
					connectWebSocket();
					requestSync().catch(() => {});
				}
			});
			window.addEventListener("freeze", () => { closeSocket(); });
			window.addEventListener("resume", () => {
				if (core && !document.hidden) {
					connectWebSocket();
					requestSync().catch(() => {});
				}
			});
		}
		void (async () => {
			try { await migrateLocalV4(); }
			catch (error) {
				PERF_PROFILER.error("cloudflare.migration-error", error, { phase: "init" });
				state.lastError = error?.message || String(error); setStatus("error", "Migration fehlgeschlagen", state.lastError); return;
			}
			if (state.url && state.syncKey) configure(state.url, state.syncKey).catch(() => {});
		})();
	}

	async function generateSyncKey() {
		return CORE.generateSyncKey();
	}


	return {
		init, configure, disconnect, syncNow: () => requestSync(false), purgeCloudData, compactCloud,
		generateSyncKey, status: () => ({ ...state }),
		isConfigured: () => !!(state.url && (core || state.syncKey)),
		migrateLocalV4,
	};
})();
