"use strict";

import { S } from "./state.js";
import { U } from "./util.js";
import { inlineMathParts } from "./editor-menus.js";

// ---------- Inline: Markdown → Rich-HTML → Markdown (verlustfreier Roundtrip) ----------
const LT = String.fromCharCode(60);
const tag = (name, inner, attrs) => LT + name + (attrs || "") + ">" + inner + LT + "/" + name + ">";
const esc = (t) => U.esc(String(t ?? ""));

// Rendert den Inline-Markdown eines Textblocks als echten Rich-Text.
// Inline-Formeln ($…$ und \(…\)) werden zu nicht-editierbaren Chips mit data-md —
// KaTeX-DOM darf nie Teil des editierbaren Textflusses werden.
export function inlineHtml(text) {
	// Wiki-Links, Formeln und Inline-Code werden nach dem Umwandeln als Platzhalter
	// geparkt: Sonst griffen die *-, ~~- und ==-Regeln in ihren Inhalt und ihre
	// Attribute (aus $a * b * c$ wurde im data-md „$a <em> b </em> c$“ gespeichert).
	const stash = [];
	const hold = (html) => "" + (stash.push(html) - 1) + "";
	const restore = (s) => s.replace(/(\d+)/g, (_, i) => restore(stash[+i]));
	return restore(esc(text)
		// Ausgeschriebene Wiki-Links bleiben als [[Titel]] gespeichert, werden im
		// Editor aber wie die vom Link-Menü erzeugte Markdown-Variante anklickbar.
		// Nur ein exakter, aktiver Seitentitel wird verlinkt; unbekannte Titel
		// bleiben normaler Text und können weiter bearbeitet werden.
		.replace(/\[\[([^\]\n]+)\]\]/g, (md, label) => {
			const page = Object.values(S?.pages || {}).find((p) => p && !p.trashed && esc(p.title || "Ohne Titel") === label);
			return page ? hold(tag("a", label, ' href="#' + esc(page.id) + '" data-md="' + md + '"')) : md;
		})
		// data-key enthält die Formel: ändert sie sich, ersetzt U.morph den Chip (frisches
		// KaTeX); bleibt sie gleich, bleibt der gerenderte Chip unangetastet stehen.
		// Formeln matchen nur echte Delimiter; maskierte \$ bleiben reiner Text.
		.replace(/\\\((.+?)\\\)|(?<!\\)\$([^$\n]+?)(?<!\\)\$/g, (md, paren, dollar) => {
			const f = paren == null ? dollar : paren;
			return hold(LT + 'span class="blk-imath" contenteditable="false" data-key="im:' + f + '" data-md="' + md + '" title="Formel bearbeiten">' + f + LT + "/span>");
		})
		.replace(/\\(\$)/g, "$1")
		.replace(/\x60([^\x60]+)\x60/g, (_, v) => hold(tag("code", v)))
		.replace(/\{(bg-)?(gray|red|orange|yellow|green|blue|purple|pink)\}([\s\S]*?)\{\/\}/g,
			(_, bg, color, v) => tag("span", v, ' class="' + (bg ? "hl-" : "c-") + color + '"'))
		.replace(/==([^=\n]+)==/g, (_, v) => tag("mark", v))
		.replace(/\*\*\*([^*]+)\*\*\*/g, (_, v) => tag("strong", tag("em", v)))
		.replace(/\*\*([^*]+)\*\*/g, (_, v) => tag("strong", v))
		.replace(/~~([^~]+)~~/g, (_, v) => tag("s", v))
		.replace(/&lt;u&gt;([\s\S]*?)&lt;\/u&gt;/gi, (_, v) => tag("u", v))
		.replace(/(^|[^*])\*([^*\n]+)\*/g, (_, pre, v) => pre + tag("em", v))
		.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => tag("a", label, ' href="' + href + '"'))
		.replace(/\n/g, LT + "br>"));
}

