import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><body><div id='editor'></div></body>", { url: "http://localhost/" });
for (const key of ["window", "document", "Element", "Node", "NodeFilter", "HTMLElement", "MutationObserver", "navigator", "innerWidth", "innerHeight"]) {
	Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
}
Object.defineProperty(globalThis, "localStorage", { value: dom.window.localStorage, configurable: true });
Object.defineProperty(globalThis, "requestAnimationFrame", { value: (fn) => setTimeout(() => fn(performance.now()), 0), configurable: true });
Object.defineProperty(globalThis, "matchMedia", { value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), configurable: true });
dom.window.Range.prototype.getBoundingClientRect = () => ({ top: 20, right: 20, bottom: 20, left: 20, width: 0, height: 16 });

const { EDITOR } = await import("../web/editor.js");
const { S } = await import("../web/state.js");

function typeInto(field, value) {
	field.innerHTML = value;
	field.focus();
	const range = document.createRange();
	range.selectNodeContents(field);
	range.collapse(false);
	const selection = window.getSelection();
	selection.removeAllRanges();
	selection.addRange(range);
	field.dispatchEvent(new window.InputEvent("input", { bubbles: true, data: value.slice(-1), inputType: "insertText" }));
}

test("Bug 1: Verschachtelte Toggles (<details>) bleiben beim Parsen und Serialisieren stabil", () => {
	const md = `<details open>
<summary>Äußerer Toggle</summary>

<details open>
<summary>Innerer Toggle</summary>

Innerer Inhalt
</details>

Äußerer Folgeinhalt
</details>`;

	const blocks = EDITOR.parse(md);
	assert.equal(blocks.length, 1, "sollte genau einen äußeren Toggle-Block erzeugen");
	assert.equal(blocks[0].type, "toggle");
	assert.equal(blocks[0].summary, "Äußerer Toggle");
	assert.equal(blocks[0].children.length, 2, "äußerer Toggle sollte inneren Toggle und Folgeabsatz enthalten");
	assert.equal(blocks[0].children[0].type, "toggle");
	assert.equal(blocks[0].children[0].summary, "Innerer Toggle");
	assert.equal(blocks[0].children[0].children[0].text, "Innerer Inhalt");
	assert.equal(blocks[0].children[1].text, "Äußerer Folgeinhalt");

	document.body.innerHTML = "<div id='editor-toggle'></div>";
	S.pages = { toggletest: { id: "toggletest", title: "Toggle-Test", content: md } };
	EDITOR.mount(document.getElementById("editor-toggle"), "toggletest");

	const reserialized = EDITOR.serialize();
	const reblocks = EDITOR.parse(reserialized);
	assert.equal(reblocks.length, 1);
	assert.equal(reblocks[0].children.length, 2);
	assert.equal(reblocks[0].children[1].text, "Äußerer Folgeinhalt");
});

test("Bug 2: Slash-Menü öffnet sich auch nach formatiertem Text und Links", async () => {
	document.body.innerHTML = "<div id='editor-slash'></div>";
	S.pages = { slashtest: { id: "slashtest", title: "Slash-Test", content: "**Fett:** " } };
	EDITOR.mount(document.getElementById("editor-slash"), "slashtest");
	const field = document.querySelector("#editor-slash [data-btext]");

	typeInto(field, "<strong>Fett:</strong> /todo");
	await new Promise((resolve) => setTimeout(resolve, 0));

	const menu = document.querySelector(".blk-slashmenu");
	assert.ok(menu, "Slash-Menü sollte sich auch nach vorangestelltem formatierten Text öffnen");
});

test("Bug 3: Slash-Befehl /columns fokussiert das erste Feld der ersten Spalte", async () => {
	document.body.innerHTML = "<div id='editor-cols'></div>";
	S.pages = { colstest: { id: "colstest", title: "Cols-Test", content: "" } };
	EDITOR.mount(document.getElementById("editor-cols"), "colstest");
	const field = document.querySelector("#editor-cols [data-btext]");

	typeInto(field, "/columns");
	const menu = document.querySelector(".blk-slashmenu");
	assert.ok(menu);
	menu.querySelector('[data-slashpick="columns"]').click();
	await new Promise((resolve) => setTimeout(resolve, 10));

	const colField = document.querySelector("#editor-cols .blk-column [data-btext]");
	assert.ok(colField, "Spaltenfeld existiert");
	assert.equal(document.activeElement, colField, "Spalten-Textfeld sollte fokussiert sein");
});

