// mcp/test-mcp.mjs - Automatisierter Integrationstest für Impala67 MCP-Server
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, unlinkSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { WebSocket } from "ws";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SERVER_PATH = resolve(__dirname, "server.mjs");

function createMcpClient(env = {}) {
	const tempDir = mkdtempSync(resolve(tmpdir(), "impala-mcp-test-"));
	const testStorage = resolve(tempDir, ".storage.json");

	const child = spawn(process.execPath, [SERVER_PATH], {
		cwd: resolve(__dirname, ".."),
		env: {
			...process.env,
			IMPALA67_STORAGE_FILE: testStorage,
			...env,
		},
		stdio: ["pipe", "pipe", "pipe"],
	});

	let reqId = 0;
	const pending = new Map();
	let buffer = "";

	child.stdout.on("data", (chunk) => {
		buffer += chunk.toString("utf8");
		const lines = buffer.split("\n");
		buffer = lines.pop() || "";

		for (const line of lines) {
			const clean = line.trim();
			if (!clean) continue;
			try {
				const msg = JSON.parse(clean);
				if (msg.id !== undefined && pending.has(msg.id)) {
					const { resolve, reject } = pending.get(msg.id);
					pending.delete(msg.id);
					if (msg.error) {
						reject(new Error(msg.error.message || JSON.stringify(msg.error)));
					} else {
						resolve(msg.result);
					}
				}
			} catch (err) {
				console.error("Fehler beim Parsen der Server-Antwort:", clean, err);
			}
		}
	});

	child.stderr.on("data", (chunk) => {
		// Server-Logs nach stderr sind im Normalbetrieb erwartet
	});

	function request(method, params) {
		const id = ++reqId;
		return new Promise((resolve, reject) => {
			pending.set(id, { resolve, reject });
			const msg = { jsonrpc: "2.0", id, method, params };
			child.stdin.write(JSON.stringify(msg) + "\n");
		});
	}

	function notify(method, params) {
		const msg = { jsonrpc: "2.0", method, params };
		child.stdin.write(JSON.stringify(msg) + "\n");
	}

	async function callTool(name, args) {
		const res = await request("tools/call", { name, arguments: args });
		assert.ok(res, "Ergebnis von tools/call darf nicht leer sein");
		const content = res.content?.[0]?.text;
		let data = null;
		if (content && !res.isError) {
			try { data = JSON.parse(content); } catch {}
		}
		return {
			isError: !!res.isError,
			content,
			data,
		};
	}

	async function close() {
		child.stdin.end();
		child.kill();
		try {
			if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
		} catch {}
	}

	return { request, notify, callTool, close };
}

test("MCP-Server: Initialisierung, Werkzeuge und Lebenszyklus", async () => {
	const client = createMcpClient();
	try {
		// 1. Initialisierung
		const initRes = await client.request("initialize", {
			protocolVersion: "2024-11-05",
			capabilities: {},
			clientInfo: { name: "test-client", version: "1.0.0" },
		});
		assert.equal(initRes.serverInfo?.name, "impala67-mcp");
		assert.equal(initRes.serverInfo?.version, "1.0.0");
		assert.ok(initRes.capabilities?.tools);

		client.notify("notifications/initialized", {});

		// 2. Werkzeuge auflisten
		const toolsRes = await client.request("tools/list", {});
		const toolNames = (toolsRes.tools || []).map((t) => t.name);
		assert.ok(toolNames.includes("impala_list_pages"));
		assert.ok(toolNames.includes("impala_get_page"));
		assert.ok(toolNames.includes("impala_create_page"));
		assert.ok(toolNames.includes("impala_update_page"));
		assert.ok(toolNames.includes("impala_search"));
		assert.ok(toolNames.includes("impala_list_flashcards"));
		assert.ok(toolNames.includes("impala_create_flashcard"));
	} finally {
		await client.close();
	}
});

