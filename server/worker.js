/**
 * Impala67 Cloudflare Real-Time Sync Worker (Production Grade 10/10)
 * 
 * - Durable Objects: Globaler Actor pro User-ID (garantiert 100% zuverlässige WebSockets weltweit)
 * - Single-Thread Actor: Schließt Race-Conditions bei Sequenznummern (seq) mathematisch aus
 * - Atomare Deduplizierung: Erkennt und ignoriert bereits gespeicherte event_ids
 * - WebSocket Hibernation + Attachment: Stellt userId & Auth-Status nach Schlafzustand zuverlässig wieder her
 * - In-Band WebSocket Handshake: Kein Token in der URL-Query (geschützt vor Log-Leaks & Referer-Leaks)
 * - Gehashte Token-Verifikation: Server speichert ausschließlich SHA-256 Hashes der Tokens (Zero-Knowledge)
 * - D1 + R2 Hybrid-Speicherung: D1 für Indizes/Metadaten, R2 für Chiffrate (10 GB Free Tier)
 * - E2EE: Server speichert ausschließlich Chiffrate { iv, data }
 * - Quota-Schutz: 1.000 MB (1 GB) pro Nutzer, 10 GB Gesamtkapazität
 */

import { CLOUD_SYNC_PROTOCOL, CLOUD_SYNC_PROTOCOL_HEADER } from "../web/sync-core.js";

const MAX_USER_STORAGE_BYTES = 1_000_000_000; // 1 GB (1.000 MB dezimal) pro Nutzer
const MAX_TOTAL_SERVER_STORAGE_BYTES = 10_000_000_000; // 10 GB (10.000 MB dezimal) Gesamt-Server-Limit (Cloudflare R2 Free Tier: 10 GB-month)
const MAX_TOTAL_SERVER_USERS = 10; // Maximal 10 Accounts (10 x 1 GB = 10 GB Gesamtkapazität)
// D1 Free: höchstens 50 Queries pro Worker-Aufruf.
const MAX_EVENTS_PER_REQUEST = 40;
const MAX_R2_EVENT_DATA_CHARS = 12_000_000;
const MAX_SYNC_RESPONSE_DATA_CHARS = 8_000_000;
const AI_MODELS = [
	"qwen/qwen3.6-27b",
	"openai/gpt-oss-120b",
	"openai/gpt-oss-20b",
];
const VISION_MODELS = new Set(["qwen/qwen3.6-27b"]);
const MAX_AI_MESSAGES = 60;
const MAX_AI_MESSAGE_CHARS = 32_000;
const MAX_AI_IMAGE_CHARS = 6_000_000; // ~4.5 MB Base64
const MAX_AI_OUTPUT_TOKENS = 1_500;
const enc = new TextEncoder();

