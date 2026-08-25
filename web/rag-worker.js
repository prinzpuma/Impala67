"use strict";

import { rankRag } from "./rag-ranking.js";

let dbPromise = null, vecCache = null, vecCacheAt = 0, vecCacheIdentity = "";

function openDb() {
	dbPromise ??= new Promise((resolve, reject) => {
		const req = indexedDB.open("impala67");
		req.onsuccess = () => {
			const db = req.result;
			db.onversionchange = () => { db.close(); dbPromise = null; vecCache = null; };
			resolve(db);
		};
		req.onerror = () => reject(req.error);
	}).catch((error) => { dbPromise = null; throw error; });
	return dbPromise;
}

async function loadVecs(identity) {
	if (vecCache && vecCacheIdentity === identity && Date.now() - vecCacheAt <= 30000) return vecCache;
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
	vecCache = Object.fromEntries(rows);
	vecCacheAt = Date.now();
	vecCacheIdentity = identity;
	return vecCache;
}

self.addEventListener("message", async (event) => {
	const msg = event.data || {};
	if (msg.type === "invalidate") { vecCache = null; return; }
	if (msg.type !== "search" || !msg.id) return;
	try {
		const vecs = await loadVecs(msg.identity);
		self.postMessage({ type: "result", id: msg.id, hits: rankRag({ ...msg, vecs }) });
	} catch (error) {
		self.postMessage({ type: "error", id: msg.id, error: String(error?.message || error) });
	}
});
