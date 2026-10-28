"use strict";
import { S, STATE } from "./state.js";
import { DB } from "./db.js";
import { EMBEDDINGS, isValidVector, vectorModelKey } from "./embedding.js";
import { buildRagIndex, rankRag, relatedPages } from "./rag-ranking.js";
import { norm } from "./vector-math.js";
import { CORE } from "./rust-core.js";
import { PERF_PROFILER } from "./performance-profiler.js";
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
	const embeddingModel = () => vectorModelKey(S.settings.embedModel);
	const embeddingIdentity = () => ({
		model: embeddingModel(),
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
	const invalidateRankingIndex = () => { dropMainIndex(); try { rankingWorker?.postMessage({ type: "invalidate" }); } catch {} };

	// FIX: Beim Entfernen aus dem Index wurde der Speicher-Cache NICHT verworfen — bis zu 30 s
	// lieferte die Suche danach weiter Treffer aus geleerten Seiten (Papierkorb wird zwar
	// gefiltert, eine geleerte Seite nicht). Eine Ausgangstür statt zwei halber.
	const dropIndex = async (pageId) => { await DB.delVec(pageId); invalidateRankingIndex(); };

	// Abschnitte (Rust-Kern): Überschriften beginnen neue, Nachbarn überlappen leicht, höchstens 80.
	const chunk = (text) => CORE.ragChunk(text);

	// PDF-Volltext: liegt als eigener Blob ("pdftext:<id>") in IndexedDB; ältere PDFs werden
	// einmalig nachextrahiert. `onlyPdf`: eingebettete Dateien nur, wenn sie PDFs sind.
	async function pdfText(id, onlyPdf) {
		let rec = await DB.getBlob("pdftext:" + id);
		if (!rec) {
			const pdf = await DB.getBlob(id);
			if (pdf && (!onlyPdf || CORE.ragIsPdf(pdf.meta?.type, pdf.meta?.name))) {
				// Nur fuer die einmalige Alt-PDF-Migration laden. Ein statischer
				// Import wuerde rag.js -> pdfs.js -> ai.js -> rag.js erzeugen.
				const { PDFS } = await import("./pdfs.js");
				const ex = await PDFS.extractText(pdf.buf.slice(0));
				if (ex && ex.text) {
					await DB.putBlob("pdftext:" + id, new TextEncoder().encode(ex.text).buffer, { type: "text/plain" });
					rec = await DB.getBlob("pdftext:" + id);
				}
			}
		}
		return rec && rec.buf ? new TextDecoder().decode(rec.buf) : undefined;
	}

	async function performIndexPage(pageId) {
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
		// Gesamttext (Rust-Kern): Titel, Inhalt, PDF-Volltexte, Handschrift der Hefte.
		let pagePdf;
		if (pg.pdfId) {
			try { pagePdf = await pdfText(pg.pdfId, false); } catch (e) { console.warn("PDF-Volltext für RAG fehlgeschlagen:", e); }
		}
		const inlinePdfs = [];
		for (const fId of CORE.ragInlineFileIds(String(pg.content || ""), pg.pdfId || undefined)) {
			try {
				const t = await pdfText(fId, true);
				if (t !== undefined) inlinePdfs.push(t);
			} catch (e) { console.warn("Inline-PDF-Volltext für RAG fehlgeschlagen:", e); }
		}
		const hdoc = STATE.heftDoc(pageId);
		const heftPages = hdoc && Array.isArray(hdoc.pages) ? hdoc.pages.map((hp) => ({ texts: Array.isArray(hp?.texts) ? hp.texts : [], ocrText: hp?.ocrText ? String(hp.ocrText) : undefined })) : [];
		const metaOcr = STATE.heftMeta(pageId)?.ocrText;
		const text = CORE.ragIndexText(String(pg.title || ""), String(pg.content || ""), pagePdf, inlinePdfs,
			JSON.stringify(heftPages), metaOcr ? String(metaOcr) : undefined);
		const chunks = chunk(text);
		if (!chunks.length) { await dropIndex(pageId); return; }
		// iPad/WebKit darf nie einen kompletten PDF-Index als einen einzigen
		// Inferenz-Batch erhalten. Das Modell verarbeitet die Batches nacheinander;
		// dadurch bleibt der Spitzenverbrauch klein und die UI bekommt zwischen den
		// Schritten wieder Kontrolle.
		// Unveränderte Abschnitte behalten ihren Vektor (gleicher Text + gleiches Modell =
		// gleicher Vektor). Beim Tippen ändert sich meist nur ein Abschnitt — vorher wurde
		// nach jeder Tipp-Pause die ganze Seite (bis 80 Abschnitte) neu eingebettet.
		let previous = null;
		try { previous = await DB.getVec(pageId); } catch { /* ohne Altbestand alles neu einbetten */ }
		const reusable = new Map();
		if (previous && previous.model === identity.model && previous.providerId === identity.providerId && Array.isArray(previous.chunks)) {
			for (const c of previous.chunks) if (c && typeof c.text === "string" && isValidVector(c.vec)) reusable.set(c.text, c.vec);
		}
		const vecs = chunks.map((text) => reusable.get(text) || null);
		const missing = chunks.map((_, i) => i).filter((i) => !vecs[i]);
		for (let at = 0; at < missing.length; at += EMBEDDING_BATCH_SIZE) {
			const idx = missing.slice(at, at + EMBEDDING_BATCH_SIZE);
			assertCurrent();
			const batch = await EMBEDDINGS.embed(idx.map((i) => chunks[i]), { priority: "background" });
			assertCurrent();
			if (!Array.isArray(batch) || batch.length !== idx.length || !batch.every(isValidVector)) {
				throw new Error("Embedding unvollständig für Seite " + pageId);
			}
			idx.forEach((i, j) => { vecs[i] = batch[j]; });
			await yieldToBrowser();
		}
		// Unvollständige Embedding-Antworten verwerfen statt einen halben Index zu
		// speichern — queuePage fängt den Fehler und die Seite bleibt „stale“.
		if (!Array.isArray(vecs) || vecs.length !== chunks.length || !vecs.every(isValidVector)) {
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
		return { chunks: chunks.length, embedded: missing.length };
	}

	// Debounced-Warteschlange — wird nach Edits/Ingest aus app.js & pdfs.js befüllt.
	// Fehler pro Batch gebündelt loggen (sonst spamt ein kaputtes Embedding-Modell die Console
	// mit einer Zeile pro Seite). Bei wiederholtem gleichem Fehler bricht der Batch ab —
	// die restlichen IDs bleiben stale und kommen im nächsten Zyklus wieder.
	// Durchläufe nacheinander: Ein Lauf kann (lokales Modell, viele Seiten) länger dauern als die
	// 2,5 s Wartezeit — vorher startete dann ein zweiter parallel und bettete dieselben Seiten doppelt ein.
	let running = Promise.resolve();
	function queuePage(pageId) {
		if (!enabled()) return;
		queue.add(pageId);
		clearTimeout(timer);
		timer = setTimeout(() => { running = running.then(indexQueued); }, 2500);
	}
	async function indexQueued() {
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
		const model = embeddingModel(), providerId = embeddingProviderId();
		for (const pg of Object.values(S.pages)) {
			if (pg.trashed) continue;
			const v = vecs[pg.id];
			if (!v || v.updated !== pg.updated || v.model !== model || v.providerId !== providerId) queuePage(pg.id);
		}
	}

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
	// Rust-Index im Hauptthread (verwandte Seiten, Suche ohne Worker): bleibt bestehen, bis
	// ein Re-Index, ein Herkunftswechsel oder 30 s ihn veralten lassen.
	let mainIndex = null, mainIndexAt = 0, mainIndexIdentity = "";
	const queryCache = new Map();
	function dropMainIndex() {
		mainIndex?.index.free();
		mainIndex = null;
	}
	async function mainIndexCached() {
		const identity = embeddingProviderId() + "::" + embeddingModel();
		if (!mainIndex || mainIndexIdentity !== identity || Date.now() - mainIndexAt > 30000) {
			const vecs = await DB.allVecs();
			dropMainIndex();
			mainIndex = buildRagIndex(vecs, embeddingModel(), embeddingProviderId());
			mainIndexAt = Date.now();
			mainIndexIdentity = identity;
		}
		return mainIndex;
	}
	const pageFlags = () => Object.fromEntries(Object.entries(S.pages).map(([id, pg]) => [id, { title: pg.title, trashed: !!pg.trashed, archived: !!pg.archived }]));
	async function queryVec(query) {
		// Embedding-Quelle gehört mit in den Cache-Schlüssel: derselbe Modellname über eine
		// andere Quelle darf keine gecachten Query-Vektoren der alten Quelle wiederverwenden.
		const key = String(query || "").trim().toLowerCase() + "::" + embeddingProviderId() + "::" + embeddingModel();
		if (queryCache.has(key)) return queryCache.get(key);
		const [qv] = await EMBEDDINGS.embed([query], { priority: "foreground" });
		queryCache.set(key, qv);
		if (queryCache.size > 20) queryCache.delete(queryCache.keys().next().value);
		return qv;
	}
	async function search(query, k = 6) {
		if (!enabled()) return null; // Aufrufer fällt auf Stichwortsuche zurück
		return PERF_PROFILER.run("rag.search", () => performSearch(query, k), { query: String(query).slice(0, 40) }, 40);
	}

	async function performSearch(query, k = 6) {
		const qv = await queryVec(query);
		const model = embeddingModel(), providerId = embeddingProviderId();
		const pages = pageFlags();
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
		return rankRag(await mainIndexCached(), { query, qv, pages, k });
	}

	// Verwandte Seiten: Ähnlichkeit der Seitenvektoren (normierter Mittelwert der Chunks), ab 0,5.
	async function related(pageId, k = 3) {
		if (!enabled()) return [];
		return relatedPages(await mainIndexCached(), pageFlags(), pageId, k);
	}

	return { queuePage, reindexStale, search, enabled, related };
})();
