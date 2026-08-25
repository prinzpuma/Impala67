import test from "node:test";
import assert from "node:assert/strict";

import { S } from "../web/state.js";
import { DB } from "../web/db.js";
import { EMBEDDINGS } from "../web/embedding.js";
import { RAG } from "../web/rag.js";

test("RAG ignores vectors from another provider with the same model name", async () => {
	const oldAll = DB.allVecs, oldEmbed = EMBEDDINGS.embed, oldPages = S.pages;
	S.settings.embedModel = "shared-model";
	S.settings.embedProviderId = "provider-b";
	S.pages = { p1: { id: "p1", title: "Test", content: "Inhalt", updated: 1 } };
	DB.allVecs = async () => ({
		p1: { model: "shared-model", providerId: "provider-a", chunks: [{ text: "Inhalt", vec: [1, 0], norm: 1 }] },
	});
	EMBEDDINGS.embed = async () => [[1, 0]];
	try {
		assert.deepEqual(await RAG.search("Test"), []);
	} finally {
		DB.allVecs = oldAll;
		EMBEDDINGS.embed = oldEmbed;
		S.pages = oldPages;
	}
});
