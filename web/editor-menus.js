"use strict";

import { S, STATE } from "./state.js";
import { U } from "./util.js";
import { icon, pageIcon } from "./icons.js";
import { PLATFORM } from "./platform.js";

// ---------- Menü- und Popover-Zustand ----------
export let slash = null;      // { items, index, bid, query }
export let linkMenu = null;   // { items, index, query, bid }
export let blockMenuId = null;
export let mathEdit = null;   // { bid, spanEl, delimiters }

// Blocktypen mit EINEM editierbaren Rich-Text-Feld (block.text)
export const TEXTY = { p: 1, h1: 1, h2: 1, h3: 1, bullet: 1, number: 1, todo: 1, quote: 1 };
export const COLORS = ["gray", "red", "orange", "yellow", "green", "blue", "purple", "pink"];

const esc = (t) => U.esc(String(t ?? ""));

export function inlineMathParts(markdown) {
	const md = String(markdown || "");
	if (md.startsWith("\\(") && md.endsWith("\\)")) return { formula: md.slice(2, -2), open: "\\(", close: "\\)" };
	if (md.startsWith("$") && md.endsWith("$")) return { formula: md.slice(1, -1), open: "$", close: "$" };
	return { formula: md, open: "$", close: "$" };
}

// Schnittstelle zum Editor-Zustand (Host, Selektion, Mutationen, Blöcke)
let env = {
	getHost: () => null,
	getPageId: () => null,
	fieldOf: () => null,
	findBlock: () => null,
	findContext: () => null,
	mutate: (fn) => fn(),
	paintTextField: () => {},
	pickFile: () => {},
	newBlock: () => ({}),
	focusBlock: () => {},
	turnInto: () => {},
	syncFieldToModel: () => {},
};

export function initEditorMenus(context) {
	if (context) env = { ...env, ...context };
}

// ---------- Popover-Gerüst (Slash, Links, Blockmenü, Farben, Gleichung) ----------
export function closeMenus() {
	if (typeof document !== "undefined") {
		document.querySelectorAll(".blk-menu, .blk-mathpop").forEach((el) => el.remove());
	}
	slash = null;
	linkMenu = null;
	blockMenuId = null;
	mathEdit = null;
}

export function positionMenu(menu, anchorEl) {
	let r = anchorEl.getBoundingClientRect();
	const selection = typeof window !== "undefined" ? window.getSelection() : null;
	if (selection?.rangeCount && selection.anchorNode && anchorEl.contains(selection.anchorNode)) {
		const caretRange = selection.getRangeAt(0).cloneRange();
		caretRange.collapse(true);
		const caretRect = caretRange.getBoundingClientRect();
		if (caretRect && (caretRect.width || caretRect.height)) r = caretRect;
	}
	const mw = menu.offsetWidth || 280, mh = menu.offsetHeight || 200;
	// iPadOS verkleinert innerHeight nicht, wenn die Bildschirmtastatur offen ist — das
	// Menü landete darunter. visualViewport beschreibt den wirklich sichtbaren Ausschnitt.
	const vv = typeof window !== "undefined" ? window.visualViewport : null;
	const viewTop = vv ? vv.offsetTop : 0;
	const winH = vv ? vv.offsetTop + vv.height : typeof window !== "undefined" ? window.innerHeight : 800;
	const winW = typeof window !== "undefined" ? window.innerWidth : 1200;
	let x = r.left;
	let side = menu.dataset.side;
	if (!side) side = r.bottom + 4 + mh <= winH - 8 ? "below" : "above";
	let y = side === "below" ? r.bottom + 4 : Math.max(viewTop + 8, r.top - mh - 4);
	if (side === "below" && y + mh > winH - 8 && r.top - mh - 4 >= viewTop + 8) {
		side = "above";
		y = r.top - mh - 4;
	}
	if (x + mw > winW - 8) x = Math.max(8, winW - mw - 8);
	menu.dataset.side = side;
	menu.style.left = Math.max(8, x) + "px";
	menu.style.top = y + "px";
}

export function openMenu(anchorEl, html, cls) {
	closeMenus();
	const menu = document.createElement("div");
	menu.className = "blk-menu " + (cls || "");
	menu.innerHTML = html;
	document.body.appendChild(menu);
	positionMenu(menu, anchorEl);
	return menu;
}

