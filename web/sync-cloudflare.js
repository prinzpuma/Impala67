"use strict";

import { S, STATE } from "./state.js";
import { DB } from "./db.js";
import { U } from "./util.js";
import { SETTINGS_SYNC } from "./settings-sync.js";
import { pruneEventsForUpload } from "./sync-core.js";
import {
	deriveSyncCredentials,
	encryptPayload,
	decryptPayload,
	formatStorageUsage,
	generateSyncKey,
	MAX_USER_STORAGE_BYTES,
} from "./sync-crypto.js";

/**
 * Cloudflare Real-Time Sync Engine für Impala67 (Production Grade)
 * 
 * - 100 % Local-First & E2EE verschlüsselt (AES-GCM 256)
 * - Durable Objects / WebSockets für Live-Sync zwischen Geräten (< 50 ms)
 * - Kryptografischer Zugriffsnachweis (Auth-Token) gegen unbefugten Zugriff
 * - Robuste Paginierung: Lädt verpasste Events in 500er-Batches lückenlos nach
 * - Delta-Upload-Tracking: Verhindert Mehrfach-Uploads bereits gesendeter Events
 * - Quota-Überwachung (500 MB Limit)
 */
export const DEFAULT_WORKER_URL = "https://impala67-sync.joshuagayer1.workers.dev";

