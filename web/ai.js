"use strict";

import { S, STATE } from "./state.js";
import { TOOLS } from "./tools.js";
import { U } from "./util.js";
import { RENDER } from "./render.js";
import { CHATS } from "./chats.js";
import { THINK } from "./think-heuristik.js";
import { RAG } from "./rag.js";

// ai.js — KI-Adapter, OpenAI-kompatibel (LM Studio, OpenAI, Gemini-Gateway, OpenRouter …).
// KISS-Rewrite 20.7.2026: funktionsgleich, stark komprimiert. Fixes:
//  [F1] 429 wird wie 5xx mit Backoff wiederholt, Retry-After respektiert (OpenRouter-Rate-Limits).
//  [F2] Gestreamte tool_calls ohne index werden per id/letztem Slot gemerged (manche OpenRouter-Routen).
//  [F3] Sparmodus (Tools aus): System-Prompt beschreibt request_tools statt nicht verfügbarer Tools,
//       wird nach Freischaltung aktualisiert; Debug „Tool-Modus" nennt den echten Grund.
// Update 21.7.2026 (Einstellungen → KI):
//  [F4] Embeddings laufen über eine EIGENE Quelle (settings.embedProviderId) statt implizit über
//       die aktive Chat-Quelle; listEmbeddingModels() durchsucht dafür ALLE konfigurierten Quellen.
//  [F5] pingProvider(): Verbindungstest je Quelle mit konkreter Diagnose (Key ungültig,
//       /v1 vergessen, Server aus / CORS) für die neuen „Verbindung testen"-Buttons.
export const AI = (() => {
	// ---- Konstanten ----
	const MODEL_PRESETS = [
		{ value: "gemini-2.5-flash", label: "Gemini 2.5 Flash", provider: "google" },
		{ value: "gemini-2.5-pro", label: "Gemini 2.5 Pro", provider: "google" },
		{ value: "gemma-4-31b-it", label: "Gemma 4 31B", provider: "google" },
		{ value: "gemma-4-26b-a4b-it", label: "Gemma 4 26B A4B", provider: "google" },
		{ value: "gpt-4.1", label: "GPT-4.1", provider: "openai" },
		{ value: "gpt-4.1-mini", label: "GPT-4.1 mini", provider: "openai" },
		{ value: "local-model", label: "Lokales Modell", provider: "local" },
	];
	const MUTATING_TOOLS = new Set(["create_page", "append_to_page", "replace_page_content"]); // → Edit-Karte (Diff+Undo)
	const MAX_AGENT_STEPS = 8;
	const DEBUG_LOG_LIMIT = 40;
	const historyLimit = () => (cfg().providerId === "local" ? 16 : 48); // lokal kleiner Kontext, Cloud 128k+
	const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

	// ---- Debug-Log (nur Metadaten + gekürzte Ausgaben, nie Key/Notizinhalte) ----
	const debugLog = [];
	function debugEvent(kind, detail) {
		debugLog.push({ at: new Date().toISOString(), kind, detail });
		if (debugLog.length > DEBUG_LOG_LIMIT) debugLog.splice(0, debugLog.length - DEBUG_LOG_LIMIT);
	}
	function debugReport() {
		const { base, model, providerId } = cfg();
		const rows = debugLog.map((e) => "[" + e.at + "] " + e.kind + "\n" + JSON.stringify(e.detail, null, 2));
		return [
			"Impala67 KI-Debugprotokoll",
			"Erstellt: " + new Date().toISOString(),
			"Provider: " + (providerId || "—"),
			"Modell: " + (model || "—"),
			"Endpoint: " + (base || "—"),
			"Hinweis: API-Schlüssel und Nutzereingaben sind nicht enthalten. Gekürzte Modellantworten können jedoch Inhalte daraus wiedergeben.",
			"", rows.length ? rows.join("\n\n") : "Noch keine KI-Anfrage in dieser Sitzung protokolliert.",
		].join("\n");
	}

	const pendingChoices = Object.create(null); // Frage-mid → resolve() (ask_choice/Lösch-Bestätigung)
	const chatSummaries = Object.create(null); // summaryKey → {count,text}; nur RAM, wird bei Bedarf neu aufgebaut

	// ---- Quellen & Konfiguration ----
	function activeProvider() {
		const ps = S.settings.aiProviders || [];
		return ps.find((p) => p.id === S.settings.aiProviderId) || ps[0] || null;
	}
	const providerById = (id) => (id && (S.settings.aiProviders || []).find((p) => p.id === id)) || null;
	// [F4] Embedding-Quelle: explizit gewählte Quelle (⚙️ → KI → Embeddings), sonst aktive Chat-Quelle.
	const embedProvider = () => providerById(S.settings.embedProviderId) || activeProvider();
	function cfg() {
		const pr = activeProvider();
		return { base: String(pr?.base || "").replace(/\/+$/, ""), key: pr?.key || "", model: S.settings.aiModel || "", providerId: pr?.id || "" };
	}
	const auth = (key) => (key ? { Authorization: "Bearer " + key } : {});
	const capKey = (c = cfg()) => [c.providerId, c.base, c.model].join("::");
	const capStore = () => S.thinkingCapabilities || (S.thinkingCapabilities = Object.create(null));
	// /models kennt keine Thinking-Capability, aktive Proben wären kostenpflichtig → nur
	// dokumentierte Kombinationen freischalten (Manifest); Unbekanntes bleibt „Automatisch" ohne Extras.
	function declaredThinkingCapabilities(c) {
		if (c.providerId === "google" && /^gemini-2\.5-(flash|pro)/.test(String(c.model || "").toLowerCase())) {
			return { levels: ["low", "medium", "high"], includeThoughts: true, source: "gemini-openai" }; // Gateway: low/med/high → 1k/8k/24k Budget
		}
		return { levels: [], includeThoughts: false, source: "none" };
	}
	async function detectThinkingCapabilities() {
		const c = cfg(), store = capStore(), key = capKey(c);
		if (store[key]) return store[key];
		const d = declaredThinkingCapabilities(c);
		const cap = store[key] = {
			state: "ready", levels: d.levels, includeThoughts: d.includeThoughts, source: d.source,
			error: c.model && !d.levels.length ? "Für dieses Modell ist über den aktuellen Chat-Adapter keine steuerbare Thinking-Stufe dokumentiert." : "",
		};
		debugEvent("Thinking-Fähigkeiten", { provider: c.providerId, model: c.model, state: cap.state, levels: cap.levels, source: cap.source, passive: true });
		return cap;
	}

	// ---- HTTP ----
	class AiHttpError extends Error {
		constructor(status, text, retryAfterMs) {
			super("KI-Fehler " + status + ": " + String(text || "").slice(0, 300));
			this.status = status;
			this.retryAfterMs = retryAfterMs || 0;
		}
	}
	// ⏹ Laufende Chat-Anfrage abbrechen („kommt noch“, 22. Juli): Der Senden-Button
	// wird während S.aiBusy zum Stopp-Button (app.js) — abortActive() reißt die fetch-
	// Verbindung UND das laufende Stream-Lesen sofort ab (gleiches Signal).
	// Fix (23. Juli): EINE geteilte Variable brach bei parallelen Anfragen (z.B. Chat läuft,
	// Verlaufs-Zusammenfassung startet) nur die ZULETZT gestartete ab — ⏹ stoppt jetzt ALLE laufenden.
	let activeAborts = [];
	function abortActive() {
		activeAborts.forEach((ctrl) => ctrl.abort());
		activeAborts = [];
	}
	async function request(path, body) {
		const { base, key, providerId } = cfg();
		if (!base) throw new Error("Kein KI-Server konfiguriert (Einstellungen → KI).");
		const started = performance.now();
		const messageMeta = (body.messages || []).map((m) => ({
			role: m?.role || "?",
			chars: typeof m?.content === "string" ? m.content.length : JSON.stringify(m?.content || "").length,
			hasToolCalls: !!m?.tool_calls?.length,
		}));
		const toolSchemas = (body.tools || []).map((t) => ({ type: t.type, name: t.function?.name, description: t.function?.description, parameters: t.function?.parameters }));
		const meta = {
			path, provider: providerId || "—", model: body.model || "—", stream: !!body.stream,
			messageCount: messageMeta.length, messageChars: messageMeta.reduce((s, m) => s + m.chars, 0), messageMeta,
			toolCount: toolSchemas.length, toolChoice: body.tool_choice || null, toolSchemas,
			temperature: body.temperature, thinkingExtras: !!body.extra_body || !!body.reasoning_effort,
			extraBody: body.extra_body || null, reasoningEffort: body.reasoning_effort || null,
		};
		debugEvent("HTTP-Anfrage", meta);
		let res;
		const ctrl = new AbortController();
		activeAborts = activeAborts.filter((c) => !c.signal.aborted).slice(-8); // fertige/alte Controller nicht endlos horten
		activeAborts.push(ctrl);
		try {
			res = await fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json", ...auth(key) }, body: JSON.stringify(body), signal: ctrl.signal });
		} catch (error) {
			debugEvent("Netzwerkfehler", { ...meta, ms: Math.round(performance.now() - started), error: String(error?.message || error) });
			throw error;
		}
		const requestId = res.headers.get("x-request-id") || res.headers.get("x-goog-request-id") || null;
		const ms = Math.round(performance.now() - started);
		if (!res.ok) {
			const text = await res.text().catch(() => "");
			debugEvent("HTTP-Fehler", { ...meta, status: res.status, requestId, ms, response: String(text).slice(0, 1000) });
			throw new AiHttpError(res.status, text, (Number(res.headers.get("retry-after")) || 0) * 1000); // [F1]
		}
		debugEvent("HTTP-Erfolg", { ...meta, status: res.status, requestId, ms });
		return res;
	}

	// ---- Tool-Schemas: Googles Gateway (OpenAPI-3.0-Subset) wirft bei diesen Keys gern "500 INTERNAL" ----
	const DROPPED_SCHEMA_KEYS = new Set(["minItems", "maxItems", "additionalProperties", "default", "$schema", "examples"]);
	function sanitizeToolSchema(s) {
		if (!s || typeof s !== "object") return s;
		if (Array.isArray(s)) return s.map(sanitizeToolSchema);
		return Object.fromEntries(Object.entries(s)
			.filter(([k]) => !DROPPED_SCHEMA_KEYS.has(k))
			.map(([k, v]) => [k, v && typeof v === "object" ? sanitizeToolSchema(v) : v]));
	}
	function toolsForRequest(tools) {
		if (!tools?.length) return undefined;
		if (cfg().providerId !== "google") return tools;
		return tools.map((td) => ({ type: td.type, function: { name: td.function.name, description: td.function.description, parameters: sanitizeToolSchema(td.function.parameters) } }));
	}
	// Sparmodus („Tools immer mitsenden" aus): nur dieses Meta-Tool geht mit; ruft das
	// Modell es auf, läuft DIESELBE Anfrage sofort mit der vollen Liste weiter.
	const META_TOOL_DEF = {
		type: "function",
		function: {
			name: "request_tools",
			description: "Schaltet die vollständige Werkzeugliste frei (Notizen lesen/erstellen/ändern, Suche, Karteikarten, NotebookLM …). Rufe dieses Werkzeug auf, sobald die Anfrage Zugriff auf Notizen, Karten, Hefte oder Aktionen im Workspace erfordern könnte.",
			parameters: { type: "object", properties: {}, required: [] },
		},
	};
	let toolsUnlocked = false; // bleibt pro Sitzung frei — sonst scheitert „ja, mach das" nach Freischaltung

	// ---- Status / Modelle / Embeddings (Basis-URL ist immer vollständig — nie "/v1" anhängen) ----
	async function modelIds(base, key) {
		const res = await fetch(String(base).replace(/\/+$/, "") + "/models", { headers: auth(key) });
		if (!res.ok) throw new AiHttpError(res.status, await res.text().catch(() => ""));
		return ((await res.json()).data || []).map((m) => m?.id).filter(Boolean);
	}
	async function ping() {
		const { base, key } = cfg();
		if (!base) return false;
		try { await modelIds(base, key); return true; } catch { return false; }
	}
	async function listModels() {
		const lists = await Promise.all((S.settings.aiProviders || []).filter((p) => p.base).map(async (pr) => {
			try { return (await modelIds(pr.base, pr.key)).map((id) => ({ id, providerId: pr.id })); }
			catch { return []; } // Quelle gerade nicht erreichbar → überspringen
		}));
		return lists.flat();
	}
	// Nur klar erkennbare Embedding-Modellnamen. [F4]: ALLE konfigurierten Quellen werden
	// durchsucht — das Embedding-Modell ist nicht mehr an die aktive Chat-Quelle gebunden.
	const isEmbeddingModel = (id) => /(?:^|[-_/.])(embed(?:ding)?|text-embedding|nomic-embed|bge|e5|gte|jina-embeddings?|voyage|mxbai-embed|snowflake-arctic-embed)(?:$|[-_/.])/i.test(String(id || ""));
	async function listEmbeddingModels() {
		const providers = (S.settings.aiProviders || []).filter((p) => p.base);
		const lists = await Promise.all(providers.map(async (pr) => {
			try {
				return (await modelIds(pr.base, pr.key)).filter(isEmbeddingModel)
					.sort((a, b) => String(a).localeCompare(String(b)))
					.map((id) => ({ id, providerId: pr.id, providerName: pr.name || pr.id }));
			} catch { return []; } // Quelle gerade nicht erreichbar → überspringen
		}));
		return lists.flat();
	}
	// [F4] /embeddings läuft direkt gegen die Embedding-Quelle (embedProvider) — NICHT mehr
	// über request(), das immer die aktive CHAT-Quelle nutzt. Damit funktioniert z. B. ein
	// lokales LM-Studio-Embedding-Modell auch, während im Chat Gemini oder OpenAI aktiv ist.
	async function embed(texts) {
		if (!S.settings.embedModel) throw new Error("Kein Embedding-Modell konfiguriert.");
		const pr = embedProvider();
		if (!pr?.base) throw new Error("Keine Quelle für Embeddings konfiguriert (Einstellungen → KI).");
		const base = String(pr.base).replace(/\/+$/, "");
		const started = performance.now();
		let res;
		try {
			res = await fetch(base + "/embeddings", { method: "POST", headers: { "Content-Type": "application/json", ...auth(pr.key) }, body: JSON.stringify({ model: S.settings.embedModel, input: texts }) });
		} catch (error) {
			debugEvent("Embedding-Netzwerkfehler", { provider: pr.id, model: S.settings.embedModel, error: String(error?.message || error) });
			throw error;
		}
		if (!res.ok) {
			const text = await res.text().catch(() => "");
			debugEvent("Embedding-Fehler", { provider: pr.id, model: S.settings.embedModel, status: res.status, ms: Math.round(performance.now() - started), response: String(text).slice(0, 400) });
			throw new AiHttpError(res.status, text);
		}
		return (await res.json()).data.map((d) => d.embedding);
	}
	// [F5] Verbindungstest je Quelle (Einstellungen → KI → „Verbindung testen"). Diagnostiziert
	// die häufigsten Ursachen dafür, dass keine Verbindung zustande kommt: unvollständige URL
	// (fehlendes /v1), ungültiger API-Key, Server aus / falscher Port / CORS blockiert.
	async function pingProvider(pr) {
		if (!pr || !String(pr.base || "").trim()) return { ok: false, error: "Keine Server-URL eingetragen." };
		const base = String(pr.base).trim().replace(/\/+$/, "");
		const started = performance.now();
		const elapsed = () => Math.round(performance.now() - started);
		try {
			const ids = await modelIds(base, pr.key);
			return { ok: true, models: ids.length, ms: elapsed() };
		} catch (error) {
			if (error instanceof AiHttpError) {
				if (error.status === 401 || error.status === 403) return { ok: false, ms: elapsed(), status: error.status, error: "Server erreichbar, aber der API-Key fehlt oder ist ungültig (HTTP " + error.status + ")." };
				if (error.status === 404 && !/\/v\d+/i.test(base)) {
					// Häufigster Stolperstein: Basis-URL ohne API-Pfad (z. B. „http://localhost:1234" statt „…/v1")
					try {
						await modelIds(base + "/v1", pr.key);
						return { ok: false, ms: elapsed(), status: 404, suggestedBase: base + "/v1", error: "Unter dieser URL gibt es keinen /models-Endpunkt — mit „" + base + "/v1" + "“ antwortet der Server." };
					} catch { /* Vorschlag passt auch nicht → generische 404-Meldung */ }
				}
				return { ok: false, ms: elapsed(), status: error.status, error: "Server antwortet mit HTTP " + error.status + ". Prüfe, ob die URL auf den OpenAI-kompatiblen API-Stamm zeigt (endet meist auf /v1)." };
			}
			// FIX: Deutsche Anführungszeichen „…“ — kein ASCII-" im String, sonst bricht der JS-Parser ab
			// ("Unexpected identifier 'aktivieren'").
			return { ok: false, ms: elapsed(), error: "Keine Verbindung: " + String(error?.message || error) + ". Mögliche Ursachen: Server läuft nicht, falscher Port, oder CORS blockiert (LM Studio: Developer → „Enable CORS“ aktivieren)." };
		}
	}

	// ---- Thinking/Reasoning: 1) native API-Felder 2) <think>-Tags 3) Sticky-Heuristik (Gemma & Co.) ----
	function applyThinkingToBody(body, withExtras) {
		if (!withExtras || S.settings.thinkingEnabled === false) return false; // Ein/Aus ist die einzige Nutzerwahl; Tiefe = Provider-Standard
		const cap = capStore()[capKey()];
		if (!cap || cap.state !== "ready" || !cap.includeThoughts) return false;
		body.extra_body = { google: { thinking_config: { include_thoughts: true } } };
		return true;
	}
	const isThoughtPart = (p) => p && (p.thought === true || p.type === "thinking" || p.type === "thought" || p.type === "reasoning");
	function reasoningFrom(o) {
		if (!o || typeof o !== "object") return "";
		if (typeof o.reasoning_content === "string" && o.reasoning_content) return o.reasoning_content;
		if (typeof o.reasoning === "string" && o.reasoning) return o.reasoning;
		return Array.isArray(o.content) ? o.content.filter(isThoughtPart).map((p) => p.text || p.content || "").join("") : "";
	}
	function textFrom(content) {
		if (content == null) return "";
		if (typeof content === "string") return content;
		if (!Array.isArray(content)) return String(content);
		return content.filter((p) => !isThoughtPart(p)).map((p) => (typeof p === "string" ? p : p?.text || p?.content || "")).join("");
	}
	const splitThink = THINK.splitThink; // Tag-Splitting + Sticky-Heuristik (pure, getestet in test-core.mjs)

	// ---- Chat: mit onDelta/onReasoning → SSE-Stream, sonst Einmal-Antwort ----
	// 4 Versuche mit Backoff, solange noch nichts gestreamt wurde: 5xx, 429 [F1] und
	// Netzwerkfehler (TypeError "Failed to fetch" — Netz/CORS/kurzer Ausfall).
	// Letzter Versuch lässt bei Tool-Anfragen das Schema weg (Gemini "500 INTERNAL").
	async function chatOnce(messages, tools, onDelta, onReasoning) {
		let produced = false;
		const plans = [
			{ label: "Standard", withExtras: true, tools },
			{ label: "Retry ohne Thinking-Extras", withExtras: false, tools },
			{ label: "Retry mit gleichem Request", withExtras: false, tools },
			{ label: tools?.length ? "Fallback ohne Tool-Schema" : "Letzter Retry", withExtras: false, tools: tools?.length ? null : tools },
		];
		const waits = [0, 750, 1800, 3500];
		let lastError = null;
		for (let i = 0; i < plans.length; i++) {
			const plan = plans[i];
			if (i) {
				debugEvent("Fallback", { step: plan.label, previousStatus: lastError?.status, waitMs: waits[i] });
				await sleep(Math.max(waits[i], lastError?.retryAfterMs || 0)); // [F1] Retry-After respektieren
			}
			try {
				const msg = await doChat(messages, plan.tools, onDelta, onReasoning, plan.withExtras, () => { produced = true; });
				debugEvent("KI-Antwort", {
					stream: !!onDelta, attempt: i + 1, mode: plan.label,
					content: String(msg.content || "").slice(0, 1200), reasoning: String(msg.reasoning || "").slice(0, 1200),
					rawContent: String(msg._debugRawContent || "").slice(0, 1600),
					toolCalls: (msg.tool_calls || []).map((tc) => ({ id: tc.id || null, name: tc.function?.name || null, arguments: tc.function?.arguments || "" })).filter((tc) => tc.name),
				});
				return msg;
			} catch (error) {
				if (error && error.name === "AbortError") throw error; // ⏹ Nutzer-Abbruch: niemals retrien
				const isNetworkError = !(error instanceof AiHttpError) && (error instanceof TypeError || /failed to fetch|load failed|networkerror/i.test(String(error?.message || error)));
				const retryable = !produced && ((error instanceof AiHttpError && (error.status >= 500 || error.status === 429)) || isNetworkError);
				if (!retryable) throw error;
				lastError = error;
			}
		}
		if (lastError && !(lastError instanceof AiHttpError)) {
			throw new Error("Keine Verbindung zum KI-Server (" + String(lastError?.message || lastError) + "). Prüfe Internet, Endpoint und CORS in den Einstellungen → KI.");
		}
		throw lastError || new Error("KI-Anfrage fehlgeschlagen.");
	}
	async function doChat(messages, tools, onDelta, onReasoning, withExtras, markProduced) {
		const body = { model: cfg().model, messages, temperature: 0.4 };
		applyThinkingToBody(body, withExtras);
		const reqTools = toolsForRequest(tools);
		if (reqTools) { body.tools = reqTools; body.tool_choice = "auto"; }
		if (!onDelta) return finishMessage(await (await request("/chat/completions", body)).json());
		body.stream = true;
		return readStream(await request("/chat/completions", body), onDelta, onReasoning, markProduced);
	}
	// Geminis opake Thought-Signatur: nie anzeigen/ändern, aber unverändert in Folge-Requests zurück.
	function copyGeminiThoughtMetadata(source, target) {
		if (cfg().providerId !== "google" || !source || !target) return;
		const extra = source.extra_content;
		const signature = source.thought_signature || source.thoughtSignature || extra?.google?.thought_signature || extra?.google?.thoughtSignature;
		if (signature) target.thought_signature = signature;
		if (extra && typeof extra === "object") target.extra_content = JSON.parse(JSON.stringify(extra));
	}
	function finishMessage(data) {
		const m = data?.choices?.[0]?.message || { role: "assistant", content: "" };
		const rawContent = textFrom(m.content);
		let reasoning = reasoningFrom(m);
		const split = splitThink(rawContent, !!reasoning);
		m.content = split.content;
		if (split.reasoning) reasoning = reasoning ? reasoning + "\n" + split.reasoning : split.reasoning;
		if (reasoning) m.reasoning = reasoning; else delete m.reasoning;
		m._debugRawContent = rawContent;
		return m;
	}
	async function readStream(res, onDelta, onReasoning, markProduced) {
		const reader = res.body.getReader();
		const dec = new TextDecoder();
		const msg = { role: "assistant", content: "", reasoning: "", tool_calls: [] };
		let rawContent = "", apiReasoning = "", buf = ""; // apiReasoning = echtes API-Reasoning, nie von der Heuristik überschrieben
		const emitReasoning = () => { if (onReasoning && msg.reasoning) onReasoning(msg.reasoning); };
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			buf += dec.decode(value, { stream: true });
			const lines = buf.split("\n");
			buf = lines.pop();
			for (const line of lines) {
				const s = line.trim();
				if (!s.startsWith("data:")) continue;
				const payload = s.slice(5).trim();
				if (!payload || payload === "[DONE]") continue;
				let delta = null;
				try { delta = (JSON.parse(payload).choices || [])[0]?.delta || null; } catch { continue; }
				if (!delta) continue; // z.B. reine usage-Chunks
				copyGeminiThoughtMetadata(delta, msg);
				markProduced();
				const apiPiece = reasoningFrom(delta);
				if (apiPiece) { apiReasoning += apiPiece; msg.reasoning = apiReasoning; emitReasoning(); }
				const textPiece = textFrom(delta.content);
				if (textPiece) {
					rawContent += textPiece;
					const split = splitThink(rawContent, !!apiReasoning); // Heuristik nur ohne API-Reasoning
					msg.content = split.content;
					msg.reasoning = split.reasoning ? (apiReasoning ? apiReasoning + "\n" + split.reasoning : split.reasoning) : apiReasoning;
					emitReasoning();
					onDelta(msg.content);
				}
				for (const tc of delta.tool_calls || []) {
					// [F2] index kann fehlen → per id mergen, sonst letzter Slot; unbekannte id = neuer Slot
					let i = tc.index ?? (tc.id ? msg.tool_calls.findIndex((slot) => slot.id === tc.id) : msg.tool_calls.length - 1);
					if (i < 0) i = msg.tool_calls.length;
					const slot = (msg.tool_calls[i] = msg.tool_calls[i] || { id: "", type: "function", function: { name: "", arguments: "" } });
					copyGeminiThoughtMetadata(tc, slot);
					if (tc.id) slot.id = tc.id;
					if (tc.function?.name) slot.function.name += tc.function.name;
					if (tc.function?.arguments) slot.function.arguments += tc.function.arguments;
				}
			}
		}
		if (!msg.tool_calls.length) delete msg.tool_calls;
		if (!msg.reasoning) delete msg.reasoning;
		msg._debugRawContent = rawContent;
		return msg;
	}
	// Für den API-Verlauf: interne Anzeige-Felder raus, Gemini-Signaturen bleiben erhalten.
	function toApiMessage(msg) {
		const out = { role: "assistant", content: msg.content || "" };
		if (msg.tool_calls?.length) {
			out.tool_calls = msg.tool_calls.map((call) => {
				const clean = { ...call, function: call.function ? { ...call.function } : call.function };
				copyGeminiThoughtMetadata(call, clean);
				return clean;
			});
		}
		copyGeminiThoughtMetadata(msg, out);
		return out;
	}

	// ---- Isolierter Verbindungstest (Debug-Knopf): trennt Server-/Thinking-/Tool-Schema-Fehler ----
	async function debugProbe() {
		const c = cfg();
		const messages = [
			{ role: "system", content: "Antworte ausschließlich mit OK." },
			{ role: "user", content: "Schreibe OK." },
		];
		const runProbe = async (name, tools, withExtras) => {
			const started = performance.now();
			try {
				const m = await doChat(messages, tools, null, null, withExtras, () => {});
				return { name, ok: true, ms: Math.round(performance.now() - started), answer: String(m.content || "").slice(0, 120), hasReasoning: !!m.reasoning };
			} catch (error) {
				return { name, ok: false, ms: Math.round(performance.now() - started), status: error instanceof AiHttpError ? error.status : null, error: String(error?.message || error).slice(0, 260) };
			}
		};
		const pingOk = await ping();
		const tests = [
			await runProbe("Antwort mit Thinking-Parametern", null, true),
			await runProbe("Antwort ohne Thinking-Parameter", null, false),
			await runProbe("Antwort mit Tool-Schema", TOOLS.defs, false),
		];
		return { provider: c.providerId || "—", model: c.model || "—", base: c.base || "—", pingOk, tests };
	}

	// Einmal-Aufruf ohne Tools (z.B. PDF-Ingest).
	async function complete(prompt, system) {
		const messages = system ? [{ role: "system", content: system }] : [];
		messages.push({ role: "user", content: prompt });
		return (await chatOnce(messages)).content || "";
	}

	// ---- System-Prompt (schlank; Abrufbares liegt in Tools, Auszüge liefert Auto-RAG) ----
	// 🃏 Karteikarten-Kontext (23. Juli): Ist der Anki-Bereich offen, bekommt die KI
	// Stapel, Tageszähler und die gerade sichtbare Lernkarte — analog zur geöffneten Seite.
	function ankiContext() {
		if (S.view !== "anki") return "";
		const snap = STATE.studySnapshot(S.ankiDeck);
		const cnt = snap.counts;
		let line = "Geöffnet: Karteikarten-Bereich (Ansicht: " + (S.ankiTab || "decks") + "), Stapel: " +
			(S.ankiDeck || "alle") + " — heute offen: " + cnt.neu + " neu, " + cnt.learn + " lernen, " + cnt.review + " wiederholen.";
		const card = S.ankiTab === "study" ? ((S.reviewShowBack && S.cards[S.reviewCardId]) || snap.dueNow[0]) : null;
		if (card) {
			line += '\nSichtbare Lernkarte — Frage: "' + String(card.front || "").slice(0, 600) + '"';
			line += S.reviewShowBack
				? '\nAntwort (aufgedeckt): "' + String(card.back || "").slice(0, 600) + '"'
				: "\nDie Antwort ist noch verdeckt — verrate sie nicht ungefragt, gib höchstens Hinweise.";
		}
		return line;
	}
	// toolsMode: true = volle Liste, "meta" = nur request_tools, sonst keine Tools [F3]
	function systemPrompt(type, toolsMode, ragContext, chatSummary) {
		const cur = S.currentPageId ? S.pages[S.currentPageId] : null;
		const now = new Date();
		const toolLine = toolsMode === true
			? "Nutze deine Tools aktiv statt zu raten. Kontext holen: get_context (zuletzt bearbeitete Seiten, Lernstatus, Inhalt der geöffneten Seite), list_pages, read_page, semantic_search/search_notes. Schreiben: create_page/append_to_page, create_flashcards. Löschen wird immer im Chat bestätigt. Bei Mehrdeutigkeit: ask_choice. Sage nach Tool-Nutzung kurz, was geändert wurde."
			: toolsMode === "meta"
				? "Aktuell ist nur das Werkzeug request_tools verfügbar. Sobald die Anfrage Notizen, Karten, Hefte, Suche oder Aktionen im Workspace erfordern könnte, rufe ZUERST request_tools auf — danach stehen alle Werkzeuge in derselben Anfrage bereit. Sonst antworte direkt."
				: "Für diese Anfrage sind keine Werkzeuge aktiv. Antworte direkt aus dem vorhandenen Kontext. Sprich NIE über Werkzeuge, fehlenden Daten-Zugriff oder „dieses Chat-Fenster“ und behaupte keine Suchen oder Änderungen. Wären Notiz-Inhalte nötig, bitte den Nutzer, die Frage konkret zu formulieren (z. B. „Durchsuche meine Notizen nach …“).";
		const lines = [
			"Du bist der KI-Coach von Impala67, einer lokalen Notiz- und Lern-App. Antworte auf Deutsch, kompakt. Formeln als LaTeX ($...$ inline, $$...$$ als Block).",
			"Heute: " + now.toLocaleDateString("de-DE", { weekday: "short", year: "numeric", month: "2-digit", day: "2-digit" }) + ", " + now.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) + " Uhr.",
			S.view === "anki" ? ankiContext() : cur ? 'Geöffnete Seite: "' + cur.title + '"' : "Keine Seite geöffnet.",
			toolLine,
			"Niemals Selbstgespräche/Meta-Kommentare im sichtbaren Text ('Der Nutzer möchte…', 'I should…'). Ausführliches Nachdenken gehört AUSSCHLIESSLICH in <think>...</think> VOR der Antwort.",
		];
		// Nur das Seitenpanel bekommt den Seiteninhalt direkt; der Vollbild-Chat holt ihn per Tool.
		// Im Karteikarten-Bereich ersetzt der Anki-Kontext oben die Seite (keine irreführende Hintergrund-Seite).
		if (type === "side" && cur && S.view !== "anki") {
			const body = String(cur.content || "");
			lines.push("Inhalt der geöffneten Seite" + (body.length > 6000 ? " (gekürzt)" : "") + ":\n" + (body.slice(0, 6000) || "(Leere Seite)"));
		}
		if (ragContext) lines.push("Automatisch gefundene, möglicherweise relevante Notiz-Auszüge:\n" + ragContext);
		if (chatSummary) lines.push("Zusammenfassung des bisherigen Gesprächs (ältere Nachrichten, nicht mehr im Verlauf):\n" + chatSummary);
		if (S.settings.customInstructions?.trim()) lines.push("Zusätzliche Anweisungen (aus den Einstellungen):\n" + S.settings.customInstructions.trim());
		return lines.join("\n");
	}

	// ---- Chat-Persistenz (kein APP-Import — wäre zyklisch: chat-fullscreen → ai → …) ----
	function persistChat(type) {
		const messages = type === "side" ? S.sideChat : S.chat;
		const idKey = type === "side" ? "sideChatId" : "currentChatId";
		if (!messages.length) return;
		const list = CHATS.load();
		let s = S[idKey] ? list.find((x) => x.id === S[idKey]) : null;
		if (!s) {
			s = { id: U.uid(), title: "", created: U.now(), messages: [] };
			S[idKey] = s.id;
			list.unshift(s);
		}
		s.messages = messages;
		s.updated = U.now();
		if (!s.title) {
			const first = messages.find((m) => m.role === "user");
			s.title = first ? String(first.content).slice(0, 60) : "Neuer Chat";
		}
		CHATS.save(list);
	}

	// ---- Lösch-Tools: EINE Bestätigungs-Pipeline. resolve() → Fehler ODER {detail,question,runArgs,cancelled} ----
	const DELETE_SPECS = {
		delete_page: {
			resolve(args) {
				const title = String(args?.page_title || "").trim();
				if (!title) return { error: "delete_page: page_title fehlt." };
				const pg = STATE.findPage(title);
				if (!pg) return { error: "Seite nicht gefunden: " + title };
				const countKids = (id) => Object.values(S.pages).reduce((n, p) => (!p.trashed && p.parentId === id ? n + 1 + countKids(p.id) : n), 0);
				const subN = countKids(pg.id);
				return {
					detail: pg.title,
					question: 'Seite „' + pg.title + '“' + (subN ? " inkl. " + subN + " Unterseite(n)" : "") + " in den Papierkorb?",
					runArgs: { page_title: pg.title },
					cancelled: { cancelled: true, title: pg.title, note: "Löschen abgebrochen — nichts geändert." },
				};
			},
		},
		delete_flashcard: {
			resolve(args) {
				const front = String(args?.front || "").trim();
				if (!front) return { error: "delete_flashcard: front fehlt." };
				const card = TOOLS.findCard(front, args?.deck);
				if (!card) return { error: "Karte nicht gefunden: " + front };
				const short = String(card.front || "").replace(/\s+/g, " ").trim();
				const label = short.length > 60 ? short.slice(0, 60) + "…" : short;
				return {
					detail: short,
					question: 'Karte „' + label + '“ in den Papierkorb?',
					runArgs: { front: card.front, deck: card.deck },
					cancelled: { cancelled: true, front: card.front, note: "Löschen abgebrochen — nichts geändert." },
				};
			},
		},
		delete_deck: {
			resolve(args) {
				const name = String(args?.deck || "").trim();
				if (!name) return { error: "delete_deck: deck fehlt." };
				const match = TOOLS.resolveDeckName(name);
				if (!match) return { error: "Stapel nicht gefunden: " + name };
				const cardN = Object.values(S.cards).filter((c) => !c.trashed && ((c.deck || "Standard") === match || (c.deck || "Standard").startsWith(match + "::"))).length;
				return {
					detail: match,
					question: 'Stapel „' + match + '“' + (cardN ? " inkl. " + cardN + " Karte(n)" : "") + " in den Papierkorb?",
					runArgs: { deck: match },
					cancelled: { cancelled: true, deck: match, note: "Löschen abgebrochen — nichts geändert." },
				};
			},
		},
	};

	// ---- Agent-Loop: Streaming, Tools, Bestätigungen, Edit-Karten ----
	async function agent(userText, type, onStep) {
		type = type || "side";
		const targetChat = type === "side" ? S.sideChat : S.chat;
		const renderLog = () => (type === "side" ? RENDER.renderChat() : RENDER.renderMainChatLog());

		const pendingEdits = []; // Edit-Karten dieses Laufs — erst NACH der finalen Antwort anhängen
		const flushPendingEdits = () => {
			if (!pendingEdits.length) return;
			targetChat.push(...pendingEdits);
			pendingEdits.length = 0;
			renderLog();
		};

		// Anhänge gehören exklusiv zu dem Chat, in dem sie gewählt wurden
		const useAttachment = S.pendingAttachmentTarget === type;
		const image = useAttachment ? S.pendingImage : null;
		const textFile = useAttachment ? S.pendingTextFile : null;
		const pdfFile = useAttachment ? S.pendingPdf : null;
		if (useAttachment) {
			S.pendingImage = S.pendingTextFile = S.pendingPdf = S.pendingAttachmentTarget = null;
			// Bug-Fix („kommt noch“, 22. Juli): Anhang-Chip SOFORT beim Absenden ausblenden —
			// vorher blieb er bis zum nächsten Voll-Render (Ende der Antwort) im Composer stehen.
			RENDER.renderPendingChip(type);
		}
		targetChat.push({ mid: U.uid(), role: "user", content: userText, image, textFile, pdfFile });
		renderLog(); // eigene Nachricht sofort zeigen — nicht erst nach RAG/Zusammenfassung/erstem Token

		// Verlauf: Bilder als image_url (Vision), Text-/PDF-Anhänge als Kontext
		const history = targetChat.slice(-historyLimit())
			.filter((m) => m.role === "user" || m.role === "assistant")
			.map((m) => {
				let content = m.content || "";
				if (m.textFile) content = (content ? content + "\n\n" : "") + "[Angehängte Datei: " + m.textFile.name + "]\n" + m.textFile.content;
				if (m.pdfFile) content = (content ? content + "\n\n" : "") + "[Angehängtes PDF: " + m.pdfFile.name + "]\n" + m.pdfFile.content;
				return m.image ? { role: m.role, content: [{ type: "text", text: content }, { type: "image_url", image_url: { url: m.image } }] } : { role: m.role, content };
			});
		const fullToolDefs = () => {
			let defs = TOOLS.defs.slice();
			if (typeof window.EXP?.extraToolDefs === "function") defs = defs.concat(window.EXP.extraToolDefs()); // 🧪 Experimente
			return defs;
		};
		const metaOnly = S.settings.alwaysSendTools === false && !toolsUnlocked;
		let agentTools = metaOnly ? [META_TOOL_DEF] : fullToolDefs();
		// Auto-RAG: relevanteste Notiz-Auszüge zur aktuellen Frage; Fehler → still kein Extra-Kontext
		let ragContext = "";
		try {
			if (RAG.enabled() && String(userText || "").trim().length >= 8) {
				ragContext = ((await RAG.search(userText, 4)) || [])
					.filter((h) => (h.score == null || h.score >= 0.3) && h.snippet)
					.map((h) => "• [" + h.title + "] " + h.snippet)
					.join("\n");
			}
		} catch (e) { debugEvent("Auto-RAG übersprungen", { error: String(e?.message || e).slice(0, 200) }); }
		// Rollierende Zusammenfassung für Nachrichten jenseits des Verlaufsfensters (Auffrischung ab 4 neuen)
		let chatSummary = "";
		try {
			const convo = targetChat.filter((m) => m.role === "user" || m.role === "assistant");
			const overflow = convo.slice(0, Math.max(0, convo.length - historyLimit()));
			if (overflow.length) {
				const summaryKey = type + ":" + ((type === "side" ? S.sideChatId : S.currentChatId) || "neu");
				const cached = chatSummaries[summaryKey];
				if (cached && overflow.length - cached.count < 4) {
					chatSummary = cached.text;
				} else {
					const fresh = cached ? overflow.slice(cached.count) : overflow;
					const transcript = fresh.map((m) => (m.role === "user" ? "Nutzer: " : "KI: ") + String(m.content || "").replace(/\s+/g, " ").slice(0, 600)).join("\n");
					const summaryMsg = await chatOnce([
						{ role: "system", content: "Du fasst einen Chat-Verlauf zusammen. Maximal 120 Wörter. Behalte Fakten, Namen, Entscheidungen, offene Aufgaben und Nutzer-Vorlieben. Antworte NUR mit der Zusammenfassung." },
						{ role: "user", content: (cached ? "Bisherige Zusammenfassung:\n" + cached.text + "\n\nNeue Nachrichten:\n" : "Verlauf:\n") + transcript },
					]);
					const summaryText = String(summaryMsg.content || "").trim();
					if (summaryText) { chatSummaries[summaryKey] = { count: overflow.length, text: summaryText }; chatSummary = summaryText; }
					else if (cached) chatSummary = cached.text;
				}
			}
		} catch (e) { debugEvent("Chat-Zusammenfassung übersprungen", { error: String(e?.message || e).slice(0, 200) }); }
		// 👁 Vision-Hinweis: Modelle ohne Bild-Empfang sollen das offen sagen statt zu raten
		const visionNote = history.some((m) => Array.isArray(m.content))
			? "\n\nAn Nachrichten können Bilder hängen (z. B. Heft-Seiten oder Screenshots). Wenn du Bilder technisch nicht empfangen oder nicht sehen kannst (kein Vision-Modell), erwähne das kurz und ehrlich, statt Inhalte zu raten."
			: "";
		const sysMsg = (mode) => ({ role: "system", content: systemPrompt(type, mode, ragContext, chatSummary) + visionNote });
		const messages = [sysMsg(metaOnly ? "meta" : true), ...history];
		debugEvent("Tool-Modus", { mode: metaOnly ? "nur request_tools" : "volle Liste", reason: metaOnly ? "Einstellung »Tools immer mitsenden« ist aus" : (toolsUnlocked ? "in dieser Sitzung freigeschaltet" : "Standard: Tools immer mitsenden") }); // [F3]

		// Max. ~12 Chat-Log-Rebuilds/s (LaTeX/Code-Rendering ist teuer)
		let renderQueued = false, lastLiveRender = 0;
		const scheduleRender = () => {
			if (renderQueued) return;
			renderQueued = true;
			setTimeout(() => { renderQueued = false; lastLiveRender = Date.now(); renderLog(); }, Math.max(16, 80 - (Date.now() - lastLiveRender)));
		};

		// Frage-Karte anzeigen und auf Klick warten (ask_choice + Lösch-Bestätigungen)
		async function waitForAnswer(question, options, status) {
			const qMid = U.uid();
			if (type === "side") {
				document.body.classList.remove("panel-collapsed");
				if (typeof RENDER.renderTabs === "function") RENDER.renderTabs();
			}
			S.aiStatus = status;
			S.aiDraft = "";
			S.aiThinkingDraft = "";
			const answer = await new Promise((resolve) => {
				pendingChoices[qMid] = resolve;
				targetChat.push({ mid: qMid, role: "question", question, options, answered: false });
				renderLog();
			});
			const qMsg = targetChat.find((x) => x.mid === qMid);
			if (qMsg) { qMsg.answered = true; qMsg.answer = answer; }
			S.aiStatus = "…denkt nach…";
			return answer;
		}
		const pushToolChip = (name, detail, error) => targetChat.push({ mid: U.uid(), role: "tool", name, detail: String(detail || "").slice(0, 80), error: !!error });
		const pushToolResult = (tc, out) => messages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(out) });
		const persist = () => { try { persistChat(type); } catch (e) { console.warn("Chat speichern:", e); } };

		// 💭 Gedankengang über ALLE Agent-Schritte sammeln (bleibt sichtbar, wird komplett gespeichert)
		let runReasoning = "";
		const addRunReasoning = (piece) => { if (piece) runReasoning = runReasoning ? runReasoning + "\n\n" + piece : piece; };
		for (let step = 0; step < MAX_AGENT_STEPS; step++) {
			S.aiDraft = "";
			S.aiThinkingDraft = runReasoning;
			const msg = await chatOnce(
				messages, agentTools,
				(text) => { S.aiDraft = text; scheduleRender(); },
				(text) => { S.aiThinkingDraft = runReasoning ? runReasoning + "\n\n" + text : text; scheduleRender(); },
			);
			addRunReasoning(msg.reasoning);
			messages.push(toApiMessage(msg)); // bereinigt in den API-Verlauf (ohne interne Felder)

			if (!msg.tool_calls?.length) { // finale Antwort
				const finalMsg = { mid: U.uid(), role: "assistant", content: msg.content || "", reasoning: runReasoning || null, reasoningExpanded: false };
				S.aiDraft = "";
				S.aiThinkingDraft = "";
				targetChat.push(finalMsg);
				flushPendingEdits();
				persist(); // Reload direkt nach der Antwort darf den Chat nicht verlieren
				return finalMsg.content;
			}

			// 📓 Bilder aus get_heft_page_image — erst NACH allen Tool-Antworten dieses Schritts anhängen
			// (zwischen assistant(tool_calls) und den tool-Antworten darf keine andere Nachricht stehen)
			const pendingImageMessages = [];
			for (const tc of msg.tool_calls) {
				const name = tc.function.name;
				let args = {};
				try { args = JSON.parse(tc.function.arguments || "{}"); } catch { /* leere Argumente */ }

				if (name === "get_heft_page_image") { // 📓 Heftseite als Bild (Vision); als user-Nachricht injiziert
					let out, pageNo = 0;
					try {
						const HEFT = window.HEFT;
						if (typeof HEFT?.pageAsDataUrl !== "function") throw new Error("Heft-Modul nicht verfügbar.");
						let heftId = null;
						if (args.page_title) {
							const pg = STATE.findPage(args.page_title);
							if (!pg) throw new Error("Keine Seite mit Titel „" + args.page_title + "“ gefunden.");
							if (pg.kind !== "heft") throw new Error("„" + pg.title + "“ ist kein Handschrift-Heft.");
							heftId = pg.id;
						} else if (HEFT.activeId) heftId = HEFT.activeId;
						else throw new Error("Es ist gerade kein Heft geöffnet — bitte page_title angeben.");
						const pageIdx = args.heft_page ? Math.max(0, Math.floor(args.heft_page) - 1) : (HEFT.activeId === heftId ? (HEFT.activeIndex || 0) : 0);
						pageNo = pageIdx + 1;
						const dataUrl = await HEFT.pageAsDataUrl(heftId, pageIdx);
						pendingImageMessages.push({ role: "user", content: [
							{ type: "text", text: "[Automatisch angehängt: Heftseite " + pageNo + " als Bild" + (args.page_title ? " aus „" + args.page_title + "“" : "") + "]" },
							{ type: "image_url", image_url: { url: dataUrl } },
						] });
						out = { ok: true, hinweis: "Heftseite " + pageNo + " folgt direkt nach den Tool-Ergebnissen als Bild-Nachricht. Falls du Bilder technisch nicht sehen kannst (kein Vision-Modell), sage das kurz und ehrlich." };
					} catch (e) { out = { error: String(e?.message || e) }; }
					if (onStep) onStep(name);
					pushToolChip(name, (args.page_title || "aktuelles Heft") + (pageNo ? " · Seite " + pageNo : ""), out?.error);
					scheduleRender();
					pushToolResult(tc, out);
					persist();
					continue;
				}

				if (name === "request_tools") { // Sparmodus: volle Liste freischalten + Prompt aktualisieren [F3]
					toolsUnlocked = true;
					agentTools = fullToolDefs();
					messages[0] = sysMsg(true);
					if (onStep) onStep(name);
					pushToolChip(name, "Werkzeuge freigeschaltet");
					scheduleRender();
					pushToolResult(tc, { ok: true, hinweis: "Alle Werkzeuge sind jetzt in dieser Anfrage verfügbar." });
					continue;
				}

				if (DELETE_SPECS[name]) { // gemeinsame Lösch-Bestätigung
					const spec = DELETE_SPECS[name].resolve(args);
					if (spec.error) {
						if (onStep) onStep(name);
						pushToolChip(name, spec.error, true);
						scheduleRender();
						pushToolResult(tc, { error: spec.error });
						continue;
					}
					const answer = await waitForAnswer(spec.question, ["Ja, löschen", "Abbrechen"], "Warte auf Bestätigung…");
					let out;
					if (!String(answer || "").toLowerCase().startsWith("ja")) out = spec.cancelled;
					else { try { out = await TOOLS.run(name, spec.runArgs); } catch (e) { out = { error: String(e) }; } }
					if (onStep) onStep(name);
					if (!out.cancelled) pushToolChip(name, spec.detail, out?.error); // Abbruch: beantwortete Frage-Karte reicht
					renderLog();
					pushToolResult(tc, out);
					persist();
					continue;
				}

				if (name === "ask_choice") { // Rückfrage: pausiert bis Klick, nur Frage-Karte in der UI
					const norm = TOOLS.normalizeAskChoice(args);
					if (norm.error) {
						if (onStep) onStep(name);
						pushToolChip(name, norm.error, true);
						scheduleRender();
						pushToolResult(tc, norm);
						continue;
					}
					const answer = await waitForAnswer(norm.question, norm.options, "Warte auf deine Auswahl…");
					if (onStep) onStep(name);
					renderLog();
					pushToolResult(tc, { answer, question: norm.question });
					persist();
					continue;
				}

				// Normale Tools (inkl. Seiten-Änderungen mit Edit-Karte)
				const mutating = MUTATING_TOOLS.has(name);
				let beforePageId = null, before = { title: "", content: "" };
				if (mutating && name !== "create_page") {
					const pg = STATE.findPage(args.page_title);
					if (pg) { beforePageId = pg.id; before = { title: pg.title, content: pg.content }; }
				}
				let out;
				try { out = await TOOLS.run(name, args); } catch (e) { out = { error: String(e) }; }
				if (onStep) onStep(name);
				let detail = args.page_title || args.title || args.query || "";
				if (name === "semantic_search") detail = (detail ? detail + " · " : "") + "Embedding: " + (S.settings.embedModel || "—");
				pushToolChip(name, detail, out?.error);
				scheduleRender();
				if (mutating && out && !out.error) {
					let pageId = beforePageId, created = false;
					if (name === "create_page") {
						// Fix (23. Juli): bevorzugt die vom Tool zurückgegebene id — die reine
						// Titel-Suche konnte bei zwei gleichnamigen Seiten die falsche Seite
						// (und damit eine falsche Diff-/Undo-Karte) erwischen.
						const pg = (out.id && S.pages[out.id]) || STATE.findPage(args.title);
						if (pg) { pageId = pg.id; created = true; }
					}
					if (pageId && S.pages[pageId]) {
						const after = { title: S.pages[pageId].title, content: S.pages[pageId].content };
						pendingEdits.push({ mid: U.uid(), role: "edit", pageId, pageTitle: after.title, before, after, created, undone: false });
					}
				}
				pushToolResult(tc, out);
				persist();
			}
			if (pendingImageMessages.length) messages.push(...pendingImageMessages); // 📓 jetzt anhängen (siehe oben)
		}
		S.aiDraft = "";
		S.aiThinkingDraft = "";
		const abort = "(Abgebrochen: zu viele Tool-Schritte.)";
		targetChat.push({ mid: U.uid(), role: "assistant", content: abort });
		flushPendingEdits();
		persist();
		return abort;
	}

	// ---- Rückfragen auflösen (Klick auf Frage-Karte) & Antwort anpassen ----
	function resolveChoice(mid, answer) {
		const resolve = pendingChoices[mid];
		if (!resolve) return false;
		delete pendingChoices[mid];
		resolve(answer);
		return true;
	}
	const hasPendingChoice = () => Object.keys(pendingChoices).length > 0;
	// Formuliert eine bestehende Antwort länger/kürzer/gleich um.
	async function refine(historyMessages, instruction, onDelta) {
		return (await chatOnce([{ role: "system", content: systemPrompt() }, ...historyMessages, { role: "user", content: instruction }], null, onDelta)).content || "";
	}

	return { chatOnce, complete, agent, abortActive, resolveChoice, hasPendingChoice, refine, ping, pingProvider, embed, listModels, listEmbeddingModels, detectThinkingCapabilities, debugProbe, debugReport, MODEL_PRESETS };
})();