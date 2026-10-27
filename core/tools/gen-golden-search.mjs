// Schreibt die Golden-Files für `cargo test -p impala-search` (core/impala-search/tests/golden/*.json)
// aus den echten JS-Modulen: fold/typoDistance/Fuzzy-Index (search-fuzzy.js), searchNotes (state.js),
// Chunking samt Textaufbau und Vektor-Wiederverwendung (rag.js mit nachgebildetem DB/Embedder),
// rankRag (rag-ranking.js) und verwandte Seiten (rag.js) mit festen Zufallsvektoren.
// Neu erzeugen nur, wenn sich das JS-Verhalten bewusst ändert: node core/tools/gen-golden-search.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
for (const k of ["window", "document", "navigator", "localStorage", "sessionStorage", "Element", "HTMLElement", "Node", "CustomEvent"]) {
	if (!(k in globalThis)) globalThis[k] = dom.window[k];
}
const { S, STATE } = await import("../../web/state.js");
const { DB } = await import("../../web/db.js");
const { RAG } = await import("../../web/rag.js");
const { EMBEDDINGS, vectorModelKey, isValidVector } = await import("../../web/embedding.js");
const { rankRag, norm } = await import("../../web/rag-ranking.js");
const { fold, typoDistance, createFuzzyIndex } = await import("../../web/search-fuzzy.js");

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../impala-search/tests/golden");
fs.mkdirSync(dir, { recursive: true });
const write = (name, data) => fs.writeFileSync(path.join(dir, name), JSON.stringify(data, null, 1) + "\n");

