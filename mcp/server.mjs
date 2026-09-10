#!/usr/bin/env node
// mcp/server.mjs - Model Context Protocol (MCP) Stdio JSON-RPC Server für Impala67
import { createInterface } from "node:readline";
import { WebSocketServer } from "ws";
import { createStore } from "./store.mjs";
import { createSyncClient } from "./sync-client.mjs";

let liveBrowserWs = null;
const pendingBrowserCalls = new Map();
let browserCallSeq = 1;

try {
	const wss = new WebSocketServer({ port: 8765 });
	wss.on("connection", (ws) => {
		console.error("[impala-mcp] ⚡ Browser-App live verbunden!");
		liveBrowserWs = ws;

		ws.on("message", (raw) => {
			try {
				const data = JSON.parse(raw);
				if (data && data.callId && pendingBrowserCalls.has(data.callId)) {
					const { resolve } = pendingBrowserCalls.get(data.callId);
					pendingBrowserCalls.delete(data.callId);
					resolve(data.result);
				}
			} catch (e) {
				console.error("[impala-mcp] Fehler bei Browser-Nachricht:", e.message);
			}
		});

		ws.on("close", () => {
			console.error("[impala-mcp] Browser-App getrennt.");
			if (liveBrowserWs === ws) liveBrowserWs = null;
		});

		ws.on("error", (err) => {
			console.error("[impala-mcp] WebSocket-Fehler:", err.message);
		});
	});
	wss.on("error", (err) => {
		console.error("[impala-mcp] WSS Port 8765:", err.message);
	});
} catch (e) {
	console.error("[impala-mcp] Konnte WSS nicht starten:", e.message);
}

function callLiveBrowser(tool, args) {
	if (!liveBrowserWs || liveBrowserWs.readyState !== 1) return null;
	const callId = browserCallSeq++;
	return new Promise((resolve) => {
		const timer = setTimeout(() => {
			pendingBrowserCalls.delete(callId);
			resolve({ error: "Timeout bei Antwort der Browser-App" });
		}, 8000);
		pendingBrowserCalls.set(callId, {
			resolve: (res) => {
				clearTimeout(timer);
				resolve(res);
			},
		});
		liveBrowserWs.send(JSON.stringify({ callId, tool, args }));
	});
}

const SERVER_NAME = "impala67-mcp";
const SERVER_VERSION = "1.0.0";
const PROTOCOL_VERSION = "2024-11-05";