test("MCP-Server: Notiz-Erstellung, Auslesen, Suche und Aktualisierung", async () => {
	const client = createMcpClient();
	try {
		await client.request("initialize", { protocolVersion: "2024-11-05", capabilities: {} });
		client.notify("notifications/initialized", {});

		// 1. Notiz anlegen
		const createRes = await client.callTool("impala_create_page", {
			title: "Analysis Grundlagen",
			content: "Die Ableitung f'(x) beschreibt die lokale Steigung der Funktion f an der Stelle x.",
			subject: "Mathematik",
		});
		assert.equal(createRes.isError, false);
		assert.equal(createRes.data.ok, true);
		assert.equal(createRes.data.title, "Analysis Grundlagen");
		assert.equal(createRes.data.subject, "Mathematik");
		assert.equal(createRes.data.kind, "notion");
		const pageId = createRes.data.id;
		assert.ok(pageId);

		// 2. Notiz per Titel auslesen
		const getRes = await client.callTool("impala_get_page", { title: "Analysis Grundlagen" });
		assert.equal(getRes.isError, false);
		assert.equal(getRes.data.id, pageId);
		assert.match(getRes.data.content, /lokale Steigung/);
		assert.equal(getRes.data.subject, "Mathematik");

		// 3. Notizen auflisten
		const listRes = await client.callTool("impala_list_pages", { query: "Analysis" });
		assert.equal(listRes.isError, false);
		assert.ok(listRes.data.pages.some((p) => p.id === pageId));

		// 4. Volltextsuche
		const searchRes = await client.callTool("impala_search", { query: "lokale Steigung" });
		assert.equal(searchRes.isError, false);
		assert.ok(searchRes.data.results.length >= 1);
		assert.equal(searchRes.data.results[0].id, pageId);

		// 5. Notiz aktualisieren (Inhalt anhängen)
		const updateRes = await client.callTool("impala_update_page", {
			id: pageId,
			append_content: "Zweite Ableitung f''(x) gibt Auskunft über das Krümmungsverhalten.",
		});
		assert.equal(updateRes.isError, false);
		assert.equal(updateRes.data.ok, true);

		// Prüfen, dass der neue Inhalt vorhanden ist
		const getUpdated = await client.callTool("impala_get_page", { id: pageId });
		assert.match(getUpdated.data.content, /lokale Steigung/);
		assert.match(getUpdated.data.content, /Krümmungsverhalten/);
	} finally {
		await client.close();
	}
});

test("MCP-Server: Karteikarten erstellen und auflisten", async () => {
	const client = createMcpClient();
	try {
		await client.request("initialize", { protocolVersion: "2024-11-05", capabilities: {} });
		client.notify("notifications/initialized", {});

		// 1. Karteikarte anlegen
		const createCard = await client.callTool("impala_create_flashcard", {
			front: "Was ist die Ableitung von e^x?",
			back: "e^x",
			deck: "Mathematik::Analysis",
		});
		assert.equal(createCard.isError, false);
		assert.equal(createCard.data.ok, true);
		assert.equal(createCard.data.deck, "Mathematik::Analysis");
		const cardId = createCard.data.id;
		assert.ok(cardId);

		// 2. Karteikarten auflisten (nach Stapel gefiltert)
		const listCards = await client.callTool("impala_list_flashcards", { deck: "Analysis" });
		assert.equal(listCards.isError, false);
		assert.ok(listCards.data.cards.some((c) => c.id === cardId && c.back === "e^x"));

		// 3. Suche findet auch Karteikarten
		const searchCards = await client.callTool("impala_search", { query: "Ableitung von e^x" });
		assert.equal(searchCards.isError, false);
		assert.ok(searchCards.data.results.some((r) => r.type === "flashcard" && r.id === cardId));
	} finally {
		await client.close();
	}
});

test("MCP-Server: Handschrift-Heft Textauslese schützt Vektorstriche", async () => {
	const client = createMcpClient();
	try {
		await client.request("initialize", { protocolVersion: "2024-11-05", capabilities: {} });
		client.notify("notifications/initialized", {});

		// 1. Heft-Seite anlegen
		const createHeft = await client.callTool("impala_create_page", {
			title: "Chemie Formeln",
			content: "H2O + CO2 -> H2CO3",
			kind: "heft",
			subject: "Chemie",
		});
		assert.equal(createHeft.isError, false);
		assert.equal(createHeft.data.kind, "heft");
		const heftId = createHeft.data.id;

		// 2. Heft auslesen: Liefert Text und schützt Striche
		const getHeft = await client.callTool("impala_get_page", { id: heftId });
		assert.equal(getHeft.isError, false);
		assert.equal(getHeft.data.kind, "heft");
		assert.match(getHeft.data.content, /H2O \+ CO2/);
		assert.match(getHeft.data.note, /Vektorstriche bleiben geschützt/);

		// 3. Text sicher an Heft anhängen
		const updateHeft = await client.callTool("impala_update_page", {
			id: heftId,
			append_content: "pH-Wert von Kohlensäure ist leicht sauer.",
		});
		assert.equal(updateHeft.isError, false);

		// 4. Prüfen, dass beide Texte enthalten sind
		const getHeftAfter = await client.callTool("impala_get_page", { id: heftId });
		assert.match(getHeftAfter.data.content, /H2O \+ CO2/);
		assert.match(getHeftAfter.data.content, /pH-Wert/);
	} finally {
		await client.close();
	}
});

