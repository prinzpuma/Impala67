"use strict";

import { S, STATE } from "./state.js";
import { U } from "./util.js";
import { RENDER } from "./render.js";
import { TABS } from "./tabs.js";
import { PERF_PROFILER } from "./performance-profiler.js";
import { AI } from "./ai.js";
import { CLOUDFLARE_SYNC } from "./sync-cloudflare.js";
import { DRIVE } from "./drive.js";
import { SEARCH } from "./search.js";
import { DB } from "./db.js";
import { STORAGE_TOOLS } from "./storage-tools.js";
import { TOOLS } from "./tools.js";
import { mcpBridgeEnabled, setMcpBridgeEnabled } from "./mcp-bridge-flag.js";
import { SANDBOX } from "./sandbox.js";

// web/mcp-bridge.js - Live-Verbindung zwischen Impala67 im Browser und Antigravity MCP
let bridgeStarted = false;

// Der Sync-Schlüssel ist das E2EE-Geheimnis aller Geräte; er gehört nicht in Diagnose-Antworten,
// die in KI-Protokollen und Chat-Verläufen landen.
function cloudflareStatus() {
	const { syncKey, ...status } = CLOUDFLARE_SYNC.status();
	return { ...status, hasSyncKey: !!syncKey };
}

// Schalter in Einstellungen → Daten → Diagnose: an verbindet sofort, aus wirkt nach dem nächsten App-Start.
if (typeof document !== "undefined") {
	document.addEventListener("change", (event) => {
		if (event.target?.id !== "inpMcpBridge") return;
		const on = event.target.checked;
		setMcpBridgeEnabled(on);
		if (on) initMcpBridge();
		U.toast(on ? "MCP-Live-Bridge aktiviert." : "MCP-Live-Bridge wird beim nächsten Start nicht mehr verbunden.", "success");
	}, true);
}

// Laufende/fertige impala_heft_add_pages-Aufrufe nach op_key (vom MCP-Server), damit eine
// Wiederholung nach einem Timeout nicht dieselbe Vorlage nochmal einfügt.
const addPagesOps = new Map();

function resolveHeftPage(idOrTitle) {
	const key = String(idOrTitle || "").trim();
	const pg = (key && S.pages?.[key]) || (key ? STATE.findPage(key) : null);
	if (!pg || pg.trashed || pg.kind !== "heft") throw new Error(`Kein Heft gefunden: ${idOrTitle}`);
	return pg;
}

function heftPageHasContent(p) {
	return (p?.strokes || []).length > 0 || (p?.texts || []).length > 0 || (p?.images || []).length > 0;
}

function parsePageIndices(raw) {
	const items = Array.isArray(raw) ? raw : [raw];
	const out = new Set();
	for (const item of items) {
		if (typeof item === "number") {
			if (Number.isInteger(item)) out.add(item);
			continue;
		}
		for (const part of String(item ?? "").split(",")) {
			const s = part.trim();
			if (!s) continue;
			const range = s.match(/^(\d+)\s*-\s*(\d+)$/);
			if (range) {
				const a = Number(range[1]);
				const b = Number(range[2]);
				if (a <= b) for (let i = a; i <= b; i++) out.add(i);
			} else if (/^-?\d+$/.test(s)) {
				out.add(Number(s));
			}
		}
	}
	return [...out].sort((a, b) => a - b);
}

async function deleteHeftPageIds(HEFT, pageId, ids) {
	if (!ids.length) return;
	if (HEFT.openDoc(pageId)) await HEFT.saveNow();
	const beforeCount = (HEFT.openDoc(pageId) || STATE.heftDoc(pageId))?.pages?.length ?? 0;
	await STATE.dispatch("heftOps", { pageId, ops: ids.map((p) => ({ t: "pg-", p })) });
	// Ein geöffnetes Heft übernimmt die Änderung asynchron: kurz warten, bis sie angekommen ist.
	const expected = Math.max(1, beforeCount - ids.length);
	const countNow = () => (HEFT.openDoc(pageId) || STATE.heftDoc(pageId))?.pages?.length ?? null;
	for (let i = 0; i < 20 && countNow() !== expected; i++) await new Promise((r) => setTimeout(r, 100));
}

