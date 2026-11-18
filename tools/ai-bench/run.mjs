#!/usr/bin/env node
// KI-Benchmark für die Impala-KI mit lokalen Modellen (LM Studio) und kostenlosen Cloud-Modellen.
//
// Ablauf: Der Benchmark startet eine oder mehrere Spielwiesen der App (eigene Browser-Ursprünge ab
// Port 8019, headless; web/sandbox.js: eigene Datenkopie, kein Sync, kein Drive) und füllt sie mit
// einer Kopie der Daten aus der offenen echten App (über die MCP-Bridge, nur lesend). In der
// Spielwiese schreiben die Werkzeuge echt – spätere Schritte und Runden sehen also den neuen
// Stand –, und vor jedem Szenario wird alles per Rückgängig zurückgesetzt. Jedes Szenario läuft
// als echtes Mehrrunden-Gespräch über den Rust-Agenten der App, in zwei Profilen:
//   app = wie der KI-Chat in Impala (geöffnete Seite, Notizsuche, eigene Anweisungen)
//   mcp = wie ein externer Assistent (nichts automatisch mitgeschickt, flache Werkzeuge)
//
//   node tools/ai-bench/run.mjs --quick          Schnelllauf: Gemini Flash-Lite, 3 Durchgänge, 3 parallel
//   node tools/ai-bench/run.mjs                  lokale Modelle bis 10 B (2B, 9B), 1 Durchgang
//        [--scenarios orga,schreiben] [--modes app,mcp] [--final] [--models a,b]
//        [--cloud [impala-ai,gemini-3.5-flash-lite,gemma-4-31b-it]] [--no-local]
//        [--repeat 3] [--parallel 3] [--no-cache] [--now 2026-11-18T10:00] [--compare results/<Zeit>.json]
//        [--fresh] [--no-open] [--visible] [--app-tools classic|flat] [--ctx 32768] [--no-think]
//   node tools/ai-bench/run.mjs --report results/<Zeit>.json   (Bericht neu erzeugen)
//
// Messen ohne Rauschen und ohne Warten:
// - Feste Uhrzeit (--now): Die Szenarien fragen nach „heute“ und „diese Woche“.
// - Wiederholungen (--repeat): Modelle antworten jedes Mal anders; der Bericht zeigt Mittel und
//   Spanne. Ein Unterschied innerhalb der Spanne ist Zufall.
// - Cache (results/cache/): Ein Szenario-Durchgang wird nur neu gemessen, wenn sich Kern/App
//   (web/*.js, web/core/), Harness, Datenkopie, Uhrzeit, Modell oder die Fragen geändert haben.
//   Bewertet wird immer neu, Änderungen an den Prüfungen brauchen also keinen neuen Lauf.
// - Parallel (--parallel): Cloud-Modelle laufen auf mehreren Spielwiesen gleichzeitig; lokale
//   Modelle immer nacheinander (eine GPU, ehrliche Zeiten).
// - Cloud-Schlüssel: GEMINI_API_KEY (oder GOOGLE_API_KEY) als Umgebungsvariable – dann braucht
//   der Lauf die echte App nur für eine neue Datenkopie (--fresh) oder Impala AI.
// Ergebnis: tools/ai-bench/results/<Zeit>.json (Protokolle) und .md (Bericht) – nicht im Git,
// weil sie Auszüge aus den eigenen Notizen enthalten.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket, WebSocketServer } from "ws";
import { SCENARIOS } from "./scenarios.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const WEB = join(here, "../../web");
const arg = (name, fallback) => {
	const i = process.argv.indexOf("--" + name);
	return i < 0 ? fallback : process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : true;
};
const flag = (name) => arg(name, false) === true;
const QUICK = flag("quick");
const LMS = String(arg("lms", "http://localhost:1234"));
const CTX = Number(arg("ctx", 32768));
const WS_PORT = Number(process.env.IMPALA_WS_PORT || 8765);
const SANDBOX_PORT = Number(arg("sandbox-port", 8019));
const BRIDGE_PORT = Number(arg("bridge-port", 8767));
const TURN_LIMIT_MS = Number(arg("turn-timeout", 20 * 60000));
const MODES = String(arg("modes", "app,mcp")).split(",");
// Werkzeuge im app-Profil: flat = search, read_pages … (wie der KI-Chat heute), classic = inspect/change
const APP_TOOLS = String(arg("app-tools", "flat"));
const LOCAL_MAX_B = flag("final") ? Infinity : 10;
const REPEAT = Math.max(1, Number(arg("repeat", QUICK ? 3 : 1)));
const PARALLEL = Math.max(1, Number(arg("parallel", QUICK ? 3 : 1)));
const USE_CACHE = !flag("no-cache");
// Mittwoch, 18.11.2026 vormittags: dafür sind die Szenarien geschrieben (VL 5 DGL heute, Blatt 04 bis 14 Uhr).
const BENCH_NOW = String(arg("now", "2026-11-18T10:00"));
const THINK = !flag("no-think");
const CLOUD_DEFAULT = ["impala-ai:cloudflare", "gemini-3.5-flash-lite:google", "gemma-4-31b-it:google"];
const GOOGLE_PRESET = { id: "google", name: "Google Gemini", base: "https://generativelanguage.googleapis.com/v1beta/openai" };
const ENV_GOOGLE = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
const OUT_DIR = join(here, "results");
const CACHE_DIR = join(OUT_DIR, "cache");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toLocaleTimeString("de-DE"), ...a);
const sha = (s) => createHash("sha256").update(s).digest("hex");

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
					name: "echte App",
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

