// mcp/test-mcp.mjs - Automatisierter Integrationstest für Impala67 MCP-Server
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SERVER_PATH = resolve(__dirname, "server.mjs");

function createMcpClient(env = {}) {
	const child = spawn(process.execPath, [SERVER_PATH], {
		cwd: resolve(__dirname, ".."),
		env: {
			...process.env,
			// Eigener Port, damit Tests nie die echte, im Browser offene App erreichen
			IMPALA_WS_PORT: String(20000 + Math.floor(Math.random() * 20000)),
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


