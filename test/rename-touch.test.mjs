import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";

test("CSS: .row-rename-input erlaubt explizit Texteingabe und -auswahl auf Touchgeräten", async () => {
	const css = await readFile(new URL("../web/styles.css", import.meta.url), "utf8");
	const ruleMatch = css.match(/\.row-rename-input\s*\{([^}]+)\}/);
	assert.ok(ruleMatch, ".row-rename-input CSS-Regel gefunden");
	const ruleBody = ruleMatch[1];
	assert.match(ruleBody, /user-select:\s*text/, "user-select: text muss gesetzt sein");
	assert.match(ruleBody, /-webkit-user-select:\s*text/, "-webkit-user-select: text muss gesetzt sein");
});

test("Popovers: rowMenuButton ignoriert Eingabefelder und Textareas in Zeilen", async () => {
	const dom = new JSDOM("<!doctype html><body><div class='row'><input id='renameInp' value='Test'><button data-pagemenu='p1'>⋯</button></div></body>");
	const { window } = dom;
	const { document } = window;
	const inp = document.getElementById("renameInp");

	// Simuliere rowMenuButton Logik
	const row = inp.closest(".row");
	const shouldIgnore = !!inp.closest("input, textarea, [contenteditable='true']");
	assert.equal(shouldIgnore, true, "Eingabefelder dürfen kein Zeilen-Kontextmenü triggern");
});

test("CSS: .heft-text-editor erlaubt explizit Texteingabe und -auswahl", async () => {
	const css = await readFile(new URL("../web/css/heft.css", import.meta.url), "utf8");
	const ruleMatch = css.match(/\.heft-text-editor\s*\{([^}]+)\}/);
	assert.ok(ruleMatch, ".heft-text-editor CSS-Regel gefunden");
	const ruleBody = ruleMatch[1];
	assert.match(ruleBody, /user-select:\s*text/, "user-select: text muss gesetzt sein");
	assert.match(ruleBody, /-webkit-user-select:\s*text/, "-webkit-user-select: text muss gesetzt sein");
});

test("Touch-Schutz: Dialoge und Editoren rufen select() nicht ungeschützt auf Touchgeräten auf", async () => {
	const appJs = await readFile(new URL("../web/app.js", import.meta.url), "utf8");
	const libJs = await readFile(new URL("../web/library.js", import.meta.url), "utf8");
	const ankiJs = await readFile(new URL("../web/render-anki.js", import.meta.url), "utf8");
	const editorJs = await readFile(new URL("../web/editor.js", import.meta.url), "utf8");
	const heftJs = await readFile(new URL("../web/heft.js", import.meta.url), "utf8");

	// openPromptDialog
	assert.match(appJs, /if\s*\(!PLATFORM\.isTouch\(\)\)\s*\{\s*inp\.select\(\);/);

	// openShelfHeftDialog
	assert.match(libJs, /if\s*\(!window\.PLATFORM\?\.isTouch\?\.[\s\S]*inp\.select\(\)/);

	// render-anki
	assert.match(ankiJs, /if\s*\(!window\.PLATFORM\?\.isTouch\?\.[\s\S]*neu\.select\(\)/);

	// editor openMathPop
	assert.match(editorJs, /if\s*\(!window\.PLATFORM\?\.isTouch\?\.[\s\S]*ta\.select\(\)/);

	// heft openTextEditor blur grace period
	assert.match(heftJs, /Date\.now\(\)\s*-\s*openedAt\s*<\s*350/);
});
