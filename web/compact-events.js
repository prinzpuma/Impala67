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
// blobKeep = { live: [Bild-Hashes, die ein Heft gerade zeigt], since: ISO-Zeit der Schonfrist }:
// dann fallen auch Bilder weg, die keine Heftseite mehr zeigt (sonst blieben sie für immer).
export function compactEvents(events, blobKeep = null) {
	try {
		const order = blobKeep ? CORE.compactOrder(events, blobKeep.live, blobKeep.since) : CORE.compactOrder(events);
		return Array.from(order, (i) => events[i]);
	} catch (error) {
		console.warn("Kompaktierung übersprungen:", error?.message || error);
		return [...events].sort(byLogOrder);
	}
}

// Kompaktiert den events-Store in EINER readwrite-Transaktion (Hauptthread oder compact-worker.js).
// Das Event mit der höchsten seq bleibt immer: DB.maxSeq() ist der Wasserstand für Upload-Cursor
// und Start-Checkpoint. Sänke er, hielte der Cloudflare-Push den Log für zurückgesetzt und lüde
// alles neu hoch. Ein zusätzlich behaltenes Event ist harmlos, der Log bleibt eine Obermenge.
// droppedBlobs: Hashes weggefallener Heft-Bilder (der geladene Zustand vergisst sie dann).
export function compactEventStore(db, minDrop, blobKeep = null) {
	return new Promise((resolve, reject) => {
		const tx = db.transaction("events", "readwrite"), store = tx.objectStore("events");
		const req = store.getAll();
		let dropped = 0, floor = "";
		const droppedBlobs = [];
		req.onsuccess = () => {
			const evs = req.result || [], compacted = compactEvents(evs, blobKeep);
			if (evs.length - compacted.length < minDrop) return;
			const keep = new Set(compacted.map((ev) => ev.seq));
			keep.add(evs.reduce((top, ev) => Math.max(top, ev.seq || 0), 0));
			for (const ev of evs) if (!keep.has(ev.seq)) {
				store.delete(ev.seq);
				dropped++;
				if (ev.type === "heftBlob" && ev.payload?.hash) droppedBlobs.push(String(ev.payload.hash));
			}
			floor = compacted.length ? compacted[0].t : "";
		};
		req.onerror = () => { try { tx.abort(); } catch {} };
		tx.oncomplete = () => resolve({ dropped, droppedBlobs, floor });
		tx.onerror = tx.onabort = () => reject(tx.error || req.error || new Error("Kompaktierung abgebrochen."));
	});
}
