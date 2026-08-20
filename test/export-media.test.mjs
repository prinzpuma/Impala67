import test from "node:test";
import assert from "node:assert/strict";

const { DB } = await import("../web/db.js");
const { EXPORT_MEDIA } = await import("../web/export-media.js");

test("Markdown-Export ersetzt lokale Bilder und Dateien durch portable Links", () => {
	const source = "![Skizze](img:abc)\n\n:::file file:def Skript.pdf";
	assert.deepEqual(EXPORT_MEDIA.mediaReferences(source), [
		{ id: "img:abc", name: "Skizze", kind: "image" },
		{ id: "file:def", name: "Skript.pdf", kind: "file" },
	]);
	const out = EXPORT_MEDIA.rewriteMediaReferences(source, new Map([
		["img:abc", "../_assets/Skizze.png"], ["file:def", "../_assets/Skript.pdf"],
	]));
	assert.equal(out, "![Skizze](../_assets/Skizze.png)\n\n[Skript.pdf](../_assets/Skript.pdf)");
});

test("lokale Bilder werden für den PDF-Druck als echte Data-URL eingebettet", async () => {
	const old = DB.getBlob;
	DB.getBlob = async (id) => id === "img:abc" ? { buf: new Uint8Array([1, 2, 3]).buffer, meta: { type: "image/png", name: "grafik.png" } } : null;
	try {
		const out = await EXPORT_MEDIA.inlineLocalImages("![Grafik](img:abc)");
		assert.match(out, /^!\[Grafik\]\(data:image\/png;base64,AQID\)$/);
	} finally { DB.getBlob = old; }
});
