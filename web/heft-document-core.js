"use strict";

function signature(value) {
	if (Array.isArray(value.pts)) {
		const first = value.pts[0] || [];
		const last = value.pts[value.pts.length - 1] || [];
		return value.pts.length + "|" + first[0] + "," + first[1] + "|" + last[0] + "," + last[1] + "|" + value.color + "|" + value.size + "|" + (value.shape ? JSON.stringify(value.shape) : "");
	}
	// Bildpixel liegen unveränderlich als eigener Blob vor; nur der Rahmen gehört
	// zur Dokumentänderung. Legacy-src bleibt lesbar, bis alle Altstände ersetzt sind.
	if (value.ref || value.src) return value.x + "," + value.y + "," + value.w + "," + value.h + "|" + (value.ref || value.src.length);
	return JSON.stringify(value);
}

const signatureMap = (items) => new Map((items || []).map((item) => [item.id, signature(item)]));

export function documentShadow(document) {
	return {
		pages: (document.pages || []).map((page) => ({
			id: page.id,
			paper: page.paper,
			ocrText: page.ocrText || "",
			s: signatureMap(page.strokes),
			i: signatureMap(page.images),
			x: signatureMap(page.texts),
		})),
	};
}

function diffItems(operations, pageId, kind, previous, items) {
	const removed = new Set(previous ? previous.keys() : []);
	for (const item of items || []) {
		if (!item || !item.id) continue;
		const oldSignature = previous ? previous.get(item.id) : undefined;
		if (oldSignature === undefined) operations.push({ t: kind + "+", p: pageId, o: item });
		else {
			removed.delete(item.id);
			if (oldSignature !== signature(item)) operations.push({ t: kind + "=", p: pageId, o: item });
		}
	}
	if (removed.size) operations.push({ t: kind + "-", p: pageId, ids: [...removed] });
}

export function diffDocument(previous, next) {
	const operations = [];
	const oldPages = (previous && previous.pages) || [];
	const oldById = new Map(oldPages.map((page) => [page.id, page]));
	const nextIds = next.pages.map((page) => page.id);
	const nextSet = new Set(nextIds);

	for (const page of oldPages) if (!nextSet.has(page.id)) operations.push({ t: "pg-", p: page.id });
	let added = false;
	next.pages.forEach((page, index) => {
		if (oldById.has(page.id)) return;
		operations.push({ t: "pg+", at: index, page: { id: page.id, paper: page.paper } });
		added = true;
	});

	// Die Reihenfolge wird nur übertragen, wenn sie sich tatsächlich geändert hat.
	const keptBefore = oldPages.filter((page) => nextSet.has(page.id)).map((page) => page.id).join(",");
	const keptAfter = nextIds.filter((id) => oldById.has(id)).join(",");
	if (added || keptBefore !== keptAfter) operations.push({ t: "pgo", order: nextIds });

	for (const page of next.pages) {
		const oldPage = oldById.get(page.id);
		if (oldPage && oldPage.paper !== page.paper) operations.push({ t: "pgp", p: page.id, paper: page.paper });
		if ((oldPage ? oldPage.ocrText : "") !== (page.ocrText || "")) operations.push({ t: "ocr", p: page.id, text: page.ocrText || "" });
		diffItems(operations, page.id, "s", oldPage && oldPage.s, page.strokes);
		diffItems(operations, page.id, "i", oldPage && oldPage.i, page.images);
		diffItems(operations, page.id, "x", oldPage && oldPage.x, page.texts);
	}
	return operations;
}

export function blobId(data) {
	// Bestehendes 64-Bit-Verfahren bewusst unverändert halten: Die ID ist Teil des
	// persistierten Heftformats und darf sich durch eine Refaktorierung nicht ändern.
	let fnv = 0x811c9dc5;
	let djb = 5381;
	for (let index = 0; index < data.length; index++) {
		const code = data.charCodeAt(index);
		fnv = Math.imul(fnv ^ code, 0x01000193) >>> 0;
		djb = ((djb * 33) ^ code) >>> 0;
	}
	return "b" + data.length.toString(36) + "-" + fnv.toString(36) + djb.toString(36);
}
