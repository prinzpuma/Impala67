"use strict";

import { S, STATE } from "./state.js";
import { U } from "./util.js";
import { RENDER } from "./render.js";
import { TABS } from "./tabs.js";
import { PERF_PROFILER } from "./performance-profiler.js";
import { CLOUDFLARE_SYNC } from "./sync-cloudflare.js";
import { DRIVE } from "./drive.js";
import { SEARCH } from "./search.js";

// web/mcp-bridge.js - Live-Verbindung zwischen Impala67 im Browser und Antigravity MCP
export function initMcpBridge() {
	if (typeof window === "undefined") return;

	const WS_URL = "ws://127.0.0.1:8765";
	const recentErrors = [];
	const MAX_ERRORS = 20;

	// Fehler-Puffer für Diagnose-Auswertung
	window.addEventListener("error", (ev) => {
		recentErrors.push({
			type: "error",
			message: String(ev.message || ev.error?.message || ev),
			source: ev.filename,
			lineno: ev.lineno,
			timestamp: new Date().toISOString(),
		});
		if (recentErrors.length > MAX_ERRORS) recentErrors.shift();
	});

	window.addEventListener("unhandledrejection", (ev) => {
		recentErrors.push({
			type: "unhandledrejection",
			message: String(ev.reason?.message || ev.reason),
			timestamp: new Date().toISOString(),
		});
		if (recentErrors.length > MAX_ERRORS) recentErrors.shift();
	});

	let ws = null;
	let reconnectTimer = null;

	function connect() {
		try {
			ws = new WebSocket(WS_URL);
		} catch {
			scheduleReconnect();
			return;
		}

		ws.onopen = () => {
			console.info("[MCP-Bridge] ⚡ Verbunden mit Antigravity MCP-Server");
		};

		ws.onmessage = async (event) => {
			try {
				const msg = JSON.parse(event.data);
				if (!msg || !msg.callId || !msg.tool) return;
				const { callId, tool, args } = msg;
				let result = null;

				switch (tool) {
					case "impala_list_pages": {
						const pages = Object.values(S.pages || {})
							.filter((p) => !p.trashed)
							.map((p) => ({
								id: p.id,
								title: p.title || "Ohne Titel",
								kind: p.kind || "notion",
								subject: p.subject || null,
								updated: p.updated,
								created: p.created,
							}));
						result = { count: pages.length, pages };
						break;
					}
					case "impala_get_page": {
						let page = null;
						if (args.id) page = S.pages[args.id];
						if (!page && args.title) {
							const q = String(args.title).trim().toLowerCase();
							page = Object.values(S.pages || {}).find((p) => !p.trashed && (p.title || "").toLowerCase() === q);
						}
						if (!page) {
							result = { error: `Notiz nicht gefunden: ${args.id || args.title}` };
						} else {
							result = {
								id: page.id,
								title: page.title || "Ohne Titel",
								kind: page.kind || "notion",
								subject: page.subject || null,
								content: page.content || "",
								created: page.created,
								updated: page.updated,
								tags: page.tags || [],
							};
						}
						break;
					}
					case "impala_create_page": {
						const id = U.uid();
						const title = String(args.title || "Neue Notiz").trim();
						const content = String(args.content || "");
						const subject = args.subject ? String(args.subject).trim() : null;
						const kind = args.kind === "heft" ? "heft" : "notion";

						await STATE.dispatch("pageCreate", {
							id,
							title,
							content,
							subject,
							kind,
							workspaceId: "default",
						});
						RENDER.render();
						if (TABS && TABS.openPage) TABS.openPage(id);

						result = { ok: true, id, title, kind, subject };
						break;
					}
					case "impala_update_page": {
						let page = null;
						if (args.id) page = S.pages[args.id];
						if (!page && args.title) {
							const q = String(args.title).trim().toLowerCase();
							page = Object.values(S.pages || {}).find((p) => !p.trashed && (p.title || "").toLowerCase() === q);
						}
						if (!page) {
							result = { error: `Notiz nicht gefunden: ${args.id || args.title}` };
						} else {
							const patch = {};
							if (args.new_title) patch.title = String(args.new_title).trim();
							if (args.content !== undefined) patch.content = String(args.content);
							if (args.append_content) patch.content = (page.content || "") + "\n" + String(args.append_content);
							if (args.subject !== undefined) patch.subject = args.subject ? String(args.subject).trim() : null;

							await STATE.dispatch("pageUpdate", { id: page.id, patch });
							RENDER.render();
							result = { ok: true, id: page.id, title: page.title };
						}
						break;
					}
					case "impala_search": {
						const q = String(args.query || "").trim().toLowerCase();
						const results = [];
						if (q) {
							for (const p of Object.values(S.pages || {})) {
								if (p.trashed) continue;
								if ((p.title || "").toLowerCase().includes(q) || (p.content || "").toLowerCase().includes(q)) {
									results.push({
										type: "page",
										id: p.id,
										title: p.title,
										kind: p.kind,
										subject: p.subject,
									});
								}
							}
						}
						result = { query: args.query, totalMatches: results.length, results };
						break;
					}
					case "impala_create_flashcard": {
						const id = U.uid();
						const front = String(args.front || "").trim();
						const back = String(args.back || "").trim();
						const deck = String(args.deck || "Standard").trim();

						await STATE.dispatch("cardCreate", {
							id,
							front,
							back,
							deck,
						});
						RENDER.render();
						result = { ok: true, id, front, back, deck };
						break;
					}
					case "impala_list_flashcards": {
						let cards = Object.values(S.cards || {}).filter((c) => !c.trashed);
						if (args.deck) {
							const deckLower = String(args.deck).trim().toLowerCase();
							cards = cards.filter((c) => (c.deck || "").toLowerCase() === deckLower);
						}
						result = { count: cards.length, cards };
						break;
					}
					case "impala_get_diagnostics": {
						const memory = typeof performance !== "undefined" && performance.memory ? {
							usedJsHeapMb: Math.round((performance.memory.usedJSHeapSize / 1048576) * 10) / 10,
							limitJsHeapMb: Math.round((performance.memory.jsHeapSizeLimit / 1048576) * 10) / 10,
						} : null;

						const activePage = S.currentPageId ? S.pages[S.currentPageId] : null;

						result = {
							app: {
								activePageId: S.currentPageId || null,
								activePageTitle: activePage?.title || null,
								openTabs: (S.tabs || []).map((t) => ({ id: t.pageId, title: S.pages[t.pageId]?.title || "Unbekannt" })),
								totalPages: Object.keys(S.pages || {}).length,
								activePages: Object.values(S.pages || {}).filter((p) => !p.trashed).length,
								totalCards: Object.keys(S.cards || {}).length,
								totalHeftDocs: Object.keys(S.heftDocs || {}).length,
								sidebarCollapsed: !!S.sidebarCollapsed,
							},
							performance: {
								profilerStatus: PERF_PROFILER ? PERF_PROFILER.status() : null,
								memory,
							},
							sync: {
								cloudflare: CLOUDFLARE_SYNC ? CLOUDFLARE_SYNC.status() : null,
								drive: DRIVE ? DRIVE.status() : null,
							},
							recentErrors: recentErrors.slice(-10),
						};
						break;
					}
					case "impala_get_performance_trace": {
						if (!PERF_PROFILER) {
							result = { error: "PERF_PROFILER nicht verfügbar." };
							break;
						}
						if (args.enable !== undefined) {
							PERF_PROFILER.setEnabled(!!args.enable);
						}
						const rawReport = PERF_PROFILER.report();
						if (args.clear) {
							PERF_PROFILER.clear();
						}
						try {
							result = JSON.parse(rawReport);
						} catch {
							result = { raw: rawReport };
						}
						break;
					}
					case "impala_eval": {
						if (!args.code) {
							result = { error: "Kein JavaScript-Code übergeben." };
							break;
						}
						try {
							// Sichere Ausführung im Window-Kontext
							const fn = new Function("S", "STATE", "TOOLS", "RENDER", "TABS", "PERF_PROFILER", "CLOUDFLARE_SYNC", "DRIVE", "SEARCH", `return (async () => { ${args.code} })();`);
							const evalOutput = await fn(S, STATE, null, RENDER, TABS, PERF_PROFILER, CLOUDFLARE_SYNC, DRIVE, SEARCH);
							result = { ok: true, output: evalOutput !== undefined ? evalOutput : "void" };
						} catch (evalErr) {
							result = { ok: false, error: evalErr.message, stack: evalErr.stack };
						}
						break;
					}
					case "impala_run_ui_action": {
						const action = args.action;
						switch (action) {
							case "open_page": {
								if (!args.target) { result = { error: "target fehlt" }; break; }
								const pageId = S.pages[args.target] ? args.target : Object.keys(S.pages).find((id) => (S.pages[id]?.title || "").toLowerCase() === args.target.toLowerCase());
								if (!pageId) { result = { error: "Seite nicht gefunden" }; break; }
								TABS.openPage(pageId);
								result = { ok: true, opened: pageId, title: S.pages[pageId]?.title };
								break;
							}
							case "close_active_tab": {
								if (S.currentPageId) TABS.closeTab(S.currentPageId);
								result = { ok: true };
								break;
							}
							case "search_ui": {
								if (SEARCH && SEARCH.open) {
									SEARCH.open();
									result = { ok: true, searchOpened: true };
								} else {
									result = { error: "Suche nicht verfügbar" };
								}
								break;
							}
							case "trigger_sync": {
								if (CLOUDFLARE_SYNC && CLOUDFLARE_SYNC.syncNow) {
									const syncRes = await CLOUDFLARE_SYNC.syncNow();
									result = { ok: true, sync: syncRes };
								} else {
									result = { error: "Cloudflare Sync nicht initialisiert" };
								}
								break;
							}
							case "toggle_sidebar": {
								S.sidebarCollapsed = !S.sidebarCollapsed;
								RENDER.render();
								result = { ok: true, sidebarCollapsed: S.sidebarCollapsed };
								break;
							}
							default:
								result = { error: `Unbekannte UI-Aktion: ${action}` };
						}
						break;
					}
					default:
						result = { error: `Unbekanntes Werkzeug: ${tool}` };
				}

				ws.send(JSON.stringify({ callId, result }));
			} catch (err) {
				ws.send(JSON.stringify({ callId: msg?.callId, result: { error: err.message } }));
			}
		};

		ws.onclose = () => scheduleReconnect();
		ws.onerror = () => ws.close();
	}

	function scheduleReconnect() {
		if (reconnectTimer) return;
		reconnectTimer = setTimeout(() => {
			reconnectTimer = null;
			connect();
		}, 3000);
	}

	connect();
}
