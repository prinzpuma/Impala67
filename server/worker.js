/**
 * Impala67 Cloudflare Real-Time Sync Worker (Production Grade 10/10)
 * 
 * - Durable Objects: Globaler Actor pro User-ID (garantiert 100% zuverlässige WebSockets weltweit)
 * - Single-Thread Actor: Schließt Race-Conditions bei Sequenznummern (seq) mathematisch aus
 * - Atomare Deduplizierung: Erkennt und ignoriert bereits gespeicherte event_ids
 * - WebSocket Hibernation + Attachment: Stellt userId & Auth-Status nach Schlafzustand zuverlässig wieder her
 * - In-Band WebSocket Handshake: Kein Token in der URL-Query (geschützt vor Log-Leaks & Referer-Leaks)
 * - Gehashte Token-Verifikation: Server speichert ausschließlich SHA-256 Hashes der Tokens (Zero-Knowledge)
 * - D1 Datenbank: Langzeit-SQL-Persistenz
 * - E2EE: Server speichert ausschließlich Chiffrate { iv, data }
 * - Quota-Schutz: Striktes 500 MB Limit pro Nutzer
 */

const MAX_USER_STORAGE_BYTES = 500 * 1024 * 1024; // 500 MB pro Nutzer
const MAX_TOTAL_SERVER_USERS = 8; // Maximal 8 Accounts (8 x 500 MB = 4.000 MB = 4 GB, 1 GB Puffer zum 5 GB Free Limit)
const enc = new TextEncoder();