// ---------- Slash-Menü ----------
export const SLASH = [
	{ k: "p", icon: "¶", label: "Text", hint: "Einfacher Absatz" },
	{ k: "h1", icon: "H1", label: "Überschrift 1", hint: "# " },
	{ k: "h2", icon: "H2", label: "Überschrift 2", hint: "## " },
	{ k: "h3", icon: "H3", label: "Überschrift 3", hint: "### " },
	{ k: "todo", icon: icon("check-square"), label: "To-do-Liste", hint: "[] " },
	{ k: "bullet", icon: "•", label: "Aufzählung", hint: "- " },
	{ k: "number", icon: "1.", label: "Nummerierte Liste", hint: "1. " },
	{ k: "toggle", icon: "▸", label: "Toggle-Liste", hint: "> aufklappbar" },
	{ k: "quote", icon: "”", label: "Zitat", hint: "> " },
	{ k: "callout", icon: icon("bulb"), label: "Callout", hint: "Hervorgehobener Kasten" },
	{ k: "code", icon: "</>", label: "Code", hint: "Codeblock mit Syntax" },
	{ k: "math", icon: "√", label: "Gleichung", hint: "KaTeX-Formel" },
	{ k: "mermaid", icon: icon("graph"), label: "Diagramm", hint: "Mermaid: Ablauf, Zustände, Zeitachse" },
	{ k: "svg", icon: icon("pen-tool"), label: "SVG-Grafik", hint: "Zeichnung als SVG-Code" },
	{ k: "table", icon: "▦", label: "Tabelle", hint: "Einfache Tabelle" },
	{ k: "columns", icon: icon("columns"), label: "2 Spalten", hint: "Nebeneinander" },
	{ k: "divider", icon: "—", label: "Trennlinie", hint: "---" },
	{ k: "image", icon: icon("image"), label: "Bild", hint: "Hochladen" },
	{ k: "pdf", icon: icon("file"), label: "PDF", hint: "PDF einbetten" },
	{ k: "file", icon: icon("paperclip"), label: "Datei / Medien", hint: "Video, Audio, Sonstige" },
	{ k: "heft", icon: icon("notebook"), label: "Heft", hint: "Handschrift-Einbettung" },
	{ k: "link", icon: icon("link"), label: "Seite verlinken", hint: "[[" },
];

// end = Markdown-Position direkt hinter "/befehl" (Caret beim Tippen).
export function openSlash(bid, query, end) {
	const q = (query || "").toLowerCase();
	const items = SLASH.filter((s) => !q || s.label.toLowerCase().includes(q) || s.k.includes(q));
	if (!items.length) { closeMenus(); return; }
	const field = env.fieldOf(bid, "text");
	if (!field) return;
	const keepIndex = slash && slash.bid === bid ? Math.min(slash.index, items.length - 1) : 0;
	const html = items.map((s, k) =>
		'<div class="blk-mi' + (k === keepIndex ? " active" : "") + '" data-slashpick="' + s.k + '">' +
		'<span class="blk-mi-ic">' + s.icon + '</span><span>' + esc(s.label) +
		'<small>' + esc(s.hint) + "</small></span></div>").join("");
	const existing = slash?.bid === bid ? document.querySelector(".blk-slashmenu") : null;
	if (existing) {
		existing.innerHTML = html;
		positionMenu(existing, field);
	} else {
		openMenu(field, html, "blk-slashmenu");
	}
	slash = { items, index: keepIndex, bid, query: q, end, len: 1 + String(query || "").length };
}

