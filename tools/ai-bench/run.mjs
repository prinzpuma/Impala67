#!/usr/bin/env node
// KI-Benchmark für die Impala-KI mit lokalen Modellen (LM Studio) und kostenlosen Cloud-Modellen.
//
// Ablauf: Der Benchmark startet eine Spielwiese der App (eigener Browser-Ursprung auf Port 8019,
// web/sandbox.js: eigene Datenkopie, kein Sync, kein Drive) und füllt sie mit einer Kopie der
// Daten aus der offenen echten App (über die MCP-Bridge, nur lesend). In der Spielwiese schreiben
// die Werkzeuge echt – spätere Schritte und Runden sehen also den neuen Stand –, und vor jedem
// Szenario wird alles per Rückgängig zurückgesetzt. Jedes Szenario läuft als echtes Mehrrunden-
// Gespräch über den Rust-Agenten der App, in zwei Profilen:
//   app = wie der KI-Chat in Impala (geöffnete Seite, Notizsuche, eigene Anweisungen)
//   mcp = wie ein externer Assistent (nichts automatisch mitgeschickt, flache Werkzeuge)
//
//   node tools/ai-bench/run.mjs [--scenarios orga,schreiben] [--modes app,mcp] [--final]
//        [--models a,b] [--cloud [impala-ai,gemini-3.5-flash-lite,gemma-4-31b-it]] [--no-local]
//        [--fresh] [--no-open] [--app-tools classic|flat] [--ctx 32768] [--no-think]
//   node tools/ai-bench/run.mjs --report results/<Zeit>.json   (Bericht neu erzeugen)
//
// Lokale Modelle: immer alle mit Werkzeugen bis 10 B (2B, 9B), mit --final auch die größeren (27B).
// Ergebnis: tools/ai-bench/results/<Zeit>.json (Protokolle) und .md (Bericht) – nicht im Git,
// weil sie Auszüge aus den eigenen Notizen enthalten.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket, WebSocketServer } from "ws";
import { SCENARIOS } from "./scenarios.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const arg = (name, fallback) => {
	const i = process.argv.indexOf("--" + name);
	return i < 0 ? fallback : process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : true;
};
const LMS = String(arg("lms", "http://localhost:1234"));
const CTX = Number(arg("ctx", 32768));
const WS_PORT = Number(process.env.IMPALA_WS_PORT || 8765);
const SANDBOX_PORT = Number(arg("sandbox-port", 8019));
const BRIDGE_PORT = Number(arg("bridge-port", 8767));
const SANDBOX_URL = `http://localhost:${SANDBOX_PORT}/?sandbox=${BRIDGE_PORT}`;
const TURN_LIMIT_MS = Number(arg("turn-timeout", 20 * 60000));
const MODES = String(arg("modes", "app,mcp")).split(",");
// Werkzeuge im app-Profil: classic = inspect/change (wie der KI-Chat heute), flat = search, read_pages …
const APP_TOOLS = String(arg("app-tools", "classic"));
const LOCAL_MAX_B =arg("final", false) === true ? Infinity : 10;
const CLOUD_DEFAULT = ["impala-ai:cloudflare", "gemini-3.5-flash-lite:google", "gemma-4-31b-it:google"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toLocaleTimeString("de-DE"), ...a);

// ---------- Verbindungen ----------
// Echte App (nur lesend): über das Relay des laufenden MCP-Servers.
function connectReal() {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(`ws://127.0.0.1:${WS_PORT}/relay`);
		const pending = new Map();
		let seq = 1;
		const timer = setTimeout(() => reject(new Error("Kein MCP-Server auf Port " + WS_PORT + " (Claude Code / MCP-Server starten, App offen?)")), 3000);
		ws.on("error", (e) => reject(e));
		ws.on("message", (raw) => {
			let msg; try { msg = JSON.parse(raw); } catch { return; }
			if (msg.relayAck) {
				clearTimeout(timer);
				resolve({
					call: (tool, args, timeoutMs = 30000) => new Promise((res) => {
						const id = seq++;
						const t = setTimeout(() => { pending.delete(id); res({ error: "Relay-Timeout", timeout: true }); }, timeoutMs + 10000);
						pending.set(id, (v) => { clearTimeout(t); res(v); });
						ws.send(JSON.stringify({ relayCallId: id, tool, args: { ...args, timeoutMs } }));
					}),
					close: () => ws.close(),
				});
				return;
			}
			const res = pending.get(msg.relayCallId);
			if (res) { pending.delete(msg.relayCallId); res(msg.result); }
		});
	});
}

