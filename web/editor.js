"use strict";
import { S, STATE } from "./state.js";
import { U } from "./util.js";
import { DB } from "./db.js";
import { RAG } from "./rag.js";
import { HEFT } from "./heft.js";
import { PDFS } from "./pdfs.js";
import { PERF_PROFILER } from "./performance-profiler.js";
import { icon, lead, pageIcon } from "./icons.js";
import {
	parse as parseMarkdown,
	serialize as serializeMarkdown,
	serializeBlock,
	FENCE,
	LISTY,
	mimeFromName,
} from "./editor-markdown.js";
import {
	initEditorMenus,
	closeMenus,
	openSlash,
	applySlash,
	openLinkMenu,
	applyLink,
	openBlockMenu,
	openMathPop,
	commitMathPop,
	TEXTY,
	slash,
	linkMenu,
	mathEdit,
} from "./editor-menus.js";
import {
	inlineHtml,
	mdFromEditable,
	splitFieldAtCaret,
	hydrateKatex,
	hydrateInlineMath,
	visibleLength,
	isSafeHref,
	caretInfo,
	setCaret,
} from "./editor-inline.js";
import { createBlockKeys } from "./editor-keys.js";
import { diagramLang, renderDiagram } from "./diagram.js";

export const EDITOR = (() => {

	// ---------- Zustand ----------
	let host = null;          // #blockEditor-Container (pro renderMain neu)
	let pageId = null;
	let blocks = [];          // Blockobjekte = interne Wahrheit dieser Sitzung
	let linkMenuTimer = 0;    // PERF: Debounce für openLinkMenu beim Tippen hinter "[["
	let dragBid = null;
	let mouseSelFrom = -1;    // Startblock eines Maus-Drags — Markieren über Blockgrenzen
	let crossSelJust = false; // Klick direkt nach Cross-Block-Drag darf die Auswahl nicht löschen
	let composing = false;    // IME aktiv → keine Live-Transformationen
	let selRange = null;      // Blockauswahl { from, to } (Indizes in blocks)
	let selAnchor = null;
	let selAll = false;
	let gutterDrag = false;
	let gutterFrom = -1;
	let ctrlAArmed = false;   // zweistufiges Strg+A wie in Notion
	let lastColor = "bg:yellow"; // Strg+Shift+H = letzte Farbe erneut
	let saveTimer = 0;
	let lastSaved = "";      // Inhalt, den der Editor selbst zuletzt geschrieben hat
	const ownPending = new Map(); // pageId → Zahl eigener, noch nicht angewandter pageUpdate-Dispatches
	let histTimer = 0;
	let histPending = false;
	let histState = "";       // letzter festgeschriebener Snapshot (JSON)
	let histFocus = null;
	let renderBoundary = null; // einmalige DOM-Marke für exakte Merge-Caretposition
	// Lesemodus: Wer ihn wann will, entscheidet der Aufrufer (Handy-UI) über setReadOnly(fn).
	// render() fragt ihn pro Seite neu ab; Felder bekommen dann contenteditable="false".
	let readOnlyFn = null;
	let readOnly = false;
	let listNums = new Map(); // Block-ID → Listennummer, vor jedem render() berechnet	// v3 (25. Juli): scrollReserve entfallen. Der Editor baut seinen DOM nicht mehr bei
	// jedem Render neu auf (U.morph gleicht nur Unterschiede an) — dadurch ändert sich die
	// Gesamthöhe nicht mehr schlagartig, der Browser klemmt scrollTop nicht mehr, und die
	// ganze Anker-Rechnerei samt End-Reserve wird nicht mehr gebraucht.
	const undoStacks = {};    // je Seite: [{ json, focus }]
	const redoStacks = {};
	let styleInjected = false;
	let globalWired = false;
	// mount() kann für denselben DOM-Host mehrfach laufen (z. B. nach einem
	// App-Render). Listener dürfen dann nicht doppelt hängen: doppelte input-/
	// keydown-Handler erzeugen sonst doppelte Mutationen, ungleiches Löschtempo
	// und eine History, die scheinbar zufällig Schritte überspringt.
	const wiredHosts = new WeakSet();
	const HISTORY_LIMIT = 200;
	// Verlaufsspeicher bleibt beschränkt: pro Seite bis HISTORY_LIMIT Schritte, aber nur
	// für die letzten HISTORY_PAGES besuchten Seiten. Vorher hielt die App jeden
	// Schnappschuss JEDER je geöffneten Seite bis zum Neuladen im Speicher — bei langen
	// Sitzungen wuchs der Verbrauch unbegrenzt.
	const HISTORY_PAGES = 3;
	const histPages = [];
	function touchHistoryPage(pid) {
		const k = histPages.indexOf(pid);
		if (k >= 0) histPages.splice(k, 1);
		histPages.unshift(pid);
		for (const alt of histPages.splice(HISTORY_PAGES)) { delete undoStacks[alt]; delete redoStacks[alt]; }
	}

	// Object-URLs je Blob-ID EINMAL erzeugen und wiederverwenden.
	// FIX (25. Juli, Speicherleck): hydrate() lief bisher bei JEDEM Render — also bei
	// jedem Enter, jeder Listen-Umwandlung, jedem Undo — komplett neu, weil host.innerHTML
	// alle Elemente ersetzte und die dataset.hydrated-Wachen deshalb nie greifen konnten.
	// Pro Durchlauf entstand für JEDES Bild und JEDE Datei ein neuer Object-URL, der nie
	// freigegeben wurde: auf einer bildlastigen Seite wuchs der Speicher mit jedem
	// Tastendruck. Der gemeinsame Cache liegt jetzt in db.js (DB.blobUrl) — ein
	// Object-URL je Blob für die ganze App, freigegeben beim Löschen des Blobs.

	// LISTY (editor-markdown.js) und TEXTY (editor-menus.js) kommen aus den Teilmodulen.

	const uid = () => U.uid();
	// Diagramm-Blöcke, deren Code gerade offen ist (nur Anzeige, wird nie gespeichert)
	const diagramEdit = new Set();
	const esc = (t) => U.esc(String(t ?? ""));

	// ---------- Modell: Block-Fabriken & Baum-Navigation ----------
	function newBlock(kind) {
		// Eine Blockauswahl erzeugt NUR Struktur, nie Platzhaltertext.
		if (kind === "table") return { id: uid(), type: "table", rows: [["", ""], ["", ""]] };
		if (kind === "columns") return { id: uid(), type: "columns", columns: [[newBlock("p")], [newBlock("p")]] };
		if (kind === "code") return { id: uid(), type: "code", language: "javascript", text: "" };
		if (kind === "mermaid" || kind === "svg") return { id: uid(), type: "code", language: kind, text: "" };
		if (kind === "math") return { id: uid(), type: "math", text: "" };
		if (kind === "divider") return { id: uid(), type: "divider" };
		if (kind === "callout") return { id: uid(), type: "callout", color: "blue", children: [newBlock("p")] };
		if (kind === "toggle") return { id: uid(), type: "toggle", summary: "", open: true, children: [newBlock("p")] };
		if (kind === "todo") return { id: uid(), type: "todo", checked: false, indent: 0, text: "" };
		if (kind === "bullet" || kind === "number") return { id: uid(), type: kind, indent: 0, text: "" };
		if (kind === "h1" || kind === "h2" || kind === "h3" || kind === "quote") return { id: uid(), type: kind, text: "" };
		return { id: uid(), type: "p", text: "" };
	}

	// Sucht einen Block auch in Callout-Kindern, Toggle-Kindern und Spalten.
	// parent = umschließender Block (macht verschachtelte Blöcke als Einheit behandelbar).
	function scanContext(id, list, parent) {
		for (let index = 0; index < list.length; index++) {
			const block = list[index];
			if (block.id === id) return { list, index, block, parent };
			if (block.children) {
				const nested = scanContext(id, block.children, block);
				if (nested) return nested;
			}
			if (block.columns) {
				for (const column of block.columns) {
					const found = scanContext(id, column, block);
					if (found) return found;
				}
			}
		}
		return null;
	}
	// PERF: Blockzugriff über einen Index statt Baumsuche. findContext lief bei JEDEM
	// Tastendruck mehrfach rekursiv durch den GANZEN Blockbaum (input →
	// syncFieldToModel → findBlock, caretInfo → findContext, topIndexOf sogar je
	// Elternebene erneut) — auf langen Seiten der Hauptgrund fürs Tipp-Ruckeln.
	// Reines Tippen ändert die Struktur nicht, der Index bleibt also gültig.
	let ctxIdx = null;
	let ctxLive = true; // false = laufende Strukturmutation, Index nicht vertrauenswürdig
	const bustCtxIdx = () => { ctxIdx = null; };
	function buildCtxIdx(list, parent, map) {
		for (let index = 0; index < list.length; index++) {
			const block = list[index];
			map.set(block.id, { list, index, block, parent });
			if (block.children) buildCtxIdx(block.children, block, map);
			if (block.columns) for (const column of block.columns) buildCtxIdx(column, block, map);
		}
		return map;
	}
	function findContext(id) {
		// Während fn() in mutate() verschieben sich Indizes laufend — dort exakt wie
		// früher direkt suchen, statt einen halbfertigen Index zu befragen.
		if (!ctxLive) return scanContext(id, blocks, null);
		if (!ctxIdx) ctxIdx = buildCtxIdx(blocks, null, new Map());
		return ctxIdx.get(id) || null;
	}
	const findBlock = (id) => { const c = findContext(id); return c && c.block; };
	// Index im TOP-LEVEL-Array. Für verschachtelte Blöcke (Callout/Toggle/Spalte)
	// wandert die Suche den Elternpfad hoch — sonst schlägt selectBlocks fehl
	// (topIndexOf fand z. B. ein Bild in einem Callout nie).
	const topIndexOf = (b) => {
		if (!b) return -1;
		let c = findContext(b.id || b);
		while (c && c.parent) c = findContext(c.parent.id);
		return c ? c.index : -1;
	};
	// Selektiert den äußersten Top-Level-Block eines (ggf. verschachtelten) Blocks.
	function selectTopOf(b) {
		const i = topIndexOf(b);
		if (i >= 0) { selAnchor = i; selectBlocks(i, i); return true; }
		return false;
	}

	// Tiefe Kopie mit NEUEN IDs (für Duplizieren) — sonst kollidieren DOM-Anker.
	function reassignIds(b) {
		b.id = uid();
		if (b.children) b.children.forEach(reassignIds);
		if (b.columns) b.columns.forEach((col) => col.forEach(reassignIds));
		return b;
	}
	const cloneBlock = (b) => reassignIds(JSON.parse(JSON.stringify(b)));

	function plainTextOf(b) {
		if (TEXTY[b.type]) return String(b.text || "");
		if (b.type === "code" || b.type === "math") return String(b.text || "");
		if (b.type === "callout" || b.type === "toggle") {
			return (b.type === "toggle" ? String(b.summary || "") + "\n" : "") +
				(b.children || []).map(plainTextOf).join("\n");
		}
		if (b.type === "table") return (b.rows || []).map((r) => r.join(" ")).join("\n");
		if (b.type === "columns") return (b.columns || []).map((col) => col.map(plainTextOf).join("\n")).join("\n");
		if (b.type === "image") return b.alt || "";
		if (b.type === "file") return b.name || "";
		return "";
	}

	// ---------- Markdown-Parsing und Serialisierung (editor-markdown.js) ----------
	const parse = (md, customUid) => PERF_PROFILER.measure("editor.parse", () => parseMarkdown(md, customUid || uid), { length: (md || "").length }, 15);
	const serializeList = (list) => serializeMarkdown(list);
	const serialize = (customBlocks) => PERF_PROFILER.measure("editor.serialize", () => serializeMarkdown(customBlocks !== undefined ? customBlocks : blocks), { blocks: (customBlocks || blocks)?.length }, 15);

	// Notion hat genau EINEN Seitenscroller am rechten Fensterrand. Nur dieser
	// darf bewegt werden; niemals #blockEditor oder ein beliebiger Vorfahr.
	function scrollRoot() {
		return host && (host.closest(".page-scroll") || host);
	}

	function keepCaretVisible() {
		const root = scrollRoot();
		const sel = window.getSelection();
		if (!root || !sel || !sel.rangeCount) return;
		const rr = root.getBoundingClientRect();
		let cr = sel.getRangeAt(0).getBoundingClientRect();
		if (!cr || (!cr.width && !cr.height)) {
			const el = sel.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement);
			cr = el && el.getBoundingClientRect ? el.getBoundingClientRect() : null;
		}
		if (!cr) return;
		const pad = 18;
		if (cr.top < rr.top + pad) root.scrollTop -= (rr.top + pad - cr.top);
		else if (cr.bottom > rr.bottom - pad) root.scrollTop += (cr.bottom - (rr.bottom - pad));
	}

	function focusBoundary(marker) {
		if (!marker) return false;
		const field = marker.closest("[data-btext]");
		if (!field) return false;
		field.focus({ preventScroll: true });
		const sel = window.getSelection();
		const range = document.createRange();
		range.setStartBefore(marker);
		range.collapse(true);
		sel.removeAllRanges();
		sel.addRange(range);
		// Die Marke darf beim nächsten Backspace nicht als „leeres Zeichen“ im Weg
		// stehen. Nach remove() bleibt die Range am gleichen DOM-Grenzpunkt.
		marker.remove();
		keepCaretVisible();
		return true;
	}

	function fieldOf(bid, kind, cell) {
		if (!host) return null;
		if (kind === "cell" && cell) return host.querySelector('[data-bcell="' + cell + '"]');
		if (kind === "summary") return host.querySelector('[data-bsummary="' + bid + '"]');
		if (kind === "code") return host.querySelector('[data-bcode="' + bid + '"]');
		return host.querySelector('[data-btext="' + bid + '"]');
	}

	function focusBlock(bid, offset, kind, cell) {
		const field = fieldOf(bid, kind || "text", cell);
		if (field) setCaret(field, offset);
		else {
			// Nicht-Text-Block (Bild, Trennlinie …) → äußersten Top-Level-Block selektieren
			// (auch tief verschachtelt: Tabelle in Callout in Toggle).
			const c = findContext(bid);
			if (c) selectTopOf(c.block);
		}
	}

	// Slash-Befehle ändern nicht nur die Blockstruktur, sondern auch den Text im
	// gerade fokussierten contenteditable. U.morph bewahrt diesen DOM absichtlich,
	// damit normales Tippen nie überschrieben wird. Befehle müssen den sichtbaren
	// Feldinhalt deshalb ausdrücklich mit ihrer Modelländerung synchronisieren.
	function paintTextField(bid, text, offset, refocus = true) {
		const field = fieldOf(bid, "text");
		if (!field) return false;
		field.innerHTML = inlineHtml(text);
		hydrateInlineMath(field);
		if (refocus) setCaret(field, offset);
		return true;
	}

	// ---------- Undo/Redo: seitenweite Snapshots + Caret-Restore ----------
	// Wie Notion: App-eigene History, NIE die Browser-History (execCommand).
	function snapshotJson() { return JSON.stringify(blocks); }

	function commitHistory(skipSnapshot) {
		if (!histPending) return;
		histPending = false;
		const stack = undoStacks[pageId] || (undoStacks[pageId] = []);
		const root = scrollRoot();
		stack.push({ json: histState, focus: histFocus, scrollTop: root ? root.scrollTop : 0 });
		if (stack.length > HISTORY_LIMIT) stack.shift();
		redoStacks[pageId] = [];
		// mutate() schreibt histState nach fn() selbst — ein Snapshot hier wäre doppelte Arbeit.
		if (!skipSnapshot) histState = snapshotJson();
	}

	// checkpoint(): VOR einer Änderung aufrufen. Tipp-Änderungen werden 700ms
	// gebündelt (ein Undo-Schritt pro Tipp-Phase, wie in Notion), strukturelle
	// Änderungen (force) schreiben sofort fest.
	function checkpoint(force, skipSnapshot) {
		if (!histPending) {
			histPending = true;
			histFocus = caretInfo();
		}
		clearTimeout(histTimer);
		if (force) commitHistory(skipSnapshot);
		else histTimer = setTimeout(commitHistory, 700);
	}

	function undoRedo(redo) {
		commitHistory();
		const from = redo ? redoStacks[pageId] : undoStacks[pageId];
		const to = redo ? (undoStacks[pageId] || (undoStacks[pageId] = [])) : (redoStacks[pageId] || (redoStacks[pageId] = []));
		if (!from || !from.length) { U.toast(redo ? "Nichts zu wiederholen" : "Nichts rückgängig zu machen"); return; }
		const entry = from.pop();
		const root = scrollRoot();
		to.push({ json: snapshotJson(), focus: caretInfo(), scrollTop: root ? root.scrollTop : 0 });
		if (to.length > HISTORY_LIMIT) to.shift();
		blocks = JSON.parse(entry.json);
		bustCtxIdx(); // andere Blockobjekte → alter Index zeigt ins Leere
		histState = entry.json;
		histPending = false;
		// Alte Blockauswahl verwerfen — ihre Indizes zeigen nach dem Undo ins Leere
		selRange = null;
		selAnchor = null;
		// Der DOM-Abgleich schützt das gerade fokussierte contenteditable beim Tippen
		// absichtlich vor Überschreiben. Beim Undo/Redo ist aber der wiederhergestellte
		// Snapshot führend; ohne Fokusverlust blieb deshalb der alte Text sichtbar und
		// das erste Strg+Z wirkte nach Enter + Tippen scheinbar wirkungslos.
		const active = document.activeElement;
		if (active && host.contains(active) && typeof active.blur === "function") active.blur();
		render({ anchorId: entry.focus && entry.focus.bid });
		if (entry.focus) focusBlock(entry.focus.bid, entry.focus.offset, entry.focus.kind, entry.focus.cell);
		// Scroll NACH dem Fokus wiederherstellen, sonst zieht keepCaretVisible/focus
		// den Viewport oft an den Seitenanfang.
		if (root && typeof entry.scrollTop === "number") {
			root.scrollTop = entry.scrollTop;
			requestAnimationFrame(() => { root.scrollTop = entry.scrollTop; });
		}
		save(true);
	}

	// ---------- Speichern (Hintergrund-Markdown) ----------
	function save(now) {
		clearTimeout(saveTimer);
		saveTimer = 0;
		const run = () => {
			const pg = S.pages[pageId];
			if (!pg) return;
			const content = serialize();
			// lastSaved = Stand, den der Editor selbst geschrieben hat. Nur damit lässt sich
			// später eine EXTERNE Änderung (Sync) von eigenen, noch nicht gespeicherten
			// Tastendrücken unterscheiden — ohne bei jedem Render die ganze Seite neu zu
			// serialisieren.
			lastSaved = content;
			if (content === pg.content) return;
			// viaEditor: dieser Autosave kommt vom Editor selbst — sein DOM/Scroll ist
			// längst konsistent (render() lief schon in mutate()/undoRedo()). dispatch()
			// persistiert asynchron (erst nach dem IndexedDB-Write feuert onStateChange),
			// also lange NACH unserer eigenen Fokus-/Scroll-Wiederherstellung — und oft
			// genau dann, wenn der Fokus (z.B. nach einem strukturellen Undo mit reiner
			// Blockauswahl statt Textfokus) nicht mehr in einem Textfeld liegt. render.js
			// hielt das für eine EXTERNE Änderung und baute #main komplett neu auf —
			// der frische Scroll-Container begann dann immer bei 0 („springt nach oben“).
			// Bis reduce() läuft, hat pg.content noch den ALTEN Stand. mount() darf das in
			// diesem Fenster nicht für eine externe Änderung halten (sonst parst ein
			// dazwischenkommender App-Render den veralteten Inhalt, z.B. nach schnellem Undo/Redo).
			const pid = pageId;
			ownPending.set(pid, (ownPending.get(pid) || 0) + 1);
			STATE.dispatch("pageUpdate", { id: pid, patch: { content }, viaEditor: true }).finally(() => {
				const n = (ownPending.get(pid) || 1) - 1;
				if (n) ownPending.set(pid, n); else ownPending.delete(pid);
			});
			RAG.queuePage(pid);
		};
		if (now) run();
		else saveTimer = setTimeout(() => { saveTimer = 0; run(); }, 450);
	}

	// mutate(): die eine Transaktions-Klammer für ALLE Strukturänderungen.
	function mutate(fn, opts) {
		const soft = !!(opts && opts.soft);
		checkpoint(!soft, true);
		// Strukturänderung: Blockindex verwerfen und während fn() direkt suchen.
		ctxLive = false;
		try { fn(); } finally {
			bustCtxIdx(); ctxLive = true;
			// Nach Struktur-Mutation muss histState dem IST-Zustand entsprechen — sonst
			// hinkt die History hinterher und Strg+Z stellt oft denselben Stand wieder her.
			// checkpoint() hat den Vorzustand bereits festgeschrieben (ohne eigenen Snapshot).
			if (!soft) { histState = snapshotJson(); histPending = false; }
		}
		if (!(opts && opts.noRender)) render(opts);
		save(!!(opts && opts.saveNow));
	}

	// ---------- Rendern (WYSIWYG — identisches Design in Ruhe & Bearbeitung) ----------
	const colorStyle = (b) => {
		let s = "";
		if (b.textColor) s += "color:var(--c-" + b.textColor + ");";
		if (b.bgColor) s += "background:var(--bg-" + b.bgColor + ");";
		return s ? ' style="' + s + '"' : "";
	};

	// Ein editierbares Rich-Text-Feld. data-btext/-bsummary/-bcell/-bcode sind
	// die einzigen Anker, über die Events dem Modell zugeordnet werden.
	function editable(b, opts) {
		const o = opts || {};
		const attr = o.attr || ('data-btext="' + b.id + '"');
		const cls = "blk-text" + (o.cls ? " " + o.cls : "");
		const raw = o.raw != null ? o.raw : (b.text || "");
		let html = o.plain ? esc(raw) : inlineHtml(raw);
		if (!o.plain && renderBoundary && renderBoundary.bid === b.id && o.attr == null) {
			html = inlineHtml(renderBoundary.before) + '<span data-caret-boundary="1"></span>' + inlineHtml(renderBoundary.after);
		}
		return '<div class="' + cls + '" ' + attr + ' contenteditable="' + !readOnly + '" spellcheck="false" data-placeholder="' +
			esc(o.ph || "") + '"' + (o.style || "") + ">" + html + "</div>";
	}

	// Code-Text → HTML mit Syntax-Highlight. U.highlightCode arbeitet auf DOM-
	// Elementen — hier brauchen wir aber einen HTML-String (hljs global per CDN).
	function codeHtml(text, language) {
		const src = String(text || "");
		if (window.hljs) {
			try {
				if (language && hljs.getLanguage(language)) return hljs.highlight(src, { language }).value;
			} catch { /* unten escaped */ }
		}
		return esc(src);
	}

	// Diagramm-Codeblock (```mermaid / ```svg): fertig gerendert anzeigen, Klick öffnet
	// den Code darüber mit Live-Vorschau darunter; Fokusverlust schließt ihn wieder.
	// data-key = Quelle: unveränderte Diagramme behalten ihr SVG (kein Neu-Rendern).
	function diagramBlockHtml(b) {
		const src = String(b.text || "");
		const editing = !readOnly && (diagramEdit.has(b.id) || !src.trim());
		const view = '<div class="blk-diagram" data-bdiagram="' + b.id + '" data-key="dg:' + esc(b.language) + ":" + esc(src) +
			'" data-owned="1" data-dglang="' + esc(b.language) + '" data-dgsrc="' + esc(src) + '" contenteditable="false"' +
			(editing ? "" : ' tabindex="0" role="button" aria-label="Diagramm bearbeiten"') + "></div>";
		if (!editing) return '<div class="blk-codewrap blk-dgwrap">' + view + "</div>";
		return '<div class="blk-codewrap blk-dgwrap is-editing">' +
			'<button class="blk-codelang" data-bcodelang="' + b.id + '">' + esc(b.language) + "</button>" +
			'<pre class="blk-code"><code class="blk-text" data-bcode="' + b.id +
			'" contenteditable="true" spellcheck="false">' + codeHtml(b.text, b.language === "svg" ? "xml" : "") + "</code></pre>" +
			view + "</div>";
	}

	function blockHtml(b, ctx) {
		const nested = ctx && ctx.nested;
		const ind = b.indent ? ' style="margin-left:' + (b.indent * 26) + 'px"' : "";
		let inner = "";

		switch (b.type) {
			case "h1": case "h2": case "h3":
				inner = editable(b, { cls: "blk-" + b.type, ph: "Überschrift " + b.type[1], style: colorStyle(b) });
				break;
			case "bullet":
				inner = '<div class="blk-li"' + ind + '><span class="blk-marker">•</span>' +
					editable(b, { ph: "Liste", style: colorStyle(b) }) + "</div>";
				break;
			case "number": {
				inner = '<div class="blk-li"' + ind + '><span class="blk-marker blk-num">' + (listNums.get(b.id) || 1) + '.</span>' +
					editable(b, { ph: "Liste", style: colorStyle(b) }) + "</div>";
				break;
			}
			case "todo":
				inner = '<div class="blk-li"' + ind + '><span class="blk-marker"><input type="checkbox" data-btodo="' +
					b.id + '"' + (b.checked ? " checked" : "") + "></span>" +
					editable(b, { cls: b.checked ? "blk-done" : "", ph: "To-do", style: colorStyle(b) }) + "</div>";
				break;
			case "quote":
				inner = '<blockquote class="blk-quote"' + colorStyle(b) + ">" + editable(b, { ph: "Zitat" }) + "</blockquote>";
				break;
			case "divider":
				inner = '<hr class="blk-hr">';
				break;
			case "code":
				if (diagramLang(b.language)) { inner = diagramBlockHtml(b); break; }
				// Immer contenteditable-<pre> — nie eine Textarea (kein Designwechsel).
				// Syntax-Highlight passiert nur bei render(), nicht während des Tippens
				// (sonst springt der Caret); beim Verlassen wird neu gerendert.
				inner = '<div class="blk-codewrap">' +
					'<button class="blk-codelang" data-bcodelang="' + b.id + '">' + esc(b.language || "text") + "</button>" +
					'<pre class="blk-code"><code class="blk-text" data-bcode="' + b.id +
					'" contenteditable="' + !readOnly + '" spellcheck="false">' + codeHtml(b.text, b.language) +
					"</code></pre></div>";
				break;
			case "math":
				// Gleichung wie in Notion: gerendert anzeigen, Klick öffnet Popover.
				inner = '<div class="blk-math" data-bmath="' + b.id + '" tabindex="0">' +
					(String(b.text || "").trim()
						? '<span class="blk-mathview" data-key="mv:' + esc(b.text) + '" data-mathsrc="' + esc(b.text) + '">' + esc(b.text) + "</span>"
						: '<span class="blk-mathempty">Neue Gleichung — klicken zum Bearbeiten</span>') +
					"</div>";
				break;
			case "image":
				// data-key = Quelle: gleiche Quelle → U.morph behält das bereits geladene <img>
				// samt Blob-URL; andere Quelle → frisches Element, das neu hydriert wird.
				inner = '<figure class="blk-img"><img data-key="img:' + esc(b.src || "") + '" data-imgsrc="' + esc(b.src || "") + '" alt="' + esc(b.alt || "") +
					'" draggable="false">' + (b.alt ? "<figcaption>" + esc(b.alt) + "</figcaption>" : "") + "</figure>";
				break;
			case "file":
				// contenteditable="false": Player-Bedienelemente (Video/Audio/PDF) müssen
				// klickbar sein und dürfen nie Teil des editierbaren Textflusses werden.
				inner = '<figure class="blk-file" data-key="file:' + esc(b.src || "") + '" data-filesrc="' + esc(b.src || "") + '" data-fileblk="' + b.id +
					'" contenteditable="false"><div class="blk-file-row"><span class="blk-file-ic">' + icon("paperclip") + '</span>' +
					'<span class="blk-file-name">' + esc(b.name || "Datei") + "</span></div></figure>";
				break;
			case "heft":
				// data-owned: den Inhalt füllt HEFT.hydrateEmbeds — U.morph fasst ihn nie an.
				inner = '<button type="button" class="blk-heft" data-key="heft:' + esc(b.heftId || "") + '" data-owned="1" data-heftembed="' + esc(b.heftId || "") + '" data-page="' + esc(b.heftId || "") + '" contenteditable="false" aria-label="Heft öffnen"></button>';
				break;
			case "table": {
				const rows = (b.rows || []).map((row, ri) =>
					"<tr>" + row.map((cell, ci) => {
						const t = ri === 0 ? "th" : "td";
						return "<" + t + ">" + editable(b, {
							attr: 'data-bcell="' + b.id + ":" + ri + ":" + ci + '"',
							raw: cell, cls: "blk-cell",
						}) + "</" + t + ">";
					}).join("") + "</tr>").join("");
				inner = '<div class="blk-tablewrap"><table class="blk-table">' + rows + "</table>" +
					'<button class="blk-tbtn blk-tbtn-col" data-btablecol="' + b.id + '" title="Spalte hinzufügen">+</button>' +
					'<button class="blk-tbtn blk-tbtn-row" data-btablerow="' + b.id + '" title="Zeile hinzufügen">+</button></div>';
				break;
			}
			case "callout":
				inner = '<div class="blk-callout blk-callout-' + (b.color || "blue") + '"' + colorStyle(b) + ">" +
					'<button class="blk-calloutdot" data-bcalloutcolor="' + b.id + '" title="Farbe"></button>' +
					'<div class="blk-children">' + (b.children || []).map((ch) => blockHtml(ch, { nested: true })).join("") + "</div></div>";
				break;
			case "toggle":
				inner = '<div class="blk-toggle' + (b.open ? " open" : "") + '">' +
					'<div class="blk-togglehead"><button class="blk-togglearrow" data-btogglearrow="' + b.id + '">' +
					(b.open ? "▾" : "▸") + "</button>" +
					editable(b, { attr: 'data-bsummary="' + b.id + '"', raw: b.summary || "", ph: "Toggle" }) + "</div>" +
					(b.open ? '<div class="blk-children blk-togglebody">' +
						(b.children || []).map((ch) => blockHtml(ch, { nested: true })).join("") + "</div>" : "") +
					"</div>";
				break;
			case "columns":
				inner = '<div class="blk-columns">' + (b.columns || []).map((col, ci) =>
					'<div class="blk-column" data-bcolumn="' + b.id + ":" + ci + '">' +
					col.map((ch) => blockHtml(ch, { nested: true })).join("") + "</div>").join("") + "</div>";
				break;
			default:
				inner = editable(b, { ph: "Schreib etwas, oder drücke „/“ für Befehle …", style: colorStyle(b) });
		}

		// Jeder Block bekommt Handle (⋮⋮) + Plus — wie in Notion links im Gutter.
		// data-key = Block-ID: U.morph erkennt denselben Block wieder, auch wenn er im
		// Dokument verrutscht. Nur wirklich geänderte Blöcke werden angefasst — daher
		// bleiben Cursor, Auswahl, Scroll und laufende Medien beim Rendern erhalten.
		return '<div class="blk" data-key="' + b.id + '" data-blk="' + b.id + '" data-btype="' + b.type + '">' +
			(nested ? "" : '<div class="blk-gutter" contenteditable="false">' +
				'<button class="blk-plus" data-bplus="' + b.id + '" title="Block darunter einfügen">+</button>' +
				'<button class="blk-handle" data-bhandle="' + b.id + '" draggable="true" title="Ziehen oder klicken">⋮⋮</button></div>') +
			'<div class="blk-body">' + inner + "</div></div>";
	}

	// render(): kompletter Neuaufbau des Editors aus `blocks`.
	// Wird NUR bei Strukturänderungen aufgerufen — reines Tippen verändert den
	// DOM direkt (contenteditable) und synchronisiert nur das Modell.
	// Unterseiten-Verweise wie in Notion am Ende des Inhalts — klickbare
	// Seitenzeilen (die Navigation übernimmt die data-page-Delegation in app.js).
	function childPagesHtml() {
		const pg = S.pages[pageId];
		// Datenbank-Seiten zeigen ihre Unterseiten schon als Karten (db-view.js).
		if (!pg || pg.db) return "";
		// Eingebettete Hefte sind bereits als große, klickbare Vorschau Teil der Seite.
		// Dieselbe Unterseite darunter ein zweites Mal als Textzeile zu zeigen, erzeugt
		// zwei konkurrierende Navigationselemente für dasselbe Dokument.
		const embedded = new Set();
		const collect = (list) => (list || []).forEach((block) => {
			if (block.type === "heft" && block.heftId) embedded.add(block.heftId);
			if (block.children) collect(block.children);
			if (block.columns) block.columns.forEach(collect);
		});
		collect(blocks);
		const kinder = STATE.childrenOf(pageId, pg.workspaceId).filter((child) => !embedded.has(child.id));
		if (!kinder.length) return "";
		return '<div class="child-pages" data-key="childpages" contenteditable="false">' + kinder.map((k) => {
			const icHtml = /^(https?:|data:)/.test(k.icon || "") ? '<img class="cp-img" src="' + esc(k.icon) + '" alt="">' : pageIcon(k);
			return '<button type="button" class="child-page-row" data-page="' + esc(k.id) + '">' +
				'<span class="cp-icon">' + icHtml + "</span>" +
				'<span class="cp-title">' + esc(k.title || "Ohne Titel") + "</span>" +
				"</button>";
		}).join("") + "</div>";
	}

	function isPdfDuplicateBlock(b, pg) {
		if (!pg || !pg.pdfId) return false;
		if (b.type === "file") {
			const s = String(b.src || "");
			if (s === pg.pdfId || s === "file:" + pg.pdfId || s.includes(pg.pdfId)) return true;
			if (b.name && pg.title && pg.title.toLowerCase().includes(b.name.replace(/\.pdf$/i, "").toLowerCase())) return true;
		}
		if (b.type === "quote") {
			const txt = String(b.text || "").trim();
			if (/^📄\s*(\*\*.*?\*\*|[^\n]+?\.pdf)\s*·/i.test(txt)) return true;
			if (txt.startsWith("📄") && txt.includes("·") && (/\.pdf\b/i.test(txt) || /Seiten\b/i.test(txt) || /\b(KB|MB)\b/i.test(txt))) return true;
		}
		return false;
	}

	function render(opts) {
		if (!host) return;
		const finish = PERF_PROFILER.start("editor.render", { blocks: blocks?.length }, 16);
		if (!blocks.length) { blocks.push(newBlock("p")); bustCtxIdx(); }
		const o = opts || {};
		readOnly = isReadOnly(pageId);
		host.classList.toggle("is-readonly", readOnly);
		// Fokussierte Felder überspringt der DOM-Abgleich — vorher loslassen, sonst bliebe
		// das Feld beim Wechsel in den Lesemodus editierbar (und die Tastatur offen).
		const active = document.activeElement;
		if (readOnly && active && host.contains(active) && typeof active.blur === "function") active.blur();
		renderBoundary = o.boundary || null;
		// v3 (25. Juli): DOM ANGLEICHEN statt wegwerfen. Vorher ersetzte jedes render()
		// den kompletten Editor-Inhalt per innerHTML — bei jedem Enter, jeder Listen-
		// Umwandlung, jedem Undo. Folgen: alle Bilder, Formeln, Codeblocks und Medien
		// wurden neu aufgebaut (Tipp-Ruckeln auf langen Seiten), laufende Videos sprangen
		// zurück auf Anfang, und die Scrollposition musste hinterher mühsam nachgerechnet
		// werden. U.morph fasst jetzt nur die Blöcke an, die sich wirklich geändert haben
		// (data-key = Block-ID) — alles andere bleibt physisch dasselbe DOM-Element.
		const pg = S.pages[pageId];
		const displayBlocks = blocks.filter((b) => !isPdfDuplicateBlock(b, pg));
		listNums = numberBlocks();
		const parts = displayBlocks.map((b) => [b.id, blockHtml(b)]);
		const kids = childPagesHtml();
		if (kids) parts.push(["childpages", kids]);
		parts.push(["tail", '<div class="blk-tail" data-key="tail" data-btail="1"></div>']);
		patchBlocks(parts);
		renderBoundary = null;
		hydrate();
		applySelectionClasses();
		finish();
	}

	// PERF: Blockweise angleichen. Vorher wurde bei jedem Render (Enter, Sync, Chat-Stream …)
	// die ganze Seite als ein HTML-String geparst und verglichen — bei 400 Blöcken ~8 ms
	// für einen einzigen neuen Block. Jetzt merkt sich jeder Blockknoten das Markup, auf
	// das er zuletzt vollständig angeglichen wurde (_edHtml); nur geänderte Blöcke werden
	// geparst und per U.morph-Regeln angeglichen. _edHtml = null heißt „DOM weicht evtl.
	// ab“: nach Tippen (input-Handler), wenn morph das fokussierte Feld auslassen musste,
	// und bei der Caret-Marke, die placeCaret gleich wieder entfernt.
	function patchBlocks(parts) {
		const wanted = new Set(parts.map((p) => p[0]));
		const old = new Map();
		// Weggefallene und fremde Knoten zuerst entfernen — sonst müssten die übrigen
		// verschoben werden (ein verschobenes Feld verliert den Fokus).
		for (const n of [...host.childNodes]) {
			const k = n.nodeType === 1 ? n.getAttribute("data-key") : null;
			if (k != null && wanted.has(k) && !old.has(k)) old.set(k, n);
			else n.remove();
		}
		let cursor = host.firstChild;
		for (const [key, html] of parts) {
			let node = old.get(key);
			if (!node || node._edHtml !== html) {
				const tpl = document.createElement("template");
				tpl.innerHTML = html;
				const fresh = tpl.content.firstElementChild;
				if (node && node.nodeName === fresh.nodeName) U._morphNode(node, fresh);
				else {
					if (node) { if (node === cursor) cursor = node.nextSibling; node.remove(); }
					node = fresh;
				}
			}
			if (node === cursor) cursor = node.nextSibling;
			else host.insertBefore(node, cursor);
			node._edHtml = node.contains(document.activeElement) || html.includes("data-caret-boundary") ? null : html;
		}
	}

	// Nummerierte Listen: fortlaufende Zähler je Ebene (wie Notion). PERF: Die Nummer
	// steht schon im erzeugten HTML. Vorher kam jeder Marker als „1.“ heraus, U.morph
	// setzte ihn bei jedem Render zurück und ein DOM-Durchlauf schrieb ihn danach neu —
	// zwei Textänderungen pro Listenpunkt und Tastendruck (Style + Layout jedes Mal).
	function numberBlocks() {
		const nums = new Map(), counters = {};
		let prevListy = false;
		const walk = (list) => {
			for (const b of list) {
				if (b.type === "number") {
					const depth = b.indent || 0;
					if (!prevListy) for (const k in counters) delete counters[k];
					counters[depth] = (counters[depth] || 0) + 1;
					for (const k in counters) if (+k > depth) delete counters[k];
					nums.set(b.id, counters[depth]);
					prevListy = true;
				} else if (LISTY[b.type]) {
					// Aufzählung/Todo auf derselben Ebene beendet die Nummerierung dort
					// (tiefer eingerückte unterbrechen sie nicht).
					const depth = b.indent || 0;
					for (const k in counters) if (+k >= depth) delete counters[k];
					prevListy = true;
				} else {
					prevListy = false;
					for (const k in counters) delete counters[k];
				}
				if (b.children || b.columns) {
					if (b.children) walk(b.children);
					if (b.columns) b.columns.forEach((col) => { prevListy = false; walk(col); });
					// Eine Liste im Callout/Toggle darf nicht hinter dem Container weiterzählen.
					prevListy = false;
					for (const k in counters) delete counters[k];
				}
			}
		};
		walk(blocks);
		return nums;
	}

	// Asynchrone Anreicherung nach dem HTML-Aufbau: Bilder, Hefte, Formeln, Code.
	function hydrate() {
		// Bild-Blobs aus IndexedDB laden. Die dataset.hydrated-Wache greift jetzt wirklich:
		// U.morph behält bereits geladene <img> als dasselbe Element, also läuft das hier
		// pro Bild genau EINMAL statt bei jedem Tastendruck.
		host.querySelectorAll("img[data-imgsrc]").forEach(async (img) => {
			if (img.dataset.hydrated) return;
			const src = img.dataset.imgsrc;
			if (!src) return;
			img.dataset.hydrated = "1";
			// Altformat „blob:<uuid>“: so legte das Android-Teilen Bilder ab (Blob unter der nackten UUID).
			const legacyId = /^blob:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(src)?.[1];
			if (src.startsWith("img:") || legacyId) {
				try {
					// DB.putBlob speichert { buf, meta } — blob.data bleibt als Fallback für
					// Alt-Datensätze aus der früheren "notion"-DB lesbar (siehe DB.blobUrl).
					const u = await DB.blobUrl(legacyId || src, "image/png");
					if (u) img.src = u; else img.alt = "Bild fehlt";
				} catch { img.alt = "Bild fehlt"; }
			} else {
				img.src = src;
			}
		});
		// Datei-/Medienblöcke: Blob (oder externe URL) laden und je nach MIME-Typ als
		// Video-, Audio-, PDF-, Bild- oder Download-Element anzeigen.
		host.querySelectorAll(".blk-file[data-filesrc]").forEach(hydrateFileBlock);
		// Heft-Einbettungen
		try { HEFT.hydrateEmbeds(host); } catch { /* Heft-Modul optional */ }
		// Diagramme (Mermaid/SVG): nur neue oder geänderte Quellen rendern
		host.querySelectorAll(".blk-diagram[data-dgsrc]:not([data-hydrated])").forEach((el) => {
			el.dataset.hydrated = "1";
			renderDiagram(el, el.dataset.dglang, el.dataset.dgsrc);
		});
		// Formel-Blöcke mit KaTeX rendern (Quelle bleibt in data-mathsrc)
		// data-key hängt an der Formel: unveränderte Formeln behalten ihr KaTeX-DOM,
		// geänderte bekommen ein frisches Element und werden hier neu gerendert.
		host.querySelectorAll(".blk-mathview").forEach((el) => {
			const f = String(el.dataset.mathsrc || el.textContent || "");
			hydrateKatex(el, f, true);
		});
		hydrateInlineMath(host);
	}

	// Medien-Ansicht eines Dateiblocks: der MIME-Typ entscheidet, nicht der Blocktyp.
	function fileViewHtml(url, mime, name, bid, src) {
		const cap = name ? "<figcaption>" + esc(name) + "</figcaption>" : "";
		if (mime.startsWith("video/")) return '<video class="blk-media" src="' + esc(url) + '" controls preload="metadata" playsinline></video>' + cap;
		if (mime.startsWith("audio/")) return '<div class="blk-file-row"><span class="blk-file-ic">' + icon("headphones") + '</span><span class="blk-file-name">' + esc(name || "Audio") + '</span></div><audio class="blk-media" src="' + esc(url) + '" controls preload="metadata"></audio>';
		if (mime.startsWith("image/")) return '<img class="blk-media" src="' + esc(url) + '" alt="' + esc(name) + '" draggable="false">' + cap;
		if (mime === "application/pdf") return '<div class="pdf-viewer embedded" data-key="pdf:' + esc(src || bid) + '" data-owned="1"></div>';
		// Unbekanntes Format: Zeile mit Download-Knopf (Delegation über data-fdl in wire()).
		return '<div class="blk-file-row"><span class="blk-file-ic">' + icon("paperclip") + '</span><span class="blk-file-name">' + esc(name || "Datei") + '</span><button type="button" class="blk-file-dl" data-fdl="' + bid + '">' + lead("download") + 'Herunterladen</button></div>';
	}

	async function hydrateFileBlock(fig) {
		if (fig.dataset.hydrated) return;
		fig.dataset.hydrated = "1";
		// data-owned: ab jetzt gehört dieser Teilbaum dem Medien-Player. U.morph fasst ihn
		// nie wieder an — ein laufendes Video läuft während Hintergrund-Renders weiter.
		fig.dataset.owned = "1";
		const src = fig.dataset.filesrc || "";
		const bid = fig.dataset.fileblk || "";
		const b = findBlock(bid) || {};
		const name = b.name || "";
		let url = src, mime = mimeFromName(name) || mimeFromName(src);
		let isPdf = mime === "application/pdf" || (name && /\.pdf$/i.test(name)) || (src && /\.pdf$/i.test(src));
		if (src.startsWith("file:") || (!src.includes("/") && !src.startsWith("http"))) {
			try {
				const rec = await DB.getBlob(src);
				if (!rec) { fig.innerHTML = '<div class="blk-file-row"><span class="blk-file-ic">' + icon("alert") + '</span><span class="blk-file-name">Datei fehlt: ' + esc(name || src) + "</span></div>"; return; }
				mime = (rec.meta && rec.meta.type) || mime;
				if (mime === "application/pdf" || (rec.meta && /\.pdf$/i.test(rec.meta.name))) isPdf = true;
				// Bei PDF lädt PDFS.mountViewer die Daten direkt per DB.getBlob — keine Blob-URL nötig
				if (!isPdf) {
					const u = await DB.blobUrl(src, mime);
					if (!u) { fig.innerHTML = '<div class="blk-file-row"><span class="blk-file-ic">' + icon("alert") + '</span><span class="blk-file-name">Datei fehlt: ' + esc(name || src) + "</span></div>"; return; }
					url = u;
				}
			} catch { fig.innerHTML = '<div class="blk-file-row"><span class="blk-file-ic">' + icon("alert") + '</span><span class="blk-file-name">Datei konnte nicht geladen werden</span></div>'; return; }
		}
		if (isPdf) mime = "application/pdf";
		fig.innerHTML = fileViewHtml(url, mime || "", name, bid, src);
		if (mime === "application/pdf") {
			const viewer = fig.querySelector(".pdf-viewer");
			if (viewer) {
				PDFS.mountViewer(viewer, src, { title: name });
			}
		}
	}

	// Diagramm in den Bearbeiten-Modus schalten (Code + Vorschau) und Caret ans Ende.
	function editDiagram(bid) {
		const b = findBlock(bid);
		if (!b) return;
		diagramEdit.add(bid);
		render();
		focusBlock(bid, String(b.text || "").length, "code");
	}

	// Live-Vorschau beim Tippen (entprellt): rendert direkt in die Vorschau, ohne render().
	let previewTimer = 0;
	function previewDiagram(bid) {
		const b = findBlock(bid);
		if (!b || !diagramLang(b.language)) return;
		clearTimeout(previewTimer);
		previewTimer = setTimeout(() => {
			const view = host && host.querySelector('[data-bdiagram="' + bid + '"]');
			if (view) renderDiagram(view, b.language, b.text);
		}, 350);
	}

	// Highlight eines Codeblocks neu aufbauen (nur bei Fokusverlust — nie beim
	// Tippen, sonst springt der Caret).
	function rehighlight(bid) {
		const b = findBlock(bid);
		const el = fieldOf(bid, "code");
		if (b && el && document.activeElement !== el) {
			el.innerHTML = codeHtml(b.text, b.language);
		}
	}

	// ---------- Blockauswahl (Esc / Handle-Klick / Gutter-Drag / Strg+A Stufe 2) ----------
	function applySelectionClasses() {
		host.querySelectorAll(".blk.selected").forEach((el) => el.classList.remove("selected"));
		if (!selRange) return;
		for (let k = selRange.from; k <= selRange.to; k++) {
			const b = blocks[k];
			const el = b && host.querySelector('[data-blk="' + b.id + '"]');
			if (el) el.classList.add("selected");
		}
	}
	function selectBlocks(from, to) {
		if (from < 0 || to < 0 || !blocks.length) { clearSelection(); return; }
		selRange = { from: Math.min(from, to), to: Math.max(from, to) };
		if (selAnchor == null) selAnchor = from;
		const sel = window.getSelection();
		if (sel) sel.removeAllRanges(); // Text-Caret raus — jetzt gilt Blockauswahl
		applySelectionClasses();
		// Auswahl sichtbar halten OHNE scrollIntoView — das wirft den Viewport
		// in Chromium oft an den Seitenanfang, sobald KaTeX/Bilder die Höhe ändern.
		const erster = blocks[selRange.from];
		const el = erster && host ? host.querySelector('.blk[data-blk="' + erster.id + '"]') : null;
		if (el) {
			const root = scrollRoot();
			if (root) {
				const er = el.getBoundingClientRect();
				const rr = root.getBoundingClientRect();
				if (er.top < rr.top + 8) root.scrollTop -= (rr.top + 8 - er.top);
				else if (er.bottom > rr.bottom - 8) root.scrollTop += (er.bottom - (rr.bottom - 8));
			}
		}
	}
	function clearSelection() {
		selRange = null; selAnchor = null; selAll = false; ctrlAArmed = false;
		if (host) applySelectionClasses();
	}
	function deleteSelectedBlocks(directionKey) {
		if (!selRange) return;
		const { from, to } = selRange;
		const prevBlock = from > 0 ? blocks[from - 1] : null;
		const nextBlock = to + 1 < blocks.length ? blocks[to + 1] : null;
		mutate(() => { blocks.splice(from, to - from + 1); });
		clearSelection();
		// Backspace: ans ENDE des vorherigen Blocks (wie Notion).
		// Delete/Entf: an den ANFANG des folgenden Blocks.
		if (directionKey === "Backspace" && prevBlock && findBlock(prevBlock.id)) {
			focusNeighbor(prevBlock, -1);
		} else if (nextBlock && findBlock(nextBlock.id)) {
			focusNeighbor(nextBlock, 1);
		} else if (prevBlock && findBlock(prevBlock.id)) {
			focusNeighbor(prevBlock, -1);
		} else if (blocks[0]) {
			focusNeighbor(blocks[0], 1);
		}
	}

	// ---------- Popover- & Menü-Verbindung (editor-menus.js) ----------
	initEditorMenus({
		getHost: () => host,
		getPageId: () => pageId,
		fieldOf,
		findBlock,
		findContext,
		mutate,
		paintTextField,
		pickFile,
		newBlock,
		focusBlock,
		turnInto,
		syncFieldToModel,
	});


	// ---------- Datei/Bild auswählen & hochladen (EIN Pfad für alle Formate) ----------
	// accept="image/*" nur für den Bild-Befehl; der Datei-Befehl nimmt alles.
	function pickFile(bid, accept) {
		const input = document.createElement("input");
		input.type = "file";
		if (accept) input.accept = accept;
		input.multiple = true;
		input.onchange = async () => {
			let after = bid;
			for (const file of input.files || []) after = await insertFileBlock(file, after);
		};
		input.click();
	}
	// EINE Funktion für ALLE Uploads (DRY — ersetzt insertImageFile): Bilder werden
	// Bildblöcke, alles andere (Video, Audio, PDF, beliebige Dateien) ein Dateiblock.
	// Liefert die ID des neuen Blocks: Mehrere Dateien hängen sich so der Reihe nach
	// an (vorher: umgekehrte Reihenfolge bzw. ab der zweiten ans Seitenende).
	async function insertFileBlock(file, afterBid) {
		const isImg = (file.type || mimeFromName(file.name)).startsWith("image/");
		const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
		const mime = file.type || (isPdf ? "application/pdf" : mimeFromName(file.name));
		const buf = await U.readAsBuffer(file);
		const blobId = (isImg ? "img:" : "file:") + uid();
		await DB.putBlob(blobId, buf, { type: mime, name: file.name });
		if (isPdf) {
			try {
				const { text } = await PDFS.extractText(buf.slice(0));
				if (text) await DB.putBlob("pdftext:" + blobId, new TextEncoder().encode(text).buffer, { name: file.name + ".txt", type: "text/plain" });
			} catch (e) {
				console.warn("PDF-Textextraktion fehlgeschlagen:", e);
			}
		}
		const nb = isImg
			? { id: uid(), type: "image", src: blobId, alt: file.name.replace(/\.[a-z0-9]+$/i, "") }
			: { id: uid(), type: "file", src: blobId, name: file.name };
		mutate(() => {
			const c = afterBid && findContext(afterBid);
			if (c) {
				if (TEXTY[c.block.type] && !String(c.block.text || "").trim()) c.list.splice(c.index, 1, nb);
				else c.list.splice(c.index + 1, 0, nb);
			} else {
				blocks.push(nb);
			}
		});
		return nb.id;
	}

	// ---------- Umwandeln ("Turn into") ----------
	function turnInto(b, kind) {
		if (b.type === kind) return;
		const keepText = plainTextOf(b);
		if (kind === "callout") {
			const child = { id: uid(), type: "p", text: TEXTY[b.type] ? String(b.text || "") : keepText };
			delete b.text; delete b.indent; delete b.checked; delete b.summary; delete b.open; delete b.rows; delete b.columns;
			b.type = "callout"; b.color = b.color || "blue"; b.children = [child];
			return;
		}
		if (kind === "toggle") {
			b.summary = TEXTY[b.type] ? String(b.text || "") : "";
			delete b.text; delete b.indent; delete b.checked; delete b.color; delete b.rows; delete b.columns;
			b.type = "toggle"; b.open = true; b.children = b.children || [newBlock("p")];
			return;
		}
		if (kind === "code") {
			b.text = keepText; b.language = b.language || "javascript";
			delete b.children; delete b.indent; delete b.checked; delete b.summary; delete b.open; delete b.color; delete b.rows; delete b.columns;
			b.type = "code";
			return;
		}
		// Zieltyp ist ein Textblock
		b.text = TEXTY[b.type] || b.type === "code" ? String(b.text || "") : keepText;
		delete b.children; delete b.columns; delete b.rows; delete b.summary; delete b.open; delete b.language; delete b.color;
		if (kind === "todo") b.checked = !!b.checked; else delete b.checked;
		if (!LISTY[kind]) delete b.indent;
		b.type = kind;
	}

	// ---------- Modell-Sync beim Tippen ----------
	// Der DOM ist während des Tippens führend; nach jedem input-Event wird der
	// betroffene Feldinhalt zurück ins Modell geschrieben (kein Re-Render!).
	function syncFieldToModel(field) {
		const md = mdFromEditable(field);
		if (field.dataset.bcell) {
			const [bid, ri, ci] = field.dataset.bcell.split(":");
			const b = findBlock(bid);
			if (b && b.rows && b.rows[+ri]) b.rows[+ri][+ci] = md;
			return bid;
		}
		if (field.dataset.bsummary) {
			const b = findBlock(field.dataset.bsummary);
			if (b) b.summary = md;
			return field.dataset.bsummary;
		}
		if (field.dataset.bcode) {
			const b = findBlock(field.dataset.bcode);
			if (b) b.text = field.textContent || ""; // Code: reiner Text, kein Inline-MD
			return field.dataset.bcode;
		}
		const b = findBlock(field.dataset.btext);
		if (b) b.text = md;
		return field.dataset.btext;
	}

	// ---------- Live-Transformationen (Markdown-Auslöser wie in Notion) ----------
	// Greifen nur am Zeilen-/Blockanfang direkt nach einem Leerzeichen-Tastendruck.
	const TRANSFORMS = [
		[/^#\s$/, "h1"], [/^##\s$/, "h2"], [/^###\s$/, "h3"],
		[/^[-*+]\s$/, "bullet"], [/^1[.)]\s$/, "number"],
		[/^\[\]\s$/, "todo"], [/^\[ \]\s$/, "todo"],
		[/^>\s$/, "quote"],
	];

	// Nach input prüfen: "/befehl", "[[", Markdown-Trigger, "---", FENCE, "$$".
	function handleLiveTriggers(field, e) {
		if (composing || !field.dataset.btext) return false;
		const bid = field.dataset.btext;
		const c = findContext(bid);
		if (!c || !TEXTY[c.block.type]) return false;
		const text = String(c.block.text || "");
		const split = splitFieldAtCaret(field, text);
		const upto = split.vor;

		// Slash-Menü öffnen/aktualisieren
		const sm = upto.match(/\/([a-zäöüß0-9]*)$/i);
		if (sm && (upto.length === sm[0].length || /\s\/[a-zäöüß0-9]*$/i.test(upto))) {
			openSlash(bid, sm[1], upto.length);
			return false;
		} else if (slash) closeMenus();

		// [[ Link-Menü — PERF (18. Juli, Audit-Punkt): Folgezeichen debounced (80 ms).
		// Vorher lief STATE.activePages() + Titel-Filter bei JEDEM Tastendruck hinter
		// "[[". Das erste Öffnen bleibt sofort; nur die Suche beim Weitertippen wird
		// gebündelt. Der Guard im Timer verhindert ein Wiederöffnen nach closeMenus().
		const lm = upto.match(/\[\[([^\]]*)$/);
		if (lm) {
			clearTimeout(linkMenuTimer);
			if (!linkMenu) openLinkMenu(bid, lm[1], upto.length);
			else linkMenuTimer = setTimeout(() => { if (linkMenu) openLinkMenu(bid, lm[1], upto.length); }, 80);
			return false;
		}
		else if (linkMenu) { clearTimeout(linkMenuTimer); closeMenus(); }

		// Nur bei Leerzeichen als letztem Zeichen: Blocktyp-Trigger
		if (e && e.data === " " && c.block.type === "p") {
			for (const [re, kind] of TRANSFORMS) {
				if (re.test(upto)) {
					// `upto` ist hier exakt das Kürzel am Blockanfang. Den Rest aus dem
					// bereits synchronisierten Modell ableiten: Chromium kann die zweite
					// DOM-Range am contenteditable-Rand noch vor dem Kürzel verankern und
					// würde es über `split.nach` sonst ein zweites Mal übernehmen.
					const remaining = text.slice(upto.length);
					mutate(() => {
						turnInto(c.block, kind);
						c.block.text = remaining;
					});
					// Der DOM-Abgleich schützt das fokussierte contenteditable absichtlich.
					// Nach der Kürzel-Umwandlung muss dessen alter Marker deshalb explizit
					// durch den bereinigten Modelltext ersetzt werden, bevor weitergetippt wird.
					paintTextField(bid, remaining, 0);
					return true;
				}
			}
		}
		// "---" → Trennlinie
		if (text === "---") {
			const nb = newBlock("p");
			mutate(() => { c.list.splice(c.index, 1, { id: c.block.id, type: "divider" }, nb); });
			focusBlock(nb.id, 0);
			return true;
		}
		// Code-Zaun → Codeblock
		if (text.startsWith(FENCE)) {
			const language = text.slice(3).trim() || "javascript";
			mutate(() => { c.list.splice(c.index, 1, { id: c.block.id, type: "code", language, text: "" }); });
			focusBlock(c.block.id, 0, "code");
			return true;
		}
		// "$$" → Gleichungsblock mit Popover
		if (text === "$$") {
			mutate(() => {
				c.list.splice(c.index, 1, { id: c.block.id, type: "math", text: "" });
				setTimeout(() => openMathPop(c.block.id), 0);
			});
			return true;
		}
		// Inline-Markdown sofort hübsch rendern, sobald ein Muster VOLLSTÄNDIG ist
		// (z.B. zweiter Stern von **fett** getippt) — Feld neu rendern + Caret halten.
		if (e && /[*\x60~=$)\/}>]/.test(e.data || "") &&
			/(\*\*[^*]+\*\*|(^|[^*])\*[^*\n]+\*|\x60[^\x60]+\x60|~~[^~]+~~|==[^=\n]+==|<u>[\s\S]*?<\/u>|\$[^$\n]+\$|\\\(.+?\\\)|\[[^\]]+\]\([^)\s]+\)|\{(bg-)?[a-z]+\}[\s\S]*?\{\/\})/.test(upto)) {
			// Der Caret muss in SICHTBAREN Zeichen gesetzt werden: nach dem Rendern sind die
			// Markdown-Zeichen (** **, == ==, $…$) verschwunden. Mit dem rohen Markdown-Offset
			// sprang der Caret um genau diese Zeichen zu weit nach rechts, sobald hinter der
			// Fundstelle noch Text stand. splitFieldAtCaret liefert das Markdown VOR dem Caret
			// exakt über DOM-Ranges — dessen Sichtlänge ist die gesuchte Position.
			// visibleLength wie setCaret: Formel-Chips zählen nicht (textContent zählte ihr
			// Innenleben mit – hinter einer Formel stand der Cursor um diese Länge zu weit rechts).
			const probe = document.createElement("div");
			probe.innerHTML = inlineHtml(split.vor);
			const off = visibleLength(probe);
			field.innerHTML = inlineHtml(text);
			hydrateInlineMath(field);
			setCaret(field, off);
			return false;
		}
		return false;
	}

	// ---------- Inline-Formatierung (Auswahl → Strg+B/I/E/K, Farben) ----------
	function wrapSelection(before, after) {
		const sel = window.getSelection();
		if (!sel || sel.isCollapsed || !sel.rangeCount) return;
		const caret = caretInfo();
		if (!caret) return;
		const field = fieldOf(caret.bid, caret.kind, caret.cell);
		if (!field) return;
		const r = sel.getRangeAt(0);
		const vorR = document.createRange(); vorR.selectNodeContents(field); vorR.setEnd(r.startContainer, r.startOffset);
		const midR = r.cloneRange();
		const nachR = document.createRange(); nachR.selectNodeContents(field); nachR.setStart(r.endContainer, r.endOffset);
		const zuMd = (frag) => { const t = document.createElement("div"); t.appendChild(frag); return mdFromEditable(t); };
		const pre = zuMd(vorR.cloneContents()), mid = zuMd(midR.cloneContents()), post = zuMd(nachR.cloneContents());
		// Sichtbare Zeichen wie setCaret (Range.toString zählte KaTeX-Innenleben mit).
		const domStartOff = visibleLength(vorR.cloneContents());
		const domMidLen = visibleLength(midR.cloneContents());
		let next;
		// Bei einer Auswahl des ganzen gerenderten Elements liegen die Markdown-
		// Marker in `mid` statt außerhalb in `pre`/`post`. Kursiv braucht eine
		// Sonderregel, damit **Fett** durch Strg+I nicht versehentlich entfettet wird.
		const midIsWrapped = mid.startsWith(before) && mid.endsWith(after) &&
			mid.length >= before.length + after.length &&
			(before !== "*" || (mid.startsWith("***") && mid.endsWith("***")) ||
				(!mid.startsWith("**") && !mid.endsWith("**")));
		if (midIsWrapped) {
			next = pre + mid.slice(before.length, mid.length - after.length) + post;
		} else if (pre.endsWith(before) && post.startsWith(after)) {
			next = pre.slice(0, -before.length) + mid + post.slice(after.length);
		} else {
			next = pre + before + mid + after + post;
		}
		checkpoint(true);
		if (caret.kind === "cell") {
			const [bid, ri, ci] = caret.cell.split(":");
			const b = findBlock(bid);
			if (b && b.rows && b.rows[+ri]) b.rows[+ri][+ci] = next;
		} else if (caret.kind === "summary") {
			const b = findBlock(caret.bid); if (b) b.summary = next;
		} else {
			const b = findBlock(caret.bid); if (b) b.text = next;
		}
		field.innerHTML = inlineHtml(next);
		hydrateInlineMath(field);
		setCaret(field, domStartOff + domMidLen);
		save();
	}
	const colorWrap = (spec) => {
		lastColor = spec;
		const [kind2, cname] = spec.split(":");
		wrapSelection("{" + (kind2 === "bg" ? "bg-" : "") + cname + "}", "{/}");
	};

	// ---------- Tastatur (das Herzstück der Notion-Kopie) ----------
	function onKeydown(e) {
		const field = e.target.closest && e.target.closest("[data-btext],[data-bcell],[data-bsummary],[data-bcode]");
		const mod = e.ctrlKey || e.metaKey;

		// --- Menü-Navigation hat Vorrang ---
		const menu = slash || linkMenu;
		if (menu && (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === "Tab" || e.key === "Escape")) {
			e.preventDefault();
			if (e.key === "Escape") { closeMenus(); return; }
			if (e.key === "ArrowDown" || e.key === "ArrowUp") {
				const d = e.key === "ArrowDown" ? 1 : -1;
				menu.index = (menu.index + d + menu.items.length) % Math.max(1, menu.items.length);
				document.querySelectorAll(".blk-menu .blk-mi").forEach((el, k) => el.classList.toggle("active", k === menu.index));
				return;
			}
			if (slash && slash.items[slash.index]) void applySlash(slash.items[slash.index].k).catch((error) => {
				console.warn("Slash-Befehl fehlgeschlagen", error);
				U.toast("Befehl konnte nicht ausgeführt werden", "error");
			});
			else if (linkMenu && linkMenu.items[linkMenu.index]) applyLink(linkMenu.items[linkMenu.index].id);
			return;
		}
		if (mathEdit && e.key === "Escape") { e.preventDefault(); closeMenus(); return; }

		// --- Undo/Redo IMMER app-eigen (nie Browser) ---
		if (mod && !e.shiftKey && e.key.toLowerCase() === "z") { e.preventDefault(); undoRedo(false); return; }
		if (mod && (e.key.toLowerCase() === "y" || (e.shiftKey && e.key.toLowerCase() === "z"))) { e.preventDefault(); undoRedo(true); return; }

		// --- Blockauswahl-Modus ---
		// Wichtig: Nach Maus-Markierung über mehrere Blöcke bleibt oft noch ein
		// contenteditable fokussiert. selectBlocks() hat die DOM-Textselektion
		// bereits geleert — der Browser hätte bei Strg+C also nichts zu kopieren.
		// Deshalb dieselben Blockauswahl-Tasten (Copy, Entf, Pfeile …) IMMER
		// bevorzugen, sobald selRange gesetzt ist — nicht nur ohne Textfokus.
		if (selRange && handleSelectionKeys(e)) return;

		if (!field) return;
		const caret = caretInfo();

		// --- Esc: Textfokus → Blockauswahl (wie Notion) ---
		if (e.key === "Escape") {
			const c0 = caret && findContext(caret.bid);
			if (c0 && selectTopOf(c0.block)) {
				e.preventDefault();
				e.target.blur();
			}
			return;
		}

		// --- Zweistufiges Strg+A ---
		if (mod && e.key.toLowerCase() === "a") {
			const fieldText = field.textContent || "";
			const selText = String(window.getSelection());
			if (ctrlAArmed || (fieldText && selText === fieldText)) {
				e.preventDefault();
				selAll = true; selAnchor = 0;
				selectBlocks(0, blocks.length - 1);
				e.target.blur();
				return;
			}
			ctrlAArmed = true; // Browser macht Stufe 1 (Feld auswählen)
			return;
		}
		ctrlAArmed = false;

		// --- Inline-Format-Shortcuts ---
		if (mod && !e.shiftKey && e.key.toLowerCase() === "b") { e.preventDefault(); wrapSelection("**", "**"); return; }
		if (mod && !e.shiftKey && e.key.toLowerCase() === "i") { e.preventDefault(); wrapSelection("*", "*"); return; }
		if (mod && !e.shiftKey && e.key.toLowerCase() === "u") { e.preventDefault(); wrapSelection("<u>", "</u>"); return; }
		if (mod && !e.shiftKey && e.key.toLowerCase() === "e") { e.preventDefault(); wrapSelection("\x60", "\x60"); return; }
		if (mod && e.shiftKey && e.key.toLowerCase() === "s") { e.preventDefault(); wrapSelection("~~", "~~"); return; }
		if (mod && e.shiftKey && e.key.toLowerCase() === "h") { e.preventDefault(); colorWrap(lastColor); return; }
		if (mod && !e.shiftKey && e.key.toLowerCase() === "k") {
			e.preventDefault();
			const url = prompt("Link-Adresse:");
			if (url) wrapSelection("[", "](" + url + ")");
			return;
		}

		const bid = caret && caret.bid;
		const c = bid && findContext(bid);

		// --- Strg+D: Block duplizieren ---
		if (mod && !e.shiftKey && e.key.toLowerCase() === "d" && c) {
			e.preventDefault();
			mutate(() => { c.list.splice(c.index + 1, 0, cloneBlock(c.block)); });
			return;
		}

		// --- Strg+Shift+0-8: Blocktyp wechseln (wie Notion: 0=Text, 1-3=H, 4=Todo, 5=Bullet, 6=Nummer, 7=Toggle, 8=Code) ---
		// Mit Shift ist e.key auf Standardlayouts ein Satzzeichen (!, ", §, …).
		// e.code bezeichnet dagegen stabil die tatsächlich gedrückte Zifferntaste.
		const digitMatch = String(e.code || "").match(/^(?:Digit|Numpad)([0-8])$/);
		const blockShortcut = digitMatch ? digitMatch[1] : (/^[0-8]$/.test(e.key) ? e.key : null);
		if (mod && e.shiftKey && blockShortcut != null && c) {
			e.preventDefault();
			const map = { 0: "p", 1: "h1", 2: "h2", 3: "h3", 4: "todo", 5: "bullet", 6: "number", 7: "toggle", 8: "code" };
			const off = caret.offset;
			mutate(() => { turnInto(c.block, map[blockShortcut]); });
			focusBlock(bid, off, map[blockShortcut] === "toggle" ? "summary" : map[blockShortcut] === "code" ? "code" : "text");
			return;
		}

		// --- Strg+Shift+↑/↓: Block verschieben ---
		if (mod && e.shiftKey && (e.key === "ArrowUp" || e.key === "ArrowDown") && c) {
			e.preventDefault();
			const d = e.key === "ArrowUp" ? -1 : 1;
			const ni = c.index + d;
			if (ni < 0 || ni >= c.list.length) return;
			const off = caret.offset;
			mutate(() => { c.list.splice(ni, 0, c.list.splice(c.index, 1)[0]); });
			focusBlock(bid, off, caret.kind, caret.cell);
			return;
		}

		// --- Tabellen-Navigation: Tab/Shift+Tab/Enter, letzte Zelle+Tab = neue Zeile ---
		if (field.dataset.bcell) { if (handleTableKeys(e, field)) return; }

		// --- Codeblock: Tab = 2 Spaces, Enter = Zeilenumbruch, Escape via Pfeil unten am Ende ---
		if (field.dataset.bcode) { if (handleCodeKeys(e, field)) return; }

		// --- Toggle-Summary: Enter / Backspace / Navigation ---
		if (field.dataset.bsummary) {
			if (e.key === "Enter" && !e.shiftKey) {
				e.preventDefault();
				const b = findBlock(field.dataset.bsummary);
				if (!b) return;
				mutate(() => {
					b.open = true;
					if (!b.children || !b.children.length) b.children = [newBlock("p")];
				});
				focusBlock(b.children[0].id, 0);
				return;
			}
			if (e.key === "Backspace") {
				const b = findBlock(field.dataset.bsummary);
				const caret = caretInfo();
				if (b && caret && caret.offset === 0 && !String(b.summary || "").length) {
					e.preventDefault();
					const c = findContext(b.id);
					if (c) {
						// Nur leere TEXT-Kinder dürfen mit dem Toggle verschwinden — ein einzelnes
						// Bild oder eine Tabelle ohne .text wäre sonst kommentarlos gelöscht worden.
						const kids = b.children || [];
						const leer = !kids.length || (kids.length === 1 && TEXTY[kids[0].type] && !String(kids[0].text || "").trim());
						mutate(() => {
							if (leer) turnInto(b, "p");
							else c.list.splice(c.index, 1, ...kids);
						});
						// Beim Auspacken existiert der Toggle nicht mehr: Fokus ins erste Kind.
						if (leer) focusBlock(b.id, 0);
						else focusNeighbor(kids[0], 1);
						return;
					}
				}
			}
			if (e.key === "ArrowUp" || e.key === "ArrowDown") {
				const b = findBlock(field.dataset.bsummary);
				const caret = caretInfo();
				const d = e.key === "ArrowUp" ? -1 : 1;
				// Sichtlänge statt Markdown-Länge: bei **fett** im Titel kam ↓ sonst nie raus
				const edge = d < 0 ? caret && caret.offset === 0 : caret && caret.offset >= visibleLength(field);
				if (edge) {
					const c = findContext(field.dataset.bsummary);
					if (d > 0 && b && b.open && b.children && b.children.length) {
						e.preventDefault();
						focusNeighbor(b.children[0], 1);
						return;
					}
					const neighbor = c && c.list[c.index + d];
					if (neighbor) {
						e.preventDefault();
						focusNeighbor(neighbor, d);
						return;
					}
				}
			}
		}

		if (!c || !field.dataset.btext) return;
		handleTextBlockKeys(e, field, c, caret);
	}

	// Tasten in Text-, Tabellen- und Codeblöcken (editor-keys.js)
	const { handleTextBlockKeys, focusNeighbor, handleTableKeys, handleCodeKeys } = createBlockKeys({
		getHost: () => host,
		getBlocks: () => blocks,
		mutate, focusBlock, findBlock, findContext, turnInto, newBlock, focusBoundary, selectTopOf,
		selectBlockAt: (i) => { selAnchor = i; selectBlocks(i, i); },
	});

	// Markdown synchron in die Zwischenablage. In einigen WebView-Umgebungen ist
	// navigator.clipboard zwar vorhanden, writeText() wird aber teilweise trotzdem mit
	// NotAllowedError abgelehnt. execCommand muss deshalb zuerst und synchron im
	// Tastatur-Event laufen; nur falls das nicht geht, kommt die Clipboard-API dran.
	// Liefert true (kopiert), ein Promise (asynchroner Versuch) oder false (geht nicht).
	function copyMarkdown(md) {
		const ta = document.createElement("textarea");
		ta.value = md;
		ta.setAttribute("readonly", "");
		ta.style.position = "fixed";
		ta.style.left = "-9999px";
		ta.style.top = "0";
		document.body.appendChild(ta);
		ta.select();
		let copied = false;
		try { copied = document.execCommand("copy"); } catch { /* unten Clipboard-API */ }
		ta.remove();
		if (copied) return true;
		if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(md);
		return false;
	}

	// Tasten im Blockauswahl-Modus (kein Textfokus): Pfeile, Shift+Pfeile,
	// Enter = Bearbeiten, Backspace/Entf = löschen, Strg+D = duplizieren, Esc = aufheben.
	function handleSelectionKeys(e) {
		if (e.key === "Escape") { e.preventDefault(); clearSelection(); return true; }
		if (e.key === "Backspace" || e.key === "Delete") { e.preventDefault(); deleteSelectedBlocks(e.key); return true; }
		if (e.key === "Enter") {
			e.preventDefault();
			const b = blocks[selRange.from];
			clearSelection();
			if (b) {
				// focusNeighbor gibt true bei Blockauswahl zurück; sonst hat es
				// den Caret selbst gesetzt. Kein zweiter focusBlock-Fallback danach.
				if (!focusNeighbor(b, 1)) focusBlock(b.id, 0);
			}
			return true;
		}
		// FIX „Strg+A doppelt → Strg+C kopiert nichts“: Stufe 2 blurt das Textfeld
		// (Blockauswahl statt DOM-Textselektion) — der Browser hat dann NICHTS zu
		// kopieren. Deshalb die ausgewählten Blöcke selbst als Markdown serialisieren
		// und in die Zwischenablage schreiben.
		if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c") {
			e.preventDefault();
			const result = copyMarkdown(serializeList(blocks.slice(selRange.from, selRange.to + 1)));
			if (result === true) U.toast("Kopiert");
			else if (result) result.then(() => U.toast("Kopiert"), () => U.toast("Kopieren fehlgeschlagen", "error"));
			else U.toast("Kopieren fehlgeschlagen", "error");
			return true;
		}
		if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "x") {
			e.preventDefault();
			const result = copyMarkdown(serializeList(blocks.slice(selRange.from, selRange.to + 1)));
			// Ausschneiden löscht gleich danach: scheitert das Kopieren, muss der Nutzer es erfahren.
			// FIX: Ohne Clipboard-API wurde bisher kommentarlos gelöscht.
			const cutFailed = (err) => {
				if (err) PERF_PROFILER.error("clipboard-error", err, { source: "editor-cut" });
				U.toast("Ausschneiden: Zwischenablage nicht verfügbar — mit Strg+Z rückgängig machen.", "error");
			};
			if (result === false) cutFailed();
			else if (result !== true) result.catch(cutFailed);
			deleteSelectedBlocks("Delete");
			return true;
		}
		if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
			e.preventDefault();
			const { from, to } = selRange;
			mutate(() => {
				const copies = blocks.slice(from, to + 1).map(cloneBlock);
				blocks.splice(to + 1, 0, ...copies);
			});
			selectBlocks(to + 1, to + 1 + (to - from));
			return true;
		}
		if (e.key === "ArrowUp" || e.key === "ArrowDown") {
			e.preventDefault();
			const d = e.key === "ArrowUp" ? -1 : 1;
			if (e.shiftKey) {
				// Auswahl erweitern/verkleinern relativ zum Anker
				const edge = d < 0 ? (selRange.from < selAnchor ? selRange.from : selRange.to)
					: (selRange.to > selAnchor ? selRange.to : selRange.from);
				const ne = Math.max(0, Math.min(blocks.length - 1, edge + d));
				selectBlocks(Math.min(selAnchor, ne), Math.max(selAnchor, ne));
			} else {
				const k = Math.max(0, Math.min(blocks.length - 1, (d < 0 ? selRange.from : selRange.to) + d));
				selAnchor = k;
				selectBlocks(k, k);
			}
			return true;
		}
		return false;
	}

	// ---------- Verkabelung am Host (pro mount) ----------
	function wire() {
		if (!host || wiredHosts.has(host)) return;
		wiredHosts.add(host);
		host.addEventListener("compositionstart", () => { composing = true; });
		host.addEventListener("compositionend", (e) => {
			composing = false;
			const field = e.target.closest && e.target.closest("[data-btext],[data-bcell],[data-bsummary],[data-bcode]");
			if (field) { checkpoint(); syncFieldToModel(field); save(); }
		});

		// Tippen: Modell synchronisieren + Live-Trigger prüfen (kein Re-Render)
		host.addEventListener("input", (e) => {
			// Getippt: dieser Block weicht jetzt am gemerkten Markup vorbei ab (patchBlocks)
			let top = e.target;
			while (top && top.parentNode !== host) top = top.parentNode;
			if (top) top._edHtml = null;
			if (composing) return;
			const field = e.target.closest && e.target.closest("[data-btext],[data-bcell],[data-bsummary],[data-bcode]");
			if (!field) return;
			checkpoint();
			syncFieldToModel(field);
			// Nach dem letzten gelöschten Zeichen lässt der Browser ein <br> stehen:
			// :empty greift dann nicht und der Platzhalter („To-do“, „Liste“ …) fehlt.
			if (field.childNodes.length === 1 && field.firstChild.nodeName === "BR") {
				field.textContent = "";
				setCaret(field, 0);
			}
			handleLiveTriggers(field, e);
			if (field.dataset.bcode) previewDiagram(field.dataset.bcode);
			save();
		});

		host.addEventListener("keydown", onKeydown);

		// Fokusverlust: Codeblöcke neu highlighten, Tipp-History festschreiben
		host.addEventListener("focusout", (e) => {
			const code = e.target.closest && e.target.closest("[data-bcode]");
			if (code && diagramLang(findBlock(code.dataset.bcode)?.language)) {
				// Diagramm-Code verlassen → wieder als Grafik zeigen (außer der Fokus
				// bleibt im selben Block, z. B. beim Sprache-Knopf).
				const bid = code.dataset.bcode;
				setTimeout(() => {
					const wrap = code.closest(".blk-dgwrap");
					if (wrap && wrap.contains(document.activeElement)) return;
					diagramEdit.delete(bid);
					render();
				}, 0);
			} else if (code) setTimeout(() => rehighlight(code.dataset.bcode), 0);
			commitHistory();
		});

		// Klicks: Checkboxen, Handles, Plus, Toggles, Tabellen-Buttons, Formeln …
		host.addEventListener("click", (e) => {
			const t = e.target;

			const todo = t.closest && t.closest("[data-btodo]");
			if (todo) {
				const b = findBlock(todo.dataset.btodo);
				if (b) mutate(() => { b.checked = todo.checked; });
				return;
			}
			// Lesemodus: nur Lesehilfen (Haken, Aufklappen, Links, Downloads) — nichts, was
			// Blöcke anlegt oder umbaut.
			if (readOnly && t.closest && t.closest("[data-bplus],[data-bhandle],[data-btablerow],[data-btablecol],[data-bcalloutcolor],[data-bcodelang],[data-bdiagram],[data-bmath],.blk-imath,[data-btail]")) return;
			const plus = t.closest && t.closest("[data-bplus]");
			if (plus) {
				const c = findContext(plus.dataset.bplus);
				if (c) {
					const nb = newBlock("p");
					nb.text = "/";
					mutate(() => { c.list.splice(c.index + 1, 0, nb); });
					focusBlock(nb.id, 1);
					openSlash(nb.id, "", 1);
				}
				return;
			}
			const handle = t.closest && t.closest("[data-bhandle]");
			if (handle) { e.preventDefault(); openBlockMenu(handle.dataset.bhandle, handle); return; }

			const arrow = t.closest && t.closest("[data-btogglearrow]");
			if (arrow) {
				const b = findBlock(arrow.dataset.btogglearrow);
				if (b) mutate(() => { b.open = !b.open; }, { soft: true });
				return;
			}
			const tRow = t.closest && t.closest("[data-btablerow]");
			if (tRow) {
				const b = findBlock(tRow.dataset.btablerow);
				if (b && b.rows) {
					const colCount = (b.rows[0] && b.rows[0].length) || 2;
					mutate(() => { b.rows.push(Array(colCount).fill("")); });
				}
				return;
			}
			const tCol = t.closest && t.closest("[data-btablecol]");
			if (tCol) {
				const b = findBlock(tCol.dataset.btablecol);
				if (b && b.rows) mutate(() => { b.rows.forEach((r) => r.push("")); });
				return;
			}
			const coDot = t.closest && t.closest("[data-bcalloutcolor]");
			if (coDot) {
				const b = findBlock(coDot.dataset.bcalloutcolor);
				if (b) mutate(() => {
					const order = ["blue", "green", "yellow", "red", "gray", "purple"];
					b.color = order[(order.indexOf(b.color || "blue") + 1) % order.length];
				});
				return;
			}
			const lang = t.closest && t.closest("[data-bcodelang]");
			if (lang) {
				const b = findBlock(lang.dataset.bcodelang);
				if (!b) return;
				const next = prompt("Sprache:", b.language || "javascript");
				if (next != null) mutate(() => { b.language = next.trim() || "text"; });
				return;
			}
			const dgView = t.closest && t.closest(".blk-dgwrap:not(.is-editing) [data-bdiagram]");
			if (dgView) { editDiagram(dgView.dataset.bdiagram); return; }
			const mathBlk = t.closest && t.closest("[data-bmath]");
			if (mathBlk) { openMathPop(mathBlk.dataset.bmath); return; }
			const imath = t.closest && t.closest(".blk-imath");
			if (imath) {
				const caret = caretInfo();
				openMathPop(caret && caret.bid, imath);
				return;
			}

			// Download-Knopf eines Dateiblocks (Format ohne Inline-Ansicht)
			const fdl = t.closest && t.closest("[data-fdl]");
			if (fdl) {
				const b = findBlock(fdl.dataset.fdl);
				if (b && String(b.src || "").startsWith("file:")) {
					DB.getBlob(b.src).then((rec) => {
						if (rec) U.downloadBlob(b.name || "Datei", new Blob([rec.buf || rec.data], { type: rec.meta && rec.meta.type || "" }));
						else U.toast("Datei nicht gefunden", "error");
					});
				} else if (b && b.src) {
					window.open(b.src, "_blank", "noopener");
				}
				return;
			}

			// contenteditable folgt externen Links nicht selbst. Interne #seiten-Links
			// lässt der Editor dagegen bis zum zentralen App-Handler weiterlaufen; so
			// entsteht kein fachlich falsches, persistiertes "navigate"-Ereignis.
			const a = t.closest && t.closest("a[href]");
			if (a && host.contains(a)) {
				const href = a.getAttribute("href") || "";
				if (href.startsWith("#")) return;
				e.preventDefault();
				if (isSafeHref(href)) window.open(href, "_blank", "noopener");
				return;
			}

			// Klick auf den leeren Bereich unter dem letzten Block → neuer Absatz
			if (t.dataset && t.dataset.btail != null) {
				const last = blocks[blocks.length - 1];
				if (last && TEXTY[last.type] && !String(last.text || "").trim()) {
					focusBlock(last.id, 0);
				} else {
					const nb = newBlock("p");
					mutate(() => { blocks.push(nb); });
					focusBlock(nb.id, 0);
				}
				return;
			}
			// Klick in einen Block hebt eine bestehende Blockauswahl auf — außer direkt
			// nach einem Drag über Blockgrenzen (dieser Klick gehört noch zum Drag)
			if (crossSelJust) { crossSelJust = false; return; }
			if (selRange && t.closest && t.closest("[data-blk]")) clearSelection();
		});

		// Markieren über Zeilen hinweg („kommt noch“, 22. Juli): Jeder Block ist ein
		// eigenes contenteditable, daher endet native Textauswahl hart an der Block-
		// grenze. Zieht die Maus vom Text eines Blocks in einen anderen, wechseln wir
		// wie Notion in die Blockauswahl (selectBlocks) — kopieren/löschen/färben etc.
		// funktionieren dann über die bestehenden Blockauswahl-Shortcuts.
		host.addEventListener("mousedown", (e) => {
			mouseSelFrom = -1;
			if (e.button !== 0 || readOnly) return;
			if (e.target.closest('.blk-gutter, button, input, a, [contenteditable="false"]')) return;
			const over = e.target.closest("[data-blk]");
			if (over) mouseSelFrom = blocks.findIndex((b) => b.id === over.dataset.blk);
		});
		host.addEventListener("mouseover", (e) => {
			if (mouseSelFrom < 0 || !(e.buttons & 1)) return;
			const over = e.target.closest("[data-blk]");
			if (!over) return;
			const idx = blocks.findIndex((b) => b.id === over.dataset.blk);
			if (idx === -1) return;
			if (idx === mouseSelFrom) {
				// zurück im Startblock: Blockauswahl aufheben, normale Textauswahl gilt wieder
				if (selRange) { clearSelection(); crossSelJust = false; }
				return;
			}
			selAnchor = mouseSelFrom;
			selectBlocks(Math.min(mouseSelFrom, idx), Math.max(mouseSelFrom, idx));
			crossSelJust = true;
		});

		// ⋮⋮ Drag & Drop (nur Top-Level-Blöcke, wie bisher)
		host.addEventListener("dragstart", (e) => {
			const handle = e.target.closest && e.target.closest("[data-bhandle]");
			if (!handle) { e.preventDefault(); return; }
			dragBid = handle.dataset.bhandle;
			e.dataTransfer.effectAllowed = "move";
			e.dataTransfer.setData("text/plain", dragBid);
		});
		host.addEventListener("dragover", (e) => {
			const isFileDrag = e.dataTransfer && e.dataTransfer.types && (e.dataTransfer.types.includes("Files") || e.dataTransfer.types.includes("public.file-url"));
			if (!dragBid && !isFileDrag) return;
			e.preventDefault();
			clearDropMarks();
			const over = e.target.closest && e.target.closest("[data-blk]");
			if (!over) return;
			const r = over.getBoundingClientRect();
			over.classList.add(e.clientY < r.top + r.height / 2 ? "drop-above" : "drop-below");
		});
		host.addEventListener("drop", async (e) => {
			e.preventDefault();
			clearDropMarks();
			// Dateien direkt fallen lassen — ALLE Formate (Bilder als Bildblock,
			// Video/Audio/PDF/Sonstiges als Dateiblock), nicht mehr nur Bilder.
			if (e.dataTransfer.files && e.dataTransfer.files.length) {
				const over = e.target.closest && e.target.closest("[data-blk]");
				let after = over && over.dataset.blk;
				for (const f of e.dataTransfer.files) after = await insertFileBlock(f, after);
				dragBid = null;
				return;
			}
			if (!dragBid) return;
			const over = e.target.closest && e.target.closest("[data-blk]");
			const src = findContext(dragBid);
			dragBid = null;
			if (!over || !src || src.parent) return;
			const dst = findContext(over.dataset.blk);
			if (!dst || dst.parent || dst.block.id === src.block.id) return;
			const r = over.getBoundingClientRect();
			const before = e.clientY < r.top + r.height / 2;
			mutate(() => {
				const [moved] = blocks.splice(src.index, 1);
				let di = blocks.findIndex((x) => x.id === dst.block.id);
				if (!before) di++;
				blocks.splice(di, 0, moved);
			});
		});
		host.addEventListener("dragend", () => { dragBid = null; clearDropMarks(); });

		// Einfügen: Bilder als Blob, Text als Markdown-Blöcke bzw. Inline-Text
		host.addEventListener("paste", async (e) => {
			const field = e.target.closest && e.target.closest("[data-btext],[data-bcell],[data-bsummary],[data-bcode]");
			const items = e.clipboardData && e.clipboardData.items || [];
			for (const item of items) {
				// ALLE Datei-Anhänge aus der Zwischenablage übernehmen (Screenshots,
				// kopierte Videos/PDFs …) — nicht mehr nur Bilder.
				if (item.kind === "file") {
					const f = item.getAsFile();
					if (!f) continue;
					e.preventDefault();
					const caret = caretInfo();
					await insertFileBlock(f, caret && caret.bid);
					return;
				}
			}
			if (!field) return;
			e.preventDefault();
			const text = e.clipboardData.getData("text/plain") || "";
			if (!text) return;
			// Mehrzeiliger Markdown-Text in einen normalen Textblock → als Blöcke einfügen
			if (field.dataset.btext && /\n\s*\n|^(#{1,3}\s|[-*+]\s|\d+[.)]\s|>|\||\$\$|\\\[)/m.test(text) && text.includes("\n")) {
				const c = findContext(field.dataset.btext);
				if (c) {
					const pasted = parse(text);
					// Am Caret teilen (wie Enter): Text davor bleibt im Block, Text danach
					// folgt hinter den eingefügten Blöcken. Ersetzt auch markierten Text.
					const teile = splitFieldAtCaret(field, c.block.text);
					const last = pasted[pasted.length - 1];
					if (teile.nach) {
						pasted.push(LISTY[c.block.type]
							? { id: uid(), type: c.block.type, indent: c.block.indent || 0, text: teile.nach, ...(c.block.type === "todo" ? { checked: false } : {}) }
							: { id: uid(), type: "p", text: teile.nach });
					}
					field.innerHTML = inlineHtml(teile.vor);
					hydrateInlineMath(field);
					mutate(() => {
						c.block.text = teile.vor;
						c.list.splice(c.index + 1, 0, ...pasted);
						if (!teile.vor.trim() && c.block.type === "p") c.list.splice(c.index, 1);
					});
					if (last) focusBlock(last.id, null);
					return;
				}
			}
			// Sonst: als reiner Text an der Caret-Position (Browser-insertText hält den Caret korrekt)
			// Verlaufsmarke erst HIER: im Block-Pfad setzt mutate() bereits eine eigene, zwei
			// Marken pro Einfügen ließen das erste Strg+Z wirkungslos erscheinen.
			checkpoint(true);
			document.execCommand("insertText", false, text);
		});
	}
	function clearDropMarks() {
		host.querySelectorAll(".drop-above,.drop-below").forEach((el) => el.classList.remove("drop-above", "drop-below"));
	}

	// ---------- Globale Verkabelung (einmalig, document-weit) ----------
	function wireGlobal() {
		if (globalWired) return;
		globalWired = true;

		// Klicks in Menüs/Popovern (liegen außerhalb des Hosts im body)
		document.addEventListener("click", (e) => {
			const t = e.target;

			const sp = t.closest && t.closest("[data-slashpick]");
			if (sp) {
				void applySlash(sp.dataset.slashpick).catch((error) => {
					console.warn("Slash-Befehl fehlgeschlagen", error);
					U.toast("Befehl konnte nicht ausgeführt werden", "error");
				});
				return;
			}
			const lp = t.closest && t.closest("[data-linkpick]");
			if (lp) { applyLink(lp.dataset.linkpick); return; }

			const ti = t.closest && t.closest("[data-turninto]");
			if (ti) {
				const [bid, kind] = ti.dataset.turninto.split(":");
				closeMenus();
				const b = findBlock(bid);
				if (b) {
					mutate(() => { turnInto(b, kind); });
					focusBlock(bid, null, kind === "toggle" ? "summary" : kind === "code" ? "code" : "text");
				}
				return;
			}
			const bc = t.closest && t.closest("[data-bcolor]");
			if (bc) {
				const [bid, kind, cname] = bc.dataset.bcolor.split(":");
				closeMenus();
				const b = findBlock(bid);
				if (b) mutate(() => {
					if (kind === "none") { delete b.textColor; delete b.bgColor; }
					else if (kind === "c") { b.textColor = cname; delete b.bgColor; }
					else { b.bgColor = cname; delete b.textColor; }
				});
				return;
			}
			const dup = t.closest && t.closest("[data-bdup]");
			if (dup) {
				const c = findContext(dup.dataset.bdup);
				closeMenus();
				if (c) mutate(() => { c.list.splice(c.index + 1, 0, cloneBlock(c.block)); });
				return;
			}
			const cp = t.closest && t.closest("[data-bcopy]");
			if (cp) {
				const b = findBlock(cp.dataset.bcopy);
				closeMenus();
				if (b) {
					if (navigator.clipboard && navigator.clipboard.writeText) {
						navigator.clipboard.writeText(serializeBlock(b)).then(
							() => U.toast("Als Markdown kopiert"),
							() => U.toast("Kopieren fehlgeschlagen", "error")
						);
					}
				}
				return;
			}
			const fl = t.closest && t.closest("[data-bflash]");
			if (fl) {
				const b = findBlock(fl.dataset.bflash);
				closeMenus();
				if (b) {
					STATE.dispatch("cardCreate", { id: uid(), front: plainTextOf(b), back: "", pageId });
					U.toast("Lernkarte erstellt — Rückseite in Anki ergänzen");
				}
				return;
			}
			const del = t.closest && t.closest("[data-bdel]");
			if (del) {
				const c = findContext(del.dataset.bdel);
				closeMenus();
				if (c) mutate(() => { c.list.splice(c.index, 1); });
				return;
			}
			const mok = t.closest && t.closest(".blk-mathok");
			if (mok) { commitMathPop(); return; }

			// Klick außerhalb: Menüs schließen (Gleichungs-Popover wird übernommen),
			// Klick außerhalb des Editors hebt die Blockauswahl auf
			if (!t.closest || !t.closest(".blk-menu")) {
				if (t.closest && t.closest(".blk-mathpop")) { /* im Popover weitertippen */ }
				else if (mathEdit) commitMathPop();
				else closeMenus();
			}
			if (selRange && host && !host.contains(t)) clearSelection();
		}, true);

		// Enter im Gleichungs-Popover bestätigt (Shift+Enter = neue Zeile)
		document.addEventListener("keydown", (e) => {
			if (mathEdit && e.target.closest && e.target.closest(".blk-mathpop")) {
				if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); commitMathPop(); }
				if (e.key === "Escape") { e.preventDefault(); closeMenus(); }
				return;
			}
			// Blockauswahl-Tasten auch ohne Editor-Fokus (nach Esc liegt der Fokus im body).
			// Wichtig: Events, die der Editor bereits behandelt hat (defaultPrevented),
			// hier ignorieren. Sonst loescht derselbe Backspace, der einen Strukturblock
			// (Tabelle, Bild, Code, Callout, Toggle, Spalten) gerade erst ausgewaehlt hat,
			// ihn im selben Tastendruck wieder — Datenverlust. Wie in Notion gilt:
			// erster Backspace waehlt aus, erst der zweite loescht.
			if (e.defaultPrevented) return;
			if (selRange && host && document.activeElement && !host.contains(document.activeElement)) {
				handleSelectionKeys(e);
				if (e.defaultPrevented) return;
			}
			// Strg+Z / Strg+Y wirken wie in Notion IMMER auf den Editor — auch wenn
			// der Fokus außerhalb liegt (z.B. auf dem body nach einer Blockauswahl).
			// Fremde Eingabefelder (Titel, Suche, Popover) behalten ihr Browser-Undo.
			const mod = e.ctrlKey || e.metaKey;
			if (mod && !readOnly && host && document.body.contains(host)) {
				const ae = document.activeElement;
				const fremdesFeld = ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || (ae.isContentEditable && !host.contains(ae)));
				if (!fremdesFeld && !(ae && host.contains(ae))) {
					const k = (e.key || "").toLowerCase();
					if (k === "z" && !e.shiftKey) { e.preventDefault(); undoRedo(false); return; }
					if (k === "y" || (k === "z" && e.shiftKey)) { e.preventDefault(); undoRedo(true); return; }
				}
			}
		});
		document.addEventListener("visibilitychange", () => {
			if (document.hidden && saveTimer) save(true);
		});
		window.addEventListener("pagehide", () => {
			if (saveTimer) save(true);
		});
		window.addEventListener("freeze", () => {
			if (saveTimer) save(true);
		});
	}

	// ---------- Styles für Datei-/Medienblöcke (einmalig injiziert, wie notebooklm.js) ----------
	function injectStyles() {
		if (styleInjected) return;
		styleInjected = true;
		const st = document.createElement("style");
		st.textContent = [
			".blk-file{margin:3px 0;max-width:100%}",
			".blk-media{display:block;max-width:100%;border-radius:8px}",
			"video.blk-media{width:100%;max-height:480px;background:#000}",
			"audio.blk-media{width:100%;margin-top:6px}",
			".blk-file-row{display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid rgba(128,128,128,.35);border-radius:8px}",
			".blk-file-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
			".blk-file-dl{flex:none;font:inherit;font-size:12px;padding:4px 10px;border-radius:6px;border:1px solid rgba(128,128,128,.35);background:transparent;color:inherit;cursor:pointer}",
			".blk-file figcaption{font-size:12px;opacity:.65;margin-top:3px}",
		].join("\n");
		document.head.appendChild(st);
	}

	// ---------- mount() ----------
	// render.js ruft mount(host, pageId) bei jedem renderMain — parse nur dann,
	// wenn die Seite gewechselt hat oder der Inhalt extern (Sync) geändert wurde.
	function mount(el, pid) {
		const pg = S.pages[pid];
		if (!el || !pg) return;
		const finish = PERF_PROFILER.start("editor.mount", { pid }, 20);
		try {
			const pageChanged = pid !== pageId;
			// Offene Rückstände VOR dem Seitenwechsel abschließen — noch mit den alten Blöcken:
			// der Autosave (450 ms) hätte danach die neue Seite gesehen und die letzten
			// Änderungen der alten stillschweigend verworfen, und der offene Verlaufsschritt
			// (700 ms) wäre im Stapel der NEUEN Seite gelandet — ein Strg+Z dort hätte fremden
			// Inhalt hergestellt.
			if (pageChanged && pageId) {
				if (saveTimer) save(true);
				commitHistory();
			}
			// Externe Änderung = pg.content weicht von dem ab, was der Editor selbst geschrieben
			// hat. Vorher wurde dafür bei JEDEM Render die komplette Seite neu serialisiert.
			// Solange ein eigener Speicherstand noch unterwegs ist, ist pg.content veraltet,
			// nicht extern geändert — sein reduce() überschreibt es gleich mit lastSaved.
			const externallyChanged = !pageChanged && (pg.content || "") !== lastSaved && !histPending && !ownPending.has(pid);
			host = el;
			host.classList.add("block-editor");
			injectStyles();
			if (pageChanged || externallyChanged || !blocks.length) {
				if (pageChanged) { clearSelection(); closeMenus(); touchHistoryPage(pid); }
				pageId = pid;
				blocks = parse(pg.content || "");
				if (pg.pdfId) {
					const filtered = blocks.filter((b) => !isPdfDuplicateBlock(b, pg));
					if (filtered.length !== blocks.length) {
						blocks = filtered;
						if (!blocks.length) blocks.push(newBlock("p"));
					}
				}
				bustCtxIdx(); // frisch geparste Blockobjekte
				lastSaved = pg.content || "";
				histState = snapshotJson();
				histPending = false;
			}
			render();
			wire();
			wireGlobal();
		} finally {
			finish();
		}
	}

	function isReadOnly(pid) { return !!readOnlyFn && !!pid && readOnlyFn(pid); }
	function setReadOnly(fn) { readOnlyFn = typeof fn === "function" ? fn : null; }

	return { mount, undoRedo, isReadOnly, setReadOnly };
})();
