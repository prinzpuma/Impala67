import test from "node:test";
import assert from "node:assert/strict";

import {
	STATE_CHECKPOINT_KEYS,
	checkpointStateStats,
	eventLogInfoOf,
	isUsableStateCheckpoint,
	makeStateCheckpoint,
} from "../web/state-checkpoint.js";

const state = () => Object.fromEntries(STATE_CHECKPOINT_KEYS.map((key) => [key, key.endsWith("Id") ? null : {}]));

test("Checkpoint akzeptiert nur einen lückenlosen, zeitlich nachfolgenden Event-Tail", () => {
	const base = [{ seq: 1, id: "a", t: "2026-08-26T10:00:00.000Z" }];
	const checkpoint = makeStateCheckpoint(state(), eventLogInfoOf(base), base[0].t);
	const tail = [{ seq: 2, id: "b", t: "2026-08-26T10:01:00.000Z" }];
	assert.equal(isUsableStateCheckpoint(checkpoint, { count: 2, maxSeq: 2, lastEventId: "b" }, base[0], tail), true);
	assert.equal(isUsableStateCheckpoint(checkpoint, { count: 3, maxSeq: 2, lastEventId: "b" }, base[0], tail), false, "gelöschte/fehlende Events dürfen nicht verborgen werden");
	assert.equal(isUsableStateCheckpoint(checkpoint, { count: 2, maxSeq: 2, lastEventId: "b" }, { ...base[0], id: "falsch" }, tail), false);
	assert.equal(isUsableStateCheckpoint(checkpoint, { count: 2, maxSeq: 2, lastEventId: "b" }, base[0], [{ ...tail[0], t: "2026-08-25T10:00:00.000Z" }]), false,
		"ältere Fremd-Events erzwingen den deterministischen Voll-Replay");
});

test("Checkpoint-Statistik misst große Heftdaten ohne Serialisierung", () => {
	const value = state();
	value.pages = { a: {}, b: {} };
	value.cards = { c: {} };
	value.chatSessions = { chat: {} };
	value.heftDocs = { h: { pages: [{}, {}] } };
	value.heftBlobs = { x: "abc", y: "12345" };
	assert.deepEqual(checkpointStateStats(value), {
		pageCount: 2,
		cardCount: 1,
		chatSessionCount: 1,
		heftDocCount: 1,
		heftPageCount: 2,
		heftBlobCount: 2,
		heftBlobChars: 8,
	});
});
