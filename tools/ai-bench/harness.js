// Browser-Seite des KI-Benchmarks (tools/ai-bench/run.mjs schickt diese Datei per impala_eval).
// Ruft den echten Agenten des Rust-Kerns (CORE.AiRun) mit den echten Werkzeugen der App auf –
// aber an der App vorbei: kein Chat wird gespeichert, S.settings bleibt unverändert und
// Schreib-Werkzeuge (change) werden nur protokolliert, nie ausgeführt. Lese-Werkzeuge
// (inspect, calculate, view_heft_page, Notizsuche) laufen echt auf den Nutzerdaten.
// Misst je Anfrage: Wartezeit bis zum ersten Token, Prompt-/Antwort-Token (usage von LM Studio),
// Prefill- und Decode-Geschwindigkeit.
const VERSION = 3;
if (globalThis.__aiBench?.version === VERSION) return { ready: true, version: VERSION };

const [{ S, STATE }, { TOOLS }, { CORE }, { HEFT }, { RAG }, { BUS }] = await Promise.all([
	import("./state.js"), import("./tools.js"), import("./rust-core.js"),
	import("./heft.js"), import("./rag.js"), import("./event-bus.js"),
]);

const enc = new TextEncoder(), dec = new TextDecoder();
const now = () => performance.now();
const clip = (s, n) => { s = String(s ?? ""); return s.length > n ? s.slice(0, n) + `… [+${s.length - n}]` : s; };
const KNOWN_OPS = new Set(["page.create", "page.append", "page.replace", "page.patch", "page.rename", "page.move", "page.trash",
	"page.archive", "page.unarchive", "heft.append", "card.create", "card.update", "card.move", "card.trash", "card.suspend",
	"card.reset", "deck.create", "deck.rename", "deck.move", "deck.trash"]);

// ---------- HTTP mit Messung ----------
function makeHttp(rec, limitMs) {
	function prepare(req) {
		let body = req.body, info = {};
		if (body && body.byteLength) {
			try {
				const j = JSON.parse(dec.decode(body));
				const msgs = j.messages || [];
				info = {
					model: j.model, messages: msgs.length, tools: (j.tools || []).length, stream: !!j.stream,
					promptChars: JSON.stringify(msgs).length,
					images: msgs.reduce((n, m) => n + (Array.isArray(m.content) ? m.content.filter((p) => p.type === "image_url").length : 0), 0),
				};
				// Exakte Token-Zahlen: LM Studio schickt usage nur mit include_usage.
				if (j.stream && /\/chat\/completions/.test(req.url) && !j.stream_options) {
					j.stream_options = { include_usage: true };
					body = enc.encode(JSON.stringify(j));
				}
			} catch { info = { bytes: body.byteLength }; }
		}
		return { body, info };
	}
	async function start(req) {
		const { body, info } = prepare(req);
		const r = { path: new URL(req.url).pathname, ...info, t0: now(), tHead: 0, tFirst: 0, tEnd: 0, status: 0,
			chunks: { content: 0, reasoning: 0, tool: 0 }, usage: null, error: null };
		rec.requests.push(r);
		const controller = new AbortController();
		rec.controllers.add(controller);
		const timer = setTimeout(() => controller.abort(), limitMs);
		try {
			const res = await fetch(req.url, { method: req.method, headers: Object.fromEntries(req.headers), body, signal: controller.signal });
			r.tHead = now(); r.status = res.status;
			return { res, r, controller, done: () => { clearTimeout(timer); rec.controllers.delete(controller); r.tEnd ||= now(); } };
		} catch (error) {
			clearTimeout(timer); rec.controllers.delete(controller);
			r.error = String(error?.message || error); r.tEnd = now();
			throw error;
		}
	}
	function scan(r, state, text) {
		state.buf += text;
		const lines = state.buf.split("\n");
		state.buf = lines.pop();
		for (const line of lines) {
			const m = /^data:\s*(.*)$/.exec(line.trim());
			if (!m || m[1] === "[DONE]") continue;
			let j; try { j = JSON.parse(m[1]); } catch { continue; }
			if (j.usage) r.usage = j.usage;
			const d = j.choices?.[0]?.delta;
			if (!d) continue;
			const hit = (k, v) => { if (v) { r.chunks[k]++; if (!r.tFirst) r.tFirst = now(); } };
			hit("content", d.content);
			hit("reasoning", d.reasoning_content || d.reasoning);
			hit("tool", Array.isArray(d.tool_calls) && d.tool_calls.length);
		}
	}
	return {
		async send(req) {
			const { res, r, done } = await start(req);
			try {
				const bytes = new Uint8Array(await res.arrayBuffer());
				try { const j = JSON.parse(dec.decode(bytes)); if (j.usage) r.usage = j.usage; } catch {}
				r.tFirst ||= now();
				return { status: res.status, headers: [...res.headers], body: bytes };
			} finally { done(); }
		},
		async open(req) {
			const { res, r, controller, done } = await start(req);
			const reader = res.body?.getReader?.();
			const state = { buf: "" }, td = new TextDecoder();
			let finished = false;
			const finish = () => { if (!finished) { finished = true; done(); } };
			return {
				status: res.status, headers: [...res.headers],
				async read() {
					if (!reader) { finish(); return null; }
					try {
						const { value, done: end } = await reader.read();
						if (end) { finish(); return null; }
						scan(r, state, td.decode(value, { stream: true }));
						return value;
					} catch (error) { r.error = String(error?.message || error); finish(); throw error; }
				},
				cancel() { try { reader?.cancel(); } catch {} controller.abort(); finish(); },
			};
		},
	};
}

