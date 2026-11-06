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

  // Prüft, ob die alte, ungenutzte Datenbank "notion" (vor der Umbenennung zu impala67) noch im Browser liegt.
  async function checkLegacyDatabase(idb = typeof indexedDB !== "undefined" ? indexedDB : null) {
    if (!idb) return { exists: false };
    if (typeof idb.databases === "function") {
      try {
        const dbs = await idb.databases();
        const hasLegacy = (dbs || []).some((d) => d && d.name === "notion");
        if (!hasLegacy) return { exists: false };
        return { exists: true };
      } catch { /* Fallback auf open-Check */ }
    }
    return new Promise((resolve) => {
      let createdNew = false;
      let req;
      try {
        req = idb.open("notion");
      } catch {
        resolve({ exists: false });
        return;
      }
      req.onupgradeneeded = (e) => {
        createdNew = true;
        try { e.target.transaction.abort(); } catch {}
        resolve({ exists: false });
      };
      req.onsuccess = (e) => {
        if (createdNew) { resolve({ exists: false }); return; }
        const d = e.target.result;
        const stores = Array.from(d?.objectStoreNames || []);
        d?.close();
        resolve({ exists: stores.length > 0, stores });
      };
      req.onerror = () => resolve({ exists: false });
    });
  }

  // Löscht die Alt-Datenbank "notion" restlos aus dem Browser.
  async function deleteLegacyDatabase(idb = typeof indexedDB !== "undefined" ? indexedDB : null) {
    if (!idb) return false;
    return new Promise((resolve, reject) => {
      const req = idb.deleteDatabase("notion");
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error || new Error("Löschen der Alt-Datenbank fehlgeschlagen"));
      req.onblocked = () => resolve(false);
    });
  }

  // Prüft alle CacheStorage-Einträge (Service Worker, Offline-Module, KI).
  async function inspectCaches(cachesObj = typeof caches !== "undefined" ? caches : null) {
    if (!cachesObj?.keys) return { totalBytes: 0, items: [] };
    try {
      const keys = await cachesObj.keys();
      const items = [];
      let totalBytes = 0;
      for (const name of keys) {
        let bytes = 0;
        let count = 0;
        try {
          const c = await cachesObj.open(name);
          const reqs = await c.keys();
          count = reqs.length;
          for (const r of reqs) {
            const res = await c.match(r);
            if (res) {
              const cl = res.headers.get("content-length");
              if (cl) {
                bytes += Number(cl) || 0;
              } else {
                try {
                  const b = await res.blob();
                  bytes += b.size;
                } catch {}
              }
            }
          }
        } catch {}
        totalBytes += bytes;
        let category = "app";
        if (name.includes("transformers")) category = "ai-rag";
        else if (name.includes("handwriting")) category = "handwriting";
        else if (name.includes("optional-modules")) category = "modules";
        else if (name.includes("share")) category = "share";
        items.push({ name, count, bytes, category });
      }
      return { totalBytes, items };
    } catch {
      return { totalBytes: 0, items: [] };
    }
  }

  // Detaillierte Speicher-Aufschlüsselung aller Bereiche.
  async function inspectDetailedStorage({ pages = {}, db = null, state = null, cachesObj = null, idb = null, aliveChecker = null } = {}) {
    let estimate = null;
    if (typeof navigator !== "undefined" && navigator.storage?.estimate) {
      try {
        const est = await navigator.storage.estimate();
        estimate = {
          usageBytes: Number(est?.usage) || 0,
          quotaBytes: Number(est?.quota) || 0,
          usageDetails: est?.usageDetails || null,
        };
      } catch {}
    }

    const legacyDb = await checkLegacyDatabase(idb);

    let eventLog = { count: 0, maxSeq: 0 };
    if (db?.eventLogInfo) {
      try {
        eventLog = await db.eventLogInfo();
      } catch {}
    }

    let blobStats = { total: 0, checkpoints: 0, pdfTexts: 0, files: 0, orphans: 0 };
    if (db?.allBlobKeys) {
      try {
        const keys = await db.allBlobKeys();
        blobStats.total = keys.length;
        const isAlive = typeof aliveChecker === "function" ? aliveChecker : () => true;
        for (const key of keys) {
          const k = String(key || "");
          if (k.startsWith("__impala67_state_checkpoint")) {
            blobStats.checkpoints++;
          } else if (k.startsWith("pdftext:")) {
            blobStats.pdfTexts++;
          } else {
            blobStats.files++;
            if (!isAlive(k)) {
              blobStats.orphans++;
            }
          }
        }
      } catch {}
    }

    let heftStats = { count: 0, totalPages: 0, totalImages: 0, topHefte: [] };
    if (state?.heftIds) {
      try {
        const hIds = state.heftIds() || [];
        heftStats.count = hIds.length;
        const heftList = [];
        for (const id of hIds) {
          const meta = state.heftMeta?.(id) || null;
          const refs = state.heftImageRefs?.(id) || [];
          const page = pages?.[id];
          const title = page?.title || "Unbenanntes Heft";
          const pCount = meta?.pages ?? (Array.isArray(state.heftPageIds?.(id)) ? state.heftPageIds(id).length : 0);
          const imgCount = refs.length;
          heftStats.totalPages += pCount;
          heftStats.totalImages += imgCount;
          heftList.push({ id, title, pages: pCount, images: imgCount, bytes: meta?.bytes || 0 });
        }
        heftList.sort((a, b) => (b.images - a.images) || (b.pages - a.pages) || (b.bytes - a.bytes));
        heftStats.topHefte = heftList.slice(0, 5);
      } catch {}
    }

    const pdfRows = collectPdfPages(pages);
    const pdfTotalKb = pdfRows.reduce((sum, r) => sum + (r.kb || 0), 0);
    const pdfStats = {
      count: pdfRows.length,
      totalMb: Math.round(pdfTotalKb / 1024),
      top: pdfRows.slice(0, 5),
    };

    const cacheStats = await inspectCaches(cachesObj);

    return {
      estimate,
      legacyDb,
      eventLog,
      blobStats,
      heftStats,
      pdfStats,
      cacheStats,
    };
  }

  return {
    collectPdfPages,
    storageReport,
    buildDetachPatch,
    checkLegacyDatabase,
    deleteLegacyDatabase,
    inspectCaches,
    inspectDetailedStorage,
  };
})();
