// Schreibt die Golden-Files für `cargo test -p impala-ai` (core/impala-ai/tests/golden/*.json)
// aus dem JS-Original (web/ai.js, web/think-heuristik.js, web/tools.js).
//
// So lädt ai.js in Node: jsdom stellt window/document/localStorage bereit (wie test/ai.test.mjs),
// alle echten Module laden unverändert. Ersetzt werden nur Laufzeit-Kanten:
//  • fetch → Attrappe, die jede Anfrage aufzeichnet und vorbereitete Antworten/SSE-Ströme liefert
//    (Ströme in zufällig, aber fest geseedet zerschnittene Byte-Stücke, Grenzen landen im Golden-File),
//  • Date → feste Zeit (2026-10-27 14:05 UTC, TZ=UTC), U.uid → Zähler, setTimeout → ohne Wartezeit
//    (außer den 30/60-s-Zeitlimits) und Wartezeiten der Wiederholungen werden mitgeschrieben,
//  • App-Zugriffe der Werkzeuge: TOOLS.run, STATE.findPage/studySnapshot, HEFT.pageAsDataUrl,
//    RAG.enabled/search → Attrappen mit Drehbuch je Fall.
// Der Cloudflare-Weg nutzt den echten CLOUDFLARE_SYNC.aiRequest (Sync-Schlüssel in localStorage).
// Neu erzeugen: node core/tools/gen-golden-ai.mjs
process.env.TZ = "UTC";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, "../impala-ai/tests/golden");
fs.mkdirSync(outDir, { recursive: true });

const dom = new JSDOM("<!doctype html><body></body>", { url: "http://localhost/" });
for (const key of ["window", "document", "Element", "Node", "HTMLElement", "MutationObserver", "navigator"]) {
	Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
}
Object.defineProperty(globalThis, "localStorage", { value: dom.window.localStorage, configurable: true });
Object.defineProperty(globalThis, "requestAnimationFrame", { value: (fn) => setTimeout(fn, 0), configurable: true });
Object.defineProperty(globalThis, "matchMedia", { value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), configurable: true });

const SYNC_KEY = "impala-0123-4567-89ab-cdef-0123-4567-89ab-cdef";
const SYNC_URL = "https://golden-sync.example.workers.dev";
localStorage.setItem("impala67_cf_sync_key", SYNC_KEY);
localStorage.setItem("impala67_cf_server_url", SYNC_URL);
const SAFETY_ID = "install_golden";
localStorage.setItem("impala67AiSafetyId", SAFETY_ID);

const FIXED = Date.parse("2026-10-27T14:05:00Z");
const RealDate = Date;
globalThis.Date = class extends RealDate {
	constructor(...a) { super(...(a.length ? a : [FIXED])); }
	static now() { return FIXED; }
};
const realSetTimeout = globalThis.setTimeout;
let sleeps = [];
globalThis.setTimeout = (fn, ms, ...rest) => {
	if (ms === 60000 || ms === 30000) return realSetTimeout(fn, ms, ...rest);
	if (ms >= 100 && ms !== 1500) sleeps.push(ms);
	return realSetTimeout(fn, 0, ...rest);
};

const { S, STATE } = await import("../../web/state.js");
const { U } = await import("../../web/util.js");
const { AI } = await import("../../web/ai.js");
const { TOOLS } = await import("../../web/tools.js");
const { THINK } = await import("../../web/think-heuristik.js");
const { RAG } = await import("../../web/rag.js");
const { HEFT } = await import("../../web/heft.js");
const CORE = await import("../../web/core/impala_core.js");
await CORE.default({ module_or_path: fs.readFileSync(path.join(here, "../../web/core/impala_core_bg.wasm")) });
STATE.dispatch = async (type, payload) => STATE.reduce({ id: crypto.randomUUID(), t: new Date().toISOString(), type, payload });

let uidCounter = 0;
U.uid = () => "u" + String(++uidCounter).padStart(7, "0") + "-golden";
const creds = CORE.syncAuth(SYNC_KEY);