function base64ToBytes(base64) {
	const binary = atob(String(base64 || ""));
	const len = binary.length;
	const bytes = new Uint8Array(len);
	for (let i = 0; i < len; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

function bytesToBase64(bytes) {
	const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
	const CHUNK_SIZE = 0x8000;
	let binary = "";
	for (let i = 0; i < arr.length; i += CHUNK_SIZE) {
		binary += String.fromCharCode.apply(null, arr.subarray(i, i + CHUNK_SIZE));
	}
	return btoa(binary);
}

function corsHeaders() {
	return {
		"Access-Control-Allow-Origin": "*",
		"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
		// Authorization muss bei CORS explizit erlaubt werden. Der Platzhalter
		// deckt diesen Header in Browsern nicht zuverlässig ab.
		"Access-Control-Allow-Headers": `Authorization, Content-Type, X-User-Id, ${CLOUD_SYNC_PROTOCOL_HEADER}`,
		"Access-Control-Max-Age": "86400",
	};
}

function jsonResponse(data, status = 200) {
	return new Response(JSON.stringify(data), {
		status,
		headers: {
			"Content-Type": "application/json",
			...corsHeaders(),
		},
	});
}

async function hashToken(token) {
	const bytes = enc.encode("impala67_token_verifier:" + String(token || ""));
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function getRequestUserId(request) {
	const url = new URL(request.url);
	return url.searchParams.get("user") || request.headers.get("X-User-Id") || "";
}

async function verifyHttpUser(request, env, userId) {
	const rawAuthToken = extractAuthToken(request);
	if (!env?.DB || !userId || userId.length < 16 || !rawAuthToken) return false;
	const row = await env.DB.prepare(
		"SELECT auth_token_hash FROM user_storage WHERE user_id = ?"
	).bind(userId).first();
	if (!row?.auth_token_hash) return false;
	return row.auth_token_hash === await hashToken(rawAuthToken);
}

function protocolError(request) {
	return request.headers.get(CLOUD_SYNC_PROTOCOL_HEADER) === String(CLOUD_SYNC_PROTOCOL)
		? null
		: jsonResponse({ error: `Sync-Protokoll v${CLOUD_SYNC_PROTOCOL} erforderlich. Bitte Impala67 aktualisieren.` }, 426);
}

function normalizeAiMessages(messages) {
	if (!Array.isArray(messages) || messages.length < 1 || messages.length > MAX_AI_MESSAGES) {
		return { error: `Ungültige AI-Nachrichten: Array mit 1 bis ${MAX_AI_MESSAGES} Nachrichten erwartet.` };
	}
	const normalized = [];
	let hasImages = false;
	let totalImages = 0;

	for (const message of messages) {
		if (!message || typeof message !== "object") {
			return { error: "Ungültiges Nachrichtenformat." };
		}
		const role = message.role;
		if (!["system", "user", "assistant", "tool"].includes(role)) {
			return { error: `Nicht unterstützte Rolle „${role}“. Erlaubt sind system, user, assistant und tool.` };
		}

		const entry = { role };

		if (role === "tool") {
			if (!message.tool_call_id || typeof message.tool_call_id !== "string") {
				return { error: "Nachrichten mit der Rolle „tool“ müssen eine gültige tool_call_id enthalten." };
			}
			entry.tool_call_id = message.tool_call_id.slice(0, 128);
			entry.content = typeof message.content === "string" ? message.content.slice(0, MAX_AI_MESSAGE_CHARS) : JSON.stringify(message.content || "");
			normalized.push(entry);
			continue;
		}

		if (role === "assistant" && Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
			entry.tool_calls = message.tool_calls.slice(0, 10).map((tc, idx) => ({
				id: String(tc?.id || `call_${idx}`).slice(0, 128),
				type: "function",
				function: {
					name: String(tc?.function?.name || "").slice(0, 128),
					arguments: String(tc?.function?.arguments || ""),
				},
			}));
		}

		if (Array.isArray(message.content)) {
			const parts = [];
			for (const part of message.content) {
				if (!part || typeof part !== "object") continue;
				if (part.type === "text" && typeof part.text === "string" && part.text.trim()) {
					parts.push({ type: "text", text: part.text.slice(0, MAX_AI_MESSAGE_CHARS) });
				} else if (part.type === "image_url" && (part.image_url?.url || part.url)) {
					const url = String(part.image_url?.url || part.url);
					if (url.length > MAX_AI_IMAGE_CHARS) {
						return { error: "Bild überschreitet die maximale Größe von ~4.5 MB." };
					}
					totalImages++;
					if (totalImages > 5) {
						return { error: "Maximal 5 Bilder pro Anfrage erlaubt." };
					}
					hasImages = true;
					parts.push({ type: "image_url", image_url: { url } });
				}
			}
			if (!parts.length && !entry.tool_calls) {
				return { error: "Leere strukturierte Nachricht nicht erlaubt." };
			}
			entry.content = parts;
		} else if (typeof message.content === "string") {
			const text = message.content.trim();
			if (!text && !entry.tool_calls) {
				return { error: "Leere Textnachrichten sind nicht erlaubt." };
			}
			entry.content = text.slice(0, MAX_AI_MESSAGE_CHARS);
		} else if (entry.tool_calls) {
			entry.content = null;
		} else {
			return { error: "Ungültiger Inhalt der Nachricht." };
		}

		normalized.push(entry);
	}

	return { messages: normalized, hasImages };
}

function normalizeAiTools(tools) {
	if (!tools || !Array.isArray(tools)) return undefined;
	const valid = [];
	for (const t of tools.slice(0, 30)) {
		if (t?.type === "function" && t.function?.name) {
			valid.push({
				type: "function",
				function: {
					name: String(t.function.name).slice(0, 128),
					description: t.function.description ? String(t.function.description).slice(0, 2048) : undefined,
					parameters: t.function.parameters && typeof t.function.parameters === "object" ? t.function.parameters : {},
				},
			});
		}
	}
	return valid.length ? valid : undefined;
}

async function handleAiRequest(request, env) {
	if (request.method !== "POST") return jsonResponse({ error: "Nur POST ist für AI-Anfragen erlaubt." }, 405);
	if (!env?.GROQ_API_KEY) return jsonResponse({ error: "AI-Dienst ist auf dem Worker nicht konfiguriert (GROQ_API_KEY fehlt)." }, 503);

	const userId = getRequestUserId(request);
	if (!(await verifyHttpUser(request, env, userId))) {
		return jsonResponse({ error: "Ungültiger Autorisierungs-Token für diesen Account." }, 403);
	}

	const body = await request.json().catch(() => null);
	const validation = normalizeAiMessages(body?.messages);
	if (validation.error) {
		return jsonResponse({ error: validation.error }, 400);
	}

	const tools = normalizeAiTools(body?.tools);
	const toolChoice = body?.tool_choice;
	const hasImages = validation.hasImages;
	const candidateModels = hasImages
		? AI_MODELS.filter((m) => VISION_MODELS.has(m))
		: AI_MODELS;

	let upstream = null;
	let responseText = "";
	for (const model of candidateModels) {
		const payload = {
			model,
			messages: validation.messages,
			max_completion_tokens: MAX_AI_OUTPUT_TOKENS,
			stream: false,
		};
		if (tools) payload.tools = tools;
		if (toolChoice) payload.tool_choice = toolChoice;

		upstream = await fetch("https://api.groq.com/openai/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${env.GROQ_API_KEY}`,
			},
			body: JSON.stringify(payload),
		});
		responseText = await upstream.text();
		if (upstream.status !== 429 || model === candidateModels.at(-1)) break;
	}

	return new Response(responseText, {
		status: upstream?.status || 502,
		headers: {
			"Content-Type": upstream?.headers.get("Content-Type") || "application/json",
			...corsHeaders(),
		},
	});
}

async function handleNotionRequest(request, env) {
	if (request.method !== "POST") return jsonResponse({ error: "Nur POST ist für Notion-Anfragen erlaubt." }, 405);
	const userId = getRequestUserId(request);
	if (!(await verifyHttpUser(request, env, userId))) {
		return jsonResponse({ error: "Ungültiger Autorisierungs-Token für diesen Account." }, 403);
	}

	const requestBody = await request.json().catch(() => null);
	const token = typeof requestBody?.token === "string" ? requestBody.token.trim() : "";
	const path = typeof requestBody?.path === "string" ? requestBody.path : "";
	const method = String(requestBody?.method || "GET").toUpperCase();
	const allowedPath = /^\/(?:search|pages|blocks|databases)(?:\/|\?|$)/.test(path) && !path.startsWith("//") && !path.includes("\\");
	if (!token || token.length > 4096 || !allowedPath || !["GET", "POST", "PATCH", "DELETE"].includes(method)) {
		return jsonResponse({ error: "Ungültige Notion-Anfrage." }, 400);
	}

	const upstream = await fetch("https://api.notion.com/v1" + path, {
		method,
		headers: {
			Authorization: `Bearer ${token}`,
			"Notion-Version": "2022-06-28",
			"Content-Type": "application/json",
		},
		body: method === "GET" || method === "DELETE" || requestBody.body === undefined
			? undefined
			: JSON.stringify(requestBody.body),
	});
	const headers = { "Content-Type": upstream.headers.get("Content-Type") || "application/json", ...corsHeaders() };
	const retryAfter = upstream.headers.get("Retry-After");
	if (retryAfter) headers["Retry-After"] = retryAfter;
	return new Response(upstream.body, { status: upstream.status, headers });
}

function extractAuthToken(request) {
	const authHeader = request.headers.get("Authorization") || "";
	if (authHeader.startsWith("Bearer ")) {
		return authHeader.slice(7).trim();
	}
	return "";
}

/**
 * Durable Object: Eigener synchroner Actor pro Nutzer
 */
export class SyncRoom {
	constructor(ctx, env) {
		this.ctx = ctx;
		this.env = env;
		this.userId = null;
		this.authTokenHash = null;
		this.initialized = false;
		this.maxSeq = 0;
		this.totalBytes = 0;
		this._queue = Promise.resolve();
	}

	async ensureInitialized(userId) {
		if (this.initialized && this.userId === userId) return;
		this.userId = userId;

		// 1. DO Persistent Storage prüfen
		if (this.ctx?.storage) {
			const savedUserId = await this.ctx.storage.get("userId");
			if (!savedUserId && userId) {
				await this.ctx.storage.put("userId", userId);
			}
			this.authTokenHash = (await this.ctx.storage.get("authTokenHash")) || null;
		}

		// 2. Initialzustand aus D1 Datenbank laden
		const eventStateRow = await this.env.DB.prepare(
			"SELECT COALESCE(MAX(seq), 0) as max_seq, COALESCE(SUM(size), 0) as total_bytes FROM sync_events WHERE user_id = ?"
		).bind(userId).first();
		this.maxSeq = eventStateRow ? Number(eventStateRow.max_seq) : 0;
		this.totalBytes = eventStateRow ? Number(eventStateRow.total_bytes) || 0 : 0;

		const usageRow = await this.env.DB.prepare(
			"SELECT auth_token_hash, total_bytes FROM user_storage WHERE user_id = ?"
		).bind(userId).first();
		if (usageRow?.auth_token_hash && !this.authTokenHash) {
			this.authTokenHash = usageRow.auth_token_hash;
		}

		this.initialized = true;
	}

	async verifyAuthorization(rawAuthToken) {
		if (!rawAuthToken) {
			// Auch bei einem noch nie verwendeten Kanal ist ein Token nötig.
			// Sonst könnte jemand, der nur die öffentliche userId kennt, den
			// Kanal vor dem eigentlichen Gerät für sich reservieren.
			return false;
		}

		const providedHash = await hashToken(rawAuthToken);

		// Erster Aufruf: Prüfen ob Nutzerlimit erreicht ist, bevor neuer Account angelegt wird
		if (!this.authTokenHash) {
			const countRow = await this.env.DB.prepare("SELECT COUNT(*) as cnt FROM user_storage").first();
			const currentUsers = countRow ? Number(countRow.cnt) : 0;
			if (currentUsers >= MAX_TOTAL_SERVER_USERS) {
				return false; // Server-Kapazität von 10 Accounts erreicht
			}
			this.authTokenHash = providedHash;
			if (this.ctx?.storage) {
				await this.ctx.storage.put("authTokenHash", providedHash);
			}
			if (this.userId) {
				const now = new Date().toISOString();
				await this.env.DB.prepare(
					"INSERT INTO user_storage (user_id, auth_token_hash, total_bytes, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET auth_token_hash = ?"
				).bind(this.userId, providedHash, this.totalBytes, now, providedHash).run();
			}
			return true;
		}

		// Folgende Aufrufe: Hash abgleichen
		return this.authTokenHash === providedHash;
	}

	broadcast(message, excludeWs = null) {
		const payload = typeof message === "string" ? message : JSON.stringify(message);
		const sockets = this.ctx?.getWebSockets ? this.ctx.getWebSockets() : [];
		for (const ws of sockets) {
			if (ws !== excludeWs) {
				try {
					ws.send(payload);
				} catch {
					try { ws.close(); } catch {}
				}
			}
		}
	}

	// WebSocket Hibernation API Handlers
	async webSocketMessage(ws, message) {
		try {
			// 1. userId & Auth aus Attachment / Storage wiederherstellen falls nach Hibernation aufgeweckt
			let userId = this.userId;
			let isAuth = false;
			if (ws.deserializeAttachment) {
				const att = ws.deserializeAttachment();
				if (att) {
					if (att.userId) userId = att.userId;
					if (att.authenticated && att.protocol === CLOUD_SYNC_PROTOCOL) isAuth = true;
				}
			}
			if (!userId && this.ctx?.storage) {
				userId = await this.ctx.storage.get("userId");
			}

			if (userId) {
				await this.ensureInitialized(userId);
			}

			const msg = JSON.parse(message);

			// In-Band Auth Handshake (Kein Token in der URL-Query!)
			if (msg.type === "auth") {
				if (msg.protocol !== CLOUD_SYNC_PROTOCOL) {
					ws.send(JSON.stringify({ type: "unsupported_protocol", error: `Sync-Protokoll v${CLOUD_SYNC_PROTOCOL} erforderlich.` }));
					try { ws.close(4406, "Unsupported protocol"); } catch {}
					return;
				}
				const ok = await this.verifyAuthorization(msg.token);
				if (ok) {
					if (typeof ws.serializeAttachment === "function") {
						ws.serializeAttachment({ userId: this.userId, authenticated: true, protocol: CLOUD_SYNC_PROTOCOL });
					}
					ws.send(JSON.stringify({ type: "authenticated", protocol: CLOUD_SYNC_PROTOCOL }));
				} else {
					ws.send(JSON.stringify({ type: "unauthorized", error: "Ungültiger Autorisierungs-Token" }));
					try { ws.close(4401, "Unauthorized"); } catch {}
				}
				return;
			}

			// Ping / Pong
			if (!isAuth) {
				ws.send(JSON.stringify({ type: "unauthorized", error: "WebSocket nicht autorisiert" }));
				return;
			}

			if (msg.type === "ping") {
				ws.send(JSON.stringify({ type: "pong", t: Date.now() }));
				return;
			}

			// Events nur verarbeiten, wenn Socket autorisiert ist
			if (msg.type === "event" && msg.event) {
				const res = await this.saveEvents([msg.event]);
				if (res.ok) {
					if (res.savedEvents.length > 0) {
						this.broadcast({ type: "event", event: res.savedEvents[0] }, ws);
					}
					ws.send(JSON.stringify({
						type: "ack",
						eventId: msg.event.id,
						seq: res.maxSeq,
						usage: res.usage,
						alreadyExisted: res.savedEvents.length === 0,
					}));
				} else {
					ws.send(JSON.stringify({ type: "error", error: res.error, usage: res.usage, limit: MAX_USER_STORAGE_BYTES }));
				}
			}
		} catch (e) {
			console.error("[SyncRoom] WS Message Error:", e);
		}
	}

	async webSocketClose(ws, code, reason, wasClean) {
		try { ws.close(code, reason); } catch {}
	}

	async webSocketError(ws, error) {
		try { ws.close(); } catch {}
	}

	/**
	 * Serialisierte Speicherung über eine Promise-Kette
	 */
	saveEvents(events) {
		const task = this._queue.then(() => this._saveEventsAtomic(events));
		this._queue = task.then(() => undefined, () => undefined);
		return task;
	}

	async _saveEventsAtomic(events) {
		if (!this.env?.DB || !this.env?.BUCKET) {
			return { ok: false, error: "Cloud-Sync benötigt D1 und R2.", status: 503, usage: this.totalBytes };
		}
		await this.ensureInitialized(this.userId);
		if (!events || !events.length) {
			return { ok: true, savedEvents: [], maxSeq: this.maxSeq, usage: this.totalBytes };
		}

		// 1. Filtern und Deduplizieren
		const candidates = [];
		const batchEventIds = new Set();

		for (const ev of events) {
			const encodedData = typeof ev?.data === "string" && ev.data.startsWith("gz:") ? ev.data.slice(3) : ev?.data;
			if (
				!ev || typeof ev.id !== "string" || !ev.id || ev.id.length > 200 ||
				typeof ev.iv !== "string" || !/^[0-9a-f]{24}$/i.test(ev.iv) ||
				typeof encodedData !== "string" || !encodedData || encodedData.length % 4 !== 0 ||
				!/^[A-Za-z0-9+/]+={0,2}$/.test(encodedData)
			) {
				return { ok: false, error: "Ungültiges verschlüsseltes Event-Paket.", status: 400, usage: this.totalBytes };
			}
			if (ev.data.length > MAX_R2_EVENT_DATA_CHARS) {
				return {
					ok: false,
					error: "Ein einzelnes Sync-Element ist selbst nach Komprimierung zu groß.",
					status: 413,
					usage: this.totalBytes,
				};
			}
			// Bereits bekanntes Event überspringen (Idempotenz)
			if (batchEventIds.has(ev.id)) continue;
			batchEventIds.add(ev.id);

			// Quota-Werte niemals vom Client übernehmen: Base64 enthält vier
			// Zeichen je drei Chiffrat-Bytes, die IV liegt als Hex vor.
			const padding = encodedData.endsWith("==") ? 2 : (encodedData.endsWith("=") ? 1 : 0);
			const cipherBytes = Math.max(0, Math.floor((encodedData.length * 3) / 4) - padding);
			const ivBytes = Math.floor(ev.iv.length / 2);
			const size = cipherBytes + ivBytes;
			candidates.push({ ...ev, size });
		}

		// Nur die IDs des aktuellen Pakets gegen D1 prüfen. Der frühere Ansatz
		// lud bei jedem Actor-Start sämtliche IDs eines Kontos in den Worker-RAM.
		const existingIds = new Set();
		if (candidates.length) {
			for (let i = 0; i < candidates.length; i += 80) {
				const part = candidates.slice(i, i + 80);
				const placeholders = part.map(() => "?").join(", ");
				const rows = await this.env.DB.prepare(
					`SELECT event_id FROM sync_events WHERE user_id = ? AND event_id IN (${placeholders})`
				).bind(this.userId, ...part.map((ev) => ev.id)).all();
				for (const row of rows.results || []) existingIds.add(row.event_id);
			}
		}
		const freshEvents = candidates.filter((ev) => !existingIds.has(ev.id));
		const incomingBytes = freshEvents.reduce((sum, ev) => sum + ev.size, 0);

		// Falls alle Events bereits existieren -> Erfolgreicher No-Op (idempotent)
		if (!freshEvents.length) {
			return { ok: true, savedEvents: [], maxSeq: this.maxSeq, usage: this.totalBytes };
		}

		// 2. Quota Check (1.000 MB pro Account & 10 GB Server-Gesamtlimit)
		if (this.totalBytes + incomingBytes > MAX_USER_STORAGE_BYTES) {
			return {
				ok: false,
				error: "Quota überschritten: Das Limit von 1.000 MB für diesen Account wurde erreicht.",
				status: 413,
				usage: this.totalBytes,
			};
		}

		const serverStorageStmt = this.env.DB.prepare("SELECT COALESCE(SUM(total_bytes), 0) as server_bytes FROM user_storage");
		const serverStorageRow = await serverStorageStmt.first();
		const serverBytes = serverStorageRow ? Number(serverStorageRow.server_bytes) || 0 : 0;
		if (serverBytes + incomingBytes > MAX_TOTAL_SERVER_STORAGE_BYTES) {
			return {
				ok: false,
				error: "Server-Kapazität erreicht: Das Cloudflare-Gesamtspeicherlimit von 10 GB wurde erreicht.",
				status: 413,
				usage: this.totalBytes,
			};
		}

		// 3. Sequenznummern atomar vergeben & Daten in R2 + D1 speichern
		const savedEvents = [];
		const now = new Date().toISOString();
		const stmts = [];

		let nextSeq = this.maxSeq;
		const r2Writes = [];
		const r2KeysWritten = [];

		for (const ev of freshEvents) {
			nextSeq++;
			const r2Key = `users/${this.userId}/events/${ev.id}.bin`;
			const saved = {
				id: ev.id,
				seq: nextSeq,
				iv: ev.iv,
				data: ev.data,
				size: ev.size,
				created_at: now,
			};
			savedEvents.push(saved);

			const isGz = ev.data.startsWith("gz:");
			const rawB64 = isGz ? ev.data.slice(3) : ev.data;
			r2Writes.push({
				key: r2Key,
				rawB64,
				metadata: {
					userId: this.userId,
					eventId: ev.id,
					iv: ev.iv,
					gz: isGz ? "1" : "0",
				},
			});

			stmts.push(
				this.env.DB.prepare(
					"INSERT OR IGNORE INTO sync_events (user_id, seq, event_id, iv, r2_key, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
				).bind(this.userId, saved.seq, saved.id, saved.iv, r2Key, saved.size, now)
			);
		}

		// Kleine Pakete begrenzt parallel schreiben; das beseitigt beim Erstabgleich
		// die R2-Latenz pro Objekt. Maximal sechs gleichzeitige Dekodierungen halten
		// auch gemischte Medien-Batches deutlich unter dem Isolate-Speicherlimit.
		try {
			for (let i = 0; i < r2Writes.length; i += 6) {
				const group = r2Writes.slice(i, i + 6);
				const results = await Promise.allSettled(group.map(async (write) => {
					await this.env.BUCKET.put(write.key, base64ToBytes(write.rawB64), { customMetadata: write.metadata });
					r2KeysWritten.push(write.key);
				}));
				if (results.some((result) => result.status === "rejected")) throw new Error("R2 write failed");
			}
		} catch {
			if (r2KeysWritten.length > 0) {
				try { await this.env.BUCKET.delete(r2KeysWritten); } catch {}
			}
			return {
				ok: false,
				error: "Speicherfehler beim Schreiben in den Cloudflare R2 Bucket.",
				status: 500,
				usage: this.totalBytes,
			};
		}

		const nextTotalBytes = this.totalBytes + incomingBytes;
		stmts.push(
			this.env.DB.prepare(
				"INSERT INTO user_storage (user_id, auth_token_hash, total_bytes, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET total_bytes = ?, updated_at = ?"
			).bind(this.userId, this.authTokenHash, nextTotalBytes, now, nextTotalBytes, now)
		);
		try {
			await this.env.DB.batch(stmts);
		} catch (dbErr) {
			// Rollback der geschriebenen R2-Objekte bei Datenbankfehler
			if (r2KeysWritten.length > 0) {
				try { await this.env.BUCKET.delete(r2KeysWritten); } catch {}
			}
			return {
				ok: false,
				error: "Datenbank-Schreibfehler beim Persistieren der Events.",
				status: 500,
				usage: this.totalBytes,
			};
		}

		// Erst nach erfolgreichem Persistieren in-memory fortschreiben. Bei einem
		// D1- oder R2-Fehler darf der Actor keine Events als gespeichert markieren.
		this.maxSeq = nextSeq;
		this.totalBytes = nextTotalBytes;
		return {
			ok: true,
			savedEvents,
			maxSeq: this.maxSeq,
			usage: this.totalBytes,
		};
	}

	async fetch(request) {
		const url = new URL(request.url);
		if (!this.env?.DB || !this.env?.BUCKET) return jsonResponse({ error: "Cloud-Sync benötigt D1 und R2." }, 503);
		const userId = url.searchParams.get("user") || request.headers.get("X-User-Id");
		if (!userId || userId.length < 16) {
			return jsonResponse({ error: "Fehlende oder ungültige User-ID" }, 401);
		}

		// 1. WebSocket Verbindungsaufbau (In-Band Auth)
		if (url.pathname === "/ws") {
			await this.ensureInitialized(userId);
			const upgradeHeader = request.headers.get("Upgrade");
			if (!upgradeHeader || upgradeHeader.toLowerCase() !== "websocket") {
				return new Response("Expected Upgrade: websocket", { status: 426 });
			}

			let client = {}, server = {};
			if (typeof WebSocketPair !== "undefined") {
				const webSocketPair = new WebSocketPair();
				const values = Object.values(webSocketPair);
				client = values[0];
				server = values[1];
			} else if (request._mockServer) {
				server = request._mockServer;
			}

			if (this.ctx?.acceptWebSocket) {
				this.ctx.acceptWebSocket(server);
				if (typeof server.serializeAttachment === "function") {
					server.serializeAttachment({ userId: this.userId, authenticated: false });
				}
			} else if (server && typeof server.accept === "function") {
				server.accept();
				server.addEventListener("message", (e) => this.webSocketMessage(server, e.data));
			}

			return new Response(null, {
				status: typeof WebSocketPair !== "undefined" ? 101 : 200,
				webSocket: client,
			});
		}

		const versionError = protocolError(request);
		if (versionError) return versionError;
		await this.ensureInitialized(userId);

		// Bei HTTP-Endpunkten: Autorisierung über Header prüfen
		const authToken = extractAuthToken(request);
		const isAuthorized = await this.verifyAuthorization(authToken);
		if (!isAuthorized) {
			return jsonResponse({ error: "Ungültiger Autorisierungs-Token für diesen Account." }, 403);
		}

		// 2. GET /api/quota
		if (url.pathname === "/api/quota" && request.method === "GET") {
			const percent = Math.min(100, Math.round((this.totalBytes / MAX_USER_STORAGE_BYTES) * 100));
			return jsonResponse({
				userId,
				usage: this.totalBytes,
				limit: MAX_USER_STORAGE_BYTES,
				percent,
				available: Math.max(0, MAX_USER_STORAGE_BYTES - this.totalBytes),
			});
		}

		// 3. GET /api/sync?since=123&limit=500
		if (url.pathname === "/api/sync" && request.method === "GET") {
			const since = Math.max(0, parseInt(url.searchParams.get("since") || "0", 10));
			const limit = Math.min(1000, Math.max(1, parseInt(url.searchParams.get("limit") || "500", 10)));

			const events = [];
			let stoppedBySize = false;
			const rows = await this.env.DB.prepare(
				"SELECT seq, event_id as id, iv, r2_key, size, created_at FROM sync_events WHERE user_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?"
			).bind(userId, since, limit).all();
			const rawEvents = rows.results || [];
			let responseChars = 0;

			for (const row of rawEvents) {
				const estimatedChars = Math.ceil((Number(row.size) || 0) * 4 / 3) + 128;
				if (events.length && responseChars + estimatedChars > MAX_SYNC_RESPONSE_DATA_CHARS) {
					stoppedBySize = true;
					break;
				}
				const obj = await this.env.BUCKET.get(row.r2_key);
				if (!obj) return jsonResponse({ error: "Verschlüsseltes R2-Event fehlt." }, 502);
				const isGz = obj.customMetadata?.gz === "1";
				const buf = await obj.arrayBuffer();
				const payload = (isGz ? "gz:" : "") + bytesToBase64(new Uint8Array(buf));
				events.push({
					seq: row.seq,
					id: row.id,
					iv: row.iv,
					data: payload,
					size: row.size,
					created_at: row.created_at,
				});
				responseChars += payload.length + 128;
			}

			return jsonResponse({
				events,
				since,
				maxSeq: this.maxSeq,
				hasMore: Boolean(stoppedBySize || events.length === limit),
				usage: this.totalBytes,
				limit: MAX_USER_STORAGE_BYTES,
			});
		}

		// 4. POST /api/events
		if (url.pathname === "/api/events" && request.method === "POST") {
			const body = await request.json().catch(() => null);
			if (!body || !Array.isArray(body.events)) {
				return jsonResponse({ error: "Ungültiger Request-Body (Array 'events' erwartet)" }, 400);
			}
			if (body.events.length > MAX_EVENTS_PER_REQUEST) {
				return jsonResponse({ error: `Maximal ${MAX_EVENTS_PER_REQUEST} Events pro Upload erlaubt.` }, 413);
			}

			const res = await this.saveEvents(body.events);
			if (!res.ok) {
				return jsonResponse({ error: res.error, usage: res.usage, limit: MAX_USER_STORAGE_BYTES }, res.status || 400);
			}

			// Broadcast neu gespeicherte Events
			for (const ev of res.savedEvents) {
				this.broadcast({ type: "event", event: ev });
			}

			return jsonResponse({
				ok: true,
				savedCount: res.savedEvents.length,
				maxSeq: res.maxSeq,
				usage: res.usage,
				limit: MAX_USER_STORAGE_BYTES,
			});
		}

		// 5. POST /api/reset
		if (url.pathname === "/api/reset" && request.method === "POST") {
			try {
				while (true) {
					const list = await this.env.BUCKET.list({ prefix: `users/${userId}/`, limit: 1000 });
					const keys = (list?.objects || []).map((object) => object.key);
					if (!keys.length) break;
					await this.env.BUCKET.delete(keys);
				}
			} catch (err) {
				console.error("[SyncRoom] R2 Reset-Fehler für User", userId, err);
				return jsonResponse({ error: "Cloud-Daten konnten nicht vollständig aus R2 gelöscht werden." }, 500);
			}

			await this.env.DB.batch([
				this.env.DB.prepare("DELETE FROM sync_events WHERE user_id = ?").bind(userId),
				this.env.DB.prepare("DELETE FROM user_storage WHERE user_id = ?").bind(userId),
			]);
			this.maxSeq = 0;
			this.totalBytes = 0;

			this.broadcast({ type: "reset" });
			return jsonResponse({ ok: true, message: "Cloud-Daten gelöscht" });
		}

		return jsonResponse({ error: "Endpunkt nicht gefunden" }, 404);
	}
}

export default {
	async fetch(request, env, ctx) {
		try {
			return await handleRequest(request, env, ctx);
		} catch (error) {
			console.error(JSON.stringify({ scope: "worker_fetch", message: error?.message || String(error) }));
			return jsonResponse({ error: "Interner Cloudflare-Sync-Fehler.", code: "internal_error" }, 500);
		}
	},
};

async function handleRequest(request, env, ctx) {
		// Preflight CORS
		if (request.method === "OPTIONS") {
			return new Response(null, { status: 204, headers: corsHeaders() });
		}

		const url = new URL(request.url);

		// Health Check
		if (url.pathname === "/api/health" || url.pathname === "/") {
			return jsonResponse({
				app: "Impala67 Real-Time Sync Server",
				version: "3.1.0",
				protocol: CLOUD_SYNC_PROTOCOL,
				features: ["protocol_v2", "durable_objects", "websocket_hibernation", "in_band_auth", "hashed_token_verifier", "attachment_state", "e2ee", "atomic_dedup", "d1_r2_required"],
				quotaLimitBytes: MAX_USER_STORAGE_BYTES,
				serverCapacityBytes: MAX_TOTAL_SERVER_STORAGE_BYTES,
			});
		}

		// Verfügbare AI-Modelle (OpenAI-kompatibel)
		if (url.pathname === "/api/models" || url.pathname === "/models" || url.pathname === "/v1/models") {
			return jsonResponse({
				object: "list",
				data: AI_MODELS.map((id) => ({ id, object: "model", owned_by: "groq" })),
			});
		}

		if (url.pathname === "/api/ai") {
			return await handleAiRequest(request, env);
		}

		if (url.pathname === "/api/notion") {
			return await handleNotionRequest(request, env);
		}

		const userId = getRequestUserId(request);
		if (!userId || userId.length < 16) {
			return jsonResponse({ error: "Fehlende oder ungültige User-ID (mindestens 16 Zeichen erforderlich)" }, 401);
		}

		if (!env.SYNC_ROOM) return jsonResponse({ error: "Cloud-Sync benötigt das SYNC_ROOM Durable Object." }, 503);
		const id = env.SYNC_ROOM.idFromName(userId);
		const room = env.SYNC_ROOM.get(id);
		return await room.fetch(request);
}
