"use strict";
// pdfs.js — PDF-Pipeline: speichern (IndexedDB) → Text extrahieren (pdf.js)
// → KI sortiert ein & fasst zusammen → Seite wird angelegt.
export const PDFS = (() => {
	if (window.pdfjsLib) {
		pdfjsLib.GlobalWorkerOptions.workerSrc =
			"https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
	}

	async function extractText(buf, maxPages = 40) {
		if (!window.pdfjsLib) throw new Error("pdf.js nicht geladen (Internet nötig).");
		const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
		const n = Math.min(doc.numPages, maxPages);
		const parts = [];
		for (let i = 1; i <= n; i++) {
			const page = await doc.getPage(i);
			const tc = await page.getTextContent();
			parts.push("[Seite " + i + "] " + tc.items.map((it) => it.str).join(" "));
		}
		return { text: parts.join("\n\n"), numPages: doc.numPages };
	}

	async function ingest(file, onStatus) {
		if (onStatus) onStatus("PDF wird gelesen…");
		const buf = await U.readAsBuffer(file);
		const pdfId = U.uid();
		await DB.putBlob(pdfId, buf, { name: file.name, size: file.size, type: "application/pdf" });

		const { text, numPages } = await extractText(buf.slice(0));
		// Volltext als eigener Blob — damit durchsucht die semantische Suche (RAG)
		// das ganze PDF, nicht nur die KI-Zusammenfassung (siehe rag.js indexPage).
		try { await DB.putBlob("pdftext:" + pdfId, new TextEncoder().encode(text).buffer, { name: file.name + ".txt", type: "text/plain" }); } catch (e) { console.warn(e); }

		if (onStatus) onStatus("KI sortiert ein & fasst zusammen…");
		let meta = null;
		try {
			const prompt =
				'Neues PDF: "' + file.name + '" (' + numPages + " Seiten).\n" +
				"Vorhandene Seiten der App: " + (STATE.pageTitles().join(" | ") || "(keine)") + "\n\n" +
				"Aufgaben: 1) guten deutschen Titel vergeben, 2) passende Elternseite aus der Liste wählen (oder null), " +
				"3) kompakte Markdown-Zusammenfassung (Überschriften, Stichpunkte, wichtigste Formeln als Klartext), 4) 2-5 Tags.\n" +
				'Antworte NUR als JSON: {"title":"...","parent_title":"...oder null","summary":"...","tags":["..."]}\n\n' +
				"PDF-Auszug:\n" + text.slice(0, 14000);
			const raw = await AI.complete(prompt, "Du bist ein präziser Bibliothekar. Antworte NUR mit gültigem JSON.");
			meta = JSON.parse((raw.match(/\{[\s\S]*\}/) || ["{}"])[0]);
		} catch (e) {
			console.warn("KI-Ingest fehlgeschlagen:", e);
		}

		const title = (meta && meta.title) || file.name.replace(/\.pdf$/i, "");
		const parent = meta && meta.parent_title ? STATE.findPage(meta.parent_title) : null;
		const summary = (meta && meta.summary)
			|| "_KI war nicht erreichbar — Zusammenfassung später über den Chat erstellen._";
		const tags = (meta && Array.isArray(meta.tags) && meta.tags) || [];

		const id = U.uid();
		const content =
			"> 📄 **" + file.name + "** · " + numPages + " Seiten · Tags: " + (tags.join(", ") || "—") + "\n\n" +
			"## Zusammenfassung\n\n" + summary + "\n";
		await STATE.dispatch("pageCreate", {
			id, title, parentId: parent ? parent.id : null, content, pdfId, tags,
			workspaceId: S.currentWorkspaceId,
		});
		RAG.queuePage(id);
		S.currentPageId = id;
		S.view = "page";
		S.editorMode = "preview";
		render();
		return id;
	}

	// Objekt-URLs werden gecacht (für den Inline-Viewer im Hauptbereich)
	const urlCache = {};
	// Objekt-URLs beim Verlassen der Seite freigeben (Memory-Leak-Schutz)
	window.addEventListener("pagehide", () => {
		// Auch aus dem Cache entfernen — sonst liefert der Cache nach einer
		// bfcache-Rückkehr tote (widerrufene) Objekt-URLs aus.
		for (const k of Object.keys(urlCache)) {
			URL.revokeObjectURL(urlCache[k]);
			delete urlCache[k];
		}
	});
	async function urlFor(pdfId) {
		if (urlCache[pdfId]) return urlCache[pdfId];
		const rec = await DB.getBlob(pdfId);
		if (!rec) return null;
		urlCache[pdfId] = URL.createObjectURL(new Blob([rec.buf], { type: "application/pdf" }));
		return urlCache[pdfId];
	}

	async function openViewer(pdfId) {
		const url = await urlFor(pdfId);
		if (!url) { alert("PDF nicht gefunden."); return; }
		window.open(url, "_blank");
	}

	return { ingest, openViewer, urlFor, extractText };
})();