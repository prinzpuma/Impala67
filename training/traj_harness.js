// Browser-Harness zur Aufnahme echter Trainings-Trajektorien für flache Werkzeuge.
// Läuft ausschließlich in der Spielwiese (web/sandbox.js) über den echten Rust-Agenten (CORE.AiRun)
// und zeichnet jede Anfrage/Antwort inkl. reasoning_content und tool_calls lückenlos auf.
const VERSION = 1;
if (globalThis.__trajGen?.version === VERSION) return { ready: true, version: VERSION, sandbox: true };

const [{ S, STATE }, { TOOLS }, { CORE }, { HEFT }, { RAG }, { SANDBOX }] = await Promise.all([
	import("./state.js"), import("./tools.js"), import("./rust-core.js"),
	import("./heft.js"), import("./rag.js"), import("./sandbox.js"),
]);
if (!SANDBOX.on) throw new Error("Trajektorien-Generator nur in der Spielwiese (web/sandbox.js).");

const enc = new TextEncoder(), dec = new TextDecoder();
const now = () => performance.now();

function mergeToolDeltas(acc, deltas) {
	for (const d of deltas) {
		const idx = d.index ?? 0;
		if (!acc[idx]) acc[idx] = { id: d.id || `call_${idx}`, type: "function", function: { name: "", arguments: "" } };
		const cur = acc[idx];
		if (d.id) cur.id = d.id;
		if (d.function?.name) cur.function.name += d.function.name;
		if (d.function?.arguments) cur.function.arguments += d.function.arguments;
	}
}

function makeHttp(rec, limitMs) {
	function prepare(req) {
		let body = req.body, parsed = null;
		if (body && body.byteLength) {
			try {
				const j = JSON.parse(dec.decode(body));
				parsed = { model: j.model, messages: j.messages || [], tools: j.tools || [] };
				if (j.stream && /\/chat\/completions/.test(req.url) && !j.stream_options) {
					j.stream_options = { include_usage: true };
					body = enc.encode(JSON.stringify(j));
				}
			} catch {}
		}
		return { body, parsed };
	}
	function parseSse(buf, state) {
		state.buf += buf;
		const lines = state.buf.split("\n");
		state.buf = lines.pop();
		for (const line of lines) {
			const m = /^data:\s*(.*)$/.exec(line.trim());
			if (!m || m[1] === "[DONE]") continue;
			let j; try { j = JSON.parse(m[1]); } catch { continue; }
			if (j.usage) state.usage = j.usage;
			const d = j.choices?.[0]?.delta;
			if (!d) continue;
			if (d.reasoning_content) { state.reasoning += d.reasoning_content; state.chunks++; }
			else if (d.reasoning) { state.reasoning += d.reasoning; state.chunks++; }
			if (d.content) { state.content += d.content; state.chunks++; }
			if (Array.isArray(d.tool_calls)) { mergeToolDeltas(state.toolCalls, d.tool_calls); state.chunks++; }
		}
	}
	return {
		async send(req) {
			const { body, parsed } = prepare(req);
			const controller = new AbortController();
			rec.controllers.add(controller);
			const timer = setTimeout(() => controller.abort(), limitMs);
			try {
				const res = await fetch(req.url, { method: req.method, headers: Object.fromEntries(req.headers), body, signal: controller.signal });
				const bytes = new Uint8Array(await res.arrayBuffer());
				try {
					const j = JSON.parse(dec.decode(bytes));
					const msg = j.choices?.[0]?.message;
					if (parsed && msg) {
						rec.trace.push({
							reqMessages: parsed.messages,
							assistant: {
								role: "assistant",
								content: msg.content || "",
								reasoning_content: msg.reasoning_content || msg.reasoning || "",
								...(msg.tool_calls?.length ? { tool_calls: msg.tool_calls } : {}),
							},
							usage: j.usage || null,
						});
					}
				} catch {}
				return { status: res.status, headers: [...res.headers], body: bytes };
			} finally {
				clearTimeout(timer);
				rec.controllers.delete(controller);
			}
		},
		async open(req) {
			const { body, parsed } = prepare(req);
			const controller = new AbortController();
			rec.controllers.add(controller);
			const timer = setTimeout(() => controller.abort(), limitMs);
			const res = await fetch(req.url, { method: req.method, headers: Object.fromEntries(req.headers), body, signal: controller.signal });
			const reader = res.body?.getReader?.();
			const state = { buf: "", reasoning: "", content: "", toolCalls: [], usage: null, chunks: 0 };
			rec.activeState = state;
			let finished = false;
			const finish = () => {
				if (finished) return;
				finished = true;
				clearTimeout(timer);
				rec.controllers.delete(controller);
				if (parsed) {
					const tcs = state.toolCalls.filter(Boolean);
					rec.trace.push({
						reqMessages: parsed.messages,
						assistant: {
							role: "assistant",
							content: state.content,
							reasoning_content: state.reasoning,
							...(tcs.length ? { tool_calls: tcs } : {}),
						},
						usage: state.usage,
					});
				}
			};
			return {
				status: res.status,
				headers: [...res.headers],
				async read() {
					if (!reader) { finish(); return null; }
					try {
						const { value, done } = await reader.read();
						if (done) { finish(); return null; }
						parseSse(dec.decode(value, { stream: true }), state);
						return value;
					} catch (e) { finish(); throw e; }
				},
				cancel() { try { reader?.cancel(); } catch {} controller.abort(); finish(); },
			};
		},
	};
}