// Spielwiese: Der Benchmark ist selbst der Bridge-Server, mit dem sich nur die Spielwiese verbindet
// (web/sandbox.js lenkt web/mcp-bridge.js dorthin) – so erreicht kein anderer Assistent sie.
function startSandboxBridge() {
	const wss = new WebSocketServer({ host: "127.0.0.1", port: BRIDGE_PORT, verifyClient: (info) => info.origin === `http://localhost:${SANDBOX_PORT}` });
	let current = null, waiters = [];
	const pending = new Map();
	let seq = 1;
	wss.on("connection", (ws) => {
		current = ws;
		ws.on("message", (raw) => {
			let msg; try { msg = JSON.parse(raw); } catch { return; }
			const res = msg?.callId && pending.get(msg.callId);
			if (res) { pending.delete(msg.callId); res(msg.result); }
		});
		ws.on("close", () => {
			if (current === ws) current = null;
			for (const [id, res] of pending) { pending.delete(id); res({ error: "Spielwiese getrennt", disconnected: true }); }
		});
		waiters.splice(0).forEach((w) => w());
	});
	const ready = (ms) => new Promise((res, rej) => {
		if (current?.readyState === 1) return res();
		const t = setTimeout(() => rej(new Error(`Spielwiese hat sich nicht verbunden (${SANDBOX_URL} im Browser offen?)`)), ms);
		waiters.push(() => { clearTimeout(t); res(); });
	});
	return {
		ready,
		async call(tool, args, timeoutMs = 30000) {
			await ready(60000);
			return new Promise((res) => {
				const callId = seq++;
				const t = setTimeout(() => { pending.delete(callId); res({ error: "Timeout", timeout: true }); }, timeoutMs + 5000);
				pending.set(callId, (v) => { clearTimeout(t); res(v); });
				current.send(JSON.stringify({ callId, tool, args: { ...args, timeoutMs } }));
			});
		},
		// Nach einem Neuladen meldet sich die Seite neu an.
		async reconnect(ms = 120000) { await sleep(1500); if (current?.readyState !== 1) current = null; await ready(ms); },
		close: () => wss.close(),
	};
}
async function evalIn(app, code, timeoutMs = 30000) {
	const r = await app.call("impala_eval", { code }, timeoutMs);
	if (!r) throw new Error("Keine App verbunden.");
	if (r.error) throw new Error(String(r.error));
	if (r.ok === false) throw new Error(String(r.error || r.message || JSON.stringify(r)));
	return r.output;
}

async function serveSandbox() {
	try { await fetch(`http://localhost:${SANDBOX_PORT}/index.html`); return null; } catch {}
	const child = spawn(process.execPath, [join(here, "../serve.mjs"), String(SANDBOX_PORT)], { stdio: "ignore" });
	for (let i = 0; i < 50; i++) { await sleep(100); try { await fetch(`http://localhost:${SANDBOX_PORT}/index.html`); return child; } catch {} }
	throw new Error("Spielwiesen-Server startet nicht (Port " + SANDBOX_PORT + ")");
}
function openBrowser(url) {
	const [cmd, args] = process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
	try { spawn(cmd, args, { stdio: "ignore", detached: true }).unref(); } catch {}
}

