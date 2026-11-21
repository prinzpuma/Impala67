// Benchmark-Antworten (tools/ai-bench/scenarios.mjs), die nicht in Trainingsdaten stehen dürfen.
// Eine Trajektorie fliegt raus, wenn eine Assistenten-Nachricht eine dieser Lösungen enthält.
export const LEAKS = [
	["DGL-Blatt-04-Frist", /blatt\s*0?4[^\n]{0,120}18\.\s*(11|nov)|18\.\s*(11|nov)[^\n]{0,120}blatt\s*0?4/i],
	["Lab-1-Abgabe 22.11.", /(lab\s*1|protokoll)[^\n]{0,120}22\.\s*(11|nov)|22\.\s*(11|nov)[^\n]{0,120}(lab\s*1|protokoll)/i],
	["Report-Termine", /0?6\.\s*12\.[^\n]{0,80}20\.\s*12\.|31\.\s*0?1\.[^\n]{0,80}14\.\s*0?2\./],
	["DGL-Klausur 01.03.2027", /0?1\.\s*(0?3\.|märz)\s*(20)?27/i],
	["FKP-Übungsgruppe", /gruppe\s*2[^\n]{0,120}(01\s*016|101)|(01\s*016)[^\n]{0,80}gruppe/i],
	["Klausur/Lernpartner (Gedächtnis)", /\bmalte\b|hs\s*1015/i],
	["BJT-Skript Analysebeispiel", /3[,.]44\d?\s*V|8[,.]8\d?\s*(µ|u)A|1[,.]33\s*mA[^\n]{0,60}8[,.]3\d?\s*V/i],
	["Heft Aufbau-Übungsblatt", /aufbau-übungsblatt/i],
	["KM V04 Lager-Eintrag", /V04\.pdf/i],
];

export function leaksIn(messages) {
	const text = messages.filter((m) => m.role === "assistant").map((m) => `${m.content || ""}\n${m.reasoning_content || ""}`).join("\n");
	return LEAKS.filter(([, re]) => re.test(text)).map(([name]) => name);
}