// ── Hilfen ───────────────────────────────────────────────────────────────
function rng(seed) {
	return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const enc = new TextEncoder();
function cut(text, seed) {
	const bytes = enc.encode(text), r = rng(seed), sizes = [];
	for (let at = 0; at < bytes.length;) { const n = Math.min(bytes.length - at, 1 + Math.floor(r() * 23)); sizes.push(n); at += n; }
	return sizes;
}
const sse = (...events) => events.map((e) => "data: " + (typeof e === "string" ? e : JSON.stringify(e)) + "\n\n").join("") + "data: [DONE]\n\n";
const delta = (d, extra = {}) => ({ choices: [{ delta: d, ...extra }] });
const stream = (text, seed = 1) => ({ status: 200, headers: { "content-type": "text/event-stream" }, body: text, chunks: cut(text, seed) });
const json = (obj, status = 200, headers = {}) => ({ status, headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(obj) });
const text = (body, status, headers = {}) => ({ status, headers: { "content-type": "text/plain", ...headers }, body });
const completion = (message) => json({ choices: [{ message: { role: "assistant", ...message } }] });

let script = [], requests = [];
globalThis.fetch = async (url, init = {}) => {
	const headers = { ...(init.headers || {}) };
	let body = null;
	try { body = init.body ? JSON.parse(init.body) : null; } catch { body = init.body; }
	requests.push({ url: String(url), method: init.method || "GET", headers, body });
	const next = script.shift();
	if (!next) throw new TypeError("fetch failed");
	if (next.throw) throw new TypeError(next.throw);
	let payload = next.body;
	if (next.chunks) {
		const bytes = enc.encode(next.body), parts = [];
		let at = 0;
		for (const n of next.chunks) { parts.push(bytes.slice(at, at + n)); at += n; }
		payload = new ReadableStream({ start(c) { for (const p of parts) c.enqueue(p); c.close(); } });
	}
	return new Response(payload, { status: next.status, headers: next.headers });
};

const PROVIDERS = {
	local: { id: "local", name: "Lokal (LM Studio)", base: "http://localhost:1234/v1", key: "" },
	google: { id: "google", name: "Google Gemini", base: "https://generativelanguage.googleapis.com/v1beta/openai", key: "g-key" },
	openai: { id: "openai", name: "OpenAI", base: "https://api.openai.com/v1", key: "o-key" },
	cloudflare: { id: "cloudflare", name: "Impala AI", base: "", key: "" },
	deepseek: { id: "ds", name: "DeepSeek", base: "https://api.deepseek.com/v1", key: "d-key" },
	groq: { id: "groq", name: "Groq", base: "https://api.groq.com/openai/v1/", key: "q-key" },
};
function useProvider(id, model, extra = {}) {
	S.settings.aiProviders = Object.values(PROVIDERS).map((p) => ({ ...p }));
	S.settings.aiProviderId = PROVIDERS[id].id;
	S.settings.aiModel = model;
	S.settings.thinkingEnabled = extra.thinkingEnabled !== false;
	S.settings.alwaysSendTools = extra.alwaysSendTools !== false;
	S.settings.customInstructions = extra.customInstructions || "";
	S.settings.embedModel = extra.embedModel || "";
	S.settings.embedProviderId = extra.embedProviderId || "";
}
const settingsOf = () => ({
	providers: S.settings.aiProviders, activeProviderId: S.settings.aiProviderId, model: S.settings.aiModel,
	thinkingEnabled: S.settings.thinkingEnabled !== false, alwaysSendTools: S.settings.alwaysSendTools !== false,
	customInstructions: S.settings.customInstructions, embedModel: S.settings.embedModel,
});
function debugEntries() {
	const report = AI.debugReport();
	const out = [];
	for (const block of report.split(/\n\n(?=\[)/)) {
		const m = block.match(/^\[[^\]]+\] ([^\n]+)\n([\s\S]*)$/);
		if (m) { try { out.push({ kind: m[1], detail: JSON.parse(m[2]) }); } catch {} }
	}
	return out;
}
const errorInfo = (e) => ({ message: String(e?.message || e), status: e?.status || 0 });
function write(name, data) {
	fs.writeFileSync(path.join(outDir, name), JSON.stringify(data) + "\n");
}

// ── 1. Denkblöcke ────────────────────────────────────────────────────────
const thinkInputs = [
	"", "Hallo Welt", "<think>Plan</think>Antwort", "<thinking>a</thinking>b<thought>c</thought>d", "<think>x</thought>rest",
	"Antwort <reasoning>noch offen", "<think>offen ohne Ende", "a<think>1</think>b<think>2",
	"The user wants a summary. I should keep it short. Hier ist die Zusammenfassung:\n\n- Punkt 1\n- Punkt 2",
	"Okay, let me think. Wait, maybe not. Hmm.", "Okay, die Antwort ist 42.", "Ich sollte nachsehen.Die Lösung ist einfach.",
	"Let me check.<br>Die Antwort lautet: ja.", "1. Let me check this.\n2. Die Antwort folgt.", "- I need to think\n- Ergebnis: 5",
	"Lass mich überlegen! Äpfel sind rot.", "Der Nutzer fragt nach X. Ich prüfe das. Übrigens: X ist Y.",
	"I'll do it.   Done here.", "   führender Raum   ", "Maybe.Perhaps.So.", "<think></think>", "Text <think>a</think> mitte <thought>b</thought> ende",
	"Actually\n\n\nNeue Zeile mit Antwort.", "they want details. Okay. Gut. Fertig ist es.", "LET ME see. ÜBRIGENS gut.",
];
write("think.json", thinkInputs.flatMap((raw) => [false, true].map((skip) => ({ raw, skip, ...THINK.splitThink(raw, skip) }))));

// ── 2. Familien, Modelle, Thinking-Stufen ────────────────────────────────
const familyCases = [
	["cloudflare", "", ""], ["x", "Mein Worker", "https://a.workers.dev"], ["x", "Impala AI", ""], ["x", "", "https://h.example/api/ai"],
	["local", "Lokal", "http://localhost:1234/v1"], ["x", "LM Studio", "http://box:1234"], ["x", "", "http://nas.local/v1"], ["x", "Ollama", "http://10.0.0.2:11434/v1"],
	["google", "Google Gemini", "https://generativelanguage.googleapis.com/v1beta/openai"], ["x", "Gemma", "https://h.example"],
	["ds", "DeepSeek", "https://api.deepseek.com/v1"], ["openai", "OpenAI", "https://api.openai.com/v1"], ["x", "", "https://api.openai.com/v1"],
	["groq", "Groq", "https://api.groq.com/openai/v1"], ["x", "openrouter", "https://openrouter.ai/api/v1"], ["x", "jan", ""], ["x", "localhoster", ""],
];
const models = ["", "gemini-3.6-flash", "models/gemini-3.5-flash-lite", "gemini-2.5-flash", "gemini-2.5-pro", "gpt-5.6-sol", "gpt-5", "gpt-5-pro", "gpt-4o",
	"qwen3-8b", "gemma-4-31b-it", "llama-3.3-70b-versatile", "openai/gpt-oss-120b", "impala-ai", "qwen/qwen3.6-27b", "cloudflare-auto"];
const config = [];
for (const [id, name, base] of familyCases) {
	for (const model of models) {
		S.settings.aiProviders = [{ id, name, base, key: "k" }];
		S.settings.aiProviderId = id;
		S.settings.aiModel = model;
		S.thinkingCapabilities = Object.create(null);
		const cap = await AI.detectThinkingCapabilities();
		config.push({ provider: { id, name, base }, model, cap: { levels: cap.levels, includeThoughts: cap.includeThoughts, offEffort: cap.offEffort ?? null, offLabel: cap.offLabel ?? null, source: cap.source, error: cap.error } });
	}
}
write("config.json", config);
write("tool-defs.json", TOOLS.defs);
write("presets.json", AI.MODEL_PRESETS);

// ── 3. Einzelne Anfragen: complete (am Stück) und refine (gestreamt) ──────
const chats = [];
async function chatCase(name, provider, model, call, responses, extra = {}) {
	useProvider(provider, model, extra);
	AI.debugClear();
	script = responses.slice(); requests = []; sleeps = [];
	let result = null, error = null, lastDelta = "", lastReasoning = "";
	try {
		result = await call((t) => { lastDelta = t; }, (t) => { lastReasoning = t; });
	} catch (e) { error = errorInfo(e); }
	const answer = debugEntries().filter((e) => e.kind === "KI-Antwort").pop()?.detail || null;
	chats.push({ name, settings: settingsOf(), call: extra.callInfo, responses, requests, sleeps, result, error, lastDelta, lastReasoning,
		message: answer && { content: answer.content, reasoning: answer.reasoning, rawContent: answer.rawContent, toolCalls: answer.toolCalls } });
}
const refineCall = (history, instruction) => [(d, r) => AI.refine(history, instruction, d, r), { kind: "refine", history, instruction }];
const completeCall = (prompt, system) => [() => AI.complete(prompt, system), { kind: "complete", prompt, system: system || null }];
async function both(name, provider, model, [call, info], responses, extra = {}) {
	await chatCase(name, provider, model, call, responses, { ...extra, callInfo: info });
}
const hist = [{ role: "user", content: "Erkläre Photosynthese." }, { role: "assistant", content: "Pflanzen machen aus Licht Zucker." }];
const long = "Dies ist eine lange Antwort ohne Denkanteil. ".repeat(14);
await both("complete-local", "local", "qwen3-8b", completeCall("Sag hallo", "Sei knapp."), [completion({ content: "Hallo!" })]);
await both("complete-google-parts", "google", "gemini-3.6-flash", completeCall("Frage"), [completion({ content: [{ type: "text", text: "Teil A " }, { type: "thinking", text: "geheim" }, { type: "text", text: "Teil B" }], extra_content: { google: { thought_signature: "sig-msg" } } })]);
await both("complete-reasoning-field", "openai", "gpt-5.6-sol", completeCall("Frage"), [completion({ content: "<think>leak</think>Ergebnis", reasoning_content: "api-denken" })]);
await both("complete-leaked", "groq", "gemma-x", completeCall("Frage"), [completion({ content: "The user wants a number. I should answer. Die Zahl ist 7." })]);
await both("complete-openai-off", "openai", "gpt-5.6-terra", completeCall("Frage", "System"), [completion({ content: "ok" })], { thinkingEnabled: false });
await both("complete-local-off", "local", "gemma-4-31b-it", completeCall("Frage"), [completion({ content: "ok" })], { thinkingEnabled: false });
await both("complete-cloudflare-off", "cloudflare", "", completeCall("Frage"), [completion({ content: "ok" })], { thinkingEnabled: false });
await both("complete-cloudflare-legacy", "cloudflare", "llama-3.3-70b-versatile", completeCall("Frage"), [completion({ content: "ok" })]);
await both("refine-local-plain", "local", "local-model", refineCall(hist, "Kürzer bitte"), [stream(sse(...long.match(/.{1,37}/g).map((c) => delta({ content: c }))), 7)]);
await both("refine-google-thoughts", "google", "gemini-3.6-flash", refineCall(hist, "Anders"), [stream(sse(
	delta({ content: [{ type: "thinking", text: "Ich denke " }], extra_content: { google: { thought_signature: "s1" } } }),
	delta({ content: [{ thought: true, text: "nach." }] }),
	delta({ content: "Grüße aus 🌍 der Antwort." }),
), 3)]);
await both("refine-think-tags", "groq", "qwen3", refineCall(hist, "Nochmal"), [stream(sse(
	delta({ content: "<thi" }), delta({ content: "nk>Plan A" }), delta({ content: " und B</think>" }), delta({ content: "Fertig: A." }),
), 11)]);
await both("refine-leaked-stream", "local", "gemma-3", refineCall(hist, "Nochmal"), [stream(sse(
	delta({ content: "The user asks again. " }), delta({ content: "I should rephrase. " }), delta({ content: "Hier die neue Fassung." }),
), 5)]);
await both("refine-only-leaked", "local", "gemma-3", refineCall(hist, "?"), [stream(sse(delta({ content: "Let me think about it. Hmm." })), 2)]);
await both("refine-reasoning-field", "deepseek", "deepseek-chat", refineCall(hist, "?"), [stream(sse(
	delta({ reasoning_content: "Schritt 1. " }), delta({ reasoning_content: "Schritt 2." }), delta({ content: "Antwort." }),
), 13)]);
await both("refine-toolcalls", "google", "gemini-3.6-flash", refineCall(hist, "?"), [stream(sse(
	delta({ tool_calls: [{ index: 0, id: "c1", function: { name: "insp", arguments: "{\"ki" }, extra_content: { google: { thought_signature: "tsig" } } }] }),
	delta({ tool_calls: [{ index: 0, function: { name: "inspect", arguments: "nd\":\"pages\"}" } }] }),
	delta({ tool_calls: [{ index: 1, function: { name: "calculate", arguments: "{}" } }] }),
	delta({ tool_calls: [{ function: { arguments: "" } }] }),
	delta({ tool_calls: [{ index: 3, function: { arguments: "{\"x\":1}" } }] }),
), 17)]);
await both("refine-json-fallback", "local", "m", refineCall(hist, "?"), [completion({ content: "Am Stück" })]);
await both("refine-crlf-noise", "local", "m", refineCall(hist, "?"), [stream(": kommentar\r\nevent: x\r\ndata:{\"choices\":[{\"delta\":{\"content\":\"A\"}}]}\r\ndata: kaputt\r\n\r\ndata: {\"choices\":[]}\r\ndata: {\"choices\":[{\"delta\":{\"content\":\"B\"}}]}", 4)]);
await both("refine-error-after-text", "local", "m", refineCall(hist, "?"), [stream(sse(delta({ content: "Teil" }), { error: { code: 503, message: "überlastet" } }), 6)]);
await both("refine-error-first", "local", "m", refineCall(hist, "?"), [
	stream(sse({ error: { message: "kaputt" } }), 6), stream(sse(delta({ content: "Zweiter Versuch" })), 8)]);
write("chats.json", chats);

// ── 4. Wiederholungen und Fehler ──────────────────────────────────────────
const retries = [];
async function retryCase(name, provider, model, responses, extra = {}) {
	chats.length = 0;
	await both(name, provider, model, completeCall("Frage"), responses, extra);
	retries.push(chats[0]);
}
const err = (status, message, headers) => json({ error: { message } }, status, headers);
await retryCase("server-500-then-ok", "local", "m", [err(500, "intern"), completion({ content: "ok" })]);
await retryCase("429-retry-after-seconds", "groq", "m", [err(429, "Rate limit", { "retry-after": "2" }), completion({ content: "ok" })]);
await retryCase("429-retry-after-date", "groq", "m", [err(429, "Rate limit", { "retry-after": "Tue, 27 Oct 2026 14:05:03 GMT" }), completion({ content: "ok" })]);
await retryCase("429-try-again-text", "groq", "m", [json({ error: { message: "Please try again in 1.25s." } }, 429), completion({ content: "ok" })]);
await retryCase("429-too-long", "groq", "m", [err(429, "Tageslimit", { "retry-after": "40" })]);
await retryCase("401-no-retry", "openai", "gpt-5.6-sol", [text("Unauthorized", 401)]);
await retryCase("400-thinking-incompatible", "google", "gemini-3.6-flash", [err(400, "Unknown field extra_body"), completion({ content: "ok" })]);
await retryCase("400-plain", "local", "m", [err(400, "kaputte Anfrage")]);
await retryCase("network-all", "local", "m", [{ throw: "fetch failed" }, { throw: "fetch failed" }, { throw: "fetch failed" }, { throw: "fetch failed" }]);
await retryCase("server-all", "local", "m", [err(502, "a"), err(503, "b"), text("c", 504), err(500, "d")]);
await retryCase("worker-string-error", "cloudflare", "", [json({ error: "Kontingent erschöpft" }, 503), completion({ content: "ok" })]);
await retryCase("metadata-raw", "groq", "m", [json({ error: { message: "x", metadata: { raw: "roh" } } }, 400)]);
await retryCase("no-base", "local", "m", [], {});
retries[retries.length - 1].note = "Basis leer";
write("retries.json", retries);

// ── 5. Agent-Schleife ─────────────────────────────────────────────────────
const IMG = "data:image/png;base64,SEVGVA==";
const agents = [];
let chatNo = 0;
function setupWorkspace(ws) {
	S.pages = {}; S.heftDocs = {}; S.currentPageId = null; S.view = "notes"; S.sideContextOff = null; S.pageCtxInfo = null;
	if (!ws || ws.kind === "empty") return;
	if (ws.kind === "anki") { S.view = "anki"; S.ankiTab = ws.tab; S.ankiDeck = ws.deck; S.reviewShowBack = !!ws.back; S.reviewCardId = "k1";
		S.cards = { k1: { id: "k1", front: ws.front, back: ws.back || "geheim" } };
		STATE.studySnapshot = () => ({ counts: { neu: ws.new, learn: ws.learn, review: ws.review }, dueNow: ws.front ? [S.cards.k1] : [] });
		return; }
	S.pages[ws.id] = { id: ws.id, title: ws.title, content: ws.content || "", kind: ws.kind === "heft" ? "heft" : undefined };
	S.currentPageId = ws.id;
	if (ws.off) S.sideContextOff = ws.id;
	if (ws.kind === "heft") S.heftDocs[ws.id] = { pages: [{ texts: (ws.texts || []).map((t) => ({ text: t })), ocrText: ws.ocr || "" }] };
}
STATE.findPage = (title) => Object.values(S.pages).find((p) => String(p.title).toLowerCase().includes(String(title).toLowerCase())) || null;
HEFT.pageAsDataUrl = async () => IMG;

async function agentCase(name, provider, model, sc) {
	useProvider(provider, model, sc.settings || {});
	setupWorkspace(sc.workspace);
	const target = (sc.chat || []).map((m) => ({ mid: U.uid(), ...m }));
	const id = "chat" + ++chatNo;
	const runs = [];
	for (const run of sc.runs) {
		const before = JSON.parse(JSON.stringify(target));
		script = run.responses.slice(); requests = []; sleeps = [];
		const toolRuns = [], asks = [], ragQueries = [];
		const toolResults = (run.toolResults || []).slice(), answers = (run.answers || []).slice();
		RAG.enabled = () => !!sc.rag;
		RAG.search = async (q) => { ragQueries.push(q); return sc.rag || []; };
		TOOLS.run = async (n, args) => {
			toolRuns.push({ name: n, args });
			const next = toolResults.shift() || { json: { ok: true } };
			if (next.throw) throw new Error(next.throw);
			const out = JSON.parse(JSON.stringify(next.json));
			if (next.undo) Object.defineProperty(out, "_undo", { value: next.undo, enumerable: false });
			return out;
		};
		if (run.attachment) { S.pendingAttachmentTarget = "side"; S.pendingImage = run.attachment.image || null; S.pendingTextFile = run.attachment.textFile || null; S.pendingPdf = run.attachment.pdfFile || null; }
		const start = target.length;
		const poll = setInterval(() => {
			const q = target.find((m) => m.role === "question" && !m.answered && !m._seen);
			if (!q) return;
			q._seen = true;
			asks.push({ question: q.question, options: q.options });
			const a = answers.shift() ?? "Abbrechen";
			if (a === "__abort__") AI.abortActive(); else AI.resolveChoice(q.mid, a);
		}, 1);
		let result = null, error = null;
		try { result = await AI.agent(run.userText, "side", () => {}, { target, id }); } catch (e) { error = errorInfo(e); }
		clearInterval(poll);
		const items = target.slice(start + 1).filter((m) => m.role !== "question").map(({ mid, _seen, reasoningExpanded, reasoning, ...m }) => (m.role === "thought" ? { ...m, reasoning } : m));
		runs.push({
			userText: run.userText, attachment: run.attachment || null, chatBefore: before.map(({ mid, _seen, ...m }) => m),
			responses: run.responses, toolResults: (run.toolResults || []).map((t) => ({ json: t.throw ? null : JSON.stringify(t.json), throw: t.throw ? "Error: " + t.throw : null, undo: t.undo || null })),
			answers: run.answers || [], requests, toolRuns, asks, ragQueries, items, result, error, pageCtxInfo: S.pageCtxInfo || null,
		});
		for (const m of target) delete m._seen;
	}
	agents.push({ name, settings: settingsOf(), workspace: sc.workspace || { kind: "empty" }, rag: sc.rag || null, runs });
}
const call = (id, name, args, extra = {}) => ({ index: extra.index ?? 0, id, type: "function", function: { name, arguments: typeof args === "string" ? args : JSON.stringify(args) }, ...extra.more });
const toolStream = (calls, seed, d = {}) => stream(sse(delta({ ...d, tool_calls: calls.map((c, i) => ({ ...c, index: i })) })), seed);
const answer = (t, seed = 1) => stream(sse(delta({ content: t })), seed);

await agentCase("einfach-seite", "local", "qwen3-8b", {
	workspace: { kind: "page", id: "p1", title: "Biologie", content: "Zellen sind klein. 🧫 ".repeat(200) },
	chat: [{ role: "user", content: "Hallo" }, { role: "assistant", content: "Hi!", model: "qwen3-8b" }, { role: "thought", reasoning: "x" }],
	runs: [{ userText: "Was steht hier?", responses: [answer("Es geht um Zellen.", 3)] }],
});
await agentCase("werkzeuge-google", "google", "gemini-3.6-flash", {
	workspace: { kind: "empty" },
	settings: { customInstructions: "  Sprich wie ein Pirat.  ", embedModel: "local:bekko-a8m" },
	runs: [{
		userText: "Suche meine Notizen zu Mitose",
		responses: [
			toolStream([call("c1", "inspect", { kind: "search", query: "Mitose" }, { more: { extra_content: { google: { thought_signature: "sig1" } } } }), call("", "calculate", { expression: "2^10" })], 21,
				{ reasoning: "Ich suche erst." }),
			answer("Gefunden: zwei Seiten.", 4),
		],
		toolResults: [{ json: { treffer: [{ titel: "Zellteilung", z: 3 }], hinweis: "ok" } }, { json: { ergebnisse: "x".repeat(7000) } }],
	}],
});
await agentCase("aenderung-bestaetigen", "openai", "gpt-5.6-sol", {
	workspace: { kind: "page", id: "p2", title: "Alt", content: "Inhalt" },
	runs: [{
		userText: "Lösche die Seite Alt und lege Neu an",
		responses: [
			toolStream([call("a1", "change", { operations: [{ op: "page.trash", title: "Alt" }, { op: "page.create", title: "Neu" }] })], 5),
			toolStream([call("a2", "change", { operations: [{ op: "card.reset", front: "F" }] })], 6),
			toolStream([call("a3", "change", { operations: [{ op: "page.create", title: "X" }] })], 7),
			answer("Erledigt.", 8),
		],
		toolResults: [{ json: { ok: true, operations: 2 }, undo: { pages: [{ id: "p2" }] } }, { json: { ok: true, operations: 1 }, undo: { pages: [] } }],
		answers: ["Ja, ausführen", "Abbrechen"],
	}],
});
await agentCase("rueckfrage-und-fehler", "local", "gemma-3", {
	workspace: { kind: "page", id: "p3", title: "Notiz", content: "kurz", off: true },
	runs: [{
		userText: "Mach etwas Mehrdeutiges",
		responses: [
			toolStream([call("q1", "ask_choice", { question: "Welche?", options: ["A", "a", "B", " "] }), call("q2", "ask_choice", { question: "", options: [] }),
				call("q3", "delete_page", { title: "x" }), call("q4", "inspect", "{\"kind\":\"pa"), call("q5", "calculate", { expression: "1+1" })], 9),
			answer("Fertig mit A.", 10),
		],
		toolResults: [{ throw: "Rechenfehler" }],
		answers: ["A"],
	}],
});
await agentCase("meta-freischalten", "groq", "llama-x", {
	settings: { alwaysSendTools: false },
	workspace: { kind: "empty" },
	runs: [
		{ userText: "Lege eine Karte an", responses: [toolStream([call("m1", "request_tools", {})], 12), toolStream([call("m2", "change", { operations: [{ op: "card.create", cards: [{ front: "a", back: "b" }] }] })], 13), answer("Karte angelegt.", 14)],
			toolResults: [{ json: { ok: true, operations: 1 }, undo: { cards: [{ id: "k" }] } }] },
		{ userText: "Und noch eine bitte", responses: [answer("Gern.", 15)] },
	],
});
await agentCase("heft-bild", "google", "gemma-4-31b-it", {
	workspace: { kind: "heft", id: "h1", title: "Mathe-Heft", texts: [" Aufgabe 1 ", ""], ocr: "x^2 + 1" },
	runs: [{
		userText: "Was steht auf der Seite?",
		responses: [toolStream([call("v1", "view_heft_page", { title: "Mathe", page: 2 })], 16), answer("Eine Gleichung.", 17)],
	}],
});
await agentCase("leer-dann-nudge", "deepseek", "deepseek-chat", {
	workspace: { kind: "anki", tab: "study", deck: "Bio", new: 3, learn: 1, review: 2, front: "Was ist ATP?" },
	runs: [{
		userText: "Hilf mir",
		responses: [
			toolStream([call("d1", "inspect", { kind: "due" })], 18, { reasoning_content: "Ich schaue nach." }),
			stream(sse(delta({ reasoning_content: "Nichts zu sagen." })), 19),
			answer("Lerne die Karte ATP.", 20),
		],
	}],
});
await agentCase("anhang-modellwechsel-rag", "local", "neues-modell", {
	workspace: { kind: "page", id: "p9", title: "Aktiv", content: "" },
	rag: [{ pageId: "p9", title: "Aktiv", score: 0.9, snippet: "eigene" }, { pageId: "x1", title: "Andere", score: 0.7, snippet: "passend", archived: true }, { pageId: "x2", title: "Schwach", score: 0.3, snippet: "nein" }, { pageId: "x3", title: "Ohne", snippet: "ohne score" }],
	chat: [
		{ role: "user", content: "Bild", image: IMG }, { role: "assistant", content: "Gesehen", model: "altes-modell" },
		{ role: "question", question: "Farbe?", options: ["Rot", "Blau"], answered: true, answer: "Blau" },
		{ role: "user", content: "Datei", textFile: { name: "a.txt", content: "A".repeat(15000) } }, { role: "assistant", content: "ok" },
	],
	runs: [{ userText: "Was weißt du über Photosynthese?", attachment: { pdfFile: { name: "b.pdf", content: "B".repeat(13000) }, image: IMG }, responses: [completion({ content: "Zusammenfassung B" }), answer("Das hier.", 22)] }],
});
const longChat = Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `Nachricht ${i}  mit\nUmbruch ` + "y".repeat(300) }));
await agentCase("zusammenfassung", "local", "m", {
	workspace: { kind: "empty" }, chat: longChat,
	runs: [
		{ userText: "Weiter", responses: [completion({ content: "  Kurzfassung A  " }), answer("Antwort 1", 23)] },
		{ userText: "Noch weiter", responses: [answer("Antwort 2", 24)] },
	],
});
await agentCase("cloudflare-agent", "cloudflare", "", {
	workspace: { kind: "empty" },
	runs: [{ userText: "Hi", responses: [answer("Hallo von Impala.", 25)] }],
});
await agentCase("zu-viele-schritte", "local", "m", {
	workspace: { kind: "empty" },
	runs: [{ userText: "Endlos", responses: Array.from({ length: 12 }, (_, i) => toolStream([call("z" + i, "calculate", { expression: String(i) })], 30 + i)), toolResults: [] }],
});
await agentCase("schema-fallback", "groq", "m", {
	workspace: { kind: "empty" },
	runs: [{ userText: "Hallo", responses: [err(400, "Invalid tool schema: unsupported"), answer("Ohne Werkzeuge.", 26)] }],
});
await agentCase("abbruch-rueckfrage", "local", "m", {
	workspace: { kind: "empty" },
	runs: [{ userText: "Lösche alles", responses: [toolStream([call("x1", "change", { operations: [{ op: "deck.trash", deck: "D" }] })], 27)], answers: ["__abort__"] }],
});
write("agent.json", agents);