// Kopie der echten Daten in die Spielwiese. Geräte-Zugänge (Sync-Schlüssel, Drive) bleiben draußen,
// damit die Kopie nie mit dem echten Konto spricht (zusätzlich zur Sperre in web/sandbox.js).
async function fillSandbox(real, sb) {
	log("kopiere Daten aus der echten App in die Spielwiese …");
	const total = await evalIn(real, `
		const { DB } = await import("./db.js");
		const snap = JSON.parse(await DB.exportAll({ includeBlobs: false }));
		for (const ev of snap.events) {
			if (ev.type !== "settingsSet" || !ev.payload) continue;
			for (const k of Object.keys(ev.payload)) if (/^(cf|drive|notion)/i.test(k)) delete ev.payload[k];
		}
		globalThis.__benchCopy = JSON.stringify(snap);
		return globalThis.__benchCopy.length;`, 300000);
	// Stückweise: eine Bridge-Nachricht darf höchstens 100 MB groß sein.
	const CHUNK = 8e6;
	await evalIn(sb, `globalThis.__benchCopy = []; return true;`);
	try {
		for (let at = 0; at < total; at += CHUNK) {
			const part = await evalIn(real, `return globalThis.__benchCopy.slice(${at}, ${at + CHUNK});`, 120000);
			await evalIn(sb, `globalThis.__benchCopy.push(${JSON.stringify(part)}); return true;`, 120000);
			process.stdout.write(`\r   ${Math.min(100, Math.round(((at + CHUNK) / total) * 100))} % `);
		}
	} finally { await evalIn(real, `delete globalThis.__benchCopy; return true;`).catch(() => {}); }
	process.stdout.write("\n");
	const out = await evalIn(sb, `
		const { DB } = await import("./db.js");
		const json = globalThis.__benchCopy.join(""); delete globalThis.__benchCopy;
		const exportedAt = JSON.parse(json.slice(0, 200).replace(/,"events".*$/, "}")).exportedAt || new Date().toISOString();
		const db = await new Promise((res, rej) => { const r = indexedDB.open("impala67"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
		await new Promise((res, rej) => { const t = db.transaction(["events", "blobs", "vecs"], "readwrite"); for (const s of ["events", "blobs", "vecs"]) t.objectStore(s).clear(); t.oncomplete = res; t.onerror = () => rej(t.error); });
		db.close();
		const { added } = await DB.importAll(json);
		localStorage.setItem("impala67SandboxCopy", exportedAt);
		localStorage.removeItem("impala67SandboxDirty");
		setTimeout(() => location.reload(), 300);
		return added;`, 600000);
	log(`   ${out} Events übernommen (${(total / 1e6).toFixed(1)} MB), Spielwiese lädt neu …`);
	await sb.reconnect();
}

// ---------- LM Studio ----------
async function lmsModels() {
	try { return (await (await fetch(`${LMS}/api/v0/models`)).json()).data || []; } catch { return []; }
}
function lmsLoad(id) {
	try { execFileSync("lms", ["unload", "--all"], { stdio: "ignore" }); } catch {}
	log(`lade ${id} (Kontext ${CTX}) …`);
	const t0 = Date.now();
	execFileSync("lms", ["load", id, "-c", String(CTX), "-y"], { stdio: "ignore", timeout: 10 * 60000 });
	return Date.now() - t0;
}
const sizeB = (id) => parseFloat(String(id).match(/(\d+(?:\.\d+)?)b\b/i)?.[1] || 0);

