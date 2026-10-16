"use strict";
// Standard-Oberfläche der Heft-Werkzeugleiste & Popovers:
// Stift-Favoriten, Strichstärken als Punkte, frei verschiebbare Optionsleiste (Tray)
// sowie „Seite hinzufügen“- und „Bilder“-Menü. Nur HTML/CSS-Bausteine; Zustand und Klicks bleiben in heft.js.
import { PAPERS, COLORS, SIZES } from "./heft-tools.js";
import { icon } from "./icons.js";

const dotPx = (size) => Math.round(Math.max(4, Math.min(12, 2 + size * 1.6)));
const tIcon = (name) => icon(name, "", 19);

// Am linken/rechten Rand dockt das Tray senkrecht an; rechts über `right`, damit es beim Fenster-Resize am Rand bleibt.
export const TRAY_DOCK_PX = 48;

// Senkrecht: Höhe am Heft messen, nicht per CSS-% an .heft-chrome — die ist mit „Tabs in der
// Seitenleiste“ nur eine 42px-Leiste, und die angedockte Leiste zeigte dann nur noch den Griff.
export function trayCss(p, hostHeight = 0) {
	return (p.side === "right" ? "left:auto;right:8px" : "right:auto;left:" + Math.round(p.side === "left" ? 8 : p.x) + "px") +
		";top:" + Math.round(p.y) + "px;bottom:auto;transform:none" +
		(p.side && hostHeight ? ";max-height:" + Math.max(44, hostHeight - Math.round(p.y) - 8) + "px" : "");
}

// Drei Stifte + Marker. Erster Tipp wählt, zweiter Tipp auf den aktiven öffnet Farbe und Dicke.
export function penFavoritesHtml({ pens, penSlot, tool, expanded }, renderIcon = tIcon) {
	const fav = pens.map((p, i) => {
		const on = tool === "pen" && penSlot === i;
		return '<button type="button" data-hepen="' + i + '" class="heft-main heft-penfav' + (on ? " active" : "") + (on && expanded ? " open" : "") +
			'" style="--pen:' + p.color + '" title="Stift ' + (i + 1) + (on ? " – nochmal tippen für Farbe und Dicke" : "") + '">' +
			renderIcon("pen-tool") + '<i class="heft-penfav-dot" style="--d:' + dotPx(p.size) + 'px"></i></button>';
	}).join("");
	const mOn = tool === "marker";
	return fav + '<button type="button" data-hetool="marker" class="heft-main' + (mOn ? " active" : "") + (mOn && expanded ? " open" : "") +
		'" title="Marker' + (mOn ? " – nochmal tippen für Farbe und Dicke" : "") + '">' + renderIcon("marker") + '</button>';
}

export function sizeDotHtml(label, value, active, color) {
	return '<button type="button" class="heft-size heft-size-dot' + (active ? " active" : "") + '" data-hesize="' + value + '" title="Strich: ' + label + '">' +
		'<i style="--d:' + dotPx(value) + 'px;--pen:' + color + '"></i></button>';
}

