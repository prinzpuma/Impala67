#!/usr/bin/env node
// KI-Benchmark für lokale Modelle (LM Studio) in der echten Impala-App.
//
// Ablauf: verbindet sich als Relay mit dem laufenden MCP-Server (ws://127.0.0.1:8765/relay,
// also mit der offenen App), lädt je Modell LM Studio mit fester Kontextlänge und spielt die
// Szenarien aus scenarios.mjs als echte Mehrrunden-Gespräche durch – in zwei Modi:
//   app = Rust-Agent der App mit den App-Werkzeugen (harness.js, wie der KI-Chat in Impala)
//   mcp = eigene Agent-Schleife mit den Impala-MCP-Werkzeugen (mcp-agent.mjs, wie Antigravity)
// Nichts wird gespeichert: kein Chat, keine Einstellung, Schreib-Werkzeuge nur simuliert.
//
//   node tools/ai-bench/run.mjs [--models a,b] [--scenarios heft,orga] [--modes app,mcp]
//                               [--ctx 32768] [--no-load] [--no-think] [--lms http://localhost:1234]
//   node tools/ai-bench/run.mjs --report results/<Zeit>.json   (Bericht neu erzeugen)
//
// Ergebnis: tools/ai-bench/results/<Zeit>.json (vollständige Protokolle) und .md (Bericht).
// Die Ergebnisse enthalten Auszüge aus den eigenen Notizen und sind deshalb nicht im Git.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";
import { SCENARIOS } from "./scenarios.mjs";
import { runMcpTurn } from "./mcp-agent.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const arg = (name, fallback) => {
	const i = process.argv.indexOf("--" + name);
	return i < 0 ? fallback : process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : true;
};
const LMS = String(arg("lms", "http://localhost:1234"));
const CTX = Number(arg("ctx", 32768));
const WS_PORT = Number(process.env.IMPALA_WS_PORT || 8765);
const TURN_LIMIT_MS = Number(arg("turn-timeout", 20 * 60000));
const MODES = String(arg("modes", "app,mcp")).split(",");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toLocaleTimeString("de-DE"), ...a);

// ---------- Relay zur App ----------
function connect() {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(`ws://127.0.0.1:${WS_PORT}/relay`);
		const pending = new Map();
		let seq = 1;
		const timer = setTimeout(() => reject(new Error("Kein MCP-Primärserver auf Port " + WS_PORT + " (Claude Code / MCP-Server starten, App offen?)")), 3000);
		ws.on("error", (e) => reject(e));
		ws.on("message", (raw) => {
			let msg; try { msg = JSON.parse(raw); } catch { return; }
			if (msg.relayAck) {
				clearTimeout(timer);
				resolve({
					call(tool, args, timeoutMs = 30000) {
						const id = seq++;
						return new Promise((res) => {
							// Geht eine Antwort unterwegs verloren, nicht ewig warten (Abfragen werden wiederholt).
							const timer = setTimeout(() => { pending.delete(id); res({ error: "Relay-Timeout", timeout: true }); }, timeoutMs + 10000);
							pending.set(id, (v) => { clearTimeout(timer); res(v); });
							ws.send(JSON.stringify({ relayCallId: id, tool, args: { ...args, timeoutMs } }));
						});
					},
					close: () => ws.close(),
				});
				return;
			}
			const res = pending.get(msg.relayCallId);
			if (res) { pending.delete(msg.relayCallId); res(msg.result); }
		});
	});
}
async function evalIn(app, code, timeoutMs = 30000) {
	const r = await app.call("impala_eval", { code }, timeoutMs);
	if (!r) throw new Error("Keine App verbunden (Impala im Browser offen?)");
	if (r.error) throw new Error(String(r.error));
	if (r.ok === false) throw new Error(String(r.error || r.message || JSON.stringify(r)));
	return r.output;
}

