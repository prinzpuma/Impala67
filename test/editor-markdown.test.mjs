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

test("Konstanten und Hilfsfunktionen haben erwartete Werte", () => {
	assert.equal(FENCE, "```");
	assert.equal(mimeFromName("test.mp4"), "video/mp4");
	assert.equal(mimeFromName("audio.mp3"), "audio/mpeg");
	assert.equal(mimeFromName("document.pdf"), "application/pdf");
	assert.equal(mimeFromName("image.png"), "image/png");
	assert.equal(mimeFromName("unknown.xyz"), "");
	assert.equal(mimeFromName(null), "");

	assert.ok(COLOR_META_RE.test("<!--@c:red-->"));
	assert.ok(COLOR_META_RE.test("<!--@c:;bg:yellow-->"));
	assert.ok(COLOR_META_RE.test("<!--@c:blue;bg:gray-->"));

	assert.ok(IMAGE_RE.test("![Alt-Text](https://example.com/img.jpg)"));
	assert.ok(HEFT_RE.test(":::heft heft-12345"));
	assert.ok(FILE_RE.test(":::file file:blob123 mein-dokument.pdf"));

	assert.equal(LISTY.bullet, 1);
	assert.equal(LISTY.number, 1);
	assert.equal(LISTY.todo, 1);
});

test("Überschriften h1, h2 und h3 parsen und serialisieren", () => {
	const md = "# Überschrift 1\n\n## Überschrift 2\n\n### Überschrift 3";
	const blocks = parse(md);

	assert.equal(blocks.length, 3);
	assert.equal(blocks[0].type, "h1");
	assert.equal(blocks[0].text, "Überschrift 1");

	assert.equal(blocks[1].type, "h2");
	assert.equal(blocks[1].text, "Überschrift 2");

	assert.equal(blocks[2].type, "h3");
	assert.equal(blocks[2].text, "Überschrift 3");

	assert.equal(serialize(blocks), md);
});

test("Absätze (einzeilig und mehrzeilig) parsen und serialisieren", () => {
	const md = "Erster Absatz mit fortlaufendem Text.\n\nZweiter Absatz\nmit zwei Zeilen.";
	const blocks = parse(md);

	assert.equal(blocks.length, 2);
	assert.equal(blocks[0].type, "p");
	assert.equal(blocks[0].text, "Erster Absatz mit fortlaufendem Text.");

	assert.equal(blocks[1].type, "p");
	assert.equal(blocks[1].text, "Zweiter Absatz\nmit zwei Zeilen.");

	assert.equal(serialize(blocks), md);
});

test("Code-Blöcke mit Fences und Sprache parsen und serialisieren", () => {
	const codeText = "function hello() {\n  return 'world';\n}";
	const md = `${FENCE}javascript\n${codeText}\n${FENCE}`;
	const blocks = parse(md);

	assert.equal(blocks.length, 1);
	assert.equal(blocks[0].type, "code");
	assert.equal(blocks[0].language, "javascript");
	assert.equal(blocks[0].text, codeText);

	assert.equal(serialize(blocks), md);
});

test("Formel-Blöcke ($$...$$ und \\[...\\]) parsen und serialisieren", () => {
	const mathContent = "\\sum_{i=1}^n i = \\frac{n(n+1)}{2}";
	const md = `$$\n${mathContent}\n$$`;
	const blocks = parse(md);

	assert.equal(blocks.length, 1);
	assert.equal(blocks[0].type, "math");
	assert.equal(blocks[0].text, mathContent);

	assert.equal(serialize(blocks), md);

	// Einzeilige Formel mit $$
	const singleMath = parse("$$E = mc^2$$");
	assert.equal(singleMath.length, 1);
	assert.equal(singleMath[0].type, "math");
	assert.equal(singleMath[0].text, "E = mc^2");

	// Formel mit eckigen Klammern \\[...\\]
	const bracketMath = parse("\\[a^2 + b^2 = c^2\\]");
	assert.equal(bracketMath.length, 1);
	assert.equal(bracketMath[0].type, "math");
	assert.equal(bracketMath[0].text, "a^2 + b^2 = c^2");
	assert.equal(serialize(bracketMath), "$$\na^2 + b^2 = c^2\n$$");
});

test("Todo-Listen mit Checkboxen (unerledigt, erledigt, eingerückt)", () => {
	const md = "- [ ] Aufgabe 1\n- [x] Aufgabe 2 erledigt\n  - [ ] Unteraufgabe eingerückt";
	const blocks = parse(md);

	assert.equal(blocks.length, 3);

	assert.equal(blocks[0].type, "todo");
	assert.equal(blocks[0].checked, false);
	assert.equal(blocks[0].indent, 0);
	assert.equal(blocks[0].text, "Aufgabe 1");

	assert.equal(blocks[1].type, "todo");
	assert.equal(blocks[1].checked, true);
	assert.equal(blocks[1].indent, 0);
	assert.equal(blocks[1].text, "Aufgabe 2 erledigt");

	assert.equal(blocks[2].type, "todo");
	assert.equal(blocks[2].checked, false);
	assert.equal(blocks[2].indent, 1);
	assert.equal(blocks[2].text, "Unteraufgabe eingerückt");

	// Listen gleicher Art bleiben zusammenhängend ohne Leerzeile
	assert.equal(serialize(blocks), md);
});

