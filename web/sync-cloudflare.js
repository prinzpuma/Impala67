"use strict";

import { S, STATE } from "./state.js";
import { DB } from "./db.js";
import { U } from "./util.js";
import { SETTINGS_SYNC } from "./settings-sync.js";
import { CLOUD_SYNC_PROTOCOL, CLOUD_SYNC_PROTOCOL_HEADER, chunkCloudEvents, cloudEventEnvelope, cloudEventsEnvelope, encryptedPacketChars, prepareCloudEvents, prepareIncomingCloudEvents, pruneEventsForUpload } from "./sync-core.js";
import {
	deriveSyncCredentials,
	encryptPayload,
	decryptPayload,
	formatStorageUsage,
	generateSyncKey,
	MAX_USER_STORAGE_BYTES,
	sha256Hex,
} from "./sync-crypto.js";

/**
 * Cloudflare Real-Time Sync Engine für Impala67 (Production Grade)
 * 
 * - 100 % Local-First & E2EE verschlüsselt (AES-GCM 256)
 * - Durable Objects / WebSockets für Live-Sync zwischen Geräten (< 50 ms)
 * - Kryptografischer Zugriffsnachweis (Auth-Token) gegen unbefugten Zugriff
 * - Robuste Paginierung: Lädt verpasste Events in 500er-Batches lückenlos nach
 * - Delta-Upload-Tracking: Verhindert Mehrfach-Uploads bereits gesendeter Events
 * - Quota-Überwachung (1.000 MB Limit)
 */
export const DEFAULT_WORKER_URL = "https://impala67-sync.joshuagayer1.workers.dev";

const LS_URL_KEY = "impala67_cf_server_url";
const LS_KEY_KEY = "impala67_cf_sync_key";
const LS_LAST_SEQ_KEY = "impala67_cf_last_seq";
const LS_LAST_UPLOADED_LOCAL_SEQ = "impala67_cf_last_uploaded_local_seq";

export function syncCursorStorageKeys(userId) {
	const channel = String(userId || "").trim();
	if (!channel) throw new Error("Sync-Cursor benötigen eine User-ID.");
	return {
		lastSynced: `${LS_LAST_SEQ_KEY}_${channel}`,
		lastUploaded: `${LS_LAST_UPLOADED_LOCAL_SEQ}_${channel}`,
	};
}

export function resetSyncCursorStorage(storage, userId) {
	const keys = syncCursorStorageKeys(userId);
	storage.setItem(keys.lastSynced, "0");
	storage.setItem(keys.lastUploaded, "0");
}

