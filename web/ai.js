"use strict";

import { S, STATE } from "./state.js";
import { TOOLS } from "./tools.js";
import { U } from "./util.js";
import { RENDER } from "./render.js";
import { CHATS } from "./chats.js";
import { THINK } from "./think-heuristik.js";
import { RAG } from "./rag.js";

// ai.js — KI-Adapter (OpenAI-kompatibel: LM Studio, OpenAI, Google Gemini).
// Komplett-Rewrite (11. Juli 2026): gleiche Features, klare Struktur:
//   Konfiguration → HTTP → Tool-Schemas → Thinking/Reasoning → Chat (Stream/Einmal)
//   → System-Prompt → Agent-Loop → Rückfragen/refine.
export const AI = (() => {
	// =========================================================================
	// Konstanten
	// =========================================================================
	const MODEL_PRESETS = [
		{ value: "gemini-2.5-flash", label: "Gemini 2.5 Flash", provider: "google" },
		{ value: "gemini-2.5-pro", label: "Gemini 2.5 Pro", provider: "google" },
		{ value: "gemma-4-31b-it", label: "Gemma 4 31B", provider: "google" },
		{ value: "gemma-4-26b-a4b-it", label: "Gemma 4 26B A4B", provider: "google" },
		{ value: "gpt-4.1", label: "GPT-4.1", provider: "openai" },
		{ value: "gpt-4.1-mini", label: "GPT-4.1 mini", provider: "openai" },
		{ value: "local-model", label: "Lokales Modell", provider: "local" },
	];
	// Tools mit Seiten-Änderung → automatische Edit-Karte (Diff + Undo) im Chat.
	const MUTATING_TOOLS = new Set(["create_page", "append_to_page", "replace_page_content"]);
	const MAX_AGENT_STEPS = 8;
	// Dynamisches Verlaufsfenster (15. Juli): lokale Modelle haben kleine Kontexte
	// (16 Nachrichten), Cloud-Modelle (Gemini/GPT, 128k–1M Token Kontext) vertragen
	// deutlich mehr — lange Chats bleiben kohärent, ohne lokale Server zu überladen.
	function historyLimit() {
		return cfg().providerId === "local" ? 16 : 48;
	}
	// Datenschutzfreundliches Laufzeitprotokoll für den Debug-Knopf: nur technische
	// Metadaten und gekürzte Modell-Ausgaben, niemals API-Key oder Notizinhalte.
	const DEBUG_LOG_LIMIT = 40;
	const debugLog = [];
	function debugEvent(kind, detail) {
		debugLog.push({ at: new Date().toISOString(), kind, detail });
		if (debugLog.length > DEBUG_LOG_LIMIT) debugLog.splice(0, debugLog.length - DEBUG_LOG_LIMIT);
	}
	function debugReport() {
		const { base, model, providerId } = cfg();
		const rows = debugLog.map((entry) => "[" + entry.at + "] " + entry.kind + "\n" + JSON.stringify(entry.detail, null, 2));
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
	// Offene Rückfragen (ask_choice / Lösch-Bestätigungen): Frage-mid → resolve().
	const pendingChoices = Object.create(null);
	// Rollierende Chat-Zusammenfassung je Chat (Kontext über das Verlaufsfenster
	// hinaus, 17. Juli): summaryKey → { count, text }. Nur im Speicher — beim Reload
	// wird sie beim nächsten Überlauf einfach neu aufgebaut.
	const chatSummaries = Object.create(null);

	// =========================================================================
	// Quellen & Konfiguration
	// =========================================================================
	function activeProvider() {
		const providers = S.settings.aiProviders || [];
		return providers.find((p) => p.id === S.settings.aiProviderId) || providers[0] || null;
	}
	function cfg() {
		const pr = activeProvider();
		return {
			base: String((pr && pr.base) || "").replace(/\/+$/, ""),
			key: (pr && pr.key) || "",
			model: S.settings.aiModel || "",
			providerId: (pr && pr.id) || "",
		};
	}
	function thinkingCapabilityKey(config) {
		const c = config || cfg();
		return [c.providerId, c.base, c.model].join("::");
	}
	function thinkingCapabilityStore() {
		return S.thinkingCapabilities || (S.thinkingCapabilities = Object.create(null));
	}
	// OpenAI-kompatible /models-Antworten enthalten keine einheitliche Thinking-
	// Capability. Aktive Proben über /chat/completions wären kostenpflichtige
	// Generierungen und sind deshalb ausgeschlossen. Stattdessen verwendet die App
	// einen kleinen, versionierten Provider-Manifest: nur dokumentierte Kombinationen
	// werden freigeschaltet, unbekannte Modelle bleiben bei „Automatisch“ ohne
	// Reasoning-Parameter. Das Menü bleibt dabei immer bedienbar.
	function declaredThinkingCapabilities(config) {
		const model = String(config.model || "").toLowerCase();
		// Gemini 2.5 unterstützt im OpenAI-kompatiblen Gateway low/medium/high;
		// Google mappt sie auf 1k/8k/24k Thinking-Budget. Gemma erhält keine
		// Freigabe, weil sie über diesen Gateway kein dokumentiertes Budget hat.
		if (config.providerId === "google" && /^gemini-2\.5-(flash|pro)/.test(model)) {
			return { levels: ["low", "medium", "high"], includeThoughts: true, source: "gemini-openai" };
		}
		// Lokale OpenAI-kompatible Server sind nicht einheitlich: LM Studio kann
		// Reasoning ausgeben, bietet die steuerbare gpt-oss-Variante aber über
		// /responses statt über den hier verwendeten /chat/completions-Adapter an.
		return { levels: [], includeThoughts: false, source: "none" };
	}
	async function detectThinkingCapabilities() {
		const config = cfg();
		const key = thinkingCapabilityKey(config);
		const store = thinkingCapabilityStore();
		if (store[key]) return store[key];
		const declared = declaredThinkingCapabilities(config);
		const cap = store[key] = {
			state: "ready",
			levels: declared.levels,
			includeThoughts: declared.includeThoughts,
			error: config.model && !declared.levels.length
				? "Für dieses Modell ist über den aktuellen Chat-Adapter keine steuerbare Thinking-Stufe dokumentiert."
				: "",
			source: declared.source,
		};
		debugEvent("Thinking-Fähigkeiten", { provider: config.providerId, model: config.model, state: cap.state, levels: cap.levels, source: cap.source, passive: true });
		return cap;
	}

	// =========================================================================
	// HTTP
	// =========================================================================
	class AiHttpError extends Error {
		constructor(status, text) {
			super("KI-Fehler " + status + ": " + String(text || "").slice(0, 300));
			this.status = status;
		}
	}
	async function request(path, body) {
		const { base, key, providerId } = cfg();
		if (!base) throw new Error("Kein KI-Server konfiguriert (Einstellungen → KI).");
		const started = performance.now();
		// Forensisches Debug: exakt das bereinigte Tool-Schema, das tatsächlich an
		// Google geschickt wird. Nachrichten/Key werden bewusst NICHT protokolliert.
		const toolSchemas = Array.isArray(body.tools) ? body.tools.map((tool) => ({
			type: tool.type,
			name: tool.function && tool.function.name,
			description: tool.function && tool.function.description,
			parameters: tool.function && tool.function.parameters,
		})) : [];
		const messageMeta = Array.isArray(body.messages) ? body.messages.map((message) => {
			const content = message && message.content;
			const chars = typeof content === "string" ? content.length : JSON.stringify(content || "").length;
			return { role: (message && message.role) || "?", chars, hasToolCalls: !!(message && message.tool_calls && message.tool_calls.length) };
		}) : [];
		const meta = {
			path, provider: providerId || "—", model: body.model || "—", stream: !!body.stream,
			messageCount: messageMeta.length, messageChars: messageMeta.reduce((sum, message) => sum + message.chars, 0), messageMeta,
			toolCount: toolSchemas.length, toolChoice: body.tool_choice || null, toolSchemas,
			temperature: body.temperature, thinkingExtras: !!body.extra_body || !!body.reasoning_effort,
			extraBody: body.extra_body || null, reasoningEffort: body.reasoning_effort || null,
		};
		debugEvent("HTTP-Anfrage", meta);
		let res;
		try {
			res = await fetch(base + path, {
				method: "POST",
				headers: { "Content-Type": "application/json", ...(key ? { Authorization: "Bearer " + key } : {}) },
				body: JSON.stringify(body),
			});
		} catch (error) {
			debugEvent("Netzwerkfehler", { ...meta, ms: Math.round(performance.now() - started), error: String((error && error.message) || error) });
			throw error;
		}
		if (!res.ok) {
			const text = await res.text().catch(() => "");
			debugEvent("HTTP-Fehler", { ...meta, status: res.status, requestId: res.headers.get("x-request-id") || res.headers.get("x-goog-request-id") || null, ms: Math.round(performance.now() - started), response: String(text).slice(0, 1000) });
			throw new AiHttpError(res.status, text);
		}
		debugEvent("HTTP-Erfolg", { ...meta, status: res.status, requestId: res.headers.get("x-request-id") || res.headers.get("x-goog-request-id") || null, ms: Math.round(performance.now() - started) });
		return res;
	}

	// =========================================================================
	// Tool-Schemas für Google bereinigen: der Kompat-Layer übersetzt in Geminis
	// natives Schema (OpenAPI-3.0-Subset) — minItems/maxItems & Co. lösen dort
	// gern einen generischen "500 INTERNAL" aus.
	// =========================================================================
	const DROPPED_SCHEMA_KEYS = new Set(["minItems", "maxItems", "additionalProperties", "default", "$schema", "examples"]);
	function sanitizeToolSchema(schema) {
		if (!schema || typeof schema !== "object") return schema;
		if (Array.isArray(schema)) return schema.map(sanitizeToolSchema);
		const out = {};
		for (const k of Object.keys(schema)) {
			if (DROPPED_SCHEMA_KEYS.has(k)) continue;
			const v = schema[k];
			out[k] = v && typeof v === "object" ? sanitizeToolSchema(v) : v;
		}
		return out;
	}
	function toolsForRequest(tools) {
		if (!tools || !tools.length) return undefined;
		if (cfg().providerId !== "google") return tools;
		return tools.map((td) => ({
			type: td.type,
			function: {
				name: td.function.name,
				description: td.function.description,
				parameters: sanitizeToolSchema(td.function.parameters),
			},
		}));
	}
	// Tool-Angebot v3 (17. Juli, abends): Die Wortlisten-Heuristik ist komplett
	// entfernt. Standard („Tools immer mitsenden“, Einstellungen → KI): ALLE
	// Werkzeuge gehen bei jeder Anfrage mit. Ausgeschaltet: nur das Meta-Werkzeug
	// unten geht mit — ruft die KI es auf, läuft DIESELBE Anfrage sofort mit der
	// vollen Liste weiter. So entscheidet das MODELL statt einer Regex.
	const META_TOOL_DEF = {
		type: "function",
		function: {
			name: "request_tools",
			description: "Schaltet die vollständige Werkzeugliste frei (Notizen lesen/erstellen/ändern, Suche, Karteikarten, NotebookLM …). Rufe dieses Werkzeug auf, sobald die Anfrage Zugriff auf Notizen, Karten, Hefte oder Aktionen im Workspace erfordern könnte.",
			parameters: { type: "object", properties: {}, required: [] },
		},
	};
	// Einmal freigeschaltet, bleiben die Werkzeuge für die Sitzung verfügbar —
	// sonst scheiterte „ja, mach das“ direkt nach einer Freischaltung wieder.
	let toolsUnlocked = false;
	const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

	// =========================================================================
	// Status / Modelle / Embeddings
	// =========================================================================
	// Basis-URL ist immer vollständig (bei Google inkl. /v1beta/openai) — nie "/v1" anhängen.
	async function ping() {
		const { base, key } = cfg();
		if (!base) return false;
		try {
			const res = await fetch(base + "/models", { headers: key ? { Authorization: "Bearer " + key } : {} });
			return res.ok;
		} catch { return false; }
	}
	async function listModels() {
		const providers = (S.settings.aiProviders || []).filter((p) => p.base);
		const lists = await Promise.all(providers.map(async (pr) => {
			try {
				const res = await fetch(pr.base.replace(/\/+$/, "") + "/models", {
					headers: pr.key ? { Authorization: "Bearer " + pr.key } : {},
				});
				if (!res.ok) return [];
				const data = await res.json();
				return (data.data || []).map((m) => m.id).filter(Boolean).map((id) => ({ id, providerId: pr.id }));
			} catch { return []; } // Quelle gerade nicht erreichbar — überspringen
		}));
		return lists.flat();
	}
	// /models kennt keinen einheitlichen Capability-Standard. Für die Auswahl
	// filtern wir deshalb ausschließlich klar erkennbare Embedding-Modellnamen;
	// Chat-Modelle tauchen dort nie versehentlich auf. Die Abfrage erfolgt nur
	// gegen die aktuell gewählte Quelle, weil /embeddings über genau diese Quelle
	// ausgeführt wird.
	function isEmbeddingModel(id) {
		return /(?:^|[-_/.])(embed(?:ding)?|text-embedding|nomic-embed|bge|e5|gte|jina-embeddings?|voyage|mxbai-embed|snowflake-arctic-embed)(?:$|[-_/.])/i.test(String(id || ""));
	}
	async function listEmbeddingModels() {
		const pr = activeProvider();
		if (!pr || !pr.base) return [];
		const base = String(pr.base).replace(/\/+$/, "");
		const res = await fetch(base + "/models", { headers: pr.key ? { Authorization: "Bearer " + pr.key } : {} });
		if (!res.ok) throw new AiHttpError(res.status, await res.text().catch(() => ""));
		const data = await res.json();
		return (data.data || []).map((m) => m && m.id).filter(isEmbeddingModel)
			.sort((a, b) => String(a).localeCompare(String(b)))
			.map((id) => ({ id, providerId: pr.id, providerName: pr.name || "Aktive Quelle" }));
	}
	async function embed(texts) {
		if (!S.settings.embedModel) throw new Error("Kein Embedding-Modell konfiguriert.");
		const res = await request("/embeddings", { model: S.settings.embedModel, input: texts });
		return (await res.json()).data.map((d) => d.embedding);
	}

	// =========================================================================
	// Thinking/Reasoning-Trennung — Reihenfolge:
	//   1) native API-Felder (Gemini include_thoughts, DeepSeek reasoning_content)
	//   2) <think>/<thinking>/<reasoning>-Tags im Content
	//   3) Sticky-Heuristik als letzter Fallback (Gemma & Co. ohne Thought-API)
	// =========================================================================
	// Baut ausschließlich Parameter ein, die die Capability-Probe für GENAU dieses
	// Modell und diesen Endpoint akzeptiert hat. Keine Modellnamen-Listen.
	function applyThinkingToBody(body, withExtras) {
		// Ein/Aus ist die einzige Nutzerwahl. Bei „Ein“ überlassen wir die Tiefe
		// dem dokumentierten Provider-Standard statt selbst Budget-Stufen zu raten.
		if (!withExtras || S.settings.thinkingEnabled === false) return false;
		const cap = thinkingCapabilityStore()[thinkingCapabilityKey()];
		if (!cap || cap.state !== "ready" || !cap.includeThoughts) return false;
		body.extra_body = { google: { thinking_config: { include_thoughts: true } } };
		return true;
	}
	// Reasoning-Anteile aus message/delta (Feldname je nach Backend verschieden).
	function reasoningFrom(obj) {
		if (!obj || typeof obj !== "object") return "";
		if (typeof obj.reasoning_content === "string" && obj.reasoning_content) return obj.reasoning_content;
		if (typeof obj.reasoning === "string" && obj.reasoning) return obj.reasoning;
		if (Array.isArray(obj.content)) {
			return obj.content
				.filter((p) => p && (p.thought === true || p.type === "thinking" || p.type === "thought" || p.type === "reasoning"))
				.map((p) => p.text || p.content || "")
				.join("");
		}
		return "";
	}
	// Sichtbarer Antworttext aus string ODER Part-Array (Thought-Parts ausfiltern).
	function textFrom(content) {
		if (content == null) return "";
		if (typeof content === "string") return content;
		if (Array.isArray(content)) {
			return content
				.filter((p) => p && p.thought !== true && p.type !== "thinking" && p.type !== "thought" && p.type !== "reasoning")
				.map((p) => (typeof p === "string" ? p : (p && (p.text || p.content)) || ""))
				.join("");
		}
		return String(content);
	}

	// Sticky-Heuristik & Tag-Splitting: nach think-heuristik.js ausgelagert
	// (Aufräum-Paket, 15. Juli) — reine Funktionen ohne App-Abhängigkeiten,
	// direkt testbar in test/test-core.mjs.
	const splitThink = THINK.splitThink;

	// =========================================================================
	// Chat-Aufrufe. Mit onDelta/onReasoning → SSE-Streaming, sonst Einmal-Antwort.
	// Bei 5xx VOR der ersten Ausgabe wird einmal OHNE Thinking-Extras wiederholt
	// (Googles Kompat-Layer wirft bei manchen Modellen "500 INTERNAL").
	// =========================================================================
	async function chatOnce(messages, tools, onDelta, onReasoning) {
		// Ein 500 vor dem ersten Token darf keinen Chat zerstören. Der bisherige
		// Code gab bei tool-freien Chats bereits nach ZWEI schnellen Versuchen auf.
		// Jetzt: vier kontrollierte Versuche mit wachsendem Backoff. Erst wenn Tools
		// beteiligt sind, ist der letzte Versuch ohne Schema ein lesbarer Fallback.
		let produced = false;
		const run = (withExtras, requestTools) => doChat(messages, requestTools, onDelta, onReasoning, withExtras, () => { produced = true; });
		const plans = [
			{ label: "Standard", withExtras: true, tools },
			{ label: "Retry ohne Thinking-Extras", withExtras: false, tools },
			{ label: "Retry mit gleichem Request", withExtras: false, tools },
			{ label: tools && tools.length ? "Fallback ohne Tool-Schema" : "Letzter Retry", withExtras: false, tools: tools && tools.length ? null : tools },
		];
		const waits = [0, 750, 1800, 3500];
		let lastError = null;
		for (let index = 0; index < plans.length; index++) {
			const plan = plans[index];
			if (index) {
				debugEvent("Fallback", { step: plan.label, previousStatus: lastError && lastError.status, waitMs: waits[index] });
				await sleep(waits[index]);
			}
			try {
				const message = await run(plan.withExtras, plan.tools);
				debugEvent("KI-Antwort", {
					stream: !!onDelta, attempt: index + 1, mode: plan.label,
					content: String(message.content || "").slice(0, 1200), reasoning: String(message.reasoning || "").slice(0, 1200),
					rawContent: String(message._debugRawContent || "").slice(0, 1600),
					toolCalls: (message.tool_calls || []).map((tc) => ({ id: tc.id || null, name: (tc.function || {}).name || null, arguments: (tc.function || {}).arguments || "" })).filter((tc) => tc.name),
				});
				return message;
			} catch (error) {
				// BUGFIX (17. Juli): "Failed to fetch" (Netzwerk/CORS/kurzer Ausfall) ist
				// ein TypeError, kein AiHttpError — er wurde nie erneut versucht und
				// landete als kryptische Meldung im Chat. Jetzt: dieselben Backoff-
				// Retries wie bei 5xx, solange noch nichts gestreamt wurde.
				const isNetworkError = !(error instanceof AiHttpError) && (error instanceof TypeError || /failed to fetch|load failed|networkerror/i.test(String((error && error.message) || error)));
				const retryable = !produced && ((error instanceof AiHttpError && error.status >= 500) || isNetworkError);
				if (!retryable) throw error;
				lastError = error;
			}
		}
		if (lastError && !(lastError instanceof AiHttpError)) {
			throw new Error("Keine Verbindung zum KI-Server (" + String((lastError && lastError.message) || lastError) + "). Prüfe Internet, Endpoint und CORS in den Einstellungen → KI.");
		}
		throw lastError || new Error("KI-Anfrage fehlgeschlagen.");
	}
	async function doChat(messages, tools, onDelta, onReasoning, withExtras, markProduced) {
		const { model } = cfg();
		const body = { model, messages, temperature: 0.4 };
		applyThinkingToBody(body, withExtras);
		const reqTools = toolsForRequest(tools);
		if (reqTools) { body.tools = reqTools; body.tool_choice = "auto"; }
		if (!onDelta) {
			const res = await request("/chat/completions", body);
			return finishMessage(await res.json());
		}
		body.stream = true;
		const res = await request("/chat/completions", body);
		return readStream(res, onDelta, onReasoning, markProduced);
	}
	// Gemini sendet bei Tool-Calls eine opaque Thought-Signatur zurück. Sie darf
	// weder angezeigt noch verändert werden, muss aber mit der Assistant-Nachricht
	// unverändert in den nächsten API-Request zurück. Der Kompatibilitäts-Layer
	// verwendet je nach Modell direkte Felder oder extra_content.google.
	function copyGeminiThoughtMetadata(source, target) {
		if (cfg().providerId !== "google" || !source || !target) return;
		const extra = source.extra_content;
		const signature = source.thought_signature || source.thoughtSignature ||
			(extra && extra.google && (extra.google.thought_signature || extra.google.thoughtSignature));
		if (signature) target.thought_signature = signature;
		if (extra && typeof extra === "object") target.extra_content = JSON.parse(JSON.stringify(extra));
	}

	// Einmal-Antwort normalisieren: Reasoning-Felder + Thought-Parts + Tags + Heuristik.
	function finishMessage(data) {
		const m = (data && data.choices && data.choices[0] && data.choices[0].message) || { role: "assistant", content: "" };
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
		let rawContent = "";
		let apiReasoning = ""; // echtes API-Reasoning — wird nie von der Heuristik überschrieben
		let buf = "";
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
				try {
					const choice = (JSON.parse(payload).choices || [])[0];
					delta = (choice && choice.delta) || null;
				} catch { continue; }
				if (!delta) continue; // z.B. reine usage-Chunks
				// Auch bei Streaming kann Gemini die Signatur am Delta oder Tool-Delta liefern.
				copyGeminiThoughtMetadata(delta, msg);
				markProduced();
				const apiPiece = reasoningFrom(delta);
				if (apiPiece) { apiReasoning += apiPiece; msg.reasoning = apiReasoning; emitReasoning(); }
				const textPiece = textFrom(delta.content);
				if (textPiece) {
					rawContent += textPiece;
					// Heuristik nur ohne natives API-Reasoning anwenden.
					const split = splitThink(rawContent, !!apiReasoning);
					msg.content = split.content;
					msg.reasoning = split.reasoning
						? (apiReasoning ? apiReasoning + "\n" + split.reasoning : split.reasoning)
						: apiReasoning;
					emitReasoning();
					onDelta(msg.content);
				}
				for (const tc of delta.tool_calls || []) {
					const i = tc.index || 0;
					const slot = (msg.tool_calls[i] = msg.tool_calls[i] || { id: "", type: "function", function: { name: "", arguments: "" } });
					copyGeminiThoughtMetadata(tc, slot);
					if (tc.id) slot.id = tc.id;
					if (tc.function && tc.function.name) slot.function.name += tc.function.name;
					if (tc.function && tc.function.arguments) slot.function.arguments += tc.function.arguments;
				}
			}
		}
		if (!msg.tool_calls.length) delete msg.tool_calls;
		if (!msg.reasoning) delete msg.reasoning;
		msg._debugRawContent = rawContent;
		return msg;
	}
	// Assistant-Nachricht für den API-Verlauf bereinigen. Interne Anzeige-Felder
	// (reasoning etc.) gehen nie zurück; Gemini-Thought-Signaturen sind dagegen
	// Protokoll-Metadaten und müssen bei Tool-Folgeaufrufen erhalten bleiben.
	function toApiMessage(msg) {
		const out = { role: "assistant", content: msg.content || "" };
		if (msg.tool_calls && msg.tool_calls.length) {
			out.tool_calls = msg.tool_calls.map((call) => {
				const clean = { ...call, function: call.function ? { ...call.function } : call.function };
				copyGeminiThoughtMetadata(call, clean);
				return clean;
			});
		}
		copyGeminiThoughtMetadata(msg, out);
		return out;
	}

	// Isolierter Verbindungstest für die Debug-Schaltfläche. Er schreibt nichts in
	// den Chat und gibt weder API-Key noch vollständige Inhalte preis. Die drei
	// Proben trennen Server-/Thinking-/Tool-Schema-Fehler sauber voneinander.
	async function debugProbe() {
		const config = cfg();
		const messages = [
			{ role: "system", content: "Antworte ausschließlich mit OK." },
			{ role: "user", content: "Schreibe OK." },
		];
		const runProbe = async (name, tools, withExtras) => {
			const started = performance.now();
			try {
				const message = await doChat(messages, tools, null, null, withExtras, () => {});
				return {
					name, ok: true, ms: Math.round(performance.now() - started),
					answer: String(message.content || "").slice(0, 120),
					hasReasoning: !!message.reasoning,
				};
			} catch (error) {
				return {
					name, ok: false, ms: Math.round(performance.now() - started),
					status: error instanceof AiHttpError ? error.status : null,
					error: String((error && error.message) || error).slice(0, 260),
				};
			}
		};
		const pingOk = await ping();
		const tests = [
			await runProbe("Antwort mit Thinking-Parametern", null, true),
			await runProbe("Antwort ohne Thinking-Parameter", null, false),
			await runProbe("Antwort mit Tool-Schema", TOOLS.defs, false),
		];
		return {
			provider: config.providerId || "—", model: config.model || "—",
			base: config.base || "—", pingOk, tests,
		};
	}

	// Einfacher Einmal-Aufruf ohne Tools (z.B. für den PDF-Ingest).
	async function complete(prompt, system) {
		const messages = [];
		if (system) messages.push({ role: "system", content: system });
		messages.push({ role: "user", content: prompt });
		return (await chatOnce(messages)).content || "";
	}

	// =========================================================================
	// System-Prompt
	// =========================================================================
	// System-Prompt v2 (15. Juli, abends): EXTREM entschlackt. Lange Start-Prompts
	// voller statischer Listen (80 Seitentitel, Lernstatus, Formatierungs-Doku,
	// ganze Seiteninhalte) verwässern die Aufmerksamkeit des Modells, kosten
	// Latenz/Tokens und verschlechtern Tool-Calling messbar. Alles Abrufbare liegt
	// jetzt in Tools (get_context, list_pages, read_page, semantic_search); die
	// Formatierungs-Erweiterungen stehen in den Beschreibungen der Schreib-Tools.
	// Relevante Notiz-Auszüge zur AKTUELLEN Frage liefert Auto-RAG (siehe agent()).
	function systemPrompt(type, toolsEnabled, ragContext, chatSummary) {
		const cur = S.currentPageId ? S.pages[S.currentPageId] : null;
		const now = new Date();
		const lines = [
			"Du bist der KI-Coach von Impala67, einer lokalen Notiz- und Lern-App. Antworte auf Deutsch, kompakt. Formeln als LaTeX ($...$ inline, $$...$$ als Block).",
			"Heute: " + now.toLocaleDateString("de-DE", { weekday: "short", year: "numeric", month: "2-digit", day: "2-digit" }) + ", " + now.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) + " Uhr.",
			cur ? 'Geöffnete Seite: "' + cur.title + '"' : "Keine Seite geöffnet.",
			toolsEnabled
				? "Nutze deine Tools aktiv statt zu raten. Kontext holen: get_context (zuletzt bearbeitete Seiten, Lernstatus, Inhalt der geöffneten Seite), list_pages, read_page, semantic_search/search_notes. Schreiben: create_page/append_to_page, create_flashcards. Löschen wird immer im Chat bestätigt. Bei Mehrdeutigkeit: ask_choice. Sage nach Tool-Nutzung kurz, was geändert wurde."
				: "Für diese Anfrage sind keine Werkzeuge aktiv. Antworte direkt aus dem vorhandenen Kontext. Sprich NIE über Werkzeuge, fehlenden Daten-Zugriff oder „dieses Chat-Fenster“ und behaupte keine Suchen oder Änderungen. Wären Notiz-Inhalte nötig, bitte den Nutzer, die Frage konkret zu formulieren (z. B. „Durchsuche meine Notizen nach …“).",
			"Niemals Selbstgespräche/Meta-Kommentare im sichtbaren Text ('Der Nutzer möchte…', 'I should…'). Ausführliches Nachdenken gehört AUSSCHLIESSLICH in <think>...</think> VOR der Antwort.",
		];
		// Nur das Seitenpanel bekommt den Seiteninhalt direkt — das ist sein Zweck.
		// Der Vollbild-Chat holt Inhalte bei Bedarf über get_context/read_page.
		if (type === "side" && cur) {
			const body = String(cur.content || "");
			lines.push("Inhalt der geöffneten Seite" + (body.length > 6000 ? " (gekürzt)" : "") + ":\n" + (body.slice(0, 6000) || "(Leere Seite)"));
		}
		if (ragContext) lines.push("Automatisch gefundene, möglicherweise relevante Notiz-Auszüge:\n" + ragContext);
		// Kontextbasierte Chat-Länge (17. Juli): ältere, nicht mehr mitgeschickte
		// Nachrichten fließen als rollierende Zusammenfassung ein (wie in Notion).
		if (chatSummary) lines.push("Zusammenfassung des bisherigen Gesprächs (ältere Nachrichten, nicht mehr im Verlauf):\n" + chatSummary);
		if (S.settings.customInstructions && S.settings.customInstructions.trim()) {
			lines.push("Zusätzliche Anweisungen (aus den Einstellungen):\n" + S.settings.customInstructions.trim());
		}
		return lines.join("\n");
	}

	// =========================================================================
	// Chat-Persistenz (ohne APP-Import — wäre zyklisch: chat-fullscreen → ai → …)
	// =========================================================================
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

	// =========================================================================
	// Lösch-Tools: EINE gemeinsame Bestätigungs-Pipeline (statt 3× Copy-Paste).
	// Jede resolve() liefert: Fehler ODER { detail, question, runArgs, cancelled }.
	// =========================================================================
	const DELETE_SPECS = {
		delete_page: {
			resolve(args) {
				const title = String((args && args.page_title) || "").trim();
				if (!title) return { error: "delete_page: page_title fehlt." };
				const pg = STATE.findPage(title);
				if (!pg) return { error: "Seite nicht gefunden: " + title };
				const countKids = (id) => {
					let n = 0;
					for (const p of Object.values(S.pages)) if (!p.trashed && p.parentId === id) n += 1 + countKids(p.id);
					return n;
				};
				const subN = countKids(pg.id);
				return {
					detail: pg.title,
					question: subN
						? 'Seite „' + pg.title + '“ inkl. ' + subN + ' Unterseite(n) in den Papierkorb?'
						: 'Seite „' + pg.title + '“ in den Papierkorb?',
					runArgs: { page_title: pg.title },
					cancelled: { cancelled: true, title: pg.title, note: "Löschen abgebrochen — nichts geändert." },
				};
			},
		},
		delete_flashcard: {
			resolve(args) {
				const front = String((args && args.front) || "").trim();
				if (!front) return { error: "delete_flashcard: front fehlt." };
				const card = TOOLS.findCard(front, args && args.deck);
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
				const name = String((args && args.deck) || "").trim();
				if (!name) return { error: "delete_deck: deck fehlt." };
				const match = TOOLS.resolveDeckName(name);
				if (!match) return { error: "Stapel nicht gefunden: " + name };
				const cardN = Object.values(S.cards).filter((c) => {
					if (c.trashed) return false;
					const d = c.deck || "Standard";
					return d === match || d.startsWith(match + "::");
				}).length;
				return {
					detail: match,
					question: cardN
						? 'Stapel „' + match + '“ inkl. ' + cardN + ' Karte(n) in den Papierkorb?'
						: 'Stapel „' + match + '“ in den Papierkorb?',
					runArgs: { deck: match },
					cancelled: { cancelled: true, deck: match, note: "Löschen abgebrochen — nichts geändert." },
				};
			},
		},
	};

	// =========================================================================
	// Agent-Loop: Streaming, Tools, Bestätigungen, Edit-Karten
	// =========================================================================
	async function agent(userText, type, onStep) {
		type = type || "side";
		const targetChat = type === "side" ? S.sideChat : S.chat;
		const renderLog = () => { if (type === "side") RENDER.renderChat(); else RENDER.renderMainChatLog(); };

		// Edit-Karten dieses Laufs — erst NACH der finalen Antwort anhängen.
		const pendingEdits = [];
		const flushPendingEdits = () => {
			if (!pendingEdits.length) return;
			targetChat.push(...pendingEdits);
			pendingEdits.length = 0;
			renderLog();
		};

		// Anhänge gehören exklusiv zu dem Chat, in dem sie gewählt wurden.
		const useAttachment = S.pendingAttachmentTarget === type;
		const image = useAttachment ? S.pendingImage : null;
		const textFile = useAttachment ? S.pendingTextFile : null;
		const pdfFile = useAttachment ? S.pendingPdf : null;
		if (useAttachment) {
			S.pendingImage = null;
			S.pendingTextFile = null;
			S.pendingPdf = null;
			S.pendingAttachmentTarget = null;
		}
		targetChat.push({ mid: U.uid(), role: "user", content: userText, image, textFile, pdfFile });
		// 🩹 FIX (18. Juli, spät): Die eigene Nachricht erscheint SOFORT im Chat.
		// Vorher wurde erst nach Auto-RAG/Zusammenfassung/erstem Token gerendert —
		// der Chat wirkte nach dem Absenden wie eingefroren.
		renderLog();

		// Verlauf: Bilder als image_url (Vision), Text-/PDF-Anhänge als Kontext.
		const history = targetChat.slice(-historyLimit())
			.filter((m) => m.role === "user" || m.role === "assistant")
			.map((m) => {
				let content = m.content || "";
				if (m.textFile) content = (content ? content + "\n\n" : "") + "[Angehängte Datei: " + m.textFile.name + "]\n" + m.textFile.content;
				if (m.pdfFile) content = (content ? content + "\n\n" : "") + "[Angehängtes PDF: " + m.pdfFile.name + "]\n" + m.pdfFile.content;
				if (m.image) return { role: m.role, content: [{ type: "text", text: content }, { type: "image_url", image_url: { url: m.image } }] };
				return { role: m.role, content };
			});
		// Tool-Angebot v3 (17. Juli, abends): keine Heuristik mehr. Einstellung
		// „Tools immer mitsenden“ (Standard AN) → volle Liste bei jeder Anfrage.
		// AUS → nur das Meta-Werkzeug request_tools; fordert die KI damit die
		// Werkzeuge an, läuft dieselbe Anfrage sofort mit der vollen Liste weiter.
		const fullToolDefs = () => {
			let defs = TOOLS.defs.slice();
			// 🧪 Experimente: optionale Zusatz-Werkzeuge (z. B. Wissenslücken-Detektor)
			if (window.EXP && typeof window.EXP.extraToolDefs === "function") defs = defs.concat(window.EXP.extraToolDefs());
			return defs;
		};
		let agentTools = (S.settings.alwaysSendTools !== false || toolsUnlocked) ? fullToolDefs() : [META_TOOL_DEF];
		// Auto-RAG (15. Juli): statt statischer Listen im Prompt werden die
		// relevantesten Notiz-Auszüge zur AKTUELLEN Frage still eingebettet.
		// Fehler oder fehlendes Embedding-Modell degradieren lautlos zu
		// "kein Extra-Kontext" — nie zu einem Chat-Fehler.
		let ragContext = "";
		try {
			if (RAG.enabled() && String(userText || "").trim().length >= 8) {
				const hits = (await RAG.search(userText, 4)) || [];
				ragContext = hits
					.filter((h) => (h.score == null || h.score >= 0.3) && h.snippet)
					.map((h) => "• [" + h.title + "] " + h.snippet)
					.join("\n");
			}
		} catch (e) { debugEvent("Auto-RAG übersprungen", { error: String((e && e.message) || e).slice(0, 200) }); }
		// Kontextbasierte Chat-Länge (17. Juli): Nachrichten JENSEITS des Verlaufs-
		// fensters gehen nicht mehr verloren, sondern werden inkrementell zusammen-
		// gefasst (alte Zusammenfassung + neu herausgefallene Nachrichten) und in den
		// System-Prompt eingebettet. Auffrischung erst ab 4 neuen Überlauf-Nachrichten;
		// Fehler degradieren lautlos zu "keine Zusammenfassung" — nie zu einem Chat-Fehler.
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
					if (summaryText) {
						chatSummaries[summaryKey] = { count: overflow.length, text: summaryText };
						chatSummary = summaryText;
					} else if (cached) chatSummary = cached.text;
				}
			}
		} catch (e) { debugEvent("Chat-Zusammenfassung übersprungen", { error: String((e && e.message) || e).slice(0, 200) }); }
		// 👁 Vision-Hinweis (18. Juli, spät): Hängen Bilder im Verlauf (z. B. Heft-
		// Seiten), soll ein nicht vision-fähiges Modell das offen sagen, statt zu
		// raten. An der Modell-Auswahl selbst ändert sich dabei nichts.
		const hasImages = history.some((m) => Array.isArray(m.content));
		const visionNote = hasImages ? "\n\nAn Nachrichten können Bilder hängen (z. B. Heft-Seiten oder Screenshots). Wenn du Bilder technisch nicht empfangen oder nicht sehen kannst (kein Vision-Modell), erwähne das kurz und ehrlich, statt Inhalte zu raten." : "";
		const messages = [{ role: "system", content: systemPrompt(type, !!agentTools, ragContext, chatSummary) + visionNote }, ...history];
		debugEvent("Tool-Modus", { enabled: !!agentTools, reason: agentTools ? "Aktueller Auftrag benötigt Tools" : "Normaler Chat ohne Tool-Bedarf" });

		// Max. 1 Chat-Log-Rebuild pro Frame (LaTeX/Code-Rendering ist teuer).
		// PERF (Feinschliff v11): vorher bis zu 60 Rebuilds/s (rAF) — Markdown/KaTeX
		// über den wachsenden Draft wurde bei langen Antworten spürbar teuer.
		// ~12 Rebuilds/s sind optisch identisch flüssig.
		let renderQueued = false, lastLiveRender = 0;
		const scheduleRender = () => {
			if (renderQueued) return;
			renderQueued = true;
			setTimeout(() => {
				renderQueued = false;
				lastLiveRender = Date.now();
				renderLog();
			}, Math.max(16, 80 - (Date.now() - lastLiveRender)));
		};

		// Frage-Karte anzeigen und auf Klick warten (ask_choice + Lösch-Bestätigungen).
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
		const pushToolChip = (name, detail, error) => {
			targetChat.push({ mid: U.uid(), role: "tool", name, detail: String(detail || "").slice(0, 80), error: !!error });
		};
		const pushToolResult = (tc, out) => {
			messages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(out) });
		};
		const persist = () => { try { persistChat(type); } catch (e) { console.warn("Chat speichern:", e); } };

		for (let step = 0; step < MAX_AGENT_STEPS; step++) {
			S.aiDraft = "";
			S.aiThinkingDraft = "";
			const msg = await chatOnce(
				messages, agentTools,
				(text) => { S.aiDraft = text; scheduleRender(); },
				(text) => { S.aiThinkingDraft = text; scheduleRender(); },
			);
			// Bereinigt in den API-Verlauf (ohne interne Felder wie reasoning).
			messages.push(toApiMessage(msg));

			// Keine Tool-Calls → finale Antwort.
			if (!msg.tool_calls || !msg.tool_calls.length) {
				const finalMsg = {
					mid: U.uid(), role: "assistant", content: msg.content || "",
					reasoning: msg.reasoning || null, reasoningExpanded: false,
				};
				S.aiDraft = "";
				S.aiThinkingDraft = "";
				targetChat.push(finalMsg);
				flushPendingEdits();
				// BUGFIX (15. Juli): die finale Antwort wurde nur von den Lösch-/
				// ask_choice-Zweigen gespeichert — ein Reload direkt nach der Antwort
				// konnte den Chat verlieren. Jetzt nach jedem Abschluss persistieren.
				persist();
				return finalMsg.content;
			}

			for (const tc of msg.tool_calls) {
				const name = tc.function.name;
				let args = {};
				try { args = JSON.parse(tc.function.arguments || "{}"); } catch { /* leere Argumente */ }

				// --- Meta-Werkzeug (Sparmodus): volle Werkzeugliste freischalten ---
				if (name === "request_tools") {
					toolsUnlocked = true;
					agentTools = fullToolDefs();
					if (onStep) onStep(name);
					pushToolChip(name, "Werkzeuge freigeschaltet");
					scheduleRender();
					pushToolResult(tc, { ok: true, hinweis: "Alle Werkzeuge sind jetzt in dieser Anfrage verfügbar." });
					continue;
				}

				// --- Lösch-Tools: gemeinsame Bestätigungs-Pipeline ---
				if (DELETE_SPECS[name]) {
					const spec = DELETE_SPECS[name].resolve(args);
					if (spec.error) {
						if (onStep) onStep(name);
						pushToolChip(name, spec.error, true);
						scheduleRender();
						pushToolResult(tc, { error: spec.error });
						continue;
					}
					const answer = await waitForAnswer(spec.question, ["Ja, löschen", "Abbrechen"], "Warte auf Bestätigung…");
					const confirmed = String(answer || "").toLowerCase().startsWith("ja");
					let out;
					if (!confirmed) {
						out = spec.cancelled;
					} else {
						try { out = await TOOLS.run(name, spec.runArgs); }
						catch (e) { out = { error: String(e) }; }
					}
					if (onStep) onStep(name);
					// Abbruch: kein Tool-Chip — die beantwortete Frage-Karte reicht.
					if (!out.cancelled) pushToolChip(name, spec.detail, out && out.error);
					renderLog();
					pushToolResult(tc, out);
					persist();
					continue;
				}

				// --- Rückfrage (ask_choice): pausiert bis Klick, nur Frage-Karte in der UI ---
				if (name === "ask_choice") {
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

				// --- Normale Tools (inkl. Seiten-Änderungen mit Edit-Karte) ---
				const mutating = MUTATING_TOOLS.has(name);
				let beforePageId = null;
				let before = { title: "", content: "" };
				if (mutating && name !== "create_page") {
					const pg = STATE.findPage(args.page_title);
					if (pg) { beforePageId = pg.id; before = { title: pg.title, content: pg.content }; }
				}
				let out;
				try { out = await TOOLS.run(name, args); }
				catch (e) { out = { error: String(e) }; }
				if (onStep) onStep(name);
				let detail = args.page_title || args.title || args.query || "";
				if (name === "semantic_search") detail = (detail ? detail + " · " : "") + "Embedding: " + (S.settings.embedModel || "—");
				pushToolChip(name, detail, out && out.error);
				scheduleRender();
				if (mutating && out && !out.error) {
					let pageId = beforePageId;
					let created = false;
					if (name === "create_page") {
						const pg = STATE.findPage(args.title);
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
		}
		S.aiDraft = "";
		S.aiThinkingDraft = "";
		const abort = "(Abgebrochen: zu viele Tool-Schritte.)";
		targetChat.push({ mid: U.uid(), role: "assistant", content: abort });
		flushPendingEdits();
		persist();
		return abort;
	}

	// =========================================================================
	// Rückfragen auflösen (Klick auf eine Frage-Karte) & Antwort anpassen
	// =========================================================================
	function resolveChoice(mid, answer) {
		const resolve = pendingChoices[mid];
		if (!resolve) return false;
		delete pendingChoices[mid];
		resolve(answer);
		return true;
	}
	function hasPendingChoice() {
		return Object.keys(pendingChoices).length > 0;
	}
	// Formuliert eine bestehende Antwort länger/kürzer/gleich um.
	async function refine(historyMessages, instruction, onDelta) {
		const messages = [{ role: "system", content: systemPrompt() }, ...historyMessages, { role: "user", content: instruction }];
		return (await chatOnce(messages, null, onDelta)).content || "";
	}

	return { chatOnce, complete, agent, resolveChoice, hasPendingChoice, refine, ping, embed, listModels, listEmbeddingModels, detectThinkingCapabilities, debugProbe, debugReport, MODEL_PRESETS };
})();