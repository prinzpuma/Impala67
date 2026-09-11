import test from "node:test";
import assert from "node:assert/strict";

import { STORAGE_TOOLS } from "../web/storage-tools.js";

test("parseSizeKb versteht KB und MB (de-DE)", () => {
  assert.equal(STORAGE_TOOLS.parseSizeKb("> 📄 **a.pdf** · 244310 KB"), 244310);
  assert.equal(STORAGE_TOOLS.parseSizeKb("x · 57,4 MB"), Math.round(57.4 * 1024));
  assert.equal(STORAGE_TOOLS.parseSizeKb("ohne Angabe"), 0);
});

test("collectPdfPages sortiert größte zuerst", () => {
  const rows = STORAGE_TOOLS.collectPdfPages({
    a: { id: "a", title: "📄 klein", content: "· 100 KB", pdfId: "p1" },
    b: { id: "b", title: "📄 groß", content: "· 50 MB", pdfId: "p2" },
    c: { id: "c", title: "Normale Notiz", content: "Hallo" },
  });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].id, "b");
});

test("buildDetachPatch löst pdfId und behält Inhalt", () => {
  const r = STORAGE_TOOLS.buildDetachPatch({ id: "x", content: "Zusammenfassung", pdfId: "pdf-1" });
  assert.equal(r.pdfId, "pdf-1");
  assert.equal(r.patch.pdfId, null);
  assert.match(r.patch.content, /Zusammenfassung/);
  assert.match(r.patch.content, /ausgelagert/);
  assert.equal(STORAGE_TOOLS.buildDetachPatch({ id: "y", content: "x" }), null);
});

test("storageReport summiert Gesamtgröße", () => {
  const rep = STORAGE_TOOLS.storageReport({
    a: { id: "a", title: "📄 a", content: "· 1024 KB", pdfId: "p1" },
    b: { id: "b", title: "📄 b", content: "· 1024 KB", pdfId: "p2" },
  });
  assert.equal(rep.count, 2);
  assert.equal(rep.totalMB, 2);
});
