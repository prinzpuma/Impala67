import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><body></body>", { url: "http://localhost/" });
for (const key of ["window", "document", "Element", "Node", "HTMLElement", "MutationObserver", "navigator"]) {
	Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
}
Object.defineProperty(globalThis, "localStorage", { value: dom.window.localStorage, configurable: true });
Object.defineProperty(globalThis, "requestAnimationFrame", { value: (fn) => setTimeout(fn, 0), configurable: true });
Object.defineProperty(globalThis, "matchMedia", { value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), configurable: true });

const { EDITOR } = await import("../web/editor.js");

test("Editor erkennt eingefügte \\[…\\]-Blöcke als Display-Formel", () => {
	const blocks = EDITOR.parse(`**Gram-Schmidt:**
\\[
u_k
=
v_k
-
\\sum_{j=1}^{k-1}
\\frac{v_k \\cdot u_j}{u_j \\cdot u_j}\\,u_j
\\]`);

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