test("Bullet- und Number-Listen mit Einrückungen parsen und serialisieren", () => {
	const md = "- Punkt 1\n- Punkt 2\n  - Unterpunkt A\n1. Nummer 1\n1. Nummer 2";
	const blocks = parse(md);

	assert.equal(blocks.length, 5);

	assert.equal(blocks[0].type, "bullet");
	assert.equal(blocks[0].text, "Punkt 1");
	assert.equal(blocks[0].indent, 0);

	assert.equal(blocks[1].type, "bullet");
	assert.equal(blocks[1].text, "Punkt 2");
	assert.equal(blocks[1].indent, 0);

	assert.equal(blocks[2].type, "bullet");
	assert.equal(blocks[2].text, "Unterpunkt A");
	assert.equal(blocks[2].indent, 1);

	assert.equal(blocks[3].type, "number");
	assert.equal(blocks[3].text, "Nummer 1");
	assert.equal(blocks[3].indent, 0);

	assert.equal(blocks[4].type, "number");
	assert.equal(blocks[4].text, "Nummer 2");
	assert.equal(blocks[4].indent, 0);

	assert.equal(serialize(blocks), md);
});

test("Zitate (einzeilig und mehrzeilig) parsen und serialisieren", () => {
	const md = "> Erstes Zitat\n\n> Mehrzeiliges Zitat\n> zweite Zeile des Zitats";
	const blocks = parse(md);

	assert.equal(blocks.length, 2);
	assert.equal(blocks[0].type, "quote");
	assert.equal(blocks[0].text, "Erstes Zitat");

	assert.equal(blocks[1].type, "quote");
	assert.equal(blocks[1].text, "Mehrzeiliges Zitat\nzweite Zeile des Zitats");

	assert.equal(serialize(blocks), md);
});

test("Tabellen parsen und serialisieren", () => {
	const md = "| Name | Rolle |\n| --- | --- |\n| Alice | Entwicklerin |\n| Bob | Tester |";
	const blocks = parse(md);

	assert.equal(blocks.length, 1);
	assert.equal(blocks[0].type, "table");
	assert.deepEqual(blocks[0].rows, [
		["Name", "Rolle"],
		["Alice", "Entwicklerin"],
		["Bob", "Tester"],
	]);

	assert.equal(serialize(blocks), md);
});

test("Trennlinien parsen und serialisieren", () => {
	const md = "Absatz vor der Linie\n\n---\n\nAbsatz nach der Linie";
	const blocks = parse(md);

	assert.equal(blocks.length, 3);
	assert.equal(blocks[0].type, "p");
	assert.equal(blocks[1].type, "divider");
	assert.equal(blocks[2].type, "p");

	assert.equal(serialize(blocks), md);
});

test("Farb-Metadaten für Blöcke bleiben beim Parse und Serialize erhalten", () => {
	const md = "<!--@c:red;bg:yellow-->\n# Bunte Überschrift\n\n<!--@c:blue-->\nFarbiger Textabsatz";
	const blocks = parse(md);

	assert.equal(blocks.length, 2);
	assert.equal(blocks[0].type, "h1");
	assert.equal(blocks[0].textColor, "red");
	assert.equal(blocks[0].bgColor, "yellow");
	assert.equal(blocks[0].text, "Bunte Überschrift");

	assert.equal(blocks[1].type, "p");
	assert.equal(blocks[1].textColor, "blue");
	assert.equal(blocks[1].text, "Farbiger Textabsatz");

	assert.equal(serialize(blocks), md);
});

test("Custom uidGenerator wird korrekt angewendet", () => {
	let counter = 0;
	const customUid = () => `test-id-${++counter}`;

	const blocks = parse("# Eins\n\nZwei", customUid);
	assert.equal(blocks[0].id, "test-id-1");
	assert.equal(blocks[1].id, "test-id-2");
});

test("Sonderblöcke: Callouts, Toggles, Bilder und Dateien", () => {
	// Callout
	const calloutMd = "> [!blue]\n> Ein wichtiger Hinweis";
	const callouts = parse(calloutMd);
	assert.equal(callouts.length, 1);
	assert.equal(callouts[0].type, "callout");
	assert.equal(callouts[0].color, "blue");
	assert.equal(callouts[0].children[0].text, "Ein wichtiger Hinweis");

	// Toggle
	const toggleMd = "<details open>\n<summary>Details öffnen</summary>\n\nEingeklappter Text\n</details>";
	const toggles = parse(toggleMd);
	assert.equal(toggles.length, 1);
	assert.equal(toggles[0].type, "toggle");
	assert.equal(toggles[0].open, true);
	assert.equal(toggles[0].summary, "Details öffnen");

	// Bild vs. Video
	const imgBlocks = parse("![Foto](foto.jpg)\n\n![Clip](video.mp4)");
	assert.equal(imgBlocks.length, 2);
	assert.equal(imgBlocks[0].type, "image");
	assert.equal(imgBlocks[0].alt, "Foto");
	assert.equal(imgBlocks[1].type, "file"); // mp4 wird zu file
	assert.equal(imgBlocks[1].name, "Clip");

	// Heft
	const heftBlocks = parse(":::heft h-42");
	assert.equal(heftBlocks.length, 1);
	assert.equal(heftBlocks[0].type, "heft");
	assert.equal(heftBlocks[0].heftId, "h-42");
});

test("Randfälle: Leere Eingabe, serializeBlock Einzelfall", () => {
	assert.deepEqual(parse(""), []);
	assert.deepEqual(parse(null), []);
	assert.equal(serialize([]), "");
	assert.equal(serialize(null), "");
	assert.equal(serializeBlock(null), "");
	assert.equal(serializeBlock({ type: "divider" }), "---");
});