test("MCP-Server: Eingabe-Validierungen und Fehlerfälle", async () => {
	const client = createMcpClient();
	try {
		await client.request("initialize", { protocolVersion: "2024-11-05", capabilities: {} });
		client.notify("notifications/initialized", {});

		// 1. Notiz ohne Titel schlägt fehl
		const failPage = await client.callTool("impala_create_page", { title: "   " });
		assert.equal(failPage.isError, true);
		assert.match(failPage.content, /title ist ein Pflichtfeld/);

		// 2. Nicht existierende Seite auslesen
		const notFound = await client.callTool("impala_get_page", { id: "gibts-nicht-12345" });
		assert.equal(notFound.isError, true);
		assert.match(notFound.content, /Notiz nicht gefunden/);

		// 3. Karteikarte ohne Vorder- oder Rückseite schlägt fehl
		const failCard1 = await client.callTool("impala_create_flashcard", { front: "", back: "Antwort" });
		assert.equal(failCard1.isError, true);
		assert.match(failCard1.content, /front und back dürfen nicht leer sein/);

		const failCard2 = await client.callTool("impala_create_flashcard", { front: "Frage", back: "" });
		assert.equal(failCard2.isError, true);
		assert.match(failCard2.content, /front und back dürfen nicht leer sein/);

		// 4. Live-only Werkzeuge liefern klare Fehlermeldung wenn Browser offline
		const liveOnly = await client.callTool("impala_get_diagnostics", {});
		assert.equal(liveOnly.isError, true);
		assert.match(liveOnly.content, /nur im Live-Betrieb verfügbar/);
	} finally {
		await client.close();
	}
});

test("Sync-Client: E2EE Schlüsselableitung, Verschlüsselung und Offline-Fallback", async () => {
	const { createSyncClient } = await import("./sync-client.mjs");
	const { deriveSyncCredentials, encryptPayload, decryptPayload } = await import("../web/sync-crypto.js");
	const { cloudEventsEnvelope, prepareIncomingCloudEvents } = await import("../web/sync-core.js");

	// 1. Offline-Fallback ohne Schlüssel
	const offlineClient = await createSyncClient({ syncKey: "" });
	assert.equal(offlineClient.isConfigured(), false);
	const pullRes = await offlineClient.pull(0);
	assert.equal(pullRes.configured, false);
	assert.deepEqual(pullRes.events, []);

	const pushRes = await offlineClient.push([{ id: "ev-1", type: "pageCreate" }]);
	assert.equal(pushRes.configured, false);
	assert.equal(pushRes.ok, false);

	// 2. E2EE-Schlüsselableitung und Entschlüsselung
	const testSyncKey = "impala-1111-2222-3333-4444-5555-6666-7777-8888";
	const creds = await deriveSyncCredentials(testSyncKey);
	assert.ok(creds.userId);
	assert.ok(creds.authToken);
	assert.ok(creds.cryptoKey);

	// Round-Trip Test mit Cloud-Events
	const sampleEvent = {
		id: "test-event-uuid",
		t: new Date().toISOString(),
		type: "pageCreate",
		payload: { id: "p1", title: "Test E2EE", content: "Geheim" },
	};
	const encrypted = await encryptPayload(creds.cryptoKey, cloudEventsEnvelope([sampleEvent]));
	assert.ok(encrypted.iv);
	assert.ok(encrypted.data);

	const decrypted = await decryptPayload(creds.cryptoKey, encrypted);
	const incoming = prepareIncomingCloudEvents([decrypted]);
	assert.equal(incoming.length, 1);
	assert.equal(incoming[0].id, "test-event-uuid");
	assert.equal(incoming[0].payload.title, "Test E2EE");
	assert.equal(incoming[0]._remote, true);
});

