import test from "node:test";
import assert from "node:assert/strict";

import { cooperativeGate } from "../web/cooperative.js";

test("cooperativeGate gibt erst nach verbrauchter Zeitscheibe an den Browser ab", async () => {
	let time = 0, yields = 0;
	const gate = cooperativeGate({ budgetMs: 10, now: () => time, yieldFn: async () => { yields++; } });
	assert.equal(await gate(), false);
	time = 9;
	assert.equal(await gate(), false);
	time = 10;
	assert.equal(await gate(), true);
	assert.equal(yields, 1);
	time = 19;
	assert.equal(await gate(), false);
	time = 20;
	assert.equal(await gate(), true);
	assert.equal(yields, 2);
});