// Spielwiesen: Der Benchmark ist selbst der Bridge-Server, mit dem sich nur die Spielwiesen
// verbinden (web/sandbox.js lenkt web/mcp-bridge.js dorthin) – so erreicht kein anderer Assistent
// sie. Ein Server für alle; welche Spielwiese spricht, verrät der Ursprung (Port).
function startBridgeHub() {
	const slots = new Map();
	const portOf = (origin) => Number(/^http:\/\/localhost:(\d+)$/.exec(String(origin || ""))?.[1] || 0);
	const wss = new WebSocketServer({ host: "127.0.0.1", port: BRIDGE_PORT, verifyClient: (info) => slots.has(portOf(info.origin)) });
	wss.on("connection", (ws, req) => {
		const s = slots.get(portOf(req.headers.origin));
		if (!s) return ws.close();
		s.current = ws;
		ws.on("message", (raw) => {
			let msg; try { msg = JSON.parse(raw); } catch { return; }
			const res = msg?.callId && s.pending.get(msg.callId);
			if (res) { s.pending.delete(msg.callId); res(msg.result); }
		});
		ws.on("close", () => {
			if (s.current === ws) s.current = null;
			for (const [id, res] of s.pending) { s.pending.delete(id); res({ error: "Spielwiese getrennt", disconnected: true }); }
		});
		s.waiters.splice(0).forEach((w) => w());
	});
	let seq = 1;
	return {
		handle(port) {
			const s = { current: null, waiters: [], pending: new Map() };
			slots.set(port, s);
			const url = `http://localhost:${port}/?sandbox=${BRIDGE_PORT}`;
			const ready = (ms) => new Promise((res, rej) => {
				if (s.current?.readyState === 1) return res();
				const t = setTimeout(() => rej(new Error(`Spielwiese hat sich nicht verbunden (${url} im Browser offen?)`)), ms);
				s.waiters.push(() => { clearTimeout(t); res(); });
			});
			return {
				port, url, name: `Spielwiese ${port}`, ready,
				async call(tool, args, timeoutMs = 30000) {
					await ready(60000);
					return new Promise((res) => {
						const callId = seq++;
						const t = setTimeout(() => { s.pending.delete(callId); res({ error: "Timeout", timeout: true }); }, timeoutMs + 5000);
						s.pending.set(callId, (v) => { clearTimeout(t); res(v); });
						s.current.send(JSON.stringify({ callId, tool, args: { ...args, timeoutMs } }));
					});
				},
				// Nach einem Neuladen meldet sich die Seite neu an.
				async reconnect(ms = 120000) { await sleep(1500); if (s.current?.readyState !== 1) s.current = null; await ready(ms); },
				// Neu laden und auf die NEUE Verbindung warten (die alte kann noch kurz offen sein).
				async reload(ms = 120000) {
					const old = s.current;
					await evalIn(this, `setTimeout(() => location.reload(), 200); return true;`);
					const t0 = Date.now();
					while (s.current === old || s.current?.readyState !== 1) {
						if (Date.now() - t0 > ms) throw new Error(`Spielwiese ${port} meldet sich nach dem Neuladen nicht.`);
						await sleep(200);
					}
				},
			};
		},
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

async function serveSandbox(port) {
	try { await fetch(`http://localhost:${port}/index.html`); return null; } catch {}
	const child = spawn(process.execPath, [join(here, "../serve.mjs"), String(port)], { stdio: "ignore" });
	for (let i = 0; i < 50; i++) { await sleep(100); try { await fetch(`http://localhost:${port}/index.html`); return child; } catch {} }
	throw new Error("Spielwiesen-Server startet nicht (Port " + port + ")");
}
function openBrowser(url) {
	const [cmd, args] = process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
	try { spawn(cmd, args, { stdio: "ignore", detached: true }).unref(); } catch {}
}
function findChrome() {
	const list = process.platform === "win32"
		? [
			"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
			"C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
			join(process.env.LOCALAPPDATA || "", "Google\\Chrome\\Application\\chrome.exe"),
			"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
			"C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
		]
		: process.platform === "darwin"
			? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium"]
			: ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
	return list.find((p) => p && existsSync(p)) || null;
}
function launchHeadless(url, port) {
	const bin = findChrome();
	if (!bin) return null;
	const profile = join(OUT_DIR, `.chrome-${port}`);
	mkdirSync(profile, { recursive: true });
	return spawn(bin, [
		"--headless=new", `--user-data-dir=${profile}`,
		"--no-first-run", "--no-default-browser-check", "--disable-gpu",
		"--disable-background-timer-throttling", "--disable-renderer-backgrounding",
		url,
	], { stdio: "ignore" });
}

// Kopie der Daten in eine Spielwiese – aus der echten App oder aus einer anderen Spielwiese.
// Geräte-Zugänge (Sync-Schlüssel, Drive) bleiben draußen, damit die Kopie nie mit dem echten
// Konto spricht (zusätzlich zur Sperre in web/sandbox.js). stamp = Stand der Kopie (für den Cache).
async function fillSandbox(source, sb, stamp = null) {
	log(`kopiere Daten: ${source.name} → ${sb.name} …`);
	const total = await evalIn(source, `
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
			const part = await evalIn(source, `return globalThis.__benchCopy.slice(${at}, ${at + CHUNK});`, 120000);
			await evalIn(sb, `globalThis.__benchCopy.push(${JSON.stringify(part)}); return true;`, 120000);
		}
	} finally { await evalIn(source, `delete globalThis.__benchCopy; return true;`).catch(() => {}); }
	const out = await evalIn(sb, `
		const { DB } = await import("./db.js");
		const json = globalThis.__benchCopy.join(""); delete globalThis.__benchCopy;
		const exportedAt = ${JSON.stringify(stamp)} || JSON.parse(json.slice(0, 200).replace(/,"events".*$/, "}")).exportedAt || new Date().toISOString();
		const db = await new Promise((res, rej) => { const r = indexedDB.open("impala67"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
		await new Promise((res, rej) => { const t = db.transaction(["events", "blobs", "vecs"], "readwrite"); for (const s of ["events", "blobs", "vecs"]) t.objectStore(s).clear(); t.oncomplete = res; t.onerror = () => rej(t.error); });
		db.close();
		const { added } = await DB.importAll(json);
		localStorage.setItem("impala67SandboxCopy", exportedAt);
		localStorage.removeItem("impala67SandboxDirty");
		return added;`, 600000);
	log(`   ${out} Events übernommen (${(total / 1e6).toFixed(1)} MB), ${sb.name} lädt neu …`);
	await sb.reload();
}
const sandboxState = (sb) => evalIn(sb, `const { SANDBOX } = await import("./sandbox.js"); return { sandbox: SANDBOX.on, copiedAt: localStorage.getItem("impala67SandboxCopy"), dirty: !!localStorage.getItem("impala67SandboxDirty") };`);
const loadHarness = (sb) => evalIn(sb, readFileSync(join(here, "harness.js"), "utf8"), 60000);

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

// ---------- Cache ----------
// Fingerabdruck des Codes, der eine Antwort beeinflusst: App und Kern (web/*.js, web/core/) und Harness.
function codeHash() {
	const files = [
		...readdirSync(WEB).filter((f) => f.endsWith(".js")).map((f) => join(WEB, f)),
		...readdirSync(join(WEB, "core")).map((f) => join(WEB, "core", f)),
		join(here, "harness.js"),
	].sort();
	const h = createHash("sha256");
	for (const f of files) h.update(basename(f)).update(readFileSync(f));
	return h.digest("hex");
}
// Nur was die Antworten ändert – nicht die Prüfungen (die laufen bei jedem Bericht neu).
function jobKey(base, entry, s) {
	return sha(JSON.stringify({
		v: 1, ...base, model: entry.id, provider: entry.provider, mode: entry.mode, tools: entry.tools,
		scenario: { pdf: s.pdf || null, workspacePage: s.workspacePage || null, turns: s.turns.map((t) => ({ text: t.text, answers: t.answers || null, attachPdf: !!t.attachPdf })) },
	})).slice(0, 24);
}
const cacheFile = (key) => join(CACHE_DIR, key + ".json");
function cacheGet(key) {
	if (!USE_CACHE) return [];
	try { return JSON.parse(readFileSync(cacheFile(key), "utf8")).repeats || []; } catch { return []; }
}
function cachePut(key, label, recs) {
	mkdirSync(CACHE_DIR, { recursive: true });
	let data = { key, label, repeats: [] };
	try { data = JSON.parse(readFileSync(cacheFile(key), "utf8")); } catch {}
	data.repeats.push({ at: new Date().toISOString(), recs });
	writeFileSync(cacheFile(key), JSON.stringify(data));
}
// Rate-Limit, Zeitüberschreitung, Serverfehler: sagt nichts über Werkzeuge oder Modell → nicht cachen.
const INFRA = /\b429\b|rate.?limit|quota|resource.?exhausted|timeout|zeitüberschreitung|\b50[0-4]\b|getrennt|failed to fetch|networkerror/i;
const infraError = (rec) => rec.state === "error" && INFRA.test(String(rec.error || ""));

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
		const kind = c.tool ? "tool" : c.re ? "re" : "fn";
		if (c.needsContent && !content) return { label: c.label, kind, pass: false };
		let pass = false;
		try {
			if (c.re) pass = c.re.test(rec.plain);
			else if (c.tool) pass = rec.tools.some((t) => (t.group === c.tool || (c.tool === "read" && t.group === "heft") || t.name === c.tool) && !t.error);
			else if (c.fn) pass = !!c.fn(rec, ctx);
		} catch { pass = false; }
		return { label: c.label, kind, pass };
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
// Woran eine Runde Punkte verloren hat – damit man den größten Fehlertopf angeht statt Einzelfälle.
const FAILURE_KINDS = ["Infrastruktur (Rate-Limit, Timeout, Server)", "Schrittgrenze / Abbruch", "Werkzeug falsch aufgerufen",
	"Suche/Liste ohne Treffer", "nötiges Werkzeug nicht benutzt", "Antwort inhaltlich falsch"];
function failureKind(x) {
	if (x.passed >= x.total) return null;
	const [infra, abort, toolErr, empty, noTool, content] = FAILURE_KINDS;
	if (x.state === "error" && INFRA.test(String(x.error || ""))) return infra;
	if (x.state !== "done" || /Abgebrochen/.test(x.answer || "")) return abort;
	if ((x.tools || []).some((t) => t.error)) return toolErr;
	if ((x.tools || []).some((t) => t.empty)) return empty;
	if ((x.checks || []).some((c) => !c.pass && c.kind === "tool")) return noTool;
	return content;
}

// ---------- Ein Gesprächsschritt in der Spielwiese ----------
class LostHarness extends Error {}
const guard = (body) => `if (!globalThis.__aiBench) return { lost: true }; ${body}`;
async function runTurn(sb, spec, progress) {
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
		if (progress && line !== last && Date.now() - t0 > 10000) { process.stdout.write("\r" + line.slice(0, 110).padEnd(110)); last = line; }
		if (Date.now() - t0 > TURN_LIMIT_MS) await evalIn(sb, `return globalThis.__aiBench.cancel(${JSON.stringify(id)});`);
	}
}

// Eine Runde ins Ergebnis übernehmen – gleich, ob frisch gemessen oder aus dem Cache.
function addTurn(sc, t, i, rec, prev) {
	normalize(rec);
	const checks = rec.state === "done" ? grade(t, rec, { prev }) : (t.checks || []).map((c) => ({ label: c.label, kind: c.tool ? "tool" : c.re ? "re" : "fn", pass: false }));
	prev.push(rec);
	const met = metrics(rec);
	const passed = checks.filter((c) => c.pass).length;
	const turn = { i: i + 1, question: t.text, state: rec.state, error: rec.error, wallMs: rec.wallMs, ...met, checks, passed, total: checks.length,
		answer: rec.text, tools: rec.tools, changes: rec.changes, asks: rec.asks, rag: rec.rag, summary: rec.summary, items: rec.items, requestsRaw: rec.requests, config: rec.config };
	turn.failure = failureKind(turn);
	sc.turns.push(turn);
	return { turn, met };
}

async function main() {
	mkdirSync(OUT_DIR, { recursive: true });
	const hub = startBridgeHub();
	const children = [];
	const cleanup = () => { for (const c of children) try { c?.kill(); } catch {} };
	process.on("exit", cleanup);
	process.on("SIGINT", () => { cleanup(); process.exit(130); });
	// Spielwiese starten (Server + headless Browser) und auf die Verbindung warten.
	async function startSandbox(k) {
		const port = SANDBOX_PORT + k;
		children.push(await serveSandbox(port));
		const sb = hub.handle(port);
		if (!flag("no-open")) {
			const browser = flag("visible") ? null : launchHeadless(sb.url, port);
			if (browser) children.push(browser); else openBrowser(sb.url);
		}
		log(`${sb.name}: ${sb.url} – warte auf Verbindung …`);
		await sb.ready(120000);
		const state = await sandboxState(sb);
		if (!state.sandbox) throw new Error(`Die Seite auf Port ${port} ist keine Spielwiese (Ursprung schon benutzt?).`);
		return { sb, state };
	}
	const first = await startSandbox(0);
	const sb0 = first.sb;

	const cloud = QUICK && arg("cloud", false) === false ? "gemini-3.5-flash-lite" : arg("cloud", false);
	const cloudList = cloud === false ? [] : (cloud === true ? CLOUD_DEFAULT : String(cloud).split(","))
		.map((s) => { const [model, provider] = s.split(":"); return { id: model, provider: provider || (/^impala/.test(model) ? "cloudflare" : "google") }; });
	const fresh = !first.state.copiedAt || first.state.dirty || flag("fresh");
	if (first.state.dirty) log("Spielwiese enthält Änderungen eines abgebrochenen Laufs – kopiere neu.");
	else if (!fresh) log("Spielwiese enthält die Kopie vom", first.state.copiedAt, "(neu kopieren: --fresh)");
	// Die echte App braucht es nur für eine neue Datenkopie, Impala AI oder Google ohne GEMINI_API_KEY.
	const wantsReal = fresh || cloudList.some((c) => c.provider === "cloudflare") || (cloudList.some((c) => c.provider === "google") && !ENV_GOOGLE);
	let real = null, cloudflare = null, realProviders = null;
	if (wantsReal) {
		try { real = await connectReal(); }
		catch (e) { if (fresh) throw e; log("Echte App nicht erreichbar:", e?.message || e, "– Cloud-Modelle ohne Schlüssel werden übersprungen."); }
	}
	if (real) {
		if (fresh) await fillSandbox(real, sb0); // lädt die Spielwiese danach neu
		// Cloud-Zugänge aus der echten App nur im Speicher halten (DB.exportAll entfernt API-Schlüssel).
		if (cloudList.length) realProviders = await evalIn(real, `return (S.settings.aiProviders || []).map((p) => ({ ...p }));`);
		if (cloudList.some((c) => c.provider === "cloudflare")) {
			cloudflare = await evalIn(real, `const { CORE } = await import("./rust-core.js"); const st = CLOUDFLARE_SYNC.status(); if (!st.syncKey) return null; const { userId, authToken } = CORE.syncAuth(st.syncKey); return { userId, authToken, fallbackBase: st.url };`);
			if (!cloudflare) log("Impala AI übersprungen: Die echte App hat keinen Sync-Schlüssel.");
		}
		real.close();
	}
	// Ohne neue Kopie trotzdem neu laden: Die Spielwiese soll den aktuellen Stand von web/ (und
	// des Kerns in web/core/) ausführen, nicht den vom letzten Lauf.
	if (!fresh) await sb0.reload();
	const copiedAt = (await sandboxState(sb0)).copiedAt;
	let cloudProviders = null;
	if (cloudList.length) {
		cloudProviders = realProviders || await evalIn(sb0, `return (S.settings.aiProviders || []).map((p) => ({ ...p }));`) || [];
		if (ENV_GOOGLE) {
			const gp = cloudProviders.find((p) => p.id === "google");
			if (!gp) cloudProviders.push({ ...GOOGLE_PRESET, key: ENV_GOOGLE });
			else if (!String(gp.key || "").trim()) gp.key = ENV_GOOGLE;
		}
	}
	log("Harness bereit:", JSON.stringify(await loadHarness(sb0)));

	const wanted = arg("models", null);
	const local = flag("no-local") || (QUICK && !wanted) ? [] : (await lmsModels()).filter((m) => m.type === "llm" || m.type === "vlm")
		.filter((m) => (wanted ? String(wanted).split(",").includes(m.id) : (m.capabilities || []).includes("tool_use") && sizeB(m.id) <= LOCAL_MAX_B))
		.sort((a, b) => sizeB(a.id) - sizeB(b.id));
	const hasCloudAuth = (c) => {
		if (c.provider === "cloudflare") return !!cloudflare;
		const p = (cloudProviders || []).find((x) => x.id === c.provider);
		if (p?.key && String(p.key).trim()) return true;
		log(`${c.id} (${c.provider}) übersprungen: kein API-Schlüssel (GEMINI_API_KEY setzen oder in der echten App eintragen).`);
		return false;
	};
	const models = [...local.map((m) => ({ ...m, provider: "local" })),
		...cloudList.filter(hasCloudAuth).map((c) => ({ id: c.id, provider: c.provider, type: "cloud", arch: c.provider, quantization: "–" }))];
	const scen = arg("scenarios", null);
	const scenarios = SCENARIOS.filter((s) => !scen || String(scen).split(",").includes(s.id));
	if (!models.length) throw new Error("Keine Modelle (LM Studio offen? --cloud? GEMINI_API_KEY?).");

	const results = { startedAt: new Date().toISOString(), ctx: CTX, lms: LMS, modes: MODES, sandbox: true, now: BENCH_NOW, repeat: REPEAT, copiedAt, runs: [] };
	const stamp = results.startedAt.replace(/[:.]/g, "-").slice(0, 19);
	const compareFile = arg("compare", null);
	const previous = compareFile ? resolve(String(compareFile)) : latestResult(stamp);
	if (previous) results.compare = basename(previous);
	const save = () => {
		for (const e of results.runs) e.scenarios.sort((a, b) => a.order - b.order || a.repeat - b.repeat);
		writeFileSync(join(OUT_DIR, stamp + ".json"), JSON.stringify(results, null, 2));
		writeFileSync(join(OUT_DIR, stamp + ".md"), report(results, previous));
	};

	// Aufträge: je Modell × Modus × Szenario × Durchgang. Was im Cache liegt, wird nur neu bewertet.
	const base = { code: codeHash(), copy: copiedAt, now: BENCH_NOW, ctx: CTX, think: THINK };
	const jobs = [];
	let fromCache = 0;
	for (const m of models) {
		for (const spec of MODES) {
			// „app/flat“ = app-Profil mit flachen Werkzeugen (zum Vergleich mit app = inspect/change).
			const [mode, tools] = spec.split("/");
			const entry = { id: m.id, provider: m.provider, mode, tools: mode === "app" ? tools || APP_TOOLS : "flat", type: m.type, arch: m.arch, quant: m.quantization, loadMs: null, scenarios: [] };
			results.runs.push(entry);
			for (const [order, s] of scenarios.entries()) {
				const key = jobKey(base, entry, s);
				const cached = cacheGet(key).slice(0, REPEAT);
				for (const [r, c] of cached.entries()) {
					const sc = { id: s.id, name: s.name, order, repeat: r + 1, cached: c.at, turns: [] };
					const prev = [];
					s.turns.forEach((t, i) => c.recs[i] && addTurn(sc, t, i, c.recs[i], prev));
					entry.scenarios.push(sc);
					fromCache++;
				}
				for (let r = cached.length; r < REPEAT; r++) jobs.push({ m, entry, s, order, repeat: r + 1, key });
			}
		}
	}
	log(`Modelle: ${models.map((m) => m.id).join(", ")} | Modi: ${MODES.join(", ")} | Szenarien: ${scenarios.map((s) => s.id).join(", ")} | ${REPEAT}× | Uhrzeit ${BENCH_NOW}`);
	log(`${fromCache} Durchgang/Durchgänge aus dem Cache, ${jobs.length} zu messen${USE_CACHE ? "" : " (Cache aus)"}.`);
	save();

	// Weitere Spielwiesen nur, wenn es parallele (Cloud-)Aufträge gibt; gleiche Datenkopie wie Nr. 1.
	const workers = [sb0];
	const cloudJobs = jobs.filter((j) => j.m.provider !== "local");
	const extra = Math.min(PARALLEL, cloudJobs.length) - 1;
	for (let k = 1; k <= extra; k++) {
		const { sb, state } = await startSandbox(k);
		if (state.copiedAt !== copiedAt || state.dirty) await fillSandbox(sb0, sb, copiedAt);
		else await sb.reload();
		await loadHarness(sb);
		workers.push(sb);
	}

	const pdfCache = new Map();
	async function pdfFor(sb, s) {
		if (!s.pdf) return null;
		const key = JSON.stringify(s.pdf);
		if (!pdfCache.has(key)) {
			if (s.pdf.file) {
				try { pdfCache.set(key, readFileSync(join(here, s.pdf.file), "utf8")); } catch { pdfCache.set(key, null); }
			} else pdfCache.set(key, await evalIn(sb, `return globalThis.__aiBench.heftText(${JSON.stringify(s.pdf.heft)}, ${s.pdf.from}, ${s.pdf.to});`, 60000));
		}
		const content = pdfCache.get(key);
		return content == null ? undefined : { name: s.pdf.name, content };
	}
	async function runJob(sb, job) {
		const { entry, s, order, repeat } = job;
		const tag = `${entry.id.replace("ternary-bonsai-2-", "")} ${label(entry)} ${s.id}${REPEAT > 1 ? ` #${repeat}` : ""}`;
		const convId = `${entry.id}::${label(entry)}::${s.id}::${repeat}`;
		const reset = await evalIn(sb, guard(`return await globalThis.__aiBench.reset(${JSON.stringify(convId)});`), 60000);
		if (reset?.lost) throw new LostHarness();
		if (reset.failed) log(`   Achtung (${sb.name}): ${reset.failed} Änderung(en) ließen sich nicht zurücknehmen – bei Bedarf mit --fresh neu kopieren.`);
		const pdfFile = await pdfFor(sb, s);
		const sc = { id: s.id, name: s.name, order, repeat, turns: [] };
		if (pdfFile === undefined) {
			entry.scenarios.push({ ...sc, skipped: `Textdatei ${s.pdf.file} fehlt (siehe scenarios.mjs)` });
			return log(`-- ${tag}: übersprungen, ${s.pdf.file} fehlt`);
		}
		sc.pdfChars = pdfFile?.content?.length || 0;
		entry.scenarios.push(sc);
		const prev = [], recs = [];
		for (const [i, t] of s.turns.entries()) {
			const spec = { convId, profile: entry.mode, model: entry.id, providerId: entry.provider,
				providers: entry.provider !== "local" ? cloudProviders : null,
				cloudflare: entry.provider === "cloudflare" ? cloudflare : null,
				text: t.text, workspacePage: s.workspacePage || null, answers: t.answers || null, now: BENCH_NOW,
				thinking: THINK, pdfFile: t.attachPdf ? pdfFile : null, appTools: entry.tools };
			const rec = await runTurn(sb, spec, workers.length === 1);
			if (workers.length === 1) process.stdout.write("\r".padEnd(112) + "\r");
			recs.push(structuredClone(rec));
			const { turn, met } = addTurn(sc, t, i, rec, prev);
			log(`   ${tag} R${i + 1}: ${turn.passed}/${turn.total} ✓ | ${(rec.wallMs / 1000).toFixed(1)} s | ${met.promptTokens + met.completionTokens} tk | Tools ${rec.tools.map((x) => x.name + (x.error ? "✗" : "")).join(",") || "–"}${rec.error ? " | FEHLER " + rec.error.slice(0, 120) : ""}`);
			save();
		}
		if (!recs.some(infraError)) cachePut(job.key, tag, recs);
	}
	async function runWithRetry(sb, job) {
		for (let attempt = 1; ; attempt++) {
			try { return await runJob(sb, job); } catch (e) {
				if (!(e instanceof LostHarness) || attempt >= 3) throw e;
				job.entry.scenarios = job.entry.scenarios.filter((x) => !(x.order === job.order && x.repeat === job.repeat));
				log(`   ${sb.name} neu geladen – spiele Harness neu ein und wiederhole ${job.s.id}`);
				await sb.reconnect();
				await loadHarness(sb);
			}
		}
	}
	async function pool(list, ws) {
		let next = 0;
		await Promise.all(ws.map(async (sb) => { while (next < list.length) await runWithRetry(sb, list[next++]); }));
	}
	// Lokale Modelle nacheinander auf einer Spielwiese (eine GPU), Cloud-Modelle parallel.
	for (const m of models.filter((x) => x.provider === "local")) {
		const mine = jobs.filter((j) => j.m === m);
		if (!mine.length) continue;
		const loadMs = flag("no-load") ? null : lmsLoad(m.id);
		for (const e of results.runs) if (e.id === m.id) e.loadMs = loadMs;
		log(`== ${m.id}${loadMs ? ` (geladen in ${(loadMs / 1000).toFixed(1)} s)` : ""}: ${mine.length} Durchgang/Durchgänge`);
		await pool(mine, [sb0]);
	}
	if (cloudJobs.length) {
		log(`== Cloud: ${cloudJobs.length} Durchgang/Durchgänge auf ${workers.length} Spielwiese(n)`);
		await pool(cloudJobs, workers);
	}
	for (const sb of workers) await evalIn(sb, guard(`return await globalThis.__aiBench.reset();`), 60000).catch(() => {});
	results.finishedAt = new Date().toISOString();
	save();
	if (local.length) try { execFileSync("lms", ["unload", "--all"], { stdio: "ignore" }); } catch {}
	hub.close();
	cleanup();
	log("Bericht:", join(OUT_DIR, stamp + ".md"));
}

// Letzter früherer Lauf als Vergleich („vorher“).
function latestResult(except) {
	try {
		const files = readdirSync(OUT_DIR).filter((f) => /^\d{4}-.*\.json$/.test(f) && !f.startsWith(except)).sort();
		return files.length ? join(OUT_DIR, files.at(-1)) : null;
	} catch { return null; }
}

// ---------- Bericht ----------
const label = (m) => (m.mode === "app" && m.tools && m.tools !== "flat" ? `app/${m.tools}` : m.mode);
const kTok = (n) => (n >= 10000 ? Math.round(n / 1000) + " k" : n >= 1000 ? (n / 1000).toFixed(1) + " k" : String(Math.round(n)));
const sum = (xs, k) => xs.reduce((n, x) => n + (x[k] || 0), 0);
const short = (id) => id.replace("ternary-bonsai-2-", "");
// Durchgänge eines Laufs: je Durchgang alle Runden aller Szenarien.
function repeatsOf(m) {
	const by = new Map();
	for (const s of m.scenarios) if (s.turns) { const r = s.repeat || 1; by.set(r, (by.get(r) || []).concat(s.turns)); }
	return [...by.values()];
}
// Punkte über die Durchgänge: Mittel in %, Spanne (min–max) und die Rohwerte.
function scoreOf(m) {
	const reps = repeatsOf(m).map((t) => ({ p: sum(t, "passed"), t: sum(t, "total") }));
	if (!reps.length) return null;
	const pcts = reps.map((r) => (r.t ? (100 * r.p) / r.t : 0));
	const mean = pcts.reduce((a, b) => a + b, 0) / pcts.length;
	return { n: reps.length, mean, min: Math.min(...pcts), max: Math.max(...pcts), p: reps.reduce((a, r) => a + r.p, 0) / reps.length, t: reps[0].t };
}
const fmtScore = (s) => (!s ? "–" : `${s.p.toFixed(s.n > 1 ? 1 : 0)}/${s.t} (${Math.round(s.mean)} %)${s.n > 1 ? ` · ${Math.round(s.min)}–${Math.round(s.max)} %` : ""}`);
function report(res, previousFile = null) {
	const runs = res.runs || (res.models || []).map((m) => ({ ...m, mode: "app" })); // ältere Ergebnisdateien
	let prev = null;
	try { if (previousFile) prev = JSON.parse(readFileSync(previousFile, "utf8")); } catch {}
	const prevScore = (m) => { const p = (prev?.runs || []).find((x) => x.id === m.id && label(x) === label(m)); return p ? scoreOf(p) : null; };
	const L = [];
	const fmt = (ms) => (ms == null ? "–" : (ms / 1000).toFixed(1) + " s");
	const avg = (xs, k) => { const v = xs.map((x) => x[k]).filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
	L.push(`# KI-Benchmark`, "", `Start ${res.startedAt} · Kontext ${res.ctx} Token · ${res.sandbox ? "Spielwiese (echtes Schreiben auf einer Datenkopie)" : "Trockenlauf"}${res.now ? ` · feste Uhrzeit ${res.now}` : ""}${res.repeat > 1 ? ` · ${res.repeat} Durchgänge` : ""}`, "");
	L.push("**app** = KI-Chat in Impala (geöffnete Seite, Notizsuche, eigene Anweisungen) · **mcp** = externer Assistent (nichts automatisch mitgeschickt, flache Werkzeuge). Beide über den Rust-Agenten.", "");
	L.push("Punkte = Mittel über die Durchgänge, dahinter die Spanne: Ein Unterschied innerhalb der Spanne ist Zufall. Zeit und Token = je Durchgang. Prompt-Cache = Anteil der Prompt-Token, die der Anbieter aus seinem Cache bedient hat (nur Cloud meldet das).", "");
	if (prev) L.push(`Vorher = ${res.compare || "voriger Lauf"}.`, "");
	L.push("| Modell | Modus | Punkte | vorher | Zeit | Token gesamt | Prompt | Antwort (Denken) | Prompt-Cache | Token je Punkt | Werkzeug-Anteil | Anfragen | Tool-Aufrufe (Fehler) | Abbrüche | aus Cache | Ø Decode tk/s |",
		"|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
	for (const m of runs) {
		const turns = m.scenarios.flatMap((s) => s.turns || []);
		const n = Math.max(1, repeatsOf(m).length);
		const p = sum(turns, "promptTokens"), c = sum(turns, "completionTokens"), pts = sum(turns, "passed");
		const cachedRuns = m.scenarios.filter((s) => s.cached).length;
		L.push(`| ${m.id} | ${label(m)} | ${fmtScore(scoreOf(m))} | ${prev ? fmtScore(prevScore(m)) : "–"} | ${fmt(sum(turns, "wallMs") / n)} | **${kTok((p + c) / n)}** | ${kTok(p / n)} | ${kTok(c / n)} (${kTok(sum(turns, "reasoningTokens") / n)}) | ${p && sum(turns, "cachedTokens") ? Math.round((100 * sum(turns, "cachedTokens")) / p) + " %" : "–"} | ${pts ? kTok(Math.round((p + c) / pts)) : "–"} | ${p ? Math.round((100 * sum(turns, "toolDefTokens")) / p) + " %" : "–"} | ${Math.round(sum(turns, "requests") / n)} | ${Math.round(sum(turns, "toolCalls") / n)} (${Math.round(sum(turns, "toolErrors") / n)}) | ${turns.filter((x) => x.state !== "done" || /Abgebrochen/.test(x.answer || "")).length} | ${cachedRuns ? `${cachedRuns}/${m.scenarios.length}` : "–"} | ${avg(turns, "decodeTps")?.toFixed(1) ?? "–"} |`);
	}
	const ids = [...new Set(runs.flatMap((m) => m.scenarios.map((s) => s.id)))];
	L.push("", "Je Szenario: Punkte (Ø) · Zeit · Token je Durchgang", "", "| Szenario | " + runs.map((m) => `${short(m.id)} ${label(m)}`).join(" | ") + " |", "|---|" + runs.map(() => "---").join("|") + "|");
	for (const id of ids) {
		const name = runs.flatMap((m) => m.scenarios).find((s) => s.id === id)?.name || id;
		L.push(`| ${name} | ` + runs.map((m) => {
			const list = m.scenarios.filter((x) => x.id === id && x.turns);
			if (!list.length) return "–";
			const t = list.flatMap((x) => x.turns), n = list.length;
			const pts = list.map((x) => sum(x.turns, "passed"));
			return `${(sum(t, "passed") / n).toFixed(n > 1 ? 1 : 0)}/${sum(list[0].turns, "total")}${n > 1 ? ` (${Math.min(...pts)}–${Math.max(...pts)})` : ""} · ${fmt(sum(t, "wallMs") / n)} · ${kTok((sum(t, "promptTokens") + sum(t, "completionTokens")) / n)}`;
		}).join(" | ") + " |");
	}
	// Fehlerarten: verlorene Punkte je Durchgang, nach Ursache.
	L.push("", "Woran Punkte verloren gingen (verlorene Punkte je Durchgang)", "", "| Ursache | " + runs.map((m) => `${short(m.id)} ${label(m)}`).join(" | ") + " |", "|---|" + runs.map(() => "---").join("|") + "|");
	for (const kind of FAILURE_KINDS) {
		const row = runs.map((m) => {
			const n = Math.max(1, repeatsOf(m).length);
			const lost = m.scenarios.flatMap((s) => s.turns || []).filter((x) => (x.failure ?? failureKind(x)) === kind).reduce((a, x) => a + (x.total - x.passed), 0) / n;
			return lost ? lost.toFixed(n > 1 ? 1 : 0) : "–";
		});
		if (row.some((v) => v !== "–")) L.push(`| ${kind} | ${row.join(" | ")} |`);
	}
	L.push("");
	for (const m of runs) {
		L.push(`## ${m.id} · ${label(m)}`, "", `${m.type}, ${m.arch}, ${m.quant}${m.loadMs ? `, geladen in ${fmt(m.loadMs)}` : ""}`, "");
		for (const s of m.scenarios) {
			const rep = (res.repeat > 1 || s.repeat > 1) ? ` · Durchgang ${s.repeat}` : "";
			if (s.skipped) { L.push(`### ${s.name}${rep} — übersprungen (${s.skipped})`, ""); continue; }
			L.push(`### ${s.name}${rep} — ${sum(s.turns, "passed")}/${sum(s.turns, "total")}${s.pdfChars ? ` (PDF ${s.pdfChars} Zeichen)` : ""}${s.cached ? ` (aus Cache vom ${s.cached.slice(0, 16).replace("T", " ")})` : ""}`, "");
			L.push("| Runde | Punkte | Zeit | TTFT | tk/s | Prompt-Tk | max. Prompt | Antwort-Tk | Anfragen | Tools | Ursache |", "|---|---|---|---|---|---|---|---|---|---|---|");
			for (const x of s.turns) L.push(`| ${x.i} | ${x.passed}/${x.total} | ${fmt(x.wallMs)} | ${fmt(x.ttftMs)} | ${x.decodeTps ?? "–"} | ${x.promptTokens} | ${x.maxPromptTokens} | ${x.completionTokens} | ${x.requests} | ${x.tools.map((t) => t.name.replace("impala_", "") + (t.error ? "✗" : t.empty ? "∅" : "")).join(", ") || "–"} | ${x.failure ?? failureKind(x) ?? "–"} |`);
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
	const cmp = arg("compare", null);
	writeFileSync(file.replace(/\.json$/, ".md"), report(JSON.parse(readFileSync(file, "utf8")), cmp ? resolve(String(cmp)) : null));
	log("Bericht neu erzeugt:", file.replace(/\.json$/, ".md"));
} else main().then(() => process.exit(0), (e) => { console.error("Abbruch:", e?.message || e); process.exit(1); });
