"use strict";

// Tasten in Text-, Tabellen- und Codeblöcken (Enter, Backspace, Entf, Tab, Pfeile) — exakt
// wie Notion. Aus editor.js herausgelöst; der Editor reicht Modell- und Fokus-Funktionen
// über ctx herein, sein Zustand (Host, Blockliste, Auswahl) bleibt dort.

import { U } from "./util.js";
import { LISTY } from "./editor-markdown.js";
import { TEXTY, closeMenus } from "./editor-menus.js";
import { inlineHtml, splitFieldAtCaret, hydrateInlineMath, visibleLength, caretInfo } from "./editor-inline.js";

export function createBlockKeys(ctx) {
	const { mutate, focusBlock, findBlock, findContext, turnInto, newBlock, focusBoundary, selectTopOf, selectBlockAt } = ctx;
	const uid = () => U.uid();

	// Enter/Backspace/Delete/Tab in normalen Textblöcken — exakt wie Notion.
	function handleTextBlockKeys(e, field, c, caret) {
		const b = c.block;
		const text = String(b.text || "");
		const off = caret ? caret.offset : text.length;
		const atStart = off === 0 && String(window.getSelection()).length === 0;
		const atEnd = off >= visibleLength(field);

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
			focusBlock(b.id, off);
			return;
		}

		if (e.key === "Backspace" && atStart) {
			e.preventDefault();
			const prev = c.list[c.index - 1];
			// Erster Block der obersten Liste: bewusst nichts tun (wie Notion).
			// Der frühere Umbau (Liste/Überschrift → Text) erzeugte hier korrupte
			// Duplikate mit hängender Checkbox und Caret-Sprung nach unten.
			// Verschachtelte Listen (c.parent) behalten ihr Verhalten unten.
			if (!prev && !c.parent) return;
			// Stufe 1: Listen mit Text verschmelzen direkt mit dem Vorgänger (wie Notion);
			// leere Listen rücken aus bzw. werden zu Text. Überschriften werden zu Text.
			if (LISTY[b.type]) {
				if ((b.indent || 0) > 0) {
					mutate(() => { b.indent--; }, { soft: true });
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
						selectBlockAt(pc.index);
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
				if (!focusBoundary(ctx.getHost().querySelector("[data-caret-boundary]"))) focusBlock(prev.id, null);
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

		if (e.key === "Delete" && atEnd && !String(window.getSelection())) {
			const next = c.list[c.index + 1];
			if (!next) return;
			e.preventDefault();
			if (TEXTY[next.type]) {
				const nextText = String(next.text || "");
				mutate(() => {
					b.text = text + nextText;
					c.list.splice(c.index + 1, 1);
				});
				// Das fokussierte Feld lässt der DOM-Abgleich unangetastet — ohne
				// Neumalen fehlte der angehängte Text, und das nächste Tippen schrieb
				// den alten Feldinhalt zurück ins Modell (Text des Folgeblocks weg).
				field.innerHTML = inlineHtml(text) + '<span data-caret-boundary="1"></span>' + inlineHtml(nextText);
				hydrateInlineMath(field);
				if (!focusBoundary(field.querySelector("[data-caret-boundary]"))) focusBlock(b.id, off);
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
					const nb = newBlock("p");
					mutate(() => { ctx.getBlocks().push(nb); });
					focusBlock(nb.id, 0);
					return true;
				}
			}
		}
		return false;
	}

	return { handleTextBlockKeys, focusNeighbor, handleTableKeys, handleCodeKeys };
}
