"use strict";

import { PDFS } from "./pdfs.js";
import { U } from "./util.js";

// PDFs aus Clipboard und Web Share Target werden in die bestehende PDF-Pipeline
// übergeben. Die Datei selbst wird immer von PDFS.ingest() gespeichert.
export const PDFPASTE = (() => {
	const SHARE_CACHE = "impala67-pdf-share";
	const SHARE_PAYLOAD = "/share-target-payload";

	async function ingest(file) {
		if (!file || file.type !== "application/pdf") return false;
		try {
			U.toast("📄 PDF wird importiert…");
			await PDFS.ingest(file, (message) => U.toast(message));
			return true;
		} catch (error) {
			U.toast("PDF-Import fehlgeschlagen: " + (error.message || error), "error");
			return false;
		}
	}

	function initPaste() {
		window.addEventListener("paste", async (event) => {
			// Textfelder behalten ihr normales Einfüge-Verhalten.
			const active = document.activeElement;
			if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable)) return;

			const items = event.clipboardData && event.clipboardData.items;
			if (!items) return;
			for (const item of items) {
				if (item.type !== "application/pdf") continue;
				const file = item.getAsFile();
				if (!file) return;
				event.preventDefault();
				await ingest(file);
				return;
			}
		});
	}

	async function initShareTarget() {
		const shared = new URLSearchParams(location.search).get("share-target") === "1";
		if (!shared || !("caches" in window)) return;
		try {
			const cache = await caches.open(SHARE_CACHE);
			const response = await cache.match(SHARE_PAYLOAD);
			if (!response) return;
			const blob = await response.blob();
			await cache.delete(SHARE_PAYLOAD);
			if (!blob.size) return;
			await ingest(new File([blob], "shared.pdf", { type: "application/pdf" }));
		} catch (error) {
			console.warn("Share-Target-PDF konnte nicht geöffnet werden:", error);
			U.toast("Geteiltes PDF konnte nicht geöffnet werden.", "error");
		}
	}

	initPaste();
	initShareTarget();

	return { ingest, initPaste, initShareTarget };
})();