// Führt eine Slash-Auswahl aus: "/befehl" aus dem Text entfernen, Block wandeln.
export async function applySlash(kind) {
	if (!slash) return;
	const { bid, end, len } = slash;
	closeMenus();
	let c = env.findContext(bid);
	if (!c) return;
	// Nur "/befehl" an der Caret-Stelle entfernen. Vorher fiel alles ab dem letzten
	// "/" weg — bei einem Befehl mitten im Satz auch der Text HINTER dem Caret.
	const full = String(c.block.text || "");
	const atCaret = end != null && full[end - len] === "/";
	const text = atCaret ? full.slice(0, end - len) + full.slice(end) : full.replace(/\/[^/]*$/, "");
	if (kind === "link") {
		const cut = atCaret ? end - len : text.length;
		const withLink = text.slice(0, cut) + "[[" + text.slice(cut);
		env.mutate(() => { c.block.text = withLink; }, { soft: true });
		env.paintTextField(bid, withLink, cut + 2);
		openLinkMenu(bid, "", cut + 2);
		return;
	}
	if (kind === "image" || kind === "file" || kind === "pdf") {
		env.mutate(() => { c.block.text = text; }, { soft: true });
		env.paintTextField(bid, text, text.length, false);
		env.pickFile(bid, kind === "image" ? "image/*" : (kind === "pdf" ? "application/pdf,.pdf" : ""));
		return;
	}
	if (kind === "heft") {
		const heftPageId = U.uid();
		const pageId = env.getPageId();
		// Erst die Zielseite dauerhaft anlegen. So kann weder die Vorschau vor der
		// Seite hydriert werden noch bei einem fehlgeschlagenen Dispatch ein verwaister
		// :::heft-Verweis im Dokument landen.
		await STATE.dispatch("pageCreate", {
			id: heftPageId, title: "Heft", parentId: pageId,
			workspaceId: S.pages[pageId] && S.pages[pageId].workspaceId, kind: "heft",
		});
		c = env.findContext(bid);
		if (!c) return;
		env.mutate(() => {
			const nb = { id: U.uid(), type: "heft", heftId: heftPageId };
			c.block.text = text;
			c.list.splice(c.index + 1, 0, nb);
		});
		env.paintTextField(bid, text, text.length, false);
		return;
	}
	env.mutate(() => {
		if (TEXTY[c.block.type] && (kind === "table" || kind === "columns" || kind === "code" || kind === "math" ||
			kind === "mermaid" || kind === "svg" || kind === "divider" || kind === "callout" || kind === "toggle")) {
			// Strukturblock: Rest-Text bleibt als eigener Block erhalten
			const nb = env.newBlock(kind);
			if (kind === "callout" && text) nb.children = [{ id: U.uid(), type: "p", text }];
			if (kind === "toggle" && text) nb.summary = text;
			if (text && kind !== "callout" && kind !== "toggle") {
				c.block.text = text;
				c.list.splice(c.index + 1, 0, nb);
			} else {
				c.list.splice(c.index, 1, nb);
			}
			setTimeout(() => {
				if (kind === "table") env.focusBlock(nb.id, 0, "cell", nb.id + ":0:0");
				else if (kind === "toggle") env.focusBlock(nb.id, null, "summary");
				else if (kind === "code" || kind === "mermaid" || kind === "svg") env.focusBlock(nb.id, 0, "code");
				else if (kind === "math") openMathPop(nb.id);
				else if (nb.columns && nb.columns[0] && nb.columns[0][0]) env.focusBlock(nb.columns[0][0].id, 0);
				else if (nb.children && nb.children[0]) env.focusBlock(nb.children[0].id, 0);
				else if (kind !== "divider") env.focusBlock(nb.id, 0);
			}, 0);
		} else {
			env.turnInto(c.block, kind);
			c.block.text = text;
		}
	});
	// Falls der ursprüngliche Textblock erhalten blieb, muss sein geschützter
	// contenteditable-DOM denselben Stand wie das Modell erhalten. Bei ersetzten
	// Strukturblöcken existiert das Feld nicht mehr und der Aufruf ist wirkungslos.
	env.paintTextField(bid, text, atCaret ? end - len : text.length);
}

// ---------- [[ Seiten-Link-Menü ----------
// end = Markdown-Position direkt hinter "[[suche" (Caret beim Tippen).
export function openLinkMenu(bid, query, end) {
	const q = (query || "").toLowerCase();
	const pageId = env.getPageId();
	const items = STATE.activePages()
		.filter((p) => p.id !== pageId && (!q || String(p.title || "").toLowerCase().includes(q)))
		.slice(0, 8);
	const field = env.fieldOf(bid, "text");
	if (!field) return;
	const keepIndex = linkMenu && linkMenu.bid === bid ? Math.min(linkMenu.index, Math.max(0, items.length - 1)) : 0;
	const html = items.length
		? items.map((p, k) =>
			'<div class="blk-mi' + (k === keepIndex ? " active" : "") + '" data-linkpick="' + p.id + '">' +
			'<span class="blk-mi-ic">' + pageIcon(p, "file") + "</span><span>" + esc(p.title || "Ohne Titel") + "</span></div>").join("")
		: '<div class="blk-mi disabled">Keine Seite gefunden</div>';
	openMenu(field, html, "blk-linkmenu");
	linkMenu = { items, index: keepIndex, bid, query: q, end };
}