// Fester Zufall (mulberry32).
function rng(seed) {
	return () => {
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
const WORDS = ("Photosynthese Pflanze Licht Wasser Zelle Zellatmung Energie Glukose Chlorophyll Mitochondrien Enzym Protein " +
	"Integral Ableitung Matrix Vektor Eigenwert Grenzwert Funktion Gleichung Theorem Beweis Physik Kraft Masse " +
	"Beschleunigung Spannung Strom Widerstand Kondensator Größe Übung Prüfung Klausur Straße Phänomen Thermodynamik " +
	"und der die das mit von für ist the and Café naïve 😀Emoji").split(" ");
const sentence = (r, n) => Array.from({ length: n }, () => WORDS[Math.floor(r() * WORDS.length)]).join(" ");
// Abweichung (bewusst): Schneidet JS mitten in ein Ersatzpaar, entsteht ein einzelnes Surrogat;
// Rust lässt das halbe Zeichen weg. Golden-Texte daher ohne einzelne Surrogate.
const wellFormed = (s) => s.replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, "");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------- fold / typoDistance ----------
const foldCases = ["Größe", "PHOTOSYNTHESE", "Thema", "Café naïve", "äb", "Straße", "İstanbul", "ÄÖÜ", "Ελληνικά ΣΟΦΟΣ", "", "123 phth"];
const distCases = [
	["fotosintese", "fotosyntese", 2], ["ab", "ba", 1], ["abc", "xyz", 1], ["", "abc", 3], ["kitten", "sitting", 3],
	["integral", "intergal", 2], ["matrix", "matrizen", 1], ["fotosint", "fotosintese", 2, 8], ["abcd", "abdc", 1],
	["😀a", "a😀", 2], ["gleichung", "gleichungen", 2], ["ca", "abc", 2],
];
write("fold.json", {
	fold: foldCases.map((s) => ({ input: s, output: fold(s) })),
	distance: distCases.map(([a, b, max, bLen]) => ({ a, b, max, b_len: bLen ?? b.length, output: typoDistance(a, b, max, bLen ?? b.length) })),
});

// ---------- Fuzzy-Index ----------
{
	const r = rng(7);
	const ops = [];
	const ix = createFuzzyIndex();
	const ids = Array.from({ length: 14 }, (_, i) => "p" + i);
	for (const id of ids) ops.push({ op: "set", id, text: sentence(r, 8 + Math.floor(r() * 20)) });
	ops.push({ op: "set", id: "p3", text: "Photosynthese Fotosynthese Größe Groesse" });
	ops.push({ op: "set", id: "p5", text: "" });
	ops.push({ op: "set", id: "p1", text: sentence(r, 10) });
	const queries = ["fotosintese", "photosynthese zelle", "groesse", "intergal", "matrx", "beschleunig", "thermo", "ab", "eigenwert funktion", "zz", "kondensatr strom", "fotosint", "istanbul", "cafe"];
	for (const q of queries) ops.push({ op: "search", query: q, allow: null });
	ops.push({ op: "search", query: "energie", allow: ["p0", "p2", "p4", "p6"] });
	for (const op of ops) {
		if (op.op === "set") ix.setPage(op.id, op.text);
		else op.result = ix.search(op.query, op.allow ? (id) => op.allow.includes(id) : () => true);
	}
	write("fuzzy.json", ops);
}

// ---------- searchNotes ----------
{
	const r = rng(11);
	const pages = {};
	const t = (i) => `2026-05-${String(1 + (i % 28)).padStart(2, "0")}T10:00:00.000Z`;
	for (let i = 0; i < 40; i++) {
		const id = "n" + i;
		const paras = Array.from({ length: 1 + Math.floor(r() * 4) }, () => sentence(r, 5 + Math.floor(r() * 30)));
		pages[id] = { id, title: sentence(r, 1 + Math.floor(r() * 3)), content: paras.join("\n\n"), updated: t(i), parentId: null };
	}
	pages.n3.archived = true;
	pages.n4.parentId = "n3"; // unter archivierter Seite
	pages.n5.trashed = true;
	pages.n6.title = "Licht";
	pages.n7.content = "Photosynthese braucht Licht. Licht! Licht? photosynthese.";
	pages.n8.content = "İİİ Licht nach türkischem I";
	S.pages = pages;
	S.heftMeta = { n9: { ocrText: "handschriftlich Photosynthese erkannt" } };
	STATE.searchNotes("qqqzzzxxx", { includeArchived: true }); // Wortindex in Seitenreihenfolge aufbauen
	const queries = ["licht", "Photosynthese", "fotosintese", "Größe", "integral", "matrix vektor", "a", "handschriftlich", "zellatmng", "  ", "the", "thermodynamik", "glukose energie", "i̇"];
	const cases = [];
	for (const q of queries) for (const includeArchived of [false, true]) {
		const hits = STATE.searchNotes(q, { includeArchived });
		cases.push({ query: q, include_archived: includeArchived, hits: hits.map((h) => ({ id: h.page.id, score: h.score, terms: h.terms ?? null, snippet: wellFormed(h.snippet) })) });
	}
	const docs = Object.values(pages).filter((pg) => !pg.trashed).map((pg) => ({
		id: pg.id, title: pg.title, content: pg.content, updated: pg.updated, archived: !!pg.archived,
		in_archive: STATE.isPageArchived(pg), ocr: S.heftMeta[pg.id]?.ocrText || "",
	}));
	write("notes.json", { docs, cases });
}

// ---------- Chunking + Index-Pflege (rag.js) ----------
{
	const r = rng(23);
	const DIM = 8;
	const fakeVec = (text) => {
		let h = 2166136261;
		for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
		const rr = rng(h);
		return Array.from({ length: DIM }, () => rr() - 0.5);
	};
	let embedded = [];
	EMBEDDINGS.setAdapter({ embed: async (texts) => { embedded.push(...texts); return texts.map(fakeVec); } });
	S.settings.embedModel = "local:bekko-a8m";
	S.settings.embedProviderId = "local";
	const store = new Map(), blobs = new Map();
	DB.getVec = async (id) => store.get(id);
	DB.putVec = async (id, rec) => { store.set(id, rec); };
	DB.delVec = async (id) => { store.delete(id); };
	DB.allVecs = async () => Object.fromEntries(store);
	DB.getBlob = async (key) => blobs.get(key) || null;
	DB.putBlob = async () => { throw new Error("keine Extraktion im Golden-Lauf"); };
	const enc = (s) => new TextEncoder().encode(s).buffer;
	const longText = (n) => Array.from({ length: n }, (_, i) => (i % 5 === 0 ? "## Abschnitt " + i + "\n\n" : "") + sentence(r, 10 + Math.floor(r() * 120))).join("\n\n");
	const pdfText = sentence(r, 9000) + " ENDE";
	blobs.set("pdftext:pdf1", { buf: enc(pdfText) });
	blobs.set("pdftext:f1", { buf: enc("Eingebettet eins " + sentence(r, 7000)) });
	blobs.set("pdftext:f2", { buf: enc("Eingebettet zwei " + sentence(r, 40)) });
	blobs.set("f3", { meta: { type: "image/png", name: "bild.png" }, buf: enc("x") }); // kein PDF, kein Text
	const pages = {
		c0: { title: "Leer", content: "" },
		c1: { title: "Kurz", content: "Ein Satz." },
		c2: { title: "Lang", content: longText(30) },
		c3: { title: "Überschriften", content: "# Eins\n\nText\n\n## Zwei\n\n\n\nMehr Text\n\n#### Keine Überschrift\n\n#ohne Leerzeichen\n\n### Drei" },
		c4: { title: "PDF", content: "Siehe PDF", pdfId: "pdf1" },
		c5: { title: "Eingebettet", content: "Vorher\n\n:::file f1\n\n:::file f3\n\n:::file pdf9\n\nNachher :::file  f2" },
		c6: { title: "Heft", content: "" },
		c7: { title: "Heft-Meta", content: "Notiz" },
		c8: { title: "Riesenabsatz", content: sentence(r, 400) },
		c9: { title: "Emoji 😀", content: Array.from({ length: 12 }, () => "😀".repeat(37) + " " + sentence(r, 15)).join("\n\n") },
		c10: { title: "Viele", content: Array.from({ length: 120 }, (_, i) => "# T" + i + "\n\nx").join("\n\n") },
		c11: { title: "Doppelt", content: ":::file f2\n\n:::file f2", js_dupe: true },
		c12: { title: "Leerraum", content: "\n\n   \n\n\t\n\n" },
	};
	S.heftDocs = { c6: { pages: [{ texts: [{ text: "  Getippt  " }, { text: "" }, { text: 42 }], ocrText: " Erkannt " }, { texts: [], ocrText: "" }, { texts: [{ text: "Seite drei" }] }] } };
	S.heftMeta = { c7: { ocrText: "  Meta-Handschrift  " }, c6: { ocrText: "ignoriert, weil Dokument geladen" } };
	S.pages = Object.fromEntries(Object.entries(pages).map(([id, p]) => [id, { id, updated: "2026-01-01T00:00:00.000Z", ...p }]));
	const runRound = async () => {
		embedded = [];
		RAG.reindexStale();
		await RAG.reindexStale();
		await sleep(2700);
		// Durchlauf abwarten: Warteschlange ist leer, wenn sich nichts mehr ändert.
		for (let n = embedded.length, i = 0; i < 50; i++) { await sleep(30); if (embedded.length === n) break; n = embedded.length; }
	};
	await runRound();
	const first = Object.fromEntries([...store].map(([id, rec]) => [id, structuredClone(rec)]));
	const firstEmbedded = embedded.slice();
	// Runde 2: einzelne Absätze ändern; unveränderte Chunks behalten ihren Vektor.
	const edit = (id, fn) => { S.pages[id] = { ...S.pages[id], content: fn(S.pages[id].content), updated: "2026-01-02T00:00:00.000Z" }; };
	edit("c2", (c) => c.replace(/## Abschnitt 10[\s\S]*?\n\n/, "## Abschnitt 10 geändert\n\n"));
	edit("c3", (c) => c + "\n\nNeu");
	edit("c1", () => "");
	await runRound();
	const secondEmbedded = embedded.slice();
	const blobTexts = Object.fromEntries([...blobs].filter(([k]) => k.startsWith("pdftext:")).map(([k, v]) => [k.slice(8), new TextDecoder().decode(v.buf)]));
	const blobMeta = { f3: { type: "image/png", name: "bild.png" } };
	const vecJson = (rec) => rec && { ...rec, chunks: rec.chunks.map((c) => ({ text: wellFormed(c.text), vec: Array.from(c.vec), norm: c.norm })) };
	write("chunks.json", {
		pdf_texts: blobTexts,
		blob_meta: blobMeta,
		heft_docs: S.heftDocs,
		heft_meta: S.heftMeta,
		round1: { pages: Object.fromEntries(Object.entries(pages).map(([id, p]) => [id, { ...p, chunks: first[id]?.chunks.map((c) => wellFormed(c.text)) ?? [] }])), embedded: firstEmbedded.length },
		round2: Object.fromEntries(["c1", "c2", "c3"].map((id) => [id, {
			content: S.pages[id].content,
			previous: vecJson(first[id]),
			chunks: store.get(id)?.chunks.map((c) => wellFormed(c.text)) ?? [],
			embedded: (store.get(id)?.chunks || []).map((c, i) => (secondEmbedded.includes(c.text) && !(first[id]?.chunks || []).some((p) => p.text === c.text) ? i : -1)).filter((i) => i >= 0),
		}])),
		round2_embedded_total: secondEmbedded.length,
		model_keys: ["local:bekko-a8m", "text-embedding-3-small", "", "local:other"].map((m) => [m, vectorModelKey(m)]),
		valid: [[[1, 2]], [[]], [[1, NaN]], [[Infinity]], [[0]]].map(([v]) => [v.map((x) => (Number.isFinite(x) ? x : String(x))), isValidVector(v)]),
	});
}

// ---------- rankRag + related ----------
{
	const r = rng(99);
	const DIM = 16;
	const gauss = () => (r() + r() + r() + r() - 2);
	const topics = Array.from({ length: 4 }, () => Float32Array.from({ length: DIM }, gauss));
	const near = (topic, spread) => Float32Array.from(topic, (x) => x + spread * gauss());
	const model = vectorModelKey("local:bekko-a8m"), providerId = "local";
	const vecs = {}, pages = {};
	for (let p = 0; p < 14; p++) {
		const id = "r" + p, topic = topics[p % 4];
		pages[id] = { title: sentence(r, 1 + (p % 3)), trashed: p === 5, archived: p === 6 };
		const chunks = Array.from({ length: 1 + (p % 4) }, () => {
			const vec = near(topic, 0.6);
			return { text: sentence(r, 8 + Math.floor(r() * 40)), vec, norm: norm(vec) };
		});
		vecs[id] = { updated: "t", model, providerId, chunks };
	}
	pages.r7.title = "Photosynthese";
	vecs.r8.chunks[0].text = "Die Photosynthese braucht Licht und Wasser. " + vecs.r8.chunks[0].text;
	vecs.r9.chunks.push({ text: "anders dimensioniert", vec: Float32Array.from({ length: DIM + 1 }, gauss) }); // ohne norm
	vecs.r10 = { ...vecs.r10, model: "fremd" };
	vecs.r11 = { ...vecs.r11, providerId: undefined }; // fehlende Quelle zählt als leer
	vecs.r12 = { ...vecs.r12, providerId: "remote" };
	vecs.ohneSeite = { updated: "t", model, providerId, chunks: [{ text: "Waise", vec: near(topics[0], 0.1), norm: 1 }] };
	vecs["graph-card:k1"] = { kind: "knowledge-card", model, provider: providerId, hash: "abc", vec: near(topics[1], 0.1) };
	vecs.r13.chunks[0].norm = 0; // gespeicherter Betrag 0 → neu berechnen
	const queries = [
		["photosynthese", near(topics[0], 0.3)], ["Photosynthese", near(topics[1], 0.3)], ["licht wasser", near(topics[2], 0.3)],
		["ab", near(topics[3], 0.3)], ["und", near(topics[0], 1.5)], ["", near(topics[2], 0.3)],
		[pages.r2.title, near(topics[2], 0.8)], [WORDS[3] + " " + WORDS[4], Float32Array.from({ length: DIM }, gauss)],
		["glukose", near(topics[1], 0.3)], ["x", Float32Array.from({ length: DIM }, () => 0)],
	];
	const cases = [];
	for (const [query, qv] of queries) for (const k of [3, 6, 20]) {
		const hits = rankRag({ query, qv, vecs, pages, model, providerId, k }).map((h) => ({ ...h, snippet: wellFormed(h.snippet) }));
		cases.push({ query, qv: Array.from(qv), k, hits });
	}
	// related über rag.js (S.pages liefert trashed/archived)
	S.settings.embedModel = "local:bekko-a8m";
	S.settings.embedProviderId = providerId;
	S.pages = Object.fromEntries(Object.entries(pages).map(([id, p]) => [id, { id, ...p }]));
	DB.allVecs = async () => vecs;
	const related = [];
	for (const id of [...Object.keys(pages), "ohneSeite", "fehlt"]) related.push({ page_id: id, k: 3, hits: await RAG.related(id, 3) });
	related.push({ page_id: "r0", k: 20, hits: await RAG.related("r0", 20) });
	const recJson = (rec, i) => ({
		...rec,
		...(rec.chunks ? { chunks: rec.chunks.map((c) => ({ ...c, vec: i % 5 === 1 ? JSON.parse(JSON.stringify(c.vec)) : Array.from(c.vec) })) } : { vec: Array.from(rec.vec) }),
	});
	write("rank.json", {
		model, provider_id: providerId, pages,
		records: Object.entries(vecs).map(([id, rec], i) => [id, recJson(rec, i)]),
		cases, related,
	});
}
console.log("Golden-Files geschrieben:", fs.readdirSync(dir).join(", "));
process.exit(0);