export const CLOUDFLARE_SYNC = (() => {
	const LS = typeof localStorage !== "undefined" ? localStorage : {
		getItem: () => null,
		setItem: () => {},
		removeItem: () => {},
	};

	let socket = null;
	let pingTimer = null;
	let reconnectTimer = null;
	let reconnectAttempts = 0;
	let credentials = null; // { userId, authToken, cryptoKey }
	let socketAuthenticated = false;
	let configureGeneration = 0;
	let remoteApplyChain = Promise.resolve();
	let syncPromise = null;
	let localEventIds = null;
	let initialized = false;

	let state = {
		status: "disconnected", // "disconnected" | "connecting" | "connected" | "syncing" | "error"
		label: "Nicht eingerichtet",
		detail: "Verbinde einen Cloudflare-Sync-Server",
		url: LS.getItem(LS_URL_KEY) || DEFAULT_WORKER_URL,
		syncKey: LS.getItem(LS_KEY_KEY) || "",
		lastSyncedSeq: 0,
		lastUploadedLocalSeq: 0,
		usage: { bytes: 0, limit: MAX_USER_STORAGE_BYTES, percent: 0, formatted: "0.0 MB / 1000 MB (0 %)" },
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

	function resetSyncCursors() {
		state.lastSyncedSeq = 0;
		state.lastUploadedLocalSeq = 0;
		if (credentials?.userId) resetSyncCursorStorage(LS, credentials.userId);
		state.usage = formatStorageUsage(0);
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
			[CLOUD_SYNC_PROTOCOL_HEADER]: String(CLOUD_SYNC_PROTOCOL),
		};
	}

	async function responseError(response, fallback) {
		let serverMessage = "";
		try {
			const data = await response.json();
			serverMessage = typeof data?.error === "string" ? data.error.trim() : "";
		} catch {}
		return new Error(serverMessage || `${fallback} (Status ${response.status})`);
	}

	function readableSyncError(error) {
		const message = (error && error.message) ? error.message : String(error || "Sync-Fehler aufgetreten");
		if (typeof navigator !== "undefined" && navigator.onLine === false) {
			return new Error("Das Gerät ist offline. Der lokale Stand bleibt erhalten und wird später synchronisiert.");
		}
		if (/failed to fetch|load failed|networkerror|network request failed/i.test(message)) {
			return new Error("Der Cloudflare-Server ist nicht erreichbar. Prüfe Worker-URL, Veröffentlichung und CORS-Konfiguration.");
		}
		return error instanceof Error ? error : new Error(message);
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
			state.lastSyncedSeq = Number(LS.getItem(lastSyncedKey())) || 0;
			state.lastUploadedLocalSeq = Number(LS.getItem(lastUploadedKey())) || 0;
			LS.setItem(lastSyncedKey(), String(state.lastSyncedSeq));
			LS.setItem(lastUploadedKey(), String(state.lastUploadedLocalSeq));
			await catchUp();
			if (generation !== configureGeneration) return false;
			connectWebSocket();
			return true;
		} catch (e) {
			state.lastError = (e && e.message) ? e.message : String(e || "Einrichtungsfehler aufgetreten");
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
				socket.send(JSON.stringify({ type: "auth", protocol: CLOUD_SYNC_PROTOCOL, token: credentials.authToken }));
			});

			socket.addEventListener("message", async (event) => {
				if (socket !== currentSocket) return;
				try {
					const msg = JSON.parse(event.data);
					if (msg.type === "authenticated") {
						if (msg.protocol !== CLOUD_SYNC_PROTOCOL) throw new Error("Cloudflare-Worker verwendet ein anderes Sync-Protokoll.");
						socketAuthenticated = true;
						setStatus("connected", "Live verbunden", "Echtzeit-Synchronisierung aktiv");
						startHeartbeat();
						catchUp().catch((e) => console.warn("[cf-sync] Catch-up nach Reconnect fehlgeschlagen:", e));
						return;
					}
					if (msg.type === "unauthorized") {
						closeSocket();
						state.lastError = msg.error || "Nicht autorisiert";
						setStatus("error", "Nicht autorisiert", "Sync-Schlüssel stimmt nicht mit dem Server überein.");
						return;
					}
					if (msg.type === "unsupported_protocol") {
						closeSocket();
						state.lastError = msg.error || `Sync-Protokoll v${CLOUD_SYNC_PROTOCOL} erforderlich.`;
						setStatus("error", "Update erforderlich", state.lastError);
						return;
					}
					if (msg.type === "pong") return;
					if (msg.type === "reset") {
						// Auch weitere verbundene Geraete muessen den vom Server
						// zurueckgesetzten Kanalstand kennen.
						resetSyncCursors();
						return;
					}
					if (msg.type === "event" && msg.event) {
						await handleIncomingRemoteEvent(msg.event);
					}
					if (msg.type === "ack") {
						if (msg.seq > state.lastSyncedSeq) {
							state.lastSyncedSeq = msg.seq;
							LS.setItem(lastSyncedKey(), String(msg.seq));
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
			const rawEvents = prepareIncomingCloudEvents([await decryptPayload(credentials.cryptoKey, encryptedEvent)])
				.filter((event) => event?.id && event?.type);
			if (!rawEvents.length) return;

			localEventIds ??= new Set(await DB.eventIds());
			const fresh = rawEvents.filter((event) => !localEventIds.has(event.id));

			if (fresh.some((event) => event.type === "heftOps" || event.type === "heftSnap")) {
				if (typeof window !== "undefined" && window.HEFT && typeof window.HEFT.saveNow === "function") {
					try { await window.HEFT.saveNow(); } catch (e) { console.warn("[cf-sync] Heft-Flush vor Remote-Event fehlgeschlagen:", e); }
				}
			}

			if (fresh.length) {
				await DB.addEvents(fresh);
				for (const event of fresh) localEventIds.add(event.id);
				STATE.applyRemoteEvents(fresh);
			}

			if (encryptedEvent.seq > state.lastSyncedSeq) {
				state.lastSyncedSeq = encryptedEvent.seq;
				LS.setItem(lastSyncedKey(), String(encryptedEvent.seq));
			}
		} catch (e) {
			console.error("[cf-sync] Fehler beim Entschlüsseln/Anwenden des Remote-Events:", e);
		}
	}

	function handleIncomingRemoteEvent(encryptedEvent) {
		return enqueueRemoteApply(() => applyIncomingRemoteEvent(encryptedEvent));
	}

	const lastUploadedKey = () => syncCursorStorageKeys(credentials?.userId).lastUploaded;
	const lastSyncedKey = () => syncCursorStorageKeys(credentials?.userId).lastSynced;

	/**
	 * Holt verpasste Events seit `lastSyncedSeq` vom Server in kleinen, iPad-tauglichen Seiten
	 */
	async function runCatchUp(forceAll = false) {
		setStatus("syncing", "Synchronisiere…");

		try {
			// Nur IDs einlesen und über den gesamten Lauf wiederverwenden. Zuvor
			// wurde pro Seite das komplette lokale Event-Log erneut in den RAM geladen.
			localEventIds = new Set(await DB.eventIds());
			let hasMore = true;
			const PAGE_LIMIT = 100;

			// Paginierungs-Schleife: Holt auch tausende verpasste Events lückenlos ab.
			while (hasMore) {
				const since = state.lastSyncedSeq;
				const apiUrl = getApiUrl(state.url, `/api/sync?since=${since}&limit=${PAGE_LIMIT}`);

				const response = await fetch(apiUrl, {
					headers: getAuthHeaders(),
				});

				if (!response.ok) {
					throw await responseError(response, "Abruf vom Cloudflare-Server fehlgeschlagen");
				}

				const data = await response.json();
				if (typeof data.maxSeq === "number" && (since > data.maxSeq || (data.maxSeq === 0 && (state.lastSyncedSeq > 0 || state.lastUploadedLocalSeq > 0)))) {
					resetSyncCursors();
					return runCatchUp(true);
				}
				const remoteEvents = data.events || [];

				if (remoteEvents.length) {
					const decryptedEvents = [];
					for (const item of remoteEvents) {
						try {
							const envelope = await decryptPayload(credentials.cryptoKey, item);
							const prepared = prepareIncomingCloudEvents([envelope]);
							decryptedEvents.push(...prepared.filter((event) => event?.id && event?.type));
						} catch (err) {
							// Cursor nicht über ein unlesbares Event hinwegschieben. Sonst wäre
							// dieses Event auf dem Gerät dauerhaft verloren.
							throw new Error(`Cloud-Event ${item.seq || "?"} konnte nicht entschlüsselt werden. Der Sync-Fortschritt wurde nicht verändert.`, { cause: err });
						}
					}

					if (decryptedEvents.length) await enqueueRemoteApply(async () => {
						const fresh = decryptedEvents.filter((e) => !localEventIds.has(e.id));

						if (fresh.length) {
							if (fresh.some((ev) => ev.type === "heftOps" || ev.type === "heftSnap")) {
								if (typeof window !== "undefined" && window.HEFT && typeof window.HEFT.saveNow === "function") {
									try { await window.HEFT.saveNow(); } catch {}
								}
							}
							await DB.addEvents(fresh);
							for (const ev of fresh) localEventIds.add(ev.id);
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
			state.lastError = null;
			return true;
		} catch (e) {
			const error = readableSyncError(e);
			state.lastError = error.message;
			setStatus("error", "Sync-Fehler", state.lastError);
			throw error;
		}
	}

	async function catchUp(forceAll = false) {
		if (!state.url || !credentials) {
			throw new Error("Cloudflare-Sync ist nicht eingerichtet.");
		}
		if (syncPromise) return syncPromise;
		syncPromise = runCatchUp(forceAll);
		try {
			return await syncPromise;
		} finally {
			syncPromise = null;
		}
	}

	/**
	 * Sendet lokale Events, die seit dem letzten Upload entstanden sind (Delta-Upload)
	 * Bei leerem Server (lastSyncedSeq = 0) oder forceAll = true werden die Notizen kompakt & speicherschonend hochgeladen.
	 */
	async function pushUnsyncedLocalEvents(forceAll = false) {
		if (!state.url || !credentials) return;
		const localEvents = await DB.allEvents();
		// Cursor exakt an den gelesenen Snapshot binden. Ein Event, das zwischen
		// allEvents() und einem zweiten DB-Read entsteht, darf nicht übersprungen werden.
		const localMaxSeq = localEvents.reduce((max, ev) => Math.max(max, Number(ev?.seq) || 0), 0);
		const lastUploadedSeq = Number(LS.getItem(lastUploadedKey())) || 0;

		const isInitialPush = Boolean(forceAll || state.lastSyncedSeq === 0);
		// Bei Initial-Push: Vorm Kompaktieren bereinigen, damit nicht tausende alte Tastenanschläge den RAM sprengen
		const sourceEvents = isInitialPush ? DB.compactEvents(localEvents) : localEvents.filter((e) => (e.seq || 0) > lastUploadedSeq);
		if (!sourceEvents.length) return;

		const transportEvents = prepareCloudEvents(pruneEventsForUpload(DB.filterEventsForSync(
			SETTINGS_SYNC.sanitizeEvents(sourceEvents, SETTINGS_SYNC.allowsSecrets(S.settings))
		)), { includeRemote: isInitialPush });

		const total = transportEvents.length;
		if (!total) {
			LS.setItem(lastUploadedKey(), String(localMaxSeq));
			state.lastUploadedLocalSeq = localMaxSeq;
			return;
		}

		const apiUrl = getApiUrl(state.url, "/api/events");
		const MAX_BATCH_EVENTS = 40;
		const MAX_BATCH_CHARS = 8_000_000;
		let encryptedBatch = [];
		let batchChars = 0;
		let batchElementCount = 0;
		let uploaded = 0;
		const uploadBatch = async () => {
			if (!encryptedBatch.length) return;
			const uploadedElements = batchElementCount;
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
				if (resData.usage !== undefined) state.usage = formatStorageUsage(resData.usage, resData.limit);
			} else if (response.status === 413) {
				const errData = await response.json().catch(() => ({}));
				throw new Error(errData.error || "Cloudflare-Speicherlimit erreicht.");
			} else {
				throw await responseError(response, "Upload zum Cloudflare-Server fehlgeschlagen");
			}

			uploaded += uploadedElements;
			const percent = Math.round((uploaded / total) * 100);
			state.progress = { current: uploaded, total, percent };
			setStatus("syncing", "Synchronisiere…", `Übertrage ${uploaded} von ${total} Elementen (${percent} %)`);
			encryptedBatch = [];
			batchChars = 0;
			batchElementCount = 0;
		};

		if (isInitialPush) {
			// Initial-Push / Force-Full-Push: Bündelt viele kleine fachliche Events in begrenzte E2EE-Batches
			for (const events of chunkCloudEvents(transportEvents)) {
				const batchId = `batch-${await sha256Hex(events.map((event) => event.id).join("\n"))}`;
				const enc = await encryptPayload(credentials.cryptoKey, cloudEventsEnvelope(events));
				const packet = {
					id: batchId,
					iv: enc.iv,
					data: enc.data,
					size: enc.size,
				};
				const packetChars = encryptedPacketChars(packet);
				if (encryptedBatch.length && (encryptedBatch.length >= MAX_BATCH_EVENTS || batchChars + packetChars > MAX_BATCH_CHARS)) {
					await uploadBatch();
				}
				encryptedBatch.push(packet);
				batchChars += packetChars;
				batchElementCount += events.length;
				if (encryptedBatch.length >= MAX_BATCH_EVENTS || batchChars >= MAX_BATCH_CHARS) await uploadBatch();
			}
			await uploadBatch();
		} else {
			// Normaler Delta-Upload: Verwendet die originale event.id für atomare Deduplizierung
			for (const event of transportEvents) {
				const enc = await encryptPayload(credentials.cryptoKey, cloudEventEnvelope(event));
				const packet = {
					id: event.id,
					iv: enc.iv,
					data: enc.data,
					size: enc.size,
				};
				const packetChars = encryptedPacketChars(packet);
				if (encryptedBatch.length && (encryptedBatch.length >= MAX_BATCH_EVENTS || batchChars + packetChars > MAX_BATCH_CHARS)) {
					await uploadBatch();
				}
				encryptedBatch.push(packet);
				batchChars += packetChars;
				batchElementCount += 1;
				if (encryptedBatch.length >= MAX_BATCH_EVENTS || batchChars >= MAX_BATCH_CHARS) await uploadBatch();
			}
			await uploadBatch();
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
		const [wireEvent] = prepareCloudEvents([ev]);
		if (!wireEvent) return;

		try {
			const encrypted = await encryptPayload(credentials.cryptoKey, cloudEventEnvelope(wireEvent));
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
				// Der Serverkanal und seine benutzerspezifischen Cursor muessen atomar
				// denselben leeren Stand beschreiben. Sonst ueberspringt ein Reload den
				// erneuten Upload der weiterhin lokal vorhandenen Events.
				resetSyncCursors();
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
			if (ev?.id && localEventIds) localEventIds.add(ev.id);
			if (credentials) {
				void sendEventLive(ev);
			}
		});

		if (typeof window !== "undefined") {
			window.addEventListener("online", () => {
				if (state.url && credentials) connectWebSocket();
			});

			window.addEventListener("visibilitychange", () => {
				if (!document.hidden && state.url && credentials) {
					if (!socket || socket.readyState !== WebSocket.OPEN) connectWebSocket();
					else catchUp().catch((e) => console.warn("[cf-sync] Sichtbarkeits-Sync fehlgeschlagen:", e));
				}
			});
		}

		if (state.url && state.syncKey) {
			configure(state.url, state.syncKey).catch(() => {});
		}
	}

	/**
	 * Führt eine autorisierte KI-Anfrage über den Cloudflare-Worker aus,
	 * ohne Sync-Tokens oder Groq-Schlüssel im AI-Modul offenzulegen.
	 */
	async function aiRequest(payload, options = {}) {
		const targetUrl = options.base || state.url || DEFAULT_WORKER_URL;
		if (!targetUrl) {
			throw new Error("Keine Cloudflare-Server-URL konfiguriert (Einstellungen → Sync & Dienste).");
		}
		if (!credentials && state.syncKey) {
			try { credentials = await deriveSyncCredentials(state.syncKey); } catch {}
		}
		if (!credentials?.authToken || !credentials?.userId) {
			throw new Error("Cloudflare Sync ist nicht mit einem gültigen Schlüssel eingerichtet. Bitte in Einstellungen → Sync & Dienste verbinden.");
		}
		const apiUrl = getApiUrl(targetUrl, "/api/ai");
		const body = Array.isArray(payload) ? { messages: payload } : (payload || {});
		return await fetch(apiUrl, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				...getAuthHeaders(),
			},
			body: JSON.stringify(body),
			signal: options.signal,
		});
	}

	async function notionRequest(token, path, options = {}) {
		const targetUrl = options.base || state.url || DEFAULT_WORKER_URL;
		if (!credentials && state.syncKey) {
			try { credentials = await deriveSyncCredentials(state.syncKey); } catch {}
		}
		if (!targetUrl || !credentials?.authToken || !credentials?.userId) {
			throw new Error("Der sichere Notion-Proxy benötigt eine eingerichtete Cloudflare-Synchronisierung.");
		}
		return fetch(getApiUrl(targetUrl, "/api/notion"), {
			method: "POST",
			headers: { "Content-Type": "application/json", ...getAuthHeaders() },
			body: JSON.stringify({ token, path, method: options.method || "GET", body: options.body }),
			signal: options.signal,
		});
	}

	return {
		init,
		configure,
		disconnect,
		catchUp: (forceAll = false) => catchUp(forceAll),
		// Ein manueller Sync ist ein Delta-Sync. Vollständige Wiederherstellung
		// wird weiterhin automatisch nur für einen wirklich leeren Kanal genutzt.
		syncNow: () => catchUp(false),
		purgeCloudData,
		generateSyncKey,
		status: () => ({ ...state }),
		aiRequest,
		notionRequest,
		isConfigured: () => !!(state.url && (credentials?.authToken || state.syncKey)),
	};
})();
