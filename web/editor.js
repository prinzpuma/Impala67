"use strict";
// editor.js — Notion-artiger Block-Editor über Markdown (Live-Preview-Hybrid).
// Grundprinzip: Markdown bleibt die EINZIGE Wahrheit. Event-Log, Verlauf, Diffs,
// KI-Tools, Notion-Import und Drive-Sync arbeiten unverändert auf pg.content.
// Die Seite wird in Blöcke zerlegt; der aktive Block wird als roher Markdown-
// Ausschnitt in einer Textarea bearbeitet, alle anderen Blöcke sind fertig
// gerendert (inkl. LaTeX + Code-Highlighting). Enter/Backspace/Pfeiltasten
// verhalten sich wie in Notion, ⠿-Handles verschieben Blöcke per Drag & Drop.
const EDITOR = (() => {
	let host = null;      // Container (#blockEditor), wird bei jedem renderMain neu gemountet
	let pageId = null;    // aktuell bearbeitete Seite
	let blocks = [];      // geparste Blockliste
	let activeId = null;  // Block im Bearbeiten-Modus (Textarea)
	let dragBid = null;   // Block, der gerade per ⠿ gezogen wird
	let slash = null;     // { items, index } solange das Slash-Menü offen ist
	let selAll = false;   // true = "alles ausgewählt" (Strg+A über alle Blöcke)

	const LISTY = { bullet: 1, number: 1, todo: 1 };
	const MULTILINE = { code: 1, table: 1, toggle: 1, columns: 1, quote: 1, callout: 1 };
	const COLORS = ["gray", "red", "orange", "yellow", "green", "blue", "purple", "pink"];

	// Slash-Menü-Einträge: k = Suchbegriffe, ins = eingefügtes Markdown,
	// caret = Cursorposition nach dem Einfügen (Standard: ans Ende)
	const SLASH = [
		{ k: "text absatz paragraph", label: "Text", ins: "", type: "p" },
		{ k: "h1 überschrift heading gross", label: "H1 · Überschrift 1", ins: "# ", type: "h1" },
		{ k: "h2 überschrift heading", label: "H2 · Überschrift 2", ins: "## ", type: "h2" },
		{ k: "h3 überschrift heading klein", label: "H3 · Überschrift 3", ins: "### ", type: "h3" },
		{ k: "aufzählung liste bullet punkte", label: "• Aufzählungsliste", ins: "- ", type: "bullet" },
		{ k: "nummerierte liste zahlen", label: "1. Nummerierte Liste", ins: "1. ", type: "number" },
		{ k: "todo aufgabe checkbox haken", label: "☑ To-do-Liste", ins: "- [ ] ", type: "todo" },
		{ k: "toggle aufklappen details", label: "▸ Toggle-Block", ins: "<details><summary>Titel</summary>\nInhalt\n</details>", type: "toggle", caret: 18 },
		{ k: "zitat quote", label: "❝ Zitat", ins: "> ", type: "quote" },
		{ k: "callout hinweis box info farbe", label: "💡 Callout (Farbwort im Marker änderbar)", ins: "> [!blue] ", type: "callout" },
		{ k: "code programm quelltext", label: "⌨ Code-Block", ins: "```javascript\n\n```", type: "code", caret: 14 },
		{ k: "mermaid diagramm flowchart graph gantt", label: "⧐ Mermaid-Diagramm", ins: "```mermaid\ngraph TD\n\tA[Start] --> B[Ende]\n```", type: "code", caret: 11 },
		{ k: "trennlinie divider linie", label: "— Trennlinie", ins: "---", type: "divider" },
		{ k: "tabelle table", label: "▦ Tabelle", ins: "| Spalte 1 | Spalte 2 |\n| --- | --- |\n|   |   |", type: "table" },
		{ k: "spalten columns layout nebeneinander", label: "◫ 2 Spalten", ins: ":::columns\nLinke Spalte\n:::split\nRechte Spalte\n:::end", type: "columns" },
	];

	// ---------- Markdown → Blockliste ----------
	const indentLevel = (ws) => Math.floor(String(ws || "").replace(/\t/g, "  ").length / 2);

	function isSpecialStart(line) {
		const t = line.trim();
		return t.startsWith("```") || t === ":::columns" || t.startsWith("<details")
			|| t.startsWith("|") || /^-{3,}$/.test(t) || /^#{1,3}\s/.test(t) || t.startsWith(">")
			|| /^\s*[-*]\s/.test(line) || /^\s*\d+[.)]\s/.test(line);
	}

	function parse(md) {
		const lines = String(md ?? "").split("\n");
		const out = [];
		let i = 0;
		const push = (type, raw, extra) => out.push(Object.assign({ id: U.uid(), type, raw }, extra || {}));
		while (i < lines.length) {
			const line = lines[i];
			const t = line.trim();
			if (t === "") { i++; continue; }
			if (t.startsWith("```")) {
				let j = i + 1;
				while (j < lines.length && !lines[j].trim().startsWith("```")) j++;
				push("code", lines.slice(i, Math.min(j + 1, lines.length)).join("\n"));
				i = j + 1; continue;
			}
			if (t === ":::columns") {
				let j = i + 1;
				while (j < lines.length && lines[j].trim() !== ":::end") j++;
				push("columns", lines.slice(i, Math.min(j + 1, lines.length)).join("\n"));
				i = j + 1; continue;
			}
			if (t.startsWith("<details")) {
				let j = i;
				while (j < lines.length && !lines[j].includes("</details>")) j++;
				push("toggle", lines.slice(i, Math.min(j + 1, lines.length)).join("\n"));
				i = j + 1; continue;
			}
			if (t.startsWith("|")) {
				let j = i;
				while (j < lines.length && lines[j].trim().startsWith("|")) j++;
				push("table", lines.slice(i, j).join("\n"));
				i = j; continue;
			}
			if (/^-{3,}$/.test(t)) { push("divider", "---"); i++; continue; }
			let m = t.match(/^(#{1,3})\s+/);
			if (m) { push("h" + m[1].length, t); i++; continue; }
			if (t.startsWith(">")) {
				let j = i;
				while (j < lines.length && lines[j].trim().startsWith(">")) j++;
				const seg = lines.slice(i, j).join("\n");
				push(/^>\s*\[!([a-z]+)\]/.test(t) ? "callout" : "quote", seg);
				i = j; continue;
			}
			m = line.match(/^(\s*)- \[( |x)\]/);
			if (m) { push("todo", line, { indent: indentLevel(m[1]), checked: m[2] === "x" }); i++; continue; }
			m = line.match(/^(\s*)[-*]\s+/);
			if (m) { push("bullet", line, { indent: indentLevel(m[1]) }); i++; continue; }
			m = line.match(/^(\s*)\d+[.)]\s+/);
			if (m) { push("number", line, { indent: indentLevel(m[1]) }); i++; continue; }
			let j = i;
			while (j < lines.length && lines[j].trim() !== "" && !isSpecialStart(lines[j])) j++;
			push("p", lines.slice(i, j).join("\n"));
			i = Math.max(j, i + 1);
		}
		return out;
	}

	// Blockliste ��� Markdown: Listenpunkte direkt untereinander, sonst Leerzeile dazwischen
	function serialize(list) {
		let out = "";
		list.forEach((b, idx) => {
			if (idx > 0) out += (LISTY[b.type] && LISTY[list[idx - 1].type]) ? "\n" : "\n\n";
			out += b.raw;
		});
		return out;
	}

	// ---------- Hilfen ----------
	const newBlock = (type, raw, extra) => Object.assign({ id: U.uid(), type, raw }, extra || {});
	const indentOf = (b) => b.indent || 0;
	const listText = (b) => b.raw.replace(/^\s*(- \[( |x)\]\s?|[-*]\s+|\d+[.)]\s+)/, "");

	function markerOf(b) {
		const ind = "  ".repeat(indentOf(b));
		if (b.type === "todo") return ind + "- [ ] ";
		if (b.type === "bullet") return ind + "- ";
		if (b.type === "number") return ind + "1. ";
		return "";
	}

	function splitColumns(raw) {
		const inner = String(raw).replace(/^:::columns\n?/, "").replace(/\n?:::end$/, "");
		return inner.split(/\n:::split\n/);
	}

	// ---------- Ansicht (gerenderte Blöcke) ----------
	function viewHtml(b, list, idx) {
		switch (b.type) {
			case "h1": case "h2": case "h3": {
				const lvl = b.type[1];
				return "<h" + lvl + ' class="blk-h">' + U.mdInline(b.raw.replace(/^#{1,3}\s+/, "")) + "</h" + lvl + ">";
			}
			case "divider": return '<hr class="blk-hr">';
			case "todo":
				return '<div class="blk-li" style="padding-left:' + indentOf(b) * 24 + 'px">' +
					'<input type="checkbox" class="blk-check"' + (b.checked ? " checked" : "") + ">" +
					'<span class="blk-litext' + (b.checked ? " done" : "") + '">' + U.mdInline(listText(b)) + "</span></div>";
			case "bullet":
				return '<div class="blk-li" style="padding-left:' + indentOf(b) * 24 + 'px"><span class="blk-marker">•</span>' +
					'<span class="blk-litext">' + U.mdInline(listText(b)) + "</span></div>";
			case "number": {
				// Nummer ermitteln: vorangehende nummerierte Punkte gleicher Einrückung zählen
				let n = 1;
				for (let k = idx - 1; k >= 0; k--) {
					const prev = list[k];
					if (prev.type === "number" && indentOf(prev) === indentOf(b)) n++;
					else if (LISTY[prev.type] && indentOf(prev) > indentOf(b)) continue;
					else break;
				}
				return '<div class="blk-li" style="padding-left:' + indentOf(b) * 24 + 'px"><span class="blk-marker">' + n + ".</span>" +
					'<span class="blk-litext">' + U.mdInline(listText(b)) + "</span></div>";
			}
			case "callout": {
				const m = b.raw.match(/^>\s*\[!([a-z]+)\]\s?([\s\S]*)$/);
				const color = m ? m[1] : "gray";
				const body = m ? m[2].replace(/\n>\s?/g, "\n") : b.raw;
				return '<div class="blk-callout co-' + U.esc(color) + '"><div class="md">' + U.md(body) + "</div></div>";
			}
			case "columns":
				return '<div class="blk-cols">' + splitColumns(b.raw).map((c) =>
					'<div class="blk-col md">' + U.md(c) + "</div>").join("") + "</div>";
			default:
				// p, quote, code, table, toggle: komplett über U.md rendern
				return '<div class="md blk-p">' + U.md(b.raw) + "</div>";
		}
	}

	const editHtml = (b) => '<textarea class="blk-input" rows="1" spellcheck="false" placeholder="Schreib etwas — „/“ für Befehle…">' + U.esc(b.raw) + "</textarea>";

	function autoGrow(ta) { ta.style.height = "auto"; ta.style.height = ta.scrollHeight + "px"; }

	// ---------- Zeichnen ----------
	function draw(focus) {
		if (!host) return;
		host.innerHTML = blocks.map((b, idx) => {
			const isNew = S.highlightedPageId === pageId && S.highlightedDiff && S.highlightedDiff.some((d) => d.type === "add" && d.text.trim() === b.raw.trim());
			return '<div class="blk' + (isNew ? " highlight-add" : "") + '" data-bid="' + b.id + '">' +
				'<div class="blk-gutter">' +
					'<button class="blk-plus" data-plus="' + b.id + '" title="Block darunter einfügen">+</button>' +
					'<button class="blk-handle" draggable="true" data-handle="' + b.id + '" title="Ziehen zum Verschieben">⠿</button>' +
				"</div>" +
				'<div class="blk-body">' + (b.id === activeId ? editHtml(b) : viewHtml(b, blocks, idx)) + "</div>" +
			"</div>";
		}).join("") + '<div class="blk-tail"></div>';
		// LaTeX + Code-Highlighting nur in gerenderten (nicht aktiven) Blöcken
		host.querySelectorAll(".blk").forEach((el) => {
			if (el.dataset.bid !== activeId) { U.renderMath(el); U.highlightCode(el); }
		});
		// Lokal gespeicherte Bilder (![...](img:...)) nachladen
		if (typeof hydrateImages === "function") hydrateImages(host);
		if (activeId) {
			const ta = host.querySelector(".blk-input");
			if (ta) {
				autoGrow(ta);
				ta.focus();
				const pos = focus && focus.caret !== undefined ? focus.caret : ta.value.length;
				ta.selectionStart = ta.selectionEnd = Math.min(pos, ta.value.length);
			}
		}
		renderToolbar(null);
	}

	// ---------- Speichern (debounced, wie der alte Markdown-Editor) ----------
	async function save() {
		const pg = pageId ? S.pages[pageId] : null;
		if (!pg) return;
		const md = serialize(blocks);
		if (md !== pg.content) {
			pushUndo(pg.id, pg.content);
			await STATE.dispatch("pageUpdate", { id: pg.id, patch: { content: md } });
			if (typeof RAG !== "undefined") RAG.queuePage(pg.id);
		}
	}
	const saveSoon = U.debounce(save, 700);

	// ---------- Undo/Redo über Blockgrenzen (Strg+Z / Strg+Shift+Z bzw. Strg+Y) ----------
	// Das native Textarea-Undo gilt nur im aktiven Block; diese Stapel sichern den
	// gesamten Seiteninhalt bei jeder Änderung (max. 100 Stände je Seite).
	const undoStacks = {};
	const redoStacks = {};
	function pushUndo(pid, md) {
		const st = undoStacks[pid] || (undoStacks[pid] = []);
		if (st[st.length - 1] === md) return;
		st.push(md);
		if (st.length > 100) st.shift();
		redoStacks[pid] = [];
	}
	async function undoRedo(redo) {
		const pg = pageId ? S.pages[pageId] : null;
		if (!pg) return;
		const from = redo ? (redoStacks[pageId] || []) : (undoStacks[pageId] || []);
		if (!from.length) return;
		const to = redo ? (undoStacks[pageId] || (undoStacks[pageId] = [])) : (redoStacks[pageId] || (redoStacks[pageId] = []));
		to.push(pg.content);
		const md = from.pop();
		activeId = null;
		closeSlash();
		await STATE.dispatch("pageUpdate", { id: pg.id, patch: { content: md } });
		blocks = parse(md);
		draw();
	}

	// Aktiven Block festschreiben: der bearbeitete Text kann mehrere Blöcke ergeben
	function commitActive() {
		if (!activeId) return;
		const ta = host ? host.querySelector(".blk-input") : null;
		const idx = blocks.findIndex((x) => x.id === activeId);
		activeId = null;
		closeSlash();
		if (idx === -1) return;
		const val = ta ? ta.value : blocks[idx].raw;
		if (!val.trim()) blocks[idx] = newBlock("p", "");
		else blocks.splice(idx, 1, ...parse(val));
		saveSoon();
	}

	function activate(bid, caret) {
		if (activeId && activeId !== bid) commitActive();
		activeId = bid;
		draw({ caret });
	}

	function commitAndActivate(idx2, caretMode) {
		const target = blocks[idx2];
		if (!target) return;
		const tid = target.id;
		commitActive();
		const t2 = blocks.find((x) => x.id === tid);
		if (!t2) return;
		activeId = tid;
		draw({ caret: caretMode === "end" ? t2.raw.length : 0 });
	}

	// ---------- Tipp-Verhalten (Enter/Backspace/Tab/Pfeile wie in Notion) ----------
	// Blocktyp live nachziehen, wenn der Nutzer selbst Marker tippt ("- ", "# ", "> ")
	function retype(b) {
		if (b.type === "code" || b.type === "table" || b.type === "toggle" || b.type === "columns") return;
		const raw = b.raw;
		let m;
		if ((m = raw.match(/^(\s*)- \[( |x)\]/))) { b.type = "todo"; b.indent = indentLevel(m[1]); b.checked = m[2] === "x"; }
		else if ((m = raw.match(/^(\s*)[-*]\s/))) { b.type = "bullet"; b.indent = indentLevel(m[1]); delete b.checked; }
		else if ((m = raw.match(/^(\s*)\d+[.)]\s/))) { b.type = "number"; b.indent = indentLevel(m[1]); delete b.checked; }
		else if ((m = raw.match(/^(#{1,3})\s/))) { b.type = "h" + m[1].length; delete b.indent; delete b.checked; }
		else if (/^>\s*\[!/.test(raw)) { b.type = "callout"; }
		else if (raw.startsWith(">")) { b.type = "quote"; }
		else { b.type = "p"; delete b.indent; delete b.checked; }
	}

	function onEnter(ta, b, e) {
		if (MULTILINE[b.type]) {
			if (b.type === "quote" || b.type === "callout") {
				// Enter setzt die Zitat-/Callout-Zeile fort ("> " wird automatisch vorangestellt)
				e.preventDefault();
				const s = ta.selectionStart;
				ta.value = ta.value.slice(0, s) + "\n> " + ta.value.slice(ta.selectionEnd);
				ta.selectionStart = ta.selectionEnd = s + 3;
				b.raw = ta.value;
				autoGrow(ta);
				saveSoon();
			}
			return; // Code/Tabelle/Toggle/Spalten: Enter = normale neue Zeile
		}
		e.preventDefault();
		const before = ta.value.slice(0, ta.selectionStart);
		const after = ta.value.slice(ta.selectionEnd);
		if (LISTY[b.type] && !listText(b).trim() && !after.trim()) {
			// Leeres Listenelement + Enter → zurück zu normalem Text (wie Notion)
			b.type = "p"; b.raw = ""; delete b.indent; delete b.checked;
			saveSoon();
			draw({ caret: 0 });
			return;
		}
		const idx = blocks.findIndex((x) => x.id === b.id);
		b.raw = before;
		const marker = LISTY[b.type] ? markerOf(b) : "";
		const nb = LISTY[b.type]
			? newBlock(b.type, marker + after, { indent: indentOf(b) })
			: newBlock("p", after);
		blocks.splice(idx + 1, 0, nb);
		activeId = nb.id;
		saveSoon();
		draw({ caret: marker.length });
	}

	function onBackspace(ta, b, e) {
		if (ta.selectionStart !== 0 || ta.selectionEnd !== 0) return;
		const idx = blocks.findIndex((x) => x.id === b.id);
		if (LISTY[b.type]) {
			// Erst ausrücken, dann Marker entfernen (→ normaler Absatz) — wie in Notion
			e.preventDefault();
			if (indentOf(b) > 0) { setIndent(b, ta, -1); return; }
			b.type = "p"; b.raw = listText(b); delete b.indent; delete b.checked;
			saveSoon();
			draw({ caret: 0 });
			return;
		}
		if (idx <= 0 || MULTILINE[b.type]) return;
		e.preventDefault();
		const prev = blocks[idx - 1];
		if (prev.type === "divider") { blocks.splice(idx - 1, 1); saveSoon(); draw({ caret: 0 }); return; }
		if (MULTILINE[prev.type] || LISTY[prev.type]) { commitAndActivate(idx - 1, "end"); return; }
		// Mit dem vorherigen Text-Block verschmelzen
		const caret = prev.raw.length;
		prev.raw += ta.value;
		blocks.splice(idx, 1);
		activeId = prev.id;
		saveSoon();
		draw({ caret });
	}

	function setIndent(b, ta, delta) {
		const cur = indentOf(b);
		const next = Math.max(0, Math.min(6, cur + delta));
		if (next === cur) return;
		const caret = Math.max(0, ta.selectionStart + (next - cur) * 2);
		b.indent = next;
		b.raw = "  ".repeat(next) + ta.value.replace(/^\s*/, "");
		saveSoon();
		draw({ caret });
	}

	function onArrow(ta, b, e) {
		const idx = blocks.findIndex((x) => x.id === b.id);
		if (e.key === "ArrowUp" && !ta.value.slice(0, ta.selectionStart).includes("\n")) {
			if (idx > 0) { e.preventDefault(); commitAndActivate(idx - 1, "end"); }
		} else if (e.key === "ArrowDown" && !ta.value.slice(ta.selectionEnd).includes("\n")) {
			if (idx < blocks.length - 1) { e.preventDefault(); commitAndActivate(idx + 1, 0); }
		}
	}

	// ---------- Slash-Menü ----------
	function openSlash(q) {
		const query = String(q || "").toLowerCase();
		const items = SLASH.filter((s2) => !query || s2.k.includes(query) || s2.label.toLowerCase().includes(query));
		slash = items.length ? { items, index: 0 } : null;
		drawSlash();
	}
	function closeSlash() { if (slash) { slash = null; drawSlash(); } }
	function drawSlash() {
		const menu0 = host ? host.querySelector(".slash-menu") : null;
		if (!slash) { if (menu0) menu0.remove(); return; }
		let menu = menu0;
		if (!menu) { menu = document.createElement("div"); menu.className = "slash-menu"; host.appendChild(menu); }
		menu.innerHTML = slash.items.map((s2, i) =>
			'<button class="slash-opt' + (i === slash.index ? " active" : "") + '" data-slash="' + i + '">' + s2.label + "</button>"
		).join("");
		const blkEl = host.querySelector('.blk[data-bid="' + activeId + '"]');
		if (blkEl) {
			const r = blkEl.getBoundingClientRect(), hr = host.getBoundingClientRect();
			menu.style.top = (r.bottom - hr.top + host.scrollTop + 4) + "px";
			menu.style.left = (r.left - hr.left + 46) + "px";
		}
	}
	function applySlash(i) {
		const item = slash && slash.items[i];
		const b = blocks.find((x) => x.id === activeId);
		slash = null;
		if (!item || !b) { drawSlash(); return; }
		b.raw = item.ins;
		b.type = item.type;
		delete b.indent; delete b.checked;
		saveSoon();
		if (item.type === "divider") {
			// Trennlinie direkt festschreiben und neuen Absatz darunter aktivieren
			const idx = blocks.findIndex((x) => x.id === b.id);
			const nb = newBlock("p", "");
			blocks.splice(idx + 1, 0, nb);
			activeId = nb.id;
			draw({ caret: 0 });
			return;
		}
		draw({ caret: item.caret !== undefined ? item.caret : item.ins.length });
	}

	// ---------- Auswahl-Toolbar (Fett/Kursiv/Code/Farben/Link) ----------
	function renderToolbar(ta) {
		let tb = host ? host.querySelector(".sel-toolbar") : null;
		if (!ta || ta.selectionStart === ta.selectionEnd) { if (tb) tb.remove(); return; }
		if (!tb) {
			tb = document.createElement("div");
			tb.className = "sel-toolbar";
			tb.innerHTML =
				'<button data-wrap="**|**" title="Fett"><b>B</b></button>' +
				'<button data-wrap="*|*" title="Kursiv"><i>K</i></button>' +
				'<button data-wrap="~~|~~" title="Durchgestrichen"><s>S</s></button>' +
				'<button data-wrap="`|`" title="Inline-Code">‹›</button>' +
				'<button data-wrap="==|==" title="Hervorheben">🖍</button>' +
				'<button data-link="1" title="Link einfügen">🔗</button>' +
				'<button data-colormenu="c" title="Textfarbe">A</button>' +
				'<button data-colormenu="bg" title="Hintergrundfarbe">▉</button>' +
				'<div class="color-menu" hidden></div>';
			// mousedown abfangen, damit die Textauswahl in der Textarea erhalten bleibt
			tb.addEventListener("mousedown", (e) => { if (!e.target.closest(".color-menu")) e.preventDefault(); });
			host.appendChild(tb);
		}
		const blkEl = host.querySelector('.blk[data-bid="' + activeId + '"]');
		if (blkEl) {
			const r = blkEl.getBoundingClientRect(), hr = host.getBoundingClientRect();
			tb.style.top = Math.max(0, r.top - hr.top + host.scrollTop - 38) + "px";
			tb.style.left = (r.left - hr.left + 46) + "px";
		}
	}

	// Auswahl in der aktiven Textarea mit before/after umschließen (oder Platzhalter)
	function wrapTa(before, after) {
		const ta = host ? host.querySelector(".blk-input") : null;
		const b = blocks.find((x) => x.id === activeId);
		if (!ta || !b) return;
		const s = ta.selectionStart, e2 = ta.selectionEnd;
		const sel = ta.value.slice(s, e2) || "Text";
		ta.value = ta.value.slice(0, s) + before + sel + after + ta.value.slice(e2);
		b.raw = ta.value;
		autoGrow(ta);
		ta.focus();
		ta.selectionStart = s + before.length;
		ta.selectionEnd = s + before.length + sel.length;
		saveSoon();
	}

	function openColorMenu(kind) {
		const menu = host ? host.querySelector(".color-menu") : null;
		if (!menu) return;
		menu.innerHTML = COLORS.map((c) =>
			'<button class="color-dot ' + (kind === "bg" ? "hl-" : "c-") + c + '" data-color="' + kind + ":" + c + '" title="' + c + '">A</button>'
		).join("");
		menu.hidden = !menu.hidden;
	}

	// ---------- Alles auswählen (Strg+A über alle Blöcke, wie in Notion) ----------
	function setSelAll(on) {
		selAll = on;
		if (host) host.classList.toggle("all-selected", on);
	}

	async function copyAllToClipboard() {
		const md = serialize(blocks);
		try {
			await navigator.clipboard.writeText(md);
		} catch {
			// Fallback für file:// ohne Clipboard-Berechtigung
			const tmp = document.createElement("textarea");
			tmp.value = md;
			tmp.style.position = "fixed";
			tmp.style.opacity = "0";
			document.body.appendChild(tmp);
			tmp.select();
			document.execCommand("copy");
			tmp.remove();
		}
	}

	// Gesamten Seiteninhalt ersetzen (leer oder mit dem ersten getippten Zeichen)
	function replaceAllBlocks(seed) {
		setSelAll(false);
		blocks = [newBlock("p", seed || "")];
		activeId = blocks[0].id;
		save();
		draw({ caret: (seed || "").length });
	}

	// Bilder als Blob in IndexedDB speichern und als eigene Bild-Blöcke einfügen
	// (für Drag & Drop in den Editor sowie Einfügen aus der Zwischenablage).
	async function insertImages(files, blkEl) {
		commitActive();
		let idx = blkEl ? blocks.findIndex((x) => x.id === blkEl.dataset.bid) : blocks.length - 1;
		if (idx < 0) idx = blocks.length - 1;
		for (const f of files) {
			const buf = await U.readAsBuffer(f);
			const blobId = "img:" + U.uid();
			await DB.putBlob(blobId, buf, { name: f.name || "bild", type: f.type });
			const alt = String(f.name || "Bild").replace(/[\[\]()]/g, "");
			blocks.splice(++idx, 0, newBlock("p", "![" + alt + "](" + blobId + ")"));
		}
		await save();
		draw();
	}

	// Globale Tastatur-/Maus-Handler für den Alles-ausgewählt-Modus. Nur EINMAL
	// registriert (der Editor-Container selbst wird bei jedem renderMain neu gebaut).
	let globalWired = false;
	function wireGlobal() {
		if (globalWired) return;
		globalWired = true;
		document.addEventListener("keydown", (e) => {
			if (!host || !document.body.contains(host)) { selAll = false; return; }
			const t = e.target;
			const inField = t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT" || t.isContentEditable);
			const key = (e.key || "").toLowerCase();
			// Undo/Redo über Blockgrenzen — außerhalb von Eingabefeldern (dort gilt das native Undo)
			if ((e.ctrlKey || e.metaKey) && !inField && (key === "z" || key === "y")) {
				e.preventDefault();
				undoRedo(key === "y" || e.shiftKey);
				return;
			}
			if (!selAll) {
				// Strg+A außerhalb jedes Eingabefelds → ganze Seite auswählen
				if ((e.ctrlKey || e.metaKey) && key === "a" && !inField) {
					e.preventDefault();
					commitActive();
					setSelAll(true);
					draw();
				}
				return;
			}
			// Modus "alles ausgewählt":
			if ((e.ctrlKey || e.metaKey) && key === "a") { e.preventDefault(); return; }
			if ((e.ctrlKey || e.metaKey) && key === "c") { e.preventDefault(); copyAllToClipboard(); return; }
			if ((e.ctrlKey || e.metaKey) && key === "x") {
				e.preventDefault();
				copyAllToClipboard().then(() => replaceAllBlocks(""));
				return;
			}
			if ((e.ctrlKey || e.metaKey) && key === "v") {
				// Auswahl ersetzen: frischer leerer Block, das native Einfügen landet darin
				replaceAllBlocks("");
				return;
			}
			if (key === "backspace" || key === "delete") { e.preventDefault(); replaceAllBlocks(""); return; }
			if (key === "escape") { e.preventDefault(); setSelAll(false); return; }
			// Tippen ersetzt die gesamte Auswahl (wie in Notion)
			if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
				e.preventDefault();
				replaceAllBlocks(e.key);
				return;
			}
		});
		// Linksklick irgendwo hebt die Alles-Auswahl wieder auf
		document.addEventListener("mousedown", (e) => { if (selAll && e.button === 0) setSelAll(false); });
		// Klick außerhalb des Editors schreibt den aktiven Block fest (Commit-on-blur, wie in Notion):
		// sonst bleibt der Block als Roh-Textarea stehen, wenn man z.B. in den Titel oder die Sidebar klickt.
		document.addEventListener("mousedown", (e) => {
			if (!activeId || e.button !== 0) return;
			if (!host || !document.body.contains(host)) return;
			if (e.target.closest(".block-editor")) return;
			commitActive();
			draw();
		});
	}

	// ---------- Event-Verkabelung (pro Mount; der Container entsteht bei jedem renderMain neu) ----------
	function wire() {
		host.addEventListener("input", (e) => {
			const ta = e.target;
			if (!ta.classList || !ta.classList.contains("blk-input")) return;
			autoGrow(ta);
			const b = blocks.find((x) => x.id === activeId);
			if (!b) return;
			b.raw = ta.value;
			retype(b);
			saveSoon();
			// Slash-Menü, solange nur "/befehl" im Block steht
			if (/^\/\S*$/.test(ta.value) && b.type === "p") openSlash(ta.value.slice(1));
			else closeSlash();
		});

		host.addEventListener("keydown", (e) => {
			const ta = e.target;
			if (!ta.classList || !ta.classList.contains("blk-input")) return;
			const b = blocks.find((x) => x.id === activeId);
			if (!b) return;
			// Strg+A: erste Betätigung markiert den Blocktext (nativ); ist schon der ganze
			// Block markiert (oder er ist leer), wird die GANZE Seite ausgewählt — dann
			// kopiert Strg+C alles, Entf/Backspace löscht alles, Tippen ersetzt alles.
			if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
				const whole = !ta.value.length || (ta.selectionStart === 0 && ta.selectionEnd === ta.value.length);
				if (whole) {
					e.preventDefault();
					ta.blur();
					commitActive();
					setSelAll(true);
					draw();
				}
				return;
			}
			if (slash) {
				if (e.key === "ArrowDown") { e.preventDefault(); slash.index = (slash.index + 1) % slash.items.length; drawSlash(); return; }
				if (e.key === "ArrowUp") { e.preventDefault(); slash.index = (slash.index - 1 + slash.items.length) % slash.items.length; drawSlash(); return; }
				if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); applySlash(slash.index); return; }
				if (e.key === "Escape") { e.preventDefault(); closeSlash(); return; }
			}
			if (e.key === "Enter" && !e.shiftKey) { onEnter(ta, b, e); return; }
			if (e.key === "Backspace") { onBackspace(ta, b, e); return; }
			if (e.key === "Tab" && LISTY[b.type]) { e.preventDefault(); setIndent(b, ta, e.shiftKey ? -1 : 1); return; }
			if (e.key === "Escape") { commitActive(); draw(); return; }
			if (e.key === "ArrowUp" || e.key === "ArrowDown") onArrow(ta, b, e);
		});

		const maybeToolbar = (e) => {
			if (e.target.classList && e.target.classList.contains("blk-input")) renderToolbar(e.target);
		};
		host.addEventListener("mouseup", maybeToolbar);
		host.addEventListener("keyup", maybeToolbar);

		host.addEventListener("click", (e) => {
			const slashBtn = e.target.closest("[data-slash]");
			if (slashBtn) { applySlash(Number(slashBtn.dataset.slash)); return; }
			const wrapBtn = e.target.closest("[data-wrap]");
			if (wrapBtn) { const p2 = wrapBtn.dataset.wrap.split("|"); wrapTa(p2[0], p2[1]); return; }
			if (e.target.closest("[data-link]")) { wrapTa("[", "](https://)"); return; }
			const cm = e.target.closest("[data-colormenu]");
			if (cm) { openColorMenu(cm.dataset.colormenu); return; }
			const cpick = e.target.closest("[data-color]");
			if (cpick) {
				const kc = cpick.dataset.color.split(":");
				wrapTa(kc[0] === "bg" ? "{bg-" + kc[1] + "}" : "{" + kc[1] + "}", "{/}");
				const menu = host.querySelector(".color-menu");
				if (menu) menu.hidden = true;
				return;
			}
			// To-do direkt in der Ansicht abhaken (ohne den Block zu öffnen)
			if (e.target.classList.contains("blk-check")) {
				const blkEl0 = e.target.closest(".blk");
				const b = blkEl0 && blocks.find((x) => x.id === blkEl0.dataset.bid);
				if (b && b.type === "todo") {
					b.checked = !b.checked;
					b.raw = b.raw.replace(/- \[( |x)\]/, b.checked ? "- [x]" : "- [ ]");
					saveSoon();
					draw();
				}
				return;
			}
			// "+" → neuen Block darunter anlegen und Slash-Menü öffnen
			const plus = e.target.closest(".blk-plus");
			if (plus) {
				const anchor = plus.dataset.plus;
				commitActive();
				const idx = blocks.findIndex((x) => x.id === anchor);
				const nb = newBlock("p", "/");
				blocks.splice((idx === -1 ? blocks.length - 1 : idx) + 1, 0, nb);
				activeId = nb.id;
				draw({ caret: 1 });
				openSlash("");
				return;
			}
			if (e.target.closest(".blk-handle") || e.target.closest("a")) return;
			// Klick unter den letzten Block → neuen Absatz anhängen (wie Notion)
			if (e.target.classList.contains("blk-tail")) {
				commitActive();
				const last = blocks[blocks.length - 1];
				if (last && last.type === "p" && !last.raw.trim()) { activeId = last.id; draw({ caret: 0 }); return; }
				const nb = newBlock("p", "");
				blocks.push(nb);
				activeId = nb.id;
				draw({ caret: 0 });
				return;
			}
			// Block anklicken → bearbeiten (Toggle-Blöcke erst per Doppelklick,
			// damit das native Auf-/Zuklappen per Einfachklick funktioniert)
			const blkEl = e.target.closest(".blk");
			if (blkEl && blkEl.dataset.bid !== activeId) {
				const b = blocks.find((x) => x.id === blkEl.dataset.bid);
				if (b && b.type === "toggle" && e.detail < 2) return;
				activate(blkEl.dataset.bid);
			}
		});

		// Drag & Drop über die ⠿-Handles
		host.addEventListener("dragstart", (e) => {
			const h = e.target.closest(".blk-handle");
			if (h) { dragBid = h.dataset.handle; e.dataTransfer.effectAllowed = "move"; }
		});
		host.addEventListener("dragover", (e) => {
			if (!dragBid) return;
			const blkEl = e.target.closest(".blk");
			if (!blkEl) return;
			e.preventDefault();
			clearDropMarks();
			const r = blkEl.getBoundingClientRect();
			blkEl.classList.add(e.clientY < r.top + r.height / 2 ? "drop-before" : "drop-after");
		});
		host.addEventListener("drop", (e) => {
			if (!dragBid) return;
			e.preventDefault();
			const blkEl = e.target.closest(".blk");
			clearDropMarks();
			if (blkEl && blkEl.dataset.bid !== dragBid) {
				const from = blocks.findIndex((x) => x.id === dragBid);
				if (from !== -1) {
					const r = blkEl.getBoundingClientRect();
					const after = e.clientY >= r.top + r.height / 2;
					const moved = blocks.splice(from, 1)[0];
					const to = blocks.findIndex((x) => x.id === blkEl.dataset.bid);
					blocks.splice(to + (after ? 1 : 0), 0, moved);
					saveSoon();
					draw();
				}
			}
			dragBid = null;
		});
		host.addEventListener("dragend", () => { clearDropMarks(); dragBid = null; });

		// ---------- Bilder: Drag & Drop in den Editor oder Einfügen aus der Zwischenablage ----------
		host.addEventListener("dragover", (e) => {
			if (dragBid) return;
			const items = e.dataTransfer ? e.dataTransfer.items : null;
			if (items && [...items].some((it) => it.kind === "file")) e.preventDefault();
		});
		host.addEventListener("drop", async (e) => {
			if (dragBid) return;
			const files = e.dataTransfer ? [...e.dataTransfer.files] : [];
			const imgs = files.filter((f) => f.type && f.type.startsWith("image/"));
			if (!imgs.length) return;
			e.preventDefault();
			await insertImages(imgs, e.target.closest(".blk"));
		});
		host.addEventListener("paste", async (e) => {
			if (!e.target.classList || !e.target.classList.contains("blk-input")) return;
			const items = e.clipboardData ? [...e.clipboardData.items] : [];
			const imgs = items.filter((it) => it.type && it.type.startsWith("image/")).map((it) => it.getAsFile()).filter(Boolean);
			if (!imgs.length) return;
			e.preventDefault();
			await insertImages(imgs, e.target.closest(".blk"));
		});
	}

	function clearDropMarks() {
		host.querySelectorAll(".drop-before,.drop-after").forEach((el) => el.classList.remove("drop-before", "drop-after"));
	}

	// ---------- Mount: wird von renderMain() für den Modus "blocks" aufgerufen ----------
	function mount(container, pid) {
		// Seitenwechsel: letzte ungespeicherte Änderungen der vorherigen Seite sofort sichern
		if (pageId && pageId !== pid) save();
		host = container;
		pageId = pid;
		const pg = S.pages[pid];
		blocks = parse(pg ? pg.content : "");
		if (!blocks.length) blocks.push(newBlock("p", ""));
		activeId = null;
		slash = null;
		dragBid = null;
		setSelAll(false);
		wireGlobal();
		wire();
		draw();
	}

	return { mount, parse, serialize };
})();