test("MCP-Bridge: Live WebSocket Verbindung, konfigurierbare Timeouts und Multi-Tab Resilienz", async () => {
	const testPort = 8799;
	const client = createMcpClient({ IMPALA_WS_PORT: String(testPort) });
	let ws1 = null;
	let ws2 = null;

	try {
		await client.request("initialize", { protocolVersion: "2024-11-05", capabilities: {} });
		client.notify("notifications/initialized", {});

		// 1. WebSocket-Verbindung 1 (Tab 1) aufbauen
		ws1 = new WebSocket(`ws://127.0.0.1:${testPort}`);
		await new Promise((resolve, reject) => {
			ws1.on("open", resolve);
			ws1.on("error", reject);
		});

		// Tool-Antwort-Handler für ws1
		ws1.on("message", (raw) => {
			const data = JSON.parse(raw);
			if (data.callId && data.tool === "impala_get_diagnostics") {
				ws1.send(JSON.stringify({
					callId: data.callId,
					result: { app: { activePageTitle: "Tab 1 Notiz" }, sync: { cloudflare: { status: "connected" } } },
				}));
			} else if (data.callId && data.tool === "impala_run_ui_action" && data.args?.action === "trigger_sync") {
				ws1.send(JSON.stringify({
					callId: data.callId,
					result: { ok: true, sync: true, mode: data.args?.await === false ? "background" : "completed" },
				}));
			} else if (data.callId && data.tool === "slow_action") {
				// Absichtlich nicht antworten für Timeout-Test
			}
		});

		// 2. Diagnostik über Live-Bridge abrufen und prüfen, dass Latenz & Client-Count angereichert werden
		const diagRes = await client.callTool("impala_get_diagnostics", {});
		assert.equal(diagRes.isError, false);
		assert.equal(diagRes.data.app?.activePageTitle, "Tab 1 Notiz");
		assert.equal(diagRes.data.mcpServer?.connectedClients, 1);
		assert.ok(typeof diagRes.data.mcpServer?.lastLatencyMs === "number");

		// 3. trigger_sync mit await: false testen
		const syncBgRes = await client.callTool("impala_run_ui_action", { action: "trigger_sync", await: false });
		assert.equal(syncBgRes.isError, false);
		assert.equal(syncBgRes.data.mode, "background");

		// 4. Konfigurierbares Timeout mit aussagekräftiger Fehlermeldung testen
		const timeoutRes = await client.callTool("slow_action", { timeoutMs: 150 });
		assert.equal(timeoutRes.isError, true);
		assert.match(timeoutRes.content, /Timeout nach \d+ms bei 'slow_action' in Browser-App/);
		assert.match(timeoutRes.content, /Hintergrund-Tab drosselt JavaScript/);

		// 5. Multi-Tab Test: Tab 2 verbindet sich, Tab 1 trennt sich -> Server bleibt stabil
		ws2 = new WebSocket(`ws://127.0.0.1:${testPort}`);
		await new Promise((resolve, reject) => {
			ws2.on("open", resolve);
			ws2.on("error", reject);
		});

		ws2.on("message", (raw) => {
			const data = JSON.parse(raw);
			if (data.callId && data.tool === "impala_get_diagnostics") {
				ws2.send(JSON.stringify({
					callId: data.callId,
					result: { app: { activePageTitle: "Tab 2 Notiz" }, sync: { cloudflare: { status: "connected" } } },
				}));
			}
		});

		// Tab 1 schließt
		ws1.close();
		await new Promise((r) => setTimeout(r, 100));

		// Aufruf geht nahtlos an Tab 2 weiter
		const tab2Diag = await client.callTool("impala_get_diagnostics", {});
		assert.equal(tab2Diag.isError, false);
		assert.equal(tab2Diag.data.app?.activePageTitle, "Tab 2 Notiz");
		assert.equal(tab2Diag.data.mcpServer?.connectedClients, 1);
	} finally {
		if (ws1) try { ws1.close(); } catch {}
		if (ws2) try { ws2.close(); } catch {}
		await client.close();
	}
});