// ---------- Auswertung ----------
// Modelle antworten oft in LaTeX: \text{ kg/s}, \mu A, e^{-2t}, \pm … → schlichter Text zum Vergleichen.
function plain(text) {
	return String(text || "")
		.replace(/\\(?:text|mathrm|mathbf|operatorname|boxed)\s*\{([^}]*)\}/g, "$1")
		.replace(/\\ddot\s*\{?x\}?/g, "ẍ").replace(/\\dot\s*\{?x\}?/g, "ẋ")
		.replace(/\\mu\s*/g, "µ").replace(/\\omega/g, "ω").replace(/\\gamma/g, "γ").replace(/\\lambda/g, "λ").replace(/\\pm/g, "±")
		.replace(/\\approx/g, "≈").replace(/\\cdot/g, "·").replace(/\\(?:left|right)\b/g, "")
		.replace(/\\[,;:! ]/g, " ").replace(/\\%/g, "%").replace(/\\([a-zA-Z]+)/g, "$1").replace(/[{}$]/g, "").replace(/~/g, " ");
}
// Beide Profile laufen über den Rust-Agenten: flache Werkzeuge kommen als inspect/change an.
const GROUPS = { heft: ["view_heft_page"], read: ["inspect", "view_heft_page"], write: ["change"], calc: ["calculate"] };
function normalize(rec) {
	rec.plain = plain(rec.text);
	for (const t of rec.tools) {
		t.group = Object.keys(GROUPS).find((g) => g !== "read" && GROUPS[g].includes(t.name)) || (GROUPS.read.includes(t.name) ? "read" : "other");
		let a = {}; try { a = JSON.parse(t.args); } catch {}
		if (t.name === "view_heft_page") t.page = Number(a.page) || 1;
	}
	return rec;
}
function grade(turn, rec, ctx) {
	const content = (turn.checks || []).filter((c) => c.re).some((c) => c.re.test(rec.plain));
	return (turn.checks || []).map((c) => {
		if (c.needsContent && !content) return { label: c.label, pass: false };
		let pass = false;
		try {
			if (c.re) pass = c.re.test(rec.plain);
			else if (c.tool) pass = rec.tools.some((t) => (t.group === c.tool || (c.tool === "read" && t.group === "heft") || t.name === c.tool) && !t.error);
			else if (c.fn) pass = !!c.fn(rec, ctx);
		} catch { pass = false; }
		return { label: c.label, pass };
	});
}
function metrics(rec) {
	const chat = rec.requests.filter((r) => r.messages != null); // Modell-Anfragen (lokal und Cloud), keine Nebenabrufe
	let prompt = 0, completion = 0, cached = 0, toolDefTokens = 0, decodeMs = 0, decodeTokens = 0, prefillMs = 0, prefillTokens = 0;
	for (const r of chat) {
		const u = r.usage || {};
		const out = u.completion_tokens ?? (r.chunks.content + r.chunks.reasoning + r.chunks.tool);
		const p = u.prompt_tokens || 0;
		prompt += p; completion += out;
		cached += u.prompt_tokens_details?.cached_tokens || 0;
		// Anteil der Werkzeugbeschreibungen am Prompt, geschätzt über die Zeichen.
		if (r.toolChars && r.promptChars) toolDefTokens += Math.round(p * r.toolChars / (r.toolChars + r.promptChars));
		// Nur gestreamte Anfragen: Bei der Verlaufs-Zusammenfassung (ohne Stream) kommt alles auf einmal.
		if (r.stream && r.tFirst && r.tEnd > r.tFirst) {
			decodeMs += r.tEnd - r.tFirst; decodeTokens += out;
			prefillMs += r.tFirst - r.t0; prefillTokens += p;
		}
	}
	const first = chat.find((r) => r.tFirst);
	return {
		requests: chat.length, promptTokens: prompt, completionTokens: completion, cachedTokens: cached, toolDefTokens,
		reasoningTokens: chat.reduce((n, r) => n + (r.usage?.completion_tokens_details?.reasoning_tokens ?? r.chunks.reasoning), 0),
		ttftMs: first ? first.tFirst - first.t0 : null,
		decodeTps: decodeMs ? +(decodeTokens / (decodeMs / 1000)).toFixed(1) : null,
		prefillTps: prefillMs && prefillTokens ? +(prefillTokens / (prefillMs / 1000)).toFixed(0) : null,
		maxPromptTokens: Math.max(0, ...chat.map((r) => r.usage?.prompt_tokens || 0)),
		usageExact: chat.length > 0 && chat.every((r) => r.usage),
		toolCalls: rec.tools.length, toolErrors: rec.tools.filter((t) => t.error).length,
	};
}

// ---------- Ein Gesprächsschritt in der Spielwiese ----------
class LostHarness extends Error {}
const guard = (body) => `if (!globalThis.__aiBench) return { lost: true }; ${body}`;
async function runTurn(sb, spec) {
	const id = await evalIn(sb, guard(`return globalThis.__aiBench.start(${JSON.stringify(spec)});`));
	if (id?.lost) throw new LostHarness();
	const t0 = Date.now();
	let last = "";
	for (;;) {
		await sleep(1500);
		let p;
		try { p = await evalIn(sb, guard(`return globalThis.__aiBench.poll(${JSON.stringify(id)});`), 20000); }
		catch (e) { if (/timeout/i.test(String(e?.message))) continue; throw e; }
		if (p.lost || p.state === "missing") throw new LostHarness();
		if (p.state !== "running") return p;
		const line = `   … ${Math.round(p.ms / 1000)} s, ${p.requests} Anfrage(n), Tools: ${p.tools.join(", ") || "–"}, Token im Strom: ${p.lastChunks}`;
		if (line !== last && Date.now() - t0 > 10000) { process.stdout.write("\r" + line.slice(0, 110).padEnd(110)); last = line; }
		if (Date.now() - t0 > TURN_LIMIT_MS) await evalIn(sb, `return globalThis.__aiBench.cancel(${JSON.stringify(id)});`);
	}
}