// ---------- Arbeitsbereich wie in ai.js (nur lesend) ----------
async function workspaceFor(title) {
	if (!title) return { ws: { kind: "empty" }, page: null };
	const page = STATE.findPage(title);
	if (!page) throw new Error(`Benchmark: Seite „${title}“ nicht gefunden.`);
	if (page.kind === "heft") {
		const pg = STATE.heftPage(page.id, 0);
		let imageUrl; try { imageUrl = await HEFT.pageAsDataUrl(page.id, 0); } catch {}
		return { page, ws: { kind: "page", title: page.title, context: { kind: "heft", title: page.title, pageIndex: 0, imageUrl,
			texts: (pg?.texts || []).map((t) => String(t?.text || "")).filter(Boolean), ocrText: String(pg?.ocrText || "") } } };
	}
	return { page, ws: { kind: "page", title: page.title, context: { kind: "text", content: String(page.content || "") } } };
}
async function heftPage(rec, title, pageNoArg) {
	const t0 = now(); let pageNo = 0;
	try {
		let id;
		if (title) {
			const page = STATE.findPage(title);
			if (!page) throw new Error(`Keine Seite mit Titel „${title}“ gefunden.`);
			if (page.kind !== "heft") throw new Error(`„${page.title}“ ist kein Handschrift-Heft.`);
			id = page.id;
		} else throw new Error("Es ist gerade kein Heft geöffnet — bitte page_title angeben.");
		const index = pageNoArg ? Math.max(0, Math.floor(pageNoArg) - 1) : 0;
		pageNo = index + 1;
		const pg = STATE.heftPage(id, index);
		const out = { pageNo, texts: (pg?.texts || []).map((t) => String(t?.text || "")).filter(Boolean),
			ocrText: String(pg?.ocrText || ""), imageUrl: await HEFT.pageAsDataUrl(id, index) };
		rec.tools.push({ name: "view_heft_page", args: JSON.stringify({ title, page: pageNoArg }), ms: Math.round(now() - t0), error: false, resultChars: out.ocrText.length });
		return out;
	} catch (error) {
		rec.tools.push({ name: "view_heft_page", args: JSON.stringify({ title, page: pageNoArg }), ms: Math.round(now() - t0), error: true, resultChars: 0, detail: String(error?.message || error) });
		return { pageNo, error: String(error?.message || error) };
	}
}

