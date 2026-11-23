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
		for (const name of ["impala_search", "impala_read_pages", "impala_list_pages", "impala_create_pages", "impala_edit_page", "impala_list_cards", "impala_create_cards", "impala_targets"]) {
			assert.ok(toolNames.includes(name), name);
		}
		const addPagesTool = toolsRes.tools.find((t) => t.name === "impala_heft_add_pages");
		assert.ok(addPagesTool?.inputSchema?.properties?.replace, "impala_heft_add_pages braucht replace");
		assert.ok(addPagesTool?.inputSchema?.properties?.allow_content, "impala_heft_add_pages braucht allow_content");
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

test("MCP-Bridge: Produktiv-Tab wird nicht von localhost-Testtab verdrängt & impala_targets schaltet gezielt um", async () => {
	const testPort = 8800;
	const client = createMcpClient({ IMPALA_WS_PORT: String(testPort) });
	let wsProd = null;
	let wsLocal = null;

	try {
		await client.request("initialize", { protocolVersion: "2024-11-05", capabilities: {} });
		client.notify("notifications/initialized", {});

		wsProd = new WebSocket(`ws://127.0.0.1:${testPort}`, { headers: { origin: "https://prinzpuma.github.io" } });
		await new Promise((resolve, reject) => { wsProd.on("open", resolve); wsProd.on("error", reject); });
		wsProd.send(JSON.stringify({ hello: true, meta: { origin: "https://prinzpuma.github.io", url: "https://prinzpuma.github.io/Impala67/?mcpBridge=1", kind: "pwa", pageCount: 42 } }));
		wsProd.on("message", (raw) => {
			const data = JSON.parse(raw);
			if (data.callId && data.tool === "impala_get_diagnostics") {
				wsProd.send(JSON.stringify({ callId: data.callId, result: { app: { activePageTitle: "Echte Notiz" } } }));
			} else if (data.callId) {
				wsProd.send(JSON.stringify({ callId: data.callId, result: { pages: [{ id: "p1", title: "Echte Notiz" }] } }));
			}
		});

		wsLocal = new WebSocket(`ws://127.0.0.1:${testPort}`, { headers: { origin: "http://localhost:8000" } });
		await new Promise((resolve, reject) => { wsLocal.on("open", resolve); wsLocal.on("error", reject); });
		wsLocal.send(JSON.stringify({ claim: true, meta: { origin: "http://localhost:8000", url: "http://localhost:8000/", kind: "pwa", pageCount: 5 } }));
		wsLocal.on("message", (raw) => {
			const data = JSON.parse(raw);
			if (data.callId && data.tool === "impala_get_diagnostics") {
				wsLocal.send(JSON.stringify({ callId: data.callId, result: { app: { activePageTitle: "Test-Tab" } } }));
			} else if (data.callId && data.tool === "impala_list_pages") {
				wsLocal.send(JSON.stringify({ callId: data.callId, result: { pages: [] } }));
			} else if (data.callId) {
				wsLocal.send(JSON.stringify({ callId: data.callId, result: { error: "Kein Heft gefunden" } }));
			}
		});
		await new Promise((r) => setTimeout(r, 80));

		// localhost-claim darf prinzpuma.github.io nicht verdrängen
		const diag1 = await client.callTool("impala_get_diagnostics", {});
		assert.equal(diag1.data.app?.activePageTitle, "Echte Notiz");

		// impala_targets listet beide und kann gezielt pinnen
		const targetsRes = await client.callTool("impala_targets", {});
		assert.equal(targetsRes.data.targets.length, 2);
		const selLocal = await client.callTool("impala_targets", { select: "localhost" });
		assert.equal(selLocal.isError, false);
		// Erster Aufruf nach Zielwechsel meldet _targetChanged; Fehler nennen aktives Ziel
		const listLocal = await client.callTool("impala_list_pages", {});
		assert.match(listLocal.data._targetChanged || "", /prinzpuma\.github\.io.*->.*localhost:8000/);
		const listLocal2 = await client.callTool("impala_list_pages", {});
		assert.equal(listLocal2.data._targetChanged, undefined);
		assert.match(listLocal2.data._target || "", /localhost:8000/);
		const errLocal = await client.callTool("impala_heft_add_pages", { page_id: "x", data_base64: "AA==" });
		assert.equal(errLocal.isError, true);
		assert.match(errLocal.content, /Ziel: http:\/\/localhost:8000/);

		// Zurück auf Produktiv-Tab
		await client.callTool("impala_targets", { select: "prinzpuma.github.io" });
		const diag3 = await client.callTool("impala_get_diagnostics", {});
		assert.equal(diag3.data.app?.activePageTitle, "Echte Notiz");
	} finally {
		if (wsProd) try { wsProd.close(); } catch {}
		if (wsLocal) try { wsLocal.close(); } catch {}
		await client.close();
	}
});


