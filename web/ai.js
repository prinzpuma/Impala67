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
	// 12 statt 8 (25. Juli): Mit den neuen Karten-Verwaltungs-Tools sind Ketten wie
	// list_decks → list_flashcards → move_flashcards → update_flashcard normal; bei 8
	// Schritten brach die Antwort mitten in der Arbeit ab.
	const MAX_AGENT_STEPS = 12;
	const DEBUG_LOG_LIMIT = 40;
	const historyLimit = () => (cfg().family === "local" ? 16 : 48); // lokal kleiner Kontext, Cloud 128k+
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
	// EINE Provider-Erkennung für alles (Schema-Bereinigung, Thinking, Kontextfenster).
	// Vorher hing das an der frei wählbaren Kennung ("google", "local"): Wer seine Quelle
	// anders benannte, verlor STILL die Gemini-Schema-Bereinigung („500 INTERNAL“ kam zurück),
	// die Gedankengänge und das passende Verlaufsfenster.
	// PERF: providerFamily lief über cfg() bei JEDEM gestreamten Token und jedem tool_call-
	// Häppchen erneut durch ein halbes Dutzend reguläre Ausdrücke. Das Ergebnis hängt nur an
	// id/name/base — genau danach gecacht, geänderte Einstellungen ergeben einen neuen Schlüssel.
	const familyCache = new Map();
	function providerFamily(pr) {
		const key = [pr?.id || "", pr?.name || "", pr?.base || ""].join(" | ");
		let fam = familyCache.get(key);
		if (fam === undefined) familyCache.set(key, (fam = computeProviderFamily(pr)));
		return fam;
	}
	function computeProviderFamily(pr) {
		const tag = [pr?.id, pr?.name].filter(Boolean).join(" ").toLowerCase();
		const base = String(pr?.base || "").toLowerCase();
		if (/localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|\.local(?::|\/|$)/.test(base) || /\b(local|lm[\s-]?studio|ollama|llama\.cpp|jan)\b/.test(tag)) return "local";
		if (/generativelanguage|googleapis|google/.test(base) || /\b(google|gemini|gemma)\b/.test(tag)) return "google";
		if (/api\.openai\.com/.test(base) || /\bopenai\b/.test(tag)) return "openai";
		return "other";
	}
	function cfg() {
		const pr = activeProvider();
		return { base: String(pr?.base || "").replace(/\/+$/, ""), key: pr?.key || "", model: S.settings.aiModel || "", providerId: pr?.id || "", family: providerFamily(pr) };
	}
	const auth = (key) => (key ? { Authorization: "Bearer " + key } : {});
	const capKey = (c = cfg()) => [c.providerId, c.base, c.model].join("::");
	const capStore = () => S.thinkingCapabilities || (S.thinkingCapabilities = Object.create(null));
	// /models kennt keine Thinking-Capability, aktive Proben wären kostenpflichtig → nur
	// dokumentierte Kombinationen freischalten (Manifest); Unbekanntes bleibt „Automatisch" ohne Extras.
	function declaredThinkingCapabilities(c) {
		if (c.family === "google" && /^gemini-2\.5-(flash|pro)/.test(String(c.model || "").toLowerCase())) {
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
			// Muss IMMER eine endliche Zahl sein: Ein NaN ließ die Wartezeit vor dem nächsten
			// Versuch verschwinden — ausgerechnet beim Rate-Limit wurde sofort erneut gefeuert.
			this.retryAfterMs = Number.isFinite(retryAfterMs) ? Math.min(Math.max(retryAfterMs, 0), 60000) : 0;
		}
	}
	// Retry-After ist laut Norm entweder eine Sekundenzahl ODER ein HTTP-Datum.
	function retryAfterMsOf(res) {
		const raw = res.headers.get("retry-after");
		if (!raw) return 0;
		const secs = Number(raw);
		if (Number.isFinite(secs)) return secs * 1000;
		const at = Date.parse(raw);
		return Number.isFinite(at) ? at - Date.now() : 0;
	}
	// ⏹ Laufende Chat-Anfrage abbrechen („kommt noch“, 22. Juli): Der Senden-Button
	// wird während S.aiBusy zum Stopp-Button (app.js) — abortActive() reißt die fetch-
	// Verbindung UND das laufende Stream-Lesen sofort ab (gleiches Signal).
	// Fix (23. Juli): EINE geteilte Variable brach bei parallelen Anfragen (z.B. Chat läuft,
	// Verlaufs-Zusammenfassung startet) nur die ZULETZT gestartete ab — ⏹ stoppt jetzt ALLE laufenden.
	let activeAborts = [];
	const ABORTED = Symbol("aborted");
	// EINE Anmeldestelle für alles, was ⏹ stoppen können muss (Chat, Zusammenfassung,
	// Embeddings). Vorher wurde die Liste hart auf 8 gekürzt — alles darüber war nicht mehr
	// abbrechbar — und Embeddings hingen gar nicht erst mit drin. Aufgeräumt wird nach
	// Zustand und Alter statt nach Anzahl.
	function trackAbort() {
		const ctrl = new AbortController();
		const now = Date.now();
		activeAborts = activeAborts.filter((e) => !e.ctrl.signal.aborted && now - e.at < 600000);
		activeAborts.push({ ctrl, at: now });
		return ctrl;
	}
	function abortActive() {
		activeAborts.forEach((e) => e.ctrl.abort());
		activeAborts = [];
		// FIX: Wartete der Agent auf eine Rückfrage oder Löschbestätigung, lief ⏹ ins Leere —
		// das Warte-Versprechen wurde nie aufgelöst, S.aiBusy blieb hängen und der Chat war bis
		// zum Neuladen blockiert. Offene Fragen werden jetzt sauber abgebrochen.
		for (const mid of Object.keys(pendingChoices)) {
			const resolve = pendingChoices[mid];
			delete pendingChoices[mid];
			resolve(ABORTED);
		}
	}
	async function request(path, body) {
		const { base, key, providerId } = cfg();
		if (!base) throw new Error("Kein KI-Server konfiguriert (Einstellungen → KI).");
		const started = performance.now();
		// Bild-Nachrichten sind Base64 und schnell mehrere MB groß. JSON.stringify lief hier NUR
		// zum Zeichenzählen über den kompletten Anhang — bei jeder Anfrage und in jedem Agent-Schritt.
		// Das war das kurze Stocken direkt vor dem Absenden. Jetzt Textlängen summieren, Bilder zählen.
		const contentChars = (c) => {
			if (typeof c === "string") return c.length;
			if (!Array.isArray(c)) return c ? 1 : 0;
			return c.reduce((sum, p) => sum + (typeof p?.text === "string" ? p.text.length : 0), 0);
		};
		const messageMeta = (body.messages || []).map((m) => ({
			role: m?.role || "?",
			chars: contentChars(m?.content),
			images: Array.isArray(m?.content) ? m.content.filter((p) => p?.type === "image_url").length : 0,
			hasToolCalls: !!m?.tool_calls?.length,
		}));
		// Nur Namen statt der kompletten Schemata: Das Protokoll hielt 40× alle Tool-
		// Beschreibungen samt Parametern im Speicher — mit Abstand der größte Brocken.
		const toolNames = (body.tools || []).map((t) => t.function?.name).filter(Boolean);
		const meta = {
			path, provider: providerId || "—", model: body.model || "—", stream: !!body.stream,
			messageCount: messageMeta.length, messageChars: messageMeta.reduce((s, m) => s + m.chars, 0), messageMeta,
			toolCount: toolNames.length, toolChoice: body.tool_choice || null, toolNames,
			temperature: body.temperature, thinkingExtras: !!body.extra_body || !!body.reasoning_effort,
			reasoningEffort: body.reasoning_effort || null,
		};
		debugEvent("HTTP-Anfrage", meta);
		let res;
		const ctrl = trackAbort();
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
			throw new AiHttpError(res.status, text, retryAfterMsOf(res)); // [F1]
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
		if (cfg().family !== "google") return tools;
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
	// Freischaltung gilt pro CHAT, nicht global: Einmal freigeschaltet blieb der Sparmodus
	// vorher für alle weiteren Chats der Sitzung faktisch aus.
	const toolsUnlocked = new Set(); // Chat-Schlüssel — „ja, mach das" muss nach Freischaltung weiter funktionieren

	// FIX: EINE Werkzeugliste für Lauf UND Diagnose. Der Debug-Test schickte nur TOOLS.defs — die
	// 🧪 Experimente-Tools fehlten dort, er meldete also „Tool-Schema ok“, während der echte Lauf
	// am zusätzlichen Schema scheiterte (Gemini „500 INTERNAL“).
	const fullToolDefs = () => {
		const defs = TOOLS.defs.slice();
		return typeof window.EXP?.extraToolDefs === "function" ? defs.concat(window.EXP.extraToolDefs()) : defs;
	};

	// ---- Status / Modelle / Embeddings (Basis-URL ist immer vollständig — nie "/v1" anhängen) ----
	// Zeitgrenze: Ein Server, der die Verbindung offen hält aber nie antwortet, ließ
	// „Verbindung testen“ und die Modell-Listen vorher unbegrenzt hängen.
	const MODELS_TIMEOUT_MS = 12000;
	async function modelIds(base, key) {
		let res;
		try {
			res = await fetch(String(base).replace(/\/+$/, "") + "/models", { headers: auth(key), signal: AbortSignal.timeout(MODELS_TIMEOUT_MS) });
		} catch (error) {
			if (error?.name === "TimeoutError") throw new Error("Zeitüberschreitung nach " + Math.round(MODELS_TIMEOUT_MS / 1000) + " s — der Server hat nicht geantwortet.");
			throw error;
		}
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
			// Auch Embeddings hängen jetzt an ⏹ — vorher liefen sie nach dem Stopp weiter.
			res = await fetch(base + "/embeddings", { method: "POST", headers: { "Content-Type": "application/json", ...auth(pr.key) }, body: JSON.stringify({ model: S.settings.embedModel, input: texts }), signal: trackAbort().signal });
		} catch (error) {
			debugEvent("Embedding-Netzwerkfehler", { provider: pr.id, model: S.settings.embedModel, error: String(error?.message || error) });
			throw error;
		}
		if (!res.ok) {
			const text = await res.text().catch(() => "");
			debugEvent("Embedding-Fehler", { provider: pr.id, model: S.settings.embedModel, status: res.status, ms: Math.round(performance.now() - started), response: String(text).slice(0, 400) });
			throw new AiHttpError(res.status, text);
		}
		const data = (await res.json())?.data;
		if (!Array.isArray(data)) throw new Error("Unerwartete Antwort der Embedding-Quelle (kein data-Feld).");
		const vecs = data.map((d) => d.embedding);
		// WARUM: Fehlende/leere Vektoren rutschten stumm durch. rag.js legte so einen Nicht-Vektor als
		// Antwort auf die Suchanfrage in den Cache und stuerzte danach im Betrags-Rechner ab — dieselbe
		// Frage blieb dauerhaft kaputt, ohne sichtbaren Fehler. Fehlschlag hier melden statt weitergeben.
		if (vecs.length !== texts.length || vecs.some((v) => !Array.isArray(v) || !v.length)) {
			throw new Error("Embedding-Quelle lieferte unvollstaendige Vektoren (" + vecs.length + "/" + texts.length + ").");
		}
		return vecs;
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
		// FIX: Die Fähigkeiten wurden NUR beim Öffnen der Einstellungen ermittelt — wer sie in
		// einer Sitzung nie öffnete, bekam trotz eingeschaltetem Regler NIE Gedankengänge.
		// Das Manifest ist eine reine Tabelle, also hier direkt auswertbar.
		const c = cfg();
		const cap = capStore()[capKey(c)] || declaredThinkingCapabilities(c);
		if (!cap.includeThoughts || c.family !== "google") return false;
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
		// Das Tool-Schema darf nur weggelassen werden, solange im Verlauf noch KEINE
		// Werkzeug-Aufrufe stehen. Sonst lehnen strenge Server die Anfrage komplett ab — oder
		// das Modell behauptet „erledigt“, ohne noch handeln zu können.
		const historyHasToolCalls = (messages || []).some((m) => m?.role === "tool" || m?.tool_calls?.length);
		const canDropTools = !!tools?.length && !historyHasToolCalls;
		const plans = [
			{ label: "Standard", withExtras: true, tools },
			{ label: "Retry ohne Thinking-Extras", withExtras: false, tools },
			{ label: "Retry mit gleichem Request", withExtras: false, tools },
			{ label: canDropTools ? "Fallback ohne Tool-Schema" : "Letzter Retry", withExtras: false, tools: canDropTools ? null : tools },
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
		if (cfg().family !== "google" || !source || !target) return;
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
		// Die Sticht-Heuristik arbeitet bewusst „fail closed“ — begann eine ECHTE Antwort zufällig wie
		// ein Selbstgespräch („Zunächst …“), verschwand sie komplett und der Chat blieb leer.
		// Lieber der volle Text als gar keine Antwort.
		if (!m.content && split.reasoning && !m.tool_calls?.length) m.content = split.reasoning;
		else if (split.reasoning) reasoning = reasoning ? reasoning + "\n" + split.reasoning : split.reasoning;
		if (reasoning) m.reasoning = reasoning; else delete m.reasoning;
		// Ohne Aufruf-Kennung ist das spätere Tool-Ergebnis nicht zuordenbar (harter Serverfehler).
		(m.tool_calls || []).forEach((slot, i) => { if (!slot.id) slot.id = "call_" + i + "_" + U.uid().slice(0, 8); });
		m._debugRawContent = rawContent;
		return m;
	}
	async function readStream(res, onDelta, onReasoning, markProduced) {
		const reader = res.body.getReader();
		const dec = new TextDecoder();
		const msg = { role: "assistant", content: "", reasoning: "", tool_calls: [] };
		let rawContent = "", apiReasoning = "", buf = ""; // apiReasoning = echtes API-Reasoning, nie von der Heuristik überschrieben
		let leakedReasoning = ""; // aus dem Text gezogener Denkteil (Tags/Heuristik) — wächst nur
		let plain = false; // steht fest: reiner Antworttext → teurer Volltext-Split entfällt (siehe unten)
		const emitReasoning = () => { if (onReasoning && msg.reasoning) onReasoning(msg.reasoning); };
		for (;;) {
			const { done, value } = await reader.read();
			// Zwei stille Datenverluste: Der Rest im Puffer wurde beim Ende WEGGEWORFEN (manche
			// Server senden das letzte Ereignis — oft der Tool-Aufruf — ohne Schluss-Umbruch),
			// und bei \r\n blieb ein \r stehen, an dem das Lesen der Zeile scheiterte.
			buf += done ? "" : dec.decode(value, { stream: true });
			const lines = buf.split(/\r?\n/);
			buf = done ? "" : lines.pop();
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
					// PERF: splitThink lief bei JEDEM Token über den GESAMTEN bisherigen Text — quadratischer
					// Aufwand, spürbar als Ruckeln gegen Ende langer Antworten. Steht einmal fest, dass weder
					// Tag noch Heuristik etwas abtrennt, wird nur noch angehängt; taucht doch noch ein "<" auf,
					// greift sofort wieder die volle Prüfung.
					if (plain && textPiece.includes("<")) plain = false;
					if (plain) {
						msg.content = rawContent;
					} else {
						const split = splitThink(rawContent, !!apiReasoning); // Heuristik nur ohne API-Reasoning
						msg.content = split.content;
						// FIX (26. Juli): Der aus dem Text gezogene Denkteil darf beim Streamen nur noch
						// WACHSEN. Wurde ein Denkblock durch ein späteres Token neu bewertet (z.B. weil ein
						// halb gestreamtes <think>-Tag plötzlich anders greift), verschwand die ganze
						// Gedankengang-Box mitten im Antworten.
						if (split.reasoning.length >= leakedReasoning.length) leakedReasoning = split.reasoning;
						msg.reasoning = leakedReasoning ? (apiReasoning ? apiReasoning + "\n" + leakedReasoning : leakedReasoning) : apiReasoning;
						emitReasoning();
						// Kein Denkteil, nichts abgetrennt, kein "<" im Text: ab hier ist der Split überflüssig.
						plain = !leakedReasoning && split.content === rawContent && rawContent.length > 400 && !rawContent.includes("<");
					}
					onDelta(msg.content);
				}
				for (const tc of delta.tool_calls || []) {
					// [F2] index kann fehlen → per id mergen, sonst letzter Slot; unbekannte id = neuer Slot
					let i = tc.index ?? (tc.id ? msg.tool_calls.findIndex((slot) => slot.id === tc.id) : msg.tool_calls.length - 1);
					if (i < 0) i = msg.tool_calls.length;
					const slot = (msg.tool_calls[i] = msg.tool_calls[i] || { id: "", type: "function", function: { name: "", arguments: "" } });
					copyGeminiThoughtMetadata(tc, slot);
					if (tc.id) slot.id = tc.id;
					// Manche Routen wiederholen den VOLLEN Namen in jedem Häppchen — stumpfes
					// Anhängen ergab „get_contextget_context“ → „Unbekanntes Werkzeug“.
					const piece = tc.function?.name || "";
					if (piece && piece !== slot.function.name) slot.function.name += piece;
					if (tc.function?.arguments) slot.function.arguments += tc.function.arguments;
				}
			}
			if (done) break;
		}
		// Lokale Modelle liefern manchmal keine Aufruf-Kennung — ohne sie antwortet der Server
		// beim Zurücksenden des Ergebnisses mit einem harten Fehler.
		// FIX: Lücken schließen. Kam ein tool_call mit index 1 vor index 0 (oder sprang der Index),
		// blieb ein Loch im Array — der Agent-Loop lief in "undefined.function" und der ganze Lauf brach ab.
		msg.tool_calls = msg.tool_calls.filter((slot) => slot && slot.function?.name);
		msg.tool_calls.forEach((slot, i) => { if (!slot.id) slot.id = "call_" + i + "_" + U.uid().slice(0, 8); });
		if (!msg.tool_calls.length) delete msg.tool_calls;
		// s. finishMessage: nie eine leere Antwort ausliefern, nur weil die Heuristik alles
		// als Denkprozess eingestuft hat (kein echtes API-Reasoning, keine Tool-Aufrufe).
		if (!msg.content && leakedReasoning && !apiReasoning && !msg.tool_calls) msg.content = leakedReasoning;
		if (!msg.reasoning) delete msg.reasoning;
		msg._debugRawContent = rawContent;
		return msg;
	}
	// Bilder sind die mit Abstand teuersten Nachrichten und wurden in JEDEM Agent-Schritt
	// (bis zu 12×) erneut hochgeladen. Nur die beiden jüngsten bleiben vollständig.
	const IMAGE_KEEP = 2;
	// WARUM: Jedes Werkzeug-Ergebnis war EINZELN auf 6000 Zeichen gedeckelt, in Summe aber
	// unbegrenzt — zwölf Schritte trugen so bis zu ~70000 Zeichen in JEDE weitere Anfrage.
	// Ältere Ergebnisse werden ab diesem Gesamtdeckel zu einem kurzen Hinweis eingedampft.
	const TOOL_BUDGET = 24000;
	const TOOL_DROPPED = JSON.stringify({ gekuerzt: true, hinweis: "Älteres Ergebnis aus Platzgründen entfernt — bei Bedarf erneut abrufen." });
	function pruneRunHistory(msgs) {
		let kept = 0, toolChars = 0;
		for (let i = msgs.length - 1; i >= 0; i--) {
			const m = msgs[i];
			if (m.role === "tool" && typeof m.content === "string") {
				// Vor dem Aufaddieren prüfen, sonst darf ein Ergebnis das Budget noch überschreiten.
				if (toolChars + m.content.length > TOOL_BUDGET && m.content.length > TOOL_DROPPED.length) m.content = TOOL_DROPPED;
				toolChars += m.content.length;
				continue;
			}
			if (!Array.isArray(m.content) || !m.content.some((p) => p?.type === "image_url")) continue;
			if (++kept <= IMAGE_KEEP) continue;
			m.content = m.content.filter((p) => p?.type !== "image_url")
				.concat({ type: "text", text: "[Bild aus Platzgründen entfernt — bei Bedarf mit get_heft_page_image erneut anfordern]" });
		}
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
			await runProbe("Antwort mit Tool-Schema", fullToolDefs(), false),
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
	// 👁 NUR die aktuell geöffnete Seite als Bild (Vision) — Handschrift, Skizzen und Layout gehen
	// im Text verloren. Abwählbar über den ✕-Chip im Composer (S.sideContextOff).
	// EINE Auflösung „welches Heft ist gerade sichtbar“ für Bild UND System-Prompt. Zwei Fälle:
	// die Seite IST ein Heft, oder sie bettet eins ein (dann ist HEFT.activeId das Heft und cur
	// nur die Elternseite). Stand zweimal leicht unterschiedlich in dieser Datei — der Prompt
	// konnte dadurch eine andere Seitenzahl nennen, als das mitgeschickte Bild zeigte.
	function activeHeft(cur) {
		const id = cur && cur.kind === "heft" ? cur.id : (window.HEFT?.activeId || null);
		const page = id ? S.pages[id] : null;
		if (!page || page.kind !== "heft") return null;
		return { id, page, idx: window.HEFT?.activeId === id ? (window.HEFT.activeIndex || 0) : 0 };
	}
	async function pageContextImage() {
		const cur = S.currentPageId ? S.pages[S.currentPageId] : null;
		if (!cur || S.view === "anki" || S.sideContextOff === cur.id) return null;
		if (typeof window.HEFT?.pageAsDataUrl !== "function") return null;
		const heft = activeHeft(cur);
		if (!heft) return null;
		try {
			const { page: heftPage, id: heftId, idx } = heft;
			return { role: "user", content: [
				{ type: "text", text: "[Seitenkontext: „" + heftPage.title + "“, Seite " + (idx + 1) + " als Bild]" },
				{ type: "image_url", image_url: { url: await window.HEFT.pageAsDataUrl(heftId, idx) } },
			] };
		} catch { return null; }
	}
	// toolsMode: true = volle Liste, "meta" = nur request_tools, sonst keine Tools [F3]
	function systemPrompt(toolsMode, ragContext, chatSummary, modelNote) {
		const cur = S.currentPageId ? S.pages[S.currentPageId] : null;
		const now = new Date();
		// Hier stand der komplette Werkzeug-Katalog ein zweites Mal (Namen, Regeln, Empfehlungen) —
		// derselbe Inhalt steckt schon in den Tool-Schemas. Kostete in JEDEM Agent-Schritt Kontext,
		// driftete bei Änderungen auseinander und drängte die eigentliche Frage an den Rand.
		// Es bleibt nur, was aus den Schemas NICHT hervorgeht: Arbeitsweise.
		const toolLine = toolsMode === true
			? "Arbeite mehrschrittig: erst nachsehen (get_context, list_pages, list_decks, read_page, semantic_search), dann handeln. Namen nie raten oder erfinden — immer erst auflisten. Karten korrigieren/verschieben statt löschen und neu anlegen. Bei echter Mehrdeutigkeit ask_choice. Kündige Arbeit nicht an, sondern führe sie im selben Zug aus, und sage danach in einem Satz konkret, was passiert ist (Anzahl, Namen)."
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
		// 🐛 Fix (27. Juli): Der Seitenkontext hing am Chat-Typ und fehlte im Vollbild-Chat komplett.
		// Jetzt bekommt JEDER Chat die geöffnete Seite — Text hier, Bild in pageContextImage().
		// Im Karteikarten-Bereich ersetzt der Anki-Kontext oben die Seite; per ✕ im Composer abwählbar.
		if (cur && S.view !== "anki" && S.sideContextOff !== cur.id) {
			// FIX: Heft-Seiten haben als content nur ":::heft <id>" — das ist kein
			// lesbarer Inhalt, sondern ein Einbettungs-Marker. Die KI sah diesen
			// rohen Marker als "Seiteninhalt", was in der Kontext-Anzeige und im
			// System-Prompt unsinnig wirkte. Der echte Inhalt kommt als Bild
			// via pageContextImage(); hier nur einen knappen Hinweis geben.
			const heft = activeHeft(cur);
			if (heft) {
				lines.push("Handschrift-Heft „" + heft.page.title + "“ ist geöffnet (Seite " + (heft.idx + 1) + "). Der Inhalt wird als Bild übergeben — falls kein Vision-Modell aktiv ist, steht kein visueller Inhalt zur Verfügung.");
			} else {
				// 6000 Zeichen gingen bei JEDER Anfrage und in JEDEM Agent-Schritt erneut mit — bei langen
				// Seiten der größte Posten überhaupt, und dieselbe Seite liefert get_context/read_page bei Bedarf.
				const body = String(cur.content || "");
				const cut = body.length > 2500;
				lines.push("Inhalt der geöffneten Seite" + (cut ? " (Anfang — Rest per read_page)" : "") + ":\n" + (body.slice(0, 2500) || "(Leere Seite)"));
			}
		}
		if (ragContext) lines.push("Automatisch gefundene, möglicherweise relevante Notiz-Auszüge:\n" + ragContext);
		if (chatSummary) lines.push("Zusammenfassung des bisherigen Gesprächs (ältere Nachrichten, nicht mehr im Verlauf):\n" + chatSummary);
		if (modelNote) lines.push(modelNote);
		if (S.settings.customInstructions?.trim()) lines.push("Zusätzliche Anweisungen (aus den Einstellungen):\n" + S.settings.customInstructions.trim());
		return lines.join("\n");
	}

	// ---- Chat-Persistenz (kein APP-Import — wäre zyklisch: chat-fullscreen → ai → …). Die eigentliche
	// Logik (Sitzung finden/anlegen, speichern) steckt gemeinsam mit chat-fullscreen.js in CHATS.persist. ----
	function persistChat(type) {
		const messages = type === "side" ? S.sideChat : S.chat;
		const idKey = type === "side" ? "sideChatId" : "currentChatId";
		CHATS.persist(messages, idKey);
	}

	// ---- Eingriffe mit Rückfrage: EINE Bestätigungs-Pipeline für alle Tools, die etwas
	// unwiederbringlich oder großflächig verändern. resolve() → Fehler ODER
	// {detail, question, runArgs, cancelled}; options überschreibt die Standard-Antworten.
	// EIN Kürzer für Karten-Vorderseiten — stand vorher 3× fast identisch in den Bestätigungen.
	const shortFront = (c, max = 60) => {
		const s = String(c?.front || "").replace(/\s+/g, " ").trim();
		return s.length > max ? s.slice(0, max) + "…" : s;
	};

	const CONFIRM_SPECS = {
		reset_card_progress: {
			options: ["Ja, zurücksetzen", "Abbrechen"],
			resolve(args) {
				const front = String(args?.front || "").trim();
				const deckArg = String(args?.deck || "").trim();
				if (!front && !deckArg) return { error: "reset_card_progress: bitte front oder deck angeben." };
				if (front) {
					const card = TOOLS.findCard(front, deckArg || undefined);
					if (!card) return { error: "Karte nicht gefunden: " + front };
					const label = shortFront(card);
					return {
						detail: label,
						question: 'Lernfortschritt der Karte „' + label + '“ zurücksetzen? Sie gilt danach wieder als neu.',
						runArgs: { front: card.front, deck: card.deck },
						cancelled: { cancelled: true, front: card.front, note: "Zurücksetzen abgebrochen — nichts geändert." },
					};
				}
				const hit = TOOLS.resolveDeckStrict(deckArg);
				if (hit.error) return { error: hit.error };
				const match = hit.deck;
				const cardN = TOOLS.cardsOfDeck(match).length; // EINE Teilbaum-Regel, sie lebt in tools.js
				return {
					detail: match,
					question: 'Lernfortschritt von ' + cardN + ' Karte(n) im Stapel „' + match + '“ zurücksetzen? Alle gelten danach wieder als neu.',
					runArgs: { deck: match },
					cancelled: { cancelled: true, deck: match, note: "Zurücksetzen abgebrochen — nichts geändert." },
				};
			},
		},
		delete_page: {
			resolve(args) {
				const title = String(args?.page_title || "").trim();
				if (!title) return { error: "delete_page: page_title fehlt." };
				const pg = STATE.findPage(title);
				if (!pg) return { error: "Seite nicht gefunden: " + title };
				const subN = TOOLS.subtreeIds(pg.id).size - 1; // gleiche Baum-Logik wie das Tool selbst
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
				const label = shortFront(card);
				return {
					detail: label,
					question: 'Karte „' + label + '“ in den Papierkorb?',
					runArgs: { front: card.front, deck: card.deck },
					cancelled: { cancelled: true, front: card.front, note: "Löschen abgebrochen — nichts geändert." },
				};
			},
		},
		delete_flashcards: {
			resolve(args) {
				const sel = TOOLS.selectCards(args || {});
				if (sel.error) return { error: sel.error };
				if (!sel.cards.length) return { error: "Keine passenden Karten gefunden." };
				const shown = sel.cards.slice(0, 3).map((c) => '„' + shortFront(c, 50) + '“').join(", ");
				const rest = sel.cards.length - Math.min(3, sel.cards.length);
				const n = sel.cards.length;
				// Die Auswahl kann durch die Sicherheitsgrenze gekappt sein — das gehört in die Frage,
				// sonst bestätigt man „alles“ und ein Teil bleibt stillschweigend liegen.
				const capped = sel.truncated ? " (von " + sel.total + " Treffern — der Rest bleibt vorerst erhalten)" : "";
				return {
					detail: n + (n === 1 ? " Karte" : " Karten") + (sel.deck ? " · " + sel.deck : ""),
					question: n === 1
						? 'Karte „' + shortFront(sel.cards[0], 50) + '“ in den Papierkorb?'
						: n + " Karten" + (sel.deck ? ' aus „' + sel.deck + '“' : "") + capped + " in den Papierkorb? " + shown + (rest > 0 ? " und " + rest + " weitere" : ""),
					// ids statt fronts: eindeutig, selbst wenn zwei Karten gleich beginnen
					runArgs: { ids: sel.cards.map((c) => c.id) },
					cancelled: { cancelled: true, count: n, note: "Löschen abgebrochen — nichts geändert." },
				};
			},
		},
		delete_deck: {
			resolve(args) {
				const name = String(args?.deck || "").trim();
				if (!name) return { error: "delete_deck: deck fehlt." };
				const hit = TOOLS.resolveDeckStrict(name);
				if (hit.error) return { error: hit.error };
				const match = hit.deck;
				const cardN = TOOLS.cardsOfDeck(match).length;
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
		// FIX: Ohne Chat-ID hieß der Schlüssel für JEDEN frischen Chat „neu“ — eine einmalige
		// Freischaltung galt damit stillschweigend für alle späteren neuen Chats. Kein Schlüssel =
		// keine Erinnerung; innerhalb des Laufs zählt runUnlocked, gemerkt wird erst mit echter ID.
		const chatKey = () => { const id = type === "side" ? S.sideChatId : S.currentChatId; return id ? type + ":" + id : ""; };
		const rememberUnlock = () => { const k = chatKey(); if (k) toolsUnlocked.add(k); };
		let runUnlocked = toolsUnlocked.has(chatKey());

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

		// Verlauf: Bilder als image_url (Vision), Text-/PDF-Anhänge als Kontext.
		// FIX: Erst filtern, DANN kürzen. Vorher wurden die letzten N Einträge des ROHEN Verlaufs
		// genommen (inklusive Werkzeug-Chips, Änderungs-Karten und Rückfragen) und erst danach
		// gefiltert — es reisten also viel weniger echte Nachrichten mit, als das Limit erlaubt.
		// Die Zusammenfassung rechnete gleichzeitig mit dem gefilterten Verlauf: dazwischen klaffte
		// eine Lücke, in der Nachrichten weder im Verlauf noch in der Zusammenfassung standen —
		// genau das war das „Die KI vergisst mitten im Gespräch“-Verhalten.
		// FIX: Beantwortete Rückfragen standen NUR in der UI-Karte. Die Entscheidung des Nutzers
		// („Variante B“) fehlte im nächsten Lauf komplett — die KI fragte dasselbe erneut oder riet.
		const convo = targetChat
			.filter((m) => m.role === "user" || m.role === "assistant" || (m.role === "question" && m.answered))
			.map((m) => (m.role === "question" ? { role: "user", content: "Meine Antwort auf die Rückfrage „" + m.question + "“: " + m.answer } : m));
		// WARUM: Das Verlaufsfenster zählte NACHRICHTEN. 48 kurze Zeilen sind harmlos, 48 lange
		// Antworten sprengen jeden Kontext — dieselbe Zahl bedeutete je nach Chat ein Vielfaches an
		// Text, Wartezeit und Kosten. Jetzt begrenzt ein Zeichenbudget, die Anzahl bleibt Obergrenze.
		const limit = historyLimit();
		const budget = limit * 1500;
		let used = 0, keep = 0;
		for (let i = convo.length - 1; i >= 0 && keep < limit; i--) {
			// Ein mitgeschicktes Bild kostet ein Vielfaches eines Textabsatzes — mit zu kleinem
			// Gewicht rutschten reine Bild-Verläufe komplett durch das Budget.
			used += String(convo[i].content || "").length + (convo[i].image ? 4000 : 0);
			if (used > budget && keep >= 2) break; // die zwei jüngsten Nachrichten bleiben immer
			keep++;
		}
		const overflow = convo.slice(0, convo.length - keep);
		const recent = convo.slice(convo.length - keep);
		// Angehängte PDFs/Textdateien reisten in VOLLER Länge in jeder Folgeanfrage erneut mit —
		// ein einziges großes PDF verteuerte damit jede weitere Frage im selben Chat. Nur die
		// zwei jüngsten Anhänge kommen vollständig mit, ältere nur noch als Hinweis.
		const fullAttachments = new Set();
		for (let i = recent.length - 1; i >= 0 && fullAttachments.size < 2; i--) {
			if (recent[i].textFile || recent[i].pdfFile) fullAttachments.add(recent[i]);
		}
		const attachText = (m, label, file) => (fullAttachments.has(m)
			? "[" + label + ": " + file.name + "]\n" + file.content
			: "[" + label + ": " + file.name + " — Inhalt aus Platzgründen nicht erneut mitgeschickt; bei Bedarf search_chat_history nutzen]");
		const history = recent.map((m) => {
			let content = m.content || "";
			if (m.textFile) content = (content ? content + "\n\n" : "") + attachText(m, "Angehängte Datei", m.textFile);
			if (m.pdfFile) content = (content ? content + "\n\n" : "") + attachText(m, "Angehängtes PDF", m.pdfFile);
			return m.image ? { role: m.role, content: [{ type: "text", text: content }, { type: "image_url", image_url: { url: m.image } }] } : { role: m.role, content };
		});
		const metaOnly = S.settings.alwaysSendTools === false && !runUnlocked;
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
			if (overflow.length) {
				// FIX: Ohne Chat-ID hieß der Schlüssel für JEDEN neuen Chat gleich („neu“) — die
				// Zusammenfassung eines fremden Gesprächs wanderte damit in den nächsten Chat.
				const chatId = type === "side" ? S.sideChatId : S.currentChatId;
				const summaryKey = chatId ? type + ":" + chatId : "";
				const cachedRaw = summaryKey ? chatSummaries[summaryKey] : null;
				// FIX: Wurde der Verlauf gekürzt (Nachricht bearbeitet, Antwort verworfen), beschrieb
				// die gespeicherte Zusammenfassung Nachrichten, die es gar nicht mehr gibt. Ist der
				// Überhang geschrumpft, wird sie neu gebaut statt fortgeschrieben.
				const cached = cachedRaw && overflow.length >= cachedRaw.count ? cachedRaw : null;
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
					if (summaryText) { if (summaryKey) chatSummaries[summaryKey] = { count: overflow.length, text: summaryText }; chatSummary = summaryText; }
					else if (cached) chatSummary = cached.text;
				}
			}
		} catch (e) { debugEvent("Chat-Zusammenfassung übersprungen", { error: String(e?.message || e).slice(0, 200) }); }
		// 👁 Seitenkontext: die geöffnete Seite reist als Bild mit (nur sie, sonst nichts).
		const ctxImage = await pageContextImage();
		if (ctxImage) history.push(ctxImage);
		// 👁 Vision-Hinweis: Modelle ohne Bild-Empfang sollen das offen sagen statt zu raten
		const visionNote = history.some((m) => Array.isArray(m.content))
			? "\n\nAn Nachrichten können Bilder hängen (z. B. Heft-Seiten oder Screenshots). Wenn du Bilder technisch nicht empfangen oder nicht sehen kannst (kein Vision-Modell), erwähne das kurz und ehrlich, statt Inhalte zu raten."
			: "";
		// 🔁 Modellwechsel mitten im Chat: gewechselt wird praktisch immer, WEIL die bisherigen
		// Antworten nicht getaugt haben. Ohne diesen Hinweis las das neue Modell den Verlauf als
		// gelungene Vorlage und wiederholte genau dieselben Schwächen.
		const curModel = cfg().model;
		const prevModel = (() => {
			for (let i = targetChat.length - 1; i >= 0; i--) if (targetChat[i].role === "assistant" && targetChat[i].model) return targetChat[i].model;
			return "";
		})();
		const modelNote = prevModel && prevModel !== curModel
			? "Hinweis zum Modellwechsel: Die bisherigen Antworten in diesem Chat stammen von einem anderen Modell (" + prevModel + "), ab jetzt antwortest du (" + curModel + "). Gewechselt wird in aller Regel aus Unzufriedenheit. Prüfe den bisherigen Verlauf still auf Schwächen — zu lang oder ausweichend, Frage verfehlt, erfundene Seiten-/Stapelnamen, Arbeit nur angekündigt statt ausgeführt, Formeln oder Zahlen ungeprüft — und mache es konkret besser. Sprich den Wechsel nicht an."
			: "";
		const sysMsg = (mode) => ({ role: "system", content: systemPrompt(mode, ragContext, chatSummary, modelNote) + visionNote });
		const messages = [sysMsg(metaOnly ? "meta" : true), ...history];
		debugEvent("Tool-Modus", { mode: metaOnly ? "nur request_tools" : "volle Liste", reason: metaOnly ? "Einstellung »Tools immer mitsenden« ist aus" : (runUnlocked ? "in diesem Chat freigeschaltet" : "Standard: Tools immer mitsenden") }); // [F3]

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
			// FIX (26. Juli): NICHT mehr leeren — der bisher gesammelte Gedankengang blieb sonst
			// genau in dem Moment weg, in dem man eine Rückfrage/Löschbestätigung beantwortet.
			S.aiThinkingDraft = runReasoning;
			const answer = await new Promise((resolve) => {
				pendingChoices[qMid] = resolve;
				targetChat.push({ mid: qMid, role: "question", question, options, answered: false });
				renderLog();
				persist(true); // offene Wartezeit: die Frage muss ein Neuladen überleben
			});
			const qMsg = targetChat.find((x) => x.mid === qMid);
			if (answer === ABORTED) { // ⏹ während einer offenen Rückfrage
				if (qMsg) { qMsg.answered = true; qMsg.answer = "Abgebrochen"; }
				renderLog();
				const err = new Error("Abgebrochen.");
				err.name = "AbortError";
				failRun(err);
			}
			if (qMsg) { qMsg.answered = true; qMsg.answer = answer; }
			S.aiStatus = "…denkt nach…";
			return answer;
		}
		const pushToolChip = (name, detail, error) => targetChat.push({ mid: U.uid(), role: "tool", name, detail: String(detail || "").slice(0, 80), error: !!error });
		// Werkzeug-Ergebnisse bleiben im Verlauf und werden in JEDEM weiteren Schritt erneut
		// mitgeschickt. Ohne Deckel sprengte ein gelesener Seiteninhalt oder eine lange
		// Kartenliste den Rest des Laufs — bis zu zwölfmal hintereinander.
		const TOOL_RESULT_LIMIT = 6000;
		const pushToolResult = (tc, out) => {
			let content = JSON.stringify(out ?? {});
			if (content.length > TOOL_RESULT_LIMIT) {
				content = JSON.stringify({ gekuerzt: true, hinweis: "Ergebnis war zu lang und wurde gekürzt — bei Bedarf gezielter nachfragen (Filter, Suchbegriff, limit).", auszug: content.slice(0, TOOL_RESULT_LIMIT) });
			}
			messages.push({ role: "tool", tool_call_id: tc.id, content });
		};
		// Speichern gedrosselt: Bisher lief nach JEDEM Werkzeug ein vollständiger Schreibvorgang —
		// Dutzende pro Antwort. force = Haltepunkte, an denen ein Neuladen droht.
		let persistTimer = 0, lastPersistAt = 0;
		const persist = (force) => {
			clearTimeout(persistTimer);
			persistTimer = 0;
			if (!force && Date.now() - lastPersistAt < 1500) {
				persistTimer = setTimeout(() => persist(true), 1500);
				return;
			}
			lastPersistAt = Date.now();
			try { persistChat(type); } catch (e) { console.warn("Chat speichern:", e); }
		};
		// EIN Abschluss für jeden Werkzeug-Aufruf: Schritt melden, Chip setzen, zeichnen, Ergebnis
		// in den API-Verlauf, speichern. Stand vorher achtmal fast gleich in der Schleife — jede
		// Abweichung war ein eigener Bug (fehlender Chip, kein Speichern nach Fehlern).
		// detail === null: kein Chip; full: sofort neu zeichnen statt gedrosselt.
		const finishTool = (tc, name, detail, out, full) => {
			if (onStep) onStep(name);
			if (detail !== null) pushToolChip(name, detail, out?.error);
			if (full) renderLog(); else scheduleRender();
			pushToolResult(tc, out);
			persist();
		};
		// Bricht ein Lauf mittendrin ab, sind bereits ausgeführte Seiten-Änderungen trotzdem echt.
		// Ihre Karten (Unterschied + Rückgängig) gingen bisher verloren, weil sie erst nach der
		// finalen Antwort angehängt wurden — die Änderung war also passiert und nicht rückholbar.
		// FIX: aiDraft NICHT mehr leeren — chat-fullscreen.js hängt bei ⏹ die bereits gestreamte
		// Teilantwort an, fand hier aber immer schon einen leeren Entwurf vor (Text war weg).
		// Geleert wird zentral beim Beenden des Laufzustands (setBusy).
		const failRun = (error) => {
			S.aiThinkingDraft = "";
			flushPendingEdits();
			persist(true);
			throw error;
		};

		// 💭 Gedankengang über ALLE Agent-Schritte sammeln (bleibt sichtbar, wird komplett gespeichert)
		let runReasoning = "";
		let nudged = false; // Nachfrage bei leerer Antwort höchstens einmal pro Lauf
		const addRunReasoning = (piece) => { if (piece) runReasoning = runReasoning ? runReasoning + "\n\n" + piece : piece; };
		for (let step = 0; step < MAX_AGENT_STEPS; step++) {
			S.aiDraft = "";
			S.aiThinkingDraft = runReasoning;
			pruneRunHistory(messages);
			let msg;
			try {
				msg = await chatOnce(
					messages, agentTools,
					(text) => { S.aiDraft = text; scheduleRender(); },
					(text) => { S.aiThinkingDraft = runReasoning ? runReasoning + "\n\n" + text : text; scheduleRender(); },
				);
			} catch (error) { failRun(error); }
			addRunReasoning(msg.reasoning);
			messages.push(toApiMessage(msg)); // bereinigt in den API-Verlauf (ohne interne Felder)
			// Text, der ZUSAMMEN mit Tool-Aufrufen kam, wurde live gestreamt und im nächsten Schritt
			// stillschweigend überschrieben — sichtbar geschriebener Text verschwand wieder.
			if (msg.tool_calls?.length && String(msg.content || "").trim()) {
				targetChat.push({ mid: U.uid(), role: "assistant", content: String(msg.content).trim(), model: curModel, reasoningExpanded: false });
			}

			if (!msg.tool_calls?.length) { // finale Antwort
				// Manche Modelle beenden nach Werkzeug-Arbeit mit LEEREM Text — im Chat stand dann eine
				// leere Blase. Einmal um einen Satz bitten statt Leere auszuliefern.
				if (!String(msg.content || "").trim() && !nudged) {
					nudged = true;
					messages.push({ role: "user", content: "Deine Antwort war leer. Sage in ein bis zwei Sätzen konkret, was du getan oder herausgefunden hast — ohne weiteren Werkzeug-Aufruf." });
					continue;
				}
				// model mitspeichern: einziger verlässlicher Marker für einen späteren Modellwechsel (s.o.).
				const finalMsg = { mid: U.uid(), role: "assistant", content: msg.content || "", model: curModel, reasoning: runReasoning || null, reasoningExpanded: false };
				S.aiDraft = "";
				S.aiThinkingDraft = "";
				targetChat.push(finalMsg);
				flushPendingEdits();
				persist(true); // Reload direkt nach der Antwort darf den Chat nicht verlieren
				if (runUnlocked) rememberUnlock(); // Chat-ID existiert erst nach dem Speichern
				return finalMsg.content;
			}

			// 📓 Bilder aus get_heft_page_image — erst NACH allen Tool-Antworten dieses Schritts anhängen
			// (zwischen assistant(tool_calls) und den tool-Antworten darf keine andere Nachricht stehen)
			const pendingImageMessages = [];
			for (const tc of msg.tool_calls) {
				const name = tc.function.name;
				// FIX: Abgeschnittene oder kaputte Argumente wurden STILL zu {} — create_page lief
				// dann ohne Titel, delete_page ohne Seite. Der Fehler geht jetzt zurück ans Modell,
				// das den Aufruf sauber wiederholen kann, statt Unsinn auszuführen.
				const rawArgs = String(tc.function.arguments || "").trim();
				let args = {};
				if (rawArgs) { try { args = JSON.parse(rawArgs); } catch { args = null; } }
				if (!args || typeof args !== "object" || Array.isArray(args)) {
					finishTool(tc, name, "ungültige Argumente", { error: "Die Argumente von " + name + " sind kein gültiges JSON (vermutlich abgeschnitten) — bitte den Aufruf mit vollständigen Argumenten wiederholen." });
					continue;
				}

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
					finishTool(tc, name, (args.page_title || "aktuelles Heft") + (pageNo ? " · Seite " + pageNo : ""), out);
					continue;
				}

				if (name === "request_tools") { // Sparmodus: volle Liste freischalten + Prompt aktualisieren [F3]
					runUnlocked = true;
					rememberUnlock();
					agentTools = fullToolDefs();
					messages[0] = sysMsg(true);
					finishTool(tc, name, "Werkzeuge freigeschaltet", { ok: true, hinweis: "Alle Werkzeuge sind jetzt in dieser Anfrage verfügbar." });
					continue;
				}

				if (CONFIRM_SPECS[name]) { // gemeinsame Bestätigung (Löschen, Fortschritt zurücksetzen …)
					const spec = CONFIRM_SPECS[name].resolve(args);
					if (spec.error) {
						finishTool(tc, name, spec.error, { error: spec.error });
						continue;
					}
					const answer = await waitForAnswer(spec.question, CONFIRM_SPECS[name].options || ["Ja, löschen", "Abbrechen"], "Warte auf Bestätigung…");
					let out;
					if (!String(answer || "").toLowerCase().startsWith("ja")) out = spec.cancelled;
					else { try { out = await TOOLS.run(name, spec.runArgs); } catch (e) { out = { error: String(e) }; } }
					// Abbruch: kein Chip, die beantwortete Frage-Karte sagt schon alles.
					finishTool(tc, name, out.cancelled ? null : spec.detail, out, true);
					continue;
				}

				if (name === "ask_choice") { // Rückfrage: pausiert bis Klick, nur Frage-Karte in der UI
					const norm = TOOLS.normalizeAskChoice(args);
					if (norm.error) {
						finishTool(tc, name, norm.error, norm);
						continue;
					}
					const answer = await waitForAnswer(norm.question, norm.options, "Warte auf deine Auswahl…");
					finishTool(tc, name, null, { answer, question: norm.question }, true);
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
				// Chip-Text: Seiten-Tools zuerst, dann die Karten-/Stapel-Tools — vorher blieb
				// der Chip bei jeder Karten-Aktion leer und man sah nicht, was passiert ist.
				let detail = args.page_title || args.title || args.query || args.front
					|| (args.fronts?.length ? args.fronts.slice(0, 2).join(" · ") + (args.fronts.length > 2 ? " +" + (args.fronts.length - 2) : "") : "")
					|| (args.to_deck ? "→ " + args.to_deck : "") || args.new_name || args.deck || args.from_deck || args.name || "";
				if (name === "semantic_search") detail = (detail ? detail + " · " : "") + "Embedding: " + (S.settings.embedModel || "—");
				finishTool(tc, name, detail, out);
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
						// Bei Heften landet der Text im Heft-Inhalt, nicht im Seitentext — dort entstand
						// eine leere Änderungs-Karte, deren „Rückgängig“ nichts bewirkte.
						if (created || after.title !== before.title || after.content !== before.content) {
							pendingEdits.push({ mid: U.uid(), role: "edit", pageId, pageTitle: after.title, before, after, created, undone: false });
						}
					}
				}
			}
			if (pendingImageMessages.length) messages.push(...pendingImageMessages); // 📓 jetzt anhängen (siehe oben)
		}
		S.aiDraft = "";
		S.aiThinkingDraft = "";
		const abort = "(Abgebrochen: zu viele Tool-Schritte.)";
		// Gedankengang auch hier mitgeben — sonst war nach einem Abbruch nicht nachvollziehbar,
		// was die KI in den vielen Schritten eigentlich vorhatte.
		targetChat.push({ mid: U.uid(), role: "assistant", content: abort, reasoning: runReasoning || null, reasoningExpanded: false });
		flushPendingEdits();
		persist(true);
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