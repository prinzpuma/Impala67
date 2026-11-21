#!/usr/bin/env node
// Lokale Queue-Bridge (OpenAI SSE / JSON) für Multi-Agent-Teacher-Sampling über den echten Rust-Kern.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TASKS } from "./tasks_flat.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const BRIDGE_DIR = join(here, "data/.bridge");
const PORT = Number(process.env.TEACHER_BRIDGE_PORT || 8789);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function shardIds(totalShards, shardIdx, onlyArg) {
	const ids = onlyArg
		? String(onlyArg).split(",").map((s) => s.trim()).filter(Boolean)
		: TASKS.map((t) => t.id);
	return ids.filter((_, i) => i % totalShards === shardIdx);
}

function normalizeReply(raw) {
	const reasoning = String(raw.reasoning_content ?? raw.reasoning ?? "").trim();
	const content = raw.content == null ? "" : String(raw.content);
	const rawCalls = Array.isArray(raw.tool_calls) ? raw.tool_calls : [];
	const toolCalls = rawCalls.map((tc, i) => {
		const fn = tc.function || tc;
		const name = String(fn.name || "");
		const args = typeof fn.arguments === "string" ? fn.arguments : JSON.stringify(fn.arguments ?? {});
		return { id: tc.id || `call_${Date.now()}_${i}`, type: "function", function: { name, arguments: args } };
	});
	return { reasoning_content: reasoning, content, tool_calls: toolCalls };
}

function sendCompletion(res, stream, model, reply) {
	const finish = reply.tool_calls.length ? "tool_calls" : "stop";
	const usage = { prompt_tokens: 1000, completion_tokens: 150, total_tokens: 1150 };
	if (!stream) {
		res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" });
		res.end(JSON.stringify({
			id: `chatcmpl_${Date.now()}`,
			object: "chat.completion",
			model: model || "antigravity-teacher",
			choices: [{
				index: 0,
				message: {
					role: "assistant",
					content: reply.content,
					reasoning_content: reply.reasoning_content,
					...(reply.tool_calls.length ? { tool_calls: reply.tool_calls } : {}),
				},
				finish_reason: finish,
			}],
			usage,
		}));
		return;
	}
	res.writeHead(200, {
		"content-type": "text/event-stream; charset=utf-8",
		"cache-control": "no-cache",
		"access-control-allow-origin": "*",
	});
	const chunk = (delta, finishReason = null, extra = {}) =>
		res.write(`data: ${JSON.stringify({ id: "chatcmpl_bridge", object: "chat.completion.chunk", model, choices: [{ index: 0, delta, finish_reason: finishReason }], ...extra })}\n\n`);
	chunk({ role: "assistant", reasoning_content: reply.reasoning_content });
	if (reply.tool_calls.length) {
		chunk({ tool_calls: reply.tool_calls.map((tc, index) => ({ index, id: tc.id, type: "function", function: tc.function })) });
	}
	if (reply.content) chunk({ content: reply.content });
	chunk({}, finish, { usage });
	res.write("data: [DONE]\n\n");
	res.end();
}

function formatDigest(item) {
	if (!item || item.status !== "pending") return JSON.stringify(item, null, 2);
	const msgs = item.messages || [];
	const hasToolTurn = msgs.some((m) => m.role === "tool");
	const lines = [`=== SHARD ${item.shard} | reqId=${item.reqId} | ${item.progress || ""} ===`];
	const slice = hasToolTurn ? msgs.slice(Math.max(0, msgs.length - 3)) : msgs;
	if (hasToolTurn) lines.push(`[system & earlier ${msgs.length - slice.length} msgs omitted -> ${item.reqFile}]`);
	for (const m of slice) {
		lines.push(`\n--- ${m.role.toUpperCase()}${m.tool_call_id ? ` (${m.tool_call_id})` : ""} ---`);
		if (m.reasoning_content) lines.push(`[think]: ${m.reasoning_content.slice(0, 300)}`);
		if (m.content) lines.push(Array.isArray(m.content)
			? m.content.map((p) => (typeof p === "string" ? p : p?.text ?? `[${p?.type || "Teil"}]`)).join("\n")
			: typeof m.content === "object" ? JSON.stringify(m.content) : String(m.content));
		if (Array.isArray(m.tool_calls) && m.tool_calls.length) {
			lines.push("tool_calls: " + JSON.stringify(m.tool_calls.map((t) => ({ name: t.function?.name, arguments: t.function?.arguments }))));
		}
	}
	return lines.join("\n");
}

