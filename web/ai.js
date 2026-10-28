"use strict";

// KI-Anbindung. Anfragen, Wiederholungen, Stream-Parser, Prompt-Bau und die Agent-Schleife
// laufen im Rust-Kern (core/impala-ai, Anbindung impala-wasm/src/ai.rs). Hier bleiben Netz
// (fetch mit Abbruch und Zeitlimits), Werkzeuge, Rückfragen und die Chat-Oberfläche.

import { S, STATE } from "./state.js";
import { TOOLS } from "./tools.js";
import { U } from "./util.js";
import { BUS } from "./event-bus.js";
import { HEFT } from "./heft.js";
import { CHATS } from "./chats.js";
import { RAG } from "./rag.js";
import { EMBEDDINGS, LOCAL_EMBEDDING_MODELS } from "./embedding.js";
import { CLOUDFLARE_SYNC, DEFAULT_WORKER_URL } from "./sync-cloudflare.js";
import { PERF_PROFILER } from "./performance-profiler.js";
import { CORE } from "./rust-core.js";

export const AI = (() => {
	const MODEL_PRESETS = CORE.aiModelPresets();
	const LIMIT = { debug: 40, modelsMs: 5000, modelCacheMs: 30000, requestMs: 60000, streamIdleMs: 30000, embedMs: 30000 };
	const ABORTED = Symbol("aborted");
	const pendingChoices = Object.create(null);
	// Je Chat: Zusammenfassung älterer Nachrichten und freigeschaltete Werkzeuge (überdauern Läufe).
	const chatSessions = new Map();
	const activeControllers = new Set();
	const activeRuns = new Set();
	const debugLog = [];
	const modelCache = new Map();
	const SAFETY_ID_KEY = "impala67AiSafetyId";

	const providers = () => S.settings.aiProviders || [];
	const currentPage = () => (S.currentPageId ? S.pages[S.currentPageId] : null);
	const errorText = (error) => String(error?.message || error);
	const settings = () => ({
		providers: providers(), activeProviderId: S.settings.aiProviderId || "",
		model: S.settings.aiModel || "", thinkingEnabled: S.settings.thinkingEnabled !== false,
	});
	const cfg = () => CORE.aiChatConfig(settings());
	const syncUrl = () => String(CLOUDFLARE_SYNC.status?.()?.url || "");
	function safetyIdentifier() {
		try {
			let id = localStorage.getItem(SAFETY_ID_KEY);
			if (!id) { id = "install_" + U.uid(); localStorage.setItem(SAFETY_ID_KEY, id); }
			return id;
		} catch { return ""; }
	}
	// Zugang zum Cloudflare-Worker („Impala AI“) aus dem Sync-Schlüssel.
	function requestOptions() {
		const sync = CLOUDFLARE_SYNC.status?.() || {};
		let cloudflare = null;
		if (sync.syncKey) {
			try {
				const { userId, authToken } = CORE.syncAuth(sync.syncKey);
				cloudflare = { userId, authToken, fallbackBase: sync.url || DEFAULT_WORKER_URL };
			} catch {}
		}
		return { cloudflare, safetyId: safetyIdentifier() };
	}
	const now = () => {
		const d = new Date();
		return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate(), weekday: d.getDay(), hour: d.getHours(), minute: d.getMinutes() };
	};
	const baseInput = () => ({ settings: settings(), options: requestOptions(), customInstructions: String(S.settings.customInstructions || "").trim(), now: now() });

	// Fehler zusätzlich in den Performance-Profiler (Einstellungen → Diagnose) — nur Metadaten,
	// keine Antworttexte; bei HTTP-Fehlern höchstens die Fehlermeldung des Providers.
	const PROFILER_ERRORS = new Set(["Embedding-Netzwerkfehler", "Embedding-Fehler", "Lokaler-Embedding-Fehler"]);
	function providerErrorMessage(text) {
		try { const e = JSON.parse(text)?.error; return String(e?.message || e || "").slice(0, 160); } catch { return ""; }
	}
	function debugEvent(kind, detail) {
		debugLog.push({ at: new Date().toISOString(), kind, detail });
		if (debugLog.length > LIMIT.debug) debugLog.splice(0, debugLog.length - LIMIT.debug);
		if (!PROFILER_ERRORS.has(kind)) return;
		const { response, error, ...meta } = detail || {};
		const status = meta.status ? "HTTP " + meta.status : "";
		const message = error || [status, providerErrorMessage(response)].filter(Boolean).join(": ") || kind;
		PERF_PROFILER.error("ai-error", { name: kind, message }, meta);
	}
	function debugClear() { debugLog.length = 0; }
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

	// ---------- Netz für den Kern ----------
	// Metadaten einer Chat-Anfrage fürs Debugprotokoll (ohne Inhalte und Schlüssel).
	function requestMeta(url, body) {
		const path = url.replace(/^https?:\/\/[^/]+/, "").replace(/\?.*$/, "");
		if (!body) return { path };
		try {
			const json = JSON.parse(new TextDecoder().decode(body));
			return {
				path, model: json.model || "—", stream: !!json.stream, messageCount: (json.messages || []).length,
				toolCount: (json.tools || []).length, toolChoice: json.tool_choice || null,
				thinkingExtras: !!json.extra_body || !!json.reasoning_effort, reasoningEffort: json.reasoning_effort || null,
			};
		} catch { return { path, bytes: body.byteLength }; }
	}
	const limitFor = (url) => (/\/models(?:\?|$)/.test(url) ? LIMIT.modelsMs : /\/embeddings(?:\?|$)/.test(url) ? LIMIT.embedMs : LIMIT.requestMs);
	function timeoutError(phase, ms) {
		const error = new Error(`Zeitüberschreitung: Der KI-Server hat ${phase} nicht innerhalb von ${Math.round(ms / 1000)} Sekunden abgeschlossen.`);
		error.name = "AiTimeoutError";
		return error;
	}
	// fetch mit Abbruch (⏹) und Zeitlimit bis zum Antwortkopf; liefert die Response.
	async function fetchTracked({ method, url, headers, body }) {
		const controller = new AbortController(), ms = limitFor(url), meta = requestMeta(url, body), started = performance.now();
		activeControllers.add(controller);
		debugEvent("HTTP-Anfrage", meta);
		let timedOut = false;
		const timer = setTimeout(() => { timedOut = true; controller.abort(); }, ms);
		try {
			const res = await fetch(url, { method, headers: Object.fromEntries(headers), body, signal: controller.signal });
			const info = { ...meta, status: res.status, ms: Math.round(performance.now() - started), requestId: res.headers.get("x-request-id") || res.headers.get("x-goog-request-id") || null };
			debugEvent(res.ok ? "HTTP-Erfolg" : "HTTP-Fehler", info);
			return { res, controller, done: () => { clearTimeout(timer); activeControllers.delete(controller); } };
		} catch (error) {
			clearTimeout(timer);
			activeControllers.delete(controller);
			const err = timedOut ? timeoutError("die Verbindung", ms) : error;
			debugEvent(timedOut ? "KI-Timeout" : error?.name === "AbortError" ? "Abgebrochen" : "Netzwerkfehler", { ...meta, ms: Math.round(performance.now() - started), error: errorText(err) });
			throw err;
		}
	}
	const http = {
		async send(req) {
			const { res, done } = await fetchTracked(req);
			try {
				return { status: res.status, headers: [...res.headers], body: new Uint8Array(await res.arrayBuffer()) };
			} finally { done(); }
		},
		// Stückweise (SSE): read() liefert das nächste Stück oder null; 30 s ohne Daten brechen ab.
		async open(req) {
			const { res, controller, done } = await fetchTracked(req);
			const reader = res.body?.getReader?.();
			let finished = false;
			const finish = () => { if (!finished) { finished = true; done(); } };
			return {
				status: res.status,
				headers: [...res.headers],
				async read() {
					if (!reader) { finish(); return null; }
					let timer = 0;
					try {
						const idle = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(timeoutError("den Datenstrom", LIMIT.streamIdleMs)); }, LIMIT.streamIdleMs); });
						const { value, done: end } = await Promise.race([reader.read(), idle]);
						if (end) { finish(); return null; }
						return value;
					} catch (error) { finish(); throw error; } finally { clearTimeout(timer); }
				},
				cancel() { try { reader?.cancel(); } catch {} controller.abort(); finish(); },
			};
		},
	};
	// Ein Kern-Lauf, der mit ⏹ abgebrochen werden kann.
	async function withRun(task) {
		const run = new CORE.AiRun(http);
		activeRuns.add(run);
		try { return await task(run); } finally { activeRuns.delete(run); run.free(); }
	}

	// ---------- Modelle, Verbindung, Thinking ----------
	async function listModels({ force = false } = {}) {
		const key = JSON.stringify(providers().map((p) => [p.id, p.base, p.key]));
		const cached = modelCache.get(key);
		if (!force && cached && Date.now() - cached.at < LIMIT.modelCacheMs) return cached.list.slice();
		const list = await CORE.aiListModels(http, providers(), syncUrl());
		modelCache.clear();
		modelCache.set(key, { at: Date.now(), list });
		return list.slice();
	}
	async function pingProvider(provider) {
		const started = performance.now();
		const result = await CORE.aiPingProvider(http, provider || {}, providers(), syncUrl());
		const out = { ok: result.ok, ms: Math.round(performance.now() - started) };
		if (result.ok) out.models = result.models;
		if (result.status != null) out.status = result.status;
		if (result.suggestedBase) out.suggestedBase = result.suggestedBase;
		if (result.error) out.error = result.error;
		return out;
	}
	async function ping() {
		const active = providers().find((p) => p.id === S.settings.aiProviderId) || providers()[0];
		if (!active?.base) return false;
		try { return (await CORE.aiPingProvider(http, active, providers(), syncUrl())).ok; } catch { return false; }
	}
	const capStore = () => S.thinkingCapabilities || (S.thinkingCapabilities = Object.create(null));
	async function detectThinkingCapabilities() {
		const c = cfg(), store = capStore(), key = [c.providerId, c.base, c.model].join("::");
		if (store[key]) return store[key];
		const d = CORE.aiThinkingCapabilities(settings());
		const cap = store[key] = { state: "ready", ...d, error: c.model && !d.levels.length ? "Für dieses Modell ist über den aktuellen Chat-Adapter keine steuerbare Thinking-Stufe dokumentiert." : "" };
		debugEvent("Thinking-Fähigkeiten", { provider: c.providerId, model: c.model, state: cap.state, levels: cap.levels, source: cap.source, passive: true });
		return cap;
	}

	// ---------- Embeddings ----------
	// Cloud-Embeddings nacheinander, Vordergrund (Suche) vor Hintergrund (Indexieren).
	const remoteEmbedForeground = [], remoteEmbedBackground = [];
	let processingRemoteEmbeds = false;
	async function runRemoteEmbed({ texts, provider, model }) {
		const started = performance.now();
		try {
			return (await CORE.aiEmbedRemote(http, provider, model, texts)).map((v) => Array.from(v));
		} catch (error) {
			debugEvent(error?.status ? "Embedding-Fehler" : "Embedding-Netzwerkfehler", { provider: provider.id, model, status: error?.status, ms: Math.round(performance.now() - started), error: errorText(error) });
			throw error;
		}
	}
	async function processRemoteEmbedQueue() {
		if (processingRemoteEmbeds) return;
		processingRemoteEmbeds = true;
		try {
			while (remoteEmbedForeground.length || remoteEmbedBackground.length) {
				const job = remoteEmbedForeground.shift() || remoteEmbedBackground.shift();
				try { job.resolve(await runRemoteEmbed(job)); }
				catch (error) { job.reject(error); }
			}
		} finally { processingRemoteEmbeds = false; }
	}
	function embedProvider() {
		const byId = (id) => (id && providers().find((p) => p.id === id)) || null;
		return byId(S.settings.embedProviderId) || byId(S.settings.aiProviderId) || providers()[0] || null;
	}
	async function embed(texts, options = {}) {
		if (!Array.isArray(texts)) throw new TypeError("Embedding-Texte müssen als Array übergeben werden.");
		const model = String(S.settings.embedModel || "");
		if (!model) throw new Error("Kein Embedding-Modell konfiguriert.");
		if (S.settings.embedProviderId === "local" || model.startsWith("local:")) {
			const started = performance.now();
			try {
				return await EMBEDDINGS.embedLocal(texts, { modelId: model, priority: options.priority || "foreground" });
			} catch (err) {
				debugEvent("Lokaler-Embedding-Fehler", { model, error: errorText(err), ms: Math.round(performance.now() - started) });
				throw err;
			}
		}
		const provider = embedProvider();
		if (!provider?.base) throw new Error("Keine Quelle für Embeddings konfiguriert (Einstellungen → KI).");
		return new Promise((resolve, reject) => {
			(options.priority === "background" ? remoteEmbedBackground : remoteEmbedForeground).push({
				texts: texts.slice(), provider: { id: provider.id, name: provider.name || "", base: provider.base, key: provider.key || "" }, model, resolve, reject,
			});
			processRemoteEmbedQueue();
		});
	}

	// ---------- Einfache Anfragen ----------
	async function complete(prompt, system) {
		return withRun((run) => run.complete(baseInput(), String(prompt), system ? String(system) : undefined));
	}
	async function refine(historyMessages, instruction, onDelta, onReasoning) {
		let content = "", reasoning = "";
		return withRun((run) => run.refine(baseInput(), historyMessages, String(instruction), (ev) => {
			if (ev.type === "content") { content = ev.text; onDelta?.(content); } else { reasoning = ev.text; onReasoning?.(reasoning); }
		}));
	}

	// ---------- Agent ----------
	function chatUi(type) {
		const side = type === "side";
		return {
			chat: side ? S.sideChat : S.chat,
			render: () => side ? BUS.emit("ui:render-chat") : BUS.emit("ui:render-main-chat-log"),
			id: () => side ? S.sideChatId : S.currentChatId,
		};
	}
	function takeAttachment(type) {
		if (S.pendingAttachmentTarget !== type) return { image: null, textFile: null, pdfFile: null };
		const data = { image: S.pendingImage, textFile: S.pendingTextFile, pdfFile: S.pendingPdf };
		S.pendingImage = S.pendingTextFile = S.pendingPdf = S.pendingAttachmentTarget = null;
		BUS.emit("ui:render-pending-chip", type);
		return data;
	}
	const fullToolDefs = () => {
		const extra = BUS.call("exp:extra-tool-defs");
		return Array.isArray(extra) ? TOOLS.defs.concat(extra) : TOOLS.defs.slice();
	};
	// Was der Nutzer gerade sieht, für die Arbeitsunterlagen des Kerns.
	async function workspaceOf() {
		const page = currentPage(), view = S.view;
		if (view === "anki") {
			const snapshot = STATE.studySnapshot(S.ankiDeck), counts = snapshot.counts;
			const card = S.ankiTab === "study" ? (S.reviewShowBack && S.cards[S.reviewCardId]) || snapshot.dueNow[0] : null;
			return { kind: "anki", anki: {
				tab: S.ankiTab || "", deck: S.ankiDeck || "", new: counts.neu, learn: counts.learn, review: counts.review,
				card: card ? { front: String(card.front || ""), back: S.reviewShowBack ? String(card.back || "") : null } : null,
			} };
		}
		if (!page) return { kind: "empty" };
		if (S.sideContextOff === page.id) return { kind: "page", title: page.title, context: null };
		const heftId = page.kind === "heft" ? page.id : HEFT?.activeId || null;
		const heft = heftId ? S.pages[heftId] : null;
		if (heft?.kind === "heft") {
			const idx = HEFT?.activeId === heftId ? HEFT.activeIndex || 0 : 0;
			const pg = HEFT?.openDoc?.(heftId)?.pages?.[idx] ?? STATE.heftPage(heftId, idx);
			let imageUrl;
			try { if (typeof HEFT?.pageAsDataUrl === "function") imageUrl = await HEFT.pageAsDataUrl(heftId, idx); } catch {}
			return { kind: "page", title: page.title, context: {
				kind: "heft", title: heft.title, pageIndex: idx, imageUrl,
				texts: (Array.isArray(pg?.texts) ? pg.texts : []).map((t) => String(t?.text || "")).filter(Boolean),
				ocrText: String(pg?.ocrText || ""),
			} };
		}
		return { kind: "page", title: page.title, context: { kind: "text", content: String(page.content || "") } };
	}
	// Automatische Notizsuche, wenn die Nachricht danach aussieht (Regel im Kern).
	async function ragHitsFor(text) {
		try {
			const query = CORE.aiRagQuery(String(text || ""));
			if (!query || !RAG.enabled()) return [];
			return (await RAG.search(query, 4)) || [];
		} catch (error) {
			if (error?.name === "AbortError") throw error;
			debugEvent("Auto-RAG übersprungen", { error: errorText(error).slice(0, 200) });
			return [];
		}
	}
	// Heftseite für view_heft_page: Titel leer = aktuelles Heft; Seite ab 1, leer = aktuelle.
	async function heftPageTool(title, pageNoArg) {
		let pageNo = 0;
		try {
			if (typeof HEFT?.pageAsDataUrl !== "function") throw new Error("Heft-Modul nicht verfügbar.");
			let id;
			if (title) {
				const page = STATE.findPage(title);
				if (!page) throw new Error(`Keine Seite mit Titel „${title}“ gefunden.`);
				if (page.kind !== "heft") throw new Error(`„${page.title}“ ist kein Handschrift-Heft.`);
				id = page.id;
			} else if (HEFT.activeId) id = HEFT.activeId;
			else throw new Error("Es ist gerade kein Heft geöffnet — bitte page_title angeben.");
			const index = pageNoArg ? Math.max(0, Math.floor(pageNoArg) - 1) : HEFT.activeId === id ? HEFT.activeIndex || 0 : 0;
			pageNo = index + 1;
			const pg = HEFT?.openDoc?.(id)?.pages?.[index] ?? STATE.heftPage(id, index);
			return {
				pageNo,
				texts: (Array.isArray(pg?.texts) ? pg.texts : []).map((t) => String(t?.text || "")).filter(Boolean),
				ocrText: String(pg?.ocrText || ""),
				imageUrl: await HEFT.pageAsDataUrl(id, index),
			};
		} catch (error) {
			return { pageNo, error: errorText(error) };
		}
	}
	const profileOutcome = (error) => error?.name === "AbortError" ? { aborted: true } : { failed: true, status: error?.status || 0, errorName: error?.name || "Error", errorMessage: errorText(error).slice(0, 160) };

	async function agent(userText, type, onStep, runContext) {
		type = type || "side";
		const current = cfg(), model = current.model;
		const ui = chatUi(type), target = runContext?.target || ui.chat, runId = runContext?.id || ui.id();
		const render = () => { if (ui.id() === runId) ui.render(); };
		const sessionKey = runId ? `${type}:${runId}` : "";
		const finishRun = PERF_PROFILER.start("ai.agent", { provider: current.providerId, model, anomalyThresholdMs: 45000 }, 0);
		let steps = 0;
		const pendingEdits = [];
		const flushEdits = () => {
			if (!pendingEdits.length) return;
			target.push(...pendingEdits.splice(0));
			render();
		};
		const attachment = takeAttachment(type);
		target.push({ mid: U.uid(), role: "user", content: userText, ...attachment });
		render();
		CHATS.persist(target, type === "side" ? "sideChatId" : "currentChatId", runId);

		let renderQueued = false, lastRender = 0;
		const scheduleRender = () => {
			if (renderQueued) return;
			renderQueued = true;
			setTimeout(() => { renderQueued = false; lastRender = Date.now(); render(); }, Math.max(16, 80 - (Date.now() - lastRender)));
		};
		// Zwischenstände nur lokal (Schutz vor Neuladen); ins Log und damit in den Sync geht der Chat
		// mit final = true (Antwort, Fehler, Rückfrage).
		let persistTimer = 0, lastPersist = 0;
		const persist = (final = false) => {
			clearTimeout(persistTimer);
			persistTimer = 0;
			if (!final && Date.now() - lastPersist < 1500) {
				persistTimer = setTimeout(() => persist(), 1500);
				return;
			}
			lastPersist = Date.now();
			try { CHATS.persist(target, type === "side" ? "sideChatId" : "currentChatId", runId, { localOnly: !final }); } catch (error) { console.warn("Chat speichern:", error); }
		};
		async function waitForAnswer(question, options, status) {
			const mid = U.uid();
			if (type === "side") {
				document.body.classList.remove("panel-collapsed");
				BUS.emit("ui:render-tabs");
			}
			S.aiStatus = status;
			S.aiDraft = "";
			S.aiThinkingDraft = "";
			const answer = await new Promise((resolve) => {
				pendingChoices[mid] = resolve;
				target.push({ mid, role: "question", question, options, answered: false });
				render();
				persist(true);
			});
			const card = target.find((m) => m.mid === mid);
			if (card) { card.answered = true; card.answer = answer === ABORTED ? "Abgebrochen" : answer; }
			if (answer === ABORTED) { render(); return null; }
			S.aiStatus = "…denkt nach…";
			return answer;
		}
		const executor = {
			async run(name, args) {
				let out;
				try { out = await TOOLS.run(name, args); } catch (error) { out = { error: String(error) }; }
				return { json: JSON.stringify(out ?? {}), undo: out?._undo };
			},
			ask: (question, options) => waitForAnswer(question, options, options.length === 2 && /^Ja/.test(options[0]) ? "Warte auf Bestätigung…" : "Warte auf deine Auswahl…"),
			heftPage: heftPageTool,
		};
		const onEvent = (ev) => {
			if (ev.type === "draft") { S.aiDraft = ev.text; scheduleRender(); return; }
			if (ev.type === "thinking") { S.aiThinkingDraft = ev.text; scheduleRender(); return; }
			if (ev.type === "tool") { steps++; onStep?.(ev.name); return; }
			const it = ev.item;
			if (it.kind === "thought") target.push({ mid: U.uid(), role: "thought", reasoning: it.reasoning, reasoningExpanded: false });
			else if (it.kind === "assistant") target.push({ mid: U.uid(), role: "assistant", content: it.content, model: it.model || undefined, reasoning: null, reasoningExpanded: false });
			else if (it.kind === "tool") { target.push({ mid: U.uid(), role: "tool", name: it.name, detail: it.detail, error: !!it.error }); persist(); }
			else if (it.kind === "change") pendingEdits.push({ mid: U.uid(), role: "edit", summary: it.summary, undo: it.undo, undone: false });
			scheduleRender();
		};

		try {
			const finishContext = PERF_PROFILER.start("ai.context", { anomalyThresholdMs: 1500 }, 0);
			const [ragHits, workspace] = await Promise.all([ragHitsFor(userText), workspaceOf()]);
			finishContext({ rag: ragHits.length > 0, image: !!workspace.context?.imageUrl });
			const page = currentPage();
			const session = chatSessions.get(sessionKey) || { summary: null, toolsUnlocked: false };
			const out = await withRun((run) => run.agent({
				...baseInput(), chat: target, workspace, ragHits, activePage: page ? { id: page.id, title: page.title } : null,
				tools: fullToolDefs(), alwaysSendTools: S.settings.alwaysSendTools !== false,
				embedModel: String(S.settings.embedModel || ""), session,
			}, executor, onEvent));
			if (sessionKey) chatSessions.set(sessionKey, out.session);
			if (out.pageContext && page) S.pageCtxInfo = { id: page.id, ...out.pageContext };
			S.aiDraft = ""; S.aiThinkingDraft = "";
			flushEdits();
			persist(true);
			finishRun({ steps });
			return out.text;
		} catch (error) {
			if (error && typeof error === "object") {
				error.reasoning = String(S.aiThinkingDraft || "").trim();
				error.draft = String(S.aiDraft || "").trim();
			}
			S.aiThinkingDraft = "";
			S.aiDraft = "";
			flushEdits();
			persist(true);
			finishRun({ steps, ...profileOutcome(error) });
			throw error;
		}
	}

	function abortActive() {
		for (const run of activeRuns) run.cancel();
		for (const controller of activeControllers) controller.abort();
		activeControllers.clear();
		for (const mid of Object.keys(pendingChoices)) {
			const resolve = pendingChoices[mid];
			delete pendingChoices[mid];
			resolve(ABORTED);
		}
	}
	function resolveChoice(mid, answer) {
		const resolve = pendingChoices[mid];
		if (!resolve) return false;
		delete pendingChoices[mid];
		resolve(answer);
		return true;
	}
	const undoAi = (changeSet) => TOOLS.undo(changeSet);

	// Der lokale Embedding-Worker liegt direkt in embedding.js; ai.js liefert den
	// kombinierten embed()-Einstieg (lokal oder Remote-Provider).
	EMBEDDINGS.setAdapter({ embed });

	return {
		complete, agent, undo: undoAi, abortActive, resolveChoice, refine,
		ping, pingProvider, embed, listModels,
		LOCAL_EMBEDDING_MODELS,
		detectThinkingCapabilities, debugReport, debugClear, MODEL_PRESETS,
	};
})();

BUS.provide("ai:complete", (prompt, sys) => AI.complete(prompt, sys));
