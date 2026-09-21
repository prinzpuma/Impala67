import test from "node:test";
import assert from "node:assert/strict";

import {
	parse,
	serialize,
	serializeBlock,
	FENCE,
	COLOR_META_RE,
	IMAGE_RE,
	HEFT_RE,
	FILE_RE,
	mimeFromName,
	LISTY,
} from "../web/editor-markdown.js";

test("Editor Markdown: Konstanten und MIME-Erkennung", () => {
	assert.equal(FENCE, "```");
	assert.equal(mimeFromName("test.mp4"), "video/mp4");
	assert.equal(mimeFromName("audio.mp3"), "audio/mpeg");
	assert.equal(mimeFromName("document.pdf"), "application/pdf");
	assert.equal(mimeFromName("image.png"), "image/png");
	assert.equal(mimeFromName("unknown.xyz"), "");

	assert.ok(IMAGE_RE.test("![Alt-Text](https://example.com/img.jpg)"));
	assert.ok(HEFT_RE.test(":::heft heft-12345"));
	assert.ok(FILE_RE.test(":::file file:blob123 mein-dokument.pdf"));

	assert.equal(LISTY.bullet, 1);
	assert.equal(LISTY.number, 1);
	assert.equal(LISTY.todo, 1);
});

test("Editor Markdown: Überschriften und Absätze verlustfrei", () => {
	const md = "# Überschrift 1\n\n## Überschrift 2\n\n### Überschrift 3\n\nErster Absatz.\n\nZweiter Absatz mit\nweichem Zeilenumbruch.";
	const blocks = parse(md);
	assert.equal(blocks.length, 5);
	assert.equal(blocks[0].type, "h1");
	assert.equal(blocks[1].type, "h2");
	assert.equal(blocks[2].type, "h3");
	assert.equal(blocks[3].type, "p");
	assert.equal(blocks[4].type, "p");
	assert.equal(serialize(blocks), md);
});

test("Editor Markdown: Listen (Bullet, Number, Todo mit Checkbox)", () => {
	const md = "- Aufzählung 1\n- Aufzählung 2\n  - Unterpunkt\n- [ ] Unerledigte Aufgabe\n- [x] Erledigte Aufgabe";
	const blocks = parse(md);
	assert.equal(blocks.length, 5);
	assert.equal(blocks[0].type, "bullet");
	assert.equal(blocks[2].indent, 1);
	assert.equal(blocks[3].type, "todo");
	assert.equal(blocks[3].checked, false);
	assert.equal(blocks[4].type, "todo");
	assert.equal(blocks[4].checked, true);
	assert.equal(serialize(blocks), md);

	const numMd = "1. Nummer 1\n1. Nummer 2";
	const numBlocks = parse(numMd);
	assert.equal(numBlocks.length, 2);
	assert.equal(numBlocks[0].type, "number");
	assert.equal(serialize(numBlocks), numMd);
});

test("Editor Markdown: Codeblöcke und Math-Formeln", () => {
	const md = "```javascript\nconst a = 42;\nconsole.log(a);\n```\n\n$$\n\\int_{0}^{\\infty} e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}\n$$";
	const blocks = parse(md);
	assert.equal(blocks.length, 2);
	assert.equal(blocks[0].type, "code");
	assert.equal(blocks[0].language, "javascript");
	assert.equal(blocks[0].text, "const a = 42;\nconsole.log(a);");

	assert.equal(blocks[1].type, "math");
	assert.equal(blocks[1].text, "\\int_{0}^{\\infty} e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}");

	assert.equal(serialize(blocks), md);
});

test("Editor Markdown: Struktur-Elemente (Callouts, Toggles, Tabellen, Embeds)", () => {
	// Callout
	const calloutMd = "> [!blue]\n> Wichtige Information im Kasten";
	const callouts = parse(calloutMd);
	assert.equal(callouts.length, 1);
	assert.equal(callouts[0].type, "callout");
	assert.equal(callouts[0].color, "blue");
	assert.equal(callouts[0].children[0].text, "Wichtige Information im Kasten");
	assert.equal(serialize(callouts), calloutMd);

	// Verschachtelte Toggles
	const toggleMd = `<details open>\n<summary>Haupt-Thema</summary>\n\n<details open>\n<summary>Unter-Thema</summary>\n\nDetailinhalt\n</details>\n\nWeiterer Text\n</details>`;
	const toggles = parse(toggleMd);
	assert.equal(toggles.length, 1);
	assert.equal(toggles[0].type, "toggle");
	assert.equal(toggles[0].summary, "Haupt-Thema");
	assert.equal(toggles[0].children.length, 2);
	assert.equal(toggles[0].children[0].type, "toggle");
	assert.equal(toggles[0].children[0].summary, "Unter-Thema");
	assert.equal(serialize(toggles), toggleMd);

	// Tabelle
	const tableMd = "| Fach | Note |\n| --- | --- |\n| Mathe | 1 |\n| Physik | 2 |";
	const tables = parse(tableMd);
	assert.equal(tables.length, 1);
	assert.equal(tables[0].type, "table");
	assert.deepEqual(tables[0].rows, [
		["Fach", "Note"],
		["Mathe", "1"],
		["Physik", "2"],
	]);
	assert.equal(serialize(tables), tableMd);

	// Embeds (Heft & Datei)
	const embedMd = ":::heft heft-123\n\n:::file file:blob-pdf mein-skript.pdf";
	const embeds = parse(embedMd);
	assert.equal(embeds.length, 2);
	assert.equal(embeds[0].type, "heft");
	assert.equal(embeds[0].heftId, "heft-123");
	assert.equal(embeds[1].type, "file");
	assert.equal(embeds[1].src, "file:blob-pdf");
	assert.equal(embeds[1].name, "mein-skript.pdf");
	assert.equal(serialize(embeds), embedMd);
});

test("Editor Markdown: Farb-Metadaten und Randfälle", () => {
	const md = "<!--@c:red;bg:yellow-->\n# Bunter Titel";
	const blocks = parse(md);
	assert.equal(blocks[0].textColor, "red");
	assert.equal(blocks[0].bgColor, "yellow");
	assert.equal(serialize(blocks), md);

	// Randfälle
	assert.deepEqual(parse(""), []);
	assert.deepEqual(parse(null), []);
	assert.equal(serialize([]), "");
	assert.equal(serialize(null), "");
	assert.equal(serializeBlock(null), "");
	assert.equal(serializeBlock({ type: "divider" }), "---");
});