async function addHeftPages(args) {
	const pageId = resolveHeftPage(args.page_id).id;
	const b64 = String(args.data_base64 || "").replace(/^data:[^,]*,/, "");
	if (!b64) throw new Error("data_base64 fehlt");
	const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
	const name = String(args.filename || "vorlage");
	const type = String(args.mime || (/\.pdf$/i.test(name) ? "application/pdf" : "image/png"));
	const { HEFT } = await import("./heft.js");
	// Offenes Heft: Arbeitskopie zählen (kann Ungespeichertes enthalten).
	const pagesNow = () => (HEFT.openDoc(pageId) || STATE.heftDoc(pageId))?.pages || [];
	const oldPages = pagesNow();
	if (args.replace) {
		const blocked = oldPages.map((p, i) => (heftPageHasContent(p) ? i + 1 : 0)).filter(Boolean);
		if (blocked.length && !args.allow_content) {
			throw new Error(`Seite(n) ${blocked.join(", ")} enthalten Handschrift, Bilder oder Textboxen — nur mit allow_content=true ersetzen.`);
		}
	}
	const before = oldPages.map((p) => p.id);
	let pos = args.position || "end";
	if (args.replace) {
		pos = 0;
	} else if (args.at != null) {
		const n = Number(args.at);
		if (!Number.isInteger(n) || n < 1) throw new Error(`at muss >= 1 sein (erhalten: ${args.at})`);
		pos = n - 1;
	}
	const end = await HEFT.importFiles(pageId, [new File([bytes], name, { type })], pos);
	let pageCount = pagesNow().length;
	// Ein neues Heft verliert beim Import seine leere Startseite (heft-import.js).
	const replacedBlank = before.length === 1 && !pagesNow().some((p) => p.id === before[0]);
	const added = pageCount - before.length + (replacedBlank ? 1 : 0);
	if (added <= 0) throw new Error("Datei ließ sich nicht als Seite einfügen (Bild oder PDF?)");
	let replacedPages = replacedBlank ? 1 : 0;
	if (args.replace) {
		const toDelete = before.filter((id) => pagesNow().some((p) => p.id === id));
		if (toDelete.length) {
			await deleteHeftPageIds(HEFT, pageId, toDelete);
			replacedPages += toDelete.length;
			pageCount = pagesNow().length;
		}
	}
	RENDER.render();
	return {
		ok: true,
		inserted: { from: end - added + 1, to: end },
		pageCount,
		...(replacedBlank && !args.replace ? { replacedEmptyFirstPage: true } : {}),
		...(args.replace ? { replacedPages } : {}),
	};
}

// impala_eval ohne 'unsafe-eval' (CSP): Der Code läuft als Inline-Skript ('unsafe-inline'
// ist erlaubt) und liefert sein Ergebnis über einen einmaligen globalen Rückruf.
function runEvalCode(code, ctx) {
	return new Promise((resolve, reject) => {
		const key = "__impalaEval_" + Math.random().toString(36).slice(2);
		let syntaxError = null;
		const onError = (e) => { syntaxError = e.error || new SyntaxError(e.message); };
		window[key] = { ctx, resolve, reject };
		const script = document.createElement("script");
		script.textContent = "(async () => { const { ctx, resolve, reject } = window." + key + "; delete window." + key + ";" +
			" const { S, STATE, RENDER, TABS, PERF_PROFILER, CLOUDFLARE_SYNC, DRIVE, SEARCH } = ctx;" +
			" try { resolve(await (async () => {\n" + code + "\n})()); } catch (e) { reject(e); } })();";
		window.addEventListener("error", onError);
		document.head.appendChild(script);
		window.removeEventListener("error", onError);
		script.remove();
		// Wurde der Rückruf nicht abgeholt, lief das Skript nicht (Syntaxfehler oder CSP).
		if (window[key]) {
			delete window[key];
			reject(syntaxError || new Error("Code konnte nicht ausgeführt werden."));
		}
	});
}

