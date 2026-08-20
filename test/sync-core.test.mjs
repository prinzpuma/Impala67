import test from "node:test";
import assert from "node:assert/strict";

import { boundedKnownIds, cloudEventEnvelope, decodeJson, encodeJson, isBlobAlive, newestFile, prepareCloudEvents, prepareIncomingCloudEvents, pruneEventsForUpload, shouldUploadDelta, unseenRemoteFiles } from "../web/sync-core.js";
import { DB } from "../web/db.js";
import { U } from "../web/util.js";

test("Delta wird nur bei neuen lokalen Sequenzen hochgeladen", () => {
	assert.equal(shouldUploadDelta(12, 11), true);
	assert.equal(shouldUploadDelta(12, 12), false);
	assert.equal(shouldUploadDelta(0, 0), false);
});

test("Bereits bekannte Remote-Dateien werden übersprungen", () => {
	const files = [{ id: "a" }, { id: "b" }, { id: "c" }];
	assert.deepEqual(unseenRemoteFiles(files, new Set(["b"])).map((f) => f.id), ["a", "c"]);
});

test("Snapshot-Auswahl nimmt den neuesten erlaubten Stand", () => {
	const files = [
		{ id: "old", name: "snapshot.json", modifiedTime: "2026-01-01T00:00:00Z" },
		{ id: "new", name: "snapshot.json", modifiedTime: "2026-02-01T00:00:00Z" },
		{ id: "other", name: "unrelated.json", modifiedTime: "2026-03-01T00:00:00Z" },
	];
	assert.equal(newestFile(files, ["snapshot.json"]).id, "new");
});

test("Bekannte IDs bleiben begrenzt und doppelte IDs verschwinden", () => {
	assert.deepEqual(boundedKnownIds(["a", "b", "a", "c"], 2), ["b", "c"]);
});

test("JSON-Pakete lassen sich komprimiert und unkomprimiert zurücklesen", async () => {
	const value = { app: "impala67", events: [{ id: "1", text: "Hallo" }] };
	const packed = await encodeJson(value);
	assert.deepEqual(await decodeJson(packed.bytes, packed.encoding), value);
	const raw = new TextEncoder().encode(JSON.stringify(value));
	assert.deepEqual(await decodeJson(raw, "identity"), value);
});

test("Drei-Wege-Merge verbindet getrennte Änderungen", () => {
	const result = DB.merge3("a\nb\nc", "A\nb\nc", "a\nb\nC");
	assert.equal(result.ok, true);
	assert.equal(result.text, "A\nb\nC");
});

test("Drei-Wege-Merge meldet echte Überlappung als Konflikt", () => {
	const result = DB.merge3("a\nb\nc", "A\nb\nc", "B\nb\nc");
	assert.equal(result.ok, false);
});

test("Log-Kompaktierung bewahrt Nutzungsstatistiken und den aktuellen Fachstand", () => {
	const at = (day) => `2025-01-${String(day).padStart(2, "0")}T12:00:00.000Z`;
	const events = [
		{ id: "page", t: at(1), type: "pageCreate", payload: { id: "p1", title: "Alt", content: "Ausgang" } },
		{ id: "old-title", t: at(2), type: "pageUpdate", payload: { id: "p1", patch: { title: "Zwischenstand" } } },
		{ id: "new-title", t: at(3), type: "pageUpdate", payload: { id: "p1", patch: { title: "Aktuell" } } },
		{ id: "old-tabs", t: at(4), type: "uiTabsSet", payload: { tabs: ["alt"] } },
		{ id: "new-tabs", t: at(5), type: "uiTabsSet", payload: { tabs: ["aktuell"] } },
		{ id: "tele-old", t: "2020-01-01T12:00:00.000Z", type: "teleEvent", payload: { kind: "study", seconds: 60 } },
	];
	const compacted = DB.compactEvents(events);
	const ids = compacted.map((event) => event.id);

	assert.ok(ids.includes("tele-old"), "alte Nutzungsstatistiken dürfen nicht verfallen");
	assert.ok(ids.includes("new-title"), "der aktuelle Seitenstand muss erhalten bleiben");
	assert.ok(ids.includes("new-tabs"), "der aktuelle UI-Stand muss erhalten bleiben");
	assert.ok(!ids.includes("old-title"), "vollständig überschriebene Zwischenstände dürfen entfallen");
	assert.ok(!ids.includes("old-tabs"), "veraltete UI-Zwischenstände dürfen entfallen");
	assert.equal(DB.DROPPABLE_TYPES.has("teleEvent"), false, "Statistiken dürfen auch beim späteren Import nicht als verfallen gelten");
});