async function main() {
	const server = await serveSandbox();
	const sb = startSandboxBridge();
	if (arg("no-open", false) !== true) openBrowser(SANDBOX_URL);
	log("Spielwiese:", SANDBOX_URL, "– warte auf Verbindung …");
	await sb.ready(120000);
	const state = await evalIn(sb, `const { SANDBOX } = await import("./sandbox.js"); return { sandbox: SANDBOX.on, copiedAt: localStorage.getItem("impala67SandboxCopy"), dirty: !!localStorage.getItem("impala67SandboxDirty") };`);
	if (!state.sandbox) throw new Error("Die Seite auf Port " + SANDBOX_PORT + " ist keine Spielwiese (Ursprung schon benutzt?).");

	const cloud = arg("cloud", false);
	const cloudList = cloud === false ? [] : (cloud === true ? CLOUD_DEFAULT : String(cloud).split(","))
		.map((s) => { const [model, provider] = s.split(":"); return { id: model, provider: provider || (/^impala/.test(model) ? "cloudflare" : "google") }; });
	let real = null, cloudflare = null;
	const fresh = !state.copiedAt || state.dirty || arg("fresh", false) === true;
	if (state.dirty) log("Spielwiese enthält Änderungen eines abgebrochenen Laufs – kopiere neu.");
	else if (!fresh) log("Spielwiese enthält die Kopie vom", state.copiedAt, "(neu kopieren: --fresh)");
	if (fresh || cloudList.some((c) => c.provider === "cloudflare")) {
		real = await connectReal();
		if (fresh) await fillSandbox(real, sb); // lädt die Spielwiese danach neu
		// Zugang zu „Impala AI“ (Cloudflare-Worker) aus dem Sync-Schlüssel der echten App – nur im Speicher.
		if (cloudList.some((c) => c.provider === "cloudflare")) {
			cloudflare = await evalIn(real, `const { CORE } = await import("./rust-core.js"); const st = CLOUDFLARE_SYNC.status(); if (!st.syncKey) return null; const { userId, authToken } = CORE.syncAuth(st.syncKey); return { userId, authToken, fallbackBase: st.url };`);
			if (!cloudflare) log("Impala AI übersprungen: Die echte App hat keinen Sync-Schlüssel.");
		}
		real.close();
	}
	// Ohne neue Kopie trotzdem neu laden: Die Spielwiese soll den aktuellen Stand von web/ (und
	// des Kerns in web/core/) ausführen, nicht den vom letzten Lauf.
	if (!fresh) {
		await evalIn(sb, `setTimeout(() => location.reload(), 200); return true;`);
		await sb.reconnect();
	}
	const loadHarness = async () => {
		const harness = readFileSync(join(here, "harness.js"), "utf8");
		return evalIn(sb, harness, 60000);
	};
	log("Harness bereit:", JSON.stringify(await loadHarness()));

	const wanted = arg("models", null);
	const local = arg("no-local", false) === true ? [] : (await lmsModels()).filter((m) => m.type === "llm" || m.type === "vlm")
		.filter((m) => (wanted ? String(wanted).split(",").includes(m.id) : (m.capabilities || []).includes("tool_use") && sizeB(m.id) <= LOCAL_MAX_B))
		.sort((a, b) => sizeB(a.id) - sizeB(b.id));
	const models = [...local.map((m) => ({ ...m, provider: "local" })),
		...cloudList.filter((c) => c.provider !== "cloudflare" || cloudflare).map((c) => ({ id: c.id, provider: c.provider, type: "cloud", arch: c.provider, quantization: "–" }))];
	const scen = arg("scenarios", null);
	const scenarios = SCENARIOS.filter((s) => !scen || String(scen).split(",").includes(s.id));
	if (!models.length) throw new Error("Keine Modelle (LM Studio offen? --cloud?).");
	log("Modelle:", models.map((m) => m.id).join(", "), "| Modi:", MODES.join(", "), "| Szenarien:", scenarios.map((s) => s.id).join(", "));

	const pdfCache = new Map();
	const results = { startedAt: new Date().toISOString(), ctx: CTX, lms: LMS, modes: MODES, sandbox: true, runs: [] };
	const stamp = results.startedAt.replace(/[:.]/g, "-").slice(0, 19);
	const outDir = join(here, "results");
	mkdirSync(outDir, { recursive: true });
	const save = () => {
		writeFileSync(join(outDir, stamp + ".json"), JSON.stringify(results, null, 2));
		writeFileSync(join(outDir, stamp + ".md"), report(results));
	};

	for (const m of models) {
		const loadMs = m.provider === "local" && arg("no-load", false) !== true ? lmsLoad(m.id) : null;
		for (const spec of MODES) {
			// „app/flat“ = app-Profil mit flachen Werkzeugen (zum Vergleich mit app = inspect/change).
			const [mode, tools] = spec.split("/");
			const entry = { id: m.id, provider: m.provider, mode, tools: mode === "app" ? tools || APP_TOOLS : "flat", type: m.type, arch: m.arch, quant: m.quantization, loadMs, scenarios: [] };
			results.runs.push(entry);
			log(`== ${m.id} · ${label(entry)}${loadMs ? ` (geladen in ${(loadMs / 1000).toFixed(1)} s)` : ""}`);
			for (const s of scenarios) {
				for (let attempt = 1; ; attempt++) {
					try { await runScenario(entry, s, attempt); break; } catch (e) {
						if (!(e instanceof LostHarness) || attempt >= 3) throw e;
						entry.scenarios.pop();
						log(`   Spielwiese neu geladen – spiele Harness neu ein und wiederhole ${s.id}`);
						await sb.reconnect();
						await loadHarness();
					}
				}
			}
		}
	}
	async function runScenario(entry, s, attempt) {
		const convId = `${entry.id}::${label(entry)}::${s.id}`;
		const reset = await evalIn(sb, guard(`return await globalThis.__aiBench.reset(${JSON.stringify(convId)});`), 60000);
		if (reset?.lost) throw new LostHarness();
		if (reset.failed) log(`   Achtung: ${reset.failed} Änderung(en) ließen sich nicht zurücknehmen – bei Bedarf mit --fresh neu kopieren.`);
		let pdfFile = null;
		if (s.pdf) {
			const key = JSON.stringify(s.pdf);
			if (!pdfCache.has(key)) {
				if (s.pdf.file) {
					try { pdfCache.set(key, readFileSync(join(here, s.pdf.file), "utf8")); }
					catch { entry.scenarios.push({ id: s.id, name: s.name, skipped: `Textdatei ${s.pdf.file} fehlt (siehe scenarios.mjs)` }); log(`-- ${s.id}: übersprungen, ${s.pdf.file} fehlt`); return; }
				} else pdfCache.set(key, await evalIn(sb, `return globalThis.__aiBench.heftText(${JSON.stringify(s.pdf.heft)}, ${s.pdf.from}, ${s.pdf.to});`, 60000));
			}
			pdfFile = { name: s.pdf.name, content: pdfCache.get(key) };
		}
		const sc = { id: s.id, name: s.name, attempt, pdfChars: pdfFile?.content?.length || 0, turns: [] };
		entry.scenarios.push(sc);
		log(`-- ${s.id}: ${s.name}`);
		const prev = [];
		for (const [i, t] of s.turns.entries()) {
			const spec = { convId, profile: entry.mode, model: entry.id, providerId: entry.provider, cloudflare: entry.provider === "cloudflare" ? cloudflare : null,
				text: t.text, workspacePage: s.workspacePage || null, answers: t.answers || null,
				thinking: arg("no-think", false) !== true, pdfFile: t.attachPdf ? pdfFile : null, appTools: entry.tools };
			const rec = normalize(await runTurn(sb, spec));
			process.stdout.write("\r".padEnd(112) + "\r");
			const checks = rec.state === "done" ? grade(t, rec, { prev }) : (t.checks || []).map((c) => ({ label: c.label, pass: false }));
			prev.push(rec);
			const met = metrics(rec);
			const passed = checks.filter((c) => c.pass).length;
			sc.turns.push({ i: i + 1, question: t.text, state: rec.state, error: rec.error, wallMs: rec.wallMs, ...met, checks, passed, total: checks.length,
				answer: rec.text, tools: rec.tools, changes: rec.changes, asks: rec.asks, rag: rec.rag, summary: rec.summary, items: rec.items, requestsRaw: rec.requests, config: rec.config });
			log(`   R${i + 1}: ${passed}/${checks.length} ✓ | ${(rec.wallMs / 1000).toFixed(1)} s | ${met.promptTokens + met.completionTokens} tk (Prompt ${met.promptTokens}, Antwort ${met.completionTokens}) | Tools ${rec.tools.map((x) => x.name + (x.error ? "✗" : "")).join(",") || "–"}${rec.error ? " | FEHLER " + rec.error.slice(0, 120) : ""}`);
			save();
		}
	}
	await evalIn(sb, guard(`return await globalThis.__aiBench.reset();`), 60000).catch(() => {});
	results.finishedAt = new Date().toISOString();
	save();
	try { execFileSync("lms", ["unload", "--all"], { stdio: "ignore" }); } catch {}
	sb.close();
	server?.kill();
	log("Bericht:", join(outDir, stamp + ".md"));
}

