"use strict";
import { S, STATE } from "./state.js";
import { U } from "./util.js";
import { DB } from "./db.js";
import { RAG } from "./rag.js";
import { HEFT } from "./heft.js";
import { AI } from "./ai.js";

export const EDITOR = (() => {
	// Diese Datei wird als Markdown-Codeblock gespiegelt — deshalb nie ein
	// literales Dreifach-Backtick im Quelltext:
	const FENCE = "``" + "`";

	// ---------- Zustand ----------
	let host = null;          // #blockEditor-Container (pro renderMain neu)
	let pageId = null;
	let blocks = [];          // Blockobjekte = interne Wahrheit dieser Sitzung
	let slash = null;         // { items, index, bid }
	let linkMenu = null;      // { items, index, query, bid }
	let linkMenuTimer = 0;    // PERF: Debounce für openLinkMenu beim Tippen hinter "[["
	let blockMenuId = null;
	let mathEdit = null;      // { bid } oder { bid, spanEl } — Gleichungs-Popover
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
	let histTimer = 0;
	let histPending = false;
	let histState = "";       // letzter festgeschriebener Snapshot (JSON)
	let histFocus = null;
	let renderBoundary = null; // einmalige DOM-Marke für exakte Merge-Caretposition
	// v3 (25. Juli): scrollReserve entfallen. Der Editor baut seinen DOM nicht mehr bei
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
	// Doppelte Render-Versuche vermeiden, solange die gemeinsam geladene KaTeX-Engine
	// noch unterwegs ist. WeakSet räumt entfernte Formel-Elemente automatisch auf.
	const mathHydrating = new WeakSet();
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

	const LISTY = { bullet: 1, number: 1, todo: 1 };
	// Blocktypen mit EINEM editierbaren Rich-Text-Feld (block.text)
	const TEXTY = { p: 1, h1: 1, h2: 1, h3: 1, bullet: 1, number: 1, todo: 1, quote: 1 };
	const COLORS = ["gray", "red", "orange", "yellow", "green", "blue", "purple", "pink"];
	const COLOR_META_RE = /^<!--@c:([a-z]+)?(?:;bg:([a-z]+))?-->$/;
	const IMAGE_RE = /^!\[([^\]]*)\]\(([^)\s]+)\)\s*$/;
	const HEFT_RE = /^:::heft\s+(\S+)/;
	// Datei-/Medienblock: ":::file <src> <Anzeigename>" — src ist "file:<id>" (IndexedDB)
	// oder eine externe URL. EIN Blocktyp für ALLE Formate (KISS) — was er anzeigt,
	// entscheidet der MIME-Typ erst beim Hydrieren (Video/Audio/PDF/Bild/Download).
	const FILE_RE = /^:::file\s+(\S+)(?:\s+(.*))?$/;
	// MIME-Typ aus der Dateiendung raten — für externe URLs und Dateien ohne file.type.
	const MIME_EXT = { mp4: "video/mp4", m4v: "video/mp4", webm: "video/webm", mov: "video/quicktime", mkv: "video/x-matroska", mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav", ogg: "audio/ogg", oga: "audio/ogg", opus: "audio/ogg", flac: "audio/flac", pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", avif: "image/avif" };
	const mimeFromName = (name) => {
		const m = String(name || "").toLowerCase().match(/\.([a-z0-9]+)(?:[?#].*)?$/);
		return (m && MIME_EXT[m[1]]) || "";
	};

	const uid = () => U.uid();
	const esc = (t) => U.esc(String(t ?? ""));

	// ---------- Modell: Block-Fabriken & Baum-Navigation ----------
	function newBlock(kind) {
		// Eine Blockauswahl erzeugt NUR Struktur, nie Platzhaltertext.
		if (kind === "table") return { id: uid(), type: "table", rows: [["", ""], ["", ""]] };
		if (kind === "columns") return { id: uid(), type: "columns", columns: [[newBlock("p")], [newBlock("p")]] };
		if (kind === "code") return { id: uid(), type: "code", language: "javascript", text: "" };
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

	// ---------- Inline: Markdown → Rich-HTML → Markdown (verlustfreier Roundtrip) ----------
	const LT = String.fromCharCode(60);
	const tag = (name, inner, attrs) => LT + name + (attrs || "") + ">" + inner + LT + "/" + name + ">";

	// Rendert den Inline-Markdown eines Textblocks als echten Rich-Text.
	// Inline-Formeln ($…$ und \\(…\\)) werden zu nicht-editierbaren Chips mit data-md —
	// KaTeX-DOM darf nie Teil des editierbaren Textflusses werden.
	function inlineHtml(text) {
		return esc(text)
			// data-key enthält die Formel: ändert sie sich, ersetzt U.morph den Chip (frisches
			// KaTeX); bleibt sie gleich, bleibt der gerenderte Chip unangetastet stehen.
			// Formeln matchen nur echte Delimiter; maskierte \$ bleiben reiner Text.
			.replace(/\\\((.+?)\\\)|(?<!\\)\$([^$\n]+?)(?<!\\)\$/g, (md, paren, dollar) => {
				const f = paren == null ? dollar : paren;
				return LT + 'span class="blk-imath" contenteditable="false" data-key="im:' + f + '" data-md="' + md + '" title="Formel bearbeiten">' + f + LT + "/span>";
			})
			.replace(/\\(\$)/g, "$1")
			.replace(/\{(bg-)?(gray|red|orange|yellow|green|blue|purple|pink)\}([\s\S]*?)\{\/\}/g,
				(_, bg, color, v) => tag("span", v, ' class="' + (bg ? "hl-" : "c-") + color + '"'))
			.replace(/==([^=\n]+)==/g, (_, v) => tag("mark", v))
			.replace(/\x60([^\x60]+)\x60/g, (_, v) => tag("code", v))
			.replace(/\*\*\*([^*]+)\*\*\*/g, (_, v) => tag("strong", tag("em", v)))
			.replace(/\*\*([^*]+)\*\*/g, (_, v) => tag("strong", v))
			.replace(/~~([^~]+)~~/g, (_, v) => tag("s", v))
			.replace(/&lt;u&gt;([\s\S]*?)&lt;\/u&gt;/gi, (_, v) => tag("u", v))
			.replace(/(^|[^*])\*([^*\n]+)\*/g, (_, pre, v) => pre + tag("em", v))
			.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => tag("a", label, ' href="' + href + '"'))
			.replace(/\n/g, LT + "br>");
	}

	// DOM eines editierbaren Feldes → Inline-Markdown (exakte Umkehrung von inlineHtml).
	// Hinweis: \x60 = Backtick — als Hex-Escape geschrieben, damit diese Datei
	// beim Spiegeln als Markdown-Codeblock nie kaputt-formatiert werden kann.
	function inlineMarkdown(node) {
		if (node.nodeType === Node.TEXT_NODE) return node.nodeValue || "";
		if (node.nodeType !== Node.ELEMENT_NODE) return "";
		if (node.dataset && node.dataset.md) return node.dataset.md; // Formel-Chip
		const t = node.tagName.toLowerCase();
		const inner = [...node.childNodes].map(inlineMarkdown).join("");
		if (t === "br") return "\n";
		if (t === "strong" || t === "b") return "**" + inner + "**";
		if (t === "em" || t === "i") return "*" + inner + "*";
		if (t === "s" || t === "del" || t === "strike") return "~~" + inner + "~~";
		if (t === "u" || t === "ins") return "<u>" + inner + "</u>";
		if (t === "code") return "\x60" + inner + "\x60";
		if (t === "mark") return "==" + inner + "==";
		if (t === "a") return "[" + inner + "](" + (node.getAttribute("href") || "") + ")";
		if (t === "span") {
			const cls = node.className || "";
			let m = cls.match(/(?:^|\s)c-([a-z]+)/);
			if (m) return "{" + m[1] + "}" + inner + "{/}";
			m = cls.match(/(?:^|\s)hl-([a-z]+)/);
			if (m) return "{bg-" + m[1] + "}" + inner + "{/}";
			return inner;
		}
		if (t === "div" || t === "p") return inner + "\n";
		return inner;
	}
	// Unsichtbare Steuerzeichen (Zero-Width-Space, -Joiner, BOM) entfernen — bewusst
	// über Zeichencodes statt unsichtbarer Literale, damit nichts wegkanonisiert wird.
	const INVISIBLES_RE = new RegExp("[" + String.fromCharCode(8203) + String.fromCharCode(8204) + String.fromCharCode(65279) + "]", "g");
	function mdFromEditable(el) {
		return [...el.childNodes].map(inlineMarkdown).join("").replace(INVISIBLES_RE, "").replace(/\n+$/, "");
	}

	// Feldinhalt am Caret in zwei Markdown-Hälften teilen. Der Schnitt läuft über
	// DOM-Ranges (sichtbare Koordinaten) — Formatierung, Chips und Links bleiben
	// auf beiden Seiten korrekt, egal wie stark Markdown- und Sichttext abweichen.
	function splitFieldAtCaret(field, fallbackText) {
		const sel = window.getSelection();
		if (sel && sel.rangeCount && field.contains(sel.anchorNode)) {
			const r = sel.getRangeAt(0);
			const vorR = document.createRange();
			vorR.selectNodeContents(field);
			vorR.setEnd(r.startContainer, r.startOffset);
			const nachR = document.createRange();
			nachR.selectNodeContents(field);
			nachR.setStart(r.endContainer, r.endOffset);
			const zuMd = (frag) => {
				const t = document.createElement("div");
				t.appendChild(frag);
				return mdFromEditable(t);
			};
			return { vor: zuMd(vorR.cloneContents()), nach: zuMd(nachR.cloneContents()) };
		}
		const t = String(fallbackText || "");
		return { vor: t, nach: "" };
	}

	// Gemeinsamer Direkt-Renderer für Formelblöcke und Inline-Chips. Wichtig: Ein
	// Element gilt erst nach erfolgreichem Laden UND Rendern als hydriert.
	async function hydrateKatex(el, formula, displayMode) {
		if (!el || el.dataset.hydrated || mathHydrating.has(el) || !formula) return;
		mathHydrating.add(el);
		try {
			if (!(await U.ensureKatex())) return;
			// Während des Ladens kann die Seite gewechselt oder die Formel ersetzt worden sein.
			if (!el.isConnected || !host || !host.contains(el)) return;
			katex.render(formula, el, { throwOnError: false, displayMode: !!displayMode });
			el.dataset.hydrated = "1";
			el.dataset.owned = "1";
		} catch { /* Roh-LaTeX bleibt sichtbar; ein späterer Render darf erneut versuchen */ }
		finally { mathHydrating.delete(el); }
	}
	function inlineMathParts(markdown) {
		const md = String(markdown || "");
		if (md.startsWith("\\(") && md.endsWith("\\)")) return { formula: md.slice(2, -2), open: "\\(", close: "\\)" };
		if (md.startsWith("$") && md.endsWith("$")) return { formula: md.slice(1, -1), open: "$", close: "$" };
		return { formula: md, open: "$", close: "$" };
	}

	// Formel-Chips nach dem Rendern mit KaTeX hübsch machen (data-md bleibt Quelle).
	function hydrateInlineMath(root) {
		(root || host).querySelectorAll(".blk-imath").forEach((el) => {
			// data-md enthält "$…$" oder "\\(…\\)" — Delimiter entfernen und direkt rendern
			// (renderMathInElement findet im Chip-Text keine Delimiter mehr).
			hydrateKatex(el, inlineMathParts(el.dataset.md).formula, false);
		});
	}

	// ---------- parse(): Markdown (pg.content) → Blockobjekte ----------
	// Wird genau EINMAL beim mount() aufgerufen — danach ist `blocks` die Wahrheit.
	function parse(md) {
		const lines = String(md || "").replace(/\r\n?/g, "\n").split("\n");
		const out = [];
		let pendingColor = null; // <!--@c:...--> gilt für den nächsten Block
		let i = 0;

		const applyColor = (b) => {
			if (pendingColor) {
				if (pendingColor.c) b.textColor = pendingColor.c;
				if (pendingColor.bg) b.bgColor = pendingColor.bg;
				pendingColor = null;
			}
			return b;
		};

		while (i < lines.length) {
			const line = lines[i];

			if (!line.trim()) { i++; continue; }

			const colorMeta = line.trim().match(COLOR_META_RE);
			if (colorMeta) { pendingColor = { c: colorMeta[1], bg: colorMeta[2] }; i++; continue; }

			// Code-Zaun
			if (line.startsWith(FENCE)) {
				const language = line.slice(3).trim() || "text";
				const buf = [];
				i++;
				while (i < lines.length && !lines[i].startsWith(FENCE)) buf.push(lines[i++]);
				i++;
				out.push(applyColor({ id: uid(), type: "code", language, text: buf.join("\n") }));
				continue;
			}

			// Formel-Block: $$…$$ und \\[…\\] dürfen einzeilig sein, aber auch direkt
			// nach dem öffnenden Delimiter beginnen (z. B. $$\\begin{pmatrix} …).
			const mathStart = line.trim().match(/^(\$\$|\\\[)(.*)$/);
			if (mathStart) {
				const buf = [];
				const endToken = mathStart[1] === "$$" ? "$$" : "\\]";
				const first = mathStart[2];
				const firstEnd = first.indexOf(endToken);
				if (firstEnd >= 0) {
					buf.push(first.slice(0, firstEnd));
					i++;
				} else {
					buf.push(first);
					i++;
					while (i < lines.length) {
						const end = lines[i].indexOf(endToken);
						if (end >= 0) {
							buf.push(lines[i].slice(0, end));
							i++;
							break;
						}
						buf.push(lines[i++]);
					}
				}
				out.push(applyColor({ id: uid(), type: "math", text: buf.join("\n").trim() }));
				continue;
			}

			// Heft-Einbettung
			const heft = line.match(HEFT_RE);
			if (heft) { out.push(applyColor({ id: uid(), type: "heft", heftId: heft[1] })); i++; continue; }

			// Datei-/Medien-Einbettung
			const fil = line.match(FILE_RE);
			if (fil) { out.push(applyColor({ id: uid(), type: "file", src: fil[1], name: fil[2] || "" })); i++; continue; }

			// Spalten (rekursiv geparst)
			if (/^:::columns\b/.test(line)) {
				const cols = [[]];
				let depth = 1;
				const buf = [];
				i++;
				while (i < lines.length && depth > 0) {
					const l = lines[i];
					if (/^:::columns\b/.test(l)) depth++;
					if (/^:::end\b/.test(l)) { depth--; if (!depth) { i++; break; } }
					if (depth === 1 && /^:::split\b/.test(l)) {
						cols[cols.length - 1] = parse(buf.join("\n"));
						buf.length = 0; cols.push([]); i++; continue;
					}
					buf.push(l); i++;
				}
				cols[cols.length - 1] = parse(buf.join("\n"));
				cols.forEach((c) => { if (!c.length) c.push(newBlock("p")); });
				out.push(applyColor({ id: uid(), type: "columns", columns: cols }));
				continue;
			}

			// Toggle <details> (mit Verschachtelungstiefe depth)
			if (/^<details\b/i.test(line.trim())) {
				const open = /\bopen\b/i.test(line);
				const buf = [];
				let summary = "";
				let depth = 1;
				// <summary> darf auch direkt in der <details>-Zeile stehen (Altbestand/Import)
				const sm0 = line.match(/<summary>([\s\S]*?)<\/summary>/i);
				if (sm0) summary = sm0[1];
				i++;
				while (i < lines.length && depth > 0) {
					const l = lines[i];
					const trimmed = l.trim();
					if (/^<details\b/i.test(trimmed)) depth++;
					if (/^<\/details>/i.test(trimmed)) {
						depth--;
						if (depth === 0) { i++; break; }
					}
					if (depth === 1) {
						const sm = l.match(/^\s*<summary>([\s\S]*?)<\/summary>/i);
						if (sm) { summary = sm[1]; i++; continue; }
					}
					buf.push(l); i++;
				}
				const children = parse(buf.join("\n"));
				if (!children.length) children.push(newBlock("p"));
				out.push(applyColor({ id: uid(), type: "toggle", summary, open, children }));
				continue;
			}

			// Callout `> [!farbe]` (Kinder = eingerückte >-Zeilen, rekursiv)
			const co = line.match(/^>\s*\[!([a-z]+)\]\s*(.*)$/i);
			if (co) {
				const buf = co[2] ? [co[2]] : [];
				i++;
				while (i < lines.length && /^>/.test(lines[i])) {
					buf.push(lines[i].replace(/^>\s?/, "")); i++;
				}
				const children = parse(buf.join("\n"));
				if (!children.length) children.push(newBlock("p"));
				out.push(applyColor({ id: uid(), type: "callout", color: co[1].toLowerCase(), children }));
				continue;
			}

			// Zitat (mehrzeilig)
			if (/^>\s?/.test(line)) {
				const buf = [];
				while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ""));
				out.push(applyColor({ id: uid(), type: "quote", text: buf.join("\n") }));
				continue;
			}

			// GFM-Tabelle
			if (/^\s*\|.*\|\s*$/.test(line)) {
				const rows = [];
				while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
					const raw = lines[i].trim().replace(/^\|/, "").replace(/\|$/, "");
					if (!/^[\s:|-]+$/.test(raw)) {
						rows.push(raw.split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, "|").trim()));
					}
					i++;
				}
				const width = Math.max(2, ...rows.map((r) => r.length));
				rows.forEach((r) => { while (r.length < width) r.push(""); });
				if (!rows.length) rows.push(["", ""], ["", ""]);
				out.push(applyColor({ id: uid(), type: "table", rows }));
				continue;
			}

			// Trennlinie
			if (/^\s*---+\s*$/.test(line)) { out.push(applyColor({ id: uid(), type: "divider" })); i++; continue; }

			// Bild — ![…](video.mp4)/(…mp3)/(…pdf) ist KEIN Bild: als Medienblock einhängen.
			// FIX: genau so entstand der „MP4 lässt sich nicht abspielen“-Bug — die Datei
			// landete als kaputtes <img> statt als abspielbares <video>.
			const img = line.match(IMAGE_RE);
			if (img) {
				const mm = mimeFromName(img[2]);
				if (/^(video|audio)\//.test(mm) || mm === "application/pdf") {
					out.push(applyColor({ id: uid(), type: "file", src: img[2], name: img[1] }));
				} else {
					out.push(applyColor({ id: uid(), type: "image", alt: img[1], src: img[2] }));
				}
				i++; continue;
			}

			// Überschriften
			const h = line.match(/^(#{1,3})\s+(.*)$/);
			if (h) {
				out.push(applyColor({ id: uid(), type: "h" + h[1].length, text: h[2] }));
				i++; continue;
			}

			// Listen (Einrückung = 2 Leerzeichen oder 1 Tab pro Ebene)
			const li = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
			if (li) {
				const indent = Math.floor(li[1].replace(/\t/g, "  ").length / 2);
				const rest = li[3];
				const todo = rest.match(/^\[( |x|X)\]\s?(.*)$/);
				if (todo && /^[-*+]$/.test(li[2])) {
					out.push(applyColor({ id: uid(), type: "todo", checked: todo[1].toLowerCase() === "x", indent, text: todo[2] }));
				} else if (/^[-*+]$/.test(li[2])) {
					out.push(applyColor({ id: uid(), type: "bullet", indent, text: rest }));
				} else {
					out.push(applyColor({ id: uid(), type: "number", indent, text: rest }));
				}
				i++; continue;
			}

			// Absatz (Folgezeilen bis Leerzeile gehören dazu, außer neue Blockstarts)
			const buf = [line];
			i++;
			while (i < lines.length && lines[i].trim() &&
				!/^(#{1,3}\s|>|\s*([-*+]|\d+[.)])\s|\s*\||\s*---+\s*$|:::|<details\b|<\/details\b|\$\$|\\\[)/.test(lines[i]) &&
				!lines[i].startsWith(FENCE) && !COLOR_META_RE.test(lines[i].trim()) && !IMAGE_RE.test(lines[i])) {
				buf.push(lines[i]); i++;
			}
			out.push(applyColor({ id: uid(), type: "p", text: buf.join("\n") }));
		}
		return out;
	}

	// ---------- serialize(): Blockobjekte → Markdown (nur im Hintergrund) ----------
	function serializeBlock(b) {
		const colorMeta = (b.textColor || b.bgColor)
			? "<!--@c:" + (b.textColor || "") + (b.bgColor ? ";bg:" + b.bgColor : "") + "-->\n"
			: "";
		const ind = "  ".repeat(b.indent || 0);
		switch (b.type) {
			case "h1": return colorMeta + "# " + (b.text || "");
			case "h2": return colorMeta + "## " + (b.text || "");
			case "h3": return colorMeta + "### " + (b.text || "");
			case "bullet": return colorMeta + ind + "- " + (b.text || "");
			case "number": return colorMeta + ind + "1. " + (b.text || "");
			case "todo": return colorMeta + ind + "- [" + (b.checked ? "x" : " ") + "] " + (b.text || "");
			case "quote": return colorMeta + String(b.text || "").split("\n").map((l) => "> " + l).join("\n");
			case "divider": return "---";
			case "image": return "![" + (b.alt || "") + "](" + (b.src || "") + ")";
			case "heft": return ":::heft " + (b.heftId || "");
			case "file": return ":::file " + (b.src || "") + (b.name ? " " + b.name : "");
			case "code": return FENCE + (b.language || "text") + "\n" + (b.text || "") + "\n" + FENCE;
			case "math": return "$$\n" + (b.text || "") + "\n$$";
			case "table":
				return (b.rows || []).map((row, ri) => {
					const cells = row.map((c) => String(c || "").replace(/\|/g, "\\|").replace(/\n/g, " "));
					const line = "| " + cells.join(" | ") + " |";
					return ri === 0 ? line + "\n|" + row.map(() => " --- ").join("|") + "|" : line;
				}).join("\n");
			case "callout":
				return colorMeta + "> [!" + (b.color || "blue") + "]\n" +
					serializeList(b.children || []).split("\n").map((l) => "> " + l).join("\n");
			case "toggle":
				return "<details" + (b.open ? " open" : "") + ">\n<summary>" + (b.summary || "") + "</summary>\n\n" +
					serializeList(b.children || []) + "\n</details>";
			case "columns":
				return ":::columns\n" + (b.columns || []).map((col) => serializeList(col)).join("\n:::split\n") + "\n:::end";
			default: return colorMeta + String(b.text || "");
		}
	}
	function serializeList(list) {
		const parts = [];
		for (let k = 0; k < list.length; k++) {
			const cur = list[k];
			const prev = list[k - 1];
			// Listen gleicher Art bleiben zusammenhängend (keine Leerzeile),
			// alles andere wird durch Leerzeilen getrennt — wie bisher gespeichert.
			const glue = prev && LISTY[prev.type] && LISTY[cur.type] ? "\n" : "\n\n";
			parts.push((k ? glue : "") + serializeBlock(cur));
		}
		return parts.join("");
	}
	const serialize = () => serializeList(blocks);

	// ---------- Fokus / Caret ----------
	function caretInfo() {
		const sel = window.getSelection();
		if (!sel || !sel.rangeCount || !host) return null;
		const el = sel.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement);
		const field = el && el.closest && el.closest("[data-btext],[data-bcell],[data-bsummary],[data-bcode]");
		if (!field || !host.contains(field)) return null;
		const range = sel.getRangeAt(0).cloneRange();
		range.selectNodeContents(field);
		range.setEnd(sel.anchorNode, sel.anchorOffset);
		return {
			bid: field.dataset.btext || field.dataset.bsummary || field.dataset.bcode || (field.dataset.bcell || "").split(":")[0],
			cell: field.dataset.bcell || null,
			kind: field.dataset.bsummary ? "summary" : field.dataset.bcode ? "code" : field.dataset.bcell ? "cell" : "text",
			offset: range.toString().length,
		};
	}

	// Caret an Zeichen-Offset in einem contenteditable-Feld setzen.
	function setCaret(field, offset) {
		if (!field) return;
		// Der Browser darf beim Fokus nie irgendeinen Vorfahren scrollen. Ein
		// scrollIntoView() ist hier absichtlich verboten: selbst mit „nearest“ kann
		// Chromium bei einem frisch aufgebauten contenteditable den äußeren
		// Dokument-Scroller versetzen.
		field.focus({ preventScroll: true });
		const sel = window.getSelection();
		if (!sel) return;
		if (offset == null) offset = Infinity;
		let remaining = offset, gesetzt = false;
		const walker = document.createTreeWalker(field, NodeFilter.SHOW_TEXT, {
			acceptNode: (n) => {
				const p = n.parentElement;
				if (p && p.closest && p.closest('[contenteditable="false"]')) return NodeFilter.FILTER_REJECT;
				return NodeFilter.FILTER_ACCEPT;
			},
		});
		let node = null, last = null;
		while ((node = walker.nextNode())) {
			last = node;
			const len = node.nodeValue.length;
			if (remaining <= len) {
				sel.collapse(node, remaining);
				gesetzt = true;
				break;
			}
			remaining -= len;
		}
		if (!gesetzt) {
			if (last) sel.collapse(last, last.nodeValue.length);
			else sel.collapse(field, field.childNodes.length);
		}
		keepCaretVisible();
	}

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

	function commitHistory() {
		if (!histPending) return;
		histPending = false;
		const stack = undoStacks[pageId] || (undoStacks[pageId] = []);
		const root = scrollRoot();
		stack.push({ json: histState, focus: histFocus, scrollTop: root ? root.scrollTop : 0 });
		if (stack.length > HISTORY_LIMIT) stack.shift();
		redoStacks[pageId] = [];
		histState = snapshotJson();
	}

	// checkpoint(): VOR einer Änderung aufrufen. Tipp-Änderungen werden 700ms
	// gebündelt (ein Undo-Schritt pro Tipp-Phase, wie in Notion), strukturelle
	// Änderungen (force) schreiben sofort fest.
	function checkpoint(force) {
		if (!histPending) {
			histPending = true;
			histFocus = caretInfo();
		}
		clearTimeout(histTimer);
		if (force) commitHistory();
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
			STATE.dispatch("pageUpdate", { id: pageId, patch: { content }, viaEditor: true });
			RAG.queuePage(pageId);
		};
		if (now) run();
		else saveTimer = setTimeout(() => { saveTimer = 0; run(); }, 450);
	}

	// mutate(): die eine Transaktions-Klammer für ALLE Strukturänderungen.
	function mutate(fn, opts) {
		checkpoint(!(opts && opts.soft));
		// Strukturänderung: Blockindex verwerfen und während fn() direkt suchen.
		ctxLive = false;
		try { fn(); } finally { bustCtxIdx(); ctxLive = true; }
		// Nach Struktur-Mutation muss histState dem IST-Zustand entsprechen.
		// checkpoint(force) hat zuvor den Vorzustand committed und histState auf den
		// Snapshot VOR fn() gesetzt — ohne diese Korrektur hinkt die History hinterher
		// und Strg+Z stellt oft denselben Stand wieder her (wirkt wie "tut nichts").
		if (!(opts && opts.soft)) {
			histState = snapshotJson();
			histPending = false;
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
		return '<div class="' + cls + '" ' + attr + ' contenteditable="true" spellcheck="false" data-placeholder="' +
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
				inner = '<div class="blk-li"' + ind + '><span class="blk-marker blk-num" data-bnum="' + b.id + '">1.</span>' +
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
				// Immer contenteditable-<pre> — nie eine Textarea (kein Designwechsel).
				// Syntax-Highlight passiert nur bei render(), nicht während des Tippens
				// (sonst springt der Caret); beim Verlassen wird neu gerendert.
				inner = '<div class="blk-codewrap">' +
					'<button class="blk-codelang" data-bcodelang="' + b.id + '">' + esc(b.language || "text") + "</button>" +
					'<pre class="blk-code"><code class="blk-text" data-bcode="' + b.id +
					'" contenteditable="true" spellcheck="false">' + codeHtml(b.text, b.language) +
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
					'" contenteditable="false"><div class="blk-file-row"><span class="blk-file-ic">📎</span>' +
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
		if (!pg) return "";
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
		return '<div class="child-pages" contenteditable="false">' + kinder.map((k) => {
			const ic = k.icon || (k.pdfId ? "📄" : k.kind === "heft" ? "📓" : "📝");
			const icHtml = /^(https?:|data:)/.test(ic) ? '<img class="cp-img" src="' + esc(ic) + '" alt="">' : esc(ic);
			return '<button type="button" class="child-page-row" data-page="' + esc(k.id) + '">' +
				'<span class="cp-icon">' + icHtml + "</span>" +
				'<span class="cp-title">' + esc(k.title || "Ohne Titel") + "</span>" +
				"</button>";
		}).join("") + "</div>";
	}

	function render(opts) {
		if (!host) return;
		if (!blocks.length) { blocks.push(newBlock("p")); bustCtxIdx(); }
		const o = opts || {};
		renderBoundary = o.boundary || null;
		// v3 (25. Juli): DOM ANGLEICHEN statt wegwerfen. Vorher ersetzte jedes render()
		// den kompletten Editor-Inhalt per innerHTML — bei jedem Enter, jeder Listen-
		// Umwandlung, jedem Undo. Folgen: alle Bilder, Formeln, Codeblocks und Medien
		// wurden neu aufgebaut (Tipp-Ruckeln auf langen Seiten), laufende Videos sprangen
		// zurück auf Anfang, und die Scrollposition musste hinterher mühsam nachgerechnet
		// werden. U.morph fasst jetzt nur die Blöcke an, die sich wirklich geändert haben
		// (data-key = Block-ID) — alles andere bleibt physisch dasselbe DOM-Element.
		U.morph(host, blocks.map((b) => blockHtml(b)).join("") +
			childPagesHtml() +
			'<div class="blk-tail" data-key="tail" data-btail="1"></div>');
		renderBoundary = null;
		renumber();
		hydrate();
		applySelectionClasses();
	}

	// Nummerierte Listen: fortlaufende Zähler je Ebene (wie Notion).
	function renumber() {
		const counters = {};
		let prevListy = false;
		// PERF: alle Zähler-Marker EINMAL einsammeln. Vorher lief pro nummeriertem
		// Eintrag ein eigener DOM-Selektor über den ganzen Editor — bei jedem Enter in
		// einer langen Liste hunderte Suchläufe.
		const nums = new Map();
		host.querySelectorAll("[data-bnum]").forEach((el) => nums.set(el.dataset.bnum, el));
		const walk = (list) => {
			for (const b of list) {
				if (b.type === "number") {
					const depth = b.indent || 0;
					if (!prevListy) for (const k in counters) delete counters[k];
					counters[depth] = (counters[depth] || 0) + 1;
					for (const k in counters) if (+k > depth) delete counters[k];
					const el = nums.get(b.id);
					if (el) el.textContent = counters[depth] + ".";
					prevListy = true;
				} else {
					prevListy = LISTY[b.type] ? true : false;
					if (!LISTY[b.type]) for (const k in counters) delete counters[k];
				}
				if (b.children) walk(b.children);
				if (b.columns) b.columns.forEach(walk);
			}
		};
		walk(blocks);
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
			if (src.startsWith("img:")) {
				try {
					// DB.putBlob speichert { buf, meta } — blob.data bleibt als Fallback für
					// Alt-Datensätze aus der früheren "notion"-DB lesbar (siehe DB.blobUrl).
					const u = await DB.blobUrl(src, "image/png");
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
	function fileViewHtml(url, mime, name, bid) {
		const cap = name ? "<figcaption>" + esc(name) + "</figcaption>" : "";
		if (mime.startsWith("video/")) return '<video class="blk-media" src="' + esc(url) + '" controls preload="metadata" playsinline></video>' + cap;
		if (mime.startsWith("audio/")) return '<div class="blk-file-row"><span class="blk-file-ic">🎧</span><span class="blk-file-name">' + esc(name || "Audio") + '</span></div><audio class="blk-media" src="' + esc(url) + '" controls preload="metadata"></audio>';
		if (mime.startsWith("image/")) return '<img class="blk-media" src="' + esc(url) + '" alt="' + esc(name) + '" draggable="false">' + cap;
		if (mime === "application/pdf") return '<iframe class="blk-media blk-pdfframe" src="' + esc(url) + '" title="' + esc(name || "PDF") + '"></iframe>' + cap;
		// Unbekanntes Format: Zeile mit Download-Knopf (Delegation über data-fdl in wire()).
		return '<div class="blk-file-row"><span class="blk-file-ic">📎</span><span class="blk-file-name">' + esc(name || "Datei") + '</span><button type="button" class="blk-file-dl" data-fdl="' + bid + '">⬇ Herunterladen</button></div>';
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
		if (src.startsWith("file:")) {
			try {
				const rec = await DB.getBlob(src);
				if (!rec) { fig.innerHTML = '<div class="blk-file-row"><span class="blk-file-ic">⚠️</span><span class="blk-file-name">Datei fehlt: ' + esc(name || src) + "</span></div>"; return; }
				mime = (rec.meta && rec.meta.type) || mime;
				// EIN Object-URL je Datei (DB.blobUrl) — vorher entstand pro Render ein neuer,
				// der nie freigegeben wurde.
				const u = await DB.blobUrl(src, mime);
				if (!u) { fig.innerHTML = '<div class="blk-file-row"><span class="blk-file-ic">⚠️</span><span class="blk-file-name">Datei fehlt: ' + esc(name || src) + "</span></div>"; return; }
				url = u;
			} catch { fig.innerHTML = '<div class="blk-file-row"><span class="blk-file-ic">⚠️</span><span class="blk-file-name">Datei konnte nicht geladen werden</span></div>'; return; }
		}
		fig.innerHTML = fileViewHtml(url, mime || "", name, bid);
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

	// ---------- Popover-Gerüst (Slash, Links, Blockmenü, Farben, Gleichung) ----------
	function closeMenus() {
		document.querySelectorAll(".blk-menu, .blk-mathpop").forEach((el) => el.remove());
		slash = null; linkMenu = null; blockMenuId = null; mathEdit = null;
	}
	function positionMenu(menu, anchorEl) {
		let r = anchorEl.getBoundingClientRect();
		const selection = window.getSelection();
		if (selection?.rangeCount && selection.anchorNode && anchorEl.contains(selection.anchorNode)) {
			const caretRange = selection.getRangeAt(0).cloneRange();
			caretRange.collapse(true);
			const caretRect = caretRange.getBoundingClientRect();
			if (caretRect && (caretRect.width || caretRect.height)) r = caretRect;
		}
		const mw = menu.offsetWidth || 280, mh = menu.offsetHeight || 200;
		let x = r.left;
		let side = menu.dataset.side;
		if (!side) side = r.bottom + 4 + mh <= innerHeight - 8 ? "below" : "above";
		let y = side === "below" ? r.bottom + 4 : Math.max(8, r.top - mh - 4);
		if (side === "below" && y + mh > innerHeight - 8 && r.top - mh - 4 >= 8) {
			side = "above";
			y = r.top - mh - 4;
		}
		if (x + mw > innerWidth - 8) x = Math.max(8, innerWidth - mw - 8);
		menu.dataset.side = side;
		menu.style.left = Math.max(8, x) + "px";
		menu.style.top = y + "px";
	}
	function openMenu(anchorEl, html, cls) {
		closeMenus();
		const menu = document.createElement("div");
		menu.className = "blk-menu " + (cls || "");
		menu.innerHTML = html;
		document.body.appendChild(menu);
		positionMenu(menu, anchorEl);
		return menu;
	}

	// ---------- Slash-Menü ----------
	const SLASH = [
		{ k: "p", icon: "¶", label: "Text", hint: "Einfacher Absatz" },
		{ k: "h1", icon: "H1", label: "Überschrift 1", hint: "# " },
		{ k: "h2", icon: "H2", label: "Überschrift 2", hint: "## " },
		{ k: "h3", icon: "H3", label: "Überschrift 3", hint: "### " },
		{ k: "todo", icon: "☑", label: "To-do-Liste", hint: "[] " },
		{ k: "bullet", icon: "•", label: "Aufzählung", hint: "- " },
		{ k: "number", icon: "1.", label: "Nummerierte Liste", hint: "1. " },
		{ k: "toggle", icon: "▸", label: "Toggle-Liste", hint: "> aufklappbar" },
		{ k: "quote", icon: "”", label: "Zitat", hint: "> " },
		{ k: "callout", icon: "💡", label: "Callout", hint: "Hervorgehobener Kasten" },
		{ k: "code", icon: "</>", label: "Code", hint: "Codeblock mit Syntax" },
		{ k: "math", icon: "√", label: "Gleichung", hint: "KaTeX-Formel" },
		{ k: "table", icon: "▦", label: "Tabelle", hint: "Einfache Tabelle" },
		{ k: "columns", icon: "▫▫", label: "2 Spalten", hint: "Nebeneinander" },
		{ k: "divider", icon: "—", label: "Trennlinie", hint: "---" },
		{ k: "image", icon: "🏞", label: "Bild", hint: "Hochladen" },
		{ k: "file", icon: "📎", label: "Datei / Medien", hint: "Video, Audio, PDF …" },
		{ k: "heft", icon: "📓", label: "Heft", hint: "Handschrift-Einbettung" },
		{ k: "link", icon: "🔗", label: "Seite verlinken", hint: "[[" },
	];

	function openSlash(bid, query) {
		const q = (query || "").toLowerCase();
		const items = SLASH.filter((s) => !q || s.label.toLowerCase().includes(q) || s.k.includes(q));
		if (!items.length) { closeMenus(); return; }
		const field = fieldOf(bid, "text");
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
		slash = { items, index: keepIndex, bid, query: q };
	}

	// Führt eine Slash-Auswahl aus: "/befehl" aus dem Text entfernen, Block wandeln.
	async function applySlash(kind) {
		if (!slash) return;
		const bid = slash.bid;
		closeMenus();
		let c = findContext(bid);
		if (!c) return;
		const text = String(c.block.text || "").replace(/\/[^/]*$/, "");
		if (kind === "link") {
			mutate(() => { c.block.text = text + "[["; }, { soft: true });
			paintTextField(bid, text + "[[", text.length + 2);
			openLinkMenu(bid, "");
			return;
		}
		if (kind === "image" || kind === "file") {
			mutate(() => { c.block.text = text; }, { soft: true });
			paintTextField(bid, text, text.length, false);
			pickFile(bid, kind === "image" ? "image/*" : "");
			return;
		}
		if (kind === "heft") {
			const heftPageId = uid();
			// Erst die Zielseite dauerhaft anlegen. So kann weder die Vorschau vor der
			// Seite hydriert werden noch bei einem fehlgeschlagenen Dispatch ein verwaister
			// :::heft-Verweis im Dokument landen.
			await STATE.dispatch("pageCreate", {
				id: heftPageId, title: "Heft", parentId: pageId,
				workspaceId: S.pages[pageId] && S.pages[pageId].workspaceId, icon: "📓", kind: "heft",
			});
			c = findContext(bid);
			if (!c) return;
			mutate(() => {
				const nb = { id: uid(), type: "heft", heftId: heftPageId };
				c.block.text = text;
				c.list.splice(c.index + 1, 0, nb);
			});
			paintTextField(bid, text, text.length, false);
			return;
		}
		mutate(() => {
			if (TEXTY[c.block.type] && (kind === "table" || kind === "columns" || kind === "code" || kind === "math" ||
				kind === "divider" || kind === "callout" || kind === "toggle")) {
				// Strukturblock: Rest-Text bleibt als eigener Block erhalten
				const nb = newBlock(kind);
				if (kind === "callout" && text) nb.children = [{ id: uid(), type: "p", text }];
				if (kind === "toggle" && text) nb.summary = text;
				if (text && kind !== "callout" && kind !== "toggle") {
					c.block.text = text;
					c.list.splice(c.index + 1, 0, nb);
				} else {
					c.list.splice(c.index, 1, nb);
				}
				setTimeout(() => {
					if (kind === "table") focusBlock(nb.id, 0, "cell", nb.id + ":0:0");
					else if (kind === "toggle") focusBlock(nb.id, null, "summary");
					else if (kind === "code") focusBlock(nb.id, 0, "code");
					else if (kind === "math") openMathPop(nb.id);
					else if (nb.columns && nb.columns[0] && nb.columns[0][0]) focusBlock(nb.columns[0][0].id, 0);
					else if (nb.children && nb.children[0]) focusBlock(nb.children[0].id, 0);
					else if (kind !== "divider") focusBlock(nb.id, 0);
				}, 0);
			} else {
				turnInto(c.block, kind);
				c.block.text = text;
			}
		});
		// Falls der ursprüngliche Textblock erhalten blieb, muss sein geschützter
		// contenteditable-DOM denselben Stand wie das Modell erhalten. Bei ersetzten
		// Strukturblöcken existiert das Feld nicht mehr und der Aufruf ist wirkungslos.
		paintTextField(bid, text, text.length);
	}

	// ---------- [[ Seiten-Link-Menü ----------
	function openLinkMenu(bid, query) {
		const q = (query || "").toLowerCase();
		const items = STATE.activePages()
			.filter((p) => p.id !== pageId && (!q || String(p.title || "").toLowerCase().includes(q)))
			.slice(0, 8);
		const field = fieldOf(bid, "text");
		if (!field) return;
		const keepIndex = linkMenu && linkMenu.bid === bid ? Math.min(linkMenu.index, Math.max(0, items.length - 1)) : 0;
		const html = items.length
			? items.map((p, k) =>
				'<div class="blk-mi' + (k === keepIndex ? " active" : "") + '" data-linkpick="' + p.id + '">' +
				'<span class="blk-mi-ic">' + esc(p.icon || "📄") + "</span><span>" + esc(p.title || "Ohne Titel") + "</span></div>").join("")
			: '<div class="blk-mi disabled">Keine Seite gefunden</div>';
		openMenu(field, html, "blk-linkmenu");
		linkMenu = { items, index: keepIndex, bid, query: q };
	}

	function applyLink(pid) {
		if (!linkMenu) return;
		const bid = linkMenu.bid;
		closeMenus();
		const c = findContext(bid);
		const page = S.pages[pid];
		if (!c || !page) return;
		const link = "[" + (page.title || "Ohne Titel") + "](#" + pid + ")";
		const newText = String(c.block.text || "").replace(/\[\[[^\]]*$/, link);
		mutate(() => {
			c.block.text = newText;
		});
		paintTextField(bid, newText, newText.length);
	}

	// ---------- ⋮⋮-Blockmenü (Umwandeln, Farbe, Duplizieren, Löschen …) ----------
	const TURN_TYPES = [
		["p", "Text"], ["h1", "Überschrift 1"], ["h2", "Überschrift 2"], ["h3", "Überschrift 3"],
		["todo", "To-do-Liste"], ["bullet", "Aufzählung"], ["number", "Nummerierte Liste"],
		["toggle", "Toggle-Liste"], ["quote", "Zitat"], ["callout", "Callout"], ["code", "Code"],
	];

	function openBlockMenu(bid, anchorEl) {
		const b = findBlock(bid);
		if (!b) return;
		const turn = TEXTY[b.type] || b.type === "toggle" || b.type === "callout" || b.type === "code"
			? '<div class="blk-msec">Umwandeln in</div>' + TURN_TYPES.map(([k, label]) =>
				'<div class="blk-mi' + (b.type === k ? " active" : "") + '" data-turninto="' + bid + ":" + k + '">' + esc(label) + "</div>").join("")
			: "";
		const colors = TEXTY[b.type] || b.type === "callout"
			? '<div class="blk-msec">Farbe</div><div class="blk-colorrow">' +
				COLORS.map((cname) => '<button class="blk-cdot c-' + cname + '" data-bcolor="' + bid + ":c:" + cname + '" title="' + cname + '"></button>').join("") +
				'</div><div class="blk-colorrow">' +
				COLORS.map((cname) => '<button class="blk-cdot hl-' + cname + '" data-bcolor="' + bid + ":bg:" + cname + '" title="' + cname + ' Hintergrund"></button>').join("") +
				'<button class="blk-cdot" data-bcolor="' + bid + ':none:" title="Farbe entfernen">✕</button></div>'
			: "";
		const html = turn + colors +
			'<div class="blk-msec"></div>' +
			'<div class="blk-mi" data-bdup="' + bid + '">Duplizieren <small>Strg+D</small></div>' +
			'<div class="blk-mi" data-bcopy="' + bid + '">Als Markdown kopieren</div>' +
			(TEXTY[b.type] ? '<div class="blk-mi" data-bflash="' + bid + '">Lernkarte erstellen</div>' : "") +
			'<div class="blk-mi danger" data-bdel="' + bid + '">Löschen <small>Entf</small></div>';
		openMenu(anchorEl, html, "blk-blockmenu");
		blockMenuId = bid;
	}

	// ---------- Gleichungs-Popover (Block- und Inline-Formeln, wie Notion) ----------
	function openMathPop(bid, spanEl) {
		closeMenus();
		const anchor = spanEl || host.querySelector('[data-bmath="' + bid + '"]');
		if (!anchor) return;
		const inline = spanEl ? inlineMathParts(spanEl.dataset.md) : null;
		const src = inline ? inline.formula : String((findBlock(bid) || {}).text || "");
		const pop = document.createElement("div");
		pop.className = "blk-mathpop";
		pop.innerHTML = '<textarea class="blk-mathinput" rows="2" placeholder="E = mc^2">' + esc(src) + "</textarea>" +
			'<div class="blk-mathfoot"><small>Esc = abbrechen</small><button class="blk-mathok">Fertig ↵</button></div>';
		document.body.appendChild(pop);
		const r = anchor.getBoundingClientRect();
		pop.style.left = Math.max(8, Math.min(r.left, innerWidth - pop.offsetWidth - 8)) + "px";
		pop.style.top = (r.bottom + 6) + "px";
		mathEdit = { bid, spanEl: spanEl || null, delimiters: inline ? [inline.open, inline.close] : null };
		const ta = pop.querySelector("textarea");
		ta.focus();
		ta.select();
	}

	function commitMathPop() {
		const pop = document.querySelector(".blk-mathpop");
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
			syncFieldToModel(field);
			mutate(() => {}, { soft: true });
			return;
		}
		const c = findContext(bid);
		if (!c) return;
		mutate(() => {
			if (value) c.block.text = value;
			else c.list.splice(c.index, 1, { id: c.block.id, type: "p", text: "" });
		});
	}

	// ---------- Datei/Bild auswählen & hochladen (EIN Pfad für alle Formate) ----------
	// accept="image/*" nur für den Bild-Befehl; der Datei-Befehl nimmt alles.
	function pickFile(bid, accept) {
		const input = document.createElement("input");
		input.type = "file";
		if (accept) input.accept = accept;
		input.multiple = true;
		input.onchange = async () => {
			for (const file of input.files || []) await insertFileBlock(file, bid);
		};
		input.click();
	}
	// EINE Funktion für ALLE Uploads (DRY — ersetzt insertImageFile): Bilder werden
	// Bildblöcke, alles andere (Video, Audio, PDF, beliebige Dateien) ein Dateiblock.
	async function insertFileBlock(file, afterBid) {
		const isImg = (file.type || mimeFromName(file.name)).startsWith("image/");
		const buf = await U.readAsBuffer(file);
		const blobId = (isImg ? "img:" : "file:") + uid();
		await DB.putBlob(blobId, buf, { type: file.type || mimeFromName(file.name), name: file.name });
		mutate(() => {
			const nb = isImg
				? { id: uid(), type: "image", src: blobId, alt: file.name.replace(/\.[a-z0-9]+$/i, "") }
				: { id: uid(), type: "file", src: blobId, name: file.name };
			const c = afterBid && findContext(afterBid);
			if (c) {
				if (TEXTY[c.block.type] && !String(c.block.text || "").trim()) c.list.splice(c.index, 1, nb);
				else c.list.splice(c.index + 1, 0, nb);
			} else {
				blocks.push(nb);
			}
		});
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
			openSlash(bid, sm[1]);
			return false;
		} else if (slash) closeMenus();

		// [[ Link-Menü — PERF (18. Juli, Audit-Punkt): Folgezeichen debounced (80 ms).
		// Vorher lief STATE.activePages() + Titel-Filter bei JEDEM Tastendruck hinter
		// "[[". Das erste Öffnen bleibt sofort; nur die Suche beim Weitertippen wird
		// gebündelt. Der Guard im Timer verhindert ein Wiederöffnen nach closeMenus().
		const lm = upto.match(/\[\[([^\]]*)$/);
		if (lm) {
			clearTimeout(linkMenuTimer);
			if (!linkMenu) openLinkMenu(bid, lm[1]);
			else linkMenuTimer = setTimeout(() => { if (linkMenu) openLinkMenu(bid, lm[1]); }, 80);
			return false;
		}
		else if (linkMenu) { clearTimeout(linkMenuTimer); closeMenus(); }

		// Nur bei Leerzeichen als letztem Zeichen: Blocktyp-Trigger
		if (e && e.data === " " && c.block.type === "p") {
			for (const [re, kind] of TRANSFORMS) {
				if (re.test(upto)) {
					mutate(() => {
						turnInto(c.block, kind);
						c.block.text = split.nach;
					});
					focusBlock(bid, 0);
					return true;
				}
			}
		}
		// "---" → Trennlinie
		if (text === "---") {
			mutate(() => {
				const nb = newBlock("p");
				c.list.splice(c.index, 1, { id: c.block.id, type: "divider" }, nb);
				focusBlock(nb.id, 0);
			});
			return true;
		}
		// Code-Zaun → Codeblock
		if (text.startsWith(FENCE)) {
			const language = text.slice(3).trim() || "javascript";
			mutate(() => {
				c.list.splice(c.index, 1, { id: c.block.id, type: "code", language, text: "" });
				focusBlock(c.block.id, 0, "code");
			});
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
			const probe = document.createElement("div");
			probe.innerHTML = inlineHtml(split.vor);
			const off = probe.textContent.length;
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
		const domStartOff = vorR.toString().length;
		const domMidLen = midR.toString().length;
		let next;
		if (pre.endsWith(before) && post.startsWith(after)) {
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
			mutate(() => { c.list.splice(c.index + 1, 0, cloneBlock(JSON.parse(JSON.stringify(c.block)))); });
			return;
		}

		// --- Strg+Shift+0-8: Blocktyp wechseln (wie Notion: 0=Text, 1-3=H, 4=Todo, 5=Bullet, 6=Nummer, 7=Toggle, 8=Code) ---
		if (mod && e.shiftKey && /^[0-8]$/.test(e.key) && c) {
			e.preventDefault();
			const map = { 0: "p", 1: "h1", 2: "h2", 3: "h3", 4: "todo", 5: "bullet", 6: "number", 7: "toggle", 8: "code" };
			const off = caret.offset;
			mutate(() => { turnInto(c.block, map[e.key]); });
			focusBlock(bid, off, map[e.key] === "toggle" ? "summary" : map[e.key] === "code" ? "code" : "text");
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
						mutate(() => {
							if (!b.children || b.children.length === 0 || (b.children.length === 1 && !String(b.children[0].text || "").trim())) {
								turnInto(b, "p");
							} else {
								c.list.splice(c.index, 1, ...b.children);
							}
						});
						focusBlock(b.id, 0);
						return;
					}
				}
			}
			if (e.key === "ArrowUp" || e.key === "ArrowDown") {
				const b = findBlock(field.dataset.bsummary);
				const caret = caretInfo();
				const text = String(b && b.summary || "");
				const d = e.key === "ArrowUp" ? -1 : 1;
				const edge = d < 0 ? caret && caret.offset === 0 : caret && caret.offset >= text.length;
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

	// Enter/Backspace/Delete/Tab in normalen Textblöcken — exakt wie Notion.
	function handleTextBlockKeys(e, field, c, caret) {
		const b = c.block;
		const text = String(b.text || "");
		const off = caret ? caret.offset : text.length;
		const atStart = off === 0 && String(window.getSelection()).length === 0;
		const atEnd = off >= (field.textContent || "").length;

		// Shift+Enter = weicher Umbruch im selben Block (Browser macht <br>) → ok
		if (e.key === "Enter" && e.shiftKey) return;

		if (e.key === "Enter") {
			e.preventDefault();
			closeMenus();
			// Leeres Listenelement + Enter = ausrücken bzw. zu Text (wie Notion)
			if (LISTY[b.type] && !text.trim()) {
				mutate(() => {
					if ((b.indent || 0) > 0) b.indent--;
					else turnInto(b, "p");
				});
				focusBlock(b.id, 0);
				return;
			}
			let neuId = null;
			const teile = splitFieldAtCaret(field, text);
			const before = teile.vor, after = teile.nach;
			field.innerHTML = inlineHtml(before);
			hydrateInlineMath(field);
			mutate(() => {
				b.text = before;
				// Listen setzen sich fort; Überschriften/Zitate erzeugen Text darunter
				const nb = LISTY[b.type]
					? { id: uid(), type: b.type, indent: b.indent || 0, text: after, ...(b.type === "todo" ? { checked: false } : {}) }
					: { id: uid(), type: "p", text: after };
				c.list.splice(c.index + 1, 0, nb);
				neuId = nb.id;
			});
			// Fokus SOFORT (synchron) an den Anfang des neuen Blocks setzen — wie in
			// Notion. Der frühere setTimeout-Fokus kam einen Tick zu spät und
			// verursachte Caret-Sprünge direkt nach Enter.
			if (neuId) focusBlock(neuId, 0);
			return;
		}

		if (e.key === "Tab") {
			e.preventDefault();
			if (!LISTY[b.type]) return; // wie Notion (vereinfachtes Modell): nur Listen-Ebenen
			mutate(() => {
				if (e.shiftKey) { if ((b.indent || 0) > 0) b.indent--; }
				else {
					// Nur einrücken, wenn ein Listenelement darüber existiert (Notion-Regel)
					const prev = c.list[c.index - 1];
					if (prev && LISTY[prev.type] && (b.indent || 0) <= (prev.indent || 0)) b.indent = (b.indent || 0) + 1;
				}
			}, { soft: true });
			render();
			focusBlock(b.id, off);
			return;
		}

		if (e.key === "Backspace" && atStart) {
			e.preventDefault();
			const prev = c.list[c.index - 1];
			// Stufe 1: Listen mit Text verschmelzen direkt mit dem Vorgänger (wie Notion);
			// leere Listen rücken aus bzw. werden zu Text. Überschriften werden zu Text.
			if (LISTY[b.type]) {
				if ((b.indent || 0) > 0) {
					mutate(() => { b.indent--; }, { soft: true });
					render();
					focusBlock(b.id, 0);
					return;
				}
				if (!text.trim() || !prev || !TEXTY[prev.type]) {
					if (b.type !== "p") {
						mutate(() => { turnInto(b, "p"); });
						focusBlock(b.id, 0);
						return;
					}
				}
			} else if (b.type !== "p") {
				mutate(() => { turnInto(b, "p"); });
				focusBlock(b.id, 0);
				return;
			}
			// Stufe 2: mit dem Vorgänger verschmelzen
			if (!prev) {
				// Anfang einer Kind-Liste (Callout/Toggle/Spalte): Block vor den Elternblock ziehen
				if (c.parent) {
					const pc = findContext(c.parent.id);
					if (c.parent.type === "toggle") {
						focusBlock(c.parent.id, null, "summary");
						return;
					}
					if (pc && !text.trim() && c.list.length > 1) {
						mutate(() => { c.list.splice(c.index, 1); });
						focusBlock(pc.block.id, null, pc.block.type === "toggle" ? "summary" : undefined);
						return;
					}
					if (pc && !pc.parent) {
						selAnchor = pc.index;
						selectBlocks(pc.index, pc.index);
						field.blur();
					}
				}
				return;
			}
			if (TEXTY[prev.type]) {
				// Die Nahtstelle wird beim Rendern als echte DOM-Grenze markiert. Ein
				// Zahlenoffset ist prinzipiell falsch: <br>, Links und KaTeX-Chips haben
				// andere DOM-Längen als ihr sichtbarer bzw. gespeicherter Text.
				const boundary = { bid: prev.id, before: String(prev.text || ""), after: text };
				mutate(() => {
					prev.text = String(prev.text || "") + text;
					c.list.splice(c.index, 1);
				}, { anchorId: prev.id, boundary });
				if (!focusBoundary(host.querySelector("[data-caret-boundary]"))) focusBlock(prev.id, null);
				return;
			}
			// Vorgänger ist Struktur (Tabelle, Bild, Trennlinie …)
			if (!text.trim()) {
				// Leerer Absatz nach einem Strukturblock: den Leerblock entfernen und
				// dann in den letzten editierbaren Teil des Vorgängerblocks springen.
				// Notion löscht Tabellen/Code/Toggle/Callout hier NICHT als Ganzes.
				mutate(() => { c.list.splice(c.index, 1); });
				if (prev.type !== "divider" && prev.type !== "image" && prev.type !== "file" && prev.type !== "math" && prev.type !== "heft") {
					focusNeighbor(prev, -1);
					return;
				}
				selectTopOf(prev);
			} else if (prev.type === "divider") {
				if (selectTopOf(prev)) field.blur();
			} else {
				if (prev.type !== "image" && prev.type !== "file" && prev.type !== "math" && prev.type !== "heft") {
					focusNeighbor(prev, -1);
					return;
				}
				if (selectTopOf(prev)) field.blur();
			}
			return;
		}

		if (e.key === "Delete" && atEnd) {
			const next = c.list[c.index + 1];
			if (!next) return;
			e.preventDefault();
			if (TEXTY[next.type]) {
				mutate(() => {
					b.text = text + String(next.text || "");
					c.list.splice(c.index + 1, 1);
				});
				focusBlock(b.id, off);
			} else {
				if (selectTopOf(next)) field.blur();
			}
			return;
		}

		// ↑/↓ an Blockgrenzen: in Nachbarblock wechseln (Browser bleibt sonst hängen)
		if ((e.key === "ArrowUp" || e.key === "ArrowDown") && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
			const d = e.key === "ArrowUp" ? -1 : 1;
			const edge = d < 0 ? off === 0 : atEnd;
			if (!edge) return;
			const neighbor = c.list[c.index + d];
			if (neighbor) {
				e.preventDefault();
				focusNeighbor(neighbor, d);
			}
		}
	}

	// Fokus sinnvoll in einen Nachbarblock setzen (auch Struktur-Blöcke).
	// Gibt true zurück, wenn Fokus/Selektion gesetzt wurde (auch bei Blockauswahl).
	function focusNeighbor(nb, d) {
		if (!nb) return false;
		if (TEXTY[nb.type]) { focusBlock(nb.id, d < 0 ? null : 0); return true; }
		if (nb.type === "toggle") {
			if (d < 0 && nb.open && nb.children && nb.children.length) {
				return focusNeighbor(nb.children[nb.children.length - 1], d);
			}
			focusBlock(nb.id, d < 0 ? null : 0, "summary");
			return true;
		}
		if (nb.type === "code") { focusBlock(nb.id, d < 0 ? null : 0, "code"); return true; }
		if (nb.type === "table" && nb.rows && nb.rows.length) {
			const ri = d < 0 ? nb.rows.length - 1 : 0;
			const ci = d < 0 ? nb.rows[ri].length - 1 : 0;
			focusBlock(nb.id, null, "cell", nb.id + ":" + ri + ":" + ci);
			return true;
		}
		if (nb.type === "callout" && nb.children && nb.children.length) {
			return focusNeighbor(d < 0 ? nb.children[nb.children.length - 1] : nb.children[0], d);
		}
		if (nb.type === "columns" && nb.columns && nb.columns.length) {
			const cols = d < 0 ? [...nb.columns].reverse() : nb.columns;
			const col = cols.find((c) => c && c.length);
			if (col) return focusNeighbor(d < 0 ? col[col.length - 1] : col[0], d);
		}
		// Bild/Divider/Math/Heft (oder leerer Container): Top-Level-Block selektieren
		return selectTopOf(nb);
	}

	// Tabellen: Tab = nächste Zelle (letzte Zelle → neue Zeile), Shift+Tab = zurück,
	// Enter = Zelle darunter (letzte Zeile → neue Zeile), Backspace in leerer
	// Tabelle löscht sie NICHT versehentlich — nur über Blockauswahl/Menü (wie Notion).
	function handleTableKeys(e, field) {
		const [bid, riS, ciS] = field.dataset.bcell.split(":");
		const ri = +riS, ci = +ciS;
		const b = findBlock(bid);
		if (!b || !b.rows) return false;
		const lastRow = b.rows.length - 1, lastCol = b.rows[0].length - 1;

		if (e.key === "Tab") {
			e.preventDefault();
			let nr = ri, nc = ci + (e.shiftKey ? -1 : 1);
			if (nc > lastCol) { nc = 0; nr++; }
			if (nc < 0) { nc = lastCol; nr--; }
			if (nr < 0) return true;
			if (nr > lastRow) {
				mutate(() => { b.rows.push(b.rows[0].map(() => "")); });
			}
			focusBlock(bid, null, "cell", bid + ":" + nr + ":" + nc);
			return true;
		}
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			if (ri >= lastRow) mutate(() => { b.rows.push(b.rows[0].map(() => "")); });
			focusBlock(bid, null, "cell", bid + ":" + (ri + 1) + ":" + ci);
			return true;
		}
		if (e.key === "Backspace") {
			const caret = caretInfo();
			const empty = !(field.textContent || "").length;
			if (empty && caret && caret.offset === 0) {
				e.preventDefault();
				// Leere letzte Zeile per Backspace in Zelle 0 entfernen (Komfort)
				if (ci === 0 && ri === lastRow && ri > 1 && b.rows[ri].every((x) => !String(x).trim())) {
					mutate(() => { b.rows.pop(); });
					focusBlock(bid, null, "cell", bid + ":" + (ri - 1) + ":" + lastCol);
				} else if (ci > 0) {
					focusBlock(bid, null, "cell", bid + ":" + ri + ":" + (ci - 1));
				} else if (ri > 0) {
					focusBlock(bid, null, "cell", bid + ":" + (ri - 1) + ":" + lastCol);
				}
				return true;
			}
			return false;
		}
		if (e.key === "ArrowUp" || e.key === "ArrowDown") {
			const d = e.key === "ArrowUp" ? -1 : 1;
			const nr = ri + d;
			if (nr >= 0 && nr <= lastRow) {
				e.preventDefault();
				focusBlock(bid, null, "cell", bid + ":" + nr + ":" + ci);
				return true;
			}
			// Tabelle verlassen
			const c = findContext(bid);
			const neighbor = c && c.list[c.index + d];
			if (neighbor) { e.preventDefault(); focusNeighbor(neighbor, d); return true; }
		}
		return false;
	}

	// Codeblock: Tab = 2 Leerzeichen, Enter = normaler Umbruch (Browser),
	// Backspace am Anfang eines LEEREN Codeblocks → zurück zu Text.
	function handleCodeKeys(e, field) {
		const bid = field.dataset.bcode;
		if (e.key === "Tab") {
			e.preventDefault();
			document.execCommand("insertText", false, "  ");
			return true;
		}
		if (e.key === "Backspace") {
			const b = findBlock(bid);
			const caret = caretInfo();
			if (b && caret && caret.offset === 0 && !String(b.text || "").length) {
				e.preventDefault();
				mutate(() => { turnInto(b, "p"); });
				focusBlock(bid, 0);
				return true;
			}
		}
		if (e.key === "ArrowDown" || e.key === "ArrowUp") {
			const b = findBlock(bid);
			const caret = caretInfo();
			const text = String(b && b.text || "");
			const d = e.key === "ArrowUp" ? -1 : 1;
			const edge = d < 0 ? caret && caret.offset === 0 : caret && caret.offset >= text.length;
			if (edge) {
				const c = findContext(bid);
				const neighbor = c && c.list[c.index + d];
				if (neighbor) { e.preventDefault(); focusNeighbor(neighbor, d); return true; }
				if (!neighbor && d > 0 && c && !c.parent) {
					// Unter dem letzten Codeblock einen Absatz anlegen (sonst käme man nie raus)
					e.preventDefault();
					mutate(() => { const nb = newBlock("p"); blocks.push(nb); focusBlock(nb.id, 0); });
					return true;
				}
			}
		}
		return false;
	}

	// Tasten im Blockauswahl-Modus (kein Textfokus): Pfeile, Shift+Pfeile,
	// Enter = Bearbeiten, Backspace/Entf = löschen, Strg+D = duplizieren, Esc = aufheben.
	function handleSelectionKeys(e) {
		if (e.key === "Escape") { e.preventDefault(); clearSelection(); return true; }
		if (e.key === "Backspace" || e.key === "Delete") { e.preventDefault(); mutateDeleteSelection(e.key); return true; }
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
			const md = serializeList(blocks.slice(selRange.from, selRange.to + 1));
			// In einigen WebView-Umgebungen ist navigator.clipboard zwar vorhanden,
			// writeText() wird aber teilweise trotzdem mit NotAllowedError abgelehnt.
			// execCommand muss deshalb zuerst und synchron im Tastatur-Event laufen;
			// nur falls das nicht geht, probieren wir die moderne Clipboard-API.
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
			if (copied) {
				U.toast("Kopiert");
			} else if (navigator.clipboard && navigator.clipboard.writeText) {
				navigator.clipboard.writeText(md).then(
					() => U.toast("Kopiert"),
					() => U.toast("Kopieren fehlgeschlagen", "error")
				);
			} else {
				U.toast("Kopieren fehlgeschlagen", "error");
			}
			return true;
		}
		if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "x") {
			e.preventDefault();
			const md = serializeList(blocks.slice(selRange.from, selRange.to + 1));
			const ta = document.createElement("textarea");
			ta.value = md;
			ta.setAttribute("readonly", "");
			ta.style.position = "fixed";
			ta.style.left = "-9999px";
			ta.style.top = "0";
			document.body.appendChild(ta);
			ta.select();
			let copied = false;
			try { copied = document.execCommand("copy"); } catch { /* Fallback */ }
			ta.remove();
			if (!copied && navigator.clipboard && navigator.clipboard.writeText) {
				navigator.clipboard.writeText(md);
			}
			mutateDeleteSelection("Delete");
			return true;
		}
		if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
			e.preventDefault();
			const { from, to } = selRange;
			mutate(() => {
				const copies = blocks.slice(from, to + 1).map((b) => cloneBlock(JSON.parse(JSON.stringify(b))));
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
	function mutateDeleteSelection(key) { deleteSelectedBlocks(key); }

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
			if (composing) return;
			const field = e.target.closest && e.target.closest("[data-btext],[data-bcell],[data-bsummary],[data-bcode]");
			if (!field) return;
			checkpoint();
			syncFieldToModel(field);
			handleLiveTriggers(field, e);
			save();
		});

		host.addEventListener("keydown", onKeydown);

		// Fokusverlust: Codeblöcke neu highlighten, Tipp-History festschreiben
		host.addEventListener("focusout", (e) => {
			const code = e.target.closest && e.target.closest("[data-bcode]");
			if (code) setTimeout(() => rehighlight(code.dataset.bcode), 0);
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
			const plus = t.closest && t.closest("[data-bplus]");
			if (plus) {
				const c = findContext(plus.dataset.bplus);
				if (c) {
					mutate(() => {
						const nb = newBlock("p");
						nb.text = "/";
						c.list.splice(c.index + 1, 0, nb);
						focusBlock(nb.id, 1);
						openSlash(nb.id, "");
					});
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

			// FIX: contenteditable folgt Klicks auf <a> NIE von selbst — verlinkte Dateien
			// und URLs wirkten deshalb „tot“. Interne #seiten-Links navigieren in der App,
			// alles andere öffnet extern in einem neuen Tab.
			const a = t.closest && t.closest("a[href]");
			if (a && host.contains(a)) {
				e.preventDefault();
				const href = a.getAttribute("href") || "";
				if (href.startsWith("#")) {
					const pid = href.slice(1);
					if (S.pages[pid]) STATE.dispatch("navigate", { pageId: pid });
					return;
				}
				window.open(href, "_blank", "noopener");
				return;
			}

			// Klick auf den leeren Bereich unter dem letzten Block → neuer Absatz
			if (t.dataset && t.dataset.btail != null) {
				const last = blocks[blocks.length - 1];
				if (last && TEXTY[last.type] && !String(last.text || "").trim()) {
					focusBlock(last.id, 0);
				} else {
					mutate(() => {
						const nb = newBlock("p");
						blocks.push(nb);
						focusBlock(nb.id, 0);
					});
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
			if (e.button !== 0) return;
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
				for (const f of e.dataTransfer.files) {
					await insertFileBlock(f, over && over.dataset.blk);
				}
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
					mutate(() => {
						c.list.splice(c.index + 1, 0, ...pasted);
						if (!String(c.block.text || "").trim() && c.block.type === "p") c.list.splice(c.index, 1);
					});
					const last = pasted[pasted.length - 1];
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
				if (c) mutate(() => { c.list.splice(c.index + 1, 0, cloneBlock(JSON.parse(JSON.stringify(c.block)))); });
				return;
			}
			const cp = t.closest && t.closest("[data-bcopy]");
			if (cp) {
				const b = findBlock(cp.dataset.bcopy);
				closeMenus();
				if (b) { navigator.clipboard.writeText(serializeBlock(b)); U.toast("Als Markdown kopiert"); }
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
			if (mod && host && document.body.contains(host)) {
				const ae = document.activeElement;
				const fremdesFeld = ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || (ae.isContentEditable && !host.contains(ae)));
				if (!fremdesFeld && !(ae && host.contains(ae))) {
					const k = (e.key || "").toLowerCase();
					if (k === "z" && !e.shiftKey) { e.preventDefault(); undoRedo(false); return; }
					if (k === "y" || (k === "z" && e.shiftKey)) { e.preventDefault(); undoRedo(true); return; }
				}
			}
		});
	}

	// ---------- Styles für Datei-/Medienblöcke (einmalig injiziert, wie notebooklm.js) ----------
	function injectStyles() {
		if (styleInjected) return;
		styleInjected = true;
		const st = document.createElement("style");
		st.textContent = [
			".blk-file{margin:6px 0;max-width:100%}",
			".blk-media{display:block;max-width:100%;border-radius:8px}",
			"video.blk-media{width:100%;max-height:480px;background:#000}",
			"audio.blk-media{width:100%;margin-top:6px}",
			"iframe.blk-pdfframe{width:100%;height:520px;border:1px solid rgba(128,128,128,.35);background:#fff}",
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
		const externallyChanged = !pageChanged && (pg.content || "") !== lastSaved && !histPending;
		host = el;
		host.classList.add("block-editor");
		injectStyles();
		if (pageChanged || externallyChanged || !blocks.length) {
			if (pageChanged) { clearSelection(); closeMenus(); touchHistoryPage(pid); }
			pageId = pid;
			blocks = parse(pg.content || "");
			bustCtxIdx(); // frisch geparste Blockobjekte
			lastSaved = pg.content || "";
			histState = snapshotJson();
			histPending = false;
		}
		render();
		wire();
		wireGlobal();
	}

	return { mount, parse, serialize, undoRedo, undo: () => undoRedo(false), redo: () => undoRedo(true) };
})();
