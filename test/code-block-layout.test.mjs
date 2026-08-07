import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const styles = await readFile(new URL("../web/styles.css", import.meta.url), "utf8");

test("Markdown-Codeblöcke bewahren Einrückung wie ein Code-Editor", () => {
	const rule = styles.match(/\.md pre\s*\{([^}]+)\}/)?.[1] || "";
	assert.match(rule, /white-space:\s*pre\b/);
	assert.match(rule, /text-align:\s*left\b/);
	assert.match(rule, /tab-size:\s*4\b/);
	assert.match(rule, /overflow-x:\s*auto\b/);
	assert.match(rule, /overflow-wrap:\s*normal\b/);
	assert.match(rule, /word-break:\s*normal\b/);
});
