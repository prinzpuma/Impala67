"use strict";

import { buildRagIndex, rankRag } from "./rag-ranking.js";

let dbPromise = null, vecCacheAt = 0, vecCacheIdentity = "";

function openDb() {
	dbPromise ??= new Promise((resolve, reject) => {
		const req = indexedDB.open("impala67");
		req.onsuccess = () => {
			const db = req.result;
			db.onversionchange = () => { db.close(); dbPromise = null; dropIndex(); };
			resolve(db);
		};
		req.onerror = () => reject(req.error);
	}).catch((error) => { dbPromise = null; throw error; });
	return dbPromise;
}

// Der Rust-Index bleibt zwischen Anfragen bestehen; neu gebaut nach eigenem Re-Index
// (invalidate), Herkunftswechsel oder nach 30 s (Änderungen aus anderen Tabs und vom Sync).
let built = null;
function dropIndex() {
	built?.index.free();
	built = null;
}

async function loadIndex(msg) {
	if (built && vecCacheIdentity === msg.identity && Date.now() - vecCacheAt <= 30000) return built;
	const db = await openDb();
	const rows = await new Promise((resolve, reject) => {
		const store = db.transaction("vecs").objectStore("vecs");
		const keysReq = store.getAllKeys(), valuesReq = store.getAll();
		let keys = null, values = null;
		const done = () => { if (keys && values) resolve(keys.map((key, i) => [key, values[i]])); };
		keysReq.onsuccess = () => { keys = keysReq.result; done(); };
		valuesReq.onsuccess = () => { values = valuesReq.result; done(); };
		keysReq.onerror = valuesReq.onerror = () => reject(keysReq.error || valuesReq.error);
	});
	dropIndex();
	built = buildRagIndex(Object.fromEntries(rows), msg.model, msg.providerId);
	vecCacheAt = Date.now();
	vecCacheIdentity = msg.identity;
	return built;
}

self.addEventListener("message", async (event) => {
	const msg = event.data || {};
	if (msg.type === "invalidate") { dropIndex(); return; }
	if (msg.type !== "search" || !msg.id) return;
	try {
		self.postMessage({ type: "result", id: msg.id, hits: rankRag(await loadIndex(msg), msg) });
	} catch (error) {
		self.postMessage({ type: "error", id: msg.id, error: String(error?.message || error) });
	}
});