test("Bug 4: Pfeiltasten wechseln auch aus mehrzeiligen Absätzen an Blockgrenzen in Nachbarblöcke", () => {
	document.body.innerHTML = "<div id='editor-arrows'></div>";
	S.pages = { arrowtest: { id: "arrowtest", title: "Arrow-Test", content: "Zeile 1\nZeile 2\n\nZweiter Block" } };
	EDITOR.mount(document.getElementById("editor-arrows"), "arrowtest");

	const fields = document.querySelectorAll("#editor-arrows [data-btext]");
	assert.equal(fields.length, 2);

	// Am Ende von Block 1 -> ArrowDown wechselt in Block 2
	fields[0].focus();
	const range = document.createRange();
	range.selectNodeContents(fields[0]);
	range.collapse(false); // am Ende
	const sel = window.getSelection();
	sel.removeAllRanges();
	sel.addRange(range);

	const ev = new window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true });
	fields[0].dispatchEvent(ev);
	assert.equal(ev.defaultPrevented, true, "ArrowDown am Ende sollte den Wechsel in den Nachbarblock auslösen");
});

test("Bug 5: Delete am Blockende wählt nachfolgende Strukturblöcke (z. B. Tabellen) an", () => {
	document.body.innerHTML = "<div id='editor-del'></div>";
	S.pages = { deltest: { id: "deltest", title: "Del-Test", content: "Text vor Tabelle\n\n| A | B |\n| --- | --- |\n| 1 | 2 |" } };
	EDITOR.mount(document.getElementById("editor-del"), "deltest");

	const textField = document.querySelector("#editor-del [data-btext]");
	textField.focus();
	const range = document.createRange();
	range.selectNodeContents(textField);
	range.collapse(false);
	const sel = window.getSelection();
	sel.removeAllRanges();
	sel.addRange(range);

	const ev = new window.KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true });
	textField.dispatchEvent(ev);
	assert.equal(ev.defaultPrevented, true);
	assert.ok(document.querySelector("#editor-del .blk[data-btype='table'].selected"), "Tabelle sollte angewählt sein");
});

test("Bug 6: Unterstrichener Text (<u>...</u>) wird gerendert und als <u>...</u> serialisiert", () => {
	const md = "Hier ist <u>unterstrichener</u> Text.";
	const blocks = EDITOR.parse(md);
	assert.equal(blocks[0].text, md);

	document.body.innerHTML = "<div id='editor-u'></div>";
	S.pages = { utest: { id: "utest", title: "U-Test", content: md } };
	EDITOR.mount(document.getElementById("editor-u"), "utest");

	const uEl = document.querySelector("#editor-u u");
	assert.ok(uEl, "<u> Tag sollte im DOM gerendert sein");
	assert.equal(uEl.textContent, "unterstrichener");
	assert.equal(EDITOR.serialize(), md);
});

test("Bug 7: Markdown-Einfügen in Callouts erzeugt echte Kind-Blöcke", () => {
	document.body.innerHTML = "<div id='editor-paste-co'></div>";
	S.pages = { pastetest: { id: "pastetest", title: "Paste-Test", content: "> [!blue]\n> Initial" } };
	EDITOR.mount(document.getElementById("editor-paste-co"), "pastetest");

	const coTextField = document.querySelector("#editor-paste-co .blk-callout [data-btext]");
	assert.ok(coTextField);

	const pasteEvent = new window.Event("paste", { bubbles: true, cancelable: true });
	Object.defineProperty(pasteEvent, "clipboardData", {
		value: { items: [], getData: () => "- Listenpunkt 1\n- Listenpunkt 2" },
	});
	coTextField.dispatchEvent(pasteEvent);

	const listItems = document.querySelectorAll("#editor-paste-co .blk-callout .blk[data-btype='bullet']");
	assert.equal(listItems.length, 2, "Im Callout sollten 2 Listenblöcke eingefügt worden sein");
});