async function workspaceFor(title) {
	if (!title) return { ws: { kind: "empty" }, page: null };
	const page = STATE.findPage(title);
	if (!page) throw new Error(`Seite „${title}“ nicht gefunden.`);
	if (page.kind === "heft") {
		const pg = STATE.heftPage(page.id, 0);
		let imageUrl; try { imageUrl = await HEFT.pageAsDataUrl(page.id, 0); } catch {}
		return { page, ws: { kind: "page", title: page.title, context: { kind: "heft", title: page.title, pageIndex: 0, imageUrl,
			texts: (pg?.texts || []).map((t) => String(t?.text || "")).filter(Boolean), ocrText: String(pg?.ocrText || "") } } };
	}
	return { page, ws: { kind: "page", title: page.title, context: { kind: "text", content: String(page.content || "") } } };
}

const convs = new Map(), runs = new Map();
let undos = [];
const DIRTY = "impala67SandboxDirty";
let seq = 0;

function promptNow(at) {
	const d = at ? new Date(at) : new Date();
	return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate(), weekday: d.getDay(), hour: d.getHours(), minute: d.getMinutes() };
}

function stitchTurn(recTrace) {
	if (!recTrace.length) return { system: null, turn: [] };
	const last = recTrace[recTrace.length - 1];
	const msgs = structuredClone(last.reqMessages || []);
	const lastUserIdx = msgs.map((m) => m.role).lastIndexOf("user");
	const turnMsgs = lastUserIdx >= 0 ? msgs.slice(lastUserIdx) : msgs.slice(1);
	const assts = recTrace.map((s) => s.assistant).filter(Boolean);
	let stepIdx = 0;
	for (const m of turnMsgs) {
		if (m.role !== "assistant") continue;
		if (!m.reasoning_content && stepIdx < assts.length - 1) {
			m.reasoning_content = assts[stepIdx]?.reasoning_content || "";
		}
		stepIdx++;
	}
	if (last.assistant) turnMsgs.push(structuredClone(last.assistant));
	return { system: msgs[0]?.role === "system" ? structuredClone(msgs[0]) : null, turn: turnMsgs };
}

