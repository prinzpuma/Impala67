"use strict";
import { S, STATE } from "./state.js";
import { DB } from "./db.js";
import { U } from "./util.js";
import { EMBEDDINGS } from "./embedding.js";
import { rankRag } from "./rag-ranking.js";
// rag.js — Semantische Suche (RAG): Notizen werden in Chunks zerlegt, als
// Embeddings in IndexedDB gespeichert und per Kosinus-Ähnlichkeit durchsucht.
// Benötigt das lokale Bekko-Embedding-Modell aus ⚙️ → KI.
export const RAG = (() => {
	const queue = new Set();
	let timer = null;
	const EMBEDDING_BATCH_SIZE = 4;
	const yieldToBrowser = () => new Promise((resolve) => setTimeout(resolve, 0));

	const enabled = () => !!S.settings.embedModel;
	const embeddingProviderId = () => String(S.settings.embedProviderId || "");
	const embeddingIdentity = () => ({
		model: String(S.settings.embedModel || ""),
		providerId: embeddingProviderId(),
	});
	const sameEmbeddingIdentity = (left, right) => left.model === right.model && left.providerId === right.providerId;
	let rankingWorker = null, rankingReqId = 0;
	const rankingPending = new Map();
	function getRankingWorker() {
		if (!rankingWorker && typeof Worker !== "undefined") {
			try {
				rankingWorker = new Worker("./rag-worker.js", { type: "module" });
				rankingWorker.addEventListener("message", (event) => {
					const msg = event.data || {}, pending = rankingPending.get(msg.id);
					if (!pending) return;
					rankingPending.delete(msg.id);
					msg.type === "error" ? pending.reject(new Error(msg.error || "RAG-Worker-Fehler")) : pending.resolve(msg.hits || []);
				});
				rankingWorker.addEventListener("error", (error) => {
					for (const pending of rankingPending.values()) pending.reject(new Error(error?.message || "RAG-Worker-Fehler"));
					rankingPending.clear();
					try { rankingWorker?.terminate(); } catch {}
					rankingWorker = null;
				});
			} catch { rankingWorker = null; }
		}
		return rankingWorker;
	}
	const invalidateRankingIndex = () => { vecCache = null; try { rankingWorker?.postMessage({ type: "invalidate" }); } catch {} };

	// FIX: Beim Entfernen aus dem Index wurde der Speicher-Cache NICHT verworfen — bis zu 30 s
	// lieferte die Suche danach weiter Treffer aus geleerten Seiten (Papierkorb wird zwar
	// gefiltert, eine geleerte Seite nicht). Eine Ausgangstür statt zwei halber.
	const dropIndex = async (pageId) => { await DB.delVec(pageId); invalidateRankingIndex(); };

	// Chunking v2 (15. Juli): Überschriften beginnen neue Chunks (thematisch
	// saubere Treffer) und benachbarte Chunks überlappen sich leicht — Antworten,
	// die genau auf einer Chunk-Grenze liegen, gehen nicht mehr verloren.
	function chunk(text, size = 800, overlap = 120) {
		const parts = [];
		const paras = String(text || "").split(/\n\n+/);
		let cur = "";
		const push = () => { if (cur.trim()) parts.push(cur); };
		for (const p of paras) {
			const isHeading = /^#{1,3}\s/.test(p);
			if (cur && (isHeading || (cur + "\n\n" + p).length > size)) {
				push();
				// Überlappung: das Ende des letzten Chunks leitet den nächsten ein.
				cur = (overlap ? cur.slice(-overlap) + "\n\n" : "") + p;
			} else cur = cur ? cur + "\n\n" + p : p;
		}
		push();
		return parts.slice(0, 80); // großzügiger, damit auch PDF-Volltext hineinpasst
	}

	async function indexPage(pageId) {
		if (!enabled()) return;
		const identity = embeddingIdentity();
		const pg = S.pages[pageId];
		// Gelöschte (Papierkorb-)Seiten aus dem Index entfernen statt sie zu indexieren
		if (!pg || pg.trashed) { await dropIndex(pageId); return; }
		const pageUpdated = pg.updated;
		const assertCurrent = () => {
			if (!sameEmbeddingIdentity(identity, embeddingIdentity())) {
				throw new Error("Embedding-Konfiguration wurde während der Indexierung geändert.");
			}
			const current = S.pages[pageId];
			if (!current || current.trashed || current.updated !== pageUpdated) {
				throw new Error("Seite wurde während der Indexierung geändert.");
			}
		};
		let text = pg.title + "\n\n" + pg.content;
		// PDF-Volltext mitindexieren: der bei der Aufnahme extrahierte Text liegt als
		// eigener Blob ("pdftext:<id>") in IndexedDB; ältere PDFs werden einmalig nachextrahiert.
		if (pg.pdfId) {
			try {
				let rec = await DB.getBlob("pdftext:" + pg.pdfId);
				if (!rec) {
					const pdf = await DB.getBlob(pg.pdfId);
					if (pdf) {
						// Nur fuer die einmalige Alt-PDF-Migration laden. Ein statischer
						// Import wuerde rag.js -> pdfs.js -> ai.js -> rag.js erzeugen.
						const { PDFS } = await import("./pdfs.js");
						const ex = await PDFS.extractText(pdf.buf.slice(0));
						await DB.putBlob("pdftext:" + pg.pdfId, new TextEncoder().encode(ex.text).buffer, { type: "text/plain" });
						rec = await DB.getBlob("pdftext:" + pg.pdfId);
					}
				}
				if (rec && rec.buf) text += "\n\n" + new TextDecoder().decode(rec.buf).slice(0, 60000);
			} catch (e) { console.warn("PDF-Volltext für RAG fehlgeschlagen:", e); }
		}
		const chunks = chunk(text);
		if (!chunks.length) { await dropIndex(pageId); return; }
		// iPad/WebKit darf nie einen kompletten PDF-Index als einen einzigen
		// Inferenz-Batch erhalten. Das Modell verarbeitet die Batches nacheinander;
		// dadurch bleibt der Spitzenverbrauch klein und die UI bekommt zwischen den
		// Schritten wieder Kontrolle.
		const vecs = [];
		for (let at = 0; at < chunks.length; at += EMBEDDING_BATCH_SIZE) {
			assertCurrent();
			const batch = await EMBEDDINGS.embed(chunks.slice(at, at + EMBEDDING_BATCH_SIZE), { priority: "background" });
			assertCurrent();
			if (!Array.isArray(batch) || batch.length !== Math.min(EMBEDDING_BATCH_SIZE, chunks.length - at) || batch.some((v) => !v || !v.length)) {
				throw new Error("Embedding unvollständig für Seite " + pageId);
			}
			vecs.push(...batch);
			await yieldToBrowser();
		}
		// Unvollständige Embedding-Antworten verwerfen statt einen halben Index zu
		// speichern — queuePage fängt den Fehler und die Seite bleibt „stale“.
		if (!Array.isArray(vecs) || vecs.length !== chunks.length || vecs.some((v) => !v || !v.length)) {
			throw new Error("Embedding unvollständig für Seite " + pageId);
		}
		assertCurrent();
		// Normen einmalig beim Indexieren vorberechnen — die Suche spart sich damit
		// pro Chunk eine komplette Betrags-Berechnung (spürbar bei vielen Seiten).
		// model wird mitgespeichert: reindexStale() erkennt daran einen Modellwechsel.
		await DB.putVec(pageId, {
			updated: pageUpdated,
			model: identity.model,
			providerId: identity.providerId,
			// Neue Vektoren kompakt speichern. Alte Array-Einträge bleiben lesbar und
			// werden beim naechsten normalen Reindex automatisch ersetzt.
			chunks: chunks.map((text, i) => {
				const vec = vecs[i] instanceof Float32Array ? vecs[i] : Float32Array.from(vecs[i]);
				return { text, vec, norm: norm(vec) };
			}),
		});
		invalidateRankingIndex(); // Suche lädt beim nächsten Mal frisch
	}

	// Debounced-Warteschlange — wird nach Edits/Ingest aus app.js & pdfs.js befüllt.
	// Fehler pro Batch gebündelt loggen (sonst spamt ein kaputtes Embedding-Modell die Console
	// mit einer Zeile pro Seite). Bei wiederholtem gleichem Fehler bricht der Batch ab —
	// die restlichen IDs bleiben stale und kommen im nächsten Zyklus wieder.
	function queuePage(pageId) {
		if (!enabled()) return;
		queue.add(pageId);
		clearTimeout(timer);
		timer = setTimeout(async () => {
			const ids = [...queue];
			queue.clear();
			let failN = 0, lastErr = null, lastMsg = "";
			for (const id of ids) {
				try { await indexPage(id); }
				catch (e) {
					failN++;
					lastErr = e;
					const msg = String(e?.message || e);
					// Gleicher Config-/API-Fehler → restliche Seiten überspringen (kein Mehrwert).
					if (failN > 1 && msg === lastMsg) {
						failN += ids.length - ids.indexOf(id) - 1;
						break;
					}
					lastMsg = msg;
				}
				await yieldToBrowser();
			}
			if (failN === 1) console.warn("RAG-Index fehlgeschlagen:", lastErr);
			else if (failN > 1) console.warn("RAG-Index: " + failN + " Seite(n) fehlgeschlagen — " + lastMsg);
		}, 2500);
	}

	// Fehlende/veraltete Seiten nachindexieren (beim Start und nach ⚙️-Änderung).
	// Modellwechsel-Fix (15. Juli, später): Vorher wurde nur der Seitenstand
	// verglichen — nach einem Wechsel des Embedding-Modells blieben ALLE Vektoren
	// alt, und die Suche fand still nichts mehr (andere Dimension) oder lieferte
	// falsche Scores (gleiche Dimension, inkompatibler Vektorraum). Jetzt wird
	// jeder Eintrag neu indexiert, dessen model nicht zum aktuellen Modell passt
	// (Alt-Einträge ohne model-Feld werden dabei einmalig migriert).
	async function reindexStale() {
		if (!enabled()) return;
		const vecs = await DB.allVecs();
		const model = S.settings.embedModel, providerId = embeddingProviderId();
		for (const pg of STATE.activePages()) {
			const v = vecs[pg.id];
			if (!v || v.updated !== pg.updated || v.model !== model || v.providerId !== providerId) queuePage(pg.id);
		}
	}

	const norm = (v) => { let s = 0; for (let i = 0; i < v.length; i++) s += v[i] * v[i]; return Math.sqrt(s) || 1; };

	// Suche v2 (15. Juli):
	// - Vektoren werden im Speicher gecacht (IndexedDB-Volllast nur noch alle 30 s
	//   bzw. nach eigenem Re-Index) statt bei JEDER Suche.
	// - Query-Embeddings der letzten 20 Fragen werden wiederverwendet (Auto-RAG in
	//   ai.js stellt oft ähnliche/identische Fragen erneut).
	// - Vorberechnete Normen + reines Skalarprodukt statt kompletter Kosinus-Formel.
	// - Max. 2 Treffer pro Seite: k Ergebnisse decken mehrere Seiten ab, statt dass
	//   eine einzige lange Seite alle Plätze belegt.
	// - Chunks mit fremder Embedding-Dimension (Modellwechsel) werden übersprungen
	//   statt falsche Scores zu liefern; reindexStale() ersetzt sie ohnehin.
	let vecCache = null, vecCacheAt = 0, vecCacheIdentity = "";
	const queryCache = new Map();
	async function allVecsCached() {
		const identity = embeddingProviderId() + "::" + String(S.settings.embedModel || "");
		if (!vecCache || vecCacheIdentity !== identity || Date.now() - vecCacheAt > 30000) {
			vecCache = await DB.allVecs();
			vecCacheAt = Date.now();
			vecCacheIdentity = identity;
		}
		return vecCache;
	}
	async function queryVec(query) {
		// Embedding-Quelle gehört mit in den Cache-Schlüssel: derselbe Modellname über eine
		// andere Quelle darf keine gecachten Query-Vektoren der alten Quelle wiederverwenden.
		const key = String(query || "").trim().toLowerCase() + "::" + (S.settings.embedProviderId || "") + "::" + (S.settings.embedModel || "");
		if (queryCache.has(key)) return queryCache.get(key);
		const [qv] = await EMBEDDINGS.embed([query], { priority: "foreground" });
		queryCache.set(key, qv);
		if (queryCache.size > 20) queryCache.delete(queryCache.keys().next().value);
		return qv;
	}
	async function search(query, k = 6) {
		if (!enabled()) return null; // Aufrufer fällt auf Stichwortsuche zurück
		const qv = await queryVec(query);
		const model = S.settings.embedModel, providerId = embeddingProviderId();
		const pages = Object.fromEntries(Object.entries(S.pages).map(([id, pg]) => [id, { title: pg.title, trashed: !!pg.trashed }]));
		const worker = getRankingWorker();
		if (worker) {
			const id = "rank_" + (++rankingReqId) + "_" + Date.now();
			try {
				return await new Promise((resolve, reject) => {
					const timer = setTimeout(() => {
						rankingPending.delete(id);
						reject(new Error("RAG-Worker antwortet nicht."));
					}, 8000);
					rankingPending.set(id, {
						resolve: (value) => { clearTimeout(timer); resolve(value); },
						reject: (error) => { clearTimeout(timer); reject(error); },
					});
					worker.postMessage({ type: "search", id, identity: providerId + "::" + model, query, qv, pages, model, providerId, k });
				});
			} catch (error) { console.warn("RAG-Worker nicht verfügbar, verwende Hauptthread:", error); }
		}
		return rankRag({ query, qv, vecs: await allVecsCached(), pages, model, providerId, k });
	}

	return { queuePage, reindexStale, search, indexPage, enabled };
})();
