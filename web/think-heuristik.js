"use strict";

// think-heuristik.js — Denkprozess-Erkennung für Modelle ohne getrenntes
// Reasoning (z.B. Gemma). Aus ai.js herausgelöst (15. Juli 2026): reine
// Funktionen ohne App-Abhängigkeiten, direkt testbar in test/test-core.mjs.
//
// Gemma sendet den Denkblock als <thought> (nicht <think>). Beide Formen
// gehören ausschließlich in die Thinking-Box, nie in die sichtbare Antwort.
export const THINK_TAGS = "think|thinking|thought|reasoning";
// EINE Regel statt zweier konkurrierender Wortlisten: Selbstgespräch redet über den Nutzer oder
// über das eigene Vorgehen — alles andere ist Antwort. WARUM: "Denk-Einleitung" und "Antwort-Start"
// standen als zwei lange Listen gegeneinander; gemeinsame Wörter (okay, gut) machten das Ergebnis
// von der Prüfreihenfolge abhängig, und jeder unbekannte Antwortsatz galt vorsichtshalber als Denken.
const META_RE = /\b(the user|they (want|have|are|might|asked)|der nutzer|die nutzerin|i (should|need|must|will|have to|can|could|think|wonder)\b|i'?(ll|m going)\b|let me|let's|ich (sollte|muss|werde|denke|prüfe|schaue|könnte)|lass mich|wait\b|hmm\b|actually\b|perhaps\b|maybe\b|instead\b|my instructions|laut (meiner|den) anweisungen)\b/i;
// Füllwörter am Satzanfang ("Okay,", "Gut,", "Also,") sagen nichts über Denken vs. Antwort — genau
// sie standen früher in BEIDEN Listen und ließen ganze Antworten in der Denk-Box verschwinden.
const FILLER_RE = /^(okay|ok|gut|also|alright|so|nun|sure|well)[,!.\s]+/i;
const stripNoise = (s) => String(s || "").trim().replace(/^\d+[.)]\s*/, "").replace(/^[-*•]\s*/, "").replace(FILLER_RE, "");
const isMeta = (s) => { const t = stripNoise(s); return !t || META_RE.test(t); };
const isAnswer = (s) => { const t = stripNoise(s); return t.length >= 3 && !META_RE.test(t); };
// Sticky-Heuristik: sieht der ANFANG nach Denkprozess aus, bleibt ALLES
// reasoning, bis ein klarer Antwort-Start erkannt wird. Nur für Modelle ohne
// getrenntes Reasoning (z.B. Gemma).
export function stripLeakedReasoning(text) {
	if (!text) return { content: text, reasoning: "" };

	// Einige OpenAI-kompatible Backends liefern Zeilenumbrüche als literal
	// <br>-Tags. Der bisherige Satz-Split sah dann den gesamten Block als eine
	// Einheit und ließ den Denktext durch. Für die Erkennung werden nur diese
	// Umbrüche normalisiert; die sichtbare Antwort bleibt ansonsten unverändert.
	const source = String(text);
	// WARUM: nur normalisieren, wenn wirklich HTML-Umbrüche drinstehen — sonst ist analysis
	// identisch mit dem Original und der Schnitt unten trifft exakt den echten Text.
	const analysis = /<br\s*\/?>|&nbsp;/i.test(source)
		? source.replace(/<br\s*\/?>/gi, "\n").replace(/&nbsp;/gi, " ")
		: source;
	const parts = analysis.split(/(?<=[.!?])\s+|\n+|(?<=[.!?])(?=[A-ZÄÖÜ])/).filter(Boolean);
	if (!parts.length || !isMeta(parts[0])) return { content: source, reasoning: "" };

	// Fail closed: Beginnt die Antwort eindeutig als internes Selbstgespräch,
	// erscheint davon nie etwas im Chat. Erst ein klarer Antwortbeginn gibt
	// sichtbaren Text frei. Das gilt auch während des Streamings.
	let answerStart = -1;
	for (let i = 1; i < parts.length; i++) {
		if (isAnswer(parts[i])) { answerStart = i; break; }
	}
	if (answerStart === -1) return { content: "", reasoning: analysis.trim() };
	// WARUM: Sätze wurden mit "\n" wieder zusammengeklebt — Leerzeilen, Aufzählungen und
	// Codeblöcke der sichtbaren Antwort gingen dabei verloren. Jetzt nur die Schnittstelle im
	// Originaltext suchen und dort trennen; die Formatierung bleibt unangetastet.
	let cut = 0;
	for (let i = 0; i < answerStart; i++) {
		const at = analysis.indexOf(parts[i], cut);
		if (at >= 0) cut = at + parts[i].length;
	}
	cut = Math.max(cut, analysis.indexOf(parts[answerStart], cut));
	return { content: analysis.slice(cut).trim(), reasoning: analysis.slice(0, cut).trim() };
}
// Tags heraustrennen; ohne Tags optional die Heuristik anwenden.
export function splitThink(raw, skipHeuristic) {
	raw = String(raw || "");
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

export const THINK = { THINK_TAGS, splitThink, stripLeakedReasoning };