export const CLOUDFLARE_SYNC = (() => {
	const LS = typeof localStorage !== "undefined" ? localStorage : {
		getItem: () => null,
		setItem: () => {},
		removeItem: () => {},
	};

	const LS_URL_KEY = "impala67_cf_server_url";
	const LS_KEY_KEY = "impala67_cf_sync_key";
	const LS_LAST_SEQ_KEY = "impala67_cf_last_seq";
	const LS_LAST_UPLOADED_LOCAL_SEQ = "impala67_cf_last_uploaded_local_seq";

	let socket = null;
	let pingTimer = null;
	let reconnectTimer = null;
	let reconnectAttempts = 0;
	let credentials = null; // { userId, authToken, cryptoKey }
	let socketAuthenticated = false;
	let configureGeneration = 0;
	let remoteApplyChain = Promise.resolve();
	let syncInFlight = false;
	let initialized = false;

	let state = {
		status: "disconnected", // "disconnected" | "connecting" | "connected" | "syncing" | "error"
		label: "Nicht eingerichtet",
		detail: "Verbinde einen Cloudflare-Sync-Server",
		url: LS.getItem(LS_URL_KEY) || DEFAULT_WORKER_URL,
		syncKey: LS.getItem(LS_KEY_KEY) || "",
		lastSyncedSeq: Number(LS.getItem(LS_LAST_SEQ_KEY)) || 0,
		lastUploadedLocalSeq: Number(LS.getItem(LS_LAST_UPLOADED_LOCAL_SEQ)) || 0,
		usage: { bytes: 0, limit: MAX_USER_STORAGE_BYTES, percent: 0, formatted: "0.0 MB / 500 MB (0 %)" },
		lastError: null,
	};

	function emitStatus() {
		if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
			window.dispatchEvent(new CustomEvent("impala67:cloudflare-sync-status", { detail: { ...state } }));
		}
	}

	function setStatus(status, label, detail = "") {
		state.status = status;
		state.label = label;
		state.detail = detail || label;
		emitStatus();
	}

	function getWsUrl(httpUrl, userId) {
		const clean = String(httpUrl || "").trim().replace(/\/+$/, "");
		const wsProto = clean.startsWith("https:") ? "wss:" : "ws:";
		const host = clean.replace(/^https?:\/\//i, "");
		return `${wsProto}//${host}/ws?user=${encodeURIComponent(userId)}`;
	}

	function getApiUrl(httpUrl, endpoint) {
		const clean = String(httpUrl || "").trim().replace(/\/+$/, "");
		if (!credentials?.userId) return `${clean}${endpoint}`;
		const sep = endpoint.includes("?") ? "&" : "?";
		return `${clean}${endpoint}${sep}user=${encodeURIComponent(credentials.userId)}`;
	}

	function getAuthHeaders() {
		if (!credentials) return {};
		return {
			"X-User-Id": credentials.userId,
			"Authorization": `Bearer ${credentials.authToken}`,
		};
	}

	/**
	 * Richtet Zugangsdaten ein und startet den Sync
	 */
	async function configure(url, syncKey) {
		const cleanUrl = String(url || "").trim().replace(/\/+$/, "");
		const cleanKey = String(syncKey || "").trim();
		const generation = ++configureGeneration;
		const connectionChanged = state.url !== cleanUrl || state.syncKey !== cleanKey;
		if (connectionChanged) {
			closeSocket();
			credentials = null;
		}

		if (cleanUrl) LS.setItem(LS_URL_KEY, cleanUrl);
		else LS.removeItem(LS_URL_KEY);

		if (cleanKey) LS.setItem(LS_KEY_KEY, cleanKey);
		else LS.removeItem(LS_KEY_KEY);

		state.url = cleanUrl;
		state.syncKey = cleanKey;

		if (!cleanUrl || !cleanKey) {
			disconnect();
			setStatus("disconnected", "Nicht eingerichtet", "URL oder Sync-Schlüssel fehlt.");
			return false;
		}

		try {
			setStatus("connecting", "Verbindung wird aufgebaut…");
			credentials = await deriveSyncCredentials(cleanKey);
			if (generation !== configureGeneration) return false;
			// Cursor gehören zum jeweiligen Sync-Kanal. Ein alter globaler Cursor
			// darf beim Schlüsselwechsel keine Ereignisse überspringen.
			state.lastSyncedSeq = Number(LS.getItem(lastSyncedKey())) || 0;
			state.lastUploadedLocalSeq = Number(LS.getItem(lastUploadedKey())) || 0;
			connectWebSocket();
			await catchUp();
			return true;
		} catch (e) {
			state.lastError = e.message || String(e);
			setStatus("error", "Einrichtungsfehler", state.lastError);
			return false;
		}
	}

	/**
	 * Baut die WebSocket-Verbindung mit In-Band Auth auf
	 */
	function closeSocket() {
		clearTimeout(reconnectTimer);
		clearInterval(pingTimer);
		socketAuthenticated = false;
		const oldSocket = socket;
		socket = null;
		if (oldSocket) {
			try { oldSocket.close(); } catch {}
		}
	}

	function connectWebSocket() {
		if (typeof WebSocket === "undefined" || !state.url || !credentials) return;
		if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
			return;
		}

		clearTimeout(reconnectTimer);
		clearInterval(pingTimer);

		try {
			const wsUrl = getWsUrl(state.url, credentials.userId);
			socket = new WebSocket(wsUrl);
			const currentSocket = socket;
			socketAuthenticated = false;

			socket.addEventListener("open", () => {
				if (socket !== currentSocket) return;
				reconnectAttempts = 0;
				// In-Band Auth: Token wird geschützt über den WebSocket-Kanal übertragen, nicht in der URL!
				socket.send(JSON.stringify({ type: "auth", token: credentials.authToken }));
			});

			socket.addEventListener("message", async (event) => {
				if (socket !== currentSocket) return;
				try {
					const msg = JSON.parse(event.data);
					if (msg.type === "authenticated") {
						socketAuthenticated = true;
						setStatus("connected", "Live verbunden", "Echtzeit-Synchronisierung aktiv");
						startHeartbeat();
						catchUp().catch((e) => console.warn("[cf-sync] Catch-up nach Reconnect fehlgeschlagen:", e));
						return;
					}
					if (msg.type === "unauthorized") {
						state.lastError = msg.error || "Nicht autorisiert";
						setStatus("error", "Nicht autorisiert", "Sync-Schlüssel stimmt nicht mit dem Server überein.");
						disconnect();
						return;
					}
					if (msg.type === "pong") return;
					if (msg.type === "event" && msg.event) {
						await handleIncomingRemoteEvent(msg.event);
					}
					if (msg.type === "ack") {
						if (msg.seq > state.lastSyncedSeq) {
							state.lastSyncedSeq = msg.seq;
							LS.setItem(LS_LAST_SEQ_KEY, String(msg.seq));
						}
						if (msg.usage !== undefined) {
							state.usage = formatStorageUsage(msg.usage);
							emitStatus();
						}
					}
					if (msg.type === "error") {
						state.lastError = msg.error;
						if (msg.usage !== undefined) state.usage = formatStorageUsage(msg.usage);
						setStatus("error", "Sync-Fehler", msg.error);
					}
				} catch (e) {
					console.error("[cf-sync] Fehler beim Verarbeiten der Nachricht:", e);
				}
			});

			socket.addEventListener("close", () => {
				if (socket !== currentSocket) return;
				clearInterval(pingTimer);
				socketAuthenticated = false;
				socket = null;
				if (state.url && credentials) {
					scheduleReconnect();
				} else {
					setStatus("disconnected", "Getrennt");
				}
			});

			socket.addEventListener("error", (err) => {
				console.warn("[cf-sync] WebSocket-Fehler:", err);
			});
		} catch (e) {
			console.warn("[cf-sync] Fehler beim Erstellen des WebSockets:", e);
			scheduleReconnect();
		}
	}

	function startHeartbeat() {
		clearInterval(pingTimer);
		pingTimer = setInterval(() => {
			if (socketAuthenticated && socket && socket.readyState === WebSocket.OPEN) {
				socket.send(JSON.stringify({ type: "ping" }));
			}
		}, 30000);
	}

	function scheduleReconnect() {
		clearTimeout(reconnectTimer);
		reconnectAttempts++;
		const delay = Math.min(30000, 1000 * Math.pow(1.5, reconnectAttempts));
		setStatus("connecting", `Verbinde erneut (${reconnectAttempts})…`);
		reconnectTimer = setTimeout(() => {
			if (state.url && credentials) connectWebSocket();
		}, delay);
	}

	function disconnect() {
		configureGeneration++;
		closeSocket();
		credentials = null;
		setStatus("disconnected", "Getrennt");
	}

	/**
	 * Verarbeitet ein einzelnes eingetroffenes Remote-Event
	 */
	function enqueueRemoteApply(task) {
		const run = remoteApplyChain.then(task, task);
		remoteApplyChain = run.catch(() => {});
		return run;
	}

	async function applyIncomingRemoteEvent(encryptedEvent) {
		if (!credentials || !encryptedEvent) return;

		try {
			const rawEvent = await decryptPayload(credentials.cryptoKey, encryptedEvent);
			if (!rawEvent || !rawEvent.id || !rawEvent.type) return;

			const localEvents = await DB.allEvents();
			const exists = localEvents.some((e) => e.id === rawEvent.id);
			if (exists) {
				if (encryptedEvent.seq > state.lastSyncedSeq) {
					state.lastSyncedSeq = encryptedEvent.seq;
					LS.setItem(LS_LAST_SEQ_KEY, String(encryptedEvent.seq));
				}
				return;
			}

			if (rawEvent.type === "heftOps" || rawEvent.type === "heftSnap") {
				if (typeof window !== "undefined" && window.HEFT && typeof window.HEFT.saveNow === "function") {
					try { await window.HEFT.saveNow(); } catch (e) { console.warn("[cf-sync] Heft-Flush vor Remote-Event fehlgeschlagen:", e); }
				}
			}

			await DB.addEvents([rawEvent]);
			STATE.applyRemoteEvents([rawEvent]);

			if (encryptedEvent.seq > state.lastSyncedSeq) {
				state.lastSyncedSeq = encryptedEvent.seq;
				LS.setItem(LS_LAST_SEQ_KEY, String(encryptedEvent.seq));
			}
		} catch (e) {
			console.error("[cf-sync] Fehler beim Entschlüsseln/Anwenden des Remote-Events:", e);
		}
	}

	function handleIncomingRemoteEvent(encryptedEvent) {
		return enqueueRemoteApply(() => applyIncomingRemoteEvent(encryptedEvent));
	}

	const lastUploadedKey = () => (credentials?.userId ? `${LS_LAST_UPLOADED_LOCAL_SEQ}_${credentials.userId}` : LS_LAST_UPLOADED_LOCAL_SEQ);
	const lastSyncedKey = () => (credentials?.userId ? `${LS_LAST_SEQ_KEY}_${credentials.userId}` : LS_LAST_SEQ_KEY);

	/**
	 * Holt verpasste Events seit `lastSyncedSeq` vom Server mit lückenloser Paginierung
	 */
	async function catchUp(forceAll = false) {
		if (!state.url || !credentials || syncInFlight) return;
		syncInFlight = true;
		setStatus("syncing", "Synchronisiere…");

		try {
			let hasMore = true;
			const PAGE_LIMIT = 500;

			// Paginierungs-Schleife: Holt auch tausende verpasste Events in 500er-Batches lückenlos ab
			while (hasMore) {
				const since = state.lastSyncedSeq;
				const apiUrl = getApiUrl(state.url, `/api/sync?since=${since}&limit=${PAGE_LIMIT}`);

				const response = await fetch(apiUrl, {
					headers: getAuthHeaders(),
				});

				if (!response.ok) {
					throw new Error(`Server antwortete mit Status ${response.status}`);
				}

				const data = await response.json();
				const remoteEvents = data.events || [];

				if (remoteEvents.length) {
					const decryptedEvents = [];
					for (const item of remoteEvents) {
						try {
							const ev = await decryptPayload(credentials.cryptoKey, item);
							if (ev && ev.id) decryptedEvents.push(ev);
						} catch (err) {
							console.warn("[cf-sync] Event konnte nicht entschlüsselt werden:", err);
						}
					}

					if (decryptedEvents.length) await enqueueRemoteApply(async () => {
						const localEvents = await DB.allEvents();
						const existingIds = new Set(localEvents.map((e) => e.id));
						const fresh = decryptedEvents.filter((e) => !existingIds.has(e.id));

						if (fresh.length) {
							if (fresh.some((ev) => ev.type === "heftOps" || ev.type === "heftSnap")) {
								if (typeof window !== "undefined" && window.HEFT && typeof window.HEFT.saveNow === "function") {
									try { await window.HEFT.saveNow(); } catch {}
								}
							}
							await DB.addEvents(fresh);
							STATE.applyRemoteEvents(fresh);
						}
					});

					// Letzte Sequenznummer der geladenen Seite sichern
					const lastSeqInBatch = remoteEvents[remoteEvents.length - 1].seq;
					if (lastSeqInBatch > state.lastSyncedSeq) {
						state.lastSyncedSeq = lastSeqInBatch;
						LS.setItem(lastSyncedKey(), String(lastSeqInBatch));
					}
				}

				if (data.usage !== undefined) {
					state.usage = formatStorageUsage(data.usage, data.limit);
				}

				hasMore = Boolean(data.hasMore && remoteEvents.length > 0);
			}
			await remoteApplyChain;

			// Auch lokale ungesyncte Änderungen hochladen (bei leerem Server oder forceAll: ALLE)
			await pushUnsyncedLocalEvents(forceAll);

			setStatus("connected", "Live verbunden", "Aktueller Stand synchronisiert");
		} catch (e) {
			state.lastError = e.message || String(e);
			setStatus("error", "Sync-Fehler", state.lastError);
		} finally {
			syncInFlight = false;
		}
	}

	/**
	 * Sendet lokale Events, die seit dem letzten Upload entstanden sind (Delta-Upload)
	 * Bei leerem Server (lastSyncedSeq = 0) oder forceAll = true werden die Notizen kompakt & speicherschonend hochgeladen.
	 */
	async function pushUnsyncedLocalEvents(forceAll = false) {
		if (!state.url || !credentials) return;
		const localEvents = await DB.allEvents();
		const localMaxSeq = await DB.maxSeq();
		const lastUploadedSeq = Number(LS.getItem(lastUploadedKey())) || 0;

		const isInitialPush = forceAll || state.lastSyncedSeq === 0 || lastUploadedSeq === 0;
		// Bei Initial-Push: Vorm Kompaktieren bereinigen, damit nicht tausende alte Tastenanschläge den RAM sprengen
		const sourceEvents = isInitialPush ? DB.compactEvents(localEvents) : localEvents.filter((e) => (e.seq || 0) > lastUploadedSeq);
		if (!sourceEvents.length) return;

		const transportEvents = pruneEventsForUpload(DB.filterEventsForSync(
			SETTINGS_SYNC.sanitizeEvents(sourceEvents, SETTINGS_SYNC.allowsSecrets(S.settings))
		));

		const total = transportEvents.length;
		if (!total) {
			LS.setItem(lastUploadedKey(), String(localMaxSeq));
			state.lastUploadedLocalSeq = localMaxSeq;
			return;
		}

		const apiUrl = getApiUrl(state.url, "/api/events");
		// Speichereffizient in 50er-Chunks: Nie die gesamte Sammlung auf einmal im RAM halten!
		const CHUNK_SIZE = 50;
		for (let i = 0; i < total; i += CHUNK_SIZE) {
			const chunk = transportEvents.slice(i, i + CHUNK_SIZE);
			const encryptedBatch = [];

			for (const ev of chunk) {
				const enc = await encryptPayload(credentials.cryptoKey, ev);
				encryptedBatch.push({
					id: ev.id,
					iv: enc.iv,
					data: enc.data,
					size: enc.size,
				});
			}

			const response = await fetch(apiUrl, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					...getAuthHeaders(),
				},
				body: JSON.stringify({ events: encryptedBatch }),
			});

			if (response.ok) {
				const resData = await response.json();
				if (resData.maxSeq > state.lastSyncedSeq) {
					state.lastSyncedSeq = resData.maxSeq;
					LS.setItem(lastSyncedKey(), String(resData.maxSeq));
				}
				if (resData.usage !== undefined) {
					state.usage = formatStorageUsage(resData.usage, resData.limit);
				}
			} else if (response.status === 413) {
				const errData = await response.json().catch(() => ({}));
				throw new Error(errData.error || "500 MB Speicherlimit auf Cloudflare erreicht.");
			} else {
				const errData = await response.json().catch(() => ({}));
				throw new Error(errData.error || `Upload fehlgeschlagen (Status ${response.status})`);
			}

			const current = Math.min(total, i + CHUNK_SIZE);
			const percent = Math.round((current / total) * 100);
			state.progress = { current, total, percent };
			setStatus("syncing", "Synchronisiere…", `Übertrage ${current} von ${total} Elementen (${percent} %)`);

			// Garbage Collector und UI kurz atmen lassen (verhindert OOM / UI-Freeze)
			await new Promise((r) => setTimeout(r, 15));
		}

		LS.setItem(lastUploadedKey(), String(localMaxSeq));
		state.lastUploadedLocalSeq = localMaxSeq;
		state.progress = null;
		emitStatus();
	}

	/**
	 * Sendet ein einzelnes neues Event live über WebSocket
	 */
	async function sendEventLive(ev) {
		if (!credentials || !ev || !ev.id) return;
		if (ev.type === "uiTabsSet" || ev.type === "uiTreeSet") return;

		try {
			const encrypted = await encryptPayload(credentials.cryptoKey, ev);
			const packet = {
				id: ev.id,
				iv: encrypted.iv,
				data: encrypted.data,
				size: encrypted.size,
			};

			if (socketAuthenticated && socket && socket.readyState === WebSocket.OPEN) {
				socket.send(JSON.stringify({ type: "event", event: packet }));
			} else if (state.url) {
				const apiUrl = getApiUrl(state.url, "/api/events");
				fetch(apiUrl, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						...getAuthHeaders(),
					},
					body: JSON.stringify({ events: [packet] }),
				}).then(async (r) => {
					if (r.ok) {
						const res = await r.json();
						if (res.usage !== undefined) {
							state.usage = formatStorageUsage(res.usage, res.limit);
							emitStatus();
						}
					}
				}).catch(() => {});
			}
		} catch (e) {
			console.warn("[cf-sync] Fehler beim Live-Senden des Events:", e);
		}
	}

	/**
	 * Löscht die Daten auf dem Cloudflare-Server
	 */
	async function purgeCloudData() {
		if (!state.url || !credentials) return false;
		try {
			const apiUrl = getApiUrl(state.url, "/api/reset");
			const response = await fetch(apiUrl, {
				method: "POST",
				headers: getAuthHeaders(),
			});
			if (response.ok) {
				state.lastSyncedSeq = 0;
				state.lastUploadedLocalSeq = 0;
				LS.setItem(LS_LAST_SEQ_KEY, "0");
				LS.setItem(LS_LAST_UPLOADED_LOCAL_SEQ, "0");
				state.usage = formatStorageUsage(0);
				emitStatus();
				return true;
			}
			return false;
		} catch (e) {
			console.error("[cf-sync] Fehler beim Löschen der Cloud-Daten:", e);
			return false;
		}
	}

	/**
	 * Initialisierung beim App-Start
	 */
	function init() {
		if (initialized) return;
		initialized = true;

		STATE.onAfterDispatch((ev) => {
			if (credentials && socket && socket.readyState === WebSocket.OPEN) {
				sendEventLive(ev);
			}
		});

		if (typeof window !== "undefined") {
			window.addEventListener("online", () => {
				if (state.url && credentials) connectWebSocket();
			});

			window.addEventListener("visibilitychange", () => {
				if (!document.hidden && state.url && credentials) {
					if (!socket || socket.readyState !== WebSocket.OPEN) connectWebSocket();
					else catchUp();
				}
			});
		}

		if (state.url && state.syncKey) {
			configure(state.url, state.syncKey).catch(() => {});
		}
	}

	return {
		init,
		configure,
		disconnect,
		catchUp: (forceAll = false) => catchUp(forceAll),
		syncNow: () => catchUp(true),
		purgeCloudData,
		generateSyncKey,
		status: () => ({ ...state }),
	};
})();