export function toolbarHtml({
	tool,
	expanded,
	chromeMin,
	color,
	size,
	eraserSize,
	onlyPen,
	pens,
	penSlot,
	popKind,
	phone,
	canBack,
	canForward,
	trayPos,
	hostHeight,
}) {
	const writeOn = tool === "pen" || tool === "marker";
	const showWrite = expanded && writeOn;
	const showEraser = expanded && tool === "eraser";

	const svgPen = tIcon("pen-tool");
	const svgMarker = tIcon("marker");
	const svgEraser = tIcon("eraser");
	const svgLasso = tIcon("lasso");
	const svgLaser = tIcon("laser");
	const svgImage = tIcon("image");
	const svgUndo = tIcon("undo");
	const svgRedo = tIcon("redo");
	const svgHand = tIcon("hand");
	const svgPages = tIcon("pages-stack");
	const svgPlus = tIcon("plus");
	const svgSpark = tIcon("sparkles");
	const svgChevDown = tIcon("chevron-down");
	const writeIcon = tool === "marker" ? svgMarker : svgPen;

	if (chromeMin) {
		return '<div class="heft-chrome heft-chrome-min" aria-hidden="false">' +
			'<div class="heft-float" role="toolbar" aria-label="Werkzeuge">' +
				'<div class="heft-pill heft-pill-min">' +
					'<button type="button" data-heexpand="1" class="heft-main" title="Werkzeugleiste ausklappen">' +
						writeIcon + '<span class="heft-color-dot" style="background:' + color + '"></span>' +
						'<span class="heft-chev">▾</span></button>' +
				'</div>' +
			'</div>' +
		'</div>';
	}

	const trayClass = "heft-tray" + (trayPos && trayPos.side ? " is-vertical" : "");
	const trayStyle = trayPos ? ' style="' + trayCss(trayPos, hostHeight) + '"' : "";

	let tray = "";
	if (showWrite) {
		tray =
			'<div class="' + trayClass + '" data-hetray="1" data-key="tray-write" role="group" aria-label="Schreib-Optionen"' + trayStyle + '>' +
				'<button type="button" class="heft-tray-drag" data-hetraydrag="1" title="Optionen verschieben" aria-label="Optionen verschieben">⠿</button>' +
				SIZES.map((sz) => sizeDotHtml(sz[0], sz[1], size === sz[1], color)).join("") +
				'<span class="heft-sep" aria-hidden="true"></span>' +
				COLORS.map((c) => '<button type="button" class="heft-swatch' + (color === c ? " active" : "") +
					'" data-hecolor="' + c + '" style="--sw:' + c + ';background:' + c + '" title="Farbe"></button>').join("") +
				'<span class="heft-sep" aria-hidden="true"></span>' +
				'<button type="button" data-heonlypen="1" class="heft-opt' + (onlyPen ? " active" : "") +
					'" title="' + (onlyPen ? "Nur Stift zeichnet" : "Finger dürfen zeichnen") + '">' +
					(onlyPen ? svgPen : svgHand) + '</button>' +
			'</div>';
	} else if (showEraser) {
		tray =
			'<div class="' + trayClass + '" data-hetray="1" data-key="tray-eraser" role="group" aria-label="Radierer-Optionen"' + trayStyle + '>' +
				'<button type="button" class="heft-tray-drag" data-hetraydrag="1" title="Optionen verschieben" aria-label="Optionen verschieben">⠿</button>' +
				[["Klein", 10], ["Mittel", 16], ["Groß", 30]].map((z) => '<button type="button" class="heft-size' + (eraserSize === z[1] ? " active" : "") +
					'" data-heerasersize="' + z[1] + '" title="Radierer: ' + z[0] + '"><i style="height:' + Math.max(2, Math.round(z[1] / 5)) + 'px"></i></button>').join("") +
			'</div>';
	}

	return '<div class="heft-chrome" aria-hidden="false">' +
		'<div class="heft-corner-l-group">' +
			'<button type="button" class="heft-corner heft-sb-toggle" data-hesidebar="1" title="Seitenleiste ein-/ausklappen">☰</button>' +
			'<button type="button" class="heft-corner heft-nav-back" data-henavback="1"' + (canBack ? "" : " disabled") + ' title="Zurück">‹</button>' +
			'<button type="button" class="heft-corner heft-nav-forward" data-henavforward="1"' + (canForward ? "" : " disabled") + ' title="Vor">›</button>' +
			'<button type="button" class="heft-corner heft-corner-l' + (popKind === "pages" ? " active" : "") +
				'" data-hepagesmenu="1" title="Seiten">' + svgPages +
				'<span class="heft-pageno-inline"></span></button>' +
			(phone ? '<button type="button" data-heundo="1" class="heft-corner" title="Rückgängig">' + svgUndo + '</button>' +
				'<button type="button" data-heredo="1" class="heft-corner" title="Wiederholen">' + svgRedo + '</button>' : "") +
		'</div>' +
		'<div class="heft-float" role="toolbar" aria-label="Werkzeuge">' +
			'<div class="heft-pill">' +
				penFavoritesHtml({ pens, penSlot, tool, expanded }, tIcon) +
				'<span class="heft-sep" aria-hidden="true"></span>' +
				'<button type="button" data-hetool="eraser" class="heft-main' + (tool === "eraser" ? " active" : "") +
					(showEraser ? " open" : "") + '" title="Radierer">' + svgEraser + '</button>' +
				'<span class="heft-sep" aria-hidden="true"></span>' +
				'<button type="button" data-hetool="lasso" class="heft-main' + (tool === "lasso" ? " active" : "") +
					'" title="Lasso — Striche auswählen">' + svgLasso + '</button>' +
				(phone ? "" : '<button type="button" data-hetool="laser" class="heft-main heft-laser' + (tool === "laser" ? " active" : "") +
					'" title="Laserpointer — nicht speichern">' + svgLaser + '</button>') +
				'<span class="heft-sep" aria-hidden="true"></span>' +
				'<button type="button" data-heimgmenu="1" class="heft-main' +
					(popKind === "img" || tool === "select" ? " active" : "") + '" title="Bilder einfügen oder bearbeiten">' + svgImage + '</button>' +
				(phone ? "" : '<span class="heft-sep" aria-hidden="true"></span>' +
				'<button type="button" data-heundo="1" class="heft-main" title="Rückgängig">' + svgUndo + '</button>' +
				'<button type="button" data-heredo="1" class="heft-main" title="Wiederholen">' + svgRedo + '</button>' +
				'<span class="heft-sep" aria-hidden="true"></span>' +
				'<button type="button" data-hecollapse="1" class="heft-main heft-min-btn" title="Leiste einklappen — mehr Platz zum Schreiben">' + svgChevDown + '</button>') +
			'</div>' +
		'</div>' +
		tray +
		'<div class="heft-corner-r">' +
			'<button type="button" class="heft-corner heft-chat" data-hechat="1" title="KI-Chat">' + svgSpark + '</button>' +
			'<button type="button" class="heft-corner heft-plus' + (popKind === "plus" ? " active" : "") +
				'" data-heplusmenu="1" title="Seite hinzufügen">' + svgPlus + '</button>' +
		'</div>' +
	'</div>';
}

