"use strict";

import { S, STATE } from "./state.js";
import { TOOLS } from "./tools.js";
import { U } from "./util.js";
import { RENDER } from "./render.js";
import { CHATS } from "./chats.js";
import { THINK } from "./think-heuristik.js";
import { RAG } from "./rag.js";

export const AI = (() => {
	const MODEL_PRESETS = [
		{ value: "gemini-2.5-flash", label: "Gemini 2.5 Flash", provider: "google" },
		{ value: "gemini-2.5-pro", label: "Gemini 2.5 Pro", provider: "google" },
		{ value: "gemma-4-31b-it", label: "Gemma 4 31B", provider: "google" },
		{ value: "gemma-4-26b-a4b-it", label: "Gemma 4 26B A4B", provider: "google" },
		{ value: "gpt-4.1", label: "GPT-4.1", provider: "openai" },
		{ value: "gpt-4.1-mini", label: "GPT-4.1 mini", provider: "openai" },
		{ value: "local-model", label: "Lokales Modell", provider: "local" },
	];
	const LIMIT = { agentSteps: 12, debug: 40, modelsMs: 5000, modelCacheMs: 30000, images: 2, toolTotal: 24000, toolResult: 6000 };
	const MUTATING_TOOLS = new Set(["create_page", "append_to_page", "replace_page_content", "change"]);
	const DROP_SCHEMA_KEYS = new Set(["minItems", "maxItems", "additionalProperties", "default", "$schema", "examples"]);
	const TOOL_DROPPED = JSON.stringify({ gekuerzt: true, hinweis: "Älteres Ergebnis aus Platzgründen entfernt — bei Bedarf erneut abrufen." });
	const META_TOOL_DEF = {
		type: "function",
		function: {
			name: "request_tools",
			description: "Schaltet die vollständige Werkzeugliste frei (Notizen lesen/erstellen/ändern, Suche, Karteikarten, NotebookLM …). Rufe dieses Werkzeug auf, sobald die Anfrage Zugriff auf Notizen, Karten, Hefte oder Aktionen im Workspace erfordern könnte.",
			parameters: { type: "object", properties: {}, required: [] },
		},
	};
	const ABORTED = Symbol("aborted");
	const pendingChoices = Object.create(null);
	const chatSummaries = Object.create(null);
	const toolsUnlocked = new Set();
	const familyCache = new Map();
	const activeControllers = new Set();
	const pendingSleeps = new Set();
	const debugLog = [];
	const modelCache = new Map();
	const modelRequests = new Map();
	const splitThink = THINK.splitThink;
	function sleep(ms) {
		if (!ms) return Promise.resolve();
		return new Promise((resolve, reject) => {
			const entry = { timer: 0, reject };
			entry.timer = setTimeout(() => {
				pendingSleeps.delete(entry);
				resolve();
			}, ms);
			pendingSleeps.add(entry);
		});
	}
	const providers = () => S.settings.aiProviders || [];
	const cleanBase = (base) => String(base || "").replace(/\/+$/, "");
	const currentPage = () => (S.currentPageId ? S.pages[S.currentPageId] : null);
	const auth = (key) => (key ? { Authorization: "Bearer " + key } : {});
	const errorText = (error) => String(error?.message || error);

	function debugEvent(kind, detail) {
		debugLog.push({ at: new Date().toISOString(), kind, detail });
		if (debugLog.length > LIMIT.debug) debugLog.splice(0, debugLog.length - LIMIT.debug);
	}
	function debugReport() {
		const { base, model, providerId } = cfg();
		const rows = debugLog.map((e) => `[${e.at}] ${e.kind}\n${JSON.stringify(e.detail, null, 2)}`);
		return [
			"Impala67 KI-Debugprotokoll", "Erstellt: " + new Date().toISOString(),
			"Provider: " + (providerId || "—"), "Modell: " + (model || "—"), "Endpoint: " + (base || "—"),
			"Hinweis: API-Schlüssel und Nutzereingaben sind nicht enthalten. Gekürzte Modellantworten können jedoch Inhalte daraus wiedergeben.", "",
			rows.length ? rows.join("\n\n") : "Noch keine KI-Anfrage in dieser Sitzung protokolliert.",
		].join("\n");
	}

	function activeProvider() {
		return providers().find((p) => p.id === S.settings.aiProviderId) || providers()[0] || null;
	}
	const providerById = (id) => (id && providers().find((p) => p.id === id)) || null;
	const embedProvider = () => providerById(S.settings.embedProviderId) || activeProvider();
	function providerFamily(provider) {
		const key = [provider?.id || "", provider?.name || "", provider?.base || ""].join(" | ");
		if (familyCache.has(key)) return familyCache.get(key);
		const tag = [provider?.id, provider?.name].filter(Boolean).join(" ").toLowerCase();
		const base = String(provider?.base || "").toLowerCase();
		const family = /localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|\.local(?::|\/|$)/.test(base) || /\b(local|lm[\s-]?studio|ollama|llama\.cpp|jan)\b/.test(tag) ? "local"
			: /generativelanguage|googleapis|google/.test(base) || /\b(google|gemini|gemma)\b/.test(tag) ? "google"
				: /api\.openai\.com/.test(base) || /\bopenai\b/.test(tag) ? "openai" : "other";
		familyCache.set(key, family);
		return family;
	}
	function cfg() {
		const provider = activeProvider();
		return { base: cleanBase(provider?.base), key: provider?.key || "", model: S.settings.aiModel || "", providerId: provider?.id || "", family: providerFamily(provider) };
	}
	const capKey = (c = cfg()) => [c.providerId, c.base, c.model].join("::");
	const capStore = () => S.thinkingCapabilities || (S.thinkingCapabilities = Object.create(null));
	function declaredThinkingCapabilities(c) {
		return c.family === "google" && /^gemini-2\.5-(flash|pro)/i.test(c.model)
			? { levels: ["low", "medium", "high"], includeThoughts: true, source: "gemini-openai" }
			: { levels: [], includeThoughts: false, source: "none" };
	}
	async function detectThinkingCapabilities() {
		const c = cfg(), store = capStore(), key = capKey(c);
		if (store[key]) return store[key];
		const d = declaredThinkingCapabilities(c);
		const cap = store[key] = { state: "ready", ...d, error: c.model && !d.levels.length ? "Für dieses Modell ist über den aktuellen Chat-Adapter keine steuerbare Thinking-Stufe dokumentiert." : "" };
		debugEvent("Thinking-Fähigkeiten", { provider: c.providerId, model: c.model, state: cap.state, levels: cap.levels, source: cap.source, passive: true });
		return cap;
	}

	class AiHttpError extends Error {
		constructor(status, text, retryAfterMs = 0) {
			super(`KI-Fehler ${status}: ${String(text || "").slice(0, 300)}`);
			this.status = status;
			this.retryAfterMs = Number.isFinite(retryAfterMs) ? Math.min(Math.max(retryAfterMs, 0), 60000) : 0;
		}
	}
	function retryAfterMs(res) {
		const raw = res.headers.get("retry-after");
		if (!raw) return 0;
		const seconds = Number(raw);
		if (Number.isFinite(seconds)) return seconds * 1000;
		const date = Date.parse(raw);
		return Number.isFinite(date) ? date - Date.now() : 0;
	}
	function trackedController() {
		const controller = new AbortController();
		activeControllers.add(controller);
		return { controller, done: () => activeControllers.delete(controller) };
	}
	function abortActive() {
		for (const controller of activeControllers) controller.abort();
		activeControllers.clear();
		for (const entry of pendingSleeps) {
			clearTimeout(entry.timer);
			pendingSleeps.delete(entry);
			const error = new Error("Abgebrochen.");
			error.name = "AbortError";
			entry.reject(error);
		}
		for (const mid of Object.keys(pendingChoices)) {
			const resolve = pendingChoices[mid];
			delete pendingChoices[mid];
			resolve(ABORTED);
		}
	}
	function contentChars(content) {
		if (typeof content === "string") return content.length;
		if (!Array.isArray(content)) return content ? 1 : 0;
		return content.reduce((sum, part) => sum + (typeof part?.text === "string" ? part.text.length : 0), 0);
	}
	function requestMeta(path, body, providerId) {
		const messageMeta = (body.messages || []).map((m) => ({
			role: m?.role || "?", chars: contentChars(m?.content),
			images: Array.isArray(m?.content) ? m.content.filter((p) => p?.type === "image_url").length : 0,
			hasToolCalls: !!m?.tool_calls?.length,
		}));
		const toolNames = (body.tools || []).map((t) => t.function?.name).filter(Boolean);
		return {
			path, provider: providerId || "—", model: body.model || "—", stream: !!body.stream,
			messageCount: messageMeta.length, messageChars: messageMeta.reduce((sum, m) => sum + m.chars, 0), messageMeta,
			toolCount: toolNames.length, toolChoice: body.tool_choice || null, toolNames,
			temperature: body.temperature, thinkingExtras: !!body.extra_body || !!body.reasoning_effort,
			reasoningEffort: body.reasoning_effort || null,
		};
	}
	async function request(path, body) {
		const { base, key, providerId } = cfg();
		if (!base) throw new Error("Kein KI-Server konfiguriert (Einstellungen → KI).");
		const started = performance.now(), meta = requestMeta(path, body, providerId), op = trackedController();
		debugEvent("HTTP-Anfrage", meta);
		let res;
		try {
			res = await fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json", ...auth(key) }, body: JSON.stringify(body), signal: op.controller.signal });
		} catch (error) {
			op.done();
			debugEvent("Netzwerkfehler", { ...meta, ms: Math.round(performance.now() - started), error: errorText(error) });
			throw error;
		}
		const requestId = res.headers.get("x-request-id") || res.headers.get("x-goog-request-id") || null;
		const ms = Math.round(performance.now() - started);
		if (!res.ok) {
			const text = await res.text().catch(() => "");
			op.done();
			debugEvent("HTTP-Fehler", { ...meta, status: res.status, requestId, ms, response: text.slice(0, 1000) });
			throw new AiHttpError(res.status, text, retryAfterMs(res));
		}
		debugEvent("HTTP-Erfolg", { ...meta, status: res.status, requestId, ms });
		return { res, done: op.done };
	}

	function sanitizeSchema(value) {
		if (!value || typeof value !== "object") return value;
		if (Array.isArray(value)) return value.map(sanitizeSchema);
		return Object.fromEntries(Object.entries(value).filter(([key]) => !DROP_SCHEMA_KEYS.has(key)).map(([key, item]) => [key, sanitizeSchema(item)]));
	}
	function toolsForRequest(tools, family) {
		if (!tools?.length) return undefined;
		if (family !== "google") return tools;
		return tools.map(({ type, function: f }) => ({ type, function: { name: f.name, description: f.description, parameters: sanitizeSchema(f.parameters) } }));
	}
	const fullToolDefs = () => typeof window.EXP?.extraToolDefs === "function" ? TOOLS.defs.concat(window.EXP.extraToolDefs()) : TOOLS.defs.slice();

	const modelSourceKey = (base, key) => cleanBase(base) + "\n" + String(key || "");
	async function modelIds(base, key, { force = false } = {}) {
		const sourceKey = modelSourceKey(base, key);
		const cached = modelCache.get(sourceKey);
		if (!force && cached && Date.now() - cached.at < LIMIT.modelCacheMs) return cached.ids.slice();
		if (modelRequests.has(sourceKey)) return (await modelRequests.get(sourceKey)).slice();
		const load = fetch(cleanBase(base) + "/models", { headers: auth(key), signal: AbortSignal.timeout(LIMIT.modelsMs) })
			.then(async (res) => {
				if (!res.ok) throw new AiHttpError(res.status, await res.text().catch(() => ""));
				const ids = ((await res.json()).data || []).map((m) => m?.id).filter(Boolean);
				modelCache.set(sourceKey, { at: Date.now(), ids });
				return ids;
			})
			.catch((error) => {
				if (error?.name === "TimeoutError") throw new Error(`Zeitüberschreitung nach ${Math.round(LIMIT.modelsMs / 1000)} s — der Server hat nicht geantwortet.`);
				throw error;
			})
			.finally(() => modelRequests.delete(sourceKey));
		modelRequests.set(sourceKey, load);
		return (await load).slice();
	}
	async function ping() {
		const { base, key } = cfg();
		if (!base) return false;
		try { await modelIds(base, key, { force: true }); return true; } catch { return false; }
	}
	function modelProviders() {
		return providers().filter((p) => {
			const base = cleanBase(p.base).toLowerCase();
			const officialCloud = /(?:api\.openai\.com|generativelanguage\.googleapis\.com)/.test(base);
			return base && (p.key || !officialCloud);
		});
	}
	async function listModels({ force = false } = {}) {
		const sources = modelProviders();
		if (!sources.length) return [];
		const results = await Promise.allSettled(sources.map(async (p) =>
			(await modelIds(p.base, p.key, { force })).map((id) => ({ id, providerId: p.id }))));
		const found = results.flatMap((result) => result.status === "fulfilled" ? result.value : []);
		if (!found.length && results.every((result) => result.status === "rejected")) throw results[0].reason;
		return found;
	}
	const isEmbeddingModel = (id) => /(?:^|[-_/.])(embed(?:ding)?|text-embedding|nomic-embed|bge|e5|gte|jina-embeddings?|voyage|mxbai-embed|snowflake-arctic-embed)(?:$|[-_/.])/i.test(String(id || ""));
	async function listEmbeddingModels() {
		return (await Promise.all(modelProviders().map(async (p) => {
			try {
				return (await modelIds(p.base, p.key)).filter(isEmbeddingModel).sort((a, b) => String(a).localeCompare(String(b))).map((id) => ({ id, providerId: p.id, providerName: p.name || p.id }));
			} catch { return []; }
		}))).flat();
	}
	async function embed(texts) {
		if (!S.settings.embedModel) throw new Error("Kein Embedding-Modell konfiguriert.");
		const provider = embedProvider();
		if (!provider?.base) throw new Error("Keine Quelle für Embeddings konfiguriert (Einstellungen → KI).");
		const started = performance.now(), op = trackedController();
		let res;
		try {
			res = await fetch(cleanBase(provider.base) + "/embeddings", {
				method: "POST", headers: { "Content-Type": "application/json", ...auth(provider.key) },
				body: JSON.stringify({ model: S.settings.embedModel, input: texts }), signal: op.controller.signal,
			});
		} catch (error) {
			debugEvent("Embedding-Netzwerkfehler", { provider: provider.id, model: S.settings.embedModel, error: errorText(error) });
			throw error;
		} finally {
			if (!res) op.done();
		}
		try {
			if (!res.ok) {
				const text = await res.text().catch(() => "");
				debugEvent("Embedding-Fehler", { provider: provider.id, model: S.settings.embedModel, status: res.status, ms: Math.round(performance.now() - started), response: text.slice(0, 400) });
				throw new AiHttpError(res.status, text);
			}
			const data = (await res.json())?.data;
			if (!Array.isArray(data)) throw new Error("Unerwartete Antwort der Embedding-Quelle (kein data-Feld).");
			const vectors = data.map((d) => d.embedding);
			if (vectors.length !== texts.length || vectors.some((v) => !Array.isArray(v) || !v.length)) throw new Error(`Embedding-Quelle lieferte unvollstaendige Vektoren (${vectors.length}/${texts.length}).`);
			return vectors;
		} finally { op.done(); }
	}
	async function pingProvider(provider) {
		if (!provider || !String(provider.base || "").trim()) return { ok: false, error: "Keine Server-URL eingetragen." };
		const base = cleanBase(String(provider.base).trim()), started = performance.now(), elapsed = () => Math.round(performance.now() - started);
		try {
			const ids = await modelIds(base, provider.key);
			return { ok: true, models: ids.length, ms: elapsed() };
		} catch (error) {
			if (error instanceof AiHttpError) {
				if ([401, 403].includes(error.status)) return { ok: false, ms: elapsed(), status: error.status, error: `Server erreichbar, aber der API-Key fehlt oder ist ungültig (HTTP ${error.status}).` };
				if (error.status === 404 && !/\/v\d+/i.test(base)) {
					try {
						await modelIds(base + "/v1", provider.key);
						return { ok: false, ms: elapsed(), status: 404, suggestedBase: base + "/v1", error: `Unter dieser URL gibt es keinen /models-Endpunkt — mit „${base}/v1“ antwortet der Server.` };
					} catch {}
				}
				return { ok: false, ms: elapsed(), status: error.status, error: `Server antwortet mit HTTP ${error.status}. Prüfe, ob die URL auf den OpenAI-kompatiblen API-Stamm zeigt (endet meist auf /v1).` };
			}
			return { ok: false, ms: elapsed(), error: `Keine Verbindung: ${errorText(error)}. Mögliche Ursachen: Server läuft nicht, falscher Port, oder CORS blockiert (LM Studio: Developer → „Enable CORS“ aktivieren).` };
		}
	}

	function applyThinking(body, enabled, c) {
		if (!enabled || S.settings.thinkingEnabled === false) return;
		const cap = capStore()[capKey(c)] || declaredThinkingCapabilities(c);
		if (c.family === "google" && cap.includeThoughts) body.extra_body = { google: { thinking_config: { include_thoughts: true } } };
	}
	const isThoughtPart = (part) => part && (part.thought === true || ["thinking", "thought", "reasoning"].includes(part.type));
	function reasoningFrom(value) {
		if (!value || typeof value !== "object") return "";
		if (typeof value.reasoning_content === "string" && value.reasoning_content) return value.reasoning_content;
		if (typeof value.reasoning === "string" && value.reasoning) return value.reasoning;
		return Array.isArray(value.content) ? value.content.filter(isThoughtPart).map((part) => part.text || part.content || "").join("") : "";
	}
	function textFrom(content) {
		if (content == null) return "";
		if (typeof content === "string") return content;
		if (!Array.isArray(content)) return String(content);
		return content.filter((part) => !isThoughtPart(part)).map((part) => typeof part === "string" ? part : part?.text || part?.content || "").join("");
	}
	function copyThoughtMetadata(source, target, enabled) {
		if (!enabled || !source || !target) return;
		const extra = source.extra_content;
		const signature = source.thought_signature || source.thoughtSignature || extra?.google?.thought_signature || extra?.google?.thoughtSignature;
		if (signature) target.thought_signature = signature;
		if (extra && typeof extra === "object") target.extra_content = JSON.parse(JSON.stringify(extra));
	}
	function normalizeToolCalls(message) {
		if (!Array.isArray(message.tool_calls)) return;
		message.tool_calls = message.tool_calls.filter((call) => call?.function?.name);
		message.tool_calls.forEach((call, i) => { if (!call.id) call.id = `call_${i}_${U.uid().slice(0, 8)}`; });
		if (!message.tool_calls.length) delete message.tool_calls;
	}
	function finishMessage(data) {
		const message = data?.choices?.[0]?.message || { role: "assistant", content: "" };
		const raw = textFrom(message.content), apiReasoning = reasoningFrom(message), split = splitThink(raw, !!apiReasoning);
		normalizeToolCalls(message);
		message.content = split.content;
		let reasoning = apiReasoning;
		if (!message.content && split.reasoning && !message.tool_calls?.length) message.content = split.reasoning;
		else if (split.reasoning) reasoning = reasoning ? reasoning + "\n" + split.reasoning : split.reasoning;
		if (reasoning) message.reasoning = reasoning; else delete message.reasoning;
		message._debugRawContent = raw;
		return message;
	}
	function mergeFragment(current, piece) {
		if (!piece || current === piece || current.endsWith(piece) || current.startsWith(piece)) return current || piece;
		if (piece.startsWith(current)) return piece;
		for (let n = Math.min(current.length, piece.length); n > 0; n--) if (current.endsWith(piece.slice(0, n))) return current + piece.slice(n);
		return current + piece;
	}
	async function readStream(res, onDelta, onReasoning, markProduced, isGoogle) {
		const reader = res.body.getReader(), decoder = new TextDecoder();
		const message = { role: "assistant", content: "", reasoning: "", tool_calls: [] };
		let raw = "", apiReasoning = "", leakedReasoning = "", buffer = "", plain = false;
		const emitReasoning = () => { if (onReasoning && message.reasoning) onReasoning(message.reasoning); };
		for (;;) {
			const { done, value } = await reader.read();
			buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
			const lines = buffer.split(/\r?\n/);
			buffer = done ? "" : lines.pop();
			for (const line of lines) {
				const text = line.trim();
				if (!text.startsWith("data:")) continue;
				const payload = text.slice(5).trim();
				if (!payload || payload === "[DONE]") continue;
				let delta;
				try { delta = JSON.parse(payload).choices?.[0]?.delta; } catch { continue; }
				if (!delta) continue;
				copyThoughtMetadata(delta, message, isGoogle);
				markProduced();
				const reasoningPiece = reasoningFrom(delta);
				if (reasoningPiece) { apiReasoning += reasoningPiece; message.reasoning = apiReasoning; emitReasoning(); }
				const textPiece = textFrom(delta.content);
				if (textPiece) {
					raw += textPiece;
					if (plain && textPiece.includes("<")) plain = false;
					if (plain) message.content = raw;
					else {
						const split = splitThink(raw, !!apiReasoning);
						message.content = split.content;
						if (split.reasoning.length >= leakedReasoning.length) leakedReasoning = split.reasoning;
						message.reasoning = leakedReasoning ? [apiReasoning, leakedReasoning].filter(Boolean).join("\n") : apiReasoning;
						emitReasoning();
						plain = !leakedReasoning && split.content === raw && raw.length > 400 && !raw.includes("<");
					}
					onDelta(message.content);
				}
				for (const incoming of delta.tool_calls || []) {
					let index = incoming.index ?? (incoming.id ? message.tool_calls.findIndex((slot) => slot?.id === incoming.id) : message.tool_calls.length - 1);
					if (index < 0) index = message.tool_calls.length;
					const slot = message.tool_calls[index] ||= { id: "", type: "function", function: { name: "", arguments: "" } };
					copyThoughtMetadata(incoming, slot, isGoogle);
					if (incoming.id) slot.id = incoming.id;
					slot.function.name = mergeFragment(slot.function.name, incoming.function?.name || "");
					if (incoming.function?.arguments) slot.function.arguments += incoming.function.arguments;
				}
			}
			if (done) break;
		}
		normalizeToolCalls(message);
		if (!message.content && leakedReasoning && !apiReasoning && !message.tool_calls) message.content = leakedReasoning;
		if (!message.reasoning) delete message.reasoning;
		message._debugRawContent = raw;
		return message;
	}
	async function doChat(messages, tools, onDelta, onReasoning, withExtras, markProduced) {
		const c = cfg(), body = { model: c.model, messages, temperature: 0.4 };
		applyThinking(body, withExtras, c);
		const requestTools = toolsForRequest(tools, c.family);
		if (requestTools) { body.tools = requestTools; body.tool_choice = "auto"; }
		if (onDelta) body.stream = true;
		const call = await request("/chat/completions", body);
		try {
			return onDelta ? await readStream(call.res, onDelta, onReasoning, markProduced, c.family === "google") : finishMessage(await call.res.json());
		} finally { call.done(); }
	}
	async function chatOnce(messages, tools, onDelta, onReasoning) {
		messages = messages || [];
		let produced = false, lastError;
		const hasToolHistory = messages.some((m) => m?.role === "tool" || m?.tool_calls?.length);
		const mayDropTools = !!tools?.length && !hasToolHistory;
		const plans = [
			["Standard", true, tools], ["Retry ohne Thinking-Extras", false, tools], ["Retry mit gleichem Request", false, tools],
			[mayDropTools ? "Fallback ohne Tool-Schema" : "Letzter Retry", false, mayDropTools ? null : tools],
		];
		const waits = [0, 750, 1800, 3500];
		for (let i = 0; i < plans.length; i++) {
			const [label, extras, plannedTools] = plans[i];
			if (i) {
				debugEvent("Fallback", { step: label, previousStatus: lastError?.status, waitMs: waits[i] });
				await sleep(Math.max(waits[i], lastError?.retryAfterMs || 0));
			}
			try {
				const message = await doChat(messages, plannedTools, onDelta, onReasoning, extras, () => { produced = true; });
				debugEvent("KI-Antwort", {
					stream: !!onDelta, attempt: i + 1, mode: label, content: String(message.content || "").slice(0, 1200),
					reasoning: String(message.reasoning || "").slice(0, 1200), rawContent: String(message._debugRawContent || "").slice(0, 1600),
					toolCalls: (message.tool_calls || []).map((tc) => ({ id: tc.id || null, name: tc.function?.name || null, arguments: tc.function?.arguments || "" })).filter((tc) => tc.name),
				});
				return message;
			} catch (error) {
				if (error?.name === "AbortError") throw error;
				const network = !(error instanceof AiHttpError) && (error instanceof TypeError || /failed to fetch|load failed|networkerror/i.test(errorText(error)));
				if (produced || !((error instanceof AiHttpError && (error.status >= 500 || error.status === 429)) || network)) throw error;
				lastError = error;
			}
		}
		if (lastError && !(lastError instanceof AiHttpError)) throw new Error(`Keine Verbindung zum KI-Server (${errorText(lastError)}). Prüfe Internet, Endpoint und CORS in den Einstellungen → KI.`);
		throw lastError || new Error("KI-Anfrage fehlgeschlagen.");
	}

	function pruneRunHistory(messages) {
		let images = 0, toolChars = 0;
		for (let i = messages.length - 1; i >= 0; i--) {
			const message = messages[i];
			if (message.role === "tool" && typeof message.content === "string") {
				if (toolChars + message.content.length > LIMIT.toolTotal && message.content.length > TOOL_DROPPED.length) message.content = TOOL_DROPPED;
				toolChars += message.content.length;
				continue;
			}
			if (!Array.isArray(message.content) || !message.content.some((part) => part?.type === "image_url") || ++images <= LIMIT.images) continue;
			message.content = message.content.filter((part) => part?.type !== "image_url").concat({ type: "text", text: "[Bild aus Platzgründen entfernt — bei Bedarf mit get_heft_page_image erneut anfordern]" });
		}
	}
	function toApiMessage(message, isGoogle) {
		const out = { role: "assistant", content: message.content || "" };
		if (message.tool_calls?.length) out.tool_calls = message.tool_calls.map((call) => {
			const clean = { ...call, function: call.function ? { ...call.function } : call.function };
			copyThoughtMetadata(call, clean, isGoogle);
			return clean;
		});
		copyThoughtMetadata(message, out, isGoogle);
		return out;
	}
	async function debugProbe() {
		const c = cfg(), messages = [{ role: "system", content: "Antworte ausschließlich mit OK." }, { role: "user", content: "Schreibe OK." }];
		const run = async (name, tools, extras) => {
			const started = performance.now();
			try {
				const message = await doChat(messages, tools, null, null, extras, () => {});
				return { name, ok: true, ms: Math.round(performance.now() - started), answer: String(message.content || "").slice(0, 120), hasReasoning: !!message.reasoning };
			} catch (error) {
				return { name, ok: false, ms: Math.round(performance.now() - started), status: error instanceof AiHttpError ? error.status : null, error: errorText(error).slice(0, 260) };
			}
		};
		return {
			provider: c.providerId || "—", model: c.model || "—", base: c.base || "—", pingOk: await ping(),
			tests: [await run("Antwort mit Thinking-Parametern", null, true), await run("Antwort ohne Thinking-Parameter", null, false), await run("Antwort mit Tool-Schema", fullToolDefs(), false)],
		};
	}
	async function complete(prompt, system) {
		const messages = system ? [{ role: "system", content: system }] : [];
		messages.push({ role: "user", content: prompt });
		return (await chatOnce(messages)).content || "";
	}

	function ankiContext() {
		if (S.view !== "anki") return "";
		const snapshot = STATE.studySnapshot(S.ankiDeck), counts = snapshot.counts;
		let text = `Geöffnet: Karteikarten-Bereich (Ansicht: ${S.ankiTab || "decks"}), Stapel: ${S.ankiDeck || "alle"} — heute offen: ${counts.neu} neu, ${counts.learn} lernen, ${counts.review} wiederholen.`;
		const card = S.ankiTab === "study" ? (S.reviewShowBack && S.cards[S.reviewCardId]) || snapshot.dueNow[0] : null;
		if (!card) return text;
		text += `\nSichtbare Lernkarte — Frage: "${String(card.front || "").slice(0, 600)}"`;
		return text + (S.reviewShowBack ? `\nAntwort (aufgedeckt): "${String(card.back || "").slice(0, 600)}"` : "\nDie Antwort ist noch verdeckt — verrate sie nicht ungefragt, gib höchstens Hinweise.");
	}
	function activeHeft(page) {
		const id = page?.kind === "heft" ? page.id : window.HEFT?.activeId || null;
		const heft = id ? S.pages[id] : null;
		return heft?.kind === "heft" ? { id, page: heft, idx: window.HEFT?.activeId === id ? window.HEFT.activeIndex || 0 : 0 } : null;
	}
	async function pageContextImage() {
		const page = currentPage(), heft = page && S.view !== "anki" && S.sideContextOff !== page.id ? activeHeft(page) : null;
		if (!heft || typeof window.HEFT?.pageAsDataUrl !== "function") return null;
		try {
			return { role: "user", content: [
				{ type: "text", text: `[Seitenkontext: „${heft.page.title}“, Seite ${heft.idx + 1} als Bild]` },
				{ type: "image_url", image_url: { url: await window.HEFT.pageAsDataUrl(heft.id, heft.idx) } },
			] };
		} catch { return null; }
	}
	function systemPrompt(toolsMode, ragContext, chatSummary, modelNote) {
		const page = currentPage(), now = new Date();
		let toolLine = toolsMode === true
			? "Arbeite mehrschrittig: erst nachsehen (get_context, list_pages, list_decks, read_page, semantic_search), dann handeln. Namen nie raten oder erfinden — immer erst auflisten. Karten korrigieren/verschieben statt löschen und neu anlegen. Bei echter Mehrdeutigkeit ask_choice. Kündige Arbeit nicht an, sondern führe sie im selben Zug aus, und sage danach in einem Satz konkret, was passiert ist (Anzahl, Namen)."
			: toolsMode === "meta"
				? "Aktuell ist nur das Werkzeug request_tools verfügbar. Sobald die Anfrage Notizen, Karten, Hefte, Suche oder Aktionen im Workspace erfordern könnte, rufe ZUERST request_tools auf — danach stehen alle Werkzeuge in derselben Anfrage bereit. Sonst antworte direkt."
				: "Für diese Anfrage sind keine Werkzeuge aktiv. Antworte direkt aus dem vorhandenen Kontext. Sprich NIE über Werkzeuge, fehlenden Daten-Zugriff oder „dieses Chat-Fenster“ und behaupte keine Suchen oder Änderungen. Wären Notiz-Inhalte nötig, bitte den Nutzer, die Frage konkret zu formulieren (z. B. „Durchsuche meine Notizen nach …“).";
		if (toolsMode === true) toolLine = "Du bedienst die App direkt. Nutze inspect zum gezielten Nachsehen und change für ALLE Änderungen. Bündele unabhängige Lesevorgänge in einem inspect-Aufruf und alle zusammengehörigen Änderungen in EINEM change-Aufruf. change ist atomar und rückgängig machbar. Namen nie raten; bei echter Mehrdeutigkeit ask_choice. Führe Arbeit im selben Zug aus und melde danach knapp Anzahl und Namen.";
		const lines = [
			"Du bist der KI-Coach von Impala67, einer lokalen Notiz- und Lern-App. Antworte auf Deutsch, kompakt. Formeln als LaTeX ($...$ inline, $$...$$ als Block).",
			`Heute: ${now.toLocaleDateString("de-DE", { weekday: "short", year: "numeric", month: "2-digit", day: "2-digit" })}, ${now.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })} Uhr.`,
			S.view === "anki" ? ankiContext() : page ? `Geöffnete Seite: "${page.title}"` : "Keine Seite geöffnet.", toolLine,
			"Niemals Selbstgespräche/Meta-Kommentare im sichtbaren Text ('Der Nutzer möchte…', 'I should…'). Ausführliches Nachdenken gehört AUSSCHLIESSLICH in <think>...</think> VOR der Antwort.",
		];
		if (page && S.view !== "anki" && S.sideContextOff !== page.id) {
			const heft = activeHeft(page);
			if (heft) lines.push(`Handschrift-Heft „${heft.page.title}“ ist geöffnet (Seite ${heft.idx + 1}). Der Inhalt wird als Bild übergeben — falls kein Vision-Modell aktiv ist, steht kein visueller Inhalt zur Verfügung.`);
			else {
				const body = String(page.content || ""), max = cfg().family === "local" ? 2500 : 12000, cut = body.length > max;
				S.pageCtxInfo = { id: page.id, sent: Math.min(body.length, max), total: body.length };
				lines.push(`Inhalt der geöffneten Seite${cut ? " (Anfang — Rest per read_page)" : ""}:\n${body.slice(0, max) || "(Leere Seite)"}`);
			}
		}
		if (ragContext) lines.push("Automatisch gefundene, möglicherweise relevante Notiz-Auszüge:\n" + ragContext);
		if (chatSummary) lines.push("Zusammenfassung des bisherigen Gesprächs (ältere Nachrichten, nicht mehr im Verlauf):\n" + chatSummary);
		if (modelNote) lines.push(modelNote);
		if (S.settings.customInstructions?.trim()) lines.push("Zusätzliche Anweisungen (aus den Einstellungen):\n" + S.settings.customInstructions.trim());
		return lines.join("\n");
	}
	function persistChat(type) {
		CHATS.persist(type === "side" ? S.sideChat : S.chat, type === "side" ? "sideChatId" : "currentChatId");
	}
	function chatUi(type) {
		const side = type === "side";
		return {
			chat: side ? S.sideChat : S.chat,
			render: () => side ? RENDER.renderChat() : RENDER.renderMainChatLog(),
			id: () => side ? S.sideChatId : S.currentChatId,
		};
	}
	function takeAttachment(type) {
		if (S.pendingAttachmentTarget !== type) return { image: null, textFile: null, pdfFile: null };
		const data = { image: S.pendingImage, textFile: S.pendingTextFile, pdfFile: S.pendingPdf };
		S.pendingImage = S.pendingTextFile = S.pendingPdf = S.pendingAttachmentTarget = null;
		RENDER.renderPendingChip(type);
		return data;
	}
	function conversation(chat) {
		return chat.filter((m) => m.role === "user" || m.role === "assistant" || (m.role === "question" && m.answered)).map((m) =>
			m.role === "question" ? { role: "user", content: `Meine Antwort auf die Rückfrage „${m.question}“: ${m.answer}` } : m);
	}
	function splitHistory(items) {
		const max = cfg().family === "local" ? 16 : 48, budget = max * 1500;
		let used = 0, keep = 0;
		for (let i = items.length - 1; i >= 0 && keep < max; i--) {
			used += String(items[i].content || "").length + (items[i].image ? 4000 : 0);
			if (used > budget && keep >= 2) break;
			keep++;
		}
		return { overflow: items.slice(0, items.length - keep), recent: items.slice(items.length - keep) };
	}
	function historyMessages(recent) {
		const full = new Set();
		for (let i = recent.length - 1; i >= 0 && full.size < 2; i--) if (recent[i].textFile || recent[i].pdfFile) full.add(recent[i]);
		const attachment = (m, label, file) => full.has(m)
			? `[${label}: ${file.name}]\n${file.content}`
			: `[${label}: ${file.name} — Inhalt aus Platzgründen nicht erneut mitgeschickt; bei Bedarf search_chat_history nutzen]`;
		return recent.map((m) => {
			let content = m.content || "";
			if (m.textFile) content += (content ? "\n\n" : "") + attachment(m, "Angehängte Datei", m.textFile);
			if (m.pdfFile) content += (content ? "\n\n" : "") + attachment(m, "Angehängtes PDF", m.pdfFile);
			return m.image ? { role: m.role, content: [{ type: "text", text: content }, { type: "image_url", image_url: { url: m.image } }] } : { role: m.role, content };
		});
	}
	async function ragFor(text) {
		try {
			if (!RAG.enabled() || String(text || "").trim().length < 8) return "";
			return ((await RAG.search(text, 4)) || []).filter((h) => (h.score == null || h.score >= 0.3) && h.snippet).map((h) => `• [${h.title}] ${h.snippet}`).join("\n");
		} catch (error) {
			if (error?.name === "AbortError") throw error;
			debugEvent("Auto-RAG übersprungen", { error: errorText(error).slice(0, 200) });
			return "";
		}
	}
	async function summaryFor(type, overflow) {
		if (!overflow.length) return "";
		try {
			const ui = chatUi(type), key = ui.id() ? `${type}:${ui.id()}` : "", raw = key ? chatSummaries[key] : null;
			const cached = raw && overflow.length >= raw.count ? raw : null;
			if (cached && overflow.length - cached.count < 4) return cached.text;
			const fresh = cached ? overflow.slice(cached.count) : overflow;
			const transcript = fresh.map((m) => `${m.role === "user" ? "Nutzer" : "KI"}: ${String(m.content || "").replace(/\s+/g, " ").slice(0, 600)}`).join("\n");
			const message = await chatOnce([
				{ role: "system", content: "Du fasst einen Chat-Verlauf zusammen. Maximal 120 Wörter. Behalte Fakten, Namen, Entscheidungen, offene Aufgaben und Nutzer-Vorlieben. Antworte NUR mit der Zusammenfassung." },
				{ role: "user", content: (cached ? `Bisherige Zusammenfassung:\n${cached.text}\n\nNeue Nachrichten:\n` : "Verlauf:\n") + transcript },
			]);
			const text = String(message.content || "").trim();
			if (text) { if (key) chatSummaries[key] = { count: overflow.length, text }; return text; }
			return cached?.text || "";
		} catch (error) {
			if (error?.name === "AbortError") throw error;
			debugEvent("Chat-Zusammenfassung übersprungen", { error: errorText(error).slice(0, 200) });
			return "";
		}
	}
	function previousModel(chat) {
		for (let i = chat.length - 1; i >= 0; i--) if (chat[i].role === "assistant" && chat[i].model) return chat[i].model;
		return "";
	}
	function modelSwitchNote(chat, model) {
		const previous = previousModel(chat);
		return previous && previous !== model
			? `Hinweis zum Modellwechsel: Die bisherigen Antworten in diesem Chat stammen von einem anderen Modell (${previous}), ab jetzt antwortest du (${model}). Gewechselt wird in aller Regel aus Unzufriedenheit. Prüfe den bisherigen Verlauf still auf Schwächen — zu lang oder ausweichend, Frage verfehlt, erfundene Seiten-/Stapelnamen, Arbeit nur angekündigt statt ausgeführt, Formeln oder Zahlen ungeprüft — und mache es konkret besser. Sprich den Wechsel nicht an.`
			: "";
	}

	const shortFront = (card, max = 60) => {
		const text = String(card?.front || "").replace(/\s+/g, " ").trim();
		return text.length > max ? text.slice(0, max) + "…" : text;
	};
	const cancelled = (data, action) => ({ cancelled: true, ...data, note: `${action} abgebrochen — nichts geändert.` });
	function deckMatch(name) {
		if (!name) return { error: "deck fehlt." };
		return TOOLS.resolveDeckStrict(name);
	}
	const CONFIRM_SPECS = {
		change: {
			options: ["Ja, ausführen", "Abbrechen"],
			resolve(args) {
				const operations = Array.isArray(args?.operations) ? args.operations : [];
				const risky = operations.filter((op) => /\.trash$|\.reset$/.test(String(op?.op || "")));
				if (!risky.length) return { skip: true, runArgs: args };
				const labels = risky.slice(0, 4).map((op) => op.title || op.deck || op.front || op.op).filter(Boolean);
				return {
					detail: `${operations.length} Änderungen`,
					question: `${risky.length} löschende/zurücksetzende Operation(en) ausführen${labels.length ? ": " + labels.join(" · ") : ""}? Die gesamte KI-Aktion bleibt rückgängig machbar.`,
					runArgs: args,
					cancelled: cancelled({ operations: operations.length }, "Aktion"),
				};
			},
		},
		reset_card_progress: {
			options: ["Ja, zurücksetzen", "Abbrechen"],
			resolve(args) {
				const front = String(args?.front || "").trim(), deck = String(args?.deck || "").trim();
				if (!front && !deck) return { error: "reset_card_progress: bitte front oder deck angeben." };
				if (front) {
					const card = TOOLS.findCard(front, deck || undefined);
					if (!card) return { error: "Karte nicht gefunden: " + front };
					const label = shortFront(card);
					return { detail: label, question: `Lernfortschritt der Karte „${label}“ zurücksetzen? Sie gilt danach wieder als neu.`, runArgs: { front: card.front, deck: card.deck }, cancelled: cancelled({ front: card.front }, "Zurücksetzen") };
				}
				const hit = deckMatch(deck);
				if (hit.error) return { error: hit.error };
				const count = TOOLS.cardsOfDeck(hit.deck).length;
				return { detail: hit.deck, question: `Lernfortschritt von ${count} Karte(n) im Stapel „${hit.deck}“ zurücksetzen? Alle gelten danach wieder als neu.`, runArgs: { deck: hit.deck }, cancelled: cancelled({ deck: hit.deck }, "Zurücksetzen") };
			},
		},
		delete_page: {
			resolve(args) {
				const title = String(args?.page_title || "").trim();
				if (!title) return { error: "delete_page: page_title fehlt." };
				const page = STATE.findPage(title);
				if (!page) return { error: "Seite nicht gefunden: " + title };
				const children = TOOLS.subtreeIds(page.id).size - 1;
				return { detail: page.title, question: `Seite „${page.title}“${children ? ` inkl. ${children} Unterseite(n)` : ""} in den Papierkorb?`, runArgs: { page_title: page.title }, cancelled: cancelled({ title: page.title }, "Löschen") };
			},
		},
		delete_flashcard: {
			resolve(args) {
				const front = String(args?.front || "").trim();
				if (!front) return { error: "delete_flashcard: front fehlt." };
				const card = TOOLS.findCard(front, args?.deck);
				if (!card) return { error: "Karte nicht gefunden: " + front };
				const label = shortFront(card);
				return { detail: label, question: `Karte „${label}“ in den Papierkorb?`, runArgs: { front: card.front, deck: card.deck }, cancelled: cancelled({ front: card.front }, "Löschen") };
			},
		},
		delete_flashcards: {
			resolve(args) {
				const selected = TOOLS.selectCards(args || {});
				if (selected.error) return { error: selected.error };
				if (!selected.cards.length) return { error: "Keine passenden Karten gefunden." };
				const count = selected.cards.length, shown = selected.cards.slice(0, 3).map((card) => `„${shortFront(card, 50)}“`).join(", ");
				const rest = count - Math.min(3, count), capped = selected.truncated ? ` (von ${selected.total} Treffern — der Rest bleibt vorerst erhalten)` : "";
				const question = count === 1 ? `Karte „${shortFront(selected.cards[0], 50)}“ in den Papierkorb?`
					: `${count} Karten${selected.deck ? ` aus „${selected.deck}“` : ""}${capped} in den Papierkorb? ${shown}${rest ? ` und ${rest} weitere` : ""}`;
				return { detail: `${count}${count === 1 ? " Karte" : " Karten"}${selected.deck ? " · " + selected.deck : ""}`, question, runArgs: { ids: selected.cards.map((card) => card.id) }, cancelled: cancelled({ count }, "Löschen") };
			},
		},
		delete_deck: {
			resolve(args) {
				const name = String(args?.deck || "").trim();
				if (!name) return { error: "delete_deck: deck fehlt." };
				const hit = deckMatch(name);
				if (hit.error) return { error: hit.error };
				const count = TOOLS.cardsOfDeck(hit.deck).length;
				return { detail: hit.deck, question: `Stapel „${hit.deck}“${count ? ` inkl. ${count} Karte(n)` : ""} in den Papierkorb?`, runArgs: { deck: hit.deck }, cancelled: cancelled({ deck: hit.deck }, "Löschen") };
			},
		},
	};

	async function heftPageTool(args) {
		let pageNo = 0;
		try {
			const HEFT = window.HEFT;
			if (typeof HEFT?.pageAsDataUrl !== "function") throw new Error("Heft-Modul nicht verfügbar.");
			let id;
			if (args.page_title) {
				const page = STATE.findPage(args.page_title);
				if (!page) throw new Error(`Keine Seite mit Titel „${args.page_title}“ gefunden.`);
				if (page.kind !== "heft") throw new Error(`„${page.title}“ ist kein Handschrift-Heft.`);
				id = page.id;
			} else if (HEFT.activeId) id = HEFT.activeId;
			else throw new Error("Es ist gerade kein Heft geöffnet — bitte page_title angeben.");
			const index = args.heft_page ? Math.max(0, Math.floor(args.heft_page) - 1) : HEFT.activeId === id ? HEFT.activeIndex || 0 : 0;
			pageNo = index + 1;
			return {
				detail: `${args.page_title || "aktuelles Heft"} · Seite ${pageNo}`,
				out: { ok: true, hinweis: `Heftseite ${pageNo} folgt direkt nach den Tool-Ergebnissen als Bild-Nachricht. Falls du Bilder technisch nicht sehen kannst (kein Vision-Modell), sage das kurz und ehrlich.` },
				message: { role: "user", content: [
					{ type: "text", text: `[Automatisch angehängt: Heftseite ${pageNo} als Bild${args.page_title ? ` aus „${args.page_title}“` : ""}]` },
					{ type: "image_url", image_url: { url: await HEFT.pageAsDataUrl(id, index) } },
				] },
			};
		} catch (error) {
			return { detail: `${args.page_title || "aktuelles Heft"}${pageNo ? ` · Seite ${pageNo}` : ""}`, out: { error: errorText(error) } };
		}
	}
	function toolDetail(name, args) {
		if (name === "change") return `${Array.isArray(args.operations) ? args.operations.length : 0} Operation(en)`;
		if (name === "inspect") return args.kind + (args.query ? " · " + args.query : "");
		let detail = args.page_title || args.title || args.query || args.front
			|| (Array.isArray(args.fronts) && args.fronts.length ? args.fronts.slice(0, 2).join(" · ") + (args.fronts.length > 2 ? ` +${args.fronts.length - 2}` : "") : "")
			|| (args.to_deck ? "→ " + args.to_deck : "") || args.new_name || args.deck || args.from_deck || args.name || "";
		if (name === "semantic_search") detail += (detail ? " · " : "") + "Embedding: " + (S.settings.embedModel || "—");
		return detail;
	}
	function mutationBefore(name, args) {
		if (!MUTATING_TOOLS.has(name) || name === "create_page") return { id: null, value: { title: "", content: "" } };
		const page = STATE.findPage(args.page_title);
		return page ? { id: page.id, value: { title: page.title, content: page.content } } : { id: null, value: { title: "", content: "" } };
	}
	function recordMutation(name, args, out, before, pendingEdits) {
		if (!MUTATING_TOOLS.has(name) || !out || out.error) return;
		if (name === "change" && out._undo) {
			pendingEdits.push({ mid: U.uid(), role: "edit", summary: `${out.operations || 0} KI-Änderung(en)`, undo: out._undo, undone: false });
			return;
		}
		let id = before.id, created = false;
		if (name === "create_page") {
			const page = out.id && S.pages[out.id] || STATE.findPage(args.title);
			if (page) { id = page.id; created = true; }
		}
		const page = id && S.pages[id];
		if (!page) return;
		const after = { title: page.title, content: page.content };
		if (created || after.title !== before.value.title || after.content !== before.value.content) {
			pendingEdits.push({ mid: U.uid(), role: "edit", pageId: id, pageTitle: after.title, before: before.value, after, created, undone: false });
		}
	}

	async function agent(userText, type, onStep) {
		type = type || "side";
		const ui = chatUi(type), target = ui.chat, render = ui.render;
		const chatKey = () => ui.id() ? `${type}:${ui.id()}` : "";
		const rememberUnlock = () => { const key = chatKey(); if (key) toolsUnlocked.add(key); };
		let runUnlocked = toolsUnlocked.has(chatKey());
		const pendingEdits = [];
		const flushEdits = () => {
			if (!pendingEdits.length) return;
			target.push(...pendingEdits.splice(0));
			render();
		};

		const attachment = takeAttachment(type);
		target.push({ mid: U.uid(), role: "user", content: userText, ...attachment });
		render();
		const { overflow, recent } = splitHistory(conversation(target));
		const history = historyMessages(recent);
		// Sechs kurze Schemas sind billiger als eine zusätzliche Freischalt-Rundreise.
		const metaOnly = false;
		let agentTools = fullToolDefs();
		const [ragContext, chatSummary, contextImage] = await Promise.all([ragFor(userText), summaryFor(type, overflow), pageContextImage()]);
		if (contextImage) history.push(contextImage);
		const visionNote = history.some((m) => Array.isArray(m.content))
			? "\n\nAn Nachrichten können Bilder hängen (z. B. Heft-Seiten oder Screenshots). Wenn du Bilder technisch nicht empfangen oder nicht sehen kannst (kein Vision-Modell), erwähne das kurz und ehrlich, statt Inhalte zu raten."
			: "";
		const current = cfg(), model = current.model, isGoogle = current.family === "google", modelNote = modelSwitchNote(target, model);
		const sysMsg = (mode) => ({ role: "system", content: systemPrompt(mode, ragContext, chatSummary, modelNote) + visionNote });
		const messages = [sysMsg(metaOnly ? "meta" : true), ...history];
		debugEvent("Tool-Modus", { mode: metaOnly ? "nur request_tools" : "volle Liste", reason: metaOnly ? "Einstellung »Tools immer mitsenden« ist aus" : runUnlocked ? "in diesem Chat freigeschaltet" : "Standard: Tools immer mitsenden" });

		let renderQueued = false, lastRender = 0;
		const scheduleRender = () => {
			if (renderQueued) return;
			renderQueued = true;
			setTimeout(() => { renderQueued = false; lastRender = Date.now(); render(); }, Math.max(16, 80 - (Date.now() - lastRender)));
		};
		let persistTimer = 0, lastPersist = 0;
		const persist = (force = false) => {
			clearTimeout(persistTimer);
			persistTimer = 0;
			if (!force && Date.now() - lastPersist < 1500) {
				persistTimer = setTimeout(() => persist(true), 1500);
				return;
			}
			lastPersist = Date.now();
			try { persistChat(type); } catch (error) { console.warn("Chat speichern:", error); }
		};
		let runReasoning = "", nudged = false;
		const addReasoning = (text) => { if (text) runReasoning += (runReasoning ? "\n\n" : "") + text; };
		const fail = (error) => {
			S.aiThinkingDraft = "";
			flushEdits();
			persist(true);
			throw error;
		};
		async function waitForAnswer(question, options, status) {
			const mid = U.uid();
			if (type === "side") {
				document.body.classList.remove("panel-collapsed");
				if (typeof RENDER.renderTabs === "function") RENDER.renderTabs();
			}
			S.aiStatus = status;
			S.aiDraft = "";
			S.aiThinkingDraft = runReasoning;
			const answer = await new Promise((resolve) => {
				pendingChoices[mid] = resolve;
				target.push({ mid, role: "question", question, options, answered: false });
				render();
				persist(true);
			});
			const card = target.find((m) => m.mid === mid);
			if (answer === ABORTED) {
				if (card) { card.answered = true; card.answer = "Abgebrochen"; }
				render();
				const error = new Error("Abgebrochen.");
				error.name = "AbortError";
				fail(error);
			}
			if (card) { card.answered = true; card.answer = answer; }
			S.aiStatus = "…denkt nach…";
			return answer;
		}
		const pushToolChip = (name, detail, error) => target.push({ mid: U.uid(), role: "tool", name, detail: String(detail || "").slice(0, 80), error: !!error });
		const pushToolResult = (call, out) => {
			let content = JSON.stringify(out ?? {});
			if (content.length > LIMIT.toolResult) content = JSON.stringify({ gekuerzt: true, hinweis: "Ergebnis war zu lang und wurde gekürzt — bei Bedarf gezielter nachfragen (Filter, Suchbegriff, limit).", auszug: content.slice(0, LIMIT.toolResult) });
			messages.push({ role: "tool", tool_call_id: call.id, content });
		};
		const finishTool = (call, name, detail, out, full = false) => {
			onStep?.(name);
			if (detail !== null) pushToolChip(name, detail, out?.error);
			full ? render() : scheduleRender();
			pushToolResult(call, out);
			persist();
		};

		for (let step = 0; step < LIMIT.agentSteps; step++) {
			S.aiDraft = "";
			S.aiThinkingDraft = runReasoning;
			pruneRunHistory(messages);
			let message;
			try {
				message = await chatOnce(messages, agentTools,
					(text) => { S.aiDraft = text; scheduleRender(); },
					(text) => { S.aiThinkingDraft = runReasoning ? runReasoning + "\n\n" + text : text; scheduleRender(); });
			} catch (error) { fail(error); }
			addReasoning(message.reasoning);
			messages.push(toApiMessage(message, isGoogle));
			if (message.tool_calls?.length && String(message.content || "").trim()) target.push({ mid: U.uid(), role: "assistant", content: String(message.content).trim(), model, reasoningExpanded: false });
			if (!message.tool_calls?.length) {
				if (!String(message.content || "").trim() && !nudged) {
					nudged = true;
					messages.push({ role: "user", content: "Deine Antwort war leer. Sage in ein bis zwei Sätzen konkret, was du getan oder herausgefunden hast — ohne weiteren Werkzeug-Aufruf." });
					continue;
				}
				const final = { mid: U.uid(), role: "assistant", content: message.content || "", model, reasoning: runReasoning || null, reasoningExpanded: false };
				S.aiDraft = S.aiThinkingDraft = "";
				target.push(final);
				flushEdits();
				persist(true);
				if (runUnlocked) rememberUnlock();
				return final.content;
			}

			const pendingImages = [];
			for (const call of message.tool_calls) {
				const name = call.function.name, raw = String(call.function.arguments || "").trim();
				let args = {};
				if (raw) { try { args = JSON.parse(raw); } catch { args = null; } }
				if (!args || typeof args !== "object" || Array.isArray(args)) {
					finishTool(call, name, "ungültige Argumente", { error: `Die Argumente von ${name} sind kein gültiges JSON (vermutlich abgeschnitten) — bitte den Aufruf mit vollständigen Argumenten wiederholen.` });
					continue;
				}
				if (name === "view_heft_page" || name === "get_heft_page_image") {
					const normalized = name === "view_heft_page" ? { page_title: args.title, heft_page: args.page } : args;
					const result = await heftPageTool(normalized);
					if (result.message) pendingImages.push(result.message);
					finishTool(call, name, result.detail, result.out);
					continue;
				}
				if (name === "request_tools") {
					runUnlocked = true;
					rememberUnlock();
					agentTools = fullToolDefs();
					messages[0] = sysMsg(true);
					finishTool(call, name, "Werkzeuge freigeschaltet", { ok: true, hinweis: "Alle Werkzeuge sind jetzt in dieser Anfrage verfügbar." });
					continue;
				}
				const confirm = CONFIRM_SPECS[name];
				if (confirm) {
					const spec = confirm.resolve(args);
					if (spec.error) { finishTool(call, name, spec.error, { error: spec.error }); continue; }
					if (spec.skip) {
						let out;
						try { out = await TOOLS.run(name, spec.runArgs); } catch (error) { out = { error: String(error) }; }
						finishTool(call, name, toolDetail(name, args), out);
						recordMutation(name, args, out, mutationBefore(name, args), pendingEdits);
						continue;
					}
					const answer = await waitForAnswer(spec.question, confirm.options || ["Ja, löschen", "Abbrechen"], "Warte auf Bestätigung…");
					let out;
					if (!String(answer || "").toLowerCase().startsWith("ja")) out = spec.cancelled;
					else { try { out = await TOOLS.run(name, spec.runArgs); } catch (error) { out = { error: String(error) }; } }
					finishTool(call, name, out.cancelled ? null : spec.detail, out, true);
					recordMutation(name, args, out, mutationBefore(name, args), pendingEdits);
					continue;
				}
				if (name === "ask_choice") {
					const normalized = TOOLS.normalizeAskChoice(args);
					if (normalized.error) { finishTool(call, name, normalized.error, normalized); continue; }
					const answer = await waitForAnswer(normalized.question, normalized.options, "Warte auf deine Auswahl…");
					finishTool(call, name, null, { answer, question: normalized.question }, true);
					continue;
				}
				const before = mutationBefore(name, args);
				let out;
				try { out = await TOOLS.run(name, args); } catch (error) { out = { error: String(error) }; }
				finishTool(call, name, toolDetail(name, args), out);
				recordMutation(name, args, out, before, pendingEdits);
			}
			if (pendingImages.length) messages.push(...pendingImages);
		}
		S.aiDraft = S.aiThinkingDraft = "";
		const text = "(Abgebrochen: zu viele Tool-Schritte.)";
		target.push({ mid: U.uid(), role: "assistant", content: text, reasoning: runReasoning || null, reasoningExpanded: false });
		flushEdits();
		persist(true);
		return text;
	}

	function resolveChoice(mid, answer) {
		const resolve = pendingChoices[mid];
		if (!resolve) return false;
		delete pendingChoices[mid];
		resolve(answer);
		return true;
	}
	const hasPendingChoice = () => Object.keys(pendingChoices).length > 0;
	async function refine(historyMessages, instruction, onDelta) {
		return (await chatOnce([{ role: "system", content: systemPrompt() }, ...historyMessages, { role: "user", content: instruction }], null, onDelta)).content || "";
	}
	const undoAi = (changeSet) => TOOLS.undo(changeSet);

	return { chatOnce, complete, agent, undo: undoAi, abortActive, resolveChoice, hasPendingChoice, refine, ping, pingProvider, embed, listModels, listEmbeddingModels, detectThinkingCapabilities, debugProbe, debugReport, MODEL_PRESETS };
})();
