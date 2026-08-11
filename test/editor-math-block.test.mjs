import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><body></body>", { url: "http://localhost/" });
for (const key of ["window", "document", "Element", "Node", "NodeFilter", "HTMLElement", "MutationObserver", "navigator"]) {
	Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
}
Object.defineProperty(globalThis, "localStorage", { value: dom.window.localStorage, configurable: true });
Object.defineProperty(globalThis, "requestAnimationFrame", { value: (fn) => setTimeout(fn, 0), configurable: true });
Object.defineProperty(globalThis, "matchMedia", { value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), configurable: true });
dom.window.Range.prototype.getBoundingClientRect = () => ({ top: 0, right: 0, bottom: 0, left: 0, width: 0, height: 0 });

const { EDITOR } = await import("../web/editor.js");
const { S } = await import("../web/state.js");
const { U } = await import("../web/util.js");

const gramSchmidt = `**Gram-Schmidt:**
\\[
u_k
=
v_k
-
\\sum_{j=1}^{k-1}
\\frac{v_k \\cdot u_j}{u_j \\cdot u_j}\\,u_j
\\]`;

const basiswechsel = `Basiswechsel:

$$
[B_{\\text{Ziel}} \\mid B_{\\text{Start}}] \\xrightarrow{\\text{Gauß}} [I \\mid S]
$$

Darstellungsmatrix \\([f]^B_A\\):Startbasisvektoren \\(v_i\\) abbilden:

$$
f(v_i)
$$

Falls \\(B=\\) Standardbasis: \\(f(v_i)\\) direkt als Spalten eintragen.`;

test("Editor erkennt eingefügte \\[…\\]-Blöcke als Display-Formel", () => {
	const blocks = EDITOR.parse(gramSchmidt);

	assert.equal(blocks.length, 2);
	assert.deepEqual(blocks.map((block) => block.type), ["p", "math"]);
	assert.equal(blocks[0].text, "**Gram-Schmidt:**");
	assert.match(blocks[1].text, /^u_k[\s\S]*\\sum_[\s\S]*\\frac/);
});

test("Editor erkennt einzeilige \\[x\\]-Formeln", () => {
	const [block] = EDITOR.parse("\\[x^2 + y^2\\]");
	assert.equal(block.type, "math");
	assert.equal(block.text, "x^2 + y^2");
});

test("echtes Paste-Event erzeugt sofort Text- und Formelblock", () => {
	document.body.innerHTML = '<div id="editor"></div>';
	S.pages = { paste: { id: "paste", title: "Paste-Test", content: "" } };
	U.ensureKatex = async () => false;
	EDITOR.mount(document.getElementById("editor"), "paste");

	const field = document.querySelector("[data-btext]");
	const event = new window.Event("paste", { bubbles: true, cancelable: true });
	Object.defineProperty(event, "clipboardData", {
		value: { items: [], getData: (type) => type === "text/plain" ? gramSchmidt : "" },
	});
	field.dispatchEvent(event);

	assert.equal(event.defaultPrevented, true);
	assert.deepEqual(
		[...document.querySelectorAll("#editor > .blk")].map((block) => block.dataset.btype),
		["p", "math"],
	);
});

test("echtes Paste-Event rendert \\(…\\) zusammen mit $$…$$", async () => {
	document.body.innerHTML = '<div id="basis-editor"></div>';
	S.pages = { basis: { id: "basis", title: "Basiswechsel", content: "" } };
	const rendered = [];
	U.ensureKatex = async () => true;
	globalThis.katex = { render: (formula, _el, options) => rendered.push({ formula, display: options.displayMode }) };
	EDITOR.mount(document.getElementById("basis-editor"), "basis");

	const field = document.querySelector("[data-btext]");
	const event = new window.Event("paste", { bubbles: true, cancelable: true });
	Object.defineProperty(event, "clipboardData", {
		value: { items: [], getData: (type) => type === "text/plain" ? basiswechsel : "" },
	});
	field.dispatchEvent(event);
	await new Promise((resolve) => setTimeout(resolve, 0));

	assert.equal(event.defaultPrevented, true);
	assert.deepEqual(
		[...document.querySelectorAll("#basis-editor > .blk")].map((block) => block.dataset.btype),
		["p", "math", "p", "math", "p"],
	);
	assert.deepEqual(
		[...document.querySelectorAll("#basis-editor .blk-imath")].map((chip) => chip.dataset.md),
		["\\([f]^B_A\\)", "\\(v_i\\)", "\\(B=\\)", "\\(f(v_i)\\)"],
	);
	assert.deepEqual(
		rendered.filter((item) => !item.display).map((item) => item.formula),
		["[f]^B_A", "v_i", "B=", "f(v_i)"],
	);
});
