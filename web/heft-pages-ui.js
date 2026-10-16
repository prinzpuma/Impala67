"use strict";
// Seitenübersicht des Hefts: EIN fester Rahmen aus Kopf, Umschalter und Fußleiste
// für Raster, Verlauf und Auswahl. heft.js gleicht beim Wechsel nur den Kopf an und tauscht
// Inhalt und Fußleiste aus – Höhen und Positionen bleiben gleich, nichts springt.
import { canDeletePages } from "./heft-pages-core.js";
import { icon, lead } from "./icons.js";

const plural = (n) => n + (n === 1 ? " Seite" : " Seiten");
const spacer = '<span class="heft-pp-spacer"></span>';
const foot = (inner) => '<div class="heft-pages-manager-actions heft-pages-foot">' + inner + '</div>';

function head(tab, sub, left) {
	return '<div class="heft-pages-top">' +
		'<div class="heft-pages-manager-head">' + left +
			'<div class="heft-pp-title"><b>Seiten</b><small>' + sub + '</small></div>' +
			'<button type="button" class="heft-pages-icon" data-hepagesclose="1" aria-label="Schließen" title="Schließen">✕</button></div>' +
		'<div class="heft-seg-row heft-pages-seg' + (tab === "history" ? " is-history" : "") + '">' +
			'<button type="button" class="heft-seg' + (tab === "grid" ? " active" : "") + '" data-hepagesback="1">Raster</button>' +
			'<button type="button" class="heft-seg' + (tab === "history" ? " active" : "") + '" data-heverlauf="1">Verlauf</button></div></div>';
}

export const selectionSub = (n) => n + " ausgewählt";
export const selectAllLabel = (n, total) => (n === total ? "Keine" : "Alle");

export function pagesGridHtml({ total, idx, exportSel }) {
	const picking = !!exportSel;
	const n = picking ? exportSel.size : 0;
	const deletable = canDeletePages(total, n);
	let thumbs = "";
	for (let i = 0; i < total; i++) {
		const selected = picking ? exportSel.has(i) : i === idx;
		thumbs += '<div class="heft-pop-thumb' + (selected ? ' active' : '') + '" data-hethumb="' + i + '" role="option" aria-selected="' + (picking && exportSel.has(i) ? 'true' : 'false') + '" tabindex="0" draggable="' + (!picking) + '" title="Seite ' + (i + 1) + '">' +
			'<canvas width="264" height="374"></canvas>' +
			'<span>' + (i + 1) + (picking && exportSel.has(i) ? ' ✓' : '') + '</span>' +
			(!picking ? '<button type="button" class="heft-page-drag" data-hepagedrag="' + i + '" aria-label="Seite verschieben" title="Ziehen zum Verschieben">⠿</button>' : '<i class="heft-page-check">✓</i>') +
		'</div>';
	}
	if (picking) return head("grid", selectionSub(n), '<button type="button" class="heft-pages-text" data-heselectall="1">' + selectAllLabel(n, total) + '</button>') +
		'<div class="heft-pop-grid">' + thumbs + '</div>' +
		foot('<button type="button" class="heft-pages-text" data-heexpcancel="1">Fertig</button><span class="heft-pp-grow"></span>' +
			'<button type="button" class="heft-pages-btn danger" data-hepagesdelete="1"' + (deletable ? '' : ' disabled') + '>' + lead("trash") + 'Löschen (' + n + ')</button>' +
			'<button type="button" class="heft-pages-btn" data-heexportopen="1"' + (n ? '' : ' disabled') + '>Exportieren (' + n + ')</button>');
	return head("grid", plural(total), spacer) +
		'<div class="heft-pop-grid">' + thumbs + '<button type="button" class="heft-pop-add" data-headdend="1"><span>+</span>Neue Seite</button></div>' +
		foot('<button type="button" class="heft-pages-text" data-heexpstart="1">Auswählen</button><span class="heft-pp-grow"></span>' +
			'<button type="button" class="heft-pages-btn" data-heimport="1">' + icon("upload") + 'Importieren</button>');
}

// snaps: Array von Snapshot-Einträgen ({ t, key }); null = lädt noch, [] = keine Stände vorhanden.
export function pagesHistoryHtml(total, snaps) {
	const fmt = (t) => new Date(t).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
	const items = snaps == null ? null : snaps.map((s, i) =>
		'<div class="heft-pop-thumb" data-heverrestore="' + i + '" role="button" tabindex="0" title="Stand ' + fmt(s.t) + ' wiederherstellen">' +
			'<canvas width="264" height="374"></canvas><span>' + fmt(s.t) + '</span></div>').join("");
	const body = items == null ? '<div class="heft-pop-grid heft-pages-empty">Verlauf wird geladen …</div>'
		: items ? '<div class="heft-pop-grid">' + items + '</div>'
		: '<div class="heft-pop-grid heft-pages-empty">Noch keine Stände. Sie entstehen automatisch beim Schreiben (höchstens alle 10 Min., nur auf diesem Gerät).</div>';
	return head("history", plural(total), spacer) + body +
		foot('<span class="heft-pp-hint">Letzte 24 h · antippen zum Wiederherstellen</span>');
}