// ---------- Bericht ----------
const label = (m) => (m.mode === "app" && m.tools && m.tools !== "classic" ? `app/${m.tools}` : m.mode);
const kTok = (n) => (n >= 10000 ? Math.round(n / 1000) + " k" : n >= 1000 ? (n / 1000).toFixed(1) + " k" : String(n));
function report(res) {
	const runs = res.runs || (res.models || []).map((m) => ({ ...m, mode: "app" })); // ältere Ergebnisdateien
	const L = [];
	const fmt = (ms) => (ms == null ? "–" : (ms / 1000).toFixed(1) + " s");
	const sum = (xs, k) => xs.reduce((n, x) => n + (x[k] || 0), 0);
	const avg = (xs, k) => { const v = xs.map((x) => x[k]).filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
	const pct = (p, t) => `${p}/${t} (${t ? Math.round((100 * p) / t) : 0} %)`;
	L.push(`# KI-Benchmark`, "", `Start ${res.startedAt} · Kontext ${res.ctx} Token · ${res.sandbox ? "Spielwiese (echtes Schreiben auf einer Datenkopie)" : "Trockenlauf"}`, "");
	L.push("**app** = KI-Chat in Impala (geöffnete Seite, Notizsuche, eigene Anweisungen) · **mcp** = externer Assistent (nichts automatisch mitgeschickt, flache Werkzeuge). Beide über den Rust-Agenten.", "");
	L.push("Token gesamt = Prompt + Antwort (inkl. Denken), über alle Anfragen. Werkzeug-Anteil = geschätzter Anteil der Werkzeugbeschreibungen am Prompt.", "");
	L.push("| Modell | Modus | Punkte | Zeit | Token gesamt | Prompt | Antwort (Denken) | Token je Punkt | Werkzeug-Anteil | Anfragen | Tool-Aufrufe (Fehler) | Abbrüche | Ø Decode tk/s |",
		"|---|---|---|---|---|---|---|---|---|---|---|---|---|");
	for (const m of runs) {
		const turns = m.scenarios.flatMap((s) => s.turns || []);
		const p = sum(turns, "promptTokens"), c = sum(turns, "completionTokens"), pts = sum(turns, "passed");
		L.push(`| ${m.id} | ${label(m)} | ${pct(pts, sum(turns, "total"))} | ${fmt(sum(turns, "wallMs"))} | **${kTok(p + c)}** | ${kTok(p)} | ${kTok(c)} (${kTok(sum(turns, "reasoningTokens"))}) | ${pts ? kTok(Math.round((p + c) / pts)) : "–"} | ${p ? Math.round((100 * sum(turns, "toolDefTokens")) / p) + " %" : "–"} | ${sum(turns, "requests")} | ${sum(turns, "toolCalls")} (${sum(turns, "toolErrors")}) | ${turns.filter((x) => x.state !== "done" || /Abgebrochen/.test(x.answer || "")).length} | ${avg(turns, "decodeTps")?.toFixed(1) ?? "–"} |`);
	}
	const ids = [...new Set(runs.flatMap((m) => m.scenarios.map((s) => s.id)))];
	L.push("", "Je Szenario: Punkte · Zeit · Token", "", "| Szenario | " + runs.map((m) => `${m.id.replace("ternary-bonsai-2-", "")} ${label(m)}`).join(" | ") + " |", "|---|" + runs.map(() => "---").join("|") + "|");
	for (const id of ids) {
		const name = runs.flatMap((m) => m.scenarios).find((s) => s.id === id)?.name || id;
		L.push(`| ${name} | ` + runs.map((m) => { const s = m.scenarios.find((x) => x.id === id); if (!s?.turns) return "–"; const t = s.turns; return `${sum(t, "passed")}/${sum(t, "total")} · ${fmt(sum(t, "wallMs"))} · ${kTok(sum(t, "promptTokens") + sum(t, "completionTokens"))}`; }).join(" | ") + " |");
	}
	L.push("");
	for (const m of runs) {
		L.push(`## ${m.id} · ${label(m)}`, "", `${m.type}, ${m.arch}, ${m.quant}${m.loadMs ? `, geladen in ${fmt(m.loadMs)}` : ""}`, "");
		for (const s of m.scenarios) {
			if (s.skipped) { L.push(`### ${s.name} — übersprungen (${s.skipped})`, ""); continue; }
			L.push(`### ${s.name} — ${sum(s.turns, "passed")}/${sum(s.turns, "total")}${s.pdfChars ? ` (PDF ${s.pdfChars} Zeichen)` : ""}`, "");
			L.push("| Runde | Punkte | Zeit | TTFT | tk/s | Prompt-Tk | max. Prompt | Antwort-Tk | Anfragen | Tools |", "|---|---|---|---|---|---|---|---|---|---|");
			for (const x of s.turns) L.push(`| ${x.i} | ${x.passed}/${x.total} | ${fmt(x.wallMs)} | ${fmt(x.ttftMs)} | ${x.decodeTps ?? "–"} | ${x.promptTokens} | ${x.maxPromptTokens} | ${x.completionTokens} | ${x.requests} | ${x.tools.map((t) => t.name.replace("impala_", "") + (t.error ? "✗" : "")).join(", ") || "–"} |`);
			L.push("");
			for (const x of s.turns) {
				L.push(`**R${x.i}:** ${x.question}`, "");
				L.push(x.checks.map((c) => `${c.pass ? "✅" : "❌"} ${c.label}`).join(" · "), "");
				if (x.error) L.push(`> Fehler: ${x.error}`, "");
				const errs = x.tools.filter((t) => t.error && t.detail);
				if (errs.length) L.push("Werkzeugfehler: " + errs.map((t) => `\`${t.name}\`: ${t.detail.replace(/\n/g, " ").slice(0, 160)}`).join(" · "), "");
				if (x.changes?.length) L.push("Geschrieben: " + x.changes.map((o) => `\`${o.op}\` ${o.title || o.deck || ""}`).join(", "), "");
				L.push("> " + String(x.answer || "(keine Antwort)").replace(/\n/g, "\n> ").slice(0, 2500), "");
			}
		}
	}
	return L.join("\n");
}

if (arg("report", null)) {
	const file = resolve(String(arg("report")));
	writeFileSync(file.replace(/\.json$/, ".md"), report(JSON.parse(readFileSync(file, "utf8"))));
	log("Bericht neu erzeugt:", file.replace(/\.json$/, ".md"));
} else main().then(() => process.exit(0), (e) => { console.error("Abbruch:", e?.message || e); process.exit(1); });