async function runTurn(spec, rec) {
	const mcp = spec.profile === "mcp";
	const conv = convs.get(spec.convId) || { chat: [], session: { summary: null, toolsUnlocked: false }, system: null, fullTurns: [] };
	convs.set(spec.convId, conv);
	conv.chat.push({ mid: "traj-" + (++seq), role: "user", content: spec.text, image: null, textFile: null, pdfFile: null });
	const ragQuery = mcp ? "" : CORE.aiRagQuery(String(spec.text || ""));
	let ragHits = [];
	if (ragQuery && RAG.enabled()) { try { ragHits = (await RAG.search(ragQuery, 4)) || []; } catch {} }
	const { ws, page } = mcp ? { ws: { kind: "empty" }, page: null } : await workspaceFor(spec.workspacePage);
	const settings = { providers: spec.providers || S.settings.aiProviders || [], activeProviderId: spec.providerId || "local", model: spec.model, thinkingEnabled: true };
	const executor = {
		async run(name, args) {
			const t = now(); let out;
			try { out = await TOOLS.run(name, args); } catch (error) { out = { error: String(error) }; }
			if (out?._undo) { undos.push(out._undo); try { localStorage.setItem(DIRTY, "1"); } catch {} }
			if (name === "change" && out?.ok) rec.changes.push(...args.operations);
			rec.execTools.push({ name, ms: Math.round(now() - t), error: !!out?.error, detail: out?.error ? String(out.error).slice(0, 200) : undefined });
			return { json: JSON.stringify(out ?? {}) };
		},
		async ask(question, options) {
			let answer = null;
			for (const a of spec.answers || []) {
				const q = a.toLowerCase();
				answer = options.find((o) => o.toLowerCase().startsWith(q)) || options.find((o) => o.toLowerCase().includes(q));
				if (answer) break;
			}
			return answer || options.find((o) => /^ja/i.test(o)) || options[0];
		},
		async heftPage(title, pageNoArg) {
			const index = pageNoArg ? Math.max(0, Math.floor(pageNoArg) - 1) : 0;
			const p = title ? STATE.findPage(title) : null;
			if (!p || p.kind !== "heft") return { pageNo: index + 1, error: `Heft „${title || ""}“ nicht gefunden.` };
			const pg = STATE.heftPage(p.id, index);
			return { pageNo: index + 1, texts: (pg?.texts || []).map((t) => String(t?.text || "")).filter(Boolean), ocrText: String(pg?.ocrText || ""), imageUrl: await HEFT.pageAsDataUrl(p.id, index) };
		},
	};
	const onEvent = (ev) => {
		if (ev.type !== "item") return;
		const it = ev.item;
		if (it.kind === "assistant") conv.chat.push({ mid: "traj-" + (++seq), role: "assistant", content: it.content, model: it.model || undefined });
		else if (it.kind === "thought") conv.chat.push({ mid: "traj-" + (++seq), role: "thought", reasoning: it.reasoning });
		else if (it.kind === "tool") conv.chat.push({ mid: "traj-" + (++seq), role: "tool", name: it.name, detail: it.detail, error: !!it.error });
	};
	const run = new CORE.AiRun(makeHttp(rec, spec.requestLimitMs || 900000));
	rec.cancel = () => { try { run.cancel(); } catch {} for (const c of rec.controllers) c.abort(); };
	try {
		const out = await run.agent({
			settings, options: { cloudflare: null, safetyId: "" },
			customInstructions: mcp ? "" : String(S.settings.customInstructions || "").trim(),
			now: promptNow(spec.now), chat: conv.chat, workspace: ws, ragHits,
			activePage: page ? { id: page.id, title: page.title } : null,
			tools: TOOLS.flatDefs, alwaysSendTools: true,
			embedModel: String(S.settings.embedModel || ""), session: conv.session,
		}, executor, onEvent);
		conv.session = out.session;
		rec.text = out.text;
	} finally { run.free(); }
	const { system, turn } = stitchTurn(rec.trace);
	if (!conv.system && system) conv.system = system;
	conv.fullTurns.push(...turn);
	rec.messages = conv.system ? [structuredClone(conv.system), ...structuredClone(conv.fullTurns)] : structuredClone(conv.fullTurns);
	// Collect flat tool calls made by the model and pair with tool result messages by tool_call_id.
	const toolResults = new Map();
	for (const m of rec.messages) {
		if (m.role === "tool" && m.tool_call_id) {
			let parsed = null; try { parsed = JSON.parse(m.content); } catch {}
			toolResults.set(m.tool_call_id, parsed);
		}
	}
	const modelCalls = [];
	for (const step of rec.trace) {
		for (const tc of step.assistant?.tool_calls || []) {
			const res = toolResults.get(tc.id);
			const err = !!(res && typeof res === "object" && res.error);
			modelCalls.push({ name: tc.function?.name, args: tc.function?.arguments, error: err, detail: err ? String(res.error).slice(0, 200) : undefined });
		}
	}
	rec.tools = modelCalls;
}

globalThis.__trajGen = {
	version: VERSION,
	start(spec) {
		const id = "t-" + (++seq);
		const rec = { id, state: "running", t0: now(), trace: [], execTools: [], tools: [], changes: [], controllers: new Set(), text: "", messages: [], error: null };
		runs.set(id, rec);
		runTurn(spec, rec).then(() => { rec.state = "done"; }, (e) => { rec.state = "error"; rec.error = String(e?.message || e); })
			.finally(() => { rec.wallMs = Math.round(now() - rec.t0); });
		return id;
	},
	poll(id) {
		const rec = runs.get(id);
		if (!rec) return { state: "missing" };
		if (rec.state === "running") {
			const tools = rec.trace.flatMap((s) => (s.assistant?.tool_calls || []).map((t) => t.function?.name)).filter(Boolean);
			return { state: "running", ms: Math.round(now() - rec.t0), requests: rec.trace.length, chunks: rec.activeState?.chunks || 0, tools };
		}
		runs.delete(id);
		const { controllers, cancel, trace, execTools, ...out } = rec;
		return out;
	},
	cancel(id) { runs.get(id)?.cancel?.(); return true; },
	async reset(convId) {
		if (convId) convs.delete(convId); else convs.clear();
		let undone = 0, failed = 0;
		for (const u of undos.reverse()) {
			try { const r = await TOOLS.undo(u); if (r?.error) failed++; else undone++; } catch { failed++; }
		}
		undos = [];
		if (!failed) try { localStorage.removeItem(DIRTY); } catch {}
		return { undone, failed };
	},
};
return { ready: true, version: VERSION, sandbox: true };
