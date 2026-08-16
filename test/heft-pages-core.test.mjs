import test from "node:test";
import assert from "node:assert/strict";

import { movePage, insertAt, canDeletePages } from "../web/heft-pages-core.js";

test("Heftseiten lassen sich stabil vorwärts und rückwärts sortieren", () => {
	const pages = [{ id: "a" }, { id: "b" }, { id: "c" }];
	assert.equal(movePage(pages, 0, 2), true);
	assert.deepEqual(pages.map((page) => page.id), ["b", "c", "a"]);
	assert.equal(movePage(pages, 2, 0), true);
	assert.deepEqual(pages.map((page) => page.id), ["a", "b", "c"]);
});

test("Importziele werden an Dokumentgrenzen geklemmt", () => {
	assert.equal(insertAt("start", 4, 8), 0);
	assert.equal(insertAt("before", 4, 8), 4);
	assert.equal(insertAt("after", 4, 8), 5);
	assert.equal(insertAt("end", 4, 8), 8);
});

test("Mehrfachlöschen bewahrt mindestens eine Heftseite", () => {
	assert.equal(canDeletePages(4, 2), true);
	assert.equal(canDeletePages(4, 4), false);
	assert.equal(canDeletePages(1, 1), false);
});
