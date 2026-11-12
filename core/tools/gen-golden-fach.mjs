// Golden-Files für impala-fach aus dem echten web/fach.js (FACH.page/deck/card/clean, resolveSubject).
// state.js, db.js und embedding.js werden durch Attrappen ersetzt: Seiten kommen aus globalThis,
// Embeddings liefern nichts (die Embedding-Einordnung ist nicht Teil des Kerns).
// Aufruf: node core/tools/gen-golden-fach.mjs
import fs from "node:fs";
import path from "node:path";
import { register } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, "../impala-fach/tests/golden/fach.json");

const hooks = `
export async function resolve(spec, ctx, next) {
	const m = /(?:^|\\/)(db|state|embedding)\\.js$/.exec(spec);
	if (m && ctx.parentURL && ctx.parentURL.includes("/web/")) {
		const src = m[1] === "db" ? "export const DB = { isOpen: () => false, getMeta: async () => null, setMeta: async () => {} };"
			: m[1] === "embedding" ? "export const EMBEDDINGS = { embed: async () => null, ready: () => false };"
			: "export const S = globalThis.__mockS; export const STATE = globalThis.__mockSTATE;";
		return { url: "data:text/javascript," + encodeURIComponent(src), shortCircuit: true };
	}
	return next(spec, ctx);
}`;
register("data:text/javascript," + encodeURIComponent(hooks));

globalThis.__mockS = { settings: {}, pages: {}, workspaces: {} };
globalThis.__mockSTATE = {
	childPagesOf: (id) => Object.values(globalThis.__mockS.pages).filter((p) => (p.parentId || "") === (id || "")),
};
globalThis.setTimeout = () => 0; // Hintergrund-Embedding nie starten

const { FACH, resolveSubject, KNOWN_SUBJECTS } = await import("../../web/fach.js");
const defs = JSON.parse(fs.readFileSync(path.join(here, "../impala-fach/src/subjects.json"), "utf8"));

// ---- Texte: Namen, Aliase, Fachbegriffe, Mehrdeutiges, Randfälle ----
const texts = [
	"", "   ", "Mathe", "mathe", "MATHE", "Mathe 2", "Analysis I", "Info", "ET", "et", "Informatik 1",
	"Funktionen", "Lineare Algebra und Analysis", "Physik × Mathe", "ET × Mathe × Physik", "Infos",
	"Eine Art Bild", "Kunst und Art", "Art", "Genetik und Evolution", "Python Programmierung",
	"Weimarer Republik", "Zelle", "Bio-Klausur", "mathe,mathe", "c++ Grundlagen", "Englisch-Vokabeln",
	"Französisch: Grammaire", "Español", "Latein ACI", "Kirchhoff und Maschenstrom", "Biegemoment am Balken",
	"Sozialkunde Grundgesetz", "Semester 3", "Übersicht", "Stundenplan WS", "Physik\u0000Test", "Physik Test",
	" Chemie ", "İnformatik", "ẞ", "Mathe".repeat(30), "x".repeat(79) + "Mathe",
	"Thermodynamik und Optik", "Stochastik Stochastik Genetik", "Algebra Genetik",
];
for (const d of defs) {
	texts.push(d.name, d.name.toUpperCase(), ...d.aliases.slice(0, 3), ...d.keywords.slice(0, 4));
	texts.push(d.keywords.slice(0, 2).join(" und "), `${d.aliases[0]} ${defs[(defs.indexOf(d) + 1) % defs.length].keywords[0]}`);
}
const resolve = texts.map((t) => [t, resolveSubject(t) || null]);

const cleanIn = ["", "Mathe", "Übersicht", "uebersicht", "Sonstiges", "allgemein", "Allgemein", "Quatsch", "  physik ", "Info"];
const clean = cleanIn.map((v) => [v, FACH.clean(v)]);

const decksIn = ["", "Standard", "Mathematik::Analysis", "Uni::Mathe", "Vokabeln::Latein", "Biologie", "Genetik",
	"A::B", "  ::Physik", "Info::Netze", "Englisch Vocab"];
const decks = decksIn.map((d) => [d, FACH.deck(d)]);

