import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Heft-Global und Heft-Ansicht verwenden dieselbe Modulinstanz", async () => {
	const main = await readFile(new URL("../web/main.js", import.meta.url), "utf8");
	assert.match(main, /import \{ HEFT \} from "\.\/heft\.js";/);
	assert.doesNotMatch(main, /import \{ HEFT \} from "\.\/heft\.js\?/);
});