async function runServe(args) {
	const shards = Number(args.shards || 4);
	const basePort = Number(args["base-sandbox-port"] || 8020);
	const baseBridge = Number(args["base-bridge-port"] || 8767);
	const port = Number(args.port || PORT);
	const only = args.only || null;
	mkdirSync(BRIDGE_DIR, { recursive: true });

	const state = new Map();
	for (let s = 0; s < shards; s++) {
		state.set(String(s), { pending: null, waiters: [], done: false, exitCode: null, lastLine: "", passed: 0, failed: 0 });
	}

	const notifyWaiters = (s) => {
		const st = state.get(String(s));
		if (!st) return;
		while (st.waiters.length && (st.pending || st.done)) {
			const w = st.waiters.shift();
			w();
		}
	};

	let reqSeq = 1;
	const srv = createServer(async (req, res) => {
		if (req.method === "OPTIONS") {
			res.writeHead(204, {
				"access-control-allow-origin": "*",
				"access-control-allow-headers": "*",
				"access-control-allow-methods": "GET, POST, OPTIONS",
			});
			return res.end();
		}
		const url = new URL(req.url, `http://127.0.0.1:${port}`);
		const chunks = [];
		for await (const c of req) chunks.push(c);
		const bodyStr = Buffer.concat(chunks).toString("utf8");

		const chatMatch = /^\/s\/(\d+)\/v1\/chat\/completions$/.exec(url.pathname);
		if (req.method === "POST" && chatMatch) {
			const shard = chatMatch[1];
			const st = state.get(shard);
			if (!st) return res.writeHead(404).end("Unknown shard");
			const payload = JSON.parse(bodyStr || "{}");
			const reqId = `r${shard}_${reqSeq++}`;
			const reqFile = join(BRIDGE_DIR, `shard_${shard}_last_req.json`);
			writeFileSync(reqFile, JSON.stringify({ reqId, shard, ...payload }, null, 2));
			st.pending = {
				status: "pending",
				shard,
				reqId,
				reqFile,
				progress: `${st.passed}✓ ${st.failed}✗ | ${st.lastLine}`,
				model: payload.model,
				messages: payload.messages || [],
				stream: !!payload.stream,
				resolveReply: (reply) => {
					st.pending = null;
					sendCompletion(res, !!payload.stream, payload.model, reply);
				},
			};
			req.on("close", () => {
				if (st.pending?.reqId === reqId && !res.writableEnded) st.pending = null;
			});
			notifyWaiters(shard);
			return;
		}

		if (req.method === "GET" && url.pathname === "/wait") {
			const shard = String(url.searchParams.get("shard") || "0");
			const timeout = Math.min(30000, Math.max(500, Number(url.searchParams.get("timeout") || 15000)));
			const st = state.get(shard);
			if (!st) return res.writeHead(404).end(JSON.stringify({ error: "Unknown shard" }));
			if (!st.pending && !st.done) {
				await new Promise((doneWait) => {
					const t = setTimeout(() => {
						const i = st.waiters.indexOf(fn);
						if (i >= 0) st.waiters.splice(i, 1);
						doneWait();
					}, timeout);
					const fn = () => { clearTimeout(t); doneWait(); };
					st.waiters.push(fn);
				});
			}
			res.writeHead(200, { "content-type": "application/json" });
			if (st.pending) {
				const { resolveReply, ...pub } = st.pending;
				return res.end(JSON.stringify(pub));
			}
			return res.end(JSON.stringify({ status: st.done ? "done" : "idle", shard, exitCode: st.exitCode, passed: st.passed, failed: st.failed, lastLine: st.lastLine }));
		}

		if (req.method === "POST" && url.pathname === "/reply") {
			const body = JSON.parse(bodyStr || "{}");
			const shard = String(body.shard ?? "0");
			const st = state.get(shard);
			if (!st?.pending) return res.writeHead(409, { "content-type": "application/json" }).end(JSON.stringify({ error: `No pending request on shard ${shard}` }));
			if (body.reqId && st.pending.reqId !== body.reqId) {
				return res.writeHead(409, { "content-type": "application/json" }).end(JSON.stringify({ error: `reqId mismatch: expected ${st.pending.reqId}, got ${body.reqId}` }));
			}
			const reply = normalizeReply(body);
			st.pending.resolveReply(reply);
			res.writeHead(200, { "content-type": "application/json" });
			return res.end(JSON.stringify({ ok: true, shard, reqId: body.reqId || null }));
		}

		if (req.method === "GET" && url.pathname === "/status") {
			const out = {};
			for (const [k, v] of state) out[k] = { pending: v.pending?.reqId || null, done: v.done, exitCode: v.exitCode, passed: v.passed, failed: v.failed, lastLine: v.lastLine };
			res.writeHead(200, { "content-type": "application/json" });
			return res.end(JSON.stringify(out, null, 2));
		}

		res.writeHead(404).end("Not found");
	});

	await new Promise((r) => srv.listen(port, "127.0.0.1", r));
	console.log(`Teacher bridge listening on http://127.0.0.1:${port} (${shards} shards)`);

	const children = [];
	const cleanup = () => {
		for (const c of children) try { c.kill(); } catch {}
		srv.close();
	};
	process.on("SIGINT", () => { cleanup(); process.exit(130); });
	process.on("exit", cleanup);

	// Alle Shards laden dieselbe Kopie; gleichzeitiges Kopieren aus der echten App bricht ab.
	const seedFile = join(BRIDGE_DIR, "sandbox_seed.json");
	if (!existsSync(seedFile) || args["fresh-seed"]) {
		const r = spawnSync(process.execPath, [join(here, "generate_trajectories.mjs"), "--export-seed", seedFile], { cwd: root, stdio: "inherit" });
		if (r.status !== 0 || !existsSync(seedFile)) throw new Error("Seed-Export aus der echten App fehlgeschlagen (App offen?)");
	}

	for (let s = 0; s < shards; s++) {
		const ids = shardIds(shards, s, only);
		if (!ids.length) {
			const st = state.get(String(s));
			st.done = true; st.exitCode = 0;
			continue;
		}
		const outPath = join(here, `data/teacher_shard_${s}.jsonl`);
		const logPath = join(BRIDGE_DIR, `shard_${s}.log`);
		if (args["fresh-data"]) try { rmSync(outPath, { force: true }); } catch {}
		const childArgs = [
			join(here, "generate_trajectories.mjs"),
			"--provider", "teacher",
			"--api-base", `http://127.0.0.1:${port}/s/${s}/v1`,
			"--model", "antigravity-teacher",
			"--sandbox-port", String(basePort + s),
			"--bridge-port", String(baseBridge + s),
			"--seed", seedFile,
			"--fresh",
			"--only", ids.join(","),
			"--out", outPath,
			"--no-split",
			...(args.now ? ["--now", String(args.now)] : []),
		];
		const child = spawn(process.execPath, childArgs, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
		children.push(child);
		const st = state.get(String(s));
		const appendLog = (chunk) => {
			const txt = chunk.toString("utf8");
			writeFileSync(logPath, txt, { flag: "a" });
			for (const l of txt.split(/\r?\n/)) {
				if (!l.trim()) continue;
				st.lastLine = l.trim();
				if (/\s✓\s/.test(l)) st.passed++;
				if (/\s✗\s/.test(l)) st.failed++;
			}
		};
		child.stdout.on("data", appendLog);
		child.stderr.on("data", appendLog);
		child.on("exit", (code) => {
			st.done = true;
			st.exitCode = code;
			notifyWaiters(s);
			console.log(`Shard ${s} exited (${code}): ${st.passed}✓ ${st.failed}✗`);
		});
	}
}

function parseCli(argv) {
	const out = { _: [] };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a.startsWith("--")) {
			const k = a.slice(2);
			const n = argv[i + 1];
			if (n !== undefined && !n.startsWith("--")) { out[k] = n; i++; }
			else out[k] = true;
		} else out._.push(a);
	}
	return out;
}