test("Drive-Transport bewahrt alte Nutzungsstatistiken", () => {
	const events = [
		{ id: "tele-old", seq: 1, t: "2020-01-01T12:00:00.000Z", type: "teleEvent", payload: { kind: "study", seconds: 60 } },
		{ id: "tabs", seq: 2, type: "uiTabsSet", payload: {} },
		{ id: "stroke", seq: 3, type: "heftOps", payload: { pageId: "h1", ops: [] } },
		{ id: "snapshot", seq: 4, type: "heftSnap", payload: { pageId: "h1", doc: { pages: [] } } },
	];
	assert.deepEqual(pruneEventsForUpload(events).map((event) => event.id), ["tele-old", "snapshot"]);
});

test("Cloud-Wireformat entfernt lokale Sequenzen und verhindert Remote-Echos", () => {
	const local = { id: "local", seq: 501, type: "pageUpdate", _derived: true, payload: { id: "p1" } };
	const remote = { id: "remote", seq: 501, type: "pageUpdate", _remote: true, payload: { id: "p2" } };
	assert.deepEqual(prepareCloudEvents([local, remote]), [{ id: "local", type: "pageUpdate", payload: { id: "p1" } }]);
	assert.deepEqual(prepareCloudEvents([remote], { includeRemote: true }), [{ id: "remote", type: "pageUpdate", payload: { id: "p2" } }]);
	assert.equal(local.seq, 501, "Quelldaten bleiben unverändert");
});

test("Cloud-Empfang akzeptiert nur Protokoll v2 ohne lokale Metadaten", () => {
	assert.deepEqual(prepareIncomingCloudEvents([cloudEventEnvelope({ id: "remote", type: "pageCreate" })]), [
		{ id: "remote", type: "pageCreate", _remote: true },
	]);
	assert.throws(() => prepareIncomingCloudEvents([{ id: "legacy", type: "pageCreate" }]), /Protokoll v2/);
	assert.throws(() => prepareIncomingCloudEvents([cloudEventEnvelope({ id: "bad", seq: 501, type: "pageCreate" })]), /lokale Metadaten/);
});

test("Geräteablage bleibt bei fehlendem localStorage fehlertolerant", () => {
	assert.equal(U.storage.get("missing", "fallback"), "fallback");
	assert.equal(U.storage.set("key", "value"), false);
	assert.equal(U.storage.remove("key"), false);
	assert.deepEqual(U.storage.getJson("json", { ok: true }), { ok: true });
});

test("Blob-GC erkennt Cover, PDF, eingebettete Bilder und Alt-Strukturen korrekt", () => {
	const pdfUuid = "11111111-2222-3333-4444-555555555555";
	const imgUuid = "66666666-7777-8888-9999-000000000000";
	const orphanUuid = "99999999-9999-9999-9999-999999999999";

	const pages = {
		p1: { id: "p1", title: "PDF Notiz", pdfId: pdfUuid, cover: "cover:c1" },
		p2: { id: "p2", title: "Bild Notiz", content: `Hier ist ein Bild: ![foto](${imgUuid})` },
		p3: { id: "p3", title: "Heft Notiz", kind: "heft" },
	};

	// 1. Heft-Blob
	assert.equal(isBlobAlive("heft:p3", pages), true);
	assert.equal(isBlobAlive("heft:ghost", pages), false);

	// 2. PDF & PDF-Text Blobs
	assert.equal(isBlobAlive(pdfUuid, pages), true);
	assert.equal(isBlobAlive(`pdftext:${pdfUuid}`, pages), true);

	// 3. Eingebettetes Bild in Notizinhalt (Substring)
	assert.equal(isBlobAlive(imgUuid, pages), true);

	// 4. Cover-Bild Blobs
	assert.equal(isBlobAlive("cover:c1", pages), true);

	// 5. Fail-Safe: Spezialschlüssel & Alt-Strukturen nie löschen
	assert.equal(isBlobAlive("bgImage", pages), true);
	assert.equal(isBlobAlive("heftver:p3:123:1", pages), true);

	// 6. Verwaiste UUID ohne Referenz
	assert.equal(isBlobAlive(orphanUuid, pages), false);
});