const POS = [["before", "Davor"], ["after", "Danach"], ["last", "Am Ende"]];

export function plusPopHtml({ insertPos, curPaper }, renderIcon = icon) {
	const paper = (p, attr, active) => '<button type="button" class="heft-tpl' + (active ? " active" : "") + '" ' + attr + '="' + p[0] + '">' +
		'<i class="heft-tpl-paper heft-tpl-' + p[0] + '"></i><span>' + p[2] + '</span></button>';
	return '<div class="heft-pop-head">Neue Seite</div>' +
		'<div class="heft-seg-row">' + POS.map(([k, l]) => '<button type="button" class="heft-seg' + (insertPos === k ? " active" : "") + '" data-hepos="' + k + '">' + l + '</button>').join("") + '</div>' +
		'<div class="heft-tpl-row">' + PAPERS.map((p) => paper(p, "data-headdtpl", false)).join("") + '</div>' +
		'<div class="heft-pop-head">Papier dieser Seite</div>' +
		'<div class="heft-paper-chips">' + PAPERS.map((p) => '<button type="button" class="heft-paper-chip' + (p[0] === curPaper ? " active" : "") + '" data-hesetpaper="' + p[0] + '">' +
			'<i class="heft-tpl-paper heft-tpl-' + p[0] + '"></i>' + p[2] + '</button>').join("") + '</div>' +
		'<div class="heft-pop-sep"></div>' +
		'<button type="button" class="heft-pop-row" data-headdimg="1">' + renderIcon("image") + 'Bild als Seite</button>' +
		'<button type="button" class="heft-pop-row" data-heimport="1">' + renderIcon("upload") + 'PDF oder Bild importieren</button>' +
		'<button type="button" class="heft-pop-row" data-hescan="1">' + renderIcon("camera") + 'Dokument scannen</button>';
}

export function imgPopHtml(renderIcon = icon) {
	return '<div class="heft-pop-head">Bilder</div>' +
		'<button type="button" class="heft-pop-row" data-hetool="select">' + renderIcon("select") + 'Bilder & Texte auswählen & bearbeiten</button>' +
		'<div class="heft-pop-sep"></div>' +
		'<button type="button" class="heft-pop-row" data-hetextadd="1">' + renderIcon("pen") + 'Text schreiben</button>' +
		'<button type="button" class="heft-pop-row" data-heimgadd="1">' + renderIcon("image") + 'Bild hinzufügen</button>' +
		'<button type="button" class="heft-pop-row" data-heimgcam="1">' + renderIcon("camera") + 'Bild aufnehmen</button>' +
		'<div class="heft-pop-sub">Ausgewähltes lässt sich verschieben, skalieren oder löschen. Doppeltipp auf eine Text-Box bearbeitet den Text.</div>';
}
