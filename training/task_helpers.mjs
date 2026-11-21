// Prüf-Helfer für Trainings-Aufgaben (rec = aufgezeichnete Runde aus traj_harness.js).
// rec.tools: [{ name, args, error }], rec.changes: [{ op, title, content, deck, cards, props, … }], rec.text: Antwort.

export const parseArgs = (t) => {
	if (!t?.args) return {};
	if (typeof t.args === "object") return t.args;
	try {
		return JSON.parse(t.args);
	} catch {
		return {};
	}
};

export const hasTool = (name) => (rec) => rec.tools.some((t) => t.name === name && !t.error);
export const calledTool = (name) => (rec) => rec.tools.some((t) => t.name === name);
export const hasToolWhere = (name, pred) => (rec) =>
	rec.tools.some((t) => t.name === name && !t.error && pred(parseArgs(t), t));
export const hasChange = (op) => (rec) => rec.changes.some((c) => c?.op === op);
export const hasChangeWhere = (op, pred) => (rec) => rec.changes.some((c) => c?.op === op && pred(c));
export const countCreatedCards = (rec) =>
	rec.changes
		.filter((c) => c?.op === "card.create")
		.reduce((n, c) => n + (Array.isArray(c.cards) ? c.cards.length : 1), 0);
export const noToolErrors = (rec) => rec.tools.every((t) => !t.error);
export const noTools = (rec) => rec.tools.length === 0;
export const noChanges = (rec) => rec.changes.length === 0;
export const nonEmpty = (min = 25) => (rec) => String(rec.text || "").trim().length >= min;
export const maxLen = (max) => (rec) => String(rec.text || "").length <= max;
// Antworttext für Inhaltsprüfungen: LaTeX-Schreibweisen wie Fließtext (3{,}83 → 3,83, \text{pH} → pH,
// \, → Leerzeichen, − → -), damit Prüfungen nicht an der Formatierung scheitern.
export const plain = (s) =>
	String(s || "")
		.replace(/\{,\}/g, ",")
		.replace(/\{\.\}/g, ".")
		.replace(/\\(?:text|mathrm|mathbf|operatorname)\{([^{}]*)\}/g, "$1")
		.replace(/\\[dt]?frac\{([^{}]*)\}\{([^{}]*)\}/g, "$1/$2")
		.replace(/\\[,;:! ]/g, " ")
		.replace(/\\(?:cdot|times)/g, "·")
		.replace(/\^\s*\{?\\circ\}?/g, "°")
		.replace(/\\%/g, "%")
		.replace(/\\pm/g, "±")
		.replace(/\\approx/g, "≈")
		.replace(/\\(lambda|theta|Omega|mu|pi|alpha|beta|omega|Delta|delta|varepsilon|epsilon|sigma|rho|tau|phi)\b/g, (_, g) => GREEK[g])
		.replace(/[−–]/g, "-")
		.replace(/ /g, " ")
		// „22. November“ zusätzlich als „22.11.“, damit Datumsprüfungen beide Schreibweisen finden.
		.replace(/\b(\d{1,2})\.\s*(Januar|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember)\b/gi,
			(m, d, mon) => `${m} (${d}.${String(MONTHS.indexOf(mon.toLowerCase()) + 1).padStart(2, "0")}.)`);
const MONTHS = ["januar", "februar", "märz", "april", "mai", "juni", "juli", "august", "september", "oktober", "november", "dezember"];
const GREEK = { lambda: "λ", theta: "θ", Omega: "Ω", mu: "µ", pi: "π", alpha: "α", beta: "β", omega: "ω", Delta: "Δ", delta: "δ", varepsilon: "ε", epsilon: "ε", sigma: "σ", rho: "ρ", tau: "τ", phi: "φ" };
// Zweite Lesart ohne Endnullen (4,30 mA → 4,3 mA; 8,00 → 8), damit „2,5 V“-Prüfungen auch „2,50 V“ finden.
const noTrailingZeros = (s) => s.replace(/(\d+)([,.])(\d*?)0+(?!\d)/g, (_, a, sep, b) => (b ? a + sep + b : a));
const variants = (text) => { const p = plain(text); return [p, noTrailingZeros(p)]; };
export const matchText = (re) => (rec) => variants(rec.text).some((v) => re.test(v));
export const notText = (re) => (rec) => !variants(rec.text).some((v) => re.test(v));
// Text aller Schreibwünsche zu einer Seite (Titel-Regex), z. B. um Inhalt eines Edits zu prüfen.
export const writtenTo = (titleRe) => (rec) =>
	rec.changes
		.filter((c) => titleRe.test(String(c?.title || "")))
		.map((c) => [c.content, c.text, c.replace, c.append].filter(Boolean).join("\n"))
		.join("\n");