// ── 6. Modelle, Verbindungstest, Embeddings ───────────────────────────────
const apiCases = [];
function setProviders(list) { S.settings.aiProviders = list; S.settings.aiProviderId = list[0]?.id || ""; }
async function apiCase(name, providers, fn, responses) {
	setProviders(providers);
	script = responses.slice(); requests = [];
	let result = null, error = null;
	try { result = await fn(); } catch (e) { error = errorInfo(e); }
	if (result && typeof result === "object" && "ms" in result) delete result.ms;
	apiCases.push({ name, providers, syncUrl: SYNC_URL, settings: { embedModel: S.settings.embedModel, embedProviderId: S.settings.embedProviderId }, responses, requests, result, error });
}
const mlist = (...ids) => json({ data: ids.map((id) => ({ id })).concat([{ object: "x" }]) });
await apiCase("list-models", [
	{ id: "local", name: "Lokal", base: "http://m1.local:1234/v1/", key: "" },
	{ id: "openai", name: "OpenAI", base: "https://api.openai.com/v1", key: "" },
	{ id: "cloudflare", name: "Impala AI", base: SYNC_URL, key: "" },
	{ id: "g", name: "Google", base: "https://generativelanguage.googleapis.com/v1beta/openai", key: "gk" },
], () => AI.listModels({ force: true }), [mlist("a", "b"), mlist("impala-ai"), text("nein", 500)]);
await apiCase("list-models-all-fail", [{ id: "x", name: "X", base: "http://m2:1/v1", key: "k" }], () => AI.listModels({ force: true }), [text("down", 503)]);
await apiCase("ping-ok", [], () => AI.pingProvider({ id: "a", base: " http://p1:1/v1/ ", key: "k" }), [mlist("x")]);
await apiCase("ping-401", [], () => AI.pingProvider({ id: "a", base: "http://p2:1/v1", key: "" }), [text("no", 401)]);
await apiCase("ping-404-v1", [], () => AI.pingProvider({ id: "a", base: "http://p3:1", key: "" }), [text("nf", 404), mlist("m")]);
await apiCase("ping-404-no-v1", [], () => AI.pingProvider({ id: "a", base: "http://p4:1", key: "" }), [text("nf", 404), text("nf", 404)]);
await apiCase("ping-network", [], () => AI.pingProvider({ id: "a", base: "http://p5:1/v1", key: "" }), [{ throw: "Failed to fetch" }]);
await apiCase("ping-empty", [], () => AI.pingProvider({ id: "a", base: "  ", key: "" }), []);
await apiCase("ping-workers", [], () => AI.pingProvider({ id: "a", base: "https://w.workers.dev", key: "" }), [mlist()]);
S.settings.embedModel = "text-embedding-3-small"; S.settings.embedProviderId = "e";
await apiCase("embed-ok", [{ id: "chat", name: "C", base: "http://c:1/v1", key: "" }, { id: "e", name: "E", base: "http://e:1/v1/", key: "ek" }],
	() => AI.embed(["eins", "zwei"]), [json({ data: [{ embedding: [0.5, -1, 2] }, { embedding: [0.25, 0, 1] }] })]);
await apiCase("embed-short", [{ id: "e", name: "E", base: "http://e:1/v1", key: "" }], () => AI.embed(["eins", "zwei"]), [json({ data: [{ embedding: [1] }] })]);
await apiCase("embed-no-data", [{ id: "e", name: "E", base: "http://e:1/v1", key: "" }], () => AI.embed(["eins"]), [json({ nope: 1 })]);
await apiCase("embed-http", [{ id: "e", name: "E", base: "http://e:1/v1", key: "" }], () => AI.embed(["eins"]), [err(400, "falsches Modell")]);
write("api.json", apiCases);

write("env.json", { fixedNowMs: FIXED, syncUrl: SYNC_URL, safetyId: SAFETY_ID, userId: creds.userId, authToken: creds.authToken, image: IMG });
console.log("Golden-Files geschrieben:", fs.readdirSync(outDir).join(", "));
process.exit(0);
