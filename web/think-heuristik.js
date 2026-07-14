"use strict";

// think-heuristik.js — Denkprozess-Erkennung für Modelle ohne getrenntes
// Reasoning (z.B. Gemma). Aus ai.js herausgelöst (15. Juli 2026): reine
// Funktionen ohne App-Abhängigkeiten, direkt testbar in test/test-core.mjs.
//
// Gemma sendet den Denkblock als <thought> (nicht <think>). Beide Formen
// gehören ausschließlich in die Thinking-Box, nie in die sichtbare Antwort.
export const THINK_TAGS = "think|thinking|thought|reasoning";
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
export function stripLeakedReasoning(text) {
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
export function splitThink(raw, skipHeuristic) {
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