const cli = parseCli(process.argv.slice(2));
const cmd = cli._[0];

if (cmd === "serve") {
	await runServe(cli);
} else if (cmd === "wait") {
	const shard = String(cli._[1] ?? cli.shard ?? "0");
	const timeout = Number(cli.timeout || 15000);
	const r = await (await fetch(`http://127.0.0.1:${PORT}/wait?shard=${shard}&timeout=${timeout}`)).json();
	console.log(formatDigest(r));
} else if (cmd === "reply") {
	const shard = String(cli._[1] ?? cli.shard ?? "0");
	const src = cli._[2];
	if (!src) throw new Error("Usage: teacher_bridge.mjs reply <shard> <json-or-file-or->");
	const rawText = src === "-" ? readFileSync(0, "utf8") : (existsSync(resolve(src)) ? readFileSync(resolve(src), "utf8") : src);
	const payload = { ...JSON.parse(rawText.replace(/^﻿/, "")), shard };
	const postRes = await fetch(`http://127.0.0.1:${PORT}/reply`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(payload),
	});
	const ack = await postRes.json();
	if (!postRes.ok) { console.error("Reply error:", ack); process.exit(1); }
	if (!cli["no-wait"]) {
		const timeout = Number(cli.timeout || 15000);
		await sleep(100);
		const next = await (await fetch(`http://127.0.0.1:${PORT}/wait?shard=${shard}&timeout=${timeout}`)).json();
		console.log(formatDigest(next));
	} else {
		console.log(JSON.stringify(ack));
	}
} else if (cmd === "status") {
	console.log(await (await fetch(`http://127.0.0.1:${PORT}/status`)).text());
} else {
	console.log("Usage: teacher_bridge.mjs <serve|wait|reply|status> ...");
	process.exit(1);
}
