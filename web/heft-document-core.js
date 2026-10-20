"use strict";

function signature(value) {
	if (Array.isArray(value.pts)) {
		const first = value.pts[0] || [];
		const last = value.pts[value.pts.length - 1] || [];
		return value.pts.length + "|" + first[0] + "," + first[1] + "|" + last[0] + "," + last[1] + "|" + value.color + "|" + value.size + "|" + (value.shape ? JSON.stringify(value.shape) : "");
	}
	// Bildpixel liegen unveränderlich als eigener Blob vor; nur der Rahmen gehört
	// zur Dokumentänderung. Legacy-src bleibt lesbar, bis alle Altstände ersetzt sind.
	if (value.ref || value.src) {
		const base = value.x + "," + value.y + "," + value.w + "," + value.h + "|" + (value.ref || value.src.length);
		// Erkannter Scan-Text gehört zum Bild. Nur anhängen, wenn er existiert, damit alte Signaturen gleich bleiben.
		return value.ocr !== undefined ? base + "|o" + blobId(value.ocr) : base;
	}
	return JSON.stringify(value);
}

// Seitenmaße einer Heftseite (Weltkoordinaten), gemeinsam für heft.js und den Indexer.
export const PAGE_W = 1000, PAGE_H = 1414;

// EINZIGE Stelle, die den durchsuchbaren Seitentext zusammensetzt: Stricherkennung,
// danach der Text aller Scan-Bilder (in Reihenfolge), mit Zeilenumbruch verbunden.
export function composePageText(strokeText, page) {
	const parts = [String(strokeText || "").trim()];
	for (const im of (page && page.images) || []) {
		if (im && im.ocr) parts.push(String(im.ocr).trim());
	}
	return parts.filter(Boolean).join("\n").trim();
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

// Liefert zugleich die Signaturen des neuen Stands. PERF: Der Schatten für den
// nächsten Vergleich fällt beim Diff ohnehin an — vorher rechnete documentShadow()
// nach jedem Speichern alle Signaturen des ganzen Hefts ein zweites Mal aus.
function diffItems(operations, pageId, kind, previous, items) {
	const removed = new Set(previous ? previous.keys() : []);
	const current = new Map();
	for (const item of items || []) {
		if (!item || !item.id) continue;
		const sig = signature(item);
		current.set(item.id, sig);
		const oldSignature = previous ? previous.get(item.id) : undefined;
		if (oldSignature === undefined) operations.push({ t: kind + "+", p: pageId, o: item });
		else {
			removed.delete(item.id);
			if (oldSignature !== sig) operations.push({ t: kind + "=", p: pageId, o: item });
		}
	}
	if (removed.size) operations.push({ t: kind + "-", p: pageId, ids: [...removed] });
	return current;
}

// { ops, shadow }: ops führen previous in next über, shadow ist documentShadow(next).
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

	const pages = next.pages.map((page) => {
		const oldPage = oldById.get(page.id);
		if (oldPage && oldPage.paper !== page.paper) operations.push({ t: "pgp", p: page.id, paper: page.paper });
		if ((oldPage ? oldPage.ocrText : "") !== (page.ocrText || "")) operations.push({ t: "ocr", p: page.id, text: page.ocrText || "" });
		return {
			id: page.id,
			paper: page.paper,
			ocrText: page.ocrText || "",
			s: diffItems(operations, page.id, "s", oldPage && oldPage.s, page.strokes),
			i: diffItems(operations, page.id, "i", oldPage && oldPage.i, page.images),
			x: diffItems(operations, page.id, "x", oldPage && oldPage.x, page.texts),
		};
	});
	return { ops: operations, shadow: { pages } };
}

// Schreibt Log-Operationen in einen Schatten fort — mit denselben Regeln, mit denen der
// Reducer (state.js applyHeftOps) sie auf das Dokument anwendet. Der Schatten zeigt damit
// immer den Stand im Log, auch wenn das offene Dokument schon lokale, noch nicht
// gespeicherte Änderungen trägt (die bleiben so beim nächsten Diff sichtbar).
const emptyShadowPage = (id, paper) => ({ id, paper: paper || "lined", ocrText: "", s: new Map(), i: new Map(), x: new Map() });
export function applyOpsToShadow(shadow, ops) {
	const pageOf = (id) => shadow.pages.find((page) => page.id === id) || null;
	for (const op of ops || []) {
		if (!op || !op.t) continue;
		const page = op.p ? pageOf(op.p) : null;
		switch (op.t) {
			case "pg+": {
				if (!op.page || !op.page.id || pageOf(op.page.id)) break;
				const at = Math.max(0, Math.min(typeof op.at === "number" ? op.at : shadow.pages.length, shadow.pages.length));
				shadow.pages.splice(at, 0, emptyShadowPage(op.page.id, op.page.paper));
				break;
			}
			case "pg-": {
				const index = shadow.pages.findIndex((x) => x.id === op.p);
				if (index >= 0) shadow.pages.splice(index, 1);
				break;
			}
			case "pgo": {
				const order = Array.isArray(op.order) ? op.order : [];
				const pos = new Map(order.map((id, i) => [id, i]).reverse());
				const rank = (id) => pos.get(id) ?? 1e9;
				shadow.pages = shadow.pages.map((p, i) => [p, i]).sort((a, b) => rank(a[0].id) - rank(b[0].id) || a[1] - b[1]).map((x) => x[0]);
				break;
			}
			case "pgp": if (page) page.paper = op.paper || "lined"; break;
			case "ocr": if (page) page.ocrText = op.text || ""; break;
			default: {
				const items = page && page[op.t[0]];
				if (!(items instanceof Map)) break;
				const mode = op.t[1];
				if (mode === "-") for (const id of op.ids || []) items.delete(id);
				else if (op.o && op.o.id && (mode === "=" || (mode === "+" && !items.has(op.o.id)))) items.set(op.o.id, signature(op.o));
			}
		}
	}
	return shadow;
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