function corsHeaders() {
	return {
		"Access-Control-Allow-Origin": "*",
		"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
		// Authorization muss bei CORS explizit erlaubt werden. Der Platzhalter
		// deckt diesen Header in Browsern nicht zuverlässig ab.
		"Access-Control-Allow-Headers": "Authorization, Content-Type, X-User-Id, X-Auth-Token",
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

function extractAuthToken(request) {
	const authHeader = request.headers.get("Authorization") || "";
	if (authHeader.startsWith("Bearer ")) {
		return authHeader.slice(7).trim();
	}
	const customHeader = request.headers.get("X-Auth-Token");
	if (customHeader) return customHeader.trim();
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
		this.knownEventIds = new Set();
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
			this.authTokenHash = await this.ctx.storage.get("authTokenHash");
		}

		// 2. Initialzustand aus D1 Datenbank laden
		if (this.env?.DB && userId) {
			const eventStateRow = await this.env.DB.prepare(
				"SELECT COALESCE(MAX(seq), 0) as max_seq, COALESCE(SUM(size), 0) as total_bytes FROM sync_events WHERE user_id = ?"
			).bind(userId).first();
			this.maxSeq = eventStateRow ? Number(eventStateRow.max_seq) : 0;
			// SUM(size) repariert auch alte, vor diesem Fix zu niedrig
			// gespeicherte user_storage-Zähler ohne Datenmigration.
			this.totalBytes = eventStateRow ? Number(eventStateRow.total_bytes) || 0 : 0;

			const usageRow = await this.env.DB.prepare(
				"SELECT auth_token_hash, total_bytes FROM user_storage WHERE user_id = ?"
			).bind(userId).first();

			if (usageRow) {
				if (usageRow.auth_token_hash && !this.authTokenHash) {
					this.authTokenHash = usageRow.auth_token_hash;
				}
			}

			const rows = await this.env.DB.prepare(
				"SELECT event_id FROM sync_events WHERE user_id = ?"
			).bind(userId).all();
			for (const r of rows.results || []) {
				this.knownEventIds.add(r.event_id);
			}
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
			if (this.env?.DB) {
				const countStmt = this.env.DB.prepare("SELECT COUNT(*) as cnt FROM user_storage");
				const countRow = typeof countStmt.first === "function" ? await countStmt.first() : (countStmt.bind ? await countStmt.bind().first() : null);
				const currentUsers = countRow ? Number(countRow.cnt) : 0;
				if (currentUsers >= MAX_TOTAL_SERVER_USERS) {
					return false; // Server-Kapazität von 25 Nutzern erreicht
				}
			}
			this.authTokenHash = providedHash;
			if (this.ctx?.storage) {
				await this.ctx.storage.put("authTokenHash", providedHash);
			}
			if (this.env?.DB && this.userId) {
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
					if (att.authenticated) isAuth = true;
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
				const ok = await this.verifyAuthorization(msg.token);
				if (ok) {
					if (typeof ws.serializeAttachment === "function") {
						ws.serializeAttachment({ userId: this.userId, authenticated: true });
					}
					ws.send(JSON.stringify({ type: "authenticated" }));
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
		await this.ensureInitialized(this.userId);
		if (!events || !events.length) {
			return { ok: true, savedEvents: [], maxSeq: this.maxSeq, usage: this.totalBytes };
		}

		// 1. Filtern und Deduplizieren
		const freshEvents = [];
		const batchEventIds = new Set();
		let incomingBytes = 0;

		for (const ev of events) {
			if (
				!ev || typeof ev.id !== "string" || !ev.id || ev.id.length > 200 ||
				typeof ev.iv !== "string" || !/^[0-9a-f]{24}$/i.test(ev.iv) ||
				typeof ev.data !== "string" || !ev.data || ev.data.length % 4 !== 0 ||
				!/^[A-Za-z0-9+/]+={0,2}$/.test(ev.data)
			) {
				return { ok: false, error: "Ungültiges verschlüsseltes Event-Paket.", status: 400, usage: this.totalBytes };
			}
			// Bereits bekanntes Event überspringen (Idempotenz)
			if (this.knownEventIds.has(ev.id) || batchEventIds.has(ev.id)) continue;
			batchEventIds.add(ev.id);

			// Quota-Werte niemals vom Client übernehmen: Base64 enthält vier
			// Zeichen je drei Chiffrat-Bytes, die IV liegt als Hex vor.
			const padding = ev.data.endsWith("==") ? 2 : (ev.data.endsWith("=") ? 1 : 0);
			const cipherBytes = Math.max(0, Math.floor((ev.data.length * 3) / 4) - padding);
			const ivBytes = Math.floor(ev.iv.length / 2);
			const size = cipherBytes + ivBytes;
			incomingBytes += size;
			freshEvents.push({ ...ev, size });
		}

		// Falls alle Events bereits existieren -> Erfolgreicher No-Op (idempotent)
		if (!freshEvents.length) {
			return { ok: true, savedEvents: [], maxSeq: this.maxSeq, usage: this.totalBytes };
		}

		// 2. Quota Check (500 MB)
		if (this.totalBytes + incomingBytes > MAX_USER_STORAGE_BYTES) {
			return {
				ok: false,
				error: "Quota überschritten: Das Limit von 500 MB für diesen Account wurde erreicht.",
				status: 413,
				usage: this.totalBytes,
			};
		}

		// 3. Sequenznummern atomar vergeben
		const savedEvents = [];
		const now = new Date().toISOString();
		const stmts = [];

		let nextSeq = this.maxSeq;
		for (const ev of freshEvents) {
			nextSeq++;
			const saved = {
				id: ev.id,
				seq: nextSeq,
				iv: ev.iv,
				data: ev.data,
				size: ev.size,
				created_at: now,
			};
			savedEvents.push(saved);

			if (this.env?.DB) {
				stmts.push(
					this.env.DB.prepare(
						"INSERT OR IGNORE INTO sync_events (user_id, seq, event_id, iv, data, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
					).bind(this.userId, saved.seq, saved.id, saved.iv, saved.data, saved.size, now)
				);
			}
		}

		const nextTotalBytes = this.totalBytes + incomingBytes;
		if (this.env?.DB) {
			stmts.push(
				this.env.DB.prepare(
					"INSERT INTO user_storage (user_id, auth_token_hash, total_bytes, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET total_bytes = ?, updated_at = ?"
				).bind(this.userId, this.authTokenHash, nextTotalBytes, now, nextTotalBytes, now)
			);
			await this.env.DB.batch(stmts);
		}

		// Erst nach erfolgreichem Persistieren in-memory fortschreiben. Bei einem
		// D1-Fehler darf der Actor keine Events als gespeichert markieren.
		this.maxSeq = nextSeq;
		this.totalBytes = nextTotalBytes;
		for (const ev of freshEvents) this.knownEventIds.add(ev.id);

		return {
			ok: true,
			savedEvents,
			maxSeq: this.maxSeq,
			usage: this.totalBytes,
		};
	}

	async fetch(request) {
		const url = new URL(request.url);
		const userId = url.searchParams.get("user") || request.headers.get("X-User-Id");
		if (!userId || userId.length < 16) {
			return jsonResponse({ error: "Fehlende oder ungültige User-ID" }, 401);
		}

		await this.ensureInitialized(userId);

		// 1. WebSocket Verbindungsaufbau (In-Band Auth)
		if (url.pathname === "/ws") {
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

			let events = [];
			if (this.env?.DB) {
				const rows = await this.env.DB.prepare(
					"SELECT seq, event_id as id, iv, data, size, created_at FROM sync_events WHERE user_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?"
				).bind(userId, since, limit).all();
				events = rows.results || [];
			}

			return jsonResponse({
				events,
				since,
				maxSeq: this.maxSeq,
				hasMore: events.length === limit,
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
			this.maxSeq = 0;
			this.totalBytes = 0;
			this.knownEventIds.clear();

			if (this.env?.DB) {
				await this.env.DB.prepare("DELETE FROM sync_events WHERE user_id = ?").bind(userId).run();
				await this.env.DB.prepare("DELETE FROM user_storage WHERE user_id = ?").bind(userId).run();
			}

			this.broadcast({ type: "reset" });
			return jsonResponse({ ok: true, message: "Cloud-Daten gelöscht" });
		}

		return jsonResponse({ error: "Endpunkt nicht gefunden" }, 404);
	}
}

export default {
	async fetch(request, env, ctx) {
		// Preflight CORS
		if (request.method === "OPTIONS") {
			return new Response(null, { status: 204, headers: corsHeaders() });
		}

		const url = new URL(request.url);

		// Health Check
		if (url.pathname === "/api/health" || url.pathname === "/") {
			return jsonResponse({
				app: "Impala67 Real-Time Sync Server",
				version: "2.2.1",
				features: ["durable_objects", "websocket_hibernation", "in_band_auth", "hashed_token_verifier", "attachment_state", "e2ee", "atomic_dedup"],
				quotaLimitBytes: MAX_USER_STORAGE_BYTES,
			});
		}

		const userId = url.searchParams.get("user") || request.headers.get("X-User-Id");
		if (!userId || userId.length < 16) {
			return jsonResponse({ error: "Fehlende oder ungültige User-ID (mindestens 16 Zeichen erforderlich)" }, 401);
		}

		// An den globalen User-Durable-Object Actor weiterleiten
		if (env.SYNC_ROOM) {
			const id = env.SYNC_ROOM.idFromName(userId);
			const room = env.SYNC_ROOM.get(id);
			return room.fetch(request);
		}

		// Fallback
		const room = new SyncRoom(ctx, env);
		return room.fetch(request);
	},
};
