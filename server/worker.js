/** Impala67 Cloudflare worker — Sync protocol v4. */
import { CLOUD_SYNC_PROTOCOL, CLOUD_SYNC_PROTOCOL_HEADER } from "../web/sync-core.js";

const MAX_USER_BYTES = 1_000_000_000;
const MAX_USERS = 10;
const MAX_PACKETS = 20;
const MAX_PACKET_CHARS = 12_000_000;
const MAX_SYNC_CHARS = 8_000_000;
const MAX_BLOB_BYTES = 100_000_000;
const enc = new TextEncoder();

const AI_MODELS = ["qwen/qwen3.6-27b", "openai/gpt-oss-120b", "openai/gpt-oss-20b"];
const VISION_MODELS = new Set([AI_MODELS[0]]);
const MAX_AI_MESSAGES = 60, MAX_AI_MESSAGE_CHARS = 32_000, MAX_AI_IMAGE_CHARS = 6_000_000, MAX_AI_OUTPUT_TOKENS = 1_500;

function corsHeaders() {
	return {
		"Access-Control-Allow-Origin": "*",
		"Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
		"Access-Control-Allow-Headers": `Authorization, Content-Type, X-User-Id, X-Impala-IV, ${CLOUD_SYNC_PROTOCOL_HEADER}`,
		"Access-Control-Expose-Headers": "X-Impala-IV, X-Impala-Usage",
		"Access-Control-Max-Age": "86400",
	};
}

function json(data, status = 200, headers = {}) {
	return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...corsHeaders(), ...headers } });
}

function userIdOf(request) {
	const url = new URL(request.url);
	return url.searchParams.get("user") || request.headers.get("X-User-Id") || "";
}

function authTokenOf(request) {
	const value = request.headers.get("Authorization") || "";
	return value.startsWith("Bearer ") ? value.slice(7).trim() : "";
}

