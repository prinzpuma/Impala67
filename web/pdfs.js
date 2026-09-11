"use strict";
import { U } from "./util.js";
import { DB } from "./db.js";
import { S, STATE } from "./state.js";
import { RAG } from "./rag.js";
import { AI } from "./ai.js";
import { TABS } from "./tabs.js";
import { OPTIONAL_MODULE_URLS } from "./optional-modules.js";
// pdfs.js — PDF-Pipeline: speichern (IndexedDB) → Text extrahieren (pdf.js)
// → KI sortiert ein & fasst zusammen → Seite wird angelegt.
export const PDFS = (() => {
	async function ensureLoaded() {
		const mainUrl = OPTIONAL_MODULE_URLS.pdf;
		const workerUrl = OPTIONAL_MODULE_URLS.pdfWorker;
		if (!window.pdfjsLib) {
			await U.loadScript(mainUrl, "pdfjsLib");
		}
		if (!window.pdfjsLib) throw new Error("pdf.js konnte nicht geladen werden.");
		pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
		if (typeof caches !== "undefined") {
			try {
				const c = await caches.open("impala67-optional-modules");
				const match = await c.match(workerUrl);
				if (!match) {
					await c.add(workerUrl);
				}
			} catch (e) {
				throw new Error("PDF-Worker konnte nicht für die Offline-Nutzung gespeichert werden: " + ((e && e.message) || e));
			}
		}
		return true;
	}

	async function extractText(buf, maxPages = 40) {
		await ensureLoaded();
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
		S.editorMode = "preview";
		TABS.openPage(id);
		return id;
	}

	// Ein Object-URL je PDF — Cache, Freigabe beim Löschen und der bfcache-Schutz
	// (pagehide) liegen zentral in db.js.
	const urlFor = (pdfId) => DB.blobUrl(pdfId, "application/pdf");

	async function openViewer(pdfId) {
		const url = await urlFor(pdfId);
		if (!url) { alert("PDF nicht gefunden."); return; }
		window.open(url, "_blank");
	}

	async function download(pdfId, filename) {
		const rec = await DB.getBlob(pdfId);
		const buf = rec && (rec.buf || rec.data);
		if (!buf) {
			alert("PDF-Daten nicht gefunden.");
			return;
		}
		const rawName = filename || (rec.meta && rec.meta.name) || "dokument.pdf";
		const name = rawName.toLowerCase().endsWith(".pdf") ? rawName : rawName + ".pdf";
		const blob = new Blob([buf], { type: "application/pdf" });
		const u = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = u;
		a.download = name;
		document.body.appendChild(a);
		a.click();
		a.remove();
		setTimeout(() => URL.revokeObjectURL(u), 2000);
	}

	let currentViewerSession = 0;

	async function mountViewer(container, pdfId, opts = {}) {
		if (!container || !pdfId) return;
		const sessionId = ++currentViewerSession;
		container.innerHTML = '<div class="pdf-loading"><span>📄 PDF wird geladen…</span></div>';

		try {
			const rec = await DB.getBlob(pdfId);
			if (sessionId !== currentViewerSession) return;
			const buf = rec && (rec.buf || rec.data);
			if (!buf || !buf.byteLength) {
				container.innerHTML = '<div class="pdf-loading" style="color:var(--danger,#e53935);"><span>PDF-Datei konnte nicht geladen werden.</span></div>';
				return;
			}

			await ensureLoaded();
			if (sessionId !== currentViewerSession) return;

			const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
			if (sessionId !== currentViewerSession) return;

			let curPage = 1;
			const totalPages = doc.numPages;
			const docTitle = opts.title || (rec.meta && rec.meta.name) || "PDF-Dokument";

			try {
				const savedH = localStorage.getItem("impala_pdf_height");
				if (savedH) container.style.height = savedH;
			} catch {}

			container.innerHTML =
				'<div class="pdf-toolbar">' +
					'<div class="pdf-toolbar-group">' +
						'<span class="pdf-doc-title" title="' + U.esc(docTitle) + '">📄 ' + U.esc(docTitle) + '</span>' +
						'<button type="button" class="mini pdf-prev-btn" title="Vorherige Seite (Pfeil links)">◀</button>' +
						'<span class="pdf-page-indicator">Seite <span class="pdf-cur-page">1</span> / ' + totalPages + '</span>' +
						'<button type="button" class="mini pdf-next-btn" title="Nächste Seite (Pfeil rechts)">▶</button>' +
					'</div>' +
					'<div class="pdf-toolbar-group">' +
						'<button type="button" class="mini pdf-zoom-out" title="Verkleinern">🔍 −</button>' +
						'<span class="pdf-zoom-label" style="min-width:38px;text-align:center;">100%</span>' +
						'<button type="button" class="mini pdf-zoom-in" title="Vergrößern">🔍 +</button>' +
						'<button type="button" class="mini pdf-fit-btn" title="An Breite anpassen">Breite</button>' +
					'</div>' +
					'<div class="pdf-toolbar-group">' +
						'<button type="button" class="mini pdf-open-tab-btn" title="In neuem Browser-Tab öffnen (Vollbild & Drucken)">↗ Tab</button>' +
						'<button type="button" class="mini pdf-download-btn" title="PDF-Datei herunterladen">⬇</button>' +
						'<button type="button" class="mini pdf-collapse-btn" id="btnOpenPdf" title="PDF einklappen">▲</button>' +
					'</div>' +
				'</div>' +
				'<div class="pdf-body" tabindex="0" role="region" aria-label="PDF Anzeige">' +
					'<canvas class="pdf-canvas"></canvas>' +
				'</div>' +
				'<div class="pdf-resizer" title="Unten ziehen für gewünschte Höhe"></div>';

			const body = container.querySelector(".pdf-body");
			const canvas = container.querySelector(".pdf-canvas");
			const prevBtn = container.querySelector(".pdf-prev-btn");
			const nextBtn = container.querySelector(".pdf-next-btn");
			const curPageEl = container.querySelector(".pdf-cur-page");
			const zoomInBtn = container.querySelector(".pdf-zoom-in");
			const zoomOutBtn = container.querySelector(".pdf-zoom-out");
			const zoomLabel = container.querySelector(".pdf-zoom-label");
			const fitBtn = container.querySelector(".pdf-fit-btn");
			const openTabBtn = container.querySelector(".pdf-open-tab-btn");
			const downloadBtn = container.querySelector(".pdf-download-btn");
			const resizer = container.querySelector(".pdf-resizer");

			let curScale = 1.0;
			try {
				const firstPage = await doc.getPage(1);
				const baseVp = firstPage.getViewport({ scale: 1.0 });
				const availW = Math.max(200, (body.clientWidth || 720) - 48);
				curScale = Math.max(0.6, Math.min(2.0, availW / baseVp.width));
			} catch {
				curScale = 1.15;
			}

			let rendering = false;
			let pendingPage = null;

			async function renderCurrentPage(pageNum) {
				if (pageNum < 1) pageNum = 1;
				if (pageNum > totalPages) pageNum = totalPages;
				curPage = pageNum;

				if (rendering) {
					pendingPage = pageNum;
					return;
				}
				rendering = true;

				try {
					const page = await doc.getPage(curPage);
					if (sessionId !== currentViewerSession) return;
					const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
					const viewport = page.getViewport({ scale: curScale });

					canvas.width = Math.floor(viewport.width * dpr);
					canvas.height = Math.floor(viewport.height * dpr);
					canvas.style.width = Math.floor(viewport.width) + "px";
					canvas.style.height = Math.floor(viewport.height) + "px";

					const ctx = canvas.getContext("2d");
					ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

					await page.render({ canvasContext: ctx, viewport }).promise;

					if (curPageEl) curPageEl.textContent = String(curPage);
					if (prevBtn) prevBtn.disabled = curPage <= 1;
					if (nextBtn) nextBtn.disabled = curPage >= totalPages;
					if (zoomLabel) zoomLabel.textContent = Math.round(curScale * 100) + "%";
				} catch (renderErr) {
					console.warn("PDF.js Seitenrender-Fehler:", renderErr);
				} finally {
					rendering = false;
					if (pendingPage !== null && pendingPage !== curPage) {
						const next = pendingPage;
						pendingPage = null;
						renderCurrentPage(next);
					}
				}
			}

			if (prevBtn) prevBtn.onclick = () => renderCurrentPage(curPage - 1);
			if (nextBtn) nextBtn.onclick = () => renderCurrentPage(curPage + 1);

			if (zoomInBtn) zoomInBtn.onclick = () => {
				curScale = Math.min(3.0, curScale + 0.2);
				renderCurrentPage(curPage);
			};
			if (zoomOutBtn) zoomOutBtn.onclick = () => {
				curScale = Math.max(0.4, curScale - 0.2);
				renderCurrentPage(curPage);
			};
			if (fitBtn) fitBtn.onclick = async () => {
				try {
					const page = await doc.getPage(curPage);
					const baseVp = page.getViewport({ scale: 1.0 });
					const availW = Math.max(200, (body.clientWidth || 720) - 48);
					curScale = Math.max(0.5, Math.min(3.0, availW / baseVp.width));
					renderCurrentPage(curPage);
				} catch {}
			};

			if (openTabBtn) openTabBtn.onclick = () => openViewer(pdfId);
			if (downloadBtn) downloadBtn.onclick = () => download(pdfId, opts.title || (rec.meta && rec.meta.name));

			if (resizer) {
				let startY = 0;
				let startH = 0;
				const onMouseMove = (e) => {
					const delta = e.clientY - startY;
					const newH = Math.max(340, Math.min(1400, startH + delta));
					container.style.height = newH + "px";
				};
				const onMouseUp = () => {
					window.removeEventListener("mousemove", onMouseMove);
					window.removeEventListener("mouseup", onMouseUp);
					try { localStorage.setItem("impala_pdf_height", container.style.height); } catch {}
				};
				resizer.addEventListener("mousedown", (e) => {
					e.preventDefault();
					startY = e.clientY;
					startH = container.offsetHeight;
					window.addEventListener("mousemove", onMouseMove);
					window.addEventListener("mouseup", onMouseUp);
				});
			}

			if (body) {
				body.addEventListener("keydown", (e) => {
					if (e.key === "ArrowLeft" || e.key === "PageUp") {
						e.preventDefault();
						renderCurrentPage(curPage - 1);
					} else if (e.key === "ArrowRight" || e.key === "PageDown") {
						e.preventDefault();
						renderCurrentPage(curPage + 1);
					}
				});
			}

			await renderCurrentPage(1);
		} catch (err) {
			console.error("PDF Viewer Initialisierungsfehler:", err);
			const url = await urlFor(pdfId);
			container.innerHTML =
				'<div class="pdf-toolbar">' +
					'<span style="font-weight:500;">📄 PDF Vorschau</span>' +
					'<button type="button" class="mini pdf-open-tab-btn btn-primary">↗ In neuem Tab öffnen</button>' +
				'</div>' +
				'<div class="pdf-body" style="padding:20px;text-align:center;">' +
					'<object data="' + (url || "") + '" type="application/pdf" style="width:100%;height:100%;min-height:220px;">' +
						'<p style="color:var(--text);margin-bottom:12px;">Der interne Browser-Viewer kann dieses PDF nicht direkt einbetten.</p>' +
						'<button type="button" class="mini pdf-fallback-open btn-primary" style="padding:8px 16px;cursor:pointer;">↗ In neuem Tab öffnen</button>' +
					'</object>' +
				'</div>';
			const fBtn = container.querySelector(".pdf-fallback-open");
			if (fBtn) fBtn.onclick = () => openViewer(pdfId);
			const oBtn = container.querySelector(".pdf-open-tab-btn");
			if (oBtn) oBtn.onclick = () => openViewer(pdfId);
		}
	}

	return { ingest, openViewer, download, mountViewer, urlFor, extractText, ensureLoaded };
})();
