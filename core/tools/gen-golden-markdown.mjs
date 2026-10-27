// Schreibt die Golden-Files für `cargo test -p impala-markdown` (core/impala-markdown/tests/golden/*.json).
// Quelle ist das JS-Original: web/editor-markdown.js (parse/serialize/mimeFromName) und die verstreuten
// reinen Text-Helfer (home-view.js excerpt/cardText, home-article.js teaser, library.js erste Zeile,
// editor.js plainTextOf, editor-inline.js Wiki-Links, editor-menus.js Seitenlink, state.js Backlinks).
// Nicht exportierte Helfer werden als Quelltext aus der echten Datei gelesen und ausgewertet.
// Neu erzeugen nur, wenn sich das JS-Verhalten bewusst ändert: node core/tools/gen-golden-markdown.mjs
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parse, serialize, serializeBlock, mimeFromName } from "../../web/editor-markdown.js";
import { rng } from "./sample-log.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const dir = path.join(root, "core/impala-markdown/tests/golden");
fs.mkdirSync(dir, { recursive: true });
const src = (f) => fs.readFileSync(path.join(root, "web", f), "utf8");

// Quelltext ab `marker` bis zur passenden schließenden Klammer (Funktionskörper) bzw. Zeilenende.
function extract(file, marker) {
	const s = src(file);
	const at = s.indexOf(marker);
	if (at < 0) throw new Error(`${marker} fehlt in ${file}`);
	const open = s.indexOf("{", at + marker.length);
	let depth = 0;
	for (let k = open; k < s.length; k++) {
		if (s[k] === "{") depth++;
		else if (s[k] === "}" && --depth === 0) return s.slice(at, k + 1);
	}
	throw new Error("unbalanciert: " + marker);
}
const line = (file, marker) => {
	const s = src(file);
	const at = s.indexOf(marker);
	return s.slice(at, s.indexOf("\n", at));
};
const helpers = new Function([
	line("editor-menus.js", "export const TEXTY").replace("export ", ""),
	line("home-view.js", "const plain = "),
	extract("home-view.js", "function excerpt(pg)"),
	extract("home-view.js", "function cardText(md)"),
	extract("home-article.js", "const teaser = (body) =>") + ";",
	extract("editor.js", "function plainTextOf(b)"),
	"return { excerpt, cardText, teaser, plainTextOf };",
].join("\n"))();
// library.js libDocHtml: erste Nicht-Überschrift-Zeile (Ausdruck 1:1 aus der Datei)
const firstLineExpr = line("library.js", "const firstLine = ").replace(/^const firstLine = /, "").replace(/;$/, "");
const firstLine = new Function("pg", "return " + firstLineExpr);
// editor-inline.js: Wiki-Link-Regex; editor-menus.js: Markdown-Seitenlink
const wikiRe = /\[\[([^\]\n]+)\]\]/g;
const wikiLinks = (text) => [...String(text).matchAll(wikiRe)].map((m) => m[1]);
if (!src("editor-inline.js").includes(".replace(/\\[\\[([^\\]\\n]+)\\]\\]/g")) throw new Error("Wiki-Regex geändert");
const pageLinkSrc = extract("editor-menus.js", "function applyLink(");
if (!pageLinkSrc.includes('const label = (page.title || "Ohne Titel").replace(/[[\\]]/g, "");')) throw new Error("Seitenlink geändert");
const pageLink = (title, id) => "[" + (title || "Ohne Titel").replace(/[[\]]/g, "") + "](#" + id + ")";
// state.js backlinksOf: Zielseite mit Titel ≠ „Ohne Titel“, Inhalt enthält Titel (klein)
if (!src("state.js").includes("haystackOf(pg).contentLc.includes(t)")) throw new Error("backlinksOf geändert");
const linksTo = (content, title) => !!title && title !== "Ohne Titel" && String(content || "").toLowerCase().includes(title.toLowerCase());

// ---------- Eingaben ----------
const real = execSync("git ls-files '*.md'", { cwd: root, encoding: "utf8" }).trim().split("\n")
	.filter((f) => !f.startsWith("core/impala-markdown/"))
	.filter((f) => /^(TODO|AGENTS|CLAUDE|README)\.md$|^docs\/NATIV|^server\/README|^\.claude\/skills\/(cloudflare|impala67)/.test(f))
	.map((f) => ({ name: f, md: fs.readFileSync(path.join(root, f), "utf8") }));

