"use strict";
// Standard-Oberfläche der Heft-Werkzeugleiste:
// Stift-Favoriten statt eines „Schreiben“-Knopfs, Dicken als echte Punkte, ruhigeres
// „Seite hinzufügen“-Menü. Nur HTML-Bausteine; Zustand und Klicks bleiben in heft.js.
import { PAPERS } from "./heft-tools.js";

const dotPx = (size) => Math.round(Math.max(4, Math.min(12, 2 + size * 1.6)));

// Drei Stifte + Marker. Erster Tipp wählt, zweiter Tipp auf den aktiven öffnet Farbe und Dicke.
export function penFavoritesHtml({ pens, penSlot, tool, expanded }, icon) {
	const fav = pens.map((p, i) => {
		const on = tool === "pen" && penSlot === i;
		return '<button type="button" data-hepen="' + i + '" class="heft-main heft-penfav' + (on ? " active" : "") + (on && expanded ? " open" : "") +
			'" style="--pen:' + p.color + '" title="Stift ' + (i + 1) + (on ? " – nochmal tippen für Farbe und Dicke" : "") + '">' +
			icon("pen-tool") + '<i class="heft-penfav-dot" style="--d:' + dotPx(p.size) + 'px"></i></button>';
	}).join("");
	const mOn = tool === "marker";
	return fav + '<button type="button" data-hetool="marker" class="heft-main' + (mOn ? " active" : "") + (mOn && expanded ? " open" : "") +
		'" title="Marker' + (mOn ? " – nochmal tippen für Farbe und Dicke" : "") + '">' + icon("marker") + '</button>';
}

export function sizeDotHtml(label, value, active, color) {
	return '<button type="button" class="heft-size heft-size-dot' + (active ? " active" : "") + '" data-hesize="' + value + '" title="Strich: ' + label + '">' +
		'<i style="--d:' + dotPx(value) + 'px;--pen:' + color + '"></i></button>';
}

const POS = [["before", "Davor"], ["after", "Danach"], ["last", "Am Ende"]];

export function plusPopBetaHtml({ insertPos, curPaper }, icon) {
	const paper = (p, attr, active) => '<button type="button" class="heft-tpl' + (active ? " active" : "") + '" ' + attr + '="' + p[0] + '">' +
		'<i class="heft-tpl-paper heft-tpl-' + p[0] + '"></i><span>' + p[2] + '</span></button>';
	return '<div class="heft-pop-head">Neue Seite</div>' +
		'<div class="heft-seg-row">' + POS.map(([k, l]) => '<button type="button" class="heft-seg' + (insertPos === k ? " active" : "") + '" data-hepos="' + k + '">' + l + '</button>').join("") + '</div>' +
		'<div class="heft-tpl-row">' + PAPERS.map((p) => paper(p, "data-headdtpl", false)).join("") + '</div>' +
		'<div class="heft-pop-head">Papier dieser Seite</div>' +
		'<div class="heft-paper-chips">' + PAPERS.map((p) => '<button type="button" class="heft-paper-chip' + (p[0] === curPaper ? " active" : "") + '" data-hesetpaper="' + p[0] + '">' +
			'<i class="heft-tpl-paper heft-tpl-' + p[0] + '"></i>' + p[2] + '</button>').join("") + '</div>' +
		'<div class="heft-pop-sep"></div>' +
		'<button type="button" class="heft-pop-row" data-headdimg="1">' + icon("image") + 'Bild als Seite</button>' +
		'<button type="button" class="heft-pop-row" data-heimport="1">' + icon("upload") + 'PDF oder Bild importieren</button>' +
		'<button type="button" class="heft-pop-row" data-hescan="1">' + icon("camera") + 'Dokument scannen</button>';
}
