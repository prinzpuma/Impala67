"use strict";
import { compactEventStore } from "./compact-events.js";
import { loadCompact } from "./compact-core.js";

// Lokale Log-Kompaktierung abseits des UI-Threads. Lesen, Sortieren und Löschen des
// kompletten Event-Logs blockierten die App sonst bei großen Logs über eine Sekunde.
// Der Worker öffnet dieselbe IndexedDB in derselben Version; IndexedDB serialisiert die
// readwrite-Transaktion gegen Schreibzugriffe des Hauptthreads, das Ergebnis ist also
// genauso atomar wie vorher. Antwortet erst nach tx.oncomplete.
// Gerechnet wird im Rust-Kern (compact-core.js); er lädt schon, während die DB öffnet.
const compact = loadCompact();

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
		// Vor der Transaktion abwarten: ein await darin ließe sie automatisch committen.
		const result = await compactEventStore(d, data.minDrop, await compact);
		self.postMessage(result);
	} catch (e) {
		self.postMessage({ error: String(e?.message || e) });
	} finally {
		d?.close();
	}
};