// Tool-Definitionen nach MCP Spezifikation
const TOOLS = [
	{
		name: "impala_list_pages",
		description: "Listet vorhandene Notizen in Impala67 auf (ID, Titel, Art: Notion vs Heft, Fach, Aktualisierungszeitpunkt).",
		inputSchema: {
			type: "object",
			properties: {
				query: { type: "string", description: "Optionaler Suchbegriff zum Filtern nach Titel oder Inhalt" },
				kind: { type: "string", enum: ["all", "notion", "heft"], description: "Filter nach Notiz-Art: Notion-Seite oder GoodNotes-Handschriftheft" },
				subject: { type: "string", description: "Filter nach Schulfach (z.B. Mathematik, Biologie, Deutsch)" },
				limit: { type: "number", description: "Maximale Anzahl der Treffer (Standard: 50)" },
			},
		},
	},
	{
		name: "impala_get_page",
		description: "Liest den Titel und den Markdown-/Text-Inhalt einer Notiz aus. Bei Handschrift-Heften wird der extrahierte Text/OCR sicher geliefert, ohne Vektorstriche zu beschädigen.",
		inputSchema: {
			type: "object",
			properties: {
				id: { type: "string", description: "ID der Notiz" },
				title: { type: "string", description: "Titel der Notiz (falls ID nicht bekannt)" },
			},
		},
	},
	{
		name: "impala_create_page",
		description: "Erstellt eine neue Notiz in Impala67 (Titel, Markdown-Inhalt, optional Fach und Ordner/Elternseite).",
		inputSchema: {
			type: "object",
			properties: {
				title: { type: "string", description: "Titel der neuen Notiz" },
				content: { type: "string", description: "Markdown-Inhalt der Notiz" },
				subject: { type: "string", description: "Fach bzw. Kategorie (z.B. Informatik, Physik)" },
				parent_title: { type: "string", description: "Titel einer optionalen übergeordneten Notiz" },
				kind: { type: "string", enum: ["notion", "heft"], description: "Art der Notiz: notion (Standard) oder heft" },
			},
			required: ["title"],
		},
	},
	{
		name: "impala_update_page",
		description: "Aktualisiert oder ergänzt eine bestehende Notiz in Impala67 (Titel, Inhalt oder Fach).",
		inputSchema: {
			type: "object",
			properties: {
				id: { type: "string", description: "ID der Notiz" },
				title: { type: "string", description: "Titel der Notiz" },
				new_title: { type: "string", description: "Neuer Titel der Notiz" },
				content: { type: "string", description: "Ersetzt den gesamten Textinhalt (nur bei Notion-Seiten)" },
				append_content: { type: "string", description: "Hängt neuen Text an (auch bei Heften sicher als Textbox möglich)" },
				subject: { type: "string", description: "Neues Fach der Notiz" },
			},
		},
	},
	{
		name: "impala_search",
		description: "Durchsucht Notizen (Titel, Fließtext, OCR) und Karteikarten nach Stichworten.",
		inputSchema: {
			type: "object",
			properties: {
				query: { type: "string", description: "Suchbegriff oder Frage" },
				limit: { type: "number", description: "Maximale Anzahl an Treffern (Standard: 20)" },
			},
			required: ["query"],
		},
	},
	{
		name: "impala_list_flashcards",
		description: "Listet Karteikarten auf (optional gefiltert nach Stapel oder Stichwort).",
		inputSchema: {
			type: "object",
			properties: {
				deck: { type: "string", description: "Name des Stapels (z.B. Standard, Mathe)" },
				query: { type: "string", description: "Suchbegriff in Vorder- oder Rückseite" },
				limit: { type: "number", description: "Maximale Anzahl an Karten (Standard: 50)" },
			},
		},
	},
	{
		name: "impala_create_flashcard",
		description: "Erstellt eine neue Karteikarte mit Frage (Vorderseite) und Antwort (Rückseite).",
		inputSchema: {
			type: "object",
			properties: {
				front: { type: "string", description: "Vorderseite / Frage" },
				back: { type: "string", description: "Rückseite / Antwort" },
				deck: { type: "string", description: "Ziel-Stapel (Standard: Standard)" },
				page_title: { type: "string", description: "Zugehörige Notiz-Seite" },
			},
			required: ["front", "back"],
		},
	},
	{
		name: "impala_get_diagnostics",
		description: "Liefert umfassende App-Diagnosedaten: aktive Seite, geöffnete Tabs, Anzahl Notizen/Karten, Performance-Status, JS-Heap-Speicher, Cloudflare/Drive-Sync-Status und letzte Laufzeitfehler.",
		inputSchema: {
			type: "object",
			properties: {},
		},
	},
	{
		name: "impala_get_performance_trace",
		description: "Liest den detaillierten Performance-Profiler-Trace der App aus (Long-Tasks, Stalls, Lags). Kann den Profiler auch aktivieren/deaktivieren oder das Protokoll leeren.",
		inputSchema: {
			type: "object",
			properties: {
				enable: { type: "boolean", description: "Profiler aktivieren (true) oder deaktivieren (false)" },
				clear: { type: "boolean", description: "Bestehende Trace-Einträge nach dem Lesen leeren (Standard: false)" },
			},
		},
	},
	{
		name: "impala_eval",
		description: "Führt JavaScript-Code direkt im Kontext des geöffneten Browser-Fensters aus und liefert das Ergebnis zurück. Ideal zum Testen von UI-Zuständen, DOM-Elementen oder Auslösen von Aktionen.",
		inputSchema: {
			type: "object",
			properties: {
				code: { type: "string", description: "Ausführbarer JavaScript-Code (kann async/await nutzen; Zugriff auf S, STATE, RENDER, TABS, PERF_PROFILER)" },
			},
			required: ["code"],
		},
	},
	{
		name: "impala_run_ui_action",
		description: "Führt vordefinierte UI-Aktionen im geöffneten Browser aus (z.B. Seite öffnen, Tab schließen, Suche öffnen, Sync anstoßen, Sidebar umschalten).",
		inputSchema: {
			type: "object",
			properties: {
				action: {
					type: "string",
					enum: ["open_page", "close_active_tab", "search_ui", "trigger_sync", "toggle_sidebar"],
					description: "Die auszuführende UI-Aktion",
				},
				target: { type: "string", description: "Ziel für die Aktion (z.B. Seiten-ID oder Titel bei open_page)" },
			},
			required: ["action"],
		},
	},
];

/**
 * Startet den MCP-Server.
 */