async function tokenHash(token) {
	const digest = await crypto.subtle.digest("SHA-256", enc.encode(`impala67_token_verifier:${token || ""}`));
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function protocolError(request) {
	return request.headers.get(CLOUD_SYNC_PROTOCOL_HEADER) === String(CLOUD_SYNC_PROTOCOL)
		? null
		: json({ error: `Sync-Protokoll v${CLOUD_SYNC_PROTOCOL} erforderlich. Bitte Impala67 aktualisieren.` }, 426);
}

function base64ToBytes(value) {
	const s = atob(String(value || ""));
	const out = new Uint8Array(s.length);
	for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
	return out;
}

function bytesToBase64(value) {
	const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
	let out = "";
	for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	return btoa(out);
}

function packetSize(packet) {
	const data = String(packet?.data || "").replace(/^gz:/, "");
	const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
	return Math.max(0, Math.floor(data.length * 3 / 4) - padding) + 12;
}

async function verifyExistingUser(request, env) {
	const userId = userIdOf(request), token = authTokenOf(request);
	if (!userId || userId.length < 16 || !token) return false;
	const row = await env.DB.prepare("SELECT auth_token_hash FROM user_storage WHERE user_id = ?").bind(userId).first();
	return !!row?.auth_token_hash && row.auth_token_hash === await tokenHash(token);
}

function normalizeAiMessages(messages) {
	if (!Array.isArray(messages) || !messages.length || messages.length > MAX_AI_MESSAGES) return { error: `Ungültige AI-Nachrichten: 1 bis ${MAX_AI_MESSAGES} erwartet.` };
	let images = 0, hasImages = false;
	const out = [];
	for (const message of messages) {
		if (!message || !["system", "user", "assistant", "tool"].includes(message.role)) return { error: "Nicht unterstützte Rolle oder ungültige Nachricht." };
		const entry = { role: message.role };
		if (message.role === "tool") {
			if (!message.tool_call_id) return { error: "tool_call_id fehlt." };
			entry.tool_call_id = String(message.tool_call_id).slice(0, 128);
			entry.content = typeof message.content === "string" ? message.content.slice(0, MAX_AI_MESSAGE_CHARS) : JSON.stringify(message.content || "");
			out.push(entry); continue;
		}
		if (message.role === "assistant" && Array.isArray(message.tool_calls) && message.tool_calls.length) {
			entry.tool_calls = message.tool_calls.slice(0, 10).map((call, i) => ({
				id: String(call?.id || `call_${i}`).slice(0, 128), type: "function",
				function: { name: String(call?.function?.name || "").slice(0, 128), arguments: String(call?.function?.arguments || "") },
			}));
		}
		if (Array.isArray(message.content)) {
			entry.content = [];
			for (const part of message.content) {
				if (part?.type === "text" && typeof part.text === "string") entry.content.push({ type: "text", text: part.text.slice(0, MAX_AI_MESSAGE_CHARS) });
				else if (part?.type === "image_url" && (part.image_url?.url || part.url)) {
					const url = String(part.image_url?.url || part.url);
					if (url.length > MAX_AI_IMAGE_CHARS || ++images > 5) return { error: "Zu viele oder zu große Bilder." };
					hasImages = true; entry.content.push({ type: "image_url", image_url: { url } });
				}
			}
			if (!entry.content.length && !entry.tool_calls) return { error: "Leere Nachricht nicht erlaubt." };
		} else if (typeof message.content === "string") {
			entry.content = message.content.slice(0, MAX_AI_MESSAGE_CHARS);
			if (!entry.content.trim() && !entry.tool_calls) return { error: "Leere Nachricht nicht erlaubt." };
		} else if (entry.tool_calls) entry.content = null;
		else return { error: "Ungültiger Nachrichteninhalt." };
		out.push(entry);
	}
	return { messages: out, hasImages };
}

function normalizeAiTools(tools) {
	const out = [];
	for (const tool of Array.isArray(tools) ? tools.slice(0, 30) : []) {
		if (tool?.type !== "function" || !tool.function?.name) continue;
		out.push({ type: "function", function: {
			name: String(tool.function.name).slice(0, 128),
			description: tool.function.description ? String(tool.function.description).slice(0, 2048) : undefined,
			parameters: tool.function.parameters && typeof tool.function.parameters === "object" ? tool.function.parameters : {},
		} });
	}
	return out.length ? out : undefined;
}

async function handleAi(request, env) {
	if (request.method !== "POST") return json({ error: "Nur POST erlaubt." }, 405);
	if (!env.GROQ_API_KEY) return json({ error: "GROQ_API_KEY fehlt." }, 503);
	if (!(await verifyExistingUser(request, env))) return json({ error: "Ungültiger Autorisierungs-Token für diesen Account." }, 403);
	const body = await request.json().catch(() => null), normalized = normalizeAiMessages(body?.messages);
	if (normalized.error) return json({ error: normalized.error }, 400);
	const tools = normalizeAiTools(body?.tools), models = normalized.hasImages ? AI_MODELS.filter((m) => VISION_MODELS.has(m)) : AI_MODELS;
	let upstream, text = "";
	for (const model of models) {
		const payload = { model, messages: normalized.messages, max_completion_tokens: MAX_AI_OUTPUT_TOKENS, stream: false };
		if (tools) payload.tools = tools;
		if (body?.tool_choice) payload.tool_choice = body.tool_choice;
		upstream = await fetch("https://api.groq.com/openai/v1/chat/completions", {
			method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.GROQ_API_KEY}` }, body: JSON.stringify(payload),
		});
		text = await upstream.text();
		if (upstream.status !== 429 || model === models.at(-1)) break;
	}
	return new Response(text, { status: upstream?.status || 502, headers: { "Content-Type": upstream?.headers.get("Content-Type") || "application/json", ...corsHeaders() } });
}

async function handleNotion(request, env) {
	if (request.method !== "POST") return json({ error: "Nur POST erlaubt." }, 405);
	if (!(await verifyExistingUser(request, env))) return json({ error: "Ungültiger Autorisierungs-Token für diesen Account." }, 403);
	const body = await request.json().catch(() => null), token = String(body?.token || "").trim(), path = String(body?.path || ""), method = String(body?.method || "GET").toUpperCase();
	const allowed = /^\/(?:search|pages|blocks|databases)(?:\/|\?|$)/.test(path) && !path.startsWith("//") && !path.includes("\\");
	if (!token || token.length > 4096 || !allowed || !["GET", "POST", "PATCH", "DELETE"].includes(method)) return json({ error: "Ungültige Notion-Anfrage." }, 400);
	const upstream = await fetch("https://api.notion.com/v1" + path, {
		method,
		headers: { Authorization: `Bearer ${token}`, "Notion-Version": "2022-06-28", "Content-Type": "application/json" },
		body: method === "GET" || method === "DELETE" || body.body === undefined ? undefined : JSON.stringify(body.body),
	});
	const headers = { "Content-Type": upstream.headers.get("Content-Type") || "application/json", ...corsHeaders() };
	if (upstream.headers.get("Retry-After")) headers["Retry-After"] = upstream.headers.get("Retry-After");
	return new Response(upstream.body, { status: upstream.status, headers });
}

export class SyncRoom {
	constructor(ctx, env) {
		this.ctx = ctx; this.env = env;
		this.userId = null; this.authHash = null; this.initialized = false; this.accountExists = false;
		this.maxSeq = 0; this.totalBytes = 0; this.generation = 1; this.protocolVersion = 0;
		this.writeChain = Promise.resolve();
	}

	queue(fn) {
		const task = this.writeChain.then(fn, fn);
		this.writeChain = task.then(() => undefined, () => undefined);
		return task;
	}

	async init(userId) {
		if (this.initialized && this.userId === userId) return;
		this.userId = userId;
		if (this.ctx?.storage) {
			const storedUser = await this.ctx.storage.get("userId");
			if (!storedUser) await this.ctx.storage.put("userId", userId);
			this.authHash = await this.ctx.storage.get("authTokenHash") || null;
			this.generation = Number(await this.ctx.storage.get("generation")) || 1;
			this.protocolVersion = Number(await this.ctx.storage.get("protocolVersion")) || 0;
		}
		const [eventState, account] = await Promise.all([
			this.env.DB.prepare("SELECT COALESCE(MAX(seq),0) max_seq FROM sync_events WHERE user_id = ?").bind(userId).first(),
			this.env.DB.prepare("SELECT auth_token_hash,total_bytes FROM user_storage WHERE user_id = ?").bind(userId).first(),
		]);
		this.maxSeq = Number(eventState?.max_seq) || 0;
		this.totalBytes = Number(account?.total_bytes) || 0;
		this.accountExists = !!account;
		if (!this.authHash && account?.auth_token_hash) this.authHash = account.auth_token_hash;
		this.initialized = true;
	}

	async authorize(rawToken) {
		if (!rawToken) return false;
		const hash = await tokenHash(rawToken);
		if (this.authHash) {
			if (this.authHash !== hash) return false;
			if (!this.accountExists) await this.persistUsage();
		} else {
			const count = await this.env.DB.prepare("SELECT COUNT(*) cnt FROM user_storage").first();
			if (Number(count?.cnt) >= MAX_USERS) return false;
			this.authHash = hash;
			if (this.ctx?.storage) {
				await this.ctx.storage.put("authTokenHash", hash);
				await this.ctx.storage.put("generation", this.generation);
			}
			await this.persistUsage();
		}
		if (this.protocolVersion !== CLOUD_SYNC_PROTOCOL) {
			if (this.maxSeq || this.totalBytes) await this.clearSyncData(true);
			this.protocolVersion = CLOUD_SYNC_PROTOCOL;
			if (this.ctx?.storage) await this.ctx.storage.put("protocolVersion", CLOUD_SYNC_PROTOCOL);
		}
		return true;
	}

	async persistUsage() {
		const now = new Date().toISOString();
		await this.env.DB.prepare(
			"INSERT INTO user_storage (user_id,auth_token_hash,total_bytes,updated_at) VALUES (?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET auth_token_hash=?,total_bytes=?,updated_at=?"
		).bind(this.userId, this.authHash, this.totalBytes, now, this.authHash, this.totalBytes, now).run();
		this.accountExists = true;
	}

	broadcast(message, except = null) {
		const payload = JSON.stringify(message);
		for (const ws of this.ctx?.getWebSockets?.() || []) if (ws !== except) {
			try { ws.send(payload); } catch { try { ws.close(); } catch {} }
		}
	}

	async webSocketMessage(ws, raw) {
		let attachment = ws.deserializeAttachment?.() || {};
		let userId = attachment.userId || this.userId || await this.ctx?.storage?.get("userId");
		if (userId) await this.init(userId);
		const msg = JSON.parse(raw);
		if (msg.type === "auth") {
			if (msg.protocol !== CLOUD_SYNC_PROTOCOL) {
				ws.send(JSON.stringify({ type: "unsupported_protocol", error: `Sync-Protokoll v${CLOUD_SYNC_PROTOCOL} erforderlich.` }));
				try { ws.close(4406, "Unsupported protocol"); } catch {} return;
			}
			if (!(await this.authorize(msg.token))) {
				ws.send(JSON.stringify({ type: "unauthorized", error: "Ungültiger Autorisierungs-Token" }));
				try { ws.close(4401, "Unauthorized"); } catch {} return;
			}
			attachment = { userId: this.userId, authenticated: true, protocol: CLOUD_SYNC_PROTOCOL };
			ws.serializeAttachment?.(attachment);
			ws.send(JSON.stringify({ type: "authenticated", protocol: CLOUD_SYNC_PROTOCOL, generation: this.generation }));
			return;
		}
		if (!attachment.authenticated || attachment.protocol !== CLOUD_SYNC_PROTOCOL) {
			ws.send(JSON.stringify({ type: "unauthorized", error: "WebSocket nicht autorisiert" })); return;
		}
		if (msg.type === "ping") ws.send(JSON.stringify({ type: "pong", t: Date.now() }));
	}

	async webSocketClose(ws, code, reason) { try { ws.close(code, reason); } catch {} }
	async webSocketError(ws) { try { ws.close(); } catch {} }

	validatePacket(packet) {
		const raw = String(packet?.data || "").replace(/^gz:/, "");
		return !!packet && typeof packet.id === "string" && packet.id.length > 0 && packet.id.length <= 200 &&
			/^[0-9a-f]{24}$/i.test(String(packet.iv || "")) && raw.length > 0 && raw.length % 4 === 0 &&
			/^[A-Za-z0-9+/]+={0,2}$/.test(raw) && String(packet.data).length <= MAX_PACKET_CHARS;
	}

	savePackets(packets) {
		return this.queue(async () => {
			if (!Array.isArray(packets)) return { ok: false, status: 400, error: "Event-Pakete müssen als Array gesendet werden." };
			if (packets.length > MAX_PACKETS) return { ok: false, status: 413, error: `Maximal ${MAX_PACKETS} Pakete erlaubt.` };
			const unique = [...new Map(packets.map((p) => [p?.id, p])).values()];
			if (unique.some((p) => !this.validatePacket(p))) return { ok: false, status: 400, error: "Ungültiges verschlüsseltes Event-Paket." };
			if (!unique.length) return { ok: true, saved: [], usage: this.totalBytes };

			const placeholders = unique.map(() => "?").join(",");
			const existingRows = await this.env.DB.prepare(`SELECT event_id FROM sync_events WHERE user_id=? AND event_id IN (${placeholders})`)
				.bind(this.userId, ...unique.map((p) => p.id)).all();
			const existing = new Set((existingRows.results || []).map((row) => row.event_id));
			const fresh = unique.filter((p) => !existing.has(p.id)).map((p) => ({ ...p, size: packetSize(p) }));
			const incoming = fresh.reduce((sum, p) => sum + p.size, 0);
			if (this.totalBytes + incoming > MAX_USER_BYTES) return { ok: false, status: 413, error: "Quota überschritten.", usage: this.totalBytes };
			if (!fresh.length) return { ok: true, saved: [], usage: this.totalBytes };

			const now = new Date().toISOString(), saved = [], r2 = [], statements = [];
			let nextSeq = this.maxSeq;
			for (const packet of fresh) {
				const seq = ++nextSeq, key = `users/${this.userId}/events/${packet.id}.bin`, gz = packet.data.startsWith("gz:");
				saved.push({ id: packet.id, seq, iv: packet.iv, data: packet.data, size: packet.size, created_at: now });
				r2.push({ key, bytes: base64ToBytes(gz ? packet.data.slice(3) : packet.data), meta: { iv: packet.iv, gz: gz ? "1" : "0" } });
				statements.push(this.env.DB.prepare("INSERT INTO sync_events (user_id,seq,event_id,iv,r2_key,size,created_at) VALUES (?,?,?,?,?,?,?)")
					.bind(this.userId, seq, packet.id, packet.iv, key, packet.size, now));
			}
			const written = [];
			try {
				for (let i = 0; i < r2.length; i += 6) {
					await Promise.all(r2.slice(i, i + 6).map(async (item) => { await this.env.BUCKET.put(item.key, item.bytes, { customMetadata: item.meta }); written.push(item.key); }));
				}
				const total = this.totalBytes + incoming;
				statements.push(this.env.DB.prepare("UPDATE user_storage SET total_bytes=?,updated_at=? WHERE user_id=?").bind(total, now, this.userId));
				await this.env.DB.batch(statements);
				this.maxSeq = nextSeq; this.totalBytes = total;
			} catch (error) {
				if (written.length) try { await this.env.BUCKET.delete(written); } catch {}
				return { ok: false, status: 500, error: "Cloud-Speicher konnte nicht atomar geschrieben werden.", usage: this.totalBytes };
			}
			this.broadcast({ type: "changed", maxSeq: this.maxSeq });
			return { ok: true, saved, usage: this.totalBytes };
		});
	}

	async readEvents(since, limit) {
		const rows = await this.env.DB.prepare(
			"SELECT seq,event_id id,iv,r2_key,size,created_at FROM sync_events WHERE user_id=? AND seq>? ORDER BY seq ASC LIMIT ?"
		).bind(this.userId, since, limit).all();
		const events = []; let chars = 0, stopped = false;
		for (const row of rows.results || []) {
			const estimate = Math.ceil((Number(row.size) || 0) * 4 / 3) + 128;
			if (events.length && chars + estimate > MAX_SYNC_CHARS) { stopped = true; break; }
			const object = await this.env.BUCKET.get(row.r2_key);
			if (!object) throw new Error(`R2-Paket fehlt: ${row.id}`);
			const bytes = new Uint8Array(await object.arrayBuffer()), gz = object.customMetadata?.gz === "1";
			events.push({ seq: row.seq, id: row.id, iv: row.iv, data: (gz ? "gz:" : "") + bytesToBase64(bytes), size: row.size, created_at: row.created_at });
			chars += estimate;
		}
		return { events, stopped };
	}

	async listBlobs(cursor) {
		const prefix = `users/${this.userId}/blobs/`;
		const list = await this.env.BUCKET.list({ prefix, limit: 1000, cursor: cursor || undefined });
		return { keys: (list.objects || []).map((o) => o.key.slice(prefix.length)), cursor: list.truncated ? list.cursor : "" };
	}

	async getBlob(key) {
		const object = await this.env.BUCKET.get(`users/${this.userId}/blobs/${key}`);
		if (!object) return new Response(null, { status: 404, headers: corsHeaders() });
		return new Response(await object.arrayBuffer(), { headers: { "Content-Type": "application/octet-stream", "X-Impala-IV": object.customMetadata?.iv || "", "X-Impala-Usage": String(this.totalBytes), ...corsHeaders() } });
	}

	putBlob(key, request) {
		return this.queue(async () => {
			const iv = request.headers.get("X-Impala-IV") || "";
			if (!/^[0-9a-f]{24}$/i.test(iv) || !/^[0-9a-f]{64}$/i.test(key)) return json({ error: "Ungültiger Blob-Schlüssel oder IV." }, 400);
			const r2Key = `users/${this.userId}/blobs/${key}`;
			if (await this.env.BUCKET.head(r2Key)) return new Response(null, { status: 204, headers: { "X-Impala-Usage": String(this.totalBytes), ...corsHeaders() } });
			const bytes = new Uint8Array(await request.arrayBuffer());
			const size = bytes.byteLength + 12;
			if (!bytes.length || bytes.length > MAX_BLOB_BYTES) return json({ error: "Blob ist leer oder zu groß." }, 413);
			if (this.totalBytes + size > MAX_USER_BYTES) return json({ error: "Quota überschritten." }, 413);
			await this.env.BUCKET.put(r2Key, bytes, { customMetadata: { iv } });
			try {
				this.totalBytes += size; await this.persistUsage();
			} catch (error) {
				this.totalBytes -= size; try { await this.env.BUCKET.delete(r2Key); } catch {} throw error;
			}
			this.broadcast({ type: "changed", maxSeq: this.maxSeq });
			return new Response(null, { status: 201, headers: { "X-Impala-Usage": String(this.totalBytes), ...corsHeaders() } });
		});
	}

	async clearSyncData(bumpGeneration = false) {
		const prefix = `users/${this.userId}/`;
		while (true) {
			const list = await this.env.BUCKET.list({ prefix, limit: 1000 });
			const keys = (list.objects || []).map((o) => o.key);
			if (!keys.length) break;
			await this.env.BUCKET.delete(keys);
		}
		this.maxSeq = 0; this.totalBytes = 0;
		if (bumpGeneration) this.generation++;
		await this.env.DB.batch([
			this.env.DB.prepare("DELETE FROM sync_events WHERE user_id=?").bind(this.userId),
			this.env.DB.prepare("UPDATE user_storage SET total_bytes=0,updated_at=? WHERE user_id=?").bind(new Date().toISOString(), this.userId),
		]);
		if (this.ctx?.storage) await this.ctx.storage.put("generation", this.generation);
	}

	reset() {
		return this.queue(async () => {
			await this.clearSyncData(true);
			this.broadcast({ type: "reset", generation: this.generation });
			return json({ ok: true, generation: this.generation });
		});
	}

	async fetch(request) {
		const url = new URL(request.url), userId = userIdOf(request);
		if (!this.env?.DB || !this.env?.BUCKET) return json({ error: "Cloud-Sync benötigt D1 und R2." }, 503);
		if (!userId || userId.length < 16) return json({ error: "Fehlende oder ungültige User-ID." }, 401);

		if (url.pathname === "/ws") {
			await this.init(userId);
			if ((request.headers.get("Upgrade") || "").toLowerCase() !== "websocket") return new Response("Expected Upgrade: websocket", { status: 426 });
			let client = {}, server = {};
			if (typeof WebSocketPair !== "undefined") { const pair = new WebSocketPair(), values = Object.values(pair); [client, server] = values; }
			else if (request._mockServer) server = request._mockServer;
			if (this.ctx?.acceptWebSocket) { this.ctx.acceptWebSocket(server); server.serializeAttachment?.({ userId, authenticated: false }); }
			else if (server?.accept) { server.accept(); server.addEventListener("message", (event) => this.webSocketMessage(server, event.data)); }
			return new Response(null, { status: typeof WebSocketPair !== "undefined" ? 101 : 200, webSocket: client });
		}

		const versionError = protocolError(request); if (versionError) return versionError;
		await this.init(userId);
		if (!(await this.authorize(authTokenOf(request)))) return json({ error: "Ungültiger Autorisierungs-Token für diesen Account." }, 403);

		if (url.pathname === "/api/quota" && request.method === "GET") return json({ usage: this.totalBytes, limit: MAX_USER_BYTES, generation: this.generation });
		if (url.pathname === "/api/sync" && request.method === "GET") {
			const since = Math.max(0, Number.parseInt(url.searchParams.get("since") || "0", 10));
			const limit = Math.min(1000, Math.max(1, Number.parseInt(url.searchParams.get("limit") || "100", 10)));
			const { events, stopped } = await this.readEvents(since, limit);
			return json({ events, maxSeq: this.maxSeq, hasMore: stopped || events.length === limit, usage: this.totalBytes, limit: MAX_USER_BYTES, generation: this.generation });
		}
		if (url.pathname === "/api/events" && request.method === "POST") {
			const body = await request.json().catch(() => null), result = await this.savePackets(body?.events);
			return result.ok ? json({ ok: true, savedCount: result.saved.length, usage: result.usage, limit: MAX_USER_BYTES, generation: this.generation })
				: json({ error: result.error, usage: result.usage, limit: MAX_USER_BYTES }, result.status || 400);
		}
		if (url.pathname === "/api/blobs" && request.method === "GET") return json(await this.listBlobs(url.searchParams.get("cursor") || ""));
		if (url.pathname.startsWith("/api/blob/")) {
			const key = url.pathname.slice("/api/blob/".length);
			if (!/^[0-9a-f]{64}$/i.test(key)) return json({ error: "Ungültiger Blob-Schlüssel." }, 400);
			if (request.method === "GET") return this.getBlob(key);
			if (request.method === "PUT") return this.putBlob(key, request);
		}
		if (url.pathname === "/api/reset" && request.method === "POST") return this.reset();
		return json({ error: "Endpunkt nicht gefunden." }, 404);
	}
}

async function handleRequest(request, env) {
	if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders() });
	const url = new URL(request.url);
	if (url.pathname === "/" || url.pathname === "/api/health") return json({
		app: "Impala67 Sync Server", version: "4.0.0", protocol: CLOUD_SYNC_PROTOCOL,
		features: ["e2ee", "ordered_http_sync", "ws_invalidation", "immutable_blobs", "generation_reset", "atomic_dedup"],
		quotaLimitBytes: MAX_USER_BYTES,
	});
	if (url.pathname !== "/ws") { const error = protocolError(request); if (error) return error; }
	if (["/api/models", "/models", "/v1/models"].includes(url.pathname)) return json({ object: "list", data: AI_MODELS.map((id) => ({ id, object: "model", owned_by: "groq" })) });
	if (url.pathname === "/api/ai") return handleAi(request, env);
	if (url.pathname === "/api/notion") return handleNotion(request, env);
	const userId = userIdOf(request);
	if (!userId || userId.length < 16) return json({ error: "Fehlende oder ungültige User-ID." }, 401);
	if (!env.SYNC_ROOM) return json({ error: "SYNC_ROOM Durable Object fehlt." }, 503);
	return env.SYNC_ROOM.get(env.SYNC_ROOM.idFromName(userId)).fetch(request);
}

export default {
	async fetch(request, env) {
		try { return await handleRequest(request, env); }
		catch (error) { console.error("worker_fetch", error); return json({ error: "Interner Cloudflare-Fehler.", code: "internal_error" }, 500); }
	},
};