test("Bug 8: Listenpunkte mit '+' werden als 'bullet'-Blöcke geparst", () => {
	const md = `+ Erster Punkt
+ Zweiter Punkt
  + Unterpunkt`;

	const blocks = EDITOR.parse(md);
	assert.equal(blocks.length, 3);
	assert.equal(blocks[0].type, "bullet");
	assert.equal(blocks[0].text, "Erster Punkt");
	assert.equal(blocks[1].type, "bullet");
	assert.equal(blocks[1].text, "Zweiter Punkt");
	assert.equal(blocks[2].type, "bullet");
	assert.equal(blocks[2].indent, 1);
	assert.equal(blocks[2].text, "Unterpunkt");
});

test("Bug 9: Maskierte Dollarzeichen (\\$) werden nicht als KaTeX-Formel interpretiert", () => {
	const md = "Kostet \\$5 und \\$10.";
	document.body.innerHTML = "<div id='editor-dollar'></div>";
	S.pages = { dollartest: { id: "dollartest", title: "Dollar-Test", content: md } };
	EDITOR.mount(document.getElementById("editor-dollar"), "dollartest");

	const imath = document.querySelectorAll("#editor-dollar .blk-imath");
	assert.equal(imath.length, 0, "Es sollten keine Formel-Chips für \\$ erzeugt werden");
});

test("Enter mitten im Text teilt den Block sauber im DOM und Modell", () => {
	document.body.innerHTML = "<div id='editor-enter'></div>";
	S.pages = { entertest: { id: "entertest", title: "Enter-Test", content: "Hallo Welt" } };
	EDITOR.mount(document.getElementById("editor-enter"), "entertest");

	const field = document.querySelector("#editor-enter [data-btext]");
	field.focus();
	// Cursor nach "Hallo " (Offset 6)
	const range = document.createRange();
	range.setStart(field.firstChild, 6);
	range.setEnd(field.firstChild, 6);
	const sel = window.getSelection();
	sel.removeAllRanges();
	sel.addRange(range);

	const ev = new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
	field.dispatchEvent(ev);

	const fields = document.querySelectorAll("#editor-enter [data-btext]");
	assert.equal(fields.length, 2, "Enter erzeugt 2 Textblöcke");
	assert.equal(fields[0].textContent, "Hallo ", "Erster Block behält nur Text vor dem Cursor");
	assert.equal(fields[1].textContent, "Welt", "Zweiter Block erhält Text nach dem Cursor");
});

test("Backspace am Anfang eines nicht-leeren Todo-Blocks verschmilzt sauber mit dem Vorgänger", () => {
	document.body.innerHTML = "<div id='editor-todo-bs'></div>";
	S.pages = { todobig: { id: "todobig", title: "Todo-Test", content: "- [ ] Erstes\n- [ ] Zweites" } };
	EDITOR.mount(document.getElementById("editor-todo-bs"), "todobig");

	const fields = document.querySelectorAll("#editor-todo-bs [data-btext]");
	assert.equal(fields.length, 2);

	// Cursor am Anfang von Block 2 ("Zweites")
	fields[1].focus();
	const range = document.createRange();
	range.selectNodeContents(fields[1]);
	range.collapse(true); // atStart
	const sel = window.getSelection();
	sel.removeAllRanges();
	sel.addRange(range);

	const ev = new window.KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true });
	fields[1].dispatchEvent(ev);

	const remaining = document.querySelectorAll("#editor-todo-bs [data-btext]");
	assert.equal(remaining.length, 1, "Zweites Todo sollte in das erste Todo verschmolzen werden");
	assert.equal(remaining[0].textContent, "ErstesZweites");
});