export async function startServer(opts = {}) {
	const storagePath = opts.storagePath || process.env.IMPALA67_STORAGE_FILE || undefined;
	const store = createStore({ ...(opts.storeOptions || {}), ...(storagePath ? { storagePath } : {}) });
	const syncClient = await createSyncClient(opts.syncOptions);

	// Wenn Sync konfiguriert ist, beim Start im Hintergrund synchronisieren
	if (syncClient.isConfigured()) {
		try {
			const since = store.getState().meta.lastSyncedSeq || 0;
			const pullRes = await syncClient.pull(since);
			if (pullRes.events?.length) {
				store.applyRemoteEvents(pullRes.events, pullRes.maxSeq, pullRes.generation);
			}
		} catch (err) {
			console.error("[impala-mcp] Hintergrund-Sync Pull Fehler:", err.message);
		}
	}

	function sendResponse(id, result) {
		const message = {
			jsonrpc: "2.0",
			id,
			result,
		};
		process.stdout.write(JSON.stringify(message) + "\n");
	}

	function sendError(id, code, message, data) {
		const msg = {
			jsonrpc: "2.0",
			id,
			error: { code, message, ...(data ? { data } : {}) },
		};
		process.stdout.write(JSON.stringify(msg) + "\n");
	}

	async function pushEventsIfSync(events) {
		if (!syncClient.isConfigured() || !events || !events.length) return;
		try {
			const res = await syncClient.push(events);
			if (res.ok && res.ack?.toSeq) {
				store.getState().meta.lastUploadedSeq = res.ack.toSeq;
				store.saveToDisk();
			}
		} catch (err) {
			console.error("[impala-mcp] Sync Push fehlgeschlagen (offline gespeichert):", err.message);
		}
	}

	async function handleToolCall(name, args = {}) {
		// 1. Wenn die App im Browser geöffnet ist: IMMER direkt live in der App ausführen!
		const liveResult = await callLiveBrowser(name, args);
		if (liveResult !== null) {
			return liveResult;
		}

		// 2. Fallback: Wenn kein Browser geöffnet ist, lokalen Offline-Store nutzen
		switch (name) {
			case "impala_list_pages": {
				return store.listPages(args);
			}
			case "impala_get_page": {
				return store.getPage(args);
			}
			case "impala_create_page": {
				const res = store.createPage(args);
				if (res.createdEvent) {
					await pushEventsIfSync([res.createdEvent]);
					delete res.createdEvent;
				}
				return res;
			}
			case "impala_update_page": {
				const res = store.updatePage(args);
				if (res.updatedEvents?.length) {
					await pushEventsIfSync(res.updatedEvents);
					delete res.updatedEvents;
				}
				return res;
			}
			case "impala_search": {
				return store.search(args);
			}
			case "impala_list_flashcards": {
				return store.listFlashcards(args);
			}
			case "impala_create_flashcard": {
				const res = store.createFlashcard(args);
				if (res.createdEvent) {
					await pushEventsIfSync([res.createdEvent]);
					delete res.createdEvent;
				}
				return res;
			}
			case "impala_get_diagnostics":
			case "impala_get_performance_trace":
			case "impala_eval":
			case "impala_run_ui_action":
				return { error: `Werkzeug '${name}' ist nur im Live-Betrieb verfügbar. Bitte öffne Impala67 im Browser (http://localhost:8000).` };
			default:
				return { error: `Unbekanntes Werkzeug: ${name}` };
		}
	}

	async function handleMessage(message) {
		if (!message || typeof message !== "object") return;
		const { id, method, params } = message;

		switch (method) {
			case "initialize": {
				sendResponse(id, {
					protocolVersion: PROTOCOL_VERSION,
					capabilities: {
						tools: {},
					},
					serverInfo: {
						name: SERVER_NAME,
						version: SERVER_VERSION,
					},
				});
				break;
			}
			case "notifications/initialized": {
				// MCP Lifecycle-Bestätigung (Notification ohne Antwort)
				break;
			}
			case "ping": {
				sendResponse(id, {});
				break;
			}
			case "tools/list": {
				sendResponse(id, {
					tools: TOOLS,
				});
				break;
			}
			case "tools/call": {
				const toolName = params?.name;
				const toolArgs = params?.arguments || {};

				try {
					const result = await handleToolCall(toolName, toolArgs);
					const isError = !!result?.error;
					const textContent = isError ? `Fehler: ${result.error}` : JSON.stringify(result, null, 2);

					sendResponse(id, {
						content: [
							{
								type: "text",
								text: textContent,
							},
						],
						isError,
					});
				} catch (err) {
					sendResponse(id, {
						content: [
							{
								type: "text",
								text: `Interner Werkzeug-Fehler: ${err.message}`,
							},
						],
						isError: true,
					});
				}
				break;
			}
			default: {
				if (id !== undefined) {
					sendError(id, -32601, `Methode nicht gefunden: ${method}`);
				}
				break;
			}
		}
	}

	const rl = createInterface({
		input: process.stdin,
		output: process.stdout,
		terminal: false,
	});

	rl.on("line", (line) => {
		const clean = line.trim();
		if (!clean) return;

		try {
			const parsed = JSON.parse(clean);
			handleMessage(parsed);
		} catch (err) {
			sendError(null, -32700, `JSON-RPC Parse Error: ${err.message}`);
		}
	});

	rl.on("close", () => {
		process.exit(0);
	});

	console.error(`[impala-mcp] Server läuft (Version ${SERVER_VERSION}, E2EE-Sync: ${syncClient.isConfigured() ? "Aktiv" : "Offline-Fallback"}).`);
}

// Direkte Ausführung im CLI-Modus
if (process.argv[1] && (process.argv[1].endsWith("server.mjs") || process.argv[1].endsWith("server.js"))) {
	startServer().catch((err) => {
		console.error("[impala-mcp] Fataler Fehler beim Serverstart:", err);
		process.exit(1);
	});
}