export function initMcpBridge() {
	if (typeof window === "undefined" || bridgeStarted || !(SANDBOX.on || mcpBridgeEnabled())) return;
	bridgeStarted = true;

	let portFromParam = "";
	try {
		const p = new URLSearchParams(location.search).get("mcpPort");
		if (p && /^\d+$/.test(p)) {
			sessionStorage.setItem("impalaMcpPort", p);
			portFromParam = p;
		} else {
			portFromParam = sessionStorage.getItem("impalaMcpPort") || "";
		}
	} catch { /* ignore */ }
	const defaultWsUrl = portFromParam ? `ws://127.0.0.1:${portFromParam}` : "ws://127.0.0.1:8765";
	const WS_URL = SANDBOX.bridgeUrl || (typeof window !== "undefined" && window.__IMPALA_WS_URL) || defaultWsUrl;
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
			console.info("[MCP-Bridge] Verbunden mit Antigravity MCP-Server");
			ws.send(JSON.stringify({ hello: true, meta: bridgeMeta() }));
			if (!document.hidden) claim();
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
								appOrigin: location.origin,
								tabVisible: typeof document !== "undefined" ? !document.hidden : true,
							},
							app: {
								activePageId: S.currentPageId || null,
								activePageTitle: activePage?.title || null,
								openTabs: (S.tabs || []).map((tabId) => {
									if (typeof tabId !== "string") return { id: null, title: "Unbekannt" };
									if (tabId.startsWith("chat:")) return { id: tabId, title: "KI-Chat" };
									if (tabId === "anki:main") return { id: tabId, title: "Karteikarten" };
									return { id: tabId, title: S.pages[tabId]?.title || "Ohne Titel" };
								}),
								totalPages: Object.keys(S.pages || {}).length,
								activePages: Object.values(S.pages || {}).filter((p) => !p.trashed).length,
								totalCards: Object.keys(S.cards || {}).length,
								totalHeftDocs: STATE.heftIds().length,
								sidebarCollapsed: !!S.sidebarCollapsed,
							},
							performance: {
								profilerStatus: PERF_PROFILER ? PERF_PROFILER.status() : null,
								memory,
							},
							sync: {
								cloudflare: CLOUDFLARE_SYNC ? cloudflareStatus() : null,
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
					case "impala_get_ai_trace": {
						result = { report: AI.debugReport() };
						if (args.clear) AI.debugClear();
						break;
					}
					case "impala_eval": {
						if (!args.code) {
							result = { error: "Kein JavaScript-Code übergeben." };
							break;
						}
						try {
							const evalOutput = await runEvalCode(args.code, { S, STATE, RENDER, TABS, PERF_PROFILER, CLOUDFLARE_SYNC, DRIVE, SEARCH });
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
										result = { ok: true, started: true, mode: "background", status: cloudflareStatus() };
									} else {
										try {
											const syncRes = await CLOUDFLARE_SYNC.syncNow();
											result = { ok: true, sync: syncRes, status: cloudflareStatus() };
										} catch (syncErr) {
											result = { ok: false, error: syncErr?.message || String(syncErr), status: cloudflareStatus() };
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
							case "go_back": {
								TABS.navBack();
								result = { ok: true };
								break;
							}
							default:
								result = { error: `Unbekannte UI-Aktion: ${action}` };
						}
						break;
					}
					case "impala_storage_report": {
						const usage = CLOUDFLARE_SYNC ? CLOUDFLARE_SYNC.status()?.usage || null : null;
						const rep = await STORAGE_TOOLS.inspectDetailedStorage({
							pages: S.pages,
							db: DB,
							state: STATE,
						});
						rep.syncUsage = usage;
						const legacyRep = STORAGE_TOOLS.storageReport(S.pages, usage);
						const limit = Math.max(1, Math.min(50, Number(args.limit) || 15));
						rep.pdfTop = legacyRep.top.slice(0, limit).map((r) => ({
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
					case "impala_heft_add_pages": {
						// Wiederholter Aufruf (z. B. nach Timeout beim Agenten) läuft nicht doppelt.
						const key = args.op_key ? String(args.op_key) : null;
						const known = key && addPagesOps.get(key);
						if (known && Date.now() - known.at < 15 * 60 * 1000) {
							result = { ...(await known.promise), deduplicated: true };
							break;
						}
						const run = addHeftPages(args);
						if (key) {
							addPagesOps.set(key, { at: Date.now(), promise: run });
							run.catch(() => addPagesOps.delete(key));
						}
						result = await run;
						break;
					}
					case "impala_heft_delete_pages": {
						const pageId = resolveHeftPage(args.page_id).id;
						const { HEFT } = await import("./heft.js");
						const doc = HEFT.openDoc(pageId) || STATE.heftDoc(pageId);
						const pages = doc?.pages || [];
						const wantPages = parsePageIndices(args.pages);
						if (!wantPages.length) throw new Error("pages fehlt: z. B. [1, 2] oder '3-16'");
						const bad = wantPages.filter((p) => p < 1 || p > pages.length);
						if (bad.length) throw new Error(`Seite(n) ${bad.join(", ")} gibt es nicht (Heft hat ${pages.length} Seiten, ab 1)`);
						if (wantPages.length >= pages.length) throw new Error("Ein Heft braucht mindestens eine Seite.");
						const want = wantPages.map((p) => p - 1);
						const blocked = want.filter((i) => heftPageHasContent(pages[i])).map((i) => i + 1);
						if (blocked.length && !args.allow_content) {
							throw new Error(`Seite(n) ${blocked.join(", ")} enthalten Handschrift, Bilder oder Textboxen — nur mit allow_content=true löschen.`);
						}
						const ids = want.map((i) => pages[i].id);
						await deleteHeftPageIds(HEFT, pageId, ids);
						const countNow = (HEFT.openDoc(pageId) || STATE.heftDoc(pageId))?.pages?.length ?? null;
						RENDER.render();
						result = { ok: true, deleted: wantPages, pageCount: countNow ?? (pages.length - want.length) };
						break;
					}
					// PERF: Trainings-Werkzeug samt Wortliste (~75 KB) erst bei Bedarf laden, nicht bei jedem Start.
					case "impala_heft_page_image": {
						const pageId = resolveHeftPage(args.page_id).id;
						result = await (await import("./heft-label.js")).HEFT_LABEL.pageImage({ ...args, page_id: pageId });
						break;
					}
					case "impala_heft_label_lines": {
						const pageId = resolveHeftPage(args.page_id).id;
						result = await (await import("./heft-label.js")).HEFT_LABEL.labelLines({ ...args, page_id: pageId });
						break;
					}
					default: {
						// Inhalts-Werkzeuge = dieselben flachen Werkzeuge wie die App-KI (tools.js,
						// Kern impala-ai/flat.rs): impala_search → search, impala_edit_page → edit_page …
						const flat = tool.startsWith("impala_") ? tool.slice(7) : "";
						const known = (d) => d.function.name === flat;
						if (!TOOLS.flatDefs.some(known) && !TOOLS.lehrerDefs.some(known)) { result = { error: `Unbekanntes Werkzeug: ${tool}` }; break; }
						result = await TOOLS.runFlat(flat, args || {});
						if (result && !result.error && !result.dryRun && /^(create_|edit_|organize_|write_|check_)/.test(flat)) {
							if (S.currentPageId && S.pages?.[S.currentPageId]?.trashed) TABS.closeTab?.(S.currentPageId);
							RENDER.render();
						}
					}
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

	function bridgeMeta() {
		return {
			origin: typeof location !== "undefined" ? location.origin : "",
			url: typeof location !== "undefined" ? location.href : "",
			kind: "pwa",
			pageCount: Object.keys(S.pages || {}).length,
		};
	}

	// Sind mehrere App-Fenster verbunden, bekommt das zuletzt genutzte die Aufrufe.
	function claim() {
		if (ws && ws.readyState === 1) ws.send(JSON.stringify({ claim: true, meta: bridgeMeta() }));
	}

	if (typeof document !== "undefined") {
		window.addEventListener("focus", () => {
			if (!ws || ws.readyState > 1) connect();
			else claim();
		});
		document.addEventListener("visibilitychange", () => {
			if (document.hidden) return;
			if (!ws || ws.readyState > 1) {
				clearTimeout(reconnectTimer);
				reconnectTimer = null;
				connect();
			} else claim();
		});
	}

	connect();
}
