import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
if (!globalThis.crypto) globalThis.crypto = webcrypto;

import { CLOUD_SYNC_PROTOCOL, chunkCloudEvents, cloudEventsEnvelope, prepareCloudEvents, prepareIncomingCloudEvents, pruneEventsForUpload, isBlobAlive, isSyncBlobId, heftBaselineOps } from "../web/sync-core.js";
import { deriveSyncCredentials, encryptPayload, decryptPayload, encryptBlobRecord, decryptBlobRecord, generateSyncKey } from "../web/sync-crypto.js";

test("protocol v4 rejects legacy cloud payloads", () => {
	assert.equal(CLOUD_SYNC_PROTOCOL, 4);
	assert.throws(() => prepareIncomingCloudEvents([{ v: 3, event: { id: "old", t: "x", type: "pageCreate" } }]), /v4/);
});

test("cloud transport never echoes cloud events or drops heftOps", () => {
	const local = { id: "a", t: "1", type: "heftOps", payload: { pageId: "p", ops: [] } };
	const remote = { id: "b", t: "2", type: "pageUpdate", _remoteSource: "cloudflare", payload: {} };
	assert.deepEqual(prepareCloudEvents([local, remote]).map((e) => e.id), ["a"]);
	assert.deepEqual(prepareCloudEvents([local, remote], { includeRemote: true }).map((e) => e.id), ["a", "b"]);
	assert.deepEqual(pruneEventsForUpload([local, { id: "ui", type: "uiTabsSet" }]).map((e) => e.id), ["a"]);
});

test("event chunks stay deterministic", () => {
	const events = Array.from({ length: 501 }, (_, i) => ({ id: String(i), t: String(i), type: "x" }));
	assert.deepEqual(chunkCloudEvents(events, { maxEvents: 250 }).map((c) => c.length), [250, 250, 1]);
	assert.equal(cloudEventsEnvelope(events.slice(0, 1)).v, 4);
});

test("json and binary E2EE round-trip", async () => {
	const credentials = await deriveSyncCredentials(generateSyncKey());
	const packet = await encryptPayload(credentials.cryptoKey, { hello: "world", text: "x".repeat(100000) });
	assert.deepEqual(await decryptPayload(credentials.cryptoKey, packet), { hello: "world", text: "x".repeat(100000) });
	const raw = new TextEncoder().encode("PDF bytes").buffer;
	const blob = await encryptBlobRecord(credentials.cryptoKey, "file:abc", { buf: raw, meta: { type: "application/pdf" } });
	const decoded = await decryptBlobRecord(credentials.cryptoKey, blob.iv, blob.bytes);
	assert.equal(decoded.id, "file:abc");
	assert.equal(decoded.meta.type, "application/pdf");
	assert.equal(new TextDecoder().decode(decoded.buf), "PDF bytes");
});

test("only immutable attachment ids are cloud blob candidates", () => {
	assert.equal(isSyncBlobId("img:123"), true);
	assert.equal(isSyncBlobId("file:123"), true);
	assert.equal(isSyncBlobId("pdftext:123"), true);
	assert.equal(isSyncBlobId("bgImage"), false);
	assert.equal(isSyncBlobId("heftver:x"), false);
});

test("blob sync follows live page references and does not resurrect orphans", () => {
	const pages = { p: { id: "p", pdfId: "11111111-2222-3333-4444-555555555555", coverImg: "cover:c1", content: "![x](img:i1)\n:::file file:f1 Datei" } };
	assert.equal(isBlobAlive("11111111-2222-3333-4444-555555555555", pages), true);
	assert.equal(isBlobAlive("pdftext:11111111-2222-3333-4444-555555555555", pages), true);
	assert.equal(isBlobAlive("cover:c1", pages), true);
	assert.equal(isBlobAlive("img:i1", pages), true);
	assert.equal(isBlobAlive("file:f1", pages), true);
	assert.equal(isBlobAlive("img:orphan", pages), false);
});

test("notebook baseline preserves complete current document without snapshots", () => {
	const doc = { pages: [{ id:"p1", paper:"grid", ocrText:"Text", strokes:[{id:"s1",pts:[[1,2]]}], images:[{id:"i1",ref:"blob"}], texts:[{id:"t1",text:"Hallo"}] }] };
	const ops = heftBaselineOps(doc);
	assert.deepEqual(ops.map((op) => op.t), ["pg+","pgo","ocr","s+","i+","x+"]);
	assert.equal(ops.find((op) => op.t === "i+").o.ref, "blob");
});