// DOM eines editierbaren Feldes → Inline-Markdown (exakte Umkehrung von inlineHtml).
// Hinweis: \x60 = Backtick — als Hex-Escape geschrieben, damit diese Datei
// beim Spiegeln als Markdown-Codeblock nie kaputt-formatiert werden kann.
export function inlineMarkdown(node) {
	if (!node) return "";
	if (node.nodeType === 3 || (typeof Node !== "undefined" && node.nodeType === Node.TEXT_NODE)) return node.nodeValue || "";
	if (node.nodeType !== 1 && (typeof Node !== "undefined" && node.nodeType !== Node.ELEMENT_NODE)) return "";
	if (node.dataset && node.dataset.md) return node.dataset.md; // Formel-Chip
	const t = (node.tagName || "").toLowerCase();
	const inner = [...(node.childNodes || [])].map(inlineMarkdown).join("");
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
export const INVISIBLES_RE = new RegExp("[" + String.fromCharCode(8203) + String.fromCharCode(8204) + String.fromCharCode(65279) + "]", "g");

export function mdFromEditable(el) {
	if (!el) return "";
	return [...(el.childNodes || [])].map(inlineMarkdown).join("").replace(INVISIBLES_RE, "").replace(/\n+$/, "");
}

// Feldinhalt am Caret in zwei Markdown-Hälften teilen. Der Schnitt läuft über
// DOM-Ranges (sichtbare Koordinaten) — Formatierung, Chips und Links bleiben
// auf beiden Seiten korrekt, egal wie stark Markdown- und Sichttext abweichen.
export function splitFieldAtCaret(field, fallbackText) {
	if (typeof window !== "undefined" && typeof document !== "undefined") {
		const sel = window.getSelection();
		if (sel && sel.rangeCount && field && field.contains && field.contains(sel.anchorNode)) {
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
	}
	const t = String(fallbackText || "");
	return { vor: t, nach: "" };
}

// Doppelte Render-Versuche vermeiden, solange die gemeinsam geladene KaTeX-Engine
// noch unterwegs ist. WeakSet räumt entfernte Formel-Elemente automatisch auf.
const mathHydrating = new WeakSet();

// Gemeinsamer Direkt-Renderer für Formelblöcke und Inline-Chips. Wichtig: Ein
// Element gilt erst nach erfolgreichem Laden UND Rendern als hydriert.
export async function hydrateKatex(el, formula, displayMode) {
	if (!el || el.dataset?.hydrated || mathHydrating.has(el) || !formula) return;
	mathHydrating.add(el);
	try {
		if (!(await U.ensureKatex())) return;
		// Während des Ladens kann die Seite gewechselt oder die Formel ersetzt worden sein.
		const host = el.closest ? (el.closest(".block-editor") || (typeof document !== "undefined" ? document.getElementById("blockEditor") : null)) : null;
		if (!el.isConnected || !host || !host.contains(el)) return;
		const k = typeof katex !== "undefined" ? katex : (typeof window !== "undefined" ? window.katex : null);
		if (k) {
			k.render(formula, el, { throwOnError: false, displayMode: !!displayMode });
			el.dataset.hydrated = "1";
			el.dataset.owned = "1";
		}
	} catch { /* Roh-LaTeX bleibt sichtbar; ein späterer Render darf erneut versuchen */ }
	finally { mathHydrating.delete(el); }
}

// Formel-Chips nach dem Rendern mit KaTeX hübsch machen (data-md bleibt Quelle).
export function hydrateInlineMath(root) {
	const container = root || (typeof document !== "undefined" ? (document.getElementById("blockEditor") || document.querySelector(".block-editor")) : null);
	if (!container || !container.querySelectorAll) return;
	container.querySelectorAll(".blk-imath").forEach((el) => {
		// data-md enthält "$…$" oder "\\(…\\)" — Delimiter entfernen und direkt rendern
		// (renderMathInElement findet im Chip-Text keine Delimiter mehr).
		hydrateKatex(el, inlineMathParts(el.dataset.md).formula, false);
	});
}

// ---------- Fokus / Caret ----------
// Sichtbare Zeichen zählen wie setCaret: Formel-Chips (contenteditable="false")
// zählen nicht. Range.toString() zählte das KaTeX-Innenleben mit — nach Tab,
// Umwandeln oder Strg+Z stand der Caret dann um diese Länge zu weit rechts.
export function visibleLength(node) {
	if (!node) return 0;
	let n = 0;
	for (const ch of node.childNodes || []) {
		if (ch.nodeType === 3 || (typeof Node !== "undefined" && ch.nodeType === Node.TEXT_NODE)) n += (ch.nodeValue || "").length;
		else if ((ch.nodeType === 1 || (typeof Node !== "undefined" && ch.nodeType === Node.ELEMENT_NODE)) && ch.getAttribute?.("contenteditable") !== "false") n += visibleLength(ch);
	}
	return n;
}

export function caretInfo(hostEl) {
	if (typeof window === "undefined") return null;
	const sel = window.getSelection();
	const host = hostEl || (typeof document !== "undefined" ? (document.getElementById("blockEditor") || document.querySelector(".block-editor")) : null);
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
		offset: visibleLength(range.cloneContents()),
	};
}

function scrollRoot(field) {
	const host = (field && field.closest && field.closest(".block-editor")) || (typeof document !== "undefined" ? document.getElementById("blockEditor") : null);
	return host && (host.closest(".page-scroll") || host);
}

export function keepCaretVisible(field) {
	if (typeof window === "undefined") return;
	const root = scrollRoot(field);
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

// Caret an Zeichen-Offset in einem contenteditable-Feld setzen.
export function setCaret(field, offset) {
	if (!field) return;
	// Der Browser darf beim Fokus nie irgendeinen Vorfahren scrollen. Ein
	// scrollIntoView() ist hier absichtlich verboten: selbst mit „nearest“ kann
	// Chromium bei einem frisch aufgebauten contenteditable den äußeren
	// Dokument-Scroller versetzen.
	if (typeof field.focus === "function") field.focus({ preventScroll: true });
	if (typeof window === "undefined" || typeof document === "undefined") return;
	const sel = window.getSelection();
	if (!sel) return;
	if (offset == null) offset = Infinity;
	let remaining = offset, gesetzt = false;
	const nodeFilter = typeof NodeFilter !== "undefined" ? NodeFilter : { SHOW_TEXT: 4, FILTER_REJECT: 2, FILTER_ACCEPT: 1 };
	const walker = document.createTreeWalker(field, nodeFilter.SHOW_TEXT, {
		acceptNode: (n) => {
			const p = n.parentElement;
			if (p && p.closest && p.closest('[contenteditable="false"]')) return nodeFilter.FILTER_REJECT;
			return nodeFilter.FILTER_ACCEPT;
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
	keepCaretVisible(field);
}
