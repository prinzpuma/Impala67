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
import { HANDSCHRIFT } from "./handschrift.js";
import { HANDWRITING_PREPROCESSOR } from "./handwriting-preprocessor.js";

// web/mcp-bridge.js - Live-Verbindung zwischen Impala67 im Browser und Antigravity MCP
export function initMcpBridge() {
	if (typeof window === "undefined") return;
	const enableFlag = window.__IMPALA_ENABLE_MCP_BRIDGE === true;
	const queryFlag = (() => {
		try {
			const q = new URLSearchParams(window.location?.search || "");
			return q.get("mcpBridge") === "1";
		} catch {
			return false;
		}
	})();
	const localDevDefault = (() => {
		const host = String(window.location?.hostname || "");
		const port = String(window.location?.port || "");
		return (host === "localhost" || host === "127.0.0.1") && port === "8000";
	})();
	if (!enableFlag && !queryFlag && !localDevDefault) return;

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
					case "impala_heft_scan_extract": {
						const excludePageIds = new Set(Array.isArray(args.exclude_page_ids) ? args.exclude_page_ids : []);
						const limit = Math.max(1, Math.min(100, Number(args.limit_clusters) || 30));
						const clusters = [];

						const heftDocs = S.heftDocs || {};
						for (const [pageId, doc] of Object.entries(heftDocs)) {
							if (excludePageIds.has(pageId)) continue;
							const pageMeta = S.pages?.[pageId];
							if (pageMeta?.trashed) continue;
							const pageTitle = pageMeta?.title || "Heft";

							const pages = doc.pages || [];
							for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
								const pg = pages[pageIdx];
								const strokes = pg.strokes || [];
								if (!strokes.length) continue;

								const lines = HANDWRITING_PREPROCESSOR.segmentLines(strokes);
								for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
									if (clusters.length >= limit) break;
									const line = lines[lineIdx];
									const clusterStrokes = line.strokes || [];
									if (clusterStrokes.length === 0) continue;

									const features = HANDWRITING_PREPROCESSOR.extractLineFeatures(clusterStrokes);
									if (features.length < 5) continue;

									let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
									for (const s of clusterStrokes) {
										const b = HANDWRITING_PREPROCESSOR.strokeBbox(s);
										if (b) {
											minX = Math.min(minX, b.minX);
											minY = Math.min(minY, b.minY);
											maxX = Math.max(maxX, b.maxX);
											maxY = Math.max(maxY, b.maxY);
										}
									}
									const pad = 12;
									const w = Math.max(20, Math.ceil(maxX - minX + pad * 2));
									const h = Math.max(20, Math.ceil(maxY - minY + pad * 2));

									let imageBase64 = null;
									if (typeof document !== "undefined") {
										try {
											const canvas = document.createElement("canvas");
											canvas.width = Math.min(1200, w);
											canvas.height = Math.min(400, h);
											const ctx = canvas.getContext("2d");
											ctx.fillStyle = "#ffffff";
											ctx.fillRect(0, 0, canvas.width, canvas.height);
											ctx.strokeStyle = "#111111";
											ctx.lineWidth = 3.0;
											ctx.lineCap = "round";
											ctx.lineJoin = "round";

											for (const s of clusterStrokes) {
												const pts = s.pts || [];
												if (!pts.length) continue;
												if (pts.length === 1) {
													ctx.beginPath();
													ctx.arc(pts[0][0] - minX + pad, pts[0][1] - minY + pad, 2.0, 0, Math.PI * 2);
													ctx.fill();
													continue;
												}
												ctx.beginPath();
												ctx.moveTo(pts[0][0] - minX + pad, pts[0][1] - minY + pad);
												for (let p = 1; p < pts.length; p++) {
													ctx.lineTo(pts[p][0] - minX + pad, pts[p][1] - minY + pad);
												}
												ctx.stroke();
											}
											imageBase64 = canvas.toDataURL("image/png");
										} catch (e) {
											console.warn("[mcp-bridge] Fehler beim Rendern des Cluster-Bildes:", e);
										}
									}

									let localPrediction = "";
									let localConfidence = 0;
									let status = "unknown";
									try {
										const rec = await HANDSCHRIFT.recognizeStrokesDetails(clusterStrokes);
										localPrediction = rec.text || "";
										const grp = rec.accounting?.groups?.[0];
										localConfidence = grp?.confidence ?? 0;
										status = grp?.status ?? (rec.text ? "recognized" : "uncertain");
									} catch {}

									clusters.push({
										clusterId: `${pageId}:${pageIdx}:${lineIdx}`,
										pageId,
										pageTitle,
										pageIndex: pageIdx,
										strokesCount: clusterStrokes.length,
										featuresCount: features.length,
										width: w,
										height: h,
										localPrediction,
										localConfidence,
										status,
										imageBase64,
										originalStrokes: clusterStrokes,
									});
								}
								if (clusters.length >= limit) break;
							}
							if (clusters.length >= limit) break;
						}
						result = { totalFound: clusters.length, clusters };
						break;
					}
					case "impala_heft_scan_consensus_import": {
						const clusterId = String(args.cluster_id || "");
						const originalStrokes = args.original_strokes || [];
						const localPrediction = String(args.local_prediction || "").trim();
						const llmALabel = String(args.llm_a_label || "").trim();
						const llmBLabel = String(args.llm_b_label || "").trim();

						// 3-Wege-Konsens: Auto-übernehmen nur wenn 2 Modelle und lokales Netz übereinstimmen!
						const cleanA = llmALabel.toLowerCase();
						const cleanB = llmBLabel.toLowerCase();
						const cleanLocal = localPrediction.toLowerCase();

						const fullConsensus = cleanA.length > 0 && cleanA === cleanB && cleanA === cleanLocal;

						const REVIEW_KEY = "impala67_handwriting_review_list";
						let reviewList = [];
						try {
							const raw = localStorage.getItem(REVIEW_KEY);
							if (raw) reviewList = JSON.parse(raw);
						} catch {}

						if (fullConsensus) {
							HANDSCHRIFT.saveTrainingSample(originalStrokes, llmALabel);
							result = {
								status: "auto_adopted",
								verified: true,
								label: llmALabel,
								clusterId,
								message: "3-Wege-Konsens erreicht (Modell A == Modell B == Lokales Modell). Direkt als Trainingsbeispiel gespeichert."
							};
						} else {
							const reviewItem = {
								id: clusterId || ("rev_" + Date.now()),
								clusterId,
								originalStrokes,
								localPrediction,
								llmALabel,
								llmBLabel,
								suggestedLabel: llmALabel || llmBLabel || localPrediction,
								createdAt: Date.now()
							};
							const existingIdx = reviewList.findIndex((r) => r.clusterId === clusterId);
							if (existingIdx >= 0) reviewList[existingIdx] = reviewItem;
							else reviewList.push(reviewItem);
							try { localStorage.setItem(REVIEW_KEY, JSON.stringify(reviewList)); } catch {}

							result = {
								status: "queued_for_review",
								verified: false,
								clusterId,
								localPrediction,
								llmALabel,
								llmBLabel,
								suggestedLabel: reviewItem.suggestedLabel,
								message: "Kein 3-Wege-Konsens. Zur Prüfliste hinzugefügt."
							};
						}
						break;
					}
					case "impala_heft_scan_review_list": {
						const REVIEW_KEY = "impala67_handwriting_review_list";
						let reviewList = [];
						try {
							const raw = localStorage.getItem(REVIEW_KEY);
							if (raw) reviewList = JSON.parse(raw);
						} catch {}

						const action = args.action || "list";
						if (action === "list") {
							result = { count: reviewList.length, items: reviewList };
						} else if (action === "approve") {
							const id = args.item_id;
							const item = reviewList.find((r) => r.id === id || r.clusterId === id);
							if (!item) {
								result = { ok: false, error: "Eintrag nicht in Prüfliste gefunden." };
							} else {
								const finalLabel = String(args.corrected_label || item.suggestedLabel || "").trim();
								HANDSCHRIFT.saveTrainingSample(item.originalStrokes, finalLabel);
								reviewList = reviewList.filter((r) => r.id !== id && r.clusterId !== id);
								try { localStorage.setItem(REVIEW_KEY, JSON.stringify(reviewList)); } catch {}
								result = { ok: true, approvedLabel: finalLabel, remainingCount: reviewList.length };
							}
						} else if (action === "reject") {
							const id = args.item_id;
							reviewList = reviewList.filter((r) => r.id !== id && r.clusterId !== id);
							try { localStorage.setItem(REVIEW_KEY, JSON.stringify(reviewList)); } catch {}
							result = { ok: true, remainingCount: reviewList.length };
						} else if (action === "clear") {
							reviewList = [];
							try { localStorage.removeItem(REVIEW_KEY); } catch {}
							result = { ok: true, count: 0 };
						} else {
							result = { error: `Unbekannte Aktion: ${action}` };
						}
						break;
					}
					default:
						result = { error: `Unbekanntes Werkzeug: ${tool}` };
				}

				bridgeCallsCount++;
				const duration = (typeof performance !== "undefined" && performance.now) ? performance.now() - callStart : Date.now() - callStart;
				bridgeLastCallDurationMs = Math.round(duration * 10) / 10;

				if (ws && ws.readyState === 1) {
					ws.send(JSON.stringify({ callId, result: safeSerialize(result) }));
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
		const delay = Math.min(1000 * Math.pow(1.5, Math.min(reconnectAttempts, 8)), 15000);
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
