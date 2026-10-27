"use strict";
// Log-Kompaktierung im Rust-Kern (core/impala-sync compact.rs): verlustfrei und deterministisch
// (drop-only), damit der Log-Merge konsistent bleibt, auch wenn Geräte zu unterschiedlichen
// Zeitpunkten kompaktieren. Regeln (Patches, die neuere vollständig überschreiben; Updates
// gelöschter Seiten/Karten; UI-Zustand; Chat-/Artikel-Schnappschüsse; Seitenverlauf; nicht mehr
// referenzierte Heft-Bilder) siehe dort. db.js (Sync/Export) und compact-worker.js nutzen dies.
import { CORE } from "./rust-core.js";

const byLogOrder = (a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0) || (a.seq || 0) - (b.seq || 0);

// Behaltene Events in Log-Reihenfolge. Hat ein Event eine Form, die der Kern nicht sicher
// beurteilen kann, wird diesmal nichts verworfen (verlustfrei, nur größer).
export function compactEvents(events) {
	try {
		return Array.from(CORE.compactOrder(events), (i) => events[i]);
	} catch (error) {
		console.warn("Kompaktierung übersprungen:", error?.message || error);
		return [...events].sort(byLogOrder);
	}
}

// Kompaktiert den events-Store in EINER readwrite-Transaktion (Hauptthread oder compact-worker.js).
// Das Event mit der höchsten seq bleibt immer: DB.maxSeq() ist der Wasserstand für Upload-Cursor
// und Start-Checkpoint. Sänke er, hielte der Cloudflare-Push den Log für zurückgesetzt und lüde
// alles neu hoch. Ein zusätzlich behaltenes Event ist harmlos, der Log bleibt eine Obermenge.
export function compactEventStore(db, minDrop) {
	return new Promise((resolve, reject) => {
		const tx = db.transaction("events", "readwrite"), store = tx.objectStore("events");
		const req = store.getAll();
		let dropped = 0, floor = "";
		req.onsuccess = () => {
			const evs = req.result || [], compacted = compactEvents(evs);
			if (evs.length - compacted.length < minDrop) return;
			const keep = new Set(compacted.map((ev) => ev.seq));
			keep.add(evs.reduce((top, ev) => Math.max(top, ev.seq || 0), 0));
			for (const ev of evs) if (!keep.has(ev.seq)) { store.delete(ev.seq); dropped++; }
			floor = compacted.length ? compacted[0].t : "";
		};
		req.onerror = () => { try { tx.abort(); } catch {} };
		tx.oncomplete = () => resolve({ dropped, floor });
		tx.onerror = tx.onabort = () => reject(tx.error || req.error || new Error("Kompaktierung abgebrochen."));
	});
}
