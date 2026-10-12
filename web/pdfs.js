"use strict";
import { U } from "./util.js";
import { DB } from "./db.js";
import { S, STATE } from "./state.js";
import { RAG } from "./rag.js";
import { AI } from "./ai.js";
import { TABS } from "./tabs.js";
import { OPTIONAL_MODULE_URLS, PDFJS_VERSION } from "./optional-modules.js";
import { PERF_PROFILER } from "./performance-profiler.js";
import { icon, lead } from "./icons.js";
// pdfs.js — PDF-Pipeline: speichern (IndexedDB) → Text extrahieren (pdf.js)
// → KI sortiert ein & fasst zusammen → Seite wird angelegt.
export const PDFS = (() => {
	async function ensureLoaded() {
		const mainUrl = OPTIONAL_MODULE_URLS.pdf;
		const workerUrl = OPTIONAL_MODULE_URLS.pdfWorker;
		// Seit pdf.js 4 nur noch als ES-Modul; window.pdfjsLib bleibt die gemeinsame Referenz.
		if (!window.pdfjsLib) {
			window.pdfjsLib = await PERF_PROFILER.run("pdf.load", () => import(mainUrl), { runtime: PDFJS_VERSION }, 0);
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

	// Einziger Weg, ein PDF zu öffnen (Viewer, Textauszug, Heft-Import). Die Zusatzdaten
	// verbessern Scans (JPEG2000), asiatische und nicht eingebettete Schriften und CMYK-Farben.
	async function openDocument(buf) {
		await ensureLoaded();
		const base = OPTIONAL_MODULE_URLS.pdfAssets;
		const finish = PERF_PROFILER.start("pdf.open", { kb: Math.round((buf?.byteLength || 0) / 1024), runtime: PDFJS_VERSION }, 0);
		try {
			const doc = await pdfjsLib.getDocument({
				data: new Uint8Array(buf),
				wasmUrl: base + "wasm/",
				cMapUrl: base + "cmaps/",
				cMapPacked: true,
				standardFontDataUrl: base + "standard_fonts/",
				iccUrl: base + "iccs/",
			}).promise;
			finish({ pages: doc.numPages });
			return doc;
		} catch (err) {
			finish({ failed: true, errorName: err?.name || "Error", errorMessage: err?.message || String(err) });
			throw err;
		}
	}

	async function extractText(buf, maxPages = 40) {
		const doc = await openDocument(buf);
		const n = Math.min(doc.numPages, maxPages);
		const finish = PERF_PROFILER.start("pdf.extract-text", { pages: n }, 0);
		const parts = [];
		try {
			for (let i = 1; i <= n; i++) {
				const page = await doc.getPage(i);
				const tc = await page.getTextContent();
				parts.push("[Seite " + i + "] " + tc.items.map((it) => it.str).join(" "));
			}
		} catch (err) {
			finish({ failed: true, errorName: err?.name || "Error", errorMessage: err?.message || String(err) });
			throw err;
		}
		const text = parts.join("\n\n");
		finish({ chars: text.length });
		return { text, numPages: doc.numPages };
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

	async function mountViewer(container, pdfId, opts = {}) {
		if (!container || !pdfId) return;
		const sessionId = (container._pdfSessionId = (container._pdfSessionId || 0) + 1);
		container.innerHTML = '<div class="pdf-loading"><span>' + lead("file") + 'PDF wird geladen…</span></div>';

		try {
			const rec = await DB.getBlob(pdfId);
			if (sessionId !== container._pdfSessionId) return;
			const buf = rec && (rec.buf || rec.data);
			if (!buf || !buf.byteLength) {
				container.innerHTML = '<div class="pdf-loading" style="color:var(--danger,#e53935);"><span>PDF-Datei konnte nicht geladen werden.</span></div>';
				return;
			}

			const doc = await openDocument(buf);
			if (sessionId !== container._pdfSessionId) return;

			const totalPages = doc.numPages;
			const docTitle = opts.title || (rec.meta && rec.meta.name) || "PDF-Dokument";

			let isCollapsed = false;
			try {
				isCollapsed = localStorage.getItem("impala_pdf_collapsed_" + pdfId) === "1";
				const savedH = localStorage.getItem("impala_pdf_height_" + pdfId) || localStorage.getItem("impala_pdf_height");
				if (savedH) container.style.height = savedH;
				else container.style.height = opts.height || "560px";
			} catch {}

			if (isCollapsed) container.classList.add("collapsed");

			container.innerHTML =
				'<div class="pdf-toolbar">' +
					'<div class="pdf-toolbar-group">' +
						'<button type="button" class="pdf-toggle-btn" title="' + (isCollapsed ? "PDF aufklappen" : "PDF einklappen") + '">' +
							icon("chevron-down", "pdf-toggle-icon i-strong", 12) +
							'<span class="pdf-doc-title" title="' + U.esc(docTitle) + '">' + lead("file") + U.esc(docTitle) + '</span>' +
							'<span class="pdf-page-count">(' + totalPages + ' ' + (totalPages === 1 ? "Seite" : "Seiten") + ')</span>' +
						'</button>' +
					'</div>' +
					'<div class="pdf-toolbar-group">' +
						'<div class="pdf-zoom-pill">' +
							'<button type="button" class="pdf-zoom-btn pdf-zoom-out" title="Verkleinern" aria-label="Verkleinern">' +
								icon("minus", "i-strong", 11) +
							'</button>' +
							'<button type="button" class="pdf-zoom-val pdf-zoom-label" title="Auf 100% zurücksetzen">100%</button>' +
							'<button type="button" class="pdf-zoom-btn pdf-zoom-in" title="Vergrößern" aria-label="Vergrößern">' +
								icon("plus", "i-strong", 11) +
							'</button>' +
						'</div>' +
						'<button type="button" class="pdf-action-btn pdf-fit-btn" title="An Breite anpassen">' +
							icon("expand", "i-strong", 12) +
							'<span>Breite</span>' +
						'</button>' +
						'<button type="button" class="pdf-action-btn pdf-fullscreen-btn" title="Vollbild umschalten">' +
							icon("fullscreen", "i-strong", 12) +
							'<span>Vollbild</span>' +
						'</button>' +
						'<button type="button" class="pdf-action-btn icon-only pdf-open-btn" title="In neuem Tab öffnen" aria-label="In neuem Tab öffnen">' +
							icon("external", "i-strong", 12) +
						'</button>' +
						'<button type="button" class="pdf-action-btn icon-only pdf-download-btn" title="PDF herunterladen" aria-label="PDF herunterladen">' +
							icon("download", "i-strong", 12) +
						'</button>' +
					'</div>' +
				'</div>' +
				'<div class="pdf-body" tabindex="0" role="region" aria-label="PDF Anzeige">' +
					'<div class="pdf-pages-stack"></div>' +
				'</div>' +
				'<div class="pdf-resizer" title="Unten ziehen um Höhe anzupassen (Doppelklick = Standardhöhe)">' +
					'<div class="pdf-resizer-pill"></div>' +
				'</div>';

			const toggleBtn = container.querySelector(".pdf-toggle-btn");
			const body = container.querySelector(".pdf-body");
			const stack = container.querySelector(".pdf-pages-stack");
			const zoomInBtn = container.querySelector(".pdf-zoom-in");
			const zoomOutBtn = container.querySelector(".pdf-zoom-out");
			const zoomLabel = container.querySelector(".pdf-zoom-label");
			const fitBtn = container.querySelector(".pdf-fit-btn");
			const fullscreenBtn = container.querySelector(".pdf-fullscreen-btn");
			const openBtn = container.querySelector(".pdf-open-btn");
			const downloadBtn = container.querySelector(".pdf-download-btn");
			const resizer = container.querySelector(".pdf-resizer");

			if (openBtn) openBtn.onclick = () => openViewer(pdfId);

			if (toggleBtn) {
				toggleBtn.onclick = () => {
					isCollapsed = !isCollapsed;
					container.classList.toggle("collapsed", isCollapsed);
					toggleBtn.title = isCollapsed ? "PDF aufklappen" : "PDF einklappen";
					try {
						localStorage.setItem("impala_pdf_collapsed_" + pdfId, isCollapsed ? "1" : "0");
					} catch {}
					if (!isCollapsed) {
						// Bei Aufklappen sicherstellen, dass Maße und Stack passen
						requestAnimationFrame(() => {
							if (!stack.children.length) renderStack();
						});
					}
				};
			}

			const firstPage = await doc.getPage(1);
			const baseVp = firstPage.getViewport({ scale: 1.0 });
			const availW = Math.max(200, (body.clientWidth || 760) - 48);
			let curScale = Math.max(0.6, Math.min(2.0, availW / baseVp.width));

			const dpr = Math.min(window.devicePixelRatio || 1, 2.5);

			function renderStack() {
				stack.innerHTML = "";
				const renderedMap = new Map();
				if (zoomLabel) zoomLabel.textContent = Math.round(curScale * 100) + "%";

				const observer = new IntersectionObserver((entries) => {
					for (const entry of entries) {
						if (entry.isIntersecting) {
							const pageNum = Number(entry.target.dataset.page);
							if (pageNum && !renderedMap.has(pageNum)) {
								renderedMap.set(pageNum, true);
								renderPage(pageNum, entry.target);
							}
						}
					}
				}, { root: body, rootMargin: "400px" });

				for (let i = 1; i <= totalPages; i++) {
					const sheet = document.createElement("div");
					sheet.className = "pdf-page-sheet";
					sheet.dataset.page = String(i);
					const w = Math.floor(baseVp.width * curScale);
					const h = Math.floor(baseVp.height * curScale);
					sheet.style.width = w + "px";
					sheet.style.minHeight = h + "px";

					const canvas = document.createElement("canvas");
					canvas.className = "pdf-page-canvas";
					canvas.width = Math.floor(w * dpr);
					canvas.height = Math.floor(h * dpr);
					canvas.style.width = w + "px";
					canvas.style.height = h + "px";
					sheet.appendChild(canvas);

					const badge = document.createElement("div");
					badge.className = "pdf-page-badge";
					badge.textContent = `${i} / ${totalPages}`;
					sheet.appendChild(badge);

					stack.appendChild(sheet);
					observer.observe(sheet);
				}

				async function renderPage(pageNum, sheetEl) {
					const finish = PERF_PROFILER.start("pdf.render-page", { page: pageNum }, 50);
					try {
						const page = await doc.getPage(pageNum);
						if (sessionId !== container._pdfSessionId) return;
						const vp = page.getViewport({ scale: curScale });
						const canvas = sheetEl.querySelector("canvas");
						if (!canvas) return;
						canvas.width = Math.floor(vp.width * dpr);
						canvas.height = Math.floor(vp.height * dpr);
						canvas.style.width = Math.floor(vp.width) + "px";
						canvas.style.height = Math.floor(vp.height) + "px";
						// HiDPI über den transform-Parameter: pdf.js setzt die Kontext-Transformation
						// beim Rendern selbst, ein vorher gesetztes setTransform ist nicht verlässlich.
						const ctx = canvas.getContext("2d");
						await page.render({ canvasContext: ctx, viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null }).promise;
						finish();
					} catch (err) {
						finish({ failed: true, errorName: err?.name || "Error", errorMessage: err?.message || String(err) });
						console.warn("PDF Seite", pageNum, "Renderfehler:", err);
					}
				}
			}

			renderStack();

			if (zoomInBtn) zoomInBtn.onclick = () => {
				curScale = Math.min(2.5, curScale + 0.2);
				renderStack();
			};
			if (zoomOutBtn) zoomOutBtn.onclick = () => {
				curScale = Math.max(0.4, curScale - 0.2);
				renderStack();
			};
			if (fitBtn) fitBtn.onclick = () => {
				const w = Math.max(200, (body.clientWidth || 760) - 48);
				curScale = Math.max(0.5, Math.min(2.2, w / baseVp.width));
				renderStack();
			};

			if (zoomLabel) {
				zoomLabel.onclick = () => {
					curScale = 1.0;
					renderStack();
				};
			}

			function toggleFullscreen() {
				const isFull = container.classList.toggle("is-fullscreen");
				if (fullscreenBtn) {
					fullscreenBtn.innerHTML = isFull
						? icon("x", "i-strong", 12) + '<span>Schließen</span>'
						: icon("fullscreen", "i-strong", 12) + '<span>Vollbild</span>';
					fullscreenBtn.title = isFull ? "Vollbild beenden (Esc)" : "Vollbild umschalten";
				}
				if (isFull && isCollapsed) {
					isCollapsed = false;
					container.classList.remove("collapsed");
				}
				requestAnimationFrame(() => {
					const w = Math.max(200, (body.clientWidth || window.innerWidth) - 64);
					curScale = Math.max(0.6, Math.min(2.5, w / baseVp.width));
					renderStack();
				});
			}

			if (fullscreenBtn) fullscreenBtn.onclick = toggleFullscreen;

			const onKeyDown = (e) => {
				if (e.key === "Escape" && container.classList.contains("is-fullscreen")) {
					toggleFullscreen();
				}
			};
			window.addEventListener("keydown", onKeyDown);

			if (downloadBtn) downloadBtn.onclick = () => download(pdfId, opts.title || (rec.meta && rec.meta.name));

			if (resizer) {
				resizer.ondblclick = () => {
					container.style.height = opts.height || "560px";
					try {
						localStorage.setItem("impala_pdf_height_" + pdfId, container.style.height);
						localStorage.setItem("impala_pdf_height", container.style.height);
					} catch {}
				};
				let startY = 0;
				let startH = 0;
				const onMouseMove = (e) => {
					const delta = e.clientY - startY;
					const newH = Math.max(240, Math.min(1400, startH + delta));
					container.style.height = newH + "px";
				};
				const onMouseUp = () => {
					window.removeEventListener("mousemove", onMouseMove);
					window.removeEventListener("mouseup", onMouseUp);
					try {
						localStorage.setItem("impala_pdf_height_" + pdfId, container.style.height);
						localStorage.setItem("impala_pdf_height", container.style.height);
					} catch {}
				};
				const onTouchMove = (e) => {
					if (!e.touches || !e.touches[0]) return;
					const delta = e.touches[0].clientY - startY;
					const newH = Math.max(240, Math.min(1400, startH + delta));
					container.style.height = newH + "px";
				};
				const onTouchEnd = () => {
					window.removeEventListener("touchmove", onTouchMove);
					window.removeEventListener("touchend", onTouchEnd);
					try {
						localStorage.setItem("impala_pdf_height_" + pdfId, container.style.height);
						localStorage.setItem("impala_pdf_height", container.style.height);
					} catch {}
				};
				resizer.addEventListener("mousedown", (e) => {
					e.preventDefault();
					startY = e.clientY;
					startH = container.offsetHeight;
					window.addEventListener("mousemove", onMouseMove);
					window.addEventListener("mouseup", onMouseUp);
				});
				resizer.addEventListener("touchstart", (e) => {
					if (!e.touches || !e.touches[0]) return;
					startY = e.touches[0].clientY;
					startH = container.offsetHeight;
					window.addEventListener("touchmove", onTouchMove, { passive: true });
					window.addEventListener("touchend", onTouchEnd);
				}, { passive: true });
			}
		} catch (err) {
			console.error("PDF Viewer Initialisierungsfehler:", err);
			container.innerHTML =
				'<div class="pdf-toolbar">' +
					'<span class="pdf-doc-title">' + lead("file") + U.esc(opts.title || "PDF-Dokument") + '</span>' +
					'<button type="button" class="pdf-action-btn pdf-open-tab-btn">' + lead("external") + 'Im neuen Tab öffnen</button>' +
				'</div>' +
				'<div class="pdf-body" style="padding:24px;text-align:center;">' +
					'<p style="color:var(--text);margin-bottom:12px;">Der interne Viewer konnte das PDF nicht direkt darstellen.</p>' +
					'<button type="button" class="mini pdf-fallback-open btn-primary" style="padding:8px 16px;cursor:pointer;">' + lead("external") + 'Im neuen Tab öffnen</button>' +
				'</div>';
			const fBtn = container.querySelector(".pdf-fallback-open");
			if (fBtn) fBtn.onclick = () => openViewer(pdfId);
			const oBtn = container.querySelector(".pdf-open-tab-btn");
			if (oBtn) oBtn.onclick = () => openViewer(pdfId);
		}
	}

	return { ingest, openViewer, download, mountViewer, urlFor, extractText, ensureLoaded, openDocument };
})();
