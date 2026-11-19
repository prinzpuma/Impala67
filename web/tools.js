"use strict";
import { S, STATE } from "./state.js";
import { PERF_PROFILER } from "./performance-profiler.js";
import { U } from "./util.js";
import { RAG } from "./rag.js";
import { CHATS } from "./chats.js";
import { OPTIONAL_MODULE_URLS } from "./optional-modules.js";
import { CORE } from "./rust-core.js";
// tools.js — Die Werkzeuge der KI (OpenAI-Function-Calling-Format).
// Ausgeführt werden Lesen (inspect), Ändern (change, atomar mit Rückgängig) und die flachen
// Werkzeuge im Rust-Kern (core/impala-tools) – dieselbe Implementierung wie in den nativen Apps.
// Hier bleibt nur, was der Browser liefert: Bedeutungssuche (RAG), Rechnen (math.js), Rückfragen,
// die Lage der Oberfläche (geöffnete Seite, Lernkarte) und die lokalen Chats.
export const TOOLS = (() => {
	// ask_choice: Argumente säubern/validieren (leere/doppelte Optionen raus, 2–5 Optionen, Frage Pflicht).
	const normalizeAskChoice = (a) => CORE.aiNormalizeAskChoice(a || {});

	// Definitionen im Rust-Kern (core/impala-ai/src/tool_defs.json bzw. tool_defs_flat.json).
	const defs = CORE.aiToolDefs();
	const flatDefs = CORE.aiFlatToolDefs();

	// Gerade gelernte Karte (Lern-Ansicht, render-anki.js): nach dem Aufdecken die festgepinnte
	// (S.reviewCardId), sonst die vorderste der aktuellen Queue.
	function currentCard() {
		try {
			if (S.view !== "anki" || (S.ankiTab || "decks") !== "study") return null;
			const c = (S.reviewShowBack && S.cards[S.reviewCardId]) || STATE.studySnapshot(S.ankiDeck).dueNow[0] || null;
			if (!c) return null;
			return {
				front: c.front, back: c.back, deck: c.deck || "Standard", state: c.srs.state,
				reps: c.srs.reps || 0, lapses: c.srs.lapses || 0, revealed: !!S.reviewShowBack,
				note: S.reviewShowBack
					? "Die Rückseite ist bereits aufgedeckt."
					: "Die Rückseite ist noch NICHT aufgedeckt — die Antwort nicht verraten, außer der Nutzer bittet ausdrücklich darum.",
			};
		} catch { return null; }
	}
	// Umgebung des Aufrufs für den Kern; Chats nur, wenn danach gesucht wird (sie liegen lokal).
	function context(wantsChats) {
		const now = Date.now();
		return {
			activePage: S.currentPageId || null,
			workspace: S.currentWorkspaceId || null,
			nowMs: now,
			utcOffset: -new Date(now).getTimezoneOffset(),
			currentCard: currentCard(),
			...(wantsChats ? { chats: CHATS.load() } : {}),
		};
	}
	const wantsChats = (name, a) => name === "search_chats" || (name === "inspect" && a?.kind === "chats");

	// Kern-Werkzeug ausführen; seine Events speichert und meldet STATE wie jedes dispatch.
	// null = kein Kern-Werkzeug.
	async function core(name, a) {
		const ctx = JSON.stringify(context(wantsChats(name, a)));
		const out = await STATE.commitCoreEvents((M, stamp) => M.aiTool(name, JSON.stringify(a || {}), ctx, stamp));
		if (out.result == null) return null;
		return out.undo ? attachUndo(out.result, out.undo) : out.result;
	}
	function attachUndo(result, undo) {
		Object.defineProperty(result, "_undo", { value: undo, enumerable: false });
		return result;
	}

	// Änderungs-Satz einer KI-Aktion zurücknehmen (Kern: impala-tools/undo.rs).
	async function undo(changeSet) {
		if (!changeSet) throw new Error("Undo-Daten fehlen.");
		const out = await STATE.commitCoreEvents((M, stamp) => M.aiUndo(JSON.stringify(changeSet), stamp));
		if (out.error) throw new Error(out.error);
		return { ok: true };
	}

	// Bedeutungssuche (RAG im Browser); ohne Embedding-Modell die Stichwortsuche des Kerns.
	async function semantic(query) {
		const hits = await RAG.search(query);
		if (hits !== null) return { results: hits };
		const keyword = await core("inspect", { kind: "search", query });
		return { info: "Kein Embedding-Modell konfiguriert — Stichwortsuche verwendet.", ...keyword };
	}

	function splitTopLevelArgs(source) {
		const args = []; let start = 0, depth = 0, quote = "", escaped = false;
		for (let i = 0; i < source.length; i++) {
			const ch = source[i];
			if (quote) {
				if (escaped) escaped = false;
				else if (ch === "\\") escaped = true;
				else if (ch === quote) quote = "";
			} else if (ch === "\"" || ch === "'") quote = ch;
			else if (ch === "(" || ch === "[" || ch === "{") depth++;
			else if (ch === ")" || ch === "]" || ch === "}") depth--;
			else if (ch === "," && depth === 0) { args.push(source.slice(start, i).trim()); start = i + 1; }
		}
		args.push(source.slice(start).trim());
		return args;
	}
	async function calculate(a) {
		if (typeof window.math === "undefined" || typeof window.math.evaluate !== "function") {
			try {
				await PERF_PROFILER.run("math.load", () => U.loadScript(OPTIONAL_MODULE_URLS.math, "math"), {}, 0);
			} catch {
				return { error: "Mathe-Modul (math.js) konnte nicht geladen werden. Internetverbindung für den Erstabruf erforderlich." };
			}
		}
		if (typeof window.math === "undefined" || typeof window.math.evaluate !== "function") return { error: "Mathe-Modul (math.js) nicht geladen — evtl. noch offline/kein Netz beim ersten Start." };
		const expr = String(a.expression || "").trim();
		if (!expr) return { error: "calculate: expression fehlt." };
		try {
			// Sonderform integrate("f(x)", "x", a, b) — math.js kann das nicht nativ,
			// daher hier per Simpson-Regel selbst numerisch lösen.
			const intBody = expr.match(/^integrate\(([\s\S]*)\)$/);
			const intArgs = intBody ? splitTopLevelArgs(intBody[1]) : [];
			if (intArgs.length === 4 && /^(['"])[\s\S]*\1$/.test(intArgs[0]) && /^(['"])[\s\S]*\1$/.test(intArgs[1])) {
				const fnExpr = intArgs[0].slice(1, -1), varName = intArgs[1].slice(1, -1), loStr = intArgs[2], hiStr = intArgs[3];
				const lo = Number(window.math.evaluate(loStr));
				const hi = Number(window.math.evaluate(hiStr));
				if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { error: "integrate: Grenzen konnten nicht ausgewertet werden." };
				const compiled = window.math.compile(fnExpr);
				const N = 500; // gerade Anzahl für Simpson-Regel
				const h = (hi - lo) / N;
				let sum = compiled.evaluate({ [varName]: lo }) + compiled.evaluate({ [varName]: hi });
				for (let i = 1; i < N; i++) sum += compiled.evaluate({ [varName]: lo + i * h }) * (i % 2 === 0 ? 2 : 4);
				const value = (h / 3) * sum;
				return { ok: true, expression: expr, result: window.math.format(value, { precision: 10 }), note: "Numerisch berechnet (Simpson-Regel) — kein symbolisches Ergebnis." };
			}
			const result = window.math.evaluate(expr);
			return { ok: true, expression: expr, result: window.math.format(result, { precision: 12 }) };
		} catch (e) {
			return { error: "Rechenfehler: " + String((e && e.message) || e) };
		}
	}

	async function run(name, a) {
		a = a || {};
		if (name === "calculate") return calculate(a);
		if (name === "ask_choice") {
			// Die echte UI/Pause lebt im Agent-Loop (ai.js). run() validiert nur und
			// macht klar, dass ein direkter Aufruf nicht die interaktive Karte öffnet.
			const norm = normalizeAskChoice(a);
			if (norm.error) return norm;
			return { error: "ask_choice muss interaktiv im Chat beantwortet werden (Agent-Loop).", question: norm.question, options: norm.options };
		}
		if ((name === "inspect" && a.kind === "search" && a.semantic) || (name === "search" && a.semantic)) return semantic(String(a.query || ""));
		return (await core(name, a)) ?? { error: "Unbekanntes Tool: " + name };
	}

	// Flache Werkzeuge (search, read_pages, edit_page …) für Aufrufer ohne Rust-Agent (MCP-Bridge);
	// dry_run: true prüft Schreibwünsche nur und liefert die übersetzten Operationen als ops mit.
	const runFlat = run;

	return { defs, flatDefs, run, runFlat, undo, normalizeAskChoice };
})();
