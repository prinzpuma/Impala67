#!/usr/bin/env node
// generate_trajectories.mjs — Erzeugt echte Multi-Turn-Trainingsdaten (Teacher Rejection Sampling)
// in der isolierten Spielwiese über den echten Rust-Agenten (CORE.AiRun) mit flachen Werkzeugen.
//
// Aufruf:
//   node training/generate_trajectories.mjs
//   node training/generate_trajectories.mjs --model ternary-bonsai-2-27b --only flat-list-dgl-vl,flat-cards-list-and-create
//   node training/generate_trajectories.mjs --provider google --model gemini-3.5-flash-lite

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket, WebSocketServer } from "ws";
import { TASKS } from "./tasks_flat.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const arg = (name, fallback) => {
	const i = process.argv.indexOf("--" + name);
	return i < 0 ? fallback : process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : true;
};
const flag = (name) => arg(name, false) === true;

const LMS = String(arg("lms", "http://127.0.0.1:1234"));
const MODEL = String(arg("model", "ternary-bonsai-2-27b"));
const PROVIDER = String(arg("provider", "local"));
const API_BASE = arg("api-base", null);
const SEED_PATH = arg("seed", null);
const CTX = Number(arg("ctx", 16384));
const SANDBOX_PORT = Number(arg("sandbox-port", 8019));
const BRIDGE_PORT = Number(arg("bridge-port", 8767));
const WS_PORT = Number(process.env.IMPALA_WS_PORT || 8765);
const REPEAT = Math.max(1, Number(arg("repeat", 1)));
const TURN_LIMIT_MS = Number(arg("turn-timeout", 10 * 60000));
const NOW = String(arg("now", "2026-11-20T17:30"));
const DATA_DIR = join(here, "data");
const PROFILE_DIR = join(root, "tools/ai-bench/results", `.chrome-${SANDBOX_PORT}`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toLocaleTimeString("de-DE"), ...a);