const hand = [
	"", "\n\n", "   \n\t\n", "a\r\nb\r\n\r\nc", "a\rb\r\rc", "\r\n# Titel\r\n- x\r\n  y",
	"```js\nconst a = 1;\n\n```\nnach", "```\nnie geschlossen\n- liste", "```  \nleer\n```py\nx",
	"$$\na^2\n$$", "$$a+b$$", "$$ x", "\\[\nx\n\\]", "\\[x\\] rest", "  $$ eingerückt\nzwei\n$$ danach",
	":::heft h1", ":::heft   h2 rest", ":::heftX", ":::file file:abc Mein Dokument.pdf", ":::file https://x/y.mp4", ":::file a \u2028",
	":::columns\nlinks\n:::split\nrechts\n:::end", ":::columns\n:::columns\na\n:::split\nb\n:::end\n:::split\n:::end",
	":::columns\nnie zu", ":::columns\n:::split\n:::split\n:::end",
	"<details open>\n<summary>Mehr</summary>\n\nInhalt\n</details>", "<DETAILS><summary>inline</summary>\nx\n</DETAILS>",
	"<details>\n<details>\n<summary>innen</summary>\ny\n</details>\n</details>", "<details class=\"reopen\">\nz",
	"<details><summary>a</summary>b</details>\nweiter", "text\n<details>\nkein Block", "text\n<DETAILS>\nbleibt Absatz",
	"> [!blue] Titel\n> zeile\n>ohne\n> [!red] neu", "> [!WARN]\n", "> zitat\n>zwei\n> [!x] c", ">", "> ",
	"| a | b |\n|---|:-:|\n| c \\| d | e |", "|a|\n|b|c|d|", "||", "|", " | x | ", "| a |\n\n| b |", "|---|",
	"---", "  ----  ", "- - -", "***", "___",
	"![alt](bild.png)", "![v](film.MP4)", "![](ton.mp3?x=1)", "![d](doc.pdf#p2)", "![a](b c)", "![a](b)  ", "![x](y)z",
	"# H1\n## H2\n### H3\n#### H4\n#x", "# ", "#", "#\u2028x", "## a\u2028b",
	"- a\n  b\n    c\n- d", "* x\n+ y\n1. z\n2) w\n10. v", "- [ ] offen\n- [x] fertig\n- [X]zu\n* [ ] stern\n1. [ ] zahl",
	"  - zwei\n\t- tab\n\t\t- zwei tabs\n   - drei", "- a\n  ```\n  b", "- a\n  - b\n  c", "- a\n   \n- b", "- a\n\n- b",
	"-\tx", "1.x", "- ", "-  ", "- [ ]", "- \u00a0x", "-\u2028x", "\u00a0- x",
	"<!--@c:red-->\n# rot", "<!--@c:;bg:blue-->\n- liste", "<!--@c:green;bg:yellow-->\n\n> zit", "<!--@c:-->\ntext",
	"  <!--@c:red-->  \n---", "<!--@c:Red-->\nx", "<!--@c:red-->", "<!--@c:red-->\n<!--@c:;bg:gray-->\nletzte gilt",
	"<!--@c:red-->\n:::columns\na\n:::end", "<!--@c:purple-->\n> [!blue] c",
	"Absatz\nzwei\n# unterbrochen", "Absatz\n- liste", "Absatz\n|tab|", "Absatz\n![b](c)", "Absatz\n<!--@c:red-->", "Absatz\n:::x",
	"Absatz\n$$", "Absatz\n\\[", "Absatz\n####", "Absatz\n>x", "Absatz\n  ---  ", "Absatz\n```",
	"Ünïcödé 😀 中文 \ufeff", "\ufeff# BOM", "\u2028", "x\u2029y", "Tab\tim\tText", "  führende Leerzeichen",
	"[[Wiki Link]] und [[ ]] [[a]b]] [[[x]] [[\n]]", "[Seite](#abc123) [x](#)", "**fett** _kur_ `code` ~~weg~~ ==mark==",
	"$inline$ und $$block$$ und \\(x\\)", "<b>html</b> <br> <a href='x'>l</a>", "{{c1::Lücke::Hinweis}} rest",
];

// Zufallsdokumente aus kniffligen Bausteinen
const PIECES = [
	"", "", "", " ", "\t", "# T", "## T", "### T", "#### T", "#T", "- a", "  - b", "    - c", "\t- d", "* e", "+ f", "1. g", "2) h", "- [ ] i", "- [x] j",
	"   fortsetzung", "  weiter", "```", "```js", "code;", "$$", "$$x$$", "\\[", "\\]", ":::heft h", ":::file f n", ":::columns", ":::split", ":::end",
	"<details>", "<details open>", "<summary>S</summary>", "</details>", "> [!blue] c", "> q", ">q", "| a | b |", "|---|---|", "| x \\| y |",
	"---", "![a](b.png)", "![v](v.webm)", "<!--@c:red-->", "<!--@c:;bg:blue-->", "Text mit **fett**", "Ümlaut äöü", "😀 emoji", "中文字",
	"\u00a0nbsp", "a\u2028b", "[[Wiki]]", "[L](#id)", "<i>x</i>", "$a$", "{{c1::k}}",
];
// JS-Fehler: eine Callout-Kopfzeile mit U+2028/U+2029 (Zeilentrenner für `.`) ist weder Callout
// (`(.*)$` scheitert) noch darf sie ins Zitat (Ausschluss-Regex ohne `$`) → parse() hängt endlos.
// Solche Dokumente kann JS nicht liefern; Rust behandelt sie (eigener Test in tests/golden.rs).
const jsHangs = (md) => /[\u2028\u2029]/.test(md) && md.includes("[!");
function randomDoc(r, n) {
	const nl = r() < 0.15 ? "\r\n" : r() < 0.05 ? "\r" : "\n";
	const out = [];
	for (let k = 0; k < n; k++) {
		let p = PIECES[Math.floor(r() * PIECES.length)];
		if (r() < 0.2) p += " " + PIECES[Math.floor(r() * PIECES.length)];
		out.push(p);
	}
	return out.join(nl);
}

