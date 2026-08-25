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
const { HEFT } = await import("../web/heft.js");
const { S } = await import("../web/state.js");

function typeInto(field, value) {
	field.textContent = value;
	field.focus();
	const range = document.createRange();
	range.selectNodeContents(field);
	range.collapse(false);
	const selection = window.getSelection();
	selection.removeAllRanges();
	selection.addRange(range);
	field.dispatchEvent(new window.InputEvent("input", { bubbles: true, data: value.slice(-1), inputType: "insertText" }));
}

test("Slash-Menü bleibt beim Filtern stabil und entfernt den Slash auch aus dem fokussierten DOM", async () => {
	document.body.innerHTML = "<div id='editor'></div>";
	S.pages = { slash: { id: "slash", title: "Slash", content: "", workspaceId: "default" } };
	EDITOR.mount(document.getElementById("editor"), "slash");
	const field = document.querySelector("[data-btext]");

	typeInto(field, "/");
	const firstMenu = document.querySelector(".blk-slashmenu");
	assert.ok(firstMenu);

	typeInto(field, "/t");
	assert.equal(document.querySelector(".blk-slashmenu"), firstMenu);

	firstMenu.querySelector('[data-slashpick="p"]').click();
	await new Promise((resolve) => setTimeout(resolve, 0));
	assert.equal(document.querySelector("[data-btext]").textContent, "");
	assert.equal(EDITOR.serialize(), "");
});

test("Heft-Einbettung ist hydrierbar und ersetzt die doppelte Unterseitenzeile", () => {
	document.body.innerHTML = "<div id='editor'></div>";
	S.pages = {
		parent: { id: "parent", title: "Notiz", content: ":::heft child", workspaceId: "default" },
		child: { id: "child", title: "Mein Heft", content: "", kind: "heft", parentId: "parent", workspaceId: "default" },
	};
	const hydrate = HEFT.hydrateEmbeds;
	HEFT.hydrateEmbeds = () => {};
	try { EDITOR.mount(document.getElementById("editor"), "parent"); }
	finally { HEFT.hydrateEmbeds = hydrate; }

	assert.ok(document.querySelector('.blk-heft[data-heftembed="child"][data-page="child"]'));
	assert.equal(document.querySelector('.child-page-row[data-page="child"]'), null);
});
