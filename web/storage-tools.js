"use strict";
// web/storage-tools.js — Speicher-Analyse & PDF-Auslagern (klein, testbar, ohne DOM).
// Hintergrund: Cloud-Blobs (R2) sind unveränderlich — erst Auslagern (pdfId lösen)
// + Generation-Reset (compactCloudData) gibt Cloud-Quota wirklich frei.
export const STORAGE_TOOLS = (() => {
  function parseSizeKb(content) {
    const m = String(content || "").match(/·\s*([\d.,]+)\s*(KB|MB)/i);
    if (!m) return 0;
    const n = parseFloat(m[1].replace(/\./g, "").replace(",", ".").replace(/(\d) (\d)/g, "$1$2"));
    // de-DE: "57,4 MB" oder "57.434 KB" — robust: letztes Trennzeichen ist Dezimalzeichen
    const raw = m[1].trim();
    const lastDot = raw.lastIndexOf("."), lastComma = raw.lastIndexOf(",");
    const decPos = Math.max(lastDot, lastComma);
    let num = NaN;
    if (decPos === -1) num = parseFloat(raw.replace(/[^\d]/g, ""));
    else {
      const int = raw.slice(0, decPos).replace(/[^\d]/g, "");
      const frac = raw.slice(decPos + 1).replace(/[^\d]/g, "");
      num = parseFloat(int + "." + frac);
    }
    if (!Number.isFinite(num)) num = Number.isFinite(n) ? n : 0;
    return Math.round(/MB/i.test(m[2]) ? num * 1024 : num);
  }

  function isPdfPage(p) {
    if (!p || p.trashed) return false;
    return !!(p.pdfId || (p.title || "").startsWith("📄") || (p.content || "").includes(".pdf"));
  }

  function collectPdfPages(pages) {
    const rows = [];
    for (const p of Object.values(pages || {})) {
      if (!isPdfPage(p)) continue;
      rows.push({ id: p.id, title: p.title || "Ohne Titel", kb: parseSizeKb(p.content), pdfId: p.pdfId || null, parentId: p.parentId || null });
    }
    rows.sort((a, b) => b.kb - a.kb);
    return rows;
  }

  function storageReport(pages, usage) {
    const rows = collectPdfPages(pages);
    const totalKb = rows.reduce((s, r) => s + (r.kb || 0), 0);
    return {
      count: rows.length,
      totalMB: Math.round(totalKb / 1024),
      top: rows.slice(0, 15),
      usage: usage || null,
      hint: "Auslagern behält Zusammenfassung + Volltext, löscht nur das PDF-Binär. Erst danach gibt ein Generation-Reset (compactCloudData) Cloud-Quota frei.",
    };
  }

  // Patch zum Auslagern: pdfId lösen, Hinweis an den Inhalt hängen.
  // Der pdftext:-Blob (KB-groß, für RAG/Suche) bleibt bewusst erhalten.
  function buildDetachPatch(page) {
    if (!page || !page.pdfId) return null;
    const note = "\n\n> 🗄️ _Original-PDF ausgelagert (Speicher freigegeben). Zusammenfassung & Volltext bleiben durchsuchbar._";
    const content = (page.content || "") + (String(page.content || "").includes("ausgelagert") ? "" : note);
    return { patch: { pdfId: null, content }, pdfId: page.pdfId };
  }

  return { parseSizeKb, isPdfPage, collectPdfPages, storageReport, buildDetachPatch };
})();
