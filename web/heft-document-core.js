"use strict";

// Heft-Dokument im Rust-Kern (core/impala-heft): Diff gegen den zuletzt veröffentlichten Stand,
// Fortschreiben dieses Schattens mit Log-Operationen, Seitentext, Blob-IDs.
import { CORE } from "./rust-core.js";

// Seitenmaße einer Heftseite (Weltkoordinaten), gemeinsam für heft.js und den Indexer.
export const PAGE_W = 1000, PAGE_H = 1414;

// Leere Heftseite: eine Form für Reducer (state.js), Heft-Oberfläche und Import.
export const emptyHeftPage = (id, paper) => CORE.heftEmptyPage(String(id), paper || undefined);

// EINZIGE Stelle, die den durchsuchbaren Seitentext zusammensetzt: Stricherkennung,
// danach der Text aller Scan-Bilder (in Reihenfolge), mit Zeilenumbruch verbunden.
export const composePageText = (strokeText, page) => CORE.heftComposePageText(String(strokeText || ""), page || {});

// Schatten (je Element nur eine Signatur) eines Dokuments; ein Objekt im Kern.
export const documentShadow = (document) => CORE.HeftShadow.of(document);

// { ops, shadow }: ops führen previous (Schatten oder null) in next über, shadow ist der Schatten von next.
export function diffDocument(previous, next) {
	const diff = previous ? previous.diff(next) : CORE.heftDiffFromEmpty(next);
	try { return { ops: diff.ops, shadow: diff.takeShadow() }; } finally { diff.free(); }
}

// Schreibt Log-Operationen in einen Schatten fort — mit denselben Regeln wie der Reducer.
export function applyOpsToShadow(shadow, ops) {
	shadow?.applyOps(ops || []);
	return shadow;
}

// Bestehendes 64-Bit-Verfahren: Die ID ist Teil des persistierten Heftformats.
export const blobId = (data) => CORE.heftBlobId(String(data));
