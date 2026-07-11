"use strict";

import { S, STATE } from "./state.js";
import { TOOLS } from "./tools.js";
import { U } from "./util.js";
import { RENDER } from "./render.js";
import { CHATS } from "./chats.js";

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
	const HISTORY_LIMIT = 16;
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
	// Tool-Schemas sind für Gemma deutlich fehleranfälliger als ein normaler
	// Chat-Aufruf. Sie werden daher nur dann geschickt, wenn der aktuelle Auftrag
	// tatsächlich eine Aktion oder Recherche verlangt — nie bei „hi“/„denk mal
	// nach“. Das bewahrt Tool-Calling, beseitigt aber die unnötigen 500er.
	const TOOL_INTENT_RE = /\b(seite|seiten|notiz|notizen|karteikarte|karteikarten|karte\b|karten\b|stapel|deck|lösche|loesch|erstell|anleg|verschieb|hänge|haenge|ergänz|ergaenz|ersetz|such|finde|liste|zeig.*seiten|lies|lese|zusammenfass|recherch|notebooklm)\b/i;
	function shouldOfferTools(userText) {
		return TOOL_INTENT_RE.test(String(userText || ""));
	}
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

	// Gemma sendet den Denkblock als <thought> (nicht <think>). Beide Formen
	// gehören ausschließlich in die Thinking-Box, nie in die sichtbare Antwort.
	const THINK_TAGS = "think|thinking|thought|reasoning";
	// Typische "laut denken"-Einleitungen (Deutsch + Englisch).
	const THINK_LEADIN_RE = /^(the user|i should|i need|i will|i'll|i must|i think|i can|i am|i'm going|i'm|let me|let's|my instructions|as per|based on|since the|however,?|plan:|note:|first,|okay,?|ok,|alright,?|looking at|what could|we've|we have|if i\b|instead\b|this is\b|a smart\b|so i\b|wait,?|hmm|actually|perhaps|maybe|probably|for example|in this|in the|the previous|they (have|want|are|might)|their\b|to (test|check|see|verify|make|be|move|refine)|ich sollte|ich muss|ich werde|ich denke|ich kann|ich bin|der nutzer|die nutzerin|laut (meiner|den) anweisungen|zun[äa]chst|lass mich|okay,? der|gut,? der)\b/i;
	// Klarer Nutzer-Antwort-Start (meist Deutsch laut System-Prompt).
	const ANSWER_START_RE = /^(hallo\b|hi\b|hey\b|klar[,!.\s]|ja[,!.\s]|nein[,!.\s]|gut[,!.\s]|super\b|verstanden\b|alles klar|hier (ist|sind|die|der|das|meine|ein)\b|natürlich\b|gerne\b|okay[,!.\s]*(hier|ich|das|der|die)?|zusammengefasst\b|kurz gesagt|mein (konkreter )?vorschlag|konkret[:\s]|die antwort\b|fertig[:!.]|erledigt\b|ich habe\b|ich leg|ich erstell|ich lösch|ich verschieb|ich änder|seite „|karte „|stapel „|sure[,!.\s]|here('s| is)\b|of course\b)/i;
	function normalizeThinkPart(s) {
		return String(s || "").trim().replace(/^\d+[.)]\s*/, "").replace(/^[-*•]\s*/, "");
	}
	function isMetaThinkPart(s) {
		const t = normalizeThinkPart(s);
		return !t || THINK_LEADIN_RE.test(t);
	}
	function isAnswerStartPart(s) {
		const t = normalizeThinkPart(s);
		if (!t || t.length < 3 || isMetaThinkPart(t)) return false;
		return ANSWER_START_RE.test(t);
	}
	// Sticky-Heuristik: sieht der ANFANG nach Denkprozess aus, bleibt ALLES
	// reasoning, bis ein klarer Antwort-Start erkannt wird. Nur für Modelle ohne
	// getrenntes Reasoning (z.B. Gemma).
	function stripLeakedReasoning(text) {
		if (!text) return { content: text, reasoning: "" };

		// Einige OpenAI-kompatible Backends liefern Zeilenumbrüche als literal
		// <br>-Tags. Der bisherige Satz-Split sah dann den gesamten Block als eine
		// Einheit und ließ den Denktext durch. Für die Erkennung werden nur diese
		// Umbrüche normalisiert; die sichtbare Antwort bleibt ansonsten unverändert.
		const source = String(text);
		const analysis = source.replace(/<br\s*\/?>/gi, "\n").replace(/&nbsp;/gi, " ");
		const parts = analysis.split(/(?<=[.!?])\s+|\n+|(?<=[.!?])(?=[A-ZÄÖÜ])/).filter(Boolean);
		if (!parts.length || !isMetaThinkPart(parts[0])) return { content: source, reasoning: "" };

		// Fail closed: Beginnt die Antwort eindeutig als internes Selbstgespräch,
		// erscheint davon nie etwas im Chat. Erst ein klarer Antwortbeginn gibt
		// sichtbaren Text frei. Das gilt auch während des Streamings.
		let answerStart = -1;
		for (let i = 1; i < parts.length; i++) {
			if (isAnswerStartPart(parts[i])) { answerStart = i; break; }
		}
		if (answerStart === -1) return { content: "", reasoning: analysis.trim() };
		return {
			content: parts.slice(answerStart).join("\n").trim(),
			reasoning: parts.slice(0, answerStart).join("\n").trim(),
		};
	}
	// Tags heraustrennen; ohne Tags optional die Heuristik anwenden.
	function splitThink(raw, skipHeuristic) {
		let reasoning = "";
		let content = "";
		const re = new RegExp("<(" + THINK_TAGS + ")>([\\s\\S]*?)<\\/\\1>", "g");
		let last = 0, m;
		while ((m = re.exec(raw))) { reasoning += m[2]; content += raw.slice(last, m.index); last = re.lastIndex; }
		content += raw.slice(last);
		// Offener (noch streamender) Denk-Block: Rest komplett als Denkprozess.
		const openMatch = content.match(new RegExp("<(" + THINK_TAGS + ")>"));
		if (openMatch) { reasoning += content.slice(openMatch.index + openMatch[0].length); content = content.slice(0, openMatch.index); }
		if (!reasoning && !skipHeuristic) {
			const leaked = stripLeakedReasoning(content);
			content = leaked.content;
			reasoning = leaked.reasoning;
		}
		return { content: content.trim(), reasoning: reasoning.trim() };
	}

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
				const retryable = error instanceof AiHttpError && error.status >= 500 && !produced;
				if (!retryable) throw error;
				lastError = error;
			}
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
	// Assistant-Nachricht für den API-Verlauf bereinigen: KEINE internen Felder
	// (reasoning etc.) zurücksenden — unbekannte Felder sind eine 500er-Quelle.
	function toApiMessage(msg) {
		const out = { role: "assistant", content: msg.content || "" };
		if (msg.tool_calls && msg.tool_calls.length) out.tool_calls = msg.tool_calls;
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
	function systemPrompt(type, toolsEnabled) {
		const cur = S.currentPageId ? S.pages[S.currentPageId] : null;
		const lines = [
			"Du bist der KI-Coach von Impala67, einer lokalen Notiz- und Lern-App.",
			"Antworte auf Deutsch, kompakt, in kleinen Schritten. Nutze LaTeX für Formeln (z.B. $I = U / R$ inline oder $$...$$ für eigene Zeilen) — das wird live gerendert.",
			"Beim Schreiben in Seiten kannst du neben Markdown auch die Impala67-Erweiterungen nutzen: {red}Text{/} bzw. {bg-yellow}Text{/} für Text-/Hintergrundfarbe (gray/red/orange/yellow/green/blue/purple/pink), '> [!blue] Hinweis' für farbige Callouts, ==Text== zum Hervorheben und ':::columns ... :::split ... :::end' für Spalten.",
			...(toolsEnabled ? [
				"Du hast Tools, um Seiten zu lesen/anzulegen/zu ändern/zu verschieben/zu löschen und Karteikarten zu erstellen. Nutze sie aktiv.",
				"- Wissen speichern: create_page oder append_to_page. Seite verschieben/löschen: move_page/delete_page (Löschen wird bestätigt).",
				"- Karten: create_flashcard; löschen: delete_flashcard/delete_deck (wird bestätigt).",
				"- Unterlagen: semantic_search oder search_notes, dann read_page. Bei Mehrdeutigkeit: ask_choice mit 2–5 Optionen.",
				"- Sage nach Tool-Nutzung kurz, was angelegt/geändert/verschoben/gelöscht wurde.",
			] : [
				"Für diese Anfrage sind keine Werkzeuge freigegeben. Nenne keine internen Funktionsnamen und behaupte keine Änderungen an Seiten oder Karten.",
			]),
			"- WICHTIG: Schreibe NIEMALS Selbstgespräche/Meta-Kommentare in die sichtbare Antwort, z.B. NICHT 'The user said...', 'I should respond...', 'Ich sollte...', 'Der Nutzer möchte...'. Deine Antwort beginnt IMMER direkt mit dem eigentlichen Inhalt für die Person, ohne jede Erklärung deines Vorgehens.",
			"- Falls du dennoch vor der eigentlichen Antwort ausführlich laut nachdenken musst, packe das AUSSCHLIESSLICH in <think>...</think> VOR der Antwort, niemals ungetaggt in den sichtbaren Text. Beispiel: '<think>Nutzer fragt X, ich prüfe zuerst Y.</think>Hier ist die Antwort: ...'",
		];
		if (cur) {
			lines.push('Aktuell geöffnete Seite: "' + cur.title + '"');
			if (type === "side") {
				lines.push("Du wirst im kontextuellen Seitenpanel ausgeführt. Beziehe dich bei Fragen direkt auf den Inhalt der aktuellen Seite, falls relevant.");
				lines.push("Inhalt der aktuell geöffneten Seite:\n" + (cur.content || "(Leere Seite)"));
			}
		} else {
			lines.push("Aktuell ist keine Seite geöffnet.");
		}
		lines.push("Vorhandene Seiten: " + (STATE.pageTitles().slice(0, 80).join(" | ") || "(noch keine)"));
		// Nur explizit in den Einstellungen hinterlegte Zusatz-Anweisungen — keine
		// automatisch abgeleiteten Annahmen über die Person.
		if (S.settings.customInstructions && S.settings.customInstructions.trim()) {
			lines.push("Zusätzliche Anweisungen (von der Nutzerin/dem Nutzer in den Einstellungen hinterlegt):\n" + S.settings.customInstructions.trim());
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

		// Verlauf: Bilder als image_url (Vision), Text-/PDF-Anhänge als Kontext.
		const history = targetChat.slice(-HISTORY_LIMIT)
			.filter((m) => m.role === "user" || m.role === "assistant")
			.map((m) => {
				let content = m.content || "";
				if (m.textFile) content = (content ? content + "\n\n" : "") + "[Angehängte Datei: " + m.textFile.name + "]\n" + m.textFile.content;
				if (m.pdfFile) content = (content ? content + "\n\n" : "") + "[Angehängtes PDF: " + m.pdfFile.name + "]\n" + m.pdfFile.content;
				if (m.image) return { role: m.role, content: [{ type: "text", text: content }, { type: "image_url", image_url: { url: m.image } }] };
				return { role: m.role, content };
			});
		const agentTools = shouldOfferTools(userText) ? TOOLS.defs : null;
		const messages = [{ role: "system", content: systemPrompt(type, !!agentTools) }, ...history];
		debugEvent("Tool-Modus", { enabled: !!agentTools, reason: agentTools ? "Aktueller Auftrag benötigt Tools" : "Normaler Chat ohne Tool-Bedarf" });

		// Max. 1 Chat-Log-Rebuild pro Frame (LaTeX/Code-Rendering ist teuer).
		let renderQueued = false;
		const scheduleRender = () => {
			if (renderQueued) return;
			renderQueued = true;
			requestAnimationFrame(() => { renderQueued = false; renderLog(); });
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
				return finalMsg.content;
			}

			for (const tc of msg.tool_calls) {
				const name = tc.function.name;
				let args = {};
				try { args = JSON.parse(tc.function.arguments || "{}"); } catch { /* leere Argumente */ }

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
			}
		}
		S.aiDraft = "";
		S.aiThinkingDraft = "";
		const abort = "(Abgebrochen: zu viele Tool-Schritte.)";
		targetChat.push({ mid: U.uid(), role: "assistant", content: abort });
		flushPendingEdits();
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

	return { chatOnce, complete, agent, resolveChoice, hasPendingChoice, refine, ping, embed, listModels, detectThinkingCapabilities, debugProbe, debugReport, MODEL_PRESETS };
})();