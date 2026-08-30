import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><body></body>", { url: "http://localhost/" });
for (const key of ["window", "document", "Element", "Node", "NodeFilter", "HTMLElement", "MutationObserver", "navigator", "innerWidth", "innerHeight"]) {
	Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
}
Object.defineProperty(globalThis, "localStorage", { value: dom.window.localStorage, configurable: true });
Object.defineProperty(globalThis, "requestAnimationFrame", { value: (fn) => setTimeout(() => fn(performance.now()), 0), configurable: true });
Object.defineProperty(globalThis, "matchMedia", { value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), configurable: true });
dom.window.Range.prototype.getBoundingClientRect = () => ({ top: 20, right: 20, bottom: 20, left: 20, width: 0, height: 16 });
// JSDOM bildet diese Browser-Eigenschaft nicht ab. Der Editor-DOM-Abgleich nutzt
// sie jedoch, um das aktive contenteditable während normalen Tippens zu schützen.
Object.defineProperty(dom.window.HTMLElement.prototype, "isContentEditable", {
	configurable: true,
	get() { return this.getAttribute("contenteditable") === "true"; },
});

const { EDITOR } = await import("../web/editor.js");
const { S } = await import("../web/state.js");

function mount(pageId, content, extraPages = {}) {
	document.body.innerHTML = `<div id="${pageId}"></div>`;
	S.pages = { [pageId]: { id: pageId, title: pageId, content }, ...extraPages };
	EDITOR.mount(document.getElementById(pageId), pageId);
	return document.getElementById(pageId);
}

function setCaret(field, atEnd = true) {
	field.focus();
	const range = document.createRange();
	range.selectNodeContents(field);
	range.collapse(!atEnd);
	const selection = window.getSelection();
	selection.removeAllRanges();
	selection.addRange(range);
}

function selectField(field) {
	field.focus();
	const range = document.createRange();
	range.selectNodeContents(field);
	const selection = window.getSelection();
	selection.removeAllRanges();
	selection.addRange(range);
}

function keydown(field, init) {
	const event = new window.KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
	field.dispatchEvent(event);
	return event;
}

function typeSequentially(field, text) {
	for (const character of text) {
		const selection = window.getSelection();
		const range = selection.getRangeAt(0);
		range.deleteContents();
		const node = document.createTextNode(character);
		range.insertNode(node);
		range.setStartAfter(node);
		range.collapse(true);
		selection.removeAllRanges();
		selection.addRange(range);
		field.dispatchEvent(new window.InputEvent("input", { bubbles: true, data: character, inputType: "insertText" }));
	}
}

test("E1: Markdown-Kürzel wandeln den Block um und speichern keine unsichtbaren Zeichen", () => {
	const cases = [
		["#", "h1"],
		["-", "bullet"],
		["1.", "number"],
	];
	for (const [marker, type] of cases) {
		const pageId = `e1-${type}`;
		const host = mount(pageId, "");
		const field = host.querySelector("[data-btext]");
		field.textContent = marker + "\u200b ";
		setCaret(field);
		field.dispatchEvent(new window.InputEvent("input", { bubbles: true, data: " ", inputType: "insertText" }));

		assert.equal(host.querySelector("[data-blk]").dataset.btype, type);
		assert.doesNotMatch(EDITOR.serialize(), /[\u200b\u200c\ufeff]/);
	}
});

test("E1: zeichenweise Eingabe entfernt das Kürzel sichtbar vor Titel und Enter", () => {
	const host = mount("e1-browser-flow", "");
	let field = host.querySelector("[data-btext]");
	setCaret(field);
	typeSequentially(field, "# ");

	field = host.querySelector("[data-btext]");
	assert.equal(host.querySelector("[data-blk]").dataset.btype, "h1");
	assert.equal(field.textContent, "", "das verbrauchte Kürzel darf nicht im fokussierten DOM bleiben");

	typeSequentially(field, "Mein Titel");
	keydown(field, { key: "Enter" });
	const fields = host.querySelectorAll("[data-btext]");
	assert.equal(fields[0].textContent, "Mein Titel");
	assert.equal(fields[1].textContent, "");
	assert.equal(EDITOR.serialize(), "# Mein Titel\n\n");
});

