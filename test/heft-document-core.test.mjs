import test from "node:test";
import assert from "node:assert/strict";

import { blobId, diffDocument, documentShadow } from "../web/heft-document-core.js";

const page = (id, overrides = {}) => ({
	id,
	paper: "lined",
	strokes: [],
	images: [],
	texts: [],
	ocrText: "",
	...overrides,
});

test("Heft-Dokumentkern erzeugt unveränderte Operationsformate", () => {
	const stroke = { id: "s1", pts: [[1, 2], [3, 4]], color: "#000", size: 3 };
	const image = { id: "i1", ref: "blob-1", x: 1, y: 2, w: 3, h: 4 };
	const before = { pages: [page("p1", { strokes: [stroke], images: [image] })] };
	const after = { pages: [
		page("p2", { paper: "grid", ocrText: "neu", texts: [{ id: "x1", text: "Text", x: 4 }] }),
		page("p1", { strokes: [{ ...stroke, size: 5 }] }),
	] };

	assert.deepEqual(diffDocument(documentShadow(before), after), [
		{ t: "pg+", at: 0, page: { id: "p2", paper: "grid" } },
		{ t: "pgo", order: ["p2", "p1"] },
		{ t: "ocr", p: "p2", text: "neu" },
		{ t: "x+", p: "p2", o: { id: "x1", text: "Text", x: 4 } },
		{ t: "s=", p: "p1", o: { ...stroke, size: 5 } },
		{ t: "i-", p: "p1", ids: ["i1"] },
	]);
});

test("Heft-Dokumentkern meldet bei identischem Stand keine Änderung", () => {
	const document = { pages: [page("p1", { strokes: [{ id: "s1", pts: [[1, 2]], color: "#000", size: 3 }] })] };
	assert.deepEqual(diffDocument(documentShadow(document), document), []);
});

test("Blob-ID bleibt kompatibel zum persistierten Heftformat", () => {
	assert.equal(blobId("data:image/png;base64,Impala67"), "bu-bjrp9pptna2v");
});
