"use strict";
import { compactEvents } from "./compact-events.js";

// Lokale Log-Kompaktierung abseits des UI-Threads. Lesen, Sortieren und Löschen des
// kompletten Event-Logs blockierten die App sonst bei großen Logs über eine Sekunde.
// Der Worker öffnet dieselbe IndexedDB in derselben Version; IndexedDB serialisiert die
// readwrite-Transaktion gegen Schreibzugriffe des Hauptthreads, das Ergebnis ist also
// genauso atomar wie vorher. Antwortet erst nach tx.oncomplete.
function openDb(name, version) {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(name, version);
		// Anlegen/Migrieren bleibt Sache des Hauptthreads.
		req.onupgradeneeded = () => { req.transaction.abort(); };
		req.onsuccess = () => {
			const d = req.result;
			d.onversionchange = () => d.close();
			resolve(d);
		};
		req.onerror = () => reject(req.error);
		req.onblocked = () => reject(new Error("IndexedDB blockiert."));
	});
}

self.onmessage = async ({ data }) => {
	let d = null;
	try {
		d = await openDb(data.name, data.version);
		const result = await new Promise((resolve, reject) => {
			const tx = d.transaction("events", "readwrite"), store = tx.objectStore("events");
			const req = store.getAll();
			let dropped = 0, floor = "";
			req.onsuccess = () => {
				const evs = req.result || [], compacted = compactEvents(evs);
				dropped = evs.length - compacted.length;
				if (dropped < data.minDrop) { dropped = 0; return; }
				const keep = new Set(compacted.map((ev) => ev.seq));
				for (const ev of evs) if (!keep.has(ev.seq)) store.delete(ev.seq);
				floor = compacted.length ? compacted[0].t : "";
			};
			req.onerror = () => { try { tx.abort(); } catch {} };
			tx.oncomplete = () => resolve({ dropped, floor });
			tx.onerror = tx.onabort = () => reject(tx.error || req.error || new Error("Kompaktierung abgebrochen."));
		});
		self.postMessage(result);
	} catch (e) {
		self.postMessage({ error: String(e?.message || e) });
	} finally {
		d?.close();
	}
};
