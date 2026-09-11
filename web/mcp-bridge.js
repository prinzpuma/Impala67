"use strict";

import { S, STATE } from "./state.js";
import { U } from "./util.js";
import { RENDER } from "./render.js";
import { TABS } from "./tabs.js";
import { PERF_PROFILER } from "./performance-profiler.js";
import { CLOUDFLARE_SYNC } from "./sync-cloudflare.js";
import { DRIVE } from "./drive.js";
import { SEARCH } from "./search.js";
import { DB } from "./db.js";
import { STORAGE_TOOLS } from "./storage-tools.js";

// web/mcp-bridge.js - Live-Verbindung zwischen Impala67 im Browser und Antigravity MCP
export function initMcpBridge() {
	if (typeof window === "undefined") return;

	const WS_URL = (typeof window !== "undefined" && window.__IMPALA_WS_URL) || "ws://127.0.0.1:8765";
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
	let reconnectAttempts = 0;
	let bridgeConnectedAt = null;
	let bridgeCallsCount = 0;
	let bridgeLastCallDurationMs = null;

	function safeSerialize(val) {
		if (val === undefined) return "void";
		if (val === null || typeof val === "number" || typeof val === "boolean" || typeof val === "string") return val;
		if (typeof val === "function") return `[Function: ${val.name || "anonymous"}]`;
		if (typeof Element !== "undefined" && val instanceof Element) {
			return `<${val.tagName.toLowerCase()}${val.id ? ' id="' + val.id + '"' : ""}${val.className ? ' class="' + val.className + '"' : ""}>`;
		}
		try {
			JSON.stringify(val);
			return val;
		} catch {
			try {
				const seen = new WeakSet();
				return JSON.parse(JSON.stringify(val, (key, value) => {
					if (typeof value === "object" && value !== null) {
						if (seen.has(value)) return "[Circular]";
						seen.add(value);
						if (typeof Element !== "undefined" && value instanceof Element) {
							return `<${value.tagName.toLowerCase()}${value.id ? ' id="' + value.id + '"' : ""}>`;
						}
					}
					return value;
				}));
			} catch {
				return String(val);
			}
		}
	}

	function connect() {
		try {
			ws = new WebSocket(WS_URL);
		} catch {
			scheduleReconnect();
			return;
		}

		ws.onopen = () => {
			reconnectAttempts = 0;
			bridgeConnectedAt = new Date().toISOString();
			console.info("[MCP-Bridge] ⚡ Verbunden mit Antigravity MCP-Server");
		};

		ws.onmessage = async (event) => {
			let currentCallId = null;
			const callStart = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
			try {
				const msg = JSON.parse(event.data);
				if (!msg || !msg.callId || !msg.tool) return;
				const { callId, tool, args } = msg;
				currentCallId = callId;
				let result = null;

				switch (tool) {
					case "ping": {
						result = { pong: true, time: Date.now() };
						break;
					}
					case "impala_list_pages": {
						let pool = Object.values(S.pages || {}).filter((p) => !p.trashed);
						if (args.archived === true) {
							pool = pool.filter((p) => p.archived);
						} else if (!args.includeArchived) {
							pool = pool.filter((p) => !p.archived);
						}
						if (args.kind && args.kind !== "all") {
							pool = pool.filter((p) => (p.kind === "heft" ? "heft" : "notion") === args.kind);
						}
						if (args.subject) {
							const sQuery = String(args.subject).trim().toLowerCase();
							pool = pool.filter((p) => String(p.subject || "").toLowerCase() === sQuery);
						}
						if (args.query) {
							const q = String(args.query).trim().toLowerCase();
							pool = pool.filter((p) => {
								const title = (p.title || "").toLowerCase();
								const content = (p.content || "").toLowerCase();
								const subj = String(p.subject || "").toLowerCase();
								return title.includes(q) || content.includes(q) || subj.includes(q);
							});
						}
						pool.sort((a, b) => String(b.updated || "").localeCompare(String(a.updated || "")));
						const count = Math.max(1, Math.min(200, Number(args.limit) || 50));
						const pages = pool.slice(0, count).map((p) => ({
							id: p.id,
							title: p.title || "Ohne Titel",
							kind: p.kind || "notion",
							subject: p.subject || null,
							parentId: p.parentId || null,
							archived: !!p.archived,
							updated: p.updated,
							created: p.created,
						}));
						result = { total: pool.length, count: pages.length, pages };
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
							let content = page.content || "";
							let heftPages = null;
							if (page.kind === "heft" && S.heftDocs && S.heftDocs[page.id]) {
								const doc = S.heftDocs[page.id];
								heftPages = doc.pages?.length || 1;
								const parts = [];
								for (let i = 0; i < (doc.pages || []).length; i++) {
									const pg = doc.pages[i];
									const pageParts = [];
									if (pg.ocrText) pageParts.push(String(pg.ocrText).trim());
									if (Array.isArray(pg.texts)) {
										for (const t of pg.texts) if (t.text) pageParts.push(String(t.text).trim());
									}
									if (pageParts.length) parts.push(`--- Seite ${i + 1} ---\n${pageParts.join("\n")}`);
								}
								if (parts.length) content = parts.join("\n\n");
							}
							result = {
								id: page.id,
								title: page.title || "Ohne Titel",
								kind: page.kind || "notion",
								subject: page.subject || null,
								archived: !!page.archived,
								content,
								...(heftPages ? { heftPages, note: "Handschrift-Heft: content enthält extrahierten Text & OCR." } : {}),
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
						let parentId = args.parentId || null;
						if (!parentId && args.parent_title) {
							const pt = String(args.parent_title).trim().toLowerCase();
							const parent = Object.values(S.pages || {}).find((p) => !p.trashed && (p.title || "").toLowerCase() === pt);
							if (parent) parentId = parent.id;
						}

						await STATE.dispatch("pageCreate", {
							id,
							title,
							content,
							subject,
							kind,
							parentId,
							workspaceId: "default",
						});
						RENDER.render();
						if (TABS && TABS.openPage) TABS.openPage(id);

						result = { ok: true, id, title, kind, subject, parentId };
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

							if (Object.keys(patch).length > 0) {
								await STATE.dispatch("pageUpdate", { id: page.id, patch });
							}
							if (args.archived !== undefined) {
								if (args.archived && !page.archived) {
									await STATE.dispatch("pageArchive", { id: page.id });
								} else if (!args.archived && page.archived) {
									await STATE.dispatch("pageUnarchive", { id: page.id });
								}
							}
							RENDER.render();
							result = { ok: true, id: page.id, title: page.title, archived: !!page.archived };
						}
						break;
					}
					case "impala_search": {
						const q = String(args.query || "").trim().toLowerCase();
						const results = [];
						if (q) {
							for (const p of Object.values(S.pages || {})) {
								if (p.trashed) continue;
								if (args.archived === true && !p.archived) continue;
								if (args.archived === false && p.archived) continue;
								const title = p.title || "";
								let content = p.content || "";
								if (p.kind === "heft" && S.heftDocs && S.heftDocs[p.id]) {
									const doc = S.heftDocs[p.id];
									const parts = [];
									for (const pg of doc.pages || []) {
										if (pg.ocrText) parts.push(pg.ocrText);
										if (Array.isArray(pg.texts)) for (const t of pg.texts) if (t.text) parts.push(t.text);
									}
									if (parts.length) content = parts.join(" ");
								}
								const subj = String(p.subject || "");
								const titleMatch = title.toLowerCase().includes(q);
								const contentMatch = content.toLowerCase().includes(q);
								const subjMatch = subj.toLowerCase().includes(q);

								if (titleMatch || contentMatch || subjMatch) {
									let snippet = "";
									if (contentMatch) {
										const idx = content.toLowerCase().indexOf(q);
										const start = Math.max(0, idx - 40);
										const end = Math.min(content.length, idx + q.length + 60);
										snippet = (start > 0 ? "…" : "") + content.slice(start, end).replace(/\s+/g, " ") + (end < content.length ? "…" : "");
									} else {
										snippet = content.slice(0, 100).replace(/\s+/g, " ");
									}
									results.push({
										type: "page",
										id: p.id,
										title,
										kind: p.kind || "notion",
										subject: p.subject || null,
										archived: !!p.archived,
										snippet,
									});
								}
							}
							for (const c of Object.values(S.cards || {})) {
								if (c.trashed) continue;
								const front = c.front || "";
								const back = c.back || "";
								if (front.toLowerCase().includes(q) || back.toLowerCase().includes(q)) {
									results.push({
										type: "flashcard",
										id: c.id,
										deck: c.deck || "Standard",
										front,
										back,
										snippet: `${front} → ${back}`,
									});
								}
							}
						}
						const max = Math.max(1, Math.min(100, Number(args.limit) || 20));
						result = { query: args.query, totalMatches: results.length, results: results.slice(0, max) };
						break;
					}
					case "impala_create_flashcard": {
						const id = U.uid();
						const front = String(args.front || "").trim();
						const back = String(args.back || "").trim();
						const deck = String(args.deck || "Standard").trim();
						let pageId = null;
						if (args.page_title) {
							const pt = String(args.page_title).trim().toLowerCase();
							const page = Object.values(S.pages || {}).find((p) => !p.trashed && (p.title || "").toLowerCase() === pt);
							if (page) pageId = page.id;
						}

						await STATE.dispatch("cardCreate", {
							id,
							front,
							back,
							deck,
							...(pageId ? { pageId } : {}),
						});
						RENDER.render();
						result = { ok: true, id, front, back, deck, pageId };
						break;
					}
					case "impala_list_flashcards": {
						let pool = Object.values(S.cards || {}).filter((c) => !c.trashed);
						if (args.deck) {
							const deckLower = String(args.deck).trim().toLowerCase();
							pool = pool.filter((c) => {
								const d = (c.deck || "Standard").toLowerCase();
								return d === deckLower || d.startsWith(deckLower + "::") || d.includes(deckLower);
							});
						}
						if (args.query) {
							const q = String(args.query).trim().toLowerCase();
							pool = pool.filter((c) => (c.front || "").toLowerCase().includes(q) || (c.back || "").toLowerCase().includes(q));
						}
						const max = Math.max(1, Math.min(200, Number(args.limit) || 50));
						const cards = pool.slice(0, max).map((c) => ({
							id: c.id,
							front: c.front,
							back: c.back,
							deck: c.deck || "Standard",
							created: c.created || null,
						}));
						result = { total: pool.length, count: cards.length, cards };
						break;
					}
					case "impala_get_diagnostics": {
						const memory = typeof performance !== "undefined" && performance.memory ? {
							usedJsHeapMb: Math.round((performance.memory.usedJSHeapSize / 1048576) * 10) / 10,
							limitJsHeapMb: Math.round((performance.memory.jsHeapSizeLimit / 1048576) * 10) / 10,
						} : null;

						const activePage = S.currentPageId ? S.pages[S.currentPageId] : null;

						result = {
							bridge: {
								status: "connected",
								connectedAt: bridgeConnectedAt,
								uptimeSeconds: bridgeConnectedAt ? Math.round((Date.now() - new Date(bridgeConnectedAt).getTime()) / 1000) : 0,
								totalCallsProcessed: bridgeCallsCount,
								lastCallDurationMs: bridgeLastCallDurationMs,
								wsUrl: WS_URL,
								tabVisible: typeof document !== "undefined" ? !document.hidden : true,
							},
							app: {
								activePageId: S.currentPageId || null,
								activePageTitle: activePage?.title || null,
								openTabs: (S.tabs || []).map((tabId) => {
									if (typeof tabId !== "string") return { id: null, title: "Unbekannt" };
									if (tabId.startsWith("chat:")) return { id: tabId, title: "KI-Chat" };
									if (tabId === "anki:main") return { id: tabId, title: "Karteikarten" };
									if (tabId === "nlm:main") return { id: tabId, title: "NotebookLM" };
									return { id: tabId, title: S.pages[tabId]?.title || "Ohne Titel" };
								}),
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
						if (args.mode !== undefined) {
							PERF_PROFILER.setMode(args.mode);
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
							result = { ok: true, output: safeSerialize(evalOutput) };
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
									if (args.await === false || args.wait === false) {
										CLOUDFLARE_SYNC.syncNow().catch((err) => {
											console.warn("[MCP-Bridge] Hintergrund-Sync Fehler:", err);
										});
										result = { ok: true, started: true, mode: "background", status: CLOUDFLARE_SYNC.status() };
									} else {
										try {
											const syncRes = await CLOUDFLARE_SYNC.syncNow();
											result = { ok: true, sync: syncRes, status: CLOUDFLARE_SYNC.status() };
										} catch (syncErr) {
											result = { ok: false, error: syncErr?.message || String(syncErr), status: CLOUDFLARE_SYNC.status() };
										}
									}
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
					case "impala_storage_report": {
						const usage = CLOUDFLARE_SYNC ? CLOUDFLARE_SYNC.status()?.usage || null : null;
						const rep = STORAGE_TOOLS.storageReport(S.pages, usage);
						const limit = Math.max(1, Math.min(50, Number(args.limit) || 15));
						rep.top = rep.top.slice(0, limit).map((r) => ({
							...r,
							parent: (r.parentId && S.pages[r.parentId]?.title) || null,
						}));
						result = rep;
						break;
					}
					case "impala_storage_cleanup": {
						const all = STORAGE_TOOLS.collectPdfPages(S.pages);
						let sel = all.filter((r) => r.kb >= (Number(args.minKb) || 0));
						if (Array.isArray(args.ids) && args.ids.length) {
							const want = new Set(args.ids.map(String));
							sel = sel.filter((r) => want.has(r.id));
						} else if (Number(args.top) > 0) {
							sel = sel.slice(0, Math.min(50, Number(args.top)));
						}
						const plan = sel.filter((r) => r.pdfId).map((r) => ({ id: r.id, title: r.title, kb: r.kb, pdfId: r.pdfId }));
						const skipped = sel.length - plan.length;
						const freedKb = plan.reduce((s, r) => s + (r.kb || 0), 0);
						if (args.dryRun !== false) {
							result = { dryRun: true, count: plan.length, skippedWithoutBlob: skipped, freedMB: Math.round(freedKb / 1024), plan: plan.slice(0, 25) };
							break;
						}
						let detached = 0;
						for (const item of plan) {
							const page = S.pages[item.id];
							const d = STORAGE_TOOLS.buildDetachPatch(page);
							if (!d) continue;
							await STATE.dispatch("pageUpdate", { id: item.id, patch: d.patch });
							try { await DB.delBlob(d.pdfId); } catch {}
							detached++;
						}
						RENDER.render();
						result = {
							dryRun: false, detached, skippedWithoutBlob: skipped, freedMB: Math.round(freedKb / 1024),
							hint: "Lokal freigegeben. Cloud-Quota (R2, immutable Blobs) wird erst nach Generation-Reset frei: Einstellungen → Cloudflare → Kompaktieren.",
						};
						break;
					}
					default:
						result = { error: `Unbekanntes Werkzeug: ${tool}` };
				}

				bridgeCallsCount++;
				const duration = (typeof performance !== "undefined" && performance.now) ? performance.now() - callStart : Date.now() - callStart;
				bridgeLastCallDurationMs = Math.round(duration * 10) / 10;

				if (ws && ws.readyState === 1) {
					ws.send(JSON.stringify({ callId, result }));
				}
			} catch (err) {
				if (currentCallId && ws && ws.readyState === 1) {
					ws.send(JSON.stringify({ callId: currentCallId, result: { error: err.message } }));
				}
			}
		};

		ws.onclose = () => scheduleReconnect();
		ws.onerror = () => {
			try { ws.close(); } catch {}
		};
	}

	function scheduleReconnect() {
		reconnectAttempts++;
		const delay = 1000;
		clearTimeout(reconnectTimer);
		reconnectTimer = setTimeout(connect, delay);
	}

	if (typeof document !== "undefined") {
		window.addEventListener("focus", () => {
			if (!ws || ws.readyState > 1) connect();
		});
		document.addEventListener("visibilitychange", () => {
			if (!document.hidden && (!ws || ws.readyState > 1)) {
				clearTimeout(reconnectTimer);
				reconnectTimer = null;
				connect();
			}
		});
	}

	connect();
}
