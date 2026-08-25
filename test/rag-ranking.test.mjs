import test from "node:test";
import assert from "node:assert/strict";

import { rankRag } from "../web/rag-ranking.js";

test("RAG-Ranking kombiniert Semantik und exakte Fachbegriffe deterministisch", () => {
	const hits = rankRag({
		query: "ATP-Synthase",
		qv: [1, 0],
		model: "m",
		providerId: "p",
		k: 2,
		pages: {
			exact: { title: "ATP-Synthase" },
			semantic: { title: "Zellatmung" },
		},
		vecs: {
			exact: { model: "m", providerId: "p", chunks: [{ text: "ATP-Synthase und Protonengradient", vec: [0, 1], norm: 1 }] },
			semantic: { model: "m", providerId: "p", chunks: [{ text: "Energiegewinnung im Mitochondrium", vec: [0.6, 0.8], norm: 1 }] },
		},
	});
	assert.equal(hits[0].title, "ATP-Synthase");
	assert.equal(hits[0].score, 0.8);
	assert.equal(hits[1].semanticScore, 0.6);
});

test("RAG-Ranking verwirft Papierkorb und fremde Provider", () => {
	const hits = rankRag({
		query: "Test",
		qv: [1, 0],
		model: "m",
		providerId: "wanted",
		pages: { trash: { title: "Trash", trashed: true }, foreign: { title: "Fremd" } },
		vecs: {
			trash: { model: "m", providerId: "wanted", chunks: [{ text: "Test", vec: [1, 0], norm: 1 }] },
			foreign: { model: "m", providerId: "other", chunks: [{ text: "Test", vec: [1, 0], norm: 1 }] },
		},
	});
	assert.deepEqual(hits, []);
});