// Zufällige Block-Objekte (auch lose geformt wie aus altem Editor-Zustand) für serialize()
const TYPES = ["p", "h1", "h2", "h3", "bullet", "number", "todo", "quote", "divider", "image", "heft", "file", "code", "math", "table", "callout", "toggle", "columns"];
const TXT = ["", "x", "zwei\nzeilen", "a | b", "😀\nü", "  rand  ", "> q", "- l"];
function randomBlock(r, depth, uid) {
	const pick = (a) => a[Math.floor(r() * a.length)];
	const type = pick(TYPES);
	const b = { id: uid(), type };
	const kids = () => Array.from({ length: Math.floor(r() * 3) }, () => randomBlock(r, depth + 1, uid));
	if (r() < 0.8) b.text = pick(TXT);
	if (r() < 0.3) b.indent = Math.floor(r() * 4);
	if (type === "todo" && r() < 0.7) b.checked = r() < 0.5;
	if (type === "image") { b.alt = pick(TXT); b.src = pick(["a.png", "", "img:x"]); }
	if (type === "heft") b.heftId = pick(["h1", ""]);
	if (type === "file") { b.src = pick(["file:1", "https://x/y.pdf", ""]); if (r() < 0.6) b.name = pick(["Name", "", "a b"]); }
	if (type === "code" && r() < 0.6) b.language = pick(["js", "", "text"]);
	if (type === "table") b.rows = r() < 0.2 ? [] : Array.from({ length: 1 + Math.floor(r() * 3) }, () => Array.from({ length: Math.floor(r() * 4) }, () => pick(TXT)));
	if (type === "callout") { if (r() < 0.7) b.color = pick(["blue", "red", ""]); if (depth < 2) b.children = kids(); }
	if (type === "toggle") { if (r() < 0.7) b.summary = pick(TXT); b.open = r() < 0.5; if (depth < 2) b.children = kids(); }
	if (type === "columns" && depth < 2) b.columns = Array.from({ length: 1 + Math.floor(r() * 3) }, kids);
	if (r() < 0.2) b.textColor = pick(["red", "blue"]);
	if (r() < 0.2) b.bgColor = pick(["gray", "yellow"]);
	return b;
}

// ---------- Ausgabe ----------
const counterUid = () => { let n = 0; return () => "b" + (++n); };
function mdCase(name, md) {
	const blocks = parse(md, counterUid());
	return {
		name, md, blocks, out: serialize(blocks), blockOut: name.startsWith("hand") ? blocks.map(serializeBlock) : undefined, plain: blocks.map(helpers.plainTextOf),
		excerpt: helpers.excerpt({ title: name, content: md }), cardText: helpers.cardText(md), teaser: helpers.teaser(md),
		firstLine: firstLine({ content: md }), wiki: wikiLinks(md),
	};
}
const write = (file, data) => {
	const json = JSON.stringify(data);
	fs.writeFileSync(path.join(dir, file), json + "\n");
	console.log(file, data.length, "Fälle,", json.length, "Bytes");
};

write("real.json", real.map((f) => mdCase(f.name, f.md)));
write("hand.json", hand.map((md, k) => mdCase("hand-" + k, md)));
const r = rng(67);
const randomDocs = [];
while (randomDocs.length < 250) {
	const md = randomDoc(r, 1 + Math.floor(r() * 30));
	if (!jsHangs(md)) randomDocs.push(md);
}
write("random.json", randomDocs.map((md, k) => mdCase("rand-" + k, md)));
const rb = rng(4711);
write("blocks.json", Array.from({ length: 150 }, () => {
	const uid = counterUid();
	const blocks = Array.from({ length: 1 + Math.floor(rb() * 6) }, () => randomBlock(rb, 0, uid));
	return { blocks, out: serialize(blocks), plain: blocks.map(helpers.plainTextOf) };
}));
const NAMES = ["a.mp4", "A.MP4", "x.tar.gz", "y.pdf?dl=1", "z.png#frag", "noext", ".webm", "a.b.c", "film.mkv?x\u2028y", "ü.ogg", "a.jpeg ", "", "a.", "a.mp3.zip", "a.zip.mp3", "x.svg?a=b.png", "datei.OPUS"];
write("misc.json", [{
	mime: NAMES.map((n) => [n, mimeFromName(n)]),
	pageLink: [["Titel", "id1"], ["", "id2"], ["[[a]]b", "id3"], ["Ünï", "x"]].map(([t, id]) => [t, id, pageLink(t, id)]),
	linksTo: [["Hallo Welt", "welt"], ["x", "Ohne Titel"], ["x", ""], ["ÄRGER", "ärger"], ["İstanbul", "i̇stanbul"], ["ΣΑΣ", "σας"], ["abc", "abcd"]]
		.map(([c, t]) => [c, t, linksTo(c, t)]),
}]);