// ---- Seitenbaum mit allen Wegen (Fachfeld, Tag, Vererbung, Titel, Wurzel, Sammelseite, Abstimmung, Text, Workspace) ----
let n = 0;
const page = (id, o = {}) => ({ id, title: "", content: "", updated: `2026-01-01T00:00:${String(n++).padStart(2, "0")}Z`, workspaceId: "default", ...o });
const pages = [
	page("ws-root", { title: "Notizen", workspaceId: "w2" }),
	page("manual", { title: "Irgendwas", subject: "Physik" }),
	page("manual-child", { title: "Funktionen", parentId: "manual" }),
	page("manual-grandchild", { title: "Genetik", parentId: "manual-child" }),
	page("tag", { title: "Kapitel", tags: ["fach: Chemie"] }),
	page("tag2", { title: "Kapitel", tags: ["wichtig", "Biologie"] }),
	page("tag3", { title: "Kapitel", tags: ["Subject :  "] }),
	page("tag-num", { title: "Kapitel", tags: [5, "fachbereich: Musik"] }),
	page("overview-field", { title: "Alles", subject: "Übersicht" }),
	page("overview-child", { title: "Genetik", parentId: "overview-field" }),
	page("overview-child2", { title: "Notiz", parentId: "overview-field" }),
	page("root", { title: "Informatik 1" }),
	page("root-child", { title: "Funktionen", parentId: "root" }),
	page("sem", { title: "Semester 3" }),
	page("sem-a", { title: "Mathe", parentId: "sem" }),
	page("sem-b", { title: "Physik", parentId: "sem" }),
	page("sem-c", { title: "Chemie", parentId: "sem" }),
	page("vote", { title: "Ordner" }),
	page("vote-a", { title: "Genetik", parentId: "vote" }),
	page("vote-b", { title: "Zelle", parentId: "vote" }),
	page("vote-c", { title: "Notiz", parentId: "vote", content: "Fotosynthese und Stoffwechsel der Zelle, Genetik und Evolution" }),
	page("vote-d", { title: "Gelöscht", parentId: "vote", trashed: true, subject: "Mathe" }),
	page("mixed", { title: "Ordner" }),
	page("mixed-a", { title: "Genetik", parentId: "mixed" }),
	page("mixed-b", { title: "Algebra", parentId: "mixed" }),
	page("mixed-c", { title: "Stochastik", parentId: "mixed" }),
	page("text", { title: "Notiz", content: "Heute: Ableitung, Integral und Kurvendiskussion. Dann Nullstellen der Funktion." }),
	page("text-weak", { title: "Notiz", content: "Eine Ableitung." }),
	page("text-long", { title: "Notiz", content: "x ".repeat(1600) + "Genetik Genetik Genetik Genetik" }),
	page("ws", { title: "Notiz", workspaceId: "w-mathe" }),
	page("nothing", { title: "Notiz" }),
	page("cycle-a", { title: "A", parentId: "cycle-b" }),
	page("cycle-b", { title: "B", parentId: "cycle-a" }),
	page("orphan", { title: "Notiz", parentId: "fehlt" }),
	page("several", { title: "ET × Mathe × Physik" }),
	page("explicit-unknown", { title: "Genetik", subject: "Quatsch" }),
	page("explicit-sonst", { title: "Genetik", subject: "Sonstiges" }),
	page("intrinsic", { title: "Ordner" }),
	page("intrinsic-a", { title: "x", parentId: "intrinsic", subject: "Sonstiges" }),
	page("intrinsic-b", { title: "Genetik", parentId: "intrinsic" }),
	page("intrinsic-c", { title: "Zelle", parentId: "intrinsic" }),
];
const workspaces = { default: { id: "default", name: "Allgemein" }, w2: { id: "w2", name: "Uni" }, "w-mathe": { id: "w-mathe", name: "Mathe" } };
globalThis.__mockS.pages = Object.fromEntries(pages.map((p) => [p.id, p]));
globalThis.__mockS.workspaces = workspaces;
const results = Object.fromEntries(pages.map((p) => [p.id, FACH.page(globalThis.__mockS.pages[p.id])]));

const cardsIn = [
	{ deck: "Mathematik::Analysis", pageId: "sem-b" },
	{ deck: "Standard", pageId: "sem-b" },
	{ deck: "Standard", pageId: "nothing" },
	{ deck: "Standard", pageId: "fehlt" },
	{ deck: "Standard" },
];
const cards = cardsIn.map((c) => [c, FACH.card(c)]);

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ known: KNOWN_SUBJECTS, resolve, clean, decks, pages, workspaces, results, cards }, null, 1) + "\n");
console.log("geschrieben:", path.relative(process.cwd(), out), resolve.length, "Texte,", pages.length, "Seiten");