// ---------- Ein Gesprächsschritt ----------
const convs = new Map(), runs = new Map();
let seq = 0;
function prompt() {
	const d = new Date();
	return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate(), weekday: d.getDay(), hour: d.getHours(), minute: d.getMinutes() };
}
async function turn(spec, rec) {
	const conv = convs.get(spec.convId) || { chat: [], session: { summary: null, toolsUnlocked: false } };
	convs.set(spec.convId, conv);
	const user = { mid: "bench-" + (++seq), role: "user", content: spec.text, image: null, textFile: null, pdfFile: spec.pdfFile || null };
	conv.chat.push(user);
	const t0 = now();
	const ragQuery = CORE.aiRagQuery(String(spec.text || ""));
	let ragHits = [];
	if (ragQuery && RAG.enabled()) { try { ragHits = (await RAG.search(ragQuery, 4)) || []; } catch (e) { rec.ragError = String(e?.message || e); } }
	rec.rag = { query: ragQuery || null, hits: ragHits.map((h) => h.title || h.pageTitle || "?"), ms: Math.round(now() - t0) };
	const { ws, page } = await workspaceFor(spec.workspacePage);
	const extra = BUS.call("exp:extra-tool-defs");
	const settings = { providers: S.settings.aiProviders || [], activeProviderId: spec.providerId || "local", model: spec.model, thinkingEnabled: spec.thinking !== false };
	rec.config = CORE.aiChatConfig(settings);
	const executor = {
		async run(name, args) {
			const t = now(); let out;
			if (name === "change") {
				const ops = Array.isArray(args?.operations) ? args.operations : [];
				rec.changes.push(...ops);
				const unknown = ops.filter((o) => !KNOWN_OPS.has(o?.op)).map((o) => o?.op || "(leer)");
				out = !ops.length ? { error: "change: operations fehlt." }
					: unknown.length ? { error: `change: unbekannte Operation(en): ${unknown.join(", ")}. Keine Änderungen ausgeführt.` }
					: { ok: true, operations: ops.length, changedObjects: ops.length, results: ops.map((o) => ({ op: o.op, ok: true })) };
			} else {
				try { out = await TOOLS.run(name, args); } catch (error) { out = { error: String(error) }; }
			}
			const json = JSON.stringify(out ?? {});
			rec.tools.push({ name, args: clip(JSON.stringify(args), 800), ms: Math.round(now() - t), error: !!out?.error, resultChars: json.length, detail: out?.error ? clip(out.error, 300) : undefined });
			return { json };
		},
		async ask(question, options) {
			const pick = (spec.answers || []).find((a) => options.some((o) => o.toLowerCase().startsWith(a.toLowerCase())));
			const answer = pick ? options.find((o) => o.toLowerCase().startsWith(pick.toLowerCase())) : (options.find((o) => /^ja/i.test(o)) || options[0]);
			rec.asks.push({ question: clip(question, 400), options, answer });
			return answer;
		},
		heftPage: (title, page) => heftPage(rec, title, page),
	};
	const onEvent = (ev) => {
		if (ev.type !== "item") return;
		const it = ev.item;
		rec.items.push({ kind: it.kind, text: clip(it.content || it.reasoning || it.summary || it.detail || it.name || "", 4000) });
		if (it.kind === "assistant") conv.chat.push({ mid: "bench-" + (++seq), role: "assistant", content: it.content, model: it.model || undefined });
		else if (it.kind === "thought") conv.chat.push({ mid: "bench-" + (++seq), role: "thought", reasoning: it.reasoning });
		else if (it.kind === "tool") conv.chat.push({ mid: "bench-" + (++seq), role: "tool", name: it.name, detail: it.detail, error: !!it.error });
	};
	const run = new CORE.AiRun(makeHttp(rec, spec.requestLimitMs || 900000));
	rec.cancel = () => { try { run.cancel(); } catch {} for (const c of rec.controllers) c.abort(); };
	try {
		const out = await run.agent({
			settings, options: { cloudflare: null, safetyId: "" }, customInstructions: String(S.settings.customInstructions || "").trim(), now: prompt(),
			chat: conv.chat, workspace: ws, ragHits, activePage: page ? { id: page.id, title: page.title } : null,
			tools: Array.isArray(extra) ? TOOLS.defs.concat(extra) : TOOLS.defs.slice(),
			alwaysSendTools: S.settings.alwaysSendTools !== false, embedModel: String(S.settings.embedModel || ""), session: conv.session,
		}, executor, onEvent);
		conv.session = out.session;
		rec.text = out.text;
		rec.summary = conv.session?.summary ? clip(conv.session.summary, 1500) : null;
	} finally { run.free(); }
	rec.chatLen = conv.chat.length;
}

globalThis.__aiBench = {
	version: VERSION,
	start(spec) {
		const id = "run-" + (++seq);
		const rec = { id, state: "running", t0: now(), requests: [], tools: [], changes: [], asks: [], items: [], controllers: new Set(), text: "", error: null };
		runs.set(id, rec);
		turn(spec, rec).then(() => { rec.state = "done"; }, (e) => { rec.state = "error"; rec.error = String(e?.message || e); })
			.finally(() => { rec.wallMs = Math.round(now() - rec.t0); });
		return id;
	},
	poll(id) {
		const rec = runs.get(id);
		if (!rec) return { state: "missing" };
		if (rec.state === "running") {
			const last = rec.requests[rec.requests.length - 1];
			return { state: "running", ms: Math.round(now() - rec.t0), requests: rec.requests.length, tools: rec.tools.map((t) => t.name),
				lastChunks: last ? last.chunks.content + last.chunks.reasoning + last.chunks.tool : 0 };
		}
		runs.delete(id);
		const { controllers, cancel, ...plain } = rec;
		const base = rec.t0;
		plain.requests = rec.requests.map((r) => ({ ...r, t0: Math.round(r.t0 - base), tHead: r.tHead ? Math.round(r.tHead - base) : 0,
			tFirst: r.tFirst ? Math.round(r.tFirst - base) : 0, tEnd: r.tEnd ? Math.round(r.tEnd - base) : 0 }));
		return plain;
	},
	cancel(id) { runs.get(id)?.cancel?.(); return true; },
	reset(convId) { if (convId) convs.delete(convId); else convs.clear(); return true; },
	// Lesender Helfer: OCR-Text eines Heft-Seitenbereichs (für das PDF-Szenario).
	heftText(title, from, to) {
		const page = STATE.findPage(title);
		if (!page || page.kind !== "heft") return null;
		const parts = [];
		for (let i = from - 1; i < to; i++) {
			const pg = STATE.heftPage(page.id, i);
			if (!pg) break;
			parts.push(`--- Seite ${i + 1} ---\n${String(pg.ocrText || "").trim()}`);
		}
		return parts.join("\n\n");
	},
};
return { ready: true, version: VERSION, rag: RAG.enabled() };