export function applyLink(pid) {
	if (!linkMenu) return;
	const { bid, end } = linkMenu;
	closeMenus();
	const c = env.findContext(bid);
	const page = S.pages[pid];
	if (!c || !page) return;
	// Eckige Klammern im Titel beendeten den Link-Text vorzeitig (aus „[Kap. 1] Zelle“ wurde Kaputtes).
	const label = (page.title || "Ohne Titel").replace(/[[\]]/g, "");
	const link = "[" + label + "](#" + pid + ")";
	// Nur "[[suche" vor dem Caret ersetzen — Text dahinter bleibt stehen.
	const full = String(c.block.text || "");
	const start = end != null ? full.lastIndexOf("[[", end - 2) : -1;
	const newText = start >= 0 ? full.slice(0, start) + link + full.slice(end) : full.replace(/\[\[[^\]]*$/, () => link);
	env.mutate(() => {
		c.block.text = newText;
	});
	env.paintTextField(bid, newText, start >= 0 ? start + label.length : newText.length);
}

// ---------- ⋮⋮-Blockmenü (Umwandeln, Farbe, Duplizieren, Löschen …) ----------
export const TURN_TYPES = [
	["p", "Text"], ["h1", "Überschrift 1"], ["h2", "Überschrift 2"], ["h3", "Überschrift 3"],
	["todo", "To-do-Liste"], ["bullet", "Aufzählung"], ["number", "Nummerierte Liste"],
	["toggle", "Toggle-Liste"], ["quote", "Zitat"], ["callout", "Callout"], ["code", "Code"],
];

export function openBlockMenu(bid, anchorEl) {
	const b = env.findBlock(bid);
	if (!b) return;
	const turn = TEXTY[b.type] || b.type === "toggle" || b.type === "callout" || b.type === "code"
		? '<div class="blk-msec">Umwandeln in</div>' + TURN_TYPES.map(([k, label]) =>
			'<div class="blk-mi' + (b.type === k ? " active" : "") + '" data-turninto="' + bid + ":" + k + '">' + esc(label) + "</div>").join("")
		: "";
	const colorsHtml = TEXTY[b.type] || b.type === "callout"
		? '<div class="blk-msec">Farbe</div><div class="blk-colorrow">' +
			COLORS.map((cname) => '<button class="blk-cdot c-' + cname + '" data-bcolor="' + bid + ":c:" + cname + '" title="' + cname + '"></button>').join("") +
			'</div><div class="blk-colorrow">' +
			COLORS.map((cname) => '<button class="blk-cdot hl-' + cname + '" data-bcolor="' + bid + ":bg:" + cname + '" title="' + cname + ' Hintergrund"></button>').join("") +
			'<button class="blk-cdot" data-bcolor="' + bid + ':none:" title="Farbe entfernen">✕</button></div>'
		: "";
	const html = turn + colorsHtml +
		'<div class="blk-msec"></div>' +
		'<div class="blk-mi" data-bdup="' + bid + '">Duplizieren <small>Strg+D</small></div>' +
		'<div class="blk-mi" data-bcopy="' + bid + '">Als Markdown kopieren</div>' +
		(TEXTY[b.type] ? '<div class="blk-mi" data-bflash="' + bid + '">Lernkarte erstellen</div>' : "") +
		'<div class="blk-mi danger" data-bdel="' + bid + '">Löschen <small>Entf</small></div>';
	openMenu(anchorEl, html, "blk-blockmenu");
	blockMenuId = bid;
}

// ---------- Gleichungs-Popover (Block- und Inline-Formeln, wie Notion) ----------
export function openMathPop(bid, spanEl) {
	closeMenus();
	const host = env.getHost();
	const anchor = spanEl || (host && host.querySelector('[data-bmath="' + bid + '"]'));
	if (!anchor) return;
	const inline = spanEl ? inlineMathParts(spanEl.dataset.md) : null;
	const src = inline ? inline.formula : String((env.findBlock(bid) || {}).text || "");
	const pop = document.createElement("div");
	pop.className = "blk-mathpop";
	pop.innerHTML = '<textarea class="blk-mathinput" rows="2" placeholder="E = mc^2">' + esc(src) + "</textarea>" +
		'<div class="blk-mathfoot"><small>Esc = abbrechen</small><button class="blk-mathok">Fertig ↵</button></div>';
	document.body.appendChild(pop);
	const r = anchor.getBoundingClientRect();
	const winW = typeof window !== "undefined" ? window.innerWidth : 1200;
	pop.style.left = Math.max(8, Math.min(r.left, winW - pop.offsetWidth - 8)) + "px";
	pop.style.top = (r.bottom + 6) + "px";
	mathEdit = { bid, spanEl: spanEl || null, delimiters: inline ? [inline.open, inline.close] : null };
	const ta = pop.querySelector("textarea");
	ta.focus();
	if (!PLATFORM.isTouch()) {
		ta.select();
	} else {
		try {
			const len = ta.value.length;
			ta.setSelectionRange(len, len);
		} catch { /* ignore */ }
	}
}

export function commitMathPop() {
	const pop = typeof document !== "undefined" ? document.querySelector(".blk-mathpop") : null;
	if (!pop || !mathEdit) { closeMenus(); return; }
	const value = pop.querySelector("textarea").value.trim();
	const { bid, spanEl, delimiters } = mathEdit;
	closeMenus();
	if (spanEl) {
		// Inline-Formel: data-md des Chips im Modelltext ersetzen
		const field = spanEl.closest("[data-btext],[data-bcell],[data-bsummary]");
		if (!field) return;
		if (value) spanEl.dataset.md = (delimiters?.[0] || "$") + value + (delimiters?.[1] || "$");
		else spanEl.remove();
		env.syncFieldToModel(field);
		env.mutate(() => {}, { soft: true });
		return;
	}
	const c = env.findContext(bid);
	if (!c) return;
	env.mutate(() => {
		if (value) c.block.text = value;
		else c.list.splice(c.index, 1, { id: c.block.id, type: "p", text: "" });
	});
}