test("Backspace am Anfang einer leeren Toggle-Summary wandelt den Block in einen Absatz um", () => {
	document.body.innerHTML = "<div id='editor-toggle-bs'></div>";
	S.pages = { togglbs: { id: "togglbs", title: "Toggle-BS", content: "<details open>\n<summary></summary>\n\n\n</details>" } };
	EDITOR.mount(document.getElementById("editor-toggle-bs"), "togglbs");

	const summaryField = document.querySelector("#editor-toggle-bs [data-bsummary]");
	assert.ok(summaryField);
	summaryField.focus();
	const range = document.createRange();
	range.selectNodeContents(summaryField);
	range.collapse(true);
	const sel = window.getSelection();
	sel.removeAllRanges();
	sel.addRange(range);

	const ev = new window.KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true });
	summaryField.dispatchEvent(ev);

	assert.equal(document.querySelectorAll("#editor-toggle-bs .blk-toggle").length, 0, "Toggle sollte entfernt / zu Paragraph umgewandelt sein");
});

test("applyLink ([[ Linkauswahl) schreibt Link direkt in das sichtbare DOM und Modell", async () => {
	document.body.innerHTML = "<div id='editor-link'></div>";
	S.pages = {
		cur: { id: "cur", title: "Aktuell", content: "" },
		target: { id: "target", title: "Zielseite", content: "" },
	};
	EDITOR.mount(document.getElementById("editor-link"), "cur");

	const field = document.querySelector("#editor-link [data-btext]");
	typeInto(field, "[[Zie");
	await new Promise((resolve) => setTimeout(resolve, 100));

	const linkMenu = document.querySelector(".blk-linkmenu");
	assert.ok(linkMenu, "Linkmenü sollte sichtbar sein");
	linkMenu.querySelector('[data-linkpick="target"]').click();
	await new Promise((resolve) => setTimeout(resolve, 10));

	assert.equal(field.textContent, "Zielseite", "Link-Text sollte im sichtbaren DOM stehen");
	assert.equal(EDITOR.serialize(), "[Zielseite](#target)", "Modell enthält den Markdown-Link");
});

test("turnInto von Callout zu Toggle dupliziert Text nicht in Summary und Body", () => {
	const md = "> [!blue]\n> Callout Text";
	const blocks = EDITOR.parse(md);
	document.body.innerHTML = "<div id='editor-turn'></div>";
	S.pages = { turntest: { id: "turntest", title: "Turn-Test", content: md } };
	EDITOR.mount(document.getElementById("editor-turn"), "turntest");

	const handle = document.querySelector("#editor-turn [data-bhandle]");
	handle.click();

	const menu = document.querySelector(".blk-menu");
	assert.ok(menu);
	menu.querySelector('[data-turninto$=":toggle"]').click();

	const serialized = EDITOR.serialize();
	assert.ok(!serialized.includes("<summary>Callout Text</summary>"), "Summary darf nicht den gesamten Callout-Text doppeln");
	assert.ok(serialized.includes("Callout Text"), "Inhalt bleibt im Toggle erhalten");
});

test("***fett und kursiv*** wird gerendert", () => {
	const md = "Hier ist ***fett und kursiv***.";
	document.body.innerHTML = "<div id='editor-bi'></div>";
	S.pages = { bitest: { id: "bitest", title: "BI-Test", content: md } };
	EDITOR.mount(document.getElementById("editor-bi"), "bitest");

	const strong = document.querySelector("#editor-bi strong em");
	assert.ok(strong, "strong > em sollte für *** gerendert werden");
	assert.equal(strong.textContent, "fett und kursiv");
});

test("Dragover mit externen Dateien ruft e.preventDefault() auf", () => {
	document.body.innerHTML = "<div id='editor-drop'></div>";
	S.pages = { droptest: { id: "droptest", title: "Drop-Test", content: "Block 1" } };
	EDITOR.mount(document.getElementById("editor-drop"), "droptest");

	const host = document.getElementById("editor-drop");
	const dragOverEvent = new window.Event("dragover", { bubbles: true, cancelable: true });
	Object.defineProperty(dragOverEvent, "dataTransfer", {
		value: { types: ["Files"] },
	});
	host.dispatchEvent(dragOverEvent);

	assert.equal(dragOverEvent.defaultPrevented, true, "dragover für Dateien muss preventDefault aufrufen, damit der Drop erlaubt wird");
});