// ---------- LM Studio ----------
async function lmsModels() {
	const res = await fetch(`${LMS}/api/v0/models`);
	return (await res.json()).data || [];
}
function lmsLoad(id) {
	try { execFileSync("lms", ["unload", "--all"], { stdio: "ignore" }); } catch {}
	log(`lade ${id} (Kontext ${CTX}) …`);
	const t0 = Date.now();
	execFileSync("lms", ["load", id, "-c", String(CTX), "-y"], { stdio: "ignore", timeout: 10 * 60000 });
	return Date.now() - t0;
}

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
const GROUPS = {
	heft: ["view_heft_page", "impala_heft_page_image"],
	read: ["inspect", "impala_get_page", "impala_search", "impala_list_pages", "impala_list_flashcards", "view_heft_page", "impala_heft_page_image"],
	write: ["change", "impala_create_page", "impala_update_page", "impala_create_flashcard"],
	calc: ["calculate"],
};
// Werkzeug-Aufrufe beider Modi vergleichbar machen: Gruppe und Heftseite (1-basiert).
function normalize(rec) {
	rec.plain = plain(rec.text);
	for (const t of rec.tools) {
		t.group = Object.keys(GROUPS).find((g) => g !== "read" && GROUPS[g].includes(t.name)) || (GROUPS.read.includes(t.name) ? "read" : "other");
		let a = {}; try { a = JSON.parse(t.args); } catch {}
		if (t.name === "view_heft_page") t.page = Number(a.page) || 1;
		if (t.name === "impala_heft_page_image") t.page = (Number(a.page_index) || 0) + 1;
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
	const chat = rec.requests.filter((r) => /chat\/completions/.test(r.path));
	let prompt = 0, completion = 0, decodeMs = 0, decodeTokens = 0, prefillMs = 0, prefillTokens = 0;
	for (const r of chat) {
		const u = r.usage || {};
		const out = u.completion_tokens ?? (r.chunks.content + r.chunks.reasoning + r.chunks.tool);
		prompt += u.prompt_tokens || 0;
		completion += out;
		// Nur gestreamte Anfragen: Bei der Verlaufs-Zusammenfassung (ohne Stream) kommt alles auf einmal.
		if (r.stream && r.tFirst && r.tEnd > r.tFirst) {
			decodeMs += r.tEnd - r.tFirst; decodeTokens += out;
			prefillMs += r.tFirst - r.t0; prefillTokens += u.prompt_tokens || 0;
		}
	}
	const first = chat.find((r) => r.tFirst);
	return {
		requests: chat.length, promptTokens: prompt, completionTokens: completion,
		reasoningTokens: chat.reduce((n, r) => n + (r.usage?.completion_tokens_details?.reasoning_tokens ?? r.chunks.reasoning), 0),
		ttftMs: first ? first.tFirst - first.t0 : null,
		decodeTps: decodeMs ? +(decodeTokens / (decodeMs / 1000)).toFixed(1) : null,
		prefillTps: prefillMs && prefillTokens ? +(prefillTokens / (prefillMs / 1000)).toFixed(0) : null,
		maxPromptTokens: Math.max(0, ...chat.map((r) => r.usage?.prompt_tokens || 0)),
		usageExact: chat.length > 0 && chat.every((r) => r.usage),
		toolCalls: rec.tools.length, toolErrors: rec.tools.filter((t) => t.error).length,
	};
}

// ---------- App-Modus ----------
// Fehlt der Harness (App neu geladen oder die Bridge spricht jetzt mit einem anderen
// App-Fenster), ist das laufende Gespräch verloren: Harness neu einspielen, Szenario neu starten.
class LostHarness extends Error {}
const guard = (body) => `if (!globalThis.__aiBench) return { lost: true }; ${body}`;
async function runAppTurn(app, spec) {
	const id = await evalIn(app, guard(`return globalThis.__aiBench.start(${JSON.stringify(spec)});`));
	if (id?.lost) throw new LostHarness();
	const t0 = Date.now();
	let last = "";
	for (;;) {
		await sleep(1500);
		let p;
		try { p = await evalIn(app, guard(`return globalThis.__aiBench.poll(${JSON.stringify(id)});`), 20000); }
		catch (e) { if (/timeout/i.test(String(e?.message))) continue; throw e; }
		if (p.lost || p.state === "missing") throw new LostHarness();
		if (p.state !== "running") return p;
		const line = `   … ${Math.round(p.ms / 1000)} s, ${p.requests} Anfrage(n), Tools: ${p.tools.join(", ") || "–"}, Token im Strom: ${p.lastChunks}`;
		if (line !== last && Date.now() - t0 > 10000) { process.stdout.write("\r" + line.slice(0, 110).padEnd(110)); last = line; }
		if (Date.now() - t0 > TURN_LIMIT_MS) { await evalIn(app, `return globalThis.__aiBench.cancel(${JSON.stringify(id)});`); }
	}
}

async function main() {
	const app = await connect();
	const harness = readFileSync(join(here, "harness.js"), "utf8");
	const ready = await evalIn(app, harness, 60000);
	log("Harness bereit:", JSON.stringify(ready));

	const all = await lmsModels();
	const wanted = arg("models", null);
	const models = all.filter((m) => m.type === "llm" || m.type === "vlm")
		.filter((m) => (wanted ? String(wanted).split(",").includes(m.id) : (m.capabilities || []).includes("tool_use")))
		.sort((a, b) => parseFloat(a.id.match(/(\d+)b/i)?.[1] || 0) - parseFloat(b.id.match(/(\d+)b/i)?.[1] || 0));
	const scen = arg("scenarios", null);
	const scenarios = SCENARIOS.filter((s) => !scen || String(scen).split(",").includes(s.id));
	if (!models.length) throw new Error("Keine passenden Modelle in LM Studio.");
	log("Modelle:", models.map((m) => m.id).join(", "), "| Modi:", MODES.join(", "), "| Szenarien:", scenarios.map((s) => s.id).join(", "));

	const pdfCache = new Map();
	const results = { startedAt: new Date().toISOString(), ctx: CTX, lms: LMS, modes: MODES, runs: [] };
	const stamp = results.startedAt.replace(/[:.]/g, "-").slice(0, 19);
	const outDir = join(here, "results");
	mkdirSync(outDir, { recursive: true });
	const save = () => {
		writeFileSync(join(outDir, stamp + ".json"), JSON.stringify(results, null, 2));
		writeFileSync(join(outDir, stamp + ".md"), report(results));
	};

	for (const m of models) {
		const loadMs = arg("no-load", false) !== true ? lmsLoad(m.id) : null;
		for (const mode of MODES) {
			const entry = { id: m.id, mode, type: m.type, arch: m.arch, quant: m.quantization, loadMs, scenarios: [] };
			results.runs.push(entry);
			log(`== ${m.id} · ${mode}${loadMs ? ` (geladen in ${(loadMs / 1000).toFixed(1)} s)` : ""}`);
			for (const s of scenarios) {
				for (let attempt = 1; ; attempt++) {
					try { await runScenario(entry, s, attempt); break; } catch (e) {
						if (!(e instanceof LostHarness) || attempt >= 3) throw e;
						entry.scenarios.pop();
						log(`   App-Fenster gewechselt/neu geladen – spiele Harness neu ein und wiederhole ${s.id}`);
						await sleep(3000);
						await evalIn(app, harness, 60000);
					}
				}
			}
		}
	}
	async function runScenario(entry, s, attempt) {
		const convId = `${entry.id}::${entry.mode}::${s.id}`;
		if (entry.mode === "app") await evalIn(app, `return globalThis.__aiBench.reset(${JSON.stringify(convId)});`);
		const conv = {};
		let pdfFile = null;
		if (s.pdf) {
			const key = JSON.stringify(s.pdf);
			if (!pdfCache.has(key)) {
				if (s.pdf.file) {
					try { pdfCache.set(key, readFileSync(join(here, s.pdf.file), "utf8")); }
					catch { entry.scenarios.push({ id: s.id, name: s.name, skipped: `Textdatei ${s.pdf.file} fehlt (siehe scenarios.mjs)` }); log(`-- ${s.id}: übersprungen, ${s.pdf.file} fehlt`); return; }
				} else pdfCache.set(key, await evalIn(app, `return globalThis.__aiBench.heftText(${JSON.stringify(s.pdf.heft)}, ${s.pdf.from}, ${s.pdf.to});`, 60000));
			}
			pdfFile = { name: s.pdf.name, content: pdfCache.get(key) };
		}
		const sc = { id: s.id, name: s.name, attempt, pdfChars: pdfFile?.content?.length || 0, turns: [] };
		entry.scenarios.push(sc);
		log(`-- ${s.id}: ${s.name}`);
		const prev = [];
		for (const [i, t] of s.turns.entries()) {
			const spec = { convId, model: entry.id, text: t.text, workspacePage: s.workspacePage || null, answers: t.answers || null,
				thinking: arg("no-think", false) !== true, pdfFile: t.attachPdf ? pdfFile : null };
			const rec = normalize(entry.mode === "app" ? await runAppTurn(app, spec) : await runMcpTurn({ app, lms: LMS, model: entry.id, conv, spec, limitMs: TURN_LIMIT_MS }));
			process.stdout.write("\r".padEnd(112) + "\r");
			const checks = rec.state === "done" ? grade(t, rec, { prev }) : (t.checks || []).map((c) => ({ label: c.label, pass: false }));
			prev.push(rec);
			const met = metrics(rec);
			const passed = checks.filter((c) => c.pass).length;
			sc.turns.push({ i: i + 1, question: t.text, state: rec.state, error: rec.error, wallMs: rec.wallMs, ...met, checks, passed, total: checks.length,
				answer: rec.text, tools: rec.tools, changes: rec.changes, asks: rec.asks, rag: rec.rag, summary: rec.summary, items: rec.items, requestsRaw: rec.requests, config: rec.config });
			log(`   R${i + 1}: ${passed}/${checks.length} ✓ | ${(rec.wallMs / 1000).toFixed(1)} s | ${met.decodeTps ?? "–"} tk/s | Prompt max ${met.maxPromptTokens} tk | Tools ${rec.tools.map((x) => x.name.replace("impala_", "") + (x.error ? "✗" : "")).join(",") || "–"}${rec.error ? " | FEHLER " + rec.error.slice(0, 120) : ""}`);
			save();
		}
	}
	results.finishedAt = new Date().toISOString();
	save();
	try { execFileSync("lms", ["unload", "--all"], { stdio: "ignore" }); } catch {}
	app.close();
	log("Bericht:", join(outDir, stamp + ".md"));
}

// ---------- Bericht ----------
function report(res) {
	const runs = res.runs || (res.models || []).map((m) => ({ ...m, mode: "app" })); // ältere Ergebnisdateien
	const L = [];
	const fmt = (ms) => (ms == null ? "–" : (ms / 1000).toFixed(1) + " s");
	const sum = (xs, k) => xs.reduce((n, x) => n + (x[k] || 0), 0);
	const avg = (xs, k) => { const v = xs.map((x) => x[k]).filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
	const pct = (p, t) => `${p}/${t} (${t ? Math.round((100 * p) / t) : 0} %)`;
	L.push(`# KI-Benchmark lokale Modelle`, "", `Start ${res.startedAt} · Kontext ${res.ctx} Token · ${res.lms}`, "");
	L.push("**app** = KI-Chat in Impala (Rust-Agent, App-Werkzeuge) · **mcp** = externer Assistent mit den Impala-MCP-Werkzeugen (wie Antigravity). Schreiben wird in beiden Modi nur simuliert.", "");
	L.push("Decode = Antwort-Token je Sekunde ab dem ersten Token; Prefill = Prompt-Token bis zum ersten Token (LM Studio cacht gleiche Prompt-Anfänge).", "");
	L.push("| Modell | Modus | Punkte | Zeit gesamt | Ø Decode tk/s | Ø Prefill tk/s | Ø TTFT | max. Prompt | Denk-Token | Tool-Aufrufe (Fehler) | Abbrüche |", "|---|---|---|---|---|---|---|---|---|---|---|");
	for (const m of runs) {
		const turns = m.scenarios.flatMap((s) => s.turns || []);
		L.push(`| ${m.id} | ${m.mode} | ${pct(sum(turns, "passed"), sum(turns, "total"))} | ${fmt(sum(turns, "wallMs"))} | ${avg(turns, "decodeTps")?.toFixed(1) ?? "–"} | ${avg(turns, "prefillTps")?.toFixed(0) ?? "–"} | ${fmt(avg(turns, "ttftMs"))} | ${Math.max(0, ...turns.map((x) => x.maxPromptTokens))} | ${sum(turns, "reasoningTokens")} | ${sum(turns, "toolCalls")} (${sum(turns, "toolErrors")}) | ${turns.filter((x) => x.state !== "done" || /Abgebrochen/.test(x.answer || "")).length} |`);
	}
	// Punkte je Szenario nebeneinander
	const ids = [...new Set(runs.flatMap((m) => m.scenarios.map((s) => s.id)))];
	L.push("", "| Szenario | " + runs.map((m) => `${m.id.replace("ternary-bonsai-2-", "")} ${m.mode}`).join(" | ") + " |", "|---|" + runs.map(() => "---").join("|") + "|");
	for (const id of ids) {
		const name = runs.flatMap((m) => m.scenarios).find((s) => s.id === id)?.name || id;
		L.push(`| ${name} | ` + runs.map((m) => { const s = m.scenarios.find((x) => x.id === id); if (!s?.turns) return "–"; const t = s.turns; return `${sum(t, "passed")}/${sum(t, "total")} · ${fmt(sum(t, "wallMs"))}`; }).join(" | ") + " |");
	}
	L.push("");
	for (const m of runs) {
		L.push(`## ${m.id} · ${m.mode}`, "", `${m.type}, ${m.arch}, ${m.quant}${m.loadMs ? `, geladen in ${fmt(m.loadMs)}` : ""}`, "");
		for (const s of m.scenarios) {
			if (s.skipped) { L.push(`### ${s.name} — übersprungen (${s.skipped})`, ""); continue; }
			L.push(`### ${s.name} — ${sum(s.turns, "passed")}/${sum(s.turns, "total")}${s.pdfChars ? ` (PDF ${s.pdfChars} Zeichen)` : ""}`, "");
			L.push("| Runde | Punkte | Zeit | TTFT | tk/s | Prompt-Tk | Antwort-Tk | Anfragen | Tools |", "|---|---|---|---|---|---|---|---|---|");
			for (const x of s.turns) L.push(`| ${x.i} | ${x.passed}/${x.total} | ${fmt(x.wallMs)} | ${fmt(x.ttftMs)} | ${x.decodeTps ?? "–"} | ${x.promptTokens} | ${x.completionTokens} | ${x.requests} | ${x.tools.map((t) => t.name.replace("impala_", "") + (t.error ? "✗" : "")).join(", ") || "–"} |`);
			L.push("");
			for (const x of s.turns) {
				L.push(`**R${x.i}:** ${x.question}`, "");
				L.push(x.checks.map((c) => `${c.pass ? "✅" : "❌"} ${c.label}`).join(" · "), "");
				if (x.error) L.push(`> Fehler: ${x.error}`, "");
				if (x.changes?.length) L.push("Schreibwünsche: " + x.changes.map((o) => `\`${o.op}\` ${o.title || o.deck || ""}`).join(", "), "");
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
} else main().catch((e) => { console.error("Abbruch:", e?.message || e); process.exit(1); });