function connectReal() {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(`ws://127.0.0.1:${WS_PORT}/relay`);
		const pending = new Map();
		let seq = 1;
		const timer = setTimeout(() => reject(new Error(`Kein MCP-Server auf Port ${WS_PORT}`)), 3000);
		ws.on("error", reject);
		ws.on("message", (raw) => {
			let msg; try { msg = JSON.parse(raw); } catch { return; }
			if (msg.relayAck) {
				clearTimeout(timer);
				resolve({
					name: "echte App",
					call: (tool, args, timeoutMs = 30000) => new Promise((res) => {
						const id = seq++;
						const t = setTimeout(() => { pending.delete(id); res({ error: "Relay-Timeout" }); }, timeoutMs + 10000);
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
			for (const [id, res] of s.pending) { s.pending.delete(id); res({ error: "Spielwiese getrennt" }); }
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
				const t = setTimeout(() => rej(new Error(`Spielwiese hat sich nicht verbunden (${url})`)), ms);
				s.waiters.push(() => { clearTimeout(t); res(); });
			});
			return {
				port, url, name: `Spielwiese ${port}`, ready,
				async call(tool, args, timeoutMs = 30000) {
					await ready(60000);
					return new Promise((res) => {
						const callId = seq++;
						const t = setTimeout(() => { s.pending.delete(callId); res({ error: "Timeout" }); }, timeoutMs + 5000);
						s.pending.set(callId, (v) => { clearTimeout(t); res(v); });
						s.current.send(JSON.stringify({ callId, tool, args: { ...args, timeoutMs } }));
					});
				},
				async reload(ms = 120000) {
					const old = s.current;
					await evalIn(this, `setTimeout(() => location.reload(), 200); return true;`);
					const t0 = Date.now();
					while (s.current === old || s.current?.readyState !== 1) {
						if (Date.now() - t0 > ms) throw new Error(`Spielwiese ${port} meldet sich nach Neuladen nicht.`);
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
	const child = spawn(process.execPath, [join(root, "tools/serve.mjs"), String(port)], { stdio: "ignore" });
	for (let i = 0; i < 50; i++) { await sleep(100); try { await fetch(`http://localhost:${port}/index.html`); return child; } catch {} }
	throw new Error("Spielwiesen-Server startet nicht.");
}

function findChrome() {
	const list = [
		"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
		"C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
		join(process.env.LOCALAPPDATA || "", "Google\\Chrome\\Application\\chrome.exe"),
		"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
		"C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
	];
	return list.find((p) => p && existsSync(p)) || null;
}

function launchHeadless(url) {
	const bin = findChrome();
	if (!bin) throw new Error("Kein Chrome/Edge gefunden.");
	mkdirSync(PROFILE_DIR, { recursive: true });
	return spawn(bin, [
		"--headless=new", `--user-data-dir=${PROFILE_DIR}`,
		"--no-first-run", "--no-default-browser-check", "--disable-gpu",
		"--disable-background-timer-throttling", "--disable-renderer-backgrounding",
		url,
	], { stdio: "ignore" });
}

// Daten der echten App als JSON (ohne Sync-Zugangsdaten).
async function exportJson(source) {
	const total = await evalIn(source, `
		const { DB } = await import("./db.js");
		const snap = JSON.parse(await DB.exportAll({ includeBlobs: false }));
		for (const ev of snap.events) {
			if (ev.type !== "settingsSet" || !ev.payload) continue;
			for (const k of Object.keys(ev.payload)) if (/^(cf|drive|notion)/i.test(k)) delete ev.payload[k];
		}
		globalThis.__benchCopy = JSON.stringify(snap);
		return globalThis.__benchCopy.length;`, 300000);
	const parts = [];
	try {
		for (let at = 0; at < total; at += 8e6) parts.push(await evalIn(source, `return globalThis.__benchCopy.slice(${at}, ${at + 8e6});`, 120000));
	} finally { await evalIn(source, `delete globalThis.__benchCopy; return true;`).catch(() => {}); }
	return parts.join("");
}

// JSON-Export in die Spielwiese laden (ersetzt deren Daten).
async function loadSandbox(json, sb) {
	log(`Lade Daten (${(json.length / 1e6).toFixed(1)} MB) in die Spielwiese …`);
	const CHUNK = 8e6;
	await evalIn(sb, `globalThis.__benchCopy = []; return true;`);
	for (let at = 0; at < json.length; at += CHUNK) {
		await evalIn(sb, `globalThis.__benchCopy.push(${JSON.stringify(json.slice(at, at + CHUNK))}); return true;`, 120000);
	}
	const out = await evalIn(sb, `
		const { DB } = await import("./db.js");
		const json = globalThis.__benchCopy.join(""); delete globalThis.__benchCopy;
		const db = await new Promise((res, rej) => { const r = indexedDB.open("impala67"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
		await new Promise((res, rej) => { const t = db.transaction(["events", "blobs", "vecs"], "readwrite"); for (const s of ["events", "blobs", "vecs"]) t.objectStore(s).clear(); t.oncomplete = res; t.onerror = () => rej(t.error); });
		db.close();
		const { added } = await DB.importAll(json);
		localStorage.setItem("impala67SandboxCopy", new Date().toISOString());
		localStorage.removeItem("impala67SandboxDirty");
		return added;`, 600000);
	log(`   ${out} Events übernommen, lade Spielwiese neu …`);
	await sb.reload();
}

// Einmal aus der echten App exportieren (mehrere Shards dürfen nicht gleichzeitig dort kopieren).
async function exportSeed(path) {
	const real = await connectReal();
	try {
		const json = await exportJson(real);
		mkdirSync(dirname(resolve(path)), { recursive: true });
		writeFileSync(resolve(path), json, "utf8");
		log(`Seed geschrieben: ${path} (${(json.length / 1e6).toFixed(1)} MB)`);
	} finally { real.close(); }
}

async function ensureLocalModelLoaded(modelId) {
	if (PROVIDER !== "local") return;
	try {
		const data = await (await fetch(`${LMS}/api/v0/models`)).json();
		const loaded = (data.data || []).find((m) => m.id === modelId && m.state === "loaded");
		if (loaded && (loaded.loaded_context_length || 0) >= CTX) return;
	} catch {}
	log(`Lade ${modelId} in LM Studio (Kontext ${CTX}, parallel=1, gpu=max) …`);
	try { execFileSync("lms", ["unload", "--all"], { stdio: "ignore" }); } catch {}
	execFileSync("lms", ["load", modelId, "-c", String(CTX), "--parallel", "1", "--gpu", "max", "-y"], { stdio: "ignore", timeout: 10 * 60000 });
}

function cleanMessages(messages) {
	const hasImage = messages.some((m) => Array.isArray(m.content) && m.content.some((p) => p.type === "image_url"));
	if (hasImage) return null;
	return messages.map((m) => {
		const out = { role: m.role, content: m.content ?? "" };
		if (m.tool_call_id) out.tool_call_id = m.tool_call_id;
		if (m.reasoning_content) out.reasoning_content = m.reasoning_content;
		if (Array.isArray(m.tool_calls) && m.tool_calls.length) out.tool_calls = m.tool_calls;
		return out;
	});
}

async function runTurn(sb, spec, tag) {
	const id = await evalIn(sb, `return globalThis.__trajGen.start(${JSON.stringify(spec)});`);
	const t0 = Date.now();
	let lastLog = 0;
	for (;;) {
		await sleep(1500);
		let p;
		try { p = await evalIn(sb, `return globalThis.__trajGen.poll(${JSON.stringify(id)});`, 20000); }
		catch (e) { if (/timeout/i.test(String(e?.message))) continue; throw e; }
		if (p.state === "missing") throw new Error("Aufnahme verloren.");
		if (p.state !== "running") return p;
		if (Date.now() - lastLog > 10000) {
			log(`   … ${tag}: ${Math.round(p.ms / 1000)}s, ${p.requests} Req, ${p.chunks || 0} Chunks, Tools: ${(p.tools || []).join(",") || "–"}`);
			lastLog = Date.now();
		}
		if (Date.now() - t0 > TURN_LIMIT_MS) await evalIn(sb, `return globalThis.__trajGen.cancel(${JSON.stringify(id)});`);
	}
}

async function main() {
	mkdirSync(DATA_DIR, { recursive: true });
	if (arg("export-seed", null)) return exportSeed(String(arg("export-seed")));
	await ensureLocalModelLoaded(MODEL);

	const hub = startBridgeHub();
	const children = [];
	const cleanup = () => { for (const c of children) try { c?.kill(); } catch {} hub.close(); };
	process.on("exit", cleanup);
	process.on("SIGINT", () => { cleanup(); process.exit(130); });

	children.push(await serveSandbox(SANDBOX_PORT));
	const sb = hub.handle(SANDBOX_PORT);
	children.push(launchHeadless(sb.url));
	log(`Warte auf Spielwiese ${sb.url} …`);
	await sb.ready(120000);

	const state = await evalIn(sb, `const { SANDBOX } = await import("./sandbox.js"); return { sandbox: SANDBOX.on, copiedAt: localStorage.getItem("impala67SandboxCopy"), dirty: !!localStorage.getItem("impala67SandboxDirty") };`);
	if (!state.sandbox) throw new Error("Keine Spielwiese aktiv.");
	if (!state.copiedAt || state.dirty || flag("fresh")) {
		if (SEED_PATH && existsSync(resolve(String(SEED_PATH)))) {
			await loadSandbox(readFileSync(resolve(String(SEED_PATH)), "utf8"), sb);
		} else {
			const real = await connectReal();
			try { await loadSandbox(await exportJson(real), sb); } finally { real.close(); }
		}
	} else {
		log(`Nutze vorhandene Spielwiesen-Kopie vom ${state.copiedAt}`);
		await sb.reload();
	}
	await evalIn(sb, readFileSync(join(here, "traj_harness.js"), "utf8"), 60000);

	const envKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
	const cloudProviders = API_BASE
		? [{ id: PROVIDER, name: `Bridge (${PROVIDER})`, base: String(API_BASE), key: process.env.TEACHER_API_KEY || "teacher" }]
		: PROVIDER === "google" && envKey
			? [{ id: "google", name: "Google Gemini", base: "https://generativelanguage.googleapis.com/v1beta/openai", key: envKey }]
			: null;

	const only = arg("only", null);
	const limit = Number(arg("limit", 0));
	let list = TASKS.filter((t) => !only || String(only).split(",").includes(t.id));
	if (limit > 0) list = list.slice(0, limit);

	const rawPath = arg("out", null) ? resolve(String(arg("out"))) : join(DATA_DIR, "trajectories_raw.jsonl");
	const byId = new Map();
	if (existsSync(rawPath) && !flag("fresh-data")) {
		for (const line of readFileSync(rawPath, "utf8").split("\n")) {
			if (!line.trim()) continue;
			try { const row = JSON.parse(line); if (row?.id) byId.set(row.id, row); } catch {}
		}
	}
	let passedCount = 0, totalCount = 0;

	for (let rep = 1; rep <= REPEAT; rep++) {
		for (const task of list) {
			const rowId = `${task.id}_r${rep}`;
			if (byId.has(rowId) && !flag("rerun")) {
				log(`↷ übersprungen (schon vorhanden): ${rowId}`);
				continue;
			}
			totalCount++;
			const convId = `${task.id}::r${rep}`;
			await evalIn(sb, `return await globalThis.__trajGen.reset(${JSON.stringify(convId)});`, 60000);
			let allOk = true;
			let lastClean = null;

			for (const [idx, turn] of task.turns.entries()) {
				const rec = await runTurn(sb, {
					convId,
					profile: task.mode || "app",
					model: MODEL,
					providerId: PROVIDER,
					providers: cloudProviders,
					text: turn.text,
					workspacePage: task.workspacePage || null,
					answers: task.answers || null,
					now: NOW,
				}, `${task.id}#${rep} R${idx + 1}`);
				const ok = rec.state === "done" && !rec.error && turn.check(rec) && !/^\(Abgebrochen|^\(Keine Antwort/.test(String(rec.text || ""));
				const toolsStr = (rec.tools || []).map((t) => t.name + (t.error ? "✗" : "")).join(",") || "–";
				log(`${ok ? "✓" : "✗"} ${task.id}#${rep} R${idx + 1} (${(rec.wallMs / 1000).toFixed(1)}s) | Tools: ${toolsStr}${rec.error ? " | ERR: " + rec.error : ""}`);
				if (!ok) {
					// Für die Fehleranalyse (Prüfung zu streng oder Antwort falsch?) festhalten.
					writeFileSync(rawPath.replace(/\.jsonl$/, "") + ".failed.jsonl", JSON.stringify({
						id: task.id, turn: idx + 1, prompt: turn.text, text: rec.text, error: rec.error || null,
						tools: (rec.tools || []).map((t) => ({ name: t.name, args: t.args, error: t.error || undefined })), changes: rec.changes,
					}) + "\n", { flag: "a" });
					allOk = false;
					break;
				}
				const cleaned = cleanMessages(rec.messages || []);
				if (!cleaned || cleaned.some((m) => m.role === "assistant" && !String(m.reasoning_content || "").trim())) {
					log(`   ↳ verworfen (Bild enthalten oder leeres reasoning_content)`);
					allOk = false;
					break;
				}
				lastClean = cleaned;
			}
			if (allOk && lastClean) {
				passedCount++;
				const row = { id: `${task.id}_r${rep}`, model: MODEL, mode: task.mode || "app", messages: lastClean };
				byId.set(row.id, row);
				const allRows = [...byId.values()];
				writeFileSync(rawPath, allRows.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
			}
		}
	}

	await evalIn(sb, `return await globalThis.__trajGen.reset();`, 60000);
	const accepted = [...byId.values()];
	if (!accepted.length) throw new Error("Keine gültigen Trajektorien erzeugt.");
	if (flag("no-split")) {
		log(`Fertig: ${passedCount}/${totalCount} bestanden → ${accepted.length} in ${rawPath}`);
		return;
	}

	// Deterministischer Split: ca. 10–15 % Validierung (mind. 1), Rest Training.
	const valCount = Math.max(1, Math.round(accepted.length * 0.15));
	const val = accepted.slice(0, valCount).map((r) => ({ messages: r.messages }));
	const train = accepted.slice(valCount).map((r) => ({ messages: r.messages }));
	writeFileSync(join(DATA_DIR, "impala_flat_train.jsonl"), train.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
	writeFileSync(join(DATA_DIR, "impala_flat_val.jsonl"), val.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
	log(`Fertig: ${passedCount}/${totalCount} bestanden → ${train.length} Train / ${val.length} Val in ${DATA_DIR}`);
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