test("E1: Markdown-Kürzel vor vorhandenem Text übernimmt nur den echten Rest", () => {
	const host = mount("e1-existing-suffix", "Vorhanden");
	let field = host.querySelector("[data-btext]");
	setCaret(field, false);
	typeSequentially(field, "# ");

	field = host.querySelector("[data-btext]");
	assert.equal(host.querySelector("[data-blk]").dataset.btype, "h1");
	assert.equal(field.textContent, "Vorhanden");
	assert.equal(EDITOR.serialize(), "# Vorhanden");
});

test("E2: interne Links beider unterstützter Schreibweisen sind im Editor anklickbar", () => {
	const host = mount("e2-links", "[[Andere Notiz]] und [Notiz](#target)", {
		target: { id: "target", title: "Andere Notiz", content: "Ziel" },
	});
	const links = host.querySelectorAll('a[href="#target"]');
	assert.equal(links.length, 2, "Wiki-Link und Markdown-Link sollten dasselbe Ziel erhalten");

	let clickedHref = "";
	document.addEventListener("click", (event) => {
		event.preventDefault();
		clickedHref = event.target.closest("a")?.getAttribute("href") || "";
	}, { once: true });
	links[0].dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
	assert.equal(clickedHref, "#target", "der Link-Klick muss bis zur App-Navigation gelangen");
	assert.equal(EDITOR.serialize(), "[[Andere Notiz]] und [Notiz](#target)", "die gespeicherte Schreibweise bleibt erhalten");
});

test("E3: erstes Undo nach Enter und anschließendem Text entfernt sofort den Text", () => {
	const host = mount("e3-undo", "Alt");
	let field = host.querySelector("[data-btext]");
	setCaret(field);
	keydown(field, { key: "Enter" });

	field = host.querySelectorAll("[data-btext]")[1];
	field.textContent = "Neu";
	setCaret(field);
	field.dispatchEvent(new window.InputEvent("input", { bubbles: true, data: "u", inputType: "insertText" }));
	keydown(field, { key: "z", ctrlKey: true });

	const fields = host.querySelectorAll("[data-btext]");
	assert.equal(fields.length, 2, "die zuvor erzeugte Zeile bleibt nach dem ersten Undo bestehen");
	assert.equal(fields[1].textContent, "", "der danach geschriebene Text wird beim ersten Undo entfernt");
});

test("E4: Block-Kürzel verwenden die physische Zifferntaste trotz Shift-Zeichen", () => {
	const host = mount("e4-shortcut", "Überschrift");
	const field = host.querySelector("[data-btext]");
	setCaret(field);
	const event = keydown(field, { key: "!", code: "Digit1", ctrlKey: true, shiftKey: true });

	assert.equal(event.defaultPrevented, true);
	assert.equal(host.querySelector("[data-blk]").dataset.btype, "h1");
});

test("E5: Fett und Kursiv werden bei vollständiger Auswahl ohne doppelte Marker entfernt", () => {
	for (const { pageId, content, key, expected } of [
		{ pageId: "e5-bold", content: "**Fett**", key: "b", expected: "Fett" },
		{ pageId: "e5-italic", content: "*Kursiv*", key: "i", expected: "Kursiv" },
		{ pageId: "e5-add-italic", content: "**Fett**", key: "i", expected: "***Fett***" },
		{ pageId: "e5-remove-bold", content: "***Beides***", key: "b", expected: "*Beides*" },
		{ pageId: "e5-remove-italic", content: "***Beides***", key: "i", expected: "**Beides**" },
	]) {
		const host = mount(pageId, content);
		const field = host.querySelector("[data-btext]");
		selectField(field);
		keydown(field, { key, ctrlKey: true });
		assert.equal(EDITOR.serialize(), expected);
	}